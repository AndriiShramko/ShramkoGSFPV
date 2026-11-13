# Stage 2 "Tracks": course generator and editor in scans (plan)

Status: design only, checked against the code on 2026-11-13. No code was changed and no test was run.
Owner's requirements R1-R8 (hub), the owner's question of 2026-11-10 ("at what stage are the generation, the obstacle
editor and the generation of obstacles in scans?"), and the sound beacon's need for path corners
(`docs/wip/sonic-beacon-plan.md` section 6: "corners of the path on scans appear only with the stage 2 generator").

Short answer to the owner's question: the **format, the validator, the "not in a wall" proof and the drawing of gates
over a scan exist** (built for the Fly by Sound scan lesson, one hand-laid course of 8 rings in Winter Garden).
**There is no generator, no free-space model, no server storage, no editor, no voting and no lap timer outside the
sound mode.**

---

## 1. What exists today (paths and lines)

### 1.1 Track model (sound package, git submodule `packages/sonic-fpv`, never edited here)

- `packages/sonic-fpv/src/contract.ts:109-116` `ObjectShape`: `ring {diameter, tube}`, `square {side, bar}`,
  `cube-frame {side, bar}`, `pillar {radius, height}`, `box {size}`, `zone {size}` (no collision). Openings face local Z.
- `contract.ts:218-221` `TrackRef {id, version}`; `:227` a scan lesson names `{sceneId, sceneVersion, transform, track}`.
- `contract.ts:236-255` `TrackFile`: `format` (`'shramko-sonic-track/1'`, `:50`), `id`, `version`, `parent`, `title`,
  `scene {kind: scan|lesson, id, version}`, `transform` (the scene size it was laid for), `gates[]`, `laps`,
  `start: Pose|null`, `author {kind: person|agent|generator, name}`, `generator {name, version, seed, params}|null`,
  `created`. Positions in the scan frame, flown = s*p + t.
- `contract.ts:257-264` `TrackGate {id, shape, pos, quat, direction: forward|any}`.
- `contract.ts:204-216` `WorldCheckpoint {pos, dir, stage?}`: points at most 6 m apart, one about 1.5 m before each gate,
  straight line between neighbours free. Used by analytic worlds only today.
- `src/track/validate.ts:17-21`: `TRACK_ID`, `GATE_ID`, `MAX_GATES = 200`, `GATE_KINDS = ring|square|cube-frame`;
  `validateTrack` `:59` is strict (`c.keys(root, '', TOP_KEYS)` `:63`: an unknown key is refused), `parseTrack` `:187`,
  canonical `writeTrack` `:198`, `trackDigest` `:203`.
- `src/track/library.ts:1-25`: the never-in-place rule. `checkSuccession` refuses a new version that keeps no id, skips
  a number, names the wrong parent, changes the scene or changes nothing. "A copy under a new id is a fork: version 1
  with a parent" (`:18`). This is already the model R6 needs ("created", "edited", fork).
- `src/track/flown.ts:7-53`: `scanToFlown`, `flownToScan`, `shapeToFlown`, `trackToObjects` (gates as `SonicObject` in
  the flown world).
- `src/lesson/goals.ts:102` `gateCrossing(gate, a, b)` (forward crossing inside the opening, near miss),
  `:115` `gateCrossingBack`; exported through `src/lesson/index.ts:2` and `src/index.ts:8`.
- `src/lesson/runner.ts:1323-1330` `timedLine`: time of an attempt, `bestTimeMs`; goal kind
  `timed-course {laps}` (`contract.ts:403`, validated `lesson/validate.ts:284-286`, laps 1..50).
- `src/lesson/track.ts:36-42` `worldCheckpoints(world)` reads a `checkpoints` array **duck-typed from any SonicWorld**;
  `:108-118` `lessonTrack` takes, in order, world checkpoints, lesson checkpoints, course gates. So a scan world that
  exposes `checkpoints` gives the beacon its corners without a package change.

### 1.2 Track in the simulator (Winter Garden lesson)

- The only course: `apps/fly/public/sonic/tracks/7a475d38-rings-v1.json` (8 rings, diameter 0.7 m scan frame, author
  `agent`, hand laid).
- `apps/fly/src/sonic/scan-lesson.ts:1-23` (design notes), `:39-41` `trackUrl` (static file under the page),
  `:58-67` `readLessonTrack` (strict parse, same scene, same transform or refused), `:70-80` `loadLessonTrack`,
  `:154-158` `flownStart`, `:161-175` `buildScanLesson` (objects via `trackToObjects`, `prims: objectPrims(objects)`).
- `apps/fly/src/sonic/scan-world.ts:51-131` `ScanSonicWorld`: rays against the flown voxel walls plus the gates' solid
  parts (`:93-105` caches gates per transform, `:114-131` `castRay`). It has no `checkpoints` field.
- `apps/fly/src/sonic/feature.ts:140` loads the track, `:170` builds the lesson, `:256` creates a `PrimitiveStage`,
  `:365-383` shows the gates' prims for a scan lesson.
- Everything above is reachable only on a `?sonic=` page. A sighted pilot on a normal flight has no course at all.

### 1.3 Walls, voxels, "not in a wall"

- `packages/collision/src/world.ts:28` `sphereOverlaps(col, x, y, z, r)`, `:64` `VoxelContactWorld` (`sweepOne`, a swept
  sphere, used by the flight).
- `packages/collision/src/transform.ts:94` `transformCollision(base, s, t)`: the walls at the flown size.
- `packages/collision/src/mesh.ts:19-60` `usesOctree`, `blockDims` (grid in 4x4x4 blocks), `forEachBlock` (every
  occupied block with its 64-bit mask, octree walked once; analytic worlds voxel by voxel).
- `packages/collision/src/components.ts:12-40` `blockComponents`: connected components of **occupied** blocks (floaters).
  There is no component analysis of **free** space: no flood fill, no rooms, no reachability (grep for
  `flood|reachab|interior|density` in `packages/collision/src`, `apps/fly/src`, `packages/scenes/src`: no match).
- `packages/collision/src/rebuild.ts:121` `dropFloaters`, `:94` `suggestMinBlocks`; `ceiling.ts:72` `withCeiling`.
- `apps/fly/src/bake.ts:10-23`: walls baked in the browser at 5 cm (`BASE_VOXEL_M`) or refined to 1.6 cm
  (`REFINE_VOXEL_M`), opacity cut-off 0.1. The voxel walls are all the code knows of the scan's geometry; there is no
  per-region splat density.
- `tools/bench/src/sonic-track-check.ts` is the existing **proof that a course is flyable on real walls** (Node only):
  `freeRadius` `:69-87`, `sweeperOf` `:94-97`, `outlineOf` `:116-137` (opening and frame outlines), `checkTrack`
  `:195` (start clear, every opening and frame swept by a sphere of the margin, legs start->g1->g2... swept, a 3 m run
  through each gate, gate axis within 35 degrees of the leg in; `MARGIN_M = 0.5` `:37`, `AXIS_TOLERANCE_DEG = 35` `:39`),
  `provenMargin` `:291`, `withGateAt` `:323` (negative control: a gate pushed into a wall), `topView` `:368` (PNG from
  above). Tests: `tools/bench/test/sonic-garden.test.ts`, `sonic-scan-world.test.ts`.
- Scenes load only from the public CDN in the browser; the server never fetches a scene (`AGENTS.md`, `packages/scenes`
  row). **So the server can never check a course against the walls itself.**

### 1.4 Drawing, HUD, keys, flight log

- `apps/fly/src/sonic/primitives.ts:37-41` `PrimKind = box|cylinder|torus`, `PrimRole` incl. `gate`; `:67` `shapePrims`,
  `:111` `objectPrims`; `:307-383` `PrimitiveStage` (own root under `renderer.app.root`, `show(prims)`,
  `entitiesOf(id)`). PlayCanvas public API only (`tools/bench/src/a1-api-check.ts`). No arrow or cone prim.
- Features: `apps/fly/src/app/context.ts:84-124` (`FlightContext`: `renderer`, `hud`, `keys`, `menu`, `events`,
  `session`, `prefs`, `walls`, `pause`), `Feature {id, install(ctx)}` `:124`. HUD feature `app/builtin/hud.ts`; end of
  flight stats `app/builtin/summary-stats.ts` (no lap or course notion).
- Keys: `packages/prefs/src/keymap.ts:50-110`. Every letter is taken somewhere: always-on P R Y N M V C H O B L K F J,
  flying W A S D Q E (`FLYING_CODES` `:124`), sound mode T U I Z G X. A chord with Shift is a different key
  (`:17`, `actionFor` `:179-186`); Ctrl/Alt/Meta are never ours. `KeyLookup.map` (`:139`) lets a mode route its own
  table. `keymapProblems` `:196` checks clashes.
- Flight log header: `packages/sim-core/src/contracts.ts:83-105` `LifeHeader` (`collisionSha256`, `scene {id, version,
  transform, floaterMinBlocks, floaterSha256?, ceilingM?}`); world records `:71-76`. No course in it. Replays:
  `apps/fly/src/app/builtin/replays.ts` (logs saved in the tab), Fly by Sound sessions record the lesson's
  `LessonWorldRef` with its `TrackRef` (`contract.ts:227`).

### 1.5 API, nginx, admin

- `apps/api/server.py:1-70` (route list), stdlib `ThreadingHTTPServer` (`:96`), `DATA_DIR` volume (`:116`), `MAX_BODY =
  8 KB` (`:121`), `_rate(bucket, key, n, window)` in RAM (`:179-187`), client = nginx's real IP via `X-Forwarded-For`
  (`:1442-1443`), disk guard `free_gb` (`:190`), atomic writes with `os.replace` (`:893`, `admin.py:247`,
  `ideas.py:280`), honeypot and time-to-submit on leads (`:1733-1742`). Pilots have **no accounts**; the only
  per-object secret is the session upload token (`sessions.py:39`, `X-Session-Token`).
- Admin: `apps/api/admin.py:1-43` (scrypt password, SameSite=Strict cookie, `X-CSRF` on every POST, brute-force lock,
  audit `admin-audit.jsonl`), `MAX_BODY = 256 KB` `:65`, `AdminApi.add_route(method, pattern, handler)` `:638-642`
  (used at `server.py:1375-1377`): new admin routes get session, CSRF and errors for free.
- Admin UI: `apps/fly/src/admin/main.ts:12-21,54-70`: five tabs (scenes, drawing, ideas, outreach, sessions), chosen by a
  ternary at `:58`, labels `admin.tab.<k>`.
- nginx: `deploy/nginx.conf` one location per API route (`:185-373`); `^~ /api/session/` (`:218-235`) is the pattern for a
  per-client limited POST route (real-IP lines, `Cookie` and `Authorization` cleared, `no-store`). Routes are tested by
  `apps/api/tests/test_nginx_routes.py`; the contract table is `deploy/README.md`.

---

## 2. Design

### 2.1 Free space from voxels (R3)

New pure module `packages/tracks/src/freespace.ts` (DOM-free, runs in a worker and in Node):

1. **Cell grid.** One cell per 4x4x4 voxel block (20 cm at 5 cm walls, 6.4 cm at 1.6 cm; for fine walls group 2x2x2
   blocks so a cell is 10-25 cm). A cell is solid when its block mask is non-zero (`forEachBlock`, `mesh.ts:43`),
   after the pilot's floater filter and ceiling (`dropFloaters`, `withCeiling`) so the generator sees the walls flown.
2. **Clearance.** Dilate solid cells by the craft's clearance (default 0.5 m flown, `MARGIN_M`): a chamfer distance
   transform over the cell grid gives, per free cell, the distance to the nearest solid cell (integer arithmetic).
3. **Reachable space.** Flood fill (6-connected) of cells with clearance >= margin, starting from the scene's spawn
   (the course start). Only this component is used: nothing behind a wall, inside a wall or inside an object, because
   those cells are not connected to the spawn by a passage the craft fits through. Bounded to a box around the spawn
   (default 80 m flown) so a 600 m scene does not allocate a 3000^3 grid (the reason `components.ts:4-7` lists blocks).
4. **"Well scanned" score.** Per reachable cell, cast 26 rays (cell-grid DDA, not the renderer) up to `R` = 12 m flown.
   `enclosure` = share of rays that hit a solid cell. Holes in a badly scanned wall, open sky and the edge of the scan
   let rays out. Cells with enclosure < 0.7 (indoors) are dropped; outdoor scenes (owner's choice of scene type, or
   detected: the fill touches the box border over > 30 % of its faces) use the floor-and-near-walls variant: the down
   ray must hit within 6 m and the cell must be within 8 m of a solid surface. Then a second flood fill keeps only the
   largest well-scanned component touching the spawn. Rooms: the components of the well-scanned set after one erosion
   step (doorways disappear), dilated back; each room keeps its own volume, so "all rooms with good density" means the
   generator visits every room whose volume is above a minimum (default 8 m3 flown).
5. Output `FreeSpace {cellM, origin, dims, clearance: Uint8Array, room: Int16Array, rooms: {id, volumeM3, centroid}[],
   digest}`; `digest` = sha256 of the walls digest (`collisionSha256` + floater + ceiling + refine size), the transform,
   the bounds and the parameters.

Splat density proper is not in the walls. The voxels come from Gaussians with opacity above 0.1 (`bake.ts:12`), so a
voxel exists only where the scan is dense enough; the enclosure score measures the holes that sparse scanning leaves.
Reading the splats themselves for density is an open option, not part of this plan (section 5).

### 2.2 Placement rules and counts (R1)

`packages/tracks/src/generate.ts`, `generateCourse(free, walls, {seed, params}) -> TrackFile`:

- **Count from volume.** `V` = well-scanned reachable volume, flown m3. `N = clamp(round(4 + V / 40), 4, 24)` gates; at
  most `ceil(N / rooms)` + 2 in one room while other rooms have none. Leg length 3-15 m flown (scaled for the scene
  size, so a x5 Winter Garden and a hall at x1 both get a course a sim pilot recognises).
- **Kinds from local room.** The free radius at the gate centre picks the shape: >= 2.2 m: square race gate 1.5 m
  opening (`square`, bar 0.1); 1.4-2.2 m: ring 1.2 m (`ring`); a cell where the free height is >= 3 m and a horizontal
  plane is free: a dive gate (square, axis vertical); between two gates on a long straight leg with lateral room
  >= 3 m: a slalom pair of `pillar`s (non-gate objects, `order: null`, needed later for solid obstacles); the start
  and finish: a `zone`. Sizes are written in the scan frame (divided by `s`), as the format wants.
- **Order.** Random walk over room centroids (seeded), then within a room a farthest-point sample of candidate cells
  with clearance >= margin + half the gate; each next gate 3-15 m from the last, turn at a gate <= 120 degrees, gate
  axis = direction of the leg in (rounded to one of 16 yaws with literal quaternions, so the result needs no
  `Math.sin`), legs straight and free (swept sphere), the last leg returns to the start for laps.
- **Check.** The finished course goes through `checkTrack` (moved from `tools/bench/src/sonic-track-check.ts` into the
  package, bench re-exports it) at the margin. A failed candidate gate is dropped and the next candidate tried; after
  200 tries the course is shorter, never invalid. The proof's result (min free radius, path length) goes into
  `generator.params.proof`.
- **Determinism.** Seeded RNG (the package's own `util/rng`-style mulberry32 copy, no `Math.random`), only `+ - * /`,
  `Math.sqrt`, integer grids and table yaws (the `sim-core` rule, `AGENTS.md`). Output rounded to 1 mm and 1e-6 in the
  quaternion. Same seed + same walls digest + same generator version = same `trackDigest`, in Node and browsers.
  `generator {name: 'gsfpv-course', version: '1', seed, params: {wallsDigest, margin, cellM, N, rooms, proof}}`.
- **"Not in a wall" twice.** Generator time (above) and load time: every client runs `checkTrack` on its own walls
  (they may be refined or filtered differently) before showing a course; a course that fails there is shown red with
  the failing gate named, still flyable on request, and reported to the API as `broken-here` (counted, not trusted).

### 2.3 Visible course (R2)

`apps/fly/src/course/view.ts` with a `CourseStage` built like `PrimitiveStage` (`primitives.ts:307`):

- gates as today's prims (`objectPrims`), colour by state: next = bright, later = dim, passed = grey;
- **arrows**: chevrons every 2 m along the path (2.4) between the current and the next two gates, a new prim kind
  `cone` (PlayCanvas `ConeGeometry`, public API, add it to the a1 API check) or two thin boxes per chevron, flat at
  flying height; a floor line under the path at 30 % opacity;
- a numbered tag over each gate (DOM overlay projected each frame, hidden with H like the rest of the HUD);
- an off-screen pointer at the screen edge toward the next gate (HUD).

### 2.4 Sound course (beacon, blind pilots)

- `packages/tracks/src/path.ts` `coursePath(track, transform) -> WorldCheckpoint[]`: start, then for every leg points at
  most 6 m apart, one 1.5 m before each gate facing it, `dir` horizontal, `stage` = gate index on the point that ends the
  stage. These are exactly the rules of `contract.ts:204-216`, so the sound package's track model accepts them.
- `ScanSonicWorld` (`scan-world.ts:51`) gains a `checkpoints` getter (flown, recomputed with the transform as gates are
  at `:93-105`). `worldCheckpoints` (`lesson/track.ts:36`) picks it up duck-typed, `lessonTrack` returns kind `world`,
  and the beacon plan's `beaconTarget()` gets its corners. No change of `contract.ts` is needed for that.
- A pilot's course flown by sound: a lesson template "fly a course" (`world.kind: 'scan'`, goal `timed-course`) whose
  track comes from the API instead of `trackUrl` (`scan-lesson.ts:39`): `loadLessonTrack` gets a fetcher argument.
  The session package embeds the whole track file (not only its ref), because a server track can be hidden later.

### 2.5 Timer, laps, best time, on/off in flight (R5)

`packages/tracks/src/laps.ts` `LapTimer` (pure): fed `(tMs, posPrev, posNow)` each physics step; uses `gateCrossing`
(`goals.ts:102`). The clock starts when the craft leaves the start zone or crosses gate 1; a lap ends at the last gate
(or the start zone again for laps > 1); a skipped gate means no lap (the HUD says which gate is next); passing a gate
backward is no pass. Splits per gate, lap times, the run time for `laps`. Pause (`ctx.pause`) stops the clock; a
crash or respawn (R, Y) ends the attempt.

- HUD (`apps/fly/src/course/hud.ts`): running time, lap n/N, last lap, best lap, delta to best at each split.
- Best per track id **and version** and drone, in prefs (`IdbKv`), shown on the course card. Server leaderboards are not
  in R1-R8 and not in this plan.
- **On/off**: `course.toggle`, `Shift+T`, `when: 'always'` (T alone is `sonic.record` only on sonic pages; a Shift chord
  is a different key, `keymap.ts:17`). Off hides the stage and stops the timer; on resumes on the same course. Also a
  pause-menu item "Course" (pick, generate, on/off, edit) via `ctx.menu.add`, like `replays.ts:10-11`.
- Gates are **not solid in physics** in the first releases (decision 3 below): the flight model, its trace hash and
  every replay stay as they are; touching a gate frame is detected by the course (sphere vs gate parts, as
  `scan-world.ts` already intersects rays with them) and counted as a "touch" in the split.

### 2.6 Track format, versions, authorship (R6)

The current `/1` file is kept for the first release (the path is derived, 2.4). The sound package then adds
`shramko-sonic-track/2` (its own repository, then move the pin; `/1` still parses):

- `author` stays the creator of this version; new `origin {id, version, author}|null` = the track's first version
  (creator, shown as "created by"); `editedBy` = this version's author when it is a new version or a fork ("edited by");
- `path?: WorldCheckpoint[]` (scan frame) for hand-bent paths;
- `objects?: TrackObject[]` for non-gate obstacles (pillars, boxes) with `order: null`;
- `walls {collisionSha256, floaterMinBlocks, ceilingM, voxelM}` the course was proven on;
- `kind` of `author` gains `admin`.
Edits follow `checkSuccession` (`library.ts:16`): same id = next version with `parent` (only the track's owner or the
admin); another pilot's change = fork: new id, version 1, `parent` = the source.

### 2.7 API and storage per scene (R4, R6, R7, R8)

New `apps/api/tracks.py` (stdlib, the style of `sessions.py`), wired in `server.py`, own nginx location.

| Route | What |
|---|---|
| `GET /api/tracks?scene=<hex>&sort=top\|new&page=n` | list for a scene: id, latest version, title, creator, last editor, created, edited, gates, path length, rating, votes, `broken` count. ETag, max-age 30. Hidden tracks left out. |
| `GET /api/tracks/<id>/v<n>` | the file, immutable (`Cache-Control: immutable`, ETag = `trackDigest`). |
| `POST /api/tracks` | create (v1) or fork (v1 with `parent`). Body <= 64 KB JSON. Answers `{id, version, editToken}` once. |
| `POST /api/tracks/<id>/versions` | a new version; header `X-Track-Token` (sha256 kept, compare_digest). |
| `POST /api/tracks/<id>/vote` | `{v: 1\|-1\|0, voter}`; `voter` = random 128-bit id the browser keeps in prefs. |
| `POST /api/tracks/<id>/broken` | `{gate, wallsDigest}` a client's check failed (counted per walls digest). |
| `GET\|POST /api/admin/tracks...` | via `ADMIN.add_route` (`admin.py:638`): list all incl. hidden, hide/unhide, delete a version, save as admin (new version, `author.kind: admin`, the creator kept), reset votes. |

Storage on the volume: `DATA_DIR/tracks/<sceneId>/<trackId>/v<n>.json` (canonical `writeTrack` bytes, written with
`os.replace` and fsync before 201), `DATA_DIR/tracks/<sceneId>/index.json` (list rows, rebuilt from the files if lost),
`DATA_DIR/tracks/votes/<trackId>.json` (`{voterHash: v}`), `tokens.json` (sha256 of edit tokens). The server
validates with a Python port of `validateTrack` held to the TS one by shared fixtures (valid and invalid files under
`apps/api/tests/fixtures/tracks/`, run by both test suites), adds `created` itself and refuses ids it did not issue.
Scene ids: `^[0-9a-f]{6,32}$`, any SuperSplat scene (pilots fly scenes outside the catalogue too); `lesson-*` ids refused.

### 2.8 Protection against junk and abuse

- Bodies: 64 KB (nginx `client_max_body_size 64k` and the API), `MAX_GATES` lowered to 60 for server tracks, numbers
  finite, positions inside +-10 km, sizes 0.05-20 m.
- Text: title 3-60 chars, author name 2-32 chars, Unicode letters, digits, space and `-_.'`, no URLs (`://`, `www.`), NFC,
  no control characters; a short blocklist; the admin hides the rest.
- Rates (in RAM, `_rate`): per client 10 creates/hour, 30 versions/hour, 60 votes/hour, 300 reads/min; global 200
  creates/day; per scene at most 300 visible tracks (oldest unrated hidden first); total cap 200 MB and the disk guard
  (`free_gb`) refuse writes with 507 before the disk fills.
- Honeypot field and time-to-submit (as `/api/lead`, `server.py:1733-1742`) on create.
- The server cannot see the walls: a course is trusted only as "valid format"; every client re-checks it (2.2) and
  `broken` reports from 3 distinct clients with the same walls digest hide it from `sort=top` until the admin looks.
- nginx: `location ^~ /api/tracks` GET/POST only, real-IP lines as `/api/session/` (`nginx.conf:220-225`), `Cookie` and
  `Authorization` cleared, `no-store` on POST; a `limit_req` zone like `gsfpv_tg` (`:32`).

### 2.9 Voting and order (R7)

One vote per `voter` id per track (re-voting replaces), additionally at most one per client address hash per track per
day (keyed hash, as the admin audit does). The client offers voting only after a completed lap on that track (UI rule,
not a proof). Order `sort=top`: Wilson lower bound of up/(up+down) at 95 %, ties by newer; `sort=new` by created.
Votes belong to the track id across versions; the list shows the latest version.

### 2.10 Admin edits everything (R8)

Admin tab `apps/fly/src/admin/tracks/tab.ts` (+ `api.ts`), added to the ternary in `admin/main.ts:58` and the tab list:
scene filter, table (title, creator, editor, versions, rating, broken, hidden), top view picture (client-side, like
`topView`), hide/unhide, delete a version, "open in simulator" (link `?scene=<id>&course=<id>.v<n>&edit=1`; the admin's
save goes through `POST /api/admin/tracks/<id>/versions`, CSRF). Every action audited (`admin-audit.jsonl`).

### 2.11 Editor with the keyboard

The editor is a mode: the flight is paused, the drone camera stays (orbit around the selected gate with the arrows),
and the mode routes its own key table (`KeyLookup.map`, `keymap.ts:139`), so no global letter is taken:

| Key | Action |
|---|---|
| Tab / Shift+Tab | select next / previous gate |
| Arrows | move the gate 0.1 m (with Shift 1 m) in the horizontal plane, relative to the view |
| PageUp / PageDown | up / down |
| Q / E | yaw -15 / +15 degrees |
| 1 2 3 4 | ring, square, dive gate, pillar pair |
| + / - | size |
| Insert | a new gate after the selected one, 4 m along its axis |
| Delete | remove the selected gate |
| G / Shift+G | regenerate with a new seed / the same seed with the current parameters |
| Enter | save (create, new version or fork) |
| Esc | leave (asks when unsaved) |
| "drop here" (Space) | in flight with the editor armed: a gate at the drone's pose, 1 m ahead |

Each change re-runs `checkTrack` for the touched gate and its two legs (milliseconds); a failing gate is drawn red with
the reason, and save is refused while any gate fails. Every action is also said through the screen reader live region
(and by the sound mode's voice on a sonic page), so the editor works without seeing.

### 2.12 What the recording must carry

- Flight log (`LifeHeader`, `contracts.ts:83`): physics does not depend on a non-solid course, so the trace hash is
  unchanged. Add an optional `course {id, version, digest, laps}` to the life header and a log event for on/off with
  its tick (format `gsfpv-input-log/4`; old logs have no course). The replay rebuilds the `LapTimer` from the replayed
  positions; lap times must equal the live ones.
- Saved replays keep the track file next to the log (a track may be hidden later).
- Fly by Sound sessions embed the track file (2.4).
- If gates become solid later: they enter the collision, the header must carry the digest, and `SIM_CORE_VERSION` moves.

---

## 3. Stages, branches, order

Shared contracts (owned by stage 1, changed only by agreement): `packages/tracks/src/index.ts` types `FreeSpace`,
`CourseParams`, `LapEvent`; the existing `TrackFile` `/1`; the API JSON (section 2.7 table, written into
`deploy/README.md` by stage 3); the keymap line `course.toggle` (stage 2).

### Stage 1: branch `tracks-core` (pure, Node)

Owns `packages/tracks/**` (new workspace package), `tools/bench/src/sonic-track-check.ts` (moves its proof into the
package and re-exports), `tools/bench/test/tracks-*.test.ts`, `tools/bench/src/tracks-generate.ts` (evidence on real
walls from `.cache/scenes`: Winter Garden and two other cached scans, top-view PNGs).
Test with negative controls:
- analytic world of three rooms: A and B joined by a door, C sealed. Every generated gate in A or B, `checkTrack` ok at
  0.5 m. **Control:** the generator with the flood fill switched off must put a gate in C or in a wall and the test
  must fail on it; a course with one gate moved by `withGateAt` into a wall must fail `checkTrack`.
- determinism: same seed twice = same `trackDigest`; seed + 1 differs. **Control:** a generator that reads
  `Math.random` (injected) fails the repeat test.
- well-scanned: a room with a 2 m hole in a wall; no gate within 1 m of the hole's outside. **Control:** enclosure
  threshold 0 places one there.
- `coursePath`: neighbours <= 6 m, one point 1.5 m before each gate, segments free. **Control:** a path with one 8 m gap
  fails.

### Stage 2: branch `tracks-fly` (simulator, first release)

Owns `apps/fly/src/course/**`, `apps/fly/src/app/builtin/course.ts` (feature), one line in `packages/prefs/src/keymap.ts`
(`course.toggle`), the course strings in `apps/fly/src/i18n` locales (en, es, pl, ru), the `checkpoints` getter in
`apps/fly/src/sonic/scan-world.ts`, a worker for the generator.
Tests:
- `LapTimer` scripted paths: through all gates in order = one lap with the right time. **Controls:** a skipped gate gives
  no lap; a backward pass does not count; a pause of 5 s does not add 5 s.
- keymap: `keymapProblems` empty with `Shift+T`. **Control:** binding it to `KeyT` without Shift on a sonic page is
  reported as a clash.
- browser check (bench harness): generate on the fixture scene `39e63ce9`, gates and arrows drawn (entity count > 0 and
  pixels of the gate colour in the screenshot), `Shift+T` removes them (count 0). **Control:** a stage that never
  attaches its root fails the pixel check.
- sound: `lessonTrack` on a `ScanSonicWorld` with a course returns kind `world`. **Control:** without the getter it
  returns `gates`.

**Smallest useful first release (stage 1 + stage 2):** on any scan with walls, one click "Generate course" in the pause
menu, gates and arrows drawn, `Shift+T` on/off, lap timer and best lap kept locally, the course shareable as a link
`&course=g1.<seed>` (the deterministic generator rebuilds it; on different walls the link says so and offers a new
one). No server, no editor. It answers R1, R2, R3, R5 and gives the beacon its corners.

### Stage 3: branch `tracks-api` (server, nginx, admin)

Owns `apps/api/tracks.py`, `apps/api/tracks_admin.py`, the wiring lines in `apps/api/server.py`, `deploy/nginx.conf`,
`deploy/README.md` (contract rows), `apps/api/tests/test_tracks*.py`, `apps/api/tests/fixtures/tracks/`,
`apps/fly/src/admin/tracks/**`, two lines in `apps/fly/src/admin/main.ts`.
Tests:
- create, read, list sorted by Wilson score, fork keeps `parent`. **Controls:** 65 KB body 413; schema fixture
  `invalid-*` 400 (the same fixtures fail the TS validator); version without token 403; wrong token 403; 11th create in
  an hour 429; second vote from the same voter counts once; an admin POST without `X-CSRF` 403; a disk-guard tripped
  store answers 507.
- nginx: `test_nginx_routes.py` gains the location. **Control:** the mutated config with
  `$proxy_add_x_forwarded_for` (the existing negative pattern, `:70-74`, `:313`) fails.

### Stage 4: branch `tracks-editor` (+ sound package `/2` in its own repository)

Owns `apps/fly/src/course/editor/**`, the save/fork/vote UI, the course list per scene in the scene card; in
`shramko-fly-by-sound-fpv`: track format `/2`, the "fly a course" lesson template, then the pin move here.
Tests: an edit that moves a gate into a wall blocks save. **Control:** the check switched off lets it save, and the
test fails. A fork keeps `origin` and sets `editedBy`. **Control:** a fork that loses `origin` fails. A `/1` file still
parses (**control:** a `/2` file missing `format` is refused).

Order: 1 -> 2 (release) -> 3 (can start in parallel with 2 after the shared JSON is fixed) -> 4.

---

## 4. Risks and owner's decisions

Risks:
- Walls differ between clients (shipped vs refined vs baked, floater filter, ceiling, scene size): a course proven on
  one may cut a wall on another. Mitigation: walls digest in the course, re-check on load, `broken` reports.
- Voxels miss glass, mirrors, thin rails and unscanned surfaces; the visible scan and the walls disagree. A gate may
  look as if it stood in a window. Mitigation: enclosure score, 0.5 m margin, admin hide.
- Gaussian splats and PlayCanvas primitives: whether gates are hidden correctly behind splats (depth) is not known.
- Cost of the free-space pass on big scans (grid, distance transform, 26 rays per cell): must run in a worker and be
  measured; bounded box around the spawn.
- Anonymous votes can be stuffed; the per-address limit only slows it.
- The server cannot verify walls (scenes only in the browser, `AGENTS.md`); the server only guards format and rates.

Owner's decisions (default first):
1. **Identity for "created / edited" and votes.** Default: no accounts; a free nickname, a per-browser edit token, one
   vote per browser id and per address a day, admin hides abuse. Alternative: sign-in (e-mail link or Google) before
   saving and voting.
2. **Which scenes may have server tracks.** Default: any SuperSplat scene id a pilot flies. Alternative: only scenes in
   the published catalogue (less junk, fewer tracks).
3. **Gates solid in physics.** Default: not solid in releases 1-3 (touches counted, replays and trace hash unchanged).
   Alternative: solid frames like other simulators, with a `SIM_CORE_VERSION` bump and the course digest in every log.

---

## 5. Not verified

- No test, typecheck or browser run was made for this plan; every number of 2.1-2.2 (cell size, thresholds, N formula,
  enclosure 0.7) is a starting value to be measured on cached scans.
- Whether gate frames already collide with the drone on the Winter Garden lesson (grep found gates only in sound rays,
  `scan-world.ts:114-131`; the physics side was not read).
- Whether `PrimitiveStage` entities are depth-sorted against splats.
- The time and memory of a flood fill and distance transform on the largest cached scenes.
- `apps/fly/src/sonic/mode.ts:209` and the beacon plan's `beaconTarget()` were taken from `sonic-beacon-plan.md`, not
  re-read.
- That `Shift+T` passes `keymapProblems` and does not fire while a keyboard pilot holds Shift to fly (Shift is in
  `FLYING_CODES`).
- The replay path in `apps/fly/src/app/logs.ts` and the Fly by Sound session writer were not read for where a course
  record fits.
- Whether the repository gate B18 (no Cyrillic outside locales, `scripts/gen-catalog.ts:147`) currently passes with
  `docs/wip/sonic-beacon-plan.md`, which is written in Russian.
- Splat density per region (reading the Gaussians, not the voxels) was not looked into.
