"""The agents' commands: apps/api/ideas_cli.py (inside the API container) and tools/ideas/ideas.py (on the
agent's machine; it replaced tools/reports/pull.py, which crashed on a Windows console with Polish
letters). Both run here as separate processes, like on the hub and on the PC.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only; fake Telegram and SMTP). Every check
has a negative control that must fire.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parent
REPO = HERE.parents[2]
sys.path.insert(0, str(API))
sys.path.insert(0, str(HERE))
from fakes import World  # noqa: E402

# Polish and Russian letters made from code points: no such letters in this file (B18)
POLISH = "".join(map(chr, (0x17A, 0x144, 0x15B, 0x107, 0x142)))       # z-acute n-acute s-acute c-acute l-stroke
CYR = "".join(map(chr, (0x434, 0x43E, 0x436, 0x434, 0x44C)))           # a Russian word, "rain"
CP1252 = {**os.environ, "PYTHONIOENCODING": "cp1252"}


class Tool(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_list_does_not_crash_on_a_cp1252_console(self):
        inbox = self.d / "inbox"
        inbox.mkdir()
        rec = {"id": "R-20261013-0001", "kind": "idea", "status": "new", "created": "2026-10-13T10:00:00Z", "text": f"Deszcz {POLISH} {CYR}"}
        (inbox / "ideas.json").write_text(json.dumps({"v": 1, "ideas": [rec]}, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run([sys.executable, str(REPO / "tools" / "ideas" / "ideas.py"), "list", "--local"], capture_output=True,
                           env={**CP1252, "IDEAS_INBOX": str(inbox)}, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        self.assertIn(f"Deszcz {POLISH} {CYR}", r.stdout.decode("utf-8"))
        # control: printing the same letters on that console without the fix fails, as pull.py did
        bad = subprocess.run([sys.executable, "-c", f"print({POLISH + CYR!r})"], capture_output=True, env=CP1252, timeout=60)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn(b"UnicodeEncodeError", bad.stderr)

    def test_only_ids_and_shas_travel_on_the_ssh_command_line(self):
        r = subprocess.run([sys.executable, str(REPO / "tools" / "ideas" / "ideas.py"), "status", "R-1; rm -rf /", "done"],
                           capture_output=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"not an idea id", r.stderr)
        r = subprocess.run([sys.executable, str(REPO / "tools" / "ideas" / "ideas.py"), "release", "R-20261013-0001", "$(id)"],
                           capture_output=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"not a commit sha", r.stderr)


class Cli(unittest.TestCase):
    """ideas_cli.py as `docker exec` runs it: its own process, the container's environment."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name))
        self.env = {**CP1252, **self.w.env, "DATA_DIR": self.tmp.name, "PUBLIC_ORIGIN": "https://gsfpv.example"}

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def cli(self, *args: str, stdin: bytes = b"") -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, str(API / "ideas_cli.py"), *args], input=stdin, capture_output=True, env=self.env, timeout=60)

    def test_queue_title_and_summary(self):
        s = self.w.service
        rid = self.w.report(message=f"Rain please {POLISH}", lang="pl")["id"]
        s.set_status(rid, "accepted", "telegram")
        s.set_urgency(rid, "urgent", "telegram")
        s.add_comment(rid, f"Start with the bridge scene {CYR}", "telegram")
        other = s.add_note("waiting for an urgency", "telegram")
        s.set_status(other["id"], "accepted", "telegram")
        r = self.cli("queue")
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        out = r.stdout.decode("utf-8")
        self.assertIn(f"1. [urgent] [accepted] {rid}", out)
        self.assertIn(f"Rain please {POLISH}", out)
        self.assertIn(f"Start with the bridge scene {CYR}", out)
        self.assertIn(other["id"], out.split("waiting for the owner's urgency")[1])
        q = json.loads(self.cli("queue", "--json").stdout)
        self.assertEqual([r["id"] for r in q["queue"]], [rid])
        # the roadmap title needs all four languages
        three = json.dumps({"title": {"en": "Rain", "es": "Lluvia", "pl": "Deszcz"}}).encode()
        r = self.cli("title", rid, stdin=three)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"missing: ru", r.stderr)
        self.assertEqual(s.get(rid)["public"]["title"], {})
        four = json.dumps({"title": {"en": "Rain", "es": "Lluvia", "pl": "Deszcz", "ru": CYR}}, ensure_ascii=False).encode("utf-8")
        self.assertEqual(self.cli("title", rid, stdin=four).returncode, 0)  # control
        self.assertEqual(s.get(rid)["public"]["title"]["ru"], CYR)
        # the agent's summary: done, the owner gets the draft in Telegram, nothing is sent
        r = self.cli("summary", rid, stdin=json.dumps({"pl": f"Deszcz jest {POLISH}"}, ensure_ascii=False).encode("utf-8"))
        self.assertEqual(r.returncode, 0, r.stderr.decode("utf-8", "replace"))
        got = s.get(rid)
        self.assertEqual((got["status"], [m["state"] for m in got["thread"]]), ("done", ["draft"]))
        mail_id = got["thread"][-1]["id"]
        drafts = [p for p in self.w.tg.of("sendMessage") if any(b["callback_data"] == f"m:{mail_id}" for row in (p.get("reply_markup") or {}).get("inline_keyboard", []) for b in row)]
        self.assertEqual(len(drafts), 1)
        self.assertIn(f"Deszcz jest {POLISH}", drafts[0]["text"])
        self.w.now[0] += 86400 * 7
        self.w.worker.run_once()
        self.assertEqual(self.w.smtp.messages, [])
        # control: the owner's Send in Telegram is what sends it
        self.w.bot.handle_update({"update_id": 1, **self.w.press(f"m:{mail_id}", 1)})
        self.w.now[0] += 61
        self.w.worker.run_once()
        self.assertEqual(len(self.w.smtp.messages), 1)

    def test_status_and_unknown_ids(self):
        rid = self.w.report()["id"]
        self.assertEqual(self.cli("status", rid, "in_progress").returncode, 0)
        self.assertEqual(self.w.service.get(rid)["status"], "in_progress")
        r = self.cli("status", "R-20990101-0001", "done")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(b"not-found", r.stderr)


if __name__ == "__main__":
    unittest.main()
