# Lane race: a live board of best laps in a room

Worktree C:/dev/gsfpv-rooms, branch race (from main b2e7a73b). Decisions L1 to L7 of the lead (train 3 task).

## Status

Stage R1-share:
- [x] R1.1 (e8fe1c34) Server: apps/rooms/board.py (Board: course, rows, lap checks, order, lead), rooms.py messages `course` and
  `blap`, `board` in welcome, a row leaves with its member; docs/rooms-protocol.md section "The room's course".
  Test apps/rooms/tests/test_board.py: 9 OK; all rooms tests 101 OK (`py -m unittest discover -s tests` in apps/rooms).
  Negative controls (board.py is new, so mutants): members check removed, equal time takes the lead, time range removed,
  a new course keeps the old board: each 1 failure. Sizes measured by a py one-liner over board.py (json without
  spaces): course up 41 bytes, lap up 56, lap down 120, board of 8 rows with 20-letter nicks 560.
- [x] R1.2 (8dfbaa63) Page: apps/fly/src/rooms/board.ts (RoomBoard: reads ctx.hook.course through CourseLook only, so the course
  chunk stays out of the main chunk; a course made here is sent as `course`; the room's course is built here through
  the course hook's new `adopt`; each lap on the room's course is sent as `blap` with the next number); socket.ts
  `course`, `blap`, events `board` and `blap`, welcome `board`; hook `rooms.board` (course, rows, sent, adopting).
  Test tools/bench/test/rooms-board.test.ts: 4 OK. Negative controls (board.ts is new, so mutants): an equal best put
  last, the room's own course sent back, a lap on another course sent: each 1 failure. Also OK: rooms-race-off,
  rooms-race-page, rooms-race (7, with PYTHON=py: this PC has no `python` on PATH), sonic-int-lazy; tsc of apps/fly;
  check-architecture ok.
- [x] R1.3 and R1.4 (dcc5881b, cd965f14 and this commit) Measured and proved on Wroclaw 70b50d42 with three pages in
  one run of tools/bench/src/rooms-board.ts (release build cd965f14, walls stand-in in dist/walls; log
  U:/Temp/gsfpv-train3/race/rooms-board-7.log, evidence/2026-11-16/rooms-board.json not committed): PASS, 11 of 11
  checks, run 126 s. On the rig 9 opens the rooms panel on Wroclaw (the earlier runs), so A makes the room by the
  panel's create button and B and C open A's link (on Tunis 887f27aa 9 joins at once: rooms-race.ts meet true).
  Numbers: pages loaded 8.6 s; A and B in one room at 13.9 s; A's Shift+G made g1.153427963 (21 gates); B built the
  same 21 gates (same seed, same places to 1 mm) 16.3 s after A's course was there; each page put through its gates
  twice sent 2 laps; both pages held both rows (same order, best 5233 and 5333 ms) 4 ms after the flights ended;
  lap lag from one page's send to the other page's receipt -1, -2, 2, 4 ms (both pages in one process, so a lag
  under 0 is the order of the two event loops); C joined late and got the course (same places) and both rows in its
  welcome (629 bytes); B's new Shift+G (g1.227667450, 20 gates) was built on A and C and every row was cleared.
  Largest frames: up course 41 bytes, up blap 55, down blap 109, down board 57, welcome with board 380 to 629.
  Fault found and fixed (cd965f14, apps/fly/src/app/builtin/rooms.ts): the hook rooms.board kept `adopting` after the
  room's course showed (the board cleared it without a step, so showBoard was not called); run 6 (log
  rooms-board-6.log) failed on exactly that (B's gates equal, bCourse false); run 7 passed after the fix (the
  negative control of this change). Seen, not a fault of this lane: the course feature's `laps` reads 0 after the
  two flown rounds while its lap events were sent (2 per page); a guess, not checked: the run's results card
  resets the count (apps/fly/src/app/builtin/course.ts).
- [x] R1.3 the race of train 2: tools/bench/src/rooms-race.ts on Tunis 887f27aa (log rooms-race-1.log): both pages
  met by 9, then the run stopped at the first read of the hook rooms.race.path: the race page is not made in this
  build (RACE_ON false, apps/fly/src/rooms/race.ts; builtin/rooms.ts:438). So the train 2 reason could not be
  re-run without switching the race on; under L5 it stays off as found (reason and numbers below).
