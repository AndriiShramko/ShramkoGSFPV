# Lane rooms2, stage Q1-open-room (R27: a room that is always there, a vote for the next scan)

Branch `rooms2` from origin/main 2a5ac433, worktree C:/dev/gsfpv-center-throttle, ports 5820-5839.

## Status

Stage Q2-race (rooms-plan.md 2.4 and 4D: a race on time in a room):

- [x] Q2.1 Server: apps/rooms/race.py (prep, count, run, results; table order and gaps), messages race/ready/lap/table in
  rooms.py, welcome carries `race`, a passed vote ends the race; docs/rooms-protocol.md "Races". Test
  apps/rooms/tests/test_race.py: 10 tests OK; all other rooms tests 77 OK. Negative control (old code has no race module,
  so mutants): time checks of a lap removed: 1 failure + 1 error; table ordered by total only: 1 failure.
  Commit: "rooms2: race server".
- [x] Q2.2 Page logic (commit "rooms2: race page logic"): apps/fly/src/rooms/race.ts (`courseFor`: the course flown
  now, else the scan's newest saved course, else `g1.<new seed>`; `parseCourse`; `Countdown` 10, 3, 2, 1, go, each once,
  a late page says only the last mark passed; `RaceLaps`: laps after the start only, numbered, up to the race laps;
  `raceLine` for prep, my lap (with gap), another pilot finishing, results; `tableRows`); rooms/socket.ts: `race()`,
  `ready()`, `lap()`, `table()`, event `race`, Welcome.race; 11 keys `rooms.race.*` in rooms/{en,es,pl,ru}.json.
  Test tools/bench/test/rooms-race.test.ts: 7 of 7 pass (two RoomSockets against rooms.py: one startAt, a lap before
  it refused, the same results table on both, B first, gap 100 ms). Negative controls: neg_control.py with origin/main
  socket.ts: NEG OK (`sa.race is not a function`); mutant Countdown that skips marks: 2 assertion failures.
  Typecheck apps/fly: 0 errors.
- [x] Q2.3 Page glue (commit "rooms2: race page glue"): apps/fly/src/rooms/race-page.ts (`RacePage`: propose with
  `courseFor`, build the course on every racer's page: saved by CourseStore.load, seed by the course worker on the flown
  walls; its own CourseRun and CourseStage; `ready`; countdown said and flashed on the server's clock; run reset at go;
  laps to `sock.lap`; race lines through the Announcer and the HUD; results hide the gates and keep the table;
  `standing()` for key 0); app/builtin/rooms.ts wires it per join (`race` event, welcome's race, frame, key 0 says the
  place first, the panel asks `sock.table()`); panel.ts: "Race on a course" first and focused, the table under it;
  hook.ts: `RaceHook` (`window.__gsfpv.rooms.race`); 8 keys more in rooms/{en,es,pl,ru}.json (`rooms.race.standing*`,
  `rooms.race.col.*`); rooms-open-vote.ts proposes a scan with 9, Tab, Enter. Test tools/bench/test/rooms-race-page.test.ts
  3 of 3; with rooms-race and rooms-open-vote tests 16 of 16. Typecheck apps/fly and tools/bench: 0 errors.
- [~] Q2.4 Two-browser probe tools/bench/src/rooms-race.ts written (commit ee9be881; typecheck tools/bench 0 errors): scan
  887f27aa on both pages, 9 each, A 9 + Enter, both racers build the same course, hear Go, the probe moves each craft along
  `race.path` (0.3 m per drawn frame, the sim running), results on both, the same order and totals, B's panel table, A's
  key 0 place; control: no lap before flying. dist rebuilt at ee9be881. Run 1 started (log
  U:/Temp/gsfpv-train2/rooms2/rooms-race-run1.log); its result is the next worker's first read if this line is still [~].
- [x] deploy/release-rooms.sh uploads votes.py and race.py too (commit b6e919ce): before it, FILES held only ws, protocol
  and rooms, so a release of this branch would have started a rooms.py that cannot import votes (Q1) and race (Q2).

