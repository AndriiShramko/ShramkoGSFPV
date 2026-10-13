"""E-mail to pilots from the owner's Gmail (owner's items 3 and 7): composing a message and handing it to
Gmail's own SMTP server. Nothing here decides WHEN a message goes: service.py queues it only on the
owner's explicit act and outbox.py sends it once.

Why it lands in the inbox, not in spam: the message is submitted to smtp.gmail.com:587 (STARTTLS, then
AUTH with the owner's address and a Gmail app password), so Google itself signs it (DKIM d=gmail.com)
and sends it from its own servers (SPF of gmail.com), and the From address is the authenticated
gmail.com address (DMARC aligned). On top of that the message looks like a person's reply, because it
is one: plain text plus a simple HTML copy, no images, no tracking pixels, no link shorteners, one
recipient, the pilot's own words quoted with their date, In-Reply-To/References per idea thread.

Configuration (config.env on the hub, never in git): GMAIL_USER (zmei116@gmail.com), GMAIL_APP_PASSWORD
(a Gmail app password: Google account -> Security -> 2-Step Verification -> App passwords; the normal
password does not work over SMTP). Optional: MAIL_FROM_NAME (default "Andrii Shramko"). For tests only:
SMTP_HOST, SMTP_PORT, SMTP_TLS=none (refused for any host but this machine), SMTP_CAFILE.
Without GMAIL_USER and GMAIL_APP_PASSWORD the mailer is "not configured": e-mails wait (waiting_setup).
"""
from __future__ import annotations

import html
import re
import smtplib
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from typing import Callable

from texts import Texts

LINKEDIN = "https://www.linkedin.com/in/andrii-shramko/"
QUOTE_MAX = 2000
_ADDR_RE = re.compile(r"[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}")
_LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")


@dataclass(frozen=True)
class MailConfig:
    user: str = ""
    password: str = ""
    from_name: str = "Andrii Shramko"
    host: str = "smtp.gmail.com"
    port: int = 587
    tls: str = "starttls"     # "none" only for a test server on this machine
    cafile: str | None = None  # tests: the fake server's own certificate
    timeout: float = 30.0

    @classmethod
    def from_env(cls, env) -> "MailConfig":
        host = env.get("SMTP_HOST") or "smtp.gmail.com"
        tls = "none" if env.get("SMTP_TLS") == "none" and host in _LOCAL_HOSTS else "starttls"
        try:
            port = int(env.get("SMTP_PORT") or 587)
        except ValueError:
            port = 587
        return cls(user=(env.get("GMAIL_USER") or "").strip(), password=(env.get("GMAIL_APP_PASSWORD") or "").replace(" ", ""),
                   from_name=(env.get("MAIL_FROM_NAME") or "Andrii Shramko").strip()[:80], host=host, port=port, tls=tls,
                   cafile=env.get("SMTP_CAFILE") or None)

    @property
    def configured(self) -> bool:
        return bool(_ADDR_RE.fullmatch(self.user) and self.password)


