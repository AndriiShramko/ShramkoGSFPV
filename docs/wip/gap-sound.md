# Lane gap-sound (train 4, gap lane 3)

The owner's line 531 of the brief: no 'behind' on the way in, the quick lesson by default, headphones left and right, then at once in a
room the wall, the right wall, the ceiling, the floor, then 'try to move'; no chatter. Audit entries sound-site-2, -3, -4, -5, -6, -13.
Base: branch train4 at 2d752fcc (negative-control ref). Package branch: packages/sonic-fpv branch gap-sound from pin 53a5675.

## Status

- [x] S1 the start screen (host): no 'behind' button; Quick start first and focused for every pilot, Continue second; the settings
      list at level first with 'Show all settings (n more)'. Tests NEG OK against 2d752fcc. (commit: see git log, 'gap-sound S1')
- [ ] S2 the quick path (package data): ears-headphones 2 trials; the wall sounds inside walls-hall's room; one short intro a later
      quick lesson; quick-path.test.ts ROOM_FLIGHT_MAX_S 120 and a talk-seconds cap of the whole quick path (NEG on 53a5675).
- [ ] S3 the acceptance: tools/bench/scripts/gap-sound-accept.mjs by mouse at 1536x730, scale 1.25, first visit and returning pilot;
      the live site must fail the Quick-start-first and no-behind steps.

Design differences (the code wins):
- The sound start screen has no access to the pilot's ui.menuLevel (SonicHost is only the prefs collections), and that setting
  defaults to expert for anyone who never answered 'Before you fly' (a blind pilot on ?sonic=start never sees it). So the screen uses
  menu4's MenuLevel type and levelShows() with its own table SONIC_SETTING_LEVELS, viewed at level first; 'Show all settings' opens the
  rest for the page (an instance flag, like ui/settings/screen.ts's showAllRows). A shared link that sets a sound setting shows all.
- show() now focuses the first Start button (Quick start) instead of the h1, so one Enter starts; a screen reader reads the button
  and its description first.

## What the owner does

(filled in at S3)

## Claims

1. The Start section's buttons are Quick start (primary, focused when the screen opens), then Continue: <lesson> (with its place and
   state), then Full course, for a first visit and a returning pilot. Proof: `node node_modules/vitest/vitest.mjs run
   tools/bench/test/sonic-start-screen.test.ts` -> 33 passed; NEG OK on 2d752fcc (`-t "lane gap-sound"`).
2. The headphone check has two buttons, left and right; no sonic locale has a 'behind' key. Same proof.
3. The settings show 6 rows at level first (speaking speed, captions, my screen reader speaks, narrator, key hints, turn my head) and
   'Show all settings (12 more)'; its press draws all 18 and focuses Sound theme. Same proof.

## Not verified

- No person, no screen reader user, no phone and no real controller took part. No audio was judged.
- tools/bench/src/sonic-start-keyboard.ts (a drawn lab harness) was edited to the new screen but not run (it draws; GPU lock).

## For the lead

- Files changed outside the owned list: tools/bench/src/sonic-start-keyboard.ts (the lab harness of the start screen: two headphone
  buttons, Quick start focused, presses 'Show all settings' before the settings checks).
- Pre-existing on 2d752fcc, not this lane: 3 tests fail on a key clash 'Shift+KeyH is bound to messages.open and sonic.headCentre'
  (rooms-public.test.ts, sonic-in-place.test.ts, train1-contract.test.ts).

## Cost notes

- S1: the most replies went to reading the 880-line test file in slices; a list of test names with the ids they touch would be cheaper.
