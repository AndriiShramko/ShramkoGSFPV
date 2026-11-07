"""The owner's Sessions tab (v0.12, lane v12-feedback, docs/wip/v12-plan.md 4.3 step 9): the recordings pilots sent, what became of each in
its two channels, the file itself, a resend per channel, and the deletion a pilot or a parent may ask for.

Routes, all behind the admin's session (admin.AdminApi.handle: the cookie, and X-CSRF on every POST), wired in server.py with add_route:

GET  /api/admin/sessions                          every stored recording, newest first, with its channels; totals; what the channels are set up for
GET  /api/admin/sessions/<id>/package             the .zip as an attachment, STREAMED from disk (admin.FileBody: a package of up to 100 MiB is never held in memory)
POST /api/admin/sessions/<id>/resend {channel}    that channel goes back to queued with its failures cleared (telegram | email); the worker is woken
POST /api/admin/sessions/<id>/delete {confirm}    the package and its state are removed ({"confirm": true} is required); a tombstone line stays in index.jsonl

What the owner sees is the store's own public view (sessions.SessionStore.list): the id, when, size, SHA-256, a few facts of the manifest
(lesson, language, length, voice, under 18 and whether a guardian's consent was confirmed) and each channel's state. Never an upload token
or its hash, the pilot's nickname, the device or the user agent: those stay inside the package, which the owner opens by downloading it.
Every download, resend and deletion is written to the admin's audit log (action sessions.<what>, the id, never a token).
"""
from __future__ import annotations

import json
import re
from typing import Callable

import admin
import sessions

SID = r"(S-[0-9]{8}-[0-9a-f]{12})"
BODY_MAX = 4096


def _json(code: int, obj: dict) -> admin.Response:
    return admin._json(code, obj)


class SessionsAdmin:
    def __init__(self, store: Callable[[], sessions.SessionStore], audit: Callable[[str, str, bool, str], None], channels: Callable[[], dict] | None = None):
        """`store` is asked each time (the server may replace it); `audit(client, action, ok, detail)` is AdminApi.audit; `channels()` says what
        the delivery channels are set up for (configured, size limits), shown on the tab."""
        self._store, self._audit, self._channels = store, audit, channels

    def register(self, api: admin.AdminApi) -> None:
        api.add_route("GET", r"sessions", self.list)
        api.add_route("GET", rf"sessions/{SID}/package", self.package)
        api.add_route("POST", rf"sessions/{SID}/resend", self.resend)
        api.add_route("POST", rf"sessions/{SID}/delete", self.delete)

    # ---- the list

    @staticmethod
    def _row(r: dict) -> dict:
        """One recording for the tab: the store's public view, cut to what the tab shows (no token, no hash of it)."""
        return {"id": r["id"], "storedAt": r.get("storedAt"), "bytes": r.get("bytes"), "sha256": r.get("sha256"), "summary": r.get("summary") or {},
                "channels": r.get("channels") or {}, "delivered": bool(r.get("delivered"))}

    def list(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        rows = [self._row(r) for r in self._store().list()]
        failed = sum(1 for r in rows if any((c.get("status") == "failed") for c in r["channels"].values()))
        totals = {"stored": len(rows), "delivered": sum(1 for r in rows if r["delivered"]), "failed": failed,
                  "waiting": sum(1 for r in rows if not r["delivered"]), "bytes": sum(int(r["bytes"] or 0) for r in rows)}
        return _json(200, {"ok": True, "sessions": rows, "totals": totals, "config": self._channels() if self._channels else {},
                           "retentionDays": sessions.RETENTION_DAYS, "maxPackageBytes": sessions.MAX_PACKAGE_BYTES})

    # ---- the file

    def package(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        sid = m.group(1)
        store = self._store()
        meta = store.get(sid)
        if meta is None or meta.get("state") != "stored":
            return _json(404, {"ok": False, "reason": "not-stored"})
        path = store.package_path(sid)
        try:
            size = path.stat().st_size
        except OSError:
            return _json(404, {"ok": False, "reason": "no-file"})
        self._audit(client, "sessions.download", True, sid)
        # an attachment the browser must save, never show; the name carries only the id (no pilot, no device)
        return 200, admin.FileBody(path, size), [("Content-Type", "application/zip"), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                                                  ("Content-Disposition", f'attachment; filename="fly-by-sound-{sid}.zip"')]

    # ---- resend and delete

    @staticmethod
    def _body(read_body: Callable[[int], bytes]) -> dict | None:
        try:
            v = json.loads(read_body(BODY_MAX) or b"{}")
        except ValueError:
            return None
        return v if isinstance(v, dict) else None

    def resend(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        sid = m.group(1)
        body = self._body(read_body)
        if body is None:
            return _json(400, {"ok": False, "reason": "bad-request"})
        channel = body.get("channel")
        try:
            meta = self._store().resend(sid, channel if isinstance(channel, str) else "")
        except sessions.SessionError as e:
            self._audit(client, "sessions.resend", False, f"{sid} {e.code}")
            return _json(e.status, {"ok": False, "reason": e.code})
        self._audit(client, "sessions.resend", True, f"{sid} {channel}")
        return _json(200, {"ok": True, "id": sid, "channels": sessions.SessionStore.public_channels(meta), "delivered": sessions.SessionStore.delivered(meta)})

    def delete(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        sid = m.group(1)
        body = self._body(read_body)
        if body is None or body.get("confirm") is not True:
            return _json(400, {"ok": False, "reason": "confirm"})
        if not self._store().delete(sid, "request"):
            self._audit(client, "sessions.delete", False, f"{sid} unknown")
            return _json(404, {"ok": False, "reason": "unknown"})
        self._audit(client, "sessions.delete", True, sid)
        return _json(200, {"ok": True, "id": sid})
