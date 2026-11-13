"""gsfpv-rooms: pilots who fly one scan together (docs/rooms-protocol.md, protocol rooms/1).

One asyncio process, Python stdlib only, behind our nginx on the internal network (deploy/compose.yml):
  GET  /api/rooms/health    {ok, rooms, pilots}
  GET  /api/rooms           listed rooms
  POST /api/rooms           {scene:{id, render?}, shared?, name?, listed?, course?} -> 201 {id, hostKey}
  GET  /api/rooms/<id>      one room
  GET  /api/rooms/ws        WebSocket: hello -> welcome, binary poses up, one snapshot per room tick down
Rooms live in RAM only (nothing on disk, no poses kept beyond the last one per member). Logs carry no client
address, no query string and no room id.
Run: python -u apps/rooms/rooms.py   (HOST default 0.0.0.0, PORT default 8091)
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import protocol as P  # noqa: E402
import ws as W  # noqa: E402

PORT = 8091
TICK_HZ = 15                   # rooms-plan.md 2.2: snapshots down at 15 Hz (tests/test_relay.py measures the rate)
CAP = 8                        # pilots in a temporary room (rooms-plan.md 2.3; tests/test_relay.py fills it)
EMPTY_CLOSE_S = 600            # a temporary room closes 10 minutes after its last pilot (rooms-plan.md 2.3)
SWEEP_S = 30                   # estimate: how often closed rooms are looked for (a room lives at most 30 s longer)
SKIP_ABOVE = 16 * 1024         # rooms-plan.md 2.2: a socket with more unsent bytes skips snapshots (tests/test_backpressure.py)
DROP_ABOVE = 256 * 1024        # estimate: a reader this far behind is closed (control messages keep queueing)
POSE_KEEP_PER_S = 20           # rooms-plan.md 2.5: poses above 20/s from one socket are dropped (tests/test_rates.py)
POSE_CLOSE_PER_S = 60          # rooms-plan.md 2.5: a socket sending more than 60/s is closed (tests/test_rates.py)
CREATES_PER_HOUR = 10          # rooms-plan.md 2.5, per client address
# estimate (review RV-5): an address's share of a day. rooms-plan.md 2.5 had 200 a day for all clients together, which one
# address at 10 an hour (240 a day) could hold alone; MAX_ROOMS bounds the memory instead (tests/test_review.py)
CREATES_PER_DAY_EACH = 20
# review RV-2: the close limit POSE_CLOSE_PER_S counts every message of a socket (text and junk too, PoseGate.take);
# the client sends 15 poses a second and a ping every 20 s, so it stays far below (tests/test_review.py)
PATH_RE = re.compile(r"/api/rooms(/[A-Za-z0-9_-]{1,16})?")  # review RV-3: any other target is refused before routing
JOINS_PER_MIN = 20             # rooms-plan.md 2.5, per client address (counted at the upgrade)
MAX_ROOMS = 200                # estimate: open rooms at once (the day's create limit bounds it anyway)
HELLO_TIMEOUT_S = 10           # estimate: the first message must come this soon after the upgrade
IDLE_TIMEOUT_S = 70            # estimate: the client pings every 20 s; nginx's read timeout is 75 s
MAX_TEXT = 2048                # estimate: a hello is under 300 bytes
MAX_HEAD = 8192                # bytes of request line and headers
MAX_BODY = 4096                # nginx client_max_body_size 4k on /api/rooms
REQUEST_TIMEOUT_S = 10         # estimate: a request must arrive this soon


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


class Window:
    """At most n events per `window` seconds per key (apps/api/server.py _rate, with an injectable clock)."""

    def __init__(self, n: int, window: float, clock=time.monotonic):
        self.n, self.window, self.clock = n, window, clock
        self.q: dict[str, deque] = {}

    def allow(self, key: str) -> bool:
        q = self.q.setdefault(key, deque())
        now = self.clock()
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.n:
            return False
        q.append(now)
        return True

    def prune(self) -> int:
        """Forget every key whose events all left the window (review RV-7: an address is not kept longer); keys left."""
        now = self.clock()
        for key in list(self.q):
            q = self.q[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if not q:
                del self.q[key]
        return len(self.q)


class PoseGate:
    """Per socket: keep at most `keep` poses a second, close above `close` messages a second of any kind (sliding 1 s
    windows). `take(pose=False)` counts a text or junk message: it is never kept, it only counts toward the close."""

    def __init__(self, keep: float = POSE_KEEP_PER_S, close: float = POSE_CLOSE_PER_S, clock=time.monotonic):
        self.keep, self.close, self.clock = keep, close, clock
        self.seen: deque = deque()
        self.kept: deque = deque()

    def take(self, pose: bool = True) -> str:
        now = self.clock()
        for q in (self.seen, self.kept):
            while q and now - q[0] >= 1.0:
                q.popleft()
        self.seen.append(now)
        if len(self.seen) > self.close:
            return "close"
        if not pose:
            return "other"
        if len(self.kept) >= self.keep:
            return "drop"
        self.kept.append(now)
        return "keep"


class Member:
    def __init__(self, slot: int, nick: str, sock: W.ServerSocket, gate: PoseGate):
        self.slot, self.nick, self.sock, self.gate = slot, nick, sock, gate
        self.pose: bytes | None = None
        self.joined = time.monotonic()
        self.kept = self.dropped = self.sent = self.skipped = 0
        self.max_buffered = 0


class Room:
    def __init__(self, rid: str, req: dict, host_hash: bytes, now: float):
        self.id, self.req, self.host_hash = rid, req, host_hash
        self.members: dict[int, Member] = {}
        self.host_slot: int | None = None
        self.created = time.time()
        self.empty_since: float | None = now

    def public(self, cap: int) -> dict:
        out = {"id": self.id, "name": self.req["name"], "scene": self.req["scene"], "cap": cap,
               "members": len(self.members), "listed": self.req["listed"], "kind": "temp", "state": "open",
               "createdAt": int(self.created)}
        for k in ("shared", "course"):
            if k in self.req:
                out[k] = self.req[k]
        return out

    def roster(self) -> list[dict]:
        return [{"slot": m.slot, "nick": m.nick} for m in sorted(self.members.values(), key=lambda m: m.slot)]


class Service:
    def __init__(self, tick_hz: float = TICK_HZ, cap: int = CAP, skip_above: int | None = SKIP_ABOVE,
                 drop_above: int | None = DROP_ABOVE, pose_keep: float = POSE_KEEP_PER_S,
                 pose_close: float = POSE_CLOSE_PER_S, empty_close_s: float = EMPTY_CLOSE_S, clock=time.monotonic):
        self.tick_hz, self.cap, self.skip_above, self.drop_above = tick_hz, cap, skip_above, drop_above
        self.pose_keep, self.pose_close, self.empty_close_s, self.clock = pose_keep, pose_close, empty_close_s, clock
        self.rooms: dict[str, Room] = {}
        self.creates = Window(CREATES_PER_HOUR, 3600, clock)
        self.creates_day = Window(CREATES_PER_DAY_EACH, 86400, clock)
        self.joins = Window(JOINS_PER_MIN, 60, clock)
        self.t0 = time.monotonic()
        self.ticks = 0
        # a test switch only (--no-relay, the two-page probe's control tools/bench/src/rooms-two-page.ts): poses are
        # accepted and counted but never stored, so no snapshot carries them
        self.relay = True
        self.server: asyncio.base_events.Server | None = None
        self._tasks: list[asyncio.Task] = []

    # ---------------------------------------------------------------- lifecycle
    async def start(self, host: str = "0.0.0.0", port: int = PORT) -> int:
        self.server = await asyncio.start_server(self._conn, host, port, limit=MAX_HEAD * 2)
        self._tasks = [asyncio.ensure_future(self._tick_loop()), asyncio.ensure_future(self._sweep_loop())]
        return self.server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for room in list(self.rooms.values()):
            for m in list(room.members.values()):
                m.sock.close(W.GOING_AWAY)
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    def server_ms(self) -> int:
        return int((time.monotonic() - self.t0) * 1000) & 0xFFFFFFFF

    def pilots(self) -> int:
        return sum(len(r.members) for r in self.rooms.values())

    async def _tick_loop(self) -> None:
        period = 1.0 / self.tick_hz
        nxt = time.monotonic()
        while True:
            nxt += period
            await asyncio.sleep(max(0.0, nxt - time.monotonic()))
            if time.monotonic() - nxt > 1.0:  # a long stall: do not burst to catch up
                nxt = time.monotonic()
            self.tick()

    def tick(self) -> None:
        """One snapshot per room, built once and written to every member that keeps up."""
        self.ticks += 1
        ms = self.server_ms()
        for room in list(self.rooms.values()):
            poses = [(m.slot, m.pose) for m in sorted(room.members.values(), key=lambda m: m.slot) if m.pose]
            if not poses:
                continue
            data = P.encode_snapshot(ms, poses)
            for m in list(room.members.values()):
                b = m.sock.buffered()
                m.max_buffered = max(m.max_buffered, b)
                if self.drop_above is not None and b > self.drop_above:
                    m.sock.close(W.POLICY, "slow")
                    continue
                if self.skip_above is not None and b > self.skip_above:
                    m.skipped += 1
                    continue
                m.sock.send_binary(data)
                m.sent += 1

    async def _sweep_loop(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_S)
            self.sweep()

    def sweep(self) -> int:
        now = self.clock()
        gone = [rid for rid, r in self.rooms.items()
                if not r.members and r.empty_since is not None and now - r.empty_since >= self.empty_close_s]
        for rid in gone:
            del self.rooms[rid]
        for w in (self.creates, self.creates_day, self.joins):
            w.prune()
        if gone:
            log(f"closed {len(gone)} empty rooms; open {len(self.rooms)}")
        return len(gone)

    # ---------------------------------------------------------------- HTTP
    async def _conn(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await self._handle(reader, writer)
        except Exception as e:  # review RV-9: one line, never a traceback (release-rooms.sh reads one as a failed release)
            log(f"request failed: {type(e).__name__}")
            writer.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), REQUEST_TIMEOUT_S)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError, OSError):
            writer.close()
            return
        try:
            if len(head) > MAX_HEAD:
                return self._reply(writer, 431, {"error": "headers"})
            lines = head.decode("latin-1").split("\r\n")
            parts = lines[0].split(" ")
            if len(parts) != 3:
                return self._reply(writer, 400, {"error": "request"})
            method, target, _ = parts
            path = target.split("?", 1)[0]
            if not PATH_RE.fullmatch(path):
                return self._reply(writer, 404, {"error": "route"})
            headers: dict[str, str] = {}
            for ln in lines[1:]:
                if ":" in ln:
                    k, v = ln.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            peer = writer.get_extra_info("peername")
            client = (headers.get("x-forwarded-for") or (peer[0] if peer else "?")).split(",")[0].strip()
            if path == "/api/rooms/ws":
                await self._websocket(reader, writer, method, headers, client)
                return
            log(f"{method} {'/api/rooms/<id>' if path.startswith('/api/rooms/') and path != '/api/rooms/health' else path}")
            if method == "GET" and path == "/api/rooms/health":
                return self._reply(writer, 200, {"ok": True, "v": P.VERSION, "rooms": len(self.rooms), "pilots": self.pilots()})
            if path == "/api/rooms" and method == "GET":
                listed = [r.public(self.cap) for r in self.rooms.values() if r.req["listed"]]
                listed.sort(key=lambda r: -r["createdAt"])
                return self._reply(writer, 200, {"v": 1, "rooms": listed})
            if path == "/api/rooms" and method == "POST":
                return await self._create(reader, writer, headers, client)
            if path.startswith("/api/rooms/") and method == "GET":
                rid = path[len("/api/rooms/"):]
                room = self.rooms.get(rid) if P.ROOM_ID_RE.fullmatch(rid) else None
                if room is None:
                    return self._reply(writer, 404, {"error": "no-room"})
                return self._reply(writer, 200, room.public(self.cap))
            return self._reply(writer, 404 if method in ("GET", "POST") else 405, {"error": "route"})
        except (ConnectionError, OSError):
            writer.close()

    def _reply(self, writer: asyncio.StreamWriter, code: int, obj: dict) -> None:
        b = json.dumps(obj, separators=(",", ":")).encode()
        reason = {200: "OK", 201: "Created", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed",
                  411: "Length Required", 413: "Payload Too Large", 429: "Too Many Requests",
                  431: "Request Header Fields Too Large", 503: "Service Unavailable"}.get(code, "Error")
        writer.write((f"HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n"
                      f"Content-Length: {len(b)}\r\nConnection: close\r\n\r\n").encode("ascii") + b)
        writer.close()

    async def _create(self, reader, writer, headers: dict, client: str) -> None:
        try:
            n = int(headers.get("content-length", ""))
        except ValueError:
            return self._reply(writer, 411, {"error": "length"})
        if not 0 < n <= MAX_BODY:
            return self._reply(writer, 413, {"error": "size"})
        try:
            body = json.loads(await asyncio.wait_for(reader.readexactly(n), REQUEST_TIMEOUT_S))
        except (ValueError, RecursionError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            return self._reply(writer, 400, {"error": "body"})
        req = P.room_request(body)
        if req is None:
            return self._reply(writer, 400, {"error": "scene"})
        if len(self.rooms) >= MAX_ROOMS:
            return self._reply(writer, 503, {"error": "busy"})
        if not self.creates.allow(client) or not self.creates_day.allow(client):
            return self._reply(writer, 429, {"error": "rate"})
        rid = secrets.token_urlsafe(8)
        while rid in self.rooms:
            rid = secrets.token_urlsafe(8)
        key = secrets.token_hex(16)  # 128 bits; only its sha256 is kept
        self.rooms[rid] = Room(rid, req, hashlib.sha256(key.encode()).digest(), self.clock())
        log(f"created a room; open {len(self.rooms)}")
        return self._reply(writer, 201, {"id": rid, "hostKey": key})

    # ---------------------------------------------------------------- WebSocket
    async def _websocket(self, reader, writer, method: str, headers: dict, client: str) -> None:
        reply = W.handshake_reply(method, headers)
        if reply is None:
            return self._reply(writer, 400, {"error": "upgrade"})
        if not self.joins.allow(client):
            return self._reply(writer, 429, {"error": "rate"})
        writer.write(reply)
        sock = W.ServerSocket(reader, writer)
        try:
            msg = await asyncio.wait_for(sock.recv(), HELLO_TIMEOUT_S)
        except asyncio.TimeoutError:
            msg = None
        hello = self._json(msg)
        if hello is None or hello.get("type") != "hello":
            return self._fail(sock, "hello")
        if hello.get("v") != P.VERSION:
            return self._fail(sock, "version")
        rid = hello.get("room")
        room = self.rooms.get(rid) if isinstance(rid, str) else None
        if room is None:
            return self._fail(sock, "no-room")
        if len(room.members) >= self.cap:
            return self._fail(sock, "full")
        slot = min(s for s in range(self.cap) if s not in room.members)
        nick = P.clean_nick(hello.get("nick")) or f"Pilot-{secrets.randbelow(10000):04d}"
        taken = {m.nick for m in room.members.values()}
        base, n = nick, slot + 1
        while nick in taken:  # review RV-8: 'Bob-3' asked by another pilot must not make two of it
            nick = f"{base[:P.NICK_LEN[1] - 3]}-{n}"
            n += 1
        me = Member(slot, nick, sock, PoseGate(self.pose_keep, self.pose_close, self.clock))
        key = hello.get("hostKey")
        if isinstance(key, str) and hmac.compare_digest(hashlib.sha256(key.encode()).digest(), room.host_hash):
            room.host_slot = slot
        room.members[slot] = me
        room.empty_since = None
        if room.host_slot not in room.members:
            room.host_slot = min(room.members, key=lambda s: room.members[s].joined)
        sock.send_text(json.dumps({"type": "welcome", "v": P.VERSION, "slot": slot, "nick": nick, "hostSlot": room.host_slot,
                                   "room": room.public(self.cap), "members": room.roster(), "serverMs": self.server_ms()}))
        self._broadcast(room, {"type": "joined", "slot": slot, "nick": nick, "hostSlot": room.host_slot}, but=slot)
        log(f"ws join; pilots {self.pilots()}")
        try:
            await self._serve(room, me)
        finally:
            room.members.pop(slot, None)
            if room.host_slot == slot:
                room.host_slot = min(room.members, key=lambda s: room.members[s].joined) if room.members else None
            if not room.members:
                room.empty_since = self.clock()
            self._broadcast(room, {"type": "left", "slot": slot, "hostSlot": room.host_slot})
            sock.close()
            log(f"ws leave; pilots {self.pilots()}")

    async def _serve(self, room: Room, me: Member) -> None:
        sock = me.sock
        while not sock.closed:
            try:
                msg = await asyncio.wait_for(sock.recv(), IDLE_TIMEOUT_S)
            except asyncio.TimeoutError:
                sock.close(W.NORMAL, "idle")
                return
            if msg is None:
                return
            op, data = msg
            pose = op == W.OP_BINARY and P.is_pose(data)
            verdict = me.gate.take(pose)
            if verdict == "close":
                sock.close(W.POLICY, "rate")
                return
            if op == W.OP_BINARY:
                if not pose:  # review RV-2: junk is counted, never answered
                    continue
                if verdict == "drop":
                    me.dropped += 1
                    continue
                me.kept += 1
                if self.relay:
                    me.pose = data
                continue
            if len(data) > MAX_TEXT:
                sock.close(W.TOO_BIG, "text")
                return
            m = self._json(msg)
            kind = m.get("type") if m else None
            if kind == "ping":
                t = m.get("t")
                self._send(sock, {"type": "pong", "t": t if isinstance(t, (int, float)) and not isinstance(t, bool) else None,
                                  "s": self.server_ms()})
            elif kind == "leave":
                sock.close(W.NORMAL, "leave")
                return
            # review RV-2: an unknown message is counted by the gate and not answered

    @staticmethod
    def _json(msg) -> dict | None:
        if not msg or msg[0] != W.OP_TEXT or len(msg[1]) > MAX_TEXT:
            return None
        try:
            v = json.loads(msg[1].decode("utf-8"))
        except (ValueError, RecursionError):
            return None
        return v if isinstance(v, dict) else None

    def _send(self, sock: W.ServerSocket, obj: dict) -> None:
        """A control message; a socket that stopped reading is closed here too (review RV-2: in a room where nobody sent
        a pose, tick() never looks at its buffer)."""
        if sock.closed:
            return
        if self.drop_above is not None and sock.buffered() > self.drop_above:
            sock.close(W.POLICY, "slow")
            return
        sock.send_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))

    def _fail(self, sock: W.ServerSocket, code: str) -> None:
        self._send(sock, {"type": "error", "code": code})
        sock.close(W.POLICY, code)

    def _broadcast(self, room: Room, obj: dict, but: int | None = None) -> None:
        for m in list(room.members.values()):
            if m.slot != but:
                self._send(m.sock, obj)


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", PORT))
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    if "--host" in sys.argv:
        host = sys.argv[sys.argv.index("--host") + 1]

    async def run() -> None:
        svc = Service()
        svc.relay = "--no-relay" not in sys.argv
        got = await svc.start(host, port)
        log(f"gsfpv-rooms {P.VERSION} on port {got}")
        await asyncio.Event().wait()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
