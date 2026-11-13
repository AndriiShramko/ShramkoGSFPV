# Lane tracks (train 1): status

Plan: docs/wip/train1-plan.md section 3; design docs/wip/tracks-plan.md. Branch `tracks`, worktree C:/dev/gsfpv-tracks.

## Status

### T1 core (Node only) - DONE
- [x] package `@gsfpv/tracks` (packages/tracks), lock updated (pnpm install, +12 lines); proof moved from tools/bench/src/sonic-track-check.ts into packages/tracks/src/check.ts, bench re-exports it; sonic-garden + sonic-scan-world 26/26 green after the move (d2796de0; check.ts not changed since)
- [x] tests with controls: packages/tracks/test/generate.test.ts (three rooms, determinism, hole) and path.test.ts (coursePath): every control is an assertion inside the test and fires (c3536327); clearance = chamfer less half a cell
- [x] architecture rule 8 for packages/tracks in scripts/check-architecture.mjs (imports, DOM, clock, Math.random; no trig outside check.ts); negative: a file with Math.random() and Math.sin() is reported (a3f406e4)
- [x] evidence script tools/bench/src/tracks-generate.ts (a3f406e4, progress lines and proven margin later)
- [x] generator on real walls (worker 2): one-gate proofs; walk over the whole strided pool (no farthest-point sample); a blocked leg does not use a candidate up; out half within 2 longest legs of the start, back half toward the start; course closed (laps 3) at the last gate at least half way that sees the start, else open (laps 1, coursePath then has no leg back); generator proof unmeasured; params walked/stop/closed (bf7dc3d9, b8103a0f). Tests 12/12 green (new: open course path, NEG OK against HEAD path.ts); typecheck of @gsfpv/tracks and tools/bench exit 0
- [x] evidence rerun on the final generator: evidence/2026-11-13/tracks-generate.json + tracks-generate-7a475d38.png, -887f27aa.png (run 4 min 17 s): 9 courses, 6 with gates, 6 proven, 6 valid, all closed; Winter Garden 24/13/24 gates in 0.7-1.4 s, 887f27aa 17/22/23 gates in 21.5-23.9 s; 39e63ce9 0 gates (no usable cell); beacon path problems 0 on all 6; proven margin of seed 1: 0.533 m (WG), 0.576 m (887f27aa); peak RSS 186.5 MB. PNGs looked at: gates across the legs, the out half a wide loop, the back half tangles near the start (legs cross)
- [x] "What T2 gets" below checked against the final code

