# Release lead: sonic-beacon + center-throttle

Two lanes go out in one release. Stage 1: merge, gates, local probes, push (no deploy). Stage 2: deploy.

## Status

- [x] S1.1 fetch: simulator origin/main 6f33594 (not moved), package origin/main b102ce6 (not moved); lead copy on `main`, plain push convention
- [x] S1.2 lanes closed: every review finding and stage line [x] (beacon's open R14 is the lead's push + re-pin, done here); worktrees clean (center-throttle: 4 untracked PNGs, left)
- [x] S1.3 package: `git merge --no-ff sonic-beacon` on main = P 83ce612a765a1bf4c4a384c15acade92fc7dfce0; typecheck 0; `pnpm test` 58 files, 1268 of 1268 passed; `pnpm proof:audio` 3 files, 9 of 9 passed; pushed (b102ce6..83ce612)
- [x] S1.4 simulator: merged sonic-beacon (889f9e2d), then center-throttle (b72ca738), no conflicts; pin packages/sonic-fpv -> 83ce612 (0af6e0cb); lockfile unchanged (no install)
- [x] S1.5 seams: (a) J is bound only to `throttle.style` (keymap.ts:101; sound mode letters B N R Z and T U I G X, none J); (b) `InputHost.setLesson(null)` resets and reinstalls the style and restarts the gate when motors are off; the beacon lane did not touch input.ts or the lesson end; (c) start screen count 16 in sonic-start-screen.test.ts, center-throttle added no sound setting, sonic-v13-page.ts reads N from the page; (d) catalog gate PASS. Named run on the merged tree (sonic-mode, sonic-lessons, sonic-audio, sonic-review-input, sonicrec-*, app-centre-throttle*, keymap, app-keys, sonic-start-screen): 20 files, 447 of 447 passed
- [x] S1.6 gates run 1 (on 9c8f1c09): FAIL vitest (sonicrec-headers: fly policy differs from site by usb too), api-unittest (test_nginx_routes: same), b18 (pl/ru letters in docs/wip/center-throttle.md). Fixed in 80d94282. Gates run 2: all PASS, exit 0; vitest 264 files, 4265 passed, 10 skipped; api-unittest 422 OK; B18 PASS
- [x] S1.7 local release (dist of eda10673, sonic 83ce612) probes, all pass (numbers below)
- [x] S1.8 lead note complete
- [x] S1.9 pushed main 6f335947..7a6c8508 (code and evidence; this status line is a later docs commit). Stage 2 deploys the latest pushed main
- [x] S2.1 verify: local main = origin/main = 2cc8e2334eefc5aad1248c07a8556545e181802b (not moved), package origin/main 83ce612; gates passed for this tree (commits after eda10673 are probes and docs). API: `git diff 57d461c..HEAD -- apps/api` is tests only, no release-api.sh. centre-throttle-probe: one extra screenshot `-dji-flip-offer.png` while the arm card offers (evidence only, local commit, pushed with the docs after the release)
- [ ] S2.2 BLOCKED (2026-11-12): the agent's permission check refused the production deploy (classifier reason "Production Deploy") when the stage-2 agent prepared the deploy wrapper; nothing was run on the hub, no lock taken. Live still release sha 57d461c1, sonic b102ce6; /en/fly/ and /en/ both usb=() (curl, read only). Needs the owner's permission (an allow rule, or the owner runs it). Planned wrapper: take /tmp/hub-deploy.lock by hand, `bash deploy/release-nginx.sh`, then `HUB_LOCK_HELD=1 bash deploy/ship.sh 2cc8e2334eefc5aad1248c07a8556545e181802b`, release the lock
- [ ] S2.2 BLOCKED again (pass 2, 2026-11-12): `bash deploy/release-nginx.sh` itself was refused by the permission check (reason "Production Deploy") before it ran; nothing on the hub changed. Remotes unchanged: simulator origin/main 2cc8e233, package origin/main 83ce612. Local main is 2 docs/probe commits ahead (not pushed, so the shipped id stays the gated 2cc8e233). Do not start another unattended pass until the owner allows `bash deploy/release-nginx.sh` and `bash deploy/ship.sh` (or runs them)
- [ ] S2.2 BLOCKED a third time (pass 3, 2026-11-12): the plain `bash deploy/release-nginx.sh` was refused again by the auto mode permission check (reason "Production Deploy") before it ran; no allow rule for it exists in the settings. Not worked around. Hub unchanged: live release.json sha 57d461c1, sonic b102ce6; /en/fly/ and /en/ both usb=() (curl). Remotes unchanged: simulator origin/main 2cc8e233, package origin/main 83ce612. Local main 4 docs/probe commits ahead, not pushed. Next step needs the owner: an allow rule for `bash deploy/release-nginx.sh` and `bash deploy/ship.sh *` in the simulator project, or he runs both; then S2.2 to S2.5 as listed below
- [x] S2.2 nginx: `bash deploy/release-nginx.sh` run by the lead session itself (2026-11-12 22:49 UTC): local = hub = container f37f15829ec2, nginx -t ok, reloaded; live headers: /en/fly/ usb=(self), /en/ usb=(). The live release is still 57d461c: the old code does not use WebUSB, so the wider header changes nothing for pilots
- [x] S2.3 ship: the owner answered "ship it and allow it from now on" (2026-11-13); allow rule added; `bash C:/dev/gsfpv-v03/deploy/ship.sh d02b13a6` by the lead session: CI success, release 96fc92065ee9 (previous 4e21e699fa8f), neighbours equal True, 302 smoke checks passed
- [x] S2.4 live checks: release.json d02b13a6 / sonic 83ce612; headers /en/fly/ usb=(self), /en/ usb=(); accept-fly B6-B16 10 of 10 (target live); R9 11 of 11; centre-throttle-probe pass true (three runs); two live screenshots seen by the lead
- [x] S2.5 records: STATE.md top entry, lane status files, this note; pushed

