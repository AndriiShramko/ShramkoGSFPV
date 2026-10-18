# v0.9 lead - merge, gates, benches (the lead's hands)

Base `a3dd3eb` (branch `v03-lead`; `origin/main` 8c90f53 is its ancestor, nothing newer on origin on 2026-10-18).
Plan `docs/wip/v09-plan.md`; lane notes `docs/wip/v09-<lane>.md`. Nothing was pushed or deployed; no SSH.

## Status

RESUME-FIRST: `git log --oneline -30` shows which `Merge v09-*` commits exist; the runner for the benches is
`.cache/v09-lead/run-benches.sh` (gitignored, resume-safe by `.done` markers; logs in `.cache/v09-lead/*.log`).

- [x] eight merges (section 1), decisions renumbered D44-D74 (section 3), gen-catalog regenerated
- [x] gates once on the merged tree, all green (section 5)
- [x] merged local release built (3329aae, then c473e0c after one CSS fix) and the lanes' benches run once (section 6)
- [x] merge bugs found by the gates and benches, fixed (section 4)
- [x] deploy list, not-verified list, owner questions (sections 7-9)
- [ ] deploy, live checks, STATE.md, vault: the lead, after this

## 1. Merged (`git merge --no-ff`, order F A R E B N C D)

| # | Lane | Branch head | Merge commit | Items |
|---|---|---|---|---|
| 1 | F mail, pilot's language | 5b28a64 | 29741ce | 4 |
| 2 | A loading, video export | d8cb4a2 | 49bc1f4 | 3b 8 10 16, lemons |
| 3 | R drawing, stochastic | 5dacfac | 5d3cb36 | 7 13 |
| 4 | E input latency | ab65ed1 | dfab24f | 12 |
| 5 | B keyboard game scheme, F key | 899f402 | c206655 | 1 6 |
| 6 | N next scene, crash hint | d66d041 | 666e671 | 9 11 |
| 7 | C scene settings, sharing | 9a242b2 | 958a23b | 14 15 17 |
| 8 | D 3D drone models | 2bbda45 | 67cb28b | 3a |

Lead commits after the merges: a13e979 (renumber), cb55ad1 (gen-catalog), 2a6cef2 (share test), 3329aae (gate
evidence), c473e0c (hint CSS + README restore). No lane changed `pnpm-lock.yaml` or any `package.json`.

## 2. Conflicts and how they were resolved

