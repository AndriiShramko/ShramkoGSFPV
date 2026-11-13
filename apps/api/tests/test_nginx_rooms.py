"""nginx for the rooms service (lane rooms, docs/rooms-protocol.md): the WebSocket location passes the upgrade, the
HTTP location reaches gsfpv-rooms, both take the client address the hub's front proxy appended. Each check is a function
returning what is wrong, run on the real config (nothing) and on mutated copies (something)."""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_nginx_routes import CONF, locations, route, trusts_only_the_front_proxy  # noqa: E402

UPSTREAM = re.compile(r"set\s+\$rooms_upstream\s+http://gsfpv-rooms:8091;")


def ws_problems(conf: str) -> list[str]:
    loc, _ = route(conf, "/api/rooms/ws")
    if (loc.mod, loc.pattern) != ("=", "/api/rooms/ws"):
        return [f"/api/rooms/ws served by {loc.mod} {loc.pattern}"]
    b, out = loc.body, []
    checks = {
        "GET only": r"limit_except\s+GET\s*\{\s*deny\s+all;\s*\}",
        "HTTP/1.1 upstream": r"proxy_http_version\s+1\.1;",
        "Upgrade passed": r"proxy_set_header\s+Upgrade\s+\$http_upgrade;",
        'Connection "upgrade"': r'proxy_set_header\s+Connection\s+"upgrade";',
        "the rooms upstream": r"proxy_pass\s+\$rooms_upstream/api/rooms/ws;",
        "cookies cleared": r'proxy_set_header\s+Cookie\s+"";',
        "credentials cleared": r'proxy_set_header\s+Authorization\s+"";',
        "no buffering": r"proxy_buffering\s+off;",
        "4 sockets per client": r"limit_conn\s+gsfpv_rooms_ws\s+4;",
    }
    out += [f"/api/rooms/ws: {k} missing" for k, rx in checks.items() if not re.search(rx, b)]
    if not UPSTREAM.search(b):
        out.append("/api/rooms/ws: $rooms_upstream is not gsfpv-rooms:8091")
    t = re.search(r"proxy_read_timeout\s+(\d+)s;", b)
    if t is None or not 60 <= int(t.group(1)) <= 120:
        out.append("/api/rooms/ws: proxy_read_timeout must outlast the 20 s client ping (60-120 s)")
    if not trusts_only_the_front_proxy(b):
        out.append("/api/rooms/ws: the client address is not the one the front proxy appended")
    return out


def http_problems(conf: str) -> list[str]:
    out = []
    for uri in ("/api/rooms", "/api/rooms/health", "/api/rooms/AbCdEfGhIjK"):
        loc, _ = route(conf, uri)
        if (loc.mod, loc.pattern) != ("^~", "/api/rooms"):
            out.append(f"{uri}: served by {loc.mod} {loc.pattern}")
            continue
        b = loc.body
        if not re.search(r"limit_except\s+GET\s+POST\s*\{\s*deny\s+all;\s*\}", b):
            out.append(f"{uri}: not GET and POST only")
        if not re.search(r"client_max_body_size\s+4k;", b):
            out.append(f"{uri}: body limit is not 4k")
        if not re.search(r"limit_req\s+zone=gsfpv_rooms\s", b):
            out.append(f"{uri}: no rate zone")
        if not UPSTREAM.search(b) or not re.search(r"proxy_pass\s+\$rooms_upstream\$request_uri;", b):
            out.append(f"{uri}: not passed to gsfpv-rooms")
        # review RV-3: a variable proxy_pass with the decoded $uri lets %0d%0a split the upstream request
        if re.search(r"proxy_pass\s+\$rooms_upstream\$uri\b", b):
            out.append(f"{uri}: the decoded $uri is passed upstream (header injection)")
        if not re.search(r'add_header\s+Cache-Control\s+"no-store"\s+always;', b):
            out.append(f"{uri}: cacheable")
        if not re.search(r'proxy_set_header\s+Cookie\s+"";', b):
            out.append(f"{uri}: cookies passed on")
        if not trusts_only_the_front_proxy(b):
            out.append(f"{uri}: the client address is not the one the front proxy appended")
    return out


def zone_problems(conf: str) -> list[str]:
    lines = conf.splitlines()
    tg = next((i for i, ln in enumerate(lines) if re.match(r"limit_req_zone\s.*zone=gsfpv_tg:", ln)), None)
    if tg is None:
        return ["the gsfpv_tg zone is gone"]
    after = "\n".join(lines[tg + 1:tg + 8])
    out = []
    if not re.search(r"^limit_req_zone\s+\$binary_remote_addr\s+zone=gsfpv_rooms:1m\s+rate=\d+r/m;", after, re.M):
        out.append("no gsfpv_rooms limit_req_zone after gsfpv_tg")
    if not re.search(r"^limit_conn_zone\s+\$binary_remote_addr\s+zone=gsfpv_rooms_ws:1m;", after, re.M):
        out.append("no gsfpv_rooms_ws limit_conn_zone after gsfpv_tg")
    return out


class RoomsRoutes(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_the_websocket_location_passes_the_upgrade(self):
        self.assertEqual(ws_problems(self.conf), [])

    def test_the_http_location(self):
        self.assertEqual(http_problems(self.conf), [])

    def test_the_zones_sit_after_gsfpv_tg(self):
        self.assertEqual(zone_problems(self.conf), [])

    def test_the_neighbouring_routes_are_unchanged(self):
        self.assertEqual(route(self.conf, "/api/health")[0].pattern, "/api/health")
        self.assertEqual(route(self.conf, "/api/session/start")[0].pattern, "/api/session/")
        locs = [(x.mod, x.pattern) for x in locations(self.conf)]
        i = locs.index(("=", "/api/health"))
        self.assertEqual(locs[i + 1:i + 3], [("=", "/api/rooms/ws"), ("^~", "/api/rooms")])

    def test_control_without_connection_upgrade_fails(self):
        bad = self.conf.replace('proxy_set_header Connection "upgrade";', "", 1)
        self.assertIn('/api/rooms/ws: Connection "upgrade" missing', ws_problems(bad))

    def test_control_each_fault_is_caught(self):
        for old, new in (("proxy_http_version 1.1;", ""), ("proxy_set_header Upgrade $http_upgrade;", ""),
                         ("proxy_read_timeout 75s;", "proxy_read_timeout 10s;"),
                         ("location = /api/rooms/ws {", "location = /api/rooms/wss {")):
            self.assertTrue(ws_problems(self.conf.replace(old, new, 1)), old)

    def test_control_the_visitors_own_header_is_caught(self):
        for fn in (ws_problems, http_problems):
            bad = self.conf.replace("real_ip_recursive on;\n        limit_conn", "limit_conn", 1).replace(
                "real_ip_recursive on;\n        limit_req zone=gsfpv_rooms", "limit_req zone=gsfpv_rooms", 1)
            self.assertTrue(any("front proxy" in p for p in fn(bad)), fn.__name__)

    def test_control_without_the_locations_rooms_fall_elsewhere(self):
        bad = self.conf.replace("location ^~ /api/rooms {", "location ^~ /api/roomz {", 1)
        self.assertTrue(http_problems(bad))
        bad = self.conf.replace("zone=gsfpv_rooms:1m", "zone=gsfpv_r:1m", 1)
        self.assertTrue(zone_problems(bad))


if __name__ == "__main__":
    unittest.main()
