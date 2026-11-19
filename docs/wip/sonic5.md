# Lane sonic5: Fly by Sound at FPV speed, continued

Worktree C:/dev/gsfpv-center-throttle, branch sonic5 (from origin/main 77ab3948), ports 5760-5779. Package
C:/dev/ShramkoSonicFPV, branch train6 from the package's main e334c6e. Read with docs/wip/sonic4.md (Status of V1-measure,
Facts V1-a to V1-f, Design 1 to 7): the numbers there are the "before" of this lane.

## Status

### Stage W1-build
- [x] W1-build CLOSED 2026-11-19 by the lead's decision of W1.6 (see there); the rest of this lane continues in lane
  sound6 (docs/wip/sound6.md), which starts from this branch's head 80c91d05 and package bd79c96.
- [x] W1.1 branches: simulator sonic5 from origin/main 77ab3948; package train6 from main e334c6e with 7678880 cherry-picked
  as 5e04268 (no conflict; the cherry-pick touches cues/budget.ts, cues/lead.ts, cues/planner.ts, cues/rules.ts,
  lesson/gate-aim.ts, lesson/runner.ts and two tests; the wrong-way rule D7 (runner.ts checkDirection, WRONG_WAY_*) and the
  narrator setting are not in its hunks). train4 left as it was. Package: vitest 72 files, 1360 passed, 7 skipped; tsc
  tsconfig.core.json, tsconfig.json, tsconfig.node.json 0 errors. Simulator pin moved locally from 293ebae (origin/main's pin,
  an ancestor of the package's main e334c6e) to 5e04268; pnpm -r typecheck 0 errors.
- [x] W1.2 the table of the brought commit (Facts W1-a).
- [x] W1.3 Design 3 (speech at speed), package e28399f + da0ab7d on train6, simulator pin da0ab7d: kept (Facts W1-b). No new
  line, so no new sound for the narrator off (the count line fly.progress and the attempt's cue stay at once). Test
  packages/sonic-fpv test/speech-at-speed.test.ts, negative control against 5e04268 fails by assertion ("expected 3.4 to be
  less than 2"); package vitest 73 files 1362 passed, three tsc 0 errors.
- [x] W1.4 Design 4, package 2bea5d9 + 26be7f8 on train6, simulator pin 26be7f8: kept by the lane's rule (Facts W1-c).
  src/cues/brake.ts (estimates: 45 deg aside, turn radius at 120 deg/s plus 1 s of travel, from 4.5 m/s, the tier edge);
  the speed layer plays two falling notes (a fourth down) as 'speed.brake'; the ear pilot keeps 0.3 of its set point while
  it hears it. A sound only, no spoken line (no QUIET_SOUNDS entry needed). Test test/brake-cue.test.ts, negative control
  with the old src/pilot/ear-pilot.ts fails by assertion ("expected 8 to be less than 4"); test/budget-wired.test.ts now
  allows the brake cue at tier 2 (the speed ticks stay off). Package vitest after the change: 74 files, the 6 touched files 72
  passed (a full run with a glossary entry for the cue failed 4 files that need recorded voices: the entry was taken out);
  three tsc 0 errors. Merge of origin/main 89c9c86e as 584f31bb (21 untracked older evidence files that main now tracks
  moved to U:/Temp/gsfpv-train2/sonic5/untracked-before-merge-89c9c86e); pnpm -r typecheck 0 errors after it and at 26be7f8.
- [x] W1.5 Design 5 rest, package cd37a57 on train6, simulator pin cd37a57: kept (Facts W1-e). In front of the next gate
  (gate aim on, entry side) the racing line's look ends at the gate's approach point (src/cues/line.ts update capS and
  placeOf; src/lesson/runner.ts lineTarget); never behind the craft. Test test/line-gate-cap.test.ts (4 tests), negative
  control with the old src/cues/line.ts fails by assertion ("expected -10 to be close to -4"); line.test.ts and
  speed-lead.test.ts pass (18 tests in the three files); three tsc 0 errors. The line stays off by default.
- [x] W1.6 Design 6: measured first (Facts W1-f): at cd37a57 the ear pilot's median top speed on the ring course is
  6 m/s (8, 10, 12, 15 m/s fail on every seed), so by the package's shipping rule (test/speed-ladder.test.ts: cap at most
  median top / 1.25) no cap above 4.8 m/s can ship yet; no lesson built.
  DECISION of the lead, 2026-11-19: the package's rule "a speed cap is at most the ear pilot's median top speed divided
  by 1.25" stays; the lessons speed-5 to speed-8 are NOT built; what is proven stays (designs 3, 4, 5 and the audio
  proofs W1.7). The glossary entry of the cue 'speed.brake' (item 1 of the left list) moves to lane sound6, in the stage
  where it measures new spoken lines anyway. W1-build is closed by this decision (recorded by lane sound6).
- [~] W1.7 offline audio proofs, package 4c8e4e1 on train6, simulator pin 4c8e4e1 (commit 57340ae3; test-audio/page/proofs.ts,
  run 'PROOFS=streams-at-speed,brake-ceiling PROOFS_OUT=evidence/audio-proofs-speed.json pnpm proof:audio', no GPU lock,
  49 s; package tsc -p tsconfig.json 0 errors). streams-at-speed: 8 m/s among pillars, every layer on, streams at any 0.1 s
  median 2, worst 2 (bound 3); control with the stream budget off median 4, worst 4 (fails, as it must). brake-ceiling:
  8 m/s, gate 56 deg aside: the brake cue sounds on the speed layer (rms 0.065 against 0 with the gate ahead), peak
  -6.46 dBFS under the -6 dBFS ceiling; control without the limiter -4.8 dBFS (fails, as it must). The full
  evidence/audio-proofs.json is not rewritten (PROOFS_OUT); the run rewrote the submodule's evidence/demo-check.json as a
  side effect: reverted, not committed.
- [x] W1.7 hum-lead, package 77185cd on train6, simulator pin 77185cd (run 'PROOFS=hum-lead
  PROOFS_OUT=evidence/audio-proofs-humlead.json pnpm proof:audio', no GPU lock, 49 s; package tsc -p tsconfig.json 0 errors;
  simulator pnpm -r typecheck 0 errors, log tc5.log). The proof feeds the engine the runner's own gate aim
  (src/lesson/gate-aim.ts gateAim at the craft's speed) instead of driving a LessonRunner. At 8 m/s a craft beside a ring's
  axis (out of the approach cone, 24 m out) heading at the approach point 11.82 m out (turn radius 3.82 m plus 1.0 s of
  flight: 1.0 s of lead) hears the hum on course: 169 Hz against 84.7 Hz 30 deg off its nose, ratio 1.996 (bounds 1.8 to
  2.2). Control, the approach point at the metres of today (3 m): ratio 1.005, fails as it must. Every layer at maximum
  gain: peak -17.37 dBFS (ceiling -6). The submodule's evidence/audio-proofs.json and demo-check.json were copied before the
  run and put back after it (U:/Temp/gsfpv-train2/sonic5/*.before-humlead.json): not committed.
- [~] W1.8 run 2 of 2026-11-17 at pin cd37a57: pnpm -r typecheck 0 errors; a6-reference 1 passed; gates.py --only
  vitest,architecture,i18n,b18,leaks all PASS (vitest 129 s; python from U:/Temp/gsfpv-train2/sonic5/pybin in front of PATH,
  logs tc3.log, a6-3.log, gates3.log there). Run 3 of 2026-11-17 at pin 4c8e4e1 (only the package's test-audio changed):
  pnpm -r typecheck 0 errors; gates.py --only vitest,architecture,i18n,b18,leaks all PASS (vitest 103 s; logs tc4.log,
  gates4.log; U:/Temp/gsfpv-gates-20261117-204007). a6-reference not re-run: no flight, input or collision file changed
  since run 2. Run 4 of 2026-11-17 at pin bd79c96 (the package's test-audio and one new test changed): pnpm -r typecheck
  0 errors (tc6.log); gates.py --only vitest,architecture,i18n,b18,leaks all PASS (vitest 102 s; log gates5.log;
  U:/Temp/gsfpv-gates-20261117-205509; evidence/2026-11-17/b-repo-b18.json rewritten by the gate and committed).
  a6-reference not re-run: no file of apps/fly/src/session, packages/sim-core, input or collision changed since run 2.
  Run again after W1.6.

### Left of W1-build (exact, in this order)
1. W1.4 rest: a glossary entry for 'speed.brake' (src/i18n/catalog.ts CUE_IDS, cue.speed.brake.name/.glossary in the
   package's locales en/es/pl/ru) needs the package's recorded-voice fixtures and words check (test/events, lesson-schedule,
   lessons, words failed without them). The planner-level test is done: package bd79c96 test/brake-planner.test.ts (the
   ear pilot on rings-course at 8 m/s: the brake flag in some frames with the speed budget, none without), 2 passed;
   negative control with src/cues/planner.ts of 5e04268 fails by assertion ("expected 0 to be greater than 0"); three tsc
   0 errors; simulator pin bd79c96, pnpm -r typecheck 0 errors (tc6.log). The brake cue is a sound only, no spoken line,
   so the narrator-off rule needs no QUIET_SOUNDS entry; the glossary entry is a text for the cue list, not a flight need.
2. W1.5 done (cd37a57). Not chased: with the line on, course 2 seed 2 at 2 m/s now fails at gate 6 of 24 (it counted in
   W1-d); course 1 counts 2 of 3, not 3 of 3, so Design 5's condition for the line as the guide is still not met.
3. W1.6 Design 6: lessons speed-5 to speed-8 at 6, 8, 10, 12 m/s (estimates), texts in en, es, pl, ru with the word 'key'
   before a key's letter; each opens after a counted pass of the step before; scan-free and N courses take the highest
   passed cap, at least 5 m/s; tests with negative controls. Blocker measured (Facts W1-f): the ear pilot tops out at
   6 m/s on the ring course, so the caps 6 to 12 m/s break the package's rule "cap at most median top / 1.25"
   (test/speed-ladder.test.ts). Decision for the lead: either the ear pilot must fly faster first (the 8 m/s goal of
   Design 7 needs that anyway), or the speed-5+ caps ship as estimates with that test's rule changed. What a new lesson
   needs besides its JSON (from commits 9c40ed2, a466888 of the package): lessons/speed-N.json, src/lesson/library.ts,
   src/i18n/catalog.ts LESSONS entry, locales en/es/pl/ru, test/helpers/new-lessons.ts SPEED_LESSONS, the lines measured
   with the Windows voices (measure-tts.ps1; test/fixtures/tts-*.json) and the counts in test/lesson-schedule.test.ts,
   evidence/ear-pilot/*speed-lessons* (tools/ear-pilot.ts exports main() only: run it through a two-line runner).
4. W1.7 done (77185cd). C:/dev/ShramkoSonicFPV still has evidence/audio-proofs.json and demo-check.json modified by an
   earlier hand: not committed.
5. W1.8 done at pin bd79c96 (run 4). Left of W1-build after this run: item 3 (W1.6, waits for the lead's decision, see
   there; a fresh run cannot settle it alone) and item 1's glossary entry (a text for the cue list, not a flight need);
   after W1.6, W1.8 once more and the stage's commit of both repositories.
6. Run 5 of 2026-11-17 (started by the lane supervisor, no person watching): origin/main still 89c9c86e (merged as
   584f31bb, no merge needed); simulator tree clean; package train6 head bd79c96 = the pin; no decision on W1.6 found
   (C:/dev/gsfpv-v03/docs/wip/train3-lead.md names no sonic5 decision). Nothing re-run: inputs unchanged since run 4.
   W1-build stays blocked on the lead's decision of item 3; a further supervisor run finds the same block until the lead
   decides, so it should not be started before that.
- Design 2 targets are not met yet (W1-b at 8 m/s: streams median 3 against 2, worst second 6.76 against 3, onsets 24.8 a
  second against under 15); counted at 5, 8 and 12 m/s is 0 of 6 (the goal needs 4 of 6 at 8 m/s). Noticed, not chased: at
  5 m/s the brought commit has streams median 6 against 5 in V1-a (file suspected: packages/sonic-fpv src/cues/budget.ts, the
  4.5 m/s tier edge; a guess, not measured).

### For the lead (so far)
- Package branch train6 (local only, not pushed): 5e04268 (7678880 cherry-picked), e28399f, da0ab7d. Simulator pin (local):
  da0ab7d; origin/main's pin is 293ebae. Deploy order later: the package's main first, then the pin.
- Files changed outside apps/fly/src/sonic so far: docs/wip/sonic5.md, packages/sonic-fpv (pin).
- Package branch train6 now also 2bea5d9, 26be7f8 (design 4), cd37a57 (design 5 rest), 4c8e4e1 (audio proofs streams-at-speed, brake-ceiling), 77185cd (audio proof hum-lead);
  bd79c96 (planner test of the brake cue); simulator pin (local) bd79c96.

### Stage W2-prove
- [ ] not started.

## Facts (measured)

Tool as in sonic4 Facts: `cd tools/bench && npx tsx src/sonic-speed-measure.ts --walls
U:/Temp/gsfpv-train2/walls/release/70b50d42/v1 --scene 70b50d42 --spawn -11.9,3.12,-16.83 --course-seed <1|2> --track
U:/Temp/gsfpv-train3/sonic4/track-70b50d42-s<k>.json --speeds 2,5,8,12 --seeds 1,2,3 --line off --out
U:/Temp/gsfpv-train2/sonic5/<name>-s<k>.json`; summary `py -X utf8 U:/Temp/gsfpv-train2/sonic5/sum.py <files>`. Definitions,
pilot, craft model and walls as in sonic4 Facts. 6 flights per row (2 courses x 3 seeds), line off.

### W1-a: the brought commit (package 5e04268 = 7678880 on main e334c6e), outputs w1-base-s1/s2.json and .log
| m/s | counted | gates med (of 24) | v50 | streams median / worst second / max | onsets/s | words/10 s | wall lead med / p10 s, late of all | hum spare med / min s | brake need max m/s2 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 6 of 6 | 24 | 2.0 | 4 / 6.91 / 7 | 9.97 | 2.71 | 1.92 / 0.43, 168 of 4626 | 9.55 / 1.77 | 22 |
| 5 | 0 of 6 | 2 | 3.68 | 6 / 7.0 / 7 | 29.05 | 14.62 | 1.48 / 0.32, 61 of 750 | 2.60 / 1.78 | 37 |
| 8 | 0 of 6 | 2 | 4.16 | 3 / 6.76 / 7 | 24.81 | 28.28 | 1.29 / 0.29, 43 of 516 | 1.31 / 0.99 | 51 |
| 12 | 0 of 6 | 2 | 4.68 | 3 / 6.21 / 7 | 23.84 | 23.15 | 0.95 / 0.16, 72 of 481 | 0.55 / 0.49 | 68 |
- Against V1-a (before 7678880): 2 m/s identical (6 of 6, same numbers); counted passes at 5 to 12 m/s unchanged (0 of 6,
  gates 2 to 3 -> 2); streams median at 8 and 12 m/s 5 -> 3, but the worst second stays 6.2 to 7 (target 3); onsets at 8 m/s
  44.6 -> 24.8 a second (target under 15); brake need max 214 -> 51 m/s2 (urgent at stop distance). At 5 m/s streams rose
  5 -> 6 median (the 5 m/s flights are short: median speed 3.7 m/s, under the 4.5 m/s tier edge most of the time).
- Words per 10 s at 8 m/s are unchanged (28.6 -> 28.3): the miss lines (Design 3).

### W1-b: Design 3 (package da0ab7d), outputs w1-d3b-s1/s2.json and .log
- First try (e28399f, outputs w1-d3-*): the miss lines waited only when the attempt failed at 4.5 m/s or faster; the table
  was identical to W1-a, because the craft flies 3.2 to 3.6 m/s when an 8 m/s attempt fails (failure tails of w1-d3-s1.json:
  said fly.progress, retry, hint.1 at 3.6, 3.21, 3.36 m/s). Changed to the design's own number: in a lesson capped at 4.5 m/s
  or more the miss lines wait while the craft flies at 2 m/s or faster.
| m/s | counted | gates med | streams median / worst / max | onsets/s | words/10 s (W1-a) |
|---|---|---|---|---|---|
| 2 | 6 of 6 | 24 | 4 / 6.91 / 7 | 9.97 | 2.71 (2.71) |
| 5 | 0 of 6 | 2 | 6 / 7.0 / 7 | 29.05 | 7.37 (14.62) |
| 8 | 0 of 6 | 2 | 3 / 6.76 / 7 | 24.81 | 12.21 (28.28) |
| 12 | 0 of 6 | 2 | 3 / 6.21 / 7 | 23.84 | 12.51 (23.15) |
- Every other column equals W1-a. Kept: counted at 8 m/s did not fall, 2 and 5 m/s counted as before.
- Limit of the measure: the tool ends a flight at its first failed attempt, so the waiting lines are not in the flight's words
  at all; in the simulator they are said once the craft is under 2 m/s. What is left per 10 s at 8 m/s is the in-flight
  speech: fly.stage at gates, fly.gate-behind, fly.progress.

### W1-c: Design 4, the brake cue (package 26be7f8), outputs w1-d4b-s1/s2.json and .log (w1-d4-*: the first try, the cue
needed the speed layer, which scan-free and the courses do not have: table identical to W1-b)
| m/s | counted | gates med | v50 | streams median / worst / max | onsets/s | words/10 s | wall lead med / p10 s | hum spare med / min s | brake need max m/s2 |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 6 of 6 | 24 | 2.0 | 4 / 6.91 / 7 | 9.97 | 2.71 | 1.92 / 0.43 | 9.55 / 1.77 | 22 |
| 5 | 0 of 6 | 2 | 3.68 | 6 / 7.0 / 7 | 29.05 | 7.37 | 1.48 / 0.32 | 2.60 / 1.78 | 37 |
| 8 | 0 of 6 | 3 | 4.14 | 4 / 6.93 / 7 | 27.09 | 10.66 | 1.48 / 0.33 | 1.89 / 0.99 | 120 |
| 12 | 0 of 6 | 2 | 4.49 | 3 / 5.33 / 8 | 22.09 | 12.96 | 0.93 / 0.16 | 0.55 / 0.49 | 96 |
- Against W1-b: 2 and 5 m/s identical; at 8 m/s counted 0 of 6 as before, gates median 2 -> 3, wall lead median 1.29 ->
  1.48 s, hum spare median 1.31 -> 1.89 s, but streams median 3 -> 4 and onsets 24.8 -> 27.1 a second (Design 2 moves
  away); at 12 m/s the worst second 6.21 -> 5.33, onsets 23.8 -> 22.1. Kept by the rule (counted at 8 m/s did not fall, 2 and
  5 m/s as they were); the extra stream is the brake cue itself, a candidate for the budget's count in W1.7.

### W1-d: the line on (package 26be7f8, --line on), outputs w1-line-s1/s2.json and .log
| m/s | counted | gates med | streams median / worst / max | onsets/s | words/10 s | hum spare med / min s |
|---|---|---|---|---|---|---|
| 2 | 3 of 6 | 24 | 4 / 6.73 / 7 | 13.42 | 3.17 | 9.64 / 1.70 |
| 5 | 0 of 6 | 1.5 | 3.5 / 6.0 / 8 | 26.55 | 10.68 | 2.67 / 1.31 |
| 8 | 0 of 6 | 2 | 3 / 6.29 / 7 | 25.98 | 13.32 | 1.04 / 0.99 |
| 12 | 0 of 6 | 1 | 3 / 4.49 / 8 | 24.07 | 18.59 | 1.21 / 0.55 |
- At 2 m/s course 1 fails every seed (gates 24, 20, 21 of 24, the first with all gates but no counted pass), course 2
  counts 3 of 3. Design 5's condition holds ("until course 1 counts at 2 m/s with the line on, the gate hum stays the
  guide"): W1.5 is needed; the line stays off by default.

### W1-e: Design 5 rest, the look capped at the gate's approach point (package cd37a57, --line on), outputs w1-d5-s1/s2.json and .log
| m/s | counted | gates med | v50 | streams median / worst / max | onsets/s | words/10 s | hum spare med / min s |
|---|---|---|---|---|---|---|---|
| 2 | 4 of 6 | 24 | 2.0 | 4 / 6.84 / 7 | 13.46 | 3.04 | 9.35 / 1.92 |
| 5 | 0 of 6 | 2.5 | 3.77 | 5 / 6.27 / 7 | 27.79 | 9.70 | 3.56 / 1.08 |
| 8 | 0 of 6 | 1 | 4.11 | 4 / 6.88 / 8 | 27.66 | 11.59 | 2.01 / 0.04 |
| 12 | 0 of 6 | 1.5 | 4.51 | 3 / 4.76 / 8 | 23.07 | 15.06 | 0.55 / 0.50 |
- Against W1-d (line on, 26be7f8): at 2 m/s counted 3 -> 4 of 6; course 1 0 -> 2 of 3 (seed 3 fails at gate 2), course 2
  3 -> 2 of 3 (seed 2 fails at gate 6); 5, 8 and 12 m/s counted 0 of 6 as before (gates median at 8 m/s 2 -> 1). Kept by the
  lane's rule (counted at 8 m/s did not fall, 2 and 5 m/s not worse). The line-off table (default) is unchanged by
  construction: the cap is only in lineTarget, which the line-off flights never call.

### W1-f: how fast the ear pilot flies the ring course at cd37a57 (Design 6's caps)
Tool: packages/sonic-fpv tools/ear-pilot.ts main() through a two-line runner, `--lessons speed-4,rings-course --rungs
4.5,6,8,10,12,15 --seeds 1,2,3 --attend-hum --line on --budget on`, output U:/Temp/gsfpv-train2/sonic5/w1-ladder-cd37a57.json.
- speed-4 and rings-course alike, every seed: 4.5 pass, 6 pass, 8 fail, 10 fail, 12 fail or touch, 15 touch; median top
  6 m/s (as on 2026-11-15 before this lane's rules: evidence/ear-pilot/2026-11-15-speed-lessons-hum.json, 6 m/s).
- So the brake cue (design 4), the speech rule (design 3) and the line's cap (design 5) did not raise the top speed on the
  ring course; a cap of 6 m/s or more fails the package's rule cap x 1.25 <= median top.
