"""v0.7 catalogue fields in clean_scene (admin.py _place_fields; packages/scenes/src/catalog.ts keeps the
same rules): kept in range, dropped out of range, never anything unknown."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import admin  # noqa: E402

BASE = {"id": "70b50d42", "title": "Wroclaw Cathedral"}


class PlaceFields(unittest.TestCase):
    def test_kept_in_range(self):
        s = admin.clean_scene({**BASE, "geo": {"lat": 51.11412, "lon": 17.0461, "place": "Wroclaw, Poland"}, "compassDeg": 90,
                               "wind": {"fromDeg": 270, "speed": 4.5, "gust": 2, "source": "climate"}, "ceilingM": 35,
                               "render": {"budgetM": 8, "stochastic": True}, "about": {"en": "Fly between the towers", "xx": "no"},
                               "origin": {"url": "https://superspl.at/scene/70b50d42", "description": "A scan", "tags": ["church", 5, ""],
                                          "created": "2026-09-30", "user": "andriishramko"}})
        self.assertEqual(s["geo"], {"lat": 51.114, "lon": 17.046, "place": "Wroclaw, Poland"})
        self.assertEqual(s["compassDeg"], 90)
        self.assertEqual(s["wind"], {"fromDeg": 270, "speed": 4.5, "gust": 2, "source": "climate"})
        self.assertEqual(s["ceilingM"], 35)
        self.assertEqual(s["render"], {"budgetM": 8, "stochastic": True})
        self.assertEqual(s["about"], {"en": "Fly between the towers"})
        self.assertEqual(s["origin"], {"url": "https://superspl.at/scene/70b50d42", "description": "A scan", "tags": ["church"], "created": "2026-09-30",
                                           "user": "andriishramko"})
        # control: a user name with markup is dropped, the rest of the origin stays
        bad = admin.clean_scene({**BASE, "origin": {"url": "https://superspl.at/scene/70b50d42", "user": "<b>x</b>"}})
        self.assertEqual(bad["origin"], {"url": "https://superspl.at/scene/70b50d42"})

    def test_render_is_three_valued(self):
        # v0.9: stochastic is the desktop default, so "sorted" (False) is a choice the owner keeps for a scene;
        # absent means the device's default; anything that is not a true boolean is dropped
        self.assertEqual(admin.clean_scene({**BASE, "render": {"stochastic": False}})["render"], {"stochastic": False})
        self.assertEqual(admin.clean_scene({**BASE, "render": {"budgetM": 4, "stochastic": False}})["render"], {"budgetM": 4, "stochastic": False})
        self.assertEqual(admin.clean_scene({**BASE, "render": {"stochastic": True}})["render"], {"stochastic": True})
        for bad in ("no", 0, 1, None, [], "false"):
            self.assertNotIn("render", admin.clean_scene({**BASE, "render": {"stochastic": bad}}), bad)

    def test_extent(self):
        self.assertEqual(admin.clean_scene({**BASE, "extentM": [25.31, 10, 17.7]})["extentM"], [25.31, 10.0, 17.7])
        for bad in ([1, 2], [1, -2, 3], [1, "2", 3], "25x10x17"):
            self.assertNotIn("extentM", admin.clean_scene({**BASE, "extentM": bad}), bad)

    def test_dropped_out_of_range(self):
        s = admin.clean_scene({**BASE, "geo": {"lat": 91, "lon": 17}, "compassDeg": 400, "wind": {"fromDeg": 10, "speed": 50, "gust": 1},
                               "ceilingM": "high", "render": {"budgetM": 100, "stochastic": "yes"}, "origin": {"url": "https://evil.example/s/1"}})
        for k in ("geo", "compassDeg", "wind", "ceilingM", "render", "about", "origin"):
            self.assertNotIn(k, s)
        # control: the same scene with values in range keeps them, so the drops above are the ranges'
        ok = admin.clean_scene({**BASE, "compassDeg": 359, "ceilingM": -5})
        self.assertEqual((ok["compassDeg"], ok["ceilingM"]), (359, -5))


if __name__ == "__main__":
    unittest.main()
