"""Tests of the edited courses (tracks-plan 2.6, 2.8, 2.9, 2.10; requirements R6 edit and fork with created/edited marks, R7
voting, R8 admin edit), train 2 lane tracks, stage T1-api: apps/api/tracks.py, apps/api/tracks_admin.py, server.py wiring.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only, no network, a temporary data directory).
Every refusal has its control: the same call done right passes.
"""
from __future__ import annotations

import http.client
import json
import secrets
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import admin  # noqa: E402
import server  # noqa: E402
import tracks  # noqa: E402
import tracks_admin  # noqa: E402
from tracks import TrackError, TrackStore  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "tracks"
BASIC = json.loads((FIX / "valid-basic.json").read_bytes())
PASSWORD = "t3st-" + secrets.token_urlsafe(12)
HASH = admin.make_hash(PASSWORD)
SCENE = "39e63ce9"


def course(seed: str = "9ix", scene: str = SCENE) -> bytes:
    t = json.loads(json.dumps(BASIC))
    t["scene"]["id"], t["title"] = scene, f"Course {seed}"
    return json.dumps(t).encode()


def edit(name: str = "Ann", title: str = "Ann's loop", parent: dict | None = None, scene: str = SCENE, dx: float = 0.5) -> bytes:
    t = json.loads(course(scene=scene))
    t["author"], t["title"], t["generator"], t["parent"] = {"kind": "person", "name": name}, title, None, parent
    t["gates"][0]["pos"][0] += dx   # the pilot moved the first gate
    return json.dumps(t).encode()


def voter(i: int) -> str:
    return f"{i:032x}"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.clock = [1_794_000_000.0]
        self.store = TrackStore(lambda: self.dir, free_bytes=lambda: 10 ** 12, min_free_bytes=lambda: 10 ** 9, now=lambda: self.clock[0])

    def tick(self, s: float = 1.0) -> None:
        self.clock[0] += s

    def new(self, raw: bytes | None = None) -> dict:
        self.tick()
        return self.store.create(raw or course())

    def refused(self, status: int, code: str, fn, *a) -> None:
        with self.assertRaises(TrackError) as e:
            fn(*a)
        self.assertEqual((e.exception.status, e.exception.code), (status, code))

    def row(self, tid: str, hidden: bool = True) -> dict:
        return next(r for r in self.store.rows(SCENE, hidden=hidden) if r["id"] == tid)


class Validator(unittest.TestCase):
    def test_pilot_texts(self):
        ok = json.loads(edit())
        self.assertEqual(tracks.validate_track(ok), [])
        for name in ("A", "x" * 33, "Ann  K", "Ann\u200b", "see http://x.pl", "fuckface", "Rene\u0301e", "Ann;"):
            bad = {**ok, "author": {"kind": "person", "name": name}}
            self.assertNotEqual(tracks.validate_track(bad), [], repr(name))
        for title in ("ab", "y" * 61, "Loop <b>", "www.loop.pl"):
            self.assertNotEqual(tracks.validate_track({**ok, "title": title}), [], repr(title))
        # controls: letters of any script, digits and the allowed signs pass
        for name in ("\u0410\u043d\u044f", "O'Neil-2", "Zo\u00eb_K."):
            self.assertEqual(tracks.validate_track({**ok, "author": {"kind": "person", "name": name}}), [], repr(name))
        self.assertEqual(tracks.validate_track({**ok, "title": "Loop #2 (fast), ok?"}), [])

    def test_generated_course_rules_still_hold_and_admin_kind_is_not_public(self):
        gen = json.loads(course())
        self.assertEqual(tracks.validate_track(gen), [])
        self.assertNotEqual(tracks.validate_track({**gen, "title": "Ann's loop"}), [])        # a generated course keeps 'Course <seed>'
        self.assertNotEqual(tracks.validate_track({**gen, "parent": {"id": "a", "version": 1}}), [])
        self.assertNotEqual(tracks.validate_track({**gen, "author": {"kind": "agent", "name": "gsfpv-course"}}), [])
        many = {**gen, "laps": 1, "gates": [{**gen["gates"][0], "id": f"g{i}", "pos": [i * 0.5, 0.2, 2]} for i in range(61)]}
        self.assertNotEqual(tracks.validate_track(many), [])
        self.assertEqual(tracks.validate_track({**many, "gates": many["gates"][:60]}), [])  # control: 60 gates pass

    def test_wilson(self):
        self.assertEqual(tracks.wilson(0, 0), 0.0)
        self.assertAlmostEqual(tracks.wilson(1, 0), 0.2065, places=4)
        self.assertGreater(tracks.wilson(10, 1), tracks.wilson(1, 0))
        self.assertGreater(tracks.wilson(50, 10), tracks.wilson(5, 0))


