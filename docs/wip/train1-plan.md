# Train 1: tracks, rooms, voice feedback (plan)

Base: branch `train1-base`, worktree `C:/dev/gsfpv-train1-base`, made from origin/main 8549533e. Designs (read the section a
brief names, not the whole file): `docs/wip/tracks-plan.md`, `docs/wip/rooms-plan.md`, `docs/wip/voice-feedback-plan.md`.
`docs/agent-map.md` did not exist when the train started; section 2 below is the code map (written from the code).
Checks: level 1 with every change (the test next to the change + a negative control), level 2 once per lane (independent
review, then fixes), level 3 once for the train (all gates, release build, browser regression, page probes). Lanes never run
level 3, never run the catalogue generator, never push.

## 1. Lanes

| Lane | Branch, worktree | First release: what a pilot can do |
|---|---|---|
| tracks | `tracks`, `C:/dev/gsfpv-tracks` | On any scan with walls: one click (pause menu or Shift+G) puts a random course of gates into the well scanned free space, arrows show the way, Shift+T puts it on and off in flight, a lap timer keeps the best lap, "Save for everyone" stores the course on the server and every pilot of that scene gets it. The course gives the sound beacon its points. R1-R5. |
| rooms | `rooms`, `C:/dev/gsfpv-rooms` | "Fly with others": create a room on the scan flown, copy the link, a friend opens it and lands in the same scan at the same size; both see each other's drones with name tags and a member list; a blind pilot hears who joined and left and asks "who is around" (Shift+O). Cap 8, temporary rooms. R25, R26, R28 (speech). |
| voice | `voice`, `C:/dev/gsfpv-voice`; package branch `voice-feedback`, `C:/dev/sonic-voice` | Nothing changes on the page. The owner gets, from one recording package and one command, a one-page summary: what the pilot said and when, what happened then, the hardest places. R15-R16. |

Decisions that differ from the lead's default, with the reason:
1. The timed race in a room goes to train 2: `rooms-plan.md` 2.4 and 4D need the lap timer of lane tracks (built in this train, not yet released), a race state on the server, a countdown and a table: a stage of its own, not small.
2. Blind pilots hear the others as speech in train 1 (joins, leaves, who is around, a near call). The motor sound of other drones needs a package contract change (`SonicFrameInput.others`), a new cue and a listening proof; only one lane may move the package pin in a train (voice does), so it is train 2.
3. Server tracks are generator courses only (no free text, no edit token, no votes, no admin tab): nothing a pilot types is shown to others, so train 1 needs no moderation. Editor, authorship and voting are train 2.
4. Voice is built and tested on synthetic packages only. No agent opens a real recording or its transcript (voice and health data, `voice-feedback-plan.md` 7); the first run on real packages is the owner's decision.

## 2. Code map (entry points by name)

