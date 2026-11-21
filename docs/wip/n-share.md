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
      (start-model, start-screen, start.ts) and on S1 (start-model, flight-link). Commit 11210118.
- [x] S3 the acceptance by mouse: tools/bench/scripts/n-share-accept.mjs. Local release (sha 8cfa3df7 + the probe fix, port 6921):
      all six steps PASS (evidence/2026-11-20/n-share/accept-local-run1.json: normal rows and the sound share and landing;
      accept-local-sound.json: the sound row again with its reference). The sound friend is compared with the same address opened
      in the sharer's own browser (24 gates both), not with the in-place flight (36 gates): see For the lead. Live site, read only
      (accept-live.json): sound.shareCarries FAIL (`sonic=scan-free`, no course), sound.landsOnScene FAIL (main button Quick start,
      the scan third), sound.fliesSame FAIL (the friend's one press opens the lesson ears-headphones): the lane's negative control.
      Pictures, each looked at once: n-share-local-sound.png: one green button "Fly this scan by sound / With the course of the
      link", under it the small link "New to flying by sound? Open the lessons"; n-share-local-normal.png: "Before you fly" with
      its first answer green, the site's cookie bar under it; n-share-live-sound.png: "Quick start" green, "Full course" beside it,
      "I already fly by sound: fly this scan" a grey third button. Gates: see Claims 3. dist deleted, the profiles deleted.

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

1. Opens a scene with gates (for example Tunis, `/en/fly/?scene=887f27aa&course=g1.1`), clicks into the scene, flies.
2. Key Escape, the pause menu, "Fly by Sound here": the flight goes on by sound. Key Escape again: the pause menu; "Share scene".
3. The Share panel shows and copies `.../fly/?sonic=fly&scene=887f27aa&sz=1&course=g1.1` (before: `sonic=scan-free`, no course).
4. The friend (a browser that never opened the site) opens it: "Fly by Sound" with ONE green button "Fly this scan by sound" (its
   line: "With the course of the link: you hear its gates") and under it a small link to the lessons. One click: the flight by
   sound starts in that scene with that course.
5. A normal flight's Share gives `/en/fly/?scene=...&course=...`: the friend answers "Before you fly" (one green first answer), clicks
   into the scene, flies the same course (36 gates in Tunis g1.1).
Known difference: a sound page lays a generated course as single upright gates (24 in Tunis g1.1), so the friend flies 24 gates by
sound where the owner, who turned sound on in place over a laid course, had 36 (see For the lead).

## Claims

1. Every place that offers a link gives an address that a fresh profile reads as the same scene, course and way of flying:
   `npx vitest run tools/bench/test/share-links-table.test.ts` (14 passed; NEG OK on the base).
2. A link with a scene lands on that scene for a browser that never opened the site: one main button flies it (with the link's
   course), the lessons are a small second link; a course never saved is not sent and the Share says so in one line:
   `npx vitest run tools/bench/test/share-links-landing.test.ts tools/bench/test/sonic-start-screen.test.ts` (6 + 40 passed; NEG OK).

3. By the mouse at 1536 x 730 @ 1.25, a new browser profile opening the address copied from the pause menu's Share flies the
   sharer's scene, course and way of flying after one press (sound and normal rows):
   `node tools/bench/scripts/n-share-accept.mjs http://localhost:6921 <out.json> local` on the release build: all six steps PASS
   (evidence/2026-11-20/n-share/accept-local-run1.json + accept-local-sound.json); the same probe on the live site, sound row:
   three FAIL (accept-live.json), the negative control. Gates once (typecheck, vitest, architecture, i18n, b18, leaks): five PASS,
   vitest FAILed on two of this lane's lines (share.ts/feature.ts read `location.search` where app/env.ts liveSearch() is the one
   reader; the probe's launch did not spread pick.launch in the call); both repaired, then
   `npx vitest run packages/prefs/test/main-audit.test.ts tools/bench/test/chrome.test.ts tools/bench/test/share-links-*.test.ts
   tools/bench/test/sonic-optin.test.ts` 67 passed and `pnpm --filter ./apps/fly typecheck` PASS (the full gates not run again).

## Not verified

- No person, phone or real controller took part; the pilot was a headless Chrome driven by the mouse at 1536 x 730 @ 1.25 with
  `render=off` (the picture of the flight was not judged, only the landing screens).
- The live run had only the sound row (the row the lane repairs; the plain flight's live Share gives the picture page /s/<id>,
  which uploads a picture: not run on the live site, it would create one; the probe aborts every non-GET /api request).
- "Save and share" for a hand-built course never saved: not built (see For the lead); the Share shares the scene and says so.
- The sound friend's gate count equals the in-place sharer's only when the sharer laid the course by sound (see For the lead).

## For the lead

- Files changed outside the owned list: apps/fly/src/share/panel.ts (ShareRequest gets `course`, passed to shareLink; S2: the
  one-line note `share-note` for a course never saved, ShareState.note); apps/fly/src/sonic/sonic.css (two lines: the small lessons
  link, 44 px high); tools/bench/test/sonic-start-screen.test.ts and sonic-scan-free.test.ts (their scan-link order tests held the
  old lessons-first order the owner rejected; rewritten to the new one).
- "Save and share" needs a hook from the course feature (lane n-save): e.g. `CourseHook.saveForShare?: () => Promise<boolean>`;
  with it the Share panel's note can carry the button. store.ts fliesBySound stays (in-place.ts still uses it).
- The sound friend flies fewer gates than the in-place sharer: course/finish.ts courseElements(ctx.sonic) (app/builtin/course.ts
  ~:762, lane course4 CU-1) lays a generated course without the competition elements on a sound page, but a course laid in a normal
  flight keeps them when the pilot turns sound on in place (pause.flyBySound). Tunis g1.1: 36 gates in place, 24 on any sound page.
  The link is the same course; the owner should decide which is right: either the in-place switch re-lays the course as the ear
  pilot's (course.ts, not this lane), or the link names the elements (course/link.ts + course.ts reading it). Not changed here.
- apps/fly/src/share/panel.ts still uploads a picture to /api/share before a course flight's link is chosen, and that link does
  not use it (a wasted upload; the panel could ask flightLink first).
- Deploy: page only (apps/fly). No API, rooms, nginx or sound package change. Live checks after deploy:
  `ROWS=sound node tools/bench/scripts/n-share-accept.mjs https://gsfpv.flyreelstudio.eu <out.json> live` must PASS its three
  steps (read only).
- Later, optional: the server's /s/<id> page could carry `course=` (apps/api/server.py fly_link), so a course flight keeps its picture
  card; until then a flight with a course shares its flight address.
- Review: the sound Share's spoken line for a course never saved is a new key sonic.link.unsaved (fly/sonic locale, four languages).

## Cost notes

- S1: most replies went to finding where each Share and the course live (course.ts, rooms.ts, the server's fly_link); a map of
  "who writes which link" in docs/agent-map.md would save that. neg_control.py needs the test command as ONE quoted string on Windows.
- S2: about 30 calls; the most went to a test template written through `node -e` (the shell ate its backticks) and to finding the
  served course id format; write test edits with the Write/Edit tools, never inside a shell string.
- S3 run 1: about 45 calls; the most went to finding how the owner turns sound on with gates (Escape is the lesson menu in a lesson; in place it is the pause menu) and why the same g1 link lays 24 or 36 gates (courseElements); a line in docs/agent-map.md on "Escape in the sound mode" and "what a course link does not carry" would save it.
- S3 run 2: about 30 calls; the most went to the gates' two failures (the one-query-reader audit and the headless-launch scan):
  running main-audit.test.ts and chrome.test.ts beside the lane's own tests before the gates would have caught both.

- Review: about 40 calls; the most went to a probe step of my own (the friend shares again) that the harness could not drive (the sound page has no pause menu on Escape, the consent bar lies over the pause menu); a probe helper "open Share in any mode" would make such steps cheap.

## What the owner should try

1. Fly a scene with gates, key Escape, "Fly by Sound here", key Escape, "Share scene": the address now ends in `sonic=fly&scene=...&course=...`.
2. Open it in a private window: one green button "Fly this scan by sound"; one click flies that scene by sound with its gates.
3. The lessons are the small link under that button, never the first screen.
4. A course laid in a normal flight shows fewer gates by sound (single upright gates); say which you want (For the lead).

## Review

Verdict: SHIP (independent check, 2026-11-21). One proven finding repaired: the Share in a flight by sound over a course never
saved dropped the course silently; it now says so in one line (sonic.link.unsaved; tools/bench/test/share-links-sound-note.test.ts,
NEG OK on the lane head). The acceptance probe on a release of the repair: six steps PASS. Doubts that do not hold the lane: the
table row NEG on the base fails by a missing export, not an assertion (the live run is the real control); 24 versus 36 gates by
sound (course4, For the lead); the consent bar lies over the pause menu on a fresh profile (site-wide). The probe gets an optional
step RESHARE=1 (the friend shares again), off by default.
