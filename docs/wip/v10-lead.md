# v0.10 lead - merge, gates, benches (the lead's hands)

Base `198b659` (branch `v03-lead`; `origin/main` 5e4b11e is its ancestor, nothing newer on origin on 2026-10-20).
Plan `docs/wip/v10-plan.md`; lane notes `docs/wip/v10-r.md`, `docs/wip/v10-k.md`. Nothing was pushed or deployed; no SSH.
Evidence of this note: `evidence/2026-10-20/v10-lead/` (`logs/` = gate output, `runs/<bench>/` = each bench's own files,
JSON suffix `-v10-lead`; the lanes' evidence is untouched).

## Status

RESUME-FIRST: `git log --oneline -20` shows which `Merge v10-*` commits exist; everything below is done except the last box.

- [x] 0. fetch: origin/main has nothing that HEAD lacks (checked 2026-10-20)
- [x] 1. merge `v10-r` (head 68c7d43, 13 commits): merge commit 1d43eaa, clean
- [x] 2. merge `v10-k` (head 4ebe4b9, 17 commits): merge commit 805a5b5, 2 conflicts (section 2)
- [x] 3. decisions renumbered (K: D81-D83), STATE.md one NOT YET LIVE entry, defs count 81, gen-catalog regenerated (in 805a5b5)
- [x] 4. gates once on the merged tree: all green (section 4)
- [x] 5. landing smoke as CI runs it (nginx:1.29-alpine container with `deploy/nginx.conf` and the merged `dist`): 156/156
- [x] 6. merged local release built (from e8f0387; later commits are docs and evidence only) and every bench run once (section 5)
- [x] 7. deploy list, not-verified list, owner questions (sections 6-8)
- [ ] 8. deploy, live checks, STATE.md rewrite, vault: the lead, after this

## 1. Merged (`git merge --no-ff`, order R then K)

| # | Lane | Branch head | Merge commit | Owner's items |
|---|---|---|---|---|
| 1 | R render quality, device presets, REC clean | 68c7d43 | 1d43eaa | 2, 3, 4 |
| 2 | K How to fly card | 4ebe4b9 | 805a5b5 | 1 |

Lead commits after the merges: e8f0387 (checkpoint), 1c0f20c (gate evidence), then the bench evidence and this note.
No lane changed `pnpm-lock.yaml` (lane R added one `exports` entry, `./policy`, to `packages/render-pc/package.json`; no dependency
changed, so `pnpm install --frozen-lockfile` was not needed). No lane changed `.github/`.

## 2. Conflicts and how they were resolved

The two lanes touch only 7 files in common (README.md, llms.txt, apps/site/public/llms.txt, features.json, docs/settings.md,
docs/decisions.md, packages/prefs/test/defs.test.ts). The overlaps the brief named (`ui/hud.ts`, `app/builtin/settings.ts`, `play.css`,
`boot.ts`, `flight.ts`, `scene-host.ts`, the four bench files) are each touched by one lane only, so git merged them with no conflict; the
merged behaviour was then checked by the benches (section 5), not by reading.

| Merge | Where | Resolution |
|---|---|---|
| R | none | clean. One untracked file in the lead tree, `evidence/2026-10-20/b-repo-b18.json` (a B18 run on the plan commit), was in the way of lane R's tracked file of the same name; moved to `evidence/2026-10-20/v10-lead/b-repo-b18-plan-commit-198b659.json` |
| K | `docs/decisions.md` | lane K appended D75-D77 to the end of lane D's table (under lane D's heading); R's section D75-D80 kept, K's three rows moved under their own heading and renumbered D81-D83; R's heading "the lead renumbers" became "numbered at the v0.10 merge" |
| K | `packages/prefs/test/defs.test.ts` | both lanes wrote 80 (each added one def to 79); the real number is 81 (`display.deviceClass` + `input.howToFly`), the id lists of both already merged; the count and the test title say 81 |
| K | `STATE.md` | only lane K had written a line (a "not merged" bullet in the header block); moved into one v0.10 entry under "Where v0.3 stands", marked NOT YET LIVE, with a lane R summary written from its note (the lead rewrites it after deploy) |
| K | generated files (README.md, llms.txt, public llms.txt, docs/settings.md, features.json) | git merged them; `gen-catalog` regenerated at the end: 74 shipped settings (72 + `display.deviceClass` + `input.howToFly`); only the count line changed, both lanes' hand-written README rows survive (the Display row with "Device class", the Controls row with "Show How to fly", the Keyboard paragraph with `K` how to fly) |
| K | `docs/wip/v10-k.md` | its two references "D75-D77" now say D81-D83 after the merge |

