# Lane n-share (train 4): a shared link opens what the pilot was flying

Base: t7-base 03624451b8deb79d179cc9a5d07adf22f1383773. Plan: C:/dev/.gsfpv-lanes/designs/t7-plan.md (Part A wish 2, Part B item 4,
Part C 3, 5). The owner's wish 2 of 2026-11-20: a Share from the pause menu in a flight by sound in a scene with gates gave the friend
the sound lessons, not the scene.

## Status

- [x] S1 the table: tools/bench/test/share-links-table.test.ts (14 rows/checks); apps/fly/src/share/flight-link.ts (flightLink,
      readFlightLink, courseOfFlight); shareLink, ctx.sonicShare (through mode-keys.ts soundPlace) write through flightLink; the sound
      link carries `course=`; `sonic=fly` reads as the free flight in that scene. NEG OK twice on the base (all changed files; and only
      sonic-link.ts + start-model.ts, the row "flight by sound with gates"). Commit 26dc3f8e.
- [x] S2 the landing: a link with a scene and `sonic=` lands, for every pilot (a fresh profile included), on the start screen whose
      start section has ONE main button "Fly this scan by sound" (`sonic-start-scan`, its line names the link's course when there is
      one) and a small link "New to flying by sound? Open the lessons" (`sonic-start-lessons`, to the lessons section); Quick start,
      Continue and Full course are not in a scene link's start section any more. start-model scanStartOrder() is ['scan','lessons']
      for everyone (experiencedPilot and the "I already fly by sound" button are gone); parseSonicParam carries the link's `course`.
      An unsaved hand-built course: the Share panel shares the scene alone and says so in one line (`share-note`, share.unsaved, four
      languages). Tests: share-links-landing.test.ts (6), sonic-start-screen.test.ts "link with a scene" (2). NEG OK on the base
      (start-model, start-screen, start.ts) and on S1 (start-model, flight-link). Commit: see git log (n-share S2).
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
- S2: a normal flight's link (no `sonic=`) on a fresh profile goes through the first-visit question "Before you fly" (its first
  answer is the primary button) and then loads that scene and course: that question is the motion notice, kept; S3 measures it.
- S2: "Save and share" is not built: the editor's Save lives in app/builtin/course.ts (lane n-save) with no hook a Share can call;
  the Share takes the decision's other branch (the scene alone, said in one line). See For the lead.
- FlightPlace has optional fields beyond the contract (render, shared, sound): what a normal flight's and a sound flight's address
  already carried; the contract's fields are unchanged.

## What the owner does

(S3)

## Claims

1. Every place that offers a link gives an address that a fresh profile reads as the same scene, course and way of flying:
   `npx vitest run tools/bench/test/share-links-table.test.ts` (14 passed; NEG OK on the base).
2. A link with a scene lands on that scene for a browser that never opened the site: one main button flies it (with the link's
   course), the lessons are a small second link; a course never saved is not sent and the Share says so in one line:
   `npx vitest run tools/bench/test/share-links-landing.test.ts tools/bench/test/sonic-start-screen.test.ts` (6 + 40 passed; NEG OK).

## Not verified

(S3) No person, phone or real controller took part.

## For the lead

- Files changed outside the owned list: apps/fly/src/share/panel.ts (ShareRequest gets `course`, passed to shareLink; S2: the
  one-line note `share-note` for a course never saved, ShareState.note); apps/fly/src/sonic/sonic.css (two lines: the small lessons
  link, 44 px high); tools/bench/test/sonic-start-screen.test.ts and sonic-scan-free.test.ts (their scan-link order tests held the
  old lessons-first order the owner rejected; rewritten to the new one).
- "Save and share" needs a hook from the course feature (lane n-save): e.g. `CourseHook.saveForShare?: () => Promise<boolean>`;
  with it the Share panel's note can carry the button. store.ts fliesBySound stays (in-place.ts still uses it).
- Later, optional: the server's /s/<id> page could carry `course=` (apps/api/server.py fly_link), so a course flight keeps its picture
  card; until then a flight with a course shares its flight address.

## Cost notes

- S1: most replies went to finding where each Share and the course live (course.ts, rooms.ts, the server's fly_link); a map of
  "who writes which link" in docs/agent-map.md would save that. neg_control.py needs the test command as ONE quoted string on Windows.
- S2: about 30 calls; the most went to a test template written through `node -e` (the shell ate its backticks) and to finding the
  served course id format; write test edits with the Write/Edit tools, never inside a shell string.
