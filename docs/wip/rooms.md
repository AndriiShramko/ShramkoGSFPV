# Lane rooms (train 1): flying together

Branch `rooms`, worktree `C:/dev/gsfpv-rooms`, from `train1-base` 5ceb8aaa. Plan: `docs/wip/train1-plan.md` section 4,
design `docs/wip/rooms-plan.md` (2.1-2.5, 2.9, 4A). Requirements R25, R26, R28 at their smallest.

## Status

### Stage R1: server (Python stdlib, no browser) - DONE
- [x] `apps/rooms/ws.py` (RFC 6455), `protocol.py` (pose 36 B, snapshot, validators), `rooms.py` (service), tests
      `test_ws`, `test_protocol`, `test_relay`, `test_rates`, `test_backpressure`, fixtures (commit d35014c5)
- [x] deploy files: `compose.yml`, `nginx.conf`, `release-rooms.sh`, `ship.sh`, `README.md`; `apps/api/tests/test_nginx_rooms.py`
      (commit a6774565; nginx tests 25 pass with test_nginx_routes; NEG OK against train1-base nginx.conf)
- [x] `docs/rooms-protocol.md` (protocol `rooms/1`, routes, layouts, limits table, privacy)
- [x] load run `evidence/2026-11-13/rooms-load.json` (`apps/rooms/tests/load.py`)
- [x] checks: `python -X utf8 -m unittest discover -s apps/rooms/tests` 42 tests OK (15.5 s); nginx 25 OK
  (commit "rooms R1: protocol doc, load evidence, status")

**For stage R2 (client core):**
- Start the service: `python -X utf8 -u apps/rooms/rooms.py --host 127.0.0.1 --port 8091` (port 8091 is the default; env
  `HOST`, `PORT` work too). In a Node test start it as a child process on a free port (`--port <n>`), wait until a TCP
  connect succeeds (about 0.3 s on this PC), kill it at the end. It prints one line per request to stdout.
- Create a room: `POST /api/rooms` `{"scene":{"id":"39e63ce9"}}` -> `{id, hostKey}`; join: WebSocket `/api/rooms/ws`,
  first message `{"type":"hello","v":"rooms/1","room":id,"nick":"Ala"}`. Dev server: `apps/fly/vite.config.ts` needs a
  proxy of `/api/rooms` (with `ws: true`) to `http://127.0.0.1:8091`.
- Fixtures: `apps/rooms/tests/fixtures/pose.json` (4 cases) and `apps/rooms/tests/fixtures/snapshot.json` (3 cases):
  `{version, layout, cases: [{name, hex, value}]}`; a pose `value` is `{flags, seq, tick, pos[3], quat[4] x y z w,
  vel[3] m/s, throttle 0..1, raw: {quat, vel, throttle}}` (`raw` = the integers on the wire, compare those exactly, floats
  of `pos` are f32 values). Case `x-and-z-differ` is the one for the "x and z swapped" control. Regenerate with
  `python -X utf8 apps/rooms/tests/make_fixtures.py`.
- Clock: JSON `ping {t}` -> `pong {t, s}` (`s` = serverMs, the clock of the snapshot header).

### Stage R2: client core - DONE
- [x] `pnpm install --frozen-lockfile` in this worktree
- [x] `apps/fly/src/rooms/codec.ts` (pose 36 B, snapshot), `clock.ts` (`ServerClock`, median of 8), `interp.ts`
      (`RemoteTrack`, 150 ms playout, Hermite + slerp, 250 ms extrapolation then frozen), `pose.ts` (`simPose`,
      `PoseClock` 15 Hz) (commit 9ccc0ab1)
- [x] `socket.ts` (`RoomSocket`: hello, welcome, joined, left, snapshots, ping 250 ms x8 then 20 s, backoff 1-15 s,
      fatal codes stop), `api.ts` (`createRoom`, `getRoom`, `listRooms`, `socketUrl`, `ROOM_ID_RE`) (commit cbbd6908)
- [x] `remote-stage.ts` (`RemoteStage.show/dispose`, root `rooms-remotes`), `builtin/rooms.ts` install(), reason
      `'room'` in `context.ts`, note in `scene-host.ts`, dev proxy `/api/rooms` (ws) in `vite.config.ts` (commit e27228b6)
