# Deploying ShramkoGSFPV to the hub

The live site is a static release built in CI (`dist.tgz` + `SHA256SUMS`). The hub only unpacks it
and switches a symlink (decision D29 in [`docs/decisions.md`](../docs/decisions.md)). Nothing is built
on the server.

Everything about the hub (address, SSH port, user, key, paths) lives in `deploy/hub.env`, which is
gitignored. Copy [`hub.env.example`](hub.env.example) and fill it in. The commands below read it:

```bash
set -a; . deploy/hub.env; set +a
SSH="ssh -p $GSFPV_PORT -i $GSFPV_KEY -o BatchMode=yes $GSFPV_HOST"
```

## What is where on the hub

| Path | What it is |
|---|---|
| `$GSFPV_BASE/compose.yml` | the two containers, `gsfpv-web` (nginx) and `gsfpv-api` (python) |
| `$GSFPV_BASE/nginx.conf` | copy of [`deploy/nginx.conf`](nginx.conf); mounted read-only into `gsfpv-web` as `/etc/nginx/conf.d/default.conf` (a single-file bind mount) |
| `$GSFPV_BASE/config.env` | secrets of the API; never in git |
| `$GSFPV_BASE/api/`, `data/` | API code (`server.py`, `admin.py`, the ideas modules and `locales/` of "Ideas (v0.7)", the v0.7 modules listed under "v0.7 lane A", the catalogue seed `showcase.json`, the roadmap seed `locales/roadmap-seed.json`), counters, leads, bug reports (`reports.jsonl`, `reports/`), the ideas store (`ideas.json`), share pictures (`share/`), the scene catalogue, the admin's audit (see "Admin") and the climate wind cache (`wind-climate/`) |
| `$GSFPV_BASE/releases/<sha12>/` | unpacked releases (the last 5 are kept) |
| `$GSFPV_BASE/releases/current` | symlink to the live release; nginx serves `/srv/releases/current` |
| `$GSFPV_BASE/incoming/` | uploaded tarballs |
| `$GSFPV_BACKUPS/` | `gsfpv-predeploy-<UTC>-<sha12>.tgz`, written before every switch |

## Why the order matters: the enforced CSP

The enforced `Content-Security-Policy` lists the sha256 of every inline script, per page. The hashes
come from `csp-hashes.conf` **inside each release** (written by `scripts/build-release.mjs`). The
policy that uses them exists only in the repo's `nginx.conf`. nginx reads the hash map only when it
loads its config.

That gives three rules:

- **Upload `nginx.conf` first, then deploy.** With the old `nginx.conf` live, a new release gets
  no enforced header, and `deploy.sh`'s check after the switch fails. The new `nginx.conf` with an
  old release (no `csp-hashes.conf`) sends only the Report-Only header, as before. That is safe.
- **Reload after every switch.** `deploy.sh` and `rollback.sh` both run `nginx -t`, then
  `nginx -s reload` inside `gsfpv-web`. Without the reload, the pages of one release would go out
  with the hashes of another, and their inline scripts would be blocked.
- **`deploy.sh` refuses to switch** if `$GSFPV_BASE/nginx.conf`, or the copy `gsfpv-web` actually
  sees, is not byte-identical (sha256) to `deploy/nginx.conf` in your checkout. It also refuses if
  `gsfpv-web` is not running. It stops before uploading anything. `--no-switch` skips this check,
  because it only unpacks.

## Changing nginx.conf (this includes the first deploy with the enforced CSP)

Do these steps in this order, before the next `deploy.sh`.

1. **Keep the live copy**, so it can be put back:
   ```bash
   $SSH "cp $GSFPV_BASE/nginx.conf $GSFPV_BASE/nginx.conf.prev"
   ```
2. **Upload** from the same checkout you will deploy from:
   ```bash
   scp -P $GSFPV_PORT -i $GSFPV_KEY deploy/nginx.conf $GSFPV_HOST:$GSFPV_BASE/nginx.conf
   sha256sum deploy/nginx.conf; $SSH "sha256sum $GSFPV_BASE/nginx.conf"      # must be equal
   ```
3. **See which file the container reads:**
   ```bash
   $SSH "docker exec gsfpv-web sha256sum /etc/nginx/conf.d/default.conf"
   ```
4. **Test, then load it:**
   - **The container shows the new sha256** (the upload wrote the file in place): test it where it
     will run, then reload.
     ```bash
     $SSH "docker exec gsfpv-web nginx -t" && $SSH "docker exec gsfpv-web nginx -s reload"
     ```
   - **The container still shows the old sha256** (the upload replaced the file, so the container
     keeps the old one until a restart): `nginx -t` inside the container would test the old file.
     Test the new file in a throwaway container with the same image and mounts. Restart only if
     that passes:
     ```bash
     $SSH "cd $GSFPV_BASE && docker run --rm -v \$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro -v \$PWD/releases:/srv/releases:ro nginx:1.29-alpine nginx -t" \
       && $SSH "docker restart gsfpv-web"
     ```
     A config that fails `nginx -t` makes the restarted container crash-loop, and the site goes
     down. That is why the test comes first.
   - **If the test fails:** put the old file back (`$SSH "cp $GSFPV_BASE/nginx.conf.prev $GSFPV_BASE/nginx.conf"`)
     and do not reload or restart. The running nginx keeps the config it loaded, so the site is
     untouched.
5. **Check the site still answers:**
   ```bash
   curl -sI https://gsfpv.flyreelstudio.eu/en/ | grep -i -E '^HTTP|content-security-policy'
   ```
   Expect `200`. The live release decides the header. A release built before the enforced CSP
   gets only `Content-Security-Policy-Report-Only`. A release with `csp-hashes.conf` gets the
   enforced `Content-Security-Policy` with its hashes.
6. **Deploy** as below. The first line `deploy.sh` prints is now
   `nginx.conf on the hub and inside gsfpv-web = deploy/nginx.conf`.

## Changing the API (apps/api/server.py, admin.py)

