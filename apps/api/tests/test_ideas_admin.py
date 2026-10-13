"""The admin's ideas routes (apps/api/ideas_admin.py behind admin.py's session and CSRF) and the public
GET /api/roadmap, through the real HTTP handler of server.py.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only; fake Telegram and SMTP, a password
made up per run). Every check has a negative control that must fire.
"""
from __future__ import annotations

import http.client
import json
import secrets
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import admin  # noqa: E402
import ideas_admin  # noqa: E402
import server  # noqa: E402
from fakes import World  # noqa: E402

PASSWORD = "t3st-" + secrets.token_urlsafe(12)
HASH = admin.make_hash(PASSWORD)


class IdeasAdminTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.w = World(d)
        names = ("DATA_DIR", "REPORTS_FILE", "REPORTS_DIR", "IDEAS", "SERVICE", "BOT", "ADMIN")
        self.saved = {k: getattr(server, k) for k in names}
        server.DATA_DIR, server.REPORTS_FILE, server.REPORTS_DIR = d, self.w.reports, d / "reports"
        server.IDEAS, server.SERVICE, server.BOT = self.w.store, self.w.service, self.w.bot
        server.ADMIN = admin.AdminApi(data_dir=lambda: d, reports_dir=lambda: d / "reports", seed=lambda: None, telegram=lambda t: None,
                                      env={"ADMIN_PASSWORD_HASH": HASH}, clock=lambda: self.w.now[0],
                                      ideas=ideas_admin.IdeasAdmin(self.w.service, bot_ready=lambda: self.w.bot.configured))
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        self.api.shutdown()
        self.api.server_close()
        for k, v in self.saved.items():
            setattr(server, k, v)
        self.w.close()
        self.tmp.cleanup()

    def req(self, method: str, path: str, body=None, cookie: str | None = None, csrf: str | None = None, headers: dict | None = None):
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=20)
        h = {"X-Forwarded-For": "198.51.100.7", **(headers or {})}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if cookie:
            h["Cookie"] = cookie
        if csrf is not None:
            h["X-CSRF"] = csrf
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        out = r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
        c.close()
        return out

    def login(self) -> tuple[str, str]:
        st, h, b = self.req("POST", "/api/admin/login", {"password": PASSWORD})
        self.assertEqual(st, 200)
        return h["set-cookie"].split(";")[0], json.loads(b)["csrf"]

    def call(self, route: str, body: dict, cookie: str, csrf: str) -> tuple[int, dict]:
        st, _, b = self.req("POST", f"/api/admin/{route}", body, cookie=cookie, csrf=csrf)
        return st, json.loads(b)