- [x] checks: `pnpm vitest run tools/bench/test/rooms-{codec,interp,socket,a6}.test.ts tools/bench/test/train1-contract.test.ts`
      5 files, 13 tests pass; `pnpm --filter ./apps/fly typecheck` exit 0, `pnpm --filter ./tools/bench typecheck` exit 0.
      Controls: in-test (codec with x and z swapped fails `x-and-z-differ`; mean clock moved > 50 ms, median < 1 ms; no
      playout buffer p99 0.399 m / max 0.622 m vs bounds 0.05 / 0.15; room 2 never sees A's pose; perturb changes the
      A6 hash) and `neg_control.py --ref train1-base` NEG OK for all four test files (old code = modules absent).

**For stage R3 (screens, speech, probe): what exists**
- `window.__gsfpv.rooms` (RoomsHook) is set on every page: without `?room=` `{state:'off', room:null, ...}` and nothing
  runs. With `?room=<id>` filled: `state` (connecting/joined/lost/off), `room`, `slot`, `members` (sorted by slot),
  `remotes` (slot, pos, ageMs; drawn this frame), `problem` (`bad-id`, `scene`, or a fatal server code `no-room`,
  `full`, `version`, `hello`, or `left`). NOT filled yet: `said` (stays []), names: the nick sent is `''`, so the server
  names everyone `Pilot-NNNN` (R3: `rooms.nick` pref in `defs/rooms.ts`, pass it as `nick` in `builtin/rooms.ts`).
- Hooks for R3 in `builtin/rooms.ts`: the `RoomSocket` callbacks `joined` / `left` (speak there), `sock.members`,
  `tracks` (per slot `RemoteTrack`; `sample(serverNow)` gives pos for Shift+O distance and side), the own pose is
  `ctx.session.shownSim`. Create a room with `createRoom('', {scene:{id: ctx.scene.id, render}, shared: sharedOf(...)})`
  then navigate or re-install with `?room=<id>`; the host key goes into `RoomSocketOptions.hostKey`.
- Share link decision for R3: build `/fly/?scene=<id>&<shared params>&room=<rid>` (boot.ts opens a scan only from
  `?scene=`; a bare `?room=` lands on the picker, see "For the lead").
- Rig: `python -X utf8 -u apps/rooms/rooms.py --host 127.0.0.1 --port 8091` plus `pnpm --filter ./apps/fly dev`
  (proxy `/api/rooms` with ws to 8091). Node tests start rooms.py themselves (`tools/bench/test/rooms-socket.test.ts`,
  free port, killed in afterAll and on process exit).
- Not done in R2: name tags, member list on screen, panel, Shift+L/Shift+O, speech, live region, near call, page probe;
  remote drones are a box primitive in the slot's colour (grey when frozen), not the drones3d model.
### Stage R3: screens, speech, probe - DONE (level 2 review left to the workflow)
- [x] `rooms/nick.ts` (the server's rule, default `Pilot-NNNN`, key `gsfpv.rooms.nick`), `rooms/around.ts` (`relation`,
      `nearest`, `whoLine`, `NearWatch` 3 m / re-arm 5 m, estimates), `rooms/announce.ts` (`Announcer`: sayVia with
      `sonic.say.text` when `ctx.sonic`, else its own `role=status` region on `document.body`; keys into `said`, last 50),
      `rooms/tags.ts` (`NameTags`, DOM overlay, `worldToScreen` of `ctx.renderer.camera`, hidden with the HUD),
      `rooms/panel.ts` (`roomsPanel`: name, create with name and listed, link + Copy, members, Leave, open rooms table with
      Join, refresh 10 s), `builtin/rooms.ts` rewritten (join/leave/create in page with `history.replaceState`, menu item
      `pause.rooms` order 72 tools, keys `rooms.panel`, `rooms.who`, `ROOMS_MENU_PUBLIC`), hook fields `nick`, `link`, `tags`
      (optional), locales `fly/rooms` x4, privacy section x4, keymap lines shipped, `SHIPPED_BY_ROOMS`, `url.ts` room/rooms
- [x] checks: `pnpm vitest run tools/bench/test/rooms-around.test.ts tools/bench/test/app-keys.test.ts
      packages/i18n/test/fly-parity.test.ts tools/bench/test/train1-contract.test.ts packages/prefs/test
      tools/bench/test/rooms-{codec,interp,socket,a6}.test.ts` 23 files, 301 tests pass; typecheck apps/fly, @gsfpv/prefs,
      tools/bench exit 0; NEG OK: rooms-around (around.ts, nick.ts absent), keymap.test (keymap.ts of train1-base),
      main-audit (url.ts of train1-base); in-test controls: mirrored x gives the other side, a turned drone turns the side,
      the server's refused names refused. Site `i18n-check.mjs` OK.
