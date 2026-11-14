# Lane tracks2 (train 2): generated courses that a pilot can pass, and courses on small scans

Worktree C:/dev/gsfpv-rooms, branch tracks2 (from origin/main f0d8b146). Ports 5720-5739. Evidence and logs:
U:/Temp/gsfpv-train2/tracks2/.

## Status

Stage K2-editor-rest (the editor's leftovers of lane tracks, C:/dev/gsfpv-v03/docs/wip/tracks-edit.md).

- [x] K2.1 the selected gate in view: apps/fly/src/course/editor/camera.ts (gateCamera: the eye between the paused drone
  and the gate, CAM_NEAR_M 3.5 from it, CAM_UP_M 0.6 up, stopped 0.3 short of the first wall by a ray of the flown walls;
  inView). course.ts showEd sets session.cameraOverride and renderer.setCameraLookAt on every open, selection and change;
  closeEdit gives the camera back; the arrows move the gate by the camera's forward. Hook: course.editor.view {eye, at}.
  Shift+B with no course shown now makes one and opens the editor on it (it said "no course" before).
- [x] K2.2 vote after a lap on the server: apps/api/tracks.py vote() refuses an up or down vote without `lap` (int ms,
  LAP_MIN_MS 1000 to LAP_MAX_MS 3600000, estimates) with 403 lap-first; 0 (take back) needs none. The page sends its best
  lap of that course (rules.ts lapOf over the best-lap keys, store.ts vote(..., lapMs)).
  Tests: tools/bench/test/tracks-k2.test.ts (5), apps/api/tests/test_tracks_edit.py test_bad_votes (lap cases).
  Commit 9938ab02.
- [x] K2.3 (1f144501) local release built at 9938ab02 (exit 0); tracks-page probe section E gains the camera checks
  (hook view and magenta pixels on opening and after Tab, magenta pixels on each shot). Run:
  `EDITOR_ONLY=1 SONIC_PORTS=5720-5739 EVIDENCE_NAME=tracks2-k2-editor npx tsx src/tracks-page.ts` 25 PASS, 0 FAIL, exit 0
  (log U:/Temp/gsfpv-train2/tracks2/k2/probe.log). Shots U:/Temp/gsfpv-train2/shots/tracks2-editor-1920.png and
  tracks2-editor-844.png, looked at: 1920 the magenta gate 1 is in the middle of the view, whole, left of the window;
  844 only its left edge shows, the window covers the middle of the screen (see Left).
- [x] gates.py --only vitest,architecture,i18n,b18: all four PASS (vitest 122 s), logs U:\Temp\gsfpv-gates-20261114-015316.
- [x] K2.6 (f723ebcc) the editor's camera looks right of the gate by the window's share of the width: camera.ts aimAt
  (the look turns right by atan((1 - free) * tan(hFov / 2)), free = panel.root's left edge / innerWidth; no turn when free
  is under AIM_MIN_FREE 0.2, an estimate, or 0.98 and up), screenX; course.ts aim() on every showEd and on window resize
  while the editor is open; hook course.editor.view gains `look` and `free`. Test tools/bench/test/tracks-k26.test.ts (3),
  NEG OK on camera.ts of 544f7b48 (AssertionError: aimAt undefined). The probe's shot checks count magenta left of the
  window's box (tracks-page.ts colours(..., leftShare)).
- [x] K2.6 probe (commit with this line): release built at f723ebcc (exit 0, U:/Temp/gsfpv-train2/tracks2/k26/build.log);
  `EDITOR_ONLY=1 SONIC_PORTS=5720-5739 EVIDENCE_NAME=tracks2-k26-editor npx tsx src/tracks-page.ts` 27 PASS, 0 FAIL, exit 0
  (log U:/Temp/gsfpv-train2/tracks2/k26/probe.log). Shots looked at: 1920 the magenta gate whole, left of the middle, left
  of the window; 844x390 the magenta gate whole in the free left part, the window from x 400.
- [ ] K2.4 Space "drop a gate here" while flying; K2.5 pillar pairs as /2 objects with a key (see For the lead).

Stage K1-passable-and-small.

- [x] K1.1 audit tool: packages/tracks/src/fly.ts (flyPath, gateMisses: the course's own path flown through its own
  LapTimer, one straight step per 60 Hz frame) and tools/bench/src/tracks-audit.ts (many seeds per walls directory).
- [x] K1.1 cause found and fixed: a gate whose leg out turns back more than 90 degrees from its axis is only touched by
  the path at its centre, never crossed; fix in path.ts (gateExit, the point after such a gate), check.ts (the turn after
  the gate is swept), generate.ts (the one-gate trial proof is open). Unit tests packages/tracks/test/fly.test.ts.
- [~] K1.1 audit with the fix: 200 seeds per scan on all readable walls. The old-code run was started detached
  (U:/Temp/gsfpv-train2/tracks2/audit-old/<id>.json and .log, 10 scans; 887f27aa takes about 1 h); read its summaries
  into Facts, then run the same command with the fix into audit-new/ (command in tools/bench/src/tracks-audit.ts header;
  walls: C:/dev/gsfpv-v03/.cache/scenes/887f27aa and U:/Temp/gsfpv-train2/walls/release/<id>/v<n>).
  The K1.1 commit is 042ea41a. The new-code audit (--fit, 200 seeds, every row with its trackDigest) was started
  detached by worker 2 into U:/Temp/gsfpv-train2/tracks2/audit-new/<id>.json and .log (launcher
  U:/Temp/gsfpv-train2/tracks2/audit-new/run.sh); read both summaries into Facts when the .json files exist.
- [~] K1.1 digests: which already-valid seeds changed. Plan: rows of audit-new carry `digest`; for the old digests run
  tracks-audit.ts WITHOUT --fit under neg_control.py with --files packages/tracks/src/generate.ts
  packages/tracks/src/check.ts (old versions; path.ts and fly.ts stay new, the old check.ts imports nothing new) on a
  subset (all seeds on the small scans, 20 seeds on 887f27aa), --out audit-olddigest/<id>.json, and compare per seed.
  Do not start other runs while the swap is in place. pathM (in the digest) sums legs only, so it does not change.
- [x] K1.2 small scans (de318e7b): packages/tracks/src/fit.ts (fitCourse: scales 1, 0.5, 0.3 with
  3 derived seeds each, then the course with the most gates, short), generate.ts (param `scale`; a scaled walk skips a
  gate with no way on), course/worker.ts (fitCourse; the check job proves a scaled course at its own margin), drone size
  measured by tools/bench/src/drone-sizes.ts. Tests packages/tracks/test/fit.test.ts (tiny room 4 x 3 x 4 m, Forest
  Floor, scale 1 unchanged); NEG OK on generate.ts of origin/main.
- [ ] K1.2 left: why 2f1ddf5f and d10c5638 find 0 m3 at the CDN camera spawn (freeSpace start not found).
- [ ] K1.3 For the lead: final hooks, digests and seeds for lanes rooms2, sound and walls.
- [ ] gates.py --only vitest,architecture,i18n,b18 before handing over.

## Facts (measured)

- The two failing race courses of lane rooms2 (887f27aa at size 1, seeds 792249632 and 438779389 in decimal; the race id
  g1.<seed> is decimal, the generator's own id is base 36: g1.d3onq8 and g1.798kcd) generated in Node by
  tools/bench/src/tracks-audit.ts --list: 12 gates and 9 gates as on the pages. Old code: gates 0, 2, 3, 4, 5, 9 of the
  first and 1, 2, 5, 8 of the second are not registered at 3 m/s and at 12 m/s, cause turns-back-at-gate for every one
  (U:/Temp/gsfpv-train2/tracks2/fail2.json). With the fix: 0 missed, 0 failing; the courses are now 16 gates together
  (gates whose turn after them is blocked are dropped by the final proof), U:/Temp/gsfpv-train2/tracks2/fail2-new.json.
- Old-code audit, first scans done (200 seeds each, U:/Temp/gsfpv-train2/tracks2/audit-old/<id>.json): ab5efa0e Forest
  Floor: 200 of 200 courses have 1 gate (free volume 29.3 m3, 1 room), all fail turns-back-at-gate; 2f1ddf5f and
  d10c5638: no free space found at the CDN camera spawn (0 m3, start not found), 0 gates for all seeds.
- Unit tests: packages/tracks 8 files, 91 tests passed before the last edit; fly.test.ts and path.test.ts 6 of 6 after
  it. Negative control (neg_control.py, path.ts and check.ts of origin/main): NEG OK, the 6-seed test fails by assertion
  (50 gates missed on the old code, 0 now). tsc -p packages/tracks: exit 0.
- Drone sizes (tools/bench/src/drone-sizes.ts, compileParams boundRadius): smallest air65-1s and meteor65pro-1s
  0.0425 m, largest taurusx8-komodo-6s 0.3175 m. Smallest scale 0.3: ring 0.36 m = 4.2 diameters of the smallest drone.
- Forest Floor ab5efa0e with fitCourse (tracks-audit.ts --fit, seeds 1-20, before the way-on rule): 20 of 20 courses at
  scale 0.5 with 5-10 gates (149 gates), 0 missed at 3 and 12 m/s; mean 1911 ms a course (three tries at scale 1 first).
  U:/Temp/gsfpv-train2/tracks2/k12/ab5efa0e-fit20.json.
- Tiny room 4 x 3 x 4 m (U:/Temp/gsfpv-train2/tracks2/k12/diag.ts): free 15.7 m3, cellM 0.4; scale 1 and 0.5: 0 gates;
  scale 0.3 before the way-on rule 1 gate (the walk went to a corner, every next leg turned back over 120 degrees); after
  it 12, 11, 5 gates for seeds 1-3, all proven and flown.
- packages/tracks tests after K1.2: 9 files, 97 passed (vitest log U:/Temp/gsfpv-train2/tracks2/k12/tracks-tests.log);
  tsc packages/tracks exit 0, apps/fly tsc clean.
- Worktree: packages/sonic-fpv was checked out at 378cc50 (not the recorded 598a98f9; apps/fly tsc failed on sonic
  files); worker 2 ran git submodule update, apps/fly tsc is clean after it. The K1.1 audits and test runs before that used
  378cc50.
- Generation time on 887f27aa: 15.5-22.9 s a course in Node (the audit's ms per row).

- K2 runs: tools/bench/test/tracks-k2.test.ts + tracks-finish + tracks-fixes 18 passed; apps/api test_tracks_edit 21 OK;
  tsc apps/fly and tools/bench clean. Negative controls (neg_control.py --ref origin/main): tracks.py NEG OK (1 failure,
  test_bad_votes), rules.ts + camera.ts NEG OK (by import, camera.ts absent on origin/main).
- K2 probe camera values: opening eye 3.3 m from gate 1 (at 2, 8.8, 13.4), 7969 magenta px; after Tab gate 2, 8866 px;
  shot 1920x1080 22634 px, shot 844x390 1658 px (the gate is mostly under the window there).
- K2.6 probe values (tracks2-k26-editor): 1920x1080 window left 1532 (free 0.798), magenta 26368 px, all left of the
  window; 844x390 window left 400 (free 0.474), magenta 9721 px, all left of the window (1658 px before K2.6). On opening
  (probe viewport) free 0.697, 11066 px. Unit tests tracks-k26 + tracks-k2: 8 passed; tsc apps/fly and tools/bench clean.

## Decisions

- K2 camera: the simplest view that keeps the gate in sight and never in a wall: between the paused drone and the gate,
  the way cast against the flown walls (an orbit camera needs a render-pc camera mode, outside the lane). CAM_NEAR_M,
  CAM_UP_M, CAM_WALL_GAP_M and the vote's LAP_MIN_MS / LAP_MAX_MS are estimates.
- K2 vote rule on the server is a lap time in the body, not a proof: a script can send one, as it could press the button.

- The fix is in the path, not in the walk: gates and their order stay as the walk laid them, so a seed whose course had
  no turned-back gate keeps its gates and trackDigest. A course with such a gate keeps its gates too unless the new sweep
  of the turn after a gate finds a wall; then the final proof drops that gate (the digest changes for those seeds).
- AFTER_GATE_M 1 m and EXIT_TURN_COS 0.5 (60 degrees) are estimates; the exit is capped at 0.4 of the shorter leg, inside
  the run through the gate that checkTrack already proves.

- K1.2: the scaled courses shrink every length by one factor (gates, the free radius a gate needs, legs, spacing, the
  proof's margin) and the free space a gate takes by its cube, so the plan's rules hold at a smaller size. Scale 1 keeps
  its params and walk exactly (fit.test.ts proves the same trackDigest), so no course that fitted before changes.
- The way-on rule (skip a gate from which no next gate is in turn range) applies to scaled courses only, to keep scale 1
  digests; whether scale 1 would also gain from it is not measured.
- Forest Floor's walls are not committed (another author's scan): its test runs where the file is
  (GSFPV_FOREST_FLOOR_WALLS or U:/Temp/gsfpv-train2/walls/release/ab5efa0e/v2) and is skipped elsewhere; the tiny room
  test always runs.

## For the lead

- K2 release needs the API file apps/api/tracks.py (vote() lap rule, LAP_MIN_MS, LAP_MAX_MS) deployed together with the
  page: the new server refuses a vote of the old page (no `lap`) with 403 lap-first, and the new page's votes carry `lap`.
  No other API file changed (tracks_admin.py, server.py, nginx unchanged); apps/api/tests/test_tracks_edit.py updated.
- K2 keys a pilot uses (in flight): Shift+T show or hide a course, Shift+G a new generated course, Shift+B the editor
  (with no course shown it now makes one and opens the editor on it). In the editor: Tab / Shift+Tab select a gate (the
  camera turns to it), arrows move it by the camera's view (Shift: 1 m), PgUp / PgDn up and down, Q / E turn 15 deg,
  1 ring, 2 square, 3 dive, 4 cube frame, + / - size, Ins or I add a gate 4 m ahead, Del or Backspace remove, comma /
  period change the order, Ctrl+Z / Ctrl+Y undo and redo, G a new course, Enter save as my course, F6 into the window, Esc
  leave (twice with unsaved changes). The full table is apps/fly/src/course/editor/keys.ts KEY_ROWS.
- K2 not done (left for the next worker): Space "drop a gate here" while flying: Space is arm.toggle in KEYMAP
  (packages/prefs/src/keymap.ts line 67, also in FLYING_CODES), so it needs a decision the lane cannot take alone (a drop
  mode entered from the editor in which Space drops while armed and arms while disarmed, or another key such as Ins in
  flight); and pillar pairs as /2 `objects` with a key (the editing model and the /1 server files hold no objects;
  toTrackV1 would drop them, so it needs the /2 format on the server first).

- K1.2: the course worker (apps/fly/src/course/worker.ts) now answers a smaller course on a small scan instead of none:
  gates down to 0.3 of the plan's size (ring 0.36 m, legs 0.9-4.5 m, margin 0.15 m), and when no size reaches 4 gates
  the course with the most gates (short: true). `track: null` is left only when not one gate fits at 0.3. A scaled
  course carries generator.params.scale, legMinM, legMaxM and its marginM. Its seed may be a derived one, as before.
  Pages that fly at the plan's 0.5 m margin must take marginM from the track (the worker's check job does).

- Preliminary (K1.3 will finalise): coursePath now adds one point after a gate whose leg out is more than 60 degrees off
  its axis, and after the last gate of an open course (at most 1 m along the gate's axis). Lanes rooms2 and sound fly or
  play this path: an open course's path now ends just through its last gate, not on it. trackDigest is unchanged for a
  seed unless the new sweep of the turn after a gate drops a gate; the two race seeds 792249632 and 438779389 on 887f27aa
  (size 1) changed from 12 and 9 gates to 16 together, both pass at 3 and 12 m/s.
- Commit attribution follows the session's attribution line (Opus 5.5), not the Fable 5.2 line of the task text.

## Not verified

- K2: Shift+B with no course shown (it now generates one and opens the editor) was not run in a browser; only the
  typecheck covers it. The camera in a scan where a wall stands between the drone and the gate was not run in a browser
  (the unit test covers the stop-short rule). The whole tracks-page probe (hint flights, A-C3) was not run, only E and E3.
  apps/api: only test_tracks_edit was run, not the whole apps/api suite.

- The sound lane's stall at gate 4 (sonic-int-review-r10): its seed is not in the evidence, so it is not reproduced in
  Node; whether the turned-back gate is its cause is a guess until the sound lane runs again on this branch.

## Cost notes

- K2 worker 1: most turns went to reading course.ts and the probe in slices to find the hook points (camera override,
  vote path, probe colour helper); a short "editor hook points" list in docs/agent-map.md would have saved about five turns.

- K1 worker 1: most turns went to waiting on tests slowed by ten parallel audits on the same CPU (one vitest run timed out at 60 s); start the long audits after the unit tests, or with fewer processes.
- K1 worker 2: most turns went to finding why the tiny room got 1 gate (two diagnostic runs) and to the stale sonic-fpv
  submodule that broke apps/fly tsc; a diagnostic script that prints the walk's options per step from the start, and
  `git submodule status` in the resume check, would have saved about four turns.