class ForkAndVersions(Base):
    def test_create_answers_a_token_once_and_keeps_only_its_hash(self):
        out = self.new()
        self.assertEqual(set(out), {"id", "version", "editToken"})
        meta = (self.dir / "tracks" / SCENE / out["id"] / "meta.json").read_text(encoding="utf-8")
        self.assertNotIn(out["editToken"], meta)
        r = self.row(out["id"])
        self.assertEqual((r["creator"], r["editor"], r["edited"]), ({"kind": "generator", "name": None}, None, None))

    def test_new_version_needs_the_token(self):
        out = self.new()
        tid = out["id"]
        self.refused(403, "token", self.store.add_version, tid, None, edit())
        self.refused(403, "token", self.store.add_version, tid, "x" * 32, edit())
        self.refused(400, "scene-mismatch", self.store.add_version, tid, out["editToken"], edit(scene="887f27aa"))
        self.tick()
        v2 = self.store.add_version(tid, out["editToken"], edit())   # control: the owner's token
        self.assertEqual(v2, {"id": tid, "version": 2})
        f2 = json.loads(self.store.file(tid, 2, None)[1])
        self.assertEqual((f2["version"], f2["parent"], f2["id"]), (2, {"id": tid, "version": 1}, tid))
        self.assertEqual(tracks.validate_track(f2), [])           # a client that re-checks the stored file accepts it
        v3 = self.store.add_version(tid, out["editToken"], course(seed="again"))   # the owner generates anew
        self.assertEqual(tracks.validate_track(json.loads(self.store.file(tid, 3, None)[1])), [])
        self.store.delete(tid, 3)
        self.assertEqual(self.store.add_version(tid, out["editToken"], edit())["version"], 4)   # 3 is never given twice
        self.assertEqual(json.loads(self.store.file(tid, 4, None)[1])["parent"], {"id": tid, "version": 3})
        self.assertEqual(v3["version"], 3)
        self.assertEqual(self.store.file(tid, 1, None)[0], 200)   # the first version stays readable
        r = self.row(tid)
        self.assertEqual((r["version"], r["versions"], r["title"]), (4, [1, 2, 4], "Ann's loop"))
        self.assertEqual((r["creator"]["kind"], r["editor"]), ("generator", {"kind": "pilot", "name": "Ann"}))
        self.assertIsNotNone(r["edited"])

    def test_versions_have_a_cap(self):
        self.store.limits["versions_per_track"] = 2
        out = self.new()
        self.store.add_version(out["id"], out["editToken"], edit())
        self.refused(409, "too-many-versions", self.store.add_version, out["id"], out["editToken"], edit())

    def test_fork_keeps_the_origin_and_names_the_editor(self):
        src = self.new(edit(name="Ann"))
        fork = self.new(edit(name="Bob", title="Bob's loop", parent={"id": src["id"], "version": 1}))
        self.assertNotEqual(fork["id"], src["id"])
        r = self.row(fork["id"])
        self.assertEqual((r["version"], r["parent"], r["origin"]), (1, {"id": src["id"], "version": 1}, {"id": src["id"], "version": 1}))
        self.assertEqual((r["creator"], r["editor"]), ({"kind": "pilot", "name": "Ann"}, {"kind": "pilot", "name": "Bob"}))
        # a fork of the fork still names the first creator
        again = self.new(edit(name="Cy", title="Cy's loop", parent={"id": fork["id"], "version": 1}))
        r3 = self.row(again["id"])
        self.assertEqual((r3["creator"]["name"], r3["editor"]["name"], r3["origin"]["id"]), ("Ann", "Cy", src["id"]))
        # the source is untouched (another pilot cannot change it without its token)
        self.assertEqual(self.row(src["id"])["editor"], None)

    def test_fork_refusals(self):
        src = self.new()
        self.refused(400, "bad-parent", self.store.create, edit(parent={"id": f"{SCENE}-00000000", "version": 1}))
        self.refused(400, "bad-parent", self.store.create, edit(parent={"id": src["id"], "version": 2}))
        self.refused(400, "bad-parent", self.store.create, edit(scene="887f27aa", parent={"id": src["id"], "version": 1}))
        self.store.set_hidden(src["id"], True)
        self.refused(400, "bad-parent", self.store.create, edit(parent={"id": src["id"], "version": 1}))
        self.store.set_hidden(src["id"], False)
        self.assertIn("id", self.store.create(edit(parent={"id": src["id"], "version": 1})))   # control

    def test_a_train_one_course_is_listed_and_cannot_be_edited_without_a_token(self):
        tid = f"{SCENE}-830e1273"
        d = self.dir / "tracks" / SCENE / tid
        d.mkdir(parents=True)
        t = json.loads(course())
        t.update(id=tid, created="2026-11-13T09:50:00Z")
        (d / "v1.json").write_text(json.dumps(t), encoding="utf-8")
        (self.dir / "tracks" / SCENE / "index.json").write_text(json.dumps({"v": 1, "tracks": [{"id": tid}]}), encoding="utf-8")
        r = self.row(tid, hidden=False)
        self.assertEqual((r["version"], r["creator"]["kind"], r["editable"]), (1, "generator", False))
        self.refused(403, "token", self.store.add_version, tid, "anything", edit())
        self.assertIn("id", self.store.create(edit(parent={"id": tid, "version": 1})))   # control: it can be forked


