"""Fly by Sound recordings on the server (v0.12, lane v12-feedback, docs/wip/v12-plan.md 4.3 step 6 and section 8).

A pilot's flight and voice reach the author as ONE .zip (the session package of the sound repository). Not
losing it is the requirement, so the rules of this module are about order and proof:

- the client keeps its package until the server says "stored"; the server says it only after the package is
  whole on disk (size and SHA-256 checked, file and directory fsynced) and the delivery queue entries are on
  disk too; a retry of any call after a lost answer gives the same answer;
- the upload is in chunks of CHUNK_BYTES (1 MiB, the size nginx allows: 1100k). A chunk is streamed from the
  socket to its place in ONE preallocated file (never held in memory), checked against the client's chunk hash
  when it sent one, fsynced, and only then recorded as held. A held chunk never changes: the same bytes again
  are accepted, other bytes are refused. A restart or a dropped connection costs at most the chunk in flight;
  `status` lists the chunks held, so the client resumes;
- `finish` hashes the whole file against the SHA-256 given at `start`, then reads manifest.json from the zip and
  enforces the privacy rule in the server too (a minor's package needs the guardian's confirmation; `start`
  needs the pilot's separate confirmation to send), whatever the client says;
- limits: one package at most SESSION_MAX_BYTES (100 MiB), all packages SESSIONS_CAP_BYTES (2 GiB, uploads in
  progress count), the disk guard (free space under MIN_FREE_GB, or less than the package needs, refuses), a
  few unfinished uploads per client and in all, abandoned uploads are removed after UPLOAD_TTL_S, and one that has
  held no chunk at all for UPLOAD_IDLE_S gives its reservation back at the next sweep (a reservation that never starts
  must not hold 100 MiB of the quota for a day). Per-client and global request rates are kept by server.py (_rate),
  which owns the other routes' limits too.

Storage under DATA_DIR/sessions/:
    index.jsonl            one line per package stored (and a tombstone per deletion): the audit trail
    <id>/meta.json         the session's whole state, replaced atomically (temporary file, fsync, rename)
    <id>/upload.part       the package while it is uploaded (preallocated, written by chunk)
    <id>/package.zip       the package once it is stored
A session id is S-YYYYMMDD-<12 hex>, random, never a counter, so nothing can be enumerated. The upload token
(256 random bits as text) is shown once, at `start`; only its SHA-256 is stored; it is compared in constant
time. The client's address is never written: the per-client limit lives in memory only.

The delivery queue (Telegram, e-mail) is the `channels` of a stored session's meta.json; session_delivery.py
works it. Each channel has its own state: queued, retrying, sending, sent, link (the package was too large for
the channel, a message with the admin link was delivered instead), failed (gave up; the admin can resend).
`delivered` is true only when every channel is sent or link.

Routes (server.py): POST /api/session/start, POST /api/session/<id>/<n>, POST /api/session/<id>/finish,
GET /api/session/<id>. The token comes in the X-Session-Token header; for GET also as ?token=.
"""
from __future__ import annotations

import calendar
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
import zipfile
from pathlib import Path
from typing import Callable

CHUNK_BYTES = 1 << 20
MAX_PACKAGE_BYTES = int(os.environ.get("SESSION_MAX_BYTES", str(100 * 1024 * 1024)))
SESSIONS_CAP_BYTES = int(os.environ.get("SESSIONS_CAP_BYTES", str(2 * 1024 * 1024 * 1024)))
UPLOAD_TTL_S = 24 * 3600
UPLOAD_IDLE_S = 15 * 60           # an upload that has held no chunk for this long gives its reservation back (sweep)
CLAIM_STALE_S = 5 * 60            # a channel that has stood `sending` this long with no worker on it goes back to queued (session_delivery)
ALIAS_TTL_S = 30 * 24 * 3600      # an alias of a package already stored is a few bytes; its holder may poll the delivery for days
RETENTION_DAYS = int(os.environ.get("SESSION_RETENTION_DAYS", "1826"))   # the privacy text promises at most five years
MAX_OPEN_PER_CLIENT = 6
MAX_OPEN_TOTAL = 48
MANIFEST_MAX = 256 * 1024
READ_BLOCK = 64 * 1024
CHANNELS = ("telegram", "email")
TERMINAL_OK = ("sent", "link")
SESSION_FORMAT = "shramko-sonic-session/1"

