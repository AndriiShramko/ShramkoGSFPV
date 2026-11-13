"""Tests of the courses saved per scene (apps/api/tracks.py, GET/POST /api/tracks in server.py), train 1 lane tracks, stage T3.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only, no network, a temporary data directory).
The fixtures apps/api/tests/fixtures/tracks/{valid,invalid}-*.json are shared with packages/tracks/test/fixtures.test.ts: the
Python port and the TS validator must agree on every file. Every refusal has its control: the same call done right passes.
"""
from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import tracks  # noqa: E402
from tracks import TrackError, TrackStore  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "tracks"
BASIC = (FIX / "valid-basic.json").read_bytes()


def course(scene: str = "39e63ce9", seed: str = "9ix") -> bytes:
    t = json.loads(BASIC)
    t["scene"]["id"] = scene
    t["title"] = f"Course {seed}"
    return json.dumps(t).encode()


class Validator(unittest.TestCase):
    def test_every_fixture(self):
        files = sorted(FIX.glob("*.json"))
        self.assertGreaterEqual(len([f for f in files if f.name.startswith("valid-")]), 3)
        self.assertGreaterEqual(len([f for f in files if f.name.startswith("invalid-")]), 20)
        for f in files:
            _, issues = tracks.parse_track(f.read_bytes())
            if f.name.startswith("valid-"):
                self.assertEqual(issues, [], f.name)
            else:
                self.assertNotEqual(issues, [], f"{f.name} must be refused")

    def test_control_each_invalid_file_differs_from_a_valid_one_only_in_its_fault(self):
        # the refusal is the contract's, not a broken file: the valid base with only the scene changed back passes
        ok = json.loads(BASIC)
        for scene in ("39e63ce9", "0123456789abcdef0123456789abcdef"):
            ok["scene"]["id"] = scene
            self.assertEqual(tracks.validate_track(ok), [])
        ok["scene"]["id"] = "39E63CE9"
        self.assertNotEqual(tracks.validate_track(ok), [])

    def test_length_of_a_closed_course(self):
        t = json.loads(BASIC)
        self.assertEqual(tracks.path_length_m(t), round(25.04 ** 0.5 + 6 + 61.04 ** 0.5, 1))
        t["laps"], t["transform"][0] = 1, 2   # an open course has no leg back; the scale multiplies
        self.assertEqual(tracks.path_length_m(t), round(2 * (25.04 ** 0.5 + 6), 1))


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.clock = [1_794_000_000.0]
        self.free = [10 ** 12]
        self.store = TrackStore(lambda: self.dir, free_bytes=lambda: self.free[0], min_free_bytes=lambda: 10 ** 9, now=lambda: self.clock[0])

    def test_create_list_file(self):
        out = self.store.create(course())
        self.assertRegex(out["id"], r"^39e63ce9-[0-9a-f]{8}$")
        self.assertEqual(out["version"], 1)
        f = self.dir / "tracks" / "39e63ce9" / out["id"] / "v1.json"
        saved = json.loads(f.read_bytes())
        self.assertEqual((saved["id"], saved["created"]), (out["id"], "2026-11-06T21:20:00Z"))
        self.assertEqual(tracks.validate_track(saved), [])
        code, body, _ = self.store.file(out["id"], 1, None)
        self.assertEqual((code, json.loads(body)["id"]), (200, out["id"]))
        with self.assertRaises(TrackError) as e:
            self.store.file(out["id"], 2, None)
        self.assertEqual(e.exception.status, 404)

    def test_twenty_first_track_of_a_scene_replaces_the_oldest(self):
        # lane review TR-6: a refusal for ever made "Save for everyone" dead in a full scene; tracks-plan 2.8: the oldest
        # unrated course is hidden (the admin may still see and delete it), not refused
        self.store.limits["tracks_per_scene"] = 20
        ids = []
        for i in range(20):
            self.clock[0] += 1
            ids.append(self.store.create(course(seed=f"s{i}"))["id"])
        self.clock[0] += 1
        last = self.store.create(course(seed="last"))["id"]
        rows = self.store.rows("39e63ce9")
        self.assertEqual(len(rows), 20)
        self.assertEqual(rows[0]["id"], last)
        self.assertNotIn(ids[0], [r["id"] for r in rows])
        self.assertIn(ids[0], [r["id"] for r in self.store.rows("39e63ce9", hidden=True)])
        self.assertIn(ids[1], [r["id"] for r in rows])   # control: only the oldest went
        self.assertIn("id", self.store.create(course(scene="887f27aa")))

    def test_stored_file_is_compact_and_never_larger_than_a_body(self):
        # lane review TR-1: a nested body of 64 KB was stored as 58 MB with indent=2
        out = self.store.create(course())
        raw = (self.dir / "tracks" / "39e63ce9" / out["id"] / "v1.json").read_bytes()
        self.assertNotIn(b"\n  ", raw)
        self.assertLessEqual(len(raw), len(course()) + 200)
        deep = json.loads(BASIC)
        nest = 0
        for _ in range(900):
            nest = [nest]
        deep["generator"]["params"] = {"proof": nest}
        with self.assertRaises(TrackError) as e:
            self.store.create(json.dumps(deep).encode())
        self.assertEqual(e.exception.status, 400)
        self.assertEqual(len(list((self.dir / "tracks" / "39e63ce9").glob("*/v1.json"))), 1)

    def test_huge_positions_never_reach_the_list(self):
        # lane review TR-2: two gates at +-1e308 gave lengthM Infinity, which JSON.parse refuses, for every pilot of the scene
        with self.assertRaises(TrackError) as e:
            self.store.create((FIX / "invalid-pos-huge.json").read_bytes())
        self.assertEqual(e.exception.status, 400)
        self.store.create(course())
        idx = self.dir / "tracks" / "39e63ce9" / "index.json"
        rows = json.loads(idx.read_bytes())["tracks"]
        idx.write_text(json.dumps({"v": 1, "tracks": rows + [{**rows[0], "id": "39e63ce9-0000beef", "lengthM": float("inf")}]}), encoding="utf-8")
        code, body, _ = self.store.list("39e63ce9", None)
        self.assertNotIn(b"Infinity", body)
        self.assertEqual(len(json.loads(body)["tracks"]), 1)

    def test_malformed_numbers_and_nesting_are_400_not_a_crash(self):
        # lane review TR-9: a 400-digit integer and 30000 brackets killed the handler thread
        big = BASIC.replace(b"1.5", b"1" * 400, 1)
        self.assertNotEqual(big, BASIC)
        self.assertNotEqual(tracks.parse_track(big)[1], [])
        self.assertNotEqual(tracks.parse_track(b"[" * 30000 + b"]" * 30000)[1], [])

    def test_disk_guard_refuses_with_507(self):
        self.free[0] = 10 ** 8
        with self.assertRaises(TrackError) as e:
            self.store.create(course())
        self.assertEqual(e.exception.status, 507)
        self.assertFalse((self.dir / "tracks").exists())
        self.free[0] = 10 ** 12   # control
        self.assertIn("id", self.store.create(course()))

    def test_index_rebuilt_from_the_files_when_lost(self):
        a = self.store.create(course(seed="a"))
        self.clock[0] += 5
        b = self.store.create(course(seed="b"))
        idx = self.dir / "tracks" / "39e63ce9" / "index.json"
        before = json.loads(idx.read_bytes())["tracks"]
        idx.unlink()
        self.assertEqual(self.store.rows("39e63ce9"), before)
        self.assertEqual([r["id"] for r in before], [b["id"], a["id"]])
        idx.write_text("{broken", encoding="utf-8")   # unreadable: rebuilt too
        self.assertEqual(self.store.rows("39e63ce9"), before)

    def test_a_failed_write_leaves_no_track(self):
        with mock.patch.object(tracks, "_fsync_file", side_effect=OSError(28, "full")):
            with self.assertRaises(OSError):
                self.store.create(course())
        self.assertEqual(self.store.rows("39e63ce9"), [])


