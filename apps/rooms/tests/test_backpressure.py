"""A pilot whose browser stops reading costs the server at most SKIP_ABOVE bytes plus one snapshot
(rooms-plan.md 2.2): above that the room skips its snapshots. Control: with the cap off the same run passes the bound."""
from __future__ import annotations

import asyncio
import time
import unittest

from helpers import Client, R, ServiceThread, W, create_room, pose

TICKS = 20000          # 20000 snapshots of 80 bytes = 1.6 MB for a reader that never reads
BOUND = R.SKIP_ABOVE + 1024


async def burst(svc: R.Service, ticks: int) -> None:
    for i in range(ticks):
        svc.tick()
        if i % 50 == 0:
            await asyncio.sleep(0)  # let the loop hand bytes to the kernel


class Backpressure(unittest.TestCase):
    def run_burst(self, **kw) -> tuple[int, int, int]:
        t = ServiceThread(tick_hz=1, **kw)  # the burst drives the ticks itself
        try:
            room = create_room(t.port)
            slow = Client(t.port, rcvbuf=4096, client="10.4.0.1")
            slow.hello(room["id"], "Slow")
            fast = Client(t.port, client="10.4.0.2")
            fast.hello(room["id"], "Fast")
            for c in (slow, fast):
                c.send(W.OP_BINARY, pose())
            time.sleep(0.3)
            members = t.svc.rooms[room["id"]].members
            t.run(burst(t.svc, TICKS))
            m = members[0]
            now = m.sock.buffered()
            slow.close()
            fast.close()
            return max(m.max_buffered, now), m.skipped, m.sent
        finally:
            t.stop()

    def test_a_reader_that_stops_is_skipped_and_its_buffer_stays_bounded(self):
        peak, skipped, sent = self.run_burst()
        self.assertLessEqual(peak, BOUND, (peak, skipped, sent))
        self.assertGreater(skipped, TICKS // 2, (peak, skipped, sent))  # the bound was really pressed

    def test_control_with_the_cap_off_the_bound_fires(self):
        peak, skipped, sent = self.run_burst(skip_above=None, drop_above=None)
        self.assertEqual(skipped, 0)
        self.assertGreater(peak, 4 * BOUND, (peak, skipped, sent))

    def test_a_reader_far_behind_is_closed(self):
        peak, skipped, sent = self.run_burst(skip_above=None, drop_above=64 * 1024)
        self.assertLessEqual(peak, 64 * 1024 + 1024 + 80 * 50, (peak, skipped, sent))


if __name__ == "__main__":
    unittest.main()
