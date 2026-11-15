# Train 3: lead note

Source: the owner's message 51 (2026-11-14) after he flew release 4e9148cd1005 (main f91273cf). His points: progress of the walls build and of the course generation; gates spread over the well-scanned extent at eye level; the course tied to the respawn; a course editor like ordinary 3D editors inside the same scene; the laptop agent's branches and weak computers; Fly by Sound in any scene; the consultant's advice; fast flight by sound.

## Status

- [x] Wave 1 (night of 2026-11-14): lanes editor3, course3, sonic3 built their code; one review each; fixes started. No lane finished its browser proof (the GPU lock was held for 24 minutes around a Node audit; the walls build of Wroclaw holds the page's main thread for 13.5 s, 10 s and up to 21 s).
- [~] Wave 2 (2026-11-15), three chains: course3f; editor3f then laptop; sonic3f then hearing (a design document only).
- [x] Published walls of the nine catalogue scans are live since 2026-11-15: lighter re-bakes assembled by the lead in U:/Temp/gsfpv-train3/walls/release (148,581,855 bytes with the .gz copies; Wroclaw 17,615,280 raw and 9,670,306 gzip at 10 cm); deploy/release-walls.sh copies the .gz and checks the hub's free room first (7.1 GB free before the upload). Local pre-check and the live page probe: all nine pass (source published, no build, 20 passes at 25 m/s stop at the walls). The walls-published-probe of deploy/live-checks.sh passes from now on.
- [ ] Integration of train 3 (branches editor3, course3, sonic3 with the package's branch train3, laptop3), then the release by the lead.
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
