"""ShramkoGSFPV API (tiny, no framework). Serves only these routes behind nginx:

POST /api/e      cookieless first-party counter. No cookies, no device id, no IP stored. Only
                 whitelisted event names and whitelisted property values are written, one JSONL
                 line per event into DATA_DIR/events-YYYY-MM-DD.jsonl. Rate limit 120 / 10 min
                 per client (in RAM only). Retention: 12 months and at most 50 MB in total.
POST /api/lead   collaboration form and scene takedown reports: stored FIRST (JSONL, fsync),
                 then forwarded to the shared Telegram lead bot. Honeypot + time-to-submit.
GET  /api/health 200 {"ok": true, ...}; 503 when the disk guard has tripped.
GET  /api/superspl/explore
                 SuperSplat catalogue (owner's decision 2026-09-27, docs/decisions.md D35): the
                 list superspl.at shows, read from PlayCanvas' explore API, whose CORS answers only
                 superspl.at. Whitelisted parameters, RAM-only LRU cache (10 min, 4 MiB), a global
                 token bucket (at most 60 upstream calls in any 60 s, their limit is 120), stale
                 answers when the bucket is empty or the upstream fails, fields trimmed to what the
                 scene picker shows. Nothing from the visitor (cookies, headers, address) goes on.

Disk guard: below MIN_FREE_GB free, events are no longer written, /api/health answers 503 and
one warning goes to the lead bot. Secrets (TG_BOT_TOKEN, TG_CHAT_ID) come from the environment
only (config.env on the server, never in git). Logs contain method + path + status, no PII.
"""
from __future__ import annotations

import http.client
import io
import json
import math
import os
import re
import shutil
import ssl
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import uuid
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = os.environ.get("SITE_TAG", "gsfpv")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
LEADS_FILE = DATA_DIR / "leads.jsonl"
MIN_FREE_GB = float(os.environ.get("MIN_FREE_GB", "2"))
EVENTS_CAP_BYTES = int(os.environ.get("EVENTS_CAP_BYTES", str(50 * 1024 * 1024)))
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "365"))
MAX_BODY = 8 * 1024

# event -> allowed property -> allowed values (None = small integer bucket)
EVENTS: dict[str, dict[str, set | None]] = {
    # the same list as apps/fly/src/ui/picker-tabs.ts PickSource
    "scene_open": {"source": {"showcase", "paste", "history", "superspl", "random", "next", "favourite"}},
    "scene_loaded": {"load_ms_bucket": None, "has_collision": {True, False}},
    "input_connected": {"kind": {"hid", "gamepad", "touch", "keyboard", "sim"}},
    "calibration_done": {},
    "arm": {},
    "crash": {},
    "session_end": {"flight_s_bucket": None},
    "webgpu_unavailable": {},
    "bake_done": {},
    "lang_switch": {"to": {"en", "es", "pl", "ru"}},
    "cta_click": {"target": {"github", "calendar", "linkedin", "email"}},
    "fly_click": {},
    "copy_agent_prompt": {},
    "consent_accept": {},
    "consent_decline": {},
    "form_submit": {},
    "page_view": {"locale": {"en", "es", "pl", "ru"}},
}
LEAD_ROLES = {"pilot", "vendor", "studio", "investor", "developer", "takedown", "other"}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")

_lock = threading.Lock()
_ehits: dict[str, deque] = defaultdict(deque)
_lhits: dict[str, deque] = defaultdict(deque)
_guard = {"tripped": False, "warned": False}


def _rate(bucket: dict[str, deque], key: str, n: int, window: float) -> bool:
    q = bucket[key]
    now = time.time()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= n:
        return False
    q.append(now)
    return True


def free_gb() -> float:
    try:
        return shutil.disk_usage(DATA_DIR if DATA_DIR.exists() else "/").free / 1e9
    except OSError:
        return 0.0


def send_telegram(text: str) -> int | None:
    token = os.environ.get("TG_BOT_TOKEN", "")
    chat = os.environ.get("TG_CHAT_ID", "")
    if not token or not chat:
        return None
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps({"chat_id": chat, "text": text, "disable_web_page_preview": True}).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.load(r)
            return resp.get("result", {}).get("message_id") if resp.get("ok") else None
    except Exception:  # noqa: BLE001
        return None


