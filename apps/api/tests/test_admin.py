"""Tests of the owner's admin and the public catalogue (apps/api/admin.py, wired into server.py).

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only, no network: Telegram is a fake,
the data directory a temporary one, the clock a number the test moves). Every check has a negative
control that must fire. The test password is made up here; no real password is used or guessed.
"""
from __future__ import annotations

import contextlib
import http.client
import io
import json
import secrets
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
import admin  # noqa: E402
import server  # noqa: E402

REPO = HERE.parents[3]
PASSWORD = "t3st-" + secrets.token_urlsafe(12)  # a fresh one per run
HASH = admin.make_hash(PASSWORD)
SHOWCASE = REPO / "apps" / "fly" / "public" / "showcase.json"


class AdminApi(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.data = d
        self.saved = {k: getattr(server, k) for k in ("DATA_DIR", "REPORTS_FILE", "REPORTS_DIR", "ADMIN")}
        server.DATA_DIR, server.REPORTS_FILE, server.REPORTS_DIR = d, d / "reports.jsonl", d / "reports"
        self.now = [1_790_000_000.0]
        self.sent: list[str] = []
        self.env = {"ADMIN_PASSWORD_HASH": HASH}
        server.ADMIN = admin.AdminApi(data_dir=lambda: server.DATA_DIR, reports_file=lambda: server.REPORTS_FILE,
                                      reports_dir=lambda: server.REPORTS_DIR, seed=lambda: SHOWCASE,
                                      telegram=self.sent.append, env=self.env, clock=lambda: self.now[0])
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        self.api.shutdown()
        self.api.server_close()
        for k, v in self.saved.items():
            setattr(server, k, v)
        self.tmp.cleanup()

    def req(self, method: str, path: str, body=None, ip: str = "198.51.100.7", cookie: str | None = None,
            csrf: str | None = None, headers: dict | None = None) -> tuple[int, dict, bytes]:
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=20)
        h = {"X-Forwarded-For": ip, **(headers or {})}
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
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

    def login(self, password: str = PASSWORD, ip: str = "198.51.100.7") -> tuple[int, str | None, str | None, dict]:
        st, h, b = self.req("POST", "/api/admin/login", {"password": password}, ip=ip)
        sc = h.get("set-cookie")
        cookie = sc.split(";")[0] if sc else None
        return st, cookie, (json.loads(b).get("csrf") if st == 200 else None), h

    def state(self, cookie: str) -> dict:
        st, _, b = self.req("GET", "/api/admin/catalog", cookie=cookie)
        self.assertEqual(st, 200)
        return json.loads(b)

    def public(self) -> dict:
        st, _, b = self.req("GET", "/api/catalog")
        self.assertEqual(st, 200)
        return json.loads(b)