class Routes(IdeasAdminTest):
    def test_session_and_csrf_guard_every_ideas_route(self):
        rid = self.w.report()["id"]
        routes = [("GET", "/api/admin/ideas"), ("GET", f"/api/admin/ideas/{rid}"), ("POST", "/api/admin/ideas/update"),
                  ("POST", "/api/admin/ideas/reply"), ("POST", "/api/admin/ideas/done"), ("POST", "/api/admin/ideas/send-done"),
                  ("POST", "/api/admin/ideas/note"), ("POST", "/api/admin/ideas/mail/cancel"), ("POST", "/api/admin/ideas/mail/send")]
        for m, p in routes:
            self.assertEqual(self.req(m, p, {"id": rid, "text": "x"} if m == "POST" else None)[0], 401, p)
        cookie, csrf = self.login()
        for m, p in routes:
            if m == "POST":
                self.assertEqual(self.req(m, p, {"id": rid, "text": "x"}, cookie=cookie)[0], 403, p)
        self.assertEqual(self.w.service.get(rid)["thread"], [])  # nothing went through
        # control: with the session and the token the same routes answer
        st, _, b = self.req("GET", "/api/admin/ideas", cookie=cookie)
        doc = json.loads(b)
        self.assertEqual((st, [r["id"] for r in doc["ideas"]], doc["mail"]["configured"], doc["bot"]["configured"]), (200, [rid], True, True))
        self.assertEqual(self.req("GET", f"/api/admin/ideas/{rid}", cookie=cookie)[0], 200)
        self.assertEqual(self.req("GET", "/api/admin/ideas/R-20990101-0001", cookie=cookie)[0], 404)

    def test_update_is_all_or_nothing(self):
        rid = self.w.report()["id"]
        cookie, csrf = self.login()
        for bad in ({"id": rid, "status": "accepted", "urgency": "whenever"}, {"id": rid, "status": "accepted", "release": "not-a-sha"},
                    {"id": rid, "status": "accepted", "evil": 1}, {"id": "R-20990101-0001", "status": "accepted"}):
            st, _ = self.call("ideas/update", bad, cookie, csrf)
            self.assertIn(st, (400, 404), bad)
        self.assertEqual(self.w.service.get(rid)["status"], "new")
        # control: valid values all land
        st, doc = self.call("ideas/update", {"id": rid, "status": "accepted", "urgency": "high", "comment": "check the wind code",
                                             "publicTitle": {"en": "Rain", "es": "Lluvia", "pl": "Deszcz", "ru": "Rain ru"},
                                             "release": "1a2b3c4"}, cookie, csrf)
        self.assertEqual(st, 200)
        i = doc["idea"]
        self.assertEqual((i["status"], i["urgency"], i["comments"][0]["text"], i["public"]["title"]["es"], i["releases"]),
                         ("accepted", "high", "check the wind code", "Lluvia", ["1a2b3c4"]))
        audit = (Path(self.tmp.name) / "admin-audit.jsonl").read_text(encoding="utf-8")
        self.assertIn('"action": "ideas-update"', audit)

    def test_reply_cancel_done_and_send_follow_the_same_rules(self):
        rid = self.w.report()["id"]
        cookie, csrf = self.login()
        st, doc = self.call("ideas/reply", {"id": rid, "text": "Thanks from the admin"}, cookie, csrf)
        self.assertEqual((st, doc["mail"]["state"]), (200, "queued"))
        st, _ = self.call("ideas/mail/cancel", {"id": doc["mail"]["id"]}, cookie, csrf)
        self.assertEqual(st, 200)
        self.w.now[0] += 120
        self.w.worker.run_once()
        self.assertEqual(self.w.smtp.messages, [])                    # cancelled in the window
        st, doc = self.call("ideas/done", {"id": rid, "summary": {"pl": "Deszcz jest w scenach."}}, cookie, csrf)
        self.assertEqual((st, doc["idea"]["status"], doc["draft"]["state"]), (200, "done", "draft"))
        seen = doc["draft"]["id"]                                      # the kanban shows this draft
        st, doc = self.call("ideas/done", {"id": rid, "summary": {"pl": "Deszcz i wiatr są w scenach."}}, cookie, csrf)
        current = doc["draft"]["id"]                                   # another tab (or an agent) rewrote it
        self.w.now[0] += 86400
        self.w.worker.run_once()
        self.assertEqual(self.w.smtp.messages, [])                    # a draft is not sent
        cookie, csrf = self.login()                                    # a day later: the 12 h session is over
        self.assertEqual(self.call("ideas/send-done", {"id": rid}, cookie, csrf)[:1], (400,))   # which draft? must be named
        st, doc = self.call("ideas/send-done", {"id": rid, "mail": seen}, cookie, csrf)
        self.assertEqual((st, doc.get("reason")), (409, "stale-draft"))                        # a stale kanban sends nothing
        st, doc = self.call("ideas/send-done", {"id": rid, "mail": current}, cookie, csrf)
        self.assertEqual((st, doc["mail"]["state"]), (200, "queued"))
        self.assertEqual(self.call("ideas/mail/cancel", {"id": "M-999"}, cookie, csrf)[0], 404)
        self.w.now[0] += 61
        self.w.worker.run_once()
        self.assertEqual(len(self.w.smtp.messages), 1)                # control: the explicit send went, once
        self.assertEqual(self.call("ideas/mail/cancel", {"id": doc["mail"]["id"]}, cookie, csrf)[0], 409)
        self.assertEqual(self.call("ideas/send-done", {"id": rid, "mail": current}, cookie, csrf)[0], 409)
        self.assertIn("Deszcz i wiatr", self.w.smtp.messages[0]["data"].decode("utf-8", "replace"))


class PublicRoadmap(IdeasAdminTest):
    def test_get_roadmap_etag_and_nothing_private(self):
        cookie, csrf = self.login()
        rid = self.w.report(message="private words", contact="pilot@example.com")["id"]
        self.call("ideas/update", {"id": rid, "status": "in_progress", "publicTitle": {"en": "Crosshair"}}, cookie, csrf)
        st, doc = self.call("ideas/note", {"text": "our own plan", "kind": "feature", "publicTitle": {"en": "Wind"}}, cookie, csrf)
        self.assertEqual(st, 200)
        fid = doc["idea"]["id"]
        self.assertTrue(fid.startswith("F-"))
        st, h, body = self.req("GET", "/api/roadmap")
        self.assertEqual(st, 200)
        self.assertIn("max-age=60", h["cache-control"])
        items = json.loads(body)["items"]
        self.assertEqual([(x["id"], x["status"], x["fromPilot"]) for x in items], [(rid, "in_progress", True)])  # the feature is still new
        for private in ("private words", "pilot@example.com", "our own plan"):
            self.assertNotIn(private, body.decode())
        self.assertEqual(self.req("GET", "/api/roadmap", headers={"If-None-Match": h["etag"]})[0], 304)
        # control: accepting the feature puts it on the roadmap and changes the tag
        self.call("ideas/update", {"id": fid, "status": "accepted"}, cookie, csrf)
        st, h2, body2 = self.req("GET", "/api/roadmap", headers={"If-None-Match": h["etag"]})
        self.assertEqual(st, 200)
        self.assertNotEqual(h2["etag"], h["etag"])
        self.assertEqual([x["id"] for x in json.loads(body2)["items"]], [fid, rid])
        self.assertEqual(self.req("POST", "/api/roadmap", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
