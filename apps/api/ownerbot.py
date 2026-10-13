"""The owner's Telegram bot (owner's items 3, 7, 8): every pilot's report reaches his chat whole, with
buttons, and he runs the ideas from there.

Configuration (config.env, never in git): TG_WEBHOOK_SECRET (16-256 of A-Z a-z 0-9 _ -) turns the
two-way work on; TG_OWNER_BOT_TOKEN is optional and defaults to the shared lead bot TG_BOT_TOKEN (the
owner's decision 2026-10-13: no new bot); TG_OWNER_CHAT_ID (default TG_CHAT_ID: in a private chat with
the bot it is the owner's user id), TG_OWNER_USER_ID (also require this sender: REQUIRED when that chat
is a group or a channel, i.e. its id is negative, else any member could answer pilots from the owner's
Gmail; without it the two-way work stays off and BotConfig.problem says why), TG_OWNER_LANG (default ru). TG_API_BASE is for tests (a fake Telegram server).
On the shared bot the webhook receives EVERY update of that bot, other sites' lead notes and replies to
them included. So an update is acted on only when it is the owner's (his chat, his user) AND belongs to
GSFPV: a reply to a bot message the store knows (a card, a prompt, a draft, an e-mail notice), a button
whose idea or e-mail id the store knows, or one of the commands below. Everything else is answered 200
to Telegram and left alone: no message, no toast, no write (see `_ours`).

What the owner does in his chat:
- every report arrives as a card (kind, id, status, urgency, contact, language, page, scene with a link,
  release, time, a summary of the technical details, the pilot's whole message) with buttons Accept /
  Reject / In progress / Done, the four urgencies and Comment; a bug's technical details follow as a
  JSON file, the picture of the view as a photo (the owner's words, 2026-10-13: all the pilot's data
  straight into the chat);
- a reply to a card is his answer to the pilot by e-mail: the bot says "goes in 60 s" with Cancel and
  shows the whole e-mail as it will go (a report's words are quoted; a note's never are, mailer.keys);
- Comment -> his reply to the bot's prompt is a comment for the agent who will build it;
- Done -> his reply to the prompt (or the agent's summary) is what was done -> the bot shows the DRAFT
  thank-you e-mail in the pilot's language with Send and Edit; nothing goes without Send;
- /note <text> [e-mail] [#urgent|#high|#normal|#low] [#en|#es|#pl|#ru]: a pilot's idea told outside the
  form; /queue: the work queue; /help.
Each update that is ours is acted on once (service.first_update). The webhook is POST /api/tg/<path>,
path = an HMAC of the secret, and the X-Telegram-Bot-Api-Secret-Token header must equal the secret (else
403). `ideas_cli.py tg-setup` registers it (and refuses to replace a webhook someone else set on the bot).

Without the secret every report still goes to the shared lead bot as before (server.report_text, now
with every field), plus the technical details file, and none of the two-way work is offered (no buttons
that nothing would answer).
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import secrets
import urllib.request
from dataclasses import dataclass
from typing import Callable

import ideas
from service import IdeaError, IdeasService
from texts import Texts

SECRET_RE = re.compile(r"[A-Za-z0-9_-]{16,256}")
TEXT_LIMIT = 4000          # Telegram's limit is 4096 characters per message
WEBHOOK_BODY_MAX = 64 * 1024
STATUS_CODES = {"a": "accepted", "r": "rejected", "p": "in_progress", "d": "done"}
CODE_OF_STATUS = {v: k for k, v in STATUS_CODES.items()}
COMMANDS = ("start", "help", "queue", "note")
COMMAND_RE = re.compile(r"/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]{1,64})?(?:\s+(.*))?\Z", re.S)
IDEA_VERBS = ("s", "u", "c", "e")        # button data "<verb>:[<code>:]<idea id>"
MAIL_VERBS = ("x", "w", "m")             # button data "<verb>:<e-mail id>" (m: Send under THAT draft)


def _hhmm(iso: str | None) -> str:
    return f"{iso[:10]} {iso[11:16]} UTC" if isinstance(iso, str) and len(iso) >= 16 else "-"


def _cut(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 3] + "..."


def parse_command(text: str) -> tuple[str, str] | None:
    """`/note@SomeBot text` -> ("note", "text"); None when the message is not a bot command. The text
    after the command may start on the next line."""
    m = COMMAND_RE.match(text)
    return (m.group(1).lower(), (m.group(2) or "").strip()) if m else None


class TelegramApi:
    """The few Bot API methods the bots use. Returns the method's result, or None on any failure (a
    message that cannot go must never break the request that caused it). The token is never logged."""

    def __init__(self, token: str, base: str = "https://api.telegram.org", timeout: float = 10.0):
        self.token, self.base, self.timeout = token, base.rstrip("/"), timeout

    def _post(self, method: str, data: bytes, ctype: str):
        req = urllib.request.Request(f"{self.base}/bot{self.token}/{method}", data=data, headers={"Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                resp = json.load(r)
        except Exception:  # noqa: BLE001
            return None
        return resp.get("result") if isinstance(resp, dict) and resp.get("ok") else None

    def call(self, method: str, payload: dict):
        return self._post(method, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json")

    def upload(self, method: str, fields: dict, file_field: str, filename: str, data: bytes, mime: str):
        """multipart/form-data with one file (sendDocument, sendPhoto)."""
        b = "gsfpv" + secrets.token_hex(12)
        parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode("utf-8") for k, v in fields.items()]
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                     f"Content-Type: {mime}\r\n\r\n".encode("utf-8") + data + b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        return self._post(method, b"".join(parts), f"multipart/form-data; boundary={b}")

    def send(self, chat: str, text: str, buttons: list | None = None, reply_to: int | None = None,
             force_reply: str | None = None) -> int | None:
        p: dict = {"chat_id": chat, "text": _cut(text, TEXT_LIMIT), "link_preview_options": {"is_disabled": True}}
        if buttons:
            p["reply_markup"] = {"inline_keyboard": buttons}
        elif force_reply is not None:
            p["reply_markup"] = {"force_reply": True, "input_field_placeholder": _cut(force_reply, 64)}
        if reply_to:
            p["reply_parameters"] = {"message_id": reply_to, "allow_sending_without_reply": True}
        r = self.call("sendMessage", p)
        return r.get("message_id") if isinstance(r, dict) else None

    def edit(self, chat: str, message_id: int, text: str, buttons: list | None = None) -> bool:
        p: dict = {"chat_id": chat, "message_id": message_id, "text": _cut(text, TEXT_LIMIT), "link_preview_options": {"is_disabled": True}}
        p["reply_markup"] = {"inline_keyboard": buttons or []}
        return self.call("editMessageText", p) is not None

    def answer(self, callback_id: str, text: str = "") -> None:
        self.call("answerCallbackQuery", {"callback_query_id": callback_id, "text": _cut(text, 190)})

    def document(self, chat: str, filename: str, data: bytes, caption: str = "", reply_to: int | None = None) -> int | None:
        f = {"chat_id": chat, "caption": _cut(caption, 1000)}
        if reply_to:
            f["reply_parameters"] = json.dumps({"message_id": reply_to, "allow_sending_without_reply": True})
        r = self.upload("sendDocument", f, "document", filename, data, "application/json")
        return r.get("message_id") if isinstance(r, dict) else None

    def photo(self, chat: str, filename: str, data: bytes, caption: str = "", reply_to: int | None = None) -> int | None:
        f = {"chat_id": chat, "caption": _cut(caption, 1000)}
        if reply_to:
            f["reply_parameters"] = json.dumps({"message_id": reply_to, "allow_sending_without_reply": True})
        r = self.upload("sendPhoto", f, "photo", filename, data, "image/jpeg")
        return r.get("message_id") if isinstance(r, dict) else None


@dataclass(frozen=True)
class BotConfig:
    """The bot's settings, read from the environment each time (see the module's docstring)."""
    token: str = ""         # TG_OWNER_BOT_TOKEN, else the shared TG_BOT_TOKEN
    shared_token: str = ""  # TG_BOT_TOKEN: the lead bot of every site on the hub
    shared_chat: str = ""   # TG_CHAT_ID: where the shared lead bot writes (server.send_telegram)
    chat: str = ""
    user: str = ""
    secret: str = ""
    lang: str = "ru"
    api_base: str = "https://api.telegram.org"

    @classmethod
    def from_env(cls, env) -> "BotConfig":
        lang = env.get("TG_OWNER_LANG") or "ru"
        shared = (env.get("TG_BOT_TOKEN") or "").strip()
        return cls(token=(env.get("TG_OWNER_BOT_TOKEN") or "").strip() or shared, shared_token=shared,
                   shared_chat=(env.get("TG_CHAT_ID") or "").strip(),
                   chat=(env.get("TG_OWNER_CHAT_ID") or env.get("TG_CHAT_ID") or "").strip(),
                   user=(env.get("TG_OWNER_USER_ID") or "").strip(), secret=(env.get("TG_WEBHOOK_SECRET") or "").strip(),
                   lang=lang if lang in ideas.LOCALES else "ru", api_base=(env.get("TG_API_BASE") or "https://api.telegram.org"))

    @property
    def problem(self) -> str:
        """Why the two-way work is off ("" when it is on). Without the secret nothing could come back,
        so no buttons are offered and reports go to the shared bot as before. A group or channel chat
        (a negative id) without TG_OWNER_USER_ID is refused: every member's reply or button would act
        for the owner, an e-mail from his Gmail included."""
        if not self.token:
            return "no bot token (TG_OWNER_BOT_TOKEN or TG_BOT_TOKEN)"
        if not self.chat:
            return "no chat (TG_OWNER_CHAT_ID or TG_CHAT_ID)"
        if not SECRET_RE.fullmatch(self.secret):
            return "TG_WEBHOOK_SECRET is missing or not 16-256 of A-Z a-z 0-9 _ -"
        if self.chat.startswith("-") and not self.user:
            return ("the owner's chat is a group or a channel: set TG_OWNER_USER_ID to the owner's own Telegram user id, "
                    "else every member could answer pilots from his Gmail")
        return ""

    @property
    def ready(self) -> bool:
        """The two-way work is on (see `problem`)."""
        return not self.problem

    @property
    def shared(self) -> bool:
        """The owner bot is the shared lead bot (the default): its webhook also carries other sites' updates."""
        return self.token == self.shared_token

    def webhook_path(self) -> str:
        """/api/tg/<32 hex>: derived from the secret, so it is not guessable and needs no second setting."""
        return "/api/tg/" + hmac.new(self.secret.encode(), b"gsfpv owner bot webhook path", hashlib.sha256).hexdigest()[:32]


