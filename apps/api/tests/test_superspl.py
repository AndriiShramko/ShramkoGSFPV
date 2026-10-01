"""Tests of the SuperSplat catalogue proxy (GET /api/superspl/explore) in apps/api/server.py.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only, no network: the upstream is a fake
function or a local HTTP server). Every check has a negative control that must fire.
"""
from __future__ import annotations

import http.client
import json
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

S3 = "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat"
UPSTREAM = "https://playcanvas.com/api/splats/explore"


class Clock:
    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t


def scene(i: int, **over) -> dict:
    """One item as the explore API returns it (22 keys, measured 2026-09-27)."""
    sid = f"{i:08x}"
    it = {
        "hash": sid, "title": f"Scene {i}", "description": f"about scene {i}", "version": 1,
        "thumbnails": {k: f"{S3}/{sid}/v1/{k}.webp" for k in ("xl", "l", "m", "s", "mov")},
        "task": {"status": "complete", "message": ""}, "format": "sog", "size": 1000 + i, "lodCounts": [1, 2],
        "shBands": 3, "views": 100 + i, "comments": 2, "starred": 500 - i, "downloadCount": 0, "listed": True,
        "downloads": {"enabled": False, "license": None}, "completedAt": "2025-05-08T01:57:50.990Z",
        "createdAt": "2025-05-08T01:57:48.770Z", "modifiedAt": "2025-05-08T01:57:50.990Z",
        "softwareToolIds": [], "user": {"id": 515189, "username": f"user{i}"}, "starId": 0,
    }
    it.update(over)
    return it


def page(n: int = 3, total: int = 1303, start: int = 0, items: list | None = None) -> bytes:
    res = items if items is not None else [scene(start + i) for i in range(n)]
    return json.dumps({"result": res, "pagination": {"skip": start, "limit": n, "total": total}}).encode()


class FakeUpstream:
    """Stands in for fetch_upstream: records every call; answers from a list or a function."""

    def __init__(self, clock: Clock | None = None, answer=None):
        self.calls: list[tuple[str, dict]] = []
        self.times: list[float] = []
        self.clock = clock
        self.answer = answer or (lambda url: (200, {}, page()))

    def __call__(self, url, headers, timeout, max_bytes):
        self.calls.append((url, dict(headers)))
        if self.clock:
            self.times.append(self.clock())
        a = self.answer(url)
        if isinstance(a, Exception):
            raise a
        return a


def proxy(clock: Clock | None = None, fake: FakeUpstream | None = None, **cfg) -> tuple[server.SupersplProxy, FakeUpstream, Clock]:
    clock = clock or Clock()
    fake = fake or FakeUpstream(clock)
    p = server.SupersplProxy(server.SupersplConfig(**cfg), fetch=fake, clock=clock, wall=lambda: 1790000000.0)
    return p, fake, clock


def body(reply) -> dict:
    return json.loads(reply[1])


def header(reply, name: str) -> str | None:
    return next((v for k, v in reply[2] if k.lower() == name.lower()), None)


VALID = "sort=starred&order=-1&time=week&features=downloadable,walkable&search=gothic%20church&skip=32&limit=16"

TRICKLE_S = 1.6        # how long the fake upstream keeps dripping
TRICKLE_STEP_S = 0.1   # one byte this often: every single read is quick, the whole answer is not
DEADLINE_S = 0.5       # the fetch timeout the trickle tests give
SLACK_S = 0.5          # what a deadline may overrun by (thread start, one last short wait)


def old_fetch(url: str, headers: dict, timeout: float, max_bytes: int):
    """Control only: fetch_upstream before review C7 (2026-10-01). The deadline was checked between reads, a
    buffered read waited for 64 KiB or the end, and the socket timeout bounded each recv, not the answer."""
    import urllib.request
    deadline = time.monotonic() + timeout
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            chunks = []
            while True:
                if time.monotonic() > deadline:
                    raise server.UpstreamError("timeout")
                b = r.read(65536)
                if not b:
                    break
                chunks.append(b)
            return r.status, {}, b"".join(chunks)
    except server.UpstreamError:
        raise
    except Exception as e:  # noqa: BLE001
        raise server.UpstreamError("network") from e


def timed(f, *a):
    """(result or exception, seconds)."""
    t0 = time.monotonic()
    try:
        out = f(*a)
    except Exception as e:  # noqa: BLE001
        out = e
    return out, time.monotonic() - t0


