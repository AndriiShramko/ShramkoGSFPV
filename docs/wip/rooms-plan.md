# Stage 4 "Rooms": several pilots in one scene, also on time (plan)

Status: design only, checked against the code on 2026-11-13. No code was changed, no test and no browser was run.
Owner's requirements R25-R28 (hub) and the owner's question of 2026-11-10: "at what stage are shared flights in one
location on time?"

Short answer: **shared flights are stage 4; the first release (4A + 4B) gives a room, a link, joining and the other
pilots' drones in the same scan, without a timer. Flights on time in a room (4D) need the course and the lap timer of
stage 2 (`docs/wip/tracks-plan.md` 2.5), so they come after stage 2's first release.** Today there is no multiplayer
code at all: no WebSocket, no long-lived connection, no remote drone, no room.

---

## 1. What exists today (paths and lines)

### 1.1 Server

- `apps/api/server.py`: Python 3.12 stdlib only (imports `:72-113`), `ThreadingHTTPServer` (`:96`, started `:1823`):
  **one thread per open connection**. No WebSocket, no `Upgrade` handling, no asyncio (grep `websocket|Upgrade` in
  `apps/api`: no match). Every route is a short request/answer.
- Rate limits in RAM: `_rate(bucket, key, n, window)` `server.py:179`; per-client buckets used e.g. for the recordings
  `:1614-1621` and leads `:1721`. Client address = first `X-Forwarded-For` value as nginx sets it (`_client`
  `:1442-1443`).
- Pilots have **no accounts**. Per-object secrets only: the session upload token (`sessions.py:39`, per
  `tracks-plan.md` 1.5). Share ids: `secrets.token_urlsafe(8)`, 11 characters (`server.py:1227`), id regex `:838`.
- Shared scene settings already have a server-side validator (`server.py:1127-1157`: size 0.25-100, floaters, wind,
  ceiling, drone id regex) and a client half (`apps/fly/src/app/shared-visit.ts:1-14`, `@gsfpv/scenes`
  `shared-settings.ts`): a link can carry a scene's size, walls, floaters, ceiling and wind for one visit, without
  touching the pilot's stored settings. A room needs exactly this to make everyone fly the same flown world.
- Admin: `apps/api/admin.py:1-43` (scrypt password, SameSite=Strict cookie, `X-CSRF` on every POST, brute-force lock,
  audit `admin-audit.jsonl`), `AdminApi.add_route` `:638-642` (from `tracks-plan.md` 1.5). The scene catalogue has
  ordered **collections** (`admin.py:318-319`, `:400-425`, max 8 per scene): a "series of scans" can be a collection.
- Storage: files on the `DATA_DIR` volume, atomic `os.replace` (`server.py:893`).

### 1.2 Deploy and the hub

- `deploy/compose.yml:13-58`: two containers. `gsfpv-web` nginx 1.29-alpine, `mem_limit 96m`, `cpus 0.5`,
  `pids_limit 64` (`:27-29`), on `web-proxy` (external, the hub's nginx-proxy + acme) and `gsfpv-internal`.
  `gsfpv-api` python:3.12-alpine, read-only root, code mounted read-only from `./api`, `mem_limit 192m`, `cpus 0.25`,
  **`pids_limit 32`** (`:54-56`), only on `gsfpv-internal`. No host ports (`:2`).
- Neighbours rule: "The web-proxy network is external: never created or changed from here. Neighbours are never
  touched" (`compose.yml:3-4`); every deploy diffs neighbour snapshots (`deploy/neighbours.py`, `deploy/ship.sh:41-46`,
  `--allow gsfpv-web,gsfpv-api`); hub deploy lock `/tmp/hub-deploy.lock` (`ship.sh:3`).
- `deploy/nginx.conf`: one location per API route; resolver per request (`:76-79`); `^~ /api/session/` (`:218-235`) is
  the pattern for a per-client POST route (real-IP lines, `Cookie`/`Authorization` cleared, `no-store`); `/s/<id>`
  share pages (`:238-246`); one `limit_req_zone` (`:32`). **No `proxy_http_version 1.1`, no `Upgrade`/`Connection`
  headers, no `proxy_read_timeout` anywhere** (grep): WebSocket does not pass today.
