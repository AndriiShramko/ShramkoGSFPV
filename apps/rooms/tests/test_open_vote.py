"""R27 (lane rooms2, docs/wip/rooms2.md): the open room a pilot lands in with one press, and the vote that moves a room
to another scan. Every rule has its test; tests/test_relay.py and test_review.py keep the temporary rooms' rules."""
from __future__ import annotations

import time
import unittest

from helpers import SCENE, Client, P, R, ServiceThread, create_room, http, pose

V = R.V
SCENE_B = "aabbccdd"
SCENE_C = "11223344"


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def open_room(port: int, scene: str = SCENE, client: str = "10.0.0.1") -> tuple[int, dict]:
    return http(port, "POST", "/api/rooms/open", {"scene": {"id": scene}}, {"X-Forwarded-For": client})


def until(c: Client, kind: str, state: str | None = None, limit: int = 200) -> dict:
    for _ in range(limit):
        m = c.next_json()
        if m.get("type") == kind and (state is None or m.get("state") == state):
            return m
        if m.get("type") == "closed":
            raise AssertionError(f"closed while waiting for {kind}")
    raise AssertionError(f"no {kind}")


class Majority(unittest.TestCase):
    """rooms-plan.md 2.3: passes when yes > half of the members present; the proposer counts once."""

    def test_need(self):
        self.assertEqual([V.need(n) for n in (1, 2, 3, 4, 5, 16)], [1, 2, 2, 3, 3, 9])

    def test_two_of_four_stays_open_three_of_four_passes(self):
        b = V.Ballot(30, Clock())
        present = {0, 1, 2, 3}
        self.assertEqual(b.propose({"id": SCENE_B}, 0, SCENE, present), "open")
        self.assertEqual(b.agree(0, present), "open")  # the proposer again: still one yes (a set, not a count)
        self.assertEqual(b.agree(1, present), "open")  # 2 of 4 is not more than half
        self.assertEqual(b.agree(2, present), "passed")

    def test_alone_a_proposal_passes_at_once(self):
        self.assertEqual(V.Ballot(30, Clock()).propose({"id": SCENE_B}, 3, SCENE, {3}), "passed")

    def test_window_ends_failed(self):
        clk = Clock()
        b = V.Ballot(30, clk)
        b.propose({"id": SCENE_B}, 0, SCENE, {0, 1})
        clk.t += 29.9
        self.assertIsNone(b.check({0, 1}))
        clk.t += 0.2
        self.assertEqual(b.check({0, 1}), "failed")

    def test_one_vote_at_a_time_same_scan_counts_yes(self):
        b = V.Ballot(30, Clock())
        p = {0, 1, 2}
        b.propose({"id": SCENE_B}, 0, SCENE, p)
        self.assertEqual(b.propose({"id": SCENE_C}, 1, SCENE, p), "busy")
        self.assertEqual(b.vote.yes, {0})
        self.assertEqual(b.propose({"id": SCENE_B}, 1, SCENE, p), "passed")

    def test_the_scan_flown_is_no_vote(self):
        b = V.Ballot(30, Clock())
        self.assertEqual(b.propose({"id": SCENE}, 0, SCENE, {0, 1}), "same")
        self.assertIsNone(b.vote)

    def test_leaving_takes_the_yes(self):
        b = V.Ballot(30, Clock())
        b.propose({"id": SCENE_B}, 0, SCENE, {0, 1})
        b.drop(0)
        self.assertEqual(b.check({1}), "failed")  # nobody says yes any more


