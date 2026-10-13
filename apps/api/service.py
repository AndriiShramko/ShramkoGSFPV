"""The use-cases of the ideas server: the only code that changes an idea (ideas.py holds the data).

The owner's bot (ownerbot.py), the admin routes (ideas_admin.py), the agents' CLI (ideas_cli.py) and
the outbox worker (outbox.py) all call these methods, so a rule lives in one place:

- an e-mail is queued only by an explicit act of the owner: reply() (his answer to a pilot) and
  send_done() / send_mail() (his Send under a draft or a waiting e-mail); every queued e-mail waits
  UNDO seconds (MAIL_UNDO_S, default 60) in which cancel_mail() stops it;
- set_done_summary() only writes a DRAFT of the thank-you e-mail, never queues it;
- no e-mail address -> the answer is kept in the thread as `no_email`; Gmail not configured -> it waits
  as `waiting_setup` and only goes after a later explicit send_mail();
- the worker claims a due e-mail (queued -> sending) before it talks to SMTP and records the outcome
  after, so an e-mail is never handed to SMTP twice by itself; one left in `sending` by a restart
  becomes `unknown` (recover()).

Every change emits an event to the listeners (the owner bot shows it in Telegram): (event, idea, mail,
by) with event in status, urgency, comment, public, release, note, draft, mail-queued, mail-waiting,
mail-noemail, mail-cancelled, mail-sent, mail-failed, mail-unknown, mail-ask. Listeners run after the
change is on disk; a listener that fails never undoes it.
"""
from __future__ import annotations

import copy
import contextlib
import os
import secrets
import time
import urllib.parse
from typing import Callable, Iterator

import ideas
from ideas import IdeaStore, index, now_iso, parse_iso
from mailer import Mailer, MailError

RETRY_BACKOFF_S = (60, 300, 1800, 7200, 21600)  # after the 1st..5th failed attempt; then it stops
RESENDABLE = ("waiting_setup", "failed", "unknown")

Listener = Callable[[str, dict, "dict | None", str], None]


