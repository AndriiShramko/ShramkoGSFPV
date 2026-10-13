"""The turbo-stream decoder (apps/api/turbostream.py) on an answer recorded from superspl.at on 2026-10-13
(fixtures/superspl-scene-0230d903.data.txt, the owner's own scene) and on broken input. Every check has a
negative control that must fire."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import turbostream  # noqa: E402

RECORDED = (HERE.parent / "fixtures" / "superspl-scene-0230d903.data.txt").read_text(encoding="utf-8")


class Decode(unittest.TestCase):
    def test_recorded_scene(self):
        data = turbostream.find_route(turbostream.decode(RECORDED), "routes/scene")
        splat = data["splat"]
        self.assertEqual(splat["hash"], "0230d903")
        self.assertEqual(splat["title"], "Muster Truck Show Opole Poland 2024")
        self.assertEqual(splat["format"], "ssog")
        self.assertEqual(splat["size"], 1559018582)
        self.assertEqual(splat["downloads"], {"enabled": True, "license": "by"})
        self.assertEqual(splat["createdAt"], turbostream.Date(1791379889210))
        self.assertIsNone(splat["voxelTask"])
        self.assertEqual(data["user"]["username"], "andriishramko")
        self.assertEqual(data["user"]["fullName"], "Andrii Shramko")
        self.assertEqual(len(splat["lodCounts"]), 10)
        # control: read as plain JSON the same line is only references: the title is nowhere as a value of "title"
        raw = json.loads(RECORDED.split("\n", 1)[0])
        self.assertFalse(any(isinstance(x, dict) and x.get("title") == "Muster Truck Show Opole Poland 2024" for x in raw))

    def test_shared_values_and_constants(self):
        doc = '[{"_1":2,"_3":2,"_4":-5,"_5":-7,"_6":7},"a","same","b","n","u","d",["D",86400000]]'
        self.assertEqual(turbostream.decode(doc), {"a": "same", "b": "same", "n": None, "u": None, "d": turbostream.Date(86400000)})

    def test_broken_input_is_refused_not_crashed(self):
        for bad in ("<!doctype html>", "[]", "{}", '[{"_1":99},"a"]', '[{"x":1},"a"]', '[[5]]'):
            with self.assertRaises(turbostream.BadStream, msg=bad):
                turbostream.decode(bad)
        # a value that contains itself is the same object again, not followed forever
        me = turbostream.decode('[{"_1":0},"me"]')
        self.assertIs(me["me"], me)
        loop = turbostream.decode('[[0]]')
        self.assertIs(loop[0], loop)
        # control: a well-formed stream decodes
        self.assertEqual(turbostream.decode('[{"_1":2},"k","v"]'), {"k": "v"})


if __name__ == "__main__":
    unittest.main()
