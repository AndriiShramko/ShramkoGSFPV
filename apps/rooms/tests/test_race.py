"""Lane rooms2, stage Q2 (rooms-plan.md 2.4, 4D): a race on time in a room. The rules of race.py, then two pilots
through the service: propose, ready, countdown, laps, the table in the same order for both."""
from __future__ import annotations

import time
import unittest

from helpers import Client, R, ServiceThread, create_room

RC = R.RC
COURSE = "g1.12345"


def race(racers=(0, 1), laps=2, now=0) -> "RC.Race":
    r = RC.Race(COURSE, laps, racers[0], set(racers), now)
    for s in racers:
        r.mark_ready(s, now)
    return r


class Steps(unittest.TestCase):
    def test_countdown_waits_for_every_racer(self):
        r = RC.Race(COURSE, 1, 0, {0, 1}, 0)
        self.assertFalse(r.mark_ready(0, 100))
        self.assertEqual(r.state, "prep")
        self.assertTrue(r.mark_ready(1, 200))
        self.assertEqual((r.state, r.start_at), ("count", 200 + RC.COUNT_MS))

    def test_a_slow_page_does_not_hold_the_race(self):
        r = RC.Race(COURSE, 1, 0, {0, 1}, 0)
        r.mark_ready(0, 10)
        self.assertIsNone(r.due(RC.PREP_MS - 1))
        self.assertEqual(r.due(RC.PREP_MS), "count")

    def test_a_racer_who_leaves_in_prep_starts_the_count(self):
        r = RC.Race(COURSE, 1, 0, {0, 1}, 0)
        r.mark_ready(0, 10)
        self.assertTrue(r.drop(1, 20))

    def test_every_racer_leaves_in_prep_the_race_ends(self):
        # review RM-2: a race nobody is left in must not hold the room's races for ever
        r = RC.Race(COURSE, 1, 0, {0, 1}, 0)
        r.drop(0, 10)
        self.assertFalse(r.drop(1, 20))
        self.assertEqual(r.due(2000), "results")
        self.assertEqual(r.state, "results")

    def test_no_page_built_the_course_the_race_ends_at_the_wait(self):
        # review RM-3: no countdown to a course nobody has
        r = RC.Race(COURSE, 1, 0, {0, 1}, 0)
        self.assertIsNone(r.due(RC.PREP_MS - 1))
        self.assertEqual(r.due(RC.PREP_MS), "results")
        self.assertIsNone(r.start_at)

    def test_a_lap_shorter_than_the_minimum_is_refused(self):
        # review RM-8: a 1 ms lap must not finish the race
        r = race(laps=1)
        t = r.start_at + 60_000
        self.assertFalse(r.lap(0, 1, 1, t))
        self.assertFalse(r.lap(0, 1, RC.MIN_LAP_MS - 1, t))
        self.assertTrue(r.lap(0, 1, RC.MIN_LAP_MS, t))

    def test_the_countdown_ends_across_the_32_bit_wrap(self):
        # review RM-12: race.py keeps the unmasked ms; only the startAt sent is masked
        now = (1 << 32) - 2000
        r = race(now=now)
        self.assertEqual(r.message()["startAt"], (now + RC.COUNT_MS) & 0xFFFFFFFF)
        self.assertIsNone(r.due(now + RC.COUNT_MS - 1))
        r.due(now + RC.COUNT_MS)
        self.assertEqual(r.state, "run")

    def test_lap_before_the_start_is_refused(self):
        r = race()
        start = r.start_at
        self.assertFalse(r.lap(0, 1, 5000, start - 1))
        self.assertFalse(r.lap(0, 1, 5000, start + 1000))  # longer than the time since the start
        self.assertTrue(r.lap(0, 1, 5000, start + 5000))

    def test_lap_out_of_order_or_not_a_racer_is_refused(self):
        r = race()
        t = r.start_at + 100_000
        self.assertFalse(r.lap(0, 2, 5000, t))
        self.assertFalse(r.lap(7, 1, 5000, t))
        self.assertFalse(r.lap(0, 1, True, t))
        self.assertTrue(r.lap(0, 1, 5000, t))
        self.assertTrue(r.lap(0, 2, 6000, t))
        self.assertFalse(r.lap(0, 3, 6000, t))  # finished: two laps of two

    def test_order_and_gaps(self):
        r = race(racers=(0, 1, 2))
        t = r.start_at + 100_000
        r.lap(1, 1, 9000, t)
        r.lap(0, 1, 7000, t)
        r.lap(0, 2, 8000, t)   # 0 finished in 15000
        r.lap(1, 2, 7000, t)   # 1 finished in 16000
        r.lap(2, 1, 4000, t)   # 2 one lap only
        tab = r.table()
        self.assertEqual([x["slot"] for x in tab], [0, 1, 2])
        self.assertEqual([x["place"] for x in tab], [1, 2, 3])
        self.assertEqual([x["gapMs"] for x in tab], [None, 1000, None])
        self.assertEqual([x["bestMs"] for x in tab], [7000, 7000, 4000])

    def test_results_at_first_finisher_plus_60_s_or_all_done(self):
        r = race(laps=1)
        t = r.start_at + 10_000
        r.lap(0, 1, 9000, t)
        self.assertIsNone(r.due(t + RC.AFTER_FIRST_MS - 1))
        self.assertEqual(r.due(t + RC.AFTER_FIRST_MS), "results")
        r2 = race(laps=1)
        t = r2.start_at + 10_000
        r2.lap(0, 1, 9000, t)
        r2.lap(1, 1, 9500, t)
        self.assertEqual(r2.due(t), "results")


