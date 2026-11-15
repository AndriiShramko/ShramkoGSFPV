# Train 3: lead note

Source: the owner's message 51 (2026-11-14) after he flew release 4e9148cd1005 (main f91273cf). His points: progress of the walls build and of the course generation; gates spread over the well-scanned extent at eye level; the course tied to the respawn; a course editor like ordinary 3D editors inside the same scene; the laptop agent's branches and weak computers; Fly by Sound in any scene; the consultant's advice; fast flight by sound.

## Status

- [x] Wave 1 (night of 2026-11-14): lanes editor3, course3, sonic3 built their code; one review each; fixes started. No lane finished its browser proof (the GPU lock was held for 24 minutes around a Node audit; the walls build of Wroclaw holds the page's main thread for 13.5 s, 10 s and up to 21 s).
- [x] Wave 2 (2026-11-15, 00:36 to 04:16 UTC), three chains. course3f finished all four stages; laptop3 is accepted (a big scan from above at 0.5 to 1 M is still smeared in the near part); hearing: the design document docs/wip/sonic-headtrack-plan.md on branch sonic3; editor3f and sonic3f did not finish their browser proofs because the proofs found real faults (the gate bar hides after a drag, a second Space does not disarm, a gate added by a floor click stands behind the camera; no course by sound on a real scan was ever counted as passed: the earlier 'passed' rows were lessons that moved on after a failure).
- [x] Integration A (course3 and laptop3): main ca5760fd, live since 2026-11-15 05:48 UTC as release a1c494cdd368; deploy/live-checks.sh 15 of 15 PASS (U:/Temp/gsfpv-train3/live-ca5760fd). Section 'Integration A' below.
- [x] Wave 3 (2026-11-15, 04:16 to 07:28 UTC): lanes editor3g (C:/dev/gsfpv-voice, branch editor3) and sonic3g (C:/dev/gsfpv-center-throttle, branch sonic3), three narrow stages each with up to three passes. sonic3 is ready: the ear pilot flies a course made by N to its end with a counted pass on Wroclaw, Tunis and Housefly at 5 m/s; the switch in place keeps the speed; speed lessons and the lesson turn-listen. editor3 works on Wroclaw (handles, bar, kinds, copy, delete, undo, a gate by a floor click, the pad's test flight, Save) and has faults on Tunis (Save refused, turn rings, no click target), an unreadable Size tool and the flight's windows over the edit view.
- [x] Integration B (sonic3 with the sound package): main a7f39528, package b05aeda, live since 2026-11-15 08:45 UTC as release 6ee5c711d7d3. Section 'Integration B (sonic3)' below; the live checks and the repair of the probe's flight on Tunis are in STATE.md, first bullet.
- [~] Wave 4 (from 2026-11-15 07:28 UTC): lane fix3a (C:/dev/gsfpv-rooms, branch fix3a from main ca5760fd: the walls store, the guide to the next gate, gate 1 nearest to the scan's spawn; status docs/wip/fix3a.md); lane editor3h (C:/dev/gsfpv-voice, branch editor3: Tunis, the Size tool, the flight's windows hidden in the edit mode, the whole owner's path once more); lane laptop4 (C:/dev/gsfpv-site-sound, branch laptop4 from main a7f39528: a big scan from above at 0.5 to 1 M), started 09:10 UTC when integration B freed a slot.
- [~] Lane editor3h ended 2026-11-15 10:05 UTC with no stage finished (branch editor3 at e4639107): the handles are larger than the gate, two turn rings are edge-on and give no turn, parts of the flight stay in the edit view, the keyboard test flight does not leave the ground, Save on Tunis is refused on the start leg (generator and check: lane fix3a's follow-up). The lead looked at editor3-size-1920.png and editor3-turn-1920.png and wrote decisions D1 to D8 into lane editor3i (framing of the selected gate, handles as in ordinary 3D editors, the selected gate marked, edge-on rings can be taken, the flight's parts out of the edit view, the top bar's line, the phone, the keyboard test flight). Lane editor3i runs from 10:10 UTC (workflow run wf_584b0c34-376), three stages I1-gizmo, I2-clean, I3-prove, one review.
- [x] Lane fix3a finished 2026-11-15 about 10:13 UTC (branch fix3a at 8b58340b in C:/dev/gsfpv-rooms, not merged): the walls store write starts before the walls go in use and the walls line says 'keeping' and 'not kept'; the guide chip at the screen edge ('Gate 1 . 17 m' with an arrow; the lead looked at fix3a-gate1-tunis.png and fix3a-gate1-behind.png); a closed ring starts at the gate next to the spawn where the check allows it (1 of 33 rings; the guide leads on the others); review FX-1 to FX-5 fixed; tracks-page 46 of 46. Cost note of the lane: 38 minutes waiting for the GPU lock.
- [~] Lane fix3b (the same worktree and branch, from 10:13 UTC): a generated course passes the Save check untouched by construction (Tunis: every gate 1 refused on the start leg in the page), gates out of foliage (Tunis palm crowns), proof on Tunis and Wroclaw; stages Y1-save-check, Y2-free-gates, Y3-prove, one review.
- [ ] Integration C (fix3a, editor3, laptop4 if ready), then the third release by the lead. The workflow script holds INTEGRATIONS.train3c (a copy of train3b; the sound package step is done).
- [x] Published walls of the nine catalogue scans are live since 2026-11-15: lighter re-bakes assembled by the lead in U:/Temp/gsfpv-train3/walls/release (148,581,855 bytes with the .gz copies; Wroclaw 17,615,280 raw and 9,670,306 gzip at 10 cm); deploy/release-walls.sh copies the .gz and checks the hub's free room first (7.1 GB free before the upload). Local pre-check and the live page probe: all nine pass (source published, no build, 20 passes at 25 m/s stop at the walls). The walls-published-probe of deploy/live-checks.sh passes from now on.
- [ ] Lane menu (R29): moved to the next train; it touches the entry points that the sound and editor lanes change now. Parked branch menu in C:/dev/gsfpv-tracks.

## Branches after wave 1

| Lane | Worktree | Head | Status file |
|---|---|---|---|
| editor3 | C:/dev/gsfpv-voice | bb670ead | docs/wip/editor3.md |
| course3 | C:/dev/gsfpv-rooms | ec64aa44 | docs/wip/course3.md |
| sonic3 | C:/dev/gsfpv-center-throttle | 2065b16d (package branch train3, 2e1618f) | docs/wip/sonic3.md, docs/wip/sonic3-plan.md |
| laptop3 (wave 2) | C:/dev/gsfpv-site-sound | from origin/main, squash of origin/laptop-handoff | docs/wip/laptop3.md |

## Decisions of the lead

- The walls bake leaves the main thread (a worker, or slices where a call cannot move); the walls box always carries a sign of life that the compositor runs.
- The edit mode shows one set of handles at a time (Move, Turn, Size); the side window with the keys is closed when the mode opens.
- Races in rooms keep restarting with every life; they are switched off in the product (RACE_ON false).
- The sound package: lanes do not push; the integration merges the package's branch train3 into its main, pushes it and moves the pin.
- The laptop branch: the second exception to the rule of the public engine API in packages/render-pc is accepted (the view rule switches itself off when the engine's members are missing; the engine's version is pinned). The graphics note stays as the owner set it on the laptop. The branch comes in as one squash commit, as its hand-off file asks.
- Published walls: Wroclaw and University of Opole at 10 cm, ba7aa29d and 0230d903 at 20 cm, eb5f51dc and 1994c65c at 40 cm, Lublin 2f1ddf5f stays at 20 cm (its 40 cm bake failed with a GPU error), Forest Floor and Housefly at 5 cm.

## Cost

Wave 1, window 2026-11-14 20:30 to 2026-11-15 00:36 UTC: 89 USD at API prices; 31 workflow agents 68.9 USD (context up to 158 k each), the lead 20.5 USD in 28 steps at a context of up to 624 k.
Wave 2, window 2026-11-15 00:36 to 04:16 UTC: 99 USD at API prices; 21 workflow agents 85.2 USD (997 calls, 47 per agent on average, context up to 389 k), the lead 13.6 USD in 33 steps. 71 % of the cost fell on calls at a context of 150 to 300 k: the line 'at most 30 replies per stage' in a prompt does not hold; a stage's budget is set by the size of its task.
Wave 3, window 2026-11-15 04:16 to 07:28 UTC: 65 USD at API prices; workflow agents 55.2 USD on 1040 calls (0.053 USD a call against 0.085 in wave 2; no agent context over 150 k), the lead 9.9 USD in 52 steps. What changed: a stage is one or two named points in a given order, up to three passes by a fresh agent per stage, runs with rendering off take no GPU lock.

## Integration A (course3 and laptop3)

Status (worker 1 stopped at its step budget; a fresh worker continues from here):
- [x] origin/main had not moved (1de775ed). Submodule packages/sonic-fpv at 598a98f9 (main's pin).
- [x] Merged with --no-ff: course3 18e6a876 (b3c9f9cb), laptop3 17a448bf (2a6310a5). No conflicts. D91 is laptop3's only
  decision number; course3 took none: no renumbering.
- [x] Seams a and b (595bdac0): fly.css `.bake-status:not(:empty)` carries the note backdrop; ui/top-row.ts `noteCrowded`
  puts the HUD note under the walls box while the box shows a line. Tests in tools/bench/test/flight-ux.test.ts (44 of 44
  pass), negative control NEG OK (both new tests fail on origin/main's fly.css and top-row.ts).
- [x] Gates once on b3c9f9cb..595bdac0 merged tree: gates.py exit 0, 'B18 PASS' 1 line (log U:/Temp/gsfpv-train3/integA/gates.log).
- [x] Release build (exit 0) and the nine published walls copied into dist/walls.
- [x] Probes: U:/Temp/gsfpv-train3/integA/run2.sh and run3.sh, summary2.txt (one line per probe with its exit code).
- [x] deploy/live-checks.sh: lod-view on and off on 2f1ddf5f and 70b50d42 and course-path-probe on Wroclaw, not run. Field
  names checked against train3a-lub-on.json (view active true, failed null, missing [], calls 112) and train3a-lub-off.json
  (active false, calls 0, engine lodBehindPenalty 5, lodUpdateAngle 90, lodMultiplier 3): all present.
- [x] Probe JSON in evidence/2026-11-15/train3a/ (23 files) and evidence/2026-11-15/lod-view/*train3a*.json; no JPG or PNG.

Gates: gates.py exit 0, 'B18 PASS' 1 line, on the merged tree with seams a and b (before the evidence commit).

Probes (local release of 595bdac0 code, nine published walls in dist/walls, server 5760; exit codes from summary2.txt):
- accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16: exit 0, 10 of 10; first line 'accept-fly target: http://localhost:5760'.
- course-path-probe: Wroclaw build in the browser exit 0, Wroclaw published exit 0, Tunis exit 0 (numbers under Measured).
- walls-published-probe, nine scans: exit 0, 9 pass, ready 3.3 to 12.6 s, no 404.
- governor-start-probe (in one lock hold): exit 0, all=true (weak starts at the remembered step 4, strong at the top).
- lod-view-probe Lublin 2f1ddf5f at 1 M, rule on and viewlod=0, reference 16 M; lod-view-score exit 0. PSNR over the scan,
  off / on: after the spin 18.41 / 19.97 dB, yaw 185 19.01 / 21.12, yaw 95 18.33 / 19.72, pitch down 18.58 / 20.13; from
  above about equal (up140 19.47 / 19.43, up40 19.77 / 20.14); pitch up worse with the rule (26.05 / 23.08).
- sonic-int-review r9: exit 0, 11 of 11 (Fly by Sound works after the walls and renderer changes).
- rooms-two-page exit 0; centre-throttle-probe all exit 0; hid-source-probe exit 0; wizard-auto-check exit 0;
  tools/bench/test/a6-reference.test.ts 1 passed (hash unchanged).
- mouse-free-probe: exit 1, 78 PASS, 0 FAIL, then the timeout in the rooms entry (pause.rooms not visible): the same
  failure as train 2b (train2b-lead.md, a local release has no rooms service); not a seam of this train.
- tracks-page: exit 1, 44 of 46. FAIL 'A look (link seed 1, 24 gates)': the course is loaded (HUD 'Gate 1 of 24') but
  no gate is in the spawn view of Tunis (next 0 px, later 11 against 8 px). FAIL 'E camera: after Tab the camera looks at
  the newly selected gate' (px under the minimum). Both passed in train 2b; the cause is course3's new generator (the
  seed-1 course of g1.1 now lies outside the start view), not a seam between the lanes. Picture looked at:
  U:/Temp/gsfpv-tracks-page/2026-11-15/a-seed1-on.png. Not chased (see Not verified).
- Walls store (run3.sh, server 5762, Wroclaw folder out of dist/walls): the worker build finished in 220.2 s (state
  in-use, source bake); after a reload and in a fresh page of the same profile the walls did NOT come from the cache:
  state 'offer', source 'none' after 62 s in both. dist/walls has 9 folders again.

Measured so far:
- Wroclaw 70b50d42 with its folder out of dist/walls (course-path-probe, NOBOT=1 REGEN=1): walls built in the worker,
  read 95.8 s, voxelize 44.8 s, total 140.6 s, 5 cm level 2; gates drawn 153 s after Shift+G; the shown text never stood
  still longer than 2.0 s; the page answered the probe within 1.6 s; one long task, 268 ms. One regeneration: 24 gates,
  149.7 m.
- Wroclaw with the published walls: gates 6.1 s after Shift+G, 24 gates; regenerations 24/207.2 m, 24/82.0 m, 24/175.8 m
  (one of three much smaller, as course3's Left 5 saw on built walls). Tunis 887f27aa: 7.0 s, 24 gates; regenerations
  24/97.8, 24/97.0, 24/97.0 m. Crash with respawn: kind 'rewind', next gate 3 before the crash in both.
- Pictures looked at: U:/Temp/gsfpv-train3/shots/train3a-walls-line.png (the walls line "reading the scan. Step 2 of 3,
  19 %" on its dark backdrop over the sky, readable), U:/Temp/gsfpv-train3/shots/train3a-course-start.png (the end line
  "Walls built in 141 s ..." in the box and the course note "finding the free space. Step 1 of 2, 11 %" under it, no
  overlap).

Deploy order for the lead (git diff --stat f91273cf..HEAD): deploy/nginx.conf and deploy/compose.yml unchanged: nginx no.
apps/api: only tests/fixtures/tracks/valid-generated-quality.json (a test fixture): no release-api.sh, no --locales (the
changed locales are fly/course, fly/gpuhint and fly/sonic, built into the static site). apps/rooms unchanged: rooms no.
Static ship only; the published walls are already live.

Live checks: deploy/live-checks.sh gained lod-view on and off on 2f1ddf5f and 70b50d42 (read only: the probe opens the
page, turns and reads lod()) and course-path-probe on Wroclaw (the course is generated in the page and never saved). The
editor's Save and the votes stay out. Not run.

Pictures for the lead:
- U:/Temp/gsfpv-train3/shots/train3a-walls-line.png (walls line over the sky, looked at: readable)
- U:/Temp/gsfpv-train3/shots/train3a-course-start.png (course note under the walls box, looked at: no overlap)
- U:/Temp/gsfpv-tracks-page/2026-11-15/a-seed1-on.png (the seed-1 course: no gate in the spawn view)
- C:/dev/gsfpv-v03/evidence/2026-11-15/lod-view/train3a-lub-on-turn-yaw185-end.jpg and train3a-lub-off-turn-yaw185-end.jpg
  (not in git; the rule on and off after a turn)

What the owner should try:
- Open a catalogue scan: the walls come by download; a line says what happens.
- Open a scan outside the catalogue: the walls build without freezing the page; the line shows the step, the share and
  the time left (on Wroclaw this took about 2.5 to 3.5 minutes here).
- Wroclaw, press Shift+G: a course in a few seconds with its progress line; gates along the streets at eye level.
  Press Shift+G again: a course of the same size (24 gates).
- Crash, then respawn (R): the course goes on from the gate you reached.
- Weak computer: the picture after turns and in streets is sharper (about 1 to 2 dB in our measure). Not yet: a big scan
  from above at 0.5 to 1 million splats, the near part is still smeared (a separate lane works on it).

Not verified (so far):
- Lane laptop3's 13 localStorage keys that packages/prefs/test/migrate.test.ts cannot see (its scan reads one-part keys):
  gsfpv.hint.macro (app/macro-hint.ts), gsfpv.tour.probe (app/tour.ts), gsfpv.course.best and gsfpv.course.offered
  (course/link.ts), gsfpv.course.voter, gsfpv.course.votes and gsfpv.course.tokens (course/store.ts), gsfpv.rooms.nick
  (rooms/nick.ts), gsfpv.hint.gpu, gsfpv.hint.soft and gsfpv.hint.said (sonic/gpu-hint.ts), gsfpv.sonicrec.profile
  (sonic-session/consent.ts), gsfpv.rooms.host.* (builtin/rooms.ts, sessionStorage). For the next train.
- Course size (lead decision 1): COURSE_DEFAULTS.gatesMax stays 24; 24 gates cover about 180 to 210 m of street
  (course3 F3 pass 2); more gates on big scans is an open product question for the next train.
- course3 Left 4: the pilot's rewind went back 12.9 s instead of respawn.rewindS (the course followed it correctly).
  course3 Left 5: on walls built in the browser one regeneration of four spanned 103.8 m against 171 to 198 m.
- Forest Floor ab5efa0e (lead decision 3): course-path-probe has no record of each life's director decision (no STEPS
  switch); not run, cause not named.
- The lane laptop3 merge brings changes to packages/i18n/locales/fly/gpuhint/* and the GPU hint files of the laptop agent
  (its squash); this integration did not edit them.
- Probes ran while the gates ran (CPU shared): the timing numbers of cp-build may be longer than on a quiet PC.
- Walls store: walls built by the worker are not read back from IndexedDB after a reload or in a fresh page (state
  offer, source none after 62 s; evidence/2026-11-15/train3a/walls-cache-70b50d42.json). Cause not found
  (apps/fly/src/walls.ts and wallcache.ts); a pilot on a scan outside the catalogue rebuilds the walls on every visit.
- tracks-page A look and E camera (above): the probe's seed-1 view or the generator's start point needs a decision of
  the lead; not chased.
- mouse-free rooms entry on a local release without a rooms service: still not checked (since train 2b).
- Forest Floor ab5efa0e: STEPS=forest not run (no per-life record in course-path-probe).

Cost notes: worker 1 spent its turns on finding each probe's arguments (one probe at a time) and on blocking waits of
10 minutes that hit the tool's limit; a table of probe command lines in docs/agent-map.md would have saved about 8 turns.
Worker 2 spent most turns waiting on run2 and run3 in 10-minute blocks and on reading the two failed probes; one waiter
script that prints a short result table at its end would have saved about 5 turns.

## Integration B (sonic3)

### Merged
- sonic3 head 2cea7293 as eccb1f34 (--no-ff, no conflicts; git merged fly/sonic locales and sonic-int-lazy.test.ts by
  itself). It can not make the live site worse: Fly by Sound is opt-in (Backslash or the pause item); the parts that
  did not pass below are runs of the ear pilot, not faults of the ordinary flight.
- Sound package: branch train3 0af508a merged into the package main as 7c27300 (--no-ff), package suite 69 files passed
  (1 skipped), 1349 tests passed (4 skipped); pushed. The typecheck gate then found 3 errors in package tests under
  tsconfig.node.json (test/gate-aim.test.ts material 'gate', test/speed-ladder.test.ts maxSpeedMps possibly null; the
  lane had not run that config): fixed on train3 as 57a108d (types only, the two files 11 of 11, package tsc 0), merged
  into the package main as b05aeda, pushed. The negative control is the first gate run (typecheck FAIL on 7c27300).
  Pin: ada88fe0 (7c27300), then cf61115b (b05aeda, on the pushed package main). The two evidence files of the package
  worktree are left uncommitted.
- c40cb85d: gen-catalog after the merge (31 shortcut keys; README.md, llms.txt, docs/settings.md, features.json, site ru).
- e7f71d92: two read-only sound checks in deploy/live-checks.sh (below).
- Seams: the course seams (a) belong to the held lanes; apps/fly/src/session and packages/sim-core unchanged by sonic3,
  a6-reference 1 of 1 PASS (hash held); locales: i18n gate PASS; docs/decisions.md not touched by sonic3.

### Held back
- fix3a, editor3, laptop4 (the brief): not merged, not read. Left out with them: the editor chain, walls-store-probe,
  the guide to gate 1, lod-view-probe and lod-view-score, and their pictures.

### Gates
- Full run on ada88fe0 (U:/Temp/gsfpv-gates-20261115-083241): vitest PASS 140 s, api-unittest PASS 245 s, architecture,
  i18n PASS, B18 PASS; typecheck FAIL (package tests, fixed above), catalog FAIL (stale, regenerated above).
- After the fixes, gates.py --only typecheck,catalog,b18 on cf61115b: all PASS (U:/Temp/gsfpv-train3/train3b/gates2.log).

### Probes
Release ada88fe0 (sonic 7c27300, built 07:32 UTC) with the nine published walls in dist/walls, http://localhost:5760/en.
The head after it differs by the catalog files, the package test types and docs only (not rebuilt). Summary
U:/Temp/gsfpv-train3/train3b/summary.txt; evidence evidence/2026-11-15/train3b/.

| Probe | Result |
|---|---|
| accept-fly B6 B7 B9..B16 (first line: target http://localhost:5760) | 10 of 10 PASS |
| sonic r11 Wroclaw 70b50d42, 5 m/s, render ON | 10 of 10: on 7.02 -> 7.84 m/s, 0 lives; N to gate 1 25.4 s; 24 gates COUNTED, 0 misses, 120 s, median 3.77 m/s; off 5.13 -> 5.13 |
| sonic r11 Tunis 887f27aa, 5 m/s, render off | 10 of 10: on 1.64 -> 2.76, 0 lives; N 29.4 s; COUNTED, 1 miss, 193 s, median 3.9 m/s; off 5.13 -> 5.13 |
| sonic r11 Tunis 887f27aa, 5 m/s, render ON | 9 of 10: on 3.58 -> 5.1, 0 lives; N 25.4 s; not counted: 13 gates in the 300 s cap, 1 miss, still flying, median 2.2 m/s |
| sonic r11 Housefly d10c5638, 5 m/s, render off | 9 of 10: on 7.0 -> 7.75, 0 lives; N 47.5 s; not counted: 3 misses, moved on after 4 gates (79 s); off 5.25 -> 5.25 |
| sonic r12 speed-1..4, turn-listen | 11 of 11: speed-1..4 counted on attempt 1 (median 1.49, 2.5, 3.52, 4.48 m/s); turn-listen counted on attempt 3 |
| sonic-int-review r9 | 11 of 11 |
| lesson list (lessons-shot.mjs, U:/Temp/gsfpv-train3/train3b) | 34 lesson buttons, speed-1..4 and turn-listen present, 0 page errors |
| course-path-probe Wroclaw / Tunis | PASS / PASS (course at 5.5 s / 9.6 s, 24 gates each, no bake) |
| walls-published-probe | 9 of 9 |
| governor-start-probe | PASS |
| centre-throttle-probe all | PASS |
| hid-source-probe | exit 0 |
| wizard-auto-check | exit 0 |
| rooms-two-page | PASS |
| mouse-free-probe | FAIL: timeout on [data-action="pause.rooms"] (no rooms service locally; the same failure sonic3 S3 item 3 had on origin/main and on its dist) |
| tracks-page | 44 of 46 (A look, E camera; integration A had the same 44 of 46) |
| a6-reference | 1 of 1 PASS |

The two new live checks, their own function text, run against this release (port 5775, render off):
sonic-in-place-tunis PASS (r11 quick 8 of 8, 28 s), sonic-course-wroclaw PASS (both named checks; 8 of 10 overall, the
flight is cut at 60 s by design; 120 s). U:/Temp/gsfpv-train3/train3b/livecheck-local/.

### Deploy order for the lead
- git diff --stat ca5760fd..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api apps/rooms packages/i18n/locales:
  13 files, all locales (fly/keys, fly/sonic, fly/sonicentry in four languages, site/ru.json). They ship in the static
  release.
- nginx: no. API: no files, release-api.sh not needed, --locales not needed. Rooms: no. Walls: nothing new.
- Ship the static release of main as for integration A, then bash deploy/live-checks.sh <outdir> (two checks more:
  sonic-in-place-tunis, sonic-course-wroclaw; rendering off, no GPU lock, about 3 minutes together).

### Live checks
- sonic-in-place-tunis: r11 with Z5_QUICK=1 on Tunis: Backslash gives the free flight by sound, no new life, speed kept.
- sonic-course-wroclaw: r11 on Wroclaw with a 60 s flight: N makes a course and gate 1 is the hum's target.
- Read for both: r11 presses only flight keys (Enter on the Controls screen's keyboard choice, W, Q or E, Backslash, N,
  Space, arrows); the sound mode fetches only static track and walls files; nothing is sent or saved.

### Pictures for the lead
- U:/Temp/gsfpv-train3/shots/train3b-sound-lessons.png: the lesson list, Hover with "Turn a little and listen" (7 of 33),
  Rings with Speed 1 to Speed 4 (26 to 29 of 33).
- U:/Temp/gsfpv-train3/shots/train3b-sound-wroclaw.png: Wroclaw street drawn, "Stage 24 passed", "New best time: 1
  minute 56 seconds", Counted 1 of 1.

### What the owner should try
- Wroclaw from the catalogue: fly as always, press Backslash: Fly by Sound switches on, the craft keeps its speed.
- Press N: in about 25 s the hum of gate 1; turn with Q and E until the hum is in the middle, fly with W; 24 gates.
- Backslash again: Fly by Sound switches off, speed kept.
- Tunis: the same keys; with the picture switched off (render off) a course counted at up to 5 m/s.
- Escape, "Fly by Sound lessons": "Turn a little and listen" (lesson 7) and Speed 1 to Speed 4 (lessons 26 to 29).

### Not verified
- Housefly d10c5638 on this build: not counted (3 misses, moved on after 4 gates); the lane counted it at 5 m/s on an
  earlier build (S2). N to gate 1 took 47.5 s (lane: 60 to 125 s).
- Tunis with rendering on: 13 gates in the 300 s cap, not counted (the lane did not run it).
- The budget's open-way chime has no offline audio proof (lane LEFT 1).
- HUD altitude below zero after landing at the course end: -0.1 m in train3b-sound-wroclaw.png (lane: -0.3 Wroclaw,
  -0.9 Tunis); cause not measured.
- Nothing was heard by a human ear; es, pl, ru lesson lines only by the package's words check.
- mouse-free rooms entry and tracks-page A look and E camera, as above. The probes ran on the dist of ada88fe0, not of
  the final head (see Probes). deploy/live-checks.sh was not run against the live site.

Cost notes: the package typecheck under tsconfig.node.json was found only by the full gates after the build; running
the package's own typecheck beside its test suite before the merge would have saved a gate rerun and a second package
push.