| Topic | Where |
|---|---|
| A feature | `Feature {id, install(ctx)}` and `FlightContext` in `apps/fly/src/app/context.ts`; list `FEATURES` in `app/features.ts`; one file per feature in `app/builtin/`. Model: `builtin/replays.ts` (menu item via `ctx.menu.add`), `builtin/throttle-style.ts` (key + pref + HUD). |
| Keys | `KEYMAP`, `FLYING_CODES`, `keymapProblems`, `pageBindings` in `packages/prefs/src/keymap.ts`; router `apps/fly/src/app/keys.ts` (`KeyRouter`); `status: 'planned'` is not routed. Tests `packages/prefs/test/keymap.test.ts`, `tools/bench/test/app-keys.test.ts`. |
| Settings | one def file per owner in `packages/prefs/src/defs/`, joined in `defs/index.ts` (`SCHEMA`); store `ctx.prefs`. Model: `defs/play.ts`. Tests `packages/prefs/test/`. |
| Text | `packages/i18n/locales/fly/<namespace>/<en|es|pl|ru>.json`, merged by the glob in `apps/fly/src/i18n.ts`; key names are global (`keys.<action>`, `course.*`, `rooms.*`). Parity test `packages/i18n/test/fly-parity.test.ts`. |
| HUD | class in `apps/fly/src/ui/hud.ts`, feature `app/builtin/hud.ts` (H hides every text). A lane draws its own overlay in its own folder and follows the HUD's hidden state. |
| Flight, sim | `apps/fly/src/session/` (`FlightSession`), `simclock.ts`, `packages/sim-core` (never written by a lane; A6: the trace hash of a flight must not change, `tools/bench/src/a6-run.ts`, seam `perturb` in `sim.ts`). Events `ctx.events`: `frame`, `life`, `session`, `pause`, `walls`. |
| Walls | `ctx.walls`, `apps/fly/src/walls.ts`, `bake.ts`; `packages/collision/src/mesh.ts` (`forEachBlock`, `blockDims`), `world.ts` (`sphereOverlaps`, `VoxelContactWorld`), `transform.ts` (`transformCollision`). Proof of a course on walls: `tools/bench/src/sonic-track-check.ts` (`checkTrack`, `withGateAt`, `topView`). |
| Drawing in the scene | `PrimitiveStage`, `objectPrims`, `shapePrims` in `apps/fly/src/sonic/primitives.ts`; drone meshes `apps/fly/src/drones3d/build.ts` (`buildFor`); public PlayCanvas API only (`tools/bench/src/a1-api-check.ts`). |
| Scenes, links | `SceneHost.load` in `apps/fly/src/app/scene-host.ts`, `SceneSwitchReason` in `context.ts`, one-visit settings `app/shared-visit.ts`, share panel `builtin/share.ts`. |
| Sound mode | `apps/fly/src/sonic/` (`mode.ts` feeds `SonicFrameInput` with `beacon` from `runner.beaconTarget`, `scan-world.ts` `ScanSonicWorld`, `scan-lesson.ts`), speech `sonic-session/platform.ts` (`sayVia`). Package `packages/sonic-fpv` is a submodule: edit only in its own repository. Track model: `contract.ts` (`TrackFile`, `TrackGate`, `WorldCheckpoint`), `src/track/validate.ts`, `src/lesson/goals.ts` (`gateCrossing`), `src/lesson/track.ts` (`worldCheckpoints`, `lessonTrack`). |
| Recordings | `apps/fly/src/sonic-session/` (`recorder.ts`, `replay-segments.ts` `lessonSegments`, `replay-check.ts`); package `src/session/`, `tools/report.ts` (`buildReport`, `parseTranscript`), `tools/listen/words.py`, `test/fixtures/make-session-fixture.py`. |
| API | `apps/api/server.py` (stdlib; `_rate`, `_client`, `DATA_DIR`, disk guard `free_gb`), model of a store with tests: `sessions.py` + `tests/test_sessions.py`; local rig `tests/rig_server.py`. nginx: one location per route in `deploy/nginx.conf` (model `^~ /api/session/`), tests `tests/test_nginx_routes.py` (class `Location`), contract rows in `deploy/README.md`. |
| Deploy | `deploy/compose.yml` (`gsfpv-web`, `gsfpv-api`), `release-api.sh`, `release-nginx.sh`, `ship.sh` (static; neighbour snapshots, allow list). |
| Page probes | headless Chrome through `tools/bench/src/chrome.mjs`; GPU lock `tools/bench/src/gpu-lock.ts` and `C:/dev/.gpu-lock`; models: `sonic-v13-page.ts` (a page probe with controls), `sonicrec-serve.ts` + `sonicrec-rig.ts` (serve the build and a local API together). The page hook is `window.__gsfpv` (`app/test-hook.ts`). Fixture scene `39e63ce9`. |
| Commands | `pnpm vitest run <file>` from the root (globs `packages/*/test`, `tools/bench/test`); typecheck `pnpm --filter @gsfpv/prefs typecheck`, `pnpm --filter ./apps/fly typecheck`, `pnpm --filter ./tools/bench typecheck`. In `neg_control.py` write `pnpm.cmd` after `--` (plain `pnpm` fails there on Windows, measured). |