| Merge | Where | Resolution |
|---|---|---|
| A R E B N C D | `docs/decisions.md` | both sections kept, renumbered at the end (section 3) |
| F | none | clean |
| R | `app/builtin/video-export.ts` | A's `setDetail('auto')` (the engine's own levels under cinema's budget) AND R's `setStochastic(false)` for the run, with `prev.stochastic` restored in `restore()` |
| R | `play/easy.ts` | one guard: A's placement (after `lastT` is set, so the next dt is one frame, not the whole switch) with R's wording; lane B's `play/game.ts` needed none |
| E | `ui/hud.ts` | union: `statsDrawing` (R, F3's drawing line), `statsInput` and `statsLink` (E), one `frameStats` row |
| B | `controls.ts` (3 hunks) | `ArmView` carries both `link` (E) and `game` (B); constructor and `view()` set both |
| B, D | `packages/prefs/test/defs.test.ts` | ids list = the union (B's three, D's `drone.payload`); count = the real number of defs, 79 (`SCHEMA.defs.length` checked) |
| N | `fly/rotation/*.json` x4 | per key: `set.scenes.rotation.help` from B (Shift+F), `opt.curated` from N ("..., then SuperSplat"); en/es/pl/ru in step |
| C | `app/features.ts` | `nextHint` (N) and `sharedSettings` (C), both installed |
| C | `share/links.ts` | `scenePageUrl` = R's effective-render comparison (`sceneRender(link, catalogue)` against the entry) plus C's `isEmptyShared` and `appendShared`; the `shareApiBody` comment carries both |
| B, N | generated files (README, llms.txt, public llms.txt, settings.md, features.json) | taken ours, then `gen-catalog` at the end; B's hand-written README rows (keyboard picture text, "Shift+F next favourite") and its public llms.txt line were dropped by that and are restored in c473e0c |
| N | `STATE.md` | reset to the base: no lane's STATE lines (the lead writes STATE after deploy) |
| B N C D | 25 + 31 + 21 + 20 add/add evidence files | lane A and lane R wrote `accept-fly` output to the default `evidence/<date>/b-fly*` and `b-repo-b18.json`; theirs stay at the default paths, the others moved under `evidence/<date>/v09-<lane>/`, and their notes' references were fixed |

## 3. Renumbered decisions (`docs/decisions.md`; lane notes and code comments follow)

| Lane | Was | Now |
|---|---|---|
| F | F-1..F-4 | D44-D47 |
| A | D44, D45 | D48, D49 |
| R | DR1..DR4 | D50-D53 |
| E | D-E1..D-E3 | D54-D56 |
| B | D44..D49 | D57-D62 |
| N | D44..D47 | D63-D66 (code comments `D45` became `D64`) |
| C | C1..C5 | D67-D71 (`decision C3` became D69 in `share/links.ts` and the share test) |
| D | D44..D46 | D72-D74 |

## 4. Found by the gates and benches on the merged tree (fixed)

1. `tools/bench/test/shared-settings-app.test.ts` (lane C) expected `flightDrawing(scene).render` to merge the
   owner's entry into the link's drawing (the contract before lane R). Lane R's contract (D50, D52): `render` is
   what the scene's own LINK asked for, the owner's entry is kept apart in `catalogue` and never written into a link.
   The test now states R's contract (2a6cef2).
2. `accept-v09-next` H1 and H3 failed on the desktop layout: lane B's "Shift+F Favourite" label wraps the crash
   toast's key legend onto a second row (the toast is 94 px, not 72), and lane N's hint, stood 148 px up for a 72 px
   toast, overlapped it by about 10 px (picture in `evidence/2026-10-18/v09-lead/next-first-run-3329aae/`).
   `ui/next-hint.css` now stands the hint 190 px up (room for three legend rows in a longer language); H1-H5 pass on
   c473e0c. Only the desktop rule changed; the touch and phone rules are untouched.
3. Lane N's known baseline page error (`reading 'armed'`) counts 0 in N1-N4 after the merge, as N predicted (the
   guard in `play/easy.ts`).

## 5. Gates, once, on the merged tree

`pnpm -r typecheck` ok - `npx vitest run` 147 files / 1921 tests ok (one failure, item 4.1, fixed; the A6 hash
1d01ca5b... at default settings is `tools/bench/test/a6-reference.test.ts`, inside that run) - `python -m unittest
discover -s apps/api/tests` 302 tests ok - `node scripts/check-architecture.mjs` ok - site `i18n:check` ok (949
strings x 4) - `gen-catalog --check` up to date (72 shipped settings in 11 groups; 79 defs in the schema) - B18
(`accept-repo.ts`) line `B18 PASS {"outside":[],"placeholders":[],"topics":14}`, evidence
`evidence/2026-10-18/b-repo-b18-v09-lead.json`. After the two fixes of section 4, typecheck, vitest (147 files / 1921 tests),
architecture, i18n:check, `gen-catalog --check` and B18 (`b-repo-b18-v09-lead-final.json`, PASS) were run again on the final
tree and are green; `unittest` was not re-run (nothing under `apps/api` changed after its run).

## 6. Benches on the merged local release (one run each; base-build controls not re-run)