class Votes(Base):
    def test_one_vote_per_voter_and_one_voter_per_address_a_day(self):
        tid = self.new()["id"]
        self.assertEqual(self.store.vote(tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(1)}).encode(), "a1")["up"], 1)
        out = self.store.vote(tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(1)}).encode(), "a1")
        self.assertEqual((out["up"], out["down"]), (1, 0))                      # a second vote of the same voter counts once
        out = self.store.vote(tid, json.dumps({"v": -1, "lap": 30000, "voter": voter(1)}).encode(), "a1")
        self.assertEqual((out["up"], out["down"]), (0, 1))                      # re-voting replaces
        self.refused(429, "address-voted", self.store.vote, tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(2)}).encode(), "a1")
        self.assertEqual(self.store.vote(tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(2)}).encode(), "a2")["up"], 1)   # control: another address
        self.tick(86400)
        # lane review TK-8: the address keeps its voter on the next days too (it was cleared each UTC day)
        for day in range(3):
            self.refused(429, "address-voted", self.store.vote, tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(10 + day)}).encode(), "a1")
            self.tick(86400)
        self.assertEqual(self.row(tid)["up"], 1)
        self.assertEqual(self.store.vote(tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(3)}).encode(), "a3")["up"], 2)   # control: another address
        out = self.store.vote(tid, json.dumps({"v": 0, "lap": 30000, "voter": voter(3)}).encode(), "a3")
        self.assertEqual((out["up"], out["down"]), (1, 1))                      # 0 takes it back
        meta = (self.dir / "tracks" / SCENE / tid / "meta.json").read_text(encoding="utf-8")
        self.assertNotIn(voter(1), meta)
        self.assertNotIn("a1", json.loads(meta)["addr"])

    def test_bad_votes(self):
        tid = self.new()["id"]
        for body in ({"v": 2, "lap": 30000, "voter": voter(1)}, {"v": True, "lap": 30000, "voter": voter(1)}, {"v": 1, "voter": "x"}, {"v": 1}, [1]):
            self.refused(400, "bad-vote" if isinstance(body, dict) else "bad-json", self.store.vote, tid, json.dumps(body).encode(), "a")
        self.refused(413, "too-large", self.store.vote, tid, b" " * 2000, "a")
        # stage K2: an up or down vote needs a completed lap; taking a vote back does not
        for lap in (None, 0, 999, 3_600_001, 1.5e4, "30000", True):
            body = {"v": 1, "voter": voter(1)} if lap is None else {"v": 1, "voter": voter(1), "lap": lap}
            self.refused(403, "lap-first", self.store.vote, tid, json.dumps(body).encode(), "a")
        self.assertEqual(self.row(tid)["up"], 0)
        self.assertEqual(self.store.vote(tid, json.dumps({"v": 0, "voter": voter(1)}).encode(), "a")["up"], 0)
        self.assertEqual(self.store.vote(tid, json.dumps({"v": 1, "voter": voter(1), "lap": 1000}).encode(), "a")["up"], 1)
        self.store.set_hidden(tid, True)
        self.refused(404, "not-found", self.store.vote, tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(1)}).encode(), "a")

    def test_top_is_sorted_by_wilson_then_newer_and_new_by_created(self):
        a, b, c = self.new()["id"], self.new()["id"], self.new()["id"]
        for i in range(10):
            self.store.vote(a, json.dumps({"v": 1, "lap": 30000, "voter": voter(i)}).encode(), f"x{i}")
        self.store.vote(a, json.dumps({"v": -1, "lap": 30000, "voter": voter(99)}).encode(), "x99")
        self.store.vote(b, json.dumps({"v": 1, "lap": 30000, "voter": voter(50)}).encode(), "y")
        top = json.loads(self.store.list(SCENE, None, "top")[1])["tracks"]
        self.assertEqual([r["id"] for r in top], [a, b, c])
        self.assertEqual([r["id"] for r in json.loads(self.store.list(SCENE, None, "new")[1])["tracks"]], [c, b, a])
        self.assertGreater(top[0]["rating"], top[1]["rating"])
        d = self.new()["id"]   # no votes: ties by newer
        self.assertEqual([r["id"] for r in json.loads(self.store.list(SCENE, None)[1])["tracks"]], [a, b, d, c])

    def test_pages_and_bad_queries(self):
        self.store.limits["page_size"] = 2
        ids = [self.new()["id"] for _ in range(3)]
        p1, p2 = (json.loads(self.store.list(SCENE, None, "new", n)[1]) for n in (1, 2))
        self.assertEqual((p1["pages"], len(p1["tracks"]), [r["id"] for r in p2["tracks"]]), (2, 2, [ids[0]]))
        self.refused(400, "bad-sort", self.store.list, SCENE, None, "best")
        self.refused(400, "bad-page", self.store.list, SCENE, None, "top", 0)


