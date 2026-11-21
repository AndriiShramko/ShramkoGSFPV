# tutor-air: the first flight is the tutorial (train 4, lane 3 of the tutor chain)

Plan: C:/dev/.gsfpv-lanes/designs/t8-plan.md Part B 3 (A1-A4, A7, C 1, 2, 3, 6, 7); brief t8-tutor-brief.md.
Base (OLD of every diff and negative control): 03624451b8deb79d179cc9a5d07adf22f1383773 (t7-base).

## Status

- [x] S1 merges and the freeze
  - [x] base check: `git merge-base --is-ancestor 03624451 HEAD` true
  - [x] merge tutor-say (head ffc19a3a, LANE-DONE; carries n-share)
  - [x] merge the tutor-moment contract 41fdd9ec; the pin moved with it to 12acc110 (the contract commit carries it;
        `git submodule status` shows 12acc11 with no '+')
  - [x] apps/fly/src/sonic/moment-host.ts: RunnerAction 'moment' -> ctx.pause('moment') once per moment, null -> resume;
        'audible' -> bridge.setAudible -> engine.setAudible; release() for the mode stopping
  - [x] bridge.ts: `momentOnly` (a pause held for 'moment' alone is not the mode's: frames, runner and engine go on, no
        silence, no 'session' pause); `setAudible` (kept, cleared on stop); lessons.ts act cases 'moment'/'audible'
        (LessonPage.moments); feature.ts makes the MomentHost and momentOnly from the pause reasons; release on teardown
  - [x] tools/bench/test/sonic-moment-freeze.test.ts 3/3 (with sonic-bridge 18/18); NEG OK on the base (all three files),
        and NEG OK with bridge.ts alone swapped back; fly typecheck rc 0