- CSP `connect-src 'self' ...` (`nginx.conf:64`): a same-origin `wss:` is allowed by CSP Level 3 `'self'`.
- Release scripts: `deploy/release-api.sh`, `deploy/release-nginx.sh` (`nginx -t`, `.prev` rollback), `deploy/ship.sh`
  for the static release (`deploy/README.md:514-527`).

### 1.3 Simulation step and determinism

- `packages/sim-core/src/sim.ts:27` `DT_US = 1000` (1 kHz physics); `runner.ts:33` `MAX_CATCHUP_STEPS = 250`;
  `apps/fly/src/simclock.ts:69-77` steps the runner up to the frame's time. `SIM_CORE_VERSION = 'sim-core/0.2.0'`
  (`index.ts:18`). State in `Sim.s: Float64Array` (`sim.ts:180`), test seam `perturb` for the determinism negative
  control (`:187-191`). Rule (`AGENTS.md`): no `Math.sin/random/Date` in the step; trace hash identical everywhere (A6).
- Fly by Sound's bridge states the A6 boundary we must keep: "Nothing here runs while the mode is off ... so an
  ordinary flight is the same flight (A6)" (`apps/fly/src/sonic/bridge.ts:29-30`).

### 1.4 The pose frame that exists

- `FlightSample` (`packages/sonic-fpv/src/contract.ts:64-85`): `t`, `tick`, `pos`, `vel`, `quat`, `rate`, yaw/pitch/
  roll, `sticks`, `armed`, `touched`, `paused`. Built from the model at `bridge.ts:323-325`
  (`[s[S.px], s[S.py], s[S.pz]]`, `[s[S.qw], ...]`) once per rendered frame and emitted as `ctx.events 'sonicSample'`
  (`sonic/mode.ts:95`, typed in `app/sonic-context.ts:9-10`); the recorder keeps 30 Hz (`sonic-session/recorder.ts:8`,
  `:419`). Only while Fly by Sound runs. `SonicFrameInput` (`contract.ts:662-676`) = `{sample, world, target, beacon?,
  floorY}`: **no field for other craft.**
- Page events (`apps/fly/src/app/context.ts:32-49`): `frame {now}` per rendered frame, `life`, `session` (new scene
  session), `pause`, `walls`, `crashCleared`. A rooms feature reads `ctx.session`'s shown sim on `frame` the same way
  the bridge does.

### 1.5 Drawing drones, scenes, links

- 3D drone models: `apps/fly/src/drones3d/**` (procedural `MeshData`, `mesh.ts:7-41`; `Kit`/`Model` `kit.ts:27-39`;
  families whoop, open-x, x8; `build.ts:76 buildFor(preset, payload)`). They are drawn **only in the drone picker**
  (`ui/drone.ts:173-176` lazy `mountStage`, `drones3d/viewer.ts:99`). The flight scene draws no drone.
- Primitives in the flight scene: `apps/fly/src/sonic/primitives.ts:307-383` `PrimitiveStage` (own root under
  `renderer.app.root`, `show(prims)`), public PlayCanvas API only (`tools/bench/src/a1-api-check.ts`).
- In-page scene switching without reload: `apps/fly/src/app/scene-host.ts:1-19` (design), `SceneHost.go` `:169`,
  `SceneHost.load(id, reason, render?)` `:195`, old session disposed `:246`, `?scene=` kept by `replaceState`
  `:275`. Reasons `context.ts:64` `'next'|'random'|'favourite'|'auto'|'pick'|'back'` (no `'room'`).
- Share links: `POST /api/share` + `/s/<id>` page with Open Graph (`server.py:29`, `:838-851`, `:1037-1043`,
  `nginx.conf:238-246`).

### 1.6 Timer, stats, tracks

- No lap timer outside Fly by Sound lessons (`timedLine`, `lesson/runner.ts:1323-1330`); end-of-flight stats
  `app/builtin/summary-stats.ts` have no lap notion. Stage 2 plans `packages/tracks` (`LapTimer`, `gateCrossing`,
  deterministic course generator, link `&course=g1.<seed>`, walls digest) (`tracks-plan.md` 2.2, 2.5, 3).

### 1.7 Sound for blind pilots

