"""The roadmap seed (apps/api/locales/roadmap-seed.json, docs/wip/v07-c.md): the landing's status list as
lane B's ideas store loads it once into an empty store. Checked against the contract of docs/wip/v07-plan.md
(plus the optional landing group): format version, ids, kinds, statuses, a title in all four languages,
a unique order. Under locales/ because the titles carry Polish and Russian letters (B18). Every rule has a
negative control: a broken copy of the seed must be refused for exactly that reason.

One limit for a public title (240) and one for a public text (600) wherever they pass: this contract, the
admin card (apps/fly/src/admin/ideas/api.ts PUBLIC_TITLE_MAX), the landing's parser (apps/site/src/lib/
roadmap.ts TITLE_MAX, TEXT_MAX) and lane B's store (ideas.TITLE_MAX, ideas.PUBLIC_TEXT_MAX). A store that
cut titles shorter would show the live landing cut mid-word while the static page shows them whole.

Merge guards (SeedInLaneBStore): skipped while lane B's store (apps/api/ideas.py) is not on the branch,
they run from the v0.7 merge on and fail until the store takes every seed item unchanged and the server
finds this seed by default (it looked for apps/api/roadmap-seed.json; the seed is under locales/ for B18)."""
from __future__ import annotations

import copy
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

API = Path(__file__).resolve().parents[1]
REPO = API.parents[1]
SEED = API / "locales" / "roadmap-seed.json"
LANGS = ("en", "es", "pl", "ru")
STATUSES = ("done", "in_progress", "accepted")
GROUPS = ("radio", "controls", "drone", "crash", "camera", "scenes", "walls", "settings")
ID_RE = re.compile(r"F-[a-z0-9]+(?:-[a-z0-9]+)*")
TITLE_MAX = 240  # the longest landing line today is 211 characters (es, scene scale)
TEXT_MAX = 600  # a public text under a title (lane B's ideas.PUBLIC_TEXT_MAX)
CARD_TS = REPO / "apps" / "fly" / "src" / "admin" / "ideas" / "api.ts"
LANDING_TS = REPO / "apps" / "site" / "src" / "lib" / "roadmap.ts"


def ts_const(source: str, name: str) -> int | None:
    """The number of `export const NAME = <n>;` in a TypeScript source, or None."""
    m = re.search(rf"^export const {name} = (\d+);", source, re.M)
    return int(m.group(1)) if m else None


def seed_problems(doc) -> list[str]:
    """Everything that breaks the seed contract; empty when the seed is sound."""
    if not isinstance(doc, dict) or doc.get("v") != 1 or not isinstance(doc.get("items"), list):
        return ["not a v1 seed"]
    out: list[str] = []
    ids: set[str] = set()
    orders: set[int] = set()
    for n, it in enumerate(doc["items"]):
        where = it.get("id", f"#{n}") if isinstance(it, dict) else f"#{n}"
        if not isinstance(it, dict):
            out.append(f"{where}: not an object")
            continue
        extra = set(it) - {"id", "kind", "status", "title", "order", "group"}
        if extra:
            out.append(f"{where}: unknown fields {sorted(extra)}")
        if not isinstance(it.get("id"), str) or not ID_RE.fullmatch(it["id"]) or len(it["id"]) > 64:
            out.append(f"{where}: id")
        elif it["id"] in ids:
            out.append(f"{where}: duplicate id")
        else:
            ids.add(it["id"])
        if it.get("kind") != "feature":
            out.append(f"{where}: kind")
        if it.get("status") not in STATUSES:
            out.append(f"{where}: status")
        if "group" in it and it["group"] not in GROUPS:
            out.append(f"{where}: group")
        order = it.get("order")
        if not isinstance(order, int) or isinstance(order, bool) or order < 1:
            out.append(f"{where}: order")
        elif order in orders:
            out.append(f"{where}: duplicate order")
        else:
            orders.add(order)
        title = it.get("title")
        if not isinstance(title, dict) or set(title) != set(LANGS):
            out.append(f"{where}: title languages")
        else:
            for lang in LANGS:
                s = title[lang]
                if not isinstance(s, str) or not s.strip() or len(s) > TITLE_MAX or s != s.strip():
                    out.append(f"{where}: title.{lang}")
            if any(title[lang] == title["en"] for lang in LANGS[1:]):
                out.append(f"{where}: an untranslated title")
    return out


