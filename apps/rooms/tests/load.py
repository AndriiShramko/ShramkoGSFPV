"""Load run of the rooms service (rooms-plan.md 2.8 / 4A): N synthetic pilots in rooms of 8, each sending a pose at
15 Hz and reading the room's snapshots, against `rooms.py` started as its own process. Samples the server's resident
memory and CPU every 5 s and writes evidence/<date>/rooms-load.json.
  python -X utf8 apps/rooms/tests/load.py [--clients 50] [--seconds 90]
Not unittest (no test_ prefix): it takes minutes. The container limits (64 MB, 0.25 CPU) are NOT applied here; the
JSON says what was measured where."""
from __future__ import annotations

import argparse
import asyncio
import ctypes
import json
import math
import os
import platform
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOMS = HERE.parent
REPO = ROOMS.parents[1]
sys.path.insert(0, str(ROOMS))
import protocol as P  # noqa: E402
import ws as W  # noqa: E402


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class ProcStats:
    """Resident memory (bytes) and CPU seconds of a child process: Win32 calls on Windows, /proc elsewhere."""

    def __init__(self, proc: subprocess.Popen):
        self.proc = proc

    def sample(self) -> tuple[int, float]:
        if os.name == "nt":
            class PMC(ctypes.Structure):
                _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong)] + [
                    (n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                                   "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                                                   "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]
            h = ctypes.c_void_p(int(self.proc._handle))  # noqa: SLF001 (the Popen handle has full access)
            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(pmc), pmc.cb)
            ft = [ctypes.c_ulonglong() for _ in range(4)]
            ctypes.windll.kernel32.GetProcessTimes(h, *[ctypes.byref(x) for x in ft])
            return pmc.WorkingSetSize, (ft[2].value + ft[3].value) / 1e7
        pid = self.proc.pid
        rss = int(next(ln for ln in Path(f"/proc/{pid}/status").read_text().splitlines() if ln.startswith("VmRSS")).split()[1]) * 1024
        f = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return rss, (int(f[11]) + int(f[12])) / os.sysconf("SC_CLK_TCK")


async def http_create(port: int, client: str) -> dict:
    r, w = await asyncio.open_connection("127.0.0.1", port)
    body = json.dumps({"scene": {"id": "39e63ce9"}, "name": "Load", "listed": True}).encode()
    w.write((f"POST /api/rooms HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nX-Forwarded-For: {client}\r\n"
             f"Content-Length: {len(body)}\r\n\r\n").encode() + body)
    raw = await r.read()
    w.close()
    return json.loads(raw.split(b"\r\n\r\n", 1)[1])


class Pilot:
    def __init__(self, i: int):
        self.i = i
        self.snapshots = 0
        self.sent = 0
        self.closed = None
        self.members_seen = 0

    async def run(self, port: int, room: str, stop_at: float) -> None:
        r, w = await asyncio.open_connection("127.0.0.1", port)
        req, key = W.client_request("x", "/api/rooms/ws", extra={"X-Forwarded-For": f"10.9.{self.i // 200}.{self.i % 200}"})
        w.write(req)
        head = await r.readuntil(b"\r\n\r\n")
        assert b" 101 " in head.split(b"\r\n")[0], head[:40]
        w.write(W.encode_frame(W.OP_TEXT, json.dumps({"type": "hello", "v": P.VERSION, "room": room,
                                                      "nick": f"Load {self.i}"}).encode(), mask=True))
        reader = asyncio.ensure_future(self.read(r))
        t0 = time.monotonic()
        n = 0
        while time.monotonic() < stop_at and not reader.done():
            n += 1
            a = n / 15.0
            pose = P.encode_pose({"flags": 1, "seq": n, "tick": n * 16, "pos": [math.cos(a) * 5 + self.i, 2, math.sin(a) * 5],
                                  "quat": [0, math.sin(a / 2), 0, math.cos(a / 2)], "vel": [1, 0, 1], "throttle": 0.5})
            w.write(W.encode_frame(W.OP_BINARY, pose, mask=True))
            self.sent += 1
            await asyncio.sleep(max(0.0, t0 + n / 15.0 - time.monotonic()))
        w.write(W.encode_frame(W.OP_CLOSE, W.close_payload(W.NORMAL), mask=True))
        await asyncio.sleep(0.2)
        reader.cancel()
        w.close()

    async def read(self, r: asyncio.StreamReader) -> None:
        try:
            while True:
                fin, op, data = await W.read_frame(r, require_mask=False)
                if op == W.OP_BINARY:
                    self.snapshots += 1
                    self.members_seen = max(self.members_seen, data[5])
                elif op == W.OP_CLOSE:
                    self.closed = struct.unpack(">H", data[:2])[0] if len(data) >= 2 else 1005
                    return
        except (asyncio.IncompleteReadError, ConnectionError):
            self.closed = self.closed or "eof"


