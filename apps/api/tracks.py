"""Courses saved for everyone, per scene (train 1, lane tracks, stage T3; docs/tracks-api.md, docs/wip/train1-plan.md section 7).

A pilot generates a course of gates in a scan (apps/fly/src/course, @gsfpv/tracks) and presses "Save for everyone": the
course goes here, and every pilot who opens that scene can load it. Pilots have no accounts, so a stored course is only
"a valid file": the server cannot see the walls, every client re-checks a course on its own walls before it shows it.

Routes (wired in server.py; the admin's in tracks_admin.py; the contract table is docs/tracks-api.md):
  GET  /api/tracks?scene=<hex>&sort=top|new&page=n -> {v: 1, sort, page, pages, tracks: [rows]}, ETag/304, max-age 30
  GET  /api/tracks/<id>/v<n>          -> the file of a version, immutable, ETag
  POST /api/tracks                    -> 201 {id, version: 1, editToken} a new course or a fork (body `parent` = the source)
  POST /api/tracks/<id>/versions      -> 201 {id, version} a new version, header X-Track-Token
  POST /api/tracks/<id>/vote          -> 200 {id, v, up, down, rating}
  POST /api/tracks/<id>/broken        -> 200 {id, broken}

Storage: see TrackStore. Every file is written whole or not at all (a temporary file, fsync, os.replace, fsync of the
directory) before the answer. The id is the server's: <sceneId>-<8 hex>; the body's id, version, parent and created are
replaced by the server's.

The contract (plan section 7, tracks-plan 2.6 and 2.8): format shramko-sonic-track/1, the validator of the sound package
(packages/sonic-fpv/src/track/validate.ts) ported key for key, and on top: scene.kind 'scan', scene.id hex 6-32, 1-60 gates
at most 20 m across, unknown keys refused; author.kind 'generator' (generator.name 'gsfpv-course', title ^Course
[0-9a-z-]{1,24}$, no parent) or 'person' (the name the pilot typed, 2-32 characters, and a title of 3-60, both plain text:
_text). Authorship marks (created by, edited by, kind generator, pilot or admin) live in the track's meta, not in the /1 file.
The TS twin is validateServerTrack (packages/tracks/src/server.ts); the two are held together by the shared fixtures
apps/api/tests/fixtures/tracks/{valid,invalid}-*.json.

Stdlib only, the style of sessions.py.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import shutil
import threading
import time
import unicodedata
from pathlib import Path
from typing import Callable

# Limits, all ESTIMATES (not measured; plan section 7 and tracks-plan.md 2.8): a generated course of 24 gates is about 6 KB of
# JSON, so 64 KB holds 200 gates with room; 10 creates an hour lets a pilot try a few courses; 20 courses a scene keeps a
# scene's list short until voting exists (train 2).
LIMITS = {
    "body_bytes": 64 * 1024,          # POST body, also nginx client_max_body_size 64k
    "creates_per_client_hour": 10,    # server.py _rate(_trhits, client, ...)
    "creates_all_hour": 300,          # server.py _rate(_all_hits, "tracks-create", ...): every client together (as report, share)
    "tracks_per_scene": 300,          # visible ones; the oldest unrated is hidden first (tracks-plan 2.8, lane review TR-6)
    "versions_per_track": 50,         # 409 after that; the admin may delete old versions
    "versions_per_client_hour": 30,   # server.py _rate(_trvhits, ...) (tracks-plan 2.8)
    "votes_per_client_hour": 60,      # server.py _rate(_trvhits, "vote:" + client, ...)
    "reports_per_client_hour": 30,    # POST .../broken
    "broken_hide_clients": 3,         # distinct clients with the same walls digest leave a course out of sort=top
    "page_size": 20,                  # rows a list page holds
    "list_max_age_s": 30,             # Cache-Control of the list
    "min_free_bytes": 1 * 1000 ** 3,  # below this the store refuses writes with 507 (server.py passes MIN_FREE_GB)
}

TRACK_FORMAT = "shramko-sonic-track/1"
GENERATOR_NAME = "gsfpv-course"
MAX_GATES = 200

TRACK_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
GATE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,39}")
SCENE_ID = re.compile(r"[0-9a-f]{6,32}")
SERVER_ID = re.compile(r"([0-9a-f]{6,32})-([0-9a-f]{8})")
TITLE = re.compile(r"Course [0-9a-z-]{1,24}")
ISO_8601 = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")
CONTROL = re.compile(r"[\u0000-\u001f]")

AUTHOR_KINDS = ("generator", "person")   # 'agent' of the format is not taken from the public; the admin's mark lives in meta
# tracks-plan 2.8, ESTIMATES (not measured): the generator makes at most 24 gates (generate.ts gatesMax), 60 leaves room for
# hand-added ones; a gate wider than 20 m is no gate in any scan the site serves.
SERVER_MAX_GATES = 60
MAX_GATE_SIZE_M = 20.0
# lane review TK-8, ESTIMATE (not measured): address -> voter bindings kept per course (the oldest dropped past it)
VOTE_ADDR_CAP = 5000
# stage K2, ESTIMATES (not measured): the shortest and the longest lap a vote may carry, ms. Review T2-5: any completed
# lap counts (a 0.3-scale course of fitCourse, legs 0.9-4.5 m, can be lapped in under 1 s), so the floor is 1 ms
LAP_MIN_MS = 1
LAP_MAX_MS = 3_600_000
NAME_LEN, NAME_EXTRA = (2, 32), " -_.'"
TITLE_LEN, TITLE_EXTRA = (3, 60), " -_.',!?#()+:&"
# a short blocklist (tracks-plan 2.8: "the admin hides the rest"); the same words in packages/tracks/src/server.ts
BLOCKLIST = ("fuck", "cunt", "nigger", "faggot", "porn", "viagra", "casino", "kurwa", "pierdol", "huj", "pizd", "blyat")
TOP_KEYS = ("format", "id", "version", "parent", "title", "scene", "transform", "gates", "laps", "start", "author", "generator", "created")
GATE_KINDS = ("ring", "square", "cube-frame")


class TrackError(Exception):
    """A refusal with its HTTP status and a stable code."""

    def __init__(self, status: int, code: str, **extra) -> None:
        super().__init__(f"{status} {code}")
        self.status, self.code, self.extra = status, code, extra


# ----------------------------------------------------------------------------- the validator (port of validate.ts)

def _js_len(s: str) -> int:
    """String length as JavaScript counts it (UTF-16 code units)."""
    return len(s.encode("utf-16-le")) // 2


def _is_num(v) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    try:
        return math.isfinite(v)   # an int beyond the float range (a 400-digit literal) raises OverflowError: not a number
    except OverflowError:
        return False


# Bounds against hostile files (lane review TR-1, TR-2, TR-3), ESTIMATES not measured: no scan the site serves is near 10000
# units across (the cached scans are under 200 m), and the generator's legs are at most legMaxM 15 flown m, so 60 leaves room.
MAX_COORD = 10000.0     # |x|, |y|, |z| of a gate or the start, in scan units
MAX_LEG_M = 60.0        # one leg between two gates (and the leg back on a closed course), in flown m (times transform[0])
# generator.params: the keys the generator writes (packages/tracks/src/generate.ts), flat values, and the one proof object
# scale, legMinM and legMaxM: a smaller course of fitCourse (lane tracks2 K1.2, review T2-2)
PARAM_KEYS = ("marginM", "cellM", "freeDigest", "wanted", "rooms", "volumeM3", "tries", "walked", "stop", "closed", "proof", "scale", "legMinM", "legMaxM")
PROOF_KEYS = ("ok", "marginM", "pathM")
PARAM_TEXT_MAX = 40


class _Collector:
    def __init__(self):
        self.issues: list[tuple[str, str]] = []

    def add(self, path: str, msg: str) -> None:
        self.issues.append((path, msg))

    def record(self, v, path):
        if isinstance(v, dict):
            return v
        self.add(path, "must be an object")
        return None

    def array(self, v, path, lo=None, hi=None):
        if not isinstance(v, list):
            self.add(path, "must be an array")
            return None
        if lo is not None and len(v) < lo:
            self.add(path, f"must hold at least {lo}")
        if hi is not None and len(v) > hi:
            self.add(path, f"must hold at most {hi} items")
        return v

    def keys(self, obj: dict, path: str, allowed) -> None:
        for k in obj:
            if k not in allowed:
                self.add(_join(path, k), "is not a known key")
        for k in allowed:
            if k not in obj:
                self.add(_join(path, k), "is missing")

    def string(self, v, path, lo=None, hi=None, pattern: re.Pattern | None = None):
        if not isinstance(v, str):   # only called for a key that is present (a missing one is reported by keys())
            self.add(path, "must be a string")
            return None
        n = _js_len(v)
        if lo is not None and n < lo:
            self.add(path, f"must have at least {lo} characters")
        if hi is not None and n > hi:
            self.add(path, f"must have at most {hi} characters")
        if pattern is not None and not pattern.fullmatch(v):
            self.add(path, f"must match {pattern.pattern}")
        return v

    def number(self, v, path, lo=None, hi=None, integer=False):
        if not _is_num(v):
            self.add(path, "must be a finite number")
            return None
        if integer and not float(v).is_integer():
            self.add(path, "must be an integer")
        if lo is not None and v < lo:
            self.add(path, f"must be at least {lo}")
        if hi is not None and v > hi:
            self.add(path, f"must be at most {hi}")
        return v

    def one_of(self, v, path, values):
        if isinstance(v, str) and v in values:
            return v
        self.add(path, f"must be one of {', '.join(values)}")
        return None

    def vec3(self, v, path):
        if isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v):
            return v
        self.add(path, "must be three finite numbers [x, y, z]")
        return None


def _join(path: str, key) -> str:
    return f"{path}[{key}]" if isinstance(key, int) else (key if path == "" else f"{path}.{key}")


def _shape(c: _Collector, v, path: str) -> None:
    rec = c.record(v, path)
    if rec is None:
        return
    kind = c.one_of(rec.get("kind"), _join(path, "kind"), GATE_KINDS)
    if kind is None:
        return
    big, small = ("diameter", "tube") if kind == "ring" else ("side", "bar")
    c.keys(rec, path, ("kind", big, small))
    a = c.number(rec.get(big), _join(path, big), 0.05, 100)
    b = c.number(rec.get(small), _join(path, small), 0.005, 10)
    if a is not None and b is not None and b > a:
        c.add(_join(path, small), f"must not exceed the {big}")


def _ref(c: _Collector, v, path: str):
    rec = c.record(v, path)
    if rec is None:
        return None
    c.keys(rec, path, ("id", "version"))
    i = c.string(rec.get("id"), _join(path, "id"), pattern=TRACK_ID)
    n = c.number(rec.get("version"), _join(path, "version"), 1, 9999, integer=True)
    return (i, n) if i is not None and n is not None else None


def _iso_ok(s: str) -> bool:
    if not ISO_8601.fullmatch(s):
        return False
    try:
        y, mo, d = int(s[0:4]), int(s[5:7]), int(s[8:10])
        hh, mm, ss = int(s[11:13]), int(s[14:16]), int(s[17:19])
        time.strptime(f"{y:04d}-{mo:02d}-{d:02d}", "%Y-%m-%d")
        return hh <= 24 and mm <= 59 and ss <= 59
    except ValueError:
        return False


def validate_track(obj) -> list[tuple[str, str]]:
    """The issues of a server track ([] = valid): validateTrack of the sound package, then the contract of plan section 7."""
    c = _Collector()
    root = c.record(obj, "")
    if root is None:
        return c.issues
    c.keys(root, "", TOP_KEYS)
    if "format" in root and root["format"] != TRACK_FORMAT:
        c.add("format", f"must be '{TRACK_FORMAT}'")
    tid = c.string(root.get("id"), "id", pattern=TRACK_ID) if "id" in root else None
    version = c.number(root.get("version"), "version", 1, 9999, integer=True) if "version" in root else None

    parent = root.get("parent", "missing")
    p = None
    if parent is not None and parent != "missing":
        p = _ref(c, parent, "parent")
        if p is not None and version == 1 and tid is not None and p[0] == tid:
            c.add("parent", "version 1 cannot have a parent in the same track")
    # the format's succession (validate.ts): a later version names the version before it in the same track
    if _is_num(version) and float(version).is_integer() and version > 1 and tid is not None and parent != "missing" and p != (tid, version - 1):
        c.add("parent", f"version {int(version)} must have the parent {tid} version {int(version) - 1}")

    title = c.string(root.get("title"), "title", 1, 120) if "title" in root else None
    if title is not None and CONTROL.search(title):
        c.add("title", "must not contain control characters")

    scene = None
    if "scene" in root:
        s = c.record(root["scene"], "scene")
        if s is not None:
            c.keys(s, "scene", ("kind", "id", "version"))
            kind = c.one_of(s.get("kind"), "scene.kind", ("scan", "lesson")) if "kind" in s else None
            sid = c.string(s.get("id"), "scene.id", 1, 80) if "id" in s else None
            if "version" in s:
                c.number(s.get("version"), "scene.version", 1, None, integer=True)
            scene = (kind, sid)

    if "transform" in root:
        t = c.array(root["transform"], "transform")
        if t is not None:
            if len(t) != 4 or not all(_is_num(x) for x in t):
                c.add("transform", "must be four finite numbers [s, tx, ty, tz]")
            elif t[0] <= 0 or t[0] > 1000:
                c.add("transform[0]", "the scale must be above 0 and at most 1000")

    if "gates" in root:
        gates = c.array(root["gates"], "gates", 1, MAX_GATES)
        seen: set[str] = set()
        for i, g in enumerate(gates or []):
            path = _join("gates", i)
            rec = c.record(g, path)
            if rec is None:
                continue
            c.keys(rec, path, ("id", "shape", "pos", "quat", "direction"))
            gid = c.string(rec.get("id"), _join(path, "id"), pattern=GATE_ID) if "id" in rec else None
            if gid is not None:
                if gid in seen:
                    c.add(_join(path, "id"), f"'{gid}' is used twice")
                seen.add(gid)
            if "shape" in rec:
                _shape(c, rec["shape"], _join(path, "shape"))
            if "pos" in rec:
                c.vec3(rec["pos"], _join(path, "pos"))
            if "quat" in rec:
                q = rec["quat"]
                if not isinstance(q, list) or len(q) != 4 or not all(_is_num(x) for x in q):
                    c.add(_join(path, "quat"), "must be four finite numbers [w, x, y, z]")
                elif abs(math.sqrt(sum(x * x for x in q)) - 1) > 1e-3:
                    c.add(_join(path, "quat"), "must be a unit quaternion")
            if "direction" in rec:
                c.one_of(rec["direction"], _join(path, "direction"), ("forward", "any"))

    if "laps" in root:
        c.number(root["laps"], "laps", 1, 99, integer=True)

    if "start" in root and root["start"] is not None:
        st = c.record(root["start"], "start")
        if st is not None:
            c.keys(st, "start", ("pos", "yawDeg"))
            if "pos" in st:
                c.vec3(st["pos"], "start.pos")
            if "yawDeg" in st:
                c.number(st["yawDeg"], "start.yawDeg", -360, 360)

    author = None
    if "author" in root:
        a = c.record(root["author"], "author")
        if a is not None:
            c.keys(a, "author", ("kind", "name"))
            author = c.one_of(a.get("kind"), "author.kind", ("person", "agent", "generator")) if "kind" in a else None
            name = c.string(a.get("name"), "author.name", 1, 80) if "name" in a else None
            if name is not None and CONTROL.search(name):
                c.add("author.name", "must not contain control characters")

    gen_name = None
    if "generator" in root and root["generator"] is not None:
        g = c.record(root["generator"], "generator")
        if g is not None:
            c.keys(g, "generator", ("name", "version", "seed", "params"))
            gen_name = c.string(g.get("name"), "generator.name", 1, 80) if "name" in g else None
            if "version" in g:
                c.string(g["version"], "generator.version", 1, 40)
            if "seed" in g and g["seed"] is not None:
                c.number(g["seed"], "generator.seed", integer=True)
            if isinstance(g.get("params"), dict):
                _params(c, g["params"])
            elif "params" in g:
                c.add("generator.params", "must be an object")

    if "created" in root:
        created = c.string(root["created"], "created")
        if created is not None and not _iso_ok(created):
            c.add("created", "must be an ISO 8601 date and time with a zone")

    # the contract of server tracks (plan section 7, tracks-plan 2.6 and 2.8), on top of the format. The server replaces
    # id, version, parent and created with its own (the route says which version a body becomes), so the body's version is
    # only held to the format; a generated course never names a parent, a pilot's edit or fork may.
    if scene is not None:
        if scene[0] is not None and scene[0] != "scan":
            c.add("scene.kind", "must be 'scan'")
        if scene[1] is not None and not SCENE_ID.fullmatch(scene[1]):
            c.add("scene.id", "must be 6-32 lowercase hex digits")
    a = root.get("author") if isinstance(root.get("author"), dict) else None
    if a is not None and author is not None and author not in AUTHOR_KINDS:
        c.add("author.kind", "must be 'generator' or 'person'")
    if author == "generator":
        if version == 1 and "parent" in root and root["parent"] is not None:
            c.add("parent", "must be null for a generated course (it is no fork)")
        if title is not None and not TITLE.fullmatch(title):
            c.add("title", f"must match {TITLE.pattern}")
        # lane review TR-14 f: no free text from one pilot is served to everyone under the generator's name
        if isinstance(a.get("name"), str) and a.get("name") != GENERATOR_NAME:
            c.add("author.name", f"must be '{GENERATOR_NAME}'")
        if "generator" in root and root["generator"] is None:
            c.add("generator", "must name the generator")
    elif author == "person":
        # R6: the name the pilot typed, and the pilot's own title (tracks-plan 2.8); no other personal data exists here
        if not isinstance(a.get("name"), str):
            c.add("author.name", "a pilot's course must carry the name the pilot typed")
        else:
            _text(c, "author.name", a["name"], NAME_LEN, NAME_EXTRA)
        if title is not None:
            _text(c, "title", title, TITLE_LEN, TITLE_EXTRA)
    if gen_name is not None and gen_name != GENERATOR_NAME:
        c.add("generator.name", f"must be '{GENERATOR_NAME}'")
    if isinstance(root.get("gates"), list) and len(root["gates"]) > SERVER_MAX_GATES:
        c.add("gates", f"must hold at most {SERVER_MAX_GATES} gates on the server")
    _bounds(c, root)
    return c.issues


def _text(c: _Collector, path: str, s: str, length: tuple[int, int], extra: str) -> None:
    """A text one pilot types and every pilot reads (tracks-plan 2.8): NFC, letters, marks, digits and a few signs, no web
    address, no double or edge spaces, not on the short blocklist. The TS twin is textIssues in packages/tracks/src/server.ts."""
    if unicodedata.normalize("NFC", s) != s:
        c.add(path, "must be in Unicode NFC")
        return
    n = _js_len(s)
    if n < length[0] or n > length[1]:
        c.add(path, f"must have {length[0]}-{length[1]} characters")
    if s != s.strip(" ") or "  " in s:
        c.add(path, "must not start or end with a space or hold two spaces together")
    low = s.lower()
    if "://" in low or "www." in low:
        c.add(path, "must not hold a web address")
    if any(not (unicodedata.category(ch)[0] in "LMN" or ch in extra) for ch in s):
        c.add(path, f"may hold only letters, digits and the signs {extra!r}")
    if any(w in low for w in BLOCKLIST):
        c.add(path, "holds a word that is not allowed")


def _flat(v) -> bool:
    return v is None or isinstance(v, bool) or _is_num(v) or (isinstance(v, str) and _js_len(v) <= PARAM_TEXT_MAX)


def _params(c: _Collector, p: dict) -> None:
    """generator.params: only the generator's own keys, flat values, proof null or {ok, marginM, pathM} (no arrays, depth 2)."""
    for k, v in p.items():
        path = f"generator.params.{k}" if isinstance(k, str) and len(k) <= 40 else "generator.params"
        if k not in PARAM_KEYS:
            c.add(path, "is not a known key")
        elif k == "proof" and isinstance(v, dict):
            for pk, pv in v.items():
                if pk not in PROOF_KEYS or not (isinstance(pv, bool) or _is_num(pv)):
                    c.add(f"{path}.{pk}" if isinstance(pk, str) and len(pk) <= 40 else path, "is not a known key or not a flat value")
        elif not _flat(v):
            c.add(path, f"must be a number, a boolean, null or a text of at most {PARAM_TEXT_MAX} characters")


