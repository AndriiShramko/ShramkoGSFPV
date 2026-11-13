"""Rooms over HTTP and the WebSocket: create, list, join, the relay of poses, cap, leave, host, closing (apps/rooms/rooms.py)."""
from __future__ import annotations

import time
import unittest

from helpers import SCENE, Client, P, R, ServiceThread, W, create_room, http, pose


def snapshots_until(c: Client, want, seconds: float = 3.0) -> dict | None:
    """Reads c's frames until a snapshot satisfies `want`, or None after `seconds`."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        op, data = c.recv()
        if op == W.OP_BINARY:
            s = P.decode_snapshot(data)
            if want(s):
                return s
    return None


class Http(unittest.TestCase):
    def setUp(self):
        self.t = ServiceThread()

    def tearDown(self):
        self.t.stop()

    def test_create_get_list_and_health(self):
        code, h = http(self.t.port, "GET", "/api/rooms/health")
        self.assertEqual((code, h["ok"], h["rooms"], h["v"]), (200, True, 0, "rooms/1"))
        a = create_room(self.t.port, name="Open one", listed=True, shared={"size": 2})
        b = create_room(self.t.port, name="Hidden")
        self.assertRegex(a["id"], r"^[A-Za-z0-9_-]{11}$")
        self.assertRegex(a["hostKey"], r"^[0-9a-f]{32}$")
        code, room = http(self.t.port, "GET", f"/api/rooms/{a['id']}")
        self.assertEqual((code, room["scene"], room["shared"], room["cap"], room["members"]), (200, {"id": SCENE}, {"size": 2.0}, 8, 0))
        self.assertNotIn("hostKey", room)
        code, lst = http(self.t.port, "GET", "/api/rooms")
        self.assertEqual([r["id"] for r in lst["rooms"]], [a["id"]])  # the unlisted one is reachable by link only
        self.assertEqual(http(self.t.port, "GET", f"/api/rooms/{b['id']}")[0], 200)
        self.assertEqual(http(self.t.port, "GET", "/api/rooms/AAAAAAAAAAA")[0], 404)
        self.assertEqual(http(self.t.port, "GET", "/api/rooms/../etc")[0], 404)

    def test_bad_bodies(self):
        self.assertEqual(http(self.t.port, "POST", "/api/rooms", {"scene": {"id": "nothex!"}})[0], 400)
        self.assertEqual(http(self.t.port, "POST", "/api/rooms", b"{not json")[0], 400)
        self.assertEqual(http(self.t.port, "POST", "/api/rooms", {"scene": {"id": SCENE}, "pad": "x" * 5000})[0], 413)
        self.assertEqual(http(self.t.port, "DELETE", "/api/rooms")[0], 405)

    def test_ten_creates_an_hour_per_address(self):
        for _ in range(R.CREATES_PER_HOUR):
            create_room(self.t.port, client="10.1.1.1")
        code, _ = http(self.t.port, "POST", "/api/rooms", {"scene": {"id": SCENE}}, {"X-Forwarded-For": "10.1.1.1"})
        self.assertEqual(code, 429)
        create_room(self.t.port, client="10.1.1.2")  # another address still can

    def test_an_empty_room_closes_ten_minutes_after_the_last_pilot(self):
        now = [1000.0]
        self.t.svc.clock = lambda: now[0]
        rid = create_room(self.t.port)["id"]
        self.t.svc.rooms[rid].empty_since = now[0]
        c = Client(self.t.port)
        c.hello(rid)
        now[0] += R.EMPTY_CLOSE_S + 5
        self.assertEqual(self.t.svc.sweep(), 0)  # a pilot is in: never closed
        c.send_json({"type": "leave"})
        c.next_json()
        c.close()
        time.sleep(0.2)
        now[0] += R.EMPTY_CLOSE_S - 1
        self.assertEqual(self.t.svc.sweep(), 0)
        now[0] += 2
        self.assertEqual(self.t.svc.sweep(), 1)
        self.assertEqual(http(self.t.port, "GET", f"/api/rooms/{rid}")[0], 404)


class Relay(unittest.TestCase):
    def setUp(self):
        self.t = ServiceThread()
        self.clients: list[Client] = []

    def tearDown(self):
        for c in self.clients:
            c.close()
        self.t.stop()

    def join(self, rid: str, nick: str, key: str | None = None) -> tuple[Client, dict]:
        c = Client(self.t.port, client=f"10.2.0.{len(self.clients) + 1}")
        self.clients.append(c)
        return c, c.hello(rid, nick, key)

    def test_a_pose_reaches_the_room_and_never_another_room(self):
        room = create_room(self.t.port)
        other = create_room(self.t.port)
        a, wa = self.join(room["id"], "Ala", room["hostKey"])
        b, wb = self.join(room["id"], "Bob")
        c, wc = self.join(room["id"], "Cyd")
        d, wd = self.join(other["id"], "Dan")
        self.assertEqual((wa["type"], wa["slot"], wb["slot"], wc["slot"], wd["slot"]), ("welcome", 0, 1, 2, 0))
        self.assertEqual(wc["members"], [{"slot": 0, "nick": "Ala"}, {"slot": 1, "nick": "Bob"}, {"slot": 2, "nick": "Cyd"}])
        self.assertEqual(wa["hostSlot"], 0)
        self.assertEqual(a.next_json(), {"type": "joined", "slot": 1, "nick": "Bob", "hostSlot": 0})
        mine = pose(seq=42, x=7.5)
        a.send(W.OP_BINARY, mine)
        d.send(W.OP_BINARY, pose(seq=9, x=-1.0))
        for who in (b, c):
            s = snapshots_until(who, lambda s: any(m["slot"] == 0 for m in s["members"]))
            self.assertIsNotNone(s)
            got = next(m for m in s["members"] if m["slot"] == 0)["pose"]
            self.assertEqual((got["seq"], got["pos"][0]), (42, 7.5))
        # control: the client of the other room hears only its own room (slot 0 there is Dan, seq 9)
        seen = []
        snapshots_until(d, lambda s: seen.append(s) and False, seconds=1.0)
        self.assertTrue(seen)
        for s in seen:
            self.assertEqual([(m["slot"], m["pose"]["seq"]) for m in s["members"]], [(0, 9)])

    def test_snapshots_come_at_15_hz(self):
        room = create_room(self.t.port)
        a, _ = self.join(room["id"], "Ala")
        a.send(W.OP_BINARY, pose())
        times = []
        snapshots_until(a, lambda s: times.append(time.monotonic()) and False, seconds=2.0)
        rate = (len(times) - 1) / (times[-1] - times[0])
        self.assertTrue(13.5 <= rate <= 16.5, rate)

    def test_cap_of_8_leave_and_host_handover(self):
        room = create_room(self.t.port)
        first, w = self.join(room["id"], "Pilot A")
        for i in range(1, R.CAP):
            self.join(room["id"], f"Pilot {chr(65 + i)}")
        ninth = Client(self.t.port, client="10.3.0.1")
        self.clients.append(ninth)
        self.assertEqual(ninth.hello(room["id"], "Late"), {"type": "error", "code": "full"})
        self.assertEqual(http(self.t.port, "GET", f"/api/rooms/{room['id']}")[1]["members"], 8)
        # the host (the first in: nobody brought the key) leaves; the oldest member takes the role
        first.send_json({"type": "leave"})
        second = self.clients[1]
        while True:
            m = second.next_json()
            if m["type"] == "left":
                break
        self.assertEqual(m, {"type": "left", "slot": 0, "hostSlot": 1})

    def test_the_host_key_makes_the_host_and_names_are_cleaned(self):
        room = create_room(self.t.port)
        _, wb = self.join(room["id"], "http://spam")
        self.assertRegex(wb["nick"], r"^Pilot-\d{4}$")
        self.assertEqual(wb["hostSlot"], 0)
        _, wa = self.join(room["id"], "Ala", room["hostKey"])
        self.assertEqual(wa["hostSlot"], 1)
        _, wc = self.join(room["id"], "Ala")
        self.assertEqual(wc["nick"], "Ala-3")
        _, wd = self.join(room["id"], "Dan", "0" * 32)  # a wrong key is just a pilot
        self.assertEqual(wd["hostSlot"], 1)

    def test_wrong_hellos(self):
        room = create_room(self.t.port)
        for msg, code in (({"type": "hello", "v": "rooms/2", "room": room["id"]}, "version"),
                          ({"type": "hello", "v": "rooms/1", "room": "AAAAAAAAAAA"}, "no-room"),
                          ({"type": "nope"}, "hello")):
            c = Client(self.t.port)
            self.clients.append(c)
            c.send_json(msg)
            self.assertEqual(c.next_json(), {"type": "error", "code": code})
            self.assertEqual(c.next_json(), {"type": "closed", "code": W.POLICY})

    def test_ping_answers_with_the_server_clock(self):
        room = create_room(self.t.port)
        a, w = self.join(room["id"], "Ala")
        a.send_json({"type": "ping", "t": 123.5})
        m = a.next_json()
        self.assertEqual((m["type"], m["t"]), ("pong", 123.5))
        self.assertGreaterEqual(m["s"], w["serverMs"])


if __name__ == "__main__":
    unittest.main()
