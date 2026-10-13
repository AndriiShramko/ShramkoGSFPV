"""The scene pages' template language (apps/api/templating.py): escaping, raw slots, blocks, and that a
value is never read as template code. Every check has a negative control that must fire."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from templating import Template, TemplateError, json_for_script  # noqa: E402

HOSTILE = '"><img src=x onerror=alert(1)></title><script>alert(2)</script>{{head}}[[#faq]]'


class Templating(unittest.TestCase):
    def test_text_is_escaped_everywhere(self):
        t = Template('<a href="{{href}}" title="{{t}}">{{t}}</a>')
        out = t.render({"href": "/en/", "t": HOSTILE})
        self.assertNotIn("<script>", out)
        self.assertNotIn('"><img', out)
        self.assertIn("&lt;script&gt;", out)
        self.assertIn("&quot;&gt;&lt;img", out)
        # control: the same value through a raw slot is markup, which is why raw slots are declared
        raw = Template("{{{t}}}", raw={"t"}).render({"t": HOSTILE})
        self.assertIn("<script>", raw)

    def test_a_value_is_never_template_code(self):
        t = Template("[[#faq]]<q>{{q}}</q>[[/faq]]|{{name}}", raw={"head"})
        out = t.render({"faq": [{"q": "{{head}}"}], "name": "[[#faq]]{{{head}}}", "head": "<b>secret head</b>"})
        self.assertEqual(out, "<q>{{head}}</q>|[[#faq]]{{{head}}}")
        self.assertNotIn("secret head", out)

    def test_blocks(self):
        t = Template("[[#xs]]<li>{{v}}[[?on]]+[[/on]][[^on]]-[[/on]]</li>[[/xs]][[?empty]]E[[/empty]][[^xs]]none[[/xs]]")
        self.assertEqual(t.render({"xs": [{"v": 1, "on": True}, {"v": "<2>", "on": False}]}), "<li>1+</li><li>&lt;2&gt;-</li>")
        self.assertEqual(t.render({"xs": []}), "none")
        self.assertEqual(t.names, {"xs", "v", "on", "empty"})

    def test_parse_errors_at_load_time(self):
        for bad in ("[[#a]]x", "x[[/a]]", "[[#a]][[?b]][[/a]][[/b]]", "{{{undeclared}}}"):
            with self.assertRaises(TemplateError, msg=bad):
                Template(bad)
        # control: the same shapes closed properly load
        Template("[[#a]]x[[/a]][[?b]]y[[/b]]{{{ok}}}", raw={"ok"})

    def test_json_for_script(self):
        s = json_for_script(json.dumps({"name": "</script><script>alert(1)</script>&\u2028"}))
        self.assertNotIn("</script>", s)
        self.assertNotIn("<", s)
        self.assertEqual(json.loads(s)["name"], "</script><script>alert(1)</script>&\u2028")  # still the same data
        # control: plain json.dumps would close the script element
        self.assertIn("</script>", json.dumps({"name": "</script>"}))


if __name__ == "__main__":
    unittest.main()