- [x] Checks at 8dfbaa63: tsc of apps/fly clean; gates.py --only vitest,api-unittest,architecture,i18n,b18,leaks all
  PASS (vitest 245 s, api-unittest 238 s; logs U:/Temp/gsfpv-train3/race/gates-r1.log and gates-r1b.log);
  a6-reference 1 OK (no flight, input or collision code touched). Note for this PC: `python` is not on PATH; the gates
  api-unittest and leaks and the test rooms-race.test.ts need PATH=/c/Users/andri/AppData/Local/Programs/Python/Python311:$PATH
  (or PYTHON=py for the test).
- [x] Release build of 8dfbaa63 is in dist (node scripts/build-release.mjs, 177 s, sha256 d44cd58e..., log
  U:/Temp/gsfpv-train3/race/build-r1.log); a next run with HEAD still at the status commit after 8dfbaa63 (only this
  file changed) may serve it as it is.

- [x] R1.3 item (0) (this commit; probe commits 7ed70c93, 4f90e7f9, ac1c20a0): rooms-board.ts records each page's state,
  problem, said and open panel every 3 s while 9 is pressed (JOIN_ONLY=1 JOIN_MS=<ms> stops after the meeting). Two probe
  faults fixed: join9 waited on a state 'joining' that does not exist (the hook's states are off, connecting, joined,
  lost: apps/fly/src/rooms/hook.ts), and a JOIN_ONLY return skipped the report (it is now written in finally; the lock
  is let go first; each close gets 10 s). Run on 70b50d42 (log U:/Temp/gsfpv-train3/race/rooms-board-join5.log,
  evidence/2026-11-16/rooms-board.json not committed): both pages loaded in 9 s; on both, the first 9 opened the rooms
  panel ('panel interactive') and the state stayed 'off' for 60 s, problem null, said empty; further 9s are ignored
  while the panel is up (keys.ts: 9 waits while a dialog is up). So 9 took ninePress 'join', then joinOpen
  (apps/fly/src/app/builtin/rooms.ts:404) opened the panel instead of joining. A guess, not checked: on the local rig
  askCatalog() answers true with a list that has no 70b50d42 (the rig has no SuperSplat catalogue proxy), so the
  "scan outside the catalogue" branch (review RM-7) opens the panel; on the live site the catalogue has Wroclaw.

- [x] R1 final checks at 976be4e8: tsc of apps/fly clean; gates.py --only vitest,api-unittest,architecture,i18n,b18,leaks
  all PASS (vitest 139 s, api-unittest 231 s; log U:/Temp/gsfpv-train3/race/gates-r1c.log); a6-reference,
  rooms-board.test.ts and sonic-int-lazy.test.ts 13 of 13 OK. Stage R1-share done; next stage R2-board.

Stage R2-board:
- [x] R2.0 Merge of origin/main efd17add (merge commit cbfa2da4); tsc of apps/fly clean after it. 21 untracked evidence files
  of lane fix3a (evidence/2026-11-15/b-fly*, b-repo-b18.json) were in the way of main's tracked ones and differed from them:
  moved, not deleted, to U:/Temp/gsfpv-train3/race/fix3a-untracked/ with their paths.
- [x] R2.1 (this commit) L3, L4, L5, L6 built. apps/fly/src/rooms/lead.ts (pure: fmtLap m:ss.cc, boardShown, viewRows,
  leadChange, leadLine, LeadBanner; BANNER_MS 2000 and MOVE_MS 300 are estimates), apps/fly/src/rooms/board-view.ts (the
  board at the left edge 40 px under the mode chip's top, at most min(230 px, 30 % of the width) wide; the banner at 23 %
  of the height, centred, one line of at most 3 % of the height, so its bottom stays above a third of the height; neither
  takes a pointer, so neither needs a cross; rows glide to their new place in MOVE_MS; own row marked by a light band and
  an outline; the own takeover in green; leadBlip: a 0.18 s two-note sound in an ordinary flight),
  remote-stage.ts slotCss (the slot colour for the names), announce.ts (optional quietCue), hook rooms.board gets
  shown, banner, leads. builtin/rooms.ts: on each blap on the room's course leadChange against the rows before it; a lead
  shows the banner; in Fly by Sound one spoken line (narrator on) or the course's chime 'checkpoint' (narrator off, through
  sayVia's quietCue; never awaited), else leadBlip. The board shows while the page is in the room, the room has a course,
  two or more pilots are in it, the HUD is on and the flight is not paused. L5: no button; the countdown race stays off as
  found (RACE_ON false; reason below). Texts rooms.lead.other / rooms.lead.mine in en, es, pl, ru.
  Test tools/bench/test/rooms-lead.test.ts: 6 OK (with rooms-board and sonic-int-lazy 18 of 18). Negative controls
  (lead.ts is new, so mutants): an equal time takes the lead, a slower lap gives a banner, BANNER_MS 4000, one pilot sees
  the board, the row of a pilot who left shown: each 1 failure. tsc of apps/fly clean.
