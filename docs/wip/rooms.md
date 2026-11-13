# Lane rooms (train 1): flying together

Branch `rooms`, worktree `C:/dev/gsfpv-rooms`, from `train1-base` 5ceb8aaa. Plan: `docs/wip/train1-plan.md` section 4,
design `docs/wip/rooms-plan.md` (2.1-2.5, 2.9, 4A). Requirements R25, R26, R28 at their smallest.

## Status

### Stage R1: server (Python stdlib, no browser)
- [x] `apps/rooms/ws.py` (RFC 6455), `protocol.py` (pose 36 B, snapshot, validators), `rooms.py` (service), tests
      `test_ws`, `test_protocol`, `test_relay`, `test_rates`, `test_backpressure`, fixtures (commit: see git log, "rooms R1: service")
- [ ] `docs/rooms-protocol.md`
- [x] deploy files: `compose.yml`, `nginx.conf`, `release-rooms.sh`, `ship.sh`, `README.md`; `apps/api/tests/test_nginx_rooms.py`
      (commit "rooms R1: deploy files"; nginx tests 25 pass with test_nginx_routes; NEG OK against train1-base nginx.conf)
- [ ] load run, `evidence/<date>/rooms-load.json`
- [ ] negative controls recorded below

### Stage R2: client core (not started)
### Stage R3: screens, speech, probe (not started)

## Findings
- Backpressure on this machine (Windows, Python 3.11 Proactor loop, one reader with SO_RCVBUF 4096 that never reads,
  20000 snapshots of 80 B driven by `tick()`): cap on: peak unsent 16400 B, 18949 snapshots skipped; cap off: peak
  1570218 B (`test_backpressure.py`, printed by a one-off run).

## Decisions
- Byte order little-endian for the pose and the snapshot (DataView littleEndian=true in R2).
- Clock sync uses JSON `ping {t}` -> `pong {t, s}`: a browser cannot send WebSocket ping frames from script.
- No `./data/rooms` volume in compose for train 1: rooms live in RAM (train1-plan section 7 "nothing under DATA_DIR").
- A bad nickname is replaced by `Pilot-NNNN` (not refused); a nickname already in the room gets `-<slot+1>`.
- Host: the holder of the host key; while nobody holds it, the oldest member. A leaving host hands it to the oldest.
- Joins are counted at the upgrade (20/min/address), creates at POST (10/h/address, 200/day in all).
- The blocklist only stops names that pretend to speak for the site (admin, moderator, gsfpv, ...): there is no free text.

## For the lead before the merge
- (filled in by later steps)

## Not verified
- Python 3.12 (the container's) is not on this machine; tests ran on Python 3.11.9. The code uses nothing newer than 3.10.

## Cost notes