- [x] S2 the card, the keys, the known sounds (run 1 e3e09c0e wip; run 2 bb4eab79, tests, this commit)
  - [x] merged tutor-say's review 21f94ebc and tutor-moment's head 1c804864 now (not in S4): the pin stands on 9ac7876
        (`git submodule status` no '+'); S4 only re-checks both are ancestors and merges again if they moved
  - [x] packages/prefs doc.ts SonicState.known (cue ids, each once, cap 64); store.ts knownSounds/addKnownSound,
        resetProgress clears them
  - [x] lessons.ts runnerOptions: known + guide when the page has a MomentHost and the narrator is on (else absent: as
        before); observe(): moment 'learned'/'known' -> addKnownSound (cue from lesson.moments); the keys line
        `sonic.moment.keys` after the `do` line of the first moment that is not a 'start' one (SaidOnce key.sonic.repeat,
        key.scene.next, key.sonic.know; keyHints off: none) - the start moment stays under 60 words
  - [x] bridge.momentKey (key event moment.again/on/know first, then runner.momentKey); mode.ts inMoment: N -> 'on',
        Z -> 'again'; feature.ts Shift+K (sonic.know): frozen -> 'know', else `sonic.moment.knowOutside`; MomentCard wired
        (onView, speech events, removed on teardown); pageOf momentKeys from names.of
  - [x] moment-card.ts (data-testid sonic-moment / -line / -sound, aria-hidden, body class sonic-in-moment fades panels,
        captions and #ui by opacity) + sonic.css (z 15, forced colours, max-height 500 sizes)
  - [x] keymap row sonic.know (Shift+K); mode-keys help row sonic.moment.helpKnow; locale keys sonic.moment.keys,
        knowOutside, helpKnow (fly/sonic) and keys.sonic.know (fly/sonickeys), four languages
  - [x] guide.ts GuideLevel from the package; fly + prefs typecheck rc 0
  - [x] the spoken lines renamed to the engine's prefix (host-lines.ts speaks only `sonic.say.*`): sonic.say.momentKeys
        (two sentences, sonic-say-length), sonic.say.momentKnowOutside, sonic.say.helpKnow (bb4eab79)
  - [x] sonic.know in keymap.test DESIGN_TABLE/MODE_KEYS, catalog.test, app-keys.test SOUND; with sonic-lesson-keys 101/101
  - [x] tools/bench/test/sonic-moment-card.test.ts 3/3 and sonic-moment-keys.test.ts 6/6 (a classList on the shared
        sonic-fake-dom.ts); NEG OK on 03624451 (7 of 9 fail there); fly + bench typecheck rc 0; nearby sonic + prefs 347/347
  - [x] Start flying = sonic-start-quick -> firstOf('fast') = ears-headphones (the headphone check), then walls-hall whose
        first moment is height.tone at the start (safety.wall when near comes next and names the keys): nothing more
        from the page; proven in the page in S4
- [x] S3 "What is this sound?" (G) (this commit)
  - [x] sound-tour.ts SoundTour: G freezes the flight (pause reason 'tour'), the engine's last plan (activeCues) gives the cues
        heard now, each once (sectors folded), safety first; per cue: the card names it, `sonic.say.tourName` ("Sound n of m:
        name", the package's cue.<id>.name) with every cue gated out, then the cue alone (setAudible([cue]) + a 'repeat-cue' of
        2.5 s from its direction) and 0.4 s quiet; then `sonic.say.helpCut` ("Back to the flight.") and the lesson's own gate back;
        nothing audible: `sonic.say.tourNone` (one line with the key), no freeze; G again or any other pause ends it at once
  - [x] bridge.ts soundsOnPause (the tour's pause is the mode's: runner paused, 'session' pause written, but not silenced),
        audibleNow, activeCues (BridgeEngine.activeCues?); context.ts PauseReason gains 'tour'; moment-card.ts showCue
  - [x] feature.ts: G = sonic.whatSound (in a moment G hears the moment's sound again, as Z); the tour stops on teardown
  - [x] keymap sonic.glossary -> sonic.whatSound (G, keys.sonic.whatSound); mode-keys help row sonic.say.helpWhatSound; tests
        renamed (keymap, catalog, app-keys, sonic-optin-page probe); sonic-optin.test K list gains S2's Shift+K (missed in S2)
  - [x] locale keys sonic.say.tourName, tourNone, helpWhatSound (fly/sonic), keys.sonic.whatSound (fly/sonickeys, replaces
        keys.sonic.glossary), four languages
  - [x] tools/bench/test/sonic-tour.test.ts 4/4 (real CuePlanner in walls-hall); NEG OK on 03624451 (and with bridge.ts alone);
        nearby tests 26 files 367 (10 skipped) pass; fly + bench typecheck rc 0; architecture ok
  - lesson-menu.ts: no change needed, the glossary is a lesson of the lesson list there (ears-glossary), not its own item
- [ ] S4 the page acceptance (tutor-moment head already merged in S2; mouse probe local + live; one drawn run;
      accept-fly B6-B16; gates once with catalog; "What the owner should try"; delete dist)

Differences from the plan (the code wins):
- The runner plays a moment's sound as 'cue' actions (repeat-cue, with the form's direction), not through demoFrame: during a
  moment the engine is fed the held craft's frame, gated to the moment's cue by setAudible.
- PauseReason lives in apps/fly/src/app/context.ts (not an owned file): 'moment' added to the union (one word).
- The known sounds need a field in the saved collection: packages/prefs/src/doc.ts SonicState.known (not an owned file).
- S3: the tour's lines are `sonic.say.tour*` (the engine speaks only that prefix), not `sonic.tour.*`; each sound plays as a
  'repeat-cue' from its last direction under a one-cue gate (no demo frame), and the tour pauses with its own reason 'tour'.
- bridge.ts gains momentKey (the key events the replay needs, tutor-moment's For the lead), beyond the pause and setAudible.

## What the owner does

(S4)

## Claims

1. A moment freezes the craft while the engine keeps planning the moment's cue alone; the flight goes on after it.
   `npx vitest run tools/bench/test/sonic-moment-freeze.test.ts`: 3 passed; NEG OK on 03624451.
2. During a moment the screen shows one large line (the sentence spoken) and the sound's name only, aria-hidden, with a
   short-screen rule and forced colours. `npx vitest run tools/bench/test/sonic-moment-card.test.ts`: 3 passed; NEG OK.
3. In a moment Z hears the sound again, N goes on, Shift+K says "I know this"; each key event is written before the runner hears
   it; the known sounds are kept with the progress and given to the runner (with the guide level) only when the page can freeze
   and the narrator is on. `npx vitest run tools/bench/test/sonic-moment-keys.test.ts`: 6 passed; NEG OK on 03624451.

4. G ("What is this sound?") freezes the craft, names each sound heard now (safety first) and plays it alone, nothing sounding
   while a name is said; nothing heard: one line; G again ends it and gives the lesson its gate back; G is no longer the glossary.
   `npx vitest run tools/bench/test/sonic-tour.test.ts`: 4 passed; NEG OK on 03624451.

## Not verified

(S4)

## For the lead

- Files changed outside the owned list: apps/fly/src/app/context.ts (PauseReason gains 'moment' and 'tour'); tools/bench/src/
  sonic-optin-page.ts and tools/bench/test/sonic-optin.test.ts (G's action id and K's help line; Shift+K in K's list); packages/prefs/src/doc.ts
  (SonicState.known, S2); tools/bench/test/sonic-fake-dom.ts (a classList, test helper); packages/prefs/test/catalog.test.ts
  (the mode's key list gains Shift+K).
- The moment's spoken lines are `sonic.say.*` keys (the engine's prefix), not `sonic.moment.*` as the plan's Part C 6 wrote.

## Cost notes

- S1: reading the package's moment machine (the contract stub has none) took the most replies; a one-paragraph "how the host
  drives a moment" in tutor-moment's contract marker would have saved four reads.
- S2 run 1: finding where speech text, key names and the saved collection meet took the most replies (feature.ts, bridge,
  key-names, doc.ts); a map line per host hook in docs/agent-map.md for the sound mode would have saved about six reads.
- S2 run 2: finding test seams (no DOM env, the bridge's `on` gate, real cue ids, the engine's `sonic.say.` prefix) took the
  most replies; a short "how to test a sound-mode host piece" note beside sonic-fake-dom.ts would have saved about five.
- S3: learning whether the engine sounds a cue while the flight is paused (layers, previews, the planner's gate) took the most
  replies; reusing S1's freeze-test harness made the test cheap. neg_control needs `npx.cmd` on this shell, not `npx`.
