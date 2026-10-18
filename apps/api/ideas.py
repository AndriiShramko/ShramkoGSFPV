"""The ideas store (v0.7 lane B, owner's items 3, 7, 8): every pilot's idea or bug report, the owner's
notes, the roadmap's features, what the owner decided about each, and the e-mails to the pilot.

One file, DATA_DIR/ideas.json, rewritten whole on every change (a temporary file, fsync, rename), under
a thread lock and a file lock (DATA_DIR/ideas.lock): the API process and the agents' CLI
(ideas_cli.py, run with `docker exec` in the same container) both write it. A few hundred ideas are a
few hundred KB; changes are the owner's actions, rare, so a whole-file rewrite is cheap and simple.

The document:
    {"v": 1,
     "meta":   {"migrated": ISO, "migratedReports": n, "seeded": ISO, "seedItems": n},
     "seq":    {"N-20261013": 2, "F-20261013": 1, "M": 17},   # per-day note/feature numbers, mail numbers
     "ideas":  [record, ...],                                   # creation order
     "tg":     {"seen": [update_id, ...], "msgs": {"<message_id>": {"idea", "purpose", "mail"?}}}}

A record (see docs/wip/v07-b.md for the meaning of each field):
    id, kind (idea|bug|note|feature), created, text, lang, page, scene, release, contact, contactKind
    (email|other|none), email, suspect, diagnostics, status (new|accepted|in_progress|done|rejected),
    statusAt, urgency (urgent|high|normal|low|None), comments [{at, text, by}], public {title, text,
    visible}, done {at, summary {lang: text}, by} | None, notified, releases [sha], thread [mail], order,
    source (report|telegram|admin|seed), tg {card: message_id}, and once the pilot's language is known,
    pilotLang {code, name, at}: the language the pilot WROTE in, found by translate.py in their own text and
    kept (absent: not asked yet; the form language `lang` is the fallback).
A mail (inside its idea's thread; this is the outbox). The thread is OUT only: what came IN is the
record's own text (the pilot's report); a pilot's e-mail answer stays in the owner's Gmail (no IMAP):
    id (M-<n>), kind (reply|done), to, lang, subject, body, plain, html, messageId, inReplyTo,
    references, state (draft|superseded|queued|sending|sent|failed|cancelled|waiting_setup|waiting_language|
    no_email|unknown; superseded: a draft a newer done summary replaced, kept so its Send is refused;
    waiting_language: the text may not be readable by the pilot, only the owner's Send sends it as written),
    created, notBefore, attempts, nextAt, error, sentAt, by, tgMsg; and for the language of the pilot (v0.9):
    lang (the e-mail's language), body (the text in the e-mail), orig (the owner's own words when body is a
    translation, else null), tr ({from, to, model} of a translation, else null), wait (why it waits).

Migration: the first transaction on a missing file imports every line of reports.jsonl (the visitors'
own file, never rewritten) and the old admin flags of report-status.json (open -> new, closed -> done);
sync() imports any report line still missing, so a report whose idea could not be written is picked up
at the next start. The roadmap seed (locales/roadmap-seed.json, the landing's status list in four languages)
is loaded once, while the store has no feature and was never seeded.

Nothing here talks to the network: service.py holds the use-cases, ownerbot.py and mailer.py the I/O.
"""
from __future__ import annotations

import calendar
import contextlib
import hashlib
import json
import os
import re
import threading
import time
import unicodedata
from pathlib import Path
from typing import Callable, Iterator

KINDS = ("idea", "bug", "note", "feature")
STATUSES = ("new", "accepted", "in_progress", "done", "rejected")
URGENCIES = ("urgent", "high", "normal", "low")  # most urgent first: the queue's order
LOCALES = ("en", "es", "pl", "ru")
CONTACT_KINDS = ("email", "other", "none")
MAIL_KINDS = ("reply", "done")
MAIL_STATES = ("draft", "superseded", "queued", "sending", "sent", "failed", "cancelled", "waiting_setup", "waiting_language", "no_email", "unknown")
# the public roadmap: store status -> roadmap status, store kind -> roadmap kind (plan, "Contracts")
ROADMAP_STATUS = {"accepted": "planned", "in_progress": "in_progress", "done": "done"}
ROADMAP_KIND = {"feature": "feature", "idea": "idea", "note": "idea", "bug": "bug"}

ID_RE = re.compile(r"[RNF]-[A-Za-z0-9][A-Za-z0-9-]{0,47}")
MAIL_ID_RE = re.compile(r"M-[0-9]{1,9}")
SHA_RE = re.compile(r"[0-9a-f]{7,40}")
# an e-mail address inside whatever the pilot typed as a contact: ASCII only, nothing a header could
# be bent with (no spaces, quotes, angle brackets, commas or line breaks)
EMAIL_FIND_RE = re.compile(r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9.-])")

