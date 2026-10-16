"""The admin's Outreach tab (owner's request 2026-10-16): how the simulator's posts in Facebook groups are doing.

The truth lives in the owner's vault (campaign files, git). This module is only the SHOW WINDOW:
`fbgroups.py push` builds one snapshot and sends it to `outreach_cli.py push -` (docker exec, stdin); the
snapshot replaces the single file DATA_DIR/outreach.json. Nothing is born on the server and nothing is
written over HTTP, so the two can never disagree for long, a lost server is restored by the next push, and
the data cannot grow: one file, hard ceilings, no history.

Snapshot v1 (the sample both sides test against: tests/fixtures/outreach-snapshot.sample.json):
  {"v":1,"campaign":"gsfpv","generated":ISO,"groups":[...],"posts":[...],"visits":{...}|null,"meta":{...}}
Ceilings (a snapshot over one is REFUSED, never cut): <=250 groups, <=600 posts, <=6 checks per post, text
<=200 characters, the file <=256 KB, v == 1, group id ^[A-Za-z0-9._-]{1,80}$. The check happens before the
atomic write, so a refused snapshot leaves the previous one untouched.

Routes (behind the admin's session; GET only, there is no write over HTTP), wired in server.py:
GET /api/admin/outreach                      the view: the snapshot plus everything worked out from it
GET /api/admin/outreach/export.csv?table=groups|posts      the table as a CSV attachment

Worked out here, at read time (so the formula lives in one place):
- score 0..100 of a group with >=1 post (None without; 0 when banned):
    50*pub_rate + 30*min(1, eng/50) + 20*(1 - removed_rate)
  pub_rate = published/posts, removed_rate = removed/posts (the group's counters), eng = the mean of
  reactions + 3*comments + 5*shares over the posts whose LATEST check is at age_h >= 24 (none -> 0).
  Same as fbgroups.py score_of(); the score inside the pushed snapshot is kept as `score_pushed` only.
- totals, the funnel (groups -> posted -> published -> removed), medians per format / language / topic /
  kind and format x language x topic, the "worth more work" ranking, the checks that are due now.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import statistics
import threading
import time
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import admin

FILE = "outreach.json"
VERSION = 1
MAX_BYTES = 256 * 1024
MAX_GROUPS = 250
MAX_POSTS = 600
MAX_CHECKS = 6
MAX_STR = 200
MAX_VISIT_KEYS = 200
MAX_VISIT_DAYS = 35
CHECKPOINTS_H = (1, 24, 72, 168, 720)
WORTH_MIN = 75.0          # a score from here, with nothing removed, is "worth more work"
RANKING_LEN = 8
STALE_H = 48              # a snapshot older than this is marked as old in the tab
MATURE_H = 24             # a check taken at least this long after the post counts for engagement
POSTING_VERDICTS = ("post", "post_image", "text_only")

TOP_KEYS = ("v", "campaign", "generated", "groups", "posts", "visits", "meta")
GROUP_KEYS = ("id", "name", "url", "lang", "members", "topic", "fit", "verdict", "wave", "policy", "state",
              "prior_sim_post", "last_post_at", "posts", "published", "removed", "best_reactions", "best_comments",
              "score", "note")
POLICY_KEYS = ("video", "images", "links", "self_promo", "post_approval")
POST_KEYS = ("id", "group", "group_name", "kind", "format", "lang", "sent_at", "state", "url", "link_placement",
             "first_comment", "angle", "checks", "note")
CHECK_KEYS = ("age_h", "state", "reactions", "comments", "shares", "views", "admin_action")
VISIT_KEYS = ("days", "by_content", "note")
META_KEYS = ("groups_total", "groups_researched", "waves")
POST_KINDS = ("post", "comment", "update_post")
POST_STATES = ("sent", "pending", "published", "removed", "declined", "failed")
FC_STATES = ("none", "posted", "blocked")
ADMIN_ACTIONS = ("none", "warning", "removed", "muted")

_CAMPAIGN_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,29}")
_GROUP_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,80}")
_POST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,40}")
_ENUM_RE = re.compile(r"[A-Za-z0-9_.:-]{1,40}")
_VISIT_KEY_RE = re.compile(r"[a-z0-9._-]{1,40}")
_TS_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z")
_URL_RE = re.compile(r"https://[^\s<>\"']{1,190}")

Response = tuple[int, bytes, list]


class BadSnapshot(ValueError):
    """A refused snapshot: `.reasons` lists what is wrong (at most 10), the previous snapshot is untouched."""

    def __init__(self, reasons: list[str]):
        self.reasons = reasons[:10]
        super().__init__("; ".join(self.reasons))


class _Errs:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, msg: str) -> None:
        if len(self.items) < 25:
            self.items.append(msg)

    def __bool__(self) -> bool:
        return bool(self.items)


# ---------------- validation: a snapshot is accepted whole or refused whole ----------------

def _reject_constant(name: str):
    raise ValueError(f"not JSON: {name}")


def parse_ts(s: str | None) -> datetime | None:
    """An ISO time ending in Z (the only form the snapshot uses), else None."""
    m = _TS_RE.fullmatch(s or "")
    if not m:
        return None
    try:
        y, mo, d, h, mi, se = (int(x) for x in m.groups()[:6])
        return datetime(y, mo, d, h, mi, se, tzinfo=timezone.utc)
    except ValueError:
        return None


def _clean(s: str) -> str:
    """Control and format characters out, every run of white space one space; never cut."""
    s = "".join(" " if unicodedata.category(c) in ("Cc", "Zl", "Zp") else c for c in s if unicodedata.category(c) not in ("Cf", "Cs"))
    return " ".join(s.split())


def _int(v, lo: int, hi: int, path: str, errs: _Errs, null: bool = False):
    if v is None and null:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        errs.add(f"{path} must be an integer {lo}..{hi}" + (" or null" if null else ""))
        return None
    return v


def _num(v, lo: float, hi: float, path: str, errs: _Errs, null: bool = False):
    if v is None and null:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
        errs.add(f"{path} must be a number {lo}..{hi}" + (" or null" if null else ""))
        return None
    return v


def _text(v, path: str, errs: _Errs, null: bool = True, required: bool = False):
    if v is None and null:
        return None
    if not isinstance(v, str):
        errs.add(f"{path} must be text" + (" or null" if null else ""))
        return None
    if len(v) > MAX_STR:
        errs.add(f"{path} is {len(v)} characters, the ceiling is {MAX_STR}")
        return None
    out = _clean(v)
    if required and not out:
        errs.add(f"{path} is empty")
    return out


def _enum(v, path: str, errs: _Errs, null: bool = True, allowed: tuple | None = None):
    if v is None and null:
        return None
    if not isinstance(v, str) or not _ENUM_RE.fullmatch(v) or (allowed is not None and v not in allowed):
        errs.add(f"{path} is not an allowed value" + (f" ({'|'.join(allowed)})" if allowed else ""))
        return None
    return v


def _url(v, path: str, errs: _Errs):
    if v is None:
        return None
    if not isinstance(v, str) or not _URL_RE.fullmatch(v):
        errs.add(f"{path} must be an https address (at most 200 characters) or null")
        return None
    return v


def _stamp(v, path: str, errs: _Errs, null: bool = True):
    if v is None and null:
        return None
    if not isinstance(v, str) or parse_ts(v) is None:
        errs.add(f"{path} must be an ISO time ending in Z" + (" or null" if null else ""))
        return None
    return v


def _keys(o, keys: tuple, path: str, errs: _Errs) -> bool:
    if not isinstance(o, dict):
        errs.add(f"{path} is not an object")
        return False
    missing = [k for k in keys if k not in o]
    unknown = [k for k in o if k not in keys]
    if missing or unknown:
        errs.add(f"{path}: keys differ from the contract (missing {missing}, unknown {unknown})")
        return False
    return True


def _group(g, i: int, errs: _Errs) -> dict | None:
    p = f"groups[{i}]"
    if not _keys(g, GROUP_KEYS, p, errs):
        return None
    gid = g["id"]
    if not isinstance(gid, str) or not _GROUP_ID_RE.fullmatch(gid):
        errs.add(f"{p}.id must match ^[A-Za-z0-9._-]{{1,80}}$")
    pol = g["policy"]
    policy: dict = {}
    if _keys(pol, POLICY_KEYS, f"{p}.policy", errs):
        policy = {k: _enum(pol[k], f"{p}.policy.{k}", errs) for k in POLICY_KEYS}
    out = {
        "id": gid, "name": _text(g["name"], f"{p}.name", errs, null=False, required=True), "url": _url(g["url"], f"{p}.url", errs),
        "lang": _enum(g["lang"], f"{p}.lang", errs), "members": _int(g["members"], 0, 10 ** 9, f"{p}.members", errs, True),
        "topic": _enum(g["topic"], f"{p}.topic", errs), "fit": _int(g["fit"], 1, 5, f"{p}.fit", errs, True),
        "verdict": _enum(g["verdict"], f"{p}.verdict", errs), "wave": _int(g["wave"], 1, 9, f"{p}.wave", errs, True),
        "policy": policy, "state": _enum(g["state"], f"{p}.state", errs, null=False),
        "prior_sim_post": _enum(g["prior_sim_post"], f"{p}.prior_sim_post", errs),
        "last_post_at": _stamp(g["last_post_at"], f"{p}.last_post_at", errs),
    }
    for k in ("posts", "published", "removed", "best_reactions", "best_comments"):
        out[k] = _int(g[k], 0, 10 ** 7, f"{p}.{k}", errs)
    out["score"] = _num(g["score"], 0, 100, f"{p}.score", errs, True)
    out["note"] = _text(g["note"], f"{p}.note", errs)
    if isinstance(out["published"], int) and isinstance(out["removed"], int) and isinstance(out["posts"], int) \
            and out["published"] + out["removed"] > out["posts"]:
        errs.add(f"{p}: published + removed is more than posts")
    return out


def _check(c, p: str, errs: _Errs) -> dict | None:
    if not _keys(c, CHECK_KEYS, p, errs):
        return None
    return {"age_h": _num(c["age_h"], 0, 100000, f"{p}.age_h", errs), "state": _enum(c["state"], f"{p}.state", errs),
            "reactions": _int(c["reactions"], 0, 10 ** 8, f"{p}.reactions", errs), "comments": _int(c["comments"], 0, 10 ** 8, f"{p}.comments", errs),
            "shares": _int(c["shares"], 0, 10 ** 8, f"{p}.shares", errs), "views": _int(c["views"], 0, 10 ** 10, f"{p}.views", errs, True),
            "admin_action": _enum(c["admin_action"], f"{p}.admin_action", errs, null=False, allowed=ADMIN_ACTIONS)}


def _post(r, i: int, errs: _Errs) -> dict | None:
    p = f"posts[{i}]"
    if not _keys(r, POST_KEYS, p, errs):
        return None
    pid = r["id"]
    if not isinstance(pid, str) or not _POST_ID_RE.fullmatch(pid):
        errs.add(f"{p}.id must match ^[A-Za-z0-9._-]{{1,40}}$")
    checks: list = []
    if not isinstance(r["checks"], list) or len(r["checks"]) > MAX_CHECKS:
        errs.add(f"{p}.checks must be a list of at most {MAX_CHECKS}")
    else:
        checks = [c for c in (_check(c, f"{p}.checks[{j}]", errs) for j, c in enumerate(r["checks"])) if c is not None]
        checks.sort(key=lambda c: c["age_h"] if c["age_h"] is not None else 0)
    gid = r["group"]
    if not isinstance(gid, str) or not _GROUP_ID_RE.fullmatch(gid):
        errs.add(f"{p}.group must match ^[A-Za-z0-9._-]{{1,80}}$")
    return {
        "id": pid, "group": gid, "group_name": _text(r["group_name"], f"{p}.group_name", errs, null=False),
        "kind": _enum(r["kind"], f"{p}.kind", errs, null=False, allowed=POST_KINDS), "format": _enum(r["format"], f"{p}.format", errs, null=False),
        "lang": _enum(r["lang"], f"{p}.lang", errs), "sent_at": _stamp(r["sent_at"], f"{p}.sent_at", errs, null=False),
        "state": _enum(r["state"], f"{p}.state", errs, null=False, allowed=POST_STATES), "url": _url(r["url"], f"{p}.url", errs),
        "link_placement": _enum(r["link_placement"], f"{p}.link_placement", errs), "first_comment": _enum(r["first_comment"], f"{p}.first_comment", errs, null=False, allowed=FC_STATES),
        "angle": _text(r["angle"], f"{p}.angle", errs), "checks": checks, "note": _text(r["note"], f"{p}.note", errs)}


def _visits(v, errs: _Errs) -> dict | None:
    if v is None:
        return None
    if not _keys(v, VISIT_KEYS, "visits", errs):
        return None
    by = v["by_content"]
    counts: dict = {}
    if not isinstance(by, dict) or len(by) > MAX_VISIT_KEYS:
        errs.add(f"visits.by_content must be an object of at most {MAX_VISIT_KEYS} keys")
    else:
        for k, n in by.items():
            if not _VISIT_KEY_RE.fullmatch(str(k)):
                errs.add(f"visits.by_content key {str(k)[:40]!r} must match ^[a-z0-9._-]{{1,40}}$")
            elif _int(n, 0, 10 ** 9, f"visits.by_content[{k}]", errs) is not None:
                counts[k] = n
    return {"days": _int(v["days"], 1, MAX_VISIT_DAYS, "visits.days", errs), "by_content": counts, "note": _text(v["note"], "visits.note", errs)}


def validate(doc) -> dict:
    """The canonical snapshot (contract key order, text cleaned) or BadSnapshot. Nothing is cut: a ceiling
    that is passed refuses the whole snapshot."""
    errs = _Errs()
    if not _keys(doc, TOP_KEYS, "snapshot", errs):
        raise BadSnapshot(errs.items)
    if type(doc["v"]) is not int or doc["v"] != VERSION:
        errs.add(f"v must be {VERSION}")
    campaign = doc["campaign"]
    if not isinstance(campaign, str) or not _CAMPAIGN_RE.fullmatch(campaign):
        errs.add("campaign must match ^[a-z0-9][a-z0-9_-]{0,29}$")
    generated = _stamp(doc["generated"], "generated", errs, null=False)
    if not isinstance(doc["groups"], list) or not isinstance(doc["posts"], list):
        errs.add("groups and posts must be lists")
        raise BadSnapshot(errs.items)
    if len(doc["groups"]) > MAX_GROUPS:
        errs.add(f"{len(doc['groups'])} groups, the ceiling is {MAX_GROUPS}")
    if len(doc["posts"]) > MAX_POSTS:
        errs.add(f"{len(doc['posts'])} posts, the ceiling is {MAX_POSTS}")
    if errs:
        raise BadSnapshot(errs.items)
    groups = [g for g in (_group(g, i, errs) for i, g in enumerate(doc["groups"])) if g is not None]
    posts = [r for r in (_post(r, i, errs) for i, r in enumerate(doc["posts"])) if r is not None]
    seen: set = set()
    for g in groups:
        if isinstance(g["id"], str):  # a bad id is already reported
            if g["id"] in seen:
                errs.add(f"group id {g['id']} is listed twice")
            seen.add(g["id"])
    pseen: set = set()
    for r in posts:
        if isinstance(r["id"], str):
            if r["id"] in pseen:
                errs.add(f"post id {r['id']} is listed twice")
            pseen.add(r["id"])
        if isinstance(r["group"], str) and r["group"] not in seen:
            errs.add(f"post {str(r['id'])[:40]} belongs to an unknown group {r['group'][:40]!r}")
    meta: dict = {}
    if _keys(doc["meta"], META_KEYS, "meta", errs):
        meta = {k: _int(doc["meta"][k], 0, 10 ** 7, f"meta.{k}", errs) for k in META_KEYS}
    visits = _visits(doc["visits"], errs)
    if errs:
        raise BadSnapshot(errs.items)
    out = {"v": VERSION, "campaign": campaign, "generated": generated, "groups": groups, "posts": posts, "visits": visits, "meta": meta}
    size = len(json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > MAX_BYTES:
        raise BadSnapshot([f"the snapshot is {size} bytes, the ceiling is {MAX_BYTES}"])
    return out


def parse(raw: bytes) -> dict:
    """Bytes -> canonical snapshot, or BadSnapshot (too big, not UTF-8 JSON, not an object, or invalid)."""
    if len(raw) > MAX_BYTES:
        raise BadSnapshot([f"the snapshot is {len(raw)} bytes, the ceiling is {MAX_BYTES}"])
    try:
        doc = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError):
        raise BadSnapshot(["the snapshot is not valid UTF-8 JSON"]) from None
    return validate(doc)


# ---------------- the one file ----------------

class StoreUnreadable(Exception):
    """outreach.json exists but cannot be read (the next push restores it)."""


class OutreachStore:
    """DATA_DIR/outreach.json: the last accepted snapshot plus the time it was received. Replaced whole by an
    atomic write (a temporary file, fsync, rename); read-only for the API process."""

    def __init__(self, data_dir: Callable[[], Path], clock: Callable[[], float] = time.time):
        self.data_dir, self.clock = data_dir, clock
        self._mu = threading.Lock()

    def path(self) -> Path:
        return self.data_dir() / FILE

    def _stamp(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))

    def put(self, raw: bytes) -> dict:
        """Check, then replace. A refused snapshot raises BadSnapshot before anything is written."""
        snap = parse(raw)
        with self._mu:
            old = None
            try:
                old = self.read().get("campaign")
            except StoreUnreadable:
                pass
            doc = {"received": self._stamp(), **snap}
            body = (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
            self.data_dir().mkdir(parents=True, exist_ok=True)
            try:
                admin.write_durable(self.path(), body)
            except OSError:
                self.path().with_name(FILE + ".tmp").unlink(missing_ok=True)
                raise
        return {"groups": len(snap["groups"]), "posts": len(snap["posts"]), "bytes": len(body), "campaign": snap["campaign"],
                "replaced_campaign": old if old and old != snap["campaign"] else None}

    def read(self) -> dict:
        """The stored document; {} when there is none; StoreUnreadable when it cannot be used."""
        try:
            text = self.path().read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except OSError as e:
            raise StoreUnreadable(str(e)) from e
        try:
            doc = json.loads(text)
            received = doc.pop("received")
            snap = validate(doc)
        except (ValueError, KeyError, AttributeError, BadSnapshot) as e:
            raise StoreUnreadable(f"{type(e).__name__}") from e
        return {**snap, "received": received}

    def clear(self) -> bool:
        with self._mu:
            had = self.path().exists()
            self.path().unlink(missing_ok=True)
            self.path().with_name(FILE + ".tmp").unlink(missing_ok=True)
        return had


# ---------------- worked out at read time ----------------

def eng_of(checks: list[dict]) -> float | None:
    """reactions + 3*comments + 5*shares of the LATEST check, if it was taken at age_h >= 24, else None."""
    if not checks:
        return None
    c = max(checks, key=lambda c: c["age_h"])
    if c["age_h"] < MATURE_H:
        return None
    return float(c["reactions"] + 3 * c["comments"] + 5 * c["shares"])


def score_of(posts: int, published: int, removed: int, engs: list[float], banned: bool) -> float | None:
    """50*pub_rate + 30*min(1, eng/50) + 20*(1 - removed_rate); None without a post, 0 when banned."""
    if posts <= 0:
        return None
    if banned:
        return 0.0
    eng = sum(engs) / len(engs) if engs else 0.0
    return round(50 * (published / posts) + 30 * min(1.0, eng / 50.0) + 20 * (1 - removed / posts), 1)


def _median(xs: list[float]) -> float | None:
    return round(float(statistics.median(xs)), 1) if xs else None


def _covered(cp: float, i: int, ages: list[float]) -> bool:
    lo = cp - max(0.25 * cp, 0.5)
    hi = CHECKPOINTS_H[i + 1] if i + 1 < len(CHECKPOINTS_H) else math.inf
    return any(lo <= x < hi for x in ages)


def _due(post: dict, now: datetime) -> dict | None:
    """The checkpoint to measure now (+1 h, +24 h, +72 h, +7 d, +30 d), as fbgroups.py `due`: an older gap
    cannot be measured afterwards, so only a checkpoint after the last covered one counts."""
    if post["state"] not in ("sent", "pending", "published"):
        return None
    sent = parse_ts(post["sent_at"])
    if sent is None:
        return None
    age = (now - sent).total_seconds() / 3600
    ages = [c["age_h"] for c in post["checks"]]
    reached = [(i, cp) for i, cp in enumerate(CHECKPOINTS_H) if age >= cp]
    last_cov = max([i for i, cp in reached if _covered(cp, i, ages)], default=-1)
    actionable = [cp for i, cp in reached if i > last_cov and not _covered(cp, i, ages)]
    if not actionable:
        return None
    nxt = next((cp for cp in CHECKPOINTS_H if age < cp), None)
    return {"post": post["id"], "group": post["group"], "name": post["group_name"], "state": post["state"],
            "age_h": round(age, 1), "due_cp_h": actionable[-1], "next_cp_h": nxt}


def _slice_rows(posts: list[dict], dims: tuple[str, ...]) -> list[dict]:
    """Posts grouped by the given fields; medians over the posts that have a mature check."""
    buckets: dict[tuple, list[dict]] = {}
    for r in posts:
        buckets.setdefault(tuple(r[d] or "unknown" for d in dims), []).append(r)
    rows = []
    for key, rs in buckets.items():
        m = [r for r in rs if r["eng"] is not None]
        rows.append({**dict(zip(dims, key)), "n": len(rs), "published": sum(r["state"] == "published" for r in rs),
                     "removed": sum(r["state"] == "removed" for r in rs), "measured": len(m),
                     "median_reactions": _median([r["latest"]["reactions"] for r in m]), "median_comments": _median([r["latest"]["comments"] for r in m]),
                     "median_eng": _median([r["eng"] for r in m])})
    rows.sort(key=lambda r: (r["median_eng"] is None, -(r["median_eng"] or 0), -r["n"], [str(r[d]) for d in dims]))
    return rows


def build_view(doc: dict, now_s: float) -> dict:
    """Everything the tab shows, worked out from one stored document."""
    now = datetime.fromtimestamp(now_s, tz=timezone.utc)
    topic_of = {g["id"]: g["topic"] for g in doc["groups"]}
    by_group: dict[str, list[dict]] = {}
    posts = []
    for r in doc["posts"]:
        latest = max(r["checks"], key=lambda c: c["age_h"]) if r["checks"] else None
        row = {**r, "topic": topic_of.get(r["group"]), "latest": latest, "eng": eng_of(r["checks"])}
        sent = parse_ts(r["sent_at"])
        row["age_h"] = round((now - sent).total_seconds() / 3600, 1) if sent else None
        posts.append(row)
        by_group.setdefault(r["group"], []).append(row)
    groups = []
    for g in doc["groups"]:
        engs = [r["eng"] for r in by_group.get(g["id"], []) if r["eng"] is not None]
        banned = g["state"] == "banned"
        score = score_of(g["posts"], g["published"], g["removed"], engs, banned)
        n = g["posts"]
        groups.append({**g, "score_pushed": g["score"], "score": score, "eng": round(sum(engs) / len(engs), 1) if engs else 0.0,
                       "pub_rate": round(g["published"] / n, 3) if n else None, "removed_rate": round(g["removed"] / n, 3) if n else None,
                       "worth": score is not None and score >= WORTH_MIN and g["removed"] == 0 and not banned})
    due = [d for d in (_due(r, now) for r in posts) if d is not None]
    for g in groups:
        g["due_n"] = sum(1 for d in due if d["group"] == g["id"])
    unresolved = [{"post": r["id"], "group": r["group"], "name": r["group_name"], "state": r["state"], "age_h": r["age_h"]}
                  for r in posts if r["age_h"] is not None and ((r["state"] == "sent" and r["age_h"] >= 1) or (r["state"] == "pending" and r["age_h"] >= 72))]
    ready = sorted(({"id": g["id"], "name": g["name"], "verdict": g["verdict"], "fit": g["fit"], "members": g["members"], "lang": g["lang"], "topic": g["topic"]}
                    for g in groups if g["wave"] == 1 and g["posts"] == 0 and g["verdict"] in POSTING_VERDICTS and g["state"] not in ("banned", "removed")),
                   key=lambda g: (-(g["fit"] or 0), -(g["members"] or 0), g["id"]))
    ranking = sorted((g for g in groups if g["score"] is not None),
                     key=lambda g: (-g["score"], -g["eng"], -(g["members"] or 0), g["id"]))[:RANKING_LEN]
    latest = [r["latest"] for r in posts if r["latest"]]
    states = [r["state"] for r in posts]
    totals = {
        "groups": len(groups), "groups_known": doc["meta"]["groups_total"], "posted": sum(g["posts"] > 0 for g in groups),
        "published": sum(g["published"] > 0 for g in groups), "removed": sum(g["removed"] > 0 for g in groups),
        "banned": sum(g["state"] == "banned" for g in groups), "posts": len(posts),
        "posts_published": states.count("published"), "posts_removed": states.count("removed"),
        "posts_declined": states.count("declined"), "posts_waiting": states.count("sent") + states.count("pending"),
        "reactions": sum(c["reactions"] for c in latest), "comments": sum(c["comments"] for c in latest),
        "shares": sum(c["shares"] for c in latest), "views": sum(c["views"] or 0 for c in latest)}
    funnel = [{"stage": "groups", "n": totals["groups"]}, {"stage": "posted", "n": totals["posted"]},
              {"stage": "published", "n": totals["published"]}, {"stage": "removed", "n": totals["removed"]}]
    visits = doc["visits"]
    if visits:
        visits = {**visits, "total": sum(visits["by_content"].values())}
    received = parse_ts(doc["received"])
    gen = parse_ts(doc["generated"])
    stamp = received or gen
    return {
        "campaign": doc["campaign"], "generated": doc["generated"], "received": doc["received"], "meta": doc["meta"],
        "age_h": round((now - stamp).total_seconds() / 3600, 1) if stamp else None,
        "stale": bool(stamp and (now - stamp).total_seconds() > STALE_H * 3600),
        "worth_min": WORTH_MIN, "totals": totals, "funnel": funnel, "groups": groups, "posts": posts,
        "slices": {"format": _slice_rows(posts, ("format",)), "lang": _slice_rows(posts, ("lang",)), "topic": _slice_rows(posts, ("topic",)),
                   "kind": _slice_rows(posts, ("kind",)), "format_lang_topic": _slice_rows(posts, ("format", "lang", "topic"))},
        "ranking": [{"id": g["id"], "name": g["name"], "score": g["score"], "eng": g["eng"], "pub_rate": g["pub_rate"],
                     "removed_rate": g["removed_rate"], "worth": g["worth"]} for g in ranking],
        "due": {"checks": due, "unresolved": unresolved, "ready": ready}, "visits": visits}


# ---------------- CSV ----------------

GROUP_COLUMNS = ("id", "name", "url", "lang", "members", "topic", "fit", "verdict", "wave", "state", "prior_sim_post", "last_post_at", "posts",
                 "published", "removed", "best_reactions", "best_comments", "score", "eng", "worth", "note")
POST_COLUMNS = ("id", "group", "group_name", "kind", "format", "lang", "topic", "sent_at", "state", "url", "link_placement", "first_comment", "angle",
                "age_h", "last_check_h", "reactions", "comments", "shares", "views", "admin_action", "eng", "checks", "note")


def _cell(v) -> str:
    """A CSV cell. Text that a spreadsheet would run as a formula gets a leading apostrophe."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "yes" if v else "no"
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def _checks_text(checks: list[dict]) -> str:
    return "; ".join(f"{c['age_h']:g}h {c['reactions']}/{c['comments']}/{c['shares']}" + (f" v{c['views']}" if c["views"] is not None else "")
                     + ("" if c["admin_action"] == "none" else f" [{c['admin_action']}]") for c in checks)


