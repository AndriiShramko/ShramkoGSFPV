# Lane rooms2, stage Q1-open-room (R27: a room that is always there, a vote for the next scan)

Branch `rooms2` from origin/main 2a5ac433, worktree C:/dev/gsfpv-center-throttle, ports 5820-5839.

## Status

- [x] 1. Server: open rooms (`POST /api/rooms/open`), votes (`apps/rooms/votes.py`), protocol doc, python tests
  `apps/rooms/tests/test_open_vote.py` (24 tests OK; all 77 rooms tests OK). Commit: see git log "rooms2: server".
- [x] 2. Page (commit "rooms2: page"): key 9 outside a room joins the open room (one press, `openRoom` in rooms/api.ts);
  in a room 9 agrees to an open vote this pilot has not agreed to, else opens the panel with "Propose <next scan>"
  focused (rooms/vote.ts `ninePress`, `nextScan` = the catalogue's order after the room's scan, wrapping); `vote` and
  `scene` messages and `propose()`/`agree()` in rooms/socket.ts; each vote line is said (Announcer) and shown
  (`ctx.hud.flash`, 6 s); on `scene` the page loads the room's new scan (SceneHost.load reason 'room'); an open room
  never reloads the scan flown and never touches the visit layer; hook fields `kind`, `vote`, `roomScene`; 13 new keys
  in rooms/{en,es,pl,ru}.json and `keys.rooms.panel` reworded. Test tools/bench/test/rooms-open-vote.test.ts: 6 tests
  pass; with the related rooms tests 38 of 38 (rooms-public-review, rooms-socket, rooms-public, rooms-review).
  Negative control (neg_control.py, origin/main keys.ts and socket.ts): NEG OK, the key test fails by assertion at
  `press('join')`, the two-socket test by `sa.propose is not a function`.
  Typecheck apps/fly: no error in a rooms file; 17 errors elsewhere, all from this worktree's state (packages/sonic-fpv
  checked out at b102ce6 while origin/main pins 378cc50; `@gsfpv/tracks` not linked in node_modules).
- [x] 3a. Probes written (commit 8160ad2d and the commit "rooms2: train1-live"): new tools/bench/src/rooms-open-vote.ts
  (A on 39e63ce9, B on 7a475d38, one 9 each, A proposes with 9 + Enter, one yes of two holds 3 s, B agrees with 9,
  both in the proposed scan and see each other; control: rig with --no-relay); rooms-two-page.ts opens the panel from
  the pause menu (`panelByMenu`, Esc then `pause.rooms`), check `nineNotTypedInName` replaced by
  `panelShowsStoredName`; train1-live.ts: when 9 gave `kind=persistent`, leave the open room and create from the menu.
  Typecheck tools/bench: 0 errors. Run with SONIC_PORTS=5820-5839 (the rig's ports come from that variable).
  dist/ rebuilt at 5595851f; the worktree's packages/sonic-fpv was moved to the pinned 378cc50 (the build failed at
  b102ce6: `lessonSegments` missing).
- [~] 3b. Run rooms-open-vote.ts and rooms-two-page.ts on the local rig; results here.

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

- The panel's vote block, the hud flash and the in-page scan change after a passed vote were not seen in a browser
  (step 3 is the probe that does it).
- The pause menu still opens the panel with create, link and list; only key 9's first press changed.

## Cost notes

- Q1 worker 1: reading the existing rooms code (server 470 lines, page glue 350 lines) and the plan took 10 replies;
  edits as one python patch script per side (server, page) kept it to 2 replies each. Four Edit calls failed because the
  files had been read with cat, not Read: read files you will edit with Read. The probe did not fit in 30 replies:
  plan the probe as its own stage.