Release 3329aae served by `serve-csp.mjs dist 5611` (the live CSP); base 631fd5f served on 5612 only for the controls a
bench runs inline (`BASE_SITE`, `BASE_DIST`). The GPU lock was held by `mkdir` around the benches that do not take it
themselves; both servers and all browsers stopped, lock removed. Evidence under `evidence/2026-10-18/`, suffix
`-v09-lead` (the lanes' evidence untouched).

| Bench | Result | Evidence |
|---|---|---|
| accept-v09-next | first run: N1-N4, H2, H4, H5 pass, H1 H3 FAIL (4.2); on c473e0c N1-N4 H1-H5 all pass | `v09-next-v09-lead.json`; first run in `v09-lead/next-first-run-3329aae/` |
| accept-v09-c | 45/45 | `v09-c-accept-v09-lead.json` |
| accept-v09-admin-render | PASS (13 checks, 2 controls; the real API on a throwaway data dir) | `v09-admin-render-v09-lead.json` |
| wizard-auto-check (`/en`) | nobuttons, human, dji reach the check screen; no Start or Next ever shown; 0 errors | `v09-lead/wizard-auto-check.json` |
| hid-source-probe (`/en`) | 8/8 | `v09-lead/hid-source-probe.json` |
| link-line-probe, arm-card-knob-probe (lane E) | 6 timelines, 0 failed; knob lag mean 17.8, p95 33.4 ms, 60 of 60 drawn (30 Hz display) | `v09-lead/link-line-probe.json`, `v09-lead/arm-card-knob-probe.json` |
| accept-v09-load | V1-V6 PASS: V1 267 ms, V2 1198 ms and 0 page errors, V3 270 ms, V4 steady, V5 Fly now at 5.7 s, V6 export of 1994c65c 559/559 frames (542 forced) in 123 s, an MP4, six decoded frames show the scan (the merged A+R export path) | `v09-load-v09-lead.json` |
| accept-v09-render | D1-D6 PASS (24 checks, 5 controls against the base) | `v09-render-v09-lead.json` |
| accept-v09-keys | 25/25 | `v09-keys-v09-lead.json` |
| accept-v09-drones3d | V1-V8 PASS (first run); V9 PASS on c473e0c (3.8 M splats drawn on the flight canvas, 15 stage rounds, flight 25.9 Hz or more after the first open, longest task 101 ms); V10 green half 10/10 (red half = the same site by construction) | `v09-drones3d-v09-lead.json`, `v09-drones3d-partial-v9-v09-lead.json`, `v09-drones3d-partial-v10-v09-lead.json` |
| accept-v03-export E1 E3 (R asked the lead to re-run it) | PASS, control C1 fired | `v03-export-E1-E3-v09-lead.json` |
| accept-v08-play K, accept-v03-scenes S3 S4 S5 (B ported them) | 8/8, pass | `v08-a-play-k-v09-lead.json`, `v03-scenes-v09-lead.json` |
| accept-fly B6 B7 B9-B16 (first line `target: http://localhost:5611`) | all PASS, render on | `b-fly-summary-v09-lead.json`, `b-fly-b*-v09-lead.json` |

Notes: lane D's V10 control needs the release before its review fixes (06bef1f), which was not kept. The first drones3d
run used the base as `PRE_SITE`; V10's red half timed out on a page with no stage (its green half had passed), so V9
and V10 were run alone with `PRE_SITE` = the merged site: V10's `pass` is then false by construction and its `checks`
(the green half) are what counts. A first attempt at V9 and V10 together hit the bench's own watchdog (a page gave no answer for 122 s, log in `evidence/2026-10-18/v09-lead/drones3d-watchdog-run.txt`; lane D saw this three times in seven runs, cause unknown); V10 and V9 each passed when run alone, and the leftover Chrome of that run was stopped. Every bench except `next` and that V9/V10 run ran on 3329aae, which differs from
c473e0c only in one CSS declaration of the crash hint and the README text.

## 7. DEPLOY LIST (all lanes together; order API -> release)

0. Push: `.github/workflows/canary.yml` changed (lane A: CloudFront paths), so the pushing token needs the `workflow`
   scope. `git fetch` first; other sessions push to `main`.
1. `config.env` on the hub: `GEMINI_API_KEY` (lane F; key checked 2026-10-17), optional `GEMINI_MODEL` (default
   `gemini-2.5-flash`) and `GEMINI_TIMEOUT_S` (default 12). Never print the key.
2. API (copy `.prev` first, sha256 after): `apps/api/{server,admin,ideas,ideas_admin,ideas_cli,mailer,ownerbot,scenepages,service}.py`
   (changed) and the NEW `apps/api/translate.py` and `apps/api/langguess.py` (the others import them: all eleven or
   none); `packages/i18n/locales/bot/` (changed) and `mail/` (unchanged, copied by the README's command anyway) to
   `api/locales/`. `config.env` changed and compose reads it as `env_file`, so `docker compose up -d --force-recreate
   gsfpv-api`, not a plain restart; the first ~10 s are 502. No nginx or compose change, no new route: `GET /api/catalog`
   gains `defaults`, `POST /api/share` takes `shared`, scene pages stop writing the owner's render into their fly link.
   Lane C: the API must be live before the simulator build.
3. Release: push `main`, CI, `bash .cache/ship.sh <sha>`; neighbours must be equal; smoke.
4. Live checks (rule #12): `ideas_cli.py translate-check` prints ok, the model and a Polish sample; a reply test per
   `deploy/README.md` "The pilot's language" (an idea with `[TEST]`, the owner's second address, a reply in Russian: a
   translated mail; key removed and container recreated: the bot holds the Russian text, English still goes);
   `curl /api/catalog` has `defaults`; `/en/scenes/<id>/` links `/en/fly/?scene=<id>` with no `budget` or `stochastic` (R;
   the API renders it, a restart clears any cache, else Publish once in the admin); live `accept-fly B6..B16` with
   `SITE=` the live URL and the lanes' live-safe checks; `release.json` = the sha.
5. Close idea R-20261017-0002 (lane B, item 6): `ideas_cli.py summary R-20261017-0002 --lang pl` with the Polish
   paragraph of `docs/wip/v09-b.md` section 3 (its second block is a JSON string: `json.loads` gives the exact text
   with its letters; text through stdin, UTF-8) and `title` in four languages; the draft goes to the owner's Telegram,
   the e-mail only on his Send. Check the idea is in done on the admin board.
6. Owner action: set the default Scene size of macro scans in the admin (0.25..100) and Publish; a hidden scene's size
   reaches pilots only through `defaults`, after Publish.
7. After deploy, the lead's own: `STATE.md` (no lane wrote any), the site's roadmap seed (done items), the vault status
   note, Daily, the owner's report; the site's privacy text should say that replies are translated by Google's API (D47).

## 8. Not verified, by lane (nothing below was run by anyone)

- A: a real Chrome reclaim of an idle encoder (revival tested with a fake encoder only); V5 after the review.
- B: a real hand on a real mouse; Esc as the browser's own gesture; the live board and the vault skills for the idea.
- C: the live site behind the real nginx; the owner's real data; es/pl/ru macro-hint wording by a native speaker.
- D: the stage on a phone-sized screen and with no GPU; next to a scan on another GPU or Chrome (V9 is one machine);
  the lazy chunk behind the real CDN; three of seven full runs hung once each before a watchdog (cause unknown).
- E: the owner's real GX12 over his Bluetooth adapter (no hardware); what `Gamepad.timestamp` is for it; the Windows
  connection interval; the module's notification queue; the whole Controls screen under a gate (only the by-hand probe).
- F: the real Gemini endpoint (the lead's `translate-check`), the real Telegram and Gmail, the admin dialog's Edit
  button for a held thank-you in a browser.
- N: a real touch screen and phone; the live site; a really slow SuperSplat (the proxy's own 10 s limit).
- R: the live site; a 60 Hz display; another GPU or browser; a fully streamed 259 M scan at 4K; a slow link; a GPU
  with little VRAM; 8 M against 4 M by eye; export on a phone or WebGL; a long export of a still-streaming scan (V6
  above covers one).
- Lead: one PC, one Chrome, a 30 Hz display; no live site, no hub; the drones3d V10 control against 06bef1f was not
  re-run (the build was not kept); the crash toast in es/pl/ru was not measured (the hint's 190 px is sized for three
  legend rows).

## 9. Owner questions (all lanes)

1. R: default stochastic budget on a desktop, 4 M (shipped) or 8 M (65 % more bytes, about 1.7x VRAM)?
2. R: a link beats a pilot's stored Render = Sorted on every reload (and may ask 32 M of a pilot who set 2 M): keep?
3. R: REC and auto-record draw as the pilot sees them (grain, 20-30 % larger files): draw sorted while REC runs?
4. N: should N remember where a returning visitor stopped (`remember` in `app/tour.ts`)?
5. N: is "in order" the right default for N (the verbatim says "random or just next")? Order In order on Scenes I have
   flown ping-pongs between the last two (also on the base).
6. C: should a draft-only scene's default size count (today only after Publish)? A share carries only differences from
   the scene's defaults (D69): a receiver's own saved size or global walls-off still wins over a link that flew the defaults.
7. F: the admin's reply path shows no `tr`/`orig` yet; there is no way to correct a wrong cached `pilotLang`.
8. E: for the owner to look at once: the Controls screen line and the F3 note on his GX12, and a USB cable. An idea for a
   later round: draw the scan at a low rate while Controls is up (not measured).
9. B: a real mouse on his Chrome (the bench proves the handler, not the feel).