class Whitelist(unittest.TestCase):
    def test_valid_query_forwarded_like_supersplat_client(self):
        p, fake, _ = proxy()
        r = p.handle(VALID, "c")
        self.assertEqual(r[0], 200)
        self.assertEqual(len(fake.calls), 1)
        # superspl.at's exploreSplats(): skip, limit, sort, order, time, features (their order), search encoded twice
        self.assertEqual(fake.calls[0][0], f"{UPSTREAM}?skip=32&limit=16&sort=starred&order=-1&time=week"
                                           "&features=walkable%2Cdownloadable&search=gothic%2520church")
        self.assertEqual(body(r)["query"], {"sort": "starred", "order": -1, "time": "week", "features": ["walkable", "downloadable"],
                                            "search": "gothic church", "skip": 32, "limit": 16})

    def test_everything_off_the_whitelist_is_refused_without_an_upstream_call(self):
        bad = {
            "userId=1": "userId", "softwareToolId=postshot": "softwareToolId", "unlisted=true": "unlisted",
            "sort=likes": "sort", "sort=": "sort", "order=0": "order", "order=desc": "order", "time=hour": "time",
            "features=indoor": "features", "features=walkable,walkable": "features", "features=walkable,": "features",
            "search=" + "x" * 81: "search", "search=a%00b": "search", "skip=10001": "skip", "skip=-1": "skip",
            "skip=1e3": "skip", "skip=%EF%BC%91": "skip", "limit=0": "limit", "limit=49": "limit", "limit=": "limit",
            "sort=views&sort=views": "sort", "sort": "query", "sort=views&": "query", "search=%FF": "query",
            "a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8": "query", "x" * 1100: "query",
        }
        p, fake, _ = proxy()
        for qs, param in bad.items():
            r = p.handle(qs, "c")
            self.assertEqual(r[0], 400, qs)
            self.assertEqual(body(r), {"ok": False, "error": "bad-param", "param": param, "detail": body(r)["detail"]}, qs)
        self.assertEqual(fake.calls, [], "a refused query must never reach the upstream")
        # control: the whitelist's edges are accepted
        for qs in ("", "limit=48&skip=10000", "limit=1&skip=0", "search=" + "x" * 80, "features=&skip=5", "time=day&sort=size&order=1"):
            self.assertEqual(p.handle(qs, "c")[0], 200, qs)
        self.assertEqual(len(fake.calls), 6)

    def test_equivalent_queries_share_one_cache_entry(self):
        p, fake, _ = proxy()
        p.handle("sort=views&order=-1&features=walkable,downloadable&skip=0&limit=16", "c")
        for qs in ("limit=16&features=downloadable,walkable&order=-1&sort=views",  # order of params and features
                   "sort=views&limit=16&features=walkable%2Cdownloadable"):
            self.assertEqual(header(p.handle(qs, "c"), "X-Cache"), "hit", qs)
        p.handle("sort=trending&time=all", "c")
        self.assertEqual(header(p.handle("sort=trending&time=week", "c"), "X-Cache"), "hit")  # trending forces all time
        self.assertEqual(header(p.handle("sort=size", "c"), "X-Cache"), "miss")
        self.assertEqual(header(p.handle("sort=size&search=a", "c"), "X-Cache"), "hit")  # one letter is ignored
        self.assertEqual(header(p.handle("sort=size&search=%3Cb%3E", "c"), "X-Cache"), "hit")  # "<b>" -> "b"
        self.assertEqual(header(p.handle("sort=size&search=%20x%20%20y%20", "c"), "X-Cache"), "miss")
        self.assertEqual(header(p.handle("sort=size&search=x+y", "c"), "X-Cache"), "hit")  # whitespace runs
        self.assertEqual(len(fake.calls), 4)
        # control: a different page, time or search is a different entry
        for qs in ("sort=views&features=walkable,downloadable&skip=16&limit=16",
                   "sort=views&time=week&features=walkable,downloadable&limit=16", "sort=size&search=ab"):
            self.assertEqual(header(p.handle(qs, "c"), "X-Cache"), "miss", qs)
        self.assertEqual(len(fake.calls), 7)


