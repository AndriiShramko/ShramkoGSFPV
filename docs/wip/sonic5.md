# Lane sonic5: Fly by Sound at FPV speed, continued

Worktree C:/dev/gsfpv-center-throttle, branch sonic5 (from origin/main 77ab3948), ports 5760-5779. Package
C:/dev/ShramkoSonicFPV, branch train6 from the package's main e334c6e. Read with docs/wip/sonic4.md (Status of V1-measure,
Facts V1-a to V1-f, Design 1 to 7): the numbers there are the "before" of this lane.

## Status

### Stage W1-build
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
- [ ] W1.4 Design 4 (brake cue "slow" with a falling tone; the ear pilot brakes on it), unit test with negative control, table
  again.
- [ ] W1.5 Design 5 rest (the line's look shortened near a gate) only if the line still fails near a gate.
- [ ] W1.6 Design 6 (lessons speed-5 to speed-8 at 6, 8, 10, 12 m/s, texts en/es/pl/ru, caps lift by passing), unit tests with
  negative controls.
- [ ] W1.7 offline audio proofs for the new rules (streams at 8 m/s, hum lead, peak rule).
- [ ] W1.8 simulator typecheck, gates.py --only vitest,architecture,i18n,b18,leaks, a6-reference.

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
