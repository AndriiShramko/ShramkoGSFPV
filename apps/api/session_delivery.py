"""Delivery of stored recordings to the owner (v0.12, lane v12-feedback, docs/wip/v12-plan.md 4.3 step 7 and section 8).

A recording that the store (sessions.py) has confirmed as stored goes to the owner by TWO channels, Telegram and e-mail, from a
persistent queue: the queue is the `channels` of the session's meta.json (queued, retrying, sending, sent, link, failed), written
atomically before and after every try, so a restart loses nothing. Each channel has its own worker thread, its own status and its
own retries, so a channel that is down never holds the other back.

The rules, in the order they matter:

- Nothing is "delivered" on a hope. Telegram counts when its API answered ok with a message id; e-mail counts when Gmail's own SMTP
  server accepted the message after DATA (there is no read receipt: plan section 6, item 9). `delivered` is true only when every
  channel is sent or link.
- Every file is streamed from the disk. The Telegram upload is a multipart body whose file part is read in 256 KB pieces; the e-mail's
  base64 attachment is encoded and written to the SMTP socket in about 100 KB pieces. Neither holds the package in memory, whatever its
  size (the container has 192 MB, plan section 8; tests/test_session_delivery.py measures the peak and compares it with the naive way).
- A package over a channel's cap is not sent as a file: Telegram's cap is 49 MiB (the Bot API takes 50), e-mail's is SESSION_MAIL_MAX_BYTES
  (15 MiB: Gmail's 25 MB limit counts the base64 text). Over the cap, a short message with the link to the owner's admin goes instead and the
  channel is `link`, which counts as confirmed.
- A try that fails is recorded (a short reason code, never a URL or a token), and the next one waits BACKOFF_S[failures - 1]
  (30 s, 2 min, 10 min, 30 min, 2 h, 6 h, 12 h, 24 h; Telegram's retry_after if longer). The 9th failure makes the channel `failed`:
  it stops, and the admin's resend starts it again. A channel that is not configured does not use up tries: it waits a minute and looks again.
- A channel failing NOTICE_AFTER (3) times is reported through the OTHER channel, once; a channel that gives up is reported once more.
  A notice that cannot go is kept pending in the same meta.json and retried, so the owner is told when either way to tell him is up.
- A restart turns a send that was cut off (`sending`) back into `queued` (sessions.SessionStore.recover): the recording may or may not have
  gone, and a second copy for the owner costs nothing where a lost one costs the recording.

Configuration (config.env, names only): TG_OWNER_BOT_TOKEN or TG_BOT_TOKEN, TG_OWNER_CHAT_ID or TG_CHAT_ID, TG_API_BASE (tests) as for the
owner bot; GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM_NAME, SMTP_HOST, SMTP_PORT, SMTP_TLS, SMTP_CAFILE as for the mailer; SESSION_MAIL_TO
(default GMAIL_USER, the owner's own address), SESSION_MAIL_MAX_BYTES (15 MiB), SESSION_TG_MAX_BYTES (49 MiB).
"""
from __future__ import annotations

import base64
import http.client
import json
import re
import secrets
import smtplib
import ssl
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formataddr, formatdate
from pathlib import Path
from typing import Callable, Iterator

import mailer
import ownerbot
from sessions import CHANNELS, SessionError, SessionStore

BACKOFF_S = (30, 120, 600, 1800, 7200, 21600, 43200, 86400)
MAX_FAILURES = len(BACKOFF_S) + 1
NOTICE_AFTER = 3
NOTICE_RETRY_S = 300
NOT_CONFIGURED_RETRY_S = 60
POLL_S = 2.0
TG_MAX_BYTES = 49 * 1024 * 1024
MAIL_MAX_BYTES = 15 * 1024 * 1024
FILE_BLOCK = 256 * 1024
B64_LINES = 1800                       # lines of 76 characters per block: 102,600 bytes in, about 137 KB out
CAPTION_MAX = 1000
_SAFE_RE = re.compile(r"[^A-Za-z0-9._ |:/-]")


