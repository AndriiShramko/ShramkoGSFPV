"""The use-cases of the ideas server: the only code that changes an idea (ideas.py holds the data).

The owner's bot (ownerbot.py), the admin routes (ideas_admin.py), the agents' CLI (ideas_cli.py) and
the outbox worker (outbox.py) all call these methods, so a rule lives in one place:

- an e-mail is queued only by an explicit act of the owner: reply() (his answer to a pilot) and
  send_done() / send_mail() (his Send under a draft or a waiting e-mail); every queued e-mail waits
  UNDO seconds (MAIL_UNDO_S, default 60) in which cancel_mail() stops it;
- set_done_summary() only writes a DRAFT of the thank-you e-mail, never queues it; an older draft
  becomes `superseded` (kept), and send_done() names the draft the owner saw, so a Send under a draft
  that was replaced meanwhile is refused (stale-draft) instead of sending a text he never read;
- no e-mail address -> the answer is kept in the thread as `no_email`; Gmail not configured -> it waits
  as `waiting_setup` and only goes after a later explicit send_mail();
- the worker claims a due e-mail (queued -> sending) before it talks to SMTP and records the outcome
  after, so an e-mail is never handed to SMTP twice by itself; one left in `sending` by a restart
  becomes `unknown` (recover());
- the pilot receives the e-mail in the language they wrote in (v0.9, owner's item 4): reply() and
  set_done_summary() ask the translator (translate.py) BEFORE the store transaction (a network call must
  not hold the file lock) what goes: the owner's words, or their translation with the original kept
  (`orig`, `tr`). A text the pilot cannot surely read waits as `waiting_language` (never sent by itself:
  the owner's send_mail() is "send it as written"); use_original() swaps a translation for the owner's
  own words inside its undo window.

Every change emits an event to the listeners (the owner bot shows it in Telegram): (event, idea, mail,
by) with event in status, urgency, comment, public, release, note, draft, mail-queued, mail-waiting,
mail-noemail, mail-language, mail-cancelled, mail-sent, mail-failed, mail-unknown, mail-ask. Listeners run
after the change is on disk; a listener that fails never undoes it.
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
import translate
from ideas import IdeaStore, index, now_iso, parse_iso
from mailer import Mailer, MailError

RETRY_BACKOFF_S = (60, 300, 1800, 7200, 21600)  # after the 1st..5th failed attempt; then it stops
RESENDABLE = ("waiting_setup", "failed", "unknown", "waiting_language")

Listener = Callable[[str, dict, "dict | None", str], None]


class IdeaError(Exception):
    """A refused action: a short code for the caller (and its HTTP status for the admin)."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code, self.status = code, status