- Layers `contract.ts:268` `safety, height, speed, target, shape, room, voice`; cue ids `i18n/catalog.ts:23-44`.
- Voice budget `cues/voices.ts:7-8` `MAX_MOVING_VOICES = 8`, `MAX_STATIC_VOICES = 24`; priorities `:11-22`
  (hazard 100, touch 95, free 90, target 80, gateNote 75, shape 60, preview 50, chime 40); `VoiceAllocator` `:41`
  steals only from strictly lower priority. Hazard voices at most 3 (`sense/sampler.ts:41`, `planner.ts:405`).
- Speech: `sonic-session/platform.ts:99 sayVia(runtime)` (`SpeechLine`, `interrupt`); screen-reader live regions exist
  (`#ui` is one aria-live region, `sonic-session/panel.ts:6`).
- Package rules (`packages/sonic-fpv/AGENTS.md`): edit only in its own repository (`C:\dev\ShramkoSonicFPV`), contract
  changes together with the simulator, every new cue in the glossary and named-sounds tests, every sound claim measured
  with a negative control, strings in en/es/pl/ru.

### 1.8 Admin UI

- `apps/fly/src/admin/main.ts:12-21,54-70`: tabs scenes, drawing, ideas, outreach, sessions, chosen by a ternary at `:58`
  (from `tracks-plan.md` 1.5). Rooms get a sixth tab.

---

## 2. Design

### 2.1 Transport: WebSocket, in a new small container

| | WebSocket via the hub's nginx | WebRTC | HTTP polling |
|---|---|---|---|
| Latency | one TCP hop each way, ~RTT/2 + one server tick | lowest (P2P UDP) | poll interval + RTT; 10-15 Hz polling is 10-15 requests/s per pilot |
| Server | one asyncio process holds all sockets | still needs a signalling server (a WebSocket anyway) and, for pilots behind symmetric NAT, a TURN relay: UDP ports on the hub's host, which the compose has none of (`compose.yml:2`) and the neighbours rule forbids opening casually | every poll is a thread in `ThreadingHTTPServer` and a log line; 50 pilots x 15 Hz = 750 req/s against `cpus 0.25` |
| Topology | star: N up, N down, server relays | full mesh: N-1 peer links per pilot (49 at 50 pilots), or an SFU = a media server | star |
| Hub changes | one location with `Upgrade` in our own `nginx.conf`; the hub's nginx-proxy passes `Upgrade` in its standard template (not verified on this hub) | STUN/TURN, ports, firewall | none |
| Authority | the server can order the race start, votes, kicks | no authority without the server | yes, but slow |

**Choice: WebSocket.** It is the only option that needs no host port and no change outside our compose project,
gives one authority for starts, votes and kicks, and scales by relaying one aggregated snapshot per room tick. WebRTC's
lower latency does not matter for drawing other drones 150 ms in the past and costs a TURN server. Polling would put
hundreds of requests a second on a 0.25-CPU thread-per-request API.

**Where it runs: a new container `gsfpv-rooms`**, not inside `gsfpv-api`:
- `gsfpv-api` is thread-per-connection with `pids_limit 32`: 30 open WebSockets would exhaust the threads and stop
  leads, sessions and the admin. An asyncio service holds all sockets in one thread.
- Same image (`python:3.12-alpine`, already on the hub), stdlib only (asyncio + a ~200-line RFC 6455 framing module:
  handshake, masking, text/binary/ping/pong/close, 64 KB max message, no extensions), read-only root, code from
  `./rooms:/app:ro`, `./data/rooms:/data/rooms`, network `gsfpv-internal` only, `mem_limit 64m`, `cpus 0.25`,
  `pids_limit 8`, the same logging anchor. It also serves the small HTTP JSON routes of rooms (list, create) on the same
  port, so no second process.
- nginx (`deploy/nginx.conf`, our container only):
  - `location = /api/rooms/ws`: GET only, real-IP lines as `/api/session/`, `proxy_http_version 1.1`,
    `proxy_set_header Upgrade $http_upgrade`, `proxy_set_header Connection "upgrade"`, `proxy_read_timeout 75s`
    (client pings every 20 s), `proxy_buffering off`, `Cookie`/`Authorization` cleared, upstream
    `$rooms_upstream` = `http://gsfpv-rooms:8091` with the existing per-request resolver.
  - `location ^~ /api/rooms`: GET/POST JSON, `client_max_body_size 4k`, `no-store`, a `limit_req` zone like `gsfpv_tg`.
  - a `limit_conn` zone: at most 4 WebSockets per client address.