class ChannelError(Exception):
    """A try that did not go: a short stable reason (network, telegram-401, smtp-535, package-missing ...), never a URL or a token."""

    def __init__(self, reason: str, retry_after: float | None = None, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason, self.retry_after, self.detail = reason, retry_after, _SAFE_RE.sub("?", detail)[:160]


@dataclass(frozen=True)
class Outcome:
    mode: str                   # "file": the package itself was sent; "link": a message with the admin link, the package being over the cap
    message_id: object = None


def _mb(n: int) -> str:
    return f"{n / (1024 * 1024):.1f} MB"


def _facts(meta: dict) -> str:
    """One line about a session for a caption or a subject: no name, no device, only what the owner's list shows."""
    s = meta.get("summary") or {}
    bits = [meta["id"]]
    if s.get("lesson"):
        bits.append(f"lesson {s['lesson']}")
    if s.get("durationMs") is not None:
        bits.append(f"{round(s['durationMs'] / 1000)} s")
    bits.append(_mb(int(meta.get("bytes") or 0)))
    bits.append("with voice" if s.get("voice") else "no voice")
    if s.get("minor"):
        bits.append("under 18, guardian confirmed")
    if s.get("locale"):
        bits.append(s["locale"])
    if s.get("release"):
        bits.append(f"release {s['release']}")
    return " | ".join(bits)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ----------------------------------------------------------------------------- Telegram

class _Multipart:
    """The head and tail of a multipart/form-data body around one file part; the file is read where it lies, in pieces."""

    def __init__(self, fields: dict[str, str], name: str, filename: str, mime: str, size: int):
        self.boundary = "gsfpv" + secrets.token_hex(12)
        b = self.boundary
        head = "".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items())
        head += f'--{b}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'
        self.head, self.tail = head.encode("utf-8"), f"\r\n--{b}--\r\n".encode()
        self.length = len(self.head) + size + len(self.tail)
        self.content_type = f"multipart/form-data; boundary={b}"


class TelegramChannel:
    name = "telegram"

    def __init__(self, config: Callable[[], ownerbot.BotConfig], max_bytes: Callable[[], int] = lambda: TG_MAX_BYTES, admin_url: str = "", timeout: float = 60.0):
        self.config, self.max_bytes, self.admin_url, self.timeout = config, max_bytes, admin_url, timeout

    def configured(self) -> bool:
        c = self.config()
        return bool(c.token and c.chat)

    def _call(self, method: str, fields: dict[str, str], file: tuple[str, Path, str] | None = None) -> object:
        cfg = self.config()
        u = urllib.parse.urlsplit(cfg.api_base)
        conn_class = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
        path = f"{u.path.rstrip('/')}/bot{cfg.token}/{method}"      # carries the token: never put into an error, a log or a status
        conn = None
        try:
            conn = conn_class(u.hostname, u.port, timeout=self.timeout)
            if file is None:
                body = json.dumps(fields, ensure_ascii=False).encode("utf-8")
                conn.request("POST", path, body=body, headers={"Content-Type": "application/json", "Content-Length": str(len(body))})
            else:
                field, package, filename = file
                size = package.stat().st_size
                mp = _Multipart(fields, field, filename, "application/zip", size)
                conn.putrequest("POST", path)
                conn.putheader("Content-Type", mp.content_type)
                conn.putheader("Content-Length", str(mp.length))
                conn.endheaders()
                conn.send(mp.head)
                sent = 0
                with package.open("rb") as f:
                    while True:
                        block = f.read(FILE_BLOCK)
                        if not block:
                            break
                        conn.send(block)
                        sent += len(block)
                if sent != size:
                    raise ChannelError("package-changed")
                conn.send(mp.tail)
            resp = conn.getresponse()
            raw = resp.read(65536)
            status = resp.status
        except ChannelError:
            raise
        except FileNotFoundError:
            raise ChannelError("package-missing") from None
        except (OSError, http.client.HTTPException) as e:        # refused, reset, timeout, TLS: the package may not have arrived
            raise ChannelError("network", detail=type(e).__name__) from None
        finally:
            if conn is not None:
                conn.close()
        try:
            doc = json.loads(raw)
        except ValueError:
            raise ChannelError(f"telegram-{status}", detail="not json") from None
        if isinstance(doc, dict) and doc.get("ok") is True and 200 <= status < 300:
            return doc.get("result")
        code = doc.get("error_code") if isinstance(doc, dict) and isinstance(doc.get("error_code"), int) else status
        params = doc.get("parameters") if isinstance(doc, dict) and isinstance(doc.get("parameters"), dict) else {}
        retry = params.get("retry_after") if isinstance(params.get("retry_after"), (int, float)) else None
        raise ChannelError(f"telegram-{code}", retry_after=float(retry) if retry else None, detail=str(doc.get("description") if isinstance(doc, dict) else ""))

    @staticmethod
    def _message_id(result: object):
        return result.get("message_id") if isinstance(result, dict) else None

    def send(self, meta: dict, path: Path) -> Outcome:
        cfg = self.config()
        try:
            size = path.stat().st_size
        except OSError:
            raise ChannelError("package-missing") from None
        if size > self.max_bytes():
            text = f"Fly by Sound recording {_facts(meta)}\nToo large for Telegram ({_mb(size)}). Download it in the admin, Sessions tab: {self.admin_url}"
            return Outcome("link", self._message_id(self._call("sendMessage", {"chat_id": cfg.chat, "text": text[:3900], "disable_web_page_preview": True})))
        caption = f"Fly by Sound recording {_facts(meta)}"[:CAPTION_MAX]
        result = self._call("sendDocument", {"chat_id": cfg.chat, "caption": caption}, ("document", path, f"fly-by-sound-{meta['id']}.zip"))
        return Outcome("file", self._message_id(result))

    def notice(self, subject: str, text: str) -> None:
        self._call("sendMessage", {"chat_id": self.config().chat, "text": f"{subject}\n{text}"[:3900], "disable_web_page_preview": True})