- [x] R2.2 (a246eedf) gates.py --only vitest,api-unittest,architecture,i18n,b18,leaks all PASS (vitest 151 s, api-unittest
  228 s; log U:/Temp/gsfpv-train3/race/gates-r2.log); a6-reference 1 OK (log a6-r2.log).
- [x] R2.3 Release build of a246eedf is in dist (sha256 3ba01c12..., 1937 files; log U:/Temp/gsfpv-train3/race/build-r2.log).
  A next run with HEAD at the status commit after a246eedf (only this file changed) may serve it as it is; the local
  rooms service and the walls stand-in (dist/walls) are started as in R1.3 (rooms-board.ts).
  Not done in this run: the browser run at the stage start (the reply budget went to the build of L3 to L6).
- [x] R2.4 Probe: extend tools/bench/src/rooms-board.ts (rendering on, holds of at most 10 min, on 70b50d42): both keyboard
  pilots fly laps; hook rooms.board.shown and the board's row order equal on both pages; B beats A's best: both pages show
  banner (hook rooms.board.banner with B's nick and time) within 1 s and the rows swap; rects of [data-testid=rooms-board]
  and [data-testid=rooms-lead] at 1920x1080, 1280x720, 844x390 against the middle third, the clock block, the lap time place
  (20 % of the height), the mode chip and the page's buttons; pause menu open: both hidden; one pilot alone: no board.
  [x] Done so far (7b7caaa3, 0de288d2, c215b502, this commit): rooms-board.ts MODE=r2 (cd tools/bench; MODE=r2 npx tsx
  src/rooms-board.ts; takes the lock itself; 120 to 170 s). Run 3 on the release of c215b502 (log
  U:/Temp/gsfpv-train3/race/rooms-board-r2-3.log, evidence/2026-11-17/rooms-board.json not committed): 7 of 8 checks pass:
  no board row before laps; both pages same order; B's takeover banner on both pages 53 ms after B's lap was sent ('You
  lead, 0:04.67' green on B, 'Pilot-0157 leads, 0:04.67' on A), rows swap with the move; A takes it back at 844x390 (57 ms);
  Escape hides board and banner; alone, no board. Failed: noOverlap. Run 1 and 2 measured the places: banner at 23vh lay
  over the lap's time (1920) and the clock block 142-239 px and its cross (1280x720); at 64 px over the sound button
  (38-78 px at 1280). Run 3 showed two faults of mine, fixed in this commit but NOT yet run: the banner fell to y 0 (style.top
  cleared; now BANNER_TOP, 82 px, and under the lap's time in 13 px while that shows, capped above a third of the height),
  and the board (10,66..182,115 at 844x390) still lay over the voxel panel's fold button (179,112..223,156) because
  offsetParent is null for a fixed panel (now computed style; narrower, or under the header).
  Left for R2.4: build the release of this commit, copy U:/Temp/gsfpv-train2/walls/release/70b50d42 to dist/walls, rerun
  MODE=r2 and see 8 of 8; if noOverlap still fails, read r2.overA/overB in the evidence.
  [x] Runs 4 to 7 (27d80011, f512de3b, 73713f76; releases of each, walls stand-in in dist/walls; logs
  U:/Temp/gsfpv-train3/race/rooms-board-r2-4.log .. r2-7.log, build-r2b..e.log; evidence/2026-11-17/rooms-board.json not committed).
  Faults found and fixed in apps/fly/src/rooms/board-view.ts fit(): a selector list returned the whole voxel panel, not its header
  (run 4: board pushed to y 611 on 844x390); a fit every 30 frames left the board over the fold button after a resize (run 5);
  under the header it lay over the panel's own toggle (run 6). Now: read before write every frame; beside the whole panel the
  board narrows when the panel starts more than 120 px right of the board, else it hides (visibility) until the panel closes.
  Probe: an overlap counts when it holds two drawn frames (single frames kept in r2.onceA/onceB; run 7: one frame of the fold
  button right after the resize to 844); the takeover flies again (at most 3 times) until its best is the room's best.
  Run 7 (release 73713f76): 7 of 8. noOverlap passes (overA {}, overB {}); B takes the lead, banner on both pages 47 ms after
  the send ('Pilot-9928 leads, 0:03.43'); rows swap; pause hides both; alone no board. Failed: aTakesLeadBackAt844: A flew 3
  tries at 844x390 and its best was 5.33 s against B's 3.43 s (run 6 passed it at 59 ms, run 3 at 57 ms). A probe fault, not a
  board fault: the lap time follows the page's frame rate and A at 844 counts about one lap per 3 rounds (run 6 nexts show every
  gate passed); a guess, not checked: the course feature's results card after the course's lap count (apps/fly/src/app/builtin/course.ts).
  Left for R2.4: in rooms-board.ts takeover, let A at 844 fly with hold 1 and offs [0.6, 0, -0.6] (or fly before the resize and
  measure the banner at 844 on B's takeover) and rerun MODE=r2 for 8 of 8 on the release of HEAD (the dist of 73713f76 is in
  place with dist/walls; HEAD after it changes only this file and the probe).
  Note for the lead: after run 4 this lane ran 'rmdir C:/dev/.gpu-lock' though rooms-board.ts takes and frees the lock itself;
  if another lane held it at that moment (03:5x on 2026-11-17) its hold was cut short. Not repeated.
  [x] Runs 8 to 13 (b79f6313, 79811002, 27d7a9db, 24cceb42, fc982bb6, d49bb30d; logs U:/Temp/gsfpv-train3/race/rooms-board-r2-8..13.log,
  builds build-r2f.log, build-r2g.log). Run 8: python was not on the shell's PATH (the probe spawns 'python' for apps/rooms):
  run with PATH=/c/Users/andri/AppData/Local/Programs/Python/Python311:$PATH. Measured and fixed:
  - probe: the service refuses a lap under 3 s (apps/rooms/board.py MIN_LAP_MS); with 2 points per gate A's laps were under 3 s
    and all 9 were refused (run 8); the same points gave 5.9 s and 3.4 s in two runs. Now B's takeover flies 8 points per gate
    and each try after the first scales the points per gate from its own last lap into [3.6 s, the others' best - 0.4 s]
    (falls back to [3.1 s, best - 0.1 s]).
  - board (apps/fly/src/rooms/board-view.ts fit()): run 9 passed 8 of 8 but race-844.png showed no board: at 844x390 the folded
    'Walls 5 cm' button (16..107 x 62..105) sits on the board's place and fit() hid the board for the whole flight. Run 11 showed
    why the old measure was wrong as well: the menu of the closed <details> keeps a layout box (16..278 x 105..604, nothing
    drawn). Now the panel counts as its summary plus the menu only while open; a panel at the board's left edge moves the
    board just under it (translateY) while that stays above 60 % of the height, only a taller open panel hides it.
    New probe check boardSeenAt844. Probe skips buttons inside a closed <details> (run 12 counted the undrawn fold button).
  Run 13 (release fc982bb6, HEAD d49bb30d changes only the probe): 9 of 9 pass (evidence/2026-11-17/rooms-board.json):
  same order on both pages; B leads 0:05.07, banner on both pages 60 and 61 ms after the send; rows swap with the move; A at
  844x390 leads 0:04.37 after 2 tries, banners 67 and 59 ms; board at 844 visible at 10..182 x 112..161 under the walls button
  (16..108 x 61..105); overA {} overB {}; pause hides both; alone no board. Single frames: one of the pause menu's Continue
  button in the frame Escape opens it (known since run 5, not counted).
- [x] R2.5 Pictures looked at (U:/Temp/gsfpv-train3/shots): race-board.png (run 9, 1920x1080): the board at the top left under
  the mode line, two rows in the slots' colours (orange first, blue second), the lap clock and the middle clear.
  race-lead-change.png (run 9, 1920x1080): 'Pilot-0932 leads, 0:04.13' in a dark pill at the top centre above the course clock,
  the board's rows swapped. race-844.png (run 13, 844x390): the board under the 'Walls 5 cm' button, two rows, own row marked,
  nothing over the middle; the remote craft's name tag 'Pilot-1363' is in the middle (remote-stage, as on main).
- [x] R2.5b Checks of the board-view.ts change at a124b56a: tsc of apps/fly clean; rooms-lead.test.ts and sonic-int-lazy.test.ts
  14 of 14; gates.py --only vitest,api-unittest,architecture,i18n,b18,leaks all PASS (vitest 151 s, api-unittest 228 s; log
  U:/Temp/gsfpv-train3/race/gates-r2b.log); a6-reference 1 OK (a6-r2b.log). The release in dist is fc982bb6 (the app code of
  HEAD; later commits change only the probe and this file) with the walls stand-in in dist/walls/70b50d42.
- [x] R2.6 (f2d3a633 merge of origin/main a36280e1, docs only; tsc of apps/fly clean after it) Regression probes against the
  release fc982bb6 in dist (no app code changed since), logs in U:/Temp/gsfpv-train3/race/:
  - rooms-two-page.ts (its own rig, SONIC_PORTS=5860-5869): PASS 17 of 17 (evidence/2026-11-17/rooms-two-page.json; r26-two-page.log).
  - Local rig held up by U:/Temp/gsfpv-train3/race/rig.mts (startRoomsRig on dist, front http://127.0.0.1:5871, rooms.py 5870):
    train1-live.ts rooms with SITE=http://127.0.0.1:5871: PASS 9 of 9 (evidence/2026-11-17/train1-live.json; r26-live.log).
  - accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (first line 'accept-fly target: http://127.0.0.1:5871'): 9 of 10 in the
    chained run, B10 FAIL: profile and mapping right (step 6), but throttleUpClimbs armed false, climbed 0 (copy
    U:/Temp/gsfpv-train3/race/b-fly-b10-run1.json). B10 alone right after: PASS (armed, climbed 0.98 m; r26-b10b.log).
    Not this lane's code (no input or flight file changed); one fail in two runs, under the load of the chained run. A guess,
    not checked: the arm switch of the SimRadio wizard races the page's start under load (tools/bench/src/accept-fly.ts B10).
  - mouse-free-probe.mjs http://127.0.0.1:5871/en (render off, no lock): pass true, 84 PASS, 0 FAIL (r26-mouse.log).
  - gates.py --only architecture,i18n,b18 PASS (gates-r2c.log) for the files changed after gates-r2b (deploy script, docs);
    vitest, api-unittest and leaks passed at a124b56a (gates-r2b.log) and their inputs did not change since.
- [x] R2.7 (a1ef3980 and this commit) deploy/release-rooms.sh uploads board.py: its FILES list had only
  ws, protocol, votes, race and rooms.py, while rooms.py imports board since R1, so a release would have started a service
  that fails at import. Status for the lead below. Stage R2-board done; every stage of lane race is done.
  Line for the lead, not fixed here (not this lane's file): in run 10 the walls panel .walls-menu reported an open-sized box
  with its <details> closed; apps/fly/src/walls.ts placeMenu() reads the summary only while open; a guess: Chrome keeps the
  closed details' content laid out; harmless for the walls panel itself (the board measures the summary only while closed).

Why train 2 left the race off (docs/wip/rooms2.md, Q2 runs 2 and 3; not re-run here: the race is off in the build): rooms-race.ts
moved each craft along race.path on the real scan's course g1.438779389 (9 gates) and both pages passed gates 0 and 1,
then stayed at next 2 for 1645 frames over 3 rounds; no lap was reported (`sent` 0), 7 of 11 checks. The same stepping
on the test scene threeRooms: 60 seeds, 0 stuck. Open: the probe's path or the gate's direction on the real scan.

## Review

Release check 1 (2026-11-17, head 299876a4 plus this status part; review file U:/Temp/gsfpv-train3/reviews/race-review-1.md).
- Merge: origin/main has nothing the branch lacks (0 behind); no merge.
- Diff read (apps, packages, deploy, tools against origin/main): the flight, its keys and pointer lock, the pause and the order of
  Esc, the touch branch and the edit mode are not touched; course.ts gains one line (`hook.adopt` calls the feature's own
  generate or loadServer: a room's course arrives with the course's own 'course soon' line while the drone flies, the drone is not
  moved); Fly by Sound gets the lead line through Announcer with the course's quiet cue; packages/sonic-fpv is not changed.
- Walk on a fresh release build of 299876a4 (sha256 e65a9c0d...), walls of U:/Temp/gsfpv-train3/walls/release in dist/walls, the
  local rig (release + rooms.py, ports 5870-5879), two pages at 1536x730 at device scale 1.25 on Wroclaw 70b50d42 (script and log
  U:/Temp/gsfpv-train3/reviews/race/walk.mts, walk.json): A opened the rooms panel by 9 and clicked its create button; B opened A's
  link and joined (2 members); A's Shift+G on the ground made g1.61547034, B built it with the same gate places (to 1 mm); both
  flew 2 rounds: both rows on A's board, ordered (0:19.72, 0:29.60), board at css (10,66)-(180,115), outside the middle third;
  B's quick rounds: A showed 'Pilot-1955 leads, 0:08.97' at (668,82)-(868,109), outside the middle third, and an oscillator
  started on A for each lead change (the short sound; not heard); Esc on A: pause menu, board and banner hidden; Esc again: board
  back; B's Shift+G: A followed (g1.90687119), rows cleared on both; at 844x390 the board sits under the walls panel at
  (10,112)-(178,161); B left: A alone has no board. Pictures looked at: w2-B-gates, w4-A-banner, w6-A-844 (in the review folder).
  The lane adds no control (board and banner take no pointer).
- Negative controls by mutants (each restored by git checkout): leadChange taking an equal time as the lead fails
  rooms-lead.test.ts (1 failure); board.look sending the room's own course back fails rooms-board.test.ts (1 failure); clean 10 of 10.
- Old live rooms service with the new page: rooms.py on origin/main counts an unknown message type by its rate gate and does not
  answer it (`# review RV-2`), and its welcome has no `board`: the page then shows no board and no banner; rooms work as today.
- deploy/live-checks.sh: not changed by the lane (no live check added).
- Not run: accept-fly (no flight, key, input or session code changed; the lane ran it 10 of 10 in R2.6).
- Not verified: pointer lock (headless Chrome does not grant it: the click into the scene left pointerLockElement null); the
  owner's laptop, a real phone, touch, a second real person and real network lag took no part; the sound was counted, not heard.

Release check 2 (2026-11-17, after the approved d5ce7a24; review file U:/Temp/gsfpv-train3/reviews/race-review-1.md).
- Merge: origin/main (clockfix, 015daf1b) merged with --no-ff, no conflict (an untracked older evidence/2026-11-17/b-repo-b18.json
  was moved aside to the review folder first).
- Walk (U:/Temp/gsfpv-train3/reviews/race/walk2.mts, logs before-, after-, after2-walk2.log): release build, two keyboard pages
  in a room on Wroclaw 70b50d42 at 1536x730 dpr 1.25 plus a third page with touch (input=touch, 844x390 dpr 2, then 667x375);
  rectangles of the board, the course clock, the banner and the walls caption on the ground, in the air, after a lap, paused.
- F1 PROVEN, repaired (41a7c4a6): after the clockfix merge the course clock
  stands in the left column on a short keyboard view (16..150 x 112..206 at 844x390 and 667x375), the board lay over it (844:
  board 10..180 x 112..161; 667: 10..167 x 66..115; picture before-c844.png: rows over the time and its close cross). Now the
  board hides while the clock is drawn over its place and is back when the clock hides (the lap's own time, measured: board
  10..182 x 112..161 at 844 after a lap) and at taller views (1536x730: board 10..182 x 66..115, clock 729..807 x 120..217).
- F2 PROVEN, repaired (c4121312): touch at 844x390, the board (10..182 x 112..181) covered the THR / speed / ALT line over the
  stick pads; at 667x375 too. The board now goes 6 px under that line (844: 10..182 x 136..205; 667: 10..167 x 121..190),
  else hides (above 60 % of the height). Picture after2-c844.png looked at.
- After both: no overlap of board with clock, walls caption or banner at 1536x730, 844x390, 667x375, keyboard and touch; paused:
  board and clock hidden. Tests tools/bench/test/rooms-board-clock.test.ts 4 OK; negative controls (neg_control.py against the
  previous board-view.ts): the clock test 1 failure, the touch test 1 failure.
- Not run: accept-fly (only apps/fly/src/rooms/board-view.ts changed since d5ce7a24 besides the merge; no flight, key, input or
  session code). deploy/live-checks.sh not changed by the lane.
- Not verified: pointer lock (headless), the owner's laptop, a real phone, a person; on touch the board lies over part of the
  left stick pad's ring (it takes no pointer, touches pass through); the 'School 1/4' chip touches the THR line on touch at
  844x390 (not this lane's, same without a room).

## For the lead

- Deploy order (release check 2, unchanged by the clockfix merge and the two repairs: they change only the page): page yes;
  rooms service yes (apps/rooms/board.py new, apps/rooms/rooms.py changed, deploy/release-rooms.sh FILES holds board.py);
  compose no; nginx no; API files no (apps/api unchanged); sound package no (packages/sonic-fpv pin unchanged). Rooms service
  first (`bash deploy/release-rooms.sh`, health 200), then the site.

- Deploy order in one line each (release check 1): page yes; rooms service yes (apps/rooms/board.py new, apps/rooms/rooms.py
  changed; deploy/release-rooms.sh FILES holds board.py); compose no (deploy/compose.yml unchanged); nginx no; API files no
  (apps/api unchanged); sound package no (packages/sonic-fpv pin unchanged). Rooms service first, then the site; each works
  with the other's old version.
- Deploy order: (1) the rooms service: `bash deploy/release-rooms.sh` (no --compose: deploy/compose.yml is unchanged against
  origin/main). Changed in apps/rooms: board.py (new), rooms.py; tests/test_board.py (new, not deployed). The script's FILES
  list now holds board.py (commit a1ef3980); with the old list the service would fail at `import board`. Check after it:
  /api/rooms/health 200. (2) Then the site. An old service with the new site: rooms work, there is just no board (it
  ignores `course` and `blap`). The new service with the old site: nothing changes for the old pages.
- Read-only live check the lead can add after both are out: `cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu npx tsx
  src/train1-live.ts rooms` (two pages make a room in the service's memory only, gone when they leave; it saves no course and sends nothing to the
  site's API; passed 9 of 9 against the local rig in R2.6). The board itself on two pages: `MODE=r2 npx tsx src/rooms-board.ts`
  runs only against the local rig (it starts rooms.py itself); a live variant of it is not written.
- What the owner does: open a scan (Wroclaw), press 9 and send the link to a friend (or the friend presses 9 on the
  same scan). One of you presses Shift+G: the same gates appear for both. Fly through the gates. From the first
  finished lap a small board at the top left shows both names in your colours, ordered by the best lap, your own row
  marked. When someone's lap becomes the room's best, the top centre says 'NAME leads, 0:41.27' for 2 s with a short
  sound (green 'You lead' for your own), and the rows slide to their new places. A new Shift+G by anyone gives everyone
  the new course and clears the board. P (pause) hides the board; alone in a room there is no board.
- Not verified: no second real person was ever in a room with this build (all runs are two or three headless pages in one
  process on this PC, lap lag -2 to 4 ms there; the real network lag is not measured); not run on the live site (no
  deploy from this lane); Fly by Sound's spoken takeover line and the narrator-off chime were checked by
  code reading only, not heard in a browser; Tunis 887f27aa was used only for the train 2 race check (R1.3), the board
  runs were on Wroclaw 70b50d42; the countdown race of train 2 stays off (RACE_ON false), not re-run.
- Files changed outside apps/fly/src/rooms and apps/rooms: apps/fly/src/course/hook.ts (optional field `adopt`),
  apps/fly/src/app/builtin/course.ts (one line: `hook.adopt` calls the feature's own generate or loadServer),
  apps/fly/src/app/builtin/rooms.ts (the board's wiring: welcome, board, blap, one look per frame; the hook shows
  adopting cleared),
  docs/rooms-protocol.md (section "The room's course and the board of best laps").
- R2 (lane race, stage R2-board): outside apps/fly/src/rooms and apps/rooms it changed apps/fly/src/app/builtin/rooms.ts
  (board and banner wiring), packages/i18n/locales/fly/rooms/{en,es,pl,ru}.json (rooms.lead.other, rooms.lead.mine) and
  the new test tools/bench/test/rooms-lead.test.ts. apps/rooms is unchanged by R2 (the server's `lead` flag of R1 is not
  read: the page decides by the same rule, so an old service gives the same banners). R2 also changed
  deploy/release-rooms.sh (board.py in FILES, a1ef3980) and the probe tools/bench/src/rooms-board.ts (MODE=r2).