def diag_facts(blob: bytes | None) -> dict:
    """The few facts of a bug's technical details worth reading in a chat (the whole file follows it).
    Works for the simulator's and the landing's shapes; anything missing is left out."""
    try:
        d = json.loads(blob or b"{}").get("diagnostics")
    except (ValueError, AttributeError):
        return {}
    if not isinstance(d, dict):
        return {}
    out: dict = {}
    br = d.get("browser") if isinstance(d.get("browser"), dict) else {}
    if isinstance(br.get("userAgent"), str):
        out["browser"] = _cut(br["userAgent"], 160)
    g = br.get("gpu") if isinstance(br.get("gpu"), dict) else {}
    a = g.get("adapter") if isinstance(g.get("adapter"), dict) else {}
    gpu = " ".join(str(x) for x in (g.get("api"), a.get("vendor"), a.get("architecture"), a.get("description")) if x)
    if gpu:
        out["gpu"] = _cut(gpu, 160)
    sc = br.get("screen") if isinstance(br.get("screen"), dict) else {}
    if sc.get("w") and sc.get("h"):
        out["screen"] = f"{sc['w']}x{sc['h']} @{sc.get('dpr', 1)}"
    if isinstance(br.get("input"), str):
        out["input"] = br["input"][:40]
    fr = d.get("frames") if isinstance(d.get("frames"), dict) else {}
    if fr.get("renderHz") is not None:
        out["frames"] = {"hz": fr.get("renderHz"), "p50": fr.get("p50ms"), "p99": fr.get("p99ms")}
    errs = d.get("errors") if isinstance(d.get("errors"), list) else []
    out["errors"] = len(errs)
    if errs and isinstance(errs[-1], str):
        out["lastError"] = _cut(errs[-1], 300)
    out["log"] = isinstance(d.get("flightLog"), dict) and bool(d["flightLog"].get("records") or d["flightLog"].get("format"))
    shot = d.get("screenshot")
    out["picture"] = isinstance(shot, str) and shot.startswith("data:image/jpeg;base64,")
    return out


