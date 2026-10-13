"""The wind of a scene's place, from Open-Meteo (free, no key; https://open-meteo.com), v0.7 lane A:

GET /api/wind/<sceneId>?mode=now      public: the wind at the scene's geo right now, Open-Meteo's forecast
                                      "current" 10 m wind, cached 15 min per scene: {"ok": true, "fromDeg",
                                      "speed", "gust", "at", "source": "now"}; 404 for a scene that is not
                                      published, hidden or has no geo; 30 requests a minute per visitor
GET /api/admin/geo/search?q=&lang=    admin: places by name (Open-Meteo geocoding), for "Find place"
GET /api/admin/wind/climate?lat=&lon= admin: the prevailing wind of the place: five full years of hourly
                                      wind_speed_10m, wind_direction_10m, wind_gusts_10m from Open-Meteo's
                                      archive -> the speed-weighted vector-mean direction, the median speed,
                                      the median gust above the mean; kept in DATA_DIR/wind-climate/

Units as the catalogue's SceneWind (packages/scenes/src/catalog.ts): fromDeg is where the wind blows FROM
(0 north, clockwise, as weather reports and Open-Meteo give it), speed m/s at 10 m, gust = the gusts ABOVE
the mean (wind_gusts_10m - wind_speed_10m, at least 0). Nothing of the visitor goes upstream; every
upstream call goes through one bucket of 60 a minute (Open-Meteo allows 600 a minute without a key).
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
import unicodedata
import urllib.parse
from collections import deque
from pathlib import Path
from typing import Callable

GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
UA = "ShramkoGSFPV-wind/1.0 (+https://github.com/AndriiShramko/ShramkoGSFPV; wind of the scanned places of the FPV simulator)"
HEADERS = {"User-Agent": UA, "Accept": "application/json"}
TIMEOUT_S = 10.0
SMALL_MAX = 256 * 1024
ARCHIVE_MAX = 4 * 1024 * 1024    # five years of three hourly series: ~1.1 MB measured 2026-10-13
NOW_TTL_S = 900.0
GEO_TTL_S = 86400.0
CLIMATE_YEARS = 5
CLIMATE_MAX_AGE_S = 365 * 86400.0
UPSTREAM_PER_MIN = 60
CLIENT_PER_MIN = 30
CLIENT_TABLE_MAX = 4096
SPEED_MAX, GUST_MAX = 30.0, 20.0  # the catalogue's SceneWind ranges
LANGS = ("en", "es", "pl", "ru")

_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_NUM_RE = re.compile(r"-?[0-9]{1,3}(\.[0-9]{1,8})?")

Fetch = Callable[[str, dict, float, int], tuple]
Response = tuple[int, bytes, list]


def _json(code: int, obj: dict, cache: str = "no-store") -> Response:
    return code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), [("Content-Type", "application/json"), ("Cache-Control", cache)]


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    return (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2) if n else 0.0


def climate_from_hourly(speed: list, direction: list, gusts: list) -> dict | None:
    """The prevailing wind from hourly series (None entries skipped): the direction of the speed-weighted
    mean wind vector (fromDeg), the median speed, the median gust above the mean; steadiness = the mean
    vector's length over the mean speed (1: always from one side, 0: from every side alike)."""
    sx = sy = total = 0.0
    speeds, above = [], []
    for s, d, g in zip(speed, direction, gusts):
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in (s, d)):
            continue
        if s < 0:
            continue
        r = math.radians(d)
        sx += s * math.sin(r)
        sy += s * math.cos(r)
        total += s
        speeds.append(float(s))
        if isinstance(g, (int, float)) and not isinstance(g, bool) and math.isfinite(g):
            above.append(max(0.0, float(g) - s))
    if len(speeds) < 24 * 30:  # less than a month of hours is not a climate
        return None
    n = len(speeds)
    from_deg = (math.degrees(math.atan2(sx, sy)) + 360.0) % 360.0
    steadiness = math.hypot(sx, sy) / total if total > 0 else 0.0
    return {"fromDeg": round(from_deg) % 360, "speed": round(min(SPEED_MAX, _median(speeds)), 1),
            "gust": round(min(GUST_MAX, _median(above)), 1), "steadiness": round(steadiness, 2), "hours": n,
            "source": "climate"}


def place_name(r: dict) -> str:
    """"Wroclaw, Lower Silesia, Poland" from one geocoding result (name, the region when it differs, country)."""
    parts = [r.get("name"), r.get("admin1"), r.get("country")]
    out: list[str] = []
    for p in parts:
        if isinstance(p, str) and p.strip() and p.strip() not in out:
            out.append("".join(c for c in p.strip() if unicodedata.category(c)[0] != "C")[:40])
    return ", ".join(out)[:80]


