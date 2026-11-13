"""Findings of the lane's independent review (docs/wip/rooms.md, "R review fixes"): RV-2 floods, RV-3 the service's
target rule, RV-4 room names in every language, RV-5 the create budget, RV-7 forgotten addresses, RV-8 names, RV-9 deep
JSON. Each test fails on the code before the fixes (neg_control.py, the Status line gives the run)."""
from __future__ import annotations

import json
import socket
import time
import unittest

from helpers import ROOT, Client, P, R, ServiceThread, W, create_room, http, pose

LOCALES = ROOT.parents[1] / "packages" / "i18n" / "locales" / "fly" / "rooms"


def frames(op: int, data: bytes, n: int) -> bytes:
    return W.encode_frame(op, data, mask=True) * n


def read_until_closed(c: Client, limit: int = 100000) -> tuple[list[dict], int | None]:
    """Messages until the close frame (its code), or None when the socket stays open (read timeout)."""
    got: list[dict] = []
    try:
        for _ in range(limit):
            m = c.next_json()
            if m.get("type") == "closed":
                return got, m.get("code")
            got.append(m)
    except (socket.timeout, OSError):
        pass
    return got, None


class Floods(unittest.TestCase):
    """RV-2: every message counts toward the close limit, junk is not answered, a socket that stops reading is closed by
    the control messages it is owed too, not only by snapshots."""

    def test_a_ping_flood_closes_with_1008(self):
        t = ServiceThread()
        try:
            room = create_room(t.port)
            c = Client(t.port, timeout=3)
            c.hello(room["id"])
            c.sock.sendall(frames(W.OP_TEXT, json.dumps({"type": "ping", "t": 1}).encode(), 200))
            got, code = read_until_closed(c)
            c.close()
            self.assertEqual(code, W.POLICY)
            self.assertLessEqual(len(got), R.POSE_CLOSE_PER_S)
        finally:
            t.stop()

    def test_junk_is_not_answered_and_a_junk_flood_closes(self):
        t = ServiceThread()
        try:
            room = create_room(t.port)
            c = Client(t.port, timeout=3)
            c.hello(room["id"])
            c.sock.sendall(frames(W.OP_BINARY, b"\x07junk", 200))
            got, code = read_until_closed(c)
            c.close()
            self.assertEqual([m for m in got if m.get("type") == "error"], [])
            self.assertEqual(code, W.POLICY)
        finally:
            t.stop()

    def test_a_member_that_never_reads_in_a_room_without_poses_is_closed_near_the_cap(self):
        # the rate limit off, so the buffer cap alone must hold
        t = ServiceThread(pose_close=1e9)
        peak = [0]
        orig = W.ServerSocket.send_text

        def watched(sock, text):
            peak[0] = max(peak[0], sock.buffered())
            return orig(sock, text)

        W.ServerSocket.send_text = watched
        try:
            room = create_room(t.port)
            c = Client(t.port, rcvbuf=4096, timeout=2)
            c.hello(room["id"])
            batch = frames(W.OP_TEXT, json.dumps({"type": "ping", "t": 1}).encode(), 1000)
            try:
                for _ in range(150):
                    c.sock.sendall(batch)
            except OSError:
                pass
            time.sleep(0.5)
            members = len(t.svc.rooms[room["id"]].members)
            c.close()
            self.assertEqual(members, 0, f"still a member, peak unsent {peak[0]} B")
            self.assertLess(peak[0], R.DROP_ABOVE + 200)
        finally:
            W.ServerSocket.send_text = orig
            t.stop()


class Targets(unittest.TestCase):
    def test_a_target_outside_the_routes_is_refused_before_routing(self):
        t = ServiceThread()
        try:
            for bad in ("/api/rooms/a%0d%0ab", "/api/rooms/" + "x" * 17, "/api/rooms/a/b"):
                code, got = http(t.port, "GET", bad)
                self.assertEqual((code, got.get("error")), (404, "route"), bad)
            self.assertEqual(http(t.port, "GET", "/api/rooms/health")[0], 200)  # control: a route still answers
        finally:
            t.stop()


