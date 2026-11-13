"""The Shramko RC bridge in the CSP (lane rc2, stage 3, docs/wip/rc2.md).

The simulator page may connect to ws://127.0.0.1:47310 (the bridge serving a DJI RC 2's sticks on the pilot's own
computer); no other page may open any loopback connection. The CSP text both headers share takes the bridge source
from the map $gsfpv_rc_bridge, which is non-empty only for /{lang}/fly/ URIs. Each check returns what is wrong, so it
runs on the real config (nothing) and on copies with a planted fault (something).
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from test_nginx_routes import CONF, OTHER_PAGE_URIS, SIMULATOR_URIS, _CSP_REST

ROOT = Path(__file__).resolve().parents[3]
BRIDGE_TS = ROOT / "apps" / "fly" / "src" / "devices" / "dji-rc2-bridge.ts"
BRIDGE_PY = ROOT / "tools" / "rc-bridge" / "rc_bridge.py"
_MAP = re.compile(r"map\s+\$uri\s+\$gsfpv_rc_bridge\s*\{([^}]*)\}")
_ENTRY = re.compile(r'^\s*("[^"]*"|\S+)\s+"([^"]*)";\s*$', re.M)


def bridge_source(conf: str, uri: str) -> str | None:
    """What $gsfpv_rc_bridge gives for `uri` (nginx map: the first matching regex, else default); None without the map."""
    m = _MAP.search(conf)
    if m is None:
        return None
    default = ""
    for key, value in _ENTRY.findall(m.group(1)):
        key = key.strip('"')
        if key == "default":
            default = value
        elif key.startswith("~") and re.search(key[1:], uri):
            return value
    return default


def connect_src(conf: str, uri: str) -> list[str]:
    """The connect-src sources the page at `uri` gets, with $gsfpv_rc_bridge filled in."""
    rest = _CSP_REST.search(conf)
    if rest is None:
        return []
    text = rest.group(1).replace("$gsfpv_rc_bridge", bridge_source(conf, uri) or "")
    for d in text.split(";"):
        parts = d.split()
        if parts and parts[0] == "connect-src":
            return parts[1:]
    return []


def port_of(path: Path, pattern: str) -> int:
    return int(re.search(pattern, path.read_text(encoding="utf-8"), re.M).group(1))


def bridge_problems(conf: str) -> list[str]:
    out = []
    port = port_of(BRIDGE_TS, r"RC_BRIDGE_PORT\s*=\s*(\d+)")
    want = f"ws://127.0.0.1:{port}"
    for uri in SIMULATOR_URIS:
        if want not in connect_src(conf, uri):
            out.append(f"{uri}: connect-src has no {want}")
    for uri in OTHER_PAGE_URIS:
        local = [s for s in connect_src(conf, uri) if re.search(r"127\.0\.0\.1|localhost|\[::1\]", s)]
        if local:
            out.append(f"{uri}: connect-src has a loopback source {local}")
    for uri in SIMULATOR_URIS:
        extra = [s for s in connect_src(conf, uri) if re.search(r"127\.0\.0\.1|localhost|\[::1\]", s) and s != want]
        if extra:
            out.append(f"{uri}: loopback sources other than the bridge {extra}")
    return out


class RcBridgeCsp(unittest.TestCase):
    conf = CONF.read_text(encoding="utf-8")

    def test_only_the_simulator_page_may_reach_the_bridge(self):
        self.assertEqual(bridge_problems(self.conf), [])

    def test_the_three_ports_agree(self):
        ts = port_of(BRIDGE_TS, r"RC_BRIDGE_PORT\s*=\s*(\d+)")
        py = port_of(BRIDGE_PY, r"^PORT\s*=\s*(\d+)")
        self.assertEqual(ts, py)
        self.assertEqual(bridge_source(self.conf, "/en/fly/"), f" ws://127.0.0.1:{ts}")

    def test_control_the_bridge_on_every_page_is_caught(self):
        wide = self.conf.replace("connect-src 'self'$gsfpv_rc_bridge", "connect-src 'self' ws://127.0.0.1:47310", 1)
        self.assertNotEqual(wide, self.conf)
        self.assertTrue(any("/en/: connect-src has a loopback source" in p for p in bridge_problems(wide)))

    def test_control_no_bridge_is_caught(self):
        none = self.conf.replace("connect-src 'self'$gsfpv_rc_bridge", "connect-src 'self'", 1)
        self.assertIn("/en/fly/: connect-src has no ws://127.0.0.1:47310", bridge_problems(none))

    def test_control_a_wider_loopback_is_caught(self):
        wider = self.conf.replace('" ws://127.0.0.1:47310"', '" ws://127.0.0.1:*"', 1)
        self.assertNotEqual(wider, self.conf)
        self.assertTrue(any("loopback sources other than the bridge" in p for p in bridge_problems(wider)))


if __name__ == "__main__":
    unittest.main()