### What T2 gets (from packages/tracks/src, import '@gsfpv/tracks')
- `freeSpace(walls: VoxelCollision /* flown */, opts: FreeSpaceOptions): FreeSpace`; opts `{spawn: Vec3 (flown), marginM?, boxM?, maxCells?, enclosureMin?, rayM?, minRoomM3?, kind?: 'auto'|'indoor'|'outdoor', floodFill?}`; `FreeSpace {cellM, origin, dims, flip, marginM, solid, clearance, room, rooms, volumeM3, outdoor, startCell, stats, digest}`; helpers `cellCentre`, `cellOf`, `clearanceM`, `FREE_DEFAULTS`.
- `generateCourse(free, walls, opts: CourseOptions): TrackFile` (`shramko-sonic-track/1`, id `g1.<seed36>`, title `Course <seed36>`, author/generator `gsfpv-course`); `CourseOptions {seed, scene: {id, version}, transform: SceneTransform, params?: Partial<CourseParams>, created?: string (the package reads no clock), rng?}`; `CourseParams {marginM, legMinM, legMaxM, turnCosMin, axisCosMin, gatesMin, gatesMax, m3PerGate, tries, spacingM, laps}`; `COURSE_DEFAULTS`, `courseCount`, `courseId`, `courseTitle`, `yawQuatStep`, `nearestYaw`. A course with 0 gates means nothing fits (not a valid TrackFile: T2 must say so to the pilot). `laps` 1 = an open course (its last gate does not see the start; no leg back; T2's lap timer ends a run at the last gate); generator.params carry `wanted, walked, stop ('count'|'tries'|'no candidate in reach'|'no free leg'), closed, tries, proof {ok, marginM, pathM}`.
- `checkTrack(track, col, transform, marginM = 0.5, measure = true): TrackReport`, `withGateAt`, `provenMargin`, `flownCollision`, `sweeperOf`, `freeRadius`, `nearestWall`, `outlineOf`, `frame`, `flownStart`.
- `coursePath(track, transform = track.transform): WorldCheckpoint[]` (flown; points at most 6 m apart, one 1.5 m before each gate, stage k on gate k's centre, the return leg to the start), `pathProblems(path, track, transform, sweeper?, radius?)`.

### T2 flight
- [x] LapTimer (packages/tracks/src/laps.ts) + packages/tracks/test/laps.test.ts 6/6; controls inside (skipped gate, backward pass, 5 s pause, respawn) fire; NEG OK on laps.ts (absent before) (1f11ed2a)
- [x] ScanSonicWorld.checkpoints (opts.course, setCourse; coursePath at the flown transform, cached per transform) + tools/bench/test/tracks-beacon.test.ts 2/2 (world with a course: lessonTrack 'world'; control without: 'gates'); NEG OK on scan-world.ts (both tests fail on the old file); sonic-scan-world 7/7 still green; apps/fly depends on @gsfpv/tracks (lock +3 lines)
- [x] keys: course.toggle and course.generate shipped in keymap.ts, SHIPPED_BY_TRACKS filled; tools/bench/test/tracks-keys.test.ts 2/2 (control: plain T clashes with sonic.record); NEG OK on keymap.ts. packages/prefs/test + app-keys + train1-contract: 273/274, the one failure is keymap.test.ts:160 (see "For the lead")
- [x] apps/fly/src/course: run.ts (CourseRun: flown gates, coursePath, LapTimer; fed per drawn frame with sim.tick and the craft's position), worker.ts (freeSpace + generateCourse off the main thread on a copy of session.collision), view.ts (CourseStage: own root, gates by state next/later/passed, chevrons every 2 m from the gate before the next to two ahead, BoxGeometry/TorusGeometry via Mesh.fromGeometry), hud.ts + hud.css (lap time, lap n of N, next gate, last, best; hidden with #ui.hud-off), link.ts (course=g1.<seed36>, best per id.vN.drone in localStorage 'gsfpv.course.best'); builtin/course.ts install (Shift+G, Shift+T, two pause-menu items order 72/73 section tools, hook filled, link seed rebuilt on load); locales course en/es/pl/ru (17 keys each)
- [x] tools/bench/test/tracks-a6.test.ts 1/1: 30 s scripted flight at 60 Hz frames, CourseRun fed every frame, hash equal to solo; control inside: perturb changes the hash; NEG OK on run.ts (absent before: import-level)
- [x] typecheck @gsfpv/tracks, @gsfpv/prefs, apps/fly, tools/bench: 0 errors; fly-parity + packages/tracks/test + tracks-beacon + tracks-keys: 35/35; check-architecture ok; no Cyrillic/Polish letters outside the locales in the new files
- [x] headless look (optional in T2): NOT RUN (budget), listed under "Not verified"; hook gates > 0 / drawn > 0 in a page is the first check of T3's page probe.

### What T3 gets (from T2)
- Hook window.__gsfpv.course (CourseHook) filled by builtin/course.ts: on, source ('none'|'generated'), track {id, version}, seed, gates, next, drawn (CourseStage.drawn: gate parts + chevron arms, 0 when hidden), laps, lastLapMs, bestLapMs, beaconPoints (coursePath length), problem ('no walls' | 'nothing fits' | worker message).
- Generate: key Shift+G (action course.generate) or menu item id 'pause.course'; toggle: Shift+T (course.toggle) or 'pause.course.toggle'. A generate is async (worker); poll hook.source === 'generated'. The URL gets &course=g1.<seed36> by history.replaceState after a generate; opening that link rebuilds the course when session.collision exists at install or at the next 'session' event.
- Fixture scene 39e63ce9 gives 0 gates at the defaults (T1 finding): the probe must use 7a475d38 (Winter Garden, 0.7-1.4 s in Node) or T3 lowers minRoomM3 for small scans. Expect problem 'nothing fits' on 39e63ce9 as is.
- A source 'server' and the store (apps/fly/src/course/store.ts) are T3's; setTrack(track, 'server', null) inside builtin/course.ts is the seam (make it reachable from store.ts).

### T3 server and probe
- [x] server: apps/api/tracks.py (store DATA_DIR/tracks/<scene>/<id>/v1.json + index.json, atomic writes with fsync, index rebuilt when lost, disk guard 507, validator port + contract, server id `<scene>-<8 hex>` and created, LIMITS table of estimates), routes wired in server.py (header, _trhits, TRACKS, _tracks); packages/tracks/src/server.ts validateServerTrack (TS twin); 27 shared fixtures (3 valid, 24 invalid) in apps/api/tests/fixtures/tracks. test_tracks.py 13/13 (controls: 413, 400 invalid fixture, 429 on the 11th, 409 on the 21st, 507, newest first + ETag 304, index rebuilt, failed write leaves nothing; each with its passing twin); fixtures.test.ts 29/29 (TS agrees on every file; control: author.kind person passes validateTrack, fails the contract); NEG OK on tracks.py+server.py and on server.ts+index.ts (absent before); test_sessions.py still OK
- [x] nginx: `location ^~ /api/tracks` directly after `location = /api/roadmap`; test_nginx_tracks.py 4/4 (controls: block cut -> static site; 10 mutated configs each caught, among them $proxy_add_x_forwarded_for); NEG OK on nginx.conf; test_nginx_routes.py still OK (21 nginx tests); README row; docs/tracks-api.md
- [ ] client: apps/fly/src/course/store.ts (list on scene load, load newest on request with checkTrack in the worker, "Save for everyone"), locales
- [ ] page probe tools/bench/src/tracks-serve.ts + tracks-page.ts and its three controls; evidence/<date>/tracks-page.json

## Findings
- Real walls are copied from C:/dev/ShramkoGSFPV/.cache/scenes (read only) into this worktree's .cache/scenes (gitignored): 7a475d38, 887f27aa, 39e63ce9, bd04e182. bd04e182 is not usable: its scene.voxel.json is missing there and the CDN answers 403.
- Free-space pass, measured (intermediate run, same freespace.ts as committed): Winter Garden x5 (16 cm flown voxels, 0.64 m cells, 2.05 M cells) 935 ms, arrays 9.8 MB; 887f27aa (0.6 m cells, 1.63 M cells) 959 ms, 7.8 MB; 39e63ce9 (0.2 m cells, 0.58 M cells) 295 ms, 2.8 MB; process peak RSS 188 MB.
- Both real scans are detected as outdoor (the fill reaches more than 30 % of the box border), so the enclosure threshold has no effect on them (usable cells equal at 0.5, 0.7, 0.9). Only the analytic hole test exercises it.
- 39e63ce9 (the fixture scene of the page probes) gives no usable cell at the defaults (727 reachable cells, about 6 m3, under minRoomM3 8): T3's probe "page A generates, gates > 0" cannot use it as is. Choose another cached scene for T3 or lower minRoomM3 for small scans (decide in T2).
- The three-room analytic world comes out as one room (the 2.5 m door is wider than one erosion step): rooms are components, not rooms, until a better split exists.

- Generation time on 887f27aa (own size) is 21.5-23.9 s a course (Node, this machine), Winter Garden 0.7-1.4 s: the leg and gate sweeps dominate. In the browser T2 must run it off the main thread (a worker) or cut SWEEPS_PER_STEP / tries for big fine scans.
- The measured proof (checkTrack measure=true: free-radius probes up to 6 m) is slow: about 5 s on the three-room test world, 44-72 s a course on Winter Garden, more than 3.5 min on 887f27aa. The generator and the evidence no longer use it; the evidence reports the proven margin (bisection of unmeasured proofs, 0.5-1.5 m) instead.
- The back half walks toward the start and then hovers within 3-15 m of it, so its legs cross (top views). Fine for R1 at its smallest; a better back half (a target ring around the start, no crossing legs) is open.

## Decisions
- T2: the lap clock is the sim's tick (1 ms per step, sim-core DT), so a pause (the sim does not step) and a hidden tab add nothing; LapTimer.pause/resume is called on the 'pause' event too. Gate 0 is start and finish of a closed course; an open course (laps 1) ends at its last gate.
- T2: best laps in localStorage (one JSON object), not IdbKv (its stores are fixed in wallcache.ts, not this lane's) and not a setting (no def added).
- T2: no new PlayCanvas geometry kind: chevrons are two thin boxes; Mesh.fromGeometry is public and not in tools/bench/src/a1-api-check.ts USED (the check lists members, it does not scan files), so a1 was not changed.
- T2: ScanSonicWorld gets the course by an option / setCourse, not from its lesson track, so the Winter Garden lesson keeps lessonTrack 'gates'.
- Proof per candidate = one gate (start = where the walk stands); the whole course is proven once at the end and gates are dropped until it holds.
- A course that cannot close stays open (laps 1) instead of losing gates until the last one sees the start.
- check.ts keeps its trigonometry (ring outline, angles): it is the proof, not the generator; rule 8 exempts it. The generator, free space, path and rng use + - * /, Math.sqrt, Math.round/floor/ceil/trunc/imul and a 9-entry cosine table.
- `created` is an option (default 2026-01-01T00:00:00.000Z) because the package reads no clock; T2 passes the real time.
- FreeSpace.digest is FNV-1a 32 over parameters, grid size and rooms (not sha256 of the walls digest as plan 2.1 says): cheap, deterministic; the walls digest is the caller's to add.
- Per-room gate caps (plan 2.2 "at most ceil(N / rooms) + 2 in one room") and dive gates, pillars, zones are not built (R1 at its smallest).
- The flood-fill control of the three-room test is asserted on the free space (C has usable cells without the fill), not on gates: with the fill off the leg sweep still keeps gates out of a sealed room, so a gate-level control would not fire.
- The hole test uses kind 'indoor' explicitly: the open yard would trip the outdoor detection.

## For the lead before the merge
- tools/bench/package.json and packages/tracks are new dependencies in pnpm-lock.yaml (lane tracks owns the lock).
- Sound mode: the course gives the beacon its points through coursePath (T2 wires ScanSonicWorld.checkpoints).
- packages/prefs/test/keymap.test.ts:160 (not lane tracks' line) asserts that Shift+T and Shift+G route nothing on a ?sonic= page; with course.toggle / course.generate shipped ('always') they route the course. Fix at the merge, one line: `const shifted = actionFor(press(code, { shiftKey: true }), state, { sonic: true }); expect(shifted === null || SHIPPED_BY_TRACKS.includes(shifted), ...).toBe(true);` (measured: this is the only failure of packages/prefs/test + app-keys + train1-contract, 273/274).
- apps/fly depends on @gsfpv/tracks now (apps/fly/package.json, lock +3 lines).
- Sound mode still needs, to fly a generated course by sound (train 2): (1) sonic/feature.ts must pass the course to its ScanSonicWorld (`setCourse(track)` or `opts.course`) when the pilot generates or loads one, and drop it on a new scene; nothing in the sound mode reads window.__gsfpv.course; (2) a lesson template "fly a course" (world.kind 'scan', goal 'timed-course') whose track is the generated or served one instead of trackUrl (scan-lesson.ts loadLessonTrack with a fetcher); (3) speech for gate passes, laps and the best lap (the course says them only on the HUD flash now); (4) Shift+G / Shift+T work on ?sonic= pages too ('always'), so the mode's key list will list them.
- Generated catalogue: the two keys are shipped now, so the integration stage's gen-catalog run picks them up (README, llms.txt, features.json); no setting was added (packages/prefs/src/defs/course.ts stays empty).

## Not verified
- No unit test with a negative control for the open-course fallback and the out/back walk of the generator: they are shown only by the real-wall evidence (all 6 courses there closed, so the open branch ran on no real scan; its path side is tested in path.test.ts).
- bd04e182: walls not on this machine (CDN 403); 39e63ce9 gives 0 gates (no usable cell at minRoomM3 8).
- The 3 seeds 2-3 per scene have no free-radius number (only seed 1 is measured, by proven margin).
- Determinism across browsers (only Node runs here).
- T2 never ran in a browser (budget): the worker bundle (Vite `new URL('../../course/worker.ts')`), CourseStage drawing (colours, chevron orientation, torus size), the HUD block's place and H hiding it, the menu items, history.replaceState of the link, the localStorage best: all only typechecked. T3's page probe is the first real look.
- Lap detection in the page is per drawn frame (straight line between frames, an estimate of the flown arc), not per 1 ms physics step: the pure LapTimer is tested per step only.
- The localStorage key 'gsfpv.course.best' is not checked against any privacy or storage list of the site (none was read).

## Cost notes
- T1 worker 1: most turns went to the generator's walk on real walls (three rewrites, each followed by a 2-10 min run); the evidence run without a time budget per scene hit the 900 s timeout once. Cheaper: run the evidence on one scene with a 60 s cap first, and print walked/stop/tries from the first version on.
- T1 worker 2: most turns went to finding why the walk stalled on real walls (sample too sparse, then the walk ran to the scan's edge, then the measured proof took minutes). Cheaper: a scratch diagnostic that prints per gate distance to the start and the stop reason from the first run, and timing the measured proof separately before any full evidence run.
- T2 worker: most turns went to reading the flight shell's seams (context, session, keys, menu, primitives, sim-core) one grep at a time, and to Write/Edit refusing files read only through Bash (locales, stub, status). Cheaper: agent-map lines for "per-frame craft position" (ctx.session.runner.sim.s / tick), "flown walls" (session.collision) and "menu item with a key" (cinema.ts), and reading every file to be edited with the Read tool from the start.