def diag_picture(blob: bytes | None) -> bytes | None:
    """The small JPEG of the view inside a bug's technical details, if the pilot attached one."""
    try:
        shot = json.loads(blob or b"{}").get("diagnostics", {}).get("screenshot")
        if isinstance(shot, str) and shot.startswith("data:image/jpeg;base64,"):
            data = base64.b64decode(shot.split(",", 1)[1], validate=True)
            return data if data[:3] == b"\xff\xd8\xff" else None
    except (ValueError, AttributeError, binascii.Error):
        return None
    return None


class OwnerBot:
    """The owner bot: Telegram in and out. Changes go through the service; its events come back here
    (listen()) and are shown in the owner's chat, whoever caused them (Telegram, the admin, an agent)."""

    def __init__(self, service: IdeasService, env=os.environ, public_origin: str = "https://gsfpv.flyreelstudio.eu",
                 texts: Texts | None = None, api_factory: Callable[[str, str], TelegramApi] = TelegramApi):
        self.service, self.env, self.origin = service, env, public_origin.rstrip("/")
        self._texts = texts
        self.api_factory = api_factory
        service.listeners.append(self.on_event)

    @property
    def texts(self) -> Texts:
        """Loaded on first use: missing dictionaries on the hub break the bot's words, not the API's start."""
        if self._texts is None:
            self._texts = Texts("bot")
        return self._texts

    # ---------------- configuration ----------------

    @property
    def cfg(self) -> BotConfig:
        return BotConfig.from_env(self.env)  # read each time: tests and a recreated container change it

    @property
    def configured(self) -> bool:
        return self.cfg.ready

    def api(self) -> TelegramApi:
        c = self.cfg
        return self.api_factory(c.token, c.api_base)

    def t(self, key: str, **v) -> str:
        return self.texts.t(self.cfg.lang, key, **v)

    # ---------------- what the owner reads ----------------

    def card_text(self, rec: dict, facts: dict | None = None) -> str:
        t = self.t
        urg = t(f"urgency.{rec['urgency']}") if rec.get("urgency") in ideas.URGENCIES else t("urgency.none")
        lines = [t("card.head", kind=t(f"kind.{rec['kind']}"), id=rec["id"], status=t(f"status.{rec['status']}"), urgency=urg)]
        if rec["kind"] != "feature":
            lines.append(t(f"card.contact.{rec['contactKind']}", contact=rec["contact"]))
        meta = [t(k, value=rec[f]) for k, f in (("card.lang", "lang"), ("card.page", "page"), ("card.scene", "scene"), ("card.release", "release")) if rec.get(f)]
        if meta:
            lines.append(" · ".join(meta))
        if rec.get("scene"):
            lines.append(t("card.link", url=f"{self.origin}/{rec['lang'] or 'en'}/fly/?scene={rec['scene']}"))
        lines.append(t("card.time", time=_hhmm(rec["created"])))
        if rec.get("suspect"):
            lines.append(t("card.suspect"))
        if rec["kind"] == "bug" or rec.get("diagnostics"):
            d = rec.get("diagnostics")
            lines.append(t("card.diag.yes", kb=max(1, round((rec.get("diagBytes") or 0) / 1024))) if d is True
                         else t("card.diag.skipped") if d == "skipped" else t("card.diag.no"))
        facts = facts if facts is not None else rec.get("diagFacts")  # kept with the idea: a redrawn card keeps them
        f = facts or {}
        for k in ("browser", "gpu", "screen", "input"):
            if f.get(k):
                lines.append(t(f"diag.{k}", value=f[k]))
        if f.get("frames"):
            lines.append(t("diag.frames", hz=f["frames"].get("hz"), p50=f["frames"].get("p50"), p99=f["frames"].get("p99")))
        if facts:
            lines.append(t("diag.errors", n=f.get("errors", 0)))
            if f.get("lastError"):
                lines.append(t("diag.lastError", value=f["lastError"]))
            if f.get("log"):
                lines.append(t("diag.log"))
            if f.get("picture"):
                lines.append(t("diag.picture"))
        if rec["comments"]:
            lines.append(t("card.comments", n=len(rec["comments"])))
        body = rec["text"] or ""
        tail = t(f"card.hint.{rec['contactKind']}", s=int(self.service.undo_s)) if rec["kind"] != "feature" else ""
        head = "\n".join(lines) + "\n\n" + t("card.message") + "\n"
        room = TEXT_LIMIT - len(head) - len(tail) - 4
        return head + _cut(body, max(200, room)) + ("\n\n" + tail if tail else "")

    def card_buttons(self, rec: dict) -> list:
        t, rid = self.t, rec["id"]

        def b(label: str, data: str, on: bool = False) -> dict:
            return {"text": ("• " if on else "") + label, "callback_data": data}

        st, urg = rec["status"], rec.get("urgency")
        return [[b(t("btn.accept"), f"s:a:{rid}", st == "accepted"), b(t("btn.reject"), f"s:r:{rid}", st == "rejected")],
                [b(t("btn.progress"), f"s:p:{rid}", st == "in_progress"), b(t("btn.done"), f"s:d:{rid}", st == "done")],
                [b(t(f"btn.{u}"), f"u:{u}:{rid}", urg == u) for u in ideas.URGENCIES],
                [b(t("btn.comment"), f"c:{rid}")]]

    def draft_text(self, rec: dict, mail: dict) -> str:
        return (self.t("draft.head", to=mail["to"], lang=mail["lang"], id=rec["id"]) + "\n\n"
                + self.t("draft.subject", subject=mail["subject"]) + "\n\n" + mail["plain"])

    def queue_text(self) -> str:
        work, waiting = self.service.queue()
        t = self.t

        def title(r: dict) -> str:
            pub = r["public"]["title"]
            s = pub.get(self.cfg.lang) or pub.get("en") or (r["text"].splitlines() or [""])[0]
            return _cut(s, 90)

        lines = [t("queue.title", n=len(work)) if work else t("queue.empty")]
        for i, r in enumerate(work[:40], 1):
            lines.append(f"{i}. {t('urgency.' + r['urgency'])} · {r['id']} · {t('status.' + r['status'])} · {title(r)}"
                         + (f" ({t('card.comments', n=len(r['comments']))})" if r["comments"] else ""))
        if waiting:
            lines += ["", t("queue.waiting", n=len(waiting))]
            lines += [f"- {r['id']} · {title(r)}" for r in waiting[:20]]
        return "\n".join(lines)

    # ---------------- reports ----------------

    def deliver_report(self, rec: dict | None, shared_text: str, diag_blob: bytes | None, shared_send: Callable[[str], object]):
        """A new report into the owner's chat: the owner bot's card with buttons when it is configured,
        else the shared lead bot's text as before. The technical details file (and the picture) follow
        either way. Returns the card's message id (None: not delivered)."""
        c = self.cfg
        if c.ready and rec is not None:
            api = self.api()
            mid = api.send(c.chat, self.card_text(rec, diag_facts(diag_blob) if diag_blob else None), buttons=self.card_buttons(rec))
            if mid:
                self.service.link_message(mid, rec["id"], "card", card=True)
                self._attachments(api, c.chat, rec["id"], diag_blob, mid)
                return mid
            # the owner bot did not answer (blocked, Telegram down): the shared bot below still delivers it
        mid = shared_send(shared_text)
        if mid and diag_blob and c.shared_token and c.shared_chat:
            rid = rec["id"] if rec else "report"
            self._attachments(self.api_factory(c.shared_token, c.api_base), c.shared_chat, rid, diag_blob, mid if isinstance(mid, int) else None)
        return mid

    def _attachments(self, api: TelegramApi, chat: str, rid: str, blob: bytes | None, reply_to: int | None) -> None:
        if not blob:
            return
        api.document(chat, f"{rid}.json", blob, caption=self.t("diag.file", id=rid), reply_to=reply_to)
        pic = diag_picture(blob)
        if pic:
            api.photo(chat, f"{rid}.jpg", pic, caption=self.t("diag.pictureCaption", id=rid), reply_to=reply_to)

    # ---------------- events from the service ----------------

    def on_event(self, event: str, rec: dict, mail: dict | None, by: str) -> None:
        c = self.cfg
        if not c.ready:
            return
        api, t = self.api(), self.t
        rid = rec["id"]
        if event in ("status", "urgency", "comment") and by != "telegram":
            card = (rec.get("tg") or {}).get("card")
            if card:
                api.edit(c.chat, card, self.card_text(rec), self.card_buttons(rec))
            return
        if event == "note":
            mid = api.send(c.chat, self.card_text(rec), buttons=self.card_buttons(rec))
            if mid:
                self.service.link_message(mid, rid, "card", card=True)
                api.send(c.chat, t("note.created", id=rid), reply_to=mid)
            return
        if event == "draft":
            if mail is None:
                api.send(c.chat, t("ok.summaryNoEmail", id=rid))
                return
            self._show_draft(rec, mail)
            return
        if mail is None:
            return
        to, mid_ = mail.get("to") or "-", mail["id"]
        cancel = [[{"text": t("btn.cancel"), "callback_data": f"x:{mid_}"}]]
        again = [[{"text": t("btn.sendAgain"), "callback_data": f"w:{mid_}"}, {"text": t("btn.cancel"), "callback_data": f"x:{mid_}"}]]
        if event == "mail-queued":
            # the whole e-mail as it will go (subject, quote, footer), so the owner sees it inside the undo window
            preview = t("draft.subject", subject=mail.get("subject") or "") + "\n\n" + (mail.get("plain") or "")
            m = api.send(c.chat, t("mail.queued", to=to, id=rid, s=int(self.service.undo_s)) + "\n\n" + preview, buttons=cancel)
            if m:
                self.service.link_message(m, rid, "mail", mid_)
        elif event == "mail-waiting":
            m = api.send(c.chat, t("mail.waiting", to=to, id=rid))
            if m:
                self.service.link_message(m, rid, "mail", mid_)
        elif event == "mail-noemail":
            api.send(c.chat, t("mail.noEmail", id=rid, contact=rec["contact"] or "-"))
        elif event == "mail-ask":
            m = api.send(c.chat, t("mail.ask", to=to, id=rid) + "\n\n" + mail["plain"], buttons=again)
            if m:
                self.service.link_message(m, rid, "mail", mid_)
        else:
            text = {"mail-sent": lambda: t("mail.sent", to=to, id=rid, time=_hhmm(mail.get("sentAt"))),
                    "mail-cancelled": lambda: t("mail.cancelled", to=to, id=rid),
                    "mail-unknown": lambda: t("mail.unknown", to=to, id=rid, error=mail.get("error") or "-"),
                    "mail-failed": lambda: (t("mail.failedRetry", to=to, id=rid, error=mail.get("error") or "-", time=_hhmm(mail.get("nextAt")))
                                            if mail.get("nextAt") else t("mail.failed", to=to, id=rid, error=mail.get("error") or "-"))}.get(event)
            if text is None:
                return
            buttons = again if event == "mail-unknown" or (event == "mail-failed" and not mail.get("nextAt")) else None
            if mail.get("tgMsg"):
                api.edit(c.chat, mail["tgMsg"], text(), buttons)
            else:
                api.send(c.chat, text(), buttons=buttons)

    # ---------------- the webhook ----------------

    def handle_webhook(self, path: str, headers, body: bytes) -> tuple[int, bytes, list]:
        """POST /api/tg/<path>: 404 unless the bot and its secret are configured and the path is right,
        403 without the right secret header, 400 for a body that is not a JSON object, 503 while the
        ideas store cannot be used (Telegram retries it later), else 200 (also for what is ignored, so
        Telegram does not send it again)."""
        c = self.cfg
        hdr = [("Content-Type", "application/json"), ("Cache-Control", "no-store")]
        if not c.ready or not hmac.compare_digest(path.encode(), c.webhook_path().encode()):
            return 404, b'{"ok":false}', hdr
        if not hmac.compare_digest((headers.get("X-Telegram-Bot-Api-Secret-Token") or "").encode(), c.secret.encode()):
            return 403, b'{"ok":false}', hdr
        try:
            update = json.loads(body)
        except ValueError:
            return 400, b'{"ok":false}', hdr
        if not isinstance(update, dict):
            return 400, b'{"ok":false}', hdr
        try:
            self.handle_update(update)
        except (ideas.StoreError, OSError):  # the store cannot be read or written: Telegram delivers it again later
            print("tg update: the ideas store cannot be used; Telegram will retry", flush=True)
            return 503, b'{"ok":false}', hdr
        except Exception:  # noqa: BLE001  a bug here must not make Telegram resend the update for a day
            print("tg update failed", flush=True)
        return 200, b'{"ok":true}', hdr

    def _owner(self, chat_id, from_id) -> bool:
        c = self.cfg
        return str(chat_id) == c.chat and (not c.user or str(from_id) == c.user)

    def handle_update(self, u: dict) -> str:
        """One Telegram update; returns what was done (for tests and logs): "ignored" (not the owner),
        "not-ours" (the owner's, but not about GSFPV), "duplicate" (acted on before), else the action."""
        cb = u.get("callback_query") if isinstance(u.get("callback_query"), dict) else None
        msg = u.get("message") if isinstance(u.get("message"), dict) else None
        where = (cb.get("message") or {}) if cb else msg
        if where is None:
            return "ignored"
        chat = (where.get("chat") or {}).get("id")
        sender = ((cb or msg).get("from") or {}).get("id")
        if chat is None or not self._owner(chat, sender):
            return "ignored"
        if not self._ours(cb, msg):
            return "not-ours"   # e.g. a reply to another site's lead note on the shared bot: no answer, no write
        uid = u.get("update_id")
        if isinstance(uid, int) and not self.service.first_update(uid):
            return "duplicate"
        return self._callback(cb) if cb else self._message(msg)

    def _ours(self, cb: dict | None, msg: dict | None) -> bool:
        """Whether an update of the owner's belongs to GSFPV. Reads only, so what is not ours leaves no
        trace: a command of this bot, a reply to a bot message the store mapped to an idea, or a button
        whose idea id (or e-mail id) the store knows."""
        if cb is not None:
            data = cb.get("data") if isinstance(cb.get("data"), str) else ""
            verb, _, rest = data.partition(":")
            if verb in IDEA_VERBS:
                return self.service.get(rest.rpartition(":")[2] if verb in ("s", "u") else rest) is not None
            return verb in MAIL_VERBS and self.service.find_mail(rest) is not None
        text = (msg.get("text") or msg.get("caption") or "").strip()
        cmd = parse_command(text)
        if cmd is not None:
            return cmd[0] in COMMANDS
        reply = msg.get("reply_to_message")
        return isinstance(reply, dict) and self.service.message_target(reply.get("message_id")) is not None

    def _message(self, m: dict) -> str:
        """A command of this bot, or a reply to one of its messages (`_ours` let nothing else through)."""
        c, api, t = self.cfg, self.api(), self.t
        text = (m.get("text") or m.get("caption") or "").strip()
        cmd = parse_command(text)
        if cmd is not None:
            name, arg = cmd
            if name in ("start", "help"):
                api.send(c.chat, t("help", s=int(self.service.undo_s)))
                return "help"
            if name == "queue":
                api.send(c.chat, self.queue_text())
                return "queue"
            return self._note(arg)
        target = self.service.message_target(m["reply_to_message"].get("message_id"))
        if target is None:      # trimmed from the map since `_ours` looked (TG_MSGS_KEPT)
            return "not-ours"
        if not text:
            api.send(c.chat, t("needText"), reply_to=m.get("message_id"))
            return "no-text"
        rid, purpose = target["idea"], target["purpose"]
        try:
            if purpose == "comment":
                self.service.add_comment(rid, text, "telegram")
                api.send(c.chat, t("ok.comment", id=rid), reply_to=m.get("message_id"))
                return "comment"
            if purpose in ("summary", "draft"):
                self.service.set_done_summary(rid, text, "telegram")
                return "summary"
            self.service.reply(rid, text, "telegram")  # the card, a note's card, an e-mail notice
            return "reply"
        except IdeaError as e:
            api.send(c.chat, t("notFound", id=rid) if e.code == "not-found" else t("error", code=e.code), reply_to=m.get("message_id"))
            return f"refused:{e.code}"

    def _note(self, arg: str) -> str:
        """/note <text> [e-mail] [#urgency] [#lang]: the tags and the address leave the text, its line
        breaks stay. Urgency tags are the English names or the owner's own words (#srochno in ru...)."""
        c, api, t = self.cfg, self.api(), self.t
        aliases = {u: u for u in ideas.URGENCIES}
        aliases.update({t(f"urgency.{u}").lower().replace(" ", ""): u for u in ideas.URGENCIES})
        email = ideas.find_email(arg)
        urg, lang, lines = None, "", []
        for line in arg.split("\n"):
            kept = []
            for w in line.split(" "):
                tag = w[1:].lower() if w.startswith("#") else None
                if tag in aliases:
                    urg = aliases[tag]
                elif tag in ideas.LOCALES:
                    lang = tag
                elif not (email and w.strip(".,;:()<>") == email):
                    kept.append(w)
            lines.append(" ".join(kept).strip())
        text = "\n".join(lines).strip()
        if not text:
            api.send(c.chat, t("note.empty"))
            return "note-empty"
        self.service.add_note(text, "telegram", contact=email, lang=lang, urgency=urg)
        return "note"

    def _callback(self, cb: dict) -> str:
        """A button under one of this bot's messages (`_ours` checked that its verb and id are GSFPV's)."""
        c, api, t = self.cfg, self.api(), self.t
        data = cb.get("data") if isinstance(cb.get("data"), str) else ""
        msg_id = (cb.get("message") or {}).get("message_id")
        verb, _, rest = data.partition(":")
        toast, result = "", "callback"
        try:
            if verb in ("s", "u"):
                code, _, rid = rest.partition(":")
                if verb == "s":
                    if code not in STATUS_CODES:
                        raise IdeaError("bad-status")
                    rec = self.service.set_status(rid, STATUS_CODES[code], "telegram")
                    toast, result = t("toast.status", id=rid, status=t(f"status.{rec['status']}")), "status"
                else:
                    rec = self.service.set_urgency(rid, code if code in ideas.URGENCIES else "?", "telegram")
                    toast, result = t("toast.urgency", id=rid, urgency=t(f"urgency.{code}")), "urgency"
                if msg_id and (self.service.message_target(msg_id) or {}).get("purpose") == "card":
                    api.edit(c.chat, msg_id, self.card_text(rec), self.card_buttons(rec))
                if verb == "s" and rec["status"] == "done":
                    self._summary_prompt(rec)
            elif verb == "c":
                rec = self.service.get(rest)
                if rec is None:
                    raise IdeaError("not-found", 404)
                m = api.send(c.chat, t("prompt.comment", id=rest), force_reply=t("placeholder.comment"))
                if m:
                    self.service.link_message(m, rest, "comment")
                result = "comment-prompt"
            elif verb == "e":
                rec = self.service.get(rest)
                if rec is None:
                    raise IdeaError("not-found", 404)
                self._summary_prompt(rec, force=True)
                result = "summary-prompt"
            elif verb == "m":
                hit = self.service.find_mail(rest)
                if hit is None:
                    raise IdeaError("not-found", 404)
                self.service.send_done(hit[0]["id"], rest, "telegram")
                result = "send-done"
            elif verb == "x":
                self.service.cancel_mail(rest, "telegram")
                toast, result = t("toast.cancelled"), "cancel"
            elif verb == "w":
                self.service.send_mail(rest, "telegram")
                result = "send-again"
        except IdeaError as e:
            toast = {"too-late": t("mail.tooLate"), "no-draft": t("mail.noDraft"), "stale-draft": t("mail.staleDraft"),
                     "not-found": t("notFound", id=rest.split(":")[-1])}.get(e.code, t("error", code=e.code))
            result = f"refused:{e.code}"
            if e.code == "stale-draft":   # Send under a replaced draft: nothing went; show the draft that would go now
                hit = self.service.find_mail(rest)
                current = self._current_draft(hit[0]) if hit else None
                if current is not None:
                    self._show_draft(hit[0], current)
        if isinstance(cb.get("id"), str):
            api.answer(cb["id"], toast)
        return result

    def _summary_prompt(self, rec: dict, force: bool = False) -> None:
        """After Done: show the draft if the agent already wrote what was done, else ask for it."""
        c, api, t = self.cfg, self.api(), self.t
        summary = (rec.get("done") or {}).get("summary") or {}
        draft = self._current_draft(rec)
        if draft is not None and summary and not force:
            self._show_draft(rec, draft)
            return
        key = "prompt.summary" if rec["contactKind"] == "email" else "prompt.summaryNoEmail"
        m = api.send(c.chat, t(key, id=rec["id"], lang=rec["lang"] or "en"), force_reply=t("placeholder.summary"))
        if m:
            self.service.link_message(m, rec["id"], "summary")

    @staticmethod
    def _current_draft(rec: dict) -> dict | None:
        """The thank-you draft that Send would queue now (older ones are `superseded`)."""
        return next((m for m in reversed(rec["thread"]) if m["kind"] == "done" and m["state"] == "draft"), None)

    def _show_draft(self, rec: dict, draft: dict) -> None:
        """The draft as it will go, with Send bound to THIS draft's e-mail id (a newer draft makes this
        button refuse) and Edit (write the summary again)."""
        c, t = self.cfg, self.t
        m = self.api().send(c.chat, self.draft_text(rec, draft), buttons=[[{"text": t("btn.send"), "callback_data": f"m:{draft['id']}"},
                                                                          {"text": t("btn.edit"), "callback_data": f"e:{rec['id']}"}]])
        if m:
            self.service.link_message(m, rec["id"], "draft", draft["id"])

    # ---------------- setup (ideas_cli.py) ----------------

    def _hook_owner(self, url: str) -> str:
        """Whose webhook a URL is: "none", "ours" (this API's /api/tg/, also under an older secret) or
        "foreign" (another service reads this bot's updates)."""
        return "none" if not url else "ours" if url.startswith(self.origin + "/api/tg/") else "foreign"

    def setup_webhook(self, replace: bool = False) -> dict:
        """Register this API as the bot's webhook and the commands in the owner's chat. On the shared bot
        this makes gsfpv-api the reader of every update of that bot (other sites ignore their updates
        today); a webhook another service set is never replaced unless `replace` says so."""
        c = self.cfg
        if not c.ready:
            raise RuntimeError(f"the owner bot is not set up: {c.problem}; nothing changed")
        api = self.api()
        info = api.call("getWebhookInfo", {})
        if not isinstance(info, dict):
            raise RuntimeError("Telegram did not answer getWebhookInfo: nothing changed")
        if self._hook_owner(info.get("url") or "") == "foreign" and not replace:
            raise RuntimeError("this bot already has a webhook of another service; nothing changed "
                               "(tg-setup --replace takes the bot's updates away from it)")
        ok = api.call("setWebhook", {"url": self.origin + c.webhook_path(), "secret_token": c.secret,
                                     "allowed_updates": ["message", "callback_query"], "max_connections": 1})
        cmds = api.call("setMyCommands", {"commands": [{"command": k, "description": t} for k, t in
                                                       (("note", self.t("cmd.note")), ("queue", self.t("cmd.queue")), ("help", self.t("cmd.help")))],
                                          "scope": {"type": "chat", "chat_id": c.chat}})   # only in the owner's chat
        return {"webhook": ok is True, "commands": cmds is True, **self.webhook_info()}

    def webhook_info(self) -> dict:
        """What Telegram says about the webhook, without the URL (its path is derived from the secret)."""
        c = self.cfg
        if not c.token:
            return {"configured": False, "problem": c.problem}
        info = self.api().call("getWebhookInfo", {}) or {}
        return {"configured": c.ready, "problem": c.problem or None, "sharedBot": c.shared, "url_set": bool(info.get("url")),
                "url_is_ours": info.get("url") == self.origin + c.webhook_path(), "owner": self._hook_owner(info.get("url") or ""),
                "pending": info.get("pending_update_count"), "last_error": info.get("last_error_message"), "max_connections": info.get("max_connections")}

    def remove_webhook(self) -> bool:
        """Remove this API's webhook (the bot's updates then wait for getUpdates again); another service's
        webhook is left alone."""
        c = self.cfg
        if not c.token:
            return False
        api = self.api()
        info = api.call("getWebhookInfo", {})
        if not isinstance(info, dict) or self._hook_owner(info.get("url") or "") != "ours":
            return False
        return api.call("deleteWebhook", {"drop_pending_updates": False}) is True
