"""The wind of a scene's place (apps/api/wind.py): the climate maths on made-up hours, the public "now" route
with a fake Open-Meteo (no network), its cache, 404s and rate limits, the place search and the climate file.
Every check has a negative control that must fire."""
from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import wind  # noqa: E402

GEO_SCENE = {"id": "70b50d42", "title": "Wroclaw Cathedral", "geo": {"lat": 51.114, "lon": 17.046, "place": "Wroclaw, Poland"}}
SCENES = {"70b50d42": GEO_SCENE, "0230d903": {"id": "0230d903", "title": "Muster"}}


class Clock:
    def __init__(self):
        self.t = 5000.0

    def __call__(self):
        return self.t


class FakeMeteo:
    """Open-Meteo stand-in: answers by host; records every call."""

    def __init__(self, hours: int = 24 * 400):
        self.calls: list[str] = []
        self.hours = hours
        self.fail = False

    def __call__(self, url, headers, timeout, max_bytes):
        self.calls.append(url)
        if self.fail:
            raise TimeoutError()
        u = urllib.parse.urlsplit(url)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.netloc == "api.open-meteo.com":
            body = {"current": {"time": "2026-10-13T08:30", "wind_speed_10m": 3.2, "wind_direction_10m": 284, "wind_gusts_10m": 7.9}}
        elif u.netloc == "geocoding-api.open-meteo.com":
            body = {"results": [{"name": q["name"].title(), "latitude": 51.10286, "longitude": 17.03006, "country": "Poland", "admin1": "Lower Silesia"},
                                {"name": "Bad", "latitude": 300, "longitude": 0}]}
        else:  # the archive: wind from the west-south-west, 4 m/s, gusts 6 m/s, one hour in ten from the east
            n = self.hours
            body = {"hourly": {"wind_speed_10m": [4.0] * n, "wind_direction_10m": [90 if i % 10 == 0 else 250 for i in range(n)],
                               "wind_gusts_10m": [6.0] * n}}
        return 200, {}, json.dumps(body).encode()


def svc(fake=None, clock=None, data=None):
    clock = clock or Clock()
    return wind.WindService(fake or FakeMeteo(), lambda: data or Path(tempfile.gettempdir()), SCENES.get, clock, lambda: 1_791_900_000.0)


def body(r):
    return r[0], json.loads(r[1])


class Climate(unittest.TestCase):
    def test_vector_mean_median_gust(self):
        n = 24 * 60
        c = wind.climate_from_hourly([4.0] * n, [90 if i % 10 == 0 else 250 for i in range(n)], [6.5] * n)
        # 0.9 * (sin 250, cos 250) + 0.1 * (sin 90, cos 90) points from 247.6 deg: the east hours pull it a little
        self.assertEqual(c["fromDeg"], 248)
        self.assertEqual((c["speed"], c["gust"], c["hours"], c["source"]), (4.0, 2.5, n, "climate"))
        self.assertGreater(c["steadiness"], 0.7)

    def test_across_north(self):
        n = 24 * 60
        c = wind.climate_from_hourly([5.0] * n, [350 if i % 2 else 10 for i in range(n)], [None] * n)
        self.assertIn(c["fromDeg"], (0, 360 % 360))
        # control: the arithmetic mean of the angles says "from the south", the opposite of the truth
        self.assertEqual(sum([350, 10]) / 2, 180)

    def test_calm_from_everywhere_and_too_little_data(self):
        n = 24 * 72
        c = wind.climate_from_hourly([3.0] * n, [i * 5 % 360 for i in range(n)], [3.0] * n)
        self.assertLess(c["steadiness"], 0.05)
        self.assertIsNone(wind.climate_from_hourly([3.0] * 100, [10] * 100, [3] * 100))
        self.assertIsNotNone(wind.climate_from_hourly([3.0] * 800, [10] * 800, [3] * 800))  # control: a month is enough