class Names(unittest.TestCase):
    def test_every_languages_default_room_name_is_kept_as_is(self):
        files = sorted(LOCALES.glob("*.json"))
        self.assertEqual([f.stem for f in files], ["en", "es", "pl", "ru"])
        for f in files:
            ph = json.loads(f.read_text(encoding="utf-8"))["rooms.create.namePlaceholder"]
            for nick in ("Pilot-1234", "Ala", "x" * P.NICK_LEN[1]):
                name = ph.replace("{nick}", nick)
                self.assertEqual(P.clean_name(name), name, f"{f.stem}: {name!r}")

    def test_a_room_never_has_an_empty_name(self):
        for asked in (None, "", "a:b", "Official GSFPV admin", "Shramko moderator room"):
            got = P.room_request({"scene": {"id": "39e63ce9"}, "name": asked})["name"]
            self.assertRegex(got, r"^Room-\d{4}$", repr(asked))
        self.assertEqual(P.room_request({"scene": {"id": "39e63ce9"}, "name": "Evening"})["name"], "Evening")  # control

    def test_nicknames_in_one_room_stay_unique(self):
        t = ServiceThread()
        try:
            room = create_room(t.port)
            cs = [Client(t.port) for _ in range(3)]
            got = [c.hello(room["id"], nick)["nick"] for c, nick in zip(cs, ("Bob-3", "Bob", "Bob"))]
            for c in cs:
                c.close()
            self.assertEqual(len(set(got)), 3, got)
            self.assertEqual(got[:2], ["Bob-3", "Bob"])
        finally:
            t.stop()


class Budget(unittest.TestCase):
    def test_one_address_at_its_full_rate_for_a_day_leaves_creates_for_another(self):
        clock = [1000.0]
        t = ServiceThread(clock=lambda: clock[0])
        try:
            made = 0
            for _hour in range(24):
                for _ in range(R.CREATES_PER_HOUR):
                    code, _ = http(t.port, "POST", "/api/rooms", {"scene": {"id": "39e63ce9"}}, {"X-Forwarded-For": "10.0.0.66"})
                    made += code == 201
                clock[0] += 3600
                t.svc.sweep()
            self.assertLessEqual(made, R.CREATES_PER_DAY_EACH)
            create_room(t.port, client="10.0.0.2")  # asserts 201
        finally:
            t.stop()


class Forget(unittest.TestCase):
    def test_a_window_forgets_keys_whose_events_left_it(self):
        clock = [0.0]
        w = R.Window(10, 3600, lambda: clock[0])
        for i in range(1000):
            w.allow(f"10.0.{i // 256}.{i % 256}")
        self.assertEqual(w.prune(), 1000)  # control: inside the window they are kept
        clock[0] += 3601
        self.assertEqual(w.prune(), 0)
        self.assertEqual(w.q, {})

    def test_the_sweep_prunes_the_services_windows(self):
        clock = [1000.0]
        t = ServiceThread(clock=lambda: clock[0])
        try:
            for i in range(5):
                create_room(t.port, client=f"10.0.1.{i}")
            clock[0] += 86401
            t.svc.sweep()
            self.assertEqual((len(t.svc.creates.q), len(t.svc.creates_day.q)), (0, 0))
        finally:
            t.stop()


class DeepJson(unittest.TestCase):
    def test_deep_json_is_refused_not_a_traceback(self):
        t = ServiceThread()
        try:
            code, got = http(t.port, "POST", "/api/rooms", b"[" * 4000, {"X-Forwarded-For": "10.0.0.5"})
            self.assertEqual((code, got.get("error")), (400, "body"))
            room = create_room(t.port)
            c = Client(t.port)
            c.send(W.OP_TEXT, b"[" * 2000)
            self.assertEqual(c.next_json(), {"type": "error", "code": "hello"})
            c.close()
        finally:
            t.stop()


if __name__ == "__main__":
    unittest.main()
