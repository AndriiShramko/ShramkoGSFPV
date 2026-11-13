"""Protocol rooms/1 (docs/rooms-protocol.md): the binary pose and snapshot, the JSON control messages, and the
validators of what a pilot sends (nickname, room name, scene, the share link's scene settings).

Byte order is little-endian everywhere (a browser's DataView with littleEndian=true reads it as is).
"""
from __future__ import annotations

import math
import re
import struct
import unicodedata
from decimal import ROUND_HALF_UP, Decimal

VERSION = "rooms/1"

KIND_POSE = 1
KIND_SNAPSHOT = 2

# u8 kind, u8 flags, u16 seq, u32 tick, f32 x3 pos, i16 x4 quat (x 32767), i16 x3 vel (cm/s), u16 throttle
POSE = struct.Struct("<BBHI3f4h3hH")
POSE_BYTES = POSE.size  # 36, asserted by tests/test_protocol.py
# u8 kind, u32 serverMs, u8 count, then count x (u8 slot + 36 B pose)
SNAP_HEAD = struct.Struct("<BIB")
SNAP_ENTRY = 1 + POSE_BYTES

FLAG_ARMED, FLAG_CRASHED, FLAG_PAUSED, FLAG_IN_RACE = 1, 2, 4, 8

QUAT_SCALE = 32767
I16 = (-32768, 32767)


def _clamp(v: float, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(round(v))))


def encode_pose(p: dict) -> bytes:
    """A pose dict ({flags, seq, tick, pos[3], quat[4] x y z w, vel[3] m/s, throttle 0..1}) as 36 bytes."""
    q = [_clamp(c * QUAT_SCALE, *I16) for c in p["quat"]]
    v = [_clamp(c * 100.0, *I16) for c in p["vel"]]
    t = _clamp(p["throttle"] * 65535.0, 0, 65535)
    return POSE.pack(KIND_POSE, p.get("flags", 0) & 0xFF, p["seq"] & 0xFFFF, p["tick"] & 0xFFFFFFFF,
                     *[float(c) for c in p["pos"]], *q, *v, t)


def decode_pose(b: bytes) -> dict:
    """36 bytes back to a pose dict; `raw` keeps the integers as sent (the fixtures compare them exactly)."""
    if len(b) != POSE_BYTES or b[0] != KIND_POSE:
        raise ValueError("not a pose")
    kind, flags, seq, tick, px, py, pz, qx, qy, qz, qw, vx, vy, vz, thr = POSE.unpack(b)
    return {"flags": flags, "seq": seq, "tick": tick, "pos": [px, py, pz],
            "quat": [c / QUAT_SCALE for c in (qx, qy, qz, qw)], "vel": [c / 100.0 for c in (vx, vy, vz)],
            "throttle": thr / 65535.0, "raw": {"quat": [qx, qy, qz, qw], "vel": [vx, vy, vz], "throttle": thr}}


def is_pose(b: bytes) -> bool:
    """What the server checks before it keeps a pose: the size and the kind byte (it relays the bytes as sent;
    a client ignores a pose whose position is not finite)."""
    return len(b) == POSE_BYTES and b[0] == KIND_POSE


def encode_snapshot(server_ms: int, poses: list[tuple[int, bytes]]) -> bytes:
    """One room tick: (slot, pose bytes) of every member that has sent a pose."""
    return SNAP_HEAD.pack(KIND_SNAPSHOT, server_ms & 0xFFFFFFFF, len(poses)) + b"".join(
        bytes([slot]) + pose for slot, pose in poses)


def decode_snapshot(b: bytes) -> dict:
    kind, ms, count = SNAP_HEAD.unpack_from(b, 0)
    if kind != KIND_SNAPSHOT or len(b) != SNAP_HEAD.size + count * SNAP_ENTRY:
        raise ValueError("not a snapshot")
    out = []
    for i in range(count):
        o = SNAP_HEAD.size + i * SNAP_ENTRY
        out.append({"slot": b[o], "pose": decode_pose(b[o + 1:o + SNAP_ENTRY])})
    return {"serverMs": ms, "members": out}


# ---------------------------------------------------------------- what a pilot sends
NICK_LEN = (2, 20)        # rooms-plan.md 2.5
NAME_LEN = (2, 40)        # estimate: a room name a list row can show
_NICK_PUNCT = set(" -_.'")
# a short blocklist (rooms-plan.md 2.5): names that pretend to speak for the site; matched without case,
# spaces and punctuation. Not a word filter: free text is not offered (quick phrases only, decision 2).
_BLOCK = ("admin", "administrator", "moderator", "gsfpv", "shramko", "system", "official")


