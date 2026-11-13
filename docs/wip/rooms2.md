# Lane rooms2, stage Q1-open-room (R27: a room that is always there, a vote for the next scan)

Branch `rooms2` from origin/main 2a5ac433, worktree C:/dev/gsfpv-center-throttle, ports 5820-5839.

## Status

- [x] 1. Server: open rooms (`POST /api/rooms/open`), votes (`apps/rooms/votes.py`), protocol doc, python tests
  `apps/rooms/tests/test_open_vote.py` (24 tests OK; all 77 rooms tests OK). Commit: see git log "rooms2: server".
- [ ] 2. Page: key 9 outside a room joins the open room (one press); in a room 9 agrees to an open vote, else opens the
  panel with "Propose the next scan" focused; `vote` and `scene` messages in rooms/socket.ts; the vote said and shown;
  the page loads the chosen scan; hook fields; locales en, es, pl, ru; unit tests with negative controls; typecheck.
- [ ] 3. Two-browser probe on the local rig (tools/bench/src/rooms-two-page.ts or a new rooms-open-vote.ts): both pilots
  press 9 once each, meet, A proposes, B agrees, both arrive in the next scan and see each other.

## Decisions

- Which room key 9 lands in (R27, "the scan he is in or the one with pilots"): the open room of the pilot's scan when
  pilots fly in it; else the open room with the most pilots anywhere (company first; his page loads that scan); else the
  open room of his scan, empty (the next pilot who presses 9 anywhere lands with him); else a new one. Full (16) rooms
  are skipped, so the 17th pilot gets a new room of his scan.
- One open room per scan, made on demand by the service, not by an admin: the plan's admin series and
  `rooms-admin.json` are in apps/api (not this lane). An empty open room closes after 600 s like a temporary room; the
  next press makes it again, so for a pilot it is always there and the memory stays bounded (50 open rooms, estimate).
- Open rooms carry no shared settings and no render: each pilot keeps his own drawing, walls and drone; joining an open
  room on the scan flown does not reload it.
- Votes: the plan's rules (30 s, yes > half of the present, proposer once, one vote at a time, 5 proposals per 10 min).
  Left out on purpose: the plan's "5 minutes on a scene before a proposal" and "3 minutes cooldown": a majority is
  needed anyway, and the owner's rule forbids "cannot, because" answers. A proposal of the scan of the open vote counts
  as yes; a proposal of a third scan answers the open vote's state ("press 9 to agree").
- Votes work in temporary rooms too (the same code; the room moves).

## For the lead

- New HTTP route `POST /api/rooms/open` on gsfpv-rooms. nginx's `location ^~ /api/rooms` already passes POST with a
  4k body; no deploy file changed. Release needs the rooms service restarted (apps/rooms changed).

## Not verified

- Old-code control of test_open_vote.py: on origin/main's rooms.py the test module fails at import (no votes module),
  an error, not an assertion. The assertion control is a mutant majority rule (yes >= half): 3 failures, 1 error.

## Cost notes
