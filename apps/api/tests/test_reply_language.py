"""The owner's replies and the thank-you e-mails reach the pilot in the language the pilot wrote in (v0.9, owner's
item 4), end to end: service -> outbox -> a fake SMTP server, and the owner's Telegram chat (a fake Telegram),
against a fake Gemini endpoint (fakes.FakeGemini; no network, no real key).

What is checked: a Russian reply to a Polish pilot goes in Polish with the Polish frame, the pilot's language is
found once and kept, the undo window starts after the translation, the owner sees "Translated" with his original
under it and can send his own words instead; without a key or when the service fails a text the pilot cannot
surely read does NOT go (English still does) and goes only on the owner's explicit "as written"; thank-you
drafts say it in the pilot's language; another language gets a translated frame; no e-mail address means no
call at all.

Run: python -m unittest discover -s apps/api/tests -v   (stdlib only). Every check has a negative control that
must fire. Non-ASCII text is written as escapes (B18).
"""
from __future__ import annotations

import email
import email.policy
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import ideas  # noqa: E402
import ownerbot  # noqa: E402
from fakes import OWNER_TOKEN, World  # noqa: E402
from service import IdeaError  # noqa: E402

RU_THANKS = "\u0421\u043f\u0430\u0441\u0438\u0431\u043e! \u0414\u043e\u0431\u0430\u0432\u0438\u043c \u0434\u043e\u0436\u0434\u044c \u0432 \u043d\u043e\u044f\u0431\u0440\u0435."
RU_DONE = "\u0414\u043e\u0436\u0434\u044c \u0442\u0435\u043f\u0435\u0440\u044c \u0435\u0441\u0442\u044c \u0432\u043e \u0432\u0441\u0435\u0445 \u0441\u0446\u0435\u043d\u0430\u0445 \u043d\u0430 \u0443\u043b\u0438\u0446\u0435."
PL_PILOT = "Dodajcie deszcz do scen, prosz\u0119, bardzo mi tego brakuje."
PL_THANKS = "Dzi\u0119kuj\u0119! Dodamy deszcz w listopadzie."
PL_DONE = "Deszcz jest teraz w ka\u017cdej scenie na zewn\u0105trz."
DE_PILOT = "Bitte f\xfcgt Regen zu den Szenen hinzu, das fehlt mir sehr."
EN_DONE = "Rain is in every outdoor scene."
# translations the fake Gemini gives (its default is in no language, which the translator refuses)
EN_THANKS = "Thank you! We will add rain in November."
DE_THANKS = "Danke! Wir fuegen im November Regen hinzu."
PL_RAIN = "Deszcz jest teraz we wszystkich scenach, nie ma sie czym martwic."
CYRILLIC = re.compile("[\u0400-\u04ff]")
LOCALES = HERE.parents[2] / "packages" / "i18n" / "locales" / "mail"


def mail_text(lang: str) -> dict:
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))


class Flow(unittest.TestCase):
    keyed = True

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = World(Path(self.tmp.name), gemini=self.keyed)
        self.g = self.w.gemini
        self.t = self.w.bot.t
        if self.g:
            self.g.sources[RU_THANKS] = self.g.sources[RU_DONE] = "ru"
            self.g.glossary[("pl", RU_THANKS)] = PL_THANKS
            self.g.glossary[("pl", RU_DONE)] = PL_DONE
            self.g.glossary[("en", RU_THANKS)] = EN_THANKS
            self.g.glossary[("de", RU_THANKS)] = DE_THANKS
            self.g.glossary[("pl", EN_DONE)] = PL_RAIN

    def tearDown(self):
        self.w.close()
        self.tmp.cleanup()

    def pilot(self, rid="R-20261013-0001", message=PL_PILOT, lang="pl", wrote=("pl", "Polish"), **kw):
        """A pilot's report; Gemini finds `wrote` in their text."""
        if self.g and wrote:
            self.g.languages[message] = (wrote[0], wrote[1], True)
        return self.w.report(rid=rid, message=message, lang=lang, **kw)

    def at(self, seconds: float) -> int:
        self.w.now[0] += seconds
        self.w.worker.run_once()
        return len(self.w.smtp.messages)

    def sent(self, n: int = -1):
        """(the message, its plain text, its html) of an e-mail the fake SMTP server took."""
        m = email.message_from_bytes(self.w.smtp.messages[n]["data"], policy=email.policy.default)
        return m, m.get_body(("plain",)).get_content().replace("\r\n", "\n"), m.get_body(("html",)).get_content()

    def thread(self, rid: str) -> list[dict]:
        return self.w.service.get(rid)["thread"]


