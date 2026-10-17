"""Stand-ins for the outside world in the ideas tests (stdlib only, nothing leaves this machine):

FakeTelegram  an HTTP server shaped like api.telegram.org/bot<token>/<method>: records every call
              (token, method, payload; multipart uploads with their file) and answers like the Bot API.
FakeGemini    an HTTP server shaped like generativelanguage.googleapis.com (generateContent, the key in
              x-goog-api-key): answers the three tasks translate.py sends from tables the test fills, and
              fails on a script (HTTP errors, a slow answer, garbage, a block, a lost link).
FakeSMTP      an SMTP server on 127.0.0.1: EHLO, optional STARTTLS (a certificate made by openssl for the
              test), AUTH PLAIN/LOGIN against one user and password, MAIL/RCPT/DATA; it can refuse a command
              once with a code, or drop the connection inside DATA, to test retries and the "unknown" state.
World         a store, Gmail, the translator, the service, the owner bot and the outbox worker on a temporary
              data directory, wired to the fakes and to a clock the test moves.
RecordingApi  a Telegram client that records and never connects; offline_server() puts it under
              server.BOT for tests of the API process, whatever TG_* the shell has.
make_cert()   a throwaway self-signed certificate for localhost (None without openssl).

No real token, password or address is used: everything here is made up per run.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import socketserver
import ssl
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ideas  # noqa: E402
import mailer  # noqa: E402
import outbox  # noqa: E402
import ownerbot  # noqa: E402
import service  # noqa: E402
import translate  # noqa: E402

GEMINI_KEY = "test-gemini-key-" + "0123456789" * 3
os.environ.pop("GEMINI_API_KEY", None)   # a shell's real key must never let a test of server.py's objects call Google
OWNER_CHAT = "4242"
OWNER_TOKEN = "111111:owner-bot-fake-token"
SHARED_TOKEN = "222222:shared-lead-bot-fake-token"
SECRET = "test-secret-" + "x" * 20
GMAIL_USER = "zmei116@gmail.com"
GMAIL_PASS = "fake-app-password"


class FakeTelegram:
    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self._next = 1000
        self._mu = threading.Lock()
        self.webhook_url = ""
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                _, _, rest = self.path.partition("/bot")
                token, _, method = rest.partition("/")
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n)
                ctype = self.headers.get("Content-Type") or ""
                payload = json.loads(raw) if ctype.startswith("application/json") else fake._multipart(raw, ctype)
                result = fake._answer(token, method, payload)
                b = json.dumps({"ok": True, "result": result}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    @staticmethod
    def _multipart(raw: bytes, ctype: str) -> dict:
        boundary = ctype.split("boundary=", 1)[1].encode()
        out: dict = {}
        for part in raw.split(b"--" + boundary):
            if b"\r\n\r\n" not in part:
                continue
            head, _, body = part.partition(b"\r\n\r\n")
            body = body[:-2] if body.endswith(b"\r\n") else body
            h = head.decode("utf-8")
            name = h.split('name="', 1)[1].split('"', 1)[0]
            if 'filename="' in h:
                out[name] = {"filename": h.split('filename="', 1)[1].split('"', 1)[0], "bytes": body}
            else:
                out[name] = body.decode("utf-8")
        return out

    def _answer(self, token: str, method: str, payload: dict):
        with self._mu:
            self.calls.append((token, method, payload))
            if method in ("sendMessage", "sendDocument", "sendPhoto"):
                self._next += 1
                return {"message_id": self._next, "chat": {"id": int(payload.get("chat_id") or 0)}}
            if method == "editMessageText":
                return {"message_id": payload.get("message_id")}
            if method == "setWebhook":
                self.webhook_url = payload.get("url", "")
                return True
            if method == "getWebhookInfo":
                return {"url": self.webhook_url, "pending_update_count": 0, "max_connections": 1}
            return True

    def of(self, method: str | None = None, token: str | None = None) -> list[dict]:
        with self._mu:
            return [p for t, m, p in self.calls if (method is None or m == method) and (token is None or t == token)]

    def tokens(self) -> set[str]:
        with self._mu:
            return {t for t, _, _ in self.calls}


class FakeGemini:
    """The tables a test fills (all optional):
      languages  {text: (code, name, confident)}    what detect finds (default: English, confident)
      sources    {text: code}                       the language translate finds the text in (default "en")
      glossary   {(target code, text): translation} (default "[<target>] <text>": never mistaken for a real one)
      script     [step, ...]  one is used up per request, before the tables: ("http", 503) | ("sleep", seconds) |
                 ("raw", bytes) | ("blocked",) | ("finish", "MAX_TOKENS") | ("drop-links",) | ("empty",) |
                 ("frame-lost-hole",)   (the last one: a frame answer that drops a {placeholder})
    requests: [{"path", "key", "task", "body", "data"}] in arrival order (body: the request as sent, data: the
    task JSON inside it)."""

    def __init__(self, key: str = GEMINI_KEY):
        self.key = key
        self.languages: dict = {}
        self.sources: dict = {}
        self.glossary: dict = {}
        self.script: list = []
        self.requests: list[dict] = []
        self._mu = threading.Lock()
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                try:
                    code, body = fake._handle(self.path, self.headers.get("x-goog-api-key"), json.loads(raw))
                    self.send_response(code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:      # the client gave up (a timeout test)
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def of(self, task: str | None = None) -> list[dict]:
        with self._mu:
            return [r for r in self.requests if task is None or r["task"] == task]

    @staticmethod
    def _answer(obj, finish: str = "STOP") -> bytes:
        return json.dumps({"candidates": [{"content": {"role": "model", "parts": [{"text": json.dumps(obj, ensure_ascii=False)}]},
                                           "finishReason": finish}]}).encode()

    def _handle(self, path: str, key: str | None, req: dict) -> tuple[int, bytes]:
        task = json.loads(req["contents"][0]["parts"][0]["text"])
        with self._mu:
            self.requests.append({"path": path, "key": key, "task": task.get("task"), "body": req, "data": task})
            step = self.script.pop(0) if self.script else None
        if step and step[0] == "http":
            return step[1], b'{"error":{"message":"scripted"}}'
        if step and step[0] == "sleep":
            time.sleep(step[1])
        if step and step[0] == "raw":
            return 200, step[1]
        if step and step[0] == "blocked":
            return 200, json.dumps({"promptFeedback": {"blockReason": "SAFETY"}}).encode()
        if step and step[0] == "finish":
            return 200, self._answer({"translation": "cut", "source_language": "ru"}, step[1])
        if key != self.key:
            return 403, b'{"error":{"message":"API key not valid"}}'
        what, text = task.get("task"), task.get("text", "")
        if what == "detect":
            code, name, sure = self.languages.get(text, ("en", "English", True))
            return 200, self._answer({"code": code, "name": name, "confident": sure})
        target = task["target_language"]["code"]
        if what == "translate":
            out = self.glossary.get((target, text), f"[{target}] {text}")
            if step and step[0] == "drop-links":
                out = "translated without the links"
            if step and step[0] == "empty":
                out = "  "
            return 200, self._answer({"source_language": self.sources.get(text, "en"), "translation": out})
        rows = []                                     # translate_strings: the frame of an e-mail
        for r in task["strings"]:
            t = f"[{target}] {r['text']}"
            rows.append({"key": r["key"], "text": t.replace("{id}", "") if step and step[0] == "frame-lost-hole" else t})
        return 200, self._answer({"strings": rows})


class FakeSMTP:
    """plan: {"MAIL": [421]} answers the next MAIL FROM with 421 once; {"DATA": ["drop"]} closes the
    connection after the message body arrives, before answering it."""

    def __init__(self, user: str = GMAIL_USER, password: str = GMAIL_PASS, tls: ssl.SSLContext | None = None,
                 advertise_starttls: bool = True):
        self.user, self.password, self.tls, self.advertise_starttls = user, password, tls, advertise_starttls
        self.messages: list[dict] = []
        self.events: list[str] = []
        self.plan: dict[str, list] = {}
        self._mu = threading.Lock()
        fake = self

        class H(socketserver.StreamRequestHandler):
            def handle(self):
                fake._session(self)

        class S(socketserver.ThreadingMixIn, socketserver.TCPServer):
            allow_reuse_address = True
            daemon_threads = True

        self.server = S(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    @property
    def port(self) -> int:
        return self.server.server_address[1]

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def _planned(self, verb: str):
        with self._mu:
            q = self.plan.get(verb)
            return q.pop(0) if q else None

    def _session(self, h) -> None:
        held: dict = {}
        try:
            self._serve(h, held)
        finally:
            if held.get("tls") is not None:  # the handler closes only the plain socket it was given
                held["tls"].close()

    def _serve(self, h, held: dict) -> None:
        sock = h.request
        rf, wf = h.rfile, h.wfile

        def send(line: str) -> None:
            wf.write((line + "\r\n").encode())
            wf.flush()

        send("220 fake ESMTP")
        tls_on = authed = False
        mail_from, rcpts = None, []
        while True:
            line = rf.readline()
            if not line:
                return
            cmd = line.decode("utf-8", "replace").rstrip("\r\n")
            verb = cmd.split(" ", 1)[0].upper()
            self.events.append(verb if verb != "AUTH" else "AUTH")
            if verb in ("EHLO", "HELO"):
                caps = ["fake"] + (["STARTTLS"] if self.tls and self.advertise_starttls and not tls_on else []) + ["AUTH PLAIN LOGIN"]
                for i, c in enumerate(caps):
                    send(("250 " if i == len(caps) - 1 else "250-") + c)
            elif verb == "STARTTLS" and self.tls and not tls_on:
                send("220 ready")
                sock = held["tls"] = self.tls.wrap_socket(sock, server_side=True)
                rf, wf = sock.makefile("rb"), sock.makefile("wb")
                tls_on = True
            elif verb == "AUTH":
                parts = cmd.split(" ")
                if parts[1].upper() == "PLAIN":
                    blob = parts[2] if len(parts) > 2 else (send("334 "), rf.readline().decode().strip())[1]
                    _, u, p = base64.b64decode(blob).split(b"\0")
                else:
                    send("334 VXNlcm5hbWU6")
                    u = base64.b64decode(rf.readline().strip())
                    send("334 UGFzc3dvcmQ6")
                    p = base64.b64decode(rf.readline().strip())
                if (u.decode(), p.decode()) == (self.user, self.password):
                    authed = True
                    send("235 2.7.0 accepted")
                else:
                    send("535 5.7.8 credentials rejected")
            elif verb == "MAIL":
                code = self._planned("MAIL")
                if code:
                    send(f"{code} try later")
                elif not authed:
                    send("530 5.7.0 authentication required")
                else:
                    mail_from, rcpts = cmd[10:].strip(" <>"), []
                    send("250 ok")
            elif verb == "RCPT":
                rcpts.append(cmd[8:].strip(" <>"))
                send("250 ok")
            elif verb == "DATA":
                send("354 go on")
                data = b""
                while True:
                    ln = rf.readline()
                    if not ln or ln == b".\r\n":
                        break
                    data += ln
                if self._planned("DATA") == "drop":
                    return
                with self._mu:
                    self.messages.append({"from": mail_from, "to": rcpts, "data": data, "tls": tls_on})
                send("250 2.0.0 queued")
            elif verb == "QUIT":
                send("221 bye")
                return
            else:
                send("250 ok" if verb in ("RSET", "NOOP") else "502 not implemented")


class RecordingApi(ownerbot.TelegramApi):
    """A TelegramApi that records every call (method, content type, body) and never opens a socket."""

    def __init__(self, calls: list):
        super().__init__("0:offline", "http://offline.invalid")
        self.calls = calls

    def _post(self, method: str, data: bytes, ctype: str):
        self.calls.append((method, ctype, data))
        return {"message_id": len(self.calls)} if method.startswith("send") else True


def offline_server(test: "unittest.TestCase", server, env: dict | None = None) -> list:
    """For one test of the API process itself (server.py's module-level objects): server.BOT becomes
    an owner bot with its OWN environment (default: the shared lead bot's fake token and chat, no
    webhook secret) whose Telegram is a RecordingApi, and it is the only listener of server.SERVICE.
    The real BOT reads TG_* from os.environ, so without this a shell with TG_* set would make a test
    post to a real chat (review R4). Undone by the test's cleanup. Returns the recorded calls."""
    calls: list = []
    saved_bot, saved_listeners = server.BOT, list(server.SERVICE.listeners)
    server.SERVICE.listeners[:] = []
    server.BOT = ownerbot.OwnerBot(server.SERVICE, env=env or {"TG_BOT_TOKEN": "1:fake", "TG_CHAT_ID": "1"},
                                   public_origin=server.PUBLIC_ORIGIN, api_factory=lambda token, base: RecordingApi(calls))

    def restore() -> None:
        server.BOT = saved_bot
        server.SERVICE.listeners[:] = saved_listeners

    test.addCleanup(restore)
    return calls


def make_cert(d: Path) -> tuple[str, str] | None:
    """A self-signed certificate for localhost, made by openssl in a temporary folder (None without it)."""
    exe = shutil.which("openssl")
    if not exe:
        return None
    key, crt = str(d / "k.pem"), str(d / "c.pem")
    r = subprocess.run([exe, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "1",
                        "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
                       capture_output=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"})
    return (crt, key) if r.returncode == 0 else None


class World:
    """The ideas server on a temporary folder: store, mailer, service, owner bot, worker; fake Telegram
    and fake SMTP; `now` is the clock (seconds), moved by the test."""

    def __init__(self, data: Path, env: dict | None = None, smtp: FakeSMTP | None = None, gemini: bool = False):
        self.data = data
        self.tg = FakeTelegram()
        self.smtp = smtp or FakeSMTP()
        self.gemini = FakeGemini() if gemini else None   # off: no GEMINI_API_KEY, like a hub without the key
        self.pauses: list[float] = []                    # the waits before a retry (nothing sleeps for real)
        self.now = [1_790_000_000.0]
        self.env = {"TG_OWNER_BOT_TOKEN": OWNER_TOKEN, "TG_BOT_TOKEN": SHARED_TOKEN, "TG_CHAT_ID": OWNER_CHAT,
                    "TG_WEBHOOK_SECRET": SECRET, "TG_API_BASE": self.tg.base, "TG_OWNER_LANG": "en",
                    "GMAIL_USER": GMAIL_USER, "GMAIL_APP_PASSWORD": GMAIL_PASS, "SMTP_HOST": "127.0.0.1",
                    "SMTP_PORT": str(self.smtp.port), "SMTP_TLS": "none", "MAIL_UNDO_S": "60",
                    **({"GEMINI_API_KEY": GEMINI_KEY, "GEMINI_API_BASE": self.gemini.base, "GEMINI_TIMEOUT_S": "0.5"} if self.gemini else {}),
                    **(env or {})}
        self.reports = data / "reports.jsonl"
        self.store = ideas.IdeaStore(lambda: self.data, lambda: self.reports, seed=lambda: self.seed_path)
        self.seed_path: Path | None = None
        cfg = lambda: translate.GeminiConfig.from_env(self.env)  # noqa: E731
        self.translator = translate.Translator(cfg, lambda: self.data, gemini=translate.Gemini(cfg, sleep=self.pauses.append))
        self.mailer = mailer.Mailer(lambda: mailer.MailConfig.from_env(self.env), public_origin="https://gsfpv.example",
                                    frames=self.translator.cached_frame)
        self.service = service.IdeasService(self.store, self.mailer, clock=lambda: self.now[0], env=self.env,
                                            public_origin="https://gsfpv.example", translator=self.translator)
        self.bot = ownerbot.OwnerBot(self.service, env=self.env, public_origin="https://gsfpv.example")
        self.worker = outbox.OutboxWorker(self.service, self.mailer)

    def close(self) -> None:
        self.tg.close()
        self.smtp.close()
        if self.gemini:
            self.gemini.close()

    def report(self, rid: str = "R-20261013-0001", kind: str = "idea", message: str = "Add rain to the scenes",
               contact: str = "pilot@example.com", lang: str = "pl", **extra) -> dict:
        """A report line as server.store_report writes it, appended to reports.jsonl, and its idea."""
        line = {"id": rid, "ts": "2026-10-13T10:00:00Z", "site": "gsfpv", "kind": kind, "page": "fly", "locale": lang,
                "scene": "39e63ce9", "release": "608259b", "message": message, "contact": contact, "suspect": False,
                "diagnostics": False, "diagBytes": 0, **extra}
        with self.reports.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        return self.service.add_report(line)

    def update(self, uid: int, **body) -> str:
        """A Telegram update from the owner's chat (callers may override the chat)."""
        return self.bot.handle_update({"update_id": uid, **body})

    def owner_msg(self, text: str, reply_to: int | None = None, chat: str = OWNER_CHAT, mid: int = 1) -> dict:
        m = {"message_id": mid, "chat": {"id": int(chat), "type": "private"}, "from": {"id": int(chat)}, "text": text}
        if reply_to:
            m["reply_to_message"] = {"message_id": reply_to}
        return {"message": m}

    def press(self, data: str, on_message: int, chat: str = OWNER_CHAT) -> dict:
        return {"callback_query": {"id": f"cb{data}", "from": {"id": int(chat)}, "data": data,
                                   "message": {"message_id": on_message, "chat": {"id": int(chat)}}}}

    def card_id(self, rid: str) -> int:
        return self.service.get(rid)["tg"]["card"]
