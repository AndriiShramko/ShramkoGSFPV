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
- [ ] S2 the card, the keys, the known sounds
- [ ] S3 "What is this sound?" (G)
- [ ] S4 the page acceptance (merge tutor-moment head 1c804864 / package 9ac7876; mouse probe local + live; one drawn run;
      accept-fly B6-B16; gates once with catalog; "What the owner should try"; delete dist)

Differences from the plan (the code wins):
- The runner plays a moment's sound as 'cue' actions (repeat-cue, with the form's direction), not through demoFrame: during a
  moment the engine is fed the held craft's frame, gated to the moment's cue by setAudible.
- PauseReason lives in apps/fly/src/app/context.ts (not an owned file): 'moment' added to the union (one word).

## What the owner does

(S4)

## Claims

1. A moment freezes the craft while the engine keeps planning the moment's cue alone; the flight goes on after it.
   `npx vitest run tools/bench/test/sonic-moment-freeze.test.ts`: 3 passed; NEG OK on 03624451.

## Not verified

(S4)

## For the lead

- Files changed outside the owned list: apps/fly/src/app/context.ts (PauseReason gains 'moment').

## Cost notes

- S1: reading the package's moment machine (the contract stub has none) took the most replies; a one-paragraph "how the host
  drives a moment" in tutor-moment's contract marker would have saved four reads.