class Service(unittest.TestCase):
    def setUp(self):
        self.srv = ServiceThread()
        self.clients: list[Client] = []

    def tearDown(self):
        for c in self.clients:
            c.close()
        self.srv.stop()

    def join(self, room: str, nick: str) -> Client:
        c = Client(self.srv.port)
        self.clients.append(c)
        w = c.hello(room, nick)
        self.assertEqual(w["type"], "welcome")
        return c

    @staticmethod
    def until(c: Client, state: str, limit: int = 300) -> dict:
        for _ in range(limit):
            m = c.next_json()
            if m.get("type") == "race" and m.get("state") == state:
                return m
            if m.get("type") == "closed":
                raise AssertionError(f"closed while waiting for race {state}")
        raise AssertionError(f"no race {state}")

    def test_two_pilots_race_and_see_one_table(self):
        room = create_room(self.srv.port)["id"]
        a, b = self.join(room, "Ala"), self.join(room, "Bob")
        a.send_json({"type": "race", "course": COURSE, "laps": 1})
        pa, pb = self.until(a, "prep"), self.until(b, "prep")
        self.assertEqual((pa["course"], pb["racers"]), (COURSE, [0, 1]))
        a.send_json({"type": "ready"})
        b.send_json({"type": "ready"})
        ca, cb = self.until(a, "count"), self.until(b, "count")
        self.assertEqual(ca["startAt"], cb["startAt"])
        a.send_json({"type": "lap", "n": 1, "ms": 100})  # before the start: refused, said to him only
        self.assertEqual(self.until(a, "refused")["n"], 1)
        # the service's clock: wait until the start is behind (COUNT_MS) plus the laps' length
        self.srv.svc.rooms[room].race.start_at -= RC.COUNT_MS + 10_000
        b.send_json({"type": "lap", "n": 1, "ms": 8000})
        a.send_json({"type": "lap", "n": 1, "ms": 9000})
        ra, rb = self.until(a, "results"), self.until(b, "results")
        self.assertEqual([x["nick"] for x in ra["table"]], ["Bob", "Ala"])
        self.assertEqual(ra["table"], rb["table"])
        self.assertEqual(ra["table"][1]["gapMs"], 1000)
        a.send_json({"type": "table"})
        self.assertEqual(self.until(a, "results")["table"], ra["table"])

    def test_a_second_proposal_answers_the_race_on(self):
        room = create_room(self.srv.port)["id"]
        a, b = self.join(room, "Ala"), self.join(room, "Bob")
        a.send_json({"type": "race", "course": COURSE, "laps": 1})
        self.until(b, "prep")
        b.send_json({"type": "race", "course": "g1.999", "laps": 2})
        m = self.until(b, "prep")
        self.assertEqual((m["course"], m["by"]), (COURSE, 0))

    def test_bad_course_is_not_a_race(self):
        room = create_room(self.srv.port)["id"]
        a = self.join(room, "Ala")
        a.send_json({"type": "race", "course": "../x y", "laps": 1})
        a.send_json({"type": "race", "course": COURSE, "laps": 0})
        time.sleep(0.3)
        self.assertIsNone(self.srv.svc.rooms[room].race)


if __name__ == "__main__":
    unittest.main()
