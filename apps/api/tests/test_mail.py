"""E-mail to pilots (apps/api/mailer.py, outbox.py, service.py): what a message looks like, STARTTLS before
the password, the 60 s undo window, never the same e-mail twice, retries with backoff, the "unknown"
state when the connection breaks inside DATA, waiting for Gmail's setup, and no thank-you e-mail
without the owner's Send.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only; a fake SMTP server on 127.0.0.1,
a made-up password, a clock the test moves). Every check has a negative control that must fire.
"""
from __future__ import annotations

import email
import email.policy
import json
import re
import ssl
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import mailer  # noqa: E402
from fakes import GMAIL_PASS, GMAIL_USER, FakeSMTP, World, make_cert  # noqa: E402
from mailer import MailError  # noqa: E402

LOCALES = HERE.parents[2] / "packages" / "i18n" / "locales" / "mail"


def mail_text(lang: str) -> dict:
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))


def parse(raw: bytes) -> email.message.EmailMessage:
    return email.message_from_bytes(raw, policy=email.policy.default)


class MailTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name))

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def at(self, seconds: float) -> int:
        """Move the clock and let the worker run once; the number of messages SMTP has received."""
        self.w.now[0] += seconds
        self.w.worker.run_once()
        return len(self.w.smtp.messages)


