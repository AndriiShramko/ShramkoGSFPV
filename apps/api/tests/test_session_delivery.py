"""Tests of the delivery of stored recordings to the owner (apps/api/session_delivery.py), v0.12 step 7: a persistent per-channel queue,
Telegram sendDocument and a mail attachment both streamed from disk, retries with backoff, a notice through the other channel when one fails
three times, recovery after a restart. A fake Telegram (a real HTTP server that reads bodies in blocks) and a fake SMTP server on this machine
stand in for the outside; nothing leaves it.

Run: python3 -m unittest discover -s apps/api/tests -v   (stdlib only). Every claim has a control: the failure is paired with the same call
done right, or the naive way is measured next to the streamed one.
"""
from __future__ import annotations

import email
import email.policy
import http.client
import io
import json
import os
import smtplib
import sys
import threading
import time
import tracemalloc
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ownerbot  # noqa: E402
import server  # noqa: E402
import session_delivery as sd  # noqa: E402
from fakes import GMAIL_PASS, GMAIL_USER  # noqa: E402
from fakes_sessions import BOT_TOKEN, CHAT, MIB, Rig, chunks_of, package, sha  # noqa: E402
from sessions import CHANNELS, SessionStore  # noqa: E402


def parse(msg: dict):
    """A message the SMTP fake took: from its spool file, or from the bytes it held."""
    raw = Path(msg["path"]).read_bytes() if "path" in msg else msg["data"]
    return email.message_from_bytes(raw, policy=email.policy.default)


def attachment_of(m) -> tuple[str, bytes] | None:
    for part in m.walk():
        if part.get_filename():
            return part.get_filename(), part.get_payload(decode=True)
    return None


def text_of(m) -> str:
    body = m.get_body(preferencelist=("plain",))
    return body.get_content() if body is not None else ""


