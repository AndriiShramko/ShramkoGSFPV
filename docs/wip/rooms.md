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

### Stage R2: client core (not started)
- First step of R2: `pnpm install --frozen-lockfile` in this worktree (R1 needed no Node and did not run it; the
  submodule `packages/sonic-fpv` is initialised at 83ce612).
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
- nginx `/api/rooms` rate zone 30 r/min burst 20 (estimate); `release-rooms.sh` checks health through `gsfpv-web`'s
  busybox wget inside the network, because nginx gets the locations only in the next release step.

## For the lead before the merge
- Deploy order step 3: `bash deploy/release-rooms.sh --compose` (first release: creates only `gsfpv-rooms`), then
  `release-nginx.sh`; `ship.sh` now allows `gsfpv-web,gsfpv-api,gsfpv-rooms` in the neighbour diff. Never run by the lane.
- `deploy/README.md`: the new section "Rooms (train 1, lane rooms): flying together" sits directly before
  "## Deploying a release"; `nginx.conf`: zones after the `gsfpv_tg` line, two locations after `/api/health`.
- Not in the lane's paths, maybe wanted: a gate or CI line that runs `python -m unittest discover -s apps/rooms/tests`
  (42 tests, about 16 s; `test_rates` and `test_relay` use real time, so a loaded machine may slow them).
- Sound mode (Fly by Sound) needs nothing from R1; R3 speaks joins, leaves and Shift+O through `sayVia`.

## Not verified
- Python 3.12 (the container's) is not on this machine; tests ran on Python 3.11.9. The code uses nothing newer than 3.10.
- The container limits (64 MB, 0.25 CPU, pids 8) and alpine: the Docker engine is not running here.
- nginx syntax (`nginx -t`) of the new zones and locations: no nginx binary here; checked only by the route tests.
- `deploy/release-rooms.sh`: `bash -n` only; it was never run (no SSH, no deploy in this lane).
- The hub's nginx-proxy passing `Upgrade` to our nginx (rooms-plan.md 2.1 says not verified on this hub).

## Cost notes
- R1: about 30 replies. Most turns: a test that hung (a drain loop that read snapshots forever) and the Write tool
  turning `\uXXXX` in a test into real letters (gate B18); cheaper: give every read loop a deadline from the start and
  write non-ASCII test strings with chr() or run an ASCII check right after writing a test.
