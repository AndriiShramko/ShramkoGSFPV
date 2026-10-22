"""The cookieless counter's whitelist (POST /api/e, clean_event in apps/api/server.py) against the clients that
send to it: every event name the simulator's beacon() calls (apps/fly/src) and the landing's track() list
(apps/site/src/lib/track.ts EVENTS) send must be in server.EVENTS, or the API answers 400 and the event is
lost (2026-10-21 audit: scene_switch, walls_switch and refine_done were refused for weeks). Every check has a
negative control that must fire.

Run: python3 -m unittest discover -s apps/api/tests -v
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
FLY_SRC = ROOT / "apps" / "fly" / "src"
SITE_TRACK = ROOT / "apps" / "site" / "src" / "lib" / "track.ts"
# beacon('name' ...) and o.beacon('name' ...); the definition `function beacon(e: string` has no quote
_BEACON = re.compile(r"\bbeacon\(\s*['\"]([a-z_]+)['\"]")


def fly_event_names(root: Path = FLY_SRC) -> set[str]:
    names: set[str] = set()
    for f in root.rglob("*.ts"):
        if f.name.endswith(".test.ts"):
            continue
        names.update(_BEACON.findall(f.read_text(encoding="utf-8")))
    return names


def site_event_names(text: str | None = None) -> set[str]:
    src = SITE_TRACK.read_text(encoding="utf-8") if text is None else text
    m = re.search(r"export const EVENTS = \{(.*?)\} as const", src, re.S)
    return set(re.findall(r"^\s*([a-z_]+):", m.group(1), re.M)) if m else set()


class ClientsMatchWhitelist(unittest.TestCase):
    def test_fly_beacons_are_whitelisted(self):
        names = fly_event_names()
        # the funnel the audit counted in the live log must be found at all (the regex is not blind)
        self.assertTrue({"scene_open", "scene_loaded", "input_connected", "arm", "crash", "scene_switch", "walls_switch", "refine_done"} <= names, names)
        missing = names - set(server.EVENTS)
        self.assertEqual(missing, set(), f"beacon() names the API refuses: {sorted(missing)}")
        # control: a name the API does not know is reported
        self.assertEqual((names | {"made_up_event"}) - set(server.EVENTS), {"made_up_event"})

    def test_site_events_are_whitelisted(self):
        names = site_event_names()
        self.assertTrue({"lang_switch", "cta_click", "scene_open", "fly_click", "page_view"} <= names, names)
        self.assertEqual(names - set(server.EVENTS), set())
        # control: the parser reads a list it is given, not a constant
        self.assertEqual(site_event_names("export const EVENTS = {\n  foo_bar: [\"\"],\n} as const"), {"foo_bar"})


class CleanEvent(unittest.TestCase):
    def test_scene_switch_kept_with_its_properties(self):
        rec = server.clean_event({"e": "scene_switch", "p": {"reason": "next", "has_collision": True, "load_ms_bucket": 4}})
        self.assertIsNotNone(rec)
        self.assertEqual(rec["p"], {"reason": "next", "has_collision": True, "load_ms_bucket": 4})
        # control: a reason outside SceneSwitchReason is dropped, the event itself stays
        self.assertEqual(server.clean_event({"e": "scene_switch", "p": {"reason": "<script>"}})["p"], {})

    def test_walls_switch_and_refine_done(self):
        self.assertEqual(server.clean_event({"e": "walls_switch", "p": {"on": False}})["p"], {"on": False})
        self.assertEqual(server.clean_event({"e": "refine_done", "p": {"cm": "2.5"}})["p"], {"cm": 2.5})
        self.assertEqual(server.clean_event({"e": "refine_done", "p": {"cm": 10}})["p"], {"cm": 10.0})
        # controls: text that is not a small number, a bool and an out-of-range value are dropped
        for bad in ("2.5cm", "abc", True, 5000, "-1"):
            self.assertEqual(server.clean_event({"e": "refine_done", "p": {"cm": bad}})["p"], {}, bad)

    def test_landing_page_view(self):
        self.assertEqual(server.clean_event({"e": "page_view", "p": "pl"})["p"], {"locale": "pl"})
        self.assertEqual(server.clean_event({"e": "page_view", "p": "xx"})["p"], {})

    def test_unknown_event_refused(self):
        self.assertIsNone(server.clean_event({"e": "made_up_event", "p": {}}))


if __name__ == "__main__":
    unittest.main()
