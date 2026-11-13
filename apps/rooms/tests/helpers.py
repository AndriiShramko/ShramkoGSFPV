"""Test helpers: the service in a thread with its own loop, a blocking stdlib WebSocket client, HTTP calls."""
from __future__ import annotations

import asyncio
import http.client as httpc
import json
import socket
import struct
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import protocol as P  # noqa: E402
import rooms as R  # noqa: E402
import ws as W  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SCENE = "39e63ce9"  # the fixture scene of the bench (docs/wip/train1-plan.md section 2)

R.log = lambda msg: None  # quiet tests


class ServiceThread:
    """rooms.Service on 127.0.0.1 and a free port, in a thread; `run(coro_fn)` runs a coroutine in its loop."""

    def __init__(self, **kw):
        self.loop = asyncio.new_event_loop()
        self.svc = R.Service(**kw)
        ready = threading.Event()

        def main():
            asyncio.set_event_loop(self.loop)
            self.port = self.loop.run_until_complete(self.svc.start("127.0.0.1", 0))
            ready.set()
            self.loop.run_forever()

        self.thread = threading.Thread(target=main, daemon=True)
        self.thread.start()
        ready.wait(10)

    def run(self, coro, timeout: float = 60):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)

    def stop(self):
        self.run(self.svc.stop())
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)


def http(port: int, method: str, path: str, body=None, headers: dict | None = None) -> tuple[int, dict]:
    c = httpc.HTTPConnection("127.0.0.1", port, timeout=10)
    data = json.dumps(body).encode() if body is not None and not isinstance(body, bytes) else body
    h = {"Content-Type": "application/json", **(headers or {})}
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    raw = r.read()
    c.close()
    return r.status, (json.loads(raw) if raw else {})


def create_room(port: int, client: str = "10.0.0.1", **body) -> dict:
    code, got = http(port, "POST", "/api/rooms", {"scene": {"id": SCENE}, **body}, {"X-Forwarded-For": client})
    assert code == 201, (code, got)
    return got


class HandshakeRejected(Exception):
    pass


class Client:
    """A blocking WebSocket client: masks what it sends, checks Sec-WebSocket-Accept, reads frames."""

    def __init__(self, port: int, path: str = "/api/rooms/ws", client: str = "10.0.0.9", rcvbuf: int | None = None,
                 timeout: float = 5.0):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if rcvbuf:
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, rcvbuf)
        self.sock.settimeout(timeout)
        self.sock.connect(("127.0.0.1", port))
        req, key = W.client_request(f"127.0.0.1:{port}", path, extra={"X-Forwarded-For": client})
        self.sock.sendall(req)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1)
            if not chunk:
                raise HandshakeRejected("closed")
            head += chunk
        self.status = int(head.split(b" ", 2)[1])
        hdrs = {ln.split(":", 1)[0].strip().lower(): ln.split(":", 1)[1].strip()
                for ln in head.decode("latin-1").split("\r\n")[1:] if ":" in ln}
        if self.status != 101 or not W.check_accept(key, hdrs.get("sec-websocket-accept")):
            self.sock.close()
            raise HandshakeRejected(str(self.status))
        self.buf = b""

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("eof")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self) -> tuple[int, bytes]:
        b0, b1 = self._read(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack(">H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", self._read(8))[0]
        assert not b1 & 0x80, "the server must not mask"
        return b0 & 0x0F, self._read(n)

    def send(self, op: int, data: bytes) -> None:
        self.sock.sendall(W.encode_frame(op, data, mask=True))

    def send_json(self, obj: dict) -> None:
        self.send(W.OP_TEXT, json.dumps(obj).encode())

    def hello(self, room: str, nick: str = "Ala", host_key: str | None = None) -> dict:
        m = {"type": "hello", "v": P.VERSION, "room": room, "nick": nick}
        if host_key:
            m["hostKey"] = host_key
        self.send_json(m)
        return self.next_json()

    def next_json(self) -> dict:
        while True:
            op, data = self.recv()
            if op == W.OP_TEXT:
                return json.loads(data)
            if op == W.OP_CLOSE:
                return {"type": "closed", "code": struct.unpack(">H", data[:2])[0] if len(data) >= 2 else None}

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def pose(seq: int = 1, x: float = 1.0, flags: int = P.FLAG_ARMED) -> bytes:
    return P.encode_pose({"flags": flags, "seq": seq, "tick": seq * 4, "pos": [x, 2.0, 3.0], "quat": [0, 0, 0, 1],
                          "vel": [0.5, 0, -0.25], "throttle": 0.5})
