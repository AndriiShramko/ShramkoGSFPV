"""A local copy of the recordings' API for the browser runs (tools/bench/src/sonicrec-upload.ts), nothing in it leaves this machine.

What runs here is the REAL thing: server.Handler (the routes, the limits), the real SessionStore on a temporary data directory, and the
two real delivery workers. Only the outside is made up: a Telegram that reads bodies in blocks and keeps none (fakes_sessions.StreamTelegram)
and an SMTP server on 127.0.0.1 (fakes.FakeSMTP, a message per spool file). The retry schedule is the real one (30 s, 2 min ...), but its
clock is the real clock plus an offset the control can move, so "the channel recovers after three minutes" takes a moment.

    python rig_server.py [--data DIR] [--admin-password TEST-PASSWORD]

prints ONE json line {"api": <port>, "control": <port>, "data": <dir>} and runs until its standard input is closed (the harness owns it)
or it is killed. With --admin-password the owner's admin answers on the API port under that TEST password (a hash is made here, in this process only;
the live admin and its password are never involved): the Sessions tab can be tried in a browser against this copy. The control (second port, JSON):
    GET  /state      what the fakes received (files by SHA-256 and size), the sessions the store lists, the retry clock's offset
    POST /telegram   {"plan": [["status", 500], ["retry", 3], ["drop"]]}  the next Telegram calls fail so
    POST /email      {"password": "wrong"} makes the mail channel fail its login; {"password": "ok"} lets it work again
    POST /clock      {"advance": 600}  seconds the retry clock jumps ahead
    POST /channel    {"id": "S-...", "channel": "telegram", "status": "failed"}  sets a channel's state as the worker would after it gave up
    POST /restart    the store and the workers are built again over the same files, as a restart of the API does (what is held stays)
    POST /reset      the per-client rate counters are cleared
"""
from __future__ import annotations

import email
import email.policy
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import mailer  # noqa: E402
import ownerbot  # noqa: E402
import server  # noqa: E402
import session_delivery as sd  # noqa: E402
from fakes import GMAIL_PASS, GMAIL_USER, FakeSMTP  # noqa: E402
from fakes_sessions import BOT_TOKEN, CHAT, StreamTelegram  # noqa: E402
from sessions import SessionStore  # noqa: E402

GIB = 1 << 30


class Rig:
    def __init__(self, data: Path):
        self.dir = data
        self.offset = [0.0]
        self.tg = StreamTelegram()
        self.spool = self.dir / "mail-spool"
        self.spool.mkdir(parents=True, exist_ok=True)
        self.smtp = FakeSMTP(spool=self.spool)
        self.mail_config = {"password": GMAIL_PASS}
        self.admin_url = "https://gsfpv.example.test/admin/"
        self.store: SessionStore | None = None
        self.delivery: sd.Delivery | None = None
        self.build()

    def clock(self) -> float:
        return time.time() + self.offset[0]

    def build(self) -> None:
        """The store and the workers (again) over the same files: a restart of the API."""
        if self.delivery is not None:
            self.delivery.stop()
        self.store = SessionStore(lambda: self.dir, free_bytes=lambda: 10 * GIB, now=self.clock)
        self.store.recover()
        telegram = sd.TelegramChannel(lambda: ownerbot.BotConfig(token=BOT_TOKEN, chat=CHAT, api_base=self.tg.base), admin_url=self.admin_url, timeout=10)
        mail = sd.EmailChannel(lambda: mailer.MailConfig(user=GMAIL_USER, password=self.mail_config["password"], host="127.0.0.1", port=self.smtp.port, tls="none", timeout=10),
                               to=lambda: GMAIL_USER, admin_url=self.admin_url)
        self.delivery = sd.Delivery(self.store, telegram, mail, self.admin_url, poll_s=0.1, now=self.clock)
        server.SESSIONS = self.store          # the handler's own module-level store: the real routes now work on this directory
        self.delivery.start()

    def mail_messages(self) -> list[dict]:
        out = []
        for msg in list(self.smtp.messages):
            raw = Path(msg["path"]).read_bytes() if "path" in msg else msg["data"]
            m = email.message_from_bytes(raw, policy=email.policy.default)
            att = None
            for part in m.walk():
                if part.get_filename():
                    data = part.get_payload(decode=True)
                    att = {"name": part.get_filename(), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            out.append({"to": m["To"], "subject": str(m["Subject"]), "attachment": att})
        return out

    def state(self) -> dict:
        docs = [{"filename": c.get("filename"), "bytes": c["file"]["bytes"], "sha256": c["file"]["sha256"]} for c in self.tg.of("sendDocument") if c.get("file")]
        listed = [{"id": r["id"], "bytes": r["bytes"], "sha256": r["sha256"], "delivered": r["delivered"], "channels": {k: v["status"] for k, v in r["channels"].items()}} for r in self.store.list()]
        return {"telegram": {"documents": docs, "calls": len(self.tg.calls), "messages": len(self.tg.of("sendMessage"))}, "mail": {"messages": self.mail_messages()},
                "sessions": listed, "clockOffset": self.offset[0]}


def control(rig: Rig) -> ThreadingHTTPServer:
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, doc: dict, status: int = 200) -> None:
            b = json.dumps(doc).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send(rig.state() if self.path == "/state" else {"ok": False}, 200 if self.path == "/state" else 404)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/telegram":
                rig.tg.plan.extend(tuple(step) for step in body.get("plan", []))
            elif self.path == "/email":
                rig.mail_config["password"] = GMAIL_PASS if body.get("password") == "ok" else "wrong-password"
            elif self.path == "/clock":
                rig.offset[0] += float(body.get("advance", 0))
                rig.delivery.wake()
            elif self.path == "/channel":
                sid, name, status = body.get("id"), body.get("channel"), body.get("status")
                rig.store.update(sid, lambda m: m["channels"][name].update({"status": status, "failures": 9 if status == "failed" else 0, "error": "network" if status == "failed" else ""}))
            elif self.path == "/restart":
                rig.build()
            elif self.path == "/reset":
                for b in (server._sthits, server._schits, server._sqhits, server._all_hits):
                    b.clear()
            else:
                return self._send({"ok": False}, 404)
            self._send({"ok": True})

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main() -> None:
    args = sys.argv[1:]
    data = Path(args[args.index("--data") + 1]) if "--data" in args else Path(tempfile.mkdtemp(prefix="sonicrec-rig-"))
    data.mkdir(parents=True, exist_ok=True)
    os.environ.pop("GEMINI_API_KEY", None)
    if "--admin-password" in args:
        import admin
        os.environ["ADMIN_PASSWORD_HASH"] = admin.make_hash(args[args.index("--admin-password") + 1])
    server.DATA_DIR = data                 # the admin's audit log and the sessions' index live under the same temporary directory
    rig = Rig(data)
    api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    ctl = control(rig)
    print(json.dumps({"api": api.server_address[1], "control": ctl.server_address[1], "data": str(data)}), flush=True)
    sys.stdin.read()          # the harness closes our stdin to end us
    rig.delivery.stop()


if __name__ == "__main__":
    main()
