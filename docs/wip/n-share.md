# Lane n-share (train 4): a shared link opens what the pilot was flying

Base: t7-base 03624451b8deb79d179cc9a5d07adf22f1383773. Plan: C:/dev/.gsfpv-lanes/designs/t7-plan.md (Part A wish 2, Part B item 4,
Part C 3, 5). The owner's wish 2 of 2026-11-20: a Share from the pause menu in a flight by sound in a scene with gates gave the friend
the sound lessons, not the scene.

## Status

- [x] S1 the table: tools/bench/test/share-links-table.test.ts (14 rows/checks); apps/fly/src/share/flight-link.ts (flightLink,
      readFlightLink, courseOfFlight); shareLink, ctx.sonicShare (through mode-keys.ts soundPlace) write through flightLink; the sound
      link carries `course=`; `sonic=fly` reads as the free flight in that scene. NEG OK twice on the base (all changed files; and only
      sonic-link.ts + start-model.ts, the row "flight by sound with gates"). Commit: see git log "n-share S1".
- [ ] S2 the landing: a fresh profile on a link with a scene (with or without sonic) gets one screen with one main button that starts
      that flight (one click for sound and pointer lock); lessons a small second link. An unsaved hand-built course: Share offers
      "Save and share" (the editor's Save) or the scene alone with one line. Unit tests (start-model order for a scene link with
      experienced=false) + NEG.
- [ ] S3 the acceptance by mouse: tools/bench/scripts/n-share-accept.mjs (local build and live site, read only), at most three
      pictures, gates once (typecheck,vitest,architecture,i18n,b18,leaks), "What the owner should try", delete dist.

Findings of S1 (the code wins over the plan where they differ):
- The plain flight's Share (share/links.ts shareLink) dropped the course too: in a flight it gives the picture page /s/<id>, whose
  server page (apps/api/server.py fly_link) writes scene, drawing and shared settings, no course; without a picture the scene page
  /{lang}/scenes/<id>/, no course either. Now a flight with a course that travels is shared as its flight address (flightLink); a
  flight without a course keeps the picture page.
- There is no course chip that offers a link in the code at the base; the table's chip row calls flightLink as lane n-level's chip
  must (the contract).
- The race room invite (rooms.ts roomLink) names scene and room; the room carries its course on the server (RoomInfo.course, adopted
  on join), so the invite does not drop it: rooms.ts is not changed.
- A served course read from an address without `.v<n>` reads as version 0 (the newest is flown, as servedOfLink's null version).
- FlightPlace has optional fields beyond the contract (render, shared, sound): what a normal flight's and a sound flight's address
  already carried; the contract's fields are unchanged.

## What the owner does

(S3)

## Claims

1. Every place that offers a link gives an address that a fresh profile reads as the same scene, course and way of flying:
   `npx vitest run tools/bench/test/share-links-table.test.ts` (14 passed; NEG OK on the base).

## Not verified

(S3) No person, phone or real controller took part.

## For the lead

- Files changed outside the owned list: apps/fly/src/share/panel.ts (ShareRequest gets `course`, passed to shareLink: two lines).
- Later, optional: the server's /s/<id> page could carry `course=` (apps/api/server.py fly_link), so a course flight keeps its picture
  card; until then a flight with a course shares its flight address.

## Cost notes

- S1: most replies went to finding where each Share and the course live (course.ts, rooms.ts, the server's fly_link); a map of
  "who writes which link" in docs/agent-map.md would save that. neg_control.py needs the test command as ONE quoted string on Windows.