## 3. Lane tracks

Owns: `packages/tracks/**` (new workspace package `@gsfpv/tracks`), `pnpm-lock.yaml`, the dependency lines in
`apps/fly/package.json` and `tools/bench/package.json`, `scripts/check-architecture.mjs` (if the new package needs a rule),
`apps/fly/src/course/**`, `apps/fly/src/app/builtin/course.ts`, `packages/prefs/src/defs/course.ts`,
`packages/i18n/locales/fly/course/**`, `apps/fly/src/sonic/scan-world.ts`, `apps/fly/src/ui/hud.ts` and
`app/builtin/hud.ts` (only if the overlay needs a hook), `apps/api/tracks.py`, `apps/api/server.py`,
`apps/api/tests/test_tracks.py`, `apps/api/tests/test_nginx_tracks.py`, `apps/api/tests/fixtures/tracks/**`,
`tools/bench/src/sonic-track-check.ts`, `tools/bench/src/tracks-*`, `tools/bench/test/tracks-*`, `docs/tracks-api.md`,
`docs/wip/tracks.md` (status), its own lines of shared files per section 6. URL parameter `course`.

- **T1 core (Node only).** `packages/tracks/src`: `freespace.ts` (`freeSpace(walls, opts) -> FreeSpace`: cells from
  `forEachBlock`, clearance by distance transform, flood fill from the spawn, the enclosure score; `tracks-plan.md` 2.1),
  `generate.ts` (`generateCourse(free, walls, {seed, params}) -> TrackFile` format `/1`, gates `ring` and `square` only,
  seeded, no `Math.random` or `Math.sin`; 2.2), `check.ts` (`checkTrack` moved from `tools/bench/src/sonic-track-check.ts`,
  which re-exports it), `path.ts` (`coursePath(track, transform) -> WorldCheckpoint[]`; 2.4), `rng.ts`, `index.ts`.
  Tests `packages/tracks/test/*.test.ts` with the four controls of `tracks-plan.md` section 3 "Stage 1". Evidence script
  `tools/bench/src/tracks-generate.ts` on real walls (loaded the way `tools/bench/test/sonic-garden.test.ts` does) writes
  `evidence/<date>/tracks-generate.json` and top-view PNGs: every threshold of 2.1-2.2 is measured there or marked estimate;
  time and memory of the free-space pass are measured. Models: `tools/bench/test/sonic-garden.test.ts`,
  `packages/collision/src/components.ts`.
- **T2 flight.** `packages/tracks/src/laps.ts` (`LapTimer`, uses `gateCrossing`; 2.5) with the three controls of "Stage 2";
  `apps/fly/src/course/`: `worker.ts` (generator off the main thread, model `apps/fly/src/voxels.worker.ts`), `view.ts`
  (`CourseStage`: gates and arrows, model `PrimitiveStage`), `hud.ts` + css (time, lap, best), `link.ts`
  (`&course=g1.<seed>`), local best per track id, version and drone; `builtin/course.ts` installs all of it, a pause-menu
  item, `course.toggle` and `course.generate` flipped to shipped; `CourseHook` filled; `ScanSonicWorld` gets a `checkpoints`
  getter fed from `coursePath` (test: `lessonTrack` returns kind `world`; control: without the getter `gates`). Gates are not
  solid and nothing is written into the sim: a test proves the trace hash with the course on equals the solo one (control:
  `perturb`). The course is off until the pilot asks for it.
