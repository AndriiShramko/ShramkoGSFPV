"""The courses' location in deploy/nginx.conf (train 1, lane tracks, T3): /api/tracks reaches the API through its own block,
GET and POST only, 64k bodies, no cookie or credential, the client address the hub's front proxy appended. Uses the helpers
of test_nginx_routes.py (read only there). Controls: the config without the block sends the URLs to the static site, and each
fault of the block (the mutated-config pattern of test_nginx_routes.py) is caught.

Run: python3 -m unittest discover -s apps/api/tests -v
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_nginx_routes import CONF, route, trusts_only_the_front_proxy  # noqa: E402

URIS = ("/api/tracks", "/api/tracks/39e63ce9-0a1b2c3d/v1")


def tracks_route_problems(conf: str) -> list[str]:
    out = []
    for uri in URIS:
        loc, _ = route(conf, uri)
        if (loc.mod, loc.pattern) != ("^~", "/api/tracks"):
            out.append(f"{uri}: served by location {loc.mod} {loc.pattern}, not by ^~ /api/tracks")
            continue
        body = loc.body
        if not re.search(r"proxy_pass\s+\$api_upstream\$request_uri;", body):
            out.append(f"{uri}: no proxy_pass $api_upstream$request_uri (?scene= would be lost)")
        if not re.search(r"limit_except\s+GET\s+POST\s*\{\s*deny\s+all;\s*\}", body):
            out.append(f"{uri}: not limited to GET and POST")
        size = re.search(r"client_max_body_size\s+(\d+)k;", body)
        if size is None or int(size.group(1)) != 64:
            out.append(f"{uri}: client_max_body_size {size.group(0) if size else 'missing'}: the API takes at most 64 KB")
        if not re.search(r'proxy_set_header\s+Cookie\s+"";', body):
            out.append(f"{uri}: the visitor's cookies are passed on")
        if not re.search(r'proxy_set_header\s+Authorization\s+"";', body):
            out.append(f"{uri}: an Authorization header is passed on")
        if not trusts_only_the_front_proxy(body):
            out.append(f"{uri}: the client address is not the one the front proxy appended")
        if re.search(r"add_header\s+Cache-Control", body):
            out.append(f"{uri}: nginx overrides the API's Cache-Control (the list's max-age and the file's immutable)")
    return out


class TracksRoute(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_the_tracks_urls_reach_the_api_through_their_own_location(self):
        self.assertEqual(tracks_route_problems(self.conf), [])

    def test_the_block_sits_directly_after_the_roadmap(self):
        a = self.conf.index("location = /api/roadmap {")
        b = self.conf.index("location ^~ /api/tracks {")
        between = self.conf[self.conf.index("\n    }\n", a) + 7:b]
        self.assertNotIn("location", between)

    def test_control_without_the_location_the_urls_fall_to_the_static_site(self):
        cut = re.sub(r"\n[ \t]*location \^~ /api/tracks \{.*?\n    \}\n", "\n", self.conf, flags=re.S)
        self.assertNotEqual(cut, self.conf, "the tracks location was not found to cut")
        loc, _ = route(cut, "/api/tracks")
        self.assertEqual((loc.mod, loc.pattern), ("", "/"))
        self.assertEqual(len(tracks_route_problems(cut)), len(URIS))

    def test_control_each_fault_of_the_location_is_caught(self):
        faults = {
            "GET only": ("limit_except GET POST { deny all; }", "limit_except GET { deny all; }"),
            "no limit_except": ("limit_except GET POST { deny all; }", ""),
            "bodies too big": ("client_max_body_size 64k;", "client_max_body_size 1100k;"),
            "no limit on the body": ("client_max_body_size 64k;", ""),
            "the query string is lost": ("proxy_pass $api_upstream$request_uri;", "proxy_pass $api_upstream$uri;"),
            "the visitor's address": ("proxy_set_header X-Forwarded-For $remote_addr;", "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"),
            "no real-IP": ("real_ip_recursive on;", ""),
            "a cookie passed on": ('proxy_set_header Cookie "";', ""),
            "a credential passed on": ('proxy_set_header Authorization "";', ""),
            "nginx caches it all": ("add_header Referrer-Policy no-referrer always;", 'add_header Referrer-Policy no-referrer always;\n        add_header Cache-Control "no-store" always;'),
        }
        start = self.conf.index("location ^~ /api/tracks {")
        end = self.conf.index("\n    }\n", start)
        block = self.conf[start:end]
        for name, (old, new) in faults.items():
            self.assertIn(old, block, name)
            broken = self.conf[:start] + block.replace(old, new, 1) + self.conf[end:]
            self.assertNotEqual(tracks_route_problems(broken), [], name)


if __name__ == "__main__":
    unittest.main()
