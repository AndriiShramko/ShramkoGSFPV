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
- [~] R1.3 Measure on Wroclaw 70b50d42 with two pages (what B has after A presses Shift+G; what goes over the socket on
  a lap) and check the reason train 2 left the race off by a run.
- [~] R1.3/R1.4 run (this run, 2026-11-16): merged origin/main 77ab3948 (docs and scripts only; apps/fly tsc clean).
  Probe tools/bench/src/rooms-board.ts (commits d34cc4e6, 0f9de506, a57d4cce): three pages on SCENE (default 70b50d42),
  join by 9 (join9: presses 9 while the state is neither joined nor joining), A Shift+G, B follows, each page is put
  through its gates (+Z side to -Z side, packages/tracks laps.ts), C joins late, B Shift+G again; socket frames of kinds
  course, blap, board, welcome recorded with sizes; its own cap 570 s under the GPU lock. Walls stand-in copied into
  dist/walls (70b50d42 and manifest.json of U:/Temp/gsfpv-train2/walls/release); dist is still the build of 8dfbaa63.
  Result (log U:/Temp/gsfpv-train3/race/rooms-board-3.log, evidence/2026-11-16/rooms-board.json, not committed): FAIL.
  waitReady returned after 9.5 s, but neither page reached the room in 200 s each (meet aIn false, bIn false; join
  phase 413 s), so the run hit its cap before any course. Not measured yet: why 9 does not join on the big scan (the
  probe did not record r.state while it pressed; a guess, not checked: the rooms feature or its key waits for the scan
  to finish streaming, or 9 pressed during joining toggles).
- [ ] R1.4 Proof with two pages and a late third (page A makes a course, B has the same gates: count and places equal;
  a keyboard pilot on each flies a lap: each page holds both laps within 1 s; C joins late and gets the course and the
  laps; a new course on B replaces A's and clears the laps). Read `window.__gsfpv.rooms.board` and
  `window.__gsfpv.course` (gates, gatePoses) on each page; the pattern of two pages with the local rooms service is
  tools/bench/scripts/rooms-two-page.mjs.
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

Left for R1 (exact, in this order): (1) check the guess above in one run: record askCatalog's answer (the catalogue
order the page holds) on the rig; if it holds, make the probe join the way rooms-two-page.ts does (A presses
[data-action=rooms-create] in the panel, B and C open A's link), not by changing builtin/rooms.ts (outside this lane);
(2) R1.3 the measurement on Wroclaw 70b50d42 with two pages, including one run of the old race to check the train 2
reason; (3) R1.4 the two-page proof above; (4) gates.py --only vitest,api-unittest,architecture,i18n,b18,leaks at the
final commit. Not verified yet: anything of the room's course or laps in a browser; whether page B's generate gives the
same gates as page A on the big scan.

Why train 2 left the race off (docs/wip/rooms2.md, Q2 runs 2 and 3, not yet re-checked by a run here): rooms-race.ts
moved each craft along race.path on the real scan's course g1.438779389 (9 gates) and both pages passed gates 0 and 1,
then stayed at next 2 for 1645 frames over 3 rounds; no lap was reported (`sent` 0), 7 of 11 checks. The same stepping
on the test scene threeRooms: 60 seeds, 0 stuck. Open: the probe's path or the gate's direction on the real scan.

## For the lead

- Deploy order of the rooms service: apps/rooms/board.py (new) and apps/rooms/rooms.py changed; compose unchanged.
  The rooms service goes out before the site (an old service ignores `course` and `blap`; the page then just has no
  board).
- Files changed outside apps/fly/src/rooms and apps/rooms: apps/fly/src/course/hook.ts (optional field `adopt`),
  apps/fly/src/app/builtin/course.ts (one line: `hook.adopt` calls the feature's own generate or loadServer),
  apps/fly/src/app/builtin/rooms.ts (the board's wiring: welcome, board, blap, one look per frame),
  docs/rooms-protocol.md (section "The room's course and the board of best laps").