def clean_text(v, lo: int, hi: int) -> str | None:
    """A nickname or a room name by the rule of tracks-plan.md 2.8: NFC, Unicode letters and digits, space and
    -_.' only, no control characters, no '://' or 'www.', lo..hi characters after trimming; else None."""
    if not isinstance(v, str):
        return None
    s = unicodedata.normalize("NFC", v).strip()
    s = re.sub(r" {2,}", " ", s)
    if not lo <= len(s) <= hi:
        return None
    for ch in s:
        if ch in _NICK_PUNCT:
            continue
        if unicodedata.category(ch)[0] not in ("L", "N"):
            return None
    low = s.lower()
    if "://" in low or "www." in low:
        return None
    if not any(unicodedata.category(ch)[0] in ("L", "N") for ch in s):
        return None
    return s


def clean_nick(v) -> str | None:
    s = clean_text(v, *NICK_LEN)
    if s is None:
        return None
    bare = re.sub(r"[ \-_.']", "", s.lower())
    if any(w in bare for w in _BLOCK):
        return None
    return s


SCENE_ID_RE = re.compile(r"[0-9a-f]{6,32}")      # apps/api/server.py _ID_RE
ROOM_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")     # secrets.token_urlsafe(8), as share ids
COURSE_RE = re.compile(r"[0-9A-Za-z._-]{1,64}")   # opaque in train 1 ('g1.<seed>' or '<id>.v<n>' in train 2)

# ---- port of apps/api/server.py link_render and shared_settings (lines 1104-1173 on train1-base); the share
# link's settings, read as strictly as the page reads them (packages/scenes/test/fixtures/shared-links.json)
_BUDGET_MIN_M, _BUDGET_MAX_M = 0.25, 32
_SHARED_SIZE = (0.25, 100.0)
_SHARED_FLOATERS_MAX = 64
_SHARED_WIND = {"fromDeg": (0.0, 360.0), "speed": (0.0, 30.0), "gust": (0.0, 20.0)}
_SHARED_CEILING = (-10000.0, 10000.0)
_SHARED_DRONE_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")


def link_render(r) -> dict | None:
    if not isinstance(r, dict):
        return None
    out: dict = {}
    b = r.get("budgetM")
    if not isinstance(b, bool) and isinstance(b, (int, float)) and math.isfinite(b) and _BUDGET_MIN_M <= b <= _BUDGET_MAX_M:
        out["budgetM"] = round(float(b), 4)
    if isinstance(r.get("stochastic"), bool):
        out["stochastic"] = r["stochastic"]
    return out or None


def _shared_num(v, lo: float, hi: float, places: int):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        return None
    r = float(Decimal(float(v)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))
    return r if lo <= r <= hi else None


def shared_settings(v) -> dict | None:
    if not isinstance(v, dict):
        return None
    out: dict = {}
    if (size := _shared_num(v.get("size"), *_SHARED_SIZE, 3)) is not None:
        out["size"] = size
    if v.get("walls") in ("on", "off"):
        out["walls"] = v["walls"]
    f = v.get("floaters")
    if isinstance(f, int) and not isinstance(f, bool) and 0 <= f <= _SHARED_FLOATERS_MAX:
        out["floaters"] = f
    w = v.get("wind")
    if w == "off":
        out["wind"] = "off"
    elif isinstance(w, dict):
        got = {k: _shared_num(w.get(k), *rng, 1) for k, rng in _SHARED_WIND.items()}
        if all(x is not None for x in got.values()):
            out["wind"] = got
    c = v.get("ceiling")
    if c == "off":
        out["ceiling"] = "off"
    elif (cm := _shared_num(c, *_SHARED_CEILING, 2)) is not None:
        out["ceiling"] = cm
    d = v.get("drone")
    if isinstance(d, str) and _SHARED_DRONE_RE.fullmatch(d):
        out["drone"] = d
    return out or None


def room_request(b) -> dict | None:
    """The body of POST /api/rooms as the room keeps it, or None when the scene is missing or wrong.
    {scene: {id, render?}, shared?, name?, listed?, course?}; unknown fields are ignored, a bad optional field is dropped."""
    if not isinstance(b, dict):
        return None
    sc = b.get("scene")
    if not isinstance(sc, dict) or not isinstance(sc.get("id"), str) or not SCENE_ID_RE.fullmatch(sc["id"]):
        return None
    scene: dict = {"id": sc["id"]}
    if render := link_render(sc.get("render")):
        scene["render"] = render
    out: dict = {"scene": scene, "name": clean_text(b.get("name"), *NAME_LEN) or "", "listed": b.get("listed") is True}
    if shared := shared_settings(b.get("shared")):
        out["shared"] = shared
    c = b.get("course")
    if isinstance(c, str) and COURSE_RE.fullmatch(c):
        out["course"] = c
    return out