class IdeaError(Exception):
    """A refused action: a short code for the caller (and its HTTP status for the admin)."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


class IdeasService:
    def __init__(self, store: IdeaStore, mailer: Mailer, clock: Callable[[], float] = time.time,
                 undo_s: float | None = None, env=os.environ, public_origin: str = "https://gsfpv.flyreelstudio.eu"):
        self.store, self.mailer, self.clock = store, mailer, clock
        try:
            self.undo_s = float(env.get("MAIL_UNDO_S", "60")) if undo_s is None else float(undo_s)
        except ValueError:
            self.undo_s = 60.0
        self.host = urllib.parse.urlsplit(public_origin).hostname or "gsfpv.flyreelstudio.eu"
        self.listeners: list[Listener] = []

    # ---------------- plumbing ----------------

    def _emit(self, event: str, idea: dict, mail: dict | None = None, by: str = "") -> None:
        for fn in list(self.listeners):
            try:
                fn(event, copy.deepcopy(idea), copy.deepcopy(mail), by)
            except Exception:  # noqa: BLE001  a listener (Telegram down) never undoes a change
                pass

    @contextlib.contextmanager
    def _idea(self, rid: str) -> Iterator[tuple[dict, dict]]:
        if not isinstance(rid, str) or not ideas.ID_RE.fullmatch(rid):
            raise IdeaError("bad-id")
        with self.store.tx() as doc:
            rec = index(doc).get(rid)
            if rec is None:
                raise IdeaError("not-found", 404)
            yield doc, rec

    def _now(self) -> tuple[float, str]:
        t = self.clock()
        return t, now_iso(t)

    # ---------------- reads ----------------

    def get(self, rid: str) -> dict | None:
        r = index(self.store.read()).get(rid) if isinstance(rid, str) else None
        return copy.deepcopy(r) if r else None

    def all(self) -> list[dict]:
        return copy.deepcopy(self.store.read()["ideas"])

    def queue(self) -> tuple[list[dict], list[dict]]:
        work, waiting = ideas.work_queue(self.store.read())
        return copy.deepcopy(work), copy.deepcopy(waiting)

    def find_mail(self, mail_id: str) -> tuple[dict, dict] | None:
        hit = ideas.find_mail(self.store.read(), mail_id) if isinstance(mail_id, str) else None
        return copy.deepcopy(hit) if hit else None

    @property
    def mail_configured(self) -> bool:
        return self.mailer.configured

    # ---------------- new ideas ----------------

    def add_report(self, line: dict) -> dict | None:
        """The idea of a report just stored in reports.jsonl (server.store_report); None if malformed."""
        rec = ideas.record_from_report(line)
        if rec is None:
            return None
        with self.store.tx() as doc:
            have = index(doc).get(rec["id"])
            if have is not None:
                return copy.deepcopy(have)
            doc["ideas"].append(rec)
        return copy.deepcopy(rec)

    def add_note(self, text: str, by: str, contact: str = "", lang: str = "", urgency: str | None = None,
                 kind: str = "note", public_title=None) -> dict:
        """The owner's note (a pilot's idea told outside the form) or a roadmap feature he adds."""
        text = ideas.clean_text(text, ideas.TEXT_MAX)
        if not text:
            raise IdeaError("empty")
        if kind not in ("note", "feature"):
            raise IdeaError("bad-kind")
        if urgency is not None and urgency not in ideas.URGENCIES:
            raise IdeaError("bad-urgency")
        t, stamp = self._now()
        with self.store.tx() as doc:
            rid = ideas.next_id(doc, "F" if kind == "feature" else "N", t)
            rec = ideas.new_record(rid, kind, stamp, by)
            rec["text"] = text
            rec["lang"] = lang if lang in ideas.LOCALES else ""
            ideas.set_contact(rec, contact)
            rec["urgency"] = urgency
            title = ideas.clean_texts(public_title, ideas.TITLE_MAX)
            if title:
                rec["public"]["title"] = title
            doc["ideas"].append(rec)
        self._emit("note", rec, None, by)
        return copy.deepcopy(rec)

    # ---------------- the owner's decisions ----------------

    def set_status(self, rid: str, status: str, by: str) -> dict:
        if status not in ideas.STATUSES:
            raise IdeaError("bad-status")
        _, stamp = self._now()
        with self._idea(rid) as (_, rec):
            rec["status"], rec["statusAt"] = status, stamp
            if status == "done":
                rec["done"] = {"summary": {}, **(rec.get("done") or {}), "at": stamp, "by": by}
            out = copy.deepcopy(rec)
        self._emit("status", out, None, by)
        return out

    def set_urgency(self, rid: str, urgency: str | None, by: str) -> dict:
        if urgency is not None and urgency not in ideas.URGENCIES:
            raise IdeaError("bad-urgency")
        with self._idea(rid) as (_, rec):
            rec["urgency"] = urgency
            out = copy.deepcopy(rec)
        self._emit("urgency", out, None, by)
        return out

    def add_comment(self, rid: str, text: str, by: str) -> dict:
        text = ideas.clean_text(text, ideas.COMMENT_MAX)
        if not text:
            raise IdeaError("empty")
        _, stamp = self._now()
        with self._idea(rid) as (_, rec):
            rec["comments"].append({"at": stamp, "text": text, "by": by})
            out = copy.deepcopy(rec)
        self._emit("comment", out, None, by)
        return out

    def set_public(self, rid: str, by: str, title=None, text=None, visible: bool | None = None) -> dict:
        """The roadmap's words (our own, never the pilot's): title and text per language, visibility."""
        with self._idea(rid) as (_, rec):
            if title is not None:
                rec["public"]["title"] = ideas.clean_texts(title, ideas.TITLE_MAX)
            if text is not None:
                rec["public"]["text"] = ideas.clean_texts(text, ideas.PUBLIC_TEXT_MAX, lines=True)
            if visible is not None:
                rec["public"]["visible"] = bool(visible)
            out = copy.deepcopy(rec)
        self._emit("public", out, None, by)
        return out

    def link_release(self, rid: str, sha: str, by: str) -> dict:
        if not isinstance(sha, str) or not ideas.SHA_RE.fullmatch(sha):
            raise IdeaError("bad-release")
        with self._idea(rid) as (_, rec):
            if sha not in rec["releases"]:
                rec["releases"].append(sha)
            out = copy.deepcopy(rec)
        self._emit("release", out, None, by)
        return out

    def set_order(self, rid: str, order: int, by: str) -> dict:
        if not isinstance(order, int) or isinstance(order, bool) or not 0 <= order <= 100000:
            raise IdeaError("bad-order")
        with self._idea(rid) as (_, rec):
            rec["order"] = order
            out = copy.deepcopy(rec)
        self._emit("public", out, None, by)
        return out

    # ---------------- e-mail ----------------

    def _mail(self, doc: dict, rec: dict, kind: str, body: str, by: str, state: str, stamp: str) -> dict:
        mid = ideas.next_mail_id(doc)
        lang = rec["lang"] if rec["lang"] in ideas.LOCALES else "en"
        plain, html = self.mailer.compose(kind, lang, body, rec)
        return {"id": mid, "kind": kind, "to": rec["email"], "lang": lang, "subject": self.mailer.subject(kind, lang, rec["id"]),
                "body": body, "plain": plain, "html": html,
                "messageId": f"<gsfpv.{rec['id']}.{mid}.{secrets.token_hex(4)}@{self.host}>",
                "inReplyTo": None, "references": [], "state": state, "created": stamp, "notBefore": None,
                "attempts": 0, "nextAt": None, "error": "", "sentAt": None, "by": by, "tgMsg": None}

    def _queue(self, mail: dict, t: float) -> str:
        """Ready to go after the undo window, or waiting for Gmail's setup; the event to emit."""
        if not self.mailer.configured:
            mail["state"] = "waiting_setup"
            return "mail-waiting"
        mail["state"], mail["notBefore"] = "queued", now_iso(t + self.undo_s)
        return "mail-queued"

    def reply(self, rid: str, text: str, by: str) -> tuple[dict, dict]:
        """The owner's answer to the pilot by e-mail (a reply to the report in Telegram, or the admin)."""
        text = ideas.clean_text(text, ideas.TEXT_MAX)
        if not text:
            raise IdeaError("empty")
        t, stamp = self._now()
        with self._idea(rid) as (doc, rec):
            mail = self._mail(doc, rec, "reply", text, by, "no_email", stamp)
            event = "mail-noemail" if rec["contactKind"] != "email" else self._queue(mail, t)
            rec["thread"].append(mail)
            out = copy.deepcopy(rec)
        self._emit(event, out, mail, by)
        return out, copy.deepcopy(mail)

    def cancel_mail(self, mail_id: str, by: str) -> tuple[dict, dict]:
        with self.store.tx() as doc:
            hit = ideas.find_mail(doc, mail_id) if isinstance(mail_id, str) else None
            if hit is None:
                raise IdeaError("not-found", 404)
            rec, mail = hit
            if mail["state"] in ("sending", "sent", "no_email"):
                raise IdeaError("too-late", 409)
            changed = mail["state"] != "cancelled"
            mail["state"], mail["nextAt"] = "cancelled", None
            out, m = copy.deepcopy(rec), copy.deepcopy(mail)
        if changed:
            self._emit("mail-cancelled", out, m, by)
        return out, m

    def set_done_summary(self, rid: str, summary, by: str, lang: str | None = None) -> tuple[dict, dict | None]:
        """What was done (owner's item 7): the idea is done and a DRAFT thank-you e-mail in the pilot's
        language is (re)written. The draft never goes by itself: send_done() is the owner's Send."""
        _, stamp = self._now()
        with self._idea(rid) as (doc, rec):
            if isinstance(summary, str):
                summary = {(lang if lang in ideas.LOCALES else rec["lang"] if rec["lang"] in ideas.LOCALES else "en"): summary}
            clean = ideas.clean_texts(summary, ideas.SUMMARY_MAX, lines=True)
            if not clean:
                raise IdeaError("empty")
            if rec["status"] != "done":
                rec["status"], rec["statusAt"] = "done", stamp
            done = rec.get("done") or {"at": stamp}
            rec["done"] = {**done, "summary": {**(done.get("summary") or {}), **clean}, "by": by, "at": done.get("at") or stamp}
            draft = None
            if rec["contactKind"] == "email":
                lang_ = rec["lang"] if rec["lang"] in ideas.LOCALES else "en"
                s = rec["done"]["summary"]
                body = s.get(lang_) or s.get("en") or next(iter(s.values()))
                rec["thread"] = [m for m in rec["thread"] if not (m["kind"] == "done" and m["state"] == "draft")]
                draft = self._mail(doc, rec, "done", body, by, "draft", stamp)
                rec["thread"].append(draft)
            out = copy.deepcopy(rec)
        self._emit("draft", out, copy.deepcopy(draft), by)
        return out, copy.deepcopy(draft)

    def send_done(self, rid: str, by: str) -> tuple[dict, dict]:
        """The owner's Send under the draft thank-you e-mail: the only way it is queued."""
        t, _ = self._now()
        with self._idea(rid) as (_, rec):
            draft = next((m for m in reversed(rec["thread"]) if m["kind"] == "done" and m["state"] == "draft"), None)
            if draft is None:
                raise IdeaError("no-draft", 409)
            event = self._queue(draft, t)
            out, m = copy.deepcopy(rec), copy.deepcopy(draft)
        self._emit(event, out, m, by)
        return out, m

    def send_mail(self, mail_id: str, by: str) -> tuple[dict, dict]:
        """The owner's explicit Send of an e-mail that waited for Gmail's setup, failed or may not have
        gone (unknown); a draft goes the same way as send_done()."""
        t, _ = self._now()
        with self.store.tx() as doc:
            hit = ideas.find_mail(doc, mail_id) if isinstance(mail_id, str) else None
            if hit is None:
                raise IdeaError("not-found", 404)
            rec, mail = hit
            if mail["state"] not in RESENDABLE + ("draft",):
                raise IdeaError("not-resendable", 409)
            event = self._queue(mail, t)
            mail["nextAt"], mail["error"] = None, ""
            out, m = copy.deepcopy(rec), copy.deepcopy(mail)
        self._emit(event, out, m, by)
        return out, m

    # ---------------- the outbox worker (outbox.py) ----------------

    def due_mails(self) -> list[str]:
        now = self.clock()
        out = []
        for rec in self.store.read()["ideas"]:
            for m in rec["thread"]:
                at = parse_iso(m.get("notBefore")) if m["state"] == "queued" else parse_iso(m.get("nextAt")) if m["state"] == "failed" else None
                if at is not None and at <= now:
                    out.append(m["id"])
        return out

    def claim(self, mail_id: str) -> tuple[dict, dict] | None:
        """queued (or failed and due again) -> sending, with the thread's references as they are now;
        None when it is not due any more (cancelled meanwhile)."""
        now, _ = self._now()
        with self.store.tx() as doc:
            hit = ideas.find_mail(doc, mail_id)
            if hit is None:
                return None
            rec, mail = hit
            at = parse_iso(mail.get("notBefore")) if mail["state"] == "queued" else parse_iso(mail.get("nextAt")) if mail["state"] == "failed" else None
            if at is None or at > now:
                return None
            gone = [m["messageId"] for m in rec["thread"] if m["state"] == "sent" and m["id"] != mail["id"]]
            mail["inReplyTo"] = gone[-1] if gone else None
            mail["references"] = gone[-10:]
            mail["state"], mail["attempts"] = "sending", mail["attempts"] + 1
            return copy.deepcopy(rec), copy.deepcopy(mail)

    def finish(self, mail_id: str, error: MailError | None) -> None:
        """Record what SMTP said: sent, failed (retried after a backoff when it may pass later), or
        unknown (the connection broke while the server was taking it: never sent again by itself)."""
        t, stamp = self._now()
        with self.store.tx() as doc:
            hit = ideas.find_mail(doc, mail_id)
            if hit is None:
                return
            rec, mail = hit
            if error is None:
                mail["state"], mail["sentAt"], mail["error"], mail["nextAt"] = "sent", stamp, "", None
                if mail["kind"] == "done":
                    rec["notified"] = stamp
                event = "mail-sent"
            elif error.ambiguous:
                mail["state"], mail["error"], mail["nextAt"] = "unknown", error.reason, None
                event = "mail-unknown"
            else:
                retry = error.transient and mail["attempts"] < len(RETRY_BACKOFF_S)
                mail["state"], mail["error"] = "failed", error.reason
                mail["nextAt"] = now_iso(t + RETRY_BACKOFF_S[mail["attempts"] - 1]) if retry else None
                event = "mail-failed"
            out, m = copy.deepcopy(rec), copy.deepcopy(mail)
        self._emit(event, out, m, "outbox")

    def recover(self) -> None:
        """At start: an e-mail left in `sending` by a restart becomes `unknown` (it may have gone); one
        waiting for Gmail's setup is offered to the owner once Gmail is configured (never sent by itself)."""
        events = []
        with self.store.tx() as doc:
            for rec in doc["ideas"]:
                for m in rec["thread"]:
                    if m["state"] == "sending":
                        m["state"], m["error"] = "unknown", "restarted-while-sending"
                        events.append(("mail-unknown", copy.deepcopy(rec), copy.deepcopy(m)))
                    elif m["state"] == "waiting_setup" and self.mailer.configured and not m.get("askedAt"):
                        m["askedAt"] = now_iso(self.clock())
                        events.append(("mail-ask", copy.deepcopy(rec), copy.deepcopy(m)))
        for e, rec, m in events:
            self._emit(e, rec, m, "outbox")

    # ---------------- Telegram bookkeeping (ownerbot.py) ----------------

    def first_update(self, update_id: int) -> bool:
        """True the first time a Telegram update arrives; a retried delivery of it is not acted on again."""
        with self.store.tx() as doc:
            return ideas.remember_seen(doc, update_id)

    def link_message(self, message_id: int, rid: str, purpose: str, mail_id: str | None = None, card: bool = False) -> None:
        """Remember which idea (and e-mail) a bot message is about, so a reply or a button finds it."""
        if not isinstance(message_id, int):
            return
        with self.store.tx() as doc:
            ideas.remember_message(doc, message_id, rid, purpose, mail_id)
            rec = index(doc).get(rid)
            if rec is not None and card:
                rec.setdefault("tg", {})["card"] = message_id
            if rec is not None and mail_id:
                hit = ideas.find_mail(doc, mail_id)
                if hit is not None:
                    hit[1]["tgMsg"] = message_id

    def message_target(self, message_id) -> dict | None:
        t = self.store.read()["tg"].get("msgs", {}).get(str(message_id))
        return dict(t) if t else None

    # ---------------- the old Reports tab (GET /api/admin/reports), now read from the store ----------------

    def reports_view(self, limit: int = 500) -> list[dict]:
        rows = [r for r in self.store.read()["ideas"] if r["source"] == "report"]
        out = []
        for r in sorted(rows, key=lambda r: r["id"], reverse=True)[:limit]:
            out.append({"id": r["id"], "ts": r["created"], "kind": r["kind"], "page": r["page"], "locale": r["lang"],
                        "scene": r["scene"], "release": r["release"], "message": r["text"], "contact": r["contact"],
                        "suspect": r["suspect"], "diagnostics": r["diagnostics"],
                        "status": "closed" if r["status"] in ("done", "rejected") else "open", "statusTs": r["statusAt"]})
        return out

    def reports_set_status(self, rid: str, status: str, by: str) -> bool:
        """open/closed of the old tab: closed -> done (unless already done or rejected), open -> new."""
        if status not in ("open", "closed") or not isinstance(rid, str) or not rid.startswith("R-"):
            return False
        cur = self.get(rid)
        if cur is None:
            return False
        closed = cur["status"] in ("done", "rejected")
        if status == "closed" and not closed:
            self.set_status(rid, "done", by)
        elif status == "open" and closed:
            self.set_status(rid, "new", by)
        return True
