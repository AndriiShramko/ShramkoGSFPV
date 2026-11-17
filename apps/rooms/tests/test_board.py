"""Lane race, L1 and L2: the room's course and its live board of best laps (board.py, rooms.py _course and _blap)."""
from __future__ import annotations

import time
import unittest

from helpers import Client, R, ServiceThread, create_room

BD = R.BD
C1, C2 = "g1.12345", "g1.777"


class Rules(unittest.TestCase):
    def test_a_lap_of_a_pilot_not_in_the_room_is_dropped(self):
        b = BD.Board(C1, 0, 0)
        self.assertIsNone(b.lap(5, "Gone", {0, 1}, C1, 1, 40_000, 50_000))
        self.assertEqual(b.table(), [])

    def test_a_time_out_of_range_is_refused(self):
        b = BD.Board(C1, 0, 0)
        for ms in (BD.MIN_LAP_MS - 1, BD.MAX_LAP_MS + 1, True, 40_000.5, "40000", None):
            self.assertIsNone(b.lap(0, "Ala", {0}, C1, 1, ms, BD.MAX_LAP_MS + 10_000), ms)
        self.assertIsNotNone(b.lap(0, "Ala", {0}, C1, 1, BD.MIN_LAP_MS, BD.MIN_LAP_MS))

    def test_a_lap_longer_than_the_course_has_been_there_is_refused(self):
        b = BD.Board(C1, 0, 10_000)
        self.assertIsNone(b.lap(0, "Ala", {0}, C1, 1, 40_000, 20_000))
        self.assertIsNotNone(b.lap(0, "Ala", {0}, C1, 1, 40_000, 50_000))
        # the next lap counts from this one: one lap message per MIN_LAP_MS at most
        self.assertIsNone(b.lap(0, "Ala", {0}, C1, 2, 40_000, 60_000))

    def test_laps_in_order_and_on_this_course_only(self):
        b = BD.Board(C1, 0, 0)
        self.assertIsNone(b.lap(0, "Ala", {0}, C1, 2, 40_000, 50_000))
        self.assertIsNone(b.lap(0, "Ala", {0}, C2, 1, 40_000, 50_000))
        self.assertEqual(b.lap(0, "Ala", {0}, C1, 1, 40_000, 50_000)["n"], 1)

    def test_order_by_best_lap_and_the_lead(self):
        b = BD.Board(C1, 0, 0)
        self.assertTrue(b.lap(0, "Ala", {0, 1}, C1, 1, 40_000, 100_000)["lead"])
        self.assertTrue(b.lap(1, "Bob", {0, 1}, C1, 1, 39_000, 100_000)["lead"])
        self.assertEqual([r["slot"] for r in b.table()], [1, 0])
        slower = b.lap(0, "Ala", {0, 1}, C1, 2, 45_000, 150_000)
        self.assertFalse(slower["lead"])
        self.assertEqual(slower["best"], 40_000)
        self.assertEqual(b.table()[1], {"slot": 0, "nick": "Ala", "best": 40_000, "laps": 2})

    def test_an_equal_time_keeps_the_first_pilot(self):
        b = BD.Board(C1, 0, 0)
        b.lap(0, "Ala", {0, 1}, C1, 1, 40_000, 100_000)
        self.assertFalse(b.lap(1, "Bob", {0, 1}, C1, 1, 40_000, 100_000)["lead"])
        self.assertEqual([r["slot"] for r in b.table()], [0, 1])

    def test_a_row_leaves_with_its_pilot(self):
        b = BD.Board(C1, 0, 0)
        b.lap(1, "Bob", {0, 1}, C1, 1, 40_000, 100_000)
        self.assertTrue(b.drop(1))
        self.assertEqual(b.table(), [])

    def test_a_too_long_nick_is_refused(self):
        self.assertIsNone(R.P.clean_nick("x" * (R.P.NICK_LEN[1] + 1)))
        self.assertEqual(R.P.clean_nick("x" * R.P.NICK_LEN[1]), "x" * R.P.NICK_LEN[1])


class Service(unittest.TestCase):
    def setUp(self):
        self.srv = ServiceThread()
        self.clients: list[Client] = []

    def tearDown(self):
        for c in self.clients:
            c.close()
        self.srv.stop()

    def join(self, room: str, nick: str) -> tuple[Client, dict]:
        c = Client(self.srv.port)
        self.clients.append(c)
        w = c.hello(room, nick)
        self.assertEqual(w["type"], "welcome")
        return c, w

    @staticmethod
    def until(c: Client, kind: str, limit: int = 300) -> dict:
        for _ in range(limit):
            m = c.next_json()
            if m.get("type") == kind:
                return m
            if m.get("type") == "closed":
                raise AssertionError(f"closed while waiting for {kind}")
        raise AssertionError(f"no {kind}")

    def test_the_course_is_the_rooms_and_laps_reach_everyone(self):
        room = create_room(self.srv.port)["id"]
        (a, wa), (b, _) = self.join(room, "Ala"), self.join(room, "Bob")
        self.assertIsNone(wa["board"])
        a.send_json({"type": "course", "course": C1})
        ga, gb = self.until(a, "board"), self.until(b, "board")
        self.assertEqual((ga["course"], gb["course"], gb["rows"]), (C1, C1, []))
        time.sleep((BD.MIN_LAP_MS + 200) / 1000)
        a.send_json({"type": "blap", "course": C1, "n": 1, "ms": BD.MIN_LAP_MS})
        la, lb = self.until(a, "blap"), self.until(b, "blap")
        self.assertEqual((lb["nick"], lb["ms"], lb["lead"]), ("Ala", BD.MIN_LAP_MS, True))
        self.assertEqual(la, lb)
        c, wc = self.join(room, "Cyd")  # the late joiner gets the course and the laps
        self.assertEqual(wc["board"]["course"], C1)
        self.assertEqual([r["nick"] for r in wc["board"]["rows"]], ["Ala"])
        b.send_json({"type": "course", "course": C2})  # a new course replaces it for everyone and clears the board
        for x in (a, b, c):
            m = self.until(x, "board")
            self.assertEqual((m["course"], m["rows"]), (C2, []))
        a.send_json({"type": "blap", "course": C1, "n": 2, "ms": BD.MIN_LAP_MS})
        self.assertTrue(self.until(a, "board")["refused"])


if __name__ == "__main__":
    unittest.main()
