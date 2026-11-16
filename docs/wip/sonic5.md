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
- [~] W1.8 simulator typecheck, gates.py --only vitest,architecture,i18n,b18,leaks, a6-reference: all pass at pin da0ab7d
  (run 1 of 2026-11-16: pnpm -r typecheck 0 errors; a6-reference 1 passed; gates architecture, i18n, b18 PASS; vitest 385
  files passed and 4 failed with "spawn python ENOENT", leaks "no python program": this run's shell had no python on PATH;
  rerun with the py launcher copied as U:/Temp/gsfpv-train2/sonic5/pybin/python.exe in front of PATH (bash form
  /u/Temp/gsfpv-train2/sonic5/pybin): rooms-open-vote, rooms-race, rooms-socket, scene-default 4 files 26 passed, leaks
  PASS). Run again at the end of the stage, after W1.4 to W1.7.

### Left of W1-build (exact, in this order)
1. W1.4 Design 4: a brake cue when the next gate's hum is more than 45 deg aside and nearer than the turn radius plus 1 s x v
   (package: a cue event on the speed layer with a falling tone in src/cues and the theme; the ear pilot src/pilot/ear-pilot.ts
   brakes on it), test with negative control, table again (keep only if counted at 8 m/s does not fall and 2 and 5 m/s
   stay). A sound only adds no spoken line; if a line is added it needs its sound in apps/fly/src/sonic/quiet-cues.ts
   QUIET_SOUNDS and its text in packages/i18n/locales (en, es, pl, ru) and the package's locales.
2. W1.5 Design 5 rest, only if the line still fails near a gate (line on, --line on, same courses).
3. W1.6 Design 6: lessons speed-5 to speed-8 at 6, 8, 10, 12 m/s (estimates), texts in en, es, pl, ru with the word 'key'
   before a key's letter; each opens after a counted pass of the step before; scan-free and N courses take the highest
   passed cap, at least 5 m/s; tests with negative controls.
4. W1.7 offline audio proofs (streams at 8 m/s, hum lead, peak rule); evidence/audio-proofs.json and demo-check.json of the
   package worktree are modified by an earlier hand: commit them only if these proofs rewrite them, and say so.
5. W1.8 again; then the stage's commit of both repositories.
- Design 2 targets are not met yet (W1-b at 8 m/s: streams median 3 against 2, worst second 6.76 against 3, onsets 24.8 a
  second against under 15); counted at 5, 8 and 12 m/s is 0 of 6 (the goal needs 4 of 6 at 8 m/s). Noticed, not chased: at
  5 m/s the brought commit has streams median 6 against 5 in V1-a (file suspected: packages/sonic-fpv src/cues/budget.ts, the
  4.5 m/s tier edge; a guess, not measured).

### For the lead (so far)
- Package branch train6 (local only, not pushed): 5e04268 (7678880 cherry-picked), e28399f, da0ab7d. Simulator pin (local):
  da0ab7d; origin/main's pin is 293ebae. Deploy order later: the package's main first, then the pin.
- Files changed outside apps/fly/src/sonic so far: docs/wip/sonic5.md, packages/sonic-fpv (pin).

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