def _bounds(c: _Collector, root: dict) -> None:
    """Positions inside MAX_COORD and legs at most MAX_LEG_M flown m, so lengthM is finite and a course stays near its scan."""
    gates = root.get("gates") if isinstance(root.get("gates"), list) else []
    pts = []
    for i, g in enumerate(gates):
        shape = g.get("shape") if isinstance(g, dict) else None
        if isinstance(shape, dict):   # tracks-plan 2.8: a gate is 0.05-20 m across on the server (the format allows 100)
            big = shape.get("diameter", shape.get("side"))
            if _is_num(big) and big > MAX_GATE_SIZE_M:
                c.add(f"gates[{i}].shape", f"must be at most {MAX_GATE_SIZE_M:g} m across on the server")
        pos = g.get("pos") if isinstance(g, dict) else None
        if isinstance(pos, list) and len(pos) == 3 and all(_is_num(x) for x in pos):
            if any(abs(x) > MAX_COORD for x in pos):
                c.add(f"gates[{i}].pos", f"must be within {MAX_COORD:g} of the origin")
            else:
                pts.append((i, pos))
    st = root.get("start")
    if isinstance(st, dict) and isinstance(st.get("pos"), list) and len(st["pos"]) == 3 and all(_is_num(x) for x in st["pos"]):
        if any(abs(x) > MAX_COORD for x in st["pos"]):
            c.add("start.pos", f"must be within {MAX_COORD:g} of the origin")
    t = root.get("transform")
    s = t[0] if isinstance(t, list) and len(t) == 4 and _is_num(t[0]) and 0 < t[0] <= 1000 else None
    if s is None or not pts or len(pts) != len(gates):
        return
    legs = list(zip(pts, pts[1:]))
    if _is_num(root.get("laps")) and root["laps"] > 1 and len(pts) > 1:
        legs.append((pts[-1], pts[0]))
    for (i, a), (_, b) in legs:
        if math.dist(a, b) * s > MAX_LEG_M:
            c.add(f"gates[{i}]", f"the leg to the next gate must be at most {MAX_LEG_M:g} m")
            return


