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

- [~] R1 final checks: tsc of apps/fly clean at cd965f14; gates and a6-reference at the final commit (next entry).

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