class Reply(Flow):
    def test_a_russian_reply_reaches_a_polish_pilot_in_polish(self):
        rec = self.pilot()
        out, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["state"], mail["lang"], mail["body"], mail["orig"], mail["wait"]), ("queued", "pl", PL_THANKS, RU_THANKS, ""))
        self.assertEqual(mail["tr"], {"from": "ru", "to": "pl", "toName": "Polish", "model": "gemini-2.5-flash"})
        self.assertEqual(out["pilotLang"]["code"], "pl")
        self.assertEqual(self.at(61), 1)
        msg, plain, html = self.sent()
        pl = mail_text("pl")
        self.assertEqual((msg["Subject"], msg["Content-Language"]), (pl["replySubject"].format(id=rec["id"]), "pl"))
        for part in (plain, html):
            self.assertIn(PL_THANKS, part)
            self.assertNotRegex(part, CYRILLIC)                       # not one Russian letter reaches the pilot
        self.assertIn(pl["hello"], plain)
        self.assertIn("> " + PL_PILOT, plain)                          # their own words are quoted as they wrote them
        # control: the owner's words are in the record, never in the e-mail
        self.assertEqual(self.thread(rec["id"])[0]["orig"], RU_THANKS)

    def test_the_pilots_language_is_found_once_and_kept(self):
        rec = self.pilot()
        self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual(len(self.g.of("detect")), 1)
        self.assertEqual(len(self.g.of("translate")), 2)
        self.assertEqual(self.w.service.get(rec["id"])["pilotLang"]["name"], "Polish")
        other = self.pilot(rid="R-20261013-0002", message="Please add rain to the outdoor scenes", wrote=("en", "English"), lang="pl")
        self.w.service.reply(other["id"], RU_THANKS, "telegram")
        self.assertEqual(len(self.g.of("detect")), 2)                  # control: another pilot is asked

    def test_the_undo_window_starts_after_the_translation(self):
        rec = self.pilot()
        real = self.w.translator.plan

        def slow(r, text):
            self.w.now[0] += 20                                         # the translation takes 20 s
            return real(r, text)

        self.w.translator.plan = slow
        started = self.w.now[0]
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual(ideas.parse_iso(mail["notBefore"]), started + 20 + 60)
        self.assertEqual(self.at(59), 0)                                # 79 s after the START and still waiting: the owner is still reading
        self.assertEqual(self.at(2), 1)

    def test_a_pilot_who_wrote_english_on_the_polish_page_gets_english(self):
        rec = self.pilot(message="Please add rain to the outdoor scenes", wrote=("en", "English"), lang="pl")
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["lang"], mail["body"], mail["state"]), ("en", EN_THANKS, "queued"))
        self.at(61)
        msg, plain, _ = self.sent()
        self.assertEqual(msg["Subject"], mail_text("en")["replySubject"].format(id=rec["id"]))
        self.assertIn(mail_text("en")["hello"], plain)

    def test_a_pilot_in_another_language_gets_a_translated_frame(self):
        rec = self.pilot(message=DE_PILOT, wrote=("de", "German"), lang="en")
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["lang"], mail["body"], mail["state"]), ("de", DE_THANKS, "queued"))
        self.assertEqual(self.at(61), 1)
        msg, plain, html = self.sent()
        self.assertEqual(msg["Content-Language"], "de")
        self.assertEqual(msg["Subject"], f"[de] Re: your message about ShramkoGSFPV ({rec['id']})")
        self.assertIn("[de] Hello,", plain)
        self.assertIn("https://gsfpv.example/en/", plain)               # the site has no German pages: the link is English
        self.assertNotIn("<img", html.lower())
        # control: the frame was built once and is kept; the next pilot in German costs no frame request
        again = self.pilot(rid="R-20261013-0002", message=DE_PILOT, wrote=("de", "German"), lang="en")
        self.w.service.reply(again["id"], RU_THANKS, "telegram")
        self.assertEqual(len(self.g.of("translate_strings")), 1)

    def test_a_frame_that_cannot_be_had_is_english_at_worst(self):
        rec = self.pilot(message=DE_PILOT, wrote=("de", "German"), lang="en")
        self.g.script = [("pass",), ("frame-lost-hole",)]
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["lang"], mail["body"], mail["state"]), ("en", EN_THANKS, "queued"))
        self.at(61)
        self.assertEqual(self.sent()[0]["Content-Language"], "en")

    def test_the_agents_cli_shows_the_language_and_the_translation(self):
        import ideas_cli
        rec = self.pilot(lang="en")                                      # wrote Polish on the English page
        self.assertNotIn("wrote=", ideas_cli.render_idea(self.w.service.get(rec["id"])))      # not asked yet
        self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        shown = ideas_cli.render_idea(self.w.service.get(rec["id"]))
        self.assertIn("lang=en", shown)
        self.assertIn("wrote=pl (Polish)", shown)                        # an agent writes the done summary in THIS language
        self.assertIn("translated ru->pl", shown)
        self.w.env.pop("GEMINI_API_KEY")
        held =self.w.service.reply(rec["id"], RU_THANKS, "telegram")[1]
        self.assertEqual(held["state"], "waiting_language")
        self.assertIn(f"{held['id']} reply waiting_language", ideas_cli.render_idea(self.w.service.get(rec["id"])))
        self.assertIn("HELD (no-key)", ideas_cli.render_idea(self.w.service.get(rec["id"])))

    def test_no_address_no_call(self):
        rec = self.pilot(contact="@pilot_on_telegram")
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["state"], mail["lang"], mail["body"], mail["orig"]), ("no_email", "pl", RU_THANKS, None))
        self.assertEqual(self.g.requests, [])                           # nothing to translate: nothing will be sent
        self.assertEqual(self.at(86400), 0)

    def test_a_translation_in_the_wrong_language_never_reaches_the_pilot(self):
        """A model that hands the Russian back (as the 'translation', or saying it is Polish already) must not be believed."""
        rec = self.pilot()
        self.g.glossary[("pl", RU_THANKS)] = RU_THANKS
        for claim in ("ru", "pl"):
            self.g.sources[RU_THANKS] = claim
            out, held = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
            self.assertEqual((held["state"], held["wait"], held["body"], held["tr"], held["orig"]),
                             ("waiting_language", "failed:bad-translation", RU_THANKS, None, None), claim)
        self.assertEqual(self.at(86400), 0)                              # nothing went, however long it waits
        # control: an honest answer goes, with not one Russian letter in it
        self.g.sources[RU_THANKS] = "ru"
        self.g.glossary[("pl", RU_THANKS)] = PL_THANKS
        _, good = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((good["state"], good["body"]), ("queued", PL_THANKS))
        self.assertEqual(self.at(61), 1)
        self.assertNotRegex(self.sent()[1], CYRILLIC)

    def test_a_bug_in_the_translator_never_loses_the_owners_words(self):
        rec = self.pilot()

        def boom(r, text):
            raise ValueError("a bug")

        self.w.translator.plan = boom
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((mail["state"], mail["wait"], mail["body"]), ("waiting_language", "failed:internal", RU_THANKS))
        self.assertEqual(self.at(86400), 0)
        self.assertEqual(self.thread(rec["id"])[0]["id"], mail["id"])   # kept in the thread


