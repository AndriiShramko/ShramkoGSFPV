# Lane tracks2 (train 2): generated courses that a pilot can pass, and courses on small scans

Worktree C:/dev/gsfpv-rooms, branch tracks2 (from origin/main f0d8b146). Ports 5720-5739. Evidence and logs:
U:/Temp/gsfpv-train2/tracks2/.

## Status

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

## Decisions

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

- The sound lane's stall at gate 4 (sonic-int-review-r10): its seed is not in the evidence, so it is not reproduced in
  Node; whether the turned-back gate is its cause is a guess until the sound lane runs again on this branch.

## Cost notes

- K1 worker 1: most turns went to waiting on tests slowed by ten parallel audits on the same CPU (one vitest run timed out at 60 s); start the long audits after the unit tests, or with fewer processes.
- K1 worker 2: most turns went to finding why the tiny room got 1 gate (two diagnostic runs) and to the stale sonic-fpv
  submodule that broke apps/fly tsc; a diagnostic script that prints the walk's options per step from the start, and
  `git submodule status` in the resume check, would have saved about four turns.