def _reject_constant(name: str):
    raise ValueError(f"{name} is not JSON")


def parse_track(raw: bytes):
    """Bytes -> (obj, issues). NaN and Infinity are refused the way JSON.parse refuses them."""
    try:
        obj = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except RecursionError:   # thousands of nested brackets (lane review TR-9)
        return None, [("", "not valid JSON: nested too deep")]
    except (UnicodeDecodeError, ValueError) as e:
        return None, [("", f"not valid JSON: {str(e)[:120]}")]
    return obj, validate_track(obj)


def path_length_m(track: dict) -> float:
    """The course's length in the flown frame: gate to gate in order (and back to the first when it has laps), times the scale."""
    pts = [g["pos"] for g in track["gates"]]
    if track.get("laps", 1) > 1 and len(pts) > 1:
        pts = pts + [pts[0]]
    d = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    return round(d * float(track["transform"][0]), 1)


# ----------------------------------------------------------------------------- durable files

def _fsync_file(f) -> None:
    f.flush()
    os.fsync(f.fileno())


def _fsync_dir(path: Path) -> None:
    try:
        fd = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def _write_bytes(path: Path, data: bytes) -> None:
    """Whole file or nothing: a temporary file beside it, fsync, os.replace, fsync of the directory."""
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(data)
        _fsync_file(f)
    for i in range(8):
        try:
            os.replace(tmp, path)
            break
        except PermissionError:
            if i == 7:
                raise
            time.sleep(0.02 * (i + 1))
    _fsync_dir(path.parent)