SID_RE = re.compile(r"S-[0-9]{8}-[0-9a-f]{12}")
HASH_RE = re.compile(r"[0-9a-f]{64}")
_PACKAGE_ID_RE = re.compile(r"[A-Za-z0-9_-]{8,64}")
_LESSON_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
_RELEASE_RE = re.compile(r"[0-9A-Za-z._-]{1,40}")
_LOCALES = ("en", "es", "pl", "ru")


class SessionError(Exception):
    """A refusal with its HTTP status and a stable code (never a path, a token or a hash of someone else's data)."""

    def __init__(self, status: int, code: str, **extra):
        super().__init__(f"{status} {code}")
        self.status, self.code, self.extra = status, code, extra


# ----------------------------------------------------------------------------- durable files

def _fsync_file(f) -> None:
    f.flush()
    os.fsync(f.fileno())


def _fsync_dir(path: Path) -> None:
    """Make a rename or a new file in `path` durable (POSIX; Windows cannot open a directory: nothing to do there)."""
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


def _replace(src: Path, dst: Path) -> None:
    """os.replace; Windows refuses while another handle (a scanner, a reader) has the target open for a moment."""
    for i in range(8):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == 7:
                raise
            time.sleep(0.02 * (i + 1))


def _write_json(path: Path, obj: dict) -> None:
    """Whole file or nothing: a temporary file beside it, fsync, rename, fsync of the directory."""
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        _fsync_file(f)
    _replace(tmp, path)
    _fsync_dir(path.parent)


