"""Routes other modules add to the admin (AdminApi.add_route; server.py wires SuperSplat's facts, place search
and the prevailing wind): they sit behind the same session and CSRF check and get the query string.
No network: the handlers are fakes. Every check has a negative control that must fire."""
from __future__ import annotations

import json
import secrets
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import admin  # noqa: E402
import server  # noqa: E402

PASSWORD = "t3st-" + secrets.token_urlsafe(12)
HASH = admin.make_hash(PASSWORD)


class Headers(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class ExtraRoutes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.api = admin.AdminApi(data_dir=lambda: d, reports_file=lambda: d / "r.jsonl", reports_dir=lambda: d / "r",
                                  seed=lambda: None, telegram=lambda t: None, env={"ADMIN_PASSWORD_HASH": HASH})
        self.seen: list[tuple[str, str]] = []
        self.api.add_route("GET", r"geo/search", lambda m, qs, body, client: self._answer("geo", qs))
        self.api.add_route("POST", r"thing/([a-z]+)", lambda m, qs, body, client: self._answer(m.group(1), qs))
        st, body, hdrs = self.api.handle("POST", "/api/admin/login", Headers(), lambda n: json.dumps({"password": PASSWORD}).encode(), "1.2.3.4")
        self.assertEqual(st, 200)
        self.cookie = dict(hdrs)["Set-Cookie"].split(";")[0]
        self.csrf = json.loads(body)["csrf"]

    def tearDown(self):
        self.tmp.cleanup()

    def _answer(self, what: str, qs: str):
        self.seen.append((what, qs))
        return 200, b'{"ok": true}', [("Content-Type", "application/json")]

    def test_session_and_query(self):
        st, _b, _h = self.api.handle("GET", "/api/admin/geo/search", Headers({"Cookie": self.cookie}), lambda n: b"", "1.2.3.4", "q=wroclaw&lang=pl")
        self.assertEqual(st, 200)
        self.assertEqual(self.seen, [("geo", "q=wroclaw&lang=pl")])
        # without the session the handler never runs
        st, _b, _h = self.api.handle("GET", "/api/admin/geo/search", Headers(), lambda n: b"", "1.2.3.4", "q=x")
        self.assertEqual(st, 401)
        self.assertEqual(len(self.seen), 1)

    def test_post_needs_csrf(self):
        st, _b, _h = self.api.handle("POST", "/api/admin/thing/abc", Headers({"Cookie": self.cookie}), lambda n: b"{}", "1.2.3.4")
        self.assertEqual(st, 403)
        self.assertEqual(self.seen, [])
        # control: with the token it runs, and the path's group reaches the handler
        st, _b, _h = self.api.handle("POST", "/api/admin/thing/abc", Headers({"Cookie": self.cookie, "X-CSRF": self.csrf}), lambda n: b"{}", "1.2.3.4")
        self.assertEqual((st, self.seen), (200, [("abc", "")]))

    def test_server_wires_the_v07_routes(self):
        routes = {p.pattern for _m, p, _f in server.ADMIN._extra}
        self.assertEqual(routes, {r"superspl/([0-9a-f]{6,32})", r"geo/search", r"wind/climate"})
        # control: an unknown admin path still falls through to the built-in 404
        st, _b, _h = self.api.handle("GET", "/api/admin/nothing", Headers({"Cookie": self.cookie}), lambda n: b"", "1.2.3.4")
        self.assertEqual(st, 404)


if __name__ == "__main__":
    unittest.main()