Plan for Q2.3 (decided, not built):
- Key: no new keymap action (packages/prefs keymap.ts is not this lane). In a room 9 opens the panel; the panel gets a
  "Race on a course" button (`rooms.race.button`) focused first, "Propose <next scan>" after it, so a race is 9, Enter.
  rooms-open-vote.ts then proposes a scan with 9, Tab, Enter (change it there). Key 0 during a race or after it says
  this pilot's place line from the last table, then who is around (the table on demand); the panel shows the table
  (`tableRows`, title `rooms.race.table`) and asks `sock.table()` when opened.
- Proposal: `courseFor(ctx.hook.course, rows, randomSeed)`; rows from `new CourseStore().list(scene)` (course/store.ts),
  laps = the track's laps once built (send 1 for a seed course before it is built is wrong: build first on the
  proposer for a seed, or read `track.laps` of a saved row after `store.load`; then `sock.race(id, laps)`).
- Every page on `race` prep: build the TrackFile (`saved`: CourseStore.load({id, version}); `seed`: the course worker
  apps/fly/src/course/worker.ts with a CourseJob as course.ts generate() builds it, walls as course.ts walls() reads
  them), then `new CourseRun(track, ctx.session.transform)` (course/run.ts), draw with `new CourseStage(ctx.renderer)`
  only when the course feature does not show the same track id, `sock.ready()`.
- Per frame: `Countdown.due(startAt - serverNow)` -> announcer + hud flash; at go `run.reset()`; then
  `run.fromSim(ctx.session.runner.sim)` -> `RaceLaps.feed(ev, view.lastLapMs, started)` -> `sock.lap(n, ms)`; respawn
  and crash events reset the run like course.ts does. On `race` messages: `raceLine` -> announcer.announce + flash; keep
  the last table in the hook (`h.race = {state, course, startAt, table}`), fill RoomsHook in rooms/hook.ts.
- On results: hide the race's gates, keep the table for 0 and the panel.

Stage Q1-open-room (done):

- [x] 1. Server: open rooms (`POST /api/rooms/open`), votes (`apps/rooms/votes.py`), protocol doc, python tests
  `apps/rooms/tests/test_open_vote.py` (24 tests OK; all 77 rooms tests OK). Commit: see git log "rooms2: server".
- [x] 2. Page (commit "rooms2: page"): key 9 outside a room joins the open room (one press, `openRoom` in rooms/api.ts);
  in a room 9 agrees to an open vote this pilot has not agreed to, else opens the panel with "Propose <next scan>"
  focused (rooms/vote.ts `ninePress`, `nextScan` = the catalogue's order after the room's scan, wrapping); `vote` and
  `scene` messages and `propose()`/`agree()` in rooms/socket.ts; each vote line is said (Announcer) and shown
  (`ctx.hud.flash`, 6 s); on `scene` the page loads the room's new scan (SceneHost.load reason 'room'); an open room
  never reloads the scan flown and never touches the visit layer; hook fields `kind`, `vote`, `roomScene`; 13 new keys
  in rooms/{en,es,pl,ru}.json and `keys.rooms.panel` reworded. Test tools/bench/test/rooms-open-vote.test.ts: 6 tests
  pass; with the related rooms tests 38 of 38 (rooms-public-review, rooms-socket, rooms-public, rooms-review).
  Negative control (neg_control.py, origin/main keys.ts and socket.ts): NEG OK, the key test fails by assertion at
  `press('join')`, the two-socket test by `sa.propose is not a function`.
  Typecheck apps/fly: no error in a rooms file; 17 errors elsewhere, all from this worktree's state (packages/sonic-fpv
  checked out at b102ce6 while origin/main pins 378cc50; `@gsfpv/tracks` not linked in node_modules).