### 2.2 Synchronisation model

- **Each client simulates only its own drone** with its own deterministic `Sim`, unchanged. Rooms never write into the
  flight model, the input log or the runner: A6 and every replay stay as they are (bridge rule, `bridge.ts:29-30`).
- **Pose up at N = 15 Hz** (every frame whose time crossed the next 66.7 ms boundary), read from the shown sim as
  `bridge.ts:323-325` does: binary frame, 36 bytes: `u8 kind, u8 flags (armed, crashed, paused, in-race), u16 seq,
  u32 tick, f32 x3 pos, i16 x4 quat (x 32767), i16 x3 vel (cm/s), u16 throttle (0..65535)`. Throttle drives the remote
  motor sound. Poses are in the room's flown frame; every member flies the room's transform (2.3), so no conversion.
- **Down at 15 Hz:** the server keeps the last pose per member and, per room tick, sends **one snapshot** to everyone:
  `u8 kind, u32 serverMs, u8 count, count x (u8 slot + 36 B)`. Built once per room per tick and sent to each socket
  (the client skips its own slot).
- **Remote drones are interpolated**, never simulated: a 150 ms playout buffer on the receiver's clock (offset from
  ping/pong, NTP style, median of 8), Hermite between the two bracketing poses using `vel`, slerp for the quaternion;
  extrapolation at most 250 ms, then the drone freezes and fades as "connection lost".
- **No collisions between drones** in releases 1-3: remote drones are not in any `ContactWorld`. A close pass (< 0.5 m
  between centres) is shown and heard as a "near miss" only. Solid drones would make a crash depend on network timing
  and break replays; as an option later only as a counted touch (decision 3).
- Slow clients: when a socket's write buffer exceeds 16 KB the server skips snapshots for it (only the newest matters).

### 2.3 Rooms

- **Room** = `{id (11 chars, token_urlsafe(8)), name, scene {id, render?}, shared settings (the share-link set:
  size, walls, floaters, ceiling, wind), drone ids allowed (any), cap (8; persistent rooms 16), listed: bool,
  createdAt, hostSlot, kind: 'temp'|'persistent', course?}`.
- **Create:** pause menu "Fly with others" -> "Create room" (name, listed or unlisted). `POST /api/rooms` with the
  current scene and its shared settings (validated by a port of `server.py:1127-1157`) answers `{id, hostKey}`; the
  host key (random 128-bit, sha256 kept) goes in the first WebSocket message, never in a URL. Temp rooms live in RAM and
  close 10 minutes after the last pilot leaves.
- **Share:** the link `https://gsfpv.flyreelstudio.eu/fly/?room=<id>` (the `/fly/` redirect keeps the query,
  `nginx.conf:100-104`); the share panel offers it and the system share sheet. Later `/r/<id>` with Open Graph like
  `/s/<id>`.
- **Join:** `?room=<id>` (or a click in the list) opens the WebSocket, gets `welcome {slot, room, members, scene}`;
  if the scene differs, `SceneHost.load(scene.id, 'room', render)` (new reason `'room'` in `context.ts:64`) with the
  shared settings put into the VISIT layer as `shared-visit.ts` does (never stored). The pilot's own drone, radio and
  rates stay theirs.
- **List of open rooms:** `GET /api/rooms` -> listed rooms with scene title, member count, cap, race state; refreshed
  every 10 s while the list is open; a table readable by screen readers (one row per room, a "Join" button).
- **Leave:** pause menu or closing the tab; the server broadcasts `left {slot}`. A host who leaves hands the host role
  to the oldest member.
- **Persistent room "Drony Bydgoszczy" (R27):** defined by the admin (2.6) in `data/rooms/rooms-admin.json`:
  `{id: 'bydgoszcz', name, series: <catalogue collection id>, cap 16, listed, open}`. Its scene is the current item of
  the series (the collection's scenes in the admin's catalogue order). It never closes.
