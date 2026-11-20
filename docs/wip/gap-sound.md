# Lane gap-sound (train 4, gap lane 3)

The owner's line 531 of the brief: no 'behind' on the way in, the quick lesson by default, headphones left and right, then at once in a
room the wall, the right wall, the ceiling, the floor, then 'try to move'; no chatter. Audit entries sound-site-2, -3, -4, -5, -6, -13.
Base: branch train4 at 2d752fcc (negative-control ref). Package branch: packages/sonic-fpv branch gap-sound from pin 53a5675.

## Status

- [x] S1 the start screen (host): no 'behind' button; Quick start first and focused for every pilot, Continue second; the settings
      list at level first with 'Show all settings (n more)'. Tests NEG OK against 2d752fcc. (commit 436cc3c8)
- [ ] S2 the quick path (package data): ears-headphones 2 trials; the wall sounds inside walls-hall's room; one short intro a later
      quick lesson; quick-path.test.ts ROOM_FLIGHT_MAX_S 120 and a talk-seconds cap of the whole quick path (NEG on 53a5675).
      IN PROGRESS: package branch gap-sound, WIP commit ddb996c (data done: fast path without ears-walls; walls-hall intro =
      cue.safety.wall.name(left), dir.right(right), ceiling(up), floor(down), goal.1; corridor = height tone name, intro.3/.4/.5,
      goal.1; tunnel-gaps = intro.3, goal.1; rings-first = intro.1, cue.height.target.name, goal.1; rings-course, free-garden =
      goal.1; versions bumped; docs counts 8 -> 7). David: the room flies at 114.1 s (was 205.0), the path's flights all begin by
      271.5 s (was 471.2). Schedule printer: U:/Temp/gsfpv-train4/gap-sound/zz-scratch.test.ts (copy into the package's test/ to run).
      LEFT (package `npx vitest run`, 8 failing):
      a. test/sonic-keys.test.ts startup error: node:util styleText (Node too old for this file? check on 53a5675 first).
      b. lessons.test.ts:60 my new rule: a module-0 lesson has no goal line (only require goal.1 when the catalogue has one).
      c. lessons.test.ts:82 'fill every parameter': a text of 3 chars or less ('Wall'? 'Pared'?): allow cue names or lengthen check.
      d. quick-path talk cap: ru 163.2 s > 150: measure all four, set the cap above the largest (old value on 53a5675 for the note).
      e. replay.test.ts:276 (regex of the older-build line), :333 (an expected 3 for the headphone check: now 2).
      f. report.test.ts:146 rings-course deviation control (7.565 vs 7.924): the intro got shorter, the scripted path changed.
      g. runner.test.ts 'progress carries on' (rings-first view: lessonIndex on the fast path, now one less).
      h. world-scale.test.ts walls-hall 'calls its room small' (it read intro.1, now not said: the title says 'A small room').
      Then: NEG of quick-path (ROOM_FLIGHT and talk cap) on 53a5675, `pnpm typecheck` in the package, the final package commit
      (amend the WIP into a proper message), move the pin in the main repo, and the host keys line 'said once'
      (apps/fly/src/sonic/lessons.ts keysDue: a flying lesson says it every step; not an owned file, decide or hand to the lead).
- [ ] S3 the acceptance: tools/bench/scripts/gap-sound-accept.mjs by mouse at 1536x730, scale 1.25, first visit and returning pilot;
      the live site must fail the Quick-start-first and no-behind steps.

Design differences (the code wins):
- The package's lines are text for the voice (locales), not recordings, but locales are outside this lane's package exception:
  no line was written or reworded; lines were only removed or reused (cue names, dir.right). The removed lines' keys stay in the
  package's locales and catalogue unused (For the lead). lessons.test.ts's rule 'an intro says all its catalogue lines' became
  'its own lines in order, at least goal.1, plus lines that name the sound they play'.
- The room no longer names the height tone and the target note (owner's list: wall, right wall, ceiling, floor, then move); the
  corridor names the height tone, rings-first the target note, where it first sounds (test/named-sounds.test.ts).
- tunnel-gaps keeps its intro.3 (the chime above and below, with the setting's caveat of review E2), not one line.
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
- S2 (run 1): the package's guard tests (own catalogue lines, versions, named sounds, trials) each needed a read and an edit; a run of
  the package suite on a throwaway data change first, to list every test that pins lesson data, would have saved about 10 replies.
