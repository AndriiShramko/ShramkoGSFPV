"""Tests of bug reports, ideas and share pages (POST /api/report, POST /api/share, GET /s/<id>) in
apps/api/server.py.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only, no network: Telegram is a fake
function, the data directory a temporary one). Every check has a negative control that must fire.
"""
from __future__ import annotations

import base64
import gzip
import http.client
import json
import sys
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


def jpeg(w: int = 1200, h: int = 630) -> bytes:
    """The smallest byte stream jpeg_size() reads as a w x h JPEG: SOI, APP0, SOF0, EOI."""
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0\x00\x11\x08" + h.to_bytes(2, "big") + w.to_bytes(2, "big") + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01"
    return b"\xff\xd8" + app0 + sof0 + b"\x00" * 64 + b"\xff\xd9"


class Meta(HTMLParser):
    """What a link-preview crawler reads: <meta property|name content> and the <title>."""

    def __init__(self):
        super().__init__()
        self.tags: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "meta" and (a.get("property") or a.get("name")) and "content" in a:
            self.tags[a.get("property") or a.get("name")] = a["content"]
        self._in_title = tag == "title"

    def handle_endtag(self, tag):
        self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


class Api(unittest.TestCase):
    """A real HTTP server on a temporary data directory; Telegram recorded, never called."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        self.saved = {k: getattr(server, k) for k in ("DATA_DIR", "REPORTS_FILE", "REPORTS_DIR", "SHARE_DIR", "send_telegram")}
        server.DATA_DIR, server.REPORTS_FILE, server.REPORTS_DIR, server.SHARE_DIR = d, d / "reports.jsonl", d / "reports", d / "share"
        self.sent: list[tuple[str, bool]] = []

        def fake_telegram(text: str):
            # stored before sent: the record must already be on disk when the message goes
            stored = server.REPORTS_FILE.exists() and any(json.loads(x)["id"] in text for x in server.REPORTS_FILE.read_text(encoding="utf-8").splitlines())
            self.sent.append((text, stored))
            return 1

        server.send_telegram = fake_telegram
        for b in (server._rhits, server._shits, server._all_hits):
            b.clear()
        server._guard["tripped"] = False
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        self.api.shutdown()
        self.api.server_close()
        for k, v in self.saved.items():
            setattr(server, k, v)
        self.tmp.cleanup()

    def call(self, method: str, path: str, body: dict | bytes | None = None, ip: str = "203.0.113.5", headers: dict | None = None) -> tuple[int, bytes, dict]:
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=5)
        raw = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
        c.request(method, path, body=raw, headers={"Content-Type": "application/json", "X-Forwarded-For": ip, **(headers or {})})
        r = c.getresponse()
        out = r.read()
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        c.close()
        return r.status, out, hdrs

    def report(self, **over) -> tuple[int, dict]:
        b = {"kind": "bug", "message": "The drone falls through the floor at the stairs", "contact": "@pilot", "locale": "en",
             "page": "fly", "scene": "39e63ce9", "release": "608259b", "t": 9000, "hp": "",
             "diagnosticsConsent": True, "diagnostics": {"release": "608259b", "errors": ["TypeError: x"], "settings": [{"id": "walls", "value": True}]}}
        b.update(over)
        s, raw, _ = self.call("POST", "/api/report", {k: v for k, v in b.items() if v is not None})
        return s, json.loads(raw) if raw else {}

    def records(self) -> list[dict]:
        f = server.REPORTS_FILE
        return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()] if f.exists() else []


class Reports(Api):
    def test_stored_before_telegram(self):
        s, b = self.report()
        self.assertEqual((s, b["ok"], b["diagnostics"]), (200, True, True))
        self.assertRegex(b["id"], r"^R-[0-9]{8}-0001$")
        self.assertEqual(len(self.sent), 1)
        text, stored = self.sent[0]
        self.assertTrue(stored, "the record was not on disk when Telegram was called")
        self.assertIn(b["id"], text)
        self.assertIn("Scene: 39e63ce9", text)
        self.assertIn("Release: 608259b", text)
        self.assertIn("Diagnostics: attached", text)
        self.assertNotIn("TypeError", text)  # no logs in Telegram
        # control: storage that fails sends nothing (the order is store, then send)
        server.REPORTS_FILE = Path(self.tmp.name) / "missing-dir" / "x" / "reports.jsonl"
        s2, _ = self.report()
        self.assertEqual(s2, 500)
        self.assertEqual(len(self.sent), 1)

    def test_ids_count_per_day_and_survive_a_restart(self):
        ids = [self.report()[1]["id"] for _ in range(3)]
        self.assertEqual([i[-4:] for i in ids], ["0001", "0002", "0003"])
        server._seq.update(day="", n=0, file=None)  # a restart forgets the counter
        self.assertTrue(self.report()[1]["id"].endswith("-0004"))

    def test_consent_off_stores_no_diagnostics(self):
        s, b = self.report(diagnosticsConsent=False)
        self.assertEqual((s, b["diagnostics"]), (200, False))
        rec = self.records()[-1]
        self.assertFalse(rec["diagnostics"])
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))
        self.assertNotIn("TypeError", server.REPORTS_FILE.read_text(encoding="utf-8"))
        # an idea never keeps diagnostics, consent or not
        self.assertFalse(self.report(kind="idea")[1]["diagnostics"])
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))
        # control: with consent the same report keeps them, in their own file
        s, b = self.report()
        f = server.REPORTS_DIR / f"{b['id']}.json"
        self.assertTrue(f.exists())
        self.assertEqual(json.loads(f.read_text(encoding="utf-8"))["diagnostics"]["errors"], ["TypeError: x"])
        self.assertNotIn("TypeError", server.REPORTS_FILE.read_text(encoding="utf-8"))

    def test_whitelist_and_bad_input(self):
        self.assertEqual(self.report(kind="spam")[0], 400)
        self.assertEqual(self.report(message="   ")[0], 400)
        self.assertEqual(self.call("POST", "/api/report", b"[1, 2]")[0], 400)
        self.assertEqual(self.call("POST", "/api/report", b"{not json")[0], 400)
        s, b = self.report(scene="../../etc", release="<b>", locale="xx", page="admin", contact="a‮b\x00c")
        self.assertEqual(s, 200)
        rec = self.records()[-1]
        self.assertEqual((rec["scene"], rec["release"], rec["locale"], rec["page"], rec["contact"]), ("", "", "", "", "abc"))
        # control: the clean values are kept
        self.report()
        self.assertEqual(self.records()[-1]["scene"], "39e63ce9")

    def test_size_limits(self):
        # everything but the diagnostics: the size of a lead (8 KB)
        self.assertEqual(self.report(extra="x" * 9000)[0], 413)
        # the body on the wire: 512 KB
        self.assertEqual(self.report(diagnostics={"log": "x" * (600 * 1024)})[0], 413)
        # gzip is accepted, and a body that unpacks past 2 MB is refused (no bomb)
        big = gzip.compress(json.dumps({"kind": "bug", "message": "m", "t": 9000, "diagnosticsConsent": True, "diagnostics": {"log": "0" * (3 * 1024 * 1024)}}).encode())
        self.assertLess(len(big), server.MAX_UPLOAD)
        self.assertEqual(self.call("POST", "/api/report", big, headers={"Content-Encoding": "gzip"})[0], 413)
        self.assertEqual(self.call("POST", "/api/report", b"\x1f\x8bnot gzip", headers={"Content-Encoding": "gzip"})[0], 400)
        self.assertEqual(self.call("POST", "/api/report", b"{}", headers={"Content-Encoding": "br"})[0], 415)
        # controls: 400 KB of diagnostics plain, and 1.5 MB of them gzipped, both pass
        self.assertEqual(self.report(diagnostics={"log": "x" * (400 * 1024)})[0], 200)
        ok = gzip.compress(json.dumps({"kind": "bug", "message": "m", "t": 9000, "diagnosticsConsent": True, "diagnostics": {"log": "0" * (1536 * 1024)}}).encode())
        s, raw, _ = self.call("POST", "/api/report", ok, headers={"Content-Encoding": "gzip"})
        self.assertEqual((s, json.loads(raw)["diagnostics"]), (200, True))

    def test_spam_and_timing(self):
        self.report(hp="http://spam.example")
        self.report(t=800)
        self.assertEqual(len(self.sent), 0)
        self.assertEqual([r["suspect"] for r in self.records()], [True, True])
        self.assertFalse(server.REPORTS_DIR.exists() and any(server.REPORTS_DIR.iterdir()))  # a suspect keeps no diagnostics
        # control: a person's report goes on
        self.report()
        self.assertEqual(len(self.sent), 1)

    def test_rate_limit(self):
        for _ in range(10):
            self.assertEqual(self.report()[0], 200)
        self.assertEqual(self.report()[0], 429)
        # control: another visitor is not limited by the first one
        s, _, _ = self.call("POST", "/api/report", {"kind": "idea", "message": "more scans", "t": 9000}, ip="198.51.100.7")
        self.assertEqual(s, 200)

    def test_disk_guard_keeps_the_record_skips_diagnostics(self):
        server._guard["tripped"] = True
        try:
            s, b = self.report()
        finally:
            server._guard["tripped"] = False
        self.assertEqual((s, b["diagnostics"]), (200, "skipped"))
        self.assertIn("not stored", self.sent[-1][0])
        self.assertEqual(self.report()[1]["diagnostics"], True)  # control


class Share(Api):
    def share(self, **over) -> tuple[int, dict]:
        b = {"image": "data:image/jpeg;base64," + base64.b64encode(jpeg()).decode(), "scene": "39e63ce9",
             "title": 'Old <script>alert(1)</script> "Hall" & Co', "credit": "Old Hall — Andrii Shramko, CC BY 4.0", "locale": "en"}
        b.update(over)
        s, raw, _ = self.call("POST", "/api/share", b)
        return s, json.loads(raw) if raw else {}

    def test_jpeg_size(self):
        self.assertEqual(server.jpeg_size(jpeg()), (1200, 630))
        self.assertEqual(server.jpeg_size(jpeg(1200, 631)), (1200, 631))
        self.assertIsNone(server.jpeg_size(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64))
        self.assertIsNone(server.jpeg_size(jpeg()[:-2]))  # cut short

    def test_upload_and_page(self):
        s, b = self.share()
        self.assertEqual(s, 200)
        sid = b["id"]
        self.assertRegex(sid, r"^[A-Za-z0-9_-]{11}$")
        self.assertEqual(b["url"], f"{server.PUBLIC_ORIGIN}/s/{sid}")
        s, page, h = self.call("GET", f"/s/{sid}")
        self.assertEqual(s, 200)
        self.assertIn("text/html", h["content-type"])
        self.assertIn("script-src 'sha256-", h["content-security-policy"])
        m = Meta()
        m.feed(page.decode("utf-8"))
        t = m.tags
        self.assertTrue(t["og:title"].startswith("Fly an FPV drone through Old"))
        self.assertEqual(t["og:image"], f"{server.PUBLIC_ORIGIN}/s/{sid}.jpg")
        self.assertTrue(t["og:image"].startswith("https://"))
        self.assertEqual((t["og:image:width"], t["og:image:height"]), ("1200", "630"))
        self.assertIn("Can you fly this line?", t["og:description"])
        self.assertIn("Andrii Shramko, CC BY 4.0", t["og:description"])
        self.assertEqual(t["og:url"], b["url"])
        self.assertEqual(t["twitter:card"], "summary_large_image")
        self.assertEqual(t["twitter:image"], t["og:image"])
        self.assertIn(f'href="/en/fly/?scene=39e63ce9"', page.decode())
        # the visitor's words are escaped: the title is text, not markup
        self.assertIn('<script>alert(1)</script> "Hall"', t["og:title"])  # what a parser reads
        self.assertNotIn(b"<script>alert", page)                            # never raw in the page
        self.assertIn(b"&lt;script&gt;alert(1)&lt;/script&gt; &quot;Hall&quot; &amp; Co", page)
        # the picture: exactly what was uploaded, cached for good; HEAD too
        s, img, h = self.call("GET", f"/s/{sid}.jpg")
        self.assertEqual((s, img, h["content-type"]), (200, jpeg(), "image/jpeg"))
        self.assertIn("immutable", h["cache-control"])
        self.assertEqual(self.call("HEAD", f"/s/{sid}.jpg")[0], 200)

    def test_unknown_and_malformed_ids(self):
        self.assertEqual(self.call("GET", "/s/AAAAAAAAAAA")[0], 404)
        self.assertEqual(self.call("GET", "/s/AAAAAAAAAAA.jpg")[0], 404)
        self.assertEqual(self.call("GET", "/s/..%2F..%2Freports.jsonl")[0], 404)
        self.assertEqual(self.call("GET", "/s/../reports")[0], 404)
        # control: a stored id answers
        sid = self.share()[1]["id"]
        self.assertEqual(self.call("GET", f"/s/{sid}")[0], 200)

    def test_locale_words(self):
        sid = self.share(locale="pl", title="")[1]["id"]
        m = Meta()
        m.feed(self.call("GET", f"/s/{sid}")[1].decode("utf-8"))
        self.assertEqual(m.tags["og:title"], "Leć dronem FPV przez prawdziwy skan 3D — prosto w przeglądarce")
        self.assertEqual(m.tags["og:locale"], "pl_PL")
        # control: an unknown locale falls back to English
        sid = self.share(locale="xx")[1]["id"]
        m = Meta()
        m.feed(self.call("GET", f"/s/{sid}")[1].decode("utf-8"))
        self.assertEqual(m.tags["og:locale"], "en_US")

    def test_refusals(self):
        self.assertEqual(self.share(image=base64.b64encode(jpeg(1280, 720)).decode())[0], 400)   # wrong size
        self.assertEqual(self.share(image="data:image/jpeg;base64,!!!")[0], 400)               # not base64
        self.assertEqual(self.share(image=base64.b64encode(b"GIF89a" + b"\x00" * 40).decode())[0], 400)
        self.assertEqual(self.share(scene="not-a-scene")[0], 400)
        self.assertEqual(self.share(hp="x")[0], 400)
        big = jpeg()[:-2] + b"\x00" * (401 * 1024) + b"\xff\xd9"
        self.assertEqual(self.share(image=base64.b64encode(big).decode())[0], 413)
        server._guard["tripped"] = True
        try:
            self.assertEqual(self.share()[0], 503)
        finally:
            server._guard["tripped"] = False
        self.assertFalse(server.SHARE_DIR.exists() and any(server.SHARE_DIR.iterdir()))
        self.assertEqual(self.share()[0], 200)  # control

    def test_cap_and_rate(self):
        old = server.SHARE_CAP_BYTES
        server.SHARE_CAP_BYTES = 10
        try:
            s, _, _ = self.call("POST", "/api/share", {"image": base64.b64encode(jpeg()).decode(), "scene": "39e63ce9"}, ip="198.51.100.10")
            self.assertEqual(s, 507)
        finally:
            server.SHARE_CAP_BYTES = old
        for _ in range(12):
            self.assertEqual(self.share()[0], 200)
        self.assertEqual(self.share()[0], 429)
        s, _, _ = self.call("POST", "/api/share", {"image": base64.b64encode(jpeg()).decode(), "scene": "39e63ce9"}, ip="198.51.100.9")
        self.assertEqual(s, 200)  # control: another visitor


if __name__ == "__main__":
    unittest.main()
