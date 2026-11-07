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
        for uri in ("/api/wind/70b50d42", "/api/admin/login", "/api/session/start", "/api/session/abcdefghijklmnop/3"):
            loc, _ = route(self.conf, uri)
            self.assertTrue(trusts_only_the_front_proxy(loc.body), uri)

    def test_control_the_first_cut_passed_the_visitors_own_header_on(self):
        self.assertFalse(trusts_only_the_front_proxy(FIRST_CUT_WIND))


# ---------------------------------------------------------------- Fly by Sound (v0.12, lane v12-feedback, step 1)
# A recording of the pilot's voice needs the microphone, which the site's Permissions-Policy used to forbid on every
# page (`microphone=()`), and a replay plays that voice from a blob: URL, which a CSP without media-src blocks. The
# upload goes through its own location. Each check below is a function returning what is wrong, so the same function
# is run on the real config (nothing wrong) and on a copy that has the first cut's fault planted (something wrong).
_POLICY = re.compile(r'add_header\s+Permissions-Policy\s+"([^"]+)"\s+always;')
_MIC = re.compile(r"(?:^|,\s*)microphone=\(([^)]*)\)")
_CSP_REST = re.compile(r'map\s+\$uri\s+\$gsfpv_csp_rest\s*\{\s*default\s+"([^"]+)";')

# a Permissions-Policy as the config sent it before v0.12: the microphone was off on the simulator page too
FIRST_CUT_FLY_POLICY = ("hid=(self), gamepad=(self), fullscreen=(self), screen-wake-lock=(self), camera=(), microphone=(), "
                        "geolocation=(), usb=(), serial=(), bluetooth=(), xr-spatial-tracking=()")
SIMULATOR_URIS = ("/en/fly/", "/es/fly/", "/pl/fly/", "/ru/fly/", "/en/fly/index.html", "/pl/fly/some/deep/link")
OTHER_PAGE_URIS = ("/index.html", "/en/", "/ru/privacy/", "/en/licenses/", "/en/sound/", "/fly/assets/app-1a2b3c.js", "/_next/static/chunks/main.js",
                   "/admin/", "/en/scenes/", "/en/scenes/70b50d42/")


def microphone_of(conf: str, uri: str) -> str | None:
    """The allowlist of the microphone directive that the location serving `uri` sends, None without a policy or directive."""
    loc, _ = route(conf, uri)
    p = _POLICY.search(loc.body)
    if p is None:
        return None
    m = _MIC.search(p.group(1))
    return None if m is None else m.group(1)


def microphone_problems(conf: str) -> list[str]:
    """Only the simulator page may use the microphone; every other location that sets a policy keeps it off."""
    out = []
    for uri in SIMULATOR_URIS:
        if microphone_of(conf, uri) != "self":
            out.append(f"{uri}: microphone=({microphone_of(conf, uri)}) instead of (self)")
    for uri in OTHER_PAGE_URIS:
        if microphone_of(conf, uri) not in ("",):
            out.append(f"{uri}: microphone=({microphone_of(conf, uri)}) instead of ()")
    # a policy copied into a block this list does not name is caught here: any other location with (self) is a fault
    for loc in locations(conf):
        p = _POLICY.search(loc.body)
        m = _MIC.search(p.group(1)) if p else None
        if m and m.group(1) not in ("", "self"):
            out.append(f"location {loc.pattern}: microphone=({m.group(1)}) is neither () nor (self)")
        if m and m.group(1) == "self" and "/fly/" not in loc.pattern:
            out.append(f"location {loc.pattern}: microphone=(self) outside the simulator location")
    return out


