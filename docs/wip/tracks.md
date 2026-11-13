# Lane tracks (train 1): status

Plan: docs/wip/train1-plan.md section 3; design docs/wip/tracks-plan.md. Branch `tracks`, worktree C:/dev/gsfpv-tracks.

## Status

### T1 core (Node only) - NOT FINISHED (worker 1 stopped at its budget)
- [x] package `@gsfpv/tracks` (packages/tracks), lock updated (pnpm install, +12 lines); proof moved from tools/bench/src/sonic-track-check.ts into packages/tracks/src/check.ts, bench re-exports it; sonic-garden + sonic-scan-world 26/26 green after the move (d2796de0)
- [x] tests with controls: packages/tracks/test/generate.test.ts (three rooms, determinism, hole) and path.test.ts (coursePath): 11/11 green, every control is an assertion inside the test and fires (c3536327); clearance = chamfer less half a cell
- [x] architecture rule 8 for packages/tracks in scripts/check-architecture.mjs (imports, DOM, clock, Math.random; no trig outside check.ts); negative: a file with Math.random() and Math.sin() is reported (a3f406e4)
- [x] evidence script tools/bench/src/tracks-generate.ts (a3f406e4); evidence/2026-11-13/tracks-generate.json + PNGs exist but come from an intermediate generator (see Findings), NOT from the committed generator: rerun needed
- [ ] LEFT 1: the generator's walk on real walls. Committed generate.ts = the a3f406e4 version (tests green). On real walls it makes 1-4 gates of 24 wanted and is slow (887f27aa: about 44 s a course; a full evidence run did not end in 900 s). Causes found: (a) every candidate is proven with the whole course so far (checkTrack over all gates, a ring outline is about 280 sweeps): make it a one-gate proof (start = where the walk stands, gates = [new gate]); (b) the final loop pops gates until the last gate sees the start in a straight line: on big scans that leaves 1-2 gates. Tried in 4b32d3e5..working copy and reverted: walk over the whole pool (no farthest-point sample), farthest-first options, a "back" half that walks toward the start, close at the last gate that sees the start or else an open course (laps 1). With farthest-first options every one-gate proof failed in the three-rooms world (0 gates, tests red) even after also sweeping the run past the gate; the cause is not found. Suggested: keep the farthest-point sample of a3f406e4 (it works in the tests), add only (a) and the open-course fallback of (b), measure with `npx tsx src/tracks-generate.ts --scenes 7a475d38` (15 s) before the full run.
- [ ] LEFT 2: rerun the evidence on the final generator (all scenes, under 10 min), commit evidence/<date>/tracks-generate.json and the PNGs; look at the PNGs.
- [ ] LEFT 3: fill "What T2 gets" below from the final code (names are there already).