- [x] probe `tools/bench/src/rooms-serve.ts` (dist/ through serve-csp.mjs, rooms.py child, one front server passing
      `/api/rooms` HTTP and the WebSocket upgrade to rooms.py) and `tools/bench/src/rooms-two-page.ts`; `rooms.py --no-relay`
      test switch (commits fe578b56, then the probe fixes; run: `node scripts/build-release.mjs`, then in tools/bench
      `npx tsx src/rooms-two-page.ts`, about 3 min, it takes the GPU lock itself through gpu-lock.ts, once).
      Result `evidence/2026-11-13/rooms-two-page.json`, pass true: A flew 83.48 m in 20 s (bot, 6 teleports = respawns);
      B's remote vs A's own positions: best delay 180 ms, RMS 0.0631 m (bound 0.15), p50 0.0103, p90 0.0545, max 0.5092,
      444 samples compared, teleport windows +-400 ms skipped (with them: RMS 0.292 m, max 3.77 m, see Findings);
      B members hold A's nick, name tag on screen in 144 of 601 frames, A said `rooms.say.joined`, B said
      `rooms.say.welcome`, Shift+O on B appended `rooms.say.who`, after A closed B said `rooms.say.left` and Shift+O
      `rooms.say.nobody`; live region text present (27 chars). Controls fired: C in another room 0 of 599 frames with a
      remote; relay off: A flew 19.05 m, B 0 of 240 frames with a remote; x and z swapped RMS 6.3652 m. Rooms service
      tests after `--no-relay`: 42 OK. bench typecheck 0 errors.
- [ ] level 2 review (one independent agent) and fixes: NOT done by this worker (it cannot start another agent); the
      lead's workflow runs it. Stage R3 work is otherwise complete.

## Findings
- Load (`evidence/2026-11-13/rooms-load.json`): 50 synthetic pilots in 7 rooms, 15 poses/s each, 100 s, rooms.py as a
  plain Windows process on Python 3.11.9: working set 23.07 MB at start, peak 27.02 MB, 23.9 MB at the end; CPU mean
  5.3 %, peak 7.8 % of one core of this PC (5.33 CPU-seconds in all); every pilot got 15.0 snapshots/s, 8 members seen,
  0 sockets closed early. The container limits (64 MB, 0.25 CPU) were NOT reproduced: the Docker engine is not running
  on this machine (`docker info`: no engine pipe).
- Backpressure (Windows Proactor loop, one reader with SO_RCVBUF 4096 that never reads, 20000 snapshots of 80 B driven
  by `tick()`): cap on: peak unsent 16400 B, 18949 snapshots skipped; cap off: peak 1570218 B (`test_backpressure.py`).
- Snapshot rate measured by `test_relay.py` within 13.5-16.5 Hz; pose gate: 30/s kept 20/s, 70/s closed (1008).

## Decisions
- R3 probe: the join line is said to the pilots already in the room (A hears `rooms.say.joined` when B comes); the one
  who joins hears the welcome line (`rooms.say.welcome`, room name and count). The probe checks both.
- R3 probe: "A's trace hash equals solo" is checked by `tools/bench/test/rooms-a6.test.ts` (fixed-step determinism run
  with the pose reader attached); a real-time page flight has no fixed frame times to hash.
- R3 probe: B flies on `?simradio=open` (without it the first-visit flow left Shift+O unrouted in run 1); A on
  `?simradio=scenario`. Times are rAF timestamps (performance.now() in a late callback gave 0.32 m of timing noise).
- Byte order little-endian for the pose and the snapshot (DataView littleEndian=true in R2).
- Clock sync uses JSON `ping {t}` -> `pong {t, s}`: a browser cannot send WebSocket ping frames from script.
- No `./data/rooms` volume in compose for train 1: rooms live in RAM (train1-plan section 7 "nothing under DATA_DIR").
  `PYTHONDONTWRITEBYTECODE=1` because the root and `/app` are read-only.
