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
- [~] W1.2 the table of the brought commit (sonic-speed-measure.ts, Wroclaw 70b50d42, 2 courses x 3 seeds, 2, 5, 8, 12 m/s,
  line off).
- [ ] W1.3 Design 3 (speech at speed: in flight only the gate count; miss lines wait under 2 m/s), its sound for the narrator
  off, unit test with negative control, table again.
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
U:/Temp/gsfpv-train2/sonic5/<name>-s<k>.json`; summary `python U:/Temp/gsfpv-train2/sonic5/sum.py <files>`.
