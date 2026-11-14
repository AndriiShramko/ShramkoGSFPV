"""Lane tracks, stage fixes of train 2: review findings TK-8 (votes per address), TK-9 (page number), TK-11 a (a generated
course never has a parent at any version). Run: python -X utf8 -m unittest apps/api/tests/test_tracks_fixes.py"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import tracks  # noqa: E402
import test_tracks_edit as te  # noqa: E402
from test_tracks_edit import SCENE, course, voter  # noqa: E402


class Fixes(te.Base):
    def test_tk8_address_keeps_its_voter_for_days(self):
        tid = self.new()["id"]
        self.assertEqual(self.store.vote(tid, json.dumps({"lap": 5000, "v":1, "voter": voter(1)}).encode(), "a1")["up"], 1)
        for day in range(5):
            self.tick(86400)
            self.refused(429, "address-voted", self.store.vote, tid, json.dumps({"lap": 5000, "v":1, "voter": voter(20 + day)}).encode(), "a1")
        self.assertEqual(self.row(tid)["up"], 1)
        # control: the address's own voter still changes its vote
        self.assertEqual(self.store.vote(tid, json.dumps({"lap": 5000, "v":-1, "voter": voter(1)}).encode(), "a1")["down"], 1)

    def test_tk8_bindings_are_capped_oldest_first(self):
        tid = self.new()["id"]
        with mock.patch.object(tracks, "VOTE_ADDR_CAP", 3):
            for i in range(4):
                self.store.vote(tid, json.dumps({"lap": 5000, "v":1, "voter": voter(i)}).encode(), f"b{i}")
            meta = json.loads((self.dir / "tracks" / SCENE / tid / "meta.json").read_text(encoding="utf-8"))
            self.assertEqual(len(meta["addr"]), 3)
            # the oldest address (b0) was dropped: a new voter from it is taken
            self.assertEqual(self.store.vote(tid, json.dumps({"lap": 5000, "v":1, "voter": voter(9)}).encode(), "b0")["up"], 5)

    def test_tk11a_generator_body_with_parent_refused_at_any_version(self):
        self.new()
        for version in (2, 5):
            t = json.loads(course("abc"))
            t["version"], t["parent"] = version, {"id": t["id"], "version": version - 1}
            self.refused(400, "bad-parent", self.store.create, json.dumps(t).encode())
        # control: the same body without a parent is a new course
        t = json.loads(course("abc"))
        t["version"], t["parent"] = 1, None
        self.assertEqual(self.store.create(json.dumps(t).encode())["version"], 1)


class PageNumber(te.Http):
    def test_tk9_unicode_digit_page_is_400(self):
        self.assertEqual(self.call("GET", f"/api/tracks?scene={SCENE}&page=%C2%B2")[0], 400)
        self.assertEqual(self.call("GET", f"/api/tracks?scene={SCENE}&page=%D9%A3")[0], 400)
        self.assertEqual(self.call("GET", f"/api/tracks?scene={SCENE}&page=1")[0], 200)   # control


if __name__ == "__main__":
    unittest.main()
