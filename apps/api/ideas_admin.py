"""The owner's admin routes for ideas, under the admin's session and CSRF (admin.AdminApi calls these
after its own checks; the kanban page of lane C uses them). Every change goes through service.py, so
the admin follows the same rules as Telegram: an e-mail only on an explicit reply or Send, a 60 s undo
window, a done e-mail only as a draft until send-done.

GET  /api/admin/ideas                  every idea (with its e-mail thread), whether Gmail and the owner bot are set up
GET  /api/admin/ideas/<id>             one idea
POST /api/admin/ideas/update           {id, status?, urgency? (null clears), comment?, publicTitle? {lang: text},
                                        publicText? {lang: text}, visible?, release?, order?}
POST /api/admin/ideas/note             {text, contact?, lang?, urgency?, kind?: note|feature, publicTitle?}
POST /api/admin/ideas/reply            {id, text}: the owner's answer by e-mail (queued with the undo window)
POST /api/admin/ideas/mail/cancel      {id: mail id}: 409 when it is already being sent or was sent
POST /api/admin/ideas/done             {id, summary: {lang: text} | text}: done + the draft thank-you e-mail
POST /api/admin/ideas/send-done        {id, mail: the draft's e-mail id}: the owner's Send under the draft he was
                                       shown; 409 stale-draft when a newer summary replaced it (show the new one)
POST /api/admin/ideas/mail/send        {id: mail id}: send again an e-mail that waited, failed or may not have gone
"""
from __future__ import annotations

import json
import re
from typing import Callable

import ideas
from service import IdeaError, IdeasService

Response = tuple[int, bytes, list]
_ONE_RE = re.compile(r"ideas/([RNF]-[A-Za-z0-9][A-Za-z0-9-]{0,47})")
_UPDATE_KEYS = ("id", "status", "urgency", "comment", "publicTitle", "publicText", "visible", "release", "order")


def _json(code: int, obj: dict) -> Response:
    return code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), [("Content-Type", "application/json"), ("Cache-Control", "no-store")]


class IdeasAdmin:
    """Routes below /api/admin/ for ideas; `bot_ready` says whether the owner bot is configured.
    `unavailable`: the errors that mean the store cannot be used now (admin.py answers them 503)."""

    unavailable = (ideas.StoreError, OSError)

    def __init__(self, service: IdeasService, bot_ready: Callable[[], bool]):
        self.service, self.bot_ready = service, bot_ready

    def owns(self, route: str) -> bool:
        return route == "ideas" or route.startswith("ideas/")

    def get(self, route: str) -> Response:
        if route == "ideas":
            return _json(200, {"ok": True, "ideas": self.service.all(),
                               "mail": {"configured": self.service.mail_configured, "from": self.service.mailer.sender() or None},
                               "bot": {"configured": self.bot_ready()}, "undoSeconds": self.service.undo_s})
        m = _ONE_RE.fullmatch(route)
        rec = self.service.get(m.group(1)) if m else None
        return _json(200, {"ok": True, "idea": rec}) if rec else _json(404, {"ok": False})

    def post(self, route: str, b: dict) -> tuple[Response, str]:
        """(response, audit detail)."""
        try:
            return self._post(route, b)
        except IdeaError as e:
            return _json(e.status, {"ok": False, "reason": e.code}), f"refused {e.code}"

    def _post(self, route: str, b: dict) -> tuple[Response, str]:
        s, by = self.service, "admin"
        rid = b.get("id")
        if route == "ideas/update":
            if any(k not in _UPDATE_KEYS for k in b):
                raise IdeaError("unknown-field")
            rec = s.get(rid) if isinstance(rid, str) else None
            if rec is None:
                raise IdeaError("not-found", 404)
            # all or nothing: every value is checked before the first change is made
            if "status" in b and b["status"] not in ideas.STATUSES:
                raise IdeaError("bad-status")
            if "urgency" in b and b["urgency"] is not None and b["urgency"] not in ideas.URGENCIES:
                raise IdeaError("bad-urgency")
            if "release" in b and not (isinstance(b["release"], str) and ideas.SHA_RE.fullmatch(b["release"])):
                raise IdeaError("bad-release")
            if "order" in b and (not isinstance(b["order"], int) or isinstance(b["order"], bool) or not 0 <= b["order"] <= 100000):
                raise IdeaError("bad-order")
            if "comment" in b and not ideas.clean_text(b["comment"], ideas.COMMENT_MAX):
                raise IdeaError("empty")
            if "status" in b:
                rec = s.set_status(rid, b["status"], by)
            if "urgency" in b:
                rec = s.set_urgency(rid, b["urgency"], by)
            if "comment" in b:
                rec = s.add_comment(rid, b["comment"], by)
            if any(k in b for k in ("publicTitle", "publicText", "visible")):
                rec = s.set_public(rid, by, title=b.get("publicTitle"), text=b.get("publicText"),
                                   visible=b["visible"] if isinstance(b.get("visible"), bool) else None)
            if "release" in b:
                rec = s.link_release(rid, b["release"], by)
            if "order" in b:
                rec = s.set_order(rid, b["order"], by)
            return _json(200, {"ok": True, "idea": rec}), f"{rid} {','.join(k for k in b if k != 'id')}"
        if route == "ideas/note":
            rec = s.add_note(b.get("text"), by, contact=b.get("contact") if isinstance(b.get("contact"), str) else "",
                             lang=b.get("lang") or "", urgency=b.get("urgency"), kind=b.get("kind") or "note",
                             public_title=b.get("publicTitle"))
            return _json(200, {"ok": True, "idea": rec}), rec["id"]
        if route == "ideas/reply":
            rec, mail = s.reply(rid, b.get("text"), by)
            return _json(200, {"ok": True, "idea": rec, "mail": mail}), f"{rid} {mail['id']} {mail['state']}"
        if route == "ideas/mail/cancel":
            rec, mail = s.cancel_mail(rid, by)
            return _json(200, {"ok": True, "idea": rec, "mail": mail}), f"{rid}"
        if route == "ideas/done":
            rec, draft = s.set_done_summary(rid, b.get("summary"), by)
            return _json(200, {"ok": True, "idea": rec, "draft": draft}), f"{rid}"
        if route == "ideas/send-done":
            rec, mail = s.send_done(rid, b.get("mail"), by)
            return _json(200, {"ok": True, "idea": rec, "mail": mail}), f"{rid} {mail['id']} {mail['state']}"
        if route == "ideas/mail/send":
            rec, mail = s.send_mail(rid, by)
            return _json(200, {"ok": True, "idea": rec, "mail": mail}), f"{rid} {mail['state']}"
        return _json(404, {"ok": False}), "no route"
