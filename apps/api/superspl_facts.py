"""SuperSplat's facts about one scene for the owner's admin (item 5 of message 18, v0.7):
GET /api/admin/superspl/<id> (behind the admin session, admin.py registers the route).

Where the facts come from (research 2026-10-13, docs/wip/v07-a.md section 3): PlayCanvas has no public
GET for one scene, so the server reads what superspl.at's own scene page loads, its React Router loader
data at https://superspl.at/scene/<id>.data (a turbo-stream, turbostream.py), and asks the scene CDN for
<id>/v<version>/scene.voxel.json (the collision file: "walkable"; its voxelResolution and scene bounds give
the voxel size and the scan's extent). Two small GETs per scene, cached 10 min in RAM, at most 20 upstream
calls a minute for the whole server, no redirect followed, nothing of the admin's request sent on.

The answer is shaped like a catalogue entry (admin.py clean_scene validates it again on save):
{"ok": true, "id", "facts": {title, author, license, thumb, version, format, sizeMb, collision, voxelCm?,
 extentM?, origin {url, description?, tags?, created?, user?}}, "walkable": true|false|null,
 "licenseCode": "by"|null, "fetchedAt": ISO}. walkable null: the CDN did not answer, the walls are unknown.
SuperSplat has no tag field: tags are the description's #hashtags and the software tools the scene names.
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
import unicodedata
from typing import Callable

import licences
import turbostream

PAGE_DATA = "https://superspl.at/scene/{id}.data"
CDN = "https://d28zzqy0iyovbz.cloudfront.net"
UA = ("ShramkoGSFPV-admin/1.0 (+https://github.com/AndriiShramko/ShramkoGSFPV; the owner adds one scene "
      "to the catalogue of the FPV simulator at https://gsfpv.flyreelstudio.eu)")
HEADERS = {"User-Agent": UA, "Accept": "*/*"}
TIMEOUT_S = 8.0
DATA_MAX = 512 * 1024
VOXEL_MAX = 64 * 1024
TTL_S = 600.0
CACHE_MAX = 256
CALLS_PER_MIN = 20

_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_THUMB_RE = re.compile(r"https://s3-eu-west-1\.amazonaws\.com/images\.playcanvas\.com/splat/[0-9a-f]{6,32}/v[0-9]{1,6}/[a-z]{1,4}\.webp")
_FORMAT_RE = re.compile(r"[a-z0-9.]{1,24}")
_USER_RE = re.compile(r"[A-Za-z0-9_.-]{1,40}")
_HASHTAG_RE = re.compile(r"(?<![\w&])#(\w[\w-]{1,29})")

Fetch = Callable[[str, dict, float, int], tuple]


def _text(v, n: int) -> str:
    """Their text as one line: control and format characters dropped, whitespace runs one space, at most n."""
    if not isinstance(v, str):
        return ""
    s = "".join(" " if unicodedata.category(c) in ("Cc", "Zl", "Zp") else c for c in v[: n * 4]
                if unicodedata.category(c) not in ("Cs", "Cf"))
    return " ".join(s.split())[:n].strip()


def _iso(d) -> str | None:
    if isinstance(d, turbostream.Date) and 0 < d.ms < 4102444800000:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(d.ms / 1000))
    return None


def tags_of(description: str, tools) -> list[str]:
    """The description's #hashtags, then the software tools the scene names; at most 12, no repeats."""
    out: list[str] = []
    for t in _HASHTAG_RE.findall(description or ""):
        out.append(t)
    for t in tools if isinstance(tools, list) else []:
        name = t.get("name") if isinstance(t, dict) else t
        if isinstance(name, str):
            out.append(_text(name, 30))
    seen, tags = set(), []
    for t in out:
        if t and t.lower() not in seen:
            seen.add(t.lower())
            tags.append(t)
    return tags[:12]


def facts_from_loader(data: dict, sid: str) -> dict:
    """The catalogue fields from the scene route's loader data ({splat, user, ...}); ValueError when the
    data is not this scene."""
    splat = data.get("splat") if isinstance(data, dict) else None
    if not isinstance(splat, dict) or splat.get("hash") != sid:
        raise ValueError("not this scene")
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    if not user and isinstance(splat.get("user"), dict):
        user = splat["user"]
    title = _text(splat.get("title"), 120)
    if not title:
        raise ValueError("no title")
    ver = splat.get("version")
    version = ver if isinstance(ver, int) and not isinstance(ver, bool) and 1 <= ver <= 999999 else 1
    dl = splat.get("downloads") if isinstance(splat.get("downloads"), dict) else {}
    code = dl.get("license") if isinstance(dl.get("license"), str) else None
    thumbs = splat.get("thumbnails") if isinstance(splat.get("thumbnails"), dict) else {}
    thumb = thumbs.get("m") if isinstance(thumbs.get("m"), str) and _THUMB_RE.fullmatch(thumbs["m"]) else None
    size = splat.get("size")
    fmt = splat.get("format")
    username = user.get("username") if isinstance(user.get("username"), str) and _USER_RE.fullmatch(user["username"]) else None
    description = _text(splat.get("description"), 600)
    if description == title:  # SuperSplat repeats the title when the author wrote no description
        description = ""
    origin: dict = {"url": f"https://superspl.at/scene/{sid}"}
    if description:
        origin["description"] = description
    tags = tags_of(_text(splat.get("description"), 2000), splat.get("softwareTools") or splat.get("softwareToolIds"))
    if tags:
        origin["tags"] = tags
    created = _iso(splat.get("createdAt"))
    if created:
        origin["created"] = created
    if username:
        origin["user"] = username
    facts: dict = {
        "id": sid,
        "title": title,
        "author": _text(user.get("fullName"), 80) or (username or ""),
        "license": licences.label(code),
        "version": version,
        "origin": origin,
    }
    if thumb:
        facts["thumb"] = thumb
    if isinstance(fmt, str) and _FORMAT_RE.fullmatch(fmt):
        facts["format"] = fmt
    if isinstance(size, int) and not isinstance(size, bool) and size > 0:
        facts["sizeMb"] = max(0.01, round(size / 1e6, 1))
    return {"facts": facts, "licenseCode": code if facts["license"] else None}


