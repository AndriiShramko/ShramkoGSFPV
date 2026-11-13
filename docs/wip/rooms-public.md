# Lane rooms-public (train 1B): 'Fly with others' for every pilot

Worktree: C:/dev/gsfpv-rooms (reused from lane rooms, clean), branch rooms-public from origin/main 41372830.

## Status

### Stage P1-public-menu-keys-link
- [x] 1. ROOMS_MENU_PUBLIC = true (apps/fly/src/app/builtin/rooms.ts); keymap lines rooms.* shipped; SHIPPED_BY_ROOMS in
      packages/prefs/test/keymap.test.ts = both; keys through `ctx.keys.on` (rooms/keys.ts, the capture-phase listener,
      deleted); catalogue regenerated (`gen-catalog.ts`: 29 shortcut keys, docs/settings.md "39 keyboard keys").
- [x] 2. Rooms keys 9 (panel) and 0 (who is around); Shift+O stays settings and Shift+L share (for a pilot descending with
      Shift). Spoken lines name the keys: rooms.say.welcome `{who}`, rooms.say.noRoom `{panel}`, en es pl ru.
- [x] 3. /fly/?room=<id> without ?scene= asks GET /api/rooms/<id> for the scan (apps/fly/src/rooms/link.ts
      `roomSceneLink`, called from boot.ts before the picker); ?scene= links unchanged; no room / gone / offline: the picker.
- [x] 4a. Tests (commit 6ee9c9bf, points 1 to 3 and these tests; status and evidence 2a0d7b33):
      tools/bench rooms-public (10), rooms-review (5) = 15 passed; prefs keymap, catalogue-site, catalogue-site-drift 38
      passed; bench app-play, public-ranges, app-keys, train1-contract, sonic-start-screen, rooms-a6, rooms-around 84
      passed; i18n 22 passed; `tsc --noEmit` apps/fly, tools/bench, packages/prefs: 0 errors.
      Negative controls (neg_control.py --ref origin/main): rooms-public whole file NEG OK (keymap.ts, rooms.ts, boot.ts,
      link.ts); "no key is taken" NEG OK (keymap.ts); "boot.ts opens" NEG OK (boot.ts); "spoken lines" NEG OK (rooms.ts +
      4 locales); rooms-review RV-1 NEG OK (keymap.ts); prefs keymap.test NEG OK (keymap.ts).
- [x] 4b. Probe rooms-two-page (commit d3228c8d: no ?rooms=1, keys 9 and 0, new check roomOnlyLinkFliesTheRoomScan:
      page D opens /en/fly/?room=<id> with no ?scene=, joins, its address becomes scene=39e63ce9&room=<id>) on a local
      release build of d3228c8d (`build-release.mjs` exit 0, 1903 files), GPU lock taken by the probe itself: pass, 14 of
      14 checks, rms 0.0456 m (bound 0.15), controls 1-3 fired. Evidence evidence/2026-11-13/rooms-public-two-page.json
      (train 1's rooms-two-page.json left as it was). Console: 8 + 8 resource 404/403 lines, the same count as train 1's run.

### R review fixes (level 2 review of this lane; RP-1 to RP-5 all in commit 21e80a93)
Tests: tools/bench/test/rooms-public-review.test.ts (15). Set run: rooms-public-review, rooms-public, rooms-review, app-keys,
train1-contract, rooms-a6, sonic-start-screen = 79 passed; i18n 22 passed; prefs keymap 30 passed; tsc --noEmit apps/fly,
tools/bench, packages/prefs exit 0; gen-catalog rerun (key labels changed), `--check` up to date.
Negative controls with --ref HEAD 71acff7a (the lane before the fixes), neg_control.py: RP-4 (link.ts) NEG OK by a 2 s
timeout; "lesson line" (4 locales) NEG OK by an assertion; RP-5 (link.ts, boot.ts) NEG OK (openFirst missing); RP-1..3
(rooms/keys.ts, builtin/rooms.ts) NEG OK only by the import of the new rooms/keys.ts (the old handlers were inline).
- [x] RP-1 major, confirmed (a running lesson takes 9 and 0, sonic/digit-key.ts; its menu takes every key, lesson-menu.ts).
      Fix (b): keys stay 9 / 0; during a lesson the welcome is rooms.say.welcomeLesson ("the digits are your answers; after
      it, press 0"), key list labels say "not during a sound lesson" (en es pl ru); keymap.ts comment and the Decision
      corrected. Test: real digitAnswerHandler + real KeyRouter on one fake window. Commit 21e80a93.
- [x] RP-2 minor, fixed: both handlers call e.preventDefault() (rooms/keys.ts roomKeys). Test: the fake window sees both
      presses prevented. The probe's read of #rooms-nick after 9 goes to the lead (below).
- [x] RP-3 minor, fixed: 9 waits while dialogOpen() or a #ui screen / panel is up; 0 without a room is silent (and not
      prevented) under a dialog, 0 inside a room answers. Tests: fake window with a dialog up, with and without a room.
- [x] RP-4 minor, fixed: roomSceneLink passes AbortSignal.timeout and races a timer, ROOM_LINK_WAIT_MS = 8000 (estimate,
      marked); boot.ts shows a role=status line rooms.link.wait (4 languages) while the room is asked.
- [x] RP-5 minor, fixed: boot's choice is rooms/link.ts openFirst() (scene link in the same task / room link / picker,
      rejected ask -> picker), tested with fake answers; the boot.ts index-order text check became a one-line guard.

