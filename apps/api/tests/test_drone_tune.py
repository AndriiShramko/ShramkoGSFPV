"""Tests of the drone-physics report (POST /api/report with kind "drone", v0.8, docs/wip/v08-d.md): a pilot
who flies one of the presets for real sends the drone, a blackbox log's link and, as text, the Betaflight
`diff all` and their simulator settings for that drone. Stored like a bug's technical details, an idea in
the ideas store whose text names the drone, and the whole report in the owner's chat.

Run: python3 -m unittest discover -s apps/api/tests -v (stdlib only, no network: the Api base of
test_feedback.py records Telegram). Every check has a negative control that must fire.
"""
from __future__ import annotations

import gzip
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ideas  # noqa: E402
import ownerbot  # noqa: E402
import server  # noqa: E402
from test_feedback import Api  # noqa: E402

DIFF = "# diff all\n# version\n# Betaflight / STM32F7X2 (S7X2) 4.5.1\n\nprofile 0\nset p_roll = 52\nset d_roll = 44\n\nrateprofile 0\nset roll_srate = 80\n"


class DroneTune(Api):
    def drone(self, **over) -> tuple[int, dict]:
        b = {"kind": "drone", "message": "Hover throttle feels lower than on my real one.", "contact": "pilot@example.com",
             "locale": "pl", "page": "fly", "scene": "39e63ce9", "release": "608259b", "t": 9000, "hp": "",
             "drone": "nazgulf5v3-6s", "betaflight": DIFF, "logUrl": "https://drive.example.com/file/d/abc/view",
             "settings": {"physics.twr": 7.5, "tune.rates": {"type": "ACTUAL"}}}
        b.update(over)
        s, raw, _ = self.call("POST", "/api/report", {k: v for k, v in b.items() if v is not None})
        return s, json.loads(raw) if raw else {}

    def idea(self, rid: str) -> dict:
        return next(r for r in server.IDEAS.read()["ideas"] if r["id"] == rid)

    def test_stored_with_its_file_an_idea_and_the_owner_chat(self):
        s, b = self.drone()
        self.assertEqual((s, b["ok"], b["diagnostics"]), (200, True, True))
        rec = self.records()[-1]
        self.assertEqual((rec["kind"], rec["drone"], rec["logUrl"]), ("drone", "nazgulf5v3-6s", "https://drive.example.com/file/d/abc/view"))
        # the bulky part is in the technical-details file, never in reports.jsonl
        self.assertNotIn("set p_roll", server.REPORTS_FILE.read_text(encoding="utf-8"))
        tune = json.loads((server.REPORTS_DIR / f"{b['id']}.json").read_text(encoding="utf-8"))["diagnostics"]["tune"]
        self.assertEqual(tune["drone"], "nazgulf5v3-6s")
        self.assertEqual(tune["betaflight"], DIFF.strip())
        self.assertEqual(tune["settings"], {"physics.twr": 7.5, "tune.rates": {"type": "ACTUAL"}})
        # the owner's chat: the drone and the log in the text, the file as a document
        text, stored = self.sent[-1]
        self.assertTrue(stored)
        self.assertIn("Drone: nazgulf5v3-6s", text)
        self.assertIn("Blackbox log: https://drive.example.com/file/d/abc/view", text)
        self.assertIn("Diagnostics: attached", text)
        self.assertNotIn("Page errors", text)  # a tune file has no page facts
        self.assertTrue(any(c[0] == "sendDocument" and b["id"].encode() in c[2] and b"set p_roll" in c[2] for c in self.tg_calls), [c[0] for c in self.tg_calls])
        # the idea: its text starts with what the owner needs at a glance, then the pilot's words
        idea = self.idea(b["id"])
        self.assertEqual(idea["kind"], "idea")
        self.assertTrue(idea["text"].startswith("Drone physics: nazgulf5v3-6s\nBlackbox log: https://drive.example.com/file/d/abc/view\n"), idea["text"])
        self.assertTrue(idea["text"].endswith("Hover throttle feels lower than on my real one."))
        self.assertIs(idea["diagnostics"], True)
        self.assertEqual(idea["email"], "pilot@example.com")

    def test_control_an_idea_keeps_none_of_the_drone_fields(self):
        s, b = self.drone(kind="idea")
        self.assertEqual((s, b["diagnostics"]), (200, False))
        rec = self.records()[-1]
        self.assertNotIn("drone", rec)
        self.assertNotIn("logUrl", rec)
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))
        self.assertFalse(self.idea(b["id"])["text"].startswith("Drone physics"))

    def test_a_new_drone_and_no_text(self):
        s, b = self.drone(drone="new", betaflight=None, settings=None, logUrl=None, message="Please add the GEPRC Mark5.")
        self.assertEqual((s, b["diagnostics"]), (200, False))
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))
        self.assertEqual(self.idea(b["id"])["text"], "Drone physics: a drone that is not in the list\n\nPlease add the GEPRC Mark5.")
        # control: with the text pasted it is in the file and the idea says so
        s, b = self.drone(drone="new")
        self.assertIn("in the technical details file", self.idea(b["id"])["text"])

    def test_whitelist(self):
        bad = {"drone": "../../etc/passwd", "logUrl": "javascript:alert(1)"}
        s, b = self.drone(**bad)
        self.assertEqual(s, 200)
        rec = self.records()[-1]
        self.assertEqual((rec["drone"], rec["logUrl"]), ("", ""))
        for url in ("ftp://example.com/log.bbl", "https://exa mple.com/x", "https://x", "https://e.com/" + "a" * 600, 42):
            self.drone(logUrl=url)
            self.assertEqual(self.records()[-1]["logUrl"], "", url)
        # control characters go, new lines stay; a non-string text is no text; oversized settings are dropped
        s, b = self.drone(betaflight="set a = 1\x00\x1b[31m\nset b = 2‮", settings={"x": "y" * (9 * 1024)})
        tune = json.loads((server.REPORTS_DIR / f"{b['id']}.json").read_text(encoding="utf-8"))["diagnostics"]["tune"]
        self.assertEqual(tune["betaflight"], "set a = 1[31m\nset b = 2")
        self.assertNotIn("settings", tune)
        s, b = self.drone(betaflight=["not", "text"], settings=None)
        self.assertEqual(b["diagnostics"], False)
        # control: clean values are kept as sent
        self.drone(drone="taurusx8-komodo-6s", logUrl="http://logs.example.org/a.bbl?dl=1")
        self.assertEqual((self.records()[-1]["drone"], self.records()[-1]["logUrl"]), ("taurusx8-komodo-6s", "http://logs.example.org/a.bbl?dl=1"))

    def test_size(self):
        # the pasted text has its own limit (100 000 characters), not the 8 KB of the rest of the body
        long = ("set something = 1\n" * 6000)[: 120_000]
        s, b = self.drone(betaflight=long)
        self.assertEqual(s, 200)
        tune = json.loads((server.REPORTS_DIR / f"{b['id']}.json").read_text(encoding="utf-8"))["diagnostics"]["tune"]
        self.assertEqual(len(tune["betaflight"]), server.DRONE_TUNE_TEXT_MAX)
        # gzipped, as the simulator sends a big body
        body = gzip.compress(json.dumps({"kind": "drone", "message": "m", "t": 9000, "drone": "machr5sport-6s", "betaflight": long}).encode())
        s, raw, _ = self.call("POST", "/api/report", body, headers={"Content-Encoding": "gzip"})
        self.assertEqual((s, json.loads(raw)["diagnostics"]), (200, True))
        # control: any other field still counts toward the 8 KB
        self.assertEqual(self.drone(extra="x" * 9000)[0], 413)

    def test_suspect_keeps_no_file(self):
        self.drone(hp="http://spam.example")
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))
        self.assertEqual(len(self.sent), 0)
        # control: the same report from a person keeps its file and is sent
        self.drone()
        self.assertTrue(any(server.REPORTS_DIR.iterdir()))
        self.assertEqual(len(self.sent), 1)


class Units(unittest.TestCase):
    def test_header_and_bot_facts(self):
        self.assertEqual(ideas.drone_header({"drone": "machr5sport-6s", "logUrl": "", "diagnostics": False}), "Drone physics: machr5sport-6s")
        self.assertEqual(ideas.drone_header({}), "Drone physics: drone not given")
        tune = json.dumps({"id": "R-1", "diagnostics": {"tune": {"betaflight": "x"}}}).encode()
        self.assertEqual(ownerbot.diag_facts(tune), {})
        # control: a bug's file still gives its facts
        bug = json.dumps({"id": "R-2", "diagnostics": {"browser": {"userAgent": "UA"}, "errors": ["e"]}}).encode()
        self.assertEqual(ownerbot.diag_facts(bug)["browser"], "UA")
        # a report of another kind is an idea of its own kind; a drone report is an idea
        self.assertEqual(ideas.record_from_report({"id": "R-20261016-0001", "kind": "drone", "message": "m", "drone": "x"})["kind"], "idea")
        self.assertEqual(ideas.record_from_report({"id": "R-20261016-0002", "kind": "bug", "message": "m"})["kind"], "bug")


if __name__ == "__main__":
    unittest.main()