- **Vote to change the scene:** any member may propose "next in series" or a named scene of the series. The server
  opens a 30 s vote; the proposer counts yes; passes when **yes > half of the members present** (connected, not idle
  > 2 min); otherwise fails at 30 s. One vote at a time, 3 minutes cooldown after a change, at least 5 minutes on a
  scene before a proposal (admin can override). On pass the server sends `scene {...}` and every client loads it in-page
  (`SceneHost.load`); a race in progress blocks proposals.

### 2.4 Race on time in a shared scene (needs stage 2)

- The host (or the admin in a persistent room) picks a course: stage 2's deterministic link `g1.<seed>` (or later a
  server track `id.v<n>`). Every client builds it on its own walls and sends its walls digest; the server shows a
  mismatch warning per pilot ("your walls differ: times are not comparable") instead of hiding it.
- **Start:** host presses "Race"; server sends `race {course, laps, startAt: serverMs + 10000}`; every client shows
  and speaks a countdown 10, 3, 2, 1, go on its offset-corrected clock and respawns at the course start (the existing
  respawn rules; a pilot already at the start keeps flying). The clock of each pilot starts as in stage 2 (leaving the
  start zone or crossing gate 1), so a late start costs that pilot only.
- **Timing is local:** each client's `LapTimer` (stage 2 `packages/tracks/src/laps.ts`) on its own sim reports
  `lap {n, ms, splits[], touches}` and `finish {totalMs}`; the server orders the table (total, then best lap), closes
  the race at the first finisher + 60 s or when all finished/left, and broadcasts `results`. Times are self-reported
  (no server physics); a flight log digest per finish is kept for a later check, see risks.
- Table in the HUD: position, name, lap, gap to the leader (updated at each split). Persistent rooms keep the day's
  best 10 per course in `data/rooms/best-<room>-<date>.json` (name, ms, course, walls digest), nothing else.

### 2.5 Names and moderation

- A nickname is asked once and kept in prefs: 2-20 characters, the `tracks-plan.md` 2.8 rule (Unicode letters, digits,
  space, `-_.'`, NFC, no control characters, no `://` or `www.`), a short blocklist; default "Pilot-" + 4 digits.
- **No free-text chat** in the first releases (decision 2): a fixed set of 8 quick phrases ("ready", "wait",
  "go", "good race", ...) in the four locales, so nothing needs reading by a moderator.
- Host: kick (the pilot cannot rejoin that room for 10 min). Admin: kick, ban for 24 h by keyed hash of the address
  (as the admin audit hashes), rename to "Pilot-n", close a room. Rates: 10 room creations/hour/address, 200/day in
  all; 20 joins/min/address; 5 proposals/10 min per member; pose messages above 20/s from one socket are dropped and a
  socket above 60/s is closed.

### 2.6 Admin

- `apps/api/rooms_admin.py` through `ADMIN.add_route` (`admin.py:638`): CSRF, session and audit for free. It writes
  `data/rooms/rooms-admin.json` (persistent rooms, series, open/closed, bans) atomically (`os.replace`). The rooms
  service reads that file on mtime change (every 2 s) and writes `data/rooms/live.json` (rooms, members by nickname,
  votes, race) every 5 s for the admin tab to show; actions that must reach a live room (kick, close, force scene)
  go as an append-only `data/rooms/commands.jsonl` the service tails. No admin port on the rooms service, no cookie
  ever reaches it.
- Tab `apps/fly/src/admin/rooms/tab.ts`: persistent rooms (series = a collection picked from the catalogue),
  live rooms and members, force scene, close, kick/ban, unban.

### 2.7 Blind pilots (R28)

What a blind pilot hears about the others:
- **Joins, leaves, votes, race countdown, laps, results** as speech: through `sayVia` (`platform.ts:99`) when Fly by
  Sound runs, otherwise into a dedicated polite live region (`role=status`) the screen reader reads; never into `#ui`
  wholesale. Lines like "Anna joined. 4 pilots." / "Vote: next scan. Yes 2 of 4. Press Shift+V for yes." /
  "Lap 2, 34.1 seconds, second place, 1.2 seconds behind".
