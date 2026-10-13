"""SuperSplat's licence codes and the words and links the catalogue and the scene pages use for them.

SuperSplat gives a licence only when downloads are on: `downloads.license` is one of by, by-sa, by-nd,
by-nc, by-nc-sa, by-nc-nd (measured 2026-09-27) or cc0; the catalogue keeps the human label ("CC BY 4.0"),
the scene pages link the label back to its legal code.
"""
from __future__ import annotations

import re

_CC = ("by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd")
_CODE_RE = re.compile(r"[a-z0-9-]{1,24}")


def label(code: str | None) -> str:
    """"by-nc" -> "CC BY-NC 4.0"; "cc0" -> "CC0 1.0"; None or junk -> "" (no licence stated)."""
    if not isinstance(code, str) or not _CODE_RE.fullmatch(code):
        return ""
    if code == "cc0":
        return "CC0 1.0"
    return f"CC {code.upper()} 4.0"


def url_of(text: str | None) -> str | None:
    """The legal code's address for a catalogue label ("CC BY 4.0", "CC BY-NC-SA 4.0", "CC0 1.0"), else None."""
    if not isinstance(text, str):
        return None
    t = text.strip().upper()
    if t in ("CC0", "CC0 1.0"):
        return "https://creativecommons.org/publicdomain/zero/1.0/"
    m = re.fullmatch(r"CC ((?:BY)(?:-(?:NC|SA|ND)){0,2})(?: 4\.0)?", t)
    if m and m.group(1).lower() in _CC:
        return f"https://creativecommons.org/licenses/{m.group(1).lower()}/4.0/"
    return None
