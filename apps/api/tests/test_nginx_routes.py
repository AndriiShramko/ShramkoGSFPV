"""The routes deploy/nginx.conf puts in front of the API (v0.7 lane A): which location a URL reaches, read from
the production config with nginx's own selection rule (exact, then the longest prefix unless a ^~ prefix
wins, then the first matching regex in file order, else the longest prefix). No nginx needed; CI's smoke
step (scripts/smoke-release.mjs) checks the same redirects against a real nginx. Every check has a negative
control: the first cut's config text, which must fail it."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

CONF = Path(__file__).resolve().parents[3] / "deploy" / "nginx.conf"
_LOC = re.compile(r'^[ \t]*location[ \t]+(?:(=|~\*|~|\^~)[ \t]+)?("(?:[^"\\]|\\.)*"|[^\s{]+)[ \t]*\{', re.M)


class Location:
    """One location block: its modifier ('' for a plain prefix), pattern and body text."""

    def __init__(self, mod: str, pattern: str, body: str):
        self.mod, self.pattern, self.body = mod, pattern, body

    def redirect(self, m: re.Match | None) -> str | None:
        """The target of its `return 301`, with $1, $2 ... from the regex match, or None."""
        r = re.search(r"\breturn\s+301\s+(\S+);", self.body)
        if not r:
            return None
        return re.sub(r"\$(\d)", lambda g: (m.group(int(g.group(1))) or "") if m else "", r.group(1))


def locations(conf: str) -> list[Location]:
    """Every location block in file order (bodies by brace depth; the config has no braces inside quotes)."""
    out = []
    for m in _LOC.finditer(conf):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(conf[i], 0)
            i += 1
        out.append(Location(m.group(1) or "", m.group(2).strip('"'), conf[m.end():i - 1]))
    return out


def route(conf: str, uri: str) -> tuple[Location, re.Match | None]:
    """The location nginx picks for this path, and the regex match when a regex location won."""
    locs = locations(conf)
    for loc in locs:
        if loc.mod == "=" and loc.pattern == uri:
            return loc, None
    prefixes = [x for x in locs if x.mod in ("", "^~") and uri.startswith(x.pattern)]
    best = max(prefixes, key=lambda x: len(x.pattern), default=None)
    if best is not None and best.mod == "^~":
        return best, None
    for loc in locs:
        if loc.mod in ("~", "~*"):
            m = re.search(loc.pattern, uri, re.I if loc.mod == "~*" else 0)
            if m:
                return loc, m
    if best is None:
        raise AssertionError(f"no location for {uri}")
    return best, None


def trusts_only_the_front_proxy(body: str) -> bool:
    """The API is told the address the hub's front proxy appended, never one the visitor wrote himself."""
    return ("set_real_ip_from" in body and re.search(r"\breal_ip_header\s+X-Forwarded-For;", body) is not None
            and re.search(r"\breal_ip_recursive\s+on;", body) is not None
            and re.search(r"proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;", body) is not None
            and "$proxy_add_x_forwarded_for" not in body)


# the first cut's /api/wind block (2b3421c): the visitor's own X-Forwarded-For went on to the API
FIRST_CUT_WIND = """
        limit_except GET { deny all; }
        proxy_pass $api_upstream$request_uri;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Cookie "";
"""


class SceneUrls(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_bare_scene_urls_are_sent_to_the_slash_form(self):
        for uri, want in (("/en/scenes/70b50d42", "/en/scenes/70b50d42/"), ("/ru/scenes/0230d903", "/ru/scenes/0230d903/"),
                          ("/pl/scenes", "/pl/scenes/")):
            loc, m = route(self.conf, uri)
            self.assertEqual(loc.redirect(m), want, uri)

    def test_the_slash_forms_reach_the_api(self):
        for uri in ("/en/scenes/", "/es/scenes/70b50d42/", "/scenes/sitemap.xml", "/scenes/llms.txt", "/api/wind/70b50d42"):
            loc, _ = route(self.conf, uri)
            self.assertIn("proxy_pass $api_upstream", loc.body, uri)
        # anything else under /{lang}/scenes/ is the static site (its 404 page), never the API
        for uri in ("/en/scenes/70b50d42/x", "/en/scenes/NOTHEX", "/de/scenes/70b50d42/"):
            loc, _ = route(self.conf, uri)
            self.assertNotIn("proxy_pass", loc.body, uri)
        self.assertIn("return 404", route(self.conf, "/scene-templates/manifest.json")[0].body)

    def test_control_without_the_redirect_a_bare_scene_url_falls_to_the_static_404(self):
        cut = re.sub(r'\n[ \t]*location ~ "\^/\(en\|es\|pl\|ru\)/scenes/\(\[0-9a-f\]\{6,32\}\)\$" \{[^}]*\}\n', "\n", self.conf)
        self.assertNotEqual(cut, self.conf, "the redirect location was not found to cut")
        loc, m = route(cut, "/en/scenes/70b50d42")
        self.assertEqual((loc.mod, loc.pattern), ("", "/"))
        self.assertIn("/404.html", loc.body)
        self.assertIsNone(loc.redirect(m))


class ClientAddress(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_rate_limited_routes_take_the_address_the_front_proxy_appended(self):
        for uri in ("/api/wind/70b50d42", "/api/admin/login"):
            loc, _ = route(self.conf, uri)
            self.assertTrue(trusts_only_the_front_proxy(loc.body), uri)

    def test_control_the_first_cut_passed_the_visitors_own_header_on(self):
        self.assertFalse(trusts_only_the_front_proxy(FIRST_CUT_WIND))


if __name__ == "__main__":
    unittest.main()
