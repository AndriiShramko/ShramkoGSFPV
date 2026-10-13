"""SuperSplat's facts of one scene for the admin (apps/api/superspl_facts.py): the recorded superspl.at answer
through a fake upstream (no network), the collision file, the cache and the call budget, and hostile text.
Every check has a negative control that must fire."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import superspl_facts as sf  # noqa: E402
import turbostream  # noqa: E402

RECORDED = (HERE.parent / "fixtures" / "superspl-scene-0230d903.data.txt").read_bytes()
VOXEL = json.dumps({"version": "1.0", "voxelResolution": 0.05, "sceneBounds": {"min": [-10.09, -7.3, -6.49], "max": [15.19, 2.7, 11.2]}}).encode()


def with_description(text: str) -> bytes:
    """The recorded answer with another description (the recorded one repeats the title)."""
    line, rest = RECORDED.decode().split("\n", 1)
    vals = json.loads(line)
    i = vals.index("description")
    # the splat object maps "description" to a value index: point it at a new value at the end
    for v in vals:
        if isinstance(v, dict) and f"_{i}" in v:
            v[f"_{i}"] = len(vals)
    vals.append(text)
    return (json.dumps(vals) + "\n" + rest).encode()


class Fake:
    def __init__(self, data: tuple = (200, {}, RECORDED), voxel: tuple = (403, {}, b"")):
        self.data, self.voxel, self.calls = data, voxel, []

    def __call__(self, url, headers, timeout, max_bytes):
        self.calls.append((url, headers))
        ans = self.voxel if url.endswith("scene.voxel.json") else self.data
        if isinstance(ans, Exception):
            raise ans
        return ans


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def call(svc: sf.SupersplFacts, sid: str = "0230d903", fresh: bool = False) -> tuple[int, dict]:
    st, body, _h = svc.handle(sid, fresh)
    return st, json.loads(body)


class Facts(unittest.TestCase):
    def test_recorded_scene_without_walls(self):
        fake = Fake()
        st, doc = call(sf.SupersplFacts(fake, Clock(), lambda: 1_791_400_000))
        self.assertEqual(st, 200)
        f = doc["facts"]
        self.assertEqual(f["title"], "Muster Truck Show Opole Poland 2024")
        self.assertEqual(f["author"], "Andrii Shramko")
        self.assertEqual(f["license"], "CC BY 4.0")
        self.assertEqual(doc["licenseCode"], "by")
        self.assertEqual(f["format"], "ssog")
        self.assertEqual(f["sizeMb"], 1559.0)
        self.assertEqual(f["version"], 1)
        self.assertFalse(f["collision"])
        self.assertIs(doc["walkable"], False)
        self.assertEqual(f["thumb"], "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/0230d903/v1/m.webp")
        self.assertEqual(f["origin"], {"url": "https://superspl.at/scene/0230d903", "created": "2026-10-07T13:31:29Z", "user": "andriishramko"})
        # the description repeats the title on SuperSplat: not stored as a description
        self.assertNotIn("description", f["origin"])
        # exactly two upstream calls, both to the expected hosts, identifying us, nothing of the admin's request
        self.assertEqual([u for u, _ in fake.calls], ["https://superspl.at/scene/0230d903.data",
                                                      "https://d28zzqy0iyovbz.cloudfront.net/0230d903/v1/scene.voxel.json"])
        self.assertEqual(set(fake.calls[0][1]), {"User-Agent", "Accept"})

    def test_walls_voxel_size_and_extent(self):
        st, doc = call(sf.SupersplFacts(Fake(voxel=(200, {}, VOXEL)), Clock()))
        self.assertTrue(doc["walkable"])
        self.assertEqual((doc["facts"]["collision"], doc["facts"]["voxelCm"], doc["facts"]["extentM"]), (True, 5.0, [25.3, 10.0, 17.7]))
        # the CDN did not answer: walls unknown, the field left for the admin, never guessed
        st, doc = call(sf.SupersplFacts(Fake(voxel=TimeoutError()), Clock()))
        self.assertIsNone(doc["walkable"])
        self.assertNotIn("collision", doc["facts"])

    def test_description_tags_and_hostile_text(self):
        desc = "Old town at dusk #Wroclaw #church #church ‮<script>alert(1)</script>\n\nmore https://example.com"
        st, doc = call(sf.SupersplFacts(Fake(data=(200, {}, with_description(desc))), Clock()))
        o = doc["facts"]["origin"]
        self.assertEqual(o["tags"], ["Wroclaw", "church"])
        self.assertNotIn("‮", o["description"])  # format characters dropped
        self.assertNotIn("\n", o["description"])
        self.assertIn("<script>", o["description"])  # kept as text: the admin and the pages escape it, never run it
        # control: the description is really read from the answer (the recorded one has none of its own)
        self.assertIn("Old town at dusk", o["description"])

    def test_errors(self):
        self.assertEqual(call(sf.SupersplFacts(Fake(data=(404, {}, b""))))[0], 404)
        self.assertEqual(call(sf.SupersplFacts(Fake(data=(500, {}, b""))))[1]["reason"], "upstream")
        self.assertEqual(call(sf.SupersplFacts(Fake(data=(200, {}, b"<!doctype html>"))))[1]["reason"], "bad-data")
        self.assertEqual(call(sf.SupersplFacts(Fake(data=ConnectionResetError())))[1]["reason"], "upstream")
        self.assertEqual(call(sf.SupersplFacts(Fake()), "../etc")[0], 400)
        # the recorded answer asked for another id is not that scene's facts
        self.assertEqual(call(sf.SupersplFacts(Fake()), "70b50d42")[1]["reason"], "bad-data")
        # control: the same fake with the right id answers
        self.assertEqual(call(sf.SupersplFacts(Fake()), "0230d903")[0], 200)

    def test_cache_and_budget(self):
        clock, fake = Clock(), Fake()
        svc = sf.SupersplFacts(fake, clock)
        call(svc)
        call(svc)
        self.assertEqual(len(fake.calls), 2)  # the second answer came from the cache
        call(svc, fresh=True)
        self.assertEqual(len(fake.calls), 4)  # Refresh asks again
        clock.t += sf.TTL_S + 1
        call(svc)
        self.assertEqual(len(fake.calls), 6)
        # 20 calls a minute in all: the 11th scene within the minute waits
        codes = [call(svc, f"{i:08x}")[0] for i in range(10)]
        self.assertIn(503, codes)
        clock.t += 61
        # control: a minute later there is room again (the fake answers bad-data for these ids, not busy)
        self.assertNotEqual(call(svc, "abcdef01")[0], 503)

    def test_tags_of(self):
        self.assertEqual(sf.tags_of("a #one b#two #three-x", [{"name": "Postshot"}, "lcc"]), ["one", "three-x", "Postshot", "lcc"])
        # control: an anchor-like "&#39;" or a word glued to # is not a tag
        self.assertEqual(sf.tags_of("it&#39;s x#y", []), [])

    def test_date(self):
        self.assertEqual(sf._iso(turbostream.Date(1791379889210)), "2026-10-07T13:31:29Z")
        self.assertIsNone(sf._iso(turbostream.Date(-5)))


if __name__ == "__main__":
    unittest.main()