- **Other drones as sound** (package change, in `ShramkoSonicFPV` first, then the pin): new optional
  `SonicFrameInput.others?: readonly OtherCraft[]` (`{key, pos, vel, throttle}`), new cue `others.motor` in a new layer
  `others` (off in every existing lesson, so nothing changes for them), a quiet motor timbre per slot (on the
  pentatonic scale by slot, as the package requires), priority 45 (below `preview` 50, above `chime` 40), at most the
  **2 nearest within 15 m** take moving voices; and `safety.craft` priority 100 - rank when another drone is closer than
  2 m and closing (it may take one of the 3 hazard slots, like a wall). Glossary lines, named-sounds test, listen proof
  with a negative control (an engine with the layer off must not sound it; a third drone must not take a voice).
- **"Who is around" on demand:** in room mode a key routes "nearest pilot: Anna, 6 metres, left, above", using the
  mode's own key table (`KeyLookup.map`, `keymap.ts:139`) or a Shift chord, chosen against `keymapProblems`.
- The room list, create and join dialogs are plain buttons and tables, reachable with Tab, announced by the screen
  reader; joining by link needs no visual step. Sighted features (name tags) have spoken equivalents.

### 2.8 Server load and memory (estimate, not measured)

Assumptions: 15 Hz up and down, pose 36 B, snapshot `6 + 37 x members` B, WebSocket header 2-6 B, TLS ends at the
hub's proxy (inside the hub the traffic is plain).

| | 10 pilots, one room | 50 pilots, one room (cap raised) | 50 pilots, 5 rooms of 10 |
|---|---|---|---|
| Messages in /s | 10 x 15 = 150 | 750 | 750 |
| Snapshot bytes | 6 + 37 x 10 = 376 | 6 + 37 x 50 = 1856 | 376 |
| Messages out /s | 150 | 750 | 750 |
| Bytes out /s | 150 x 380 = 57 KB (0.46 Mbit/s) | 750 x 1860 = 1.4 MB (11 Mbit/s) | 750 x 380 = 285 KB (2.3 Mbit/s) |
| Bytes in /s | 150 x 42 = 6.3 KB | 32 KB | 32 KB |
| CPU (Python, ~50 us per receive or send incl. framing) | 300 x 50 us = 15 ms/s = 1.5 % of a core | 1500 x 50 us = 75 ms/s = 7.5 % | 7.5 % |

Memory of `gsfpv-rooms`: interpreter + asyncio + json/hashlib ~ 20 MB; per socket: transport and reader objects
~ 10 KB, write buffer capped at 16 KB, member state ~ 1 KB, so ~ 27 KB x 50 = 1.4 MB; kernel socket buffers are
charged to the container's cgroup: up to ~ 100 KB per socket under load = 5 MB at 50. **Estimate: 25-30 MB at 50 pilots,
inside a 64 MB limit; the 0.25 CPU limit leaves ~3x headroom at 50.** `gsfpv-web` (nginx): each WebSocket is two
connections (client side, upstream): 100 of the default 1024 `worker_connections`; proxy buffers ~ 16 KB per
connection = 1.6 MB of its 96 MB. Both numbers must be measured (stage 4A test) before raising caps.

### 2.9 Privacy

- No accounts, no e-mail, no location. Others see only the nickname and the pose while both are in the room.
- Poses are never written to disk; the server keeps only the last pose per member in RAM. Race results are kept only for
  persistent rooms (day best 10: nickname, time, course). Addresses: in RAM for rate limits; bans keep a keyed hash
  for 24 h.
- Host keys and room ids never go to analytics; the room id appears in the page URL and nginx's access log path
  (`/fly/?room=`), the host key never does (first WebSocket message). The rooms service logs like `log_message`
  (`server.py:1429-1431`): no address, no query.