The API is not part of `dist.tgz`: `gsfpv-api` runs `$GSFPV_BASE/api/server.py` (mounted read-only
at `/app`) and reads it only when it starts. The first release with the SuperSplat catalogue (D35)
needs both the new API and the new `nginx.conf` (location `^~ /api/superspl/`); either order is
safe (without the API change the location answers `404 {"ok": false}`, without the nginx change
the path falls through to the static site's 404 page; the client reports either as an error).

1. Keep the live copy: `$SSH "cp $GSFPV_BASE/api/server.py $GSFPV_BASE/api/server.py.prev"`.
2. Upload and compare (with `apps/api/locales/`, the /s/<id> page texts, and `apps/api/admin.py`):
   ```bash
   scp -r -P $GSFPV_PORT -i $GSFPV_KEY apps/api/locales $GSFPV_HOST:$GSFPV_BASE/api/
   scp -P $GSFPV_PORT -i $GSFPV_KEY apps/api/server.py $GSFPV_HOST:$GSFPV_BASE/api/server.py
   sha256sum apps/api/server.py; $SSH "sha256sum $GSFPV_BASE/api/server.py"      # must be equal
   ```
3. Restart only the API and check it: `$SSH "docker restart gsfpv-api"`, then
   `curl -s https://gsfpv.flyreelstudio.eu/api/health` (200) and, once nginx has the location,
   `curl -sD- -o /dev/null 'https://gsfpv.flyreelstudio.eu/api/superspl/explore?sort=starred&features=walkable&limit=3'`
   twice: `X-Cache: miss`, then `X-Cache: hit`; `...?sort=likes` must answer 400.
4. If it does not come up: put `server.py.prev` back and restart `gsfpv-api` again.

### Bug reports, ideas and share links (W5)

The release with the Feedback dialog and "Share this scene" needs the new API and the new
`nginx.conf` (upload `nginx.conf` first, as above, then the API). Nothing in `compose.yml` changes.

| Route | nginx | API |
|---|---|---|
| `POST /api/report` | `location = /api/report`, POST only, `client_max_body_size 512k`, no cookies | a bug or an idea: stored first in `data/reports.jsonl` (fsync, id `R-YYYYMMDD-NNNN`), then the report in the owner's Telegram (until v0.6 a short note without the diagnostics; since v0.7 the whole report, see "Ideas (v0.7)" below). A bug's diagnostics only with the visitor's consent, in `data/reports/<id>.json`. 8 KB of words, 512 KB on the wire, gzip accepted (unpacked at most 2 MB); honeypot and time-to-submit as for a lead (a suspect is stored, not sent, keeps no diagnostics); 10 an hour per visitor, 300 in all; the disk guard and `REPORTS_CAP_BYTES` (default 1 GB) skip diagnostics, never the record |
| `POST /api/share` | `location = /api/share`, POST only, 512k | a whole JPEG of exactly 1200x630 (at most 400 KB), its words and optionally the flight link's drawing (`render`: `budgetM` 0.25..32, `stochastic` true/false; `/s/<id>` then links `/fly/?scene=<id>&budget=<M>&stochastic`) and optionally `shared`, the sharer's scene settings that differ from the scene's defaults (v0.9: `size` 0.25..100, `walls` on/off, `floaters` 0..64, `wind` off or `{fromDeg, speed, gust}`, `ceiling` off or metres, `drone` id; read strictly, a bad field is dropped; `/s/<id>` appends `&sz=3&wl=0&fl=4&wd=270,4,2&ce=12.5&drone=<id>`): `data/share/<id>.jpg` + `.json`, id 11 random URL-safe characters; 12 an hour per visitor, 300 in all; 503 under the disk guard, 507 over `SHARE_CAP_BYTES` (default 1 GB) |
| `GET /s/<id>`, `GET /s/<id>.jpg` | `location ~ "^/s/[A-Za-z0-9_-]{11}(\.jpg)?$"`, GET/HEAD only; any other `/s/...` is the static 404 | the share page: Open Graph and Twitter card tags (og:image is the picture), its own CSP (one hashed script sends a person on to `/<locale>/fly/?scene=<id>`; crawlers do not run it); the picture with `Cache-Control: immutable` |

New environment (in `compose.yml`'s `environment` or `config.env`, all optional, no secrets):
`PUBLIC_ORIGIN` (default `https://gsfpv.flyreelstudio.eu`, the origin the share pages name; set it
for staging), `REPORTS_CAP_BYTES`, `SHARE_CAP_BYTES`. Telegram uses the existing `TG_BOT_TOKEN` and
`TG_CHAT_ID`.

Check after the restart (the second line must answer 404 from the API, not the site's 404 page):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"kind":"idea"}' https://gsfpv.flyreelstudio.eu/api/report   # 400 (no message)
curl -s https://gsfpv.flyreelstudio.eu/s/AAAAAAAAAAA | head -c 120                                                                                       # <title>Not found
```

**Reading reports.** There is no public route that lists them. Since v0.7 every report is an idea in
`data/ideas.json` (next section); `tools/ideas/ideas.py` (it replaced `tools/reports/pull.py`) reads
them over SSH (this file's `hub.env`), and `pull` copies the raw files into `tools/ideas/inbox/`
(gitignored: visitors' words and contacts never go into git):

```bash
python tools/ideas/ideas.py queue                     # the work queue (an agent starts here)
python tools/ideas/ideas.py pull                      # reports.jsonl, every diagnostics file, ideas.json
python tools/ideas/ideas.py list --kind bug --local   # from the pulled copy
python tools/ideas/ideas.py log R-20261002-0007       # its flight log to replay
```

## Ideas (v0.7): the owner's bot, answers from Gmail, the roadmap

Owner's items 3, 7 and 8 of message 18; design `docs/wip/v07-b.md`. Every report (and every note the
owner writes in Telegram) is an idea in `data/ideas.json` with a status (new, accepted, in progress,
done, rejected), an urgency, the owner's comments, a public title for the roadmap and the e-mails to
the pilot. The owner runs them from Telegram (the shared lead bot by default, see below) or from the
admin; agents read the work queue over SSH. Code: `apps/api/ideas.py` (store), `service.py` (the rules), `ownerbot.py` (Telegram),
`mailer.py` + `outbox.py` (Gmail), `ideas_admin.py` (admin routes), `ideas_cli.py` (agents' commands
inside the container), `texts.py` (the bot's and the e-mails' words).

| Route | nginx | API |
|---|---|---|
| `POST /api/report` | as before | stored as before, then the idea, then the WHOLE report in the owner's chat (the owner's request 2026-10-13): every field, a summary of the technical details, the technical details file and the picture of the view. As a card with buttons when the two-way bot is set up (`TG_WEBHOOK_SECRET`), else as the shared lead bot's plain text (now with every field and the file, no buttons) |
| `POST /api/tg/<32 hex>` | `location ^~ /api/tg/`, POST only, 64 KB, `limit_req` 60/min burst 30 PER CLIENT (the real-IP lines of `/api/admin/` give the visitor's address behind nginx-proxy; the API also limits 120/min per address), so a stranger's flood never uses up Telegram's deliveries | the bot's webhook: 404 unless the bot and its secret are configured and the path (an HMAC of `TG_WEBHOOK_SECRET`) is right; 403 unless `X-Telegram-Bot-Api-Secret-Token` equals the secret; only the owner's updates about GSFPV are acted on (each once); everything else gets 200 and nothing more |
| `GET /api/roadmap` | `location = /api/roadmap`, GET only, no cookies | `{"v":1,"items":[{id, kind, status: planned/in_progress/done, title {lang}, text?, fromPilot, done?, release?}]}`: only items with an English public title, accepted (planned), in progress or done, not hidden; never a pilot's words or contact. ETag/304, `max-age=60` |
| `GET /api/tracks?scene=<hex>`, `GET /api/tracks/<id>/v<n>`, `POST /api/tracks` | `location ^~ /api/tracks`, GET and POST, 64k, no cookies, the real-IP lines of `/api/session/` | courses of gates saved per scene (`tracks.py`, train 1): the list `{"v":1,"tracks":[{id, version, title, gates, lengthM, created}]}` newest first, ETag/304, `max-age=30`; the file immutable; a create 201 `{id, version}`, 400 invalid, 409 scene full (20), 413 over 64 KB, 429 over 10 an hour per client, 507 disk guard. Stored in `DATA_DIR/tracks/`. Detail: `docs/tracks-api.md` |
| `/api/admin/ideas...` | the admin's location | list, update (status, urgency, comment, public title/text, visibility, release, order), note, reply by e-mail, cancel, done + draft, send-done, send a waiting e-mail (`ideas_admin.py`); the Reports tab now reads the same store |

**config.env (never in git; recreate `gsfpv-api` after a change: `docker compose up -d --force-recreate gsfpv-api`):**

| Key | What |
|---|---|
| `TG_WEBHOOK_SECRET` | turns the two-way work on (cards with buttons, replies, /note, /queue). 16-256 characters of `A-Z a-z 0-9 _ -`: `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Without it reports go to the shared lead bot as plain text, as before |
| `TG_OWNER_BOT_TOKEN` | optional; default `TG_BOT_TOKEN`, the shared lead bot (the owner's decision 2026-10-13: no new bot). Set it only to move GSFPV's two-way work to a bot of its own |
| `TG_OWNER_CHAT_ID` | optional; default `TG_CHAT_ID`. In a private chat with the bot it is the owner's own Telegram user id. The owner must open the bot and press Start once, or the bot cannot write to him |
| `TG_OWNER_USER_ID` | the owner's own Telegram user id. REQUIRED when the owner's chat (`TG_OWNER_CHAT_ID`, else `TG_CHAT_ID`) is a group or a channel (a negative id): without it the two-way work stays off (`tg-setup` refuses and `tg-info` shows `problem`), because every member's reply would e-mail a pilot from the owner's Gmail. Not needed for a private chat with the bot (a positive id: the chat is the owner) |
| `TG_OWNER_LANG` | optional: the bot's language (default `ru`) |
| `GMAIL_USER` | `zmei116@gmail.com` (From and Reply-To of every e-mail to a pilot; the name is `MAIL_FROM_NAME`, default "Andrii Shramko") |
| `GMAIL_APP_PASSWORD` | a Gmail app password (Google account, Security, 2-Step Verification, App passwords: 16 letters). The normal password does not work over SMTP. Without it e-mails wait (`waiting_setup`) and the bot says so; once it is set the bot asks per waiting e-mail, nothing goes by itself |
| `MAIL_UNDO_S` | optional; the window in which Cancel stops an e-mail (default 60 s) |
| `GEMINI_API_KEY` | v0.9 (owner's item 4): the Google AI Studio key for `apps/api/translate.py`. With it the owner's reply reaches the pilot in the language THE PILOT WROTE IN (found once by Gemini in their own text, kept on the idea), translated when needed, with his original kept. Without it (or while Gemini fails) English text, the pilot's own language and plain ASCII go as written; anything else is held (`waiting_language`) and the bot says so. The texts are sent to Google for translation |
| `GEMINI_MODEL` | optional; default `gemini-2.5-flash` |
| `GEMINI_TIMEOUT_S` | optional; seconds per attempt (default 12, one retry on a timeout, a network error, HTTP 408/429/5xx) |

**The shared lead bot's updates are now read by `gsfpv-api`.** `tg-setup` gives the bot that
`TG_OWNER_BOT_TOKEN` names (by default the shared `TG_BOT_TOKEN`, @leadformfromallsitesbot, which every
site on the hub uses to send its lead notes) a webhook to `https://gsfpv.flyreelstudio.eu/api/tg/<32 hex>`.
From then on Telegram delivers every update of that bot to `gsfpv-api`: the owner's replies and button
presses under GSFPV's cards, but also his replies to other sites' lead notes and anything anyone writes to
the bot. Until now nothing read them (the sites only send), so no site loses anything; but while the
webhook is set, `getUpdates` on that bot answers 409 for everyone, so no other service can poll it.
`gsfpv-api` acts only on an update from the owner (`TG_OWNER_CHAT_ID` or `TG_CHAT_ID`, and
`TG_OWNER_USER_ID` when set) that belongs to GSFPV: one of its commands (`/note`, `/queue`, `/help`,
`/start`; their menu is set for the owner's chat only), a reply to a bot message the ideas store mapped to
an idea, or a button whose idea or e-mail id the store knows. Everything else (a reply to another site's
lead note, a stranger's message, another site's button) gets 200 and nothing more: no answer, no toast,
no write (`apps/api/ownerbot.py` `_ours`, test `test_ownerbot.SharedBot`). `tg-setup` refuses to replace a
webhook another service has set on the bot (`--replace` overrides; `tg-remove` only removes ours).

**When another site wants its replies too (later).** Telegram allows one webhook per bot, so the sites
cannot each set their own. Two ways, both keeping GSFPV's code as it is: (1) that site gets its own bot
for two-way work (`TG_OWNER_BOT_TOKEN` stays the shared bot for GSFPV, or GSFPV moves to its own bot);
(2) one router on the hub owns the shared bot's webhook and forwards each update to the site that sent
the message being answered: every site records the `message_id` of each note it sends (as
`ideas.json` `tg.msgs` does for GSFPV) and the router asks each site, or a shared map, whose message it
is; updates nobody claims are dropped. Until such a router exists, GSFPV's webhook is the router's place
and the other sites' replies are ignored, as today.

**Why the e-mails land in the inbox.** They are submitted to Gmail's own SMTP server
(`smtp.gmail.com:587`, STARTTLS, then the app password), so Google signs them (DKIM `d=gmail.com`) and
sends them from its own servers (SPF of `gmail.com`), and From is the authenticated `gmail.com`
address (DMARC aligned). Each one is a personal message: one recipient, text plus a simple HTML copy, no
images, no tracking, no link shorteners, the pilot's own words quoted with their date, `Message-ID`,
`In-Reply-To` and `References` per idea, a signature with the site and LinkedIn. Outbound
`smtp.gmail.com:587` from `gsfpv-api` was checked on 2026-10-13 (EHLO 250, STARTTLS 220).

**A pilot's answer to an e-mail** goes to the owner's Gmail inbox (From and Reply-To are
`zmei116@gmail.com`) and is read there; the API sends only, it does not read the mailbox (no IMAP), so
such an answer is not in the idea's thread, nor in Telegram.

**The rules the code holds** (tests in `apps/api/tests/test_mail.py`, `test_ownerbot.py`): an e-mail
goes only on the owner's explicit act (his reply to a card, or Send) and after the undo window; the
thank-you e-mail of a done idea is only a draft until he presses Send; an e-mail is never handed to
SMTP twice by itself (a restart in the middle marks it `unknown` and the owner decides); a temporary
failure is retried after 1, 5, 30, 120 and 360 minutes, a permanent one is not.

**Files.** Upload with the API (step 2 of "Changing the API"), then recreate `gsfpv-api`:
```bash
scp -P $GSFPV_PORT -i $GSFPV_KEY apps/api/server.py apps/api/admin.py apps/api/ideas.py apps/api/ideas_admin.py \
    apps/api/ideas_cli.py apps/api/mailer.py apps/api/outbox.py apps/api/ownerbot.py apps/api/service.py apps/api/texts.py \
    apps/api/translate.py apps/api/langguess.py \
    $GSFPV_HOST:$GSFPV_BASE/api/
scp -r -P $GSFPV_PORT -i $GSFPV_KEY packages/i18n/locales/bot packages/i18n/locales/mail $GSFPV_HOST:$GSFPV_BASE/api/locales/
scp -P $GSFPV_PORT -i $GSFPV_KEY apps/api/locales/roadmap-seed.json $GSFPV_HOST:$GSFPV_BASE/api/locales/   # the roadmap seed, loaded once
```
`data/ideas.json` (and `ideas.lock`) appear at the first start, made from `reports.jsonl` and the old
`report-status.json` (closed -> done); `reports.jsonl` itself is never rewritten. The deploy backups
already take the whole `data/`.

**Order.** `nginx.conf` first (new `limit_req_zone`, `/api/roadmap`, `/api/tg/`), then the files above,
then `config.env`, then recreate `gsfpv-api`, then register the webhook and check Gmail from inside the
container (the agents' CLI uses the container's own environment):
```bash
$SSH "docker exec gsfpv-api python /app/ideas_cli.py tg-setup"     # {"webhook": true, "commands": true, "sharedBot": true, "url_is_ours": true, ...}
                                                                    # refused if another service already set a webhook on the bot (see above)
$SSH "docker exec gsfpv-api python /app/ideas_cli.py tg-info"      # pending updates, last error
$SSH "docker exec gsfpv-api python /app/ideas_cli.py mail-check"   # ok (logs in, sends nothing)
$SSH "docker exec gsfpv-api python /app/ideas_cli.py translate-check"   # v0.9: {"ok": true, "model": ..., "detected": "ru", "polish": "..."} (asks Gemini, sends no e-mail, prints no key)
curl -sD- -o /dev/null https://gsfpv.flyreelstudio.eu/api/roadmap | grep -iE '^(HTTP|etag|cache-control)'   # 200, an ETag, max-age=60
curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' https://gsfpv.flyreelstudio.eu/api/tg/00000000000000000000000000000000   # 404
```
Then the owner sends an idea from the landing with his own second address as the contact, replies to
the card in Telegram and checks that the e-mail arrives in that inbox (not spam) after a minute.

**The pilot's language (v0.9, `translate.py`).** A reply is written in the language the pilot wrote in, English
at worst. The bot's message for a translated reply says "goes in 60 s, translated (ru -> pl)", shows the whole
e-mail and the owner's original under it, with Cancel and "Send my original instead"; for a text the pilot
cannot surely read it says "NOT sent" and why, with "Send as written" and Cancel. Check live with a test
idea (contact: the owner's second address, page language not Russian), `[TEST]` in its text; reply in
Russian: the translated e-mail arrives in the page's or the text's language; reply with Gemini failing (the
key removed from `config.env`, container recreated): the bot holds the Russian text, English still goes.
Another language than en/es/pl/ru gets a frame built once by Gemini and kept in `data/mail-frames/<code>.json`
(delete the file to build it again). `pilotLang` on the idea (`ideas_cli.py show <id> --json`) is the language found.

## Admin (v0.6): /admin/, the scene catalogue, report status

The owner's admin page `/admin/` (a static page of the release: `apps/fly/admin/index.html` +
`apps/fly/src/admin/`) and its API (`apps/api/admin.py`, wired into `server.py`). The scene picker's
Catalogue tab reads `GET /api/catalog` (what the admin published) and falls back to the release's static
`/fly/showcase.json` when the API does not answer.

| Route | nginx | API |
|---|---|---|
| `/admin/` | `location ^~ /admin/`: `no-store`, `X-Frame-Options DENY`, `noindex`, its own strict CSP (`script-src 'self'`, connects only to itself and the scene CDN) | - |
| `GET /api/catalog` | `location = /api/catalog`, GET only, no cookies | the published list, hidden scenes left out; `ETag`, 304 on `If-None-Match`, `max-age=60` (pilots see a publish within a minute) |
| `/api/admin/*` | `location ^~ /api/admin/`, GET/POST only, `client_max_body_size 256k`, `no-store`; the real-IP module takes the client address from the X-Forwarded-For nginx-proxy appends (read from the right, private addresses trusted), so a forged header does not dodge the lockout | login, logout, session, catalogue draft/publish/discard/restore, reports list/status/diagnostics (the list is in `admin.py`'s docstring) |

**Security.** Off unless `ADMIN_PASSWORD_HASH` is set in `config.env` (every admin route answers 503,
never an open door). The password is checked with scrypt (n=16384, r=8, p=1, 16-byte random salt;
one check at a time, 16 MiB, inside the 64 MB container) and a constant-time compare; it is never
stored, logged or echoed. A session is a random id in an `HttpOnly; Secure; SameSite=Strict` cookie on
`Path=/api/admin`, 12 h, in RAM only (an API restart signs the owner out). Every POST but the login
needs the `X-CSRF` token issued with the session. Brute force: 5 wrong passwords from one address in
15 min lock it for 15 min, doubling with each further lock up to 24 h; 30 wrong passwords in an hour
from anywhere refuse every login for an hour and send one Telegram alert (`TG_BOT_TOKEN`). A locked
login is refused before the password is looked at. Every action goes to `data/admin-audit.jsonl`
(time, a keyed hash of the address, action, ok).

**Files in `data/`.** `catalog.json` (live), `catalog-draft.json` (the admin's unpublished work),
`catalog-history/<UTC time>.json` (every version that went live: the undo), `report-status.json`,
`admin-audit.jsonl`. The deploy backups already take the whole `data/`.

**The catalogue entry** (the order in the list is the order pilots see): `id` (SuperSplat id), `version`
(CDN folder v<N>), `title`, `author`, `license`, `thumb` (poster URL, S3 or the CDN only), `kind`
(`interior`, `exterior`, `other`), `collision` (the scene has walls), `walls` (`on`/`off`: the admin
default of the walls switch), `dropFloaters` (0-64), `scale` (0.25-100: the default Scene size, the pilot's [ ] range), `voxelCm`, `sizeMb`, `format`,
`defaultDrone`, `pitch` (one line per language, `{"en": ..., "ru": ...}`), `collections` (ids of the
catalogue's `collections`, each `{id, title: {en, es, pl, ru}}`), `pinned` (the Featured row), `hidden`
(kept, not shown). `showcase.json`'s fields mean the same.

**Default Scene size and the public catalogue (v0.9).** `GET /api/catalog` sends the published scenes without the
hidden ones, plus `defaults`: `{"<sceneId>": {"scale": 30}}` for each hidden published scene whose `scale` is not 1
(the only thing the public learns of a hidden scene; the draft is never exposed). The simulator applies the size
whenever that scene opens (picker, `/fly/?scene=<id>`, a pasted superspl.at link, N): a shared link's size >
the pilot's own saved size for the scene > this default > 1. Same ETag / `max-age=60` as the rest, so a change goes
live within a minute of Publish. Needs the API (`admin.py`) deployed before the simulator build.

v0.7 fields (`packages/scenes/src/catalog.ts` and `admin.py` keep the same rules; out of range = dropped):
`geo` `{lat, lon, place?}` (WGS84, 3 decimals), `compassDeg` (0-360, the compass heading of the scene's
forward axis), `wind` `{fromDeg 0-360, speed 0-30 m/s, gust 0-20 m/s above the mean, source manual|climate}`,
`ceilingM` (collisions ignored above it, scan coordinates), `render` `{budgetM 0.25-32, stochastic}` (from a
pasted link's `?budget=&stochastic`; `stochastic` true = this scene drawn the SuperSplat stochastic way, false =
the classic sorted way, absent = the device's class preset, which is sorted since v0.10 (stochastic on a desktop
WebGPU browser in v0.9); the pilot's own Render / Splat budget settings and a link's parameters outrank it), `about` (our words for the scene page, per language, 1500 characters),
`origin` `{url (superspl.at only), description (600), tags (12), created (ISO), user (SuperSplat user name)}`
(what SuperSplat said: filled by "Add a scene" and "Refresh from SuperSplat"), `extentM` `[x, y, z]` (the
scan's bounding box in metres, from its collision file).

**Drawing defaults (v0.10, admin tab "Drawing").** The catalogue document has a third key beside `collections` and
`scenes`: `drawing` = `{"presets": {"<class>": {"drawing": "sorted"|"stochastic", "budgetM": 0.25-32, "renderScale": 0.4-1}}}`,
class one of `desktop-strong`, `desktop-weak`, `tablet`, `phone` (`packages/render-pc/src/device-class.ts`, `presets.ts`;
`admin.py` `clean_drawing` keeps the same table and drops what is unknown or out of range; a test keeps the two equal). Only the
fields the owner changed are stored: the rest is the simulator's built-in table (`BUILTIN_PRESETS`: sorted everywhere; 4 M / 2.5 M /
2 M / 2 M; 100 / 85 / 85 / 70 % of the screen's pixels). It goes through the same draft, Publish, history and Restore as the scenes
(`GET /api/admin/catalog` returns it in `draft` and `published`, `POST /api/admin/catalog/draft` takes it in `catalog`; a client that sends
no `drawing` key does not wipe it, one that sends it empty removes it) and `GET /api/catalog` carries it when set (absent = the built-in
table, also what an API that predates it gives). The simulator reads it at boot, before any scene opens, and starts the device's class
preset where nothing asks for anything else: the order is the scene's link > the pilot's own Render / Splat budget / Device class settings >
the scene's own `render` entry > the class's preset. Needs the API (`admin.py`) deployed before the simulator build, like the rest; the old
simulator ignores the key. History versions from before it simply have no `drawing` (Restore brings the built-in table back).

**Seeding.** The first time the catalogue is read and `data/catalog.json` does not exist, the API copies
`showcase.json`'s scenes into it (none pinned or hidden, no collections). It looks for `CATALOG_SEED`, then
`showcase.json` next to `server.py` (on the hub: `$GSFPV_BASE/api/showcase.json`). After that the file is
only the picker's fallback.

### First deploy of the admin

Either order of release and API is safe (without the API the picker gets a 404 from `/api/catalog` and
uses its static list). Do it in this order:

1. **The hash**, on the owner's machine (asks twice, no echo; prints only the line; a new salt each run):
   `python tools/admin/hash_password.py`. Put the printed `ADMIN_PASSWORD_HASH=scrypt:...` line into
   `$GSFPV_BASE/config.env` on the hub as it is (no quotes: it has no `$`, which Compose would interpolate).
   Never commit it, never paste it into a chat or a note other than the private vault.
2. **nginx.conf** as in "Changing nginx.conf" above (new: `/admin/`, `/api/catalog`, `/api/admin/`).
3. **The API**: keep `server.py.prev` as in "Changing the API", then upload three files and compare:
   ```bash
   scp -P $GSFPV_PORT -i $GSFPV_KEY apps/api/server.py apps/api/admin.py apps/fly/public/showcase.json $GSFPV_HOST:$GSFPV_BASE/api/
   sha256sum apps/api/server.py apps/api/admin.py apps/fly/public/showcase.json
   $SSH "cd $GSFPV_BASE/api && sha256sum server.py admin.py showcase.json"
   ```
4. **Recreate** the API container so it reads `config.env` again (`docker restart` does NOT re-read an
   env file): `$SSH "cd $GSFPV_BASE && docker compose up -d --force-recreate gsfpv-api"`.
5. **The release** with `deploy.sh` as usual (the picker's storefront and `/admin/`).
6. **Check**:
   ```bash
   curl -sD- -o /dev/null https://gsfpv.flyreelstudio.eu/api/catalog | grep -iE '^(HTTP|etag|cache-control)'   # 200, an ETag, max-age=60
   curl -s -o /dev/null -w '%{http_code}\n' -H 'If-None-Match: <that etag>' https://gsfpv.flyreelstudio.eu/api/catalog   # 304
   curl -s -o /dev/null -w '%{http_code}\n' https://gsfpv.flyreelstudio.eu/api/admin/session    # 401 (503: the hash is missing or malformed)
   curl -sI https://gsfpv.flyreelstudio.eu/admin/ | grep -iE '^(HTTP|cache-control|x-frame-options|content-security-policy)'
   ```
   Then sign in at `/admin/`, and `$SSH "tail -3 $GSFPV_BASE/data/admin-audit.jsonl"` shows the login.
   Two wrong passwords sent with different forged `X-Forwarded-For` headers must show the SAME `ip` hash
   in the audit (nginx-proxy appends the real address; checked locally in `evidence/2026-10-02/v06-admin-nginx.json`).

Changing the password later: a new line from the tool, replace it in `config.env`, recreate `gsfpv-api`
(step 4). Switching the admin off: remove the line and recreate.

## v0.7 lane A: scene pages, SuperSplat's facts, the wind of a place

New API modules, all next to `server.py` in `$GSFPV_BASE/api/`: `scenepages.py`, `templating.py`,
`scene-slots.json`, `superspl_facts.py`, `turbostream.py`, `licences.py`, `wind.py` (plus the changed
`server.py` and `admin.py`). Nothing new in `config.env`; Open-Meteo needs no key.

| Route | nginx | API |
|---|---|---|
| `GET /{lang}/scenes/`, `/{lang}/scenes/<id>/` | `location ~ "^/(en\|es\|pl\|ru)/scenes/([0-9a-f]{6,32}/)?$"`, GET/HEAD, `$uri` only, no cookies; `/{lang}/scenes` and `/{lang}/scenes/<id>` (no slash) -> 301 to the slash form | the scene pages from the published catalogue and the live release's templates (`releases/current/scene-templates/`); their own CSP (`script-src 'none'`), ETag/304, `max-age=300`; 404 for a hidden or unknown scene, 503 while no release has templates |
| `GET /scenes/sitemap.xml`, `/scenes/llms.txt` | two `location =` | every scene page in 4 languages (lastmod = the catalogue's publish time); the same list for answer engines. `robots.txt` names the sitemap, `llms.txt` links the list |
| `GET /api/wind/<id>?mode=now` | `location ~ "^/api/wind/[0-9a-f]{6,32}$"`, GET only; the client address from the real-IP module (as `/api/admin/`), `X-Forwarded-For $remote_addr` | `{"ok": true, "fromDeg", "speed", "gust", "at", "source": "now"}` from Open-Meteo's forecast, cached 15 min per place; 404 without geo; 30 a minute per visitor |
| `GET /api/admin/superspl/<id>[?fresh=1]` | the existing `^~ /api/admin/` | SuperSplat's facts of a scene (`https://superspl.at/scene/<id>.data` + the CDN's `scene.voxel.json`), 10 min cache, 20 upstream calls a minute |
| `GET /api/admin/geo/search?q=&lang=` | same | places by name (Open-Meteo geocoding) |
| `GET /api/admin/wind/climate?lat=&lon=` | same | the prevailing wind (5 full years of Open-Meteo's archive), kept in `data/wind-climate/` |
| `/scene-templates/` | `location ^~ /scene-templates/ { return 404; }` | - (read from the disk, never served) |

**compose.yml changes:** `gsfpv-api` mounts `./releases:/srv/releases:ro` (the templates ship with each
release, so a new design needs no API upload). `SCENE_TEMPLATES` overrides the directory.

**The landing's catalogue** is built from the committed snapshot `apps/site/src/generated/catalog.json`
(a build depends on the commit alone) and refreshed from `/api/catalog` in the visitor's browser. To have
the newest published scenes in the built HTML (crawlers, no JavaScript), refresh it before a release:
`pnpm --filter @gsfpv/site catalog:refresh`, then commit the file.

**Order** (each step is safe on its own: without the API the scene links 404/502 behind nginx, without the
release the API answers 503 for the pages; nothing else changes):
1. `nginx.conf` as in "Changing nginx.conf".
2. The API files (`scp` the eight files above and `apps/api/locales/`), compare the sha256 sums.
3. `compose.yml` with the new mount, then `$SSH "cd $GSFPV_BASE && docker compose up -d --force-recreate gsfpv-api"`.
4. The release with `deploy.sh` (it carries `scene-templates/`).
5. Check:
   ```bash
   curl -sI https://gsfpv.flyreelstudio.eu/en/scenes/ | grep -iE '^(HTTP|content-security-policy|etag)'   # 200, script-src 'none'
   curl -s https://gsfpv.flyreelstudio.eu/en/scenes/70b50d42/ | grep -c 'application/ld+json'                # 1
   curl -s -o /dev/null -w '%{http_code}\n' https://gsfpv.flyreelstudio.eu/scene-templates/manifest.json      # 404
   curl -sI https://gsfpv.flyreelstudio.eu/en/scenes/70b50d42 | grep -iE '^(HTTP|location)'                    # 301, /en/scenes/70b50d42/
   curl -s 'https://gsfpv.flyreelstudio.eu/api/wind/70b50d42?mode=now'                                       # 404 until the scene has geo
   node scripts/smoke-release.mjs https://gsfpv.flyreelstudio.eu                                              # checks the scene pages when the API answers
   ```

## v0.12 Fly by Sound: recordings (lane v12-feedback)

A pilot's flight and voice are recorded in the browser (OPFS), saved to disk, and sent to the author. The design
is `docs/wip/v12-plan.md` section 4.3 (sections 8 and 9 override it); this section grows with the lane's steps.

**nginx.conf (step 1).** Three changes, none of which needs the API; follow "Changing nginx.conf" (upload, `nginx -t`,
reload):

| Change | Where | Why |
|---|---|---|
| `microphone=(self)` in the `Permissions-Policy` | `location ~ ^/(en\|es\|pl\|ru)/fly/` only; the site, the assets, the admin and the scene pages keep `microphone=()` | `getUserMedia` (the voice recording) and the browser's speech recognition are refused by `microphone=()` |
| `media-src 'self' blob:` | the map `$gsfpv_csp_rest`, so the enforced and the report-only CSP both have it | the replay plays a recording's voice from a `blob:` URL; without the directive it falls back to `default-src 'self'` and is blocked |
| `location ^~ /api/session/` | GET and POST only, `client_max_body_size 1100k`, the client address from the real-IP module (as `/api/admin/`), cookie and `Authorization` cleared, `no-store` | the chunked upload of a recording (the routes come with the API store, step 6); until then the API answers its own 404 |

Check after the reload (`apps/api/tests/test_nginx_routes.py` reads the same rules from the file; the smoke script checks them on a served release):
```bash
curl -sI https://gsfpv.flyreelstudio.eu/en/fly/ | grep -iE '^(permissions-policy|content-security-policy)'   # microphone=(self); media-src 'self' blob:
curl -sI https://gsfpv.flyreelstudio.eu/en/privacy/ | grep -i '^permissions-policy'                          # microphone=()
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE https://gsfpv.flyreelstudio.eu/api/session/probe          # 403: GET and POST only
node scripts/smoke-release.mjs https://gsfpv.flyreelstudio.eu
```
Local runs: `tools/bench/scripts/serve-csp.mjs` sends the same `Permissions-Policy` per location and answers `/api/session/`
like this location (403, 413), reading both from `deploy/nginx.conf`; `tools/bench/src/sonicrec-headers.ts` proves the two header
changes in headless Chrome (a fake microphone), each with a control served under the config as it was before v0.12.

**API store (step 6).** `apps/api/sessions.py` and the routes in `server.py` take a recording in chunks. Upload the API
(`server.py`, `sessions.py`) first, then restart `gsfpv-api`; nothing else changes on the hub. The routes (the token is shown
once, at `start`, and sent back as the `X-Session-Token` header):

| Route | What it does |
|---|---|
| `POST /api/session/start` | body `{size, sha256, consentSend: true, packageId?, lesson?, minor?, voice?, release?}`; answers the session id, the token, the chunk size (1 MiB) and the number of chunks; 403 without `consentSend`, 413 over `SESSION_MAX_BYTES`, 507 when the disk guard or `SESSIONS_CAP_BYTES` says no; a package that is already stored is not uploaded again (the answer says `stored` and `duplicate`) |
| `POST /api/session/<id>/<n>` | the raw bytes of chunk n (optional `X-Chunk-Sha256`): streamed to disk in 64 KB pieces, fsynced, then recorded as held; the same chunk again is accepted, other bytes for a held chunk are 409 |
| `POST /api/session/<id>/finish` | the whole file is hashed against the `start` hash, `manifest.json` is read from the zip (a minor's package needs the guardian's confirmation: the server refuses it otherwise), the package is fsynced and moved into place, then the answer says `stored`; a repeat gives the same answer |
| `GET /api/session/<id>` | the chunks held (to resume) or each channel's status and `delivered` |

Config names (all optional, in `config.env`): `SESSION_MAX_BYTES` (default 100 MiB a package), `SESSIONS_CAP_BYTES` (2 GiB in all,
uploads in progress count), `SESSION_RETENTION_DAYS` (1826, the privacy text's five years; an undelivered package is never aged out).
Files: `$GSFPV_BASE/data/sessions/index.jsonl` (one line per package stored, a tombstone per deletion) and `sessions/<id>/`
(`meta.json`, `package.zip`). The client's address is never written. Checked by `apps/api/tests/test_sessions.py`.

**Where the recordings live on the hub (2026-11-08).** `$GSFPV_BASE/data/sessions` is a bind mount (`/etc/fstab`) of
`/mnt/HC_Volume_107400857/gsfpv/sessions`, the hub's Hetzner volume (10 GB, the owner can grow it; the root disk cannot grow).
The empty directory under the mount is immutable (`chattr +i`), so if the volume is missing the store gets a write error instead
of filling the root disk. The store measures free space on that volume (`MIN_FREE_GB` there), the events' disk guard measures
`data/`. The container sees the mount only if it was there when the container started: after a boot without the volume,
`docker restart gsfpv-api` once it is mounted again. The predeploy backup leaves `data/sessions` out; the weekly
server backup (`/etc/server-backup/paths.d/gsfpv.paths`) takes it.

**Delivery (step 7).** `apps/api/session_delivery.py` sends every stored package to the owner by Telegram and by e-mail, from the
queue kept in each session's `meta.json` (so a restart loses nothing; a send that a restart cut off is queued again). Upload the API
(`server.py`, `sessions.py`, `session_delivery.py`) first. **`deploy/compose.yml` changed too: `gsfpv-api` has 192 MB (was 64 MB, plan
section 8); Compose applies it only when the container is recreated:**
```bash
scp -P $GSFPV_PORT -i $GSFPV_KEY deploy/compose.yml $GSFPV_HOST:$GSFPV_BASE/compose.yml
$SSH "cd $GSFPV_BASE && docker compose up -d --force-recreate gsfpv-api && docker inspect gsfpv-api --format '{{.HostConfig.Memory}}'"   # 201326592
```
| Channel | What goes | Confirmed when |
|---|---|---|
| Telegram | `sendDocument`, the file part read from disk in 256 KB pieces, up to 49 MiB (`SESSION_TG_MAX_BYTES`); over it a message with the admin link, status `link` | Telegram's answer is ok WITH a message id (an ok that names none is a failure, `telegram-no-id`, tried again) |
| E-mail | one message to `SESSION_MAIL_TO` (default `GMAIL_USER`, the owner's own address) through the authenticated Gmail SMTP server, the zip as a base64 attachment encoded and written to the socket in about 100 KB pieces, up to `SESSION_MAIL_MAX_BYTES` (15 MiB; Gmail's 25 MB limit counts the base64 text: a 15 MiB package is a message of about 21 MiB); over it a text message with the admin link, status `link` | the SMTP server accepted the message after DATA (there is no read receipt) |

Each channel has its own worker thread, status and retries: a failed try waits 30 s, 2 min, 10 min, 30 min, 2 h, 6 h, 12 h, then 24 h; Telegram's
`retry_after` is honoured when longer; the 9th failure makes the channel `failed` (the admin's resend, step 9, starts it again). A channel that is not
set up uses no tries (it looks again each minute). **A claim that has stood `sending` for 5 minutes with no worker on it** (what a failed write of `sent`, or of a
failure, leaves behind when the disk is full at that moment) goes back to `queued` without a restart (a second copy for the owner, which costs nothing where a
lost recording would); once per channel: when the requeued send also ends with no record, the channel is `failed` (`lost-record`) for the owner's resend
instead of a third copy, and the owner is told through the other channel. **A channel that fails 3 times is reported through the other** (a Telegram message, or an e-mail
`[Fly by Sound] telegram delivery of recording S-... failed 3 times`), once, and once more when it gives up; a notice that cannot go is kept pending and
retried. `delivered` is true only when both channels are `sent` or `link`. Config names (all optional): `SESSION_MAIL_TO`, `SESSION_MAIL_MAX_BYTES`,
`SESSION_TG_MAX_BYTES`; the Telegram chat and token are those of the owner bot (`TG_OWNER_CHAT_ID`/`TG_CHAT_ID`, `TG_OWNER_BOT_TOKEN`/`TG_BOT_TOKEN`), Gmail
is `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Housekeeping (every 5 minutes with the counter's) removes uploads left unfinished for 24 h, an upload that has held no chunk at all for 15
minutes (its reservation returns to the pool: `start` is anonymous and reserves the whole size; a chunk that is arriving keeps its upload), and delivered packages
past `SESSION_RETENTION_DAYS`. Checked by `apps/api/tests/test_session_delivery.py` (fake Telegram and a local SMTP server, nothing leaves the machine).

**Sending (step 8).** The page's client (`apps/fly/src/sonic-session/upload.ts`, driven by `send-control.ts`) speaks the routes above; it needs
no change on the hub beyond the API of steps 6 and 7. What it sends is the whole package as the pilot confirmed it: start (size and SHA-256 of the
package and `consentSend: true`, which the page sends only after the pilot's own yes: the second press of key U after the question was read out, the
helper's Send with the tick set, or a spoken yes where the pilot allowed voice commands), then chunk after chunk (each with its `X-Chunk-Sha256`, the token
in `X-Session-Token`), then finish; it keeps the package on the device through all of it and after it, resumes from what the server holds (`GET`), waits out
failures (2 s, 4 s ... five minutes; a rate limit a minute, a full server five) and goes on at the next start of the page, and says "delivered" only when
the status shows both channels `sent` or `link`. A recording of a minor without the guardian's confirmation is never sent (the page checks the package's own
consent, and the server refuses it too). A request is given 60 s plus the time its bytes take at 8 kB a second (64 kbit/s), so a 1 MiB chunk gets about 3 minutes and an
uplink of 100 kbit/s, which needs 84 s for it, can finish one (the whole request used to have 60 s whatever it carried, so such a line never could). `upload.json` in the session's own folder in the browser keeps the server's id and token between visits.
**Local check:** `apps/api/tests/rig_server.py` runs the real handler, store and delivery workers with a fake Telegram and SMTP on 127.0.0.1;
`tools/bench/src/sonicrec-upload.ts` drives the page against it through `serve-csp.mjs` with `API_PROXY` (the proxy forwards the upload's own headers, as
this nginx location does). The speech recognition of the voice command is a stand-in there: the real service is not tried.

**Admin: Recordings (step 9).** The owner's tab at `/admin/` lists the stored recordings with each channel's state, downloads a package (a plain link;
the API streams the file from disk, `admin.FileBody`, so a package of up to 100 MiB never sits in memory), sends one channel again, and deletes a recording
on a pilot's or a parent's request (two clicks; the server keeps only a tombstone line with the id and the reason). Routes (behind the admin session; POST
also needs `X-CSRF`), added with `AdminApi.add_route` from `sessions_admin.py`:

| Route | What it does |
|---|---|
| `GET /api/admin/sessions` | every stored recording, newest first (id, when, size, SHA-256, a few facts of the manifest, each channel's state), totals, what the channels are set up for |
| `GET /api/admin/sessions/<id>/package` | the `.zip` as an attachment, streamed from disk; 404 for an unknown or unfinished id |
| `POST /api/admin/sessions/<id>/resend` | body `{channel: telegram\|email}`: that channel goes back to queued, its failures cleared, its worker woken |
| `POST /api/admin/sessions/<id>/delete` | body `{confirm: true}`: the package and its state are removed |

Never in the list: the upload token or its hash, the pilot's nickname, the device or the user agent (they stay inside the package). Every download, resend and
deletion is in the admin's audit log (`sessions.download`, `sessions.resend`, `sessions.delete`, the id, never a token). **To deploy:** upload the API
(`server.py`, `admin.py`, `sessions_admin.py` and the files of steps 6 and 7), restart `gsfpv-api`, then ship the release (the tab is in the admin bundle);
no nginx change (a package is streamed by the API and passed through by the existing `/api/admin/` location). Checked by `apps/api/tests/test_sessions_admin.py`
(a 20 MiB package over a real socket: the server's memory peak 0.28 MiB, against 20.1 MiB for a body that is not streamed) and, in a browser, by
`tools/bench/src/sonicrec-admin.ts` (the admin page as a release carries it, a TEST password, a local copy of the API; **the live admin is never visited**).

## Rooms (train 1, lane rooms): flying together

A third container, `gsfpv-rooms` (`deploy/compose.yml`): `python:3.12-alpine`, read-only root, `./rooms:/app:ro`, only on
`gsfpv-internal`, `mem_limit 64m`, `cpus 0.25`, `pids_limit 8`, no host port, no data volume (rooms live in RAM). One asyncio
process (`apps/rooms/rooms.py`, stdlib only) on port 8091. Protocol, byte layouts and limits: `docs/rooms-protocol.md`.

| Route | What |
|---|---|
| `GET /api/rooms/health` | `{ok, v, rooms, pilots}` |
| `GET /api/rooms` | listed rooms, newest first |
| `POST /api/rooms` | body (at most 4 KB) `{scene: {id, render?}, shared?, name?, listed?, course?}` -> 201 `{id, hostKey}` |
| `GET /api/rooms/<id>` | one room (never its host key) |
| `GET /api/rooms/ws` | WebSocket, protocol `rooms/1` |

nginx: zones `gsfpv_rooms` (30 r/min, burst 20, estimate) and `gsfpv_rooms_ws` (4 sockets per address) after the `gsfpv_tg`
zone; `location = /api/rooms/ws` (HTTP/1.1, `Upgrade`, `Connection "upgrade"`, read timeout 75 s) and `location ^~ /api/rooms`
after `/api/health`; both take the address the hub's front proxy appended. Tests: `apps/api/tests/test_nginx_rooms.py`,
`python -m unittest discover -s apps/rooms/tests`. **To deploy (once, in the release order):** after the API and before nginx,
`bash deploy/release-rooms.sh --compose` (creates only `gsfpv-rooms`; health from inside the network), then `release-nginx.sh`,
then `ship.sh` (its neighbour diff allows `gsfpv-web,gsfpv-api,gsfpv-rooms`). Undo: `bash deploy/release-rooms.sh --undo --compose`
and `docker compose stop gsfpv-rooms`; with the nginx locations still in, `/api/rooms` answers 502, which the page must treat as "rooms unavailable" (stage R2 of the lane).

## Deploying a release

**Scripts (2026-11-08).** The release order is three scripts, each reading `deploy/hub.env` and printing no value from it:
`bash deploy/release-api.sh [--compose] [--recreate] [--locales] <files under apps/api>` (`.prev` copies, sha256 on both ends,
restart or recreate, `/api/health` 200 and no Traceback; `--undo` puts the `.prev` copies back), `bash deploy/release-nginx.sh`
(`.prev`, sha on the hub and in the container, `nginx -t`, reload; a failed test puts `.prev` back), and `bash deploy/ship.sh <sha>`
(it waits for green CI, downloads the artifact until the zip tests whole, and does steps 2 to 5 below). `ship.sh` holds the hub's
deploy lock `/tmp/hub-deploy.lock` for the run; `HUB_LOCK_HELD=1` when the caller already holds it for a longer job.

1. Take `dist.tgz` and `SHA256SUMS` from the CI run of the commit you ship.
2. Take a neighbours snapshot before the deploy: `python deploy/neighbours.py snap <dir>`.
3. Deploy:
   ```bash
   bash deploy/deploy.sh dist.tgz SHA256SUMS
   ```
   It checks, in order:
   - the sha256 of the tarball, locally and on the hub;
   - the `nginx.conf` guard above;
   - free disk on the hub (at least 2 GB and 3x the tarball);
   - a backup of `$GSFPV_BASE` without the releases (no backup, no switch).

   Then it switches `current`, runs `nginx -t` and reloads. It then waits up to 5 s for `/en/` to
   be served with **every** `/en/` hash from the release's `csp-hashes.conf`. If `nginx -t` fails,
   a hash is missing, or the release lists no hash for `/en/`, it puts the previous release back,
   reloads, and exits 1.
4. Take a neighbours snapshot after the deploy, then diff the two:
   `python deploy/neighbours.py diff <before> <after> --allow gsfpv-web,gsfpv-api`. Anything other
   than our own additions means STOP and roll back.
5. Run the smoke test on the live site: `node scripts/smoke-release.mjs https://gsfpv.flyreelstudio.eu`.

**Before the first deploy with backups:** the SSH user must be able to write `$GSFPV_BACKUPS` and
read everything in `$GSFPV_BASE` except `releases/` and `incoming/`. Otherwise every deploy stops
with "no switch". That fails safe, but it blocks deploys. To check, run the command below. It
should print `backups writable` and nothing else:

```bash
$SSH "test -w $GSFPV_BACKUPS && echo backups writable; find $GSFPV_BASE \( -path $GSFPV_BASE/releases -o -path $GSFPV_BASE/incoming \) -prune -o ! -readable -print"
```

## Rolling back

```bash
bash deploy/rollback.sh            # list the releases still on the hub, and "current"
bash deploy/rollback.sh <sha12>    # switch to one of them
```

The switch is the same atomic `mv -T`. Then `rollback.sh` runs `nginx -t` and reloads. If the test
fails, it points `current` back where it was and exits 1. After the reload it checks `/en/`:

- **A release with `csp-hashes.conf`:** every `/en/` hash must be in the enforced header.
- **An older release without `csp-hashes.conf`:** there must be no enforced header, only
  Report-Only.

Run the smoke test after every rollback.

## Tested so far, and what is not

Both scripts were run end to end on this PC against a fake hub: fake `ssh`, `scp` and `docker`, and
real symlinks. That covered 16 cases: the three refusals, a normal deploy, a stale reload (one hash
out of six missing, so the previous release was put back), a release without an `/en/` line, a failed
`nginx -t`, rollbacks both ways, and a release built before the enforced CSP. On the real hub they
have not been run yet. Neither has `nginx -t` on this `nginx.conf`: Docker does not run on the build
PC. The CI step "Serve the release behind the real nginx config" runs it on every push.