- A bad nickname is replaced by `Pilot-NNNN` (not refused); a nickname already in the room gets `-<slot+1>`.
- Host: the holder of the host key; while nobody holds it, the oldest member. A leaving host hands it to the oldest.
- Joins are counted at the upgrade (20/min/address), creates at POST (10/h/address, 200/day in all).
- The blocklist only stops names that pretend to speak for the site (admin, moderator, gsfpv, ...): there is no free text.
- Snapshots carry only members that have sent a pose; a room with no pose sends nothing.
- R2: remote drones are a simple box primitive (body, two arms, nose) in the slot's colour, 0.25 m span (estimate),
  grey when frozen: the drones3d kit costs a build per pilot and a drone in flight is a few pixels.
- R2: the time of a remote pose is the sender's sim tick (1 ms each) mapped to server ms by the smallest
  (serverMs - tick) of the last 64 poses; a tick going back or a jump over 500 ms (pause, new scene) restarts the track.
- R2: the room's shared settings go into the visit layer with `applyShared` but no `beginSharedVisit` (no Keep/Reset
  chip in a room); the drone is left out (each pilot flies his own). Poses go up only once the room's scan is flown.
- R2: interpolation bounds measured by `rooms-interp.test.ts` on a home-link model (30 ms + 0-40 ms jitter, 10% of
  poses and snapshots dropped, in order): p99 0.0250 m, max 0.1002 m; bounds in the test 0.05 / 0.15 m.
- nginx `/api/rooms` rate zone 30 r/min burst 20 (estimate); `release-rooms.sh` checks health through `gsfpv-web`'s
  busybox wget inside the network, because nginx gets the locations only in the next release step.

## For the lead before the merge
- R3: `apps/rooms/rooms.py --no-relay` is a test switch of the probe (poses taken, never relayed); compose does not pass it.
- R3 finding for train 2: on a respawn of A, B's drone slides from the crash point to the spawn for about 0.4 s
  (`interp.ts` Hermite across the jump; probe max error 3.77 m there). A pose flag "respawned" that restarts the track
  would make it snap; not in train 1.
- Deploy order step 3: `bash deploy/release-rooms.sh --compose` (first release: creates only `gsfpv-rooms`), then
  `release-nginx.sh`; `ship.sh` now allows `gsfpv-web,gsfpv-api,gsfpv-rooms` in the neighbour diff. Never run by the lane.
- `deploy/README.md`: the new section "Rooms (train 1, lane rooms): flying together" sits directly before
  "## Deploying a release"; `nginx.conf`: zones after the `gsfpv_tg` line, two locations after `/api/health`.
- Not in the lane's paths, maybe wanted: a gate or CI line that runs `python -m unittest discover -s apps/rooms/tests`
  (42 tests, about 16 s; `test_rates` and `test_relay` use real time, so a loaded machine may slow them).