class Compose(MailTest):
    def test_a_reply_in_the_pilots_language_with_quote_threading_and_signature(self):
        a = self.w.report(message="Add rain\nand wind, please", lang="pl")
        _, first = self.w.service.reply(a["id"], "Thank you, it is planned for November.", "telegram")
        self.assertEqual(self.at(61), 1)
        _, second = self.w.service.reply(a["id"], "It is in now.", "telegram")
        self.assertEqual(self.at(61), 2)
        m1, m2 = (parse(x["data"]) for x in self.w.smtp.messages)
        pl = mail_text("pl")
        self.assertEqual(m2["From"], f"Andrii Shramko <{GMAIL_USER}>")
        self.assertEqual(m2["Reply-To"], m2["From"])
        self.assertEqual(m2["To"], "pilot@example.com")
        self.assertEqual(m2["Subject"], pl["replySubject"].format(id=a["id"]))
        self.assertEqual(m2["Content-Language"], "pl")
        self.assertEqual(m2["Message-ID"], second["messageId"])
        self.assertTrue(re.fullmatch(r"<gsfpv\.R-20261013-0001\.M-2\.[0-9a-f]{8}@gsfpv\.example>", m2["Message-ID"]))
        self.assertIsNone(m1["In-Reply-To"])                       # the first one starts the thread
        self.assertEqual(m2["In-Reply-To"], first["messageId"])   # the second answers the first
        self.assertEqual(m2["References"], first["messageId"])
        plain = m2.get_body(("plain",)).get_content().replace("\r\n", "\n")  # CRLF on the wire
        html = m2.get_body(("html",)).get_content()
        self.assertIn("It is in now.", plain)
        self.assertIn(pl["quoteHeader"].format(date="2026-10-13 10:00 UTC", id=a["id"]), plain)
        self.assertIn("> Add rain\n> and wind, please", plain)
        self.assertIn("https://www.linkedin.com/in/andrii-shramko/", plain)
        self.assertIn("https://gsfpv.example/pl/", plain)
        self.assertIn("<blockquote", html)
        # nothing a spam filter frowns on: no images, no tracking, only our two links
        self.assertNotIn("<img", html.lower())
        self.assertEqual(set(re.findall(r'href="([^"]+)"', html)), {"https://gsfpv.example/pl/", "https://www.linkedin.com/in/andrii-shramko/"})
        # control: another pilot's language gives that language's subject
        b = self.w.report(rid="R-20261013-0002", lang="ru")
        self.w.service.reply(b["id"], "Spasibo", "telegram")
        self.at(61)
        self.assertEqual(parse(self.w.smtp.messages[-1]["data"])["Subject"], mail_text("ru")["replySubject"].format(id=b["id"]))

    def test_a_reply_to_a_note_never_quotes_the_owners_note(self):
        """A /note holds the OWNER's words about the pilot: they are not quoted back as "you wrote" and
        the footer does not claim a feedback form (review R1)."""
        pl = mail_text("pl")
        note = self.w.service.add_note("Pilot Jan wants night scenes, told me at the meetup", "telegram",
                                       contact="jan@example.com", lang="pl")
        self.w.service.reply(note["id"], "Nocne sceny są w planie.", "telegram")
        self.assertEqual(self.at(61), 1)
        m = parse(self.w.smtp.messages[0]["data"])
        plain = m.get_body(("plain",)).get_content().replace("\r\n", "\n")
        html = m.get_body(("html",)).get_content()
        self.assertEqual(m["Subject"], pl["replySubjectNote"].format(id=note["id"]))
        for body in (plain, html):
            self.assertIn("Nocne sceny są w planie.", body)
            self.assertNotIn("told me at the meetup", body)
            self.assertNotIn("Twoja wiadomość z", body)          # the quote's header
            self.assertNotIn(pl["footer"], body)                 # "...w formularzu opinii..."
            self.assertIn(pl["footerNote"], body)
        self.assertNotIn("<blockquote", html)
        # control: a pilot's own report IS quoted, under the form's footer
        a = self.w.report(message="Add rain", lang="pl")
        self.w.service.reply(a["id"], "Odpowiedź", "telegram")
        self.assertEqual(self.at(61), 2)
        r = parse(self.w.smtp.messages[1]["data"]).get_body(("plain",)).get_content().replace("\r\n", "\n")
        self.assertIn("> Add rain", r)
        self.assertIn(pl["footer"], r)
        self.assertNotIn(pl["footerNote"], r)

    def test_a_fixed_bug_is_thanked_as_a_fixed_problem(self):
        """The thank-you for a bug speaks of the problem the pilot reported, not of "your idea" (review R5)."""
        en = mail_text("en")
        bug = self.w.report(kind="bug", message="Drone falls through floor", lang="en")
        idea = self.w.report(rid="R-20261013-0002", kind="idea", lang="en")
        _, d_bug = self.w.service.set_done_summary(bug["id"], {"en": "Fixed the floor collision"}, "agent")
        _, d_idea = self.w.service.set_done_summary(idea["id"], {"en": "Rain is in"}, "agent")
        self.assertEqual(d_bug["subject"], en["doneSubjectBug"].format(id=bug["id"]))
        self.assertIn(en["doneIntroBug"].format(id=bug["id"]), d_bug["plain"])
        self.assertNotIn(en["doneIntro"].format(id=bug["id"]), d_bug["plain"])
        self.assertNotIn("Your idea", d_bug["subject"])
        # control: an idea keeps the idea's thank-you
        self.assertEqual(d_idea["subject"], en["doneSubject"].format(id=idea["id"]))
        self.assertIn(en["doneIntro"].format(id=idea["id"]), d_idea["plain"])

    def test_tls_none_only_on_this_machine(self):
        env = {"GMAIL_USER": GMAIL_USER, "GMAIL_APP_PASSWORD": GMAIL_PASS, "SMTP_TLS": "none"}
        self.assertEqual(mailer.MailConfig.from_env({**env, "SMTP_HOST": "smtp.gmail.com"}).tls, "starttls")
        self.assertEqual(mailer.MailConfig.from_env(env).tls, "starttls")  # the default host is Gmail's
        self.assertEqual(mailer.MailConfig.from_env({**env, "SMTP_HOST": "127.0.0.1"}).tls, "none")  # control
        self.assertFalse(mailer.MailConfig.from_env({"GMAIL_USER": GMAIL_USER}).configured)
        self.assertTrue(mailer.MailConfig.from_env({**env, "GMAIL_APP_PASSWORD": "abcd efgh ijkl mnop"}).configured)