def check_disk() -> None:
    tripped = free_gb() < MIN_FREE_GB
    _guard["tripped"] = tripped
    if tripped and not _guard["warned"]:
        _guard["warned"] = True
        send_telegram(f"[WARN][site={SITE}] disk guard: {free_gb():.2f} GB free < {MIN_FREE_GB} GB; event logging paused")
    if not tripped:
        _guard["warned"] = False


def prune_events() -> None:
    """Retention: delete event files older than RETENTION_DAYS, then the oldest over the cap."""
    files = sorted(DATA_DIR.glob("events-*.jsonl"))
    cutoff = time.strftime("%Y-%m-%d", time.gmtime(time.time() - RETENTION_DAYS * 86400))
    for f in files:
        if f.name[7:17] < cutoff:
            f.unlink(missing_ok=True)
    files = sorted(DATA_DIR.glob("events-*.jsonl"))
    total = sum(f.stat().st_size for f in files)
    while files and total > EVENTS_CAP_BYTES:
        f = files.pop(0)
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


def housekeeping() -> None:
    while True:
        try:
            check_disk()
            prune_events()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(300)


def clean_event(body: dict) -> dict | None:
    name = body.get("e")
    if name not in EVENTS:
        return None
    allowed = EVENTS[name]
    p = body.get("p")
    if isinstance(p, str):
        # the landing sends one bare value: it belongs to the event's only property, if any
        props = {next(iter(allowed)): p} if len(allowed) == 1 and p else {}
    else:
        props = p if isinstance(p, dict) else {}
    out = {}
    for k, v in props.items():
        if k not in allowed:
            continue
        rule = allowed[k]
        if rule is None:
            if isinstance(v, (int, float)) and 0 <= v <= 100000:
                out[k] = int(v)
        elif v in rule:
            out[k] = v
    return {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "e": name, "p": out}


# ---------------- SuperSplat catalogue proxy (GET /api/superspl/explore) ----------------
# superspl.at builds its lists from this endpoint (research: docs/research/scenes-scale-recording-voxels.md
# 1.1-1.3). Its CORS echoes only https://superspl.at, so a visitor's browser on our origin cannot read it:
# this proxy asks once for everyone and keeps the answer. Parameter names, values and encoding follow
# superspl.at's own client (bundle api-*.js, read 2026-09-27): time omitted when "all", features in
# the order walkable,downloadable, the search text percent-encoded twice, "<" and ">" removed and a
# one-letter search ignored.

SUPERSPL_UPSTREAM = os.environ.get("SUPERSPL_UPSTREAM", "https://playcanvas.com/api/splats/explore")
SUPERSPL_UA = ("ShramkoGSFPV-catalogue/1.0 (+https://github.com/AndriiShramko/ShramkoGSFPV; "
               "scene picker of the open-source FPV simulator at https://gsfpv.flyreelstudio.eu; cached, rate-limited)")
# the only headers that ever go upstream: nothing of the visitor's request is copied
SUPERSPL_UPSTREAM_HEADERS = (("User-Agent", SUPERSPL_UA), ("Accept", "application/json"))

EXPLORE_SORTS = ("trending", "createdAt", "views", "starred", "size")
EXPLORE_ORDERS = {"1": 1, "-1": -1}
EXPLORE_TIMES = ("all", "year", "month", "week", "day")
EXPLORE_FEATURES = ("walkable", "downloadable")  # upstream's own order
EXPLORE_PARAMS = ("sort", "order", "time", "features", "search", "skip", "limit")
EXPLORE_SEARCH_MAX = 80
EXPLORE_SKIP_MAX = 10000
EXPLORE_LIMIT_MAX = 48
EXPLORE_DEFAULT_LIMIT = 32  # superspl.at's first page

_ID_RE = re.compile(r"[0-9a-f]{6,32}")
_THUMB_RE = re.compile(r"https://s3-eu-west-1\.amazonaws\.com/images\.playcanvas\.com/splat/[0-9a-f]{6,32}/v[0-9]{1,6}/[a-z]{1,4}\.webp")
_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z")
_LICENSE_RE = re.compile(r"[a-z0-9-]{1,24}")
_FORMAT_RE = re.compile(r"[a-z0-9.]{0,24}")
_DIGITS_RE = re.compile(r"[0-9]{1,6}")  # ASCII only: \d would also take other scripts' digits
THUMB_SIZES = ("s", "m", "l", "xl", "mov")


