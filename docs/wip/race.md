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
- [ ] R2.4 Probe: extend tools/bench/src/rooms-board.ts (rendering on, holds of at most 10 min, on 70b50d42): both keyboard
  pilots fly laps; hook rooms.board.shown and the board's row order equal on both pages; B beats A's best: both pages show
  banner (hook rooms.board.banner with B's nick and time) within 1 s and the rows swap; rects of [data-testid=rooms-board]
  and [data-testid=rooms-lead] at 1920x1080, 1280x720, 844x390 against the middle third, the clock block, the lap time place
  (20 % of the height), the mode chip and the page's buttons; pause menu open: both hidden; one pilot alone: no board.
- [ ] R2.5 Pictures in U:/Temp/gsfpv-train3/shots: race-board.png, race-lead-change.png, race-844.png, each looked at.
- [ ] R2.6 rooms-two-page.mjs, train1-live.ts rooms against local servers, accept-fly B6 B7 B9..B16, mouse-free-probe.
- [ ] R2.7 Status: deploy order, a read-only live check for the lead, What the owner does, not verified.

Why train 2 left the race off (docs/wip/rooms2.md, Q2 runs 2 and 3; not re-run here: the race is off in the build): rooms-race.ts
moved each craft along race.path on the real scan's course g1.438779389 (9 gates) and both pages passed gates 0 and 1,
then stayed at next 2 for 1645 frames over 3 rounds; no lap was reported (`sent` 0), 7 of 11 checks. The same stepping
on the test scene threeRooms: 60 seeds, 0 stuck. Open: the probe's path or the gate's direction on the real scan.

## For the lead

- Deploy order of the rooms service: apps/rooms/board.py (new) and apps/rooms/rooms.py changed; compose unchanged.
  The rooms service goes out before the site (an old service ignores `course` and `blap`; the page then just has no
  board).
- Files changed outside apps/fly/src/rooms and apps/rooms: apps/fly/src/course/hook.ts (optional field `adopt`),
  apps/fly/src/app/builtin/course.ts (one line: `hook.adopt` calls the feature's own generate or loadServer),
  apps/fly/src/app/builtin/rooms.ts (the board's wiring: welcome, board, blap, one look per frame; the hook shows
  adopting cleared),
  docs/rooms-protocol.md (section "The room's course and the board of best laps").
- R2 (lane race, stage R2-board): outside apps/fly/src/rooms and apps/rooms it changed apps/fly/src/app/builtin/rooms.ts
  (board and banner wiring), packages/i18n/locales/fly/rooms/{en,es,pl,ru}.json (rooms.lead.other, rooms.lead.mine) and
  the new test tools/bench/test/rooms-lead.test.ts. apps/rooms is unchanged by R2 (the server's `lead` flag of R1 is not
  read: the page decides by the same rule, so an old service gives the same banners).