## Decisions
- Keys 9 and 0, not Shift+L / Shift+O: the router reads a Shift chord no binding has as the key alone while Shift flies
  (app/keys.ts route()), so a shipped Shift+O / Shift+L would take settings / share from every keyboard pilot who holds
  Shift to descend. All 26 letters are taken (W A S D Q E flying; P R Y N M V C H O B L K F J the table; T U I Z G X the
  sound mode). Digit9 / Digit0: no binding, no flying key, far from W A S D and the arrows (no press by accident in
  flight), same place on every layout, and sonic/key-names.ts says a digit by name (a comma or full stop would be said as
  nothing by many voices). Shift+9 / Shift+0 while Shift flies fall back to 9 / 0 (rooms), which nobody had.
  Corrected after review RP-1: two raw listeners DO read digits before the router: a running sound lesson
  (sonic/digit-key.ts, every digit is an answer, 0 skips) and the recorder's survey (sonic-session/survey-keys.ts, every
  key). The keys stay 9 / 0 (fix (b) of the review): Minus, Equal and the other free punctuation codes print a different
  character on es, de and fr layouts, so the key list would show the wrong cap, and the owner's rule of 2026-11-10 keeps
  every digit in a lesson the lesson's. During a lesson the rooms keys do not work; the welcome then says so.
- Key 0 with no room says "You are not in a room. Press 9 to fly with others." (interrupting, as before); 9 is refused
  while a screen or panel is up (router `when`), as the capture listener did.
- The room link: a bare scene id plus its drawing parameters goes into boot.ts's go() as the page's own link, so the
  address becomes /fly/?scene=<id>&...&room=<id> (writeSceneQuery keeps ?room=); the room's shared settings are applied
  by the feature at the welcome, as for a Join from the list. A room the server does not have opens the picker without
  an error line (the picker's error codes are not this lane's).
- With a room link without ?scene= the scene opens after one fetch, so gtag may read the address before the rewrite (the
  comment in boot.ts about one task holds for ?scene= links only).

## For the lead before the merge
- tools/bench/test/train1-contract.test.ts (not a lane path): its two rooms lines now pin '9' and '0', and the Shift
  check is `!!shift === cap.startsWith('Shift+')` (course keys still Shift+T / Shift+G). Without it the contract test
  fails on the merged tree.
- docs/wip/train1-lead.md deploy steps 4 and 5 and the live check line name `?rooms=1` and Shift+L / Shift+O: after this
  lane the menu is public, the keys are 9 and 0, ?rooms=1 is harmless (still read by roomsShown).
- Review RV-1's router fallback proposal for keys.ts is no longer needed (no rooms chord on a Shift letter).
- RP-2 (level 3 probe, tools/bench/src/rooms-two-page.ts, not rerun by this fix): after the probe presses Digit9, read
  the value of #rooms-nick and require it to equal the stored name (proves no 9 is typed into the field in a browser).
- RP-3 in a browser: one look at 9 over Fly by Sound's start screen and lesson menu (expect nothing) and 0 over the pause
  menu without a room (expect silence).
- RP-1, the lead's call: if the owner wants "who is around" inside a sound lesson, it needs a lesson menu item
  (sonic/lesson-menu.ts) or digit-key.ts letting 0 / 9 through, which goes against the 2026-11-10 rule; not done here.
- The welcome picks the lesson line by `ctx.sonic.runner !== null` (sonic/runtime.ts), not the lesson host's `active`
  (not exposed): both are set and cleared by the same open / close, read, not run.

## Not verified
- Level 2 review of this lane: done by another agent (RP-1..RP-5), fixes above.
- Review fixes in a browser: the probe and the release build were not rerun (level 3 belongs to the lead); RP-2 and RP-3
  are proven on a fake window with the real router and digit handler, not in a page. The wait line's look (class
  'rooms-wait muted' appended to #ui) and whether a screen reader says it: not seen. ROOM_LINK_WAIT_MS 8000 is an
  estimate; the live proxy's hold time was not measured.
- The new locale lines (welcomeLesson, link.wait, key labels) in es, pl, ru: written by the agent, not read by a native.
- Live site: nothing deployed; the room-only link and keys 9 / 0 run only on the local rig (rooms-serve.ts).
- A room link to a room the server does not have, in a browser: unit test only (fake fetch: 404, offline, bad id).
- Shift held to descend plus O / L in a real browser: KeyRouter unit tests only (rooms-review RV-1, rooms-public 2).
- Fly by Sound (?sonic=) page with keys 9 and 0 and a screen reader: not run. The two lines name the key by its cap
  ('9', '0'), not by sonic/key-names.ts spokenKey (layout map): on AZERTY the key at Digit9 is printed 9 and types a
  cedilla, the line says 9.
- Whether up to 12 room lines a minute disturb a running sound lesson (rooms review RV-6): still not run.

## Cost notes
- Most turns: finding why the first negative controls printed NEG OK while `bash -c` resolved to WSL bash (every run
  failed for that reason); pass Git Bash by its full path (C:/Program Files/Git/usr/bin/bash.exe) to neg_control.py from
  the start. The probe edits were cheap because rooms.md and the agent map named every file.
- Review fixes: most turns went to finding which raw keydown listeners take digits (digit-key.ts, survey-keys.ts, and the
  lesson menu that takes every key, found only after a first "press Escape, then 0" fix was written and had to be redone);
  a list of every capture-phase keydown listener in docs/agent-map.md would have saved that. Also: the neg control for a
  fix of the lane's own code must use --ref HEAD, not origin/main (where the lane's files are absent).
