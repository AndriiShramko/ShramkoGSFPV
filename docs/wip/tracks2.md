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
- [ ] K1.2 small scans: scale gate size, leg length and gate count to the free space, down to the smallest drone
  (measure it from the drone definitions), so that Forest Floor ab5efa0e gets a course; else the smallest sensible course
  or a next step the page takes by itself. Unit tests on the Forest Floor walls file and a synthetic tiny room.
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
- Generation time on 887f27aa: 15.5-22.9 s a course in Node (the audit's ms per row).

## Decisions

- The fix is in the path, not in the walk: gates and their order stay as the walk laid them, so a seed whose course had
  no turned-back gate keeps its gates and trackDigest. A course with such a gate keeps its gates too unless the new sweep
  of the turn after a gate finds a wall; then the final proof drops that gate (the digest changes for those seeds).
- AFTER_GATE_M 1 m and EXIT_TURN_COS 0.5 (60 degrees) are estimates; the exit is capped at 0.4 of the shorter leg, inside
  the run through the gate that checkTrack already proves.

## For the lead

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