class Holds(Flow):
    """A text the pilot cannot surely read does not go: no key, or the service failed."""

    keyed = False

    def test_without_a_key_russian_waits_and_english_goes(self):
        rec = self.pilot(wrote=None)
        _, russian = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((russian["state"], russian["wait"], russian["lang"], russian["body"], russian["orig"]), ("waiting_language", "no-key", "pl", RU_THANKS, None))
        self.assertEqual(self.at(86400 * 3), 0)                          # it never goes by itself
        self.w.service.reply(rec["id"], "Thank you, it is planned for November.", "telegram")      # control: English goes
        self.assertEqual(self.at(61), 1)
        self.assertIn("planned for November", self.sent()[1])
        self.assertEqual([m["state"] for m in self.thread(rec["id"])], ["waiting_language", "sent"])

    def test_the_pilots_own_language_goes_without_a_key_another_does_not(self):
        rec = self.pilot(wrote=None)
        _, polish = self.w.service.reply(rec["id"], PL_THANKS, "telegram")
        _, spanish = self.w.service.reply(rec["id"], "Gracias por la idea, la vamos a probar.", "telegram")
        self.assertEqual((polish["state"], spanish["state"]), ("queued", "waiting_language"))

    def test_only_the_owners_explicit_send_sends_it_as_written(self):
        rec = self.pilot(wrote=None)
        _, held = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual(self.at(86400), 0)
        out, queued = self.w.service.send_mail(held["id"], "telegram")
        self.assertEqual((queued["state"], queued["wait"]), ("queued", ""))
        self.assertEqual(self.at(59), 0)                                  # it has its undo window too
        self.assertEqual(self.at(2), 1)
        self.assertIn(RU_THANKS, self.sent()[1])                          # what he wrote, as he wrote it
        self.assertEqual(self.thread(rec["id"])[0]["state"], "sent")

    def test_the_translation_swap_does_not_apply_to_a_held_text(self):
        rec = self.pilot(wrote=None)
        _, held = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        with self.assertRaises(IdeaError) as e:
            self.w.service.use_original(held["id"], "telegram")
        self.assertEqual(e.exception.code, "no-original")

    def test_a_cancelled_held_text_stays_cancelled(self):
        rec = self.pilot(wrote=None)
        _, held = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.w.service.cancel_mail(held["id"], "telegram")
        with self.assertRaises(IdeaError):
            self.w.service.send_mail(held["id"], "telegram")              # a cancelled e-mail is not sent again (not resendable)
        self.assertEqual(self.at(86400), 0)


class ServiceDown(Flow):
    def test_a_failing_service_holds_the_text_but_the_pilots_language_is_kept(self):
        rec = self.pilot()
        self.g.script = [("pass",), ("http", 503), ("http", 503)]        # detector answers, the translation fails twice
        out, held = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((held["state"], held["wait"], held["body"]), ("waiting_language", "failed:http-503", RU_THANKS))
        self.assertEqual(out["pilotLang"]["code"], "pl")
        self.assertEqual(self.at(86400), 0)
        # control: the service is back, the same owner reply is translated and goes
        _, again = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual((again["state"], again["body"]), ("queued", PL_THANKS))
        self.assertEqual(self.at(61), 1)
        self.assertNotRegex(self.sent()[1], CYRILLIC)