- [x] 3a. Probes written (commit 8160ad2d and the commit "rooms2: train1-live"): new tools/bench/src/rooms-open-vote.ts
  (A on 39e63ce9, B on 7a475d38, one 9 each, A proposes with 9 + Enter, one yes of two holds 3 s, B agrees with 9,
  both in the proposed scan and see each other; control: rig with --no-relay); rooms-two-page.ts opens the panel from
  the pause menu (`panelByMenu`, Esc then `pause.rooms`), check `nineNotTypedInName` replaced by
  `panelShowsStoredName`; train1-live.ts: when 9 gave `kind=persistent`, leave the open room and create from the menu.
  Typecheck tools/bench: 0 errors. Run with SONIC_PORTS=5820-5839 (the rig's ports come from that variable).
  dist/ rebuilt at 5595851f; the worktree's packages/sonic-fpv was moved to the pinned 378cc50 (the build failed at
  b102ce6: `lessonSegments` missing).
- [x] 3b. Runs on the local rig (dist at 5595851f, SONIC_PORTS=5820-5839, headless, GPU lock taken by the probes):
  rooms-open-vote.ts pass, 8 of 8 checks: one 9 each, both in open room k3wGAkaDQns on 39e63ce9 with 1 remote each;
  9 on A opened the panel with `rooms-propose` focused; B saw the vote {scene 7a475d38, yes 1, need 2, mine false};
  after 3 s both still on 39e63ce9; one 9 on B: both `roomScene` 7a475d38 with 1 remote, both said `rooms.vote.passed`.
  Control relay off: A2 and B2 met in one room by 9, A2 flew 33.456 m, B2 saw 0 remote frames (fired).
  rooms-two-page.ts pass, 17 of 17 checks (RMS 0.0864 m under 0.15 m over 406 samples; controls 1, 2, 3 fired).
  Evidence: U:/Temp/gsfpv-train2/rooms2/rooms-open-vote.json and rooms-two-page.json (not in git; the tracked
  evidence/2026-11-13/rooms-two-page.json of an earlier lane was left as it was).
  First run of rooms-open-vote failed at page.goto: under SONIC_PORTS the rig picked the front's port twice; fixed in
  rooms-serve.ts (commit 4ec94a57: three ports at once).

## Decisions

- Which room key 9 lands in (R27, "the scan he is in or the one with pilots"): the open room of the pilot's scan when
  pilots fly in it; else the open room with the most pilots anywhere (company first; his page loads that scan); else the
  open room of his scan, empty (the next pilot who presses 9 anywhere lands with him); else a new one. Full (16) rooms
  are skipped, so the 17th pilot gets a new room of his scan.
- One open room per scan, made on demand by the service, not by an admin: the plan's admin series and
  `rooms-admin.json` are in apps/api (not this lane). An empty open room closes after 600 s like a temporary room; the
  next press makes it again, so for a pilot it is always there and the memory stays bounded (50 open rooms, estimate).
- Open rooms carry no shared settings and no render: each pilot keeps his own drawing, walls and drone; joining an open
  room on the scan flown does not reload it.
- Votes: the plan's rules (30 s, yes > half of the present, proposer once, one vote at a time, 5 proposals per 10 min).
  Left out on purpose: the plan's "5 minutes on a scene before a proposal" and "3 minutes cooldown": a majority is
  needed anyway, and the owner's rule forbids "cannot, because" answers. A proposal of the scan of the open vote counts
  as yes; a proposal of a third scan answers the open vote's state ("press 9 to agree").
- Votes work in temporary rooms too (the same code; the room moves).

## For the lead

- Q2 (race): new WebSocket messages race, ready, lap, table and server file apps/rooms/race.py (rooms.py imports it).
  A release needs `deploy/release-rooms.sh` without --compose (only apps/rooms changed: race.py is new, so the script's
  copy of apps/rooms must take the whole folder; not checked against the script). No limit changed: MAX_TEXT 2048 holds
  every race message a page sends (under 80 bytes).
- Keys a pilot uses, in order: 9 (outside a room: the open room of his scan or the one with pilots); 9 then Enter (in a
  room: a race on the course he flies, else the scan's newest saved course, else a new generated one; every pilot in the
  room races); nothing while the courses build and during the countdown 10, 3, 2, 1, Go; fly through gate 0 after Go,
  two laps (RACE_LAPS 2 in rooms/race-page.ts, an estimate); 0 (his place and best lap, then who is around); 9 (the panel:
  the race table under "Race on a course"). A scan proposal is now 9, Tab, Enter.
