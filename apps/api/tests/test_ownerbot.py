"""The owner's Telegram bot (apps/api/ownerbot.py) end to end against a fake Telegram API and a fake SMTP
server: the webhook's secret path and header, only the owner's chat obeyed, every report delivered whole
(card with buttons, the technical details file and the picture), replies by e-mail with Cancel, the
buttons, Comment, /note, /queue, the Done flow whose e-mail goes only on Send, and a shared lead bot that
never gets a webhook.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only, nothing leaves this machine: the
tokens, the secret and the addresses are made up). Every check has a negative control that must fire.
"""
from __future__ import annotations

import base64
import http.client
import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import ownerbot  # noqa: E402
import server  # noqa: E402
from fakes import OWNER_CHAT, OWNER_TOKEN, SECRET, SHARED_TOKEN, World  # noqa: E402

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60 + b"\xff\xd9"


class BotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name))
        self.t = self.w.bot.t

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def texts(self, method: str = "sendMessage", token: str = OWNER_TOKEN) -> list[str]:
        return [p.get("text") or p.get("caption") or "" for p in self.w.tg.of(method, token)]

    def last(self, method: str = "sendMessage") -> dict:
        return self.w.tg.of(method)[-1]

    def card(self, **kw) -> tuple[dict, int]:
        """A report delivered to the owner's chat: (its idea, its card's message id)."""
        rec = self.w.report(**kw)
        mid = self.w.bot.deliver_report(rec, "shared text", None, lambda t: None)
        self.assertIsNotNone(mid)
        return rec, mid

    def at(self, seconds: float) -> int:
        self.w.now[0] += seconds
        self.w.worker.run_once()
        return len(self.w.smtp.messages)


class Http(BotTest):
    """The API process itself (server.Handler) wired to this test's world."""

    def setUp(self):
        super().setUp()
        names = ("DATA_DIR", "REPORTS_FILE", "REPORTS_DIR", "IDEAS", "SERVICE", "BOT", "send_telegram")
        self.saved = {k: getattr(server, k) for k in names}
        d = Path(self.tmp.name)
        server.DATA_DIR, server.REPORTS_FILE, server.REPORTS_DIR = d, self.w.reports, d / "reports"
        server.IDEAS, server.SERVICE, server.BOT = self.w.store, self.w.service, self.w.bot
        self.shared: list[str] = []
        server.send_telegram = lambda text: self.shared.append(text) or 7
        for b in (server._rhits, server._all_hits):
            b.clear()
        self.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.api.serve_forever, daemon=True).start()

    def tearDown(self):
        self.api.shutdown()
        self.api.server_close()
        for k, v in self.saved.items():
            setattr(server, k, v)
        super().tearDown()

    def post(self, path: str, body, headers: dict | None = None) -> tuple[int, bytes]:
        c = http.client.HTTPConnection("127.0.0.1", self.api.server_address[1], timeout=10)
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        c.request("POST", path, body=raw, headers={"Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9", **(headers or {})})
        r = c.getresponse()
        out = r.status, r.read()
        c.close()
        return out

    def hook(self, update: dict, secret: str | None = SECRET, path: str | None = None) -> int:
        h = {"X-Telegram-Bot-Api-Secret-Token": secret} if secret is not None else {}
        return self.post(path or self.w.bot.cfg.webhook_path(), update, h)[0]


