# Rooms protocol `rooms/1`

Pilots who fly one scan together (train 1, lane rooms; design `docs/wip/rooms-plan.md` 2.1-2.5, 2.9). The service is
`apps/rooms/rooms.py` (Python 3.12 stdlib, asyncio, one process) in the container `gsfpv-rooms` on port 8091, reached only
through our nginx (`deploy/nginx.conf`, `deploy/README.md` "Rooms"). Code of the layouts: `apps/rooms/protocol.py`.
Shared fixtures (bytes as hex with the decoded value): `apps/rooms/tests/fixtures/pose.json`, `snapshot.json`.

Every client simulates only its own drone. The server never simulates: it keeps the last pose of each member in RAM and
sends one snapshot per room tick. Nothing is written to disk.

## HTTP

All answers are JSON with `Cache-Control: no-store`. Errors are `{error: <code>}`.

| Route | Answer |
|---|---|
| `GET /api/rooms/health` | `{ok: true, v: "rooms/1", rooms, pilots}` |
| `GET /api/rooms` | `{v: 1, rooms: [Room]}`: listed rooms only, newest first |
| `POST /api/rooms` | body at most 4096 bytes, see below -> 201 `{id, hostKey}`; 400 `scene` or `body`, 413 `size`, 429 `rate`, 503 `busy` |
| `GET /api/rooms/<id>` | `Room`, or 404 `no-room` |
| `GET /api/rooms/ws` | the WebSocket (below); a plain GET gets 400 `upgrade`, a client over the join rate 429 `rate` |

Create body: `{scene: {id, render?}, shared?, name?, listed?, course?}`.
- `scene.id`: 6-32 lower-case hex (the API's scene id); `scene.render`: `{budgetM?: 0.25..32, stochastic?: bool}`.
- `shared`: the share link's scene settings (size 0.25-100, walls `on|off`, floaters 0-64, wind `off|{fromDeg, speed, gust}`,
  ceiling `off|-10000..10000`, drone id), read exactly as `apps/api/server.py shared_settings` reads them (a port; a test
  compares both on the same rows). A wrong field is dropped, not refused.
- `name`: 2-40 characters by the nickname rule below, else `""`. `listed`: only `true` lists the room.
- `course`: an opaque string `[0-9A-Za-z._-]{1,64}`, kept and returned, unused in train 1.

`Room` = `{id, name, scene, shared?, course?, cap: 8, members, listed, kind: "temp", state: "open", createdAt (unix s)}`.
`id` is `secrets.token_urlsafe(8)` (11 characters `[A-Za-z0-9_-]`). `hostKey` is 32 hex characters (128 bits); the server
keeps only its sha256. The host key goes in the first WebSocket message, never in a URL. The share link is
`/fly/?room=<id>`.

## WebSocket

RFC 6455, no extensions, no subprotocol. Client frames are masked, server frames are not. A message (one frame or the
sum of its fragments) is at most 65536 bytes, else close 1009. Text messages are JSON objects of at most 2048 bytes.

1. The client sends `hello` within 10 s: `{type: "hello", v: "rooms/1", room: <id>, nick, hostKey?}`.
2. The server answers `welcome` or `error` and then closes with 1008:
   `{type: "error", code}` with code `hello` (not a hello), `version`, `no-room`, `full` (8 members).