def to_csv(view: dict, table: str) -> bytes:
    """One table as CSV (UTF-8 with a BOM so a spreadsheet reads the Polish letters), policy columns after the group ones."""
    out = io.StringIO(newline="")
    w = csv.writer(out, lineterminator="\r\n")
    if table == "groups":
        w.writerow([*GROUP_COLUMNS, *(f"policy_{k}" for k in POLICY_KEYS)])
        for g in view["groups"]:
            w.writerow([*(_cell(g[c]) for c in GROUP_COLUMNS), *(_cell(g["policy"].get(k)) for k in POLICY_KEYS)])
    else:
        w.writerow(POST_COLUMNS)
        for r in view["posts"]:
            c = r["latest"] or {}
            row = {**r, "last_check_h": c.get("age_h"), "reactions": c.get("reactions"), "comments": c.get("comments"), "shares": c.get("shares"),
                   "views": c.get("views"), "admin_action": c.get("admin_action"), "checks": _checks_text(r["checks"])}
            w.writerow([_cell(row.get(col)) for col in POST_COLUMNS])
    return b"\xef\xbb\xbf" + out.getvalue().encode("utf-8")


# ---------------- the admin routes ----------------

def _json(code: int, obj: dict) -> Response:
    return code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), [("Content-Type", "application/json"), ("Cache-Control", "no-store")]


