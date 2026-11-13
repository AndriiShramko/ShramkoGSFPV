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
### Stage R3: screens, speech, probe (not started)

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

## Not verified
- Python 3.12 (the container's) is not on this machine; tests ran on Python 3.11.9. The code uses nothing newer than 3.10.
- The container limits (64 MB, 0.25 CPU, pids 8) and alpine: the Docker engine is not running here.
- nginx syntax (`nginx -t`) of the new zones and locations: no nginx binary here; checked only by the route tests.
- `deploy/release-rooms.sh`: `bash -n` only; it was never run (no SSH, no deploy in this lane).
- R2: the feature in a page (`builtin/rooms.ts`, `remote-stage.ts`) never ran in a browser: no page probe in R2 (the
  plan puts the two-page probe in R3). The tests' TypeScript is not typechecked (`tools/bench` tsconfig includes only
  `src/`); vitest ran them. serverMs wraps after 49.7 days of service uptime: not handled by `interp.ts`.
- The hub's nginx-proxy passing `Upgrade` to our nginx (rooms-plan.md 2.1 says not verified on this hub).

## Cost notes
- R1: about 30 replies. Most turns: a test that hung (a drain loop that read snapshots forever) and the Write tool
  turning `\uXXXX` in a test into real letters (gate B18); cheaper: give every read loop a deadline from the start and
  write non-ASCII test strings with chr() or run an ASCII check right after writing a test.
- R2: about 33 replies. Most turns: reading the code around the join (boot, scene-host, shared-visit, bridge, a6) to
  find the entry points one by one; cheaper: the plan's code map with the boot rule "only ?scene= starts a flight" and
  the exact helper names (applyShared, readShared, runDeterminism's loop) would have saved about 8 replies.