3. `welcome`: `{type, v, slot (0-7), nick (as kept), hostSlot, room: Room, members: [{slot, nick}], serverMs}`.
4. The others get `joined {type, slot, nick, hostSlot}`; on a leave or a lost socket `left {type, slot, hostSlot}`.
5. Clock: the client sends `{type: "ping", t: <its ms>}`, the server answers `{type: "pong", t, s: <serverMs>}`.
   Use it every 20 s at least (the server closes a socket silent for 70 s; nginx's read timeout is 75 s) and, for the
   clock offset, a few times at the start (median of 8, rooms-plan.md 2.2). WebSocket ping frames are also answered.
6. `{type: "leave"}` closes with 1000. Any other type, and a binary message that is not a pose, gets no answer; it
   counts toward the close limit like every message (review RV-2).

Nickname rule (`protocol.clean_nick`, rooms-plan.md 2.5): NFC, trimmed, runs of spaces made one, 2-20 characters, only
Unicode letters and digits and ` -_.'`, at least one letter or digit, no `://` or `www.`, not a name that pretends to
speak for the site (admin, administrator, moderator, gsfpv, shramko, system, official; without case, spaces and
punctuation). A nickname that fails becomes `Pilot-NNNN`; one already in the room gets `-<n>` from `slot+1` upward
until it is unique. A room name (`protocol.clean_name`) takes the same rule at 2-40 characters with the same blocklist;
a missing or refused name becomes `Room-NNNN`, so no room is listed without a name (review RV-4, RV-8).
The service answers 404 `route` to a request target other than `/api/rooms` or `/api/rooms/<1-16 of A-Za-z0-9_->`;
nginx passes the raw `$request_uri`, never the decoded `$uri` (review RV-3).

Host: the member who sent the right `hostKey`; while nobody did, the oldest member. When the host leaves, the oldest
member takes the role (`hostSlot` in `left`). Train 1 gives the host no powers yet.

### Pose (client -> server, binary, 36 bytes, little-endian)

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | kind = 1 |
| 1 | u8 | flags: 1 armed, 2 crashed, 4 paused, 8 in race |
| 2 | u16 | seq (wraps) |
| 4 | u32 | tick of the pilot's sim |
| 8 | f32 x 3 | position x, y, z (metres, the room's flown frame) |
| 20 | i16 x 4 | quaternion x, y, z, w, times 32767 |
| 28 | i16 x 3 | velocity x, y, z in cm/s (clamped to the i16 range) |
| 34 | u16 | throttle, 0..65535 = 0..1 |

The server keeps a pose only by its size and kind byte and relays the bytes as sent: a receiver drops a pose whose
position is not finite. Send 15 a second (every frame whose time crossed the next 66.7 ms boundary).

### Snapshot (server -> client, binary, little-endian)

`u8 kind = 2, u32 serverMs (ms since the service started, wraps), u8 count`, then `count` entries of
`u8 slot + 36-byte pose`. One per room tick (15 Hz) to every member, built once; only members that sent a pose are in
it; the receiver skips its own slot.

## Limits

Each number is in `apps/rooms/rooms.py` with its source; "measured" names the test.

| What | Value | Source |
|---|---|---|
| Members per temporary room | 8 | plan 2.3; `test_relay.py` fills it and refuses the 9th |
| Room tick | 15 Hz | plan 2.2; `test_relay.py` measures 13.5-16.5 |
| Poses kept per socket | 20/s, the rest dropped | plan 2.5; `test_rates.py` (30/s -> 20/s; control without the limit keeps all) |
| Messages that close a socket | above 60/s of any kind (poses, text, junk), close 1008 | plan 2.5; `test_rates.py` (70/s closes, 59/s does not), `test_review.py` (a ping or junk flood closes) |
| Unsent bytes before snapshots are skipped | 16 KB | plan 2.2; `test_backpressure.py` (peak 16400 B; control without the cap 1.57 MB) |
| Unsent bytes before a socket is closed | 256 KB, checked at every snapshot and every control message | estimate; `test_review.py` (a member that never reads in a room without poses is closed) |
| Empty room closes after | 600 s (checked every 30 s, estimate) | plan 2.3; `test_relay.py` with a fake clock |
| Creates | 10 an hour and 20 a day per address; no shared daily count (open rooms bound it) | plan 2.5, the day's share an estimate (review RV-5); `test_relay.py` (the 11th gets 429), `test_review.py` (a day at the full rate leaves creates for another address) |
| Addresses kept for the limits | only while one of their events is inside the window (pruned every 30 s) | review RV-7; `test_review.py` |
| Joins | 20 a minute per address (counted at the upgrade) | plan 2.5 |
| Open rooms | 200 | estimate |
| Hello within / silent socket closed after | 10 s / 70 s | estimates |
| Message / text message / POST body | 64 KB / 2 KB / 4 KB | plan 2.1 / estimate / nginx `client_max_body_size 4k` |

## Privacy

Others see only the nickname and the live pose while both are in the room. Poses are never written to disk. Client
addresses stay in RAM for the rate limits. The service logs the method and the route shape only: no address, no query
string, no room id, no nickname.