class Original(Flow):
    def test_the_owner_can_send_his_own_words_instead(self):
        rec = self.pilot()
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.w.now[0] += 30
        out, swapped = self.w.service.use_original(mail["id"], "telegram")
        self.assertEqual((swapped["state"], swapped["body"], swapped["orig"], swapped["tr"], swapped["lang"]), ("queued", RU_THANKS, None, None, "pl"))
        self.assertIn(RU_THANKS, swapped["plain"])
        self.assertNotIn(PL_THANKS, swapped["plain"])
        self.assertEqual(ideas.parse_iso(swapped["notBefore"]), self.w.now[0] + 60)      # a new window: he sees what goes
        self.assertEqual(self.at(59), 0)
        self.assertEqual(self.at(2), 1)
        msg, plain, _ = self.sent()
        self.assertIn(RU_THANKS, plain)
        self.assertEqual(msg["Subject"], mail_text("pl")["replySubject"].format(id=rec["id"]))   # the Polish frame stays
        self.assertEqual(len(self.thread(rec["id"])), 1)                  # the same e-mail, not a second one

    def test_it_cannot_be_swapped_twice_after_sending_or_when_there_is_no_translation(self):
        rec = self.pilot()
        _, mail = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.w.service.use_original(mail["id"], "telegram")
        with self.assertRaises(IdeaError) as e:                           # the second press has nothing left to swap
            self.w.service.use_original(mail["id"], "telegram")
        self.assertEqual(e.exception.code, "no-original")
        self.assertEqual(self.at(61), 1)
        with self.assertRaises(IdeaError) as e:
            self.w.service.use_original(mail["id"], "telegram")
        self.assertEqual(e.exception.code, "too-late")
        # control: a cancelled translation and an unknown e-mail are refused too, a translation still waiting is not
        _, second = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.w.service.cancel_mail(second["id"], "telegram")
        with self.assertRaises(IdeaError) as e:
            self.w.service.use_original(second["id"], "telegram")
        self.assertEqual(e.exception.code, "no-original")
        with self.assertRaises(IdeaError) as e:
            self.w.service.use_original("M-99", "telegram")
        self.assertEqual(e.exception.code, "not-found")
        _, third = self.w.service.reply(rec["id"], RU_THANKS, "telegram")
        self.assertEqual(self.w.service.use_original(third["id"], "telegram")[1]["body"], RU_THANKS)

    def test_an_english_reply_in_the_pilots_language_has_no_original(self):
        rec = self.pilot(message="Please add rain to the outdoor scenes", wrote=("en", "English"), lang="en")
        _, mail = self.w.service.reply(rec["id"], "Thanks, it is planned for November.", "telegram")
        self.assertEqual((mail["state"], mail["orig"], mail["tr"]), ("queued", None, None))
        with self.assertRaises(IdeaError) as e:
            self.w.service.use_original(mail["id"], "telegram")
        self.assertEqual(e.exception.code, "no-original")