def _coord(v: str | None, lo: float, hi: float) -> float | None:
    if not isinstance(v, str) or not _NUM_RE.fullmatch(v):
        return None
    x = float(v)
    return round(x, 3) if lo <= x <= hi else None


class Upstream:
    """Every Open-Meteo call: one bucket (UPSTREAM_PER_MIN) for the whole server."""

    def __init__(self, fetch: Fetch, clock: Callable[[], float]):
        self.fetch, self.clock = fetch, clock
        self._calls: deque = deque()
        self._mu = threading.Lock()
        self.calls = 0

    def get_json(self, base: str, params: list[tuple[str, str]], max_bytes: int):
        """The decoded answer; None when over the budget, on any upstream failure or a non-JSON answer."""
        now = self.clock()
        with self._mu:
            while self._calls and now - self._calls[0] >= 60.0:
                self._calls.popleft()
            if len(self._calls) >= UPSTREAM_PER_MIN:
                return None
            self._calls.append(now)
            self.calls += 1
        try:
            status, _h, body = self.fetch(base + "?" + urllib.parse.urlencode(params), dict(HEADERS), TIMEOUT_S, max_bytes)
        except Exception:  # noqa: BLE001
            return None
        if status != 200:
            return None
        try:
            return json.loads(body)
        except ValueError:
            return None