async def main_async(args) -> dict:
    port = free_port()
    proc = subprocess.Popen([sys.executable, "-u", str(ROOMS / "rooms.py"), "--host", "127.0.0.1", "--port", str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    stats = ProcStats(proc)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), 0.2).close()
                break
            except OSError:
                await asyncio.sleep(0.1)
        rss0, cpu0 = stats.sample()
        n_rooms = math.ceil(args.clients / 8)
        rooms = [(await http_create(port, f"10.8.0.{k}"))["id"] for k in range(n_rooms)]
        pilots = [Pilot(i) for i in range(args.clients)]
        start = time.monotonic()
        stop_at = start + args.seconds
        tasks = [asyncio.ensure_future(p.run(port, rooms[p.i % n_rooms], stop_at)) for p in pilots]
        samples = []
        last_t, last_cpu = start, cpu0
        while time.monotonic() < stop_at:
            await asyncio.sleep(5)
            now = time.monotonic()
            rss, cpu = stats.sample()
            samples.append({"t": round(now - start, 1), "rssMB": round(rss / 2**20, 2),
                            "cpuPctOfOneCore": round(100 * (cpu - last_cpu) / (now - last_t), 1)})
            last_t, last_cpu = now, cpu
        await asyncio.gather(*tasks, return_exceptions=True)
        elapsed = time.monotonic() - start
        rss1, cpu1 = stats.sample()
    finally:
        proc.terminate()
        _, err = proc.communicate(timeout=10)
    snaps = [p.snapshots / args.seconds for p in pilots]  # each pilot is connected for the run's seconds
    steady = samples[1:] or samples
    return {
        "what": "apps/rooms/tests/load.py: synthetic pilots against rooms.py as a plain process on this machine",
        "date": time.strftime("%Y-%m-%d %H:%M:%S"),
        "machine": {"os": platform.platform(), "cpu": platform.processor(), "python": platform.python_version()},
        "containerLimitsReproduced": False,
        "note": ("The container limits (mem_limit 64m, cpus 0.25, pids_limit 8, python 3.12-alpine) were NOT applied: the "
                 "Docker engine was not running on this machine. Memory is the Windows working set of the process; CPU is "
                 "per cent of one core of this PC (cpus 0.25 = 25 per cent of one hub core, which may be slower or faster)."),
        "clients": args.clients, "rooms": n_rooms, "seconds": args.seconds, "wallSeconds": round(elapsed, 1), "poseHz": 15, "tickHz": 15,
        "server": {"rssStartMB": round(rss0 / 2**20, 2), "rssEndMB": round(rss1 / 2**20, 2),
                   "rssPeakMB": max(s["rssMB"] for s in samples), "cpuMeanPctOfOneCore":
                   round(sum(s["cpuPctOfOneCore"] for s in steady) / len(steady), 1),
                   "cpuPeakPctOfOneCore": max(s["cpuPctOfOneCore"] for s in samples),
                   "cpuSecondsTotal": round(cpu1 - cpu0, 2), "stderrTail": err.decode("utf-8", "replace")[-400:]},
        "pilots": {"posesSent": sum(p.sent for p in pilots), "snapshotsPerSecMean": round(sum(snaps) / len(snaps), 2),
                   "snapshotsPerSecMin": round(min(snaps), 2), "membersSeenMax": max(p.members_seen for p in pilots),
                   "closedEarly": sum(1 for p in pilots if p.closed not in (None, 1000))},
        "samples": samples,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clients", type=int, default=50)
    ap.add_argument("--seconds", type=float, default=90)
    ap.add_argument("--out", default=str(REPO / "evidence" / time.strftime("%Y-%m-%d") / "rooms-load.json"))
    args = ap.parse_args()
    out = asyncio.run(main_async(args))
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({k: out[k] for k in ("clients", "rooms", "seconds", "server", "pilots")}, indent=1)[:1500])


if __name__ == "__main__":
    main()
