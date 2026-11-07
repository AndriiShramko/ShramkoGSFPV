# v0.12 lane v12-feedback: recordings, delivery, admin and site for Fly by Sound

Plan: `docs/wip/v12-plan.md`, section 4.3 (sections 8 and 9 override earlier text). The sound package is the git submodule `packages/sonic-fpv`: read its `docs/design/stage-1-spec.md` (section 13 overrides the sections above it), its `AGENTS.md` and `src/contract.ts` before using it. How this repository is worked on: the gsfpv skill (gates, headless browser runs, `SITE` not `BASE`, B18, locales, determinism).

Worktree `C:/dev/gsfpv-v12-feedback`, branch `v12-feedback`, cut from `v03-lead` a1ea872 (lead step 0: the submodule, the seams, the five keys). Depends on: step 0 (done) and sonic-core `main` 3959930; step 5 also on v12-flight step 7 (`ctx.sonic`; a stub runtime until then); recorder tests emit synthetic `sonicSample` until v12-flight step 2.

## Owns

`apps/fly/src/sonic-session/**`, `apps/fly/src/app/builtin/sonic-session.ts`, `apps/fly/src/admin/**`, `apps/api/**`, `deploy/**`, `tools/bench/scripts/serve-csp.mjs`, `scripts/smoke-release.mjs`, `apps/site/**`, `packages/i18n/locales/{site,mail}/**`, `packages/i18n/locales/admin/sessions/**`, `packages/i18n/locales/fly/sonicrec/**`, `tools/bench/{src,test}/sonicrec-*`. Dictionary key prefixes: `sonicrec.*`, `admin.sessions.*` (the flight lane has `sonic.*`, `gpuhint.*`; the lead has `keys.sonic.*`).

Not yours: `features.ts`, `context.ts`, `sonic-context.ts` and `keymap.ts` (the seams are in place: the feature stubs, `ctx.sonic`, the `sonicSample` and `sonicEvent` events, the keys T U I Z G with their labels), `packages/sonic-fpv`, `C:/dev/ShramkoSonicFPV`, and every other worktree. The generated site files (`apps/site/src/generated/features.json`) are produced by `scripts/gen-catalog.ts`, never by hand.

## Rules

- Commit locally, one commit per step, with the Status line of that step ticked in the same commit. Never push, deploy, SSH or log in to the live admin (admin routes are tested on a copy, never live).
- Never edit the submodule or `C:/dev/ShramkoSonicFPV`. A change needed there goes under "Needs from sonic-core" below (reason and a failing test) and you work around it with a local adapter.
- Plan section 8 overrides step 7: `SESSION_MAIL_MAX_BYTES` defaults to 15 MB and `gsfpv-api` gets 192 MB in `deploy/compose.yml`; bigger packages go as an admin link; every file is still streamed from disk.
- A step runs only the checks its change touches (api-unittest for `apps/api`, i18n check and site `verify` for `apps/site`, smoke for `deploy`, vitest `sonicrec-*` for the page); the lead runs every gate once before release. Browser runs are headless through `tools/bench/src/chrome.mjs` and hold `C:/dev/.gpu-lock` when they draw; local site checks use `SITE=http://localhost:<port>`. Long logs go to files.
- Texts for people only in `packages/i18n/locales/**` (en, es, pl, ru); Cyrillic or Polish letters outside locales fail B18 (write `\uXXXX` in tests).
- Every number you report is measured or labelled an estimate. How a sound feels cannot be judged by an agent: say so.
- Recording the replay markers (plan section 9.5): write every `sonicEvent` as it comes, including the host's `lesson open`, the `key` events with the action `reset.checkpoint`, `reset.start` or `next`, and the `speech` event with the key `speech.end`. The session writer throws for a minor's package that claims `send` or `speechRecognition` without a confirmed guardian: do not weaken it.

## Status

- [ ] 1 Headers: `/{lang}/fly/` `microphone=(self)`, `media-src 'self' blob:`, `location ^~ /api/session/`; `serve-csp.mjs` sends Permissions-Policy; smoke checks; `test_nginx_routes.py`
- [ ] 2 Recorder `sonic-session/recorder.ts`: consent by voice and key T, MediaRecorder Opus slices, 30 Hz frames, events, sonic-core `SessionWriter` into OPFS
- [ ] 3 Local save and resume: zip from OPFS, file picker or download, unfinished sessions offered at the next start
- [ ] 4 Survey UI: spoken surveys, digit answers, open answers by voice, skip, child variant, `survey.json`
- [ ] 5 Replay: open a package, rebuild the world, drive the view and the engine from recorded frames, voice on the same clock, replay-check line
- [ ] 6 API store `apps/api/sessions.py` and routes in `server.py` (start, chunks, finish, status), caps and rate limits, `tests/test_sessions.py` with negative controls
- [ ] 7 Delivery: persistent queue, worker thread, per-channel status, retries, Telegram `sendDocument` streamed up to 49 MB, mail attachment up to `SESSION_MAIL_MAX_BYTES` (15 MB), else an admin link
- [ ] 8 Upload client `sonic-session/upload.ts`: chunked, resumable, "delivered" only when both channels confirm, key U, a helper's button, voice
- [ ] 9 Admin tab: list, streamed download, resend per channel (`ADMIN.add_route`), `apps/fly/src/admin/sessions/`, `locales/admin/sessions/`
- [ ] 10 Site: privacy section on Fly by Sound recordings in four languages, landing `/{lang}/sound/`, sitemap, i18n check, `a11y.mjs`, `verify.mjs`
- [ ] 11 Lane end: api-unittest, smoke on a local build, Status

## Needs from sonic-core

None yet. Format: the change, the reason, and the failing test that proves it.

## Notes

Risks named in the plan (4.3): the 64 MB API container (now 192 MB by section 8; stream every file); Gmail refuses mail over 25 MB; OPFS can be evicted when `persist()` is refused, so offer the local save at once; microphone plus speech recognition at once fails on some systems; Chrome's permission prompt is hard to reach with a screen reader (the helper clicks it); voice and flight clocks drift (store a sync mark per slice).