def csp_problems(conf: str) -> list[str]:
    """The CSP both headers share allows a blob: audio source, and nothing wider."""
    m = _CSP_REST.search(conf)
    if m is None:
        return ["no $gsfpv_csp_rest map"]
    directives = {d.strip().split(" ", 1)[0]: d.strip().split(" ", 1)[1:] for d in m.group(1).split(";") if d.strip()}
    out = []
    media = directives.get("media-src")
    if media is None:
        out.append("no media-src: a blob: <audio> falls back to default-src 'self' and is blocked")
    elif media != ["'self' blob:"]:
        out.append(f"media-src is {media}, want exactly 'self' blob:")
    if directives.get("worker-src") != ["'self' blob:"]:
        out.append("worker-src changed")
    if directives.get("object-src") != ["'none'"]:
        out.append("object-src changed")
    # the owner's admin page has a CSP of its own and plays no audio: it must not gain a media source
    adm, _ = route(conf, "/admin/")
    if "media-src" in adm.body:
        out.append("the admin location got a media-src")
    return out


def session_route_problems(conf: str) -> list[str]:
    """/api/session/... reaches the API through its own location: GET and POST only, 1 MiB chunks, no cookie, the front proxy's address."""
    out = []
    for uri in ("/api/session/start", "/api/session/abcdefghijklmnopqrstuv/0", "/api/session/abcdefghijklmnopqrstuv/17", "/api/session/abcdefghijklmnopqrstuv/finish", "/api/session/abcdefghijklmnopqrstuv"):
        loc, _ = route(conf, uri)
        if (loc.mod, loc.pattern) != ("^~", "/api/session/"):
            out.append(f"{uri}: served by location {loc.mod} {loc.pattern}, not by ^~ /api/session/")
            continue
        body = loc.body
        if not re.search(r"proxy_pass\s+\$api_upstream\$request_uri;", body):
            out.append(f"{uri}: no proxy_pass $api_upstream$request_uri (the token in the query string would be lost)")
        if not re.search(r"limit_except\s+GET\s+POST\s*\{\s*deny\s+all;\s*\}", body):
            out.append(f"{uri}: not limited to GET and POST")
        size = re.search(r"client_max_body_size\s+(\d+)k;", body)
        if size is None or not (1024 + 4 <= int(size.group(1)) <= 2048):
            out.append(f"{uri}: client_max_body_size {size.group(0) if size else 'missing'}: a 1 MiB chunk plus its headers must fit, and not much more")
        if not re.search(r'proxy_set_header\s+Cookie\s+"";', body):
            out.append(f"{uri}: the visitor's cookies are passed on")
        if not re.search(r'proxy_set_header\s+Authorization\s+"";', body):
            out.append(f"{uri}: an Authorization header is passed on")
        if not trusts_only_the_front_proxy(body):
            out.append(f"{uri}: the client address is not the one the front proxy appended")
        if not re.search(r'add_header\s+Cache-Control\s+"no-store"\s+always;', body):
            out.append(f"{uri}: responses are cacheable")
    # the bare prefix and look-alikes are not the API's
    for uri in ("/api/sessions/", "/api/session"):
        loc, _ = route(conf, uri)
        if loc.pattern == "/api/session/":
            out.append(f"{uri} must not reach the session location")
    return out


