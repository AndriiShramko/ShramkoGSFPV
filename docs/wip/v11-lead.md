# v0.11 lead: merge of lane S (the accumulating stochastic drawing) into the lead branch

Lead branch `v03-lead` (= `main` at `3c3d1e4` before this merge: it already holds the GA4 analytics work, release `2c40c30`, and the headless bench change `443295c`).
Lane `v11-s` (worktree `C:/dev/gsfpv-v11-s`, base `db73942`, 5a0d47b at the merge; note [`v11-s.md`](v11-s.md), plan [`v11-plan.md`](v11-plan.md)).
Nothing here is pushed, deployed or run against the live site. Evidence: `evidence/2026-10-22/v11-lead/` (gates in `logs/`, one folder per run in `runs/`).

## Status

RESUME-FIRST: `git -C C:/dev/gsfpv-v03 log --oneline -8`, `git status`, then the first unchecked box. Never redo a merge or a passed check for unchanged inputs.

- [x] merge `v11-s` into `v03-lead` (conflicts resolved, headless mechanism reconciled, STATE.md entry): merge commit `252587d`
- [x] gates once on the merged tree (HEAD `252587d`): all pass (table below)
- [x] one merged local release (`dist`, built from `252587d`, sha256 `d6ee6374c6d2...`), then accept-v11-stochastic, accept-v10-render, accept-v10-keys, accept-fly B6 B7 B9-B16: all pass after the three bench updates named below (`e9f2e2b`)
- [x] this note finished and committed (the commit that carries this line)

## Short answer

The lane merges cleanly: the only git conflicts were evidence files with the same names. The merged tree passes every gate, the landing smoke and every bench. Four things in the benches
were not the merge's fault and are named with their causes below (a wrong environment variable of mine, a host main added, a v0.10 bench that reads the engine's flag as "stochastic", and a consent card that main added after the keys bench was written).
One finding is not the merge's either and is for the owner: on a first visit in a short window the analytics card stands over the How to fly card's Start button ("Finding outside the merge").
Deploy is a static release only: no API, no nginx, no compose or config change.

## The merge

`git merge --no-ff v11-s` (parents `3c3d1e4`, `5a0d47b`) gave 21 conflicts, all `add/add` in `evidence/2026-10-21/`: the lane's Stage 4 run of accept-fly B6-B16 and B18 (on `072134a`) has the same file names as main's GA4 release run
(`b-fly-b*.json`, `b-fly-summary.json`, `b-fly/*.jpg`, `b-repo-b18.json`). Resolution: main's files keep their paths (they are the GA4 release's evidence), the lane's copies are kept, byte for byte, under `evidence/2026-10-21/v11-s-stage4/`.
Nothing else conflicted. Checked by hand anyway, because "no conflict" is not "right":