- **T3 server and probe.** `apps/api/tracks.py` (store `DATA_DIR/tracks/<sceneId>/<trackId>/v1.json` + `index.json`,
  atomic, disk guard), routes and limits of section 7, wired in `server.py`; a Python port of `validateTrack` held to the TS
  one by shared fixtures (`apps/api/tests/fixtures/tracks/valid-*.json`, `invalid-*.json`, read by `test_tracks.py` and by
  `packages/tracks/test/fixtures.test.ts`); nginx location and README row per section 6; `apps/fly/src/course/store.ts`
  (list on scene load, load with `checkTrack` on the pilot's own walls, "Save for everyone"). Page probe
  `tools/bench/src/tracks-page.ts` with its own `tracks-serve.ts` (model `sonicrec-serve.ts`): page A on `39e63ce9`
  generates (hook `gates > 0`, `drawn > 0`, pixels of the gate colour in the screenshot), Shift+T (`drawn == 0`), saves; page
  B with a fresh profile on the same scene gets `source: 'server'` and the same track id. Controls that must fire: another
  scene id gives `source: 'none'`; a stage whose root is never attached fails the pixel check; a served track with one gate
  moved into a wall is refused on load (`problem` set).

## 4. Lane rooms

Owns: `apps/rooms/**` (Python service, no `package.json`), `docs/rooms-protocol.md`, `apps/fly/src/rooms/**`,
`apps/fly/src/app/builtin/rooms.ts`, `packages/prefs/src/defs/rooms.ts`, `packages/i18n/locales/fly/rooms/**`,
`apps/fly/src/app/context.ts` (`'room'` in `SceneSwitchReason`), `apps/fly/src/app/scene-host.ts`, `apps/fly/vite.config.ts`,
`deploy/compose.yml`, `deploy/release-rooms.sh`, `deploy/ship.sh`, `apps/api/tests/test_nginx_rooms.py`,
`tools/bench/src/rooms-*`, `tools/bench/test/rooms-*`, the privacy text in `packages/i18n/locales/site/**`,
`docs/wip/rooms.md` (status), its own lines of shared files per section 6. URL parameters `room`, `rooms`.

- **R1 server.** `apps/rooms/ws.py` (RFC 6455 framing, stdlib), `protocol.py` (pose 36 B, snapshot, JSON control messages;
  `rooms-plan.md` 2.2), `rooms.py` (asyncio: the routes of section 7 and the WebSocket, temp rooms in RAM, cap 8, rates of
  2.5, backpressure), `docs/rooms-protocol.md` (version `rooms/1`), fixtures `apps/rooms/tests/fixtures/*.json` (bytes as hex
  with the decoded value). Tests `apps/rooms/tests/test_*.py` with the controls of "4A". Deploy files: service `gsfpv-rooms`
  in `compose.yml`, zones and two locations in `nginx.conf`, `release-rooms.sh`, `ship.sh` allow list, README row. Load: N
  synthetic clients at 15 Hz on this machine, RSS and CPU into `evidence/` (the table of 2.8 is an estimate until then).
- **R2 client core.** `apps/fly/src/rooms/`: `codec.ts` (test on the shared fixtures; control: x and z swapped), `clock.ts`
  (offset, median of 8), `interp.ts` (150 ms playout buffer, Hermite, slerp; error bound measured on scripted poses with
  jitter and loss; control: no buffer), `socket.ts` (reconnect, ping), `remote-stage.ts` (the others' drones under their
  own root, meshes from `drones3d` or a primitive), `builtin/rooms.ts`: join by `?room=<id>`, pose up at 15 Hz read from the
  shown sim on `frame` (as `sonic/bridge.ts` reads it), the room's scene and one-visit settings (`shared-visit.ts`),
  `RoomsHook` filled. Node test: `rooms.py` as a child process, two clients, A's pose reaches B (control: another room). A6
  test: the trace hash with rooms on equals solo (control: `perturb`).
- **R3 screens, speech, probe.** Panel "Fly with others" (pause menu, Shift+L): create, copy the link, the list of open
  rooms as a table with Join buttons, members, leave; nickname (`rooms.nick`, rule of 2.5); name tags; joins and leaves
  spoken through `sayVia` when the sound mode runs, else in a polite live region; Shift+O says the nearest pilots (name,
  metres, side, above or below); a near call. The menu item shows only with `?rooms=1` or `?room=` until the lead flips one
  constant in `builtin/rooms.ts`. Probe `tools/bench/src/rooms-two-page.ts` with `rooms-serve.ts`: section 9.

## 5. Lane voice

Owns: in the package repository (worktree `C:/dev/sonic-voice`, branch `voice-feedback` from package main 83ce612, made with
`git -C C:/dev/ShramkoSonicFPV worktree add`): `src/replay/segments.ts`, `tools/analyze.ts`, `tools/listen/transcribe.py`,
`tools/feedback/**` (config and phrase lists), their tests and fixtures, the `analyze` script line in `package.json`. In the
simulator: the pin `packages/sonic-fpv`, `apps/fly/src/sonic-session/replay-segments.ts`, `docs/wip/voice.md` (status).
No new npm dependency. Nothing else in the simulator.

- **V1 analysis (Node, no GPU).** Move `lessonSegments` into the package with its tests; the two-lesson synthetic fixture
  (`voice-feedback-plan.md` 8, stage 1 item 2); `tools/analyze.ts`: read, cut by lesson, `buildReport` per lesson, step
  anchors, difficult spots (rules of 5.2 step 7 in one config, each number marked estimate), remarks from a hand-written
  transcript, `summary.md`, `analysis.json` (`shramko-voice-feedback/1`), `--share-safe`, `--out` refused inside a git tree.
  Controls: the fixture without failures gives no spots; a transcript shifted by 10 s attaches remarks to other steps; the
  share-safe file holds no transcript word.
- **V2 transcription and the pin.** `tools/listen/transcribe.py` (WebM/Opus through PyAV, faster-whisper large-v3 at the
  pinned revision, VAD, word timestamps, `HF_HUB_OFFLINE=1`, fails when the model is absent), the echo filter, the end-to-end
  check on synthetic voices under the GPU lock (controls: offset moved by 2 s fails the 300 ms bound; filter off leaves the
  lesson line), drift on a 10-minute synthetic track. Then the simulator worktree: pin to the package branch head,
  `replay-segments.ts` re-exports from the package, the sonicrec replay tests of `tools/bench` green. Under "For the lead
  before the merge": merge the package branch into its main and push first, then re-pin. If the Whisper environment or the
  model is not on the machine: do not download; mark the end-to-end check not verified.

## 6. Hot shared files and free keys

Already split on the base (commit "train 1 base: the contract ..."), so no lane edits these lists: `features.ts`,
`defs/index.ts`, `test-hook.ts`. In `keymap.ts` a lane edits only its own two reserved lines (flip to shipped; a key it does
not build stays planned); in `packages/prefs/test/keymap.test.ts` only its own list (`SHIPPED_BY_TRACKS`, `SHIPPED_BY_ROOMS`).

| File | Owner or split |
|---|---|
| `deploy/nginx.conf` | tracks: one location block directly after the `location = /api/roadmap` block. rooms: its zones directly after the `limit_req_zone ... gsfpv_tg` line and its two locations directly after the `location = /api/health` block. Nothing else. |
| `deploy/README.md` | tracks: one row under the `GET /api/roadmap` row; rooms: one new section directly before `## Deploying a release`. Long text goes to `docs/tracks-api.md`, `docs/rooms-protocol.md`. |
| `apps/api/tests/test_nginx_routes.py` | read only; each lane adds its own file (`test_nginx_tracks.py`, `test_nginx_rooms.py`) and imports the helpers. |
| `apps/api/server.py`, `pnpm-lock.yaml`, `apps/fly/package.json`, `tools/bench/package.json`, `ui/hud.ts`, `sonic/scan-world.ts` | tracks |
| `deploy/compose.yml`, `deploy/ship.sh`, `app/context.ts`, `app/scene-host.ts`, `vite.config.ts`, privacy text | rooms |
| `packages/sonic-fpv` (pin) | voice |
| `tools/bench/src/chrome.mjs`, `gpu-lock.ts`, `sonicrec-serve.ts` and every other bench helper | read only; a lane copies the pattern into its own `tracks-*` / `rooms-*` file. |
| Generated: `README.md` block, `llms.txt`, `docs/settings.md`, `apps/site/src/generated/features.json` | nobody in a lane; the integration stage runs `scripts/gen-catalog.ts` once after the merges. |

Keys. All 26 plain letters are taken (always: P R Y N M V C H O B L K F J; sound mode: T U I Z G X; flying: W A S D Q E);
digits are the answers of sound lessons; F3 and F9 are ours, F1 F5 F11 F12 the browser's; Shift+N, Shift+F, Shift+[ and
Shift+] are taken. Reserved now: Shift+T, Shift+G (tracks), Shift+L, Shift+O (rooms). Still free: Shift with B C H I J K M
P R U X Y Z (Shift+V is kept for the room vote of train 2), F2 F4 F6 F7 F8 F10, and the punctuation keys (not checked
against every keyboard layout: test with `keymapProblems` before taking one). Never Shift with W A S D Q E.