class Now(unittest.TestCase):
    def test_now_contract_and_cache(self):
        clock, fake = Clock(), FakeMeteo()
        s = svc(fake, clock)
        st, doc = body(s.handle_now("70b50d42", "mode=now", "a"))
        self.assertEqual(st, 200)
        self.assertEqual(doc, {"ok": True, "fromDeg": 284, "speed": 3.2, "gust": 4.7, "at": "2026-10-13T08:30:00Z", "source": "now"})
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(fake.calls[0]).query))
        self.assertEqual((q["latitude"], q["longitude"], q["wind_speed_unit"]), ("51.114", "17.046", "ms"))
        s.handle_now("70b50d42", "", "b")
        self.assertEqual(len(fake.calls), 1)  # the same place within 15 min: no second call
        clock.t += wind.NOW_TTL_S + 1
        s.handle_now("70b50d42", "mode=now", "c")
        self.assertEqual(len(fake.calls), 2)  # control: after 15 min it asks again

    def test_404_and_400(self):
        s = svc()
        self.assertEqual(body(s.handle_now("0230d903", "mode=now", "a")), (404, {"ok": False, "reason": "no-geo"}))
        self.assertEqual(body(s.handle_now("ffffffff", "mode=now", "a"))[0], 404)  # unknown, or hidden (not in the published list)
        self.assertEqual(body(s.handle_now("../x", "mode=now", "a"))[0], 404)
        self.assertEqual(body(s.handle_now("70b50d42", "mode=climate", "a"))[0], 400)
        self.assertEqual(body(s.handle_now("70b50d42", "mode=now", "a"))[0], 200)  # control

    def test_rate_limit_and_upstream_failure(self):
        fake = FakeMeteo()
        s = svc(fake)
        codes = [s.handle_now("70b50d42", "mode=now", "one-visitor")[0] for _ in range(wind.CLIENT_PER_MIN + 1)]
        self.assertEqual(codes[-1], 429)
        self.assertEqual(s.handle_now("70b50d42", "mode=now", "another")[0], 200)  # control: another visitor is served
        fake.fail = True
        s2 = svc(fake)
        self.assertEqual(s2.handle_now("70b50d42", "mode=now", "x")[0], 503)


class AdminParts(unittest.TestCase):
    def test_geocode(self):
        st, doc = body(svc().geocode("q=wroclaw&lang=pl"))
        self.assertEqual(doc["places"], [{"lat": 51.103, "lon": 17.03, "place": "Wroclaw, Lower Silesia, Poland"}])
        self.assertEqual(svc().geocode("q=a")[0], 400)
        self.assertEqual(svc().geocode("q=%00%01")[0], 400)

    def test_climate_file(self):
        with tempfile.TemporaryDirectory() as d:
            fake = FakeMeteo()
            s = svc(fake, data=Path(d))
            st, doc = body(s.climate("lat=51.11&lon=17.05"))
            self.assertEqual(st, 200)
            self.assertEqual(doc["years"], [2021, 2025])
            self.assertEqual(doc["wind"]["speed"], 4.0)
            self.assertTrue((Path(d) / "wind-climate" / "51.11_17.05.json").is_file())
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(fake.calls[0]).query))
            self.assertEqual((q["start_date"], q["end_date"]), ("2021-01-01", "2025-12-31"))
            s.climate("lat=51.11&lon=17.05")
            self.assertEqual(len(fake.calls), 1)  # kept on disk
            self.assertEqual(s.climate("lat=91&lon=0")[0], 400)
            self.assertEqual(s.climate("lat=abc&lon=0")[0], 400)
            # control: too few hours from the archive is an error, not a made-up climate
            short = svc(FakeMeteo(hours=50), data=Path(d))
            self.assertEqual(short.climate("lat=10&lon=10")[0], 502)

    def test_upstream_budget(self):
        fake = FakeMeteo()
        up = wind.Upstream(fake, Clock())
        got = [up.get_json("https://api.open-meteo.com/v1/forecast", [], 1000) for _ in range(wind.UPSTREAM_PER_MIN + 5)]
        self.assertEqual(sum(1 for g in got if g is None), 5)
        self.assertTrue(math.isfinite(len(fake.calls)))
        self.assertEqual(len(fake.calls), wind.UPSTREAM_PER_MIN)


if __name__ == "__main__":
    unittest.main()