| the lead's rule | result |
|---|---|
| lists keep both | no list conflicted |
| `packages/i18n/locales/**` union by key | `site/{en,es,pl,ru}.json` were edited on both sides (GA4 privacy texts, the lane's licences item) and merged by git; each file parses, 27 keys in each language, `i18n:check` OK (951 strings x 4); the merge changes one line per language against main (the licences item) |
| generated files (README tables, `llms.txt`, `docs/settings.md`, `features.json`) | only the lane changed them; `gen-catalog.ts --check` says up to date (74 settings, 9 drones), so no regeneration was needed |
| `packages/prefs/test/defs.test.ts` count | unchanged by both sides; the test passes |
| `docs/decisions.md` numbering | main's last decision is D83; the lane's D84-D88 stay as numbered, nothing to renumber (`git grep` of D84-D88 on main finds only media binaries) |
| `STATE.md` | one entry added under "Where v0.3 stands", marked NOT YET LIVE |
| B18 | passes on the merged tree (`b-repo-b18-merged-gate.json`: outside none, placeholders none, 14 topics); main had already turned the inherited `run.txt` into escapes |

`apps/fly/src/app/flight.ts` (edited on both sides) merged to exactly main plus the lane's `parseImpl` import and the `?impl=` / `?accum=` options.

## One headless mechanism

Main (`443295c`): `tools/bench/src/chrome.mjs` puts `headless` into `pickBrowser().launch`, so every launcher built on it is headless; `BENCH_VISIBLE=1` shows a window. The lane (`f7c5d71`) had added `BENCH_BACKGROUND=headless|offscreen`
and a pointer-lock stub in `src/browser.ts`. Reconciled into main's:

- `browser.ts`: `BACKGROUND`, the `offscreen` mode, the window-size arguments and `POINTER_LOCK_STUB` are gone; `launchChrome` is `chromium.launch({ ...o, ...pick.launch })`, `pick.launch` last, so a caller's own `headless: false` cannot open a window.
- The stub is not needed: accept-v10-keys K6 on the merged release, headless, no stub: `locked: true`, and K7 takes off (`runs/accept-v10-keys-2/run.txt`).
- Two launchers still opened a window on their own: accept-fly's Firefox in B8 and `tools/probe/run.mjs` (visible unless `PROBE_HEADLESS=1`); both use `benchHeadless()` now; `probe-enter-keeps-wreck.ts` too (it had its own copy of the rule).
- `v11-s-cost.ts` records `headless` and its measured window instead of the lane's `background` field.
- `tools/bench/README.md` says it in one paragraph: headless by default, one switch `BENCH_VISIBLE=1`. `tools/probe/README.md` follows.
- `tools/bench/test/chrome.test.ts` gains a test that scans every launcher in `tools/` and `apps/site/scripts/` and fails on a literal `headless: false` or a bare `launch()`, with a control that proves the rule catches both, and a test that `BENCH_BACKGROUND` and the stub are gone (13 tests in the file, all pass).

## Gates, once, on the merged tree (`252587d`)

| gate | result |
|---|---|
| `pnpm -r typecheck` | green |
| `npx vitest run` | 154 files, 2098 tests, all pass: 2078 in the full run, and the 20 tests of `tools/bench/test/shared-settings-app.test.ts`, whose 10 s hook timed out while 154 workers loaded the machine; alone it passes 20 of 20 |
| `python -m unittest discover -s apps/api/tests` | 320 OK |
| `node scripts/check-architecture.mjs` | ok |
| `pnpm --filter @gsfpv/site i18n:check` | OK, 951 strings x 4 |
| `gen-catalog.ts --check` | up to date |
| B18 `accept-repo` | PASS |
| release | `node scripts/build-release.mjs` (the GA id is in the sources; its guard passes): 401 files, 109 gzipped, 49 CSP pages, sha256 `d6ee6374c6d22c690188061b589b335c074181a200b218cb21ecd350dc6d1c95`, 58.7 MB |
| landing smoke (`apps/site/scripts/verify.mjs`, what CI runs) | **158/158** against `apps/site/scripts/serve.mjs` (a copy of `out/`). Against `serve-csp.mjs` first: 157/158, the miss being "out/index.html redirects by Accept-Language then cookie" (`serve-csp` answers `/` with a fixed 302 to `/en/`, the v10 lead saw the same); not a build fault. Not run behind the nginx container CI uses (Docker is installed; I did not start that container) |

After the bench updates below, the bench tests (`npx vitest run tools/bench`: 759 pass), `tsc` of the bench and `check-architecture` were run again.

## Benches on the merged release

`dist` (from `252587d`) served by `serve-csp.mjs` on `:5731` for the two benches that take `SITE`; accept-v11-stochastic and accept-v10-render start their own servers. Headless (chrome.mjs, Chrome 155, the owner's RTX 4090, which showed 90 % load from another process when I looked before the runs: no timing is claimed). The two that take the GPU lock themselves did; for accept-v10-keys and accept-fly I held `C:/dev/.gpu-lock` with one bounded wait (nine minutes at most per command); the lock was never left behind, and every server and browser I started is stopped.
`EVIDENCE_SUFFIX=-v11-lead...` kept the lane's tracked evidence files untouched; accept-fly's screenshots of this run are in its run folder (same names as the lane's, which stay as the lane committed them).

| bench | result | evidence (`evidence/2026-10-22/v11-lead/runs/...`) |
|---|---|---|
| accept-v11-stochastic V1-V9 | first full run: 67 checks, 66 ok, V2 V3 V4 V5 V7 V8 V9 pass; the one miss was V1's BASE control, **my fault**: my script exported `BASE_DIST=dist` for every step, so the "BASE" was the merged build. Re-run V1 and V6 with the real BASE (`.cache/dist-base`, the lane's db73942 build): V1 passes, V6 failed on one host, see below; re-run again with that host named: **V1, V6 pass (16 checks, 5 controls)**. Together all nine items pass | `accept-v11-stochastic/`, `accept-v11-stochastic-v1v6/`, `accept-v11-stochastic-v6/` (void: V6 alone reads no page, its "0 state reads" check cannot pass), `accept-v11-stochastic-v1v6-2/` |
| accept-v10-render R1-R7 | first run: 8 non-control checks failed. **Bench stale, not the merge**: its helper `stochastic()` reads the engine's flag and the shader define, which are false while the vendored renderer draws (it switches the engine's renderer off), and its F3 regex lacks ", accumulating"; R6's grain measurement cannot tell a converged picture from a sorted one. Updated (the hook's `drawn` is read; F3 accepts the suffix; R6 opens with `?impl=engine`, the v0.10 measurement it always was; `sorted()` also demands `drawn` sorted, so the checks are stricter than before). Whole bench again: **52 checks, 40 ok, no non-control failure; the 14 controls: 2 ok, 12 fail by construction** because the BASE and PRE builds are the merged `dist` (same as the v10 lead: 38 non-control + 2 controls pass, 12 controls named BASE/PRE fail) | `accept-v10-render/` (first), `accept-v10-render-2/` (after the update) |
| accept-v10-keys | first run: 44 pass, then a timeout at K20c: "consent-decline ... intercepts pointer events" on Start flying. **Main's analytics card** (GA4, `00d0ebf`), not the merge; see the finding. Bench contexts now answer the card (`gsfpv_consent = no` in an init script). Re-run: **55/55**, K6 `locked: true` headless without a stub | `accept-v10-keys/` (the crash; its screenshot of the collision is in `evidence/`), `accept-v10-keys-2/` |
| accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (first line `accept-fly target: http://localhost:5731`, render on) | all pass, first run | `accept-fly/` |

