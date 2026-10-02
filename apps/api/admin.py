"""The owner's admin (owner's request 2026-10-02), wired into server.py; stdlib only.

Routes (nginx: location ^~ /api/admin/, GET/POST only, 256 KB bodies; location = /api/catalog):
GET  /api/catalog                      the published scene catalogue for the scene picker (public,
                                       ETag + If-None-Match -> 304, max-age 60); hidden scenes left out
POST /api/admin/login {password}       a session cookie + the CSRF token
POST /api/admin/logout
GET  /api/admin/session                the CSRF token of the current session (a page reload)
GET  /api/admin/catalog                draft, published, whether they differ, the history
POST /api/admin/catalog/draft {catalog}   save the draft (the whole list)
POST /api/admin/catalog/publish        draft -> live; the version goes to catalog-history/
POST /api/admin/catalog/discard        draft = live again
POST /api/admin/catalog/restore {name} an earlier version goes live (itself a new history entry)
GET  /api/admin/reports                visitors' bug reports and ideas, newest first, with status
POST /api/admin/reports/status {id, status: open|closed}
GET  /api/admin/reports/<id>/diagnostics  the technical details stored with a bug (consent given)

Security (deploy/README.md, "Admin"):
- Off unless ADMIN_PASSWORD_HASH holds a valid "scrypt:n:r:p:salt:hash" (tools/admin/hash_password.py);
  every admin route then answers 503, never an open door. ":" not "$": Docker Compose interpolates
  "$" in env files. The password is compared through hashlib.scrypt, one at a time (16 MiB each in a
  64 MB container), with hmac.compare_digest; it is never stored, logged or echoed.
- A session is secrets.token_urlsafe(32) in an HttpOnly, Secure, SameSite=Strict cookie on Path=/api/admin
  (the only path that needs it; the page itself is static), 12 h, in RAM only (a restart logs out).
  Only its sha256 is kept. At most 16 sessions: a new one pushes out the oldest.
- CSRF: every POST except the login carries X-CSRF equal to the token issued with the session.
- Brute force, per client address (nginx's real-IP address, not a header the visitor can write): 5
  failures in 15 min lock it for 15 min, doubling with each further lock (at most 24 h); 30 failures in
  an hour from everywhere refuse every login for an hour and send one Telegram alert. A locked login is
  refused before the password is looked at.
- Audit: DATA_DIR/admin-audit.jsonl, one line per action: time, a keyed hash of the address, action, ok.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path
from typing import Callable

COOKIE = "gsfpv_admin"
COOKIE_PATH = "/api/admin"
SESSION_TTL = 12 * 3600.0
SESSION_CAP = 16
MAX_BODY = 256 * 1024
PASSWORD_MAX = 256

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1
SCRYPT_MEM_CAP = 32 * 1024 * 1024  # 128 * n * r of a hash we accept
_HASH_RE = re.compile(r"scrypt:([0-9]{1,6}):([0-9]{1,2}):([0-9]):([A-Za-z0-9_-]{16,88}):([A-Za-z0-9_-]{43,88})")

LOCALES = ("en", "es", "pl", "ru")
KINDS = ("interior", "exterior", "other")
REPORT_STATUSES = ("open", "closed")
MAX_SCENES = 500
MAX_COLLECTIONS = 40
HISTORY_LISTED = 50
_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_SLUG_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
_DRONE_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,39}")
_FORMAT_RE = re.compile(r"[a-z0-9.]{1,24}")
_THUMB_RE = re.compile(r"https://(s3-eu-west-1\.amazonaws\.com/images\.playcanvas\.com/splat|d28zzqy0iyovbz\.cloudfront\.net)/[0-9a-f]{6,32}/v[0-9]{1,6}/[a-z]{1,4}\.webp")
_HISTORY_RE = re.compile(r"[0-9]{8}T[0-9]{6}Z(-[0-9]{1,3})?")
_REPORT_ID_RE = re.compile(r"R-[0-9]{8}-[0-9]{4,}")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_hash(password: str, salt: bytes | None = None, n: int = SCRYPT_N, r: int = SCRYPT_R, p: int = SCRYPT_P) -> str:
    """The ADMIN_PASSWORD_HASH line for a password: scrypt with a random 16-byte salt per install."""
    if not password:
        raise ValueError("empty password")
    salt = secrets.token_bytes(16) if salt is None else salt
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=2 * SCRYPT_MEM_CAP, dklen=32)
    return f"scrypt:{n}:{r}:{p}:{_b64(salt)}:{_b64(dk)}"


def parse_hash(s: str | None) -> tuple[int, int, int, bytes, bytes] | None:
    """(n, r, p, salt, hash) of a well-formed line within the memory cap, else None (admin stays off)."""
    m = _HASH_RE.fullmatch((s or "").strip())
    if not m:
        return None
    n, r, p = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if n < 2 ** 10 or n & (n - 1) or not 1 <= r <= 16 or not 1 <= p <= 4 or 128 * n * r > SCRYPT_MEM_CAP:
        return None
    try:
        salt, dk = _unb64(m.group(4)), _unb64(m.group(5))
    except ValueError:
        return None
    return (n, r, p, salt, dk) if len(salt) >= 12 and len(dk) >= 32 else None


def check_password(password: str, parsed: tuple[int, int, int, bytes, bytes]) -> bool:
    n, r, p, salt, dk = parsed
    got = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=2 * SCRYPT_MEM_CAP, dklen=len(dk))
    return hmac.compare_digest(got, dk)


class LoginGuard:
    """Failed logins: per address and in all. wait() before the password is checked, fail()/ok() after."""

    def __init__(self, clock: Callable[[], float] = time.time, per_ip: int = 5, window: float = 900.0, lock: float = 900.0,
                 lock_max: float = 86400.0, global_max: int = 30, global_window: float = 3600.0, global_lock: float = 3600.0):
        self.clock, self.per_ip, self.window, self.lock, self.lock_max = clock, per_ip, window, lock, lock_max
        self.global_max, self.global_window, self.global_lock = global_max, global_window, global_lock
        self._ip: dict[str, dict] = {}
        self._all: deque = deque()
        self._global_until = 0.0
        self._mu = threading.Lock()

    def wait(self, ip: str) -> tuple[float, str]:
        """Seconds until this address may try again and why ('ip', 'global'); (0, '') when it may now."""
        now = self.clock()
        with self._mu:
            if now < self._global_until:
                return self._global_until - now, "global"
            s = self._ip.get(ip)
            if s and now < s["until"]:
                return s["until"] - now, "ip"
        return 0.0, ""

    def fail(self, ip: str) -> str:
        """Count a wrong password; '' or the lock it started ('ip' or 'global', the caller audits/alerts)."""
        now = self.clock()
        started = ""
        with self._mu:
            self._prune(now)
            s = self._ip.setdefault(ip, {"fails": deque(), "until": 0.0, "strikes": 0, "last": now})
            if now - s["last"] > self.lock_max:
                s["strikes"] = 0  # a day without failures forgives the earlier locks
            s["last"] = now
            s["fails"].append(now)
            while s["fails"] and now - s["fails"][0] > self.window:
                s["fails"].popleft()
            if len(s["fails"]) >= self.per_ip:
                s["strikes"] += 1
                s["until"] = now + min(self.lock * 2 ** (s["strikes"] - 1), self.lock_max)
                s["fails"].clear()
                started = "ip"
            self._all.append(now)
            while self._all and now - self._all[0] > self.global_window:
                self._all.popleft()
            if len(self._all) >= self.global_max and now >= self._global_until:
                self._global_until = now + self.global_lock
                self._all.clear()
                started = "global"
        return started

    def ok(self, ip: str) -> None:
        with self._mu:
            self._ip.pop(ip, None)

    def _prune(self, now: float) -> None:
        if len(self._ip) < 4096:
            return
        for k in [k for k, s in self._ip.items() if now >= s["until"] and now - s["last"] > self.lock_max]:
            del self._ip[k]
        while len(self._ip) >= 4096:  # a flood of addresses: forget the quietest
            del self._ip[min(self._ip, key=lambda k: self._ip[k]["last"])]


class Sessions:
    """Session id -> CSRF token and expiry, in RAM; the id itself is kept only as its sha256."""

    def __init__(self, clock: Callable[[], float] = time.time, ttl: float = SESSION_TTL, cap: int = SESSION_CAP):
        self.clock, self.ttl, self.cap = clock, ttl, cap
        self._s: dict[str, dict] = {}
        self._mu = threading.Lock()

    @staticmethod
    def _key(sid: str) -> str:
        return hashlib.sha256(sid.encode()).hexdigest()

    def new(self) -> tuple[str, str, float]:
        sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        now = self.clock()
        with self._mu:
            for k in [k for k, v in self._s.items() if v["expires"] <= now]:
                del self._s[k]
            while len(self._s) >= self.cap:
                del self._s[min(self._s, key=lambda k: self._s[k]["expires"])]
            self._s[self._key(sid)] = {"csrf": csrf, "expires": now + self.ttl}
        return sid, csrf, now + self.ttl

    def get(self, sid: str | None) -> dict | None:
        if not sid or len(sid) > 128:
            return None
        with self._mu:
            s = self._s.get(self._key(sid))
            if s and s["expires"] <= self.clock():
                del self._s[self._key(sid)]
                return None
            return dict(s) if s else None

    def drop(self, sid: str | None) -> None:
        if sid:
            with self._mu:
                self._s.pop(self._key(sid), None)


def write_durable(path: Path, data: bytes) -> None:
    """Whole file or nothing: a temporary file, fsync, then the rename."""
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def append_line(path: Path, rec: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


# ---------------- the catalogue ----------------

class BadCatalog(ValueError):
    pass


def _words(v, n: int) -> str:
    """Admin text: a string, control and format characters dropped, one line, trimmed, at most n characters."""
    if not isinstance(v, str):
        return ""
    s = "".join(" " if c in "\n\r\t" else c for c in v[: n * 2] if unicodedata.category(c) not in ("Cc", "Cs", "Cf") or c in "\n\r\t")
    return " ".join(s.split())[:n].strip()


def _texts(v, n: int) -> dict:
    """A text per language ({"en": ..., "ru": ...}); a plain string counts as English."""
    if isinstance(v, str):
        v = {"en": v}
    if not isinstance(v, dict):
        return {}
    return {loc: w for loc in LOCALES if (w := _words(v.get(loc), n))}


def _number(v, lo: float, hi: float, whole: bool = False):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not lo <= v <= hi:
        return None
    return int(v) if whole else round(float(v), 3)


def clean_scene(e) -> dict:
    """One catalogue entry in canonical form (the field list is in deploy/README.md, "Admin")."""
    if not isinstance(e, dict):
        raise BadCatalog("a scene is not an object")
    sid = e.get("id")
    if not isinstance(sid, str) or not _ID_RE.fullmatch(sid):
        raise BadCatalog(f"bad scene id {str(sid)[:40]!r}")
    title = _words(e.get("title"), 120)
    if not title:
        raise BadCatalog(f"scene {sid} has no title")
    out: dict = {"id": sid, "title": title, "author": _words(e.get("author"), 80), "license": _words(e.get("license"), 40),
                 "kind": e.get("kind") if e.get("kind") in KINDS else "other"}
    for k, lo, hi, whole in (("version", 1, 999999, True), ("voxelCm", 0.1, 100, False), ("sizeMb", 0.01, 100000, False),
                             ("scale", 0.25, 4, False), ("dropFloaters", 0, 64, True)):
        x = _number(e.get(k), lo, hi, whole)
        if x is not None:
            out[k] = x
    if isinstance(e.get("thumb"), str) and _THUMB_RE.fullmatch(e["thumb"]):
        out["thumb"] = e["thumb"]
    if isinstance(e.get("format"), str) and _FORMAT_RE.fullmatch(e["format"]):
        out["format"] = e["format"]
    if isinstance(e.get("defaultDrone"), str) and _DRONE_RE.fullmatch(e["defaultDrone"]):
        out["defaultDrone"] = e["defaultDrone"]
    out["collision"] = e.get("collision") is not False
    out["walls"] = "off" if e.get("walls") == "off" else "on"
    pitch = _texts(e.get("pitch"), 140)
    if pitch:
        out["pitch"] = pitch
    cols = e.get("collections")
    out["collections"] = list(dict.fromkeys(c for c in cols if isinstance(c, str) and _SLUG_RE.fullmatch(c)))[:8] if isinstance(cols, list) else []
    out["pinned"] = e.get("pinned") is True
    out["hidden"] = e.get("hidden") is True
    return out


def clean_catalog(doc) -> dict:
    """The whole list: scenes in the admin's order (the order IS the position), collections in theirs."""
    if not isinstance(doc, dict) or not isinstance(doc.get("scenes"), list):
        raise BadCatalog("no scene list")
    if len(doc["scenes"]) > MAX_SCENES:
        raise BadCatalog("too many scenes")
    cols, seen = [], set()
    for c in doc.get("collections") or []:
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not _SLUG_RE.fullmatch(c["id"]) or c["id"] in seen:
            raise BadCatalog("bad collection")
        title = _texts(c.get("title"), 40)
        if "en" not in title:
            raise BadCatalog(f"collection {c['id']} has no English title")
        seen.add(c["id"])
        cols.append({"id": c["id"], "title": title})
    if len(cols) > MAX_COLLECTIONS:
        raise BadCatalog("too many collections")
    scenes, ids = [], set()
    for e in doc["scenes"]:
        s = clean_scene(e)
        if s["id"] in ids:
            raise BadCatalog(f"scene {s['id']} is listed twice")
        ids.add(s["id"])
        s["collections"] = [c for c in s["collections"] if c in seen]
        scenes.append(s)
    return {"collections": cols, "scenes": scenes}


