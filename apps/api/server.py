"""ShramkoGSFPV API (tiny, no framework). Serves only these routes behind nginx:

POST /api/e      cookieless first-party counter. No cookies, no device id, no IP stored. Only
                 whitelisted event names and whitelisted property values are written, one JSONL
                 line per event into DATA_DIR/events-YYYY-MM-DD.jsonl. Rate limit 120 / 10 min
                 per client (in RAM only). Retention: 12 months and at most 50 MB in total.
POST /api/lead   collaboration form and scene takedown reports: stored FIRST (JSONL, fsync),
                 then forwarded to the shared Telegram lead bot. Honeypot + time-to-submit.
POST /api/report a bug or an idea from the simulator or the landing, the same rules as a lead: stored
                 FIRST (reports.jsonl, fsync, id R-YYYYMMDD-NNNN), then a short Telegram message
                 (no contact details beyond what the visitor typed, no logs). A bug's technical
                 details (diagnostics) only with the visitor's consent, kept apart in
                 reports/<id>.json; the only body allowed to be large (512 KB, gzip accepted).
                 There is no public way to read reports: tools/reports/pull.py reads them over SSH.
POST /api/share  a picture of the view (JPEG 1200x630) for a link that shows it on social networks:
                 share/<id>.jpg + share/<id>.json. GET /s/<id> is a tiny page with Open Graph and
                 Twitter card tags that sends a visitor on to the simulator with that scene;
                 GET /s/<id>.jpg is the picture (immutable).
GET  /api/catalog the scene catalogue the scene picker shows (public, ETag/304, max-age 60), and
/api/admin/...   the owner's admin behind a password (login, sessions, CSRF, brute-force guard, audit,
                 catalogue draft/publish/history, report status): admin.py, which documents both.
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

import base64
import hashlib
import html
import http.client
import io
import json
import secrets
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
import zlib
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import admin

SITE = os.environ.get("SITE_TAG", "gsfpv")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
LEADS_FILE = DATA_DIR / "leads.jsonl"
MIN_FREE_GB = float(os.environ.get("MIN_FREE_GB", "2"))
EVENTS_CAP_BYTES = int(os.environ.get("EVENTS_CAP_BYTES", str(50 * 1024 * 1024)))
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "365"))
MAX_BODY = 8 * 1024
REPORTS_FILE = DATA_DIR / "reports.jsonl"
REPORTS_DIR = DATA_DIR / "reports"   # <id>.json: a bug's diagnostics, only with the visitor's consent
SHARE_DIR = DATA_DIR / "share"       # <id>.jpg + <id>.json
# the address the share pages name in og:image / og:url (behind nginx the Host header is the container's)
PUBLIC_ORIGIN = os.environ.get("PUBLIC_ORIGIN", "https://gsfpv.flyreelstudio.eu").rstrip("/")
MAX_UPLOAD = 512 * 1024              # a bug report with diagnostics, a share picture: on the wire (nginx: 512k)
MAX_INFLATED = 2 * 1024 * 1024       # a gzip body unpacks to at most this
REPORTS_CAP_BYTES = int(os.environ.get("REPORTS_CAP_BYTES", str(1024 * 1024 * 1024)))
SHARE_CAP_BYTES = int(os.environ.get("SHARE_CAP_BYTES", str(1024 * 1024 * 1024)))

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
_rhits: dict[str, deque] = defaultdict(deque)
_shits: dict[str, deque] = defaultdict(deque)
_all_hits: dict[str, deque] = defaultdict(deque)  # per endpoint, every visitor together
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


# ---------------- bug reports, ideas and share pictures ----------------
# A report is a visitor's own words (bug or idea) plus, for a bug and only with the visitor's consent,
# the technical details the page collected (diagnostics: release, browser, GPU, settings, recent
# errors, frame stats, the current life's flight log, a small picture of the view). It is stored
# before anything else happens; Telegram gets a short note with the id, never the diagnostics.

LOCALES = ("en", "es", "pl", "ru")
REPORT_KINDS = ("bug", "idea")
REPORT_PAGES = ("fly", "site")
REPORT_MESSAGE_MAX = 2000
REPORT_CONTACT_MAX = 200
TELEGRAM_MESSAGE_MAX = 600
_RELEASE_RE = re.compile(r"[0-9A-Za-z._-]{1,40}")
_REPORT_LINE_RE = re.compile(r'^\{"id": "R-([0-9]{8})-([0-9]{4,})"')
_SHARE_ID_RE = re.compile(r"[A-Za-z0-9_-]{11}")
SHARE_W, SHARE_H = 1200, 630
SHARE_IMAGE_MAX = 400 * 1024


class BadBody(ValueError):
    """A request refused for its body: the HTTP status to answer with."""

    def __init__(self, status: int):
        super().__init__(str(status))
        self.status = status


def _plain(v, n: int, lines: bool = False) -> str:
    """A visitor's text: a string only, control and format characters dropped (new lines kept where
    `lines`), trimmed, at most n characters."""
    if not isinstance(v, str):
        return ""
    keep = "\n" if lines else ""
    s = "".join(c for c in v[: n * 2] if c in keep or unicodedata.category(c) not in ("Cc", "Cs", "Cf"))
    return s.strip()[:n].strip()


def gunzip_bounded(raw: bytes, limit: int) -> bytes:
    """A gzip body unpacked to at most `limit` bytes: a small bomb cannot fill the 64 MB container."""
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    try:
        out = d.decompress(raw, limit + 1)
    except zlib.error as e:
        raise BadBody(400) from e
    if len(out) > limit:
        raise BadBody(413)
    if not d.eof:  # cut short
        raise BadBody(400)
    return out


def _write_durable(path: Path, data: bytes) -> None:
    """Whole file or nothing: a temporary file, fsync, then the rename."""
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


_dir_bytes: dict[str, int] = {}


def _dir_room(d: Path, n: int, cap: int) -> bool:
    """Room for n more bytes under the directory's cap (caller holds _lock). Counted from the disk the
    first time, then as files are written."""
    k = str(d)
    if k not in _dir_bytes:
        _dir_bytes[k] = sum(f.stat().st_size for f in d.iterdir() if f.is_file()) if d.exists() else 0
    return _dir_bytes[k] + n <= cap


def _dir_add(d: Path, n: int) -> None:
    _dir_bytes[str(d)] = _dir_bytes.get(str(d), 0) + n


def parse_report(b: dict) -> dict:
    """The whitelist of a report. Diagnostics are kept only for a bug whose sender ticked the consent
    box (diagnosticsConsent: true); without it they are dropped here and never touch the disk."""
    kind = b.get("kind")
    if kind not in REPORT_KINDS:
        raise BadBody(400)
    message = _plain(b.get("message"), REPORT_MESSAGE_MAX, lines=True)
    if not message:
        raise BadBody(400)
    # everything but the diagnostics: the size of a lead
    if len(json.dumps({k: v for k, v in b.items() if k != "diagnostics"}, ensure_ascii=False).encode()) > MAX_BODY:
        raise BadBody(413)
    try:
        t_ms = float(b.get("t") or 0)
    except (TypeError, ValueError):
        t_ms = 0
    diag = b.get("diagnostics")
    consent = b.get("diagnosticsConsent") is True
    locale, page, scene, release = b.get("locale"), b.get("page"), b.get("scene"), b.get("release")
    return {
        "kind": kind,
        "page": page if page in REPORT_PAGES else "",
        "locale": locale if locale in LOCALES else "",
        "scene": scene if isinstance(scene, str) and _ID_RE.fullmatch(scene) else "",
        "release": release if isinstance(release, str) and _RELEASE_RE.fullmatch(release) else "",
        "message": message,
        "contact": _plain(b.get("contact"), REPORT_CONTACT_MAX),
        "suspect": bool(b.get("hp")) or t_ms < 3000,
        "diagnostics": diag if kind == "bug" and consent and isinstance(diag, dict) and diag else None,
    }


_seq: dict = {"day": "", "n": 0, "file": None}


def _next_report_id(now: float) -> str:
    """R-YYYYMMDD-NNNN, numbered per UTC day (caller holds _lock); after a restart the day's last
    number is read back from reports.jsonl."""
    day = time.strftime("%Y%m%d", time.gmtime(now))
    if _seq["day"] != day or _seq["file"] != REPORTS_FILE:
        n = 0
        if REPORTS_FILE.exists():
            with REPORTS_FILE.open(encoding="utf-8") as f:
                for line in f:
                    m = _REPORT_LINE_RE.match(line)
                    if m and m.group(1) == day:
                        n = max(n, int(m.group(2)))
        _seq.update(day=day, n=n, file=REPORTS_FILE)
    _seq["n"] += 1
    return f"R-{day}-{_seq['n']:04d}"


def store_report(r: dict, now: float | None = None) -> dict:
    """Stored before anything is sent: the diagnostics file first (so a record never names a missing
    file), then the record line, both fsynced. A suspect report keeps no diagnostics; a full disk
    (the guard or the directory's cap) keeps the record and says the diagnostics were skipped."""
    now = time.time() if now is None else now
    diag = r["diagnostics"]
    with _lock:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        rid = _next_report_id(now)
        rec = {"id": rid, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "site": SITE,
               **{k: v for k, v in r.items() if k != "diagnostics"}, "diagnostics": False, "diagBytes": 0}
        if diag is not None and not r["suspect"]:
            blob = json.dumps({"id": rid, "ts": rec["ts"], "diagnostics": diag}, ensure_ascii=False, separators=(",", ":")).encode()
            if _guard["tripped"] or not _dir_room(REPORTS_DIR, len(blob), REPORTS_CAP_BYTES):
                rec["diagnostics"] = "skipped"
            else:
                REPORTS_DIR.mkdir(parents=True, exist_ok=True)
                _write_durable(REPORTS_DIR / f"{rid}.json", blob)
                _dir_add(REPORTS_DIR, len(blob))
                rec["diagnostics"], rec["diagBytes"] = True, len(blob)
        with REPORTS_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
    return rec


def report_text(rec: dict) -> str:
    """The Telegram note: what, where, the id to look it up by; no diagnostics, no logs."""
    where = " · ".join(x for x in (f"Page: {rec['page'] or '-'}", f"Lang: {rec['locale'] or '-'}",
                                   f"Scene: {rec['scene']}" if rec["scene"] else "",
                                   f"Release: {rec['release']}" if rec["release"] else "") if x)
    d = rec["diagnostics"]
    diag = f"attached ({max(1, round(rec['diagBytes'] / 1024))} KB)" if d is True else ("not stored, disk full" if d == "skipped" else "none")
    msg = rec["message"]
    short = msg if len(msg) <= TELEGRAM_MESSAGE_MAX else msg[: TELEGRAM_MESSAGE_MAX - 3] + "..."
    return (f"[{rec['kind'].upper()}][site={SITE}] {rec['id']}\n{where}\nDiagnostics: {diag}\n"
            f"Contact: {rec['contact'] or '-'}\nMessage:\n{short}")


# Share pages: the words follow what FPV pilots answer to (a real place, real physics, their own radio,
# free, in the browser, a challenge). Facts only: what the simulator does today, no numbers.
SHARE_TEXT = {
    "en": {
        "title": "Fly an FPV drone through {scene} — right in your browser",
        "scan": "a real 3D scan",
        "desc": "A real 3D scan, Betaflight-style rates and PID, walls you actually crash into. Plug in your own radio over USB or fly with touch sticks. Free, open source, nothing to install. Can you fly this line?",
        "credit": "Scan: {credit}.",
        "cta": "Fly it now",
        "alt": "FPV view inside {scene}, a 3D Gaussian Splatting scan, in the ShramkoGSFPV simulator",
    },
    "es": {
        "title": "Vuela un dron FPV a través de {scene}, directamente en tu navegador",
        "scan": "un escaneo 3D real",
        "desc": "Un escaneo 3D real, rates y PID al estilo Betaflight, paredes contra las que de verdad te estrellas. Conecta tu propia emisora por USB o vuela con sticks táctiles. Gratis, de código abierto, sin instalar nada. ¿Te atreves con esta línea?",
        "credit": "Escaneo: {credit}.",
        "cta": "Volar ahora",
        "alt": "Vista FPV dentro de {scene}, un escaneo 3D Gaussian Splatting, en el simulador ShramkoGSFPV",
    },
    "pl": {
        "title": "Leć dronem FPV przez {scene} — prosto w przeglądarce",
        "scan": "prawdziwy skan 3D",
        "desc": "Prawdziwy skan 3D, rates i PID jak w Betaflight, ściany, w które naprawdę się rozbijasz. Podłącz własną aparaturę przez USB albo leć na dotykowych drążkach. Za darmo, open source, bez instalacji. Przelecisz tę linię?",
        "credit": "Skan: {credit}.",
        "cta": "Leć teraz",
        "alt": "Widok FPV wewnątrz {scene}, skan 3D Gaussian Splatting, w symulatorze ShramkoGSFPV",
    },
    "ru": {
        "title": "Пролети на FPV-дроне через {scene} — прямо в браузере",
        "scan": "настоящий 3D-скан",
        "desc": "Настоящий 3D-скан, рейты и PID как в Betaflight, стены, в которые по-настоящему врезаешься. Подключи свой пульт по USB или летай на сенсорных стиках. Бесплатно, open source, без установки. Пролетишь эту линию?",
        "credit": "Скан: {credit}.",
        "cta": "Лететь",
        "alt": "FPV-вид внутри {scene}, 3D Gaussian Splatting скан, в симуляторе ShramkoGSFPV",
    },
}
OG_LOCALE = {"en": "en_US", "es": "es_ES", "pl": "pl_PL", "ru": "ru_RU"}
# the page's only script sends a person on to the simulator; link-preview crawlers do not run it, so
# they read this page's tags and not the simulator's (a meta refresh some of them would follow)
_SHARE_SCRIPT = 'location.replace(document.getElementById("go").href)'
_SHARE_SCRIPT_HASH = "sha256-" + base64.b64encode(hashlib.sha256(_SHARE_SCRIPT.encode()).digest()).decode()
SHARE_CSP = (f"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src '{_SHARE_SCRIPT_HASH}'; "
             "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def jpeg_size(b: bytes) -> tuple[int, int] | None:
    """(width, height) from the frame header of a whole JPEG (SOI ... EOI), else None."""
    if len(b) < 8 or b[:3] != b"\xff\xd8\xff" or b[-2:] != b"\xff\xd9":
        return None
    i = 2
    while i + 4 <= len(b):
        if b[i] != 0xFF:
            return None
        m = b[i + 1]
        if m == 0xFF:  # fill byte
            i += 1
            continue
        if 0xD0 <= m <= 0xD8 or m == 0x01:  # markers without a length
            i += 2
            continue
        seg = int.from_bytes(b[i + 2:i + 4], "big")
        if seg < 2:
            return None
        if m in _SOF:
            if i + 9 > len(b):
                return None
            return int.from_bytes(b[i + 7:i + 9], "big"), int.from_bytes(b[i + 5:i + 7], "big")
        if m == 0xDA:  # image data before any frame header
            return None
        i += 2 + seg
    return None


def parse_share(b: dict) -> tuple[bytes, dict]:
    """The picture (a whole JPEG of exactly 1200x630, at most 400 KB) and its words, cut to size."""
    if b.get("hp"):
        raise BadBody(400)
    img = b.get("image")
    if not isinstance(img, str):
        raise BadBody(400)
    img = img.removeprefix("data:image/jpeg;base64,")
    if len(img) > SHARE_IMAGE_MAX * 4 // 3 + 4:
        raise BadBody(413)
    try:
        data = base64.b64decode(img, validate=True)
    except ValueError as e:  # binascii.Error
        raise BadBody(400) from e
    if jpeg_size(data) != (SHARE_W, SHARE_H):
        raise BadBody(400)
    scene, locale = b.get("scene"), b.get("locale")
    if not isinstance(scene, str) or not _ID_RE.fullmatch(scene):
        raise BadBody(400)
    return data, {"scene": scene, "title": _plain(b.get("title"), 80), "credit": _plain(b.get("credit"), 160),
                  "locale": locale if locale in LOCALES else "en"}


def store_share(data: bytes, meta: dict, now: float | None = None) -> str:
    """The picture, then its words (the page exists once both do); 503 under the disk guard, 507 over the cap."""
    now = time.time() if now is None else now
    sid = secrets.token_urlsafe(8)  # 11 characters: not guessable, nothing to enumerate
    doc = json.dumps({"id": sid, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), **meta}, ensure_ascii=False).encode()
    with _lock:
        if _guard["tripped"]:
            raise BadBody(503)
        if not _dir_room(SHARE_DIR, len(data) + len(doc), SHARE_CAP_BYTES):
            raise BadBody(507)
        SHARE_DIR.mkdir(parents=True, exist_ok=True)
        _write_durable(SHARE_DIR / f"{sid}.jpg", data)
        _write_durable(SHARE_DIR / f"{sid}.json", doc)
        _dir_add(SHARE_DIR, len(data) + len(doc))
    return sid


def share_image(sid: str) -> bytes | None:
    if not _SHARE_ID_RE.fullmatch(sid):
        return None
    try:
        return (SHARE_DIR / f"{sid}.jpg").read_bytes()
    except OSError:
        return None


def share_page(sid: str) -> bytes | None:
    """The page a shared link opens: Open Graph and Twitter card tags for the crawlers, a picture, the
    words and a link for a person (the script follows it at once). Every visitor's word is escaped."""
    if not _SHARE_ID_RE.fullmatch(sid):
        return None
    try:
        meta = json.loads((SHARE_DIR / f"{sid}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(meta, dict) or not isinstance(meta.get("scene"), str) or not _ID_RE.fullmatch(meta["scene"]):
        return None
    loc = meta.get("locale") if meta.get("locale") in LOCALES else "en"
    tx = SHARE_TEXT[loc]
    name = _plain(meta.get("title"), 80) or tx["scan"]
    credit = _plain(meta.get("credit"), 160)
    title = tx["title"].format(scene=name)
    desc = tx["desc"] + (" " + tx["credit"].format(credit=credit) if credit else "")
    alt = tx["alt"].format(scene=name)
    page = f"{PUBLIC_ORIGIN}/s/{sid}"
    img = f"{PUBLIC_ORIGIN}/s/{sid}.jpg"
    fly = f"/{loc}/fly/?scene={meta['scene']}"
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    tags = [("property", "og:type", "website"), ("property", "og:site_name", "ShramkoGSFPV"), ("property", "og:title", title),
            ("property", "og:description", desc), ("property", "og:url", page), ("property", "og:image", img),
            ("property", "og:image:secure_url", img), ("property", "og:image:type", "image/jpeg"),
            ("property", "og:image:width", str(SHARE_W)), ("property", "og:image:height", str(SHARE_H)),
            ("property", "og:image:alt", alt), ("property", "og:locale", OG_LOCALE[loc]),
            ("name", "twitter:card", "summary_large_image"), ("name", "twitter:title", title),
            ("name", "twitter:description", desc), ("name", "twitter:image", img), ("name", "twitter:image:alt", alt)]
    head = "\n".join(f'<meta {a}="{k}" content="{e(v)}">' for a, k, v in tags)
    doc = f"""<!doctype html>
<html lang="{loc}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="{e(page)}">
{head}
<style>body{{margin:0;background:#07080a;color:#e8eaed;font:16px/1.5 system-ui,sans-serif}}main{{max-width:720px;margin:0 auto;padding:16px}}img{{width:100%;height:auto;border-radius:8px}}a{{display:inline-block;margin-top:8px;padding:12px 20px;border-radius:8px;background:#4ade80;color:#03170b;font-weight:600;text-decoration:none}}p{{color:#9ba3ae}}</style>
</head>
<body>
<main>
<img src="{e(img)}" alt="{e(alt)}" width="{SHARE_W}" height="{SHARE_H}">
<h1>{e(title)}</h1>
<p>{e(desc)}</p>
<a id="go" href="{e(fly)}">{e(tx['cta'])}</a>
</main>
<script>{_SHARE_SCRIPT}</script>
</body>
</html>
"""
    return doc.encode("utf-8")


# ---------------- the owner's admin and the public catalogue (admin.py) ----------------

def _catalog_seed() -> Path | None:
    """The first catalogue (used once, while DATA_DIR/catalog.json does not exist): CATALOG_SEED, else
    showcase.json next to this file (the hub: copied into $GSFPV_BASE/api/), else the repo's own."""
    here = Path(__file__).resolve().parent
    for p in (os.environ.get("CATALOG_SEED"), here / "showcase.json", here.parent / "fly" / "public" / "showcase.json"):
        if p and Path(p).is_file():
            return Path(p)
    return None


ADMIN = admin.AdminApi(data_dir=lambda: DATA_DIR, reports_file=lambda: REPORTS_FILE, reports_dir=lambda: REPORTS_DIR,
                       seed=_catalog_seed, telegram=lambda text: send_telegram(text), site=SITE)


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

    def _upload(self) -> dict:
        """A body that may be large (a report with diagnostics, a share picture): JSON, plain or gzip."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise BadBody(400) from None
        if n <= 0:
            raise BadBody(400)
        if n > MAX_UPLOAD:
            # read a modest excess away so the client gets the 413 instead of a reset; a huge one is cut off
            # (behind nginx client_max_body_size answers first)
            left = n if n <= 4 * MAX_UPLOAD else 0
            while left > 0:
                got = len(self.rfile.read(min(left, 65536)))
                if not got:
                    break
                left -= got
            raise BadBody(413)
        raw = self.rfile.read(n)
        enc = (self.headers.get("Content-Encoding") or "identity").strip().lower()
        if enc == "gzip":
            raw = gunzip_bounded(raw, MAX_INFLATED)
        elif enc != "identity":
            raise BadBody(415)
        try:
            v = json.loads(raw)
        except ValueError as e:  # UnicodeDecodeError too
            raise BadBody(400) from e
        if not isinstance(v, dict):
            raise BadBody(400)
        return v

    def _admin_body(self, limit: int) -> bytes:
        """An admin request's body, read only once the session is known (admin.AdminApi.handle)."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > limit:
            raise admin.TooLarge()
        return self.rfile.read(n) if n else b""

    def _admin(self, method: str, path: str) -> None:
        self._send(*ADMIN.handle(method, path, self.headers, self._admin_body, self._client()))

    def _send(self, code: int, body: bytes, headers: list, head: bool = False) -> None:
        self.send_response(code)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _share(self, path: str, head: bool) -> None:
        """GET/HEAD /s/<id> (the page) and /s/<id>.jpg (the picture); nginx adds the common headers (nosniff...)."""
        rest = path[len("/s/"):]
        if rest.endswith(".jpg"):
            img = share_image(rest[:-4])
            if img is not None:
                return self._send(200, img, [("Content-Type", "image/jpeg"), ("Cache-Control", "public, max-age=31536000, immutable")], head)
        else:
            doc = share_page(rest)
            if doc is not None:
                return self._send(200, doc, [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "public, max-age=3600"),
                                             ("Content-Security-Policy", SHARE_CSP)], head)
        self._send(404, b'<!doctype html><meta charset="utf-8"><title>Not found</title><p><a href="/">ShramkoGSFPV</a></p>\n',
                   [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store")], head)

    def do_HEAD(self):
        path = self.path.split("?")[0]
        if path.startswith("/s/"):
            return self._share(path, head=True)
        self._send(404, b"", [("Content-Type", "application/json")], head=True)

    def do_GET(self):
        path, _, qs = self.path.partition("?")
        if path.startswith("/s/"):
            return self._share(path, head=False)
        if path == "/api/superspl/explore":
            # only the query string and a client key (for the per-visitor limit, RAM only) are used
            return self._send(*SUPERSPL.handle(qs, self._client()))
        if path == "/api/catalog":
            return self._send(*ADMIN.public_catalog(self.headers.get("If-None-Match")))
        if path.startswith("/api/admin/"):
            return self._admin("GET", path)
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
        if path == "/api/report":
            if not _rate(_rhits, self._client(), 10, 3600.0) or not _rate(_all_hits, "report", 300, 3600.0):
                return self._json(429, {"ok": False})
            try:
                r = parse_report(self._upload())
                rec = store_report(r)
            except BadBody as e:
                return self._json(e.status, {"ok": False})
            except OSError:  # not stored: nothing is sent either
                return self._json(500, {"ok": False})
            mid = None if rec["suspect"] else send_telegram(report_text(rec))
            return self._json(200, {"ok": True, "id": rec["id"], "diagnostics": rec["diagnostics"], "delivered": mid is not None})
        if path.startswith("/api/admin/"):
            return self._admin("POST", path)
        if path == "/api/share":
            if not _rate(_shits, self._client(), 12, 3600.0) or not _rate(_all_hits, "share", 300, 3600.0):
                return self._json(429, {"ok": False})
            try:
                data, meta = parse_share(self._upload())
                sid = store_share(data, meta)
            except BadBody as e:
                return self._json(e.status, {"ok": False})
            except OSError:
                return self._json(500, {"ok": False})
            return self._json(200, {"ok": True, "id": sid, "url": f"{PUBLIC_ORIGIN}/s/{sid}", "image": f"{PUBLIC_ORIGIN}/s/{sid}.jpg"})
        self._json(404, {"ok": False})


def main() -> None:
    check_disk()
    threading.Thread(target=housekeeping, daemon=True).start()
    port = int(os.environ.get("PORT", "8090"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