The V6 host: `www.googletagmanager.com`, the GA4 loader of `apps/fly/src/app/analytics.ts` (loaded only after consent), which main added after the BASE build. The lane adds no host (`git diff db73942 v11-s` of the non-vendored sources adds no URL; the vendored files add only a github.com link in comments).
`accept-v11-stochastic.ts` now has `V6_ALLOW_HOSTS` (empty by default; I ran with `www.googletagmanager.com`), printed in the check's name; its control (a made-up host is still seen) passes.

## Finding outside the merge (for the owner)

On a first visit in a 900 x 480 window the analytics card (Decline / Accept) stands on top of the How to fly card and covers its **Start flying** button, the "Do not show again" box and the note's end; a mouse user has to answer the analytics card first.
Seen in the main session's own earlier run too (`runs/accept-v10-keys/evidence/k20-short-window-consent-card-over-start-flying.jpg`; the 1280 x 800 window is fine, the phone landscape window 812 x 375 was not looked at with both cards up).
Not touched here: it is main's behaviour. Options: show the analytics card only after the How to fly card closes (or stack it under), or move it clear of the dialog on short screens.

## DEPLOY LIST

Static release only, as the lane said; checked against `git diff 3c3d1e4 HEAD`: nothing under `apps/api`, `deploy/`, `scripts/`, `.github/`, no `config.env` or compose change, no lockfile change.

