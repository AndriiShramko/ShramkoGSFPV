# Lane gap-sound (train 4, gap lane 3)

The owner's line 531 of the brief: no 'behind' on the way in, the quick lesson by default, headphones left and right, then at once in a
room the wall, the right wall, the ceiling, the floor, then 'try to move'; no chatter. Audit entries sound-site-2, -3, -4, -5, -6, -13.
Base: branch train4 at 2d752fcc (negative-control ref). Package branch: packages/sonic-fpv branch gap-sound from pin 53a5675.

## Status

- [x] S1 the start screen (host): no 'behind' button; Quick start first and focused for every pilot, Continue second; the settings
      list at level first with 'Show all settings (n more)'. Tests NEG OK against 2d752fcc. (commit 436cc3c8)
- [x] S2 the quick path (package data): ears-headphones 2 trials; the wall sounds inside walls-hall's room; one short intro a later
      quick lesson; quick-path.test.ts ROOM_FLIGHT_MAX_S 120 and a talk-seconds cap of the whole quick path (NEG on 53a5675).
      Package: branch gap-sound head 150ebac296d5e618b6fd952ea342d03db43c1338 (one commit on 53a5675). Package suite (node 22,
      `node node_modules/vitest/vitest.mjs run`): 1428 passed, 4 skipped; `pnpm typecheck` OK. NEG OK on 53a5675 for both new
      guards: the room flies at 205.0 s > 120; ru talks 299.7 s > 165. Talk now en 131.0, es 136.0, pl 139.7, ru 163.2 s.
      Pin moved in the main repo: commit 4199b98c. Host tests that follow the data (run 3): sonic-start (7 fast lessons, Continue
      after walls-hall is corridor), sonic-lesson-keys (rings-first 5 of 7), sonic-lessons (2 headphone answers), sonic-int-replay
      (see Design differences). Host set `vitest run tools/bench/test/sonic tools/bench/test/admin-sessions tools/bench/test/app-game`:
      944 passed, 2 failed (pre-existing Shift+KeyH clash on 2d752fcc: sonic-hints.test.ts, sonic-in-place.test.ts).
      Keys line 'said once': apps/fly/src/sonic/lessons.ts keysDue() (line 762) says it on every step of a flying lesson; not an
      owned file, handed to the lead (see For the lead).
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
- The corridor keeps its three explaining lines (the way-through chime 15.4 s, the stages and reset 9.6 s, the target hum 10.2 s,
  en): reviews R3 and E2 pin them (test/named-sounds.test.ts) and they are the pilot's only words for sounds the pilot flies by. So the
  talk cap is 165 s (ru 163.2 s), not lower; a shorter corridor needs new, shorter lines, which this lane may not write.
- A cue's name may be 1 to 3 letters (ru 'floor' is 3): lessons.test.ts's 'more than 3 characters' rule exempts cue.*.name.
- The sound start screen has no access to the pilot's ui.menuLevel (SonicHost is only the prefs collections), and that setting
  defaults to expert for anyone who never answered 'Before you fly' (a blind pilot on ?sonic=start never sees it). So the screen uses
  menu4's MenuLevel type and levelShows() with its own table SONIC_SETTING_LEVELS, viewed at level first; 'Show all settings' opens the
  rest for the page (an instance flag, like ui/settings/screen.ts's showAllRows). A shared link that sets a sound setting shows all.
- sonic-int-replay.test.ts: with the shorter rings-first intro the second counted gate fell live at 45936 ms; the replay, which
  finds gates on the 32 ms samples, found it at 45920 ms (matched within the comparer's 100 ms), so the gate's one-shot cues (note,
  lap, praise) ended 2 frames early there (frame 1391) against a slack of 1. The test now measures that gate shift per lesson
  (gateShiftFrames, at most 1 frame, asserted) and allows it only to frames where nothing but those gate cues differ (cause 'gate');
  a control removes the praise from the replay and is still caught. The package's comparer and its slack are unchanged.
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
  buttons, Quick start focused, presses 'Show all settings' before the settings checks); the host tests that count the package's lesson
  data: tools/bench/test/sonic-start.test.ts, sonic-lesson-keys.test.ts, sonic-lessons.test.ts, sonic-int-replay.test.ts (gate shift).
- The sound package: branch gap-sound head 150ebac296d5e618b6fd952ea342d03db43c1338 must reach the package's main together with
  car 4's package head (it is on no remote; parent 53a5675). Ask the Lodz testers to listen once after the release: no person
  listened here.
- The keys line 'said once' (owner, line 531): apps/fly/src/sonic/lessons.ts keysDue() returns true on every step of a flying
  lesson. Proposal: `if (this.lesson?.world.kind !== 'none') return !this.keysSaid;` (once a lesson), with its host test.
  Not an owned file of this lane, so not changed here.
- Pre-existing on 2d752fcc, not this lane: 3 tests fail on a key clash 'Shift+KeyH is bound to messages.open and sonic.headCentre'
  (rooms-public.test.ts, sonic-in-place.test.ts, train1-contract.test.ts).

## Cost notes

- S1: the most replies went to reading the 880-line test file in slices; a list of test names with the ids they touch would be cheaper.
- S2 (run 1): the package's guard tests (own catalogue lines, versions, named sounds, trials) each needed a read and an edit; a run of
  the package suite on a throwaway data change first, to list every test that pins lesson data, would have saved about 10 replies.
- S2 (run 2): most replies went to small test-text slips (a quote in a test title, a regex) and to a printer for the talk seconds;
  running the host suite (tools/bench/test/sonic*) right after the data change in run 1 would have shown the 5 host tests early.
  Python's open(..., 'w') writes CRLF on Windows: write with newline='' or use the Edit tool.
- S2 (run 3): most replies went to the replay test's frame 1391: a dump of recorded vs derived cues and the derived events around the
  failing frame (one temporary JSON write in the test) found the 16 ms gate shift in 2 runs; start there next time.