class FlyBySoundHeaders(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_the_microphone_is_allowed_on_the_simulator_page_only(self):
        self.assertEqual(microphone_problems(self.conf), [])
        for uri in SIMULATOR_URIS:
            self.assertEqual(microphone_of(self.conf, uri), "self", uri)
        for uri in OTHER_PAGE_URIS:
            self.assertEqual(microphone_of(self.conf, uri), "", uri)

    def test_the_simulator_location_changes_nothing_else_in_its_policy(self):
        loc, _ = route(self.conf, "/en/fly/")
        policy = _POLICY.search(loc.body).group(1)
        self.assertEqual(policy, FIRST_CUT_FLY_POLICY.replace("microphone=()", "microphone=(self)"))

    def test_control_the_first_cuts_policy_is_caught(self):
        first_cut = self.conf.replace("camera=(), microphone=(self), geolocation=()", "camera=(), microphone=(), geolocation=()", 1)
        self.assertNotEqual(first_cut, self.conf, "the simulator policy was not found to revert")
        self.assertEqual(microphone_problems(first_cut), [f"{u}: microphone=() instead of (self)" for u in SIMULATOR_URIS])

    def test_control_a_policy_copied_into_the_site_location_is_caught(self):
        # microphone=(self) for the whole site: the landing, the privacy page and the assets could ask for the microphone too
        wide = self.conf.replace("camera=(), microphone=(), geolocation=()", "camera=(), microphone=(self), geolocation=()")
        self.assertNotEqual(wide, self.conf)
        problems = microphone_problems(wide)
        self.assertTrue(any(p.startswith("/en/: microphone=(self)") for p in problems), problems)
        self.assertTrue(any("outside the simulator location" in p for p in problems), problems)

    def test_the_csp_has_a_blob_audio_source_and_no_other_change(self):
        self.assertEqual(csp_problems(self.conf), [])

    def test_control_the_first_cuts_csp_is_caught(self):
        first_cut = self.conf.replace(" media-src 'self' blob:;", "")
        self.assertNotEqual(first_cut, self.conf)
        self.assertEqual(len(csp_problems(first_cut)), 1)
        self.assertIn("no media-src", csp_problems(first_cut)[0])
        wide = self.conf.replace("media-src 'self' blob:", "media-src * data: blob:")
        self.assertIn("media-src is", csp_problems(wide)[0])
        admin_gets_it = self.conf.replace("script-src 'self'; connect-src 'self' https://d28zzqy0iyovbz.cloudfront.net; img-src", "script-src 'self'; media-src blob:; connect-src 'self' https://d28zzqy0iyovbz.cloudfront.net; img-src", 1)
        self.assertNotEqual(admin_gets_it, self.conf)
        self.assertEqual(csp_problems(admin_gets_it), ["the admin location got a media-src"])


class SessionUploadRoute(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_the_session_urls_reach_the_api_through_their_own_location(self):
        self.assertEqual(session_route_problems(self.conf), [])

    def test_the_other_session_like_paths_do_not(self):
        for uri in ("/api/sessions/", "/api/session"):
            loc, _ = route(self.conf, uri)
            self.assertNotEqual(loc.pattern, "/api/session/", uri)
            self.assertNotIn("proxy_pass", loc.body, uri)

    def test_control_without_the_location_the_urls_fall_to_the_static_site(self):
        cut = re.sub(r"\n[ \t]*location \^~ /api/session/ \{.*?\n    \}\n", "\n", self.conf, flags=re.S)
        self.assertNotEqual(cut, self.conf, "the session location was not found to cut")
        loc, _ = route(cut, "/api/session/start")
        self.assertEqual((loc.mod, loc.pattern), ("", "/"))
        self.assertIn("/404.html", loc.body)
        self.assertEqual(len(session_route_problems(cut)), 5)

    def test_control_each_fault_of_the_location_is_caught(self):
        faults = {
            "GET only": ("limit_except GET POST { deny all; }", "limit_except GET { deny all; }"),
            "no limit_except": ("limit_except GET POST { deny all; }", ""),
            "chunks that do not fit": ("client_max_body_size 1100k;", "client_max_body_size 512k;"),
            "no limit on the body": ("client_max_body_size 1100k;", "client_max_body_size 64m;"),
            "the query string is lost": ("proxy_pass $api_upstream$request_uri;", "proxy_pass $api_upstream$uri;"),
            "the visitor's address": ("proxy_set_header X-Forwarded-For $remote_addr;", "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"),
        }
        start = self.conf.index("location ^~ /api/session/ {")
        end = self.conf.index("\n    }\n", start)
        block = self.conf[start:end]
        for name, (old, new) in faults.items():
            self.assertIn(old, block, name)
            broken = self.conf[:start] + block.replace(old, new, 1) + self.conf[end:]
            self.assertNotEqual(session_route_problems(broken), [], name)
        # a cookie or a credential passed on
        for header in ('proxy_set_header Cookie "";', 'proxy_set_header Authorization "";'):
            broken = self.conf[:start] + block.replace(header, "", 1) + self.conf[end:]
            self.assertNotEqual(session_route_problems(broken), [], header)


if __name__ == "__main__":
    unittest.main()
