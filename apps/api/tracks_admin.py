"""The admin's routes of the courses (tracks-plan 2.10, requirement R8: the admin edits everything), behind admin.AdminApi's
session, CSRF and error handling (add_route). Every action is written to the admin's audit log (action tracks.<what>, the
course id, never a token or a voter).

  GET  /api/admin/tracks                      -> {ok, scenes: [{scene, tracks, hidden}]}
  GET  /api/admin/tracks?scene=<hex>          -> {ok, tracks: [rows incl. hidden ones, versions, editable]}
  GET  /api/admin/tracks/<id>/v<n>            -> the file of a version, also of a hidden course (no-store)
  POST /api/admin/tracks/<id>/hide            {hidden: true|false}
  POST /api/admin/tracks/<id>/delete          {confirm: true}       the whole course
  POST /api/admin/tracks/<id>/v<n>/delete     {confirm: true}       one version (the last one takes the course)
  POST /api/admin/tracks/<id>/versions        a track file          a new version, edited by kind 'admin', the creator kept
  POST /api/admin/tracks/<id>/votes/reset     {confirm: true}
  POST /api/admin/tracks/<id>/broken/reset    {confirm: true}
"""
from __future__ import annotations

import json
import re
import urllib.parse
from typing import Callable

import admin
import tracks

TID = r"([0-9a-f]{6,32}-[0-9a-f]{8})"
BODY_MAX = 4096


def _json(code: int, obj: dict) -> admin.Response:
    return admin._json(code, obj)


class TracksAdmin:
    def __init__(self, store: Callable[[], tracks.TrackStore], audit: Callable[[str, str, bool, str], None]) -> None:
        """`store` is asked each time (the server's tests replace it); `audit(client, action, ok, detail)` is AdminApi.audit."""
        self._store, self._audit = store, audit

    def register(self, api: admin.AdminApi) -> None:
        api.add_route("GET", r"tracks", self.list)
        api.add_route("GET", rf"tracks/{TID}/v([0-9]{{1,4}})", self.file)
        api.add_route("POST", rf"tracks/{TID}/hide", self.hide)
        api.add_route("POST", rf"tracks/{TID}/delete", self.delete)
        api.add_route("POST", rf"tracks/{TID}/v([0-9]{{1,4}})/delete", self.delete)
        api.add_route("POST", rf"tracks/{TID}/versions", self.version)
        api.add_route("POST", rf"tracks/{TID}/(votes|broken)/reset", self.reset)

    @staticmethod
    def _body(read_body: Callable[[int], bytes]) -> dict | None:
        try:
            v = json.loads(read_body(BODY_MAX) or b"{}")
        except ValueError:
            return None
        return v if isinstance(v, dict) else None

    def _do(self, client: str, action: str, tid: str, fn: Callable[[], dict], code: int = 200) -> admin.Response:
        try:
            out = fn()
        except tracks.TrackError as e:
            self._audit(client, f"tracks.{action}", False, f"{tid} {e.code}")
            return _json(e.status, {"ok": False, "reason": e.code, **e.extra})
        self._audit(client, f"tracks.{action}", True, tid)
        return _json(code, {"ok": True, "id": tid, **out})

    def list(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        scene = (urllib.parse.parse_qs(qs).get("scene") or [""])[0]
        if not scene:
            return _json(200, {"ok": True, "scenes": self._store().scenes()})
        if not tracks.SCENE_ID.fullmatch(scene):
            return _json(400, {"ok": False, "reason": "bad-scene"})
        rows = self._store().rows(scene, hidden=True)
        return _json(200, {"ok": True, "scene": scene, "tracks": [{**r, "rating": round(tracks.wilson(r["up"], r["down"]), 4)} for r in rows]})

    def file(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        try:
            return self._store().file(m.group(1), int(m.group(2)), None, admin=True)
        except tracks.TrackError as e:
            return _json(e.status, {"ok": False, "reason": e.code})

    def hide(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        tid, body = m.group(1), self._body(read_body)
        if body is None or not isinstance(body.get("hidden"), bool):
            return _json(400, {"ok": False, "reason": "bad-request"})
        return self._do(client, "hide" if body["hidden"] else "unhide", tid, lambda: {"row": self._store().set_hidden(tid, body["hidden"])})

    def delete(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        tid, body = m.group(1), self._body(read_body)
        n = int(m.group(2)) if m.lastindex and m.lastindex >= 2 else None
        if body is None or body.get("confirm") is not True:
            return _json(400, {"ok": False, "reason": "confirm"})
        return self._do(client, "delete" if n is None else f"delete-v{n}", tid, lambda: self._store().delete(tid, n))

    def version(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        tid = m.group(1)
        limit = tracks.LIMITS["body_bytes"]
        try:
            raw = read_body(limit + 1)
        except Exception:   # the admin reader refuses a body over its limit
            raw = b"x" * (limit + 1)
        return self._do(client, "version", tid, lambda: self._store().add_version(tid, None, raw, admin=True), code=201)

    def reset(self, m: re.Match, qs: str, read_body: Callable[[int], bytes], client: str) -> admin.Response:
        tid, what, body = m.group(1), m.group(2), self._body(read_body)
        if body is None or body.get("confirm") is not True:
            return _json(400, {"ok": False, "reason": "confirm"})
        return self._do(client, f"reset-{what}", tid, lambda: {"row": self._store().reset(tid, what)})
