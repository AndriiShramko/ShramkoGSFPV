"""Stand-ins and helpers for the recordings' tests (test_sessions.py, test_session_delivery.py), stdlib only, nothing leaves this machine:

package()          the REAL package fixture (made by the sound repository's writer) with another consent block, a filler of random bytes
                   (a package of many chunks), a changed manifest, or no manifest
StreamTelegram     an HTTP server shaped like api.telegram.org/bot<token>/<method> that READS A BODY IN BLOCKS and keeps none of it: for a
                   sendDocument it records the fields, the file name, the file's length and SHA-256, so a test of a 20 MB upload measures the
                   sender's memory and not this fake's. It knows its bot tokens (a wrong one is 401), can fail the next calls by a plan
                   (HTTP 500, 429 with retry_after, a dropped connection) and records every call.
Rig                the store, both channels, the workers and the fakes on a temporary data directory and a clock the test moves.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mailer  # noqa: E402
import ownerbot  # noqa: E402
import session_delivery as sd  # noqa: E402
from fakes import GMAIL_PASS, GMAIL_USER, FakeSMTP  # noqa: E402
from sessions import CHUNK_BYTES, SessionStore  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "session-adult.zip"
MIB = 1 << 20
BOT_TOKEN = "777000:stream-bot-fake-token-" + "k" * 20
CHAT = "4242"


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def package(consent: dict | None = None, filler: int = 0, manifest_over: dict | None = None, drop_manifest: bool = False) -> bytes:
    """The real fixture package, optionally with another consent block, a filler entry of random bytes (a package of several chunks),
    a changed manifest, or no manifest at all. Stored without compression, like the real writer's zips."""
    src = zipfile.ZipFile(FIXTURE)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == "manifest.json":
                if drop_manifest:
                    continue
                m = json.loads(data)
                if consent is not None:
                    m["consent"] = {**m["consent"], **consent}
                if manifest_over:
                    m.update(manifest_over)
                data = json.dumps(m).encode()
            z.writestr(info.filename, data)
        if filler:
            z.writestr("voice-extra.bin", os.urandom(filler))
    return out.getvalue()


def chunks_of(data: bytes) -> list[bytes]:
    return [data[i:i + CHUNK_BYTES] for i in range(0, len(data), CHUNK_BYTES)]