class Auth(AdminApi):
    def test_disabled_without_the_hash(self):
        for value in (None, "", "scrypt$16384$8$1$abc$def", "scrypt:1024:64:1:" + "A" * 22 + ":" + "B" * 43):  # unset, empty, old separator, over the memory cap
            if value is None:
                self.env.pop("ADMIN_PASSWORD_HASH", None)
            else:
                self.env["ADMIN_PASSWORD_HASH"] = value
            self.assertEqual(self.login()[0], 503, value)
            for m, p in (("GET", "/api/admin/session"), ("GET", "/api/admin/catalog"), ("POST", "/api/admin/catalog/publish")):
                self.assertEqual(self.req(m, p, {} if m == "POST" else None)[0], 503, (value, p))
        # control: with a valid hash the same route asks for a login instead
        self.env["ADMIN_PASSWORD_HASH"] = HASH
        self.assertEqual(self.req("GET", "/api/admin/session")[0], 401)

    def test_wrong_password_refused_right_one_gets_a_strict_cookie(self):
        st, cookie, csrf, h = self.login(PASSWORD + "x")
        self.assertEqual((st, cookie, csrf), (401, None, None))
        self.assertEqual(self.login("")[0], 400)
        # control: the right password
        st, cookie, csrf, h = self.login()
        self.assertEqual(st, 200)
        sc = h["set-cookie"]
        for attr in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/admin", "Max-Age=43200"):
            self.assertIn(attr, sc)
        self.assertTrue(cookie.startswith("gsfpv_admin=") and len(cookie) > 40 and csrf and len(csrf) > 40)
        self.assertEqual(self.req("GET", "/api/admin/session", cookie=cookie)[0], 200)

    def test_lockout_after_five_and_exponential(self):
        for _ in range(5):
            self.assertEqual(self.login("nope-nope", ip="203.0.113.1")[0], 401)
        st, _, _, h = self.login(ip="203.0.113.1")  # even the right password is not looked at now
        self.assertEqual(st, 429)
        self.assertEqual(h["retry-after"], "900")
        # control: another address may still log in
        self.assertEqual(self.login(ip="203.0.113.2")[0], 200)
        self.now[0] += 901
        self.assertEqual(self.login("nope-nope", ip="203.0.113.1")[0], 401)  # free again, then a second lock
        for _ in range(4):
            self.login("nope-nope", ip="203.0.113.1")
        self.assertEqual(self.login(ip="203.0.113.1")[3]["retry-after"], "1800")  # doubled
        self.now[0] += 1801
        self.assertEqual(self.login(ip="203.0.113.1")[0], 200)
        audit = (self.data / "admin-audit.jsonl").read_text(encoding="utf-8")
        self.assertEqual(audit.count('"action": "lockout-ip"'), 2)

    def test_global_ceiling_refuses_everyone_and_alerts_once(self):
        for i in range(29):
            self.assertEqual(self.login("nope-nope", ip=f"192.0.2.{i}")[0], 401)
        # control: one below the ceiling a fresh address still gets in
        self.assertEqual(self.login(ip="192.0.2.200")[0], 200)
        self.assertEqual(self.login("nope-nope", ip="192.0.2.99")[0], 401)  # the 30th failure
        st, _, _, h = self.login(ip="192.0.2.201")
        self.assertEqual((st, h["retry-after"]), (429, "3600"))
        self.assertEqual(len(self.sent), 1)
        self.assertIn("[ALERT]", self.sent[0])
        self.assertNotIn(PASSWORD, self.sent[0])
        self.now[0] += 3601
        self.assertEqual(self.login(ip="192.0.2.201")[0], 200)
        self.assertEqual(len(self.sent), 1)

    def test_no_session_is_401_on_every_endpoint(self):
        routes = [("GET", "/api/admin/session"), ("GET", "/api/admin/catalog"), ("GET", "/api/admin/reports"),
                  ("GET", "/api/admin/reports/R-20261002-0001/diagnostics"), ("GET", "/api/admin/nothing"),
                  ("POST", "/api/admin/catalog/draft"), ("POST", "/api/admin/catalog/publish"), ("POST", "/api/admin/catalog/discard"),
                  ("POST", "/api/admin/catalog/restore"), ("POST", "/api/admin/reports/status"), ("POST", "/api/admin/logout")]  # logout last
        for m, p in routes:
            self.assertEqual(self.req(m, p, {} if m == "POST" else None)[0], 401, p)
            self.assertEqual(self.req(m, p, {} if m == "POST" else None, cookie="gsfpv_admin=forged-" + "a" * 40)[0], 401, p)
        # control: a real session gets past the door on the same routes
        _, cookie, csrf, _ = self.login()
        for m, p in routes:
            self.assertNotIn(self.req(m, p, {} if m == "POST" else None, cookie=cookie, csrf=csrf)[0], (401, 403, 503), p)

    def test_session_expires_after_12h_and_logout_ends_it(self):
        _, cookie, csrf, _ = self.login()
        self.now[0] += 12 * 3600 - 5
        self.assertEqual(self.req("GET", "/api/admin/session", cookie=cookie)[0], 200)  # control
        self.now[0] += 10
        self.assertEqual(self.req("GET", "/api/admin/session", cookie=cookie)[0], 401)
        _, cookie, csrf, _ = self.login()
        st, h, _ = self.req("POST", "/api/admin/logout", {}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        self.assertIn("Max-Age=0", h["set-cookie"])
        self.assertEqual(self.req("GET", "/api/admin/session", cookie=cookie)[0], 401)

    def test_csrf_missing_or_wrong_is_403(self):
        _, cookie, csrf, _ = self.login()
        before = self.state(cookie)["draft"]
        moved = {"collections": [], "scenes": list(reversed(before["scenes"]))}
        self.assertEqual(self.req("POST", "/api/admin/catalog/draft", {"catalog": moved}, cookie=cookie)[0], 403)
        self.assertEqual(self.req("POST", "/api/admin/catalog/draft", {"catalog": moved}, cookie=cookie, csrf=csrf[:-1] + "A")[0], 403)
        self.assertEqual(self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf="")[0], 403)
        self.assertEqual(self.state(cookie)["draft"], before)  # nothing changed
        # control: the right token
        self.assertEqual(self.req("POST", "/api/admin/catalog/draft", {"catalog": moved}, cookie=cookie, csrf=csrf)[0], 200)
        self.assertNotEqual(self.state(cookie)["draft"], before)

    def test_audit_lines_and_the_password_is_nowhere(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.login(PASSWORD + "-wrong")
            _, cookie, csrf, _ = self.login()
            self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf=csrf)
            self.req("POST", "/api/admin/logout", {}, cookie=cookie, csrf=csrf)
        lines = [json.loads(x) for x in (self.data / "admin-audit.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(x["action"], x["ok"]) for x in lines], [("login", False), ("login", True), ("publish", True), ("logout", True)])
        for x in lines:
            self.assertEqual(set(x) - {"detail"}, {"ts", "ip", "action", "ok"})
            self.assertRegex(x["ip"], r"^[0-9a-f]{16}$")
            self.assertNotIn("198.51.100.7", json.dumps(x))
        texts = {"stdout": out.getvalue(), "stderr": err.getvalue()}
        texts.update({str(f): f.read_text(encoding="utf-8", errors="replace") for f in self.data.rglob("*") if f.is_file()})
        self.assertTrue(any("/api/admin/login" in t for t in texts.values()))  # control: the request log was captured
        sid = cookie.split("=", 1)[1]
        for where, t in texts.items():
            for secret in (PASSWORD, sid, csrf):
                self.assertNotIn(secret, t, where)


class Catalogue(AdminApi):
    def test_seeded_from_showcase_once(self):
        seed = json.loads(SHOWCASE.read_text(encoding="utf-8"))["scenes"]
        pub = self.public()
        self.assertEqual([s["id"] for s in pub["scenes"]], [s["id"] for s in seed])
        self.assertEqual(pub["scenes"][0]["title"], seed[0]["title"])
        self.assertEqual(pub["scenes"][0]["walls"], seed[0].get("walls", "on"))
        self.assertTrue((self.data / "catalog.json").exists())
        # control: once written, the seed is not read again
        server.ADMIN.catalog.seed = lambda: None
        self.assertEqual(len(self.public()["scenes"]), len(seed))
        # no seed and nothing live: 404, the picker keeps its static list
        (self.data / "catalog.json").unlink()
        self.assertEqual(self.req("GET", "/api/catalog")[0], 404)

    def test_draft_changes_nothing_until_publish_then_restore(self):
        _, cookie, csrf, _ = self.login()
        live0 = self.public()
        d = self.state(cookie)["draft"]
        a, b, c = d["scenes"]
        b = {**b, "pinned": True, "pitch": {"en": "Fly the old town", "ru": "Old town in Russian"}, "collections": ["cities"]}
        draft = {"collections": [{"id": "cities", "title": {"en": "Cities"}}], "scenes": [b, c, a]}
        st, _, body = self.req("POST", "/api/admin/catalog/draft", {"catalog": draft}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        self.assertTrue(json.loads(body)["dirty"])
        self.assertEqual(self.public(), live0)  # control: the draft is not live
        st, _, body = self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        v1 = json.loads(body)["version"]
        live1 = self.public()
        self.assertEqual([s["id"] for s in live1["scenes"]], [b["id"], c["id"], a["id"]])
        self.assertTrue(live1["scenes"][0]["pinned"])
        self.assertEqual(live1["collections"], [{"id": "cities", "title": {"en": "Cities"}}])
        st_ = self.state(cookie)
        self.assertFalse(st_["dirty"])
        self.assertEqual([h["name"] for h in st_["history"]], [v1])
        # hide one and publish again: gone from the public list, still in the admin's
        hidden = {**draft, "scenes": [{**b, "hidden": True}, c, a]}
        self.req("POST", "/api/admin/catalog/draft", {"catalog": hidden}, cookie=cookie, csrf=csrf)
        self.now[0] += 1
        self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf=csrf)
        self.assertEqual([s["id"] for s in self.public()["scenes"]], [c["id"], a["id"]])
        self.assertTrue(self.state(cookie)["published"]["scenes"][0]["hidden"])
        # restore v1: live again, and the restore is itself a version (undoable)
        self.now[0] += 1
        st, _, body = self.req("POST", "/api/admin/catalog/restore", {"name": v1}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        self.assertEqual([s["id"] for s in self.public()["scenes"]], [b["id"], c["id"], a["id"]])
        self.assertEqual(len(self.state(cookie)["history"]), 3)
        self.assertEqual(self.req("POST", "/api/admin/catalog/restore", {"name": "20990101T000000Z"}, cookie=cookie, csrf=csrf)[0], 404)
        self.assertEqual(self.req("POST", "/api/admin/catalog/restore", {"name": "../catalog"}, cookie=cookie, csrf=csrf)[0], 400)
        # discard: the draft goes back to what is live
        self.req("POST", "/api/admin/catalog/draft", {"catalog": {"collections": [], "scenes": [a]}}, cookie=cookie, csrf=csrf)
        self.assertTrue(self.state(cookie)["dirty"])
        self.req("POST", "/api/admin/catalog/discard", {}, cookie=cookie, csrf=csrf)
        self.assertFalse(self.state(cookie)["dirty"])

    def test_etag_304(self):
        st, h, body = self.req("GET", "/api/catalog")
        self.assertEqual(st, 200)
        etag = h["etag"]
        self.assertIn("max-age=60", h["cache-control"])
        st, h2, body2 = self.req("GET", "/api/catalog", headers={"If-None-Match": etag})
        self.assertEqual((st, body2), (304, b""))
        # control: a different tag, and the tag after a publish, get the body
        self.assertEqual(self.req("GET", "/api/catalog", headers={"If-None-Match": '"0000"'})[0], 200)
        _, cookie, csrf, _ = self.login()
        d = self.state(cookie)["draft"]
        self.req("POST", "/api/admin/catalog/draft", {"catalog": {**d, "scenes": d["scenes"][::-1]}}, cookie=cookie, csrf=csrf)
        self.req("POST", "/api/admin/catalog/publish", {}, cookie=cookie, csrf=csrf)
        st, h3, _ = self.req("GET", "/api/catalog", headers={"If-None-Match": etag})
        self.assertEqual(st, 200)
        self.assertNotEqual(h3["etag"], etag)

    def test_validation(self):
        _, cookie, csrf, _ = self.login()
        ok = {"id": "39e63ce9", "title": "A"}
        bad = [{"scenes": [ok, ok]}, {"scenes": [{"id": "../x", "title": "A"}]}, {"scenes": [{"id": "39e63ce9"}]},
               {"scenes": [ok], "collections": [{"id": "Bad Slug", "title": {"en": "x"}}]}, {"scenes": "no"}, None]
        for doc in bad:
            self.assertEqual(self.req("POST", "/api/admin/catalog/draft", {"catalog": doc}, cookie=cookie, csrf=csrf)[0], 400, doc)
        # control: the same entry once, with junk fields dropped and values clamped to their ranges
        doc = {"scenes": [{**ok, "evil": "<script>", "scale": 9, "dropFloaters": 12, "walls": "off", "collections": ["nope"],
                           "title": "A‮\x00 b", "thumb": "https://evil.example/x.webp"}]}
        st, _, body = self.req("POST", "/api/admin/catalog/draft", {"catalog": doc}, cookie=cookie, csrf=csrf)
        self.assertEqual(st, 200)
        s = json.loads(body)["draft"]["scenes"][0]
        self.assertEqual((s["title"], s["walls"], s["dropFloaters"], s["collections"]), ("A b", "off", 12, []))
        for k in ("evil", "scale", "thumb"):
            self.assertNotIn(k, s)
        self.assertEqual(self.req("POST", "/api/admin/catalog/draft", b"x" * 10, cookie=cookie, csrf=csrf)[0], 400)


class ReportsTab(AdminApi):
    def setUp(self):
        super().setUp()
        recs = [{"id": "R-20261001-0001", "ts": "2026-10-01T10:00:00Z", "kind": "bug", "page": "fly", "scene": "39e63ce9",
                 "message": "it crashed", "contact": "a@b.cd", "diagnostics": True},
                {"id": "R-20261002-0001", "ts": "2026-10-02T10:00:00Z", "kind": "idea", "page": "site", "scene": "",
                 "message": "more scenes", "contact": "", "diagnostics": False}]
        server.REPORTS_FILE.write_text("".join(json.dumps(r) + "\n" for r in recs), encoding="utf-8")
        server.REPORTS_DIR.mkdir()
        (server.REPORTS_DIR / "R-20261001-0001.json").write_text('{"diagnostics": {"gpu": "x"}}', encoding="utf-8")

    def test_list_status_and_diagnostics(self):
        _, cookie, csrf, _ = self.login()
        st, _, body = self.req("GET", "/api/admin/reports", cookie=cookie)
        rows = json.loads(body)["reports"]
        self.assertEqual([(r["id"], r["status"]) for r in rows], [("R-20261002-0001", "open"), ("R-20261001-0001", "open")])
        self.assertEqual(self.req("POST", "/api/admin/reports/status", {"id": "R-20261001-0001", "status": "closed"}, cookie=cookie, csrf=csrf)[0], 200)
        rows = json.loads(self.req("GET", "/api/admin/reports", cookie=cookie)[2])["reports"]
        self.assertEqual(rows[1]["status"], "closed")
        self.assertEqual(rows[0]["status"], "open")  # control: the other one is untouched
        self.assertIn("R-20261001-0001", json.loads((self.data / "report-status.json").read_text(encoding="utf-8")))
        before = server.REPORTS_FILE.read_text(encoding="utf-8")
        for b in ({"id": "R-20990101-0001", "status": "closed"}, {"id": "R-20261001-0001", "status": "deleted"}, {"id": "../x", "status": "open"}):
            self.assertEqual(self.req("POST", "/api/admin/reports/status", b, cookie=cookie, csrf=csrf)[0], 400, b)
        self.assertEqual(server.REPORTS_FILE.read_text(encoding="utf-8"), before)  # visitors' words never change
        st, h, blob = self.req("GET", "/api/admin/reports/R-20261001-0001/diagnostics", cookie=cookie)
        self.assertEqual((st, json.loads(blob)["diagnostics"]["gpu"]), (200, "x"))
        self.assertEqual(h["cache-control"], "no-store")
        self.assertEqual(self.req("GET", "/api/admin/reports/R-20261002-0001/diagnostics", cookie=cookie)[0], 404)


class HashTool(unittest.TestCase):
    def test_cli_prints_only_the_hash_line(self):
        pw = "t3st-" + secrets.token_urlsafe(8)
        r = subprocess.run([sys.executable, str(REPO / "tools" / "admin" / "hash_password.py"), "--stdin"], input=pw + "\n",
                           capture_output=True, text=True, check=True)
        lines = r.stdout.strip().splitlines()
        self.assertEqual(len(lines), 1)
        key, _, value = lines[0].partition("=")
        self.assertEqual(key, "ADMIN_PASSWORD_HASH")
        self.assertNotIn(pw, r.stdout + r.stderr)
        parsed = admin.parse_hash(value)
        self.assertIsNotNone(parsed)
        self.assertTrue(admin.check_password(pw, parsed))
        self.assertFalse(admin.check_password(pw + "x", parsed))  # control
        self.assertNotEqual(value, admin.make_hash(pw))  # a fresh salt each time


if __name__ == "__main__":
    unittest.main()