1. From the final HEAD of `v03-lead` (or `main` after the lead moves it): `node scripts/build-release.mjs` (the GA guard needs the id in the sources, it is there), then the usual `deploy/deploy.sh` upload of `dist.tgz` + `SHA256SUMS`. The release adds about 255 KB of source (the vendored renderer; less once minified) to the simulator bundle.
2. No API upload, no nginx reload, no container recreate, no admin data change (the Drawing tab's intro text changed in four languages, static).
3. Live checks after the switch (the lead's usual set): `accept-fly` B6-B16 on the live URL (never `BASE`), and the stochastic page itself: `https://gsfpv.flyreelstudio.eu/en/fly/?scene=39e63ce9&stochastic` should report `drawn: 'accum'` in the hook and F3 "Render: stochastic, accumulating (the link)"; with nothing asked, `drawn: 'sorted'` (D75, D88: sorted stays the default on every class).
4. STATE.md: rewrite the NOT YET LIVE entry with the release sha. README and `llms.txt` are regenerated and up to date; no screenshot changed.
5. Owner message 25: after the release is live and checked, the Facebook-group agents announce it (skill `fb-campaign-gsfpv`, item 6): only measured numbers from `v11-s.md`. What may be said: it is SuperSplat's own stochastic renderer with a temporal history (MIT, v1.38.0), adapted to our engine; at rest it converges to 31-41 dB from the sorted picture, in flight it is 23-33 dB and visibly noisier in rooms; it is a choice ("Render: Stochastic"), not the default; it is NOT shown to be faster and needs 120-210 MB more video memory at 4K.

## Not verified

The lane's list stands (details in `v11-s.md`, "Not verified"): a weak GPU, an iGPU laptop, Firefox, Safari, a phone (stochastic is refused there by class); GPU time of the new drawing against sorted in either direction (the GPU's clock decides); a real flight replay (every path is synthetic); a hovering flight model (only paused and a 0.5 px synthetic hover were measured); engine bumps (a moved internal falls back to the engine's dither, a changed behaviour of a member that still exists is seen only by re-running the Stage 3 benches); upstream is days old and experimental.
Added by the lead:

- accept-v10-render's BASE and PRE controls are the merged build, so 12 of its 14 controls fail by construction; the lanes' own control runs (v10 evidence) are not repeated.
- accept-v11-stochastic was not run end to end in one piece: V2-V5 and V7-V9 come from the first run (they use no BASE build), V1 and V6 from the second; the build, the tree and the scene are the same.
- The landing smoke ran against the site's own static server, not behind the nginx container; accept-v10-keys with `V10_CONTROL=1` and accept-v09/v07 benches were not run.
- Nothing ran against the live site; the owner's own screen and a real hand and mouse were not used (headless; the owner's rule of 2026-10-22).
- The first-visit overlap of the two cards at 812 x 375.

## Owner questions (the lane's, unchanged) and one more

1. Sorted stays the default everywhere (D75, D88); the accumulating stochastic is a choice. Is that enough, or should it be the picture of a paused or hovering drone and sorted while flying? That needs a rule that does not exist yet.
2. A weak desktop (Intel iGPU with WebGPU, a laptop): on this PC the GPU times of the two drawings cannot be told apart, so nothing says stochastic is cheaper there. Put `desktop-weak` on stochastic in the Drawing tab when a real device says so.
3. Non-linear tone maps differ from sorted by up to 6 levels on dense scans (the pixel is tone-mapped once). Accept, or edit the vendored compose shader for scenes that set a non-linear tone map?
4. At 4K the renderer holds 369-473 MB of its own (+120 to +210 MB over sorted at 4 M splats); at 720p it saves 37-194 MB. Fine on a desktop; the classes that cannot draw stochastic never make it.
5. (lead) The analytics card over the How to fly card in a short window: which fix do you want (finding above)?

## Housekeeping

- The lead worktree still has three untracked paths that are not mine: `evidence/2026-10-01/rec/` (80 MB of mp4), `evidence/2026-10-22/v10-k/` (screenshots of the main session's headless keys run) and `evidence/2026-10-22/b-repo-b18-main-7b82f73.json` (its B18 PASS; renamed from `b-repo-b18.json` before the merge, because the lane tracks a file of that name). Left as they were; my two keys runs overwrote the ten screenshots of `v10-k/` and I put the originals back from a copy.
- Logs of this session, the second copy of the BASE build (`.cache/dist-base`) and the run scripts are under `.cache/v11-lead/` and `.cache/` (ignored).
- Every non-ASCII character of the run logs is a `\uXXXX` escape (B18 reads tracked `.txt` and `.json` files for Polish and Cyrillic letters).