class Tls(unittest.TestCase):
    """The real path: STARTTLS, the certificate checked, then the password, then the message."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        cert = make_cert(Path(self.tmp.name))
        if cert is None:
            self.skipTest("openssl is not available to make a test certificate")
        self.crt = cert[0]
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(*cert)
        self.ctx = ctx

    def tearDown(self):
        self.tmp.cleanup()

    def send(self, smtp: FakeSMTP, password: str = GMAIL_PASS):
        cfg = mailer.MailConfig(user=GMAIL_USER, password=password, host="localhost", port=smtp.port, cafile=self.crt, timeout=10)
        m = mailer.Mailer(lambda: cfg, public_origin="https://gsfpv.example")
        mail = {"to": "pilot@example.com", "subject": "s", "messageId": "<x@gsfpv.example>", "plain": "hi", "html": "<p>hi</p>", "lang": "en"}
        m.send(mail)

    def test_password_only_after_starttls(self):
        smtp = FakeSMTP(tls=self.ctx)
        try:
            self.send(smtp)
            self.assertEqual(len(smtp.messages), 1)
            self.assertTrue(smtp.messages[0]["tls"])
            ev = smtp.events
            self.assertLess(ev.index("STARTTLS"), ev.index("AUTH"))
            # control: a server that offers no STARTTLS gets neither the password nor the message
            plain = FakeSMTP(tls=self.ctx, advertise_starttls=False)
            try:
                with self.assertRaises(MailError) as e:
                    self.send(plain)
                self.assertEqual((e.exception.reason, e.exception.transient), ("not-supported", False))
                self.assertNotIn("AUTH", plain.events)
                self.assertEqual(plain.messages, [])
            finally:
                plain.close()
        finally:
            smtp.close()

    def test_wrong_password_is_not_retried(self):
        smtp = FakeSMTP(tls=self.ctx)
        try:
            with self.assertRaises(MailError) as e:
                self.send(smtp, password="wrong")
            self.assertEqual((e.exception.reason, e.exception.transient), ("auth", False))
            self.assertEqual(smtp.messages, [])
        finally:
            smtp.close()


class Outbox(MailTest):
    def test_cancel_in_the_undo_window_sends_nothing(self):
        a = self.w.report()
        _, m1 = self.w.service.reply(a["id"], "first answer", "telegram")
        self.assertEqual(m1["state"], "queued")
        self.assertEqual(self.at(30), 0)                 # inside the window: not yet
        self.w.service.cancel_mail(m1["id"], "telegram")
        self.assertEqual(self.at(31), 0)                 # past the window: cancelled stays unsent
        self.assertEqual(self.at(3600), 0)
        # control: the same without Cancel goes once, right after the window
        _, m2 = self.w.service.reply(a["id"], "second answer", "telegram")
        self.assertEqual(self.at(59), 0)
        self.assertEqual(self.at(2), 1)
        self.assertEqual(self.w.service.find_mail(m2["id"])[1]["state"], "sent")
        self.assertEqual(self.w.service.find_mail(m1["id"])[1]["state"], "cancelled")
        with self.assertRaises(Exception) as e:          # too late to cancel what went
            self.w.service.cancel_mail(m2["id"], "telegram")
        self.assertEqual(getattr(e.exception, "code", ""), "too-late")

    def test_never_the_same_email_twice(self):
        a = self.w.report()
        _, m = self.w.service.reply(a["id"], "answer", "telegram")
        self.assertEqual(self.at(61), 1)
        self.assertEqual(self.at(61), 1)
        self.assertEqual(self.at(86400), 1)
        # a restart while an e-mail was being handed to SMTP: it may have gone, so it is never resent by itself
        _, m2 = self.w.service.reply(a["id"], "another", "telegram")
        self.w.now[0] += 61
        self.assertIsNotNone(self.w.service.claim(m2["id"]))   # the worker took it ... and the process died
        self.w.service.recover()
        self.assertEqual(self.w.service.find_mail(m2["id"])[1]["state"], "unknown")
        self.assertEqual(self.at(86400), 1)
        # control: the owner's explicit Send gets it out (once more, his decision)
        self.w.service.send_mail(m2["id"], "telegram")
        self.assertEqual(self.at(61), 2)
        self.assertEqual(self.at(61), 2)

    def test_a_transient_failure_is_retried_after_a_backoff_a_permanent_one_is_not(self):
        a = self.w.report()
        self.w.smtp.plan["MAIL"] = [421]
        _, m = self.w.service.reply(a["id"], "answer", "telegram")
        self.assertEqual(self.at(61), 0)
        got = self.w.service.find_mail(m["id"])[1]
        self.assertEqual((got["state"], got["error"], got["attempts"]), ("failed", "smtp-421", 1))
        self.assertIsNotNone(got["nextAt"])
        self.assertEqual(self.at(30), 0)                 # the backoff is 60 s
        self.assertEqual(self.at(31), 1)
        self.assertEqual(self.w.service.find_mail(m["id"])[1]["state"], "sent")
        # control: a permanent refusal (550) is not retried
        self.w.smtp.plan["MAIL"] = [550]
        _, m2 = self.w.service.reply(a["id"], "again", "telegram")
        self.assertEqual(self.at(61), 1)
        got = self.w.service.find_mail(m2["id"])[1]
        self.assertEqual((got["state"], got["nextAt"]), ("failed", None))
        self.assertEqual(self.at(86400), 1)

    def test_broken_inside_data_is_unknown_and_not_retried(self):
        a = self.w.report()
        self.w.smtp.plan["DATA"] = ["drop"]
        _, m = self.w.service.reply(a["id"], "answer", "telegram")
        self.at(61)
        got = self.w.service.find_mail(m["id"])[1]
        self.assertEqual(got["state"], "unknown")
        self.assertEqual(self.at(86400), 0)
        self.assertEqual(self.w.service.find_mail(m["id"])[1]["attempts"], 1)
        # control: the next one, with the connection intact, is sent
        _, m2 = self.w.service.reply(a["id"], "answer 2", "telegram")
        self.assertEqual(self.at(61), 1)

    def test_without_gmail_it_waits_and_goes_only_on_send(self):
        self.w.env.pop("GMAIL_APP_PASSWORD")
        a = self.w.report()
        _, m = self.w.service.reply(a["id"], "answer", "telegram")
        self.assertEqual(m["state"], "waiting_setup")
        self.assertEqual(self.at(86400), 0)
        self.w.env["GMAIL_APP_PASSWORD"] = GMAIL_PASS     # Gmail set up, the container recreated
        events = []
        self.w.service.listeners.append(lambda e, rec, mail, by: events.append(e))
        self.w.service.recover()
        self.assertEqual(events, ["mail-ask"])
        self.w.service.recover()
        self.assertEqual(events, ["mail-ask"])           # asked once, not at every start
        self.assertEqual(self.at(86400), 0)              # asking is not sending
        self.w.service.send_mail(m["id"], "telegram")
        self.assertEqual(self.at(61), 1)
        # control: configured from the start, a reply is queued at once
        _, m2 = self.w.service.reply(a["id"], "answer 2", "telegram")
        self.assertEqual(m2["state"], "queued")

    def test_no_email_address_no_email(self):
        a = self.w.report(contact="@pilot_on_telegram")
        _, m = self.w.service.reply(a["id"], "answer", "telegram")
        self.assertEqual((m["state"], m["to"]), ("no_email", ""))
        self.assertEqual(self.at(86400), 0)
        # control: an address anywhere in the contact is used
        b = self.w.report(rid="R-20261013-0002", contact="tg @x, mail: pilot2@example.com")
        _, m2 = self.w.service.reply(b["id"], "answer", "telegram")
        self.assertEqual((m2["state"], m2["to"]), ("queued", "pilot2@example.com"))

    def test_the_thank_you_email_needs_the_owners_send(self):
        a = self.w.report(lang="es")
        rec, draft = self.w.service.set_done_summary(a["id"], {"es": "Lluvia en todas las escenas."}, "agent")
        self.assertEqual((rec["status"], draft["state"], draft["kind"]), ("done", "draft", "done"))
        self.assertEqual(self.at(86400 * 7), 0)          # a week later: still only a draft
        # the owner edits the text: still a draft, one draft
        rec, draft = self.w.service.set_done_summary(a["id"], "Lluvia y viento en todas las escenas.", "telegram")
        self.assertEqual([m["state"] for m in rec["thread"]], ["draft"])
        self.assertEqual(self.at(86400), 0)
        # control: Send queues it, it goes after the window, once
        self.w.service.send_done(a["id"], "telegram")
        self.assertEqual(self.at(61), 1)
        msg = parse(self.w.smtp.messages[0]["data"])
        es = mail_text("es")
        self.assertEqual(msg["Subject"], es["doneSubject"].format(id=a["id"]))
        body = msg.get_body(("plain",)).get_content()
        self.assertIn(es["doneIntro"].format(id=a["id"]), body)
        self.assertIn("Lluvia y viento en todas las escenas.", body)
        self.assertIsNotNone(self.w.service.get(a["id"])["notified"])
        with self.assertRaises(Exception) as e:          # pressing Send again finds no draft
            self.w.service.send_done(a["id"], "telegram")
        self.assertEqual(getattr(e.exception, "code", ""), "no-draft")
        self.assertEqual(self.at(86400), 1)


if __name__ == "__main__":
    unittest.main()