# ----------------------------------------------------------------------------- e-mail

def _stuff(block: bytes) -> bytes:
    """Dot-stuffing of whole lines (a line that starts with a dot gets another), as SMTP's DATA needs."""
    return re.sub(rb"(?m)^\.", b"..", block)


def _b64_blocks(path: Path) -> Iterator[bytes]:
    """The file as base64 text in lines of 76 characters, a block of lines at a time: 57 bytes make exactly one line, so every block
    but the last ends on a line."""
    with path.open("rb") as f:
        while True:
            raw = f.read(57 * B64_LINES)
            if not raw:
                return
            enc = base64.b64encode(raw)
            yield b"\r\n".join(enc[i:i + 76] for i in range(0, len(enc), 76)) + b"\r\n"


def message_blocks(sender: str, name: str, to: str, subject: str, text: str, attachment: tuple[str, Path] | None, host: str) -> Iterator[bytes]:
    """An e-mail as blocks of whole CRLF lines: the header, the text, and, when there is an attachment, its base64 text read from the
    disk a block at a time. Headers are ASCII (the values are made here from ids and numbers, never from a pilot's words)."""
    ascii_ = lambda s: s.encode("ascii", "replace").decode("ascii")  # noqa: E731
    clean = lambda s: ascii_(re.sub(r"[\r\n]+", " ", s))  # noqa: E731
    head = [f"From: {formataddr((name, sender), charset='utf-8')}", f"To: {clean(to)}", f"Subject: {clean(subject)}", f"Date: {formatdate(time.time(), usegmt=True)}",
            f"Message-ID: <{uuid.uuid4().hex}@{clean(host)}>", "MIME-Version: 1.0"]
    body = ascii_(text).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")
    if attachment is None:
        head += ['Content-Type: text/plain; charset="us-ascii"', "Content-Transfer-Encoding: 7bit", "", body, ""]
        yield _stuff("\r\n".join(head).encode("ascii"))
        return
    boundary = "=_gsfpv_" + secrets.token_hex(12)
    filename, path = attachment
    head += [f'Content-Type: multipart/mixed; boundary="{boundary}"', "", f"--{boundary}", 'Content-Type: text/plain; charset="us-ascii"', "Content-Transfer-Encoding: 7bit", "", body, "",
             f"--{boundary}", f'Content-Type: application/zip; name="{filename}"', "Content-Transfer-Encoding: base64", f'Content-Disposition: attachment; filename="{filename}"', "", ""]
    yield _stuff("\r\n".join(head).encode("ascii"))
    yield from _b64_blocks(path)
    yield f"\r\n--{boundary}--\r\n".encode("ascii")