def _etag(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest()[:32] + '"'


def wilson(up: int, down: int, z: float = 1.96) -> float:
    """Lower bound of the Wilson interval of up/(up+down) at 95 % (tracks-plan 2.9); 0 without votes."""
    n = up + down
    if n <= 0:
        return 0.0
    p = up / n
    return (p + z * z / (2 * n) - z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)


def _now_iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _mark(author: dict | None, admin: bool = False) -> dict:
    """The authorship mark of a version (tracks-plan 2.6): kind generator, pilot or admin, and only the name the pilot typed."""
    if admin:
        return {"kind": "admin", "name": None}
    if isinstance(author, dict) and author.get("kind") == "person":
        return {"kind": "pilot", "name": author.get("name")}
    return {"kind": "generator", "name": None}


VOTER = re.compile(r"[0-9a-f]{32}")      # the browser's random 128-bit voter id, as hex
WALLS_DIGEST = re.compile(r"[0-9a-f]{16,64}")


class TrackStore:
    """The courses on disk. root() is DATA_DIR (read at each call, as the server's tests swap it).

    DATA_DIR/tracks/<scene>/<id>/v<n>.json  the versions (immutable once written)
    DATA_DIR/tracks/<scene>/<id>/meta.json  authorship, token hash, hidden, votes, broken reports
    DATA_DIR/tracks/<scene>/index.json      {v: 2, tracks: [rows]} incl. hidden ones; rebuilt from the meta files when lost
    A train-1 course (v1.json without meta.json) is read as a generated course without an edit token."""

    def __init__(self, root: Callable[[], Path], free_bytes: Callable[[], int] | None = None, min_free_bytes: Callable[[], int] | None = None,
                 now: Callable[[], float] = time.time, limits: dict | None = None) -> None:
        self.root = root
        self.free_bytes = free_bytes or (lambda: self._disk_free())
        self.min_free_bytes = min_free_bytes or (lambda: LIMITS["min_free_bytes"])
        self.now = now
        self.limits = {**LIMITS, **(limits or {})}
        self.lock = threading.RLock()

    def _dir(self) -> Path:
        return Path(self.root()) / "tracks"

    def _disk_free(self) -> int:
        p = Path(self.root())
        try:
            return shutil.disk_usage(p if p.exists() else p.anchor or "/").free
        except OSError:
            return 0

    def _salt(self) -> bytes:
        """The key of the voter and address hashes (made once, kept on the volume; no raw id or address is stored)."""
        f = self._dir() / "salt.bin"
        try:
            k = f.read_bytes()
            if len(k) == 32:
                return k
        except OSError:
            pass
        f.parent.mkdir(parents=True, exist_ok=True)
        k = secrets.token_bytes(32)
        _write_bytes(f, k)
        return k

    def _hash(self, kind: str, value: str) -> str:
        return hmac.new(self._salt(), f"{kind}:{value}".encode(), hashlib.sha256).hexdigest()[:32]

    # -- one track
    def _tdir(self, tid: str) -> Path:
        m = SERVER_ID.fullmatch(tid or "")
        if not m:
            raise TrackError(404, "not-found")
        return self._dir() / m.group(1) / tid

    def _meta(self, tid: str) -> dict:
        """The track's meta; a train-1 dir with only v1.json is read as a generated course without a token."""
        d = self._tdir(tid)
        try:
            meta = json.loads((d / "meta.json").read_bytes())
            if isinstance(meta, dict) and meta.get("id") == tid and meta.get("versions"):
                return meta
        except (OSError, ValueError):
            pass
        try:
            t = json.loads((d / "v1.json").read_bytes())
        except (OSError, ValueError):
            raise TrackError(404, "not-found") from None
        mark = _mark(t.get("author"))
        return {"id": tid, "scene": tid.rsplit("-", 1)[0], "created": t.get("created"), "tokenSha256": None, "hidden": False,
                "creator": mark, "origin": None, "parent": None, "versions": [{"n": 1, "created": t.get("created"), "editor": mark, **_summary(t)}],
                "voters": {}, "addr": {}, "day": "", "broken": {}}

    def _put(self, meta: dict) -> dict:
        """Write the meta and the track's row in the scene's index."""
        d = self._tdir(meta["id"])
        _write_bytes(d / "meta.json", _compact(meta))
        row = _row(meta)
        self._index(meta["scene"], [r for r in self.rows(meta["scene"], hidden=True) if r["id"] != meta["id"]] + [row])
        return row

    def _index(self, scene: str, rows: list[dict]) -> None:
        rows.sort(key=lambda r: (r["created"], r["id"]), reverse=True)
        _write_bytes(self._dir() / scene / "index.json", _compact({"v": 2, "tracks": rows}))

    def _drop_row(self, scene: str, tid: str) -> None:
        self._index(scene, [r for r in self.rows(scene, hidden=True) if r["id"] != tid])

    def _visible(self, meta: dict) -> dict:
        if meta.get("hidden"):
            raise TrackError(404, "not-found")
        return meta

    # -- rows
    def _rows_from_files(self, scene: str) -> list[dict]:
        rows = []
        sdir = self._dir() / scene
        if not sdir.is_dir():
            return rows
        for d in sdir.iterdir():
            if d.is_dir() and SERVER_ID.fullmatch(d.name):
                try:
                    rows.append(_row(self._meta(d.name)))
                except (TrackError, KeyError, TypeError, ValueError):
                    continue
        return rows

    def rows(self, scene: str, hidden: bool = False) -> list[dict]:
        """The scene's rows (newest first); the index is rebuilt from the files when it is lost, unreadable or of train 1."""
        idx = self._dir() / scene / "index.json"
        rows = None
        try:
            data = json.loads(idx.read_bytes())
            if isinstance(data, dict) and data.get("v") == 2 and isinstance(data.get("tracks"), list):
                rows = [r for r in data["tracks"] if _row_ok(r)]
        except (OSError, ValueError):
            pass
        if rows is None:
            rows = [r for r in self._rows_from_files(scene) if _row_ok(r)]
            if rows:
                try:
                    _write_bytes(idx, _compact({"v": 2, "tracks": rows}))
                except (OSError, ValueError):
                    pass
        rows.sort(key=lambda r: (r["created"], r["id"]), reverse=True)
        return rows if hidden else [r for r in rows if not r.get("hidden")]

    def scenes(self) -> list[dict]:
        out = []
        if self._dir().is_dir():
            for d in sorted(self._dir().iterdir()):
                if d.is_dir() and SCENE_ID.fullmatch(d.name):
                    rows = self.rows(d.name, hidden=True)
                    out.append({"scene": d.name, "tracks": len(rows), "hidden": sum(1 for r in rows if r.get("hidden"))})
        return out

    def ordered(self, scene: str, sort: str) -> list[dict]:
        """sort=top: Wilson lower bound, ties by newer, courses with broken reports from enough clients left out; new: created."""
        rows = self.rows(scene)
        if sort == "new":
            return rows
        cut = self.limits["broken_hide_clients"]
        rows = [r for r in rows if r.get("broken", 0) < cut]
        return sorted(rows, key=lambda r: (-wilson(r.get("up", 0), r.get("down", 0)), _neg(r["created"]), _neg(r["id"])))

    # -- public routes
    def list(self, scene: str, if_none_match: str | None, sort: str = "top", page: int = 1) -> tuple[int, bytes, list]:
        if not SCENE_ID.fullmatch(scene or ""):
            raise TrackError(400, "bad-scene")
        if sort not in ("top", "new"):
            raise TrackError(400, "bad-sort")
        if not 1 <= page <= 1000:
            raise TrackError(400, "bad-page")
        rows = self.ordered(scene, sort)
        size = self.limits["page_size"]
        body = _compact({"v": 1, "sort": sort, "page": page, "pages": max(1, -(-len(rows) // size)),
                         "tracks": [_public(r) for r in rows[(page - 1) * size: page * size]]})
        tag = _etag(body)
        headers = [("Content-Type", "application/json"), ("Cache-Control", f"public, max-age={self.limits['list_max_age_s']}"), ("ETag", tag)]
        if if_none_match and tag in [x.strip() for x in if_none_match.split(",")]:
            return 304, b"", headers
        return 200, body, headers

    def file(self, track_id: str, n: int, if_none_match: str | None, admin: bool = False) -> tuple[int, bytes, list]:
        meta = self._meta(track_id)
        if not admin:
            self._visible(meta)
        if n not in [v["n"] for v in meta["versions"]]:
            raise TrackError(404, "not-found")
        try:
            data = (self._tdir(track_id) / f"v{n}.json").read_bytes()
        except OSError:
            raise TrackError(404, "not-found") from None
        tag = _etag(data)
        cache = "no-store" if admin else "public, max-age=31536000, immutable"
        headers = [("Content-Type", "application/json"), ("Cache-Control", cache), ("ETag", tag)]
        if if_none_match and tag in [x.strip() for x in if_none_match.split(",")]:
            return 304, b"", headers
        return 200, data, headers

    def _parse(self, raw: bytes) -> dict:
        if len(raw) > self.limits["body_bytes"]:
            raise TrackError(413, "too-large")
        obj, issues = parse_track(raw)
        if issues:
            raise TrackError(400, "invalid", issues=[f"{p}: {m}" if p else m for p, m in issues[:8]])
        if self.free_bytes() < self.min_free_bytes():
            raise TrackError(507, "disk-full")
        return obj

    def _write_version(self, obj: dict, tid: str, n: int, parent: dict | None) -> dict:
        """Give the body the server's id, version, parent and time; write v<n>.json; the version's summary."""
        obj["id"], obj["version"], obj["parent"], obj["created"] = tid, n, parent, _now_iso(self.now())
        # compact, and never more than the body was allowed to be (lane review TR-1: indent multiplied a nested body)
        data = _compact(obj, sort_keys=True)
        if len(data) > self.limits["body_bytes"]:
            raise TrackError(413, "too-large")
        s = _summary(obj)
        if not _is_num(s["lengthM"]):
            raise TrackError(400, "invalid", issues=["gates: the length of the course is not a finite number"])
        d = self._tdir(tid)
        d.mkdir(parents=True, exist_ok=True)
        _write_bytes(d / f"v{n}.json", data + b"\n")
        return {"n": n, "created": obj["created"], **s}

    def create(self, raw: bytes) -> dict:
        """A new course (v1) or a fork of another one (v1 with `parent` = the source's id and version): 201 {id, version,
        editToken}. The token is answered once; only its sha256 is kept. A fork keeps the source's origin (created by)."""
        obj = self._parse(raw)
        scene = obj["scene"]["id"]
        # lane review TK-11 a: a generated course never has a parent, at any version the body names
        if obj.get("parent") is not None and isinstance(obj.get("author"), dict) and obj["author"].get("kind") == "generator":
            raise TrackError(400, "bad-parent")
        with self.lock:
            origin = parent = None
            if obj.get("parent") is not None:
                try:
                    src = self._meta(obj["parent"]["id"])
                except TrackError:
                    src = None
                if src is None or src.get("hidden") or src["scene"] != scene or obj["parent"]["version"] not in [v["n"] for v in src["versions"]]:
                    raise TrackError(400, "bad-parent")
                parent = {"id": src["id"], "version": obj["parent"]["version"]}
                origin = src.get("origin") or {"id": src["id"], "version": src["versions"][0]["n"], "creator": src["creator"]}
            tid = f"{scene}-{secrets.token_hex(4)}"
            while self._tdir(tid).exists():
                tid = f"{scene}-{secrets.token_hex(4)}"
            token = secrets.token_urlsafe(24)
            mark = _mark(obj.get("author"))
            ver = self._write_version(obj, tid, 1, parent)
            meta = {"id": tid, "scene": scene, "created": ver["created"], "tokenSha256": hashlib.sha256(token.encode()).hexdigest(),
                    "hidden": False, "creator": mark, "origin": origin, "parent": parent, "versions": [{**ver, "editor": mark}],
                    "voters": {}, "addr": {}, "day": "", "broken": {}}
            self._put(meta)
            self._cap(scene)
        return {"id": tid, "version": 1, "editToken": token}

    def _cap(self, scene: str) -> None:
        """At most tracks_per_scene visible courses a scene: the oldest unrated one is hidden first, then the lowest rated
        (tracks-plan 2.8; lane review TR-6: a refusal for ever made "Save for everyone" dead in a full scene)."""
        rows = self.rows(scene)
        over = len(rows) - self.limits["tracks_per_scene"]
        if over <= 0:
            return
        victims = sorted(rows, key=lambda r: (r.get("up", 0) + r.get("down", 0) > 0, wilson(r.get("up", 0), r.get("down", 0)), r["created"]))[:over]
        for r in victims:
            meta = self._meta(r["id"])
            meta["hidden"] = "cap"
            self._put(meta)

    def add_version(self, tid: str, token: str | None, raw: bytes, admin: bool = False) -> dict:
        """A new version of a course: the owner's token (X-Track-Token) or the admin. 201 {id, version}."""
        with self.lock:
            meta = self._meta(tid)
            if not admin:
                self._visible(meta)
                want = meta.get("tokenSha256")
                got = hashlib.sha256((token or "").encode()).hexdigest()
                if not token or not isinstance(want, str) or not hmac.compare_digest(want, got):
                    raise TrackError(403, "token")
            obj = self._parse(raw)
            if obj["scene"]["id"] != meta["scene"]:
                raise TrackError(400, "scene-mismatch")
            if len(meta["versions"]) >= self.limits["versions_per_track"]:
                raise TrackError(409, "too-many-versions")
            # a number is never given twice (a file once served is cached as immutable), and the parent is the number before
            # it, as the format's succession wants, even when the admin deleted that version
            n = max([meta.get("top", 0)] + [v["n"] for v in meta["versions"]]) + 1
            ver = self._write_version(obj, tid, n, {"id": tid, "version": n - 1})
            meta["top"] = n
            meta["versions"].append({**ver, "editor": _mark(obj.get("author"), admin)})
            self._put(meta)
        return {"id": tid, "version": ver["n"]}

    def vote(self, tid: str, raw: bytes, client: str) -> dict:
        """{v: 1|-1|0, voter}: one vote per voter id per course (a new one replaces it, 0 takes it back) and at most one voter
        per client address per course per day (tracks-plan 2.9). Only keyed hashes of both are kept."""
        body = _small(raw)
        v, voter = body.get("v"), body.get("voter")
        if v not in (1, -1, 0) or isinstance(v, bool) or not isinstance(voter, str) or not VOTER.fullmatch(voter):
            raise TrackError(400, "bad-vote")
        # stage K2 (tracks-plan 2.9): an up or down vote carries the pilot's completed lap of the course, in ms; taking a vote
        # back (0) does not. The page sends its best lap (course/editor/rules.ts lapOf); a vote without one is refused.
        lap = body.get("lap")
        if v != 0 and (not isinstance(lap, int) or isinstance(lap, bool) or not LAP_MIN_MS <= lap <= LAP_MAX_MS):
            raise TrackError(403, "lap-first")
        with self.lock:
            meta = self._visible(self._meta(tid))
            vh, ah = self._hash("voter", voter), self._hash("addr", f"{tid}:{client}")
            # lane review TK-8: the address's voter is kept for the life of the course (it was cleared each UTC day, so one
            # address added one vote a day with a fresh voter id); the newest VOTE_ADDR_CAP bindings are kept
            addr = meta.setdefault("addr", {})
            if addr.get(ah, vh) != vh:
                raise TrackError(429, "address-voted")
            addr.pop(ah, None)
            addr[ah] = vh
            while len(addr) > VOTE_ADDR_CAP:
                addr.pop(next(iter(addr)))
            if v == 0:
                meta["voters"].pop(vh, None)
            else:
                meta["voters"][vh] = v
            row = self._put(meta)
        return {"id": tid, "v": v, "up": row["up"], "down": row["down"], "rating": round(wilson(row["up"], row["down"]), 4)}

    def broken(self, tid: str, raw: bytes, client: str) -> dict:
        """{gate, wallsDigest}: a client's own check of the course failed on these walls (tracks-plan 2.8; the server side of
        lane review TR-13/TR-8). Distinct client addresses are counted per walls digest; enough of them leave the course out
        of sort=top until the admin looks."""
        body = _small(raw)
        gate, digest = body.get("gate"), body.get("wallsDigest")
        if not isinstance(gate, int) or isinstance(gate, bool) or not 0 <= gate < SERVER_MAX_GATES \
                or not isinstance(digest, str) or not WALLS_DIGEST.fullmatch(digest):
            raise TrackError(400, "bad-report")
        with self.lock:
            meta = self._visible(self._meta(tid))
            seen = meta["broken"].setdefault(digest, [])
            ah = self._hash("addr", f"{tid}:{client}")
            if ah not in seen and len(seen) < 50:
                seen.append(ah)
            while len(meta["broken"]) > 20:   # the oldest digest goes (dicts keep their insertion order)
                meta["broken"].pop(next(iter(meta["broken"])))
            row = self._put(meta)
        return {"id": tid, "broken": row["broken"]}

    # -- the admin's actions (tracks_admin.py)
    def set_hidden(self, tid: str, hidden: bool) -> dict:
        with self.lock:
            meta = self._meta(tid)
            meta["hidden"] = bool(hidden)
            return self._put(meta)

    def reset(self, tid: str, what: str) -> dict:
        with self.lock:
            meta = self._meta(tid)
            if what == "votes":
                meta["voters"], meta["addr"] = {}, {}
            else:
                meta["broken"] = {}
            return self._put(meta)

    def delete(self, tid: str, n: int | None = None) -> dict:
        """Delete one version (n) or the whole course; the last version going takes the course with it."""
        with self.lock:
            meta = self._meta(tid)
            if n is not None:
                if n not in [v["n"] for v in meta["versions"]]:
                    raise TrackError(404, "not-found")
                if len(meta["versions"]) > 1:
                    meta["versions"] = [v for v in meta["versions"] if v["n"] != n]
                    (self._tdir(tid) / f"v{n}.json").unlink(missing_ok=True)
                    return {"deleted": "version", "row": self._put(meta)}
            shutil.rmtree(self._tdir(tid), ignore_errors=True)
            self._drop_row(meta["scene"], tid)
            return {"deleted": "track"}


def _neg(s: str) -> tuple:
    return tuple(-ord(ch) for ch in s)


def _small(raw: bytes) -> dict:
    if len(raw) > 1024:
        raise TrackError(413, "too-large")
    try:
        v = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise TrackError(400, "bad-json") from None
    if not isinstance(v, dict):
        raise TrackError(400, "bad-json")
    return v


def _summary(t: dict) -> dict:
    return {"title": t["title"], "gates": len(t["gates"]), "lengthM": path_length_m(t)}


def _row(meta: dict) -> dict:
    """The index row of a course (all of it; _public cuts what every pilot sees). created by = the origin's creator for a
    fork, else the first version's; edited by = the latest version's author when the course is a fork or a later version."""
    first, last = meta["versions"][0], meta["versions"][-1]
    origin = meta.get("origin")
    edited = origin is not None or last["n"] > 1
    up = sum(1 for x in meta.get("voters", {}).values() if x == 1)
    down = sum(1 for x in meta.get("voters", {}).values() if x == -1)
    return {"id": meta["id"], "version": last["n"], "versions": [v["n"] for v in meta["versions"]], "title": last["title"],
            "gates": last["gates"], "lengthM": last["lengthM"], "created": first["created"], "edited": last["created"] if edited else None,
            "creator": origin["creator"] if origin else meta["creator"], "editor": last["editor"] if edited else None,
            "parent": meta.get("parent"), "origin": {"id": origin["id"], "version": origin["version"]} if origin else None,
            "up": up, "down": down, "broken": max((len(x) for x in meta.get("broken", {}).values()), default=0),
            "hidden": meta.get("hidden") or False, "editable": bool(meta.get("tokenSha256"))}


def _public(r: dict) -> dict:
    out = {k: r[k] for k in ("id", "version", "title", "gates", "lengthM", "created", "edited", "creator", "editor", "parent", "origin", "up", "down", "broken")}
    out["rating"] = round(wilson(r["up"], r["down"]), 4)
    return out


def _compact(obj, sort_keys: bool = False) -> bytes:
    """JSON a browser's JSON.parse reads: no NaN or Infinity (ValueError instead), no indent."""
    return json.dumps(obj, separators=(",", ":"), sort_keys=sort_keys, ensure_ascii=False, allow_nan=False).encode("utf-8")


def _row_ok(r) -> bool:
    """A list row a client can read: its length is a finite number (lane review TR-2: one Infinity broke a scene's list)."""
    return isinstance(r, dict) and isinstance(r.get("id"), str) and _is_num(r.get("lengthM")) and isinstance(r.get("gates"), int) \
        and isinstance(r.get("created"), str)
