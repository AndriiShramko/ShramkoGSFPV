# Train 4 integration

## Status

Car 1 (job int4-car1, work copy C:/dev/gsfpv-v13-int, branch train4 from e3201fec).

- [x] S1 the merges (car 1: the lanes whose review said SHIP when S1 reached them): 71e9f0d0 site4, 37d6c672 edit4b,
      8eaa97c5 menu4, b174107b tails4, 3e7a7c6e head4; the car 1 list is closed (a second look at the review files after
      the last merge found no new SHIP); every merged lane head is an ancestor of HEAD; pnpm install --frozen-lockfile,
      gen-catalog (everything up to date, no change) and pnpm -r typecheck (rc 0) on 3e7a7c6e
- [x] S2 the seams between car 1 lanes, the one full check, on 4707f7d2 (no source change was needed: see Seams):
      gates typecheck, api-unittest, architecture, i18n, catalog, b18, leaks PASS; vitest 5383 tests passed, 4 files
      failed only at server start (rooms-open-vote, rooms-race, rooms-socket: "rooms.py did not start"; scene-default:
      beforeAll 30 s timeout), all four start a Python server and ran beside the release build; the same four files
      alone afterwards: 4 files, 26 tests PASS; no car 1 lane touched them or apps/api/rooms. a6-reference.test.ts holds
      its hash (PASS). One release build (sha 4707f7d2, 1948 files) with the nine walls, served on :6180. Probes on it,
      evidence/2026-11-19/int4-car1/: site4-links 11/11 PASS (steps sound, soundall, band, person, lang, banner; the
      scene step needs a local API, not run), edit4b-probe 12/12 PASS (render off), menu4-first-minute 15/15 PASS,
      tails4-review-start 9/9 PASS, tails4-helper-download 12/12 PASS, head4-accept 12/12 PASS (fake camera clip, render
      off). accept-fly on http://localhost:6180: B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS (evidence b-fly-*.json).
      No picture taken: no step judged a picture.
- [x] S3 the hand-over: Deploy order, Live checks (six new read-only checks in deploy/live-checks.sh, all six FAIL on
      the live site before the release: the negative control), What the owner should try, Not verified;
      U:/Temp/gsfpv-train4/int4-car1.json written for this head. dist was already deleted after S2.