## 7. Contracts between lanes

- Code on the base: `CourseHook` (`apps/fly/src/course/hook.ts`), `RoomsHook` (`apps/fly/src/rooms/hook.ts`), the reserved
  keys, the def files, the feature stubs, the locale namespaces `course` and `rooms`; test
  `tools/bench/test/train1-contract.test.ts`.
- Track file: `TrackFile` `shramko-sonic-track/1` of the package, unchanged. Server tracks: `author.kind = 'generator'`,
  `generator.name = 'gsfpv-course'`, `title` matches `^Course [0-9a-z-]{1,24}$`, `scene.kind = 'scan'`, at most 200 gates.
- Tracks API (on `gsfpv-api`): `GET /api/tracks?scene=<hex 6-32>` -> `{v: 1, tracks: [{id, version, title, gates, lengthM,
  created}]}` newest first, ETag, max-age 30; `GET /api/tracks/<id>/v<n>` -> the file, immutable; `POST /api/tracks` (body
  at most 64 KB) -> 201 `{id, version}`. Limits (estimates, in one table in `tracks.py`): 10 creates an hour per client, 20
  tracks a scene. Storage `DATA_DIR/tracks/`.
- Rooms (on `gsfpv-rooms:8091`): `GET /api/rooms/health`, `GET /api/rooms`, `POST /api/rooms` -> `{id, hostKey}`,
  `GET /api/rooms/<id>`, WebSocket `GET /api/rooms/ws`; messages and byte layouts in `docs/rooms-protocol.md` (`rooms/1`).
  A room record keeps an optional opaque `course` string (unused in train 1; train 2 puts `g1.<seed>` or `<id>.v<n>` there).
  Nothing under `DATA_DIR` in train 1 (rooms live in RAM).