class Broken(Base):
    def report(self, tid: str, client: str, digest: str = "ab" * 8) -> dict:
        return self.store.broken(tid, json.dumps({"gate": 2, "wallsDigest": digest}).encode(), client)

    def test_three_clients_on_the_same_walls_leave_the_course_out_of_top(self):
        tid, other = self.new()["id"], self.new()["id"]
        for _ in range(3):
            self.report(tid, "c1")                 # one client three times counts once
        self.report(tid, "c2", "cd" * 8)           # another walls digest is another count
        top = [r["id"] for r in json.loads(self.store.list(SCENE, None)[1])["tracks"]]
        self.assertIn(tid, top)                    # control
        self.report(tid, "c2")
        self.assertEqual(self.report(tid, "c3")["broken"], 3)
        self.assertEqual([r["id"] for r in json.loads(self.store.list(SCENE, None)[1])["tracks"]], [other])
        self.assertIn(tid, [r["id"] for r in json.loads(self.store.list(SCENE, None, "new")[1])["tracks"]])
        self.store.reset(tid, "broken")            # the admin looked
        self.assertIn(tid, [r["id"] for r in json.loads(self.store.list(SCENE, None)[1])["tracks"]])

    def test_bad_reports(self):
        tid = self.new()["id"]
        for body in ({"gate": 60, "wallsDigest": "ab" * 8}, {"gate": True, "wallsDigest": "ab" * 8}, {"gate": 1, "wallsDigest": "XYZ"}, {"gate": 1}):
            self.refused(400, "bad-report", self.store.broken, tid, json.dumps(body).encode(), "c")