def walls_from_voxel(status: int, body: bytes) -> dict:
    """What the collision file says: {"walkable": True, "voxelCm", "extentM"} for a 200, {"walkable": False}
    for a 403/404 (the CDN's "no such file"), {"walkable": None} for anything else."""
    if status in (403, 404):
        return {"walkable": False}
    if status != 200:
        return {"walkable": None}
    out: dict = {"walkable": True}
    try:
        doc = json.loads(body)
    except ValueError:
        return out
    if not isinstance(doc, dict):
        return out
    res = doc.get("voxelResolution")
    if isinstance(res, (int, float)) and not isinstance(res, bool) and 0.001 <= res <= 1:
        out["voxelCm"] = round(res * 100, 2)
    b = doc.get("sceneBounds")
    if isinstance(b, dict) and isinstance(b.get("min"), list) and isinstance(b.get("max"), list) and len(b["min"]) == 3 == len(b["max"]):
        try:
            ext = [round(float(hi) - float(lo), 1) for lo, hi in zip(b["min"], b["max"])]
        except (TypeError, ValueError):
            ext = []
        if len(ext) == 3 and all(0 <= x <= 100000 and math.isfinite(x) for x in ext):
            out["extentM"] = ext
    return out


def _json(code: int, obj: dict) -> tuple:
    return code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), [("Content-Type", "application/json"), ("Cache-Control", "no-store")]


class SupersplFacts:
    """The facts of one scene, cached; every dependency injectable (fetch, clocks) for the tests."""

    def __init__(self, fetch: Fetch, clock: Callable[[], float] = time.monotonic, wall: Callable[[], float] = time.time):
        self.fetch, self.clock, self.wall = fetch, clock, wall
        self._cache: dict[str, tuple[float, dict]] = {}
        self._calls: list[float] = []
        self._mu = threading.Lock()

    def _budget(self, n: int) -> bool:
        """Room for n upstream calls in the last minute (taken when there is)."""
        now = self.clock()
        with self._mu:
            self._calls = [t for t in self._calls if now - t < 60.0]
            if len(self._calls) + n > CALLS_PER_MIN:
                return False
            self._calls.extend([now] * n)
            return True

    def _get(self, url: str, max_bytes: int) -> tuple[int, bytes]:
        try:
            status, _headers, body = self.fetch(url, dict(HEADERS), TIMEOUT_S, max_bytes)
        except Exception:  # noqa: BLE001  a timeout, a reset, too large: "the upstream did not answer"
            return 0, b""
        return status, body

    def handle(self, sid: str, fresh: bool = False) -> tuple:
        """(status, body, headers) for GET /api/admin/superspl/<id>; `fresh` skips the cache (Refresh)."""
        if not isinstance(sid, str) or not _ID_RE.fullmatch(sid):
            return _json(400, {"ok": False, "reason": "bad-id"})
        now = self.clock()
        with self._mu:
            hit = self._cache.get(sid)
        if hit and not fresh and now - hit[0] < TTL_S:
            return _json(200, hit[1])
        if not self._budget(2):
            return _json(503, {"ok": False, "reason": "busy", "retryAfter": 60})
        status, body = self._get(PAGE_DATA.format(id=sid), DATA_MAX)
        if status == 404:
            return _json(404, {"ok": False, "reason": "not-found"})
        if status != 200:
            return _json(502, {"ok": False, "reason": "upstream", "detail": f"superspl.at answered {status or 'nothing'}"})
        try:
            data = turbostream.find_route(turbostream.decode(body.decode("utf-8")), "routes/scene")
            got = facts_from_loader(data or {}, sid)
        except (ValueError, UnicodeDecodeError):
            return _json(502, {"ok": False, "reason": "bad-data", "detail": "superspl.at's page data has changed shape"})
        facts = got["facts"]
        v_status, v_body = self._get(f"{CDN}/{sid}/v{facts['version']}/scene.voxel.json", VOXEL_MAX)
        walls = walls_from_voxel(v_status, v_body)
        if walls["walkable"] is not None:
            facts["collision"] = walls["walkable"]
        for k in ("voxelCm", "extentM"):
            if k in walls:
                facts[k] = walls[k]
        doc = {"ok": True, "id": sid, "facts": facts, "walkable": walls["walkable"], "licenseCode": got["licenseCode"],
               "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.wall()))}
        with self._mu:
            if len(self._cache) >= CACHE_MAX:
                self._cache.pop(min(self._cache, key=lambda k: self._cache[k][0]))
            self._cache[sid] = (self.clock(), doc)
        return _json(200, doc)