class RoadmapSeed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads(SEED.read_text(encoding="utf-8"))

    def test_seed_keeps_the_contract(self):
        self.assertEqual(seed_problems(self.doc), [])

    def test_seed_is_the_landing_list(self):
        items = self.doc["items"]
        by = {s: [i for i in items if i["status"] == s] for s in STATUSES}
        # the landing on 13 October 2026: 51 live, 1 in progress, 1 next (live -> done, progress ->
        # in_progress, next -> accepted)
        self.assertEqual({s: len(v) for s, v in by.items()}, {"done": 51, "in_progress": 1, "accepted": 1})
        self.assertEqual([i["order"] for i in items], list(range(1, len(items) + 1)))
        self.assertEqual(items[0]["title"]["en"], "EdgeTX radio over USB (WebHID) in Chrome or Edge")
        self.assertEqual(sorted({i["group"] for i in by["done"]}), sorted(GROUPS))

    def test_every_rule_fires(self):
        """Negative controls: one broken copy per rule, each refused for its own reason."""
        def broken(change) -> list[str]:
            d = copy.deepcopy(self.doc)
            change(d["items"][0], d)
            return seed_problems(d)

        first = self.doc["items"][0]["id"]
        cases = {
            "status": lambda it, d: it.update(status="planned"),
            "kind": lambda it, d: it.update(kind="idea"),
            "id": lambda it, d: it.update(id="R-20261006-0001"),
            "group": lambda it, d: it.update(group="physics"),
            "order": lambda it, d: it.update(order=0),
            "title languages": lambda it, d: it["title"].pop("pl"),
            "title.ru": lambda it, d: it["title"].update(ru=" "),
            "an untranslated title": lambda it, d: it["title"].update(es=it["title"]["en"]),
            "unknown fields": lambda it, d: it.update(contact="pilot@example.com"),
        }
        for why, change in cases.items():
            with self.subTest(why=why):
                self.assertTrue(any(p.startswith(f"{first}: {why}") or p.startswith(f"R-20261006-0001: {why}") for p in broken(change)),
                                broken(change))
        dup = copy.deepcopy(self.doc)
        dup["items"][1]["id"] = first
        self.assertIn(f"{first}: duplicate id", seed_problems(dup))
        self.assertEqual(seed_problems({"v": 2, "items": []}), ["not a v1 seed"])


class OneLimit(unittest.TestCase):
    """The admin card and the landing take the same title and text limits as this contract."""

    def test_the_card_and_the_landing_use_the_contract_limits(self):
        card, landing = CARD_TS.read_text(encoding="utf-8"), LANDING_TS.read_text(encoding="utf-8")
        self.assertEqual((ts_const(card, "PUBLIC_TITLE_MAX"), ts_const(landing, "TITLE_MAX"), ts_const(landing, "TEXT_MAX")),
                         (TITLE_MAX, TITLE_MAX, TEXT_MAX))

    def test_a_changed_or_missing_limit_is_caught(self):
        """Control: the same source with another number, or without the constant, does not pass."""
        card = CARD_TS.read_text(encoding="utf-8")
        self.assertEqual(ts_const(card.replace(f"PUBLIC_TITLE_MAX = {TITLE_MAX};", "PUBLIC_TITLE_MAX = 140;"), "PUBLIC_TITLE_MAX"), 140)
        self.assertIsNone(ts_const(card, "NO_SUCH_LIMIT"))


@unittest.skipUnless((API / "ideas.py").is_file(), "lane B's ideas store (apps/api/ideas.py) is not on this branch yet: runs from the v0.7 merge on")
class SeedInLaneBStore(unittest.TestCase):
    """Merge guards: the seed reaches the store, and from it the live landing, exactly as written here."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(API))
        import ideas  # noqa: PLC0415 (lane B's module, present only after the merge)
        cls.ideas = ideas
        cls.doc = json.loads(SEED.read_text(encoding="utf-8"))

    def test_the_store_uses_the_same_limits(self):
        self.assertEqual((self.ideas.TITLE_MAX, self.ideas.PUBLIC_TEXT_MAX), (TITLE_MAX, TEXT_MAX),
                         "lane B's ideas.TITLE_MAX / PUBLIC_TEXT_MAX must be the contract's (docs/wip/v07-c.md)")

    def test_every_seed_item_loads_unchanged(self):
        stamp = "2026-10-13T00:00:00Z"
        changed = []
        for n, it in enumerate(self.doc["items"]):
            rec = self.ideas.record_from_seed(it, n, stamp)
            if rec is None:
                changed.append(f"{it['id']}: refused")
                continue
            for lang in LANGS:
                if rec["public"]["title"].get(lang) != it["title"][lang]:
                    changed.append(f"{it['id']}: title.{lang} {len(it['title'][lang])} -> {len(rec['public']['title'].get(lang, ''))}")
            if (rec["kind"], rec["status"], rec["order"]) != ("feature", it["status"], it["order"]):
                changed.append(f"{it['id']}: kind/status/order")
        self.assertEqual(changed, [])
        # control: a title over the limit does not come through unchanged
        long = copy.deepcopy(self.doc["items"][0])
        long["title"]["en"] = "x" * (TITLE_MAX + 1)
        rec = self.ideas.record_from_seed(long, 0, stamp)
        self.assertTrue(rec is None or rec["public"]["title"].get("en") != long["title"]["en"])

    def test_the_server_finds_the_shipped_seed(self):
        import server  # noqa: PLC0415
        with mock.patch.dict(os.environ):
            os.environ.pop("ROADMAP_SEED", None)
            found = server.IDEAS.seed()
        self.assertIsNotNone(found, "server.py finds no seed by default: point it at apps/api/locales/roadmap-seed.json")
        self.assertEqual(Path(found).resolve(), SEED.resolve())
        # control: the check reads the server's own lookup (an override is followed)
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / "seed.json"
            other.write_text('{"v": 1, "items": []}', encoding="utf-8")
            with mock.patch.dict(os.environ, {"ROADMAP_SEED": str(other)}):
                self.assertEqual(Path(server.IDEAS.seed()).resolve(), other.resolve())


if __name__ == "__main__":
    unittest.main()
