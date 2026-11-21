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
- [ ] S2 the card, the keys, the known sounds (run 1 committed as "tutor-air S2 (wip)")
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
  LEFT (exact):
  - [ ] packages/prefs/test/keymap.test.ts DESIGN_TABLE (+ 'sonic.know': ['Shift+K'], MODE_KEYS list) and
        tools/bench/test/app-keys.test.ts SOUND list; packages/prefs/test/catalog.test.ts (the mode's keys) - 5 fail now
  - [ ] tools/bench/test/sonic-lesson-keys.test.ts B7 fails (K's lines: the new help row; see whether the rig's engine
        dict lacks sonic.moment.helpKnow or the test lists the lines) - fix in the owned side if possible
  - [ ] new tools/bench/test/sonic-moment-card.test.ts (card DOM: name + line only, hidden on null, aria-hidden; check
        for a DOM env in the repo first) and sonic-moment-keys.test.ts (runnerOptions known/guide given only with a
        MomentHost and narrator on; store known round trip through mkStore; bridge.momentKey records the key event
        before runner.momentKey; mode N/Z route by inMoment; prefs known validator) ; NEG on 03624451
  - [ ] "Start flying opens straight into the air after the headphone check": verify which lesson Start flying opens
        (start-model.ts) and that the package's first set needs nothing more from the page
  - [ ] commit S2, Status, cost note
- [ ] S3 "What is this sound?" (G)
- [ ] S4 the page acceptance (tutor-moment head already merged in S2; mouse probe local + live; one drawn run;
      accept-fly B6-B16; gates once with catalog; "What the owner should try"; delete dist)

Differences from the plan (the code wins):
- The runner plays a moment's sound as 'cue' actions (repeat-cue, with the form's direction), not through demoFrame: during a
  moment the engine is fed the held craft's frame, gated to the moment's cue by setAudible.
- PauseReason lives in apps/fly/src/app/context.ts (not an owned file): 'moment' added to the union (one word).
- The known sounds need a field in the saved collection: packages/prefs/src/doc.ts SonicState.known (not an owned file).
- bridge.ts gains momentKey (the key events the replay needs, tutor-moment's For the lead), beyond the pause and setAudible.

## What the owner does

(S4)

## Claims

1. A moment freezes the craft while the engine keeps planning the moment's cue alone; the flight goes on after it.
   `npx vitest run tools/bench/test/sonic-moment-freeze.test.ts`: 3 passed; NEG OK on 03624451.

## Not verified

(S4)

## For the lead

- Files changed outside the owned list: apps/fly/src/app/context.ts (PauseReason gains 'moment'); packages/prefs/src/doc.ts
  (SonicState.known, S2).

## Cost notes

- S1: reading the package's moment machine (the contract stub has none) took the most replies; a one-paragraph "how the host
  drives a moment" in tutor-moment's contract marker would have saved four reads.
- S2 run 1: finding where speech text, key names and the saved collection meet took the most replies (feature.ts, bridge,
  key-names, doc.ts); a map line per host hook in docs/agent-map.md for the sound mode would have saved about six reads.