class OpenRoomHttp(unittest.TestCase):
    def setUp(self):
        self.t = ServiceThread()
        self.port = self.t.port

    def tearDown(self):
        self.t.stop()

    def test_same_scan_same_room_listed_persistent_cap_16(self):
        c1, a = open_room(self.port)
        c2, b = open_room(self.port, client="10.0.0.2")
        self.assertEqual((c1, c2), (200, 200))
        self.assertEqual(a["id"], b["id"])
        self.assertEqual((a["room"]["kind"], a["room"]["cap"], a["room"]["listed"]), ("persistent", 16, True))
        self.assertEqual(a["room"]["scene"], {"id": SCENE})
        code, listed = http(self.port, "GET", "/api/rooms")
        self.assertEqual([r["id"] for r in listed["rooms"]], [a["id"]])

    def test_company_first_then_own_scan(self):
        _, a = open_room(self.port)
        c = Client(self.port)
        try:
            self.assertEqual(c.hello(a["id"])["type"], "welcome")
            _, b = open_room(self.port, SCENE_B)  # pilots fly in A's room: B's pilot lands there
            self.assertEqual(b["id"], a["id"])
        finally:
            c.close()
        time.sleep(0.3)
        _, b2 = open_room(self.port, SCENE_B)  # nobody anywhere: his own scan's room
        self.assertNotEqual(b2["id"], a["id"])
        self.assertEqual(b2["room"]["scene"]["id"], SCENE_B)

    def test_temporary_rooms_are_not_offered(self):
        tmp = create_room(self.port, name="Mine", listed=True)
        _, a = open_room(self.port)
        self.assertNotEqual(a["id"], tmp["id"])

    def test_bad_scene_400(self):
        for body in ({"scene": {"id": "ZZ"}}, {"scene": "x"}, [1]):
            code, got = http(self.port, "POST", "/api/rooms/open", body)
            self.assertEqual((code, got.get("error")), (400, "scene"))

    def test_new_open_rooms_are_limited_per_address(self):
        codes = [open_room(self.port, f"{i:08x}", client="10.0.0.7")[0] for i in range(R.OPEN_CREATES_PER_HOUR + 1)]
        self.assertEqual(codes[:-1], [200] * R.OPEN_CREATES_PER_HOUR)
        self.assertEqual(codes[-1], 429)
        self.assertEqual(open_room(self.port, "00000000", client="10.0.0.7")[0], 200)  # joining one that exists

    def test_open_rooms_capped(self):
        old = R.MAX_PERSISTENT
        R.MAX_PERSISTENT = 2
        try:
            got = [open_room(self.port, f"{i:08x}", client=f"10.1.0.{i}")[0] for i in range(3)]
        finally:
            R.MAX_PERSISTENT = old
        self.assertEqual(got, [200, 200, 503])

    def test_the_sixteenth_pilot_fits_the_seventeenth_gets_a_new_room(self):
        _, a = open_room(self.port)
        cs = []
        try:
            for i in range(16):
                c = Client(self.port, client=f"10.2.0.{i}")
                cs.append(c)
                self.assertEqual(c.hello(a["id"], nick=f"P{i:02d}")["type"], "welcome")
            _, b = open_room(self.port)
            self.assertNotEqual(b["id"], a["id"])
        finally:
            for c in cs:
                c.close()