class Trim(unittest.TestCase):
    def test_answer_has_only_the_fields_the_picker_needs(self):
        long_desc = "word " * 200
        items = [scene(0, description=long_desc, downloads={"enabled": True, "license": "by-sa"}),
                 scene(1, thumbnails={"m": "https://evil.example/x.webp", "s": f"{S3}/00000001/v1/s.webp"}),
                 scene(2, hash="../../x"), scene(3, listed=False), "junk",
                 scene(4, title="a\x00b\u202ec", starred=True, views=-5, version="2", createdAt="yesterday")]
        p, _, _ = proxy(fake=FakeUpstream(answer=lambda url: (200, {}, page(items=items, total=77))))
        out = body(p.handle("limit=10", "c"))
        self.assertEqual(out["total"], 77)
        self.assertEqual(out["fetchedAt"], 1790000000)
        self.assertEqual([x["id"] for x in out["items"]], ["00000000", "00000001", "00000004"])
        keys = {"id", "version", "title", "author", "likes", "views", "sizeBytes", "thumbs", "createdAt", "license",
                "downloadable", "description", "format"}
        for x in out["items"]:
            self.assertEqual(set(x), keys)
        a, b, c = out["items"]
        self.assertEqual((a["likes"], a["views"], a["sizeBytes"], a["author"]), (500, 100, 1000, "user0"))
        self.assertEqual((a["license"], a["downloadable"]), ("by-sa", True))
        self.assertLessEqual(len(a["description"]), 300)
        self.assertTrue(a["description"].endswith("..."))
        self.assertEqual(a["thumbs"]["m"], f"{S3}/00000000/v1/m.webp")  # control for the host check below
        self.assertIsNone(b["thumbs"]["m"])  # a thumbnail off the S3 bucket is dropped (our CSP img-src allows only it)
        self.assertEqual(b["thumbs"]["s"], f"{S3}/00000001/v1/s.webp")
        self.assertEqual((c["likes"], c["views"], c["version"], c["createdAt"]), (0, 0, 1, None))
        self.assertEqual(c["title"], "a b\u202ec")
        self.assertEqual(server.trim_item(scene(0))["description"], "about scene 0")  # control: short text is untouched

    def test_limit_caps_the_items_passed_on(self):
        p, _, _ = proxy(fake=FakeUpstream(answer=lambda url: (200, {}, page(n=10))))
        self.assertEqual(len(body(p.handle("limit=4", "c"))["items"]), 4)
        self.assertEqual(len(body(p.handle("limit=10", "c"))["items"]), 10)  # control


class Cache(unittest.TestCase):
    def test_hit_makes_no_upstream_call_until_the_ttl_expires(self):
        p, fake, clock = proxy()
        first = p.handle("sort=starred", "c")
        self.assertEqual((first[0], header(first, "X-Cache"), header(first, "Cache-Control")), (200, "miss", "public, max-age=600"))
        clock.t += 100
        hit = p.handle("sort=starred", "c")
        self.assertEqual((header(hit, "X-Cache"), header(hit, "Cache-Control")), ("hit", "public, max-age=500"))
        self.assertEqual(hit[1], first[1])
        self.assertEqual(len(fake.calls), 1, "cache hit: 0 upstream calls")
        clock.t += 501  # control: 601 s after the fetch the entry is no longer fresh
        self.assertEqual(header(p.handle("sort=starred", "c"), "X-Cache"), "miss")
        self.assertEqual(len(fake.calls), 2, "TTL expired: 1 upstream call")

    def test_bounded_bytes_and_least_recently_used_goes_first(self):
        one = len(proxy()[0].handle("skip=0", "c")[1]) + 512
        p, fake, _ = proxy(cache_max_bytes=3 * one + 10)
        for s in range(3):
            p.handle(f"skip={s}", "c")
        p.handle("skip=0", "c")  # touch: skip=0 is now the most recent
        p.handle("skip=3", "c")  # evicts skip=1, the least recently used
        self.assertLessEqual(p.cache_bytes(), 3 * one + 10)
        n = len(fake.calls)
        self.assertEqual(header(p.handle("skip=0", "c"), "X-Cache"), "hit")  # control: recently used survives
        self.assertEqual(len(fake.calls), n)
        self.assertEqual(header(p.handle("skip=1", "c"), "X-Cache"), "miss")
        self.assertEqual(len(fake.calls), n + 1)

    def test_default_bound_is_far_under_the_container_limit(self):
        c = server.SupersplConfig()
        self.assertLessEqual(c.cache_max_bytes, 8 * 1024 * 1024)  # container: 64 MB
        real_size = [scene(i, title="t" * 60, description="d" * 400) for i in range(48)]  # ~45 KB trimmed, like the live pages
        p, _, _ = proxy(fake=FakeUpstream(answer=lambda url: (200, {}, page(items=real_size))), bucket_capacity=1e9)
        for s in range(400):
            p.handle(f"skip={s}&limit=48", f"c{s}")
        self.assertLessEqual(p.cache_bytes(), c.cache_max_bytes)
        self.assertGreater(p.cache_bytes(), c.cache_max_bytes * 0.9)  # control: the bound is what stopped it