class Done(Flow):
    def test_a_summary_in_english_reaches_a_polish_pilot_in_polish(self):
        rec = self.pilot()
        out, draft = self.w.service.set_done_summary(rec["id"], {"en": EN_DONE}, "agent")
        self.assertEqual((draft["state"], draft["lang"], draft["body"], draft["orig"]), ("draft", "pl", PL_RAIN, EN_DONE))
        self.assertEqual(draft["tr"]["from"], "en")
        self.assertEqual(out["done"]["summary"], {"en": EN_DONE})
        self.assertEqual(self.at(86400), 0)                              # a draft never goes by itself
        self.w.service.send_done(rec["id"], draft["id"], "telegram")
        self.assertEqual(self.at(61), 1)
        msg, plain, _ = self.sent()
        self.assertEqual(msg["Subject"], mail_text("pl")["doneSubject"].format(id=rec["id"]))
        self.assertIn(PL_RAIN, plain)
        self.assertIn(mail_text("pl")["doneThanks"].format(site="https://gsfpv.example/pl/"), plain)

    def test_a_summary_already_in_the_pilots_language_is_not_translated(self):
        rec = self.pilot()
        _, draft = self.w.service.set_done_summary(rec["id"], {"pl": PL_DONE, "en": EN_DONE}, "agent")
        self.assertEqual((draft["body"], draft["orig"], draft["tr"]), (PL_DONE, None, None))
        self.assertEqual(self.g.of("translate"), [])
        # control: the same summary without the Polish text is translated
        other = self.pilot(rid="R-20261013-0002")
        _, d2 = self.w.service.set_done_summary(other["id"], {"en": EN_DONE}, "agent")
        self.assertEqual(len(self.g.of("translate")), 1)
        self.assertNotEqual(d2["body"], EN_DONE)

    def test_the_owners_russian_summary_is_filed_under_russian_and_translated(self):
        rec = self.pilot()
        out, draft = self.w.service.set_done_summary(rec["id"], RU_DONE, "telegram")
        self.assertEqual(out["done"]["summary"], {"ru": RU_DONE})         # used to be filed under the page's language
        self.assertEqual((draft["body"], draft["orig"], draft["tr"]["from"]), (PL_DONE, RU_DONE, "ru"))
        # a later summary in English by an agent: the Polish draft is built from the newest, translated, not from the Russian text
        out, d2 = self.w.service.set_done_summary(rec["id"], {"en": EN_DONE}, "agent")
        self.assertEqual(out["done"]["summary"], {"ru": RU_DONE, "en": EN_DONE})
        self.assertEqual((d2["body"], d2["orig"]), (PL_RAIN, EN_DONE))
        self.assertEqual([m["state"] for m in self.thread(rec["id"])], ["superseded", "draft"])

    def test_a_summary_that_cannot_be_checked_waits_and_a_newer_one_replaces_it(self):
        rec = self.pilot()
        self.g.script = [("pass",), ("http", 503), ("http", 503)]
        _, held = self.w.service.set_done_summary(rec["id"], RU_DONE, "telegram")
        self.assertEqual((held["state"], held["wait"], held["body"], held["kind"]), ("waiting_language", "failed:http-503", RU_DONE, "done"))
        with self.assertRaises(IdeaError) as e:
            self.w.service.send_done(rec["id"], held["id"], "telegram")  # Send under a draft is for drafts: this one needs "as written"
        self.assertEqual(e.exception.code, "no-draft")
        self.assertEqual(self.at(86400), 0)
        _, fresh = self.w.service.set_done_summary(rec["id"], {"pl": PL_DONE}, "agent")
        self.assertEqual([m["state"] for m in self.thread(rec["id"])], ["superseded", "draft"])
        with self.assertRaises(IdeaError) as e:
            self.w.service.send_mail(held["id"], "telegram")              # a replaced text is never sent
        self.assertEqual(e.exception.code, "stale-draft")
        self.assertEqual(fresh["body"], PL_DONE)

    def test_a_summary_the_model_hands_back_untranslated_waits(self):
        rec = self.pilot()
        self.g.glossary[("pl", RU_DONE)] = RU_DONE
        _, held = self.w.service.set_done_summary(rec["id"], RU_DONE, "telegram")
        self.assertEqual((held["state"], held["wait"], held["body"], held["tr"]), ("waiting_language", "failed:bad-translation", RU_DONE, None))
        self.assertEqual(self.at(86400), 0)
        self.assertIsNone(self.w.service.get(rec["id"])["notified"])     # nobody was thanked

    def test_a_summary_written_while_the_translation_ran_is_not_lost(self):
        rec = self.pilot()
        rid, real, calls = rec["id"], self.w.translator.plan, []

        def racing(r, text):
            calls.append(text)
            if len(calls) == 1:                                           # another writer lands a Polish summary meanwhile
                with self.w.store.tx() as doc:
                    row = ideas.index(doc)[rid]
                    row["status"], row["done"] = "done", {"summary": {"pl": PL_DONE}, "by": "agent", "at": "2026-10-17T10:00:00Z"}
            return real(r, text)

        self.w.translator.plan = racing
        out, draft = self.w.service.set_done_summary(rid, {"en": EN_DONE}, "agent")
        self.assertEqual(calls, [{"en": EN_DONE}, {"pl": PL_DONE, "en": EN_DONE}])      # decided again from what is there now
        self.assertEqual(out["done"]["summary"], {"pl": PL_DONE, "en": EN_DONE})
        self.assertEqual(draft["body"], PL_DONE)

    def test_no_address_no_call(self):
        rec = self.pilot(contact="@pilot_on_telegram")
        out, draft = self.w.service.set_done_summary(rec["id"], RU_DONE, "telegram")
        self.assertIsNone(draft)
        self.assertEqual(self.g.requests, [])
        self.assertEqual(out["done"]["summary"], {"pl": RU_DONE})         # nothing to translate: the page's language, as before


class Frame(Flow):
    keyed = False

    def test_the_frame_of_another_language_is_used_when_it_exists_else_english(self):
        rec = self.pilot(wrote=None)
        plain, html = self.w.mailer.compose("reply", "de", "Body text", rec)
        self.assertIn("Hello,", plain)
        self.assertNotIn("[de]", plain)                                   # no frame yet: English
        self.assertIn("/en/", plain)
        (Path(self.tmp.name) / "mail-frames").mkdir()
        en = self.w.translator._texts().d["en"]
        (Path(self.tmp.name) / "mail-frames" / "de.json").write_text(
            json.dumps({"v": 1, "code": "de", "strings": {k: f"[de] {v}" for k, v in en.items()}}), encoding="utf-8")
        plain, html = self.w.mailer.compose("reply", "de", "Body text", rec)
        self.assertIn("[de] Hello,", plain)
        self.assertIn("[de] On 2026-10-13 10:00 UTC you wrote (" + rec["id"] + "):", plain)
        self.assertEqual(self.w.mailer.subject("reply", "de", rec), f"[de] Re: your message about ShramkoGSFPV ({rec['id']})")
        self.assertIn("Body text", html)
        # control: a language of ours does not look at frames at all
        self.assertEqual(self.w.mailer.compose("reply", "pl", "Body text", rec)[0].count("[de]"), 0)