- `apps/fly/src/app/boot.ts` (not ours): a bare `/fly/?room=<id>` (the plan's link) shows the scene picker, because
  only `?scene=` starts a flight and features install only in flight. Wanted: when `?room=` has no `?scene=`, GET
  `/api/rooms/<id>` and `go(room.scene.id)`. Until then R3 writes the share link with `?scene=` and the shared params.
- Sound mode (Fly by Sound) needs nothing from R2; R3 needs `sayVia` for joins, leaves and Shift+O.
- Sound mode (Fly by Sound) needs nothing from R1; R3 speaks joins, leaves and Shift+O through `sayVia`.
- R3: THE CONSTANT that shows the menu item "Fly with others" and Shift+L to everyone: `ROOMS_MENU_PUBLIC` in
  `apps/fly/src/app/builtin/rooms.ts` (false now: only `?rooms=1` or `?room=`). Flip it after the live two-browser check
  (plan section 8 step 6), as a second static release.
- R3: deploy files and order are unchanged from R1 (plan section 8): step 3 `release-rooms.sh --compose`, step 4
  `release-nginx.sh` with both lanes' locations, step 5 `ship.sh` (allow list `gsfpv-web,gsfpv-api,gsfpv-rooms`), step 6
  the two-browser check with `?rooms=1`, then the release with `ROOMS_MENU_PUBLIC = true`. Not verified: the hub's
  nginx-proxy passing `Upgrade` to our nginx.
- R3, outside the lane's listed paths but the lane's own parameters (plan section 4 "URL parameters room, rooms"):
  `packages/prefs/src/url.ts` got two entries `room` and `rooms` in `APP_URL_PARAMS_NOT_SETTINGS`, and `builtin/rooms.ts`
  reads them through `q` of `app/env.ts`. Without that `packages/prefs/test/main-audit.test.ts` fails (3 tests; it already
  failed on the R2 commit, which read `location.search`). NEG OK against train1-base url.ts.
- R3: `rooms.nick` is NOT a prefs setting: the schema has no text type (`schema.ts` kinds: bool, number, enum, json with a
  fixed kind list) and `defs.test.ts` pins 82 settings. The nickname lives under the storage key `gsfpv.rooms.nick`
  (`apps/fly/src/rooms/nick.ts`, the server's rule). To make it a setting: a text kind in `schema.ts`, the def in
  `defs/rooms.ts` `ROOMS_DEFS`, `set.rooms.nick` labels in four fly locales, `defs.test.ts` count 83 and its A8 row, then
  `gen-catalog`.
- R3: the privacy paragraph is a new section `{"id": "rooms", ...}` before "Your rights" in the four
  `packages/i18n/locales/site/*.json` (`i18n-check.mjs` OK, 1167 strings x 4).
- Sound mode, train 2: the motor sound of other drones needs the package change of rooms-plan.md 2.7 (`SonicFrameInput.others`
  `{key, pos, vel, throttle}`, cue `others.motor` in a new layer `others` off in every lesson, priority 45, the 2 nearest
  within 15 m, `safety.craft` when closer than 2 m and closing) in `C:/dev/ShramkoSonicFPV` first, then the pin; the page
  feeds it from `builtin/rooms.ts` (`others` with `RemoteTrack.sample`, vel from the pose). Train 1 speaks only lines:
  joins, leaves, Shift+O, the near call (through `sayVia` with the host line `sonic.say.text`).

## Not verified
- R3 probe ran on a local rig (serve-csp.mjs + a Node front server), not behind the hub's nginx-proxy and our nginx; headless
  Chrome on this PC only. Speech through the engine on a `?sonic=` page was not run (the probe checks the live region path).
- Python 3.12 (the container's) is not on this machine; tests ran on Python 3.11.9. The code uses nothing newer than 3.10.
- The container limits (64 MB, 0.25 CPU, pids 8) and alpine: the Docker engine is not running here.
- nginx syntax (`nginx -t`) of the new zones and locations: no nginx binary here; checked only by the route tests.
- `deploy/release-rooms.sh`: `bash -n` only; it was never run (no SSH, no deploy in this lane).
- R2: the feature in a page (`builtin/rooms.ts`, `remote-stage.ts`) never ran in a browser: no page probe in R2 (the
  plan puts the two-page probe in R3). The tests' TypeScript is not typechecked (`tools/bench` tsconfig includes only
  `src/`); vitest ran them. serverMs wraps after 49.7 days of service uptime: not handled by `interp.ts`.
- The hub's nginx-proxy passing `Upgrade` to our nginx (rooms-plan.md 2.1 says not verified on this hub).
- R3 so far: the panel, tags, announcer and Shift+L / Shift+O never ran in a browser (the two-page probe is the next
  step); `panel.ts`, `tags.ts`, `announce.ts` have no unit test (DOM; the probe covers them). Speech through the engine
  (`sonic.say.text`) is not heard or checked on a `?sonic=` page.

## Cost notes
- R1: about 30 replies. Most turns: a test that hung (a drain loop that read snapshots forever) and the Write tool
  turning `\uXXXX` in a test into real letters (gate B18); cheaper: give every read loop a deadline from the start and
  write non-ASCII test strings with chr() or run an ASCII check right after writing a test.
- R2: about 33 replies. Most turns: reading the code around the join (boot, scene-host, shared-visit, bridge, a6) to
  find the entry points one by one; cheaper: the plan's code map with the boot rule "only ?scene= starts a flight" and
  the exact helper names (applyShared, readShared, runDeterminism's loop) would have saved about 8 replies.
- R3 (first worker): about 45 replies, the probe not reached. Most turns: finding the seams one grep at a time (camera
  `ctx.renderer.camera`, `ctx.sonic`, the speakable host line `sonic.say.text`, `ctx.hud.root`, the schema having no text
  setting, main-audit's rule that only `app/env.ts` reads the query) and Write turning `\uXXXX` into letters again;
  cheaper: a stage this size split into two (screens and speech; probe), the plan naming those seams, and a pre-run of
  `packages/prefs/test` in R2 (it would have caught the `location.search` read there).
- R3 (second worker): about 22 replies. Most turns: the probe itself (3 runs: timing noise from performance.now(),
  Shift+O unrouted on a page with no radio, teleports in the RMS); cheaper: the plan naming rAF timestamps for page
  traces and `?simradio=open` for a page that only listens.
