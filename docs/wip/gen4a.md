# Lane gen4a (train 4): the course generator's scan analysis and placement

Design: C:/dev/.gsfpv-lanes/designs/gen4.md, part gen4a (sections 0, 3, 5 A1-A3). Owned: packages/tracks/src/{request,
scan, plan, index}.ts, generate.ts (only the optional `place` option), freespace.ts (only a cell predicate if needed),
packages/tracks/test/{request,scan,plan}.test.ts, tools/bench/src/{scan-kind-audit, gen4-place-audit}.ts,
tools/bench/src/scan-kinds.json, evidence/2026-11-19/gen4/.

## Status

- [x] S0 contract: request.ts (types, LEVELS, courseLinkId, parseCourseLink), scan.ts (ScanAnalysis interface only),
  plan.ts (planCourse stub = the worker's path of today moved into the package, request ignored except the seed;
  placementStats answers zeros, kind 'unknown'), index.ts exports; request.test.ts (link round trip for all 6
  combinations; NEG OK: absent request.ts fails). Commit b142e495.
- [x] A1 analysis: scan.ts analyzeScan + scan.test.ts + scan-kind-audit.ts + scan-kinds.json. Commits 7da1c05c, 1da82a25,
  c54508f8 (run 1) and the A1 commit of run 2 (this Status).
  - Run 2 found from the walls themselves (scan-kind-audit.ts --profile and --map): SuperSplat's voxels are SOLID under
    every surface (64 voxels in every inner block; a column is one run from the grid's bottom to the ground or the roof),
    and 5dfeb49b is solid up to the grid's top all round a carved bowl. So run 1's density measures (crisp, cover, fill)
    could not work. analyzeScan now reads per column cell where the air is: the surface (top of the lowest run), a ceiling
    (a run over >= 1 m x unit of air), leaves (a run over a smaller gap), the roof, the territory (air over the surface;
    open sky over the grid's top unless a run caps the column there). Detail = the air's boundary per column (runs + half
    the surface steps to the 4 neighbours); quality = detail x cover over 3x3 tiles over the best tenth; the core = the
    window of 0.125 x extent richest in detail above a flat floor.
  - Kind rules (KIND_RULES, from the audit table): room (ceiling >= 0.38 with leaves 0.2-0.5, or ceiling >= 0.6), plants
    (leaves >= 0.3, ceiling < 0.2), object (relief >= 0.4 x extent), cityAbove (relief >= 6 m x unit, ceiling <= 0.15),
    else street. Audit run 4: MATCH 11/14 (evidence/2026-11-19/gen4/scan-kinds.json). MISS: 0230d903 (truck show) reads
    cityAbove (ceiling 0.13, relief 23 m: the same measures as Lublin); 5dfeb49b x1 and x15 read room: its walls close the
    bowl (ceiling 0.73), so the placement keeps gates inside the bowl under its ceiling, which is what G1 needs too.
    Analysis time: Lublin 1.4 s, 5dfeb49b 1.7 s (design limit 5 s). Quality histograms no longer pile up at 1.
  - scan.test.ts 5 passed; the city world's buildings are now solid as real walls are. NEG OK twice (neg_control.py):
    scan.ts absent (origin/main) and run 1's scan.ts (HEAD before this commit) both fail the test.
- [ ] A2 placement: plan.ts planCourse for real + generate.ts `place` option + placementStats + plan.test.ts (closed course,
  startFinishM 0, outside 0, underGround 0, openings 10/6/4 D); NEG: the same worlds through fitCourse give an open course
  or a gate under the slab top; g1 tests stay green unchanged.
- [ ] A3 tight scans and evidence: no-room + fitSize, shrunk ladder to 4 D, gen4-place-audit.ts over 12 scenes x 3 levels
  x 2 spreads x 3 seeds -> evidence/2026-11-19/gen4/place.json, PASS/FAIL per rule; ms per plan <= FIT_BUDGET_MS; the
  gates once before LANE-DONE.

Differences from the design: planCourse and placementStats live in plan.ts (design section 3), not in request.ts
(section 0 lists them there); both come out of '@gsfpv/tracks' the same. The stub's onStep gives estMs 0 for 'analyse'
and 'free' (the page keeps its own rates until A2).

## What the owner does

Nothing yet: stage S0 changes no page. After gen4b: Shift+G opens the 'Generate a course' dialog (gen4b's part).

## Claims

1. A course link 'g2.<seed36>.<b|m|p><c|w|v>' round-trips every level and spread, and 'g1.bnhwha' stays the old
   generator's seed. Proof: `npx vitest run packages/tracks/test/request.test.ts`; last result 5 passed; NEG OK.

## Not verified

- Whether 5dfeb49b's core (-50.1, 9.3, -7.7), radius 20 m, lies on the skull: no coordinates of the skull are known to
  this lane (a drawn look in stage A3 or the acceptance can show it). Kind labels are a person's reading of the catalogue
  notes, not the owner's check.

- planCourse's stub is not run by a test of its own in S0 (it is the worker's code of today moved; A2 tests it). No person,
  phone or real controller took part.

3. analyzeScan tells room, plants, object, cityAbove and street apart on four synthetic scans, finds the TOP of a fuzzy
   ground shell where qualityMap's old rule does not, and keeps the air beside a table out of the territory. Proof:
   `npx vitest run packages/tracks/test/scan.test.ts`; last result 5 passed; NEG OK (scan.ts absent; run 1's scan.ts).
4. On the 12 real scans the kind matches the hand label 11 of 14 times (x1 and x15). Proof: `cd tools/bench && npx tsx
   src/scan-kind-audit.ts`; last result MATCH 11/14 (evidence/2026-11-19/gen4/scan-kinds.json).

## For the lead

- Files outside the owned list: packages/tracks/test/scan-worlds.ts (new: the four synthetic scans shared by scan.test.ts
  and plan.test.ts; worlds.ts itself is not touched).
- Differences from the design: ScanAnalysis has one more field, `measures` (ScanMeasures: what the kind was decided by),
  so the audit can show it; gen4b does not read it.
- Deploy order: page only (packages/tracks is bundled into the page and its worker).

## Cost notes

- A1 (run 2, done): about 40 replies; most went to finding that the walls are solid (the profile and map printouts
  showed it at once) and to the synthetic skull's core (sitting on the table's edge). Cheaper: print --profile first for
  any new measure; debug a pure function with a tsx script under TEMP that imports by absolute path (tsx -e prints nothing).

- A1 (run 1, left): about 35 replies; most went to the synthetic worlds (a signed-hash bug gave 54 % fuzz instead of 10 %)
  and to finding the micro-greens id (a repo-wide grep timed out: grep docs/wip only). Cheaper: print the real scans'
  per-layer cover profile BEFORE writing kind rules, so the rules are designed from data in one pass.
- S0: about 12 replies; the neg_control call needs `npx.cmd`, not `npx`, on this Windows shell (one wasted call).