@dataclass(frozen=True)
class SupersplConfig:
    ttl_s: float = 600.0                 # fresh for 10 min, like the owner's catalogue plan (E.6)
    stale_max_s: float = 86400.0         # an older copy still beats an error for a day
    cache_max_bytes: int = 4 * 1024 * 1024  # a 48-scene page is ~45 KB: 90+ full pages, far under the 64 MB container
    cache_max_entries: int = 512
    entry_overhead: int = 512            # key, entry object and dict slot, counted against the byte bound
    # token bucket: burst 30, refill 0.5/s => at most 30 + 0.5 * 60 = 60 upstream calls in ANY 60 s
    # window, half of PlayCanvas' `ratelimit-policy: 120;w=60`
    bucket_capacity: float = 30.0
    bucket_refill_per_s: float = 0.5
    upstream_timeout_s: float = 6.0      # whole answer, not per read
    upstream_max_bytes: int = 2 * 1024 * 1024
    upstream_concurrency: int = 3        # threads (pids_limit 32) and 0.25 CPU
    slot_wait_s: float = 3.0
    error_cooldown_s: float = 20.0       # after a failed call for a page: stale answers, no new call for it
    failed_table_max: int = 1024
    cooldown_429_s: float = 60.0         # their 429 stops every call: their window, unless they say otherwise
    cooldown_max_s: float = 600.0
    client_limit: int = 60               # requests per visitor per window (hits included)
    client_window_s: float = 60.0
    client_table_max: int = 4096


class BadParam(ValueError):
    def __init__(self, param: str, detail: str):
        super().__init__(f"{param}: {detail}")
        self.param = param
        self.detail = detail


def _clean_search(raw: str) -> str:
    """superspl.at's rule (utils T): drop < and >, ignore one letter; whitespace runs become one space."""
    s = " ".join(raw.replace("<", "").replace(">", "").split())
    return s if len(s) > 1 else ""


def parse_explore_query(qs: str) -> dict:
    """The whitelist. Anything not named here, repeated, malformed or out of range is refused (400)."""
    if len(qs) > 1024:
        raise BadParam("query", "too long")
    try:
        pairs = urllib.parse.parse_qsl(qs, keep_blank_values=True, strict_parsing=True, encoding="utf-8",
                                       errors="strict", max_num_fields=len(EXPLORE_PARAMS))
    except ValueError as e:  # UnicodeDecodeError is a ValueError
        raise BadParam("query", "malformed or too many fields") from e
    got: dict[str, str] = {}
    for k, v in pairs:
        if k not in EXPLORE_PARAMS:
            raise BadParam(k[:32], "not allowed")
        if k in got:
            raise BadParam(k, "repeated")
        got[k] = v
    sort = got.get("sort", "trending")
    if sort not in EXPLORE_SORTS:
        raise BadParam("sort", "one of " + "|".join(EXPLORE_SORTS))
    order = EXPLORE_ORDERS.get(got.get("order", "-1"))
    if order is None:
        raise BadParam("order", "1 or -1")
    t = got.get("time", "all")
    if t not in EXPLORE_TIMES:
        raise BadParam("time", "one of " + "|".join(EXPLORE_TIMES))
    if sort == "trending":
        t = "all"  # superspl.at forces it; keeps one cache entry per trending page
    fraw = got.get("features", "")
    feats = fraw.split(",") if fraw else []
    if any(f not in EXPLORE_FEATURES for f in feats) or len(set(feats)) != len(feats):
        raise BadParam("features", "a subset of " + ",".join(EXPLORE_FEATURES))
    search = got.get("search", "")
    if len(search) > EXPLORE_SEARCH_MAX:
        raise BadParam("search", f"at most {EXPLORE_SEARCH_MAX} characters")
    if any(unicodedata.category(c) in ("Cc", "Cs") for c in search):
        raise BadParam("search", "control characters")

    def whole(name: str, default: int, lo: int, hi: int) -> int:
        s = got.get(name)
        if s is None:
            return default
        if not _DIGITS_RE.fullmatch(s) or not lo <= int(s) <= hi:
            raise BadParam(name, f"an integer {lo}..{hi}")
        return int(s)

    return {"sort": sort, "order": order, "time": t, "features": [f for f in EXPLORE_FEATURES if f in feats],
            "search": _clean_search(search), "skip": whole("skip", 0, 0, EXPLORE_SKIP_MAX),
            "limit": whole("limit", EXPLORE_DEFAULT_LIMIT, 1, EXPLORE_LIMIT_MAX)}


