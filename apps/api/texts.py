"""The words the API says to people other than through the site: the owner's Telegram bot (group "bot",
the owner reads Russian: TG_OWNER_LANG, default ru) and the e-mails to pilots (group "mail", in the
pilot's language). One flat JSON dictionary per language, {"key": "text with {placeholders}"}.

Where they live: packages/i18n/locales/<group>/<lang>.json in the repo (the one home of every
user-facing string, checked by packages/i18n/test/api-parity.test.ts). On the hub they are uploaded next
to the API as api/locales/<group>/ (deploy/README.md), since only api/ is mounted into the container.
API_LOCALES_DIR overrides both (tests).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

LANGS = ("en", "es", "pl", "ru")
HERE = Path(__file__).resolve().parent


def locales_dir(group: str) -> Path:
    """The first of: $API_LOCALES_DIR/<group>, api/locales/<group> (the hub), the repo's dictionaries."""
    for base in (os.environ.get("API_LOCALES_DIR"), HERE / "locales", HERE.parent.parent / "packages" / "i18n" / "locales"):
        if base and (Path(base) / group / "en.json").is_file():
            return Path(base) / group
    raise FileNotFoundError(f"no dictionaries for {group!r}")


class Texts:
    """A group's dictionaries. t() falls back to English for an unknown language or a missing key; the
    values given to it are inserted as they are (format applies to our template only, never to them)."""

    def __init__(self, group: str):
        d = locales_dir(group)
        self.group = group
        self.d = {lang: json.loads((d / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}

    def lang(self, lang: str | None) -> str:
        return lang if lang in LANGS else "en"

    def t(self, lang: str | None, key: str, /, **values) -> str:  # positional-only: a text may have a {lang} of its own
        table = self.d[self.lang(lang)]
        tpl = table.get(key, self.d["en"].get(key))
        if tpl is None:
            raise KeyError(f"{self.group}: no text {key!r}")
        return tpl.format_map(values) if values else tpl