class StreamTelegram:
    def __init__(self, tokens: tuple[str, ...] = (BOT_TOKEN,)):
        self.tokens = set(tokens)
        self.calls: list[dict] = []
        self.plan: list[tuple] = []             # consumed one per call: ("status", 500) ("retry", 900) ("drop",)
        self.max_block = 0
        self._next = 2000
        self._mu = threading.Lock()
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                fake._handle(self)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def _answer(self, h, status: int, doc: dict) -> None:
        b = json.dumps(doc).encode()
        h.send_response(status)
        h.send_header("Content-Type", "application/json")
        h.send_header("Content-Length", str(len(b)))
        h.end_headers()
        h.wfile.write(b)

    def _handle(self, h) -> None:
        _, _, rest = h.path.partition("/bot")
        token, _, method = rest.partition("/")
        n = int(h.headers.get("Content-Length") or 0)
        ctype = h.headers.get("Content-Type") or ""
        call: dict = {"method": method, "token_ok": token in self.tokens, "length": n, "fields": {}}
        if ctype.startswith("multipart/form-data"):
            self._read_multipart(h, n, ctype, call)
        else:
            raw = h.rfile.read(n)
            try:
                call["fields"] = json.loads(raw)
            except ValueError:
                call["fields"] = {}
        with self._mu:
            step = self.plan.pop(0) if self.plan else None
            self.calls.append(call)
            self._next += 1
            mid = self._next
        if step and step[0] == "drop":
            h.connection.close()
            return
        if token not in self.tokens:
            return self._answer(h, 401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
        if step and step[0] == "status":
            return self._answer(h, step[1], {"ok": False, "error_code": step[1], "description": "Internal Server Error"})
        if step and step[0] == "retry":
            return self._answer(h, 429, {"ok": False, "error_code": 429, "description": "Too Many Requests: retry later", "parameters": {"retry_after": step[1]}})
        self._answer(h, 200, {"ok": True, "result": {"message_id": mid, "chat": {"id": int(call["fields"].get("chat_id") or 0)}}})

    def _read_multipart(self, h, n: int, ctype: str, call: dict) -> None:
        """Fields before the file, then the file part, then the tail: the file is hashed as it arrives, never kept."""
        boundary = ctype.split("boundary=", 1)[1]
        tail = f"\r\n--{boundary}--\r\n".encode()
        buf, left, in_file = b"", n, False
        digest, file_len, hold = hashlib.sha256(), 0, b""
        while left > 0:
            block = h.rfile.read(min(65536, left))
            if not block:
                break
            left -= len(block)
            self.max_block = max(self.max_block, len(block))
            if not in_file:
                buf += block
                marker = buf.find(b"\r\n\r\n", buf.find(b'filename="')) if b'filename="' in buf else -1
                if marker < 0:
                    continue
                head, body = buf[:marker], buf[marker + 4:]
                for part in head.decode("utf-8").split(f"--{boundary}"):
                    if 'name="' in part and 'filename="' not in part:
                        name = part.split('name="', 1)[1].split('"', 1)[0]
                        call["fields"][name] = part.split("\r\n\r\n", 1)[1].rstrip("\r\n") if "\r\n\r\n" in part else ""
                    elif 'filename="' in part:
                        call["filename"] = part.split('filename="', 1)[1].split('"', 1)[0]
                buf, in_file, block = b"", True, body
            data = hold + block
            if len(data) > len(tail):
                digest.update(data[:-len(tail)])
                file_len += len(data) - len(tail)
                hold = data[-len(tail):]
            else:
                hold = data
        call["file"] = {"bytes": file_len, "sha256": digest.hexdigest(), "tail_ok": hold == tail} if in_file else None

    def of(self, method: str) -> list[dict]:
        with self._mu:
            return [c for c in self.calls if c["method"] == method]


class Rig:
    """Everything the delivery needs, on a temporary directory and a moving clock. `smtp_spool`: the SMTP fake writes messages to files."""

    def __init__(self, test: unittest.TestCase, *, tg_max: int = sd.TG_MAX_BYTES, mail_max: int = sd.MAIL_MAX_BYTES, smtp_spool: bool = False,
                 telegram: bool = True, password: str = GMAIL_PASS, token: str = BOT_TOKEN):
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.clock = [1_794_000_000.0]
        self.tg = StreamTelegram()
        test.addCleanup(self.tg.close)
        self.spool = self.dir / "spool"
        self.spool.mkdir()
        self.smtp = FakeSMTP(spool=self.spool if smtp_spool else None)
        test.addCleanup(self.smtp.close)
        self.admin_url = "https://gsfpv.example.test/admin/"
        self.tg_config = {"token": token if telegram else "", "chat": CHAT if telegram else ""}
        self.mail_config = {"password": password}
        self.tg_max, self.mail_max = tg_max, mail_max
        self.build()

    def build(self) -> None:
        """(Re)build the store, the channels and the workers on the same directory: what a restart of the API does."""
        self.store = SessionStore(lambda: self.dir, free_bytes=lambda: 10 * 1024 * MIB, now=lambda: self.clock[0])
        self.store.recover()
        self.telegram = sd.TelegramChannel(lambda: ownerbot.BotConfig(token=self.tg_config["token"], chat=self.tg_config["chat"], api_base=self.tg.base),
                                           max_bytes=lambda: self.tg_max, admin_url=self.admin_url, timeout=10)
        self.email = sd.EmailChannel(lambda: mailer.MailConfig(user=GMAIL_USER, password=self.mail_config["password"], host="127.0.0.1", port=self.smtp.port, tls="none", timeout=10),
                                     to=lambda: GMAIL_USER, max_bytes=lambda: self.mail_max, admin_url=self.admin_url)
        self.delivery = sd.Delivery(self.store, self.telegram, self.email, self.admin_url, now=lambda: self.clock[0])
        self.tg_worker, self.mail_worker = self.delivery.workers

    def stored(self, data: bytes, client: str = "203.0.113.5") -> str:
        """A package uploaded and stored (not delivered); the session id."""
        import io as _io
        s = self.store.start(client, {"size": len(data), "sha256": sha(data), "consentSend": True, "lesson": "walls-hall"})
        for n, c in enumerate(chunks_of(data)):
            self.store.put_chunk(s["id"], s["token"], n, len(c), _io.BytesIO(c).read, sha(c))
        self.store.finish(s["id"], s["token"], None)
        return s["id"]

    def channels(self, sid: str) -> dict:
        return self.store.get(sid)["channels"]

    def status(self, sid: str) -> dict:
        m = self.store.get(sid)
        return {"channels": {n: c["status"] for n, c in m["channels"].items()}, "delivered": SessionStore.delivered(m)}
