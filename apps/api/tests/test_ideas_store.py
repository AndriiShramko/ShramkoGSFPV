"""The ideas store (apps/api/ideas.py): migration from reports.jsonl without losing a report, durable
writes, the lock between the API and the CLI, the roadmap seed loaded once, the work queue's order, and
a public roadmap that never carries a pilot's words or contact.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only, no network). Every check has a
negative control that must fire.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import ideas  # noqa: E402
from fakes import World  # noqa: E402

PRIVATE = ("pilot@example.com", "secret words of the pilot", "a comment only for the agent", "Telegram @pilotx")


def leaks(body: bytes, needles=PRIVATE) -> list[str]:
    """Private strings found in a public body (the roadmap's privacy check)."""
    text = body.decode("utf-8")
    return [n for n in needles if n in text]


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.w = World(self.d)

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def lines(self, *recs: dict) -> None:
        with self.w.reports.open("a", encoding="utf-8") as f:
            for r in recs:
                f.write((r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)) + "\n")


class Migration(StoreTest):
    def test_every_report_becomes_an_idea_and_nothing_changes_the_visitors_file(self):
        base = {"ts": "2026-10-01T10:00:00Z", "site": "gsfpv", "page": "fly", "locale": "pl", "scene": "39e63ce9",
                "release": "608259b", "suspect": False, "diagnostics": False, "diagBytes": 0}
        self.lines({**base, "id": "R-20261001-0001", "kind": "bug", "message": "falls through", "contact": "Telegram @x or a@b.cd"},
                   {**base, "id": "R-20261001-0002", "kind": "idea", "message": "rain", "contact": "@pilot"},
                   "{not json",
                   {**base, "id": "R-20261001-0003", "kind": "idea", "message": "bot", "contact": "", "suspect": True})
        (self.d / "report-status.json").write_text(json.dumps({"R-20261001-0002": {"status": "closed", "ts": "2026-10-02T00:00:00Z"}}), encoding="utf-8")
        before = self.w.reports.read_bytes()
        doc = self.w.store.read()
        got = {r["id"]: r for r in doc["ideas"]}
        self.assertEqual(sorted(got), ["R-20261001-0001", "R-20261001-0002", "R-20261001-0003"])
        self.assertEqual((got["R-20261001-0001"]["email"], got["R-20261001-0001"]["contactKind"]), ("a@b.cd", "email"))
        self.assertEqual((got["R-20261001-0002"]["contactKind"], got["R-20261001-0002"]["status"]), ("other", "done"))
        self.assertEqual(got["R-20261001-0001"]["status"], "new")
        self.assertTrue(got["R-20261001-0003"]["suspect"])
        self.assertEqual(doc["meta"]["migratedReports"], 3)
        self.assertEqual(self.w.reports.read_bytes(), before)
        # a report stored while the store could not be written: the next sync() picks it up, once
        self.lines({**base, "id": "R-20261003-0001", "kind": "idea", "message": "later", "contact": ""})
        self.assertEqual(self.w.store.sync(), 1)
        self.assertEqual(self.w.store.sync(), 0)
        # control: an idea lost from the store is noticed by the same check and restored by sync()
        with self.w.store.tx() as doc:
            doc["ideas"] = [r for r in doc["ideas"] if r["id"] != "R-20261001-0002"]
        ids = {json.loads(x)["id"] for x in self.w.reports.read_text(encoding="utf-8").splitlines() if x.startswith("{\"")}
        self.assertEqual(ids - {r["id"] for r in self.w.store.read()["ideas"]}, {"R-20261001-0002"})
        self.w.store.sync()
        self.assertEqual(ids - {r["id"] for r in self.w.store.read()["ideas"]}, set())

    def test_write_is_whole_or_nothing(self):
        self.w.report()
        good = self.w.store.path().read_bytes()
        with mock.patch.object(ideas.os, "replace", side_effect=OSError("disk gone")):
            with self.assertRaises(OSError):
                self.w.service.add_note("a note", "admin")
        self.assertEqual(self.w.store.path().read_bytes(), good)  # the old file, whole
        json.loads(good)
        # control: the same write without the failure changes the file
        self.w.service.add_note("a note", "admin")
        self.assertNotEqual(self.w.store.path().read_bytes(), good)

    def test_the_cli_and_the_api_take_turns(self):
        """A second process holding the lock (the CLI) makes the API's write wait for it."""
        self.w.report()
        code = ("import sys,time; sys.path.insert(0, sys.argv[1]); import ideas, pathlib;"
                "cm = ideas.file_lock(pathlib.Path(sys.argv[2]) / 'ideas.lock'); cm.__enter__();"
                "print('locked', flush=True); time.sleep(1.5); cm.__exit__(None, None, None)")

        def timed_write() -> float:
            with subprocess.Popen([sys.executable, "-c", code, str(HERE.parent), str(self.d)], stdout=subprocess.PIPE, text=True) as p:
                self.assertEqual(p.stdout.readline().strip(), "locked")
                t0 = time.monotonic()
                self.w.service.add_note("while locked", "admin")
                took = time.monotonic() - t0
                p.wait(10)
            return took

        self.assertGreater(timed_write(), 0.9)
        # control: without the file lock the write does not wait
        with mock.patch.object(ideas, "file_lock", lambda path: nullcontext()):
            self.assertLess(timed_write(), 0.5)