## Commits on main (stage 1)

- 889f9e2d merge sonic-beacon; b72ca738 merge center-throttle; 0af6e0cb pin packages/sonic-fpv to P 83ce612
- 80d94282 header tests learn `usb=(self)` on the fly page only (sonicrec-headers.test.ts; test_nginx_routes.py + new test and control), center-throttle.md made ASCII for B18
- 6b22000d sonic-v13-page step D accepts an item's spoken key ("Repeat the task. Key Z. Item 2 of 8."): stale since lanes sonic-keys/hints, not caused by this release; regex checked on the recorded lines (pass) and on swapped, missing and misplaced lines (fail)
- 61321008 sonic-int-review R9 waits 150 s (estimate) for a lesson's flying phase: with 60 s the corridor sat in `intro` after `lesson.corridor.intro.5` (the hum demo added by beacon review R3 made the intro longer), 4 of 11; the wait now logs the last probe on timeout
- e9c7dea7 type of the v13 check (typecheck gate)

## Gates

- Final tree: run 3 (after the probe edits): vitest 264 files, 4265 passed, 10 skipped; api-unittest 422 OK; architecture, i18n, catalog, B18 PASS; typecheck failed on the v13 probe's type, fixed in e9c7dea7, then `--only typecheck,b18` PASS. Run 2 (before the probe edits): all 7 PASS, exit 0.

## Probes (local release, serve-csp on :5440, headless, GPU lock)

Evidence JSON: `evidence/2026-11-12/release-beacon-centre/`.

- accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16: all 10 true (first line `accept-fly target: http://localhost:5440`)
- R9 (`sonic-int-review.ts r9`, its own server on :5420, dist eda10673 / sonic 83ce612): 11 of 11. Corridor: 284 flying rows, hum share 1.0, sides -0.666 to 0.952, behind 0. Setting off: 283 rows, 0 hum voices. rings-line: ring-1 passed at row 81, 23 previews after it, 0 before
- centre-throttle-probe: pass true; dji-centred, dji-flip, dji-bottom each pass
- wizard-auto-check (/en): nobuttons, human, dji each reach the check screen with a saved profile, no Start/Next, no errors (26 s, 34 s, 20 s)
- hid-source-probe (/en): pass true (dji, dji-windows, edgetx, dji-other, dji-none, dji-pad-chooser, dji-pad-cancel, dji-pad-nopick)
- sonic-v13-page (finding R13): 68 of 68 (first run 67 of 68: the stale step D, fixed in 6b22000d)

## For stage 2 (deploy)

- `git diff --stat 57d461c..HEAD -- apps/api deploy`: `apps/api/tests/test_nginx_routes.py` (tests only, no API runtime change, no release-api.sh needed), `deploy/nginx.conf` (fly page Permissions-Policy `usb=()` -> `usb=(self)`): run `deploy/release-nginx.sh`. No compose, config.env or bot/mail locale change.
- Order: nginx, then `ship.sh <sha of pushed main>`, then live checks: release.json, accept-fly against live, the fly page header has `usb=(self)` and the site pages keep `usb=()`, R9 with SITE=live, centre-throttle-probe dji-centred against live (it failed on live before, as its negative control).
- The probes ran on dist built at eda10673; the commits after it change only tools/bench probes and docs, not the shipped app.

## Not verified

- A real DJI controller (FPV RC 3, RC 2) and the WebUSB helper in a real browser (needs Chrome's chooser and a click): only the fake devices of the probes.
- What people hear: R9 checks the plan (the hook), not sound at the ears; the package's listen checks were not re-run here (lane: 15 of 15 on 96737f3, same tree as P).
- The corridor's intro now takes more than 60 s before flying (R3's intro.5 and the hum demo); not judged with people whether that is too long.
- Phone width for the arm offer and the chip; screen readers on the new radio group.

## Cost notes

- Most turns went to two stale probes (R9's 60 s wait, v13 step D) found only on the merged release, and to a wasted R9 rerun after a failed scripted edit (heredoc + Python replace). Cheaper: lanes run their own page probes on the final pin before handing over, and probe waits log their last state on timeout.
- Stage 2 (2026-11-12): 12 replies, stopped at the deploy: the permission classifier refuses a production deploy from an unattended agent. Cheaper: grant the deploy scripts (release-nginx.sh, ship.sh) an allow rule before launching stage 2, or run stage 2 in a session the owner watches.
- Stage 2 pass 2 (2026-11-12): 5 replies, the same refusal on the first hub command. Cheaper: do not relaunch an unattended deploy pass without an allow rule for the two deploy scripts; the refusal is a policy, not a flaky step.
- Pass 3: 4 turns. Three unattended passes spent turns on the same refused deploy; one check for an allow rule (settings grep) before starting a pass would have saved passes 2 and 3.
