# Lane race: a live board of best laps in a room

Worktree C:/dev/gsfpv-rooms, branch race (from main b2e7a73b). Decisions L1 to L7 of the lead (train 3 task).

## Status

Stage R1-share:
- [x] R1.1 Server: apps/rooms/board.py (Board: course, rows, lap checks, order, lead), rooms.py messages `course` and
  `blap`, `board` in welcome, a row leaves with its member; docs/rooms-protocol.md section "The room's course".
  Test apps/rooms/tests/test_board.py: 9 OK; all rooms tests 101 OK (`py -m unittest discover -s tests` in apps/rooms).
  Negative controls (board.py is new, so mutants): members check removed, equal time takes the lead, time range removed,
  a new course keeps the old board: each 1 failure. Sizes measured by a py one-liner over board.py (json without
  spaces): course up 41 bytes, lap up 56, lap down 120, board of 8 rows with 20-letter nicks 560.
- [ ] R1.2 Page: apps/fly/src/rooms sends `course` when the course feature makes one in a room, builds the room's
  course on `board`/welcome, sends `blap` on each lap, keeps the board; unit tests with negative controls.
- [ ] R1.3 Measure on Wroclaw 70b50d42 with two pages (what B has after A presses Shift+G; what goes over the socket on
  a lap) and check the reason train 2 left the race off by a run.
- [ ] R1.4 Proof with two pages and a late third; typecheck, gates.py --only vitest,api-unittest,architecture,i18n,b18,
  a6-reference.

Why train 2 left the race off (docs/wip/rooms2.md, Q2 runs 2 and 3, not yet re-checked by a run here): rooms-race.ts
moved each craft along race.path on the real scan's course g1.438779389 (9 gates) and both pages passed gates 0 and 1,
then stayed at next 2 for 1645 frames over 3 rounds; no lap was reported (`sent` 0), 7 of 11 checks. The same stepping
on the test scene threeRooms: 60 seeds, 0 stuck. Open: the probe's path or the gate's direction on the real scan.

## For the lead

- Deploy order of the rooms service: apps/rooms/board.py (new) and apps/rooms/rooms.py changed; compose unchanged.