class IdeasService:
    def __init__(self, store: IdeaStore, mailer: Mailer, clock: Callable[[], float] = time.time,
                 undo_s: float | None = None, env=os.environ, public_origin: str = "https://gsfpv.flyreelstudio.eu",
                 translator: translate.Translator | None = None):
        self.store, self.mailer, self.clock = store, mailer, clock
        self.translator = translator or translate.Translator(lambda: translate.GeminiConfig.from_env(env), store.data_dir)
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
            except Exception as e:  # noqa: BLE001  a listener (Telegram down) never undoes a change; it is logged
                print(f"ideas listener failed on {event}: {type(e).__name__}: {e}"[:300], flush=True)

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

    def add_report(self, line: dict, facts: dict | None = None) -> dict | None:
        """The idea of a report just stored in reports.jsonl (server.store_report); None if malformed.
        `facts`: the short summary of a bug's technical details (ownerbot.diag_facts), kept so the
        owner's card shows it every time it is redrawn."""
        rec = ideas.record_from_report(line)
        if rec is None:
            return None
        if facts:
            rec["diagFacts"] = facts
        with self.store.tx() as doc:
            have = index(doc).get(rec["id"])
            if have is not None:  # already imported from reports.jsonl (the store's first transaction does that)
                if facts and not have.get("diagFacts"):
                    have["diagFacts"] = facts
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

    def _plan(self, rec: dict, text: str | dict) -> translate.Plan:
        """What goes to the pilot (translate.Translator.plan), asked OUTSIDE the store transaction. A bug in
        the translator never loses the owner's words: the text then waits for his own Send."""
        try:
            return self.translator.plan(rec, text)
        except Exception as e:  # noqa: BLE001
            print(f"translate: plan failed ({type(e).__name__})", flush=True)
            words = next(iter(text.values())) if isinstance(text, dict) else text
            lang = rec["lang"] if rec["lang"] in ideas.LOCALES else "en"
            return translate.Plan(False, words, lang, why="failed:internal")

    def _remember_pilot(self, rec: dict, plan: translate.Plan | None) -> None:
        """Keep the pilot's language detected from their own text on the idea (asked once, kept)."""
        if plan is not None and plan.pilot_new and plan.pilot is not None and not rec.get("pilotLang"):
            rec["pilotLang"] = {"code": plan.pilot.code, "name": plan.pilot.name, "at": now_iso(self.clock())}

    def _mail(self, doc: dict, rec: dict, kind: str, body: str, by: str, state: str, stamp: str,
              plan: translate.Plan | None = None) -> dict:
        """A mail of the idea's thread. With a plan (translate.py): its language, its body (the owner's words
        translated, or as written) and the owner's original; without one (no e-mail address: nothing will
        be sent) the form language and the owner's words."""
        mid = ideas.next_mail_id(doc)
        lang = plan.lang if plan is not None else rec["lang"] if rec["lang"] in ideas.LOCALES else "en"
        text = plan.body if plan is not None else body
        plain, html = self.mailer.compose(kind, lang, text, rec)
        return {"id": mid, "kind": kind, "to": rec["email"], "lang": lang, "subject": self.mailer.subject(kind, lang, rec),
                "body": text, "orig": (plan.original or None) if plan is not None else None,
                "tr": plan.tr if plan is not None else None, "wait": "", "plain": plain, "html": html,
                "messageId": f"<gsfpv.{rec['id']}.{mid}.{secrets.token_hex(4)}@{self.host}>",
                "inReplyTo": None, "references": [], "state": state, "created": stamp, "notBefore": None,
                "attempts": 0, "nextAt": None, "error": "", "sentAt": None, "by": by, "tgMsg": None}

    def _hold(self, mail: dict, plan: translate.Plan) -> str:
        """The text cannot surely be read by the pilot: it waits for the owner (see the module's docstring)."""
        mail["state"], mail["wait"] = "waiting_language", plan.why
        return "mail-language"

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
        before = self.get(rid)
        if before is None:
            raise IdeaError("not-found", 404)
        # in the pilot's language (the network, so before the transaction); no address: nothing will be sent
        plan = self._plan(before, text) if before["contactKind"] == "email" else None
        t, stamp = self._now()    # after the translation: the undo window starts when the owner can read the result
        with self._idea(rid) as (doc, rec):
            if rec["contactKind"] == "email" and plan is None:
                raise IdeaError("busy", 409)   # the address appeared between the two reads: the owner sends again
            self._remember_pilot(rec, plan)
            mail = self._mail(doc, rec, "reply", text, by, "no_email", stamp, plan)
            if rec["contactKind"] != "email":
                event = "mail-noemail"
            elif plan is not None and not plan.ok:
                event = self._hold(mail, plan)
            else:
                event = self._queue(mail, t)
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
            if mail["state"] == "superseded":
                raise IdeaError("stale-draft", 409)
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
        language is (re)written. The draft never goes by itself: send_done() is the owner's Send.

        `summary` is a text of unknown language (the owner's words in Telegram: filed under the language the
        translator finds in it) or {language: text} (an agent). The draft says it in the language the pilot
        wrote in: the summary written in it, else a translation of the English one (translate.py)."""
        for _ in range(3):
            before = self.get(rid)
            if before is None:
                raise IdeaError("not-found", 404)
            old = (before.get("done") or {}).get("summary") or {}
            if isinstance(summary, str):
                words = ideas.clean_text(summary, ideas.SUMMARY_MAX)
                clean, said = {}, words
            else:
                clean = ideas.clean_texts(summary, ideas.SUMMARY_MAX, lines=True)
                words, said = "", {**old, **clean}
            if not (words or clean):
                raise IdeaError("empty")
            plan = self._plan(before, said) if before["contactKind"] == "email" else None
            _, stamp = self._now()
            with self._idea(rid) as (doc, rec):
                if ((rec.get("done") or {}).get("summary") or {}) != old:
                    continue     # a newer summary landed while the translation ran: decide again from it
                if words:        # the language the owner wrote in: the translator found it, else the form's
                    fallback = lang if lang in ideas.LOCALES else rec["lang"] if rec["lang"] in ideas.LOCALES else "en"
                    clean = {plan.source if plan is not None and plan.source in ideas.LOCALES else fallback: words}
                became_done = rec["status"] != "done"
                if became_done:
                    rec["status"], rec["statusAt"] = "done", stamp
                done = rec.get("done") or {}
                rec["done"] = {"summary": {**old, **clean}, "by": by,
                               "at": stamp if became_done or not done.get("at") else done["at"]}
                draft, event = None, "draft"
                if rec["contactKind"] == "email":
                    if plan is None:
                        raise IdeaError("busy", 409)
                    self._remember_pilot(rec, plan)
                    for m in rec["thread"]:  # kept, so a Send pressed under an older draft is refused, not lost
                        if m["kind"] == "done" and m["state"] in ("draft", "waiting_language"):
                            m["state"] = "superseded"
                    draft = self._mail(doc, rec, "done", plan.body, by, "draft", stamp, plan)
                    if not plan.ok:
                        event = self._hold(draft, plan)
                    rec["thread"].append(draft)
                out = copy.deepcopy(rec)
            break
        else:
            raise IdeaError("busy", 409)
        if became_done:
            self._emit("status", out, None, by)  # the owner's card shows "done" (an agent's summary, the admin)
        self._emit(event, out, copy.deepcopy(draft), by)
        return out, copy.deepcopy(draft)

    def send_done(self, rid: str, mail_id: str, by: str) -> tuple[dict, dict]:
        """The owner's Send under the draft thank-you e-mail he was shown (mail_id: that draft): the only
        way it is queued. A draft that a newer summary replaced meanwhile is refused (stale-draft), so
        what goes is always the text he saw; one already sent or queued is refused (no-draft)."""
        if not isinstance(mail_id, str) or not ideas.MAIL_ID_RE.fullmatch(mail_id):
            raise IdeaError("bad-mail")
        t, _ = self._now()
        with self._idea(rid) as (_, rec):
            draft = next((m for m in rec["thread"] if m["id"] == mail_id and m["kind"] == "done"), None)
            if draft is None:
                raise IdeaError("not-found", 404)
            if draft["state"] == "superseded":
                raise IdeaError("stale-draft", 409)
            if draft["state"] != "draft":
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
            if mail["state"] == "superseded":
                raise IdeaError("stale-draft", 409)
            if mail["state"] not in RESENDABLE + ("draft",):
                raise IdeaError("not-resendable", 409)
            event = self._queue(mail, t)
            mail["nextAt"], mail["error"], mail["wait"] = None, "", ""
            out, m = copy.deepcopy(rec), copy.deepcopy(mail)
        self._emit(event, out, m, by)
        return out, m

    def use_original(self, mail_id: str, by: str) -> tuple[dict, dict]:
        """Instead of the translation the owner was shown, send his own words (Telegram: "Send my original
        instead"): the same e-mail is rebuilt around them and gets a new undo window, so he sees what goes.
        Only while it still waits in the outbox (queued) and only a translated one has an original."""
        t, _ = self._now()
        with self.store.tx() as doc:
            hit = ideas.find_mail(doc, mail_id) if isinstance(mail_id, str) else None
            if hit is None:
                raise IdeaError("not-found", 404)
            rec, mail = hit
            if mail["state"] in ("sending", "sent"):
                raise IdeaError("too-late", 409)
            if mail["state"] != "queued" or not mail.get("orig"):
                raise IdeaError("no-original", 409)
            words = mail["orig"]
            mail["plain"], mail["html"] = self.mailer.compose(mail["kind"], mail["lang"], words, rec)
            mail["body"], mail["orig"], mail["tr"] = words, None, None
            mail["notBefore"] = now_iso(t + self.undo_s)
            out, m = copy.deepcopy(rec), copy.deepcopy(mail)
        self._emit("mail-queued", out, m, by)
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