class Delivering(unittest.TestCase):
    def test_both_channels_get_the_package_byte_for_byte(self):
        rig = Rig(self)
        data = package(filler=300_000)
        sid = rig.stored(data)
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "queued", "email": "queued"}, "delivered": False})
        self.assertEqual(rig.delivery.run_once(), 2)
        docs = rig.tg.of("sendDocument")
        self.assertEqual(len(docs), 1)
        d = docs[0]
        self.assertTrue(d["token_ok"])
        self.assertEqual((d["fields"]["chat_id"], d["filename"], d["file"]["bytes"], d["file"]["sha256"], d["file"]["tail_ok"]), (CHAT, f"fly-by-sound-{sid}.zip", len(data), sha(data), True))
        self.assertIn(sid, d["fields"]["caption"])
        self.assertIn("walls-hall", d["fields"]["caption"])
        self.assertEqual(len(rig.smtp.messages), 1)
        m = parse(rig.smtp.messages[0])
        name, payload = attachment_of(m)
        self.assertEqual((name, sha(payload)), (f"fly-by-sound-{sid}.zip", sha(data)))
        self.assertEqual((m["To"], sid in m["Subject"], GMAIL_USER in m["From"]), (GMAIL_USER, True, True))
        self.assertIn(sha(data), text_of(m))
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        meta = rig.store.get(sid)
        self.assertEqual((meta["channels"]["telegram"]["attempts"], meta["channels"]["telegram"]["failures"], meta["channels"]["telegram"]["messageId"] is not None), (1, 0, True))
        # control: a second round sends nothing more
        self.assertEqual(rig.delivery.run_once(), 0)
        self.assertEqual((len(rig.tg.of("sendDocument")), len(rig.smtp.messages)), (1, 1))

    def test_delivered_only_when_both_channels_have_confirmed(self):
        rig = Rig(self)
        sid = rig.stored(package(filler=500))
        rig.tg_worker.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "queued"}, "delivered": False})
        self.assertFalse(SessionStore.delivered(rig.store.get(sid)))
        rig.mail_worker.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})

    def test_a_failing_channel_does_not_hold_the_other_and_each_has_its_own_status(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)]
        sid = rig.stored(package(filler=500))
        self.assertEqual(rig.delivery.run_once(), 2)
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "retrying", "email": "sent"}, "delivered": False})
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["failures"], tg["attempts"], tg["error"], tg["nextAt"] - rig.clock[0]), (1, 1, "telegram-500", 30))
        pub = SessionStore.public_channels(rig.store.get(sid))
        self.assertEqual((pub["telegram"]["status"], pub["telegram"]["error"], pub["email"]["status"]), ("retrying", "telegram-500", "sent"))
        # not before its time
        rig.clock[0] += 29
        self.assertEqual(rig.delivery.run_once(), 0)
        self.assertEqual(len(rig.tg.of("sendDocument")), 1)
        rig.clock[0] += 1                                      # control: at its time it goes, and the e-mail is not sent again
        self.assertEqual(rig.delivery.run_once(), 1)
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual(len(rig.smtp.messages), 1)

    def test_the_pauses_between_tries_grow_by_the_schedule(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * 5
        sid = rig.stored(package(filler=100))
        seen = []
        for i in range(5):
            rig.clock[0] = max(rig.clock[0], rig.channels(sid)["telegram"]["nextAt"])
            rig.tg_worker.run_once()
            seen.append(round(rig.channels(sid)["telegram"]["nextAt"] - rig.clock[0]))
        self.assertEqual(seen, list(sd.BACKOFF_S[:5]))
        rig.clock[0] += sd.BACKOFF_S[4] - 1                    # one second early: nothing
        calls = len(rig.tg.of("sendDocument"))
        rig.tg_worker.run_once()
        self.assertEqual(len(rig.tg.of("sendDocument")), calls)
        rig.clock[0] += 1
        rig.tg_worker.run_once()                               # control: on time, and the plan is used up, so it goes
        self.assertEqual(rig.status(sid)["channels"]["telegram"], "sent")

    def test_a_channel_that_fails_three_times_is_reported_through_the_other_once(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * 4
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()                                # failure 1 (and the e-mail package goes)
        self.assertEqual(len(rig.smtp.messages), 1)
        rig.clock[0] += 10_000
        rig.tg_worker.run_once()                               # failure 2: still no notice (control: two are not three)
        self.assertEqual((rig.channels(sid)["telegram"]["failures"], len(rig.smtp.messages)), (2, 1))
        rig.clock[0] += 10_000
        rig.tg_worker.run_once()                               # failure 3
        self.assertEqual(rig.channels(sid)["telegram"]["failures"], 3)
        self.assertEqual(len(rig.smtp.messages), 2)
        note = parse(rig.smtp.messages[1])
        self.assertIn(f"telegram delivery of recording {sid} failed 3 times", note["Subject"])
        body = text_of(note)
        for part in ("telegram-500", "Reached you by email: yes", "stored on the server", rig.admin_url):
            self.assertIn(part, body)
        self.assertIsNone(attachment_of(note))
        self.assertEqual(rig.channels(sid)["telegram"]["notices"]["3"]["state"], "sent")
        rig.clock[0] += 100_000
        rig.tg_worker.run_once()                               # failure 4: no second notice
        self.assertEqual((rig.channels(sid)["telegram"]["failures"], len(rig.smtp.messages)), (4, 2))

    def test_an_email_channel_that_fails_three_times_is_reported_by_telegram(self):
        rig = Rig(self)
        rig.smtp.plan = {"MAIL": [421, 421, 421]}
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        for _ in range(2):
            rig.clock[0] += 10_000
            rig.mail_worker.run_once()
        self.assertEqual((rig.channels(sid)["email"]["failures"], rig.channels(sid)["email"]["error"]), (3, "smtp-421"))
        notes = [c["fields"]["text"] for c in rig.tg.of("sendMessage")]
        self.assertEqual(len(notes), 1)
        self.assertIn(f"email delivery of recording {sid} failed 3 times", notes[0])
        self.assertIn("smtp-421", notes[0])
        self.assertIn("Reached you by telegram: yes", notes[0])
        rig.clock[0] += 10_000                                  # control: the 4th try goes through (the plan is used up)
        rig.mail_worker.run_once()
        self.assertEqual(rig.status(sid)["delivered"], True)
        self.assertEqual(len(rig.tg.of("sendMessage")), 1)

    def test_a_notice_that_cannot_go_waits_and_goes_when_the_other_channel_is_up(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * 3
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()                                # failure 1; the e-mail package is sent
        rig.mail_config["password"] = "changed-and-wrong"      # now e-mail refuses everything: the notice has no way out
        for _ in range(2):
            rig.clock[0] += 10_000
            rig.tg_worker.run_once()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["failures"], tg["notices"]["3"]["state"]), (3, "pending"))
        self.assertIn(sid, rig.store.due("telegram:notice", tg["noticeAt"]))
        self.assertEqual(len(rig.smtp.messages), 1)
        rig.tg_worker.run_once()                                # not yet time to try the notice again
        self.assertEqual(len(rig.smtp.messages), 1)
        rig.mail_config["password"] = GMAIL_PASS               # control: the other channel is back
        rig.clock[0] = tg["noticeAt"]
        rig.tg_worker.run_once()
        self.assertEqual(len(rig.smtp.messages), 2)
        self.assertEqual(rig.channels(sid)["telegram"]["notices"]["3"]["state"], "sent")
        self.assertNotIn("noticeAt", rig.channels(sid)["telegram"])
        rig.clock[0] += 5000
        rig.tg_worker.run_once()
        self.assertEqual(len(rig.smtp.messages), 2)             # sent once

    def test_a_wrong_bot_token_is_a_counted_failure_and_the_token_never_shows(self):
        rig = Rig(self, token="999999:not-the-bots-token-" + "z" * 12)
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["status"], tg["error"], tg["failures"]), ("retrying", "telegram-401", 1))
        self.assertFalse(rig.tg.of("sendDocument")[0]["token_ok"])
        for _ in range(2):
            rig.clock[0] += 10_000
            rig.tg_worker.run_once()
        everything = json.dumps(rig.store.get(sid)) + "".join(str(parse(m)["Subject"]) + text_of(parse(m)) for m in rig.smtp.messages) + json.dumps(SessionStore.public_channels(rig.store.get(sid)))
        self.assertNotIn("not-the-bots-token", everything)
        self.assertNotIn(BOT_TOKEN, everything)
        self.assertIn("telegram-401", everything)               # the notice says what went wrong, not with what
        rig.tg_config["token"] = BOT_TOKEN                      # control: the right token
        rig.clock[0] += 100_000
        rig.tg_worker.run_once()
        self.assertEqual(rig.status(sid)["channels"]["telegram"], "sent")

    def test_telegrams_retry_after_is_honoured_when_longer_than_the_backoff(self):
        rig = Rig(self)
        rig.tg.plan = [("retry", 900)]
        sid = rig.stored(package(filler=100))
        rig.tg_worker.run_once()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["error"], tg["nextAt"] - rig.clock[0]), ("telegram-429", 900))

    def test_a_channel_gives_up_after_nine_failures_and_the_admins_resend_starts_it_again(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * sd.MAX_FAILURES
        sid = rig.stored(package(filler=100))
        rig.mail_worker.run_once()
        for _ in range(sd.MAX_FAILURES):
            rig.clock[0] += 200_000
            rig.tg_worker.run_once()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["status"], tg["failures"]), ("failed", sd.MAX_FAILURES))
        self.assertEqual(rig.status(sid)["delivered"], False)
        subjects = [parse(m)["Subject"] for m in rig.smtp.messages[1:]]
        self.assertEqual(len(subjects), 2)                      # the notice at 3, and one more when it gave up
        self.assertIn(f"gave up after {sd.MAX_FAILURES} attempts", subjects[1])
        calls = len(rig.tg.of("sendDocument"))
        rig.clock[0] += 10_000_000
        self.assertEqual(rig.tg_worker.run_once(), 0)           # it has stopped
        self.assertEqual(len(rig.tg.of("sendDocument")), calls)
        rig.store.resend(sid, "telegram")                       # the owner's resend
        self.assertEqual(rig.tg_worker.run_once(), 1)
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertNotIn("notices", rig.channels(sid)["telegram"])      # a new run of failures could be reported again

    def test_a_channel_that_is_not_set_up_uses_no_tries_and_the_other_still_delivers(self):
        rig = Rig(self, telegram=False)
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["status"], tg["attempts"], tg["failures"], tg["error"], tg["nextAt"] - rig.clock[0]), ("queued", 0, 0, "not-configured", 60))
        self.assertEqual(rig.tg.calls, [])
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "queued", "email": "sent"}, "delivered": False})
        rig.tg_config.update(token=BOT_TOKEN, chat=CHAT)        # control: set up, it goes at its minute
        rig.clock[0] += 60
        rig.delivery.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual(rig.channels(sid)["telegram"]["attempts"], 1)

    def test_a_package_over_a_channels_cap_goes_as_a_link_and_counts_as_confirmed(self):
        rig = Rig(self, tg_max=1000, mail_max=1000, smtp_spool=True)
        data = package(filler=5000)
        sid = rig.stored(data)
        rig.delivery.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "link", "email": "link"}, "delivered": True})
        self.assertEqual(rig.tg.of("sendDocument"), [])
        text = rig.tg.of("sendMessage")[0]["fields"]["text"]
        self.assertIn(rig.admin_url, text)
        self.assertIn("Too large for Telegram", text)
        m = parse(rig.smtp.messages[0])
        self.assertIsNone(attachment_of(m))
        self.assertIn(rig.admin_url, text_of(m))
        self.assertIn("over the", text_of(m))
        # control: the same package under the default caps goes as a file
        rig2 = Rig(self, smtp_spool=True)
        sid2 = rig2.stored(data)
        rig2.delivery.run_once()
        self.assertEqual(rig2.status(sid2), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual(attachment_of(parse(rig2.smtp.messages[0]))[0], f"fly-by-sound-{sid2}.zip")

    def test_the_default_caps_are_the_decided_ones(self):
        self.assertEqual(sd.MAIL_MAX_BYTES, 15 * 1024 * 1024)                 # plan section 8: Gmail's 25 MB counts the base64 text
        self.assertEqual(sd.TG_MAX_BYTES, 49 * 1024 * 1024)
        self.assertLess(sd.MAIL_MAX_BYTES * 4 // 3 * 78 // 76, 25 * 1000 * 1000)   # base64 and the line breaks of a full-size attachment stay under 25 MB
        self.assertEqual(server._env_int("SESSION_MAIL_MAX_BYTES", sd.MAIL_MAX_BYTES), sd.MAIL_MAX_BYTES)
        with mock.patch.dict(os.environ, {"SESSION_MAIL_MAX_BYTES": "1234"}):
            self.assertEqual(server._env_int("SESSION_MAIL_MAX_BYTES", sd.MAIL_MAX_BYTES), 1234)
        with mock.patch.dict(os.environ, {"SESSION_MAIL_MAX_BYTES": "junk"}):
            self.assertEqual(server._env_int("SESSION_MAIL_MAX_BYTES", sd.MAIL_MAX_BYTES), sd.MAIL_MAX_BYTES)
        with mock.patch.dict(os.environ, {"SESSION_MAIL_MAX_BYTES": "-5"}):
            self.assertEqual(server._env_int("SESSION_MAIL_MAX_BYTES", sd.MAIL_MAX_BYTES), sd.MAIL_MAX_BYTES)
        self.assertEqual(server.SESSION_DELIVERY.workers[1].channel.max_bytes(), sd.MAIL_MAX_BYTES)
        self.assertEqual(server.SESSION_DELIVERY.workers[0].channel.max_bytes(), sd.TG_MAX_BYTES)

    def test_smtp_refusals_are_counted_and_named(self):
        rig = Rig(self, password="not-the-app-password")
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        em = rig.channels(sid)["email"]
        self.assertEqual((em["status"], em["error"]), ("retrying", "smtp-auth"))
        self.assertEqual(rig.status(sid)["channels"]["telegram"], "sent")
        self.assertNotIn("not-the-app-password", json.dumps(rig.store.get(sid)))
        rig.mail_config["password"] = GMAIL_PASS               # control
        rig.clock[0] += 30
        rig.mail_worker.run_once()
        self.assertEqual(rig.status(sid)["delivered"], True)
        rig3 = Rig(self)
        rig3.smtp.plan = {"MAIL": [421]}
        sid3 = rig3.stored(package(filler=101))
        rig3.delivery.run_once()
        self.assertEqual(rig3.channels(sid3)["email"]["error"], "smtp-421")

    def test_a_connection_that_breaks_inside_the_message_is_retried_and_delivered_once_it_works(self):
        rig = Rig(self)
        rig.smtp.plan = {"DATA": ["drop"]}
        sid = rig.stored(package(filler=2000))
        rig.delivery.run_once()
        em = rig.channels(sid)["email"]
        self.assertEqual((em["status"], em["error"]), ("retrying", "broken-in-data"))
        self.assertEqual(len(rig.smtp.messages), 0)
        rig.clock[0] += 30
        rig.mail_worker.run_once()
        self.assertEqual((rig.status(sid)["delivered"], len(rig.smtp.messages)), (True, 1))

    def test_a_package_that_is_gone_is_a_failure_not_a_crash(self):
        rig = Rig(self)
        a, b = rig.stored(package(filler=11)), rig.stored(package(filler=12))
        (rig.dir / "sessions" / a / "package.zip").unlink()
        self.assertEqual(rig.delivery.run_once(), 4)
        self.assertEqual({n: c["error"] for n, c in rig.channels(a).items()}, {"telegram": "package-missing", "email": "package-missing"})
        self.assertEqual(rig.status(b)["delivered"], True)       # the next recording is not held up by it


class Restarting(unittest.TestCase):
    def test_a_send_cut_off_by_a_restart_is_queued_again_and_goes_once(self):
        rig = Rig(self)
        sid = rig.stored(package(filler=400))
        claimed = rig.tg_worker._claim(sid)                       # the process dies right after the claim is on disk
        self.assertEqual(claimed["channels"]["telegram"]["status"], "sending")
        rig.build()                                               # a restart: new store, new channels, recover()
        tg = rig.channels(sid)["telegram"]
        self.assertEqual((tg["status"], tg["recovered"]), ("queued", True))
        rig.delivery.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual((len(rig.tg.of("sendDocument")), len(rig.smtp.messages)), (1, 1))

    def test_what_was_confirmed_before_a_restart_is_not_sent_again(self):
        rig = Rig(self)
        sid = rig.stored(package(filler=400))
        rig.tg_worker.run_once()                                  # Telegram confirmed; the e-mail has not been tried
        self.assertEqual(rig.status(sid)["channels"], {"telegram": "sent", "email": "queued"})
        rig.build()
        self.assertEqual(rig.status(sid)["channels"], {"telegram": "sent", "email": "queued"})
        rig.delivery.run_once()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual((len(rig.tg.of("sendDocument")), len(rig.smtp.messages)), (1, 1))      # not twice

    def test_the_count_of_failures_and_the_notice_survive_restarts(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * 4
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        rig.clock[0] += 10_000
        rig.tg_worker.run_once()
        rig.build()                                               # two failures behind it, then a restart
        self.assertEqual(rig.channels(sid)["telegram"]["failures"], 2)
        self.assertEqual(len(rig.smtp.messages), 1)
        rig.clock[0] += 10_000
        rig.tg_worker.run_once()                                  # the third: reported
        self.assertEqual(len(rig.smtp.messages), 2)
        rig.build()
        rig.clock[0] += 100_000
        rig.tg_worker.run_once()                                  # the fourth, after another restart: not reported again
        self.assertEqual((rig.channels(sid)["telegram"]["failures"], len(rig.smtp.messages)), (4, 2))

    def test_a_pending_notice_survives_a_restart(self):
        rig = Rig(self)
        rig.tg.plan = [("status", 500)] * 3
        sid = rig.stored(package(filler=100))
        rig.delivery.run_once()
        rig.mail_config["password"] = "wrong-for-now"
        for _ in range(2):
            rig.clock[0] += 10_000
            rig.tg_worker.run_once()
        self.assertEqual(rig.channels(sid)["telegram"]["notices"]["3"]["state"], "pending")
        rig.build()
        rig.mail_config["password"] = GMAIL_PASS
        rig.clock[0] += 400
        rig.tg_worker.run_once()
        self.assertEqual(rig.channels(sid)["telegram"]["notices"]["3"]["state"], "sent")
        self.assertEqual(len(rig.smtp.messages), 2)

    def test_the_real_threads_deliver_what_a_started_server_finds_waiting(self):
        rig = Rig(self)
        sid = rig.stored(package(filler=800))
        with mock.patch.object(server, "SESSIONS", rig.store), mock.patch.object(server, "SESSION_DELIVERY", rig.delivery):
            rig.build()
            with mock.patch.object(server, "SESSIONS", rig.store), mock.patch.object(server, "SESSION_DELIVERY", rig.delivery):
                server.start_sessions()                           # what main() does after a restart
                try:
                    t0 = time.time()
                    while not rig.status(sid)["delivered"] and time.time() - t0 < 10:
                        time.sleep(0.05)
                finally:
                    rig.delivery.stop()
        self.assertEqual(rig.status(sid), {"channels": {"telegram": "sent", "email": "sent"}, "delivered": True})
        self.assertEqual((len(rig.tg.of("sendDocument")), len(rig.smtp.messages)), (1, 1))
        self.assertTrue(all(not w._thread.is_alive() for w in rig.delivery.workers))

    def test_housekeeping_removes_what_the_store_says_is_abandoned(self):
        rig = Rig(self)
        up = rig.store.start("c", {"size": 100, "sha256": sha(b"abandoned"), "consentSend": True})
        rig.clock[0] += 25 * 3600
        with mock.patch.object(server, "SESSIONS", rig.store):
            server.sweep_sessions()
        self.assertFalse((rig.dir / "sessions" / up["id"]).exists())
        tomb = [json.loads(x) for x in (rig.dir / "sessions" / "index.jsonl").read_text().splitlines()]
        self.assertEqual((tomb[-1]["id"], tomb[-1]["reason"]), (up["id"], "abandoned"))


class Streaming(unittest.TestCase):
    """Peak memory while a package is sent, measured by tracemalloc over the sender and the fakes (which keep nothing), next to the naive way."""

    @staticmethod
    def peak(fn) -> int:
        tracemalloc.start()
        try:
            fn()
            return tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()

    def test_telegram_streams_a_large_package_from_disk(self):
        size = 20 * MIB
        rig = Rig(self)
        data = package(filler=size)
        sid = rig.stored(data)
        peak = self.peak(rig.tg_worker.run_once)
        doc = rig.tg.of("sendDocument")[0]
        self.assertEqual((doc["file"]["bytes"], doc["file"]["sha256"]), (len(data), sha(data)))       # all of it arrived, intact
        self.assertLess(peak, 3 * MIB, f"peak {peak / MIB:.1f} MiB for a {len(data) / MIB:.1f} MiB package")
        self.assertLessEqual(rig.tg.max_block, 65536)
        # control: the way the owner bot uploads (the whole file in memory) shows up in the same measurement
        naive = self.peak(lambda: ownerbot.TelegramApi(BOT_TOKEN, rig.tg.base, timeout=60).document(CHAT, "x.zip", data))
        self.assertGreater(naive, size)
        self.assertGreater(naive, 8 * peak)
        self.assertEqual(rig.status(sid)["channels"]["telegram"], "sent")

    def test_the_mail_attachment_is_encoded_and_sent_in_pieces(self):
        size = 14 * MIB                                           # under the 15 MiB cap
        rig = Rig(self, smtp_spool=True)
        data = package(filler=size)
        sid = rig.stored(data)
        peak = self.peak(rig.mail_worker.run_once)
        self.assertEqual(rig.status(sid)["channels"]["email"], "sent")
        self.assertLess(peak, 3 * MIB, f"peak {peak / MIB:.1f} MiB for a {len(data) / MIB:.1f} MiB package")
        name, payload = attachment_of(parse(rig.smtp.messages[0]))                # parsed outside the measured part
        self.assertEqual((name, len(payload), sha(payload)), (f"fly-by-sound-{sid}.zip", len(data), sha(data)))
        # control: building the message the usual way (the bytes attached, send_message) in the same measurement
        def naive() -> None:
            from email.message import EmailMessage
            m = EmailMessage()
            m["From"], m["To"], m["Subject"] = GMAIL_USER, GMAIL_USER, "x"
            m.set_content("x")
            m.add_attachment(data, maintype="application", subtype="zip", filename="x.zip")
            s = smtplib.SMTP("127.0.0.1", rig.smtp.port, timeout=60)
            try:
                s.login(GMAIL_USER, GMAIL_PASS)
                s.send_message(m)
            finally:
                s.close()

        naive_peak = self.peak(naive)
        self.assertGreater(naive_peak, 2 * size)
        self.assertGreater(naive_peak, 10 * peak)


class Mime(unittest.TestCase):
    def test_the_message_is_well_formed_whatever_is_in_the_text(self):
        rig = Rig(self, smtp_spool=True)
        rig.email.notice("a\r\nBcc: evil@example.test", ".starts with a dot\n..two dots\nplain line\n.")
        m = parse(rig.smtp.messages[0])
        self.assertEqual(m["Subject"], "[Fly by Sound] a Bcc: evil@example.test")      # one line: no second header could be smuggled in
        self.assertIsNone(m["Bcc"])
        self.assertEqual(text_of(m).replace("\r\n", "\n").strip(), ".starts with a dot\n..two dots\nplain line\n.")        # dot-stuffing round trips
        self.assertEqual(m["Content-Type"].split(";")[0], "text/plain")

    def test_an_attachment_of_every_size_in_blocks_round_trips(self):
        rig = Rig(self, smtp_spool=True)
        sizes = [1, 56, 57, 58, 76, 57 * sd.B64_LINES - 1, 57 * sd.B64_LINES, 57 * sd.B64_LINES + 1, 3 * 57 * sd.B64_LINES + 5]
        for n, size in enumerate(sizes):
            p = rig.dir / f"blob{n}.bin"
            p.write_bytes(os.urandom(size))
            raw = b"".join(sd.message_blocks(GMAIL_USER, "Andrii Shramko", GMAIL_USER, "s", "t", ("blob.bin", p), "example.test"))
            self.assertTrue(raw.endswith(b"\r\n"))
            got = email.message_from_bytes(raw, policy=email.policy.default)
            self.assertEqual(attachment_of(got), ("blob.bin", p.read_bytes()), f"size {size}")
            for line in raw.split(b"\r\n"):
                self.assertLessEqual(len(line), 998)
        # control: a flipped byte in the base64 text is a different file
        raw = bytearray(b"".join(sd.message_blocks(GMAIL_USER, "n", GMAIL_USER, "s", "t", ("blob.bin", p), "example.test")))
        at = raw.index(b"\r\n\r\n", raw.index(b"Content-Disposition: attachment")) + 4 + 10      # ten characters into the base64 text
        raw[at] = ord("A") if raw[at] != ord("A") else ord("B")
        bad = email.message_from_bytes(bytes(raw), policy=email.policy.default)
        self.assertNotEqual(attachment_of(bad)[1], p.read_bytes())

    def test_a_non_ascii_name_or_text_does_not_break_the_send(self):
        rig = Rig(self, smtp_spool=True)
        accent, cyr = chr(0xE9), chr(0x431)                  # built from code points: B18 keeps these letters out of the source
        rig.email.notice(f"caf{accent} {cyr}", f"text {accent} {cyr}")
        m = parse(rig.smtp.messages[0])
        self.assertEqual(m["To"], GMAIL_USER)
        self.assertTrue(text_of(m).startswith("text"))


class Production(unittest.TestCase):
    def test_the_objects_the_server_starts_deliver_with_only_the_environment_as_their_config(self):
        """server.SESSIONS and server.SESSION_DELIVERY as main() builds them, configured by environment names alone (config.env on the hub), against the fakes."""
        rig = Rig(self)
        data = package(filler=3000)
        env = {"TG_BOT_TOKEN": BOT_TOKEN, "TG_CHAT_ID": CHAT, "TG_API_BASE": rig.tg.base, "GMAIL_USER": GMAIL_USER, "GMAIL_APP_PASSWORD": GMAIL_PASS,
               "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(rig.smtp.port), "SMTP_TLS": "none", "SESSION_MAIL_TO": "owner-inbox@example.test"}
        with mock.patch.dict(os.environ, env), mock.patch.object(server, "DATA_DIR", rig.dir), mock.patch.object(server, "free_gb", lambda: 100.0):
            for k in ("TG_OWNER_BOT_TOKEN", "TG_OWNER_CHAT_ID", "SESSION_MAIL_MAX_BYTES", "SESSION_TG_MAX_BYTES"):
                os.environ.pop(k, None)                         # the shell's own, if any (patch.dict puts them back)
            self.addCleanup(server.SESSIONS.recover)             # the module's own indexes forget this temporary directory (DATA_DIR is back by then)
            server.SESSIONS.recover()
            s = server.SESSIONS.start("203.0.113.5", {"size": len(data), "sha256": sha(data), "consentSend": True})
            server.SESSIONS.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(data))
            server.SESSIONS.finish(s["id"], s["token"], None)
            self.assertEqual(server.SESSION_DELIVERY.run_once(), 2)
            st = server.SESSIONS.status(s["id"], s["token"])
        self.assertEqual((st["delivered"], {c: v["status"] for c, v in st["channels"].items()}), (True, {"telegram": "sent", "email": "sent"}))
        self.assertEqual(rig.tg.of("sendDocument")[0]["file"]["sha256"], sha(data))
        m = parse(rig.smtp.messages[0])
        self.assertEqual(m["To"], "owner-inbox@example.test")                       # SESSION_MAIL_TO, not the Gmail address
        self.assertEqual(rig.smtp.messages[0]["to"], ["owner-inbox@example.test"])  # and the envelope says so too
        self.assertEqual(sha(attachment_of(m)[1]), sha(data))

    def test_without_the_environment_nothing_is_sent_and_nothing_is_lost(self):
        rig = Rig(self)
        data = package(filler=2000)
        with mock.patch.dict(os.environ, {}), mock.patch.object(server, "DATA_DIR", rig.dir), mock.patch.object(server, "free_gb", lambda: 100.0):
            for k in ("TG_BOT_TOKEN", "TG_CHAT_ID", "TG_OWNER_BOT_TOKEN", "TG_OWNER_CHAT_ID", "GMAIL_USER", "GMAIL_APP_PASSWORD"):
                os.environ.pop(k, None)
            self.addCleanup(server.SESSIONS.recover)
            server.SESSIONS.recover()
            s = server.SESSIONS.start("203.0.113.5", {"size": len(data), "sha256": sha(data), "consentSend": True})
            server.SESSIONS.put_chunk(s["id"], s["token"], 0, len(data), io.BytesIO(data).read, sha(data))
            self.assertTrue(server.SESSIONS.finish(s["id"], s["token"], None)["stored"])
            self.assertEqual(server.SESSION_DELIVERY.run_once(), 0)                   # neither channel is set up: no try is made
            st = server.SESSIONS.status(s["id"], s["token"])
            self.assertEqual((st["stored"], st["delivered"], {c: v["status"] for c, v in st["channels"].items()}), (True, False, {"telegram": "queued", "email": "queued"}))
            self.assertTrue((rig.dir / "sessions" / s["id"] / "package.zip").exists())


class EndToEnd(unittest.TestCase):
    def test_from_the_browsers_calls_to_the_owners_telegram_and_mail(self):
        """The real handler on a socket and the two real worker threads: start, chunks, finish, then the status says delivered."""
        rig = Rig(self, smtp_spool=True)
        data = package(filler=2 * MIB + 77)
        with mock.patch.object(server, "SESSIONS", rig.store):
            for b in (server._sthits, server._schits, server._sqhits, server._all_hits):
                b.clear()
            api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
            threading.Thread(target=api.serve_forever, daemon=True).start()
            self.addCleanup(lambda: (api.shutdown(), api.server_close()))
            rig.delivery.start()
            self.addCleanup(rig.delivery.stop)

            def call(method, path, body=None, token=None, headers=None):
                c = http.client.HTTPConnection("127.0.0.1", api.server_address[1], timeout=10)
                raw = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
                c.request(method, path, body=raw, headers={"X-Forwarded-For": "203.0.113.8", **({"X-Session-Token": token} if token else {}),
                                                            **({"Content-Type": "application/json"} if isinstance(body, dict) else {}), **(headers or {})})
                r = c.getresponse()
                out = r.read()
                c.close()
                return r.status, json.loads(out) if out else {}

            st, j = call("POST", "/api/session/start", {"size": len(data), "sha256": sha(data), "consentSend": True, "lesson": "walls-hall"})
            self.assertEqual(st, 200)
            for n, c in enumerate(chunks_of(data)):
                self.assertEqual(call("POST", f"/api/session/{j['id']}/{n}", c, token=j["token"], headers={"X-Chunk-Sha256": sha(c)})[0], 200)
            st, fin = call("POST", f"/api/session/{j['id']}/finish", {"sha256": sha(data)}, token=j["token"])
            self.assertEqual((st, fin["stored"]), (200, True))
            t0, status = time.time(), {}
            while time.time() - t0 < 15:
                status = call("GET", f"/api/session/{j['id']}", token=j["token"])[1]
                if status.get("delivered"):
                    break
                time.sleep(0.05)
        self.assertTrue(status["delivered"], status)
        self.assertEqual({c: v["status"] for c, v in status["channels"].items()}, {"telegram": "sent", "email": "sent"})
        doc = rig.tg.of("sendDocument")[0]
        self.assertEqual(doc["file"]["sha256"], sha(data))
        self.assertEqual(sha(attachment_of(parse(rig.smtp.messages[0]))[1]), sha(data))


if __name__ == "__main__":
    unittest.main()
