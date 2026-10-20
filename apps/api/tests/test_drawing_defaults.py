"""The owner's drawing defaults (v0.10 lane R, docs/wip/v10-r.md): one preset per class of device in the
catalogue document (apps/api/admin.py clean_drawing, CatalogStore), served publicly with the catalogue
(GET /api/catalog "drawing"), saved as a draft, published and restored with the same history as the scenes.
Run: python -m unittest discover -s apps/api/tests -v. Every check has a negative control that must fire."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parent))
import admin  # noqa: E402
from test_admin import PASSWORD, AdminApi  # noqa: E402

SCENES = [{"id": "39e63ce9", "title": "Modlinek Villa"}, {"id": "ba7aa29d", "title": "Opole"}]
FULL = {"presets": {
    "desktop-strong": {"drawing": "stochastic", "budgetM": 8, "renderScale": 1},
    "desktop-weak": {"drawing": "sorted", "budgetM": 2, "renderScale": 0.85},
    "tablet": {"drawing": "sorted", "budgetM": 1.5, "renderScale": 0.75},
    "phone": {"drawing": "sorted", "budgetM": 1, "renderScale": 0.6},
}}


class Validation(unittest.TestCase):
    def test_a_full_document_is_kept_as_it_is(self):
        self.assertEqual(admin.clean_drawing(FULL), FULL)
        # control: not a document at all
        for bad in (None, 5, "sorted", [], {}, {"presets": []}, {"presets": {}}, {"presets": {"desktop-strong": 7}}):
            self.assertIsNone(admin.clean_drawing(bad), bad)

    def test_the_owner_changes_only_what_he_changes(self):
        part = {"presets": {"phone": {"budgetM": 1.5}}}
        self.assertEqual(admin.clean_drawing(part), part)

    def test_unknown_classes_modes_and_out_of_range_numbers_are_dropped(self):
        got = admin.clean_drawing({"presets": {
            "desktop-strong": {"drawing": "taa", "budgetM": 99, "renderScale": 0.1},         # nothing valid left: the preset goes
            "console": {"drawing": "sorted"},                                               # not a class
            "tablet": {"drawing": "sorted", "budgetM": "4", "renderScale": 0.8, "x": 1},      # the string and the unknown field go
            "phone": {"budgetM": True},                                                     # a boolean is not a number
        }})
        self.assertEqual(got, {"presets": {"tablet": {"drawing": "sorted", "renderScale": 0.8}}})
        # control: the same values inside the ranges are kept, so the drops above are the ranges'
        ok = admin.clean_drawing({"presets": {"desktop-strong": {"drawing": "stochastic", "budgetM": 32, "renderScale": 0.4}}})
        self.assertEqual(ok["presets"]["desktop-strong"], {"drawing": "stochastic", "budgetM": 32, "renderScale": 0.4})
        self.assertEqual(admin.clean_drawing({"presets": {"phone": {"budgetM": 0.25}}})["presets"]["phone"], {"budgetM": 0.25})
        self.assertIsNone(admin.clean_drawing({"presets": {"phone": {"budgetM": 0.24}}}))

    def test_the_catalogue_keeps_the_key_only_when_something_is_left(self):
        with_it = admin.clean_catalog({"collections": [], "scenes": SCENES, "drawing": FULL})
        self.assertEqual(with_it["drawing"], FULL)
        self.assertNotIn("drawing", admin.clean_catalog({"collections": [], "scenes": SCENES}))
        self.assertNotIn("drawing", admin.clean_catalog({"collections": [], "scenes": SCENES, "drawing": {"presets": {"phone": {"drawing": "x"}}}}))

    def test_the_classes_follow_the_shared_table(self):
        # packages/render-pc (device-class.ts, presets.ts) is the table the simulator and the admin page read; this keeps the server's copy equal
        import re
        root = HERE.parents[3] / "packages" / "render-pc" / "src"
        classes_src = (root / "device-class.ts").read_text(encoding="utf-8")
        presets_src = (root / "presets.ts").read_text(encoding="utf-8")
        classes = re.search(r"DEVICE_CLASSES = \[([^\]]+)\]", classes_src).group(1)
        self.assertEqual(tuple(re.findall(r"'([a-z-]+)'", classes)), admin.DEVICE_CLASSES)
        modes = re.search(r"PRESET_DRAWINGS = \[([^\]]+)\]", presets_src).group(1)
        self.assertEqual(tuple(re.findall(r"'([a-z]+)'", modes)), admin.DRAWING_MODES)
        rng = {k: float(v) for k, v in re.findall(r"(PRESET_[A-Z_]+) = ([0-9.]+);", presets_src)}
        self.assertEqual((rng["PRESET_BUDGET_MIN"], rng["PRESET_BUDGET_MAX"]), (admin.PRESET_BUDGET_MIN, admin.PRESET_BUDGET_MAX))
        self.assertEqual((rng["PRESET_SCALE_MIN"], rng["PRESET_SCALE_MAX"]), (admin.PRESET_SCALE_MIN, admin.PRESET_SCALE_MAX))


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = [1_790_000_000.0]
        self.store = admin.CatalogStore(lambda: Path(self.tmp.name), lambda: None, lambda: self.t[0])
        # something live to start from: two scenes, no drawing defaults
        self.store.save_draft({"collections": [], "scenes": SCENES})
        self.store.publish()

    def tearDown(self):
        self.tmp.cleanup()

    def public(self) -> dict:
        got = self.store.public()
        assert got is not None
        return json.loads(got[0])

    def test_nothing_set_nothing_public(self):
        self.assertNotIn("drawing", self.public())
        self.assertFalse(self.store.state()["dirty"])

    def test_draft_changes_nothing_until_publish_and_it_is_a_change(self):
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": FULL})
        st = self.store.state()
        self.assertTrue(st["dirty"])                     # the drawing alone makes the draft differ from what is live
        self.assertEqual(st["draft"]["drawing"], FULL)
        self.assertNotIn("drawing", self.public())      # control: not live yet
        self.t[0] += 1
        self.store.publish()
        self.assertEqual(self.public()["drawing"], FULL)
        self.assertFalse(self.store.state()["dirty"])

    def test_a_client_that_does_not_send_the_key_does_not_wipe_it(self):
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": FULL})
        self.store.save_draft({"collections": [], "scenes": list(reversed(SCENES))})     # the Scenes tab of an older admin page
        self.assertEqual(self.store.draft()["drawing"], FULL)
        self.t[0] += 1
        self.store.publish()
        self.assertEqual(self.public()["drawing"], FULL)
        self.assertEqual([s["id"] for s in self.public()["scenes"]], ["ba7aa29d", "39e63ce9"])
        # a later save without it keeps the live ones too (the draft was made from the live document)
        self.store.discard()
        self.store.save_draft({"collections": [], "scenes": SCENES})
        self.assertEqual(self.store.draft()["drawing"], FULL)
        # control: sending the key empty removes it (the owner's "back to the built-in table")
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": None})
        self.assertNotIn("drawing", self.store.draft())
        self.assertTrue(self.store.state()["dirty"])
        self.t[0] += 1
        self.store.publish()
        self.assertNotIn("drawing", self.public())

    def test_history_restores_the_drawing_with_the_scenes(self):
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": FULL})
        self.t[0] += 1
        with_drawing = self.store.publish()
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": {"presets": {"phone": {"budgetM": 1.25}}}})
        self.t[0] += 1
        self.store.publish()
        self.assertEqual(self.public()["drawing"], {"presets": {"phone": {"budgetM": 1.25}}})
        self.t[0] += 1
        self.store.restore(with_drawing)
        self.assertEqual(self.public()["drawing"], FULL)
        # control: restoring the version from before the defaults existed brings the built-in table back
        first = self.store.history()[-1]["name"]
        self.t[0] += 1
        self.store.restore(first)
        self.assertNotIn("drawing", self.public())
        self.assertEqual(len(self.store.history()), 5)

    def test_the_etag_follows_the_drawing(self):
        _, tag0 = self.store.public()
        self.store.save_draft({"collections": [], "scenes": SCENES, "drawing": FULL})
        self.t[0] += 1
        self.store.publish()
        self.assertNotEqual(self.store.public()[1], tag0)


class Routes(AdminApi):
    """Over HTTP: the admin's draft and publish routes and the public catalogue."""

    def test_draft_publish_and_the_public_payload(self):
        _, cookie, csrf, _ = self.login()
        d = self.state(cookie)["draft"]
        self.assertNotIn("drawing", d)
        self.assertNotIn("drawing", self.public())
        # the editor sends the whole document; a bad value is dropped by the server, a good one is kept
        doc = {"collections": d["collections"], "scenes": d["scenes"], "drawing": {"presets": {"phone": {"drawing": "sorted", "budgetM": 1.5, "renderScale": 0.65, "x": 1}, "tv": {"budgetM": 4}}}}
        st, _, body = self.req("POST", "/api/admin/catalog/draft", {"catalog": doc}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        state = json.loads(body)
        self.assertEqual(state["draft"]["drawing"], {"presets": {"phone": {"drawing": "sorted", "budgetM": 1.5, "renderScale": 0.65}}})
        self.assertTrue(state["dirty"])
        self.assertNotIn("drawing", self.public())      # control: the draft is not public
        st, _, body = self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        pub = self.public()
        self.assertEqual(pub["drawing"], {"presets": {"phone": {"drawing": "sorted", "budgetM": 1.5, "renderScale": 0.65}}})
        # the public document carries nothing else new, and the scenes are untouched
        self.assertEqual(set(pub) - {"defaults"}, {"v", "published", "collections", "scenes", "drawing"})
        self.assertEqual([s["id"] for s in pub["scenes"]], [s["id"] for s in d["scenes"]])
        # the admin's login is required for the editor's routes (control)
        self.assertEqual(self.req("POST", "/api/admin/catalog/draft", {"catalog": doc})[0], 401)

    def test_a_scenes_tab_that_sends_no_drawing_keeps_the_owners_defaults(self):
        _, cookie, csrf, _ = self.login()
        d = self.state(cookie)["draft"]
        full = {"collections": d["collections"], "scenes": d["scenes"], "drawing": FULL}
        self.req("POST", "/api/admin/catalog/draft", {"catalog": full}, cookie=cookie, csrf=csrf)
        old_client = {"collections": d["collections"], "scenes": list(reversed(d["scenes"]))}
        st, _, body = self.req("POST", "/api/admin/catalog/draft", {"catalog": old_client}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(body)["draft"]["drawing"], FULL)


if __name__ == "__main__":
    unittest.main()
    _ = PASSWORD