class _StreamSMTP(mailer._SMTP):
    """smtplib.SMTP whose DATA can be given as blocks, so a large message is never one string in memory. `in_data` is set while the body
    is on its way, as the mailer's does, so a break there is known as ambiguous (the server may have taken the message)."""

    def data_blocks(self, blocks: Iterator[bytes]) -> tuple[int, bytes]:
        self.putcmd("data")
        code, reply = self.getreply()
        if code != 354:
            raise smtplib.SMTPDataError(code, reply)
        self.in_data = True
        for block in blocks:
            self.send(block)
        self.send(b".\r\n")
        code, reply = self.getreply()
        self.in_data = False
        if code != 250:
            raise smtplib.SMTPDataError(code, reply)
        return code, reply


class EmailChannel:
    name = "email"

    def __init__(self, config: Callable[[], mailer.MailConfig], to: Callable[[], str] = lambda: "", max_bytes: Callable[[], int] = lambda: MAIL_MAX_BYTES,
                 admin_url: str = "", host: str = "gsfpv.flyreelstudio.eu", smtp_class: type = _StreamSMTP):
        self.config, self.to, self.max_bytes, self.admin_url, self.host, self.smtp_class = config, to, max_bytes, admin_url, host, smtp_class

    def _recipient(self) -> str:
        return (self.to() or self.config().user).strip()

    def configured(self) -> bool:
        return self.config().configured and bool(mailer._ADDR_RE.fullmatch(self._recipient()))

    def _deliver(self, subject: str, text: str, attachment: tuple[str, Path] | None) -> None:
        """One message to the owner's own address through the authenticated SMTP server (the mailer's handshake and its error words)."""
        cfg = self.config()
        to = self._recipient()
        if not cfg.configured:
            raise ChannelError("not-configured")
        s = None
        try:
            s = self.smtp_class(cfg.host, cfg.port, timeout=cfg.timeout)
            s.ehlo()
            if cfg.tls != "none":
                s.starttls(context=ssl.create_default_context(cafile=cfg.cafile))
                s.ehlo()
            s.login(cfg.user, cfg.password)
            code, reply = s.mail(cfg.user)
            if code != 250:
                raise smtplib.SMTPSenderRefused(code, reply, cfg.user)
            code, reply = s.rcpt(to)
            if code not in (250, 251):
                raise ChannelError("smtp-recipient", detail=str(code))
            s.data_blocks(message_blocks(cfg.user, cfg.from_name, to, subject, text, attachment, self.host))
        except ChannelError:
            raise
        except FileNotFoundError:
            raise ChannelError("package-missing") from None
        except smtplib.SMTPAuthenticationError as e:
            raise ChannelError("smtp-auth", detail=str(e.smtp_code)) from None
        except smtplib.SMTPRecipientsRefused:
            raise ChannelError("smtp-recipient") from None
        except smtplib.SMTPNotSupportedError:
            raise ChannelError("smtp-not-supported") from None
        except smtplib.SMTPResponseException as e:     # the server answered with a refusal: nothing was taken
            raise ChannelError(f"smtp-{e.smtp_code}", detail=e.smtp_error.decode("utf-8", "replace") if isinstance(e.smtp_error, bytes) else str(e.smtp_error)) from None
        except (smtplib.SMTPException, OSError) as e:
            raise ChannelError("broken-in-data" if getattr(s, "in_data", False) else "network", detail=type(e).__name__) from None
        finally:
            if s is not None:
                try:
                    s.quit()
                except (smtplib.SMTPException, OSError):
                    s.close()

    def send(self, meta: dict, path: Path) -> Outcome:
        try:
            size = path.stat().st_size
        except OSError:
            raise ChannelError("package-missing") from None
        subject = f"Fly by Sound recording {meta['id']} ({_mb(size)})"
        lines = ["A pilot sent a flight with the pilot's voice.", "", _facts(meta), "", f"sha256 {meta.get('sha256')}"]
        if size > self.max_bytes():
            lines += ["", f"The package is {_mb(size)}, over the {_mb(self.max_bytes())} this channel sends as an attachment.",
                      f"Download it in the admin, Sessions tab: {self.admin_url}"]
            self._deliver(subject, "\n".join(lines), None)
            return Outcome("link")
        lines += ["", f"The package is attached ({_mb(size)}). The admin's Sessions tab has the download and the status of each channel: {self.admin_url}"]
        self._deliver(subject, "\n".join(lines), (f"fly-by-sound-{meta['id']}.zip", path))
        return Outcome("file")

    def notice(self, subject: str, text: str) -> None:
        self._deliver(f"[Fly by Sound] {subject}", text, None)


