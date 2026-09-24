"""ShramkoGSFPV API (tiny, no framework). Serves only three routes behind nginx:

POST /api/e      cookieless first-party counter. No cookies, no device id, no IP stored. Only
                 whitelisted event names and whitelisted property values are written, one JSONL
                 line per event into DATA_DIR/events-YYYY-MM-DD.jsonl. Rate limit 120 / 10 min
                 per client (in RAM only). Retention: 12 months and at most 50 MB in total.
POST /api/lead   collaboration form and scene takedown reports: stored FIRST (JSONL, fsync),
                 then forwarded to the shared Telegram lead bot. Honeypot + time-to-submit.
GET  /api/health 200 {"ok": true, ...}; 503 when the disk guard has tripped.

Disk guard: below MIN_FREE_GB free, events are no longer written, /api/health answers 503 and
one warning goes to the lead bot. Secrets (TG_BOT_TOKEN, TG_CHAT_ID) come from the environment
only (config.env on the server, never in git). Logs contain method + path + status, no PII.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import urllib.request
import uuid
from collections import defaultdict, deque
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
    "scene_open": {"source": {"showcase", "paste", "history"}},
    "scene_loaded": {"load_ms_bucket": None, "has_collision": {True, False}},
    "input_connected": {"kind": {"hid", "gamepad", "touch", "keyboard", "sim"}},
    "calibration_done": {},
    "arm": {},
    "crash": {},
    "session_end": {"flight_s_bucket": None},
    "webgpu_unavailable": {},
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

    def do_GET(self):
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
