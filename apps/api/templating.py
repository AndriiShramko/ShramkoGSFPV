"""The scene pages' template language (scenepages.py fills templates the site build makes; docs/wip/v07-a.md 4).

Small on purpose, so the template stays the site's design and the API only puts data in:
    {{name}}               the value as escaped text (& < > " ' escaped: safe in text and in quoted attributes)
    {{{name}}}             the value as it is; only for names the caller declares raw (JSON-LD, head tags
                           the API builds and escapes itself)
    [[#name]]...[[/name]]  repeated for each item of a list of dicts (inside, the item's names come first)
    [[?name]]...[[/name]]  shown when the value is truthy;  [[^name]]...[[/name]]  when it is not
Names are [A-Za-z][A-Za-z0-9_]*. A template that does not parse (an unclosed block, a raw name not
declared raw) raises TemplateError when it is loaded, never half-way through a page.
"""
from __future__ import annotations

import html
import re

_TOKEN = re.compile(r"\{\{\{([A-Za-z][A-Za-z0-9_]*)\}\}\}|\{\{([A-Za-z][A-Za-z0-9_]*)\}\}|\[\[([#?^/])([A-Za-z][A-Za-z0-9_]*)\]\]")


class TemplateError(ValueError):
    pass


def esc(v) -> str:
    """Text for HTML: & < > " ' escaped."""
    return html.escape("" if v is None else str(v), quote=True)


class Template:
    """A parsed template: a tree of text, slots and blocks."""

    def __init__(self, text: str, raw: frozenset[str] | set[str] = frozenset()):
        self.raw = frozenset(raw)
        self.names: set[str] = set()  # every name used, for the caller's check against its slot list
        self.tree = self._parse(text)

    def _parse(self, text: str) -> list:
        root: list = []
        stack: list[tuple[str, str, list]] = []  # (kind, name, children)
        cur = root
        pos = 0
        for m in _TOKEN.finditer(text):
            if m.start() > pos:
                cur.append(text[pos:m.start()])
            pos = m.end()
            raw_name, name, op, block = m.group(1), m.group(2), m.group(3), m.group(4)
            if raw_name:
                if raw_name not in self.raw:
                    raise TemplateError(f"{{{{{{{raw_name}}}}}}} is not a raw slot")
                self.names.add(raw_name)
                cur.append(("raw", raw_name))
            elif name:
                self.names.add(name)
                cur.append(("text", name))
            elif op == "/":
                if not stack or stack[-1][1] != block:
                    raise TemplateError(f"[[/{block}]] closes nothing open")
                kind, bname, children = stack.pop()
                cur = stack[-1][2] if stack else root
                cur.append((kind, bname, children))
            else:
                self.names.add(block)
                children: list = []
                stack.append(({"#": "each", "?": "if", "^": "unless"}[op], block, children))
                cur = children
        if stack:
            raise TemplateError(f"[[{stack[-1][1]}]] is never closed")
        if pos < len(text):
            cur.append(text[pos:])
        return root

    def render(self, ctx: dict) -> str:
        out: list[str] = []
        self._emit(self.tree, [ctx], out)
        return "".join(out)

    def _emit(self, nodes: list, scopes: list[dict], out: list[str]) -> None:
        def look(name: str):
            for s in reversed(scopes):
                if name in s:
                    return s[name]
            return None

        for n in nodes:
            if isinstance(n, str):
                out.append(n)
            elif n[0] == "text":
                out.append(esc(look(n[1])))
            elif n[0] == "raw":
                v = look(n[1])
                out.append("" if v is None else str(v))
            elif n[0] == "each":
                items = look(n[1])
                for it in items if isinstance(items, list) else []:
                    self._emit(n[2], scopes + [it if isinstance(it, dict) else {}], out)
            elif n[0] == "if":
                if look(n[1]):
                    self._emit(n[2], scopes, out)
            elif n[0] == "unless":
                if not look(n[1]):
                    self._emit(n[2], scopes, out)


def json_for_script(s: str) -> str:
    """JSON text made safe inside <script type="application/ld+json">: < > & and the line separators as \\u escapes
    (a title "</script><script>..." stays data)."""
    return (s.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
