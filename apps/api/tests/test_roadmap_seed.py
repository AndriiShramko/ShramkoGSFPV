"""The roadmap seed (apps/api/locales/roadmap-seed.json, docs/wip/v07-c.md): the landing's status list as
lane B's ideas store loads it once into an empty store. Checked against the contract of docs/wip/v07-plan.md
(plus the optional landing group): format version, ids, kinds, statuses, a title in all four languages,
a unique order. Under locales/ because the titles carry Polish and Russian letters (B18). Every rule has a
negative control: a broken copy of the seed must be refused for exactly that reason."""
from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[1] / "locales" / "roadmap-seed.json"
LANGS = ("en", "es", "pl", "ru")
STATUSES = ("done", "in_progress", "accepted")
GROUPS = ("radio", "controls", "drone", "crash", "camera", "scenes", "walls", "settings")
ID_RE = re.compile(r"F-[a-z0-9]+(?:-[a-z0-9]+)*")
TITLE_MAX = 240  # the longest landing line today is 211 characters (es, scene scale)


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


if __name__ == "__main__":
    unittest.main()