class MailError(Exception):
    """A send that did not go. transient: worth trying again later; ambiguous: the server may have taken
    it (the connection broke inside DATA), so it is never sent again without the owner's say."""

    def __init__(self, reason: str, transient: bool, ambiguous: bool = False, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason, self.transient, self.ambiguous, self.detail = reason, transient, ambiguous, detail[:200]


class _SMTP(smtplib.SMTP):
    """smtplib.SMTP that remembers whether the message body was being handed over when it failed."""

    in_data = False

    def data(self, msg):
        self.in_data = True
        r = super().data(msg)
        self.in_data = False
        return r


def _quote(text: str) -> str:
    t = text if len(text) <= QUOTE_MAX else text[: QUOTE_MAX - 3] + "..."
    return "\n".join("> " + line if line else ">" for line in t.splitlines() or [""])


def _date(created: str) -> str:
    """'2026-10-13T10:00:05Z' -> '2026-10-13 10:00 UTC' (the same in every language)."""
    return f"{created[:10]} {created[11:16]} UTC" if isinstance(created, str) and len(created) >= 16 else str(created or "")


def _p(text: str) -> str:
    """Paragraphs of plain text as HTML: escaped, blank lines split paragraphs, line breaks kept."""
    paras = [x for x in text.split("\n\n") if x.strip()]
    return "".join("<p>" + html.escape(x).replace("\n", "<br>\n") + "</p>\n" for x in paras)


class Mailer:
    """compose() renders a message in the pilot's language; send() hands it to SMTP once."""

    def __init__(self, config: Callable[[], MailConfig], public_origin: str, texts: Texts | None = None,
                 smtp_class: type = _SMTP):
        self.config, self.origin, self.smtp_class = config, public_origin.rstrip("/"), smtp_class
        self.texts = texts or Texts("mail")

    @property
    def configured(self) -> bool:
        return self.config().configured

    def sender(self) -> str:
        return self.config().user

    def subject(self, kind: str, lang: str, idea_id: str) -> str:
        return self.texts.t(lang, "doneSubject" if kind == "done" else "replySubject", id=idea_id)

    def compose(self, kind: str, lang: str, body: str, idea: dict) -> tuple[str, str]:
        """(text/plain, text/html) of a reply (body = the owner's answer) or a thank-you (body = what was
        done). Both end with the signature and the pilot's own message quoted with its date."""
        t = lambda key, **v: self.texts.t(lang, key, **v)  # noqa: E731
        site = f"{self.origin}/{self.texts.lang(lang)}/"
        parts = [t("hello")]
        if kind == "done":
            parts += [t("doneIntro", id=idea["id"]), body, t("doneThanks", site=site)]
        else:
            parts += [body]
        name = self.config().from_name
        sig = ["--", name, t("tagline"), site, LINKEDIN]
        quoted = idea.get("text") or ""
        quote_head = t("quoteHeader", date=_date(idea.get("created")), id=idea["id"])
        plain = "\n\n".join(parts) + "\n\n" + "\n".join(sig) + "\n\n"
        if quoted:
            plain += quote_head + "\n" + _quote(quoted) + "\n\n"
        plain += t("footer") + "\n"
        h = ['<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">\n']
        h += [_p(x) for x in parts]
        h.append('<p style="color:#555">--<br>\n' + html.escape(name) + "<br>\n" + html.escape(t("tagline")) + "<br>\n"
                 + f'<a href="{html.escape(site, quote=True)}">{html.escape(site)}</a><br>\n'
                 + f'<a href="{LINKEDIN}">{LINKEDIN}</a></p>\n')
        if quoted:
            h.append("<p>" + html.escape(quote_head) + "</p>\n")
            h.append('<blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#444">'
                     + _p(quoted if len(quoted) <= QUOTE_MAX else quoted[: QUOTE_MAX - 3] + "...") + "</blockquote>\n")
        h.append('<p style="color:#777;font-size:12px">' + html.escape(t("footer")) + "</p>\n</div>\n")
        return plain, "".join(h)

    def message(self, mail: dict) -> EmailMessage:
        """The MIME message of an outbox entry, headers included (From and Reply-To: the owner)."""
        cfg = self.config()
        me = formataddr((cfg.from_name, cfg.user))
        m = EmailMessage()
        m["From"] = me
        m["Reply-To"] = me
        m["To"] = mail["to"]
        m["Subject"] = mail["subject"]
        m["Date"] = formatdate(time.time(), usegmt=True)
        m["Message-ID"] = mail["messageId"]
        if mail.get("inReplyTo"):
            m["In-Reply-To"] = mail["inReplyTo"]
        if mail.get("references"):
            m["References"] = " ".join(mail["references"])
        m["Content-Language"] = mail.get("lang") or "en"
        m.set_content(mail["plain"])
        m.add_alternative(mail["html"], subtype="html")
        return m

    def send(self, mail: dict) -> None:
        """Hand one message to the SMTP server. Raises MailError; returns once the server took it (a
        failing QUIT after that does not count: the message is sent)."""
        cfg = self.config()
        if not cfg.configured:
            raise MailError("not-configured", transient=False)
        if not _ADDR_RE.fullmatch(mail.get("to") or ""):
            raise MailError("bad-address", transient=False)
        msg = self.message(mail)
        s = None
        try:
            s = self.smtp_class(cfg.host, cfg.port, timeout=cfg.timeout)
            s.ehlo()
            if cfg.tls != "none":
                s.starttls(context=ssl.create_default_context(cafile=cfg.cafile))
                s.ehlo()
            s.login(cfg.user, cfg.password)
            refused = s.send_message(msg, from_addr=cfg.user, to_addrs=[mail["to"]])
            if refused:
                raise MailError("recipient", transient=False, detail=str(refused))
        except MailError:
            raise
        except smtplib.SMTPAuthenticationError as e:
            raise MailError("auth", transient=False, detail=f"{e.smtp_code}") from e
        except smtplib.SMTPRecipientsRefused as e:
            raise MailError("recipient", transient=False, detail=str(list(e.recipients.values()))[:200]) from e
        except smtplib.SMTPNotSupportedError as e:
            raise MailError("not-supported", transient=False, detail=str(e)) from e  # no STARTTLS or no AUTH
        except smtplib.SMTPResponseException as e:  # the server answered with a refusal: nothing was taken
            err = e.smtp_error.decode("utf-8", "replace") if isinstance(e.smtp_error, bytes) else str(e.smtp_error)
            raise MailError(f"smtp-{e.smtp_code}", transient=400 <= e.smtp_code < 500, detail=err) from e
        except (smtplib.SMTPException, OSError) as e:  # OSError: refused, reset, timeout, TLS
            if getattr(s, "in_data", False):
                raise MailError("broken-in-data", transient=False, ambiguous=True, detail=type(e).__name__) from e
            raise MailError("network", transient=True, detail=type(e).__name__) from e
        finally:
            if s is not None:
                try:
                    s.quit()
                except (smtplib.SMTPException, OSError):
                    s.close()

    def check_login(self) -> str:
        """Connect, STARTTLS, log in and quit, sending nothing: 'ok' or the reason (ideas_cli.py mail-check)."""
        cfg = self.config()
        if not cfg.configured:
            return "not-configured"
        s = None
        try:
            s = self.smtp_class(cfg.host, cfg.port, timeout=cfg.timeout)
            s.ehlo()
            if cfg.tls != "none":
                s.starttls(context=ssl.create_default_context(cafile=cfg.cafile))
                s.ehlo()
            s.login(cfg.user, cfg.password)
            return "ok"
        except smtplib.SMTPAuthenticationError as e:
            return f"auth refused ({e.smtp_code})"
        except (smtplib.SMTPException, OSError) as e:
            return f"failed: {type(e).__name__}"
        finally:
            if s is not None:
                try:
                    s.quit()
                except (smtplib.SMTPException, OSError):
                    s.close()