class VoteOverSockets(unittest.TestCase):
    def start(self, **kw):
        self.t = ServiceThread(**kw)
        self.addCleanup(self.t.stop)
        _, a = open_room(self.t.port)
        self.rid = a["id"]
        self.a, self.b = Client(self.t.port, client="10.3.0.1"), Client(self.t.port, client="10.3.0.2")
        self.addCleanup(self.a.close)
        self.addCleanup(self.b.close)
        self.assertEqual(self.a.hello(self.rid, "Ala")["type"], "welcome")
        self.assertEqual(self.b.hello(self.rid, "Bob")["type"], "welcome")
        until(self.a, "joined")

    def test_propose_agree_both_move_and_old_poses_go(self):
        self.start()
        self.a.send(2, pose())  # a pose of the old scan
        time.sleep(0.2)
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        for c in (self.a, self.b):
            v = until(c, "vote", "open")
            self.assertEqual((v["scene"], v["by"], v["yes"], v["need"], v["present"]), ({"id": SCENE_B}, 0, [0], 2, 2))
        self.b.send_json({"type": "agree"})
        for c in (self.a, self.b):
            self.assertEqual(until(c, "vote", "passed")["yes"], [0, 1])
            self.assertEqual(until(c, "scene")["room"]["scene"], {"id": SCENE_B})
        code, room = http(self.t.port, "GET", f"/api/rooms/{self.rid}")
        self.assertEqual(room["scene"], {"id": SCENE_B})
        svc_room = self.t.svc.rooms[self.rid]
        self.assertTrue(all(m.pose is None for m in svc_room.members.values()))

    def test_a_vote_without_majority_fails_at_the_end_of_its_window(self):
        self.start(vote_s=0.5)
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        until(self.b, "vote", "open")
        v = until(self.b, "vote", "failed")
        self.assertEqual(v["yes"], [0])
        self.assertEqual(http(self.t.port, "GET", f"/api/rooms/{self.rid}")[1]["scene"], {"id": SCENE})

    def test_an_idle_pilot_is_not_counted(self):
        self.start(present_s=0.3)
        time.sleep(0.5)  # both idle now; the proposal makes A active, B stays idle
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        self.assertEqual(until(self.b, "vote", "passed")["present"], 1)

    def test_a_paused_pose_is_not_a_sign_of_life(self):
        self.start(present_s=0.3)
        for i in range(8):
            self.b.send(2, pose(seq=i + 1, flags=P.FLAG_PAUSED))
            time.sleep(0.07)
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        self.assertEqual(until(self.b, "vote", "passed")["present"], 1)

    def test_a_flying_pose_is_a_sign_of_life(self):
        self.start(present_s=0.3)
        for i in range(8):
            self.b.send(2, pose(seq=i + 1))
            time.sleep(0.07)
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        self.assertEqual(until(self.b, "vote", "open")["present"], 2)

    def test_the_last_no_voter_leaves_and_the_vote_passes(self):
        self.start()
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        until(self.a, "vote", "open")
        self.b.close()
        self.assertEqual(until(self.a, "vote", "passed")["present"], 1)
        self.assertEqual(until(self.a, "scene")["room"]["scene"]["id"], SCENE_B)

    def test_another_scan_while_a_vote_runs_answers_its_state(self):
        self.start()
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        until(self.b, "vote", "open")
        self.b.send_json({"type": "propose", "scene": {"id": SCENE_C}})
        v = until(self.b, "vote", "busy")
        self.assertEqual((v["scene"], v["yes"]), ({"id": SCENE_B}, [0]))

    def test_a_newcomer_gets_the_open_vote_in_the_welcome(self):
        self.start()
        self.a.send_json({"type": "propose", "scene": {"id": SCENE_B}})
        until(self.a, "vote", "open")
        c = Client(self.t.port, client="10.3.0.3")
        try:
            w = c.hello(self.rid, "Cyd")
            self.assertEqual((w["vote"]["state"], w["vote"]["scene"]), ("open", {"id": SCENE_B}))
        finally:
            c.close()

    def test_proposals_per_member_are_limited(self):
        self.start()
        self.b.close()
        until(self.a, "left")
        got = []
        for i in range(V.PROPOSALS + 1):
            self.a.send_json({"type": "propose", "scene": {"id": (SCENE_B, SCENE_C)[i % 2]}})
            got.append(until(self.a, "vote")["state"])
            if got[-1] == "passed":
                until(self.a, "scene")
        self.assertEqual(got, ["passed"] * V.PROPOSALS + ["wait"])

    def test_a_bad_proposal_is_not_answered(self):
        self.start()
        self.a.send_json({"type": "propose", "scene": {"id": "../x"}})
        self.a.send_json({"type": "propose", "scene": {"id": SCENE}})
        self.assertEqual(until(self.a, "vote")["state"], "same")


if __name__ == "__main__":
    unittest.main()