class Http(unittest.TestCase):
    """The real handler on a real socket, the way nginx reaches it."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.free = [10 ** 12]
        saved = server.TRACKS
        server.TRACKS = TrackStore(lambda: self.dir, free_bytes=lambda: self.free[0], min_free_bytes=lambda: 10 ** 9)
        self.addCleanup(lambda: setattr(server, "TRACKS", saved))
        server._trhits.clear()
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
        return r.status, dict(r.getheaders()), out

    def test_create_then_list_newest_first_with_etag(self):
        s1, _, b1 = self.call("POST", "/api/tracks", course(seed="a"))
        self.assertEqual(s1, 201, b1)
        server.TRACKS.now = lambda: 1_900_000_000.0
        s2, _, b2 = self.call("POST", "/api/tracks", course(seed="b"))
        self.assertEqual(s2, 201, b2)
        ids = [json.loads(b1)["id"], json.loads(b2)["id"]]
        code, h, body = self.call("GET", "/api/tracks?scene=39e63ce9")
        self.assertEqual(code, 200)
        lst = json.loads(body)
        self.assertEqual(lst["v"], 1)
        self.assertEqual([r["id"] for r in lst["tracks"]], ids[::-1])
        self.assertEqual(set(lst["tracks"][0]), {"id", "version", "title", "gates", "lengthM", "created", "edited", "creator", "editor",
                                                 "parent", "origin", "up", "down", "rating", "broken"})
        self.assertIn("max-age=30", h["Cache-Control"])
        self.assertEqual(self.call("GET", "/api/tracks?scene=39e63ce9", headers={"If-None-Match": h["ETag"]})[0], 304)
        code, fh, fb = self.call("GET", f"/api/tracks/{ids[0]}/v1")
        self.assertEqual((code, json.loads(fb)["id"]), (200, ids[0]))
        self.assertIn("immutable", fh["Cache-Control"])
        # controls: another scene has none, a bad scene id and an unknown file are refused
        self.assertEqual(json.loads(self.call("GET", "/api/tracks?scene=887f27aa")[2])["tracks"], [])
        self.assertEqual(self.call("GET", "/api/tracks?scene=lesson-1")[0], 400)
        self.assertEqual(self.call("GET", "/api/tracks/39e63ce9-00000000/v1")[0], 404)

    def test_oversize_body_is_413(self):
        big = course()[:-1] + b"," + b'"pad": "' + b"x" * (64 * 1024) + b'"}'
        self.assertEqual(self.call("POST", "/api/tracks", big)[0], 413)
        self.assertEqual(self.call("POST", "/api/tracks", course(), ip="203.0.113.8")[0], 201)   # control

    def test_invalid_fixture_is_400(self):
        code, _, body = self.call("POST", "/api/tracks", (FIX / "invalid-author-agent.json").read_bytes())
        self.assertEqual(code, 400)
        self.assertEqual(json.loads(body)["error"], "invalid")
        self.assertEqual(self.call("POST", "/api/tracks", (FIX / "valid-open-scaled.json").read_bytes(), ip="203.0.113.8")[0], 201)   # control

    def test_eleventh_create_in_an_hour_is_429(self):
        for i in range(10):
            self.assertEqual(self.call("POST", "/api/tracks", course(seed=f"r{i}"))[0], 201, i)
        self.assertEqual(self.call("POST", "/api/tracks", course(seed="r10"))[0], 429)
        self.assertEqual(self.call("POST", "/api/tracks", course(seed="r11"), ip="198.51.100.1")[0], 201)   # control: another client

    def test_cross_site_posts_are_refused(self):
        # lane review TR-6: a text/plain POST from another site's page went through (201) from the visitor's own address
        self.assertEqual(self.call("POST", "/api/tracks", course(), headers={"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.call("POST", "/api/tracks", course(), headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.call("POST", "/api/tracks", course(), headers={"Sec-Fetch-Site": "same-origin"})[0], 201)   # control

    def test_all_clients_together_have_a_cap(self):
        saved = tracks.LIMITS["creates_all_hour"]
        tracks.LIMITS["creates_all_hour"] = 2
        self.addCleanup(lambda: tracks.LIMITS.__setitem__("creates_all_hour", saved))
        server._all_hits.pop("tracks-create", None)
        self.addCleanup(lambda: server._all_hits.pop("tracks-create", None))
        codes = [self.call("POST", "/api/tracks", course(seed=f"g{i}"), ip=f"198.51.100.{i + 10}")[0] for i in range(3)]
        self.assertEqual(codes, [201, 201, 429])

    def test_malformed_bodies_get_an_answer(self):
        # lane review TR-9: no answer (RemoteDisconnected) for both before
        self.assertEqual(self.call("POST", "/api/tracks", BASIC.replace(b"1.5", b"1" * 400, 1))[0], 400)
        self.assertEqual(self.call("POST", "/api/tracks", b"[" * 30000 + b"]" * 30000, ip="203.0.113.20")[0], 400)

    def test_disk_guard_is_507(self):
        self.free[0] = 10 ** 8
        self.assertEqual(self.call("POST", "/api/tracks", course())[0], 507)
        self.free[0] = 10 ** 12
        self.assertEqual(self.call("POST", "/api/tracks", course(), ip="203.0.113.9")[0], 201)


if __name__ == "__main__":
    unittest.main()