def seed_from_showcase(path: Path | None) -> dict:
    """The first catalogue: apps/fly/public/showcase.json's scenes as they are (title, author, licence,
    kind, walls, scale, dropFloaters...), none pinned or hidden, no collections."""
    if path is None or not path.is_file():
        return {"collections": [], "scenes": []}
    doc = json.loads(path.read_text(encoding="utf-8"))
    return clean_catalog({"collections": [], "scenes": doc.get("scenes") or []})


class CatalogStore:
    """DATA_DIR/catalog.json (live), catalog-draft.json (the admin's work), catalog-history/<time>.json
    (every version that went live). Seeded from showcase.json the first time it is read."""

    def __init__(self, data_dir: Callable[[], Path], seed: Callable[[], Path | None], clock: Callable[[], float] = time.time):
        self.data_dir, self.seed, self.clock = data_dir, seed, clock
        self._mu = threading.RLock()
        self._public: tuple[tuple, bytes, str] | None = None

    def _p(self, name: str) -> Path:
        return self.data_dir() / name

    def _stamp(self) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))

    def _read(self, path: Path) -> dict | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None

    def _write(self, path: Path, doc: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_durable(path, (json.dumps(doc, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))

    def published(self) -> dict | None:
        """The live catalogue; the seed becomes it the first time (None: nothing to seed, nothing live)."""
        with self._mu:
            doc = self._read(self._p("catalog.json"))
            if doc is None:
                seed = seed_from_showcase(self.seed())
                if not seed["scenes"]:
                    return None
                doc = {"v": 1, "published": self._stamp(), "seeded": True, **seed}
                self._write(self._p("catalog.json"), doc)
            return doc

    def public(self) -> tuple[bytes, str] | None:
        """What /api/catalog sends (hidden scenes and the admin-only field dropped) and its ETag."""
        with self._mu:
            doc = self.published()
            if doc is None:
                return None
            st = self._p("catalog.json").stat()
            key = (st.st_mtime_ns, st.st_size, str(self._p("catalog.json")))
            if self._public is None or self._public[0] != key:
                scenes = [{k: v for k, v in s.items() if k != "hidden"} for s in doc["scenes"] if not s.get("hidden")]
                body = json.dumps({"v": 1, "published": doc.get("published"), "collections": doc["collections"], "scenes": scenes},
                                  ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self._public = (key, body, '"' + hashlib.sha256(body).hexdigest()[:32] + '"')
            return self._public[1], self._public[2]

    def draft(self) -> dict:
        with self._mu:
            d = self._read(self._p("catalog-draft.json"))
            if d is not None:
                return d
            pub = self.published()
            return {"collections": pub["collections"], "scenes": pub["scenes"]} if pub else {"collections": [], "scenes": []}

    def state(self) -> dict:
        with self._mu:
            pub = self.published()
            draft = self.draft()
            live = {"collections": pub["collections"], "scenes": pub["scenes"]} if pub else {"collections": [], "scenes": []}
            return {"draft": draft, "published": pub, "dirty": self._body(draft) != self._body(live), "history": self.history()}

    @staticmethod
    def _body(d: dict) -> str:
        return json.dumps({"collections": d.get("collections"), "scenes": d.get("scenes")}, sort_keys=True)

    def save_draft(self, doc) -> dict:
        clean = clean_catalog(doc)
        with self._mu:
            self._write(self._p("catalog-draft.json"), {"saved": self._stamp(), **clean})
        return clean

    def _go_live(self, body: dict, note: str) -> str:
        """Write the version to history first, then make it live (caller holds the lock)."""
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(self.clock()))
        hist = self._p("catalog-history")
        name, n = stamp, 1
        while (hist / f"{name}.json").exists():
            n += 1
            name = f"{stamp}-{n}"
        doc = {"v": 1, "published": self._stamp(), "note": note, **body}
        self._write(hist / f"{name}.json", doc)
        self._write(self._p("catalog.json"), doc)
        self._p("catalog-draft.json").unlink(missing_ok=True)
        return name

    def publish(self) -> str:
        with self._mu:
            d = self.draft()
            return self._go_live(clean_catalog(d), "publish")

    def discard(self) -> None:
        with self._mu:
            self._p("catalog-draft.json").unlink(missing_ok=True)

    def restore(self, name: str) -> str:
        if not isinstance(name, str) or not _HISTORY_RE.fullmatch(name):
            raise BadCatalog("bad version name")
        with self._mu:
            doc = self._read(self._p("catalog-history") / f"{name}.json")
            if doc is None:
                raise FileNotFoundError(name)
            return self._go_live(clean_catalog(doc), f"restore {name}")

    def history(self) -> list[dict]:
        hist = self._p("catalog-history")
        if not hist.is_dir():
            return []
        out = []
        for f in sorted(hist.glob("*.json"), key=lambda p: p.name, reverse=True)[:HISTORY_LISTED]:
            try:
                doc = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                continue
            out.append({"name": f.stem, "published": doc.get("published"), "note": doc.get("note", ""), "scenes": len(doc.get("scenes") or [])})
        return out


# ---------------- reports (read-only, plus a status) ----------------

class Reports:
    """Visitors' reports as /api/report stored them (reports.jsonl, reports/<id>.json) and the admin's
    status per report (report-status.json). Nothing here changes what a visitor sent."""

    def __init__(self, reports_file: Callable[[], Path], reports_dir: Callable[[], Path], status_file: Callable[[], Path]):
        self.reports_file, self.reports_dir, self.status_file = reports_file, reports_dir, status_file
        self._mu = threading.Lock()

    def _status(self) -> dict:
        try:
            return json.loads(self.status_file().read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}

    def list(self, limit: int = 500) -> list[dict]:
        rows: deque = deque(maxlen=limit)
        f = self.reports_file()
        if f.exists():
            with f.open(encoding="utf-8") as fh:
                for line in fh:
                    try:
                        rows.append(json.loads(line))
                    except ValueError:
                        continue
        st = self._status()
        keep = ("id", "ts", "kind", "page", "locale", "scene", "release", "message", "contact", "suspect", "diagnostics")
        out = []
        for r in reversed(rows):
            if not isinstance(r, dict) or not isinstance(r.get("id"), str):
                continue
            x = {k: r.get(k) for k in keep}
            s = st.get(r["id"]) or {}
            x["status"] = s.get("status", "open")
            x["statusTs"] = s.get("ts")
            out.append(x)
        return out

    def exists(self, rid: str) -> bool:
        f = self.reports_file()
        if not f.exists():
            return False
        needle = f'{{"id": "{rid}"'
        with f.open(encoding="utf-8") as fh:
            return any(line.startswith(needle) for line in fh)

    def set_status(self, rid: str, status: str, ts: str) -> bool:
        if not isinstance(rid, str) or not _REPORT_ID_RE.fullmatch(rid) or status not in REPORT_STATUSES or not self.exists(rid):
            return False
        with self._mu:
            st = self._status()
            st[rid] = {"status": status, "ts": ts}
            self.status_file().parent.mkdir(parents=True, exist_ok=True)
            write_durable(self.status_file(), (json.dumps(st, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))
        return True

    def diagnostics(self, rid: str) -> bytes | None:
        if not _REPORT_ID_RE.fullmatch(rid):
            return None
        f = self.reports_dir() / f"{rid}.json"
        return f.read_bytes() if f.is_file() else None


# ---------------- the routes ----------------

class TooLarge(Exception):
    pass


Response = tuple[int, bytes, list]


def _json(code: int, obj: dict, extra: list | None = None) -> Response:
    return code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), [("Content-Type", "application/json"), ("Cache-Control", "no-store"), *(extra or [])]


def _cookie(header: str | None) -> str | None:
    for part in (header or "").split(";"):
        k, _, v = part.strip().partition("=")
        if k == COOKIE:
            return v
    return None


class AdminApi:
    def __init__(self, data_dir: Callable[[], Path], reports_file: Callable[[], Path], reports_dir: Callable[[], Path],
                 seed: Callable[[], Path | None], telegram: Callable[[str], object], site: str = "gsfpv",
                 env=os.environ, clock: Callable[[], float] = time.time):
        self.data_dir, self.telegram, self.site, self.env, self.clock = data_dir, telegram, site, env, clock
        self.guard = LoginGuard(clock)
        self.sessions = Sessions(clock)
        self.catalog = CatalogStore(data_dir, seed, clock)
        self.reports = Reports(reports_file, reports_dir, lambda: data_dir() / "report-status.json")
        self._kdf = threading.Lock()  # one scrypt at a time: memory, and a natural brake

    def config(self) -> tuple | None:
        return parse_hash(self.env.get("ADMIN_PASSWORD_HASH"))

    def _who(self, client: str) -> str:
        key = (self.env.get("ADMIN_PASSWORD_HASH") or "").encode()
        return hmac.new(key, client.encode(), hashlib.sha256).hexdigest()[:16]

    def audit(self, client: str, action: str, ok: bool, detail: str = "") -> None:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock())), "ip": self._who(client), "action": action, "ok": ok}
        if detail:
            rec["detail"] = detail[:120]
        try:
            append_line(self.data_dir() / "admin-audit.jsonl", rec)
        except OSError:
            pass

    def public_catalog(self, if_none_match: str | None) -> Response:
        pub = self.catalog.public()
        if pub is None:
            return _json(404, {"ok": False, "reason": "no-catalog"})
        body, etag = pub
        hdrs = [("Content-Type", "application/json"), ("Cache-Control", "public, max-age=60"), ("ETag", etag)]
        if if_none_match and etag in [x.strip() for x in if_none_match.split(",")]:
            return 304, b"", hdrs
        return 200, body, hdrs

    def handle(self, method: str, path: str, headers, read_body: Callable[[int], bytes], client: str) -> Response:
        cfg = self.config()
        if cfg is None:
            return _json(503, {"ok": False, "reason": "admin-disabled"})
        route = path[len("/api/admin/"):]
        if method == "POST" and route == "login":
            return self._login(cfg, read_body, client)
        sid = _cookie(headers.get("Cookie"))
        sess = self.sessions.get(sid)
        if sess is None:
            return _json(401, {"ok": False, "reason": "login"})
        if method == "POST" and not hmac.compare_digest((headers.get("X-CSRF") or "").encode(), sess["csrf"].encode()):
            self.audit(client, "csrf", False, route)
            return _json(403, {"ok": False, "reason": "csrf"})
        try:
            return self._route(method, route, read_body, client, sid, sess)
        except TooLarge:
            return _json(413, {"ok": False})
        except BadCatalog as e:
            return _json(400, {"ok": False, "reason": str(e)})
        except FileNotFoundError:
            return _json(404, {"ok": False})

    def _body(self, read_body: Callable[[int], bytes]) -> dict:
        try:
            v = json.loads(read_body(MAX_BODY) or b"{}")
        except ValueError:
            raise BadCatalog("the body is not JSON") from None
        if not isinstance(v, dict):
            raise BadCatalog("the body is not an object")
        return v

    def _login(self, cfg: tuple, read_body: Callable[[int], bytes], client: str) -> Response:
        wait, why = self.guard.wait(client)
        if wait > 0:
            return _json(429, {"ok": False, "reason": f"locked-{why}", "retryAfter": math.ceil(wait)}, [("Retry-After", str(math.ceil(wait)))])
        try:
            b = self._body(read_body)
        except (BadCatalog, TooLarge):
            return _json(400, {"ok": False})
        pw = b.get("password")
        if not isinstance(pw, str) or not pw or len(pw) > PASSWORD_MAX:
            return _json(400, {"ok": False})
        with self._kdf:
            good = check_password(pw, cfg)
        del pw, b
        if not good:
            started = self.guard.fail(client)
            self.audit(client, "login", False)
            if started:
                self.audit(client, f"lockout-{started}", True)
            if started == "global":
                self.telegram(f"[ALERT][site={self.site}] admin: {self.guard.global_max} failed logins within an hour; "
                              f"every admin login is refused for {int(self.guard.global_lock // 60)} min. Audit: data/admin-audit.jsonl")
            return _json(401, {"ok": False, "reason": "password"})
        self.guard.ok(client)
        sid, csrf, expires = self.sessions.new()
        self.audit(client, "login", True)
        cookie = f"{COOKIE}={sid}; Path={COOKIE_PATH}; Max-Age={int(SESSION_TTL)}; HttpOnly; Secure; SameSite=Strict"
        return _json(200, {"ok": True, "csrf": csrf, "expires": int(expires)}, [("Set-Cookie", cookie)])

    def _route(self, method: str, route: str, read_body, client: str, sid: str | None, sess: dict) -> Response:
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))
        if method == "GET":
            if route == "session":
                return _json(200, {"ok": True, "csrf": sess["csrf"], "expires": int(sess["expires"])})
            if route == "catalog":
                return _json(200, {"ok": True, **self.catalog.state()})
            if route == "reports":
                return _json(200, {"ok": True, "reports": self.reports.list()})
            m = re.fullmatch(r"reports/(R-[0-9]{8}-[0-9]{4,})/diagnostics", route)
            if m:
                blob = self.reports.diagnostics(m.group(1))
                if blob is None:
                    return _json(404, {"ok": False})
                return 200, blob, [("Content-Type", "application/json"), ("Cache-Control", "no-store"),
                                   ("Content-Disposition", f'inline; filename="{m.group(1)}.json"')]
            return _json(404, {"ok": False})
        if route == "logout":
            self.sessions.drop(sid)
            self.audit(client, "logout", True)
            return _json(200, {"ok": True}, [("Set-Cookie", f"{COOKIE}=; Path={COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict")])
        if route == "catalog/draft":
            b = self._body(read_body)
            clean = self.catalog.save_draft(b.get("catalog"))
            self.audit(client, "draft", True, f"{len(clean['scenes'])} scenes")
            return _json(200, {"ok": True, **self.catalog.state()})
        if route == "catalog/publish":
            name = self.catalog.publish()
            self.audit(client, "publish", True, name)
            return _json(200, {"ok": True, "version": name, **self.catalog.state()})
        if route == "catalog/discard":
            self.catalog.discard()
            self.audit(client, "discard", True)
            return _json(200, {"ok": True, **self.catalog.state()})
        if route == "catalog/restore":
            name = self.catalog.restore(self._body(read_body).get("name"))
            self.audit(client, "restore", True, name)
            return _json(200, {"ok": True, "version": name, **self.catalog.state()})
        if route == "reports/status":
            b = self._body(read_body)
            if not self.reports.set_status(b.get("id"), b.get("status"), stamp):
                return _json(400, {"ok": False})
            self.audit(client, "report-status", True, f"{b.get('id')} {b.get('status')}")
            return _json(200, {"ok": True})
        return _json(404, {"ok": False})