class Webhook(Http):
    def test_secret_path_and_secret_header(self):
        help_ = {"update_id": 1, **self.w.owner_msg("/help")}
        path = self.w.bot.cfg.webhook_path()
        self.assertRegex(path, r"^/api/tg/[0-9a-f]{32}$")
        self.assertNotIn(SECRET, path)
        self.assertEqual(self.hook(help_, secret=None), 403)
        self.assertEqual(self.hook(help_, secret=SECRET + "x"), 403)
        self.assertEqual(self.hook(help_, path="/api/tg/" + "0" * 32), 404)
        self.assertEqual(self.post(path, b"[1]", {"X-Telegram-Bot-Api-Secret-Token": SECRET})[0], 400)
        self.assertEqual(self.w.tg.of("sendMessage"), [])     # none of these did anything
        # control: the right path and header are obeyed
        self.assertEqual(self.hook(help_), 200)
        self.assertEqual(self.texts(), [self.t("help", s=60)])
        # without a secret configured there is no webhook at all
        self.w.env.pop("TG_WEBHOOK_SECRET")
        self.assertEqual(self.hook({"update_id": 2, **self.w.owner_msg("/help")}, path=path), 404)

    def test_another_chat_is_ignored(self):
        rec, card = self.card()
        other = {"update_id": 5, **self.w.owner_msg("send this to the pilot", reply_to=card, chat="999")}
        sent_before = len(self.w.tg.calls)
        self.assertEqual(self.hook(other), 200)
        self.assertEqual(len(self.w.tg.calls), sent_before)                   # not a word to anyone
        self.assertEqual(self.w.service.get(rec["id"])["thread"], [])
        self.assertEqual(self.w.bot.handle_update(self.w.press(f"s:a:{rec['id']}", card, chat="999")), "ignored")
        self.assertEqual(self.w.service.get(rec["id"])["status"], "new")
        # control: the owner's own chat
        self.assertEqual(self.hook({"update_id": 6, **self.w.owner_msg("send this to the pilot", reply_to=card)}), 200)
        self.assertEqual([m["state"] for m in self.w.service.get(rec["id"])["thread"]], ["queued"])


class Reports(Http):
    def bug(self) -> dict:
        shot = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()
        b = {"kind": "bug", "message": "The drone falls through the floor\nat the stairs", "contact": "Jan, jan@example.com",
             "locale": "pl", "page": "fly", "scene": "39e63ce9", "release": "608259b", "t": 9000, "hp": "", "diagnosticsConsent": True,
             "diagnostics": {"browser": {"userAgent": "Mozilla/5.0 Chrome/141", "gpu": {"api": "webgpu", "adapter": {"vendor": "nvidia", "architecture": "ada"}},
                                         "screen": {"w": 2560, "h": 1440, "dpr": 1}, "input": "hid"},
                             "frames": {"renderHz": 59.9, "p50ms": 16.7, "p99ms": 21}, "errors": ["10:00:01 error: TypeError: x"],
                             "flightLog": {"format": "gsfpv-flight/2", "records": 3}, "screenshot": shot, "settings": [{"id": "walls", "value": True}]}}
        st, raw = self.post("/api/report", b)
        self.assertEqual(st, 200)
        return json.loads(raw)

    def test_the_whole_report_with_buttons_file_and_picture(self):
        r = self.bug()
        self.assertTrue(r["delivered"])
        rid = r["id"]
        msg = self.w.tg.of("sendMessage", OWNER_TOKEN)[0]
        self.assertEqual(msg["chat_id"], OWNER_CHAT)
        text = msg["text"]
        for part in ("The drone falls through the floor\nat the stairs", "Jan, jan@example.com", "https://gsfpv.example/pl/fly/?scene=39e63ce9",
                     "608259b", self.t("diag.browser", value="Mozilla/5.0 Chrome/141"), "webgpu nvidia ada", "2560x1440",
                     self.t("diag.errors", n=1), "TypeError: x", self.t("diag.log"), self.t("card.hint.email", s=60)):
            self.assertIn(part, text)
        data = [b["callback_data"] for row in msg["reply_markup"]["inline_keyboard"] for b in row]
        self.assertEqual(data, [f"s:a:{rid}", f"s:r:{rid}", f"s:p:{rid}", f"s:d:{rid}", f"u:urgent:{rid}", f"u:high:{rid}",
                                f"u:normal:{rid}", f"u:low:{rid}", f"c:{rid}"])
        doc = self.w.tg.of("sendDocument", OWNER_TOKEN)[0]
        self.assertEqual(doc["document"]["filename"], f"{rid}.json")
        self.assertEqual(doc["document"]["bytes"], (server.REPORTS_DIR / f"{rid}.json").read_bytes())
        self.assertEqual(self.w.tg.of("sendPhoto", OWNER_TOKEN)[0]["photo"]["bytes"], JPEG)
        self.assertEqual(self.w.tg.tokens(), {OWNER_TOKEN})
        self.assertEqual(self.shared, [])
        self.assertEqual(self.w.card_id(rid), 1001)  # the fake's first message id: replies to it find the idea
        # control: without the owner bot, the shared lead bot gets every field and the file, as before plus more
        self.w.env.pop("TG_OWNER_BOT_TOKEN")
        server._rhits.clear()
        r2 = self.bug()
        self.assertTrue(r2["delivered"])
        self.assertEqual(len(self.shared), 1)
        for part in (r2["id"], "Jan, jan@example.com", "at the stairs", "Browser: Mozilla/5.0 Chrome/141", "Page errors: 1; last: 10:00:01 error: TypeError: x"):
            self.assertIn(part, self.shared[0])
        self.assertEqual(self.w.tg.of("sendDocument", SHARED_TOKEN)[0]["document"]["filename"], f"{r2['id']}.json")
        self.assertEqual(len(self.w.tg.of("sendMessage", OWNER_TOKEN)), 1)    # nothing more through the owner bot
        self.assertEqual([m for _, m, _ in self.w.tg.calls if m == "setWebhook"], [])

    def test_a_suspect_is_stored_not_sent(self):
        st, raw = self.post("/api/report", {"kind": "idea", "message": "buy now", "t": 100, "hp": "x"})
        self.assertEqual(st, 200)
        self.assertFalse(json.loads(raw)["delivered"])
        self.assertTrue(self.w.service.get(json.loads(raw)["id"])["suspect"])
        self.assertEqual(self.w.tg.calls, [])
        # control: a person's idea is sent
        self.post("/api/report", {"kind": "idea", "message": "more scenes", "t": 9000})
        self.assertEqual(len(self.w.tg.of("sendMessage", OWNER_TOKEN)), 1)