- Voice: `analysis.json` format `shramko-voice-feedback/1`; no contract with the other lanes.
- Settings ids start with `course.` and `rooms.`; text keys with `course.`, `rooms.`, `keys.course.`, `keys.rooms.`.
- Neither feature writes into the sim, the input log or the runner (A6). Rooms draws drones, tracks draws gates: each
  under its own root entity.

## 8. Merge order and deploy order

Merge into `train1-base` (or straight into main by the integration stage): **voice, tracks, rooms**. Voice first: the package branch is merged into the package main and pushed, then the pin; its simulator diff is two paths. Tracks second: it owns the lockfile (`pnpm install` once after the merge). Rooms last: the second hunks of `nginx.conf` and README. After the three merges: `scripts/gen-catalog.ts` once, then level 3.

Deploy, each step with neighbour snapshots and the hub lock:
1. The sound package is public: push its main before the simulator pin.
2. API: `release-api.sh` (`tracks.py`, `server.py`); the route is unreachable until nginx has its location.
3. Rooms container: `release-rooms.sh` (`docker compose up -d gsfpv-rooms` creates only the new container; health from inside the network).
4. nginx: `release-nginx.sh` with both lanes' locations (`nginx -t`, reload).
5. Static: `ship.sh` with the allow list `gsfpv-web,gsfpv-api,gsfpv-rooms`; the rooms menu still behind `?rooms=1`.
6. Live checks: the tracks list and file routes, the two-browser rooms check with `?rooms=1`; then a second static release that shows the rooms menu item. Rollback in reverse order. Voice deploys nothing.