class OutreachAdmin:
    """GET /api/admin/outreach and /api/admin/outreach/export.csv, read-only, behind AdminApi's session."""

    def __init__(self, store: OutreachStore, clock: Callable[[], float] = time.time):
        self.store, self.clock = store, clock

    def register(self, api) -> None:
        api.add_route("GET", r"outreach", self.view)
        api.add_route("GET", r"outreach/export\.csv", self.export)

    def _doc(self) -> tuple[dict | None, bool]:
        try:
            doc = self.store.read()
        except StoreUnreadable:
            return None, True
        return (doc or None), False

    def view(self, _m, _qs, _body, _client) -> Response:
        doc, unreadable = self._doc()
        if doc is None:
            return _json(200, {"ok": True, "empty": True, "unreadable": unreadable})
        return _json(200, {"ok": True, "empty": False, "unreadable": False, **build_view(doc, self.clock())})

    def export(self, _m, qs, _body, _client) -> Response:
        table = (urllib.parse.parse_qs(qs).get("table") or [""])[0]
        if table not in ("groups", "posts"):
            return _json(400, {"ok": False, "reason": "table"})
        doc, _unreadable = self._doc()
        if doc is None:
            return _json(404, {"ok": False, "reason": "no-snapshot"})
        stamp = time.strftime("%Y-%m-%d", time.gmtime(self.clock()))
        name = f"outreach-{doc['campaign']}-{table}-{stamp}.csv"
        return 200, to_csv(build_view(doc, self.clock()), table), [
            ("Content-Type", "text/csv; charset=utf-8"), ("Cache-Control", "no-store"),
            ("Content-Disposition", f'attachment; filename="{name}"')]