class AdminActions(Base):
    def setUp(self):
        super().setUp()
        self.api = admin.AdminApi(data_dir=lambda: self.dir, reports_dir=lambda: self.dir / "r", seed=lambda: None, telegram=lambda t: None,
                                  env={"ADMIN_PASSWORD_HASH": HASH})
        tracks_admin.TracksAdmin(lambda: self.store, self.api.audit).register(self.api)
        st, body, hdrs = self.api.handle("POST", "/api/admin/login", _H(), lambda n: json.dumps({"password": PASSWORD}).encode(), "1.2.3.4")
        self.assertEqual(st, 200)
        self.cookie, self.csrf = dict(hdrs)["Set-Cookie"].split(";")[0], json.loads(body)["csrf"]

    def call(self, method: str, path: str, body=None, csrf: bool = True, qs: str = ""):
        h = _H({"Cookie": self.cookie, **({"X-CSRF": self.csrf} if csrf and method == "POST" else {})})
        data = body if isinstance(body, bytes) else json.dumps(body if body is not None else {}).encode()
        st, out, _ = self.api.handle(method, f"/api/admin/{path}", h, lambda n: data, "1.2.3.4", qs)
        return st, (json.loads(out) if isinstance(out, (bytes, bytearray)) and out[:1] == b"{" else out)

    def audit(self) -> list[str]:
        p = self.dir / "admin-audit.jsonl"
        return [json.loads(x)["action"] for x in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []

    def test_posts_need_the_csrf_token_and_change_nothing_without_it(self):
        tid = self.new()["id"]
        before = self.store.rows(SCENE, hidden=True)
        for path, body in ((f"tracks/{tid}/hide", {"hidden": True}), (f"tracks/{tid}/delete", {"confirm": True}),
                           (f"tracks/{tid}/versions", json.loads(edit())), (f"tracks/{tid}/votes/reset", {"confirm": True})):
            self.assertEqual(self.call("POST", path, body, csrf=False)[0], 403, path)
        self.assertEqual(self.store.rows(SCENE, hidden=True), before)
        self.assertEqual(self.call("POST", f"tracks/{tid}/hide", {"hidden": True})[0], 200)   # control

    def test_list_hide_edit_delete_reset_all_audited(self):
        tid = self.new(edit(name="Ann"))["id"]
        self.assertEqual(self.call("GET", "tracks")[1]["scenes"], [{"scene": SCENE, "tracks": 1, "hidden": 0}])
        self.assertEqual(self.call("POST", f"tracks/{tid}/hide", {"hidden": True})[0], 200)
        self.assertEqual(self.store.rows(SCENE), [])
        st, out = self.call("GET", "tracks", qs=f"scene={SCENE}")
        self.assertEqual((st, out["tracks"][0]["hidden"]), (200, True))
        self.assertEqual(self.call("GET", f"tracks/{tid}/v1")[0], 200)          # the admin reads a hidden course
        self.refused(404, "not-found", self.store.file, tid, 1, None)          # the public does not
        self.assertEqual(self.call("POST", f"tracks/{tid}/hide", {"hidden": False})[0], 200)
        st, out = self.call("POST", f"tracks/{tid}/versions", json.loads(edit(name="Ann", title="Ann's loop fixed")))
        self.assertEqual((st, out["version"]), (201, 2))
        r = self.row(tid)
        self.assertEqual((r["creator"], r["editor"]), ({"kind": "pilot", "name": "Ann"}, {"kind": "admin", "name": None}))
        self.store.vote(tid, json.dumps({"v": 1, "lap": 30000, "voter": voter(1)}).encode(), "a")
        self.assertEqual(self.call("POST", f"tracks/{tid}/votes/reset", {"confirm": True})[0], 200)
        self.assertEqual(self.row(tid)["up"], 0)
        self.assertEqual(self.call("POST", f"tracks/{tid}/v1/delete", {})[0], 400)                 # confirm needed
        self.assertEqual(self.call("POST", f"tracks/{tid}/v1/delete", {"confirm": True})[0], 200)
        self.assertEqual(self.row(tid)["versions"], [2])
        self.refused(404, "not-found", self.store.file, tid, 1, None)
        self.assertEqual(self.call("POST", f"tracks/{tid}/v2/delete", {"confirm": True})[1]["deleted"], "track")   # the last version
        self.assertEqual(self.store.rows(SCENE, hidden=True), [])
        self.assertEqual(self.call("POST", f"tracks/{tid}/delete", {"confirm": True})[0], 404)
        self.assertEqual([a for a in self.audit() if a.startswith("tracks.")],
                         ["tracks.hide", "tracks.unhide", "tracks.version", "tracks.reset-votes", "tracks.delete-v1", "tracks.delete-v2", "tracks.delete"])

    def test_admin_edit_is_validated_like_any_course(self):
        tid = self.new()["id"]
        st, out = self.call("POST", f"tracks/{tid}/versions", json.loads(edit(name="A")))
        self.assertEqual((st, out["reason"]), (400, "invalid"))
        self.assertEqual(self.row(tid)["versions"], [1])

    def test_the_server_wires_the_routes(self):
        routes = {(m, p.pattern) for m, p, _f in server.ADMIN._extra}
        self.assertIn(("POST", rf"tracks/{tracks_admin.TID}/versions"), routes)
        self.assertIn(("GET", r"tracks"), routes)


class _H(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class Http(unittest.TestCase):
    """The real handler on a real socket, the way nginx reaches it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        saved = server.TRACKS
        server.TRACKS = TrackStore(lambda: Path(self.tmp.name), free_bytes=lambda: 10 ** 12, min_free_bytes=lambda: 10 ** 9)
        self.addCleanup(lambda: setattr(server, "TRACKS", saved))
        server._trhits.clear()
        server._trvhits.clear()
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (self.api.shutdown(), self.api.server_close()))

    def call(self, method: str, path: str, body: bytes | None = None, ip: str = "203.0.113.7", headers: dict | None = None):
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=10)
        h = {"X-Forwarded-For": ip, **({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        return r.status, (json.loads(out) if out[:1] == b"{" else out)

    def test_version_vote_broken_routes(self):
        st, out = self.call("POST", "/api/tracks", course())
        self.assertEqual(st, 201, out)
        tid, token = out["id"], out["editToken"]
        self.assertEqual(self.call("POST", f"/api/tracks/{tid}/versions", edit())[0], 403)
        self.assertEqual(self.call("POST", f"/api/tracks/{tid}/versions", edit(), headers={"X-Track-Token": token[::-1]})[0], 403)
        st, out = self.call("POST", f"/api/tracks/{tid}/versions", edit(), headers={"X-Track-Token": token})
        self.assertEqual((st, out["version"]), (201, 2))
        self.assertEqual(self.call("GET", f"/api/tracks/{tid}/v2")[0], 200)
        st, out = self.call("POST", f"/api/tracks/{tid}/vote", json.dumps({"v": 1, "lap": 30000, "voter": voter(7)}).encode())
        self.assertEqual((st, out["up"]), (200, 1))
        st, out = self.call("POST", f"/api/tracks/{tid}/broken", json.dumps({"gate": 0, "wallsDigest": "ab" * 8}).encode())
        self.assertEqual((st, out["broken"]), (200, 1))
        st, lst = self.call("GET", f"/api/tracks?scene={SCENE}&sort=new&page=1")
        self.assertEqual((st, lst["tracks"][0]["version"], lst["tracks"][0]["editor"]["kind"]), (200, 2, "pilot"))
        self.assertEqual(self.call("GET", f"/api/tracks?scene={SCENE}&sort=best")[0], 400)
        self.assertEqual(self.call("GET", f"/api/tracks?scene={SCENE}&page=x")[0], 400)
        self.assertEqual(self.call("POST", f"/api/tracks/{tid}/vote", b'{"v":1}', headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("POST", f"/api/tracks/{tid}/rename", b"{}")[0], 404)

    def test_each_action_has_its_own_rate(self):
        saved = dict(tracks.LIMITS)
        self.addCleanup(lambda: tracks.LIMITS.update(saved))
        tracks.LIMITS.update(votes_per_client_hour=2, versions_per_client_hour=1)
        tid = self.call("POST", "/api/tracks", course())[1]["id"]
        codes = [self.call("POST", f"/api/tracks/{tid}/vote", json.dumps({"v": 1, "lap": 30000, "voter": voter(1)}).encode())[0] for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])
        self.assertEqual(self.call("POST", f"/api/tracks/{tid}/vote", json.dumps({"v": 1, "lap": 30000, "voter": voter(2)}).encode(), ip="198.51.100.4")[0], 200)
        self.assertEqual([self.call("POST", f"/api/tracks/{tid}/versions", edit())[0] for _ in range(2)], [403, 429])


if __name__ == "__main__":
    unittest.main()
