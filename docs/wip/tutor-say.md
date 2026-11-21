# tutor-say (train 4): say only what is new

Lane of the Fly by Sound tutorial after the first outside feedback (plan C:/dev/.gsfpv-lanes/designs/t8-plan.md Part A1,
Part B 1, Part C 2, 6, 7; brief t8-tutor-brief.md decisions 1, 7, 8, 9 outside moments). Base t7-base
03624451b8deb79d179cc9a5d07adf22f1383773; n-share merged in S1.

## Status

- [ ] S1 measure and contract
  - [x] merge n-share (fc merge commit on tutor-say)
  - [x] (a) tools/bench/test/sonic-said-between-steps.test.ts: fails on the base, 4 of 4 (walls-hall: the keys line at
        step 1/2 -> 2/2; ears-headphones then walls-hall: the keys line 4 times in one session)
  - [ ] (b) tools/bench/scripts/tutor-say-ax.mjs on a build of the base, evidence ax-base.json, the cause in one line
  - [ ] (c) the contract commit: SonicState.guide, guide.ts, SaidOnce; typecheck prefs and fly; marker file
- [ ] S2 the repair (keys line once a session; only the instruction between steps; #ui quiet in a lesson; progress panel one line)
- [ ] S3 the start screen and short speech (title + main button at open; row redraw; Start flying / All lessons / Continue;
      Guide row; sonic-say-length.test.ts)
- [ ] S4 the acceptance by mouse (tutor-say-accept.mjs local and live; two pictures; gates once; What the owner should try)

## What the owner does

(S4)

## Claims

(S2-S4)

## Not verified

No person, phone or real controller took part; the screen reader path is measured through the captions region and the
Chrome accessibility tree, not with a real screen reader.

## For the lead

(none yet)

## Cost notes