def _write_at(f, offset: int, data: bytes) -> None:
    """One block of a chunk into the upload file (a seam: the tests make this raise ENOSPC)."""
    f.seek(offset)
    f.write(data)


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _parse_iso(s) -> float | None:
    if not isinstance(s, str):
        return None
    try:
        return float(calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")))
    except ValueError:
        return None


# ----------------------------------------------------------------------------- the manifest's facts

def manifest_summary(m: dict) -> dict:
    """The few facts of a package's manifest the owner's list shows, each cut to its own shape. Never the pilot's
    nickname, the device or the user agent: those stay inside the package."""
    consent = m.get("consent") if isinstance(m.get("consent"), dict) else {}
    lesson = m.get("lesson") if isinstance(m.get("lesson"), dict) else None
    device = m.get("device") if isinstance(m.get("device"), dict) else {}
    app = m.get("app") if isinstance(m.get("app"), dict) else {}
    pid = m.get("id")
    start, end = _parse_iso(m.get("created")), _parse_iso(m.get("ended"))
    lid = lesson.get("id") if lesson else None
    files = []
    for f in m.get("files") if isinstance(m.get("files"), list) else []:
        if isinstance(f, dict) and isinstance(f.get("name"), str) and re.fullmatch(r"[A-Za-z0-9._-]{1,40}", f["name"]) and isinstance(f.get("bytes"), int) and f["bytes"] >= 0:
            files.append({"name": f["name"], "bytes": f["bytes"]})
    return {
        "packageId": pid if isinstance(pid, str) and _PACKAGE_ID_RE.fullmatch(pid) else "",
        "lesson": lid if isinstance(lid, str) and _LESSON_RE.fullmatch(lid) else "",
        "path": lesson.get("path") if lesson and lesson.get("path") in ("full", "fast") else "",
        "locale": device.get("locale") if device.get("locale") in _LOCALES else "",
        "minor": consent.get("minor") is True,
        "guardianConfirmed": consent.get("guardianConfirmed") is True,
        "voice": consent.get("voice") is True,
        "complete": m.get("complete") is True,
        "durationMs": int((end - start) * 1000) if start is not None and end is not None and end >= start else None,
        "release": app.get("release") if isinstance(app.get("release"), str) and _RELEASE_RE.fullmatch(app["release"]) else "",
        "sonic": app.get("sonic") if isinstance(app.get("sonic"), str) and _RELEASE_RE.fullmatch(app["sonic"]) else "",
        "files": files[:8],
    }


def request_summary(b) -> dict:
    """What the client says about its package at `start` (informational: the manifest in the zip decides)."""
    b = b if isinstance(b, dict) else {}
    lesson = b.get("lesson")
    pid = b.get("packageId")
    return {
        "packageId": pid if isinstance(pid, str) and _PACKAGE_ID_RE.fullmatch(pid) else "",
        "lesson": lesson if isinstance(lesson, str) and _LESSON_RE.fullmatch(lesson) else "",
        "minor": b.get("minor") is True,
        "voice": b.get("voice") is True,
        "release": b.get("release") if isinstance(b.get("release"), str) and _RELEASE_RE.fullmatch(b["release"]) else "",
    }


# ----------------------------------------------------------------------------- the store

class SessionStore:
    def __init__(self, data_dir: Callable[[], Path], *, free_bytes: Callable[[], int] | None = None, min_free_bytes: Callable[[], int] | None = None,
                 cap_bytes: Callable[[], int] | None = None, max_bytes: Callable[[], int] | None = None,
                 now: Callable[[], float] = time.time, on_change: Callable[[str], None] | None = None):
        self._data_dir = data_dir
        self._free = free_bytes or (lambda: shutil.disk_usage(self.root if self.root.exists() else self.root.parent).free)
        self._min_free = min_free_bytes or (lambda: 0)
        self._cap = cap_bytes or (lambda: SESSIONS_CAP_BYTES)
        self._max = max_bytes or (lambda: MAX_PACKAGE_BYTES)
        self.now = now
        self.on_change = on_change
        self._mu = threading.Lock()
        self._locks: dict[str, threading.RLock] = {}
        self._inflight: set[tuple[str, int]] = set()
        self._open: dict[str, tuple[int, str]] = {}      # unfinished: id -> (bytes reserved, client key); memory only
        self._stored_bytes = 0
        self._due: dict[str, dict[str, float]] = {}      # id -> {channel: nextAt} for channels that still have work
        self._indexed = False

    # ---- paths and locks

    @property
    def root(self) -> Path:
        return self._data_dir() / "sessions"

    def dir(self, sid: str) -> Path:
        return self.root / sid

    def package_path(self, sid: str) -> Path:
        return self.dir(sid) / "package.zip"

    def _lock(self, sid: str) -> threading.RLock:
        with self._mu:
            lk = self._locks.get(sid)
            if lk is None:
                lk = self._locks[sid] = threading.RLock()
            return lk

    # ---- reading and writing a session's state

    def _read(self, sid: str) -> dict:
        if not SID_RE.fullmatch(sid):
            raise SessionError(404, "unknown")
        try:
            with self._lock(sid):
                return json.loads((self.dir(sid) / "meta.json").read_bytes())
        except FileNotFoundError:
            raise SessionError(404, "unknown") from None
        except (ValueError, OSError):
            raise SessionError(500, "unreadable") from None

    def get(self, sid: str) -> dict | None:
        """The session's state, or None when there is none (internal: no token)."""
        try:
            return self._read(sid)
        except SessionError:
            return None

    def update(self, sid: str, fn: Callable[[dict], object]) -> dict:
        """Read, change in `fn`, write atomically, refresh the queue index. Raises what `fn` raises (nothing is written then)."""
        with self._lock(sid):
            meta = self._read(sid)
            fn(meta)
            _write_json(self.dir(sid) / "meta.json", meta)
            work = self._reindex(meta)
        if work and self.on_change is not None:
            self.on_change(sid)
        return meta

    def _reindex(self, meta: dict) -> bool:
        """Refresh the queue index of one session; True when a channel still has work."""
        sid = meta["id"]
        work: dict[str, float] = {}
        wake = False
        if meta.get("state") == "stored":
            for name, ch in (meta.get("channels") or {}).items():
                if ch.get("status") in ("queued", "retrying"):
                    work[name] = float(ch.get("nextAt") or 0)
                    wake = True
                # a send that is on its way (`sending`) is looked at again when its claim has stood CLAIM_STALE_S: a worker that wrote
                # the claim and then could not write the outcome leaves it so, and nothing else would ever look (not work to wake for)
                if ch.get("status") == "sending":
                    work[f"{name}:claim"] = float(ch.get("claimedAt") or 0) + CLAIM_STALE_S
                # a notice about this channel's trouble that could not go through the other channel yet is work too
                if any(n.get("state") == "pending" for n in (ch.get("notices") or {}).values()):
                    work[f"{name}:notice"] = float(ch.get("noticeAt") or 0)
                    wake = True
        with self._mu:
            if work:
                self._due[sid] = work
            else:
                self._due.pop(sid, None)
        return wake

    def due(self, channel: str, now: float | None = None) -> list[str]:
        """Sessions whose `channel` is waiting and its time has come, the oldest wait first."""
        t = self.now() if now is None else now
        with self._mu:
            return [sid for sid, w in sorted(self._due.items(), key=lambda kv: kv[1].get(channel, 0)) if channel in w and w[channel] <= t]

    def next_due_at(self, channel: str) -> float | None:
        with self._mu:
            times = [w[channel] for w in self._due.values() if channel in w]
        return min(times) if times else None

    # ---- start up

    def recover(self) -> dict:
        """Run once before the workers: rebuild the in-memory indexes from the disk, and turn a send that a restart cut
        off (`sending`) back into `queued`: it may or may not have gone, and a doubled copy for the owner costs nothing
        where a lost one costs the recording. Leftover temporary files are removed. Never raises on one bad session."""
        stats = {"sessions": 0, "requeued": 0, "bad": 0, "tmp": 0}
        stored_bytes = 0
        with self._mu:
            self._open.clear()
            self._due.clear()
        root = self.root
        if root.exists():
            for d in sorted(root.iterdir()):
                if not d.is_dir() or not SID_RE.fullmatch(d.name):
                    continue
                for tmp in d.glob("*.tmp"):
                    try:
                        tmp.unlink()
                        stats["tmp"] += 1
                    except OSError:
                        pass
                try:
                    meta = json.loads((d / "meta.json").read_bytes())
                except (OSError, ValueError):
                    stats["bad"] += 1
                    print(f"sessions: {d.name} has no readable meta.json (kept on disk, not served)", flush=True)
                    continue
                stats["sessions"] += 1
                if meta.get("state") == "stored":
                    stored_bytes += int(meta.get("bytes") or 0)
                    changed = False
                    for ch in (meta.get("channels") or {}).values():
                        if ch.get("status") == "sending":
                            ch["status"], ch["recovered"], ch["nextAt"] = "queued", True, 0
                            changed = True
                            stats["requeued"] += 1
                    if changed:
                        _write_json(d / "meta.json", meta)
                    self._reindex(meta)
                elif meta.get("state") == "uploading":
                    with self._mu:
                        self._open[meta["id"]] = (int(meta.get("size") or 0), "")
        with self._mu:
            self._stored_bytes = stored_bytes
            self._indexed = True
        return stats

    def _ensure_indexed(self) -> None:
        if not self._indexed:
            self.recover()

    # ---- the routes' work

    def _new_id(self) -> str:
        return f"S-{time.strftime('%Y%m%d', time.gmtime(self.now()))}-{secrets.token_hex(6)}"

    def _find_stored(self, digest: str) -> str | None:
        root = self.root
        if not root.exists():
            return None
        for d in root.iterdir():
            if not d.is_dir() or not SID_RE.fullmatch(d.name):
                continue
            try:
                m = json.loads((d / "meta.json").read_bytes())
            except (OSError, ValueError):
                continue
            if m.get("state") == "stored" and m.get("sha256") == digest:
                return m["id"]
        return None

    def start(self, client: str, body) -> dict:
        """POST /api/session/start. Body: size (bytes), sha256 (of the whole package), consentSend (true: the pilot's
        separate confirmation to send), and the optional facts packageId, lesson, minor, voice, release."""
        self._ensure_indexed()
        if not isinstance(body, dict):
            raise SessionError(400, "bad-request")
        size, digest = body.get("size"), body.get("sha256")
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
            raise SessionError(400, "bad-size")
        if not isinstance(digest, str) or not HASH_RE.fullmatch(digest):
            raise SessionError(400, "bad-hash")
        if body.get("consentSend") is not True:
            raise SessionError(403, "no-consent")
        if size > self._max():
            raise SessionError(413, "too-large", limit=self._max())
        now = self.now()
        summary = request_summary(body)
        sid, token = self._new_id(), secrets.token_urlsafe(32)
        sdir = self.dir(sid)
        # a package that is already stored is not uploaded again: this session is an alias of it (its token polls the same status)
        existing = self._find_stored(digest)
        if existing is not None:
            sdir.mkdir(parents=True, exist_ok=True)
            _write_json(sdir / "meta.json", {"v": 1, "id": sid, "state": "duplicate", "of": existing, "created": _iso(now), "ts": now,
                                              "size": size, "sha256": digest, "tokenSha256": _sha256_hex(token), "summary": summary})
            return {"ok": True, "id": sid, "token": token, "stored": True, "duplicate": True, "chunkBytes": CHUNK_BYTES, "chunks": 0}
        with self._mu:
            mine = sum(1 for _, (_, c) in self._open.items() if c == client)
            reserved = sum(b for b, _ in self._open.values())
            if mine >= MAX_OPEN_PER_CLIENT or len(self._open) >= MAX_OPEN_TOTAL:
                raise SessionError(429, "too-many-uploads")
            if self._stored_bytes + reserved + size > self._cap():
                raise SessionError(507, "cap")
            self._open[sid] = (size, client)
        try:
            if self._free() - size < self._min_free():
                raise SessionError(507, "disk")
            sdir.mkdir(parents=True, exist_ok=True)
            part = sdir / "upload.part"
            with part.open("wb") as f:
                try:
                    os.posix_fallocate(f.fileno(), 0, size)       # takes the room now (Linux); elsewhere the file is made sparse
                except (AttributeError, OSError) as e:
                    if isinstance(e, OSError) and e.errno == errno.ENOSPC:
                        raise
                    f.truncate(size)
                _fsync_file(f)
            chunks = -(-size // CHUNK_BYTES)
            meta = {"v": 1, "id": sid, "state": "uploading", "created": _iso(now), "ts": now, "size": size, "sha256": digest, "chunkBytes": CHUNK_BYTES,
                    "chunks": chunks, "held": {}, "tokenSha256": _sha256_hex(token), "consent": {"send": True, "at": _iso(now)}, "summary": summary}
            _write_json(sdir / "meta.json", meta)
        except OSError as e:
            self._forget_open(sid)
            shutil.rmtree(sdir, ignore_errors=True)
            raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
        except SessionError:
            self._forget_open(sid)
            shutil.rmtree(sdir, ignore_errors=True)
            raise
        return {"ok": True, "id": sid, "token": token, "stored": False, "chunkBytes": CHUNK_BYTES, "chunks": chunks}

    def _forget_open(self, sid: str) -> None:
        with self._mu:
            self._open.pop(sid, None)

    def _authed(self, sid: str, token: str | None) -> dict:
        meta = self._read(sid)
        if not token or not hmac.compare_digest(_sha256_hex(token), str(meta.get("tokenSha256") or "")):
            raise SessionError(403, "token")
        return meta

    @staticmethod
    def _chunk_len(meta: dict, n: int) -> int:
        return min(meta["chunkBytes"], meta["size"] - n * meta["chunkBytes"])

    def put_chunk(self, sid: str, token: str | None, n: int, length: int, read: Callable[[int], bytes], chunk_sha256: str | None = None) -> dict:
        """POST /api/session/<id>/<n>: `length` bytes from `read` are chunk n. Streamed in READ_BLOCK pieces; nothing but a piece is in memory."""
        meta = self._authed(sid, token)
        if meta["state"] == "duplicate":
            raise SessionError(409, "duplicate", of=meta.get("of"))
        if meta["state"] != "uploading":
            raise SessionError(409, "not-uploading")
        if not 0 <= n < meta["chunks"]:
            raise SessionError(404, "bad-chunk")
        expect = self._chunk_len(meta, n)
        if length != expect:
            raise SessionError(413 if length > expect else 400, "bad-length", expect=expect)
        if chunk_sha256 is not None and not HASH_RE.fullmatch(chunk_sha256.lower()):
            raise SessionError(400, "bad-hash")
        key = (sid, n)
        with self._mu:
            if key in self._inflight:
                raise SessionError(409, "busy")
            self._inflight.add(key)
        try:
            h, got = hashlib.sha256(), 0
            held = self._read(sid)["held"].get(str(n))   # read again now that the chunk is ours: a request that just finished may have held it
            part = self.dir(sid) / "upload.part"
            try:
                f = None if held is not None else part.open("r+b")
            except OSError as e:
                raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
            try:
                while got < length:
                    try:
                        block = read(min(READ_BLOCK, length - got))
                    except TimeoutError:
                        raise SessionError(408, "slow") from None
                    except OSError:
                        raise SessionError(400, "cut-short") from None
                    if not block:
                        raise SessionError(400, "cut-short")
                    h.update(block)
                    if f is not None:
                        try:
                            _write_at(f, n * meta["chunkBytes"] + got, block)
                        except OSError as e:
                            raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
                    got += len(block)
                digest = h.hexdigest()
                if held is not None:
                    # a held chunk never changes: the same bytes again are fine (a retry after a lost answer), other bytes are not
                    if digest != held:
                        raise SessionError(409, "chunk-differs")
                    return {"ok": True, "held": len(meta["held"]), "of": meta["chunks"], "already": True}
                if chunk_sha256 is not None and digest != chunk_sha256.lower():
                    raise SessionError(422, "bad-hash")
                try:
                    _fsync_file(f)
                except OSError as e:
                    raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
            finally:
                if f is not None:
                    f.close()
            try:
                held_now = self.update(sid, lambda m: m["held"].__setitem__(str(n), digest))
            except OSError as e:
                raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
            return {"ok": True, "held": len(held_now["held"]), "of": meta["chunks"], "already": False}
        finally:
            with self._mu:
                self._inflight.discard(key)

    def _read_manifest(self, path: Path) -> dict:
        try:
            with zipfile.ZipFile(path) as zf:
                info = zf.getinfo("manifest.json")
                if info.file_size > MANIFEST_MAX:
                    raise SessionError(422, "not-a-package")
                with zf.open(info) as f:
                    raw = f.read(MANIFEST_MAX + 1)
        except (zipfile.BadZipFile, KeyError, RuntimeError, NotImplementedError, EOFError, OSError):
            raise SessionError(422, "not-a-package") from None
        try:
            m = json.loads(raw)
        except ValueError:
            raise SessionError(422, "not-a-package") from None
        if not isinstance(m, dict) or m.get("format") != SESSION_FORMAT or not isinstance(m.get("consent"), dict):
            raise SessionError(422, "not-a-package")
        return m

    def finish(self, sid: str, token: str | None, body=None) -> dict:
        """POST /api/session/<id>/finish. The package is stored (and this says so) only when it is whole on disk: every chunk held, the size
        and SHA-256 equal to what `start` declared, a readable manifest that passes the privacy rule, file and directory fsynced, the
        queue entries written. A repeat after a lost answer returns the same answer."""
        meta = self._authed(sid, token)
        if meta["state"] == "duplicate":
            return self._stored_answer(self._read(meta["of"]), sid)
        if meta["state"] == "stored":
            return self._stored_answer(meta, sid)
        if isinstance(body, dict) and body.get("sha256") is not None and str(body["sha256"]).lower() != meta["sha256"]:
            raise SessionError(400, "hash-changed")
        with self._lock(sid):
            meta = self._read(sid)
            if meta["state"] == "stored":
                return self._stored_answer(meta, sid)
            sdir = self.dir(sid)
            part, final = sdir / "upload.part", sdir / "package.zip"
            missing = [i for i in range(meta["chunks"]) if str(i) not in meta["held"]] if not final.exists() else []
            if missing:
                raise SessionError(409, "incomplete", missing=missing[:200], held=len(meta["held"]), of=meta["chunks"])
            src = final if final.exists() else part     # a finish cut off after the rename finds the package already in place
            try:
                if src.stat().st_size != meta["size"]:
                    raise SessionError(422, "bad-size")
                h = hashlib.sha256()
                with src.open("rb") as f:
                    while True:
                        block = f.read(CHUNK_BYTES)
                        if not block:
                            break
                        h.update(block)
            except OSError:
                raise SessionError(500, "io") from None
            if h.hexdigest() != meta["sha256"]:
                self._discard(sid, meta)
                raise SessionError(422, "bad-hash", restart=True)
            manifest = self._read_manifest(src)
            consent = manifest["consent"]
            if consent.get("minor") is True and consent.get("guardianConfirmed") is not True:
                self._discard(sid, meta)
                raise SessionError(422, "consent-guardian")
            other = self._find_stored(meta["sha256"])
            now = self.now()
            if other is not None and other != sid:
                self._discard(sid, meta, keep_alias_of=other)
                return self._stored_answer(self._read(other), sid, duplicate=True)
            try:
                if src is part:
                    with part.open("rb+") as f:
                        _fsync_file(f)
                    _replace(part, final)
                    _fsync_dir(sdir)
                summary = manifest_summary(manifest)
                meta.update(state="stored", storedAt=_iso(now), storedTs=now, bytes=meta["size"], summary=summary, held={})
                meta["channels"] = {c: {"status": "queued", "attempts": 0, "failures": 0, "nextAt": now, "error": "", "sentAt": None, "messageId": None} for c in CHANNELS}
                _write_json(sdir / "meta.json", meta)
                self._append_index({"id": sid, "ts": now, "storedAt": meta["storedAt"], "bytes": meta["bytes"], "sha256": meta["sha256"], "summary": summary})
            except OSError as e:
                raise SessionError(507 if e.errno == errno.ENOSPC else 500, "disk" if e.errno == errno.ENOSPC else "io") from None
            with self._mu:
                self._open.pop(sid, None)
                self._stored_bytes += meta["bytes"]
            self._reindex(meta)
        if self.on_change is not None:
            self.on_change(sid)
        return self._stored_answer(meta, sid)

    def _discard(self, sid: str, meta: dict, keep_alias_of: str | None = None) -> None:
        """An upload that cannot be kept: its files go, the reservation is released. With `keep_alias_of` the id stays as an alias of the
        copy that is already stored, so the client's polling still works."""
        sdir = self.dir(sid)
        for name in ("upload.part", "package.zip"):
            try:
                (sdir / name).unlink()
            except OSError:
                pass
        with self._mu:
            self._open.pop(sid, None)
        if keep_alias_of is not None:
            _write_json(sdir / "meta.json", {"v": 1, "id": sid, "state": "duplicate", "of": keep_alias_of, "created": meta["created"], "ts": meta["ts"],
                                              "size": meta["size"], "sha256": meta["sha256"], "tokenSha256": meta["tokenSha256"], "summary": meta.get("summary", {})})
        else:
            shutil.rmtree(sdir, ignore_errors=True)

    def _append_index(self, rec: dict) -> None:
        root = self.root
        root.mkdir(parents=True, exist_ok=True)
        with (root / "index.jsonl").open("ab") as f:
            f.write((json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
            _fsync_file(f)

    @staticmethod
    def public_channels(meta: dict) -> dict:
        return {name: {"status": ch.get("status"), "attempts": int(ch.get("attempts") or 0), "error": ch.get("error") or "", "at": ch.get("sentAt")}
                for name, ch in (meta.get("channels") or {}).items()}

    @staticmethod
    def delivered(meta: dict) -> bool:
        chans = meta.get("channels") or {}
        return meta.get("state") == "stored" and bool(chans) and all(c.get("status") in TERMINAL_OK for c in chans.values())

    def _stored_answer(self, meta: dict, sid: str, duplicate: bool = False) -> dict:
        out = {"ok": True, "stored": True, "id": sid, "bytes": meta["bytes"], "sha256": meta["sha256"], "channels": self.public_channels(meta), "delivered": self.delivered(meta)}
        if duplicate or sid != meta["id"]:
            out["duplicate"] = True
            out["of"] = meta["id"]
        return out

    def status(self, sid: str, token: str | None) -> dict:
        """GET /api/session/<id>: where the upload stands (the chunks held, to resume) or where the delivery stands (each channel)."""
        meta = self._authed(sid, token)
        if meta["state"] == "duplicate":
            try:
                target = self._read(meta["of"])
            except SessionError:
                raise SessionError(410, "gone") from None
            return self._stored_answer(target, sid, duplicate=True)
        if meta["state"] == "stored":
            return {**self._stored_answer(meta, sid), "state": "stored", "storedAt": meta.get("storedAt")}
        return {"ok": True, "state": "uploading", "stored": False, "id": sid, "size": meta["size"], "chunks": meta["chunks"], "chunkBytes": meta["chunkBytes"],
                "held": sorted(int(i) for i in meta["held"]), "delivered": False}

    # ---- what the admin and the workers use

    def list(self) -> list[dict]:
        """Every stored session, newest first: id, when, size, summary, channels (no token, no hash of the token)."""
        out = []
        root = self.root
        if root.exists():
            for d in root.iterdir():
                if not d.is_dir() or not SID_RE.fullmatch(d.name):
                    continue
                try:
                    m = json.loads((d / "meta.json").read_bytes())
                except (OSError, ValueError):
                    continue
                if m.get("state") == "stored":
                    out.append({"id": m["id"], "storedAt": m.get("storedAt"), "ts": m.get("storedTs") or m.get("ts"), "bytes": m.get("bytes"), "sha256": m.get("sha256"),
                                "summary": m.get("summary") or {}, "channels": self.public_channels(m), "delivered": self.delivered(m)})
        out.sort(key=lambda r: r.get("ts") or 0, reverse=True)
        return out

    def resend(self, sid: str, channel: str) -> dict:
        """The owner's resend for one channel: back to queued at once, the count of failures cleared."""
        if channel not in CHANNELS:
            raise SessionError(400, "bad-channel")
        now = self.now()

        def fn(m: dict) -> None:
            if m.get("state") != "stored":
                raise SessionError(409, "not-stored")
            m["channels"][channel] = {"status": "queued", "attempts": 0, "failures": 0, "nextAt": now, "error": "", "sentAt": None, "messageId": None, "resent": now}

        return self.update(sid, fn)

    def delete(self, sid: str, reason: str = "request") -> bool:
        """The package and its state removed (the pilot's or a parent's request, the retention, an abandoned upload); a tombstone line stays."""
        with self._lock(sid):
            meta = self.get(sid)
            if meta is None:
                return False
            shutil.rmtree(self.dir(sid), ignore_errors=True)
            with self._mu:
                self._open.pop(sid, None)
                self._due.pop(sid, None)
                if meta.get("state") == "stored":
                    self._stored_bytes = max(0, self._stored_bytes - int(meta.get("bytes") or 0))
            try:
                self._append_index({"id": sid, "deleted": self.now(), "reason": reason})
            except OSError:
                pass
        return True

    def _receiving(self, sid: str) -> bool:
        """A chunk of this upload is arriving right now."""
        with self._mu:
            return any(key[0] == sid for key in self._inflight)

    def _drop_idle(self, sid: str) -> bool:
        """Removes an upload that has held no chunk, looked at again under its lock: a chunk that has just been held, or is arriving, keeps it."""
        with self._lock(sid):
            meta = self.get(sid)
            if meta is None or meta.get("state") != "uploading" or meta.get("held") or self._receiving(sid):
                return False
            return self.delete(sid, "idle")

    def sweep(self) -> list[str]:
        """Housekeeping: uploads left unfinished for UPLOAD_TTL_S go, and so does one that has held no chunk at all for UPLOAD_IDLE_S (its
        reservation returns to the pool: start is anonymous, so a reservation that never begins must not hold room for a day; a chunk that is
        arriving this moment is not idle); a stored package goes only after RETENTION_DAYS AND only when every channel is done (an
        undelivered recording is never aged out). Returns the ids removed."""
        self._ensure_indexed()
        now = self.now()
        gone: list[str] = []
        root = self.root
        if not root.exists():
            return gone
        for d in sorted(root.iterdir()):
            if not d.is_dir() or not SID_RE.fullmatch(d.name):
                continue
            meta = self.get(d.name)
            if meta is None:
                continue
            age = now - float(meta.get("storedTs") or meta.get("ts") or now)
            if meta.get("state") == "uploading" and age > UPLOAD_TTL_S:
                if self.delete(d.name, "abandoned"):
                    gone.append(d.name)
            elif meta.get("state") == "uploading" and not meta.get("held") and age > UPLOAD_IDLE_S:
                if self._drop_idle(d.name):
                    gone.append(d.name)
            elif meta.get("state") == "duplicate" and age > ALIAS_TTL_S:
                if self.delete(d.name, "alias"):
                    gone.append(d.name)
            elif meta.get("state") == "stored" and age > RETENTION_DAYS * 86400:
                chans = (meta.get("channels") or {}).values()
                if all(c.get("status") in TERMINAL_OK + ("failed",) for c in chans):
                    if self.delete(d.name, "retention"):
                        gone.append(d.name)
        return gone