class Telegram(Flow):
    """What the owner sees and presses."""

    def card(self, **kw) -> tuple[dict, int]:
        rec = self.pilot(**kw)
        mid = self.w.bot.deliver_report(rec, "shared text", None, lambda t: None)
        self.assertIsNotNone(mid)
        return rec, mid

    def texts(self, method: str = "sendMessage") -> list[dict]:
        return self.w.tg.of(method, OWNER_TOKEN)

    def test_the_owner_sees_the_translation_and_his_original_inside_the_undo_window(self):
        rec, card = self.card()
        self.assertEqual(self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card)), "reply")
        shown = self.texts()[-1]
        mail = self.w.service.find_mail("M-1")[1]
        head = self.t("mail.queuedTranslated", to="pilot@example.com", id=rec["id"], s=60, source="Russian", language="Polish")
        self.assertEqual(shown["text"], head + "\n\n" + self.t("draft.subject", subject=mail["subject"]) + "\n\n" + mail["plain"]
                         + "\n\n" + self.t("mail.original") + "\n" + RU_THANKS)
        self.assertIn(PL_THANKS, shown["text"])
        self.assertIn("Translated", self.t("draft.translated", source="x", language="y"))
        self.assertEqual([[b["callback_data"] for b in row] for row in shown["reply_markup"]["inline_keyboard"]], [["x:M-1", "o:M-1"]])
        self.assertEqual(self.at(61), 1)                                   # control: left alone, the translation goes
        self.assertNotRegex(self.sent()[1], CYRILLIC)
        self.assertEqual(self.texts("editMessageText")[-1]["text"], self.t("mail.sent", to="pilot@example.com", id=rec["id"],
                                                                           time=ownerbot._hhmm(self.w.service.find_mail("M-1")[1]["sentAt"])))

    def test_send_my_original_instead(self):
        rec, card = self.card()
        self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card))
        shown_id = self.w.tg._next
        self.w.now[0] += 30
        n = len(self.texts())
        self.assertEqual(self.w.update(11, **self.w.press("o:M-1", shown_id)), "original")
        self.assertEqual(self.texts("answerCallbackQuery")[-1]["text"], self.t("toast.original"))
        old = [e for e in self.texts("editMessageText") if e["message_id"] == shown_id][-1]
        self.assertEqual((old["text"], old["reply_markup"]["inline_keyboard"]), (self.t("mail.originalChosen", to="pilot@example.com", id=rec["id"]), []))
        self.assertEqual(len(self.texts()), n + 1)                         # the new preview: his own words, the usual Cancel
        new = self.texts()[-1]
        self.assertIn(RU_THANKS, new["text"])
        self.assertNotIn(PL_THANKS, new["text"])
        self.assertTrue(new["text"].startswith(self.t("mail.queued", to="pilot@example.com", id=rec["id"], s=60)))
        self.assertEqual([[b["callback_data"] for b in row] for row in new["reply_markup"]["inline_keyboard"]], [["x:M-1"]])
        self.assertEqual(self.at(59), 0)
        self.assertEqual(self.at(2), 1)
        self.assertIn(RU_THANKS, self.sent()[1])
        self.assertEqual(self.texts("editMessageText")[-1]["message_id"], self.w.service.find_mail("M-1")[1]["tgMsg"])   # "sent" edits the new preview
        # a second press (the old button is gone, but a stale client may still send it) changes nothing
        self.assertEqual(self.w.update(12, **self.w.press("o:M-1", shown_id)), "refused:too-late")
        self.assertEqual(self.texts("answerCallbackQuery")[-1]["text"], self.t("mail.tooLate"))

    def test_a_second_press_before_sending_says_there_is_nothing_to_swap(self):
        rec, card = self.card()
        self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card))
        self.w.update(11, **self.w.press("o:M-1", self.w.tg._next))
        self.assertEqual(self.w.update(12, **self.w.press("o:M-1", self.w.tg._next)), "refused:no-original")
        self.assertEqual(self.texts("answerCallbackQuery")[-1]["text"], self.t("mail.noOriginal"))
        self.assertEqual(self.w.update(13, **self.w.press("o:M-77", self.w.tg._next)), "not-ours")      # control: an unknown e-mail is not ours

    def test_a_language_the_dictionary_lacks_is_named_by_the_translator(self):
        rec, card = self.card(message=DE_PILOT, wrote=("de", "German"), lang="en")
        self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card))
        self.assertIn(self.t("mail.queuedTranslated", to="pilot@example.com", id=rec["id"], s=60, source="Russian", language="German"),
                      self.texts()[-1]["text"])

    def test_a_held_text_is_said_not_sent_with_the_way_out(self):
        self.g.close()
        self.w.env.pop("GEMINI_API_KEY")
        rec, card = self.card(wrote=None)
        self.assertEqual(self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card)), "reply")
        shown = self.texts()[-1]
        self.assertEqual(shown["text"], self.t("mail.language", to="pilot@example.com", id=rec["id"], language="Polish", why=self.t("why.noKey")) + "\n\n" + RU_THANKS)
        self.assertEqual([[b["callback_data"] for b in row] for row in shown["reply_markup"]["inline_keyboard"]], [["w:M-1", "x:M-1"]])
        self.assertEqual(self.at(86400), 0)
        self.assertEqual(self.w.update(11, **self.w.press("w:M-1", self.w.tg._next)), "send-again")     # "Send as written"
        again = self.texts()[-1]
        self.assertTrue(again["text"].startswith(self.t("mail.queued", to="pilot@example.com", id=rec["id"], s=60)))
        self.assertEqual(self.at(61), 1)
        self.assertIn(RU_THANKS, self.sent()[1])
        # control: English text in the same situation needs no button
        self.w.update(12, **self.w.owner_msg("Thanks, it is planned for November.", reply_to=card, mid=2))
        self.assertTrue(self.texts()[-1]["text"].startswith(self.t("mail.queued", to="pilot@example.com", id=rec["id"], s=60)))

    def test_a_failed_service_is_named_in_the_notice(self):
        rec, card = self.card()
        self.g.script = [("pass",), ("http", 503), ("http", 503)]
        self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card))
        self.assertIn(self.t("why.failed", code="http-503"), self.texts()[-1]["text"])

    def held_thanks(self) -> tuple[dict, int, int]:
        """A Polish pilot's idea is Done in Telegram and the owner's Russian summary is held (the service is down):
        (the idea, the card's message, the notice's message)."""
        rec, card = self.card()
        self.g.script = [("pass",), ("http", 503), ("http", 503)]
        self.w.update(10, **self.w.press(f"s:d:{rec['id']}", card))
        self.assertEqual(self.w.update(11, **self.w.owner_msg(RU_DONE, reply_to=self.w.tg._next)), "summary")
        return rec, card, self.w.tg._next

    def test_a_held_thank_you_is_written_again_in_a_reply_to_its_notice(self):
        rec, card, notice = self.held_thanks()
        shown = self.texts()[-1]
        why = self.t("why.failed", code="http-503")
        self.assertEqual(shown["text"], self.t("mail.languageDone", to="pilot@example.com", id=rec["id"], language="Polish", why=why) + "\n\n" + RU_DONE)
        self.assertEqual([[b["callback_data"] for b in row] for row in shown["reply_markup"]["inline_keyboard"]], [["w:M-1", "x:M-1"]])
        self.assertEqual(self.w.service.message_target(notice), {"idea": rec["id"], "purpose": "draft", "mail": "M-1"})   # a reply is a summary
        # Done pressed again: the held e-mail is shown, the owner is not asked for a summary that exists
        n = len(self.texts())
        self.w.update(12, **self.w.press(f"s:d:{rec['id']}", card))
        again = self.texts()[-1]
        self.assertEqual(len(self.texts()), n + 1)
        self.assertTrue(again["text"].startswith(self.t("mail.languageDone", to="pilot@example.com", id=rec["id"], language="Polish", why=why)))
        self.assertNotIn("force_reply", json.dumps(again.get("reply_markup") or {}))
        # the service is back; his reply to the notice is the new summary (English goes in the pilot's frame, translated)
        self.assertEqual(self.w.update(13, **self.w.owner_msg(EN_DONE, reply_to=notice, mid=2)), "summary")
        thread = self.thread(rec["id"])
        self.assertEqual([(m["kind"], m["state"]) for m in thread], [("done", "superseded"), ("done", "draft")])    # not an ordinary reply
        draft = self.texts()[-1]
        self.assertIn(PL_RAIN, draft["text"])
        self.assertEqual([b["callback_data"] for b in draft["reply_markup"]["inline_keyboard"][0]], ["m:M-2", f"e:{rec['id']}"])
        self.assertEqual(self.at(86400), 0)                                # nothing went by itself

    def test_a_held_thank_you_can_be_sent_as_written_and_then_the_pilot_is_thanked(self):
        rec, card, notice = self.held_thanks()
        self.assertIsNone(self.w.service.get(rec["id"])["notified"])
        self.assertEqual(self.w.update(12, **self.w.press("w:M-1", notice)), "send-again")
        self.assertEqual(self.at(59), 0)
        self.assertEqual(self.at(2), 1)
        self.assertIn(RU_DONE, self.sent()[1])                             # what he wrote, as he wrote it
        self.assertIsNotNone(self.w.service.get(rec["id"])["notified"])    # the admin stops offering the thank-you
        self.assertEqual([m["kind"] for m in self.thread(rec["id"])], ["done"])

    def test_an_answer_held_for_its_language_is_still_rewritten_in_a_reply_to_the_card(self):
        """Control for the thank-you: the notice of a held ANSWER is the one linked as an e-mail, and the card still works."""
        rec, card = self.card()
        self.g.glossary[("pl", EN_THANKS)] = PL_THANKS
        self.g.script = [("pass",), ("http", 503), ("http", 503)]
        self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card))
        self.assertEqual(self.w.service.message_target(self.w.tg._next), {"idea": rec["id"], "purpose": "mail", "mail": "M-1"})
        self.assertEqual(self.w.update(11, **self.w.owner_msg(EN_THANKS, reply_to=card, mid=2)), "reply")
        self.assertEqual([(m["kind"], m["state"]) for m in self.thread(rec["id"])], [("reply", "waiting_language"), ("reply", "queued")])

    def test_an_english_pilot_is_not_told_neither_in_english_nor_in_english(self):
        self.g.close()
        self.w.env.pop("GEMINI_API_KEY")
        rec, card = self.card(message="Please add rain to the outdoor scenes", wrote=None, lang="en")
        self.assertEqual(self.w.update(10, **self.w.owner_msg(RU_THANKS, reply_to=card)), "reply")
        shown = self.texts()[-1]["text"]
        self.assertEqual(shown, self.t("mail.languageEn", to="pilot@example.com", id=rec["id"], language="English", why=self.t("why.noKey")) + "\n\n" + RU_THANKS)
        self.assertNotIn("English or in English", shown)
        self.assertNotIn("nor in English", shown)
        # control: a Polish pilot is told both languages (the old wording, for the pilot who needs it)
        other, card2 = self.card(rid="R-20261013-0002", wrote=None)
        self.w.update(11, **self.w.owner_msg(RU_THANKS, reply_to=card2, mid=2))
        self.assertIn("Polish", self.texts()[-1]["text"])
        self.assertIn("nor in Polish", self.texts()[-1]["text"])

    def test_the_held_notices_name_the_pilots_language_only_when_it_is_not_english(self):
        for lang in ("en", "es", "pl", "ru"):
            for key, times in (("mail.language", 2), ("mail.languageEn", 0), ("mail.languageDone", 2), ("mail.languageDoneEn", 0)):
                text = self.w.bot.texts.t(lang, key, to="a@b.c", id="R-1", language="XQZ", why="w")
                self.assertEqual(text.count("XQZ"), times, (lang, key))
                self.assertIn("a@b.c", text)

    def test_a_translated_thank_you_draft_says_so_and_shows_the_original(self):
        rec, card = self.card()
        self.w.service.set_done_summary(rec["id"], {"en": EN_DONE}, "agent")
        draft = self.texts()[-1]
        self.assertTrue(draft["text"].startswith(self.t("draft.head", to="pilot@example.com", lang="pl", id=rec["id"])))
        self.assertIn(self.t("draft.translated", source="English", language="Polish"), draft["text"])
        self.assertTrue(draft["text"].endswith(self.t("mail.original") + "\n" + EN_DONE))
        self.assertIn(PL_RAIN, draft["text"])
        self.assertEqual([b["callback_data"] for b in draft["reply_markup"]["inline_keyboard"][0]], ["m:M-1", f"e:{rec['id']}"])
        # control: a draft already in the pilot's language carries no translation note
        other, _ = self.card(rid="R-20261013-0002")
        self.w.service.set_done_summary(other["id"], {"pl": PL_DONE}, "agent")
        self.assertNotIn(self.t("draft.translated", source="English", language="Polish"), self.texts()[-1]["text"])

    def test_the_owners_own_summary_in_telegram_is_translated_for_the_pilot(self):
        rec, card = self.card()
        self.w.update(10, **self.w.press(f"s:d:{rec['id']}", card))
        self.assertEqual(self.w.update(11, **self.w.owner_msg(RU_DONE, reply_to=self.w.tg._next)), "summary")
        draft = self.texts()[-1]
        self.assertIn(PL_DONE, draft["text"])
        self.assertTrue(draft["text"].endswith(self.t("mail.original") + "\n" + RU_DONE))
        self.assertEqual(self.at(86400 * 3), 0)                             # nothing goes without Send

    def test_the_dictionaries_name_the_four_languages(self):
        for code, name in (("en", "English"), ("es", "Spanish"), ("pl", "Polish"), ("ru", "Russian")):
            self.assertEqual(self.w.bot.label(code), name)
        self.assertEqual(self.w.bot.label("de", "German"), "German")        # another language: the translator's name
        self.assertEqual(self.w.bot.label("de"), "de")                      # ... or its code
        self.assertEqual(self.w.bot.label(""), self.t("lang.unknown"))


if __name__ == "__main__":
    unittest.main()