Locales: the two lanes added different dictionaries (`fly/drawing` and `admin/drawing` from R; `fly/play` edits from K), so no key collided.
All 42 dictionary directories have the same keys and the same `{placeholders}` in en / es / pl / ru (checked by a script, 0 problems).

## 3. Renumbered decisions (`docs/decisions.md`)

| Lane | Was | Now |
|---|---|---|
| R | D75-D80 | D75-D80 (main ended at D74, nothing to renumber; the references in `v10-r.md` stay) |
| K | D75, D76, D77 | D81, D82, D83 (no code comment referred to them; the two references in `v10-k.md` fixed) |

No duplicate number in the file (checked), no "lead renumbers" text left outside `docs/wip/`.

## 4. Gates, once, on the merged tree (HEAD e8f0387; logs in `evidence/2026-10-20/v10-lead/logs/`)

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | ok (`typecheck.txt`) |
| `npx vitest run` | 151 files, 1996 tests passed, no file needed a rerun (`vitest.txt`); the A6 hash test `tools/bench/test/a6-reference.test.ts` is inside that run and was run alone too: passes, its perturbed-thrust control fails as it must |
| `python -m unittest discover -s apps/api/tests` | 314 tests OK (`unittest.txt`; lane R's `test_drawing_defaults` rows included) |
| `node scripts/check-architecture.mjs` | ok |
| `node scripts/check-licenses.mjs` (CI runs it) | 65 packages ok |
| `pnpm --filter @gsfpv/site i18n:check` | OK, 949 strings x 4 locales |
| `node --import tsx scripts/gen-catalog.ts --check` | up to date (74 settings in 11 groups; its planted-stale controls caught) |
| B18 (`tools/bench`, `SITE=x npx tsx src/accept-repo.ts`) | `B18 PASS {"outside":[],"placeholders":[],"topics":14}`; evidence `b-repo-b18-merged-gate.json` |
| release build (`node scripts/build-release.mjs`, `NEXT_PUBLIC_GA_ID=G-E7X0ES0QBE` as CI) | ok, sha e8f0387, 401 files, 49 CSP pages, 134 hashes (`build-release.txt`) |
| `docker run nginx:1.29-alpine` with the merged `dist` and `deploy/nginx.conf` (CI's step) | `nginx -t` ok; `scripts/smoke-release.mjs`: 193 checks passed (the 7 scene-page link checks need the API and were not made) |
| landing smoke `pnpm --filter @gsfpv/site verify` with `BASE=` that nginx (CI's step) | **156/156** (`site-verify-nginx.txt`) |

A first smoke run against `serve-csp` instead of nginx gave 155/156 (`site-verify.txt`): the one miss, "out/index.html redirects by
Accept-Language then cookie", is `serve-csp` answering `/` with a fixed 302 to `/en/`; real nginx maps it by cookie and language, and the
same check passes there. Not a build fault.

## 5. Benches on the merged local release (one run each; base-build controls not re-run)

Release of e8f0387 (`dist`) served by `tools/bench/scripts/serve-csp.mjs dist 5701` (the live CSP; `/api` answers 204). The benches that
take the GPU lock themselves did (`accept-v10-keys`, `accept-v10-render`, `accept-v09-keys`, `accept-v09-render`, `accept-v07-render`);
for the others I held `C:/dev/.gpu-lock` with one bounded wait (`wizard-auto-check`, `hid-source-probe`, `accept-fly`, `accept-v08-play`).
Server, container and browsers stopped, lock absent afterwards.

| Bench | Result | Evidence (`runs/...`) |
|---|---|---|
| accept-v10-keys (lane K) | **55/55**, 0 failed | `accept-v10-keys/` |
| accept-v10-render (lane R) | 52 checks: all **38 non-control checks pass** (R1-R7). The 14 controls name the BASE build (R1, R2, R3, R5) and the pre-review build (R7); both were pointed at the merged `dist` as the bench allows, so 12 of the 14 fail by construction and 2 (R3 draft control, R6 measurement control) pass. The lanes' own control runs are not repeated: `evidence/2026-10-20/v10-render.json`, `v10-render-review.json` | `accept-v10-render/` |
| accept-v09-keys (K ported V1, V2b) | **first run 19/25** (V2 V5 V6 V6b V9 V10b: the click after Esc did not capture the mouse); **rerun, same build, 25/25** (section 7) | `accept-v09-keys-run1/`, `accept-v09-keys/` |
| accept-v09-render (R gave it `V09_DEFAULTS`) | D1-D6 pass, 20 checks; the 4 controls that need an older build skipped (`BASE_SITE` = `SITE`, as the bench allows) | `accept-v09-render/` |
| accept-v07-render (R) | R1-R7, R9 pass with the v0.10 default expectations; **R8 failed in the full run** (the governor did not step under a simulated overload within 12 s); **R8 alone, same build: pass** (step 2, 5 M of 8) (section 7) | `accept-v07-render/`, `accept-v07-render-r8-rerun/` |
| wizard-auto-check, base `http://localhost:5701/en` | nobuttons, human, dji all reach the check screen (23 screens each), no Start or Next ever shown, 0 errors | `wizard-auto-check/` |
| hid-source-probe, base WITH `/en` | 8/8 (dji, dji-windows, edgetx, dji-other, dji-none, dji-pad-chooser, dji-pad-cancel, dji-pad-nopick) | `hid-source-probe/` |
| accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (first line `accept-fly target: http://localhost:5701`) | all pass | `accept-fly/` |
| accept-v08-play, K part (K ported it; not on the brief's list, run because the merge touches what it tests) | 7/7 | `accept-v08-play-k/` |

Not run: `accept-v10-keys` with `V10_CONTROL=1` and the lanes' base/pre-review controls (recorded by the lanes), the `accept-v08-play` touch
part, `tools/bench/src/screens.ts` (keys flow, K ported it; it writes `docs/screenshots`), `accept-v09-next` and the other v0.9 benches
(untouched by these lanes).

## 6. DEPLOY LIST (order: API, then the release; nothing else on the hub)

0. Push: `git fetch` first (other sessions push to `main`). `.github/` is unchanged by both lanes, so no extra token scope. Nothing was
   pushed by this lead.
1. **API (first):** only `apps/api/admin.py` changed (lane R: `clean_drawing`, the `drawing` key of the catalogue document, its draft /
   Publish / history, `GET /api/catalog` carries `drawing` when set). Procedure of `deploy/README.md` "Changing the API": keep
   `admin.py.prev`, upload, `sha256sum` both sides equal, restart only the API (`docker restart gsfpv-api`; no `config.env` change, no
   new route, no nginx or compose change), then `curl https://gsfpv.flyreelstudio.eu/api/health` (200) and `/api/catalog` still answers
   with no `drawing` key (nothing published yet). If it does not come up, put `admin.py.prev` back. The new simulator wants this API
   first (an old API drops the key; the simulator then uses its built-in table, nothing breaks).
2. **Release:** push `main`, CI (the same steps ran locally above), `bash .cache/ship.sh <sha>`; neighbours must be equal; smoke;
   `release.json` = the sha. Lane K is the static release only; lane R's admin tab and the Drawing locale ship in the same release (the
   admin page is part of `dist`).
3. **Live checks (rule #12), after the release:**
   - `curl /api/catalog`: no `drawing` key and `defaults` as before. In the admin (the owner's login; no agent has it) the Drawing tab lists
     four classes and every scene; do not Publish a change as a test.
   - live-safe benches with `SITE=` the live URL (they read `SITE`, never `BASE`; check the first printed line): `accept-v10-keys` (a fresh
     visitor meets the card), `accept-v09-keys`, `accept-v07-render` and `accept-v09-render` (`BASE_SITE` = `SITE`) with the v0.10 defaults,
     `accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16`, `wizard-auto-check` and `hid-source-probe` with the base WITH `/en`.
     `accept-v10-render` is NOT live-safe (it starts its own API and admin on a throwaway data dir); its live equivalent is the
     default-drawing rows of `accept-v07-render` R1 and `accept-v09-render` D1 (sorted at 4 M, class from the browser).
   - the live page draws SORTED on a strong desktop with a plain link; F3's line ends with the class; the admin's Publish of a preset reaches
     a fresh page (the owner's action, owner question 1).
4. After deploy, the lead's own: `STATE.md` (rewrite the NOT YET LIVE v0.10 entry with the release id and the live evidence), re-take
   `docs/screenshots/keys.webp` and the README screenshot of the keys (`tools/bench/src/screens.ts`, the `keys` flow now waits for the How
   to fly card; the file still shows the v0.9 key card), the site's roadmap seed (done items), the vault status note, Daily, the owner's report.
5. No `config.env` change. Nothing for nginx. No new environment variable.

## 7. Found on the merged tree

1. **No merge bug.** Every gate passed at the first run; every bench that exercises the merged areas (the HUD, the settings, play, the drawing,
   the key card, REC) passed. The intermittent items below are the only red results.
2. **Two intermittent bench failures, both passed on an unchanged rerun of the same build, cause not proven.**
   - `accept-v09-keys` first run 19/25: V2 (a click on the view must capture the mouse; before false, after false), and V5 V6 V6b V9 V10b,
     which all need that capture. V12 later in the same run (a click after Esc captures again) passed. Rerun: 25/25. Lane K recorded 25/25
     too. The failing step is the click made 400 ms after Esc closed the How to fly card (K's port waits 5.5 s for the K activation to
     expire). Both runs were on the same `dist`, so the code did not differ.
   - `accept-v07-render` R8 (a simulated overload must step the governor down) in the full run: step 0 for 12 s. R8 alone on the same build:
     step 2, budget 5 M. Lane R's runs did not include R8 (R1-R4, R9). R8 passed on 2026-10-17 and 10-18 (`v07-render.json`).
   Both are timing in a visible Chrome window (a frame loop that did not run, a pointer-lock request that was not granted); the first run of
   each came straight after another bench had closed its browsers. My reading: a focus or occlusion effect of the test machine, not a
   regression; but it was not proven, and the click-after-Esc path of K (pointer lock requested at a resume) is the place to look if V2 ever
   fails on the live site.
3. The brief expected hand merging of `ui/hud.ts` and others: there was nothing to merge there (one lane each); see section 2.

## 8. Not verified, by lane (nothing below was run by anyone), and the owner's questions

### Lane R (items 2, 3, 4)

- A weak desktop GPU, a tablet, a real phone: the classes and presets (desktop-weak 2.5 M at 85 %, tablet 2 M at 85 %, phone 2 M at 70 %) are
  tested in Node and emulated in a browser (user agent, touch, screen size on this PC's GPU), never on the real device. The Intel / AMD adapter
  names the rule keys on come from the WebGPU spec's examples and Chrome's reports.
- A desktop in "Request desktop site" mode on a real phone: emulated (Linux user agent, 5 touch points, a 412 px `screen`).
- A tablet in desktop mode is not recognised (the pilot names the class).
- A desktop without WebGPU starts as `desktop-weak` (2.5 M at 85 %, where v0.9 drew 4 M at 100 %): never measured on a WebGL machine.
- Stochastic as a good mode (an unbiased dither plus temporal accumulation): the cause of the bias is proven by a chunk swap, nothing of it
  ships; the engine's own `CameraFrame.taa` was NOT evaluated (not even once); the cost of a good stochastic mode here is open.
- SuperSplat's viewer in motion (only the settled picture was scored).
- The live site and the real admin (the admin ran on a local API with a throwaway data dir; this lead had no login either).

### Lane K (item 1)

- A real mouse in a real hand on the owner's Chrome (the click on Start flying is Playwright's trusted click; pointer lock is granted to it);
  Esc as the browser's own release; the first-flight pill in front of a real hand.
- A real phone (Chrome touch emulation without WebHID, 390 x 844 and 812 x 375, Russian 390 x 844) and a real radio or gamepad (the radio card is
  drawn by pointing the page at a gamepad source and pressing K; its model and texts are unit-tested, an arm button was never seen on a real profile).
- The first-flight pill appears only once the drone is armed; the ground line covers the ground (left as it is, by K's choice).
- `docs/screenshots/keys.webp` and the README screenshot still show the v0.9 key card (deploy list item 4).

### Lead

- The base-build and pre-review controls of `accept-v10-render` (and `accept-v10-keys` with `V10_CONTROL=1`) were not re-run: the lanes recorded
  them on the unchanged benches; here the BASE and PRE builds were the merged `dist`.
- The two intermittent failures of section 7 (cause not proven).
- Everything on the live site: nothing was deployed; the benches ran on a local release behind the live CSP, with `/api` mocked as 204 (apart
  from `accept-v10-render`'s own API).
- The `accept-v08-play` touch part, `screens.ts` and the other v0.9 benches were not re-run on the merge.

### Owner questions (from the lanes, unchanged)

1. (R) Strong desktops: 4 M (shipped; the same bytes as v0.9) or 8 M (+64 to 71 % bytes, +5.5 to 6 dB on big scans, nothing on scans under 4 M
   splats)? One number in the admin's Drawing tab, live after Publish, no deploy.
2. (R) The weak desktop, tablet and phone presets are first guesses from the governor's ladder and SuperSplat's mobile budget, not measured on
   those devices: tune them in the admin when a real device says otherwise.
3. (R) A stochastic drawing that is actually good needs an unbiased dither AND temporal accumulation; what it costs here is not known (the
   engine's `CameraFrame.taa` was not tried). Worth one experiment only if huge scans on weak GPUs turn out to need stochastic. Say if you
   want it tried.
4. (K) Does one card at every visit annoy you? The box "Do not show again" and the setting `input.howToFly` exist; the default (shown once per
   visit, on) is your call.