class Limits(unittest.TestCase):
    def calls_in_any_window(self, times: list[float], w: float = 60.0) -> int:
        return max((sum(1 for u in times if t <= u < t + w) for t in times), default=0)

    def run_demand(self, **cfg) -> list[float]:
        """10 new pages a second for 3 minutes, from many visitors (so only the global bucket limits)."""
        p, fake, clock = proxy(**cfg)
        for i in range(1800):
            clock.t = 1000.0 + i / 10
            p.handle(f"skip={i}", f"visitor{i % 100}")
        return fake.times

    def test_bucket_keeps_upstream_calls_at_60_in_any_60s(self):
        times = self.run_demand()
        self.assertLessEqual(self.calls_in_any_window(times), 60)
        self.assertGreaterEqual(self.calls_in_any_window(times), 55)  # it does use its budget
        # control: a bucket as big as their limit would break 120 in a window, and this counter sees it
        self.assertGreater(self.calls_in_any_window(self.run_demand(bucket_capacity=200.0, bucket_refill_per_s=2.0)), 120)

    def test_empty_bucket_serves_stale(self):
        p, fake, clock = proxy(bucket_capacity=2.0, bucket_refill_per_s=0.001)
        p.handle("skip=0", "c")
        clock.t += 700  # expired; the bucket refilled 0.7 of a token
        p.handle("skip=1", "c")  # spends the last whole token
        r = p.handle("skip=0", "c")
        self.assertEqual((r[0], header(r, "X-Cache"), header(r, "Cache-Control")), (200, "stale", "no-cache"))
        self.assertEqual(len(fake.calls), 2, "stale answer: no upstream call")
        # control: a page never fetched has no stale copy -> a clear 503
        r = p.handle("skip=2", "c")
        self.assertEqual(r[0], 503)
        self.assertEqual({k: v for k, v in body(r).items() if k != "detail"}, {"ok": False, "error": "busy", "retryAfter": int(header(r, "Retry-After"))})
        self.assertGreaterEqual(body(r)["retryAfter"], 1)
        self.assertEqual(len(fake.calls), 2)

    def test_stale_copy_is_served_for_a_day_only(self):
        p, fake, clock = proxy(bucket_capacity=1.0, bucket_refill_per_s=1e-9)
        p.handle("skip=0", "c")
        clock.t += 23 * 3600
        self.assertEqual(header(p.handle("skip=0", "c"), "X-Cache"), "stale")  # control
        clock.t += 3600
        self.assertEqual(p.handle("skip=0", "c")[0], 503)

    def test_upstream_failure_serves_stale_else_502(self):
        state = {"fail": None}

        def answer(url):
            return state["fail"] or (200, {}, page())
        p, fake, clock = proxy(fake=FakeUpstream(answer=answer))
        p.handle("skip=0", "c")
        clock.t += 700
        for fail, detail in (((500, {}, b""), "http-500"), (server.UpstreamError("timeout"), "timeout"),
                             ((200, {}, b"<html>"), "bad-json"), ((200, {}, b'{"result": 5}'), "bad-json"),
                             ((302, {}, b""), "http-302")):
            state["fail"] = fail
            clock.t += 30  # past the per-page cool-down
            r = p.handle("skip=0", "c")
            self.assertEqual((r[0], header(r, "X-Cache")), (200, "stale"), detail)
            r = p.handle(f"skip=9&limit={len(detail)}", "c")  # control: no stale copy -> 502 with the reason
            self.assertEqual((r[0], body(r)["error"], body(r)["detail"]), (502, "upstream", detail))

    def test_failed_page_cools_down_alone(self):
        state = {"fail": True}
        p, fake, clock = proxy(fake=FakeUpstream(answer=lambda url: (503, {}, b"") if state["fail"] and "skip=5" in url else (200, {}, page())))
        self.assertEqual(p.handle("skip=5", "c")[0], 502)
        self.assertEqual(p.handle("skip=5", "c")[0], 502)
        self.assertEqual(len(fake.calls), 1, "within the cool-down the same failure is not asked again")
        self.assertEqual(p.handle("skip=6", "c")[0], 200)  # another page is not blocked
        state["fail"] = False
        clock.t += 21  # control: after the cool-down it is asked again
        self.assertEqual(p.handle("skip=5", "c")[0], 200)
        self.assertEqual(len(fake.calls), 3)

    def test_upstream_429_stops_every_call_for_its_retry_after(self):
        state = {"n": 0}

        def answer(url):
            state["n"] += 1
            return (429, {"retry-after": "30"}, b"") if state["n"] == 1 else (200, {}, page())
        p, fake, clock = proxy(fake=FakeUpstream(answer=answer))
        r = p.handle("skip=0", "c")
        self.assertEqual((r[0], body(r)["error"]), (503, "busy"))
        self.assertGreaterEqual(int(header(r, "Retry-After")), 29)
        clock.t += 29
        self.assertEqual(p.handle("skip=1", "c")[0], 503)
        self.assertEqual(len(fake.calls), 1)
        clock.t += 2  # control: after Retry-After the next page is asked
        self.assertEqual(p.handle("skip=1", "c")[0], 200)
        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(server._retry_after({"ratelimit": "limit=120, remaining=0, reset=17"}, 60, 600), 17)
        self.assertEqual(server._retry_after({}, 60, 600), 60)

    def test_one_visitor_is_limited_per_minute(self):
        p, fake, clock = proxy()
        for _ in range(60):
            self.assertEqual(p.handle("skip=0", "a")[0], 200)
        r = p.handle("skip=0", "a")
        self.assertEqual((r[0], body(r)["error"], header(r, "Retry-After")), (429, "rate-limited", "60"))
        self.assertEqual(p.handle("skip=0", "b")[0], 200)  # control: another visitor passes
        clock.t += 60
        self.assertEqual(p.handle("skip=0", "a")[0], 200)  # control: the window moves on

    def test_client_table_stays_bounded(self):
        p, _, _ = proxy(client_table_max=50)
        for i in range(500):
            p.handle("skip=0", f"fake{i}")
        self.assertLessEqual(len(p._clients), 50)


