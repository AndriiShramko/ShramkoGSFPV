"""Pose rates (rooms-plan.md 2.5): above 20 poses a second the rest are dropped, above 60 the socket is closed."""
from __future__ import annotations

import time
import unittest

from helpers import Client, R, ServiceThread, W, create_room, pose


def feed(gate: R.PoseGate, clock: list, per_s: float, seconds: float) -> dict:
    out = {"keep": 0, "drop": 0, "close": 0}
    for _ in range(int(per_s * seconds)):
        clock[0] += 1.0 / per_s
        out[gate.take()] += 1
        if out["close"]:
            break
    return out


class Gate(unittest.TestCase):
    def test_30_a_second_is_cut_to_20(self):
        clock = [0.0]
        got = feed(R.PoseGate(clock=lambda: clock[0]), clock, 30, 10)
        self.assertEqual(got["close"], 0)
        self.assertAlmostEqual(got["keep"] / 10, 20, delta=1)

    def test_60_a_second_passes_70_closes(self):
        clock = [0.0]
        self.assertEqual(feed(R.PoseGate(clock=lambda: clock[0]), clock, 59, 5)["close"], 0)
        clock = [0.0]
        self.assertEqual(feed(R.PoseGate(clock=lambda: clock[0]), clock, 70, 5)["close"], 1)

    def test_control_without_the_limits_30_and_70_both_pass(self):
        clock = [0.0]
        got = feed(R.PoseGate(keep=1e9, close=1e9, clock=lambda: clock[0]), clock, 70, 5)
        self.assertEqual((got["keep"], got["close"]), (350, 0))


class Live(unittest.TestCase):
    """The same through a real socket: the server counts the poses it kept."""

    def run_at(self, per_s: float, seconds: float, **kw) -> tuple[R.Member | None, dict]:
        t = ServiceThread(**kw)
        try:
            room = create_room(t.port)
            c = Client(t.port)
            c.hello(room["id"], "Ala")
            member = t.svc.rooms[room["id"]].members[0]
            start = time.monotonic()
            n = 0
            closed = False
            try:
                while time.monotonic() - start < seconds:
                    n += 1
                    c.send(W.OP_BINARY, pose(seq=n))
                    time.sleep(max(0.0, start + n / per_s - time.monotonic()))
            except OSError:
                closed = True
            sending = time.monotonic() - start
            time.sleep(0.3)
            if not closed:
                c.sock.settimeout(1.0)
                end = time.monotonic() + 1.0  # snapshots keep coming while the socket is open
                try:
                    while time.monotonic() < end:
                        op, data = c.recv()
                        if op == W.OP_CLOSE:
                            closed = int.from_bytes(data[:2], "big")
                            break
                except (OSError, ConnectionError):
                    pass
            c.close()
            return member, {"sent": n, "closed": closed, "elapsed": sending}
        finally:
            t.stop()

    def test_30_a_second_keeps_about_20(self):
        m, run = self.run_at(30, 3.0)
        rate = m.kept / run["elapsed"]
        self.assertFalse(run["closed"])
        self.assertLessEqual(m.kept, 20 * 4)   # never more than 20 in any second
        self.assertGreater(m.dropped, 0)
        self.assertTrue(15 <= rate <= 21, (m.kept, m.dropped, run))

    def test_control_with_the_limit_off_30_a_second_all_kept(self):
        m, run = self.run_at(30, 3.0, pose_keep=1e9)
        self.assertEqual((m.dropped, m.kept), (0, run["sent"]))

    def test_70_a_second_closes_the_socket(self):
        m, run = self.run_at(70, 2.0)
        self.assertTrue(run["closed"], run)
        self.assertEqual(m.sock.close_code, W.POLICY, run)
        self.assertLess(run["sent"], 70 * 2)


if __name__ == "__main__":
    unittest.main()