class Seed(StoreTest):
    def seed(self, n: int) -> Path:
        p = self.d / "roadmap-seed.json"
        items = [{"id": f"F-item-{i}", "kind": "feature", "status": ["done", "in_progress", "accepted"][i % 3],
                  "title": {"en": f"Feature {i}", "es": f"Funcion {i}", "pl": f"Funkcja {i}", "ru": f"F {i}"}, "order": i} for i in range(n)]
        p.write_text(json.dumps({"v": 1, "items": items}), encoding="utf-8")
        return p

    def test_loaded_once_into_an_empty_roadmap(self):
        self.w.seed_path = self.seed(3)
        features = [r for r in self.w.store.read()["ideas"] if r["kind"] == "feature"]
        self.assertEqual([r["id"] for r in features], ["F-item-0", "F-item-1", "F-item-2"])
        self.assertEqual(features[0]["status"], "done")
        # a later, longer seed is not loaded again
        self.w.seed_path = self.seed(5)
        self.w.store.sync()
        self.assertEqual(len([r for r in self.w.store.read()["ideas"] if r["kind"] == "feature"]), 3)

    def test_a_store_with_features_is_never_seeded(self):
        self.w.service.add_note("the owner's own feature", "admin", kind="feature", public_title={"en": "Own"})
        self.w.seed_path = self.seed(3)
        self.w.store.sync()
        self.assertEqual([r["id"].startswith("F-item") for r in self.w.store.read()["ideas"]], [False])
        # control: a fresh store with the same seed takes it
        other = World(self.d / "fresh")
        (self.d / "fresh").mkdir()
        other.seed_path = self.w.seed_path
        try:
            self.assertEqual(len(other.store.read()["ideas"]), 3)
        finally:
            other.close()


class Queue(StoreTest):
    def test_most_urgent_first_and_only_with_an_urgency(self):
        s = self.w.service
        made = {}
        for name, status, urg in (("low-acc", "accepted", "low"), ("urg-acc", "accepted", "urgent"), ("high-prog", "in_progress", "high"),
                                  ("high-acc", "accepted", "high"), ("none-acc", "accepted", None), ("new-urg", "new", "urgent"),
                                  ("rej-urg", "rejected", "urgent")):
            rid = s.add_note(name, "admin")["id"]
            self.w.now[0] += 1
            s.set_status(rid, status, "admin")
            s.set_urgency(rid, urg, "admin")
            made[rid] = name
        work, waiting = s.queue()
        self.assertEqual([made[r["id"]] for r in work], ["urg-acc", "high-prog", "high-acc", "low-acc"])
        self.assertEqual([made[r["id"]] for r in waiting], ["none-acc"])
        # control: the order does not come from the order of creation
        doc = json.loads(self.w.store.path().read_text(encoding="utf-8"))
        doc["ideas"].reverse()
        self.assertEqual([made[r["id"]] for r in ideas.work_queue(doc)[0]], ["urg-acc", "high-prog", "high-acc", "low-acc"])


class Roadmap(StoreTest):
    def test_public_items_only_our_words(self):
        s = self.w.service
        a = self.w.report(rid="R-20261013-0001", message="secret words of the pilot", contact="pilot@example.com")
        s.add_comment(a["id"], "a comment only for the agent", "telegram")
        s.set_status(a["id"], "accepted", "telegram")
        s.set_public(a["id"], "agent", title={"en": "Rain in the scenes", "pl": "Deszcz"}, text={"en": "Weather on the scans"})
        b = self.w.report(rid="R-20261013-0002", message="secret words of the pilot", contact="Telegram @pilotx")
        s.set_public(b["id"], "agent", title={"en": "Not accepted yet"})            # new: not on the roadmap
        c = self.w.report(rid="R-20261013-0003", message="secret words of the pilot")
        s.set_status(c["id"], "done", "admin")
        s.link_release(c["id"], "1a2b3c4", "agent")
        s.set_public(c["id"], "agent", title={"en": "Shipped"})
        d = s.add_note("no title yet", "telegram")
        s.set_status(d["id"], "in_progress", "telegram")                              # no English title: hidden
        e = s.add_note("hidden one", "telegram")
        s.set_status(e["id"], "accepted", "admin")
        s.set_public(e["id"], "admin", title={"en": "Hidden"}, visible=False)
        st, body, h = self.w.store.public_roadmap(None)
        self.assertEqual(st, 200)
        doc = json.loads(body)
        self.assertEqual(doc["v"], 1)
        items = {x["id"]: x for x in doc["items"]}
        self.assertEqual(sorted(items), ["R-20261013-0001", "R-20261013-0003"])
        self.assertEqual(items["R-20261013-0001"], {"id": "R-20261013-0001", "kind": "idea", "status": "planned",
                                                    "title": {"en": "Rain in the scenes", "pl": "Deszcz"},
                                                    "text": {"en": "Weather on the scans"}, "fromPilot": True})
        self.assertEqual((items["R-20261013-0003"]["status"], items["R-20261013-0003"]["release"]), ("done", "1a2b3c4"))
        self.assertIn("done", items["R-20261013-0003"])
        self.assertEqual(leaks(body), [])
        # control: the leak check fires on a body that carries the record as it is stored
        self.assertEqual(len(leaks(json.dumps(self.w.store.read(), ensure_ascii=False).encode())), 4)
        # ETag and 304; a change gives a new tag
        st, b2, _ = self.w.store.public_roadmap(h[2][1])
        self.assertEqual((st, b2), (304, b""))
        s.set_public(e["id"], "admin", visible=True)
        st, b3, h3 = self.w.store.public_roadmap(h[2][1])
        self.assertEqual(st, 200)
        self.assertNotEqual(h3[2][1], h[2][1])
        self.assertIn("Hidden", b3.decode())


if __name__ == "__main__":
    unittest.main()