class Dedupe(unittest.TestCase):
    def concurrent(self, queries: list[str]) -> tuple[list, int]:
        gate = threading.Event()
        started = threading.Semaphore(0)

        def answer(url):
            started.release()
            gate.wait(5)
            return 200, {}, page()
        p, fake, _ = proxy(clock=time.monotonic, fake=FakeUpstream(answer=answer))
        out: list = [None] * len(queries)

        def run(i):
            out[i] = p.handle(queries[i], f"c{i}")
        ts = [threading.Thread(target=run, args=(i,)) for i in range(len(queries))]
        for t in ts:
            t.start()
        started.acquire(timeout=5)
        time.sleep(0.2)  # let the others arrive while the first call is still open
        gate.set()
        for t in ts:
            t.join(10)
        return out, len(fake.calls)

    def test_same_page_asked_at_once_makes_one_call(self):
        out, calls = self.concurrent(["skip=0"] * 3)
        self.assertEqual(calls, 1)
        self.assertTrue(all(r[0] == 200 and r[1] == out[0][1] for r in out))
        out, calls = self.concurrent(["skip=0", "skip=1", "skip=2"])  # control: different pages -> 3 calls
        self.assertEqual(calls, 3)


class RealFetch(unittest.TestCase):
    """fetch_upstream against a local HTTP server: what goes over the wire, redirects, size, deadline."""

    @classmethod
    def setUpClass(cls):
        cls.seen: list[dict] = []
        seen = cls.seen

        class Up(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                seen.append({k.lower(): v for k, v in self.headers.items()})
                if self.path.startswith("/redirect"):
                    self.send_response(302)
                    self.send_header("Location", "http://127.0.0.1:1/elsewhere")
                    self.end_headers()
                    return
                if self.path.startswith("/slow"):
                    self.send_response(200)
                    self.send_header("Content-Length", "20")
                    self.end_headers()
                    for _ in range(10):
                        self.wfile.write(b"xx")
                        self.wfile.flush()
                        time.sleep(0.1)
                    return
                if self.path.startswith("/trickle"):
                    # an overloaded upstream: a byte every TRICKLE_STEP_S for TRICKLE_S, in the headers or the body
                    try:
                        if self.path.startswith("/trickle-head"):
                            self.wfile.write(b"HTTP/1.1 200 OK\r\nX-Pad: ")
                        else:
                            self.send_response(200)
                            self.send_header("Content-Length", "100000")  # far more than ever comes
                            self.end_headers()
                        t_end = time.monotonic() + TRICKLE_S
                        while time.monotonic() < t_end:
                            self.wfile.write(b"x")
                            self.wfile.flush()
                            time.sleep(TRICKLE_STEP_S)
                    except OSError:  # the client gave up: that is the point
                        pass
                    self.close_connection = True
                    return
                b = b"x" * 5000 if self.path.startswith("/big") else page()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Set-Cookie", "track=1")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

        cls.up = ThreadingHTTPServer(("127.0.0.1", 0), Up)
        cls.base = f"http://127.0.0.1:{cls.up.server_address[1]}"
        threading.Thread(target=cls.up.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.up.shutdown()
        cls.up.server_close()

    def setUp(self):
        self.seen.clear()

    def test_redirect_size_and_deadline(self):
        h = dict(server.SUPERSPL_UPSTREAM_HEADERS)
        self.assertEqual(server.fetch_upstream(self.base + "/ok", h, 2, 100000)[0], 200)  # control
        self.assertEqual(server.fetch_upstream(self.base + "/redirect", h, 2, 100000)[0], 302)  # not followed
        self.assertEqual(len(self.seen), 2, "the redirect target was never asked")
        with self.assertRaises(server.UpstreamError) as e:
            server.fetch_upstream(self.base + "/big", h, 2, 4096)
        self.assertEqual(e.exception.detail, "too-large")
        self.assertEqual(len(server.fetch_upstream(self.base + "/big", h, 2, 8192)[2]), 5000)  # control
        with self.assertRaises(server.UpstreamError) as e:
            server.fetch_upstream(self.base + "/slow", h, 0.35, 100000)  # every read is quick, the whole is not
        self.assertEqual(e.exception.detail, "timeout")
        self.assertEqual(len(server.fetch_upstream(self.base + "/slow", h, 3, 100000)[2]), 20)  # control
        with self.assertRaises(server.UpstreamError) as e:
            # 5 s, not 1: Windows answers a closed loopback port with a refusal only after ~2 s of SYN retries
            server.fetch_upstream("http://127.0.0.1:1/", h, 5, 100)
        self.assertEqual(e.exception.detail, "network")

    def test_the_deadline_holds_for_the_whole_answer_against_a_trickle(self):
        """Review C7: one byte every 0.1 s must not stretch a 0.5 s deadline, neither in a body announced as
        100000 bytes nor in headers that never end. Control: the fetch before the fix overran the same
        deadline by the whole trickle."""
        h = dict(server.SUPERSPL_UPSTREAM_HEADERS)
        for path in ("/trickle", "/trickle-head"):
            out, dt = timed(server.fetch_upstream, self.base + path, h, DEADLINE_S, 1_000_000)
            self.assertIsInstance(out, server.UpstreamError, path)
            self.assertEqual((path, out.detail), (path, "timeout"))
            self.assertLess(dt, DEADLINE_S + SLACK_S, path)
        for path in ("/trickle", "/trickle-head"):
            _, dt = timed(old_fetch, self.base + path, h, DEADLINE_S, 1_000_000)
            self.assertGreater(dt, TRICKLE_S - 0.3, f"control {path}: the old fetch waited the trickle out")

    def test_a_trickling_upstream_keeps_no_visitor_past_the_deadline(self):
        """Review C7 (b): the page's leader is bounded, so every visitor asking that page gets the stale copy
        by the deadline (before the fix: each one waited up to timeout + slot wait + 1 s, holding a thread)."""
        def run(fetch) -> list:
            clock = Clock()
            p = server.SupersplProxy(server.SupersplConfig(upstream_timeout_s=DEADLINE_S, slot_wait_s=0.2), fetch=fetch,
                                     clock=clock, wall=lambda: 1790000000.0, upstream=self.base + "/ok")
            self.assertEqual(header(p.handle("skip=0", "seed"), "X-Cache"), "miss")
            clock.t += p.cfg.ttl_s + 1  # the copy is stale now: the next ask goes upstream, which now drips
            p.upstream = self.base + "/trickle"
            out: list = [None] * 6

            def ask(i):
                r, dt = timed(p.handle, "skip=0", f"visitor{i}")
                out[i] = (r[0], header(r, "X-Cache"), dt)
            ts = [threading.Thread(target=ask, args=(i,)) for i in range(len(out))]
            for t in ts:
                t.start()
            for t in ts:
                t.join(15)
            return out
        got = run(server.fetch_upstream)
        self.assertEqual([g[:2] for g in got], [(200, "stale")] * 6)
        self.assertLess(max(g[2] for g in got), DEADLINE_S + SLACK_S)
        ctl = run(old_fetch)  # control: the same page with the old fetch keeps every visitor for the trickle
        self.assertEqual([g[:2] for g in ctl], [(200, "stale")] * 6)
        self.assertGreater(max(g[2] for g in ctl), TRICKLE_S - 0.3)

    def test_nothing_of_the_visitor_reaches_the_upstream(self):
        """Visitor -> our Handler (real HTTP) -> real fetch_upstream -> local fake upstream, headers compared."""
        test_proxy = server.SupersplProxy(upstream=self.base + "/api/splats/explore")
        api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=api.serve_forever, daemon=True).start()
        old, server.SUPERSPL = server.SUPERSPL, test_proxy
        try:
            c = http.client.HTTPConnection("127.0.0.1", api.server_address[1], timeout=5)
            c.request("GET", "/api/superspl/explore?sort=starred&limit=3", headers={
                "Cookie": "NEXT_LOCALE=pl; _ga=GA1.1.123", "Authorization": "Bearer secret-of-the-visitor",
                "X-Forwarded-For": "203.0.113.9", "Referer": "https://gsfpv.flyreelstudio.eu/pl/fly/",
                "User-Agent": "VisitorBrowser/1.0", "Accept-Language": "pl"})
            r = c.getresponse()
            data = json.loads(r.read())
            c.close()
            self.assertEqual((r.status, r.getheader("X-Cache"), r.getheader("Set-Cookie")), (200, "miss", None))
            self.assertEqual(r.getheader("Content-Type"), "application/json; charset=utf-8")
            self.assertEqual(len(data["items"]), 3)
        finally:
            server.SUPERSPL = old
            api.shutdown()
            api.server_close()
        self.assertEqual(len(self.seen), 1)
        got = self.seen[0]
        self.assertEqual(got["user-agent"], server.SUPERSPL_UA)
        self.assertEqual(set(got), {"host", "user-agent", "accept", "accept-encoding", "connection"})
        # control: the fake upstream does record a cookie when one is sent, so its absence above means something
        server.fetch_upstream(self.base + "/ok", {**dict(server.SUPERSPL_UPSTREAM_HEADERS), "Cookie": "x=1"}, 2, 100000)
        self.assertEqual(self.seen[-1].get("cookie"), "x=1")


class Routes(unittest.TestCase):
    def setUp(self):
        self.fake = FakeUpstream()
        self.old = server.SUPERSPL
        server.SUPERSPL = server.SupersplProxy(fetch=self.fake)
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        server.SUPERSPL = self.old
        self.api.shutdown()
        self.api.server_close()

    def get(self, method: str, path: str) -> tuple[int, dict]:
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=5)
        c.request(method, path, body=b"{}" if method == "POST" else None)
        r = c.getresponse()
        raw = r.read()
        c.close()
        return r.status, json.loads(raw) if raw else {}

    def test_routes(self):
        s, b = self.get("GET", "/api/superspl/explore?sort=starred&features=walkable")
        self.assertEqual((s, b["ok"], b["query"]["features"]), (200, True, ["walkable"]))
        self.assertEqual(self.get("GET", "/api/superspl/explore?sort=likes")[0], 400)
        self.assertEqual(self.get("GET", "/api/superspl/random")[0], 404)  # random is picked in the browser
        self.assertEqual(self.get("POST", "/api/superspl/explore")[0], 404)
        self.assertEqual(len(self.fake.calls), 1)
        self.assertIn(self.get("GET", "/api/health")[0], (200, 503))  # control: the old routes still answer


if __name__ == "__main__":
    unittest.main()