class WindService:
    """Open-Meteo's geocoding, current wind and climate, with their caches; scene lookup injected."""

    def __init__(self, fetch: Fetch, data_dir: Callable[[], Path], scene: Callable[[str], dict | None],
                 clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time):
        self.up = Upstream(fetch, clock)
        self.data_dir, self.scene, self.clock, self.wall = data_dir, scene, clock, wall
        self._now: dict[tuple, tuple[float, dict]] = {}
        self._geo: dict[tuple, tuple[float, list]] = {}
        self._clients: dict[str, deque] = {}
        self._mu = threading.Lock()

    # ---- public: /api/wind/<id>?mode=now ----
    def _client_ok(self, client: str) -> bool:
        now = self.clock()
        with self._mu:
            q = self._clients.get(client)
            if q is None:
                if len(self._clients) >= CLIENT_TABLE_MAX:
                    self._clients = {k: d for k, d in self._clients.items() if d and now - d[-1] < 60.0}
                    if len(self._clients) >= CLIENT_TABLE_MAX:
                        self._clients.clear()
                q = self._clients[client] = deque()
            while q and now - q[0] >= 60.0:
                q.popleft()
            if len(q) >= CLIENT_PER_MIN:
                return False
            q.append(now)
            return True

    def handle_now(self, sid: str, qs: str, client: str) -> Response:
        if not self._client_ok(client):
            return _json(429, {"ok": False, "reason": "rate-limited", "retryAfter": 60})
        mode = urllib.parse.parse_qs(qs).get("mode", ["now"])
        if mode != ["now"]:
            return _json(400, {"ok": False, "reason": "mode", "detail": "only mode=now"})
        if not _ID_RE.fullmatch(sid or ""):
            return _json(404, {"ok": False, "reason": "no-scene"})
        s = self.scene(sid)
        geo = s.get("geo") if isinstance(s, dict) else None
        if not isinstance(geo, dict) or not isinstance(geo.get("lat"), (int, float)) or not isinstance(geo.get("lon"), (int, float)):
            return _json(404, {"ok": False, "reason": "no-geo" if s else "no-scene"})
        key = (round(float(geo["lat"]), 3), round(float(geo["lon"]), 3))
        now = self.clock()
        with self._mu:
            hit = self._now.get(key)
        if hit and now - hit[0] < NOW_TTL_S:
            return _json(200, hit[1], f"public, max-age={max(1, int(NOW_TTL_S - (now - hit[0])))}")
        doc = self.up.get_json(FORECAST, [("latitude", str(key[0])), ("longitude", str(key[1])),
                                          ("current", "wind_speed_10m,wind_direction_10m,wind_gusts_10m"),
                                          ("wind_speed_unit", "ms"), ("timezone", "GMT")], SMALL_MAX)
        cur = doc.get("current") if isinstance(doc, dict) else None
        out = self._current(cur)
        if out is None:
            if hit:  # an older answer beats none
                return _json(200, {**hit[1], "stale": True}, "no-cache")
            return _json(503, {"ok": False, "reason": "upstream", "retryAfter": 60})
        with self._mu:
            if len(self._now) > 1024:
                self._now.clear()
            self._now[key] = (self.clock(), out)
        return _json(200, out, f"public, max-age={int(NOW_TTL_S)}")

    @staticmethod
    def _current(cur) -> dict | None:
        if not isinstance(cur, dict):
            return None
        s, d, g, t = cur.get("wind_speed_10m"), cur.get("wind_direction_10m"), cur.get("wind_gusts_10m"), cur.get("time")
        nums = (s, d)
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in nums):
            return None
        gust = max(0.0, float(g) - float(s)) if isinstance(g, (int, float)) and not isinstance(g, bool) and math.isfinite(g) else 0.0
        at = t + ":00Z" if isinstance(t, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", t) else None
        return {"ok": True, "fromDeg": round(float(d)) % 360, "speed": round(min(SPEED_MAX, max(0.0, float(s))), 1),
                "gust": round(min(GUST_MAX, gust), 1), "at": at, "source": "now"}

    # ---- admin: find a place ----
    def geocode(self, qs: str) -> Response:
        p = urllib.parse.parse_qs(qs)
        q = " ".join((p.get("q") or [""])[0].split())[:80]
        lang = (p.get("lang") or ["en"])[0]
        lang = lang if lang in LANGS else "en"
        if len(q) < 2 or any(unicodedata.category(c) in ("Cc", "Cs", "Cf") for c in q):
            return _json(400, {"ok": False, "reason": "query"})
        key = (q.lower(), lang)
        now = self.clock()
        with self._mu:
            hit = self._geo.get(key)
        if hit and now - hit[0] < GEO_TTL_S:
            return _json(200, {"ok": True, "places": hit[1]})
        doc = self.up.get_json(GEOCODE, [("name", q), ("count", "8"), ("language", lang), ("format", "json")], SMALL_MAX)
        if not isinstance(doc, dict):
            return _json(502, {"ok": False, "reason": "upstream"})
        places = []
        for r in doc.get("results") or []:
            if not isinstance(r, dict):
                continue
            lat, lon = r.get("latitude"), r.get("longitude")
            if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (lat, lon)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue
            places.append({"lat": round(lat, 3), "lon": round(lon, 3), "place": place_name(r)})
        with self._mu:
            if len(self._geo) > 512:
                self._geo.clear()
            self._geo[key] = (self.clock(), places)
        return _json(200, {"ok": True, "places": places})

    # ---- admin: the prevailing wind of a place ----
    def _climate_file(self, lat: float, lon: float) -> Path:
        return self.data_dir() / "wind-climate" / f"{lat:.2f}_{lon:.2f}.json"

    def climate(self, qs: str) -> Response:
        p = urllib.parse.parse_qs(qs)
        lat = _coord((p.get("lat") or [None])[0], -90, 90)
        lon = _coord((p.get("lon") or [None])[0], -180, 180)
        if lat is None or lon is None:
            return _json(400, {"ok": False, "reason": "lat-lon"})
        f = self._climate_file(lat, lon)
        try:
            kept = json.loads(f.read_text(encoding="utf-8"))
            if self.wall() - kept.get("fetched", 0) < CLIMATE_MAX_AGE_S and isinstance(kept.get("wind"), dict):
                return _json(200, {"ok": True, **kept})
        except (OSError, ValueError, AttributeError):
            pass
        last = time.gmtime(self.wall()).tm_year - 1
        first = last - CLIMATE_YEARS + 1
        doc = self.up.get_json(ARCHIVE, [("latitude", f"{lat:.2f}"), ("longitude", f"{lon:.2f}"), ("start_date", f"{first}-01-01"),
                                         ("end_date", f"{last}-12-31"), ("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m"),
                                         ("wind_speed_unit", "ms"), ("timeformat", "unixtime")], ARCHIVE_MAX)
        hourly = doc.get("hourly") if isinstance(doc, dict) else None
        wind = None
        if isinstance(hourly, dict):
            series = [hourly.get(k) for k in ("wind_speed_10m", "wind_direction_10m", "wind_gusts_10m")]
            if all(isinstance(x, list) for x in series):
                wind = climate_from_hourly(*series)
        if wind is None:
            return _json(502, {"ok": False, "reason": "upstream"})
        kept = {"wind": wind, "years": [first, last], "lat": lat, "lon": lon, "fetched": int(self.wall())}
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_name(f.name + ".tmp")
            tmp.write_text(json.dumps(kept), encoding="utf-8")
            tmp.replace(f)
        except OSError:
            pass  # the answer still goes out; it is asked again next time
        return _json(200, {"ok": True, **kept})