- Release of this branch's rooms service: `bash deploy/release-rooms.sh` WITHOUT --compose (no limit changed; it now
  uploads ws, protocol, votes, race, rooms). The page part ships with the site release.

- New HTTP route `POST /api/rooms/open` on gsfpv-rooms. nginx's `location ^~ /api/rooms` already passes POST with a
  4k body; no deploy file changed. Release needs the rooms service restarted (apps/rooms changed).
- Probes of the rig: run with SONIC_PORTS=<range>; before commit 4ec94a57 rooms-serve.ts under SONIC_PORTS served the
  site and the front on one port (page.goto failed). Without SONIC_PORTS it was fine (random ports).
- A pilot in the open room who wants his own room: the panel in a room offers leave, not create, so it is menu, leave,
  menu, create (four presses). A "create a room" button in the open room's panel would cut it to two; not built here.
- This worktree's packages/sonic-fpv was checked out at b102ce6; it is now at the pinned 378cc50 (fetched from the
  lead copy's submodule). A worktree with the old submodule fails build-release (`lessonSegments` missing).

## Not verified

- Q2: no page glue yet, so nothing of the race was seen in a browser; the two-browser probe (rooms-race.ts) is not
  written. The race timings PREP_MS 45 s, RUN_MS 15 min, MAX_LAPS 10, LATE_MS 500 ms are estimates (named in race.py).
- Q2: the race's spoken lines were not heard and the flash and the panel's table not looked at on a screenshot (keys in
  `said` and DOM text only). A course that a page cannot build (no walls, generator finds nothing) leaves that pilot
  without gates; the race still runs for the others: not run in a browser.
- Q2: the probe flies by moving the craft along the course's path, not with the sticks; real flying through gates was
  not tried.

- Old-code control of test_open_vote.py: on origin/main's rooms.py the test module fails at import (no votes module),
  an error, not an assertion. The assertion control is a mutant majority rule (yes >= half): 3 failures, 1 error.

- The in-page scan change after a passed vote and the propose panel are seen by rooms-open-vote.ts (hook and DOM); the
  hud flash text and the spoken lines were not looked at on a screenshot or heard, only their keys in `said`.
- rooms-open-vote.ts against an origin/main build (it must fail there at the first 9, which opens the panel): not run,
  a second release build of the old tree was not made.
- train1-live.ts's new branch (9 gave kind persistent: leave, then create from the menu) was not run: it targets the
  live site, which still runs 73beb77e (9 opens the panel), and this workflow runs probes locally only. Typecheck only.
- The vote's 30 s timeout (a vote that fails) in a browser: covered by the python tests only.

## Cost notes

- Q1 worker 1: reading the existing rooms code (server 470 lines, page glue 350 lines) and the plan took 10 replies;
  edits as one python patch script per side (server, page) kept it to 2 replies each. Four Edit calls failed because the
  files had been read with cat, not Read: read files you will edit with Read. The probe did not fit in 30 replies:
  plan the probe as its own stage.
- Q1 worker 2 (probes, 26 replies): most turns went to waiting for the GPU lock (another lane held it ~20 min) and one
  failed run from the SONIC_PORTS port clash in rooms-serve.ts; a rig smoke check (curl the front) before the first
  browser run would have caught the clash without a lock wait.
- Q2 worker 1 (30 replies, finished server and page logic, not the glue): reading the course feature (course.ts,
  run.ts, laps.ts) to find a public way to build the same course took 5 replies; it has no function to build a course
  from a seed for another feature, so the glue must drive the course worker itself. Cheaper: one scout line naming the
  course feature's public API for other lanes, and a stage split server+logic / glue / probe from the start.
- Q2 worker 2 (glue, probe, deploy fix): the glue fit in 4 replies once the whole plan was in the status file; finding
  how a probe can pass gates took 3 (no teleport in the page; the probe writes the sim's position along `race.path`).
  Cheaper: a scout line naming the probe's way to fly a course, and release-rooms.sh's FILES checked at Q1.