### What T2 gets (from packages/tracks/src, import '@gsfpv/tracks')
- `freeSpace(walls: VoxelCollision /* flown */, opts: FreeSpaceOptions): FreeSpace`; opts `{spawn: Vec3 (flown), marginM?, boxM?, maxCells?, enclosureMin?, rayM?, minRoomM3?, kind?: 'auto'|'indoor'|'outdoor', floodFill?}`; `FreeSpace {cellM, origin, dims, flip, marginM, solid, clearance, room, rooms, volumeM3, outdoor, startCell, stats, digest}`; helpers `cellCentre`, `cellOf`, `clearanceM`, `FREE_DEFAULTS`.
- `generateCourse(free, walls, opts: CourseOptions): TrackFile` (`shramko-sonic-track/1`, id `g1.<seed36>`, title `Course <seed36>`, author/generator `gsfpv-course`); `CourseOptions {seed, scene: {id, version}, transform: SceneTransform, params?: Partial<CourseParams>, created?: string (the package reads no clock), rng?}`; `CourseParams {marginM, legMinM, legMaxM, turnCosMin, axisCosMin, gatesMin, gatesMax, m3PerGate, tries, spacingM, laps}`; `COURSE_DEFAULTS`, `courseCount`, `courseId`, `courseTitle`, `yawQuatStep`, `nearestYaw`. A course with 0 gates means nothing fits (not a valid TrackFile: T2 must say so to the pilot).
- `checkTrack(track, col, transform, marginM = 0.5, measure = true): TrackReport`, `withGateAt`, `provenMargin`, `flownCollision`, `sweeperOf`, `freeRadius`, `nearestWall`, `outlineOf`, `frame`, `flownStart`.
- `coursePath(track, transform = track.transform): WorldCheckpoint[]` (flown; points at most 6 m apart, one 1.5 m before each gate, stage k on gate k's centre, the return leg to the start), `pathProblems(path, track, transform, sweeper?, radius?)`.

### T2 flight
- [ ] not started

### T3 server and probe
- [ ] not started

## Findings
- Real walls are copied from C:/dev/ShramkoGSFPV/.cache/scenes (read only) into this worktree's .cache/scenes (gitignored): 7a475d38, 887f27aa, 39e63ce9, bd04e182. bd04e182 is not usable: its scene.voxel.json is missing there and the CDN answers 403.
- Free-space pass, measured (intermediate run, same freespace.ts as committed): Winter Garden x5 (16 cm flown voxels, 0.64 m cells, 2.05 M cells) 935 ms, arrays 9.8 MB; 887f27aa (0.6 m cells, 1.63 M cells) 959 ms, 7.8 MB; 39e63ce9 (0.2 m cells, 0.58 M cells) 295 ms, 2.8 MB; process peak RSS 188 MB.
- Both real scans are detected as outdoor (the fill reaches more than 30 % of the box border), so the enclosure threshold has no effect on them (usable cells equal at 0.5, 0.7, 0.9). Only the analytic hole test exercises it.
- 39e63ce9 (the fixture scene of the page probes) gives no usable cell at the defaults (727 reachable cells, about 6 m3, under minRoomM3 8): T3's probe "page A generates, gates > 0" cannot use it as is. Choose another cached scene for T3 or lower minRoomM3 for small scans (decide in T2).
- The three-room analytic world comes out as one room (the 2.5 m door is wider than one erosion step): rooms are components, not rooms, until a better split exists.

## Decisions
- check.ts keeps its trigonometry (ring outline, angles): it is the proof, not the generator; rule 8 exempts it. The generator, free space, path and rng use + - * /, Math.sqrt, Math.round/floor/ceil/trunc/imul and a 9-entry cosine table.
- `created` is an option (default 2026-01-01T00:00:00.000Z) because the package reads no clock; T2 passes the real time.
- FreeSpace.digest is FNV-1a 32 over parameters, grid size and rooms (not sha256 of the walls digest as plan 2.1 says): cheap, deterministic; the walls digest is the caller's to add.
- Per-room gate caps (plan 2.2 "at most ceil(N / rooms) + 2 in one room") and dive gates, pillars, zones are not built (R1 at its smallest).
- The flood-fill control of the three-room test is asserted on the free space (C has usable cells without the fill), not on gates: with the fill off the leg sweep still keeps gates out of a sealed room, so a gate-level control would not fire.
- The hole test uses kind 'indoor' explicitly: the open yard would trip the outdoor detection.

## For the lead before the merge
- tools/bench/package.json and packages/tracks are new dependencies in pnpm-lock.yaml (lane tracks owns the lock).
- Sound mode: the course gives the beacon its points through coursePath (T2 wires ScanSonicWorld.checkpoints).

## Not verified
- The committed generator on real walls (LEFT 1): only the analytic worlds are proven by tests.
- Determinism across browsers (only Node runs here).

## Cost notes
- T1 worker 1: most turns went to the generator's walk on real walls (three rewrites, each followed by a 2-10 min run); the evidence run without a time budget per scene hit the 900 s timeout once. Cheaper: run the evidence on one scene with a 60 s cap first, and print walked/stop/tries from the first version on.