Car 2 (job int4, work copy C:/dev/gsfpv-v13-int, branch train4 on car 1's head 2716e78e and the lead's release merge
aa18f1e4 of origin/main; the lead's change of 17:50 UTC: car 2 takes the lanes whose review says SHIP, the rest is car 3).

- [x] S1 the merges: adb19dd6 ux4a, c164d5ed ux4b, fa53187d vox4, a246294a edit4a, 4383f155 edit4s, 0a1848ce edit4c,
      2540dea0 sound6 (resumed after the outage: the sound6 merge was half done; its two conflicts finished, the package
      checked out at the new pin). Car 3: gen4a (no review file, both looks), gen4b (needs gen4a). The car 2 list is
      closed. Every merged lane head is an ancestor of HEAD; pnpm -r typecheck rc 0 on 2540dea0; sonic start tests 44/44.
- [x] S2 the seams between car 2 lanes (and with car 1), the one full check, the two failed live checks of car 1.
      Done so far: origin/main's lead note a3806503 merged; seams b3e62a93 (Messages on Shift+L), the K help line for
      Shift+H, dfeb1d03 (drag cancel closes the live tag; seam 'saved'; edit4a-camera); the two live checks' probes
      repaired (edit4b-probe step 10 on live, edit-mouse-probe d.controls through the Course menu); the window under the
      top bar on a small view (30ae9183, 56e6ed71); the probes out of date (see Seams). Release build of 56e6ed71 with the
      nine walls on :6180; every lane probe and accept-fly on it (U:/Temp/gsfpv-train4/int4/probes4.sh, logs4): edit4a 13
      and edit4c s8 failed at 844x390 with walls (the window under the bar lay over the gates and the Add list: repaired,
      the window narrows beside the bar); head4-accept and sound6-walk 11 out of date (repaired in the probes); accept-fly
      stopped at B10 on a page load timeout. Then builds of 5bab5cce, 29945db2, 030d11d1 (the Add click from an eye in the
      scan) with probes (probes8.sh, logs8 on 030d11d1): all PASS but site4-links (only its scene step: needs a local API, as
      in car 1), edit4b-course-life step 1-open-numbers (no gate in view on open: the probe out of date, repaired, see
      Seams) and ux4a-messages step 6 at 1536x730 (two runs of three: a message over the top-row buttons 2.9 s; repaired
      in the product, 3d86ffee, see Seams). Left: a new release build of the head (top-row.ts changed), every probe again
      (probes8.sh with L=logs9-final), accept-fly, the gates once on the final tree; then S2 is done.
      2026-11-20: origin/main's lead note abdf4523 and two site commits (sound page texts) merged, 6f3b0da3; the final
      release build of that head, the probes (probes9.sh, logs9-final) and the gates follow.
      Release build of 88ccd89e (1948 files, U:/Temp/gsfpv-train4/int4/build8.log) with the nine walls from
      U:/Temp/gsfpv-train3/walls/release, served on :6180 (serve-csp, started in the background of the run that stopped:
      kill it by its PID when done). Probes on it (logs9-final/summary.txt): edit4c, edit4b-course-life, edit4s,
      ux4a-messages, ux4b-phone, head4-accept, edit-mouse-wroclaw, edit4a, ux4b-cancel, vox4, vox4-switch,
      menu4-first-minute, tails4-start-moved all rc 0; site4-links rc 1 only at its scene step (needs a local API, as in
      car 1); sound6-walk rc 1 at firefox 3 and 4 only (chromium PASS): AudioContext still 'suspended' 2 s after the click
      and the first speech started 25.3 s late (0.8 s on logs8), the walk took 367 s against 206 s on logs8: a loaded
      machine (other jobs held the GPU lock until 13:28), no sound code changed since logs8 PASS. accept-fly was still
      running when the run stopped (the subscription's reserve hook, 86 % of the window, 2026-11-20 ~13:45 UTC).
      Left: read logs9-final/accept-fly.log (B6-B16), rerun sound6-walk alone on :6180 (logs9-final/sound6-walk-2.log),
      the gates once, commit the evidence (2026-11-19/int4, 2026-11-20 b-fly), kill the server; then S2 is done.
      Run of 2026-11-20 ~17:05 UTC: accept-fly on 88ccd89e: B6 B7 B9-B14 B16 PASS, B15 FAIL only at its LSB control:
      the same flight as on c4e3ffdc (5631 records, 2 lives, the same crash point) but the scenario's flip began at
      tick 24173 instead of ~5650 (a slow start on the loaded machine), so the tamper at the absolute tick 10000 (B15_TICK)
      met idle throttle -1 (tamperedValue -1, hash unchanged). The check's timing, not the product; if the rerun fails
      the same way, make B15 tamper at the first record after the flight's start (flip.startTick) instead of tick 10000.
      Gates on the final tree (356fc8ff: 88ccd89e + this status), all PASS rc 0 (U:/Temp/gsfpv-gates-20261120-180850,
      U:/Temp/gsfpv-train4/int4/gates3.log); a6-reference is in the vitest gate (not yet looked at in the log).
      Started in the background, still running when the run stopped (the five-hour window at 99 %, the hook's
      publication reserve): the server serve-csp on :6180 for dist (serve10.log) and probes10.sh (accept-fly B15 alone,
      then sound6-walk alone; results in logs9-final/summary.txt as accept-fly-b15 and sound6-walk-2, ALLDONE at the end).
      origin/main a59bd3db (two lead notes and STATE.md, docs only) is not merged yet: merge it before S3 (gates enough).
      Left: read the two reruns, grep a6-reference in the vitest log, commit the evidence, kill the server
      (its node process on :6180), then S2 is done.
      Run of 2026-11-20 ~18:40 UTC: the reruns read: sound6-walk-2 PASS (chromium and firefox, first wall cue 8.3 s);
      accept-fly B15 FAIL again the same way (flip at tick 21833, tamper at 10000 met throttle -1). Repaired in the check:
      B15's controls now tamper 4300 ticks after the flip's start (B15_AFTER_FLIP; the old tick 10000 against a flip at
      ~5650-5710 on 11-15, 11-16, 11-19; the crash comes ~13500 ticks after the flip, so the tamper is in powered flight).
      The gates' vitest on 356fc8ff: 441 files passed, 1 skipped, 5628 tests (a6-reference alone again: 1/1 PASS). The server was
      already gone. origin/main d72fe5f8 (lead notes and STATE.md, docs only) merged. Left: B15 alone on the dist of
      88ccd89e (no app source changed since; probes11.sh, logs9-final/accept-fly-b15-2.log), then S2 is done.
      B15 on the dist of 88ccd89e (the only non-doc change since the build is accept-fly.ts): PASS; the start was late
      again (flip at tick 19053), the controls at 23353 met throttle -0.375, LSB fired (0.016 m), twitch fired (0.36 m);
      the new tab's hash equals the saved one; CPU x4 997.5 steps/s. The negative control: the old tick 10000 failed on
      the two late starts before (21833, 24173). So B6-B16 all PASS on the build of 88ccd89e (B15 with the repaired
      check). The server is stopped (probes11.sh kills it).
      Gates once on the final head 89b2203f: all PASS rc 0 (typecheck, vitest 441 files / 5628 tests, api-unittest,
      architecture, i18n, catalog, b18, leaks; U:/Temp/gsfpv-gates-20261120-224507, int4/gates4.log). S2 is done: the
      tree handed over in S3 is this one plus status notes; S3 starts with `git fetch origin` and the MAIN MOVES rule.
- [x] S3 the hand-over (Car 2 parts, U:/Temp/gsfpv-train4/int4.json). 2026-11-20 run: `git fetch origin`: origin/main
      has no commit that is not in HEAD (nothing to merge, the S2 gates stand for the code). Seven new read-only live
      checks committed (ee0f5348); their negative control against the live site (car 1's release) runs in the background:
      U:/Temp/gsfpv-train4/int4/live-neg2/summary.txt. Deploy order, Live checks, What the owner should try, Not
      verified written (Car 2). The live site is release ac11d2c2 (sound page texts, an ancestor of HEAD and of
      origin/main), not aa18f1e4. The negative control finished (exit 0 of the wrapper; the verdicts are in
      live-neg2/summary.txt and the logs, NOT read yet: the run stopped at the subscription's reserve hook, 97 % of the
      five-hour window, 2026-11-21 ~02:00 UTC). Expected: the seven new checks FAIL (car 2's code is not live), the two
      repaired car 1 checks (edit4b-course-life, edit-mouse-wroclaw) PASS.
      2026-11-21 run: live-neg2 read: the seven new checks FAIL as expected, edit4b-course-life PASS, edit-mouse-wroclaw
      FAIL at b.select (d.controls now ok): 12 gates, 1 on screen, no candidate after backing off four times (all 44
      earlier b.select runs on our builds ok). The view, not the product: a course that runs away behind the drone and
      nothing frames it by itself (E1). The probe now presses Home (edit4a frameAll) when no gate is a candidate, as
      edit4b-probe step 1 does (recorded as home). Runs on the release build: probes12.sh, logs12/summary.txt (three
      plain runs, one with the Home path forced by a temporary copy). origin/main 9b4cbd87 (one lead note, docs only)
      is merged after that (the gates are enough). logs12: all four PASS (forced run: home true). Merge of 9b4cbd87
      done (docs/wip/train4-lead.md only). Gates on 78a8b2bd (the code handed over): all PASS rc 0 (typecheck, vitest
      441 files / 5628 tests, api-unittest, architecture, i18n, catalog, b18, leaks; U:/Temp/gsfpv-gates-20261121-033946,
      int4/gates5.log); a6-reference alone PASS (its hash holds). S3 done: int4.json written with the head of the
      commit that ticks this box. Written: U:/Temp/gsfpv-train4/int4.json with sha = the new HEAD, api
      ["server.py", "tracks.py"], rooms false, nginx false, package_sha 53a567591f2b273fd9d80cbea4e509a4a7447843,
      held ["gen4a", "gen4b"], live_only ux4a-messages,ux4b-cancel,vox4-voxels-only,edit4a-gizmo,edit4c-warnings,
      edit4s-drafts,sound6-quick-walk,edit4b-course-life,edit-mouse-wroclaw,accept-fly,head4-accept,edit-mode-wroclaw,
      voxels-alone-wroclaw,voxel-panel-wroclaw,sonic-in-place-tunis,sonic-course-wroclaw,narrator-off,menu4-first-minute
      (one line, no spaces); a cost note; LANE-DONE.

Car 3 (job int4-car3, work copy C:/dev/gsfpv-v13-int, branch train4 on car 2's head 267923c3; it brings ONE branch,
t7-base 03624451 of job base7: gap-gen (gen4a, gen4b), gap-save, gap-sound and the joined sound package 719aaf54).

- [x] S1 the merge of t7-base: `git fetch origin`: origin/main has no commit that is not in HEAD; reviews gap-gen,
      gap-save, gap-sound all 'Verdict: SHIP'; 03624451 was not an ancestor; package 719aaf54 fetched into
      packages/sonic-fpv from C:/dev/gsfpv-t7-base/packages/sonic-fpv branch t7-base (it descends from car 2's pin
      53a56759); `git merge --no-ff 03624451` = 6ef4e3b8, no conflict, the gitlink is 719aaf54; the lock did not change;
      gen-catalog everything up to date (no change); pnpm -r typecheck rc 0.
- [x] S2 the seams (base7's open seams against car 2) and the one full check.
      2026-11-21 run: seams repaired with tests (see Seams, Car 3): 47d3c657 (the editor's Generate: no second unsaved
      line in gen4b's dialog), d73cd1b9 (probes press the dialog's Build after Shift+G; edit4b-probe step 13), d100b6fc
      (PilotMessage.minMs: the start line stays START_LINE_MS). Release build of d100b6fc with the nine walls, then
      U:/Temp/gsfpv-train4/int4/probes-car3.sh (server :6180; gap-gen-accept, gen4-accept, gap-sound-accept,
      gap-save-accept, the car 1/2 probes, accept-fly B6-B16; logs-car3/summary.txt, ALLDONE at the end; evidence
      2026-11-19/int4-car3). Results (logs-car3/summary.txt): gap-gen-accept, gen4-accept, gap-sound-accept,
      edit4b-course-life (with the new step 13), edit4c, ux4b-phone, head4-accept, edit-mouse-wroclaw, edit4a,
      ux4b-cancel, vox4, vox4-switch, menu4-first-minute, tails4-start-moved rc 0. Four probes out of date, repaired in
      the probes (no product change): gap-save-accept 76595c87, edit4s s9 7f4a508e, ux4a-messages 359d4c54 (each left
      gen4b's Generate dialog open after the Course menu's or the pause menu's Generate), sound6-walk a8e5bc76 (gap-sound's
      start order and the room's four wall names). Their rerun on the same dist: probes-car3b.sh (summary '--- rerun').
      accept-fly B6 B7 B9-B16 all PASS on that build (1537 s). Rerun (probes-car3b.sh): edit4s, sound6-walk PASS;
      gap-save-accept failed s15.emptySaved / s15small / review.reopenSmall (a seam, repaired 05a28a53, see Seams) and
      s100.emptySaved (expected: gap-save's Not verified, nothing fits at x100); ux4a-messages steps 2, 3, 5 (the probe
      out of date for the t7-base join, repaired 3240c9c0). Then the final build of 3240c9c0 and probes-car3c.sh
      (gap-save-accept, edit4b-course-life, ux4a-messages, gap-gen-accept, accept-fly; summary '--- final build').
      Left: read probes-car3c's results, the gates once on the final tree, a6-reference.
      Run of 2026-11-21 ~06:20 UTC (stopped by the subscription's reserve hook, 97 % of the five-hour window; this note is
      not committed: commit it first). ux4a-messages-3 on the build of 3240c9c0: 16/16 PASS. Final build of d26847d9
      (1978 files) and probes-car3c.sh with suffix -4 started in the background, server :6180 (kill its node by PID when
      done): gap-save-accept-4 all PASS but s100.emptySaved (expected, gap-save's own Not verified: nothing fits at x100);
      edit4b-course-life-4, ux4a-messages-4, gap-gen-accept-4, accept-fly-4 were still running (logs-car3/summary.txt,
      ALLDONE-C at the end). The gates were NOT started (the hook stopped them). Code tree to gate: d26847d9 (082c1c79 and
      this note are docs only). Left: commit this note; read the four '-4' results (repair what fails); the gates once
      (gates.py, all), a6-reference in its log; evidence 2026-11-19/int4-car3 committed; then S2 is done.
      Run of 2026-11-21 ~08:30 UTC: the note committed (388f19b5). The '-4' results on the build of d26847d9:
      gap-save-accept-4 all PASS but s100.emptySaved (expected, as above); edit4b-course-life-4, ux4a-messages-4,
      gap-gen-accept-4 rc 0; accept-fly-4 B6 B7 B9-B16 all PASS (769 s). Evidence committed (1172f868). origin/main
      f4da99d8 (STATE.md and the lead note, docs only) merged, 17e96753. Gates on 17e96753 (code = d26847d9): all PASS
      rc 0 (typecheck, vitest 449 files / 5728 tests, api-unittest, architecture, i18n, catalog, b18, leaks;
      U:/Temp/gsfpv-gates-20261121-084002, int4/gates-car3.log). a6-reference alone PASS (int4/a6-car3.log). No server
      left on 6180-6199. S2 done.
- [x] S3 the hand-over (Car 3 parts, U:/Temp/gsfpv-train4/int4-car3.json)
      Run of 2026-11-21 ~10:00 UTC: `git fetch origin`: origin/main 852821e5 (hot-sog3: playcanvas 2.24.2,
      splat-transform 3.12.0; the lead's release merge) brings CODE: merged 8eac608d (only evidence/2026-11-21/b-fly*
      conflicted, add/add of two accept-fly runs: ours kept at the path, hot-sog3's run moved whole to
      evidence/2026-11-21/hot-sog3-s3/); pnpm install --frozen-lockfile, pnpm -r typecheck rc 0. Release build of
      8eac608d (1950 files) with the nine walls on :6180, then every car 3 probe, hot-sog3-scans and accept-fly B6-B16
      on it: U:/Temp/gsfpv-train4/int4/probes-car3s3.sh, logs-car3s3/summary.txt (ALLDONE at the end), evidence
      2026-11-21/int4-car3-s3. Found while writing the live checks: gen4b's Shift+G opens the Generate dialog outside
      Fly by Sound, and eight live checks pressed Shift+G (or the pause menu's Generate) and waited for a course
      (course-path-wroclaw, gate-guide-wroclaw, mouse-free-probe, one-course, voxels-alone-wroclaw,
      voxel-panel-wroclaw, edit-mode-wroclaw, sonic-eye-course-wroclaw): repaired in the probes (the shared
      tools/bench/scripts/gen-build.mjs: Shift+G, then the dialog's Build; inline in editor3-smoke.ts and
      sonic-int-review.ts course-first). Three new read-only live checks: gen4-generate-dialog, gap-gen-asked-course,
      gap-sound-start. Left: read logs-car3s3; run live-checks.sh against :6180 with LIVE_ONLY of the repaired and new
      names (their positive side) and against the live site for the new three (the negative side); gates once; the
      hand-over parts and int4-car3.json.
      Run of 2026-11-21 ~11:00 UTC: logs-car3s3 read. On the build of 8eac608d: every car 3 probe rc 0 but gap-save-accept
      (only s100.emptySaved, gap-save's own Not verified, as in S2), hot-sog3-scans rc 0, accept-fly B6 B7 B9-B16 all
      PASS (evidence committed, cb70ee28). live-local (11 names on :6180): 8 PASS (gate-guide, one-course, sonic-eye-course,
      voxels-alone, voxel-panel and the three new ones); the negative side against the live site (release 852821e5): the
      three new checks FAIL, and the old mouse-free-probe on the build FAILs at courseKey (the repair's control). Three
      FAIL on :6180, repaired in the probes (no product change): edit-mode-wroclaw (editor3-smoke: edit4a frames nothing on
      open, the asked course's gate 1 stood behind the camera and every drag missed; it now presses F when the selected
      gate is off screen, 89fa2351), course-path-wroclaw (the old generator's eye band 1.2-2.0 m held against gap-gen's
      asked course, which stands a centre up to EYE_HI + half a gate and loosens its zone by tiers: an asked course is now
      judged by the planner's own stats outside 0 and underGround 0, in the probe and in the check's cpband, 89fa2351 and
      4c9b27ed), mouse-free-probe (its rooms step: locally key 9 has no rooms service and Rooms sits under the pause menu's
      More since menu4; the fallback opens More, 89fa2351). Reruns (logs-car3s3 live-local2, live-local-cp1/2, live-site3):
      edit-mode-wroclaw PASS on :6180 and live; course-path-wroclaw PASS twice on :6180 (asked, 10 gates, outside 0,
      underGround 0; the cpband judge tested on those, on the live run and on a copy with outside 1: PASS, PASS, FAIL,
      FAIL); mouse-free-probe PASS on live, on :6180 still FAIL at its rooms step only (no rooms service on a local
      release: the panel never opens; car 3 changed nothing in rooms). Found: course-path-wroclaw FAILs on the live site
      today, before car 3 (release 852821e5, the g1 course: 37 gates, one at 2.2 m against 2.1); after the release Shift+G
      builds through the dialog and the check takes the asked path.
      Gates once on 4c9b27ed (the code handed over): all PASS rc 0 (typecheck, vitest 449 files / 5728 tests, api-unittest,
      architecture, i18n, catalog, b18, leaks; U:/Temp/gsfpv-gates-20261121-135833, int4/gates-car3s3.log); a6-reference
      alone PASS (int4/a6-car3s3.log). `git fetch origin`: 511a44cb (STATE.md and the lead note, docs only) merged,
      c90020ae: the gates are enough. S3 done: int4-car3.json written with the head of the commit that ticks this box:
      api ["tracks.py"], rooms false, nginx false, package_sha 719aaf5454ddb15677ad4dc090ac6faeab853e77 (the pin moved
      from 53a56759, which is the package's main today), held [], live_only as in Live checks (Car 3).
      Then `git fetch origin` once more: 13670b66 (fix-gizmo13: tools/bench/scripts/edit4a-probe.mjs, evidence, docs; no
      app or package source) merged, 5f85f7ad; `git diff 8eac608d HEAD -- apps packages pnpm-lock.yaml` is empty, so the
      dist of 8eac608d is this head's product; edit4a-gizmo with the repaired probe on it: PASS. The gates once more on
      the tree handed over: all PASS rc 0 on 7e13d7b6 (vitest, api-unittest and the six others; U:/Temp/gsfpv-gates-
      20261121-141042, int4/gates-car3s3b.log). Then origin/main d7d60663 (STATE.md and the lead note, docs only) merged:
      the gates are enough. int4-car3.json's sha is the commit that writes this line.

Car 5 (job int4-car5, work copy C:/dev/gsfpv-v13-int, branch train4 on car 3's head 72d4babfbadf92075849a8e8d8234096dc8eeb8a
(the `sha` of int4-car3.json); the lead's order of 2026-11-21: the tutorial lanes before car 4. Lanes: n-share, tutor-say,
tutor-moment, tutor-air. The seams, the full check, Deploy order, Live checks and the hand-over cover what changed since
car 3's head.)

- [x] S1 the merges: origin/main b9bbc779 (fix-lod probe and lead notes; fast-forward); 9a14451c n-share, 75dd20ca
      tutor-say, 41ff795f tutor-moment, a7ac26e6 tutor-air (all four reviews 'Verdict: SHIP' when S1 started; nothing
      held). The package pin moves 719aaf54 -> 9ac7876dee42b8a874e51e6d46eb7cf8d70c3a48 (tutor-moment's package head,
      fetched from C:/dev/gsfpv-t8-tutor-moment/packages/sonic-fpv; 719aaf54 is its ancestor, so no join branch; not yet
      on the package's main). Every lane head is an ancestor of HEAD; pnpm install --frozen-lockfile rc 0, gen-catalog
      everything up to date, pnpm -r typecheck rc 0 on a7ac26e6.
- [x] S2 the seams (start-screen/start-model, lessons.ts, sonic locales, keymap G and Shift+K, doc.ts guide, the #ui
      live region in a lesson), the one full check: gates, a6-reference, the package's tests, one release build,
      tutor-say-accept, tutor-air-accept, n-share-accept, first-set.test.ts, accept-fly B6-B16, pictures
      Result: no product source changed in S2 (see Seams). Release build of 9bebe9b1 (1950 files, sonic 9ac7876, int4/
      build-car5.log) with the nine walls on :6180 (U:/Temp/gsfpv-train4/int4/probes-car5.sh, logs-car5/summary.txt):
      n-share-accept rc 0, tutor-say-accept rc 0, tutor-air-accept rc 0 (evidence 2026-11-21/int4-car5); the sound live
      checks against the build (LIVE_ONLY, 11 names): sonic-in-place-tunis, sonic-course-wroclaw, sonic-course-wroclaw-n,
      narrator-off, sonic-eye-course-wroclaw, menu4-first-minute, tails4-start-moved, head4-accept PASS; sonic-int-review-r9,
      sound6-quick-walk, gap-sound-start FAIL on probes out of date (Seams), repaired, then PASS on the same build
      (live-local2, live-local3; only tools/bench changed since the build). accept-fly B6 B7 B9-B16 all PASS (888 s; B15
      too, against tutor-air's note). Package tests (packages/sonic-fpv at 9ac7876d): 82 files / 1474 tests PASS;
      test/first-set.test.ts 20/20. Gates once on 611af500 (+ this status): all PASS rc 0 (typecheck, vitest 467 files /
      5846 tests, api-unittest, architecture, i18n, catalog, b18, leaks; U:/Temp/gsfpv-gates-20261121-183018, int4/
      gates-car5.log); a6-reference alone PASS. Pictures (tutor-air-accept DRAW, one drawn run): int4-car5-moment-1536.png
      and -844.png: the moment card, a yellow tag "Wall" over one large two-line sentence ("Wall: a wooden knock from a
      wall near you, faster as you get closer."), centred, nothing over it, fits 844x390. dist deleted, no server left.
      Done so far: every lane head still an ancestor of HEAD, every review still SHIP. The four lanes share one base
      (03624451, t7-base's last repair), so the seams are among themselves (joined on tutor-air's branch) and with what
      car 3 added after that base (course.ts, life.ts, messages-logic.ts minMs, top-row.ts, playcanvas 2.24.2, probes).
      Seam tests: tools/bench/test/int4-car5-seams.test.ts (the #ui hold x the real ui/messages.ts service: a crash and a
      problem with its fix reach the captions once, not held none; G / Shift+K / Shift+G / K in and outside a sound
      flight) and sonic-start-screen.test.ts 'int4 car 5' (a link's screen says the title and its one main button once,
      never Start flying): 5/5 PASS, NEG OK on car 3's head 72d4babf. No source change was needed.
- [x] S3 the hand-over: origin/main a59b1bcf merged (57496849; docs and notes only, the gates enough: they ran on the
      final tree in S2 and nothing but docs/ and deploy/live-checks.sh changed since); a fetch at the end of S3 found
      nothing new on origin/main. Three new read-only live checks (703ff41e) with their negative control against the live
      site (live-neg5: all three FAIL) and their positive side on the S2 build; Deploy order, Live checks, What the owner
      should try (with the site page's changed words and the three questions), Not verified. The package's main is still
      719aaf54 (9ac7876d a fast-forward of it, to be pushed before the page). U:/Temp/gsfpv-train4/int4-car5.json is
      written for the commit that writes this line (sha, api [], rooms false, nginx false, package_sha 9ac7876d...,
      live_only as in Live checks, held []).

Car 6 (job int4-car6, train 5, work copy C:/dev/gsfpv-v13-int, branch train4 on car 5's head
3cc6b51b15b6aca43a4c2b397bf6553ad1456e12 (the `sha` of int4-car5.json); the lead's order: the generator's repair
goes live first. Lanes: fix-fly, w1-anchor. The seams, the full check, Deploy order, Live checks and the hand-over
cover what changed since car 5's head.)

- [x] S1 the merges: origin/main 5a4d4a0d (the leads' notes and STATE.md only; fast-forward); 0b0cd554 fix-fly,
      683d7faa w1-anchor (both reviews 'Verdict: SHIP' when S1 started), no conflict. Every lane head is an ancestor
      of HEAD (fix-fly 83de811c, w1-anchor ab98035c). `git diff 3cc6b51b HEAD -- apps/api apps/rooms deploy
      packages/sonic-fpv nginx compose*` is empty (api [], rooms false, nginx false, package_sha ''). pnpm install
      --frozen-lockfile rc 0, pnpm -r typecheck rc 0 on 683d7faa. Held: n-save, n-scan, w2-pilot, w1-dialog, w3-model
      (the lead's order: the generator's repair goes live first).
- [x] S2 the seams (course.ts, generate-dialog.ts, course/anchor.ts against the first flight and the sound start;
      flight-link.ts course token with '-' against n-share), the one full check: gates, a6-reference, the package's
      tests, one release build with the walls, w1-anchor-accept, accept-fly B6 B7 B9-B16, n-share-accept, the
      generate dialog probe
      Result: no product source changed in S2 (see Seams). Seam test tools/bench/test/int4-car6-seams.test.ts 3/3 PASS,
      NEG OK on 3cc6b51b (15a01c3d). Release build of 15a01c3d (1950 files, sonic 9ac7876, int4/build-car6.log) with the
      nine walls on :6180 (int4/probes-car6.sh, logs-car6/summary.txt; evidence 2026-11-26/int4-car6): w1-anchor-accept
      FAIL at step 2 once on its 10 m line (10.7 m; see Seams), the line made NEAR_M 15 m (269d00be, tools/bench only),
      then three runs PASS (gate 1 2.0-3.6 m from the spawn, 2.3-8.6 m from the paused drone, the link the same gates) and
      the drawn run PASS; gen4-generate-dialog rc 0, n-share-accept rc 0, tutor-air-accept rc 0; the live checks against
      the build (LIVE_ONLY): one-course, sonic-course-wroclaw, n-share-sound-link, tutor-air-first-flight,
      course-path-wroclaw, gate-guide-wroclaw all PASS; accept-fly B6 B7 B9-B16 all PASS (348 s). Package tests
      (packages/sonic-fpv at 9ac7876d): 82 files / 1474 tests PASS. a6-reference PASS. Picture (one, drawn w1-anchor run):
      int4-car6-gates-round-you.png: eb5f51dc as loaded, the black-and-white START gate a few metres ahead of the camera
      in the sharp courtyard (stone houses, lamp post), the line "Gates: 14. You are at the start gate" over the view,
      nothing over the gate. Server stopped. Gates once on 14d3774e (+ this status): all PASS rc 0 (typecheck, vitest
      470 files / 5871 tests, api-unittest, architecture, i18n, catalog, b18, leaks; U:/Temp/gsfpv-gates-20261126-210804,
      int4/gates-car6.log). dist deleted.
- [ ] S3 the hand-over: origin/main merged, w1-anchor-accept in deploy/live-checks.sh with its negative control on
      the live site, Deploy order, Live checks, What the owner should try, Not verified, int4-car6.json

## Progress

Car 1 (one line a lane, in the merge order)

- site4: merged 71e9f0d0 (review SHIP), no conflict
- ux4a: car 2 (review Verdict: HOLD when S1 reached it, and again after the last merge)
- ux4b: car 2 (review Verdict: HOLD, both looks)
- vox4: car 2 (no review file, both looks)
- gen4a: car 2 (no review file, both looks)
- gen4b: car 2, needs gen4a (review SHIP, but on a tree without gen4a planCourse is the S0 stub that uses only the seed: the level and spread buttons of the Generate dialog would change nothing)
- edit4a: car 2 (no review file, both looks)
- edit4b: merged 37d6c672 (review SHIP); one conflict, evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output): edit4b's file taken whole, S2's gates write it again; no source conflict
- edit4s: car 2 (review Verdict: HOLD, both looks)
- edit4c: car 2 (no review file, both looks)
- menu4: merged 8eaa97c5 (review SHIP); the same b-repo-b18.json add/add conflict only, menu4's file taken whole
- tails4: merged b174107b (review SHIP), no conflict
- head4: merged 3e7a7c6e (review SHIP), no conflict (adds @mediapipe/tasks-vision 1.2.3 to apps/fly and the lock)
- sound6: car 2 (no review file, both looks)

Car 2 (job int4, on top of car 1's head 2716e78e and the release merge aa18f1e4 of origin/main, fast-forward; one line a lane)

- site4: in car 1, its head is an ancestor of HEAD (no new commit)
- ux4a: merged adb19dd6 (review SHIP); only generated files conflicted (README.md, llms.txt, apps/site/public/llms.txt, docs/settings.md): ours, then gen-catalog; pnpm -r typecheck rc 0
- ux4b: merged c164d5ed (review SHIP), no conflict
- vox4: merged fa53187d (review SHIP), no conflict
- edit4a: merged a246294a (review SHIP); source conflicts with edit4b in apps/fly/src/app/builtin/course.ts and course/editor/texts.ts: edit4b's seam calls kept (pointAt on a wrong gate, TopBar fly/menu, SeamBus, emptyWaits, keyRoute), edit4a's rules kept (no aim/framedId/reframe, no tool switch on the gate bar, TOOLS keys gone, Esc during a drag returns first); edit4b's three framedId lines removed with the variable. pnpm -r typecheck rc 0. Seam breaks found by the tests, for S2: Shift+H bound to ux4a messages.open and head4 sonic.headCentre (keymap, app-keys tests); edit4a-camera counts edit4b's frameSelection provider (point.ts arrowPressed) as a second frameSel()
- edit4s: merged 4383f155 (review SHIP); edit4s was built without S0, so course.ts conflicted in 8 places with edit4b/edit4a: both sides kept and joined: the DraftKeeper is made after bus.emit('opened') and disposed before bus 'closed'; a restored draft also emits changed 'restore'; edit4s's regen command dropped (edit4b has no regen key: G is the Course menu's Generate, the seam's generate now calls keeper.beforeLoss('generate')); startNew calls keeper.beforeLoss('new'); the seam's applyEdit uses markChanged(by); pointAtWrong carries edit4b's empty-course words and refusedSave sends an empty course there; trackNow is nullable, the seam's trackNow throws when closed; saveFailed points at the gate by the seam's pointAt (edit4a: no aim); the probe hook edit4 = edit4b's parts plus s (keeper, save, fix). pnpm -r typecheck rc 0; editor tests 200/201 (the edit4a-camera seam above). Found for S2: no one emits the seam event 'saved' (life.ts listens: changedSinceSave stays true after a save)
- edit4c: merged 0a1848ce (review SHIP); conflicts in course.ts (imports; the bars: edit4b's TopBar and seam kept, edit4c's AddChooser, LiveWarnings and WarnBar made after them, its old GateBar/TopBar lines dropped; the probe hook has warn and add beside edit4; Esc: a drag first, then edit4b's keyRoute, then edit4c's escTarget question/adding) and course/view.ts (PAINT keeps flash and warn); placePiece uses markChanged('piece') and emits changed 'piece'. pnpm -r typecheck rc 0; editor and tracks tests 356/357 (the same edit4a-camera seam)
- gen4a: car 3 (no review file when S1 reached it)
- gen4b: car 3, needs gen4a (review SHIP, but without gen4a its level and spread buttons change nothing)
- sound6: merged 2540dea0 (review SHIP); conflicts: evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output: ours, the gates write it again) and tools/bench/test/sonic-start-screen.test.ts (both kept: head4's rig and row test, sound6's path option, noWebAudio and S4 tests; settings count 18 = 17 + head4's row, sound6 adds no setting); the package pin moves 293ebaea -> 53a56759 (fetched from sound6's copy; not yet on the package's main)

Car 3 (job int4-car3, on car 2's head 267923c3; one line)

- t7-base (gap-gen with gen4a and gen4b, gap-save, gap-sound; base_of 030d11d1): merged 6ef4e3b8 (reviews gap-gen, gap-save, gap-sound SHIP), no conflict; the package pin moves 53a56759 -> 719aaf54 (fetched from base7's copy, not yet on the package's main); gen-catalog no change; pnpm -r typecheck rc 0

Car 5 (job int4-car5, on car 3's head 72d4babf and origin/main b9bbc779; one line a lane, in the merge order)

- n-share: merged 9a14451c (review SHIP); one conflict, evidence/2026-11-21/b-repo-b18.json (add/add, a gate's output): n-share's file taken whole, S2's gates write it again; pnpm -r typecheck rc 0
- tutor-say: merged 75dd20ca (review SHIP; carries n-share), no conflict
- tutor-moment: merged 41ff795f (review SHIP), no conflict; the gitlink takes its package head 9ac7876d (719aaf54 is an ancestor), the package checked out there
- tutor-air: merged a7ac26e6 (review SHIP; carries tutor-say and tutor-moment, pin 9ac7876d), no conflict; gen-catalog up to date, pnpm -r typecheck rc 0
- held: none

Car 6 (job int4-car6, on car 5's head 3cc6b51b and origin/main 5a4d4a0d; one line a lane, in the merge order)

- fix-fly: merged 0b0cd554 (review SHIP; tools/bench only: accept-fly waits for the page's own readiness), no conflict
- w1-anchor: merged 683d7faa (review SHIP; stands on w1-diag, whose measuring script and notes come with it), no conflict; pnpm -r typecheck rc 0
- held: n-save, n-scan, w2-pilot, w1-dialog, w3-model (the lead's order: the generator's repair goes live first)

## Seams

Car 1

The seams the integration prompt names (gen4b's Generate dialog in edit4b's editor, gen4b to gen4a, ux4a's message
service, edit4a's drag event to edit4c, the head4 and sound6 rows in the sound start screen) each have one side in car 2,
so they are car 2's to make real. Where car 1 lanes meet:
- menu4, tails4 and head4 all change packages/prefs (menu4: levels in defs; tails4: migrate.ts MACHINE_LOCAL_KEYS; head4:
  doc.ts SonicState.headTrack, keymap.ts Shift+H): merged without conflict. head4's headTrack is a field of the sonic
  collection, not a schema setting, so menu4's level table (levels.test.ts: every def has a level) needs no entry; head4
  adds no storage key, so tails4's every-key classification test holds. Proof: vitest on the merged tree.
- edit4b (KeyG removed), head4 (Shift+H) and menu4 (the generated catalogue): gen-catalog --check PASS on the merged
  tree, so docs/settings.md, llms.txt and features.json already agree with all three.
- edit4b, menu4 and head4 do not share a pause menu item: only menu4 changed pause.ts / menu.ts (menu-levels.ts
  PAUSE_LEVELS lists today's items; an unknown id falls to expert).
- For car 2: edit4b's seam.ts is the design's contract plus flashGate; parts/life-ask.ts askFirst is to be swapped for
  gen4's app/ask.ts at that merge; head4's start-screen row `sonic-head` and sound6's rows in start-screen.ts merge by
  keeping both (sonic-start-screen.test.ts counts 18 settings today); the spoken key help (sound6's mode-keys.ts) does
  not list Shift+H yet.

Car 2 (on car 1's head 2716e78e and release aa18f1e4; gen4a and gen4b are car 3, so the Generate dialog in the editor and
the dialog's options reaching gen4a's generator are car 3's seams)

- ux4a's message service x head4 (car 1): both bound Shift+H (messages.open always, sonic.headCentre on ?sonic= pages): the
  keymap and app-keys tests failed after the ux4a merge. head4's key is live since car 1 and said by the voice, so it stays;
  Messages moved to Shift+J (J for journal). Refused on the way by the repository's own rules: Shift+M (M is keyboard
  flying's shared key), Shift+L (rooms RV-1: a pilot holding Shift to descend keeps L = Share and O = Settings), Shift+I (no
  other action may take a shifted sound-mode letter T U I Z G). Plain J is a radio's or gamepad's throttle style and Shift
  is a flying key only while the keyboard flies, so Shift+J takes nothing from anyone; it also gives H back to a pilot
  descending with Shift (plain H, the HUD). Caps come from the keymap, so the pause menu's Messages item, the top-row
  button's title and the generated catalogue (docs/settings.md, README.md, features.json) follow. Tests: keymap.test.ts
  (Shift+J opens Messages, J alone stays the throttle style, Shift+H routes nothing off the sound page and centres the head
  on it), app-keys.test.ts, rooms-review and rooms-public unchanged and passing; NEG OK against the merged keymap.
- head4 x sound6's spoken key help (mode-keys.ts KEY_HELP): K did not name Shift+H. One line sonic.say.helpHead in en es pl ru,
  said after the narrator key. sonic-head-switch.test.ts (K names it with the page's cap; off the sound page no line),
  sonic-optin.test.ts's pinned list +1; NEG OK.
- ux4a's message service x the course and the editor: real. The course's lines go through tell() with COURSE_LINE
  (progress, done, problem from 'course'); the editor's refusals go to the top bar's line and, as problems from
  'course-editor', to the Messages list; edit4s's saveFailed says through the same path. Not done (ux4a's follow-up, not a
  seam break): vox4's voxel failure and ux4b's walls failure stay in their panels' status lines, logged as plain lines.
- edit4a's gizmo drag x edit4c's warnings: the HandleDrag event's move and end reach dragTo, which asks LiveWarnings during
  the drag and on the release. A cancelled drag (Esc, a right click: edit4a A2) left the live tag beside the gate, naming a
  place the gate no longer stood at: dragCancel now ends the live check and closes the tag. int4-seams.test.ts, NEG OK.
- edit4s's save x edit4b's seam: no one emitted the seam's 'saved', so life.ts kept 'unsaved' after a save and the next loss
  question called saved gates unsaved. Both saves (mine, admin) now emit it after keeper.saved. int4-seams.test.ts, NEG OK.
- edit4a's camera rule x edit4b's arrow: edit4a-camera.test.ts counted one frameSel() in course.ts; the second is the seam's
  frameSelection, which only a click on edit4b's edge arrow asks for (the pilot's own press). The test now names both and
  that point.ts calls it once.
- head4's start-screen row x sound6's rows: merged in S1 (sonic-start-screen.test.ts keeps both, 18 settings); the gates run
  it.
- edit4b's longer top bar (car 1) x the editor window on a small view (found by edit4a's step 13 at 844x390): the bar's
  seven buttons reach past x 400, where the window began beside it, so the window covered the bar's last buttons. On a
  view narrower than 900 px or lower than 500 px the window now starts under the bar (top-bar.ts place() writes the bar's
  bottom to --ce-topbar-bottom, editor.css uses it), 30ae9183. That first version also counted the bar's own bottom for
  --ce-below, so on a low view the bar pushed itself down to mid-view and edit4c's Add list under it ran past the
  bottom (edit4c s8 at 844x390): the bar is now watched for its size only, 56e6ed71. int4-seams.test.ts, NEG OK both.
  On the build with the nine walls the Walls chip puts the bar at y 109 (train 3 I2), so the window under it began at y 167:
  over the view's middle, where Home frames the gates (edit4a 13: no gate left to click), and over the cross of edit4c's
  Add list (s8). The window now stays at the top right and narrows to the room right of the bar (--ce-beside); only with
  less than 260 px (BESIDE_MIN: a phone upright, a long language) does it start under the bar. The room is measured from
  the window's own right edge (64 px in on a low view, left of the sound button: the first try from the view's edge left
  the window where it was). The same step found edit4a's hover tag lying on the gate bar when the hovered handle is just
  above it: the tag then goes above the pointer and the bar (view-mouse.ts). int4-seams.test.ts, NEG OK.
- edit4a's overview eye x the Add click (edit-mouse c.add, two runs of three on 5bab5cce): Home and the editor's first view
  frame the course without a wall test (frame.ts frameBox), so on some random Wroclaw courses the eye stood in a tree's
  voxels; every click then hit 0.107 m from the eye and the new gate stood at the eye, lifted behind the camera plane (out
  of view). The probe now records the editor's place for c.add. A first try (pass hits nearer than 1 m) still failed one
  run in two on 29945db2: hit 1.02 m. Measured on the release's walls in Node along both failing rays: scan on 5 and 6 of
  the eye's 6 axes within 0.75 m, leaves along the ray to 0.4 m and to 1.3 m, then 18.5 m and 3.3 m of free air. Now: when
  the first hit is nearer than 1 m the eye stands in the scan, and the ray goes on through it until it has crossed 1 m of
  free air (add-place.ts hitPastEye), for a gate and a piece. int4-add-eye.test.ts (both measured rays among its cases),
  NEG OK against 5bab5cce and against the first try.
- Probes out of date after a merge (the product right, the probe repaired, each with the reason in the probe): edit4s s9
  (key G no longer makes a course in the editor since edit4b: the probe takes Course, Generate a new course, Yes);
  edit4c and edit4a (since edit4a a click selects without framing and the one gizmo has a size box on each axis: edit4c
  presses F like the pilot, presses the move arrow itself, and on s2 takes Tab when a far gate's few pixels missed;
  edit4a step 11 clicks only gates that no handle of the selected gate covers); edit-mouse (the Keys table's rows press
  their key, Esc left the editor); vox4 step 3 and ux4b-cancel (tails4 moved Lublin's start onto the ground); head4-accept
  step 5 (sound6 replaced 'Start the course from the beginning' by Quick start, which the probe now clicks; also a live
  check); sound6-walk 11 (the prefs store writes 250 ms after a change: the walk now waits for the saved 'fast' as it
  already waited for 'full').
- ux4a's message stack x the top row (ui/top-row.ts; ux4a-messages step 6 at 1536x730 on 030d11d1, two runs of three): a
  new line 471 px wide, centred, reached x 1004 over the row's buttons from x 892 (Sound, Full screen, Messages) for 2.9 s.
  The stack keeps class hud-note, so the top row moves it under the buttons, but its ResizeObserver only queued a layout
  for the next animation frame, and with the scan rendering headless a frame took seconds (the probe's new timeline: note
  w471 at 8212 ms, crowded at 11107 ms). A pilot sees the same for one frame, longer on a weak GPU. The observer's
  callback now lays out at once (before paint); nothing laid out there changes an observed size, so no observer loop.
  int4-top-row.test.ts, NEG OK. The probe's fault now records the notes, the row's parent and --top-row-bottom, and step 6
  carries the timeline when it fails.
- edit4b's numbers on open x edit4a's camera rule (edit4b-course-life step 1-open-numbers, one run of three on 030d11d1,
  and logs8): the editor opens at the flight camera (editor3 E2), and since edit4a nothing frames gate 1 on open (the
  owner's rule E1: the view never moves by itself); after the probe's flight the drone looked away from the course, so
  no gate was in view (13 gates, no label, no arrow). The product follows its rules; the probe now presses Home (edit4a's
  frame all, the pilot's way to the course) when no label is up after opening, and records it (home). Forced once: Home,
  8 gates, labels = on screen, PASS. For the lead (not a seam break, not repaired): nothing points to the course when the
  editor opens looking away from it; a hint 'Home shows the whole course' would help a new pilot.
- Car 1's two failed live checks (release aa18f1e4), both the check out of date, not the product:
  - edit4b-course-life step 10-pointed: on the live site Save is never pressed, and the course of step 6 already had a
    problem (gate 1 in a wall), so the step tried nothing (how: [], the 'pointed' it read was step 9's). The probe now,
    on live only, undoes gates until no gate has a problem, then makes the problem the step judges (711f2520).
  - edit-mouse-wroclaw d.controls: 'courses' and 'keys' were 'not on screen' because edit4b (car 1) moved Courses and Keys
    into the top bar's Course menu; the probe now opens Course and presses the item, the pilot's path (711f2520).

Car 3 (t7-base 03624451 on car 2's head 267923c3; base7's base_of was 030d11d1). Car 2's product change after base_of
is only apps/fly/src/ui/top-row.ts (3d86ffee, a message over the top-row buttons), so the seams are base7's open ones
against car 1 and car 2 lanes:
- edit4b Course menu Generate x gen4b Generate dialog: the seam call was right (keeper draft, then the dialog from
  'editor', its build reopens the editor); the dialog named the unsaved changes a second time after life.ts's question
  had named them and the pilot said yes. Repaired (47d3c657): from 'editor' the dialog has no lost line; int4-seams car 3
  tests, NEG OK. edit4b-probe step 13 walks it by mouse on the build (Course > Generate, Yes, the dialog, Build, the
  editor on the new course).
- gen4b's start line x ux4a's message rules: base7 dropped gen4b's 8 s (START_LINE_MS); the service's reading time gave
  the ru 'you are at the start gate' line 7.6 s. Repaired: PilotMessage.minMs (messages-logic.ts, never past
  MAX_SHOWN_MS), course.ts passes START_LINE_MS with the start line; int4-seams tests in en/es/pl/ru, NEG OK.
- gen4b's Shift+G opens the dialog first (G9): the probes that made a course by Shift+G alone would wait for a course
  forever (edit4b, edit4a, edit-mouse); they now press the dialog's Build by mouse (d73cd1b9), recorded as genDialog.
- gap-gen's progress box x ux4a's keyed progress line (base7: the box alone shows the steps; an old problem line stays
  until closed or the ready line replaces it): left as base7 joined it, within the owner's rules (one progress view).
  ux4a-messages-probe still expected progress lines under course.progress and the old 'course.ready' line: it now reads
  gen4b's progress box and the start line (3240c9c0).
- edit4b's New empty course x gap-gen's asked start x gap-save's flown sizes (found by gap-save-accept on the build:
  s15.emptySaved 'Not saved. The way from the start to gate 1 goes through a wall' after an asked course at x15):
  emptyCourse spread the course before, so the empty course kept the asked course's start (gap-gen S3 puts it on gate
  1's approach, far from where the pilot looks) and its scale (gap-save's own 'For the lead' need). Repaired (05a28a53):
  the empty course takes the scale flown now (seam.flown()) and the scene's own spawn (start null); int4-seams and
  edit4b-life tests, NEG OK. On the build the editor then refused it ('This course has no start. Press G for a new
  course.'): its checks need a pose, so the page's startNew writes the spawn as one (startAtSpawn, life-texts.ts,
  d26847d9; test: flown back to the spawn, NEG OK). For the lead: that fix line names key G, which does nothing in the
  editor since edit4b (the Course menu's Generate is the way): a text for the editor's owners in four languages.
- Not seams of this car, the lanes' own needs for the lead (not changed here): gap-gen's course.ts hook.adopt line for
  race rooms (RACE_ON is false: nothing on the page uses it yet) and 'the drone stands at the course start' at x15;
  gap-save's startNew transform and the editor at x100 when nothing fits; gap-sound's keysDue once a lesson.

Car 5 (since car 3's head 72d4babf; the four lanes share one base, 03624451, and tutor-air carries the other three, so the
joins among them were made on tutor-air's branch; the seams below are the header's, each made real and tested)

- start-screen.ts / start-model.ts, n-share's link screen x tutor-say's Start group and its spoken open line: a link with a
  scene has ONE main button (Fly this scan by sound), the lessons a small link (n-share's tests, unchanged); the plain screen
  has Start flying, All lessons (Continue third once there is progress). New test (sonic-start-screen.test.ts 'int4 car 5'):
  the first key on a link's screen says "Fly by Sound. Fly this scan by sound. ..." once and never "Start flying". PASS.
- lessons.ts: tutor-say's say path x tutor-air's 'moment' and 'audible' cases and its keysDue condition (a page that teaches by
  moments says no keys line at a lesson's start): joined on tutor-air's branch; its tests and the three probes PASS on the build.
- locales fly/sonic, fly/sonickeys, fly/share: the same keys in all four (the i18n gate). No held lane adds a key.
- keymap.ts: tutor-air's G = sonic.whatSound and Shift+K = sonic.know (when 'sonic') x gen4b's Shift+G (always: the Generate
  dialog; in a sound flight the asked course) x K (help.keys): keymapProblems empty; new test int4-car5-seams.test.ts: in a
  sound flight G, Shift+K, Shift+G, K are four actions; outside it G and Shift+K are nothing, Shift+G still Generate. PASS.
- doc.ts SonicState.guide (tutor-say) and .known (tutor-air): both fields, merged clean; prefs tests PASS.
- #ui live region: tutor-say holds it 'off' while a lesson runs (LessonHold); the HUD's news goes to the captions
  (captions.ts pageNews -> relayHeldNews). New test int4-car5-seams.test.ts with the REAL ui/messages.ts service (ux4a, car 3's
  minMs): a crash line and a problem with its fix reach the captions once while held; not held, nothing relayed. PASS.
- NEG OK for the three new tests on car 3's head (captions, live-quiet, keymap, start-screen, start-model swapped).
- Probes out of date after the tutorial lanes (the design changed, not a seam; repaired in the probes, 5793738f, 611af500):
  gap-sound-accept (gap-sound-start) and sonic-quick-walk (sound6-quick-walk) expected Quick start, Continue, Full course and
  the room listing wall, right, ceiling, floor before its flight; now Start flying, All lessons, Continue (tutor-say), and the
  room introduces its wall in a moment in the air (tutor-moment walls-hall v5; no ceiling or floor in the first set: the lead's
  decision 3 of 2026-11-20): the walks hold key W until the room's wall-ahead moment comes (either form passes, so the live
  site before the release still passes them). sonic-int-review R9: the corridor now opens with its 'target' moment (the
  flight frozen until key N): R9 goes on with N (at most 3 presses), as the pilot is told, before its turns.
- Stale page harnesses no live check or test runs (tutor-say's list; not repaired, for the lead): sonic-int-review R10
  (sonic-start-full), sonic-v13-page.ts (:291 Quick start / Full course), sonic-start-keyboard.ts (:356 the full button).
- Open for the package (not editable here): the headphone trial still SAYS "Sound 1 of 2." (headphones.trial, runner.ts
  :1663; decision 7 asks for no counter unless asked); the screen no longer shows it.

Car 6 (since car 5's head 3cc6b51b; fix-fly is tools/bench only, so the seams are w1-anchor's)

- course.ts / course/anchor.ts / generate-dialog.ts against car 5's first flight and sound start: every press (the dialog,
  a direct Shift+G, the sound mode's ask through the same generate(), the no-room box) takes FROM_PILOT, read when the job
  is sent; a link and a room's adopt pass their named anchor. The sound page's own N path (sonic/course-ask.ts courseJob)
  sends no request, so the worker lays the old generator's course from the spawn as before (untouched by w1-anchor). The
  dialog's model asks no place (CourseAsk): the page adds it. Real on the build: sonic-course-wroclaw (Shift+G in the sound
  mode makes a course), tutor-air-first-flight (the tutorial's room and its first step), one-course, course-path-wroclaw,
  gate-guide-wroclaw and gen4-generate-dialog all PASS.
- share/flight-link.ts against n-share: a shared SOUND link carries the course token whole when it holds '-' (sonic-link.ts
  COURSE_TOKEN already took '-'; flight-link.ts GENERATED now does too); the start screen's parseSonicParam keeps it and
  course/link.ts reads the anchor back; a token of the old form still reads anchor null (the core, the old course).
  tools/bench/test/int4-car6-seams.test.ts (3 tests) PASS, NEG OK on 3cc6b51b. n-share-accept and n-share-sound-link PASS.
- Sound link 'sg=' (modeScanPage, the sighted page's pause item to the sound page) carries only a 'g1.' seed (seedOfLink),
  as before car 6: a g2 course with its anchor does not travel that way (it never carried the level either). Not a new
  break; noted for the lead.
- w1-anchor-accept step 2 FAILED once on the build (gate 1 10.7 m from the paused drone against the probe's 10 m line;
  evidence w1-anchor-accept-10m-line-fail.json): the review's DOUBT (single random seeds lay gate 1 12.3-12.5 m away; the
  design's 10 m is the measuring gate's median). Not a seam, and the probe becomes a live check, so its line is now NEAR_M
  15 m with step 2 also asking gate 1 nearer the drone than the spawn (269d00be); three runs and one drawn run PASS on the
  same build; the live site's 492.6 m still fails it.

## Deploy order

Car 1 (from the merged lanes' 'For the lead' and `git diff origin/main HEAD -- apps/api deploy packages/sonic-fpv`)

1. The sound package: nothing. The pin of packages/sonic-fpv is unchanged (293ebaea, the one origin/main has); sound6 is
   in car 2.
2. The page: one release of this head (apps/fly, the site with its scene templates, the generated catalogue). The build
   fetches MediaPipe's face model once from storage.googleapis.com (head4; cached in node_modules/.cache/gsfpv-headtrack,
   checked by sha256), so the build machine needs the network the first time. The release gains /fly/headtrack/ (about
   18.9 MB unpacked, 8 MB over the wire, downloaded only when a pilot turns "Turn my head to listen" on).
3. The API files: none. apps/api changes only in a test (apps/api/tests/test_nginx_routes.py); server.py is unchanged.
   The scene pages' fix (site4) is in the release folder's scene-templates, which the running API already reads.
4. Rooms: no (nothing under apps/api/rooms changed).
5. nginx: yes, after the page: upload deploy/nginx.conf, `nginx -t`, reload. One line changes, in
   `location ~ ^/(en|es|pl|ru)/fly/` only: Permissions-Policy camera=(self) (every other location keeps camera=()). The
   page alone works (the camera is refused, the setting says so and turns off); nginx alone is harmless.
6. Walls: no new walls; deploy/release-walls.sh need not run.

Car 2 (what changed since car 1's release aa18f1e4: `git diff aa18f1e4 HEAD -- apps/api deploy packages/sonic-fpv`)

1. The sound package FIRST: its main must hold 53a567591f2b273fd9d80cbea4e509a4a7447843 before the page. It is a
   fast-forward of the package's main today (e334c6e, 'Merge branch train5'): 15 commits of lanes sonic4, sonic5 and
   sound6 (quick path as the default, no front or behind in any lesson, the first wall knock within 12 s, the brake cue
   'Slow-down notes', Firefox's older listener setters). The commit is on no remote yet: it lives in sound6's package
   copy C:/dev/ShramkoSonicFPV, branch quick1 (and in this work copy's submodule); push from there.
2. The API files: server.py and tracks.py (lane edit4s E9): a create the store refuses (4xx) gives its hit back to the
   hour's count and counts in its own count of 60 refused bodies an hour; every 429 of /api/tracks carries Retry-After;
   creates per client and hour 10 -> 20. Upload both and restart the API (gsfpv-api) before the page; the page alone
   works with the old API too (without Retry-After its words name the hour's end). apps/api tests: test_tracks.py,
   test_tracks_edit.py (the gates' api-unittest PASS).
3. The page: one release of this head (apps/fly, the site, the generated catalogue). As in car 1 the build fetches
   MediaPipe's face model once (cached).
4. Rooms: no (nothing under apps/api/rooms changed).
5. nginx: no (deploy/nginx.conf unchanged since aa18f1e4; edit4s: the tracks location does not hide Retry-After,
   test_nginx_tracks.py).
6. Walls: no new walls (vox4 changes only how the voxels are drawn; the S2 build used the nine release walls).

Car 3 (what changed since car 2's head 267923c3: `git diff 267923c3 HEAD -- apps/api apps/rooms deploy packages/sonic-fpv`;
hot-sog3, merged from origin/main 852821e5, is already live: released on its own by the lead)

1. The sound package FIRST: its main must hold 719aaf5454ddb15677ad4dc090ac6faeab853e77 before the page. The package's
   main is 53a56759 today (car 2's pin); 719aaf54 is a fast-forward of it, 3 commits: gap-save 7f20f89f (the track
   validator judges a gate's sizes in flown metres by the course's scale), gap-sound 150ebac2 (the quick start for a
   returning pilot, the room names its four walls) and base7's join. It is on no remote: it lives in
   C:/dev/gsfpv-t7-base/packages/sonic-fpv branch t7-base (and in this work copy's submodule); push from there.
2. The API file: tracks.py (gap-save: sizes judged in flown metres, scale 0 < s <= 1000, else 1; a course at scale 1
   meets the numbers it met before). Upload it and restart the API (gsfpv-api) BEFORE the page: with the old API the
   server refuses a whoop course saved at Scene size x15. The old page with the new API is unchanged. Tests:
   apps/api/tests/test_tracks_sizes.py with its fixture (the gates' api-unittest PASS). server.py is unchanged.
3. The page: one release of this head (apps/fly with gen4a/gen4b's Generate dialog and planner, gap-gen's asked courses
   and its race-room adopt, gap-save's client validator, gap-sound's start screen; the site; the generated catalogue).
4. Rooms: no. apps/rooms and apps/api/rooms are unchanged (gap-gen: the course id is opaque to the rooms service; its
   race code is page code, and RACE_ON is still false).
5. nginx: no (deploy/nginx.conf unchanged since car 2).
6. Walls: no new walls (the S3 build used the nine release walls).

Car 5 (what changed since car 3's head 72d4babfbadf92075849a8e8d8234096dc8eeb8a: `git diff 72d4babf HEAD -- apps/api
apps/rooms deploy packages/sonic-fpv` gives deploy/live-checks.sh and the gitlink of packages/sonic-fpv only; no held lane,
no held gap lane, no re-baked walls)

1. The sound package FIRST: its main must hold 9ac7876dee42b8a874e51e6d46eb7cf8d70c3a48 before the page. The package's
   main is 719aaf54 today (car 3's pin); 9ac7876d is a fast-forward of it, 11 commits of lane tutor-moment (the moment
   contract and machine: a new sound in the first set stops the flight, is named, played alone, then the task is said;
   RunnerOptions.known and guide; the 'moment' and 'audible' actions; the first set's lessons reworded in four languages;
   the moment events in the session codec and the replay). It is on no remote: it lives in
   C:/dev/gsfpv-t8-tutor-moment/packages/sonic-fpv, branch tutor-moment (and in this work copy's submodule); push from
   there. The page uses the package's moment API (RunnerOptions.known, the 'moment' and 'audible' actions), so the
   package goes first.
2. The API files: none (apps/api unchanged since car 3's head).
3. The page: one release of this head (apps/fly with n-share's link order and one-button landing, tutor-say's start
   screen and say path, tutor-air's moments, card and G tour; the fly/sonic locales; packages/prefs doc.ts and keymap.ts;
   the site; the generated catalogue), built with packages/sonic-fpv at 9ac7876d.
4. Rooms: no (apps/rooms and apps/api/rooms unchanged).
5. nginx: no (deploy/nginx.conf unchanged since car 3's head).
6. Walls: no new walls (the S2 build used the nine release walls); deploy/release-walls.sh need not run.

## Live checks

Car 1. After the release and the nginx reload: `LIVE_ONLY=<names> bash deploy/live-checks.sh <outdir>` with the names
below; the whole file after that as usual.

New in deploy/live-checks.sh (read-only, each honours LIVE_ONLY, a failed probe exits non-zero and FAILs its line):
- site4-links: site4-links.mjs, every main button of the sound, home, scene and supporter pages (13 steps on the live site)
- edit4b-course-life: edit4b-probe.mjs on 70b50d42, render off, under the GPU lock (Save is never pressed)
- menu4-first-minute: menu4-first-minute-probe.mjs, the first visit's question and the short menus
- tails4-start-moved: tails4-review-start.mjs, the moved starts of 2f1ddf5f, d10c5638, ab5efa0e
- head4-camera-headers: two HEAD requests, /en/fly/ has camera=(self), /en/privacy/ camera=()
- head4-accept: head4-accept.mjs with the fake camera clip HEAD4_CLIP (default U:/Temp/gsfpv-train4/head4/head4-clip.mjpeg)

Existing names that cover what changed: accept-fly (head4's Shift+H and tails4's start touch the keys and the session),
edit-mouse-wroclaw and edit-mode-wroclaw (edit4b changed the top bar and removed key G in the editor), sonic-in-place-tunis
and sonic-course-wroclaw (head4's start-screen row and SonicSetup.head), mouse-free-probe (menu4's pause menu).

Left out on purpose: tails4-helper-download.mjs (it fakes a USB device and rewrites the helper's socket; the file already
leaves connect-probe.mjs out for the same reason; the lane proved it locally, S2 again on the release build: PASS).

Negative control before the release, on 833acb8f against the live site (release 89c9c86e, the code before train 4):
`LIVE_ONLY=site4-links,edit4b-course-life,menu4-first-minute,tails4-start-moved,head4-camera-headers,head4-accept bash
deploy/live-checks.sh U:/Temp/gsfpv-train4/int4/live-neg`: all six FAIL, LIVE CHECKS: FAIL, exit 1, each on the steps its
lane repairs (evidence/2026-11-19/int4-car1/live-neg.json): site4-links 12 of 12 steps fail; edit4b-course-life 10 of 12;
menu4-first-minute 10 of 15; tails4-start-moved 3 of 9 (the three spawnOverGround); head4-accept 10 of 12 (offLoadsNothing
and otherPageRefuses pass, as on the lane's own live control); head4-camera-headers: /en/fly/ has camera=() today.
The lanes' own runs on the release build of 4707f7d2 (S2) gave the PASS side of the same probes.

Car 2. After the sound package, the API restart and the page: `LIVE_ONLY=<names> bash deploy/live-checks.sh <outdir>`
with the names below (the hand-over's live_only), then the whole file as usual.

New in deploy/live-checks.sh (ee0f5348; read-only, each honours LIVE_ONLY through run(), a failed probe exits non-zero
and FAILs its line; each passed on the release build of 88ccd89e in S2):
- ux4a-messages: ux4a-messages-probe.mjs, render off (the report form is opened and closed, never sent)
- ux4b-cancel: ux4b-cancel-probe.mjs, drawn, in the GPU lock (a pick, Cancel, the cross, key N)
- vox4-voxels-only: vox4-probe.mjs with BENCH_UNCAPPED=1, drawn, in the GPU lock
- edit4a-gizmo: edit4a-probe.mjs on 70b50d42 at 1536x730, drawn, in the GPU lock (never Save, Send, Vote, Create)
- edit4c-warnings: edit4c-probe.mjs with COURSE=g1.1 and render off, in the GPU lock (the course stays in the page)
- edit4s-drafts: edit4s-probe.mjs with the https address (the probe aborts every request but GET to /api/; s7, s8 not
  run); judged: open, s1-s5, s9. s6 is left out: it needs the stored version's 201, which the probe refuses to send there.
  The judge tested on S2's local evidence: PASS when marked live, FAIL with s3 false, FAIL when not live.
- sound6-quick-walk: sonic-quick-walk.ts with SITE, render off (Chromium, then Firefox steps 1-4)

Car 1's two failed live checks, repaired in the check (the product was right; see Seams, Car 2, the last item):
edit4b-course-life (step 10-pointed) and edit-mouse-wroclaw (step d.controls); both PASS on the release build of
88ccd89e in S2 (logs9-final). They run again after the release (in live_only).

The negative control against the live site before the release (release ac11d2c2, car 1 and the sound page texts;
U:/Temp/gsfpv-train4/int4/live-neg2): the seven new checks FAIL (ux4a-messages, ux4b-cancel, vox4-voxels-only,
edit4a-gizmo, edit4c-warnings, edit4s-drafts, sound6-quick-walk: car 2's code is not live, so each one fires);
edit4b-course-life PASS (its repair holds on live); edit-mouse-wroclaw d.controls ok (its repair holds) but b.select
FAIL: the view after opening showed 1 gate of 12 and backing off found no other gate. The check, not the product: edit4a
never frames by itself (E1), the pilot's way to the whole course is Home. b.select now presses Home when no gate is a
candidate (36f69c8b, recorded as home); on the release build three plain runs PASS (home false) and one with the Home
path forced PASS (home true, gate 28 picked; logs12).

Existing names that cover what changed: accept-fly (B6-B16; B15's tamper now relative to the flip, 3b8bfd96),
head4-accept (step 5 clicks Quick start since sound6), edit-mode-wroclaw (edit4a's click and arrow), voxels-alone-wroclaw
and voxel-panel-wroclaw (vox4, ux4b's walls panel), sonic-in-place-tunis, sonic-course-wroclaw and narrator-off (sound6's
package), menu4-first-minute (ux4a's Messages item in the pause menu).

Left out on purpose: vox4-switch.mjs (it compares two scan switches' reveal times; over the live CDN the first switch warms
the cache for the second), edit4s's s6, s7, s8 (they store a course on the server).

Negative control before the release, against the live site (car 1's release aa18f1e4): see Status S3 (live-neg2).

Car 3. After the sound package, the API restart (tracks.py) and the page: `LIVE_ONLY=<names> bash deploy/live-checks.sh
<outdir>` with the names below (the hand-over's live_only), then the whole file as usual.

New in deploy/live-checks.sh (read-only, render off, no GPU lock; each honours LIVE_ONLY through run(), a failed probe
exits non-zero and FAILs its line; no save button is pressed, a generated course, the Scene size and the sound progress
live only in the probe's own browser profile):
- gen4-generate-dialog: gen4-accept-probe.mjs, Shift+G opens the Generate dialog, Build lays a course of that level
- gap-gen-asked-course: gap-gen-accept.mjs, asked courses on small and scaled scans (x15 at the skull) and a room's
  course adopted with the asker's level and spread (step 5)
- gap-sound-start: gap-sound-accept.mjs, Fly by Sound's start for a new and a returning pilot (Quick start first), the
  room's four walls
gap-save has no live check: every step of gap-save-accept.mjs stores a course (it refuses an https address).

Repaired in this car (the probes, not the product): gen4b's Shift+G and the pause menu's Generate open the Generate
dialog outside Fly by Sound (nothing is replaced before its Build), so the probes behind eight existing checks would wait
for a course that never comes after the release: course-path-wroclaw, gate-guide-wroclaw, mouse-free-probe (courseKey,
courseMenu), one-course, voxels-alone-wroclaw, voxel-panel-wroclaw, edit-mode-wroclaw (editor3-smoke.ts),
sonic-eye-course-wroclaw (sonic-int-review.ts with Z5_COURSE_FIRST). Each now presses the dialog's Build after the key
(tools/bench/scripts/gen-build.mjs; it waits 4 s for the dialog, so on a page without it, the live site today, the
probe goes on as before). Checks in the sound mode (sonic-*, narrator-off, onecourse's sound step) are unchanged: there
Shift+G still builds at once. Three more repairs after their first run on the build (89fa2351, 4c9b27ed): edit-mode-wroclaw
presses F when the selected gate is off screen; course-path-wroclaw (probe and cpband) judges an asked course by the
planner's stats (outside 0, underGround 0) and only prints the eye band; mouse-free-probe opens the pause menu's More
when Rooms is not shown.

Existing names that cover what changed: edit4b-course-life (step 13: Course > Generate, the dialog, Build), ux4a-messages
(gen4b's progress box and start line), edit4s-drafts (s9 presses Build), edit4a-gizmo and edit-mouse-wroclaw (genDialog),
sound6-quick-walk (gap-sound's start order), sonic-in-place-tunis, sonic-course-wroclaw, sonic-course-wroclaw-n and
narrator-off (the package moves), accept-fly (B6-B16), scans-open (hot-sog3, merged here).

The positive side on the release build of 8eac608d and the negative side against the live site: Status S3 (Car 3),
logs-car3s3 live-local and live-neg3 (the reruns: live-local2, live-local-cp1, live-local-cp2, live-site3).

live_only (int4-car3.json, one line): gen4-generate-dialog,gap-gen-asked-course,gap-sound-start,edit4b-course-life,
ux4a-messages,edit4s-drafts,edit4a-gizmo,edit-mouse-wroclaw,sound6-quick-walk,sonic-in-place-tunis,sonic-course-wroclaw,
sonic-course-wroclaw-n,narrator-off,accept-fly,scans-open,course-path-wroclaw,gate-guide-wroclaw,mouse-free-probe,
one-course,voxels-alone-wroclaw,voxel-panel-wroclaw,edit-mode-wroclaw,sonic-eye-course-wroclaw
edit4a-gizmo is in again: fix-gizmo13 (origin/main 13670b66, merged 5f85f7ad, probe only) repaired its step 13, and the
repaired check PASSES on car 3's build (logs-car3s3/live-local-gizmo). Left out on purpose: pause-rise-lublin (hot-sog3's,
lane fix-lod).

Car 5. After the sound package (9ac7876d on the package's main) and the page: `LIVE_ONLY=<names> bash
deploy/live-checks.sh <outdir>` with the names below (the hand-over's live_only), then the whole file as usual.

New in deploy/live-checks.sh (703ff41e; read-only, render off, no GPU lock, each in a new throwaway browser profile; each
honours LIVE_ONLY through run(), a failed probe exits non-zero and FAILs its line; the verdict is the probe's exit code):
- tutor-say-start: tutor-say-accept.mjs, the sound start screen (the title and Start flying said once, no list, no
  "Item n of N"; Tab says only "All lessons"), a step says only its task, K says the keys when asked, the Guide row is
  remembered over a reload (in the probe's own profile)
- tutor-air-first-flight: tutor-air-accept.mjs, the tutorial's first steps by the mouse (Start flying, the headphone
  check, moving within 60 s and under 60 words, the flight stops for the first sound's moment with one cue and the card,
  N goes on, G names the sounds one by one, the narrator off runs no moment)
- n-share-sound-link: n-share-accept.mjs with ROWS=sound, a sound flight's Share address opened in a new profile offers
  one main button that flies the same scene, course and way of flying (the probe aborts every request to /api/ but GET)

Positive side: the same three probes PASS on the release build of 9bebe9b1 (S2, logs-car5: n-share-accept,
tutor-say-accept, tutor-air-accept rc 0). Negative side against the live site before the release (release 72d4babf, car
3's head, sonic 719aaf5; U:/Temp/gsfpv-train4/int4/live-neg5): all three FAIL, each on the steps its lane changes:
tutor-say-start open, tab, steps, once, guide (the old screen reads the key list and "Full course ... Item 2 of 2", the
keys line on every step); tutor-air-first-flight move60 (109 s), words60 (143 words), freeze, card, onN, tour (start, ears,
guideOff pass: the old page has no moments to switch off); n-share-sound-link shareCarries (the old link has no course)
and landsOnScene (the old screen's Quick start, not one scan button).

Existing names that cover what changed: sonic-in-place-tunis, sonic-course-wroclaw, sonic-course-wroclaw-n, narrator-off
and sonic-eye-course-wroclaw (the package moves to 9ac7876d, the say path and the start screen), sonic-int-review-r9,
sound6-quick-walk and gap-sound-start (their probes repaired in S2 for Start flying, All lessons and the room's moments,
5793738f, 611af500: they would fail against the live site until the release), menu4-first-minute, tails4-start-moved and
head4-accept (the start screen's rows and buttons), accept-fly (B6-B16: the keymap's G and Shift+K, prefs doc.ts). All
of them PASS on the release build of 9bebe9b1 (S2, logs-car5/live-local, live-local2, live-local3).

live_only (int4-car5.json, one line): tutor-say-start,tutor-air-first-flight,n-share-sound-link,sonic-in-place-tunis,
sonic-course-wroclaw,sonic-course-wroclaw-n,narrator-off,sonic-eye-course-wroclaw,sonic-int-review-r9,sound6-quick-walk,
gap-sound-start,menu4-first-minute,tails4-start-moved,head4-accept,accept-fly
Left out on purpose: the stale lane harnesses no check runs (sonic-v13-page.ts, sonic-start-keyboard.ts,
sonic-review-keys.ts, sonic-int-review R10: see Seams).

## What the owner should try

Car 1, in the order of his messages (tails4: train 2's leftovers; menu4: brief line 373; head4: the head tracking plan;
site4: brief lines 533-536; edit4b: brief lines 541-556). No person, phone, camera or controller took part in any check.

1. The start of three scans (tails4). Open the scans 2f1ddf5f, d10c5638 and ab5efa0e: the drone stands about 1.5 m over
   the ground in the scan instead of hanging high in empty air. On the Controls screen, the helper's two download links
   save files that run.
2. The menu for new pilots (menu4). In a fresh browser profile (or after clearing the site's data) open the flight page:
   "Before you fly" asks "Have you flown FPV before?" with three answers. Click "Never. Keep it simple", answer the cookie
   question, click Keyboard, Start flying, click into the scene. Key P: 9 items and a line "More (18)"; click it, the rest
   opens. Click Settings: 11 rows and "Show all settings (67 more)"; type "uptilt" in the search: the camera uptilt row
   shows, marked "In the full menu". Later: Settings, Display, first row "Menu": Simple / Sim pilot / Everything. A pilot
   who visited before is never asked and keeps the full menus.
3. Turn my head to listen (head4). Headphones on, a web camera. Open /en/fly/?sonic=start, Settings, tick "Turn my head
   to listen": the voice explains first, then the browser asks for the camera: Allow. Start a lesson, face the screen,
   key Shift+H: "Centred." Turn your head: a sound ahead of the drone stays where it is in the room. Untick it: "Head
   tracking off. The camera is closed." and the camera's light goes out. Block instead of Allow: the voice says how to
   allow it by the icon left of the address.
4. The site's main buttons (site4). /en/sound/: the top menu's button says "Fly by Sound" and opens the Fly by Sound
   start; the same on /pl/, /es/, /ru/. On the phone /en/sound/ has a bar at the bottom with that button. The home page's
   Fly by Sound band has "Start Fly by Sound". A scene page (/en/scenes/39e63ce9/) or a supporter's page: the menu's
   button flies that scene. /en/sound/#sound-keys, "pl" in the menu: the Polish page at the same place.
5. The course's life in the editor (edit4b). A scan, Keyboard, click into the scene, take off, Shift+G, Shift+B. Every
   gate carries its number. Course on the top bar: New empty course, Delete all gates, Generate a new course, Overview,
   Courses, Keys. Delete all gates asks first; Yes, then Undo brings them back. New empty course: Add gate is on, two
   clicks on the floor give gates 1 and 2. Fly the course flies at once; the same button, Back to editing, returns. A
   refused Save that names a gate selects that gate, its number flashes 3 times, the view does not turn. Key G no longer
   makes a course in the editor (Course, Generate a new course does, with a question).

Car 2, in the order of his messages (sound6: brief lines 531-532; edit4a: 543-548; edit4s: 543-544, 549-550, 559-560;
edit4c: 545-546, 557-558, 561-562; ux4a: 555-556; ux4b and vox4: 565-566, vox4 also 577-578). No person, phone or
controller took part in any check.

1. Fly by Sound, the quick way (sound6). Headphones on, /en/fly/?sonic=start: the first button is "Quick start"; one
   click and the sound starts at once, the first wall knock comes within about 12 s. The headphone check asks only left
   and right (no "behind or in front"), and no lesson says front or behind. Back at the start: Continue, Quick start,
   then Full course (the long course for those who want it). In the glossary the brake cue is "Slow-down notes".
2. Moving around in the editor (edit4a). A scan, Keyboard, click into the scene, take off, Shift+G, Shift+B. A click on a
   gate selects it and the view stays still. Drag empty space: the view orbits; Shift+drag pans; the wheel moves towards
   the cursor. Home shows every gate, F frames the selected one, a double click frames another. One gizmo on the gate:
   the arrows move it, the rings turn it, the small boxes change its opening; Esc during a drag puts it back.
3. Saving (edit4s). Move a gate, then reload the page and open the editor: the course is back, the line says so with the
   time; the editor's window, Versions, lists it. Turn a gate the wrong way and Save: an offer of small corrections names
   that gate; "Correct and save" fixes and saves it. A refused save keeps the course as a draft and says when to try
   again; 20 new courses an hour now, and refused ones do not use them up.
4. Building the course (edit4c). Add opens a list: one gate, Double vertical, Triple horizontal and the others. A click
   between two gates far apart puts the new gate between them, facing their line; one Undo removes a whole group. Drag a
   gate towards the next one: a warning tag follows it; on release "Keep it here?": Put back, or Keep (the gate stays
   orange until it is fixed).
5. Messages (ux4a). Generate a course: the lines are large and stay long enough to read; a problem stays with a cross, a
   line saying what to do and "Send to the author" (opens the report form with the problem's text). The top row's
   Messages button (or Shift+J) lists the past lines.
6. Cancel a scan (ux4b). P, Change scan, pick a big scan: while it loads, Cancel stops it and the old scan flies on; pick
   another. On a phone held across the Cancel card is in view.
7. Voxels only (vox4). The walls chip, "Voxels only": the scan is gone completely (no frozen picture with holes), the
   voxels are shaded (tops lighter than sides) and far ones fade into the fog. On Lublin the panel says the walls near the
   drone are thin; "Over the scan" brings the scan back.

Car 3 (t7-base: gap-gen with gen4a and gen4b, gap-save, gap-sound; the owner's lines on the generator at his scene size,
saving at that size and the sound lesson). No person, phone, controller or headphones took part in any check.

1. Generate a course, the new way (gen4b). In flight press Shift+G (or P, then "Generate a course"): the flight pauses and
   a window asks Beginner / Medium / Pro and Compact / Whole scene, with each level's numbers. Build (or Enter) makes it;
   Cancel, the cross or Esc changes nothing. A box under the top row shows "Building the course", the step, a bar and the
   time left, with Cancel. Then "Gates: N. The start gate is ... m away: follow the arrow" stays about 8 s. The choice is
   remembered. In the editor, Course, Generate a new course: one question about unsaved changes (not two), then the same
   window; Build reopens the editor on the new course.
2. The generator at his size (gap-gen). Open /en/fly/?scene=5dfeb49b (the skull), click into the scene, P, drag Scene size
   to x15, "Generate a course", Beginner, Compact, Build: in a few seconds the course stands at the skull (gate 1 about
   7 m from it), no "enlarge the scene" text. The drone itself still stands where the scene puts it, about 800 m away at
   x15: follow the arrow (moving the drone to the course is not done yet, see Not verified). The same at x15 on the
   micro-greens (ab5efa0e): about 7 gates under the leaves. On Hallstatt (1994c65c) at x1, Pro and Whole scene: 24 gates.
3. Save at that size (gap-save). A scene, P, Drone, Meteor65 card's Fly; P, Scene size x15, P. Shift+B opens the editor
   (it makes a course first). Course, New empty course (or keep the generated one): Add gate, click into the scene for
   each gate; key Minus makes the selected gate smaller, down to 0.5 m. Open the editor's window, type a title and the
   name, Save (and "Correct and save" when offered): "Saved as your course: <title>, version 1". Before, a whoop course
   with 0.5 m gates at x15 was refused ("must be at least 0.05"). The new empty course now starts where the scene puts
   the drone and keeps the size he flies at (it kept the old course's start and size).
4. The sound lesson (gap-sound). Headphones on, /en/fly/?sonic=start: "Quick start" is first and already focused (Enter
   starts). The headphone check has only left and right. Sound settings show 6 rows and "Show all settings (12 more)".
   Quick start: "Sound 1 of 2" key 1, "Sound 2 of 2" key 2; about a minute later the small room names its walls (Wall,
   On your right, Ceiling, Floor), then "Fly to each wall and stop close to it without touching it", "Go." at about 2
   minutes. Leave and come back: Quick start is still first, "Continue: A small room" second.

Car 5 (n-share, tutor-say, tutor-moment, tutor-air: the tutorial is the first flight). No person, screen reader, phone,
controller or real ears took part in any check.

1. Open Fly by Sound with headphones on: https://gsfpv.flyreelstudio.eu/en/fly/?sonic=start (a new private window shows
   it as a new pilot does). Press the Down arrow once: the voice reads only the title and the main button ("Fly by Sound.
   Start flying ..."), then where the focus went ("All lessons"). No list of keys, no "Item 2 of 2".
2. Click Start flying. The headphone check asks left and right only: press 1, then 2. About half a minute after the click
   you are in the air in a small room ("... Go."). The box at the left shows one line, the step's task, no "Step 2 of 3".
3. Fly forward with key W. Near the wall the game stops by itself: the drone hangs still, every other sound goes quiet,
   the voice says "Wall: a wooden knock from a wall near you, faster as you get closer.", the knock plays alone, then
   one sentence on what to do. The screen shows the yellow word "Wall" and that sentence in large letters. The keys are
   named once (Z hears it again, N goes on, Shift+K "I know this"), not at every step. Key N: the flight goes on. Each
   new sound of the first lessons is introduced the same way the first time it appears.
4. Key K at any time says the keys, because you asked.
5. Press key G in any flight by sound ("What is this sound?"): the flight stops, "Sound 1 of 2: Wall." with the knock
   alone, then the next sound, "Back to the flight.", and you fly on.
6. The Guide setting: on the sound start screen, Settings, Guide: Full, Short (the default) or New sounds only. Choose New
   sounds only and reload: it is remembered. With the narrator off (Shift+V) no moment stops the flight.
7. Share by sound (n-share): open a scene with gates (/en/fly/?scene=887f27aa&course=g1.1), click into it, Escape, "Fly
   by Sound here", Escape, Share. Open the copied address in another browser: one green button "Fly this scan by sound";
   one click flies that scene with that course by sound. Known difference: the friend hears 24 gates in Tunis g1.1 where
   the sharer, who turned sound on over a laid course, had 36 (n-share's For the lead: which is right is your call).
8. Held lanes: none; car 5 carried every lane of its order.

Car 5, for the lead.
- The site's sound page (apps/site, another session) still describes "Quick start", "Full course" and the listening part
  as car 3 left them. After this car: the first button is "Start flying" (the lessons are "All lessons", then "Continue");
  the start screen reads only the title and Start flying; in the first lessons the game stops at each new sound
  ("moments": named, played alone, then the task; Z again, N on, Shift+K I know this); key G is "What is this sound?"
  (the sounds you hear now, one by one; the glossary stays in the lesson menu); a new setting Guide (Full, Short, New
  sounds only); the line of keys is said once, K says it when asked; the progress box shows one line, no counters.
- Three questions for the owner to send with the release link https://gsfpv.flyreelstudio.eu/en/fly/?sonic=start once
  car 5 is live (t8-plan Part D):
  1. To Dawid: "After 'Start flying', was anything read out that you did not need? Which words?"
  2. To Dawid and the Lodz testers: "When the game stopped and played a new sound, could you find that sound again in
     flight? Which one not?"
  3. To the testers: "Was any sentence too long or said twice? Where?"
- Open calls taken as t8-plan recommended (Part D): the narrator off is the guide off; moments only in the first set (the
  other lessons keep their intros); G is the tour, the glossary stays in the lesson menu; Guide defaults to Short.

## Not verified

Car 1
- No person, phone, real web camera or real controller took part: head tracking was proven with Chrome's fake camera
  playing a clip of a still portrait (head4), the phone steps at phone sizes in headless Chrome only.
- The seams with car 2 lanes (gen4b's Generate dialog in the editor, ux4a's message service, edit4a's drag to edit4c's
  warnings, sound6's rows beside head4's in the sound start screen, Shift+H in the spoken key help) are car 2's.
- site4's 'scene' step needs an API; S2 ran it nowhere (the local build had no API); the live check runs it after the
  release.
- The positive side of the six new live checks waits for the release; before it only their negative side ran (below).
- Found by menu4, not repaired (not car 1's files): at 1536x730 the pause panel's rows stand above the item list, so
  even the 9 items of level first start near the bottom of the view; on a first visit the cookie question lies over the
  lower middle of the page.
- tails4's open product questions: the SuperSplat tab's filters, the rooms nickname and the best laps stay per browser
  (no schema setting carries them in an exported file): a decision for the lead.
- head4: the .wasm under /fly/headtrack/ has no hash in its name but an immutable cache; a later MediaPipe version must
  move the folder (HEAD_ASSET_DIR), not overwrite the file.

Car 2
- gen4a and gen4b are car 3: the editor's Generate dialog (gen4b) and its options reaching the generator (gen4a) were
  not seams of this car.
- No person, phone, real controller or headphones took part; the phone steps at phone sizes in headless browsers only.
- The positive side of the seven new live checks waits for the release; before it only their negative side ran, and
  the edit4s-drafts judge on S2's local evidence. edit4s's stored save (s6, s7) and the refused-create rule (s8, E9)
  are proven only on a local API (S2 PASS) and by apps/api's unit tests, never on the live server (they store).
- The release candidate is HEAD; the S2 release build and its probes were of 88ccd89e. Since then only accept-fly.ts
  (B15's timing), deploy/live-checks.sh and docs changed; no app source.
- sound6-walk failed once on a loaded machine in Firefox (AudioContext still 'suspended' 2 s after the click); alone it
  passed in both browsers. A weak computer may start the sound late.
- For the lead, not repaired: the editor opens at the flight camera and nothing points to the course when it looks away
  (a hint 'Home shows the whole course' would help); vox4's voxel failure and ux4b's walls failure still say their
  problems in their panels' status lines, not through ux4a's message service.

Car 3
- No person, phone, real controller or headphones took part; no audio was judged (gap-sound's seconds use the measured
  en voice: 117.7 s against 120 s, little margin for a slower voice or another language).
- The probes ran with ?render=off where the picture is not judged; no course was flown through after Generate.
- At x15 the drone stays at the scene's spawn, about 800 m from the asked course (gap-gen, For the lead: the drone at the
  course's start pose is course.ts work, not done). At x100 on 70b50d42 nothing fits and the editor does not open on an
  empty course (gap-save-accept s100.emptySaved fails as gap-save's own Not verified says).
- gap-save's saving steps ran only against a local API (they store); the live API's stored courses were read by the
  gap-save review (GET only): none newly refused.
- Not repaired, for the editor's owners: the editor's 'This course has no start. Press G for a new course.' names key G,
  which does nothing in the editor since edit4b; gap-sound's keys line is said on every step (keysDue, proposal in
  gap-sound's For the lead); gap-gen's PlanAnswer.eased is not shown; generate.ts/editor.ts round gate sizes to 0.001
  scene units (a whoop's bar at x100 rounds to 0; gap-save's For the lead).
- Race rooms: the room's course adopted with the asker's level and spread is proven in Node and by gap-gen-accept step 5
  in one page; no two browsers raced (RACE_ON is still false).
- The eight repaired live-check probes were run on the release build of 8eac608d (Status S3), not yet against the live
  site with car 3's code: that is the release's live check. mouse-free-probe's rooms step cannot pass on a local release
  (no rooms service); it passed on the live site with the repaired probe.
- An asked course is not held to a person's eye band: on Wroclaw two of ten gates stood 2.5-2.9 m over the wall under
  them in one run, and 4.8 m and over a hole in another (gap-gen's zone loosens by tiers). The live check now judges it by
  the planner's own stats (nothing outside the scan, nothing under its ground); whether the owner wants street gates
  kept at eye height in an asked course is for gap-gen's owner.
- course-path-wroclaw fails on the live site today with the old generator (one gate of 37 at 2.2 m): not car 3's.

Car 5
- No person, no screen reader and no real ears took part: the spoken lines were spied in the page (speechSynthesis), the
  words counted, the sounds judged by the engine's plan, not heard. The testers and the author of the feedback (the three
  questions under What the owner should try) are the real check.
- The 60 s to the first movement and the 7 minutes of the first set hold on measured Windows voices (en: moving at about
  31 s, 51-58 words); a slower voice or Russian may be longer. Only English was walked in a page; es, pl, ru only by the
  package's words check (VL-4) and the locale gates.
- The probes ran with ?render=off but one drawn run (the moment card at 1536x730 and 844x390); no phone, no touch.
- n-share: the friend's sound flight lays 24 gates where the in-place sharer had 36 (Tunis g1.1); the Share panel still
  uploads a picture a course link does not use; "Save and share" needs a hook from the course feature. Not changed.
- Not repaired, for their owners: the headphone trial still says "Sound 2 of 2." (the package's line; the screen no longer
  shows it); the flight region takes the focus only after a pause ends (tutor-say's For the lead: focusFlight when a
  lesson opens); sonic-v13-page.ts, sonic-start-keyboard.ts and sonic-review-keys.ts
  (lane probes, none in deploy/live-checks.sh) still name the old buttons (sonic-start-full, "Full course").
- The three new live checks' positive side ran on the release build of 9bebe9b1 (S2); against the live site with car 5's
  code they run after the release (live_only).

## Cost notes

- S1 (car 1): about 20 replies; the most went to deciding whether gen4b stands without gen4a (its status file and the
  plan.ts stub). Cheaper: a one-line 'needs: <lane>' field in each lane's status head, and gate B18 writing its evidence
  under the lane's own folder so that every merge does not meet the same add/add conflict in b-repo-b18.json.
- S2 (car 1): about 25 replies; the most went to the vitest gate failing on four server-start tests because the release
  build ran beside it. Cheaper: run the build after the gates, never at the same time; and give each probe a common
  JSON verdict shape (pass, steps[]) so one line reads them all.
- S3 (car 1): about 25 replies; the most went to collecting each probe's arguments and read-only claim from its header and
  to reading four verdict shapes (steps as an array, as a map of PASS/FAIL, with or without pass). Cheaper: each lane
  writing its live check as the ready live-checks.sh line in 'For the lead', and the common verdict shape noted for S2.

- S1 (car 2, resumed run): 12 replies; most went to the sound6 merge's package pin, whose commit existed only in sound6's
  copy (fetched from there). Cheaper: the lane writing its package head and where it lives into 'For the lead'.
- S2 (car 2, run of 2026-11-20 noon): about 40 calls for two findings (ux4a step 6, edit4b step 1); the most went to finding why each failed only sometimes, because the probes recorded the verdict but not the state behind it. Cheaper: each probe's failing step carries the page state it judged (here the top row's timeline, the numbers hook), as both now do.
- S2 (car 2, run of 2026-11-20 evening): 20 calls; the most went to B15 failing twice at an absolute tick that a slow
  start on a loaded machine moved into idle throttle. Cheaper: checks that tamper or judge at a moment of the flight
  (relative to an event they record) instead of an absolute tick.
- S3 (car 2, run of 2026-11-21): about 25 calls; most went to a live check that failed on a view (no gate on screen)
  and its proof on the release build. Cheaper: probes that click something in the 3D view first bring it into view the
  pilot's way (Home), in one shared helper, so a new framing rule does not break them one by one.
- S1 (car 3): about 10 calls; a clean merge since base7 settled the conflicts once on base_of. Cheaper: nothing to
  gain; the one branch per car is the saving.
- S2 (car 3), last run: about 20 calls; two gate runs were lost because this shell's PATH has neither `python` (only
  the py launcher) nor Node 22 first (vitest's rolldown needs node:util styleText). Cheaper: gates.py should find
  Python itself (sys.executable) as it already finds ~/node-v22; run single tests with ~/node-v22 on PATH.
- S3 (car 3), last run: about 45 calls; most went to three live checks that failed on the build for three different
  reasons (an editor that frames nothing, a generator with a new height rule, a menu item under More) and to a check
  line in live-checks.sh that repeated its probe's judge (cpband), so the probe's repair did not reach it. Cheaper: a
  live check should take its probe's exit code as its verdict (one judge, not two), and a lane that changes a rule
  (gap-gen's heights, menu4's levels, edit4a's framing) should grep deploy/live-checks.sh and tools/bench for the old rule.
- Car 5 S1 (12 calls): four clean merges; the one slip was merging tutor-moment before fetching its package head (the gitlink was right, the checkout lagged until git submodule update). Cheaper: fetch the package head before the merge that moves the pin, as the header says.
- Car 5 S2 (~50 calls): the most turns went to three sound probes out of date after the tutorial lanes (two reruns: the
  room's first moment needs the craft to fly to a wall). Cheaper: a lane that changes the start order or a lesson's intro
  greps deploy/live-checks.sh's probes for the old testids and lines and runs those probes itself (tutor-say listed them).
- Car 5 S3 (two runs, ~25 calls): the first run ended after the checks and the negative control without writing the Live
  checks part, so the second re-read the logs to rebuild it. Cheaper: write each status part in the same commit as the
  run that proves it (the negative control's summary straight into Live checks), not at the end.
- Car 6 S1 (~10 calls): two clean merges; the most turns went to reading the long status file to find the Car 5 parts.
  Cheaper: a grep for '^Car ' gives every part's line at once; read only the last car's slice.
- Car 6 S2 (~40 calls): the most went to the shell (Node 20 on PATH broke vitest; no python until the PATH line of the
  common file) and to the w1-anchor probe's 10 m line on a random seed. Cheaper: start every command with the common
  file's PATH line; run a random-seed probe three times before judging its threshold.