# ----------------------------------------------------------------------------- the workers

class _Skip(Exception):
    """Nothing to do for this session after all (it changed, or was deleted, since the queue was looked at)."""


class DeliveryWorker:
    """Works one channel's queue: one thread, one send at a time, from sessions that are stored and waiting."""

    def __init__(self, store: SessionStore, channel, peer, admin_url: str = "", poll_s: float = POLL_S, now: Callable[[], float] | None = None):
        self.store, self.channel, self.peer, self.admin_url, self.poll_s = store, channel, peer, admin_url, poll_s
        self.now = now or store.now
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---- one round

    def run_once(self) -> int:
        """Every send that is due now, then every pending notice; the number of sends tried."""
        name = self.channel.name
        tried = 0
        for sid in self.store.due(name, self.now()):
            if not self.channel.configured():
                self._wait_for_setup(sid)
                continue
            meta = self._claim(sid)
            if meta is None:
                continue
            tried += 1
            self._attempt(sid, meta)
        for sid in self.store.due(f"{name}:notice", self.now()):
            self._send_notices(sid)
        return tried

    def _wait_for_setup(self, sid: str) -> None:
        """A channel that is not set up uses up no tries: it says so and looks again in a minute."""
        name, now = self.channel.name, self.now()

        def fn(m: dict) -> None:
            ch = m["channels"][name]
            if m.get("state") != "stored" or ch.get("status") not in ("queued", "retrying") or float(ch.get("nextAt") or 0) > now:
                raise _Skip
            ch["error"], ch["nextAt"] = "not-configured", now + NOT_CONFIGURED_RETRY_S

        try:
            self.store.update(sid, fn)
        except (_Skip, SessionError):
            pass

    def _claim(self, sid: str) -> dict | None:
        name, now = self.channel.name, self.now()

        def fn(m: dict) -> None:
            ch = m["channels"][name]
            if m.get("state") != "stored" or ch.get("status") not in ("queued", "retrying") or float(ch.get("nextAt") or 0) > now:
                raise _Skip
            ch["status"], ch["claimedAt"] = "sending", now
            ch["attempts"] = int(ch.get("attempts") or 0) + 1

        try:
            return self.store.update(sid, fn)
        except (_Skip, SessionError):
            return None

    def _attempt(self, sid: str, meta: dict) -> None:
        try:
            outcome = self.channel.send(meta, self.store.package_path(sid))
        except ChannelError as e:
            self._failed(sid, e)
        except Exception as e:  # noqa: BLE001  an unexpected failure is not proof that nothing went; it is retried like any other
            self._failed(sid, ChannelError("internal", detail=type(e).__name__))
        else:
            self._sent(sid, outcome)

    def _sent(self, sid: str, outcome: Outcome) -> None:
        name, now = self.channel.name, self.now()

        def fn(m: dict) -> None:
            ch = m["channels"][name]
            ch.update(status="sent" if outcome.mode == "file" else "link", sentAt=_iso(now), messageId=outcome.message_id, error="", failures=0, nextAt=0)
            ch.pop("claimedAt", None)

        try:
            self.store.update(sid, fn)
        except SessionError:
            pass

    def _failed(self, sid: str, err: ChannelError) -> None:
        name, now = self.channel.name, self.now()
        outcome: dict = {}

        def fn(m: dict) -> None:
            ch = m["channels"][name]
            failures = int(ch.get("failures") or 0) + 1
            ch["failures"], ch["error"] = failures, err.reason
            ch.pop("claimedAt", None)
            if failures >= MAX_FAILURES:
                ch["status"], ch["nextAt"] = "failed", 0
                kind = "final"
            else:
                ch["status"], ch["nextAt"] = "retrying", now + max(BACKOFF_S[failures - 1], err.retry_after or 0)
                kind = "3" if failures == NOTICE_AFTER else None
            if kind is not None:
                notices = ch.setdefault("notices", {})
                if kind not in notices:
                    notices[kind] = {"state": "pending", "at": now}
                    ch["noticeAt"] = now
            outcome["failures"] = failures

        try:
            self.store.update(sid, fn)
        except SessionError:
            return
        self._send_notices(sid)

    # ---- telling the owner through the other channel

    def _send_notices(self, sid: str) -> None:
        """The pending notices about THIS channel, sent through the peer. A notice that cannot go stays pending and is tried again later."""
        name, now = self.channel.name, self.now()
        meta = self.store.get(sid)
        if meta is None:
            return
        pending = [k for k, v in ((meta["channels"].get(name) or {}).get("notices") or {}).items() if v.get("state") == "pending"]
        for kind in pending:
            ok = False
            if self.peer is not None and self.peer.configured():
                ch = meta["channels"][name]
                other = meta["channels"].get(self.peer.name) or {}
                sent_elsewhere = other.get("status") in ("sent", "link")
                what = f"failed {NOTICE_AFTER} times" if kind == "3" else f"gave up after {MAX_FAILURES} attempts"
                subject = f"{name} delivery of recording {sid} {what}"
                text = "\n".join([f"The {name} channel {what} (last reason: {ch.get('error') or 'unknown'}).", "",
                                  f"Recording: {_facts(meta)}", f"Reached you by {self.peer.name}: {'yes' if sent_elsewhere else 'not yet'}.", "",
                                  "The recording is stored on the server." + (" The channel keeps trying with longer pauses." if kind == "3" else " Resend it from the admin."),
                                  f"Admin, Sessions tab: {self.admin_url}"])
                try:
                    self.peer.notice(subject, text)
                    ok = True
                except ChannelError:
                    ok = False
                except Exception:  # noqa: BLE001
                    ok = False

            def fn(m: dict, kind=kind, ok=ok) -> None:
                ch = m["channels"][name]
                n = ch["notices"][kind]
                n.update(state="sent" if ok else "pending", at=now)
                if all(v.get("state") == "sent" for v in ch["notices"].values()):
                    ch.pop("noticeAt", None)
                else:
                    ch["noticeAt"] = now + NOTICE_RETRY_S

            try:
                self.store.update(sid, fn)
            except SessionError:
                return

    # ---- the thread

    def _loop(self) -> None:
        told = False
        while not self._stop.is_set():
            try:
                self.run_once()
                told = False
            except Exception as e:  # noqa: BLE001  a bad round must not end the worker
                if not told:
                    print(f"session delivery ({self.channel.name}): a round failed ({type(e).__name__}); trying again", flush=True)
                    told = True
            self._wake.wait(self.poll_s)
            self._wake.clear()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name=f"session-{self.channel.name}", daemon=True)
        self._thread.start()

    def wake(self) -> None:
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=5)


class Delivery:
    """The two channels' workers, each telling the owner through the other when it keeps failing."""

    def __init__(self, store: SessionStore, telegram: TelegramChannel, email: EmailChannel, admin_url: str = "", poll_s: float = POLL_S, now: Callable[[], float] | None = None):
        self.store = store
        self.workers = [DeliveryWorker(store, telegram, email, admin_url, poll_s, now), DeliveryWorker(store, email, telegram, admin_url, poll_s, now)]
        store.on_change = lambda sid: self.wake()

    def run_once(self) -> int:
        return sum(w.run_once() for w in self.workers)

    def start(self) -> None:
        for w in self.workers:
            w.start()

    def wake(self) -> None:
        for w in self.workers:
            w.wake()

    def stop(self) -> None:
        for w in self.workers:
            w.stop()
