"""Lane gap-save: a gate's size is checked in FLOWN m (scene units x transform[0]), the unit a leg is checked in.

The table fixtures/track-sizes.json is shared with packages/tracks/test/size-flown.test.ts (the sound package's validateTrack
and server.ts); here it runs against tracks.py validate_track. Each row is valid-basic.json flown at the row's Scene size with
every gate the row's shape. Courses stored before (scale 1) still pass: test_tracks.py reads every stored fixture.
Run: python -m unittest discover -s apps/api/tests -p "test_tracks_sizes.py"
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tracks  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
TABLE = json.loads((FIX / "track-sizes.json").read_text(encoding="utf-8"))
BASIC = (FIX / "tracks" / "valid-basic.json").read_text(encoding="utf-8")


def sized_track(row: dict) -> dict:
    t = json.loads(BASIC)
    s = row["scale"]
    t["transform"] = [s, 0, 0, 0]
    t["start"]["pos"] = [x / s for x in t["start"]["pos"]]
    shape = {k: (v / s if isinstance(v, (int, float)) else v) for k, v in row["shape"].items()}
    for g in t["gates"]:
        g["pos"] = [x / s for x in g["pos"]]
        g["shape"] = dict(shape)
    return t


class FlownSizes(unittest.TestCase):
    def test_every_row(self):
        self.assertGreaterEqual(len(TABLE["rows"]), 15)
        for row in TABLE["rows"]:
            with self.subTest(row["name"]):
                issues = tracks.validate_track(sized_track(row))
                if row["ok"]:
                    self.assertEqual(issues, [])
                else:
                    self.assertTrue(any(p.startswith("gates[0].shape") for p, _ in issues), issues)

    def test_the_message_names_flown_metres(self):
        row = next(r for r in TABLE["rows"] if r["name"] == "refused: a 0.03 m opening x15")
        issues = dict(tracks.validate_track(sized_track(row)))
        self.assertIn("m flown", issues["gates[0].shape.side"])


if __name__ == "__main__":
    unittest.main()