class SharedBot(BotTest):
    def test_the_shared_lead_bot_never_gets_a_webhook(self):
        self.w.env["TG_OWNER_BOT_TOKEN"] = SHARED_TOKEN
        self.assertFalse(self.w.bot.configured)
        with self.assertRaises(RuntimeError):
            self.w.bot.setup_webhook()
        self.assertFalse(self.w.bot.remove_webhook())
        self.w.env.pop("TG_OWNER_BOT_TOKEN")
        with self.assertRaises(RuntimeError):
            self.w.bot.setup_webhook()
        self.assertEqual(self.w.tg.calls, [])
        # control: the owner's own token gets it, with the secret and only the two update kinds
        self.w.env["TG_OWNER_BOT_TOKEN"] = OWNER_TOKEN
        info = self.w.bot.setup_webhook()
        hook = self.w.tg.of("setWebhook")
        self.assertEqual(len(hook), 1)
        self.assertEqual([t for t, m, _ in self.w.tg.calls if m == "setWebhook"], [OWNER_TOKEN])
        self.assertEqual(hook[0]["url"], "https://gsfpv.example" + self.w.bot.cfg.webhook_path())
        self.assertEqual((hook[0]["secret_token"], hook[0]["allowed_updates"], hook[0]["max_connections"]), (SECRET, ["message", "callback_query"], 1))
        self.assertTrue(info["webhook"] and info["url_is_ours"])
        self.assertNotIn("url", info)

    def test_the_owner_reads_russian_by_default(self):
        self.w.env.pop("TG_OWNER_LANG")
        rec, _ = self.card()
        ru = json.loads((HERE.parents[2] / "packages" / "i18n" / "locales" / "bot" / "ru.json").read_text(encoding="utf-8"))
        self.assertTrue(self.last()["text"].startswith(ru["kind.idea"] + " " + rec["id"]))
        self.assertEqual(self.last()["reply_markup"]["inline_keyboard"][0][0]["text"], ru["btn.accept"])