def explore_key(q: dict) -> tuple:
    return (q["sort"], q["order"], q["time"], ",".join(q["features"]), q["search"], q["skip"], q["limit"])


def js_encode_uri_component(s: str) -> str:
    return urllib.parse.quote(s, safe="!~*'()")


def explore_upstream_url(q: dict, base: str = SUPERSPL_UPSTREAM) -> str:
    """Same parameters, order and encoding as superspl.at's exploreSplats()."""
    p = [("skip", str(q["skip"])), ("limit", str(q["limit"])), ("sort", q["sort"]), ("order", str(q["order"]))]
    if q["time"] != "all":
        p.append(("time", q["time"]))
    if q["features"]:
        p.append(("features", ",".join(q["features"])))
    if q["search"]:
        p.append(("search", js_encode_uri_component(q["search"])))  # their client encodes it twice
    return base + "?" + urllib.parse.urlencode(p)


def _count(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 10**15 else 0


def _text(v, n: int) -> str:
    if not isinstance(v, str):
        return ""
    v = "".join(" " if unicodedata.category(c) in ("Cc", "Cs") else c for c in v[: n * 4])
    s = " ".join(v.split())
    return s if len(s) <= n else s[: n - 3].rstrip() + "..."


def trim_item(it) -> dict | None:
    """One scene, reduced to what the picker shows. Unknown shapes are dropped, never passed on."""
    if not isinstance(it, dict) or it.get("listed") is False:
        return None
    sid = it.get("hash")
    if not isinstance(sid, str) or not _ID_RE.fullmatch(sid):
        return None
    ver = it.get("version")
    ver = ver if isinstance(ver, int) and not isinstance(ver, bool) and 1 <= ver <= 999999 else 1
    th = it.get("thumbnails") if isinstance(it.get("thumbnails"), dict) else {}
    user = it.get("user") if isinstance(it.get("user"), dict) else {}
    dl = it.get("downloads") if isinstance(it.get("downloads"), dict) else {}
    lic = dl.get("license")
    created = it.get("createdAt")
    fmt = it.get("format")
    return {
        "id": sid,
        "version": ver,
        "title": _text(it.get("title"), 200),
        "author": _text(user.get("username"), 64),
        "likes": _count(it.get("starred")),
        "views": _count(it.get("views")),
        "sizeBytes": _count(it.get("size")),
        "thumbs": {k: th[k] if isinstance(th.get(k), str) and _THUMB_RE.fullmatch(th[k]) else None for k in THUMB_SIZES},
        "createdAt": created if isinstance(created, str) and _DATE_RE.fullmatch(created) else None,
        "license": lic if isinstance(lic, str) and _LICENSE_RE.fullmatch(lic) else None,
        "downloadable": dl.get("enabled") is True,
        "description": _text(it.get("description"), 300),
        "format": fmt if isinstance(fmt, str) and _FORMAT_RE.fullmatch(fmt) else "",
    }


def trim_page(doc, q: dict) -> tuple[int, list]:
    if not isinstance(doc, dict) or not isinstance(doc.get("result"), list):
        raise ValueError("no result list")
    items = [x for x in (trim_item(it) for it in doc["result"][: q["limit"]]) if x]
    pag = doc.get("pagination")
    total = _count(pag.get("total")) if isinstance(pag, dict) and "total" in pag else q["skip"] + len(items)
    return total, items


class UpstreamError(Exception):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


_UPSTREAM_TLS = ssl.create_default_context()  # certificate and host name checked, like urllib did


def _time_left(deadline: float) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError("deadline")
    return left


class _DeadlineIO(io.RawIOBase):
    """The response's bytes, headers and body alike. Every socket wait gets only the time left until the
    deadline, so an upstream that drips a byte now and then (each recv quick, the whole answer endless)
    cannot hold the call, its slot and the page's waiting visitors past the deadline (review C7)."""

    def __init__(self, sock, raw, deadline: float):
        self._sock = sock
        self._raw = raw  # the socket's own file: it keeps the socket open while the response reads it
        self._deadline = deadline

    def readable(self) -> bool:
        return True

    def readinto(self, b) -> int:
        self._sock.settimeout(_time_left(self._deadline))
        return self._raw.readinto(b)

    def close(self) -> None:
        self._raw.close()
        super().close()


class _DeadlineResponse(http.client.HTTPResponse):
    def __init__(self, sock, deadline: float, *args, **kwargs):
        super().__init__(sock, *args, **kwargs)
        raw = self.fp.detach()  # the base class's socket file, unread: its buffer goes, the file stays
        self.fp = io.BufferedReader(_DeadlineIO(sock, raw, deadline), 65536)


class _DeadlineHTTPS(http.client.HTTPSConnection):
    """TLS whose handshake gets the time left, not a fresh timeout of its own."""

    def __init__(self, host: str, port: int | None, deadline: float):
        super().__init__(host, port, timeout=_time_left(deadline), context=_UPSTREAM_TLS)
        self._deadline = deadline

    def connect(self) -> None:
        http.client.HTTPConnection.connect(self)  # TCP, within the time left
        self.sock.settimeout(_time_left(self._deadline))
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def fetch_upstream(url: str, headers: dict, timeout: float, max_bytes: int) -> tuple[int, dict, bytes]:
    """GET with a deadline for the whole answer: connecting, TLS, the headers and the body together take at
    most `timeout` seconds, because every socket wait gets only the time left (a name lookup is the system
    resolver's and the one step not bounded here). No redirect is followed (a 3xx is returned as its
    status) and no cookie is kept or sent: http.client does neither. Returns (status, lower-case headers,
    body); the body only for a 2xx, like the urllib version before it."""
    deadline = time.monotonic() + timeout
    conn = None
    try:
        u = urllib.parse.urlsplit(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise UpstreamError("network")
        if u.scheme == "https":
            conn = _DeadlineHTTPS(u.hostname, u.port, deadline)
        else:
            conn = http.client.HTTPConnection(u.hostname, u.port, timeout=_time_left(deadline))
        conn.response_class = lambda sock, *a, **kw: _DeadlineResponse(sock, deadline, *a, **kw)
        conn.connect()
        conn.sock.settimeout(_time_left(deadline))
        conn.request("GET", (u.path or "/") + ("?" + u.query if u.query else ""), headers={**headers, "Connection": "close"})
        r = conn.getresponse()
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        if not 200 <= r.status < 300:
            return r.status, hdrs, b""
        chunks, n = [], 0
        while True:
            b = r.read1(65536)  # what has arrived, not a full 64 KiB: the deadline is checked on every wait
            if not b:
                break
            chunks.append(b)
            n += len(b)
            if n > max_bytes:
                raise UpstreamError("too-large")
        return r.status, hdrs, b"".join(chunks)
    except UpstreamError:
        raise
    except TimeoutError as e:  # socket.timeout too
        raise UpstreamError("timeout") from e
    except (http.client.HTTPException, OSError, ValueError) as e:  # refused, reset, TLS, cut short, bad status line
        raise UpstreamError("network") from e
    finally:
        if conn is not None:
            conn.close()


@dataclass
class _Entry:
    t: float      # clock() when fetched
    body: bytes   # the exact response body, served as is
    size: int


class _Flight:
    def __init__(self) -> None:
        self.done = threading.Event()
        self.reply: tuple | None = None


def _retry_after(headers: dict, default: float, cap: float) -> float:
    """Retry-After in seconds, or the `reset=` of their `ratelimit` header, else the default."""
    m = re.search(r"reset=([0-9]{1,6})", headers.get("ratelimit", ""))
    for v in (headers.get("retry-after", ""), m.group(1) if m else ""):
        if _DIGITS_RE.fullmatch(v.strip()):
            return float(min(cap, max(1, int(v))))
    return default


class SupersplProxy:
    """State of the catalogue proxy. Every dependency is injectable for tests (fetch, clocks, limits)."""

    def __init__(self, cfg: SupersplConfig | None = None, fetch=fetch_upstream, clock=time.monotonic, wall=time.time,
                 upstream: str = SUPERSPL_UPSTREAM):
        self.cfg = cfg or SupersplConfig()
        self.fetch = fetch
        self.clock = clock
        self.wall = wall
        self.upstream = upstream
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple, _Entry] = OrderedDict()
        self._bytes = 0
        self._inflight: dict[tuple, _Flight] = {}
        self._tokens = self.cfg.bucket_capacity
        self._tokens_at = clock()
        self._cooldown_until = float("-inf")  # set by an upstream 429 only: that one is global
        self._failed: dict[tuple, tuple[float, str]] = {}  # key -> (no new call before, why)
        self._slots = threading.BoundedSemaphore(self.cfg.upstream_concurrency)
        self._clients: dict[str, deque] = {}
        self.stats = {"upstream_calls": 0, "hit": 0, "miss": 0, "stale": 0, "busy": 0, "error": 0, "limited": 0}

    # ---- replies: (status, body, headers) ----
    def _error(self, status: int, obj: dict, retry_after: float | None = None) -> tuple:
        headers = [("Content-Type", "application/json"), ("Cache-Control", "no-store")]
        if retry_after is not None:
            obj = {**obj, "retryAfter": int(math.ceil(retry_after))}
            headers.append(("Retry-After", str(int(math.ceil(retry_after)))))
        return status, json.dumps({"ok": False, **obj}).encode(), headers

    def _ok(self, ent: _Entry, now: float, state: str) -> tuple:
        fresh_s = int(self.cfg.ttl_s - (now - ent.t)) if state != "stale" else 0
        cc = f"public, max-age={fresh_s}" if fresh_s > 0 else "no-cache"
        self.stats[state] += 1
        return 200, ent.body, [("Content-Type", "application/json; charset=utf-8"), ("Cache-Control", cc), ("X-Cache", state)]

    def _busy(self, now: float) -> tuple:
        with self._lock:
            wait = max(self._cooldown_until - now, (1 - self._tokens) / self.cfg.bucket_refill_per_s, 1)
            self.stats["busy"] += 1
        return self._error(503, {"error": "busy", "detail": "the catalogue is asked too often; try again shortly"}, wait)

    def _stale_or(self, ent: _Entry | None, now: float, fallback) -> tuple:
        """The last good copy (up to stale_max_s old), else fallback() - an error reply."""
        if ent is not None and now - ent.t < self.cfg.stale_max_s:
            return self._ok(ent, now, "stale")
        return fallback()

    # ---- cache (caller holds the lock) ----
    def _get(self, key: tuple, now: float) -> _Entry | None:
        ent = self._cache.get(key)
        if ent is None:
            return None
        if now - ent.t >= self.cfg.stale_max_s:
            self._drop(key)
            return None
        self._cache.move_to_end(key)
        return ent

    def _drop(self, key: tuple) -> None:
        ent = self._cache.pop(key, None)
        if ent is not None:
            self._bytes -= ent.size

    def _put(self, key: tuple, ent: _Entry) -> None:
        if ent.size > self.cfg.cache_max_bytes:
            return
        self._drop(key)
        self._cache[key] = ent
        self._bytes += ent.size
        while self._bytes > self.cfg.cache_max_bytes or len(self._cache) > self.cfg.cache_max_entries:
            _, old = self._cache.popitem(last=False)
            self._bytes -= old.size

    def cache_bytes(self) -> int:
        with self._lock:
            return self._bytes

    # ---- limits (caller holds the lock) ----
    def _take_token(self, now: float) -> bool:
        c = self.cfg
        self._tokens = min(c.bucket_capacity, self._tokens + max(0.0, now - self._tokens_at) * c.bucket_refill_per_s)
        self._tokens_at = now
        if now < self._cooldown_until or self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    def _client_ok(self, client: str, now: float) -> bool:
        c = self.cfg
        with self._lock:
            q = self._clients.get(client)
            if q is None:
                if len(self._clients) >= c.client_table_max:  # addresses are cheap to fake: keep the table bounded
                    for k in [k for k, d in self._clients.items() if not d or now - d[-1] >= c.client_window_s]:
                        del self._clients[k]
                    if len(self._clients) >= c.client_table_max:
                        self._clients.clear()
                q = self._clients[client] = deque()
            while q and now - q[0] >= c.client_window_s:
                q.popleft()
            if len(q) >= c.client_limit:
                self.stats["limited"] += 1
                return False
            q.append(now)
            return True

    # ---- the request ----
    def handle(self, qs: str, client: str) -> tuple:
        now = self.clock()
        if not self._client_ok(client, now):
            return self._error(429, {"error": "rate-limited", "detail": "too many requests from one visitor"}, self.cfg.client_window_s)
        try:
            q = parse_explore_query(qs)
        except BadParam as e:
            return self._error(400, {"error": "bad-param", "param": e.param, "detail": e.detail})
        key = explore_key(q)
        with self._lock:
            ent = self._get(key, now)
            if ent is not None and now - ent.t < self.cfg.ttl_s:
                return self._ok(ent, now, "hit")
            flight = self._inflight.get(key)
            leader = flight is None
            if leader:
                flight = self._inflight[key] = _Flight()
        if not leader:  # the same page is being fetched right now: wait for that answer instead of a 2nd call
            if flight.done.wait(self.cfg.upstream_timeout_s + self.cfg.slot_wait_s + 1) and flight.reply:
                return flight.reply
            later = self.clock()
            return self._stale_or(ent, later, lambda: self._busy(later))
        reply = None
        try:
            reply = self._refresh(q, key, ent, now)
        except Exception:  # noqa: BLE001  a bug here must still answer, and release the waiters
            reply = self._error(502, {"error": "upstream", "detail": "internal"})
        finally:
            with self._lock:
                self._inflight.pop(key, None)
            flight.reply = reply
            flight.done.set()
        return reply

    def _upstream_error(self, detail: str, retry_after: float | None) -> tuple:
        return self._error(502, {"error": "upstream", "detail": detail}, retry_after)

    def _refresh(self, q: dict, key: tuple, ent: _Entry | None, now: float) -> tuple:
        c = self.cfg
        with self._lock:
            failed = self._failed.get(key)
            recent_failure = failed is not None and now < failed[0]
            took = not recent_failure and self._take_token(now)
        if recent_failure:  # this page failed a moment ago: do not wait for the same failure again
            return self._stale_or(ent, now, lambda: self._upstream_error(failed[1], failed[0] - now))
        if not took:
            return self._stale_or(ent, now, lambda: self._busy(now))
        if not self._slots.acquire(timeout=c.slot_wait_s):
            return self._stale_or(ent, now, lambda: self._busy(now))
        status, headers, body, detail = 0, {}, b"", ""
        try:
            with self._lock:
                self.stats["upstream_calls"] += 1
            status, headers, body = self.fetch(explore_upstream_url(q, self.upstream), dict(SUPERSPL_UPSTREAM_HEADERS),
                                               c.upstream_timeout_s, c.upstream_max_bytes)
        except UpstreamError as e:
            detail = e.detail
        except Exception:  # noqa: BLE001  a broken fetch must not take the handler down
            detail = "network"
        finally:
            self._slots.release()
        done = self.clock()
        if status == 429:
            with self._lock:
                self._cooldown_until = done + _retry_after(headers, c.cooldown_429_s, c.cooldown_max_s)
                self.stats["error"] += 1
            return self._stale_or(ent, done, lambda: self._busy(done))
        total, items = 0, []
        if status == 200:
            try:
                total, items = trim_page(json.loads(body), q)
            except ValueError:  # JSONDecodeError and a wrong shape
                detail = "bad-json"
        elif status:
            detail = f"http-{status}"
        if status != 200 or detail:
            detail = detail or "network"
            with self._lock:
                # per page, not global: one query that upsets the upstream must not close the catalogue
                if len(self._failed) >= c.failed_table_max:
                    self._failed = {k: v for k, v in self._failed.items() if v[0] > done}
                    if len(self._failed) >= c.failed_table_max:
                        self._failed.clear()
                self._failed[key] = (done + c.error_cooldown_s, detail)
                self.stats["error"] += 1
            return self._stale_or(ent, done, lambda: self._upstream_error(detail, c.error_cooldown_s))
        pub = {"sort": q["sort"], "order": q["order"], "time": q["time"], "features": q["features"],
               "search": q["search"], "skip": q["skip"], "limit": q["limit"]}
        blob = json.dumps({"ok": True, "query": pub, "total": total, "fetchedAt": int(self.wall()), "items": items},
                          ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        fresh = _Entry(t=done, body=blob, size=len(blob) + c.entry_overhead)
        with self._lock:
            self._put(key, fresh)
            self._failed.pop(key, None)
        return self._ok(fresh, done, "miss")


SUPERSPL = SupersplProxy()


class Handler(BaseHTTPRequestHandler):
    server_version = "gsfpv-api"
    sys_version = ""

    def log_message(self, fmt, *args):  # no client address, no query strings
        print(f"{time.strftime('%H:%M:%S')} {self.command} {self.path.split('?')[0]}", flush=True)

    def _json(self, code: int, obj: dict) -> None:
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _client(self) -> str:
        return (self.headers.get("X-Forwarded-For") or "?").split(",")[0].strip()

    def _body(self) -> dict | None:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            v = json.loads(self.rfile.read(n))
            return v if isinstance(v, dict) else None
        except Exception:  # noqa: BLE001
            return None

    def _send(self, code: int, body: bytes, headers: list) -> None:
        self.send_response(code)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path, _, qs = self.path.partition("?")
        if path == "/api/superspl/explore":
            # only the query string and a client key (for the per-visitor limit, RAM only) are used
            return self._send(*SUPERSPL.handle(qs, self._client()))
        if self.path.split("?")[0] == "/api/health":
            if _guard["tripped"]:
                return self._json(503, {"ok": False, "reason": "disk", "free_gb": round(free_gb(), 2)})
            return self._json(200, {"ok": True, "site": SITE, "free_gb": round(free_gb(), 2)})
        self._json(404, {"ok": False})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/e":
            if not _rate(_ehits, self._client(), 120, 600.0):
                return self._json(429, {"ok": False})
            body = self._body()
            rec = clean_event(body) if body else None
            if rec is None:
                return self._json(400, {"ok": False})
            if not _guard["tripped"]:
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                with _lock, (DATA_DIR / f"events-{rec['ts'][:10]}.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            self.send_response(204)
            self.end_headers()
            return
        if path == "/api/lead":
            if not _rate(_lhits, self._client(), 8, 3600.0):
                return self._json(429, {"ok": False})
            b = self._body()
            if b is None:
                return self._json(400, {"ok": False})
            role = str(b.get("role") or "other")[:20]
            if role not in LEAD_ROLES:
                role = "other"
            email = str(b.get("email") or "").strip()[:254]
            message = str(b.get("message") or "").strip()[:2000]
            scene = str(b.get("scene") or "").strip()[:40]
            locale = str(b.get("locale") or "")[:5]
            honeypot = str(b.get("hp") or "")
            try:
                t_ms = float(b.get("t") or 0)
            except (TypeError, ValueError):
                t_ms = 0
            if role != "takedown" and (not EMAIL_RE.match(email) or b.get("consent") is not True):
                return self._json(400, {"ok": False})
            rec = {"id": str(uuid.uuid4()), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "site": SITE, "role": role,
                   "email": email, "message": message, "scene": scene, "locale": locale,
                   "suspect": bool(honeypot) or t_ms < 3000}
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with _lock, LEADS_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
                os.fsync(f.fileno())
            mid = None
            if not rec["suspect"]:
                text = (f"[LEAD][site={SITE}][type={role}]\nEmail: {email or '-'}\nLang: {locale or '-'}"
                        + (f"\nScene: {scene}" if scene else "") + f"\nMessage:\n{message or '-'}")
                mid = send_telegram(text)
            return self._json(200, {"ok": True, "id": rec["id"], "delivered": mid is not None})
        self._json(404, {"ok": False})


def main() -> None:
    check_disk()
    threading.Thread(target=housekeeping, daemon=True).start()
    port = int(os.environ.get("PORT", "8090"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