## 9. Integration probes (final stage, once)

1. Rooms, two headless browsers against a local rig (`rooms-serve.ts`: the release build + `rooms.py` with the WebSocket
   passed through): page A on `39e63ce9` creates a room; page B opens A's link; A flies a scripted bot path for 20 s. Pass:
   B's `RoomsHook.remotes` follows A's own positions (RMS after aligning the playout delay under the bound the lane
   measured), B's `members` has A's nickname, B's `said` has the join line, A's trace hash equals A's solo run. Controls
   that must fire: B joins another room id (no remote); the server with the relay off (the remote never moves); the codec
   with swapped axes (RMS over the bound).
2. Tracks with rooms together: both pages in one room, A generates and saves a course; B (same scene) gets
   `CourseHook.source == 'server'`; both hooks stay sound with both features on. Control: B on another scene gets `none`.
3. Tracks page probe `tracks-page.ts` and its three controls on the merged build.
4. Sound mode: on a `?sonic=` scan page with a course, `CourseHook.beaconPoints > 0`; the v13 page probe still passes.
5. Voice: `pnpm analyze` on the synthetic fixture in the pinned package gives the same `analysis.json` digest as on the
   lane branch.

## 10. Deferred to train 2

Track editor, authorship, forks, voting and rating, admin edits and the admin tab (R6-R8), track format `/2`, solid gates,
slalom pillars and dive gates, the course in the flight log and in replays, a "fly a course" sound lesson. The permanent
room "Drony Bydgoszczy" with a scene vote and a room admin (R27), the timed race in a room, quick phrases, kick and ban,
the motor sound of other drones (`others` layer). Voice: package additions G1-G7, the `aggregate` command, threshold
tuning on real recordings, pulling packages from the server. Also: the menu for three kinds of newcomers, weak devices,
beacon stage 2 (walls lessons, scans without a track, the spoken list offering the throttle style).

## 11. Risks

- The hub's nginx-proxy may not pass `Upgrade` (not in this repository, not verified): rooms then needs a polling fallback.
- Walls differ between pilots (refined, floater filter, ceiling): a saved course may cut a wall for someone; the load check refuses it there. Whether gates and drones are hidden correctly behind splats (depth) is unknown until the first probe.
- The free-space pass on a big scan may be slow or large: T1 measures it before T2 builds on it.
- Anonymous `POST /api/tracks` and `POST /api/rooms`: only rates and caps guard them; the numbers are estimates.
- Three lanes regenerate nothing: if a level-1 test fails only because a generated file is stale, the lane notes it.
- A third container on the hub (`rooms-plan.md` section 4, owner's decision 1, default yes); the first deploy of `gsfpv-rooms` must not touch neighbours.
- Voice: PyAV on MediaRecorder WebM and Whisper word times on Russian and Polish speech are unverified; the consent and privacy texts may not cover automated transcription (the lane reports the missing sentence, the lead adds it).
- The lead's working copy `C:/dev/gsfpv-v03` may ship a release meanwhile: the integration stage merges main into the train before level 3.