class Conversation(BotTest):
    def test_a_reply_goes_by_email_after_the_window(self):
        rec, card = self.card(message="Add rain")
        self.assertEqual(self.w.update(10, **self.w.owner_msg("Thanks! Planned for November.", reply_to=card)), "reply")
        note = self.last()
        self.assertEqual(note["text"], self.t("mail.queued", to="pilot@example.com", id=rec["id"], s=60))
        self.assertEqual(note["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "x:M-1")
        self.assertEqual(self.at(59), 0)
        self.assertEqual(self.at(2), 1)
        body = self.w.smtp.messages[0]["data"].decode("utf-8", "replace")
        self.assertIn("Thanks! Planned for November.", body)
        self.assertIn("> Add rain", body)
        edit = self.last("editMessageText")
        sent_at = self.w.service.find_mail("M-1")[1]["sentAt"]
        self.assertEqual(edit["text"], self.t("mail.sent", to="pilot@example.com", id=rec["id"], time=ownerbot._hhmm(sent_at)))
        self.assertEqual(edit["reply_markup"]["inline_keyboard"], [])

    def test_cancel_in_the_window(self):
        rec, card = self.card()
        self.w.update(11, **self.w.owner_msg("answer", reply_to=card))
        note_id = self.w.tg._next
        self.assertEqual(self.w.update(12, **self.w.press("x:M-1", note_id)), "cancel")
        self.assertEqual(self.last("answerCallbackQuery")["text"], self.t("toast.cancelled"))
        self.assertEqual(self.at(3600), 0)
        self.assertEqual(self.last("editMessageText")["text"], self.t("mail.cancelled", to="pilot@example.com", id=rec["id"]))
        # control: a second answer, not cancelled, goes
        self.w.update(13, **self.w.owner_msg("second answer", reply_to=card))
        self.assertEqual(self.at(61), 1)

    def test_a_contact_that_is_not_an_email(self):
        rec, card = self.card(contact="@pilot_on_telegram")
        self.assertIn(self.t("card.hint.other"), self.last()["text"])
        self.w.update(14, **self.w.owner_msg("answer", reply_to=card))
        self.assertEqual(self.last()["text"], self.t("mail.noEmail", id=rec["id"], contact="@pilot_on_telegram"))
        self.assertEqual(self.at(86400), 0)
        self.assertEqual([m["state"] for m in self.w.service.get(rec["id"])["thread"]], ["no_email"])

    def test_the_same_update_twice_is_one_email(self):
        rec, card = self.card()
        upd = self.w.owner_msg("answer", reply_to=card)
        self.assertEqual(self.w.update(20, **upd), "reply")
        self.assertEqual(self.w.update(20, **upd), "duplicate")
        self.assertEqual(self.at(61), 1)
        # control: a new update id is a new answer
        self.assertEqual(self.w.update(21, **upd), "reply")
        self.assertEqual(self.at(61), 2)

    def test_buttons_and_comment(self):
        rec, card = self.card()
        rid = rec["id"]
        self.assertEqual(self.w.update(30, **self.w.press(f"s:a:{rid}", card)), "status")
        self.assertEqual(self.w.update(31, **self.w.press(f"u:urgent:{rid}", card)), "urgency")
        got = self.w.service.get(rid)
        self.assertEqual((got["status"], got["urgency"]), ("accepted", "urgent"))
        edit = self.last("editMessageText")
        self.assertEqual(edit["message_id"], card)
        labels = [b["text"] for row in edit["reply_markup"]["inline_keyboard"] for b in row]
        self.assertIn("• " + self.t("btn.accept"), labels)
        self.assertIn("• " + self.t("btn.urgent"), labels)
        self.assertNotIn("• " + self.t("btn.reject"), labels)        # control: only the chosen ones are marked
        self.assertEqual(self.last("answerCallbackQuery")["text"], self.t("toast.urgency", id=rid, urgency=self.t("urgency.urgent")))
        self.w.update(32, **self.w.press(f"c:{rid}", card))
        prompt = self.last()
        self.assertTrue(prompt["reply_markup"]["force_reply"])
        self.assertEqual(self.w.update(33, **self.w.owner_msg("Use the PlayCanvas weather layer", reply_to=self.w.tg._next)), "comment")
        self.assertEqual([c["text"] for c in self.w.service.get(rid)["comments"]], ["Use the PlayCanvas weather layer"])
        self.assertEqual(self.at(86400), 0)                                   # a comment is not an e-mail
        work, _ = self.w.service.queue()
        self.assertEqual([r["id"] for r in work], [rid])

    def test_note_and_queue(self):
        self.assertEqual(self.w.update(40, **self.w.owner_msg("/note")), "note-empty")
        self.assertEqual(self.last()["text"], self.t("note.empty"))
        self.assertEqual(self.w.service.all(), [])                           # control: an empty note makes nothing
        self.assertEqual(self.w.update(41, **self.w.owner_msg("/note Jan wants crosswind\non the bridge jan@example.com #urgent #pl")), "note")
        note = self.w.service.all()[0]
        self.assertEqual(note["id"], time.strftime("N-%Y%m%d-0001", time.gmtime(self.w.now[0])))
        self.assertEqual((note["text"], note["email"], note["urgency"], note["lang"], note["status"]),
                         ("Jan wants crosswind\non the bridge", "jan@example.com", "urgent", "pl", "new"))
        card = self.w.card_id(note["id"])
        self.assertEqual(self.last()["text"], self.t("note.created", id=note["id"]))
        self.w.update(42, **self.w.owner_msg("/queue"))
        self.assertEqual(self.last()["text"], self.t("queue.empty"))         # new: not in the queue yet
        self.w.update(43, **self.w.press(f"s:a:{note['id']}", card))
        self.w.update(44, **self.w.owner_msg("/queue@GsfpvOwnerBot"))
        q = self.last()["text"]
        self.assertTrue(q.startswith(self.t("queue.title", n=1)))
        self.assertIn(note["id"], q)

    def test_done_then_draft_then_only_send_sends(self):
        rec, card = self.card(lang="pl")
        rid = rec["id"]
        self.w.update(50, **self.w.press(f"s:d:{rid}", card))
        prompt = self.last()
        self.assertEqual(prompt["text"], self.t("prompt.summary", id=rid, lang="pl"))
        self.assertEqual(self.w.update(51, **self.w.owner_msg("Rain is in every outdoor scene.", reply_to=self.w.tg._next)), "summary")
        draft = self.last()
        self.assertTrue(draft["text"].startswith(self.t("draft.head", to="pilot@example.com", lang="pl", id=rid)))
        self.assertIn("Rain is in every outdoor scene.", draft["text"])
        self.assertEqual([b["callback_data"] for b in draft["reply_markup"]["inline_keyboard"][0]], [f"m:{rid}", f"e:{rid}"])
        self.assertEqual(self.at(86400 * 7), 0)                              # no Send, no e-mail, ever
        # control: Send queues it; it goes after the window, once
        self.assertEqual(self.w.update(52, **self.w.press(f"m:{rid}", self.w.tg._next)), "send-done")
        self.assertEqual(self.at(61), 1)
        self.assertEqual(self.w.update(53, **self.w.press(f"m:{rid}", self.w.tg._next)), "refused:no-draft")
        self.assertEqual(self.last("answerCallbackQuery")["text"], self.t("mail.noDraft"))
        self.assertEqual(self.at(86400), 1)
        self.assertIsNotNone(self.w.service.get(rid)["notified"])

    def test_an_agents_summary_reaches_the_owner_as_a_draft(self):
        rec, card = self.card()
        self.w.service.set_done_summary(rec["id"], {"en": "Done by the agent"}, "agent")
        self.assertIn("Done by the agent", self.last()["text"])
        self.assertEqual(self.last()["reply_markup"]["inline_keyboard"][0][0]["callback_data"], f"m:{rec['id']}")
        self.assertEqual(self.at(86400), 0)
        # the owner's Done afterwards shows that draft again instead of asking
        self.w.service.set_status(rec["id"], "in_progress", "admin")
        self.w.update(60, **self.w.press(f"s:d:{rec['id']}", card))
        self.assertIn("Done by the agent", self.last()["text"])


class Facts(unittest.TestCase):
    def test_diag_facts_tolerate_any_shape(self):
        for blob in (b"", b"not json", b"[]", b'{"diagnostics": 5}', b'{"diagnostics": {"browser": "x", "errors": "y"}}'):
            self.assertIsInstance(ownerbot.diag_facts(blob), dict)
            self.assertIsNone(ownerbot.diag_picture(blob))
        bad = json.dumps({"diagnostics": {"screenshot": "data:image/jpeg;base64," + base64.b64encode(b"GIF89a").decode()}}).encode()
        self.assertIsNone(ownerbot.diag_picture(bad))
        good = json.dumps({"diagnostics": {"screenshot": "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()}}).encode()
        self.assertEqual(ownerbot.diag_picture(good), JPEG)  # control


if __name__ == "__main__":
    unittest.main()