- Fly by Sound recordings made in a room record the pilot's own flight only; other pilots' nicknames are not written
  into a session package (the minors' rule of the package stays untouched).
- The privacy page gets a paragraph on rooms (nickname and live position visible to the room).

---

## 3. Stages, branches, order

Shared contracts (written first, by 4A, changed only by agreement):
- `docs/rooms-protocol.md`: JSON control messages (`hello {room, nick, hostKey?, version}`, `welcome`, `joined`,
  `left`, `scene`, `vote`, `race`, `lap`, `finish`, `results`, `phrase`, `kick`, `error`), the binary pose and snapshot
  layouts of 2.2, protocol version `rooms/1`.
- Shared fixtures `apps/rooms/tests/fixtures/` (pose and snapshot bytes with their decoded JSON) run by the Python and
  the TypeScript codec tests.
- The HTTP routes `GET /api/rooms`, `POST /api/rooms`, `GET /api/rooms/<id>` rows in `deploy/README.md`.

### 4A: branch `rooms-server`
Owns `apps/rooms/**` (`rooms.py` service, `ws.py` framing, `protocol.py`, `tests/`), `deploy/compose.yml` (service
`gsfpv-rooms`), `deploy/nginx.conf` (two locations, zones), `deploy/README.md` rows, `deploy/release-rooms.sh`, the
allow list in `deploy/ship.sh` (`gsfpv-rooms`), `apps/api/tests/test_nginx_routes.py` additions.
Tests (Python, stdlib clients): handshake per RFC 6455 test vector (control: wrong `Sec-WebSocket-Accept` is
rejected); relay: 3 clients, A's pose appears in B's and C's snapshots (control: a client in another room never sees
it); rates (control: 30 poses/s gets dropped to 20 and 70/s closes the socket); backpressure: a client that stops
reading keeps memory under the cap (control: with the cap disabled the test's bound fires); load: 50 synthetic clients
at 15 Hz for 120 s in the container's limits, RSS and CPU written to `evidence/` (this replaces the 2.8 estimate).
nginx: the WebSocket location passes `Upgrade` (control: the mutated config without `Connection "upgrade"` fails the
route test).

### 4B: branch `rooms-fly` (client; with 4A = first release)
Owns `apps/fly/src/rooms/**` (codec, socket with reconnect, clock offset, interpolation, remote drone stage built from
`drones3d` meshes as a PlayCanvas mesh with a low-poly level, name tags as a projected DOM overlay, room panel, list,
create/join dialogs), `apps/fly/src/app/builtin/rooms.ts` (feature), `'room'` in `SceneSwitchReason`
(`app/context.ts:64`) and its handling in `scene-host.ts`, room strings in the four locales.
Tests: codec against the shared fixtures (control: a codec with x and z swapped fails); interpolation on scripted
poses with jitter and loss (error < 5 cm at 15 Hz, 150 ms; control: no buffer = visible stutter metric fails);
**A6:** a bot flight with rooms on (connected, others moving) gives the same trace hash as solo (control: the `perturb`
seam, `sim.ts:187-191`, changes it).

### 4C: branch `rooms-admin` (persistent room, series, votes, sound)
Owns `apps/api/rooms_admin.py` and its wiring lines in `server.py`, `apps/fly/src/admin/rooms/**`, two lines in
`admin/main.ts`, vote logic in `apps/rooms/votes.py`, the spoken room lines; in `ShramkoSonicFPV`: `others` layer,
`others.motor`, `safety.craft`, glossary, proofs; then the pin move here.
Tests: vote majority (2 of 4 fails, 3 of 4 passes; control: counting the proposer twice is caught); admin POST without
`X-CSRF` 403; scene change reaches all clients in one switch; sound proofs as in 2.7.

### 4D: branch `rooms-race` (after stage 2 `tracks-fly` is released)
Owns `apps/rooms/race.py`, `apps/fly/src/rooms/race/**` (countdown, table HUD, spoken results), using
`packages/tracks` read-only. Tests: scripted laps from two clients give the right order and gaps (control: a lap
reported before the start is refused); countdown lines spoken in order (control: a missing line fails the speech log).

**Deploy order** (each step with neighbour snapshots before/after, the hub lock, allow list
`gsfpv-web,gsfpv-api,gsfpv-rooms`): (1) `release-rooms.sh`: copy `apps/rooms`, `docker compose up -d gsfpv-rooms`
(creates only the new container), health check `GET /api/rooms/health` from inside `gsfpv-web`'s network;
(2) `release-nginx.sh`: the new locations, `nginx -t`, reload; (3) static release via `ship.sh` with the feature
hidden behind `?rooms=1`; (4) after the two-browser check on the live site, the static release that shows the menu
item. Rollback in reverse order; the API (`gsfpv-api`) is untouched until 4C.

**Smallest useful first release (4A + 4B):** "Fly with others" in the pause menu: create a room on the current scan
with its settings, copy the link, a friend opens it and lands in the same scan with the same size; both see each
other's drone with a name tag, a member list, joins and leaves spoken/announced, leave. Cap 8, temp rooms only, no
race, no vote, no chat. It answers R25 and R26 and the first half of the owner's question; R28 gets the spoken
announcements and an accessible list (the drone sound comes in 4C).

**Check with two headless browsers** (bench harness, local rig: `rooms.py` + `vite preview` behind a local nginx with
the same `nginx.conf` locations):
1. Page A loads the fixture scene `39e63ce9`, creates a room; page B opens A's link.
2. A flies a scripted bot path (SimRadio + bot pilot, `packages/input`) for 20 s; B records the remote entity's position
   each frame and A its own sim position with timestamps.
3. Pass: B's remote drone follows A's path with RMS error < 0.15 m after aligning the 150 ms delay; B's member list
   has A's nickname; A's trace hash equals A's solo run.
4. **Negative controls that must fire:** B joins a different room id: no remote entity, assertion fails; the server
   with relay switched off (test flag): B's entity never moves; a client codec with swapped axes: RMS error above
   bound; nginx config without the `Upgrade` header: the connection fails and the test reports it.

---

## 4. Risks and owner's decisions

Risks:
- The hub's nginx-proxy template and timeouts for WebSocket are not verified; if it does not pass `Upgrade`, rooms need
  a change outside our project (forbidden by the neighbours rule) or a polling fallback at 4 Hz.
- Different walls (refined vs shipped, floater filter) make shared courses differ; times then are not comparable
  (mitigated by the walls digest warning, not solved).
- Self-reported race times can be faked; acceptable for a friendly room, not for prizes.
- Remote drones in a Gaussian splat scene: depth against splats unknown (same open point as gates in stage 2).
- A busy persistent room may exceed 16; the cap holds, overflow gets "room full, open a copy".

Owner's decisions (default first):
1. **A third container on the hub** (`gsfpv-rooms`, 64 MB, 0.25 CPU, no host port). Default: yes. Alternative: a
   thread with its own asyncio loop inside `gsfpv-api` (no compose change, but rooms and the recordings share 192 MB
   and 0.25 CPU and a rooms bug can stop the API).
2. **Text chat.** Default: none, 8 quick phrases in four locales. Alternative: free chat with blocklist, report button
   and admin moderation.
3. **Collisions between drones.** Default: none (near misses shown and heard only; replays and A6 unchanged).
   Alternative later: a counted "touch" between drones in races, still without physics.

---

## 5. Not verified

- No code, test, typecheck or browser run was made for this plan. All numbers in 2.8 are estimates.
- The hub's nginx-proxy: whether it forwards `Upgrade`/`Connection` and its `proxy_read_timeout` (not in this
  repository; its config was not read and must not be changed).
- That a same-origin `wss:` is accepted by `connect-src 'self'` on every browser the simulator supports (CSP Level 3
  says yes; old Safari did not).
- Whether the flight view has any third-person camera where a pilot would see their own drone; only the picker draws
  drone models (grep, `ui/drone.ts:173-176`); the cost of drawing up to 15 `drones3d` meshes per frame.
- Lines cited from `tracks-plan.md` and not re-read today: `admin.py:638-642`, `admin/main.ts:58`, `sessions.py:39`,
  `server.py:893`, `keymap.ts:139`, `primitives.ts:307-383`.
- That `shared-settings` covers everything that changes the flown world (e.g. a refined walls choice is not in the
  shared set; `server.py:1127-1157` lists size, floaters, wind, ceiling and drone).
- Python asyncio throughput at `cpus 0.25` (the 50 us per message figure is an assumption).
- Whether the `/fly/` language redirect keeps `?room=` on every path (`nginx.conf:100-104` uses `$is_args$args`; the
  `/<lang>/fly/` pages were not checked).
- Whether gate B18 accepts this file (it is ASCII English by intent).