TEXT_MAX = 4000        # a note or a pilot's words (a report is at most 2000)
COMMENT_MAX = 2000
TITLE_MAX = 240        # a public title: the same limit in the admin card, the landing and the seed test
PUBLIC_TEXT_MAX = 600  # (apps/api/tests/test_roadmap_seed.py); the landing's longest seeded line is 211
SUMMARY_MAX = 2000
SEEN_KEPT = 300        # Telegram update ids remembered (each update is handled once)
TG_MSGS_KEPT = 3000    # bot message -> idea links remembered


def now_iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def parse_iso(s) -> float | None:
    """Seconds since the epoch of an ISO time this module wrote (UTC, whole seconds), else None."""
    if not isinstance(s, str):
        return None
    try:
        return float(calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")))
    except ValueError:
        return None


def find_email(contact: str) -> str:
    """The first e-mail address in a contact field ("Telegram @x or a@b.cd" -> "a@b.cd"), else ""."""
    m = EMAIL_FIND_RE.search(contact or "")
    return m.group(0) if m else ""


def clean_line(v, n: int) -> str:
    """One line of owner or agent text: a string, control and format characters dropped, at most n."""
    if not isinstance(v, str):
        return ""
    s = "".join(" " if c in "\n\r\t" else c for c in v[: n * 2] if unicodedata.category(c) not in ("Cc", "Cs", "Cf") or c in "\n\r\t")
    return " ".join(s.split())[:n].strip()


def clean_text(v, n: int) -> str:
    """Several lines of owner or agent text: line breaks kept, other control characters dropped."""
    if not isinstance(v, str):
        return ""
    s = "".join(c for c in v[: n * 2] if c == "\n" or unicodedata.category(c) not in ("Cc", "Cs", "Cf"))
    lines = [" ".join(x.split()) for x in s.replace("\r", "").split("\n")]
    out = "\n".join(lines).strip()
    while "\n\n\n" in out:
        out = out.replace("\n\n\n", "\n\n")
    return out[:n].strip()


def clean_texts(v, n: int, lines: bool = False) -> dict:
    """A text per language ({"en": ..., "ru": ...}); a plain string counts as English."""
    if isinstance(v, str):
        v = {"en": v}
    if not isinstance(v, dict):
        return {}
    f = clean_text if lines else clean_line
    return {loc: w for loc in LOCALES if (w := f(v.get(loc), n))}


def empty_doc() -> dict:
    return {"v": 1, "meta": {}, "seq": {}, "ideas": [], "tg": {"seen": [], "msgs": {}}}


def new_record(rid: str, kind: str, created: str, source: str) -> dict:
    """A record with every field present (readers never need .get with a default)."""
    return {"id": rid, "kind": kind, "created": created, "text": "", "lang": "", "page": "", "scene": "", "release": "",
            "contact": "", "contactKind": "none", "email": "", "suspect": False, "diagnostics": False,
            "status": "new", "statusAt": created, "urgency": None, "comments": [],
            "public": {"title": {}, "text": {}, "visible": True}, "done": None, "notified": None,
            "releases": [], "thread": [], "order": None, "source": source, "tg": {}}


def set_contact(rec: dict, contact: str) -> None:
    contact = clean_line(contact, 200)
    email = find_email(contact)
    rec["contact"], rec["email"] = contact, email
    rec["contactKind"] = "email" if email else ("other" if contact else "none")


DRONE_MARK = "Drone physics:"   # what drone_header() starts with (translate.pilot_words() skips the header by it)


def drone_header(r: dict) -> str:
    """The first lines of a drone-physics report's idea (kind "drone", v0.8): which drone, the blackbox log's
    link, whether the Betaflight text is in the technical-details file. The owner sees them wherever he reads
    the idea (Telegram card, admin, CLI) without anything new to learn there."""
    drone = r.get("drone") if isinstance(r.get("drone"), str) else ""
    lines = [DRONE_MARK + " " + ("a drone that is not in the list" if drone == "new" else drone or "drone not given")]
    if isinstance(r.get("logUrl"), str) and r["logUrl"]:
        lines.append(f"Blackbox log: {r['logUrl']}")
    if r.get("diagnostics") is True:
        lines.append("Betaflight text / simulator settings: in the technical details file")
    return "\n".join(lines)


def record_from_report(r: dict) -> dict | None:
    """An idea from one line of reports.jsonl (server.store_report wrote it), else None. A drone-physics
    report (kind "drone") is an idea whose text starts with drone_header()."""
    rid = r.get("id")
    if not isinstance(rid, str) or not ID_RE.fullmatch(rid) or not rid.startswith("R-"):
        return None
    kind = r.get("kind") if r.get("kind") in ("idea", "bug") else "idea"
    created = r.get("ts") if isinstance(r.get("ts"), str) else now_iso(time.time())
    rec = new_record(rid, kind, created, "report")
    rec["text"] = r.get("message") if isinstance(r.get("message"), str) else ""
    if r.get("kind") == "drone":
        rec["text"] = drone_header(r) + "\n\n" + rec["text"]
    rec["lang"] = r.get("locale") if r.get("locale") in LOCALES else ""
    for k in ("page", "scene", "release"):
        rec[k] = r.get(k) if isinstance(r.get(k), str) else ""
    set_contact(rec, r.get("contact") if isinstance(r.get("contact"), str) else "")
    rec["suspect"] = r.get("suspect") is True
    d = r.get("diagnostics")
    rec["diagnostics"] = d if d in (True, False, "skipped") else False
    rec["diagBytes"] = r.get("diagBytes") if isinstance(r.get("diagBytes"), int) else 0
    return rec


def record_from_seed(item: dict, order: int, created: str) -> dict | None:
    """A roadmap feature from roadmap-seed.json (plan, "Roadmap seed"), else None."""
    if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not ID_RE.fullmatch(item["id"]) or not item["id"].startswith("F-"):
        return None
    title = clean_texts(item.get("title"), TITLE_MAX)
    if "en" not in title:
        return None
    rec = new_record(item["id"], "feature", created, "seed")
    rec["status"] = item.get("status") if item.get("status") in ("accepted", "in_progress", "done") else "accepted"
    rec["public"]["title"] = title
    if text := clean_texts(item.get("text"), PUBLIC_TEXT_MAX):
        rec["public"]["text"] = text
    o = item.get("order")
    rec["order"] = o if isinstance(o, int) and not isinstance(o, bool) else order
    if rec["status"] == "done":
        # the seed's own date when it gives one; never the day of loading (that would date everything to the deploy)
        at = item.get("done") if parse_iso(item.get("done")) is not None else None
        rec["done"] = {"at": at, "summary": {}, "by": "seed"}
    return rec


def queue_key(rec: dict) -> tuple:
    """The work queue's order: urgency, then what is already in progress, then the oldest."""
    u = rec.get("urgency")
    return (URGENCIES.index(u) if u in URGENCIES else len(URGENCIES), 0 if rec.get("status") == "in_progress" else 1, rec.get("created") or "")


def work_queue(doc: dict) -> tuple[list[dict], list[dict]]:
    """(the queue: accepted or in progress WITH an urgency, by queue_key; accepted or in progress still
    waiting for the owner's urgency). An idea enters the queue when the owner accepts it and gives it an
    urgency (owner's item 8)."""
    active = [r for r in doc["ideas"] if r["status"] in ("accepted", "in_progress") and not r.get("suspect")]
    return sorted([r for r in active if r.get("urgency") in URGENCIES], key=queue_key), \
        sorted([r for r in active if r.get("urgency") not in URGENCIES], key=lambda r: r.get("created") or "")


def roadmap_items(doc: dict) -> list[dict]:
    """The public roadmap (plan, "Contracts"): only an English public title and our own public text;
    never the pilot's words, contact, comments or anything else of the record."""
    def order(r: dict) -> tuple:
        o = r.get("order")
        return (0 if r["kind"] == "feature" and isinstance(o, int) else 1, o if isinstance(o, int) else 0, r.get("created") or "")

    out = []
    for r in sorted(doc["ideas"], key=order):
        st = ROADMAP_STATUS.get(r.get("status"))
        pub = r.get("public") or {}
        title = clean_texts(pub.get("title"), TITLE_MAX)
        if not st or "en" not in title or pub.get("visible") is False or r.get("suspect") or r.get("kind") not in ROADMAP_KIND:
            continue
        item = {"id": r["id"], "kind": ROADMAP_KIND[r["kind"]], "status": st, "title": title, "fromPilot": r["kind"] != "feature"}
        if text := clean_texts(pub.get("text"), PUBLIC_TEXT_MAX):
            item["text"] = text
        if st == "done":
            at = (r.get("done") or {}).get("at")
            if isinstance(at, str) and parse_iso(at) is not None:
                item["done"] = at
        rel = [x for x in r.get("releases") or [] if isinstance(x, str) and SHA_RE.fullmatch(x)]
        if rel:
            item["release"] = rel[-1]
        out.append(item)
    return out


class StoreError(ValueError):
    """ideas.json exists but is not a store document (broken JSON, wrong shape). Nothing is written over
    it: every caller fails cleanly instead (the API keeps serving its other routes, a report still goes
    to the shared bot, /api/roadmap answers 503) until the owner restores the file from a backup."""


def parse_doc(raw: bytes) -> dict:
    """The store document in ideas.json, or StoreError."""
    try:
        doc = json.loads(raw)
    except ValueError as e:  # JSONDecodeError, UnicodeDecodeError
        raise StoreError(f"ideas.json is not JSON ({type(e).__name__})") from e
    if not (isinstance(doc, dict) and isinstance(doc.get("ideas"), list) and all(isinstance(doc.get(k), dict) for k in ("meta", "seq", "tg"))):
        raise StoreError("ideas.json is not an ideas store document")
    return doc


def write_durable(path: Path, data: bytes) -> None:
    """Whole file or nothing: a temporary file, fsync, then the rename."""
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


@contextlib.contextmanager
def file_lock(path: Path) -> Iterator[None]:
    """An exclusive lock between processes (the API and the CLI in the same container): flock on Linux,
    a one-byte msvcrt lock where there is no fcntl (Windows, where the tests run)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as f:
        try:
            import fcntl  # noqa: PLC0415
        except ImportError:
            fcntl = None
        if fcntl is not None:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            return
        import msvcrt  # noqa: PLC0415
        f.seek(0)
        while True:
            try:
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                time.sleep(0.01)
        try:
            yield
        finally:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


class IdeaStore:
    """DATA_DIR/ideas.json. tx() is the only way to change it; read() gives a parsed snapshot that the
    caller must not change (it is shared until the file changes)."""

    def __init__(self, data_dir: Callable[[], Path], reports_file: Callable[[], Path],
                 report_status: Callable[[], Path] | None = None, seed: Callable[[], Path | None] = lambda: None,
                 clock: Callable[[], float] = time.time):
        self.data_dir, self.reports_file, self.seed, self.clock = data_dir, reports_file, seed, clock
        self.report_status = report_status or (lambda: data_dir() / "report-status.json")
        self._mu = threading.RLock()
        self._tl = threading.local()
        self._cache: tuple[tuple, dict] | None = None      # (file key, parsed doc) for read()
        self._public: tuple[tuple, bytes, str] | None = None  # (file key, roadmap body, ETag)

    def path(self) -> Path:
        return self.data_dir() / "ideas.json"

    def _key(self) -> tuple | None:
        try:
            st = self.path().stat()
        except FileNotFoundError:
            return None
        return (str(self.path()), st.st_mtime_ns, st.st_size)

    @staticmethod
    def _dump(doc: dict) -> bytes:
        return (json.dumps(doc, ensure_ascii=False, indent=1) + "\n").encode("utf-8")

    @contextlib.contextmanager
    def tx(self) -> Iterator[dict]:
        """Read, let the caller change the document, write it back if it changed. Not re-entrant: a
        nested transaction would read the file without the outer one's changes."""
        if getattr(self._tl, "busy", False):
            raise RuntimeError("nested ideas transaction")
        with self._mu:
            self._tl.busy = True
            try:
                with file_lock(self.data_dir() / "ideas.lock"):
                    try:
                        raw = self.path().read_bytes()
                    except FileNotFoundError:
                        raw = b""
                    doc = parse_doc(raw) if raw else empty_doc()
                    if not raw:
                        self._import_reports(doc, first=True)
                        self._load_seed(doc)
                    yield doc
                    out = self._dump(doc)
                    if out != raw:
                        write_durable(self.path(), out)
                        self._cache = None
            finally:
                self._tl.busy = False

    def read(self) -> dict:
        """The current document, parsed once per change of the file (callers must not change it)."""
        with self._mu:
            key = self._key()
            if key is None:
                with self.tx():
                    pass
                key = self._key()
            if self._cache is None or self._cache[0] != key:
                self._cache = (key, parse_doc(self.path().read_bytes()))
            return self._cache[1]

    def sync(self) -> int:
        """Import report lines still missing and the roadmap seed if it is due; the number of new ideas."""
        with self.tx() as doc:
            before = len(doc["ideas"])
            self._import_reports(doc, first=False)
            self._load_seed(doc)
            return len(doc["ideas"]) - before

    def _import_reports(self, doc: dict, first: bool) -> None:
        f = self.reports_file()
        if not f.exists():
            if first:
                doc["meta"]["migrated"] = now_iso(self.clock())
                doc["meta"]["migratedReports"] = 0
            return
        have = {r["id"] for r in doc["ideas"]}
        flags = {}
        if first:
            try:
                flags = json.loads(self.report_status().read_text(encoding="utf-8"))
            except (FileNotFoundError, ValueError):
                flags = {}
        added = 0
        with f.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                rec = record_from_report(r) if isinstance(r, dict) else None
                if rec is None or rec["id"] in have:
                    continue
                flag = flags.get(rec["id"]) if isinstance(flags, dict) else None
                if isinstance(flag, dict) and flag.get("status") == "closed":
                    rec["status"] = "done"
                    rec["statusAt"] = flag.get("ts") if isinstance(flag.get("ts"), str) else rec["created"]
                    rec["done"] = {"at": rec["statusAt"], "summary": {}, "by": "migration"}
                doc["ideas"].append(rec)
                have.add(rec["id"])
                added += 1
        if first:
            doc["meta"]["migrated"] = now_iso(self.clock())
            doc["meta"]["migratedReports"] = added

    def _load_seed(self, doc: dict) -> None:
        if doc["meta"].get("seeded") or any(r["kind"] == "feature" for r in doc["ideas"]):
            return
        path = self.seed()
        if path is None or not Path(path).is_file():
            return
        try:
            seed = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        items = seed.get("items") if isinstance(seed, dict) else None
        if not isinstance(items, list):
            return
        stamp = now_iso(self.clock())
        have = {r["id"] for r in doc["ideas"]}
        n = 0
        for i, it in enumerate(items):
            rec = record_from_seed(it, i, stamp)
            if rec is not None and rec["id"] not in have:
                doc["ideas"].append(rec)
                have.add(rec["id"])
                n += 1
        doc["meta"]["seeded"] = stamp
        doc["meta"]["seedItems"] = n

    def public_roadmap(self, if_none_match: str | None) -> tuple[int, bytes, list]:
        """GET /api/roadmap: (status, body, headers); ETag + If-None-Match -> 304, a minute of caching."""
        with self._mu:
            doc = self.read()
            key = self._key()
            if self._public is None or self._public[0] != key:
                body = json.dumps({"v": 1, "items": roadmap_items(doc)}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self._public = (key, body, '"' + hashlib.sha256(body).hexdigest()[:32] + '"')
            _, body, etag = self._public
        hdrs = [("Content-Type", "application/json; charset=utf-8"), ("Cache-Control", "public, max-age=60"), ("ETag", etag)]
        if if_none_match and etag in [x.strip() for x in if_none_match.split(",")]:
            return 304, b"", hdrs
        return 200, body, hdrs


def index(doc: dict) -> dict[str, dict]:
    return {r["id"]: r for r in doc["ideas"]}


def next_id(doc: dict, prefix: str, t: float) -> str:
    """N-YYYYMMDD-NNNN (a note) or F-YYYYMMDD-NNNN (a feature added by the owner), per UTC day."""
    day = time.strftime("%Y%m%d", time.gmtime(t))
    key = f"{prefix}-{day}"
    have = index(doc)
    n = int(doc["seq"].get(key, 0))
    while True:
        n += 1
        rid = f"{key}-{n:04d}"
        if rid not in have:
            doc["seq"][key] = n
            return rid


def next_mail_id(doc: dict) -> str:
    n = int(doc["seq"].get("M", 0)) + 1
    doc["seq"]["M"] = n
    return f"M-{n}"


def find_mail(doc: dict, mail_id: str) -> tuple[dict, dict] | None:
    for r in doc["ideas"]:
        for m in r["thread"]:
            if m.get("id") == mail_id:
                return r, m
    return None


def remember_seen(doc: dict, update_id: int) -> bool:
    """True the first time a Telegram update id is seen (and it is remembered), False after."""
    seen = doc["tg"].setdefault("seen", [])
    if update_id in seen:
        return False
    seen.append(update_id)
    del seen[:-SEEN_KEPT]
    return True


def remember_message(doc: dict, message_id: int, idea_id: str, purpose: str, mail_id: str | None = None) -> None:
    msgs = doc["tg"].setdefault("msgs", {})
    msgs[str(message_id)] = {"idea": idea_id, "purpose": purpose, **({"mail": mail_id} if mail_id else {})}
    if len(msgs) > TG_MSGS_KEPT:
        for k in sorted(msgs, key=lambda x: int(x) if x.isdigit() else 0)[: len(msgs) - TG_MSGS_KEPT]:
            del msgs[k]
