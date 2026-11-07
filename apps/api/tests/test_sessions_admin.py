"""Tests of the owner's Sessions tab routes (apps/api/sessions_admin.py), v0.12 step 9: the list, the streamed download, a resend per channel and
the deletion on request, all behind the admin's session and CSRF check. Run against the real AdminApi with a TEST password made here and the real
store on a temporary directory; the live admin is never touched. A fake Telegram and a fake SMTP server stand in for the outside (fakes_sessions.Rig).

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only). Every claim has a control: a refusal is paired with the same call done
right, and the streamed download is measured next to a body that is not streamed.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import secrets
import sys
import threading
import tracemalloc
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import admin  # noqa: E402
import server  # noqa: E402
import sessions_admin  # noqa: E402
from fakes_sessions import MIB, Rig, package, sha  # noqa: E402
from sessions import SessionStore  # noqa: E402

PASSWORD = "t3st-" + secrets.token_urlsafe(12)
HASH = admin.make_hash(PASSWORD)
SECRET_NICK = "SecretNick-" + secrets.token_hex(4)


class Headers(dict):
    def get(self, k, default=None):
        return super().get(k, default)


class Admin(unittest.TestCase):
    def setUp(self):
        self.rig = Rig(self)
        d = self.rig.dir
        self.api = admin.AdminApi(data_dir=lambda: d, reports_dir=lambda: d / "r", seed=lambda: None, telegram=lambda t: None, env={"ADMIN_PASSWORD_HASH": HASH})
        sessions_admin.SessionsAdmin(lambda: self.rig.store, self.api.audit, lambda: {"telegram": {"configured": True, "maxBytes": 1}, "email": {"configured": True, "maxBytes": 2}}).register(self.api)
        st, body, hdrs = self.api.handle("POST", "/api/admin/login", Headers(), lambda n: json.dumps({"password": PASSWORD}).encode(), "1.2.3.4")
        self.assertEqual(st, 200)
        self.cookie = dict(hdrs)["Set-Cookie"].split(";")[0]
        self.csrf = json.loads(body)["csrf"]

    def call(self, method: str, path: str, body: dict | bytes | None = None, *, cookie: bool = True, csrf: bool = True, raw_qs: str = ""):
        h = Headers({**({"Cookie": self.cookie} if cookie else {}), **({"X-CSRF": self.csrf} if csrf and method == "POST" else {})})
        data = body if isinstance(body, bytes) else json.dumps(body if body is not None else {}).encode()
        return self.api.handle(method, f"/api/admin/{path}", h, lambda n: data, "1.2.3.4", raw_qs)

    def stored(self, **kw) -> str:
        return self.rig.stored(package(**kw))

    def audit(self) -> list[dict]:
        p = self.rig.dir / "admin-audit.jsonl"
        return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


class Door(Admin):
    def test_every_route_needs_the_session_and_posts_need_the_csrf_token_and_nothing_changes_without_them(self):
        sid = self.stored(filler=2000)
        self.rig.delivery.run_once()
        before = json.dumps(self.rig.store.list(), sort_keys=True)
        calls = [("GET", "sessions", None), ("GET", f"sessions/{sid}/package", None), ("POST", f"sessions/{sid}/resend", {"channel": "telegram"}), ("POST", f"sessions/{sid}/delete", {"confirm": True})]
        for method, path, body in calls:
            self.assertEqual(self.call(method, path, body, cookie=False)[0], 401, path)
            if method == "POST":
                self.assertEqual(self.call(method, path, body, csrf=False)[0], 403, path)
        self.assertEqual(json.dumps(self.rig.store.list(), sort_keys=True), before)       # not one of the refused calls changed anything
        self.assertTrue(self.rig.store.package_path(sid).exists())
        # control: the same calls with the session and the token are answered
        self.assertEqual(self.call("GET", "sessions")[0], 200)
        self.assertEqual(self.call("POST", f"sessions/{sid}/resend", {"channel": "telegram"})[0], 200)

    def test_the_server_wires_the_four_routes(self):
        routes = {(m, p.pattern) for m, p, _f in server.ADMIN._extra}
        for m, p in (("GET", r"sessions"), ("GET", r"sessions/(S-[0-9]{8}-[0-9a-f]{12})/package"), ("POST", r"sessions/(S-[0-9]{8}-[0-9a-f]{12})/resend"), ("POST", r"sessions/(S-[0-9]{8}-[0-9a-f]{12})/delete")):
            self.assertIn((m, p), routes)
        # control: a path that is not one of them falls through to the built-in 404
        self.assertEqual(self.call("GET", "sessions/not-an-id/package")[0], 404)
        self.assertEqual(self.call("GET", "sessions/S-20261107-000000000000/zip")[0], 404)


class Listing(Admin):
    def test_the_list_is_newest_first_with_each_channel_and_only_what_the_owner_needs(self):
        a = self.rig.stored(package(filler=1500, manifest_over={"pilot": {"id": "pilotpilotpilot01", "nickname": SECRET_NICK}}))
        self.rig.clock[0] += 60
        b = self.stored(filler=900, consent={"minor": True, "guardianConfirmed": True})
        self.rig.delivery.run_once()
        self.rig.store.update(b, lambda m: m["channels"].__setitem__("email", {**m["channels"]["email"], "status": "failed", "error": "smtp-535", "failures": 9}))
        st, body, hdrs = self.call("GET", "sessions")
        self.assertEqual(st, 200)
        doc = json.loads(body)
        self.assertEqual([r["id"] for r in doc["sessions"]], [b, a])
        rowa, rowb = doc["sessions"][1], doc["sessions"][0]
        self.assertTrue(rowa["delivered"])
        self.assertFalse(rowb["delivered"])
        self.assertEqual({k: v["status"] for k, v in rowb["channels"].items()}, {"telegram": "sent", "email": "failed"})
        self.assertEqual(rowb["channels"]["email"]["error"], "smtp-535")
        self.assertEqual(doc["totals"], {"stored": 2, "delivered": 1, "failed": 1, "waiting": 1, "bytes": rowa["bytes"] + rowb["bytes"]})
        self.assertEqual(rowb["summary"]["minor"], True)
        self.assertEqual(rowb["summary"]["guardianConfirmed"], True)
        self.assertEqual(doc["config"]["telegram"]["configured"], True)
        self.assertIn(("Cache-Control", "no-store"), hdrs)
        # what must NOT be in it: no upload token or its hash, no nickname, no device
        text = body.decode("utf-8")
        for secret in (SECRET_NICK, "tokenSha256", "token", "userAgent", "vitest", "device"):
            self.assertNotIn(secret, text, secret)
        # control: the nickname IS in the package itself (so the check above could have failed)
        import io
        import zipfile
        manifest = json.loads(zipfile.ZipFile(io.BytesIO(self.rig.store.package_path(a).read_bytes())).read("manifest.json"))
        self.assertEqual(manifest["pilot"]["nickname"], SECRET_NICK)

    def test_an_upload_in_progress_and_an_empty_store_are_not_listed_as_recordings(self):
        self.assertEqual(json.loads(self.call("GET", "sessions")[1])["sessions"], [])
        data = package(filler=3 * MIB)
        s = self.rig.store.start("203.0.113.5", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.assertEqual(json.loads(self.call("GET", "sessions")[1])["totals"]["stored"], 0)
        self.assertEqual(self.call("GET", f"sessions/{s['id']}/package")[0], 404)         # nothing to download of a half upload


class Download(Admin):
    def test_the_package_is_an_attachment_streamed_from_disk_and_every_download_is_audited(self):
        data = package(filler=300_000)
        sid = self.rig.stored(data)
        st, body, hdrs = self.call("GET", f"sessions/{sid}/package")
        self.assertEqual(st, 200)
        self.assertIsInstance(body, admin.FileBody)
        self.assertEqual((body.path, body.size), (self.rig.store.package_path(sid), len(data)))
        h = dict(hdrs)
        self.assertEqual(h["Content-Type"], "application/zip")
        self.assertEqual(h["Content-Disposition"], f'attachment; filename="fly-by-sound-{sid}.zip"')
        self.assertEqual((h["Cache-Control"], h["X-Content-Type-Options"]), ("no-store", "nosniff"))
        self.assertEqual(hashlib.sha256(body.path.read_bytes()).hexdigest(), sha(data))
        log = [r for r in self.audit() if r["action"] == "sessions.download"]
        self.assertEqual([(r["ok"], r["detail"]) for r in log], [(True, sid)])

    def test_nothing_unknown_or_unfinished_is_served(self):
        self.assertEqual(self.call("GET", "sessions/S-20261107-000000000000/package")[0], 404)
        data = package(filler=2000)
        s = self.rig.store.start("203.0.113.5", {"size": len(data), "sha256": sha(data), "consentSend": True})
        self.assertEqual(self.call("GET", f"sessions/{s['id']}/package")[0], 404)
        # the window of a finish cut off after the rename: the package file is in place but the record still says uploading, so it is not yet
        # a stored recording (nothing is queued for it): not served
        cut = self.rig.store.start("203.0.113.6", {"size": len(data), "sha256": sha(data), "consentSend": True})
        (self.rig.store.dir(cut["id"]) / "package.zip").write_bytes(data)
        st, body, _h = self.call("GET", f"sessions/{cut['id']}/package")
        self.assertEqual((st, json.loads(body)["reason"]), (404, "not-stored"))
        # a stored one whose file is gone is a 404, not a crash
        sid = self.stored(filler=2500)
        self.rig.store.package_path(sid).unlink()
        self.assertEqual(self.call("GET", f"sessions/{sid}/package")[0], 404)
        self.assertEqual([r["action"] for r in self.audit() if r["action"] == "sessions.download"], [])   # none of these was a download

    def test_over_a_real_socket_a_20_mib_package_arrives_whole_and_the_server_holds_about_a_block_not_the_file(self):
        data = package(filler=20 * MIB)
        sid = self.rig.stored(data)
        with mock.patch.object(server, "ADMIN", self.api):
            api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            threading.Thread(target=api.serve_forever, daemon=True).start()
            self.addCleanup(lambda: (api.shutdown(), api.server_close()))

            def fetch(path: str) -> tuple[int, dict, str, int]:
                """Reads the body in 64 KB blocks and keeps none of it: the SHA-256 and the length are what is returned."""
                c = http.client.HTTPConnection("127.0.0.1", api.server_address[1], timeout=30)
                c.request("GET", path, headers={"Cookie": self.cookie, "X-Forwarded-For": "203.0.113.8"})
                r = c.getresponse()
                h, n = hashlib.sha256(), 0
                while True:
                    block = r.read(65536)
                    if not block:
                        break
                    h.update(block)
                    n += len(block)
                hdrs = dict(r.getheaders())
                c.close()
                return r.status, hdrs, h.hexdigest(), n

            # a test-only route that is NOT streamed: the whole file as bytes, the way every other admin route answers
            self.api.add_route("GET", r"blob", lambda m, qs, body, client: (200, self.rig.store.package_path(sid).read_bytes(), [("Content-Type", "application/zip")]))
            tracemalloc.start()
            try:
                tracemalloc.reset_peak()
                status, hdrs, digest, n = fetch(f"/api/admin/sessions/{sid}/package")
                streamed_peak = tracemalloc.get_traced_memory()[1]
                tracemalloc.reset_peak()
                status2, _h2, digest2, n2 = fetch("/api/admin/blob")
                naive_peak = tracemalloc.get_traced_memory()[1]
            finally:
                tracemalloc.stop()
        self.assertEqual((status, n, digest), (200, len(data), sha(data)))
        self.assertEqual(int(hdrs["Content-Length"]), len(data))
        self.assertEqual(hdrs["Content-Disposition"], f'attachment; filename="fly-by-sound-{sid}.zip"')
        self.assertEqual((status2, n2, digest2), (200, len(data), sha(data)))
        self.assertLess(streamed_peak, 2 * MIB, f"streamed peak {streamed_peak}")
        self.assertGreater(naive_peak, 20 * MIB, f"naive peak {naive_peak}")                  # control: the same measurement sees a body held in memory
        print("MEASURED", {"package_mib": round(len(data) / MIB, 2), "streamed_peak_mib": round(streamed_peak / MIB, 2), "naive_peak_mib": round(naive_peak / MIB, 2)})


class Resend(Admin):
    def test_one_channel_goes_back_to_queued_with_its_failures_cleared_the_other_is_untouched_and_the_worker_sends_it_again(self):
        sid = self.stored(filler=5000)
        self.rig.delivery.run_once()
        self.assertEqual(len(self.rig.tg.of("sendDocument")), 1)
        self.rig.store.update(sid, lambda m: m["channels"].__setitem__("telegram", {**m["channels"]["telegram"], "status": "failed", "failures": 9, "error": "network"}))
        mail_before = dict(self.rig.store.get(sid)["channels"]["email"])
        self.rig.delivery.workers[0]._wake.clear()
        st, body, _h = self.call("POST", f"sessions/{sid}/resend", {"channel": "telegram"})
        self.assertEqual(st, 200)
        doc = json.loads(body)
        self.assertEqual(doc["channels"]["telegram"]["status"], "queued")
        self.assertFalse(doc["delivered"])
        meta = self.rig.store.get(sid)
        self.assertEqual((meta["channels"]["telegram"]["failures"], meta["channels"]["telegram"]["error"]), (0, ""))
        self.assertEqual(meta["channels"]["email"], mail_before)                                  # e-mail was not touched
        self.assertTrue(self.rig.delivery.workers[0]._wake.is_set())                             # the Telegram worker was woken
        self.rig.delivery.run_once()
        self.assertEqual(len(self.rig.tg.of("sendDocument")), 2)                                 # the file went again
        self.assertEqual(len(self.rig.smtp.messages), 1)                                          # and e-mail was not sent a second time
        self.assertEqual(self.rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual([(r["ok"], r["detail"]) for r in self.audit() if r["action"] == "sessions.resend"], [(True, f"{sid} telegram")])

    def test_refusals_change_nothing_and_each_is_audited_as_failed(self):
        sid = self.stored(filler=3000)
        self.rig.delivery.run_once()
        before = json.dumps(self.rig.store.get(sid)["channels"], sort_keys=True)
        for body, status, reason in (({"channel": "fax"}, 400, "bad-channel"), ({}, 400, "bad-channel"), ({"channel": 7}, 400, "bad-channel")):
            st, b, _h = self.call("POST", f"sessions/{sid}/resend", body)
            self.assertEqual((st, json.loads(b)["reason"]), (status, reason))
        self.assertEqual(self.call("POST", f"sessions/{sid}/resend", b"not json")[0], 400)
        st, b, _h = self.call("POST", "sessions/S-20261107-000000000000/resend", {"channel": "email"})
        self.assertEqual((st, json.loads(b)["reason"]), (404, "unknown"))
        data = package(filler=2000)
        half = self.rig.store.start("203.0.113.5", {"size": len(data), "sha256": sha(data), "consentSend": True})
        st, b, _h = self.call("POST", f"sessions/{half['id']}/resend", {"channel": "email"})
        self.assertEqual((st, json.loads(b)["reason"]), (409, "not-stored"))
        self.assertEqual(json.dumps(self.rig.store.get(sid)["channels"], sort_keys=True), before)
        # each refusal that got as far as the store is in the audit log as a failure, with its code (a body that is not JSON is refused before it)
        failed = [(r["ok"], r["detail"].split(" ", 1)[1]) for r in self.audit() if r["action"] == "sessions.resend"]
        self.assertEqual(failed, [(False, "bad-channel")] * 3 + [(False, "unknown"), (False, "not-stored")])
        # control: the same call with a real channel works
        self.assertEqual(self.call("POST", f"sessions/{sid}/resend", {"channel": "email"})[0], 200)


class Delete(Admin):
    def test_deletion_needs_the_confirmation_removes_the_package_and_leaves_a_tombstone_and_the_others(self):
        keep = self.stored(filler=2000)
        gone = self.rig.stored(package(filler=2600))
        self.rig.delivery.run_once()
        for body in ({}, {"confirm": False}, {"confirm": "yes"}, {"confirm": 1}):
            self.assertEqual(self.call("POST", f"sessions/{gone}/delete", body)[0], 400, body)
        self.assertEqual(self.call("POST", f"sessions/{gone}/delete", b"junk")[0], 400)
        self.assertTrue(self.rig.store.package_path(gone).exists())                                # refused: still there
        st, body, _h = self.call("POST", f"sessions/{gone}/delete", {"confirm": True})
        self.assertEqual((st, json.loads(body)), (200, {"ok": True, "id": gone}))
        self.assertFalse(self.rig.store.dir(gone).exists())
        self.assertTrue(self.rig.store.package_path(keep).exists())                                # the other recording is untouched
        self.assertEqual([r["id"] for r in json.loads(self.call("GET", "sessions")[1])["sessions"]], [keep])
        self.assertEqual(self.call("GET", f"sessions/{gone}/package")[0], 404)
        lines = [json.loads(l) for l in (self.rig.store.root / "index.jsonl").read_text(encoding="utf-8").splitlines()]
        tomb = [l for l in lines if l.get("deleted")]
        self.assertEqual([(t["id"], t["reason"]) for t in tomb], [(gone, "request")])
        self.assertNotIn("sha256", tomb[0])                                                         # the tombstone names no content
        # a second deletion finds nothing
        st, body, _h = self.call("POST", f"sessions/{gone}/delete", {"confirm": True})
        self.assertEqual((st, json.loads(body)["reason"]), (404, "unknown"))
        self.assertEqual([(r["ok"], r["detail"]) for r in self.audit() if r["action"] == "sessions.delete"], [(True, gone), (False, f"{gone} unknown")])


class WhatAnAdminRouteAnswersWithAFile(unittest.TestCase):
    def test_a_file_body_is_written_in_blocks_and_a_missing_file_ends_the_connection_short_not_the_server(self):
        import io
        import tempfile

        class Out(io.BytesIO):
            pass

        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "f.bin"
            p.write_bytes(b"x" * 200_000)
            h = server.Handler.__new__(server.Handler)
            wrote: list[int] = []
            h.wfile = mock.Mock(write=lambda b: wrote.append(len(b)))
            h.send_response, h.send_header, h.end_headers = mock.Mock(), mock.Mock(), mock.Mock()
            h.close_connection = False
            server.Handler._send(h, 200, admin.FileBody(p, 200_000), [("Content-Type", "application/zip")])
            self.assertEqual(sum(wrote), 200_000)
            self.assertLessEqual(max(wrote), server.STREAM_BLOCK)
            self.assertGreater(len(wrote), 2)
            h.send_header.assert_any_call("Content-Length", "200000")
            # a file that is gone: the connection is closed short of its length; nothing raises into the server
            wrote.clear()
            h2 = server.Handler.__new__(server.Handler)
            h2.wfile = mock.Mock(write=lambda b: wrote.append(len(b)))
            h2.send_response, h2.send_header, h2.end_headers = mock.Mock(), mock.Mock(), mock.Mock()
            h2.close_connection = False
            server.Handler._send(h2, 200, admin.FileBody(Path(tmp) / "missing.bin", 10), [])
            self.assertTrue(h2.close_connection)
            # control: ordinary bytes still go out whole, as before
            h3 = server.Handler.__new__(server.Handler)
            h3.wfile = mock.Mock(write=lambda b: wrote.append(len(b)))
            h3.send_response, h3.send_header, h3.end_headers = mock.Mock(), mock.Mock(), mock.Mock()
            h3.close_connection = False
            wrote.clear()
            server.Handler._send(h3, 200, b"hello", [])
            self.assertEqual(wrote, [5])
            h3.send_header.assert_any_call("Content-Length", "5")


if __name__ == "__main__":
    unittest.main()
