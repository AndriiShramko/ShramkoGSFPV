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
  c54508f8 (run 1), 7b5b4788 (run 2).
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
- [x] A2 placement: plan.ts planCourse for real + generate.ts `place` option + placementStats + plan.test.ts (closed course,
  startFinishM 0, outside 0, underGround 0, openings 10/6/4 D); NEG: the same worlds through fitCourse give an open course
  or a gate under the slab top; g1 tests stay green unchanged. Commits 2b0c9f97 and the status commit after it.
  - planCourse: analyzeScan; planRules (D, the opening ladder openingD x D stepping x0.75 down to 4 D, legs, zoneR, N);
    per opening: zoneBox (zone tiles, ground to roof + 2 openings) -> freeAtMargin (spawn = startOf: over the core;
    'indoor' for a room) -> zoneAt tiers (0 all rules, 1 without quality, 2 without the kind rule; the first with
    >= 8 candidates per gate) -> generateCourse with CourseOptions.place. A compact ask under gatesMin is tried over the
    whole scan at the same opening before the opening shrinks (a bare room's core is a corner). A shrunk opening shrinks
    the legs with it. Track id = courseLinkId, version '5.<letters>'(.e2)(.s<n>).
  - generate.ts place (absent: the walk of before exactly): the zone filters the candidates, the start is the zone cell
    nearest the core, the out half keeps within reachM, legs keep climbMax, closeAt closes at any gate that sees the start
    (low 1), composed elements are kept only when all their gates are in the zone.
  - Zone details that differ from the design: the height cap is on the gate's CENTRE (<= roofTop + 2 openings, not its top
    edge: the walk's 1.4-ring free radius left no window over a skull); the low edge is min(LOW_EDGE_M x unit, one
    opening) (lowEdgeM; 0.3 m has no room over a table at x1); cityAbove excludes every centre under groundTop + 4 m x unit
    (share 0, inside the design's 1 in 5).
  - plan.test.ts 6 passed (room x 3 levels, city from above with the old path as control, skull pro at x1, plant tray
    shrunk); NEG OK (neg_control.py, plan.ts and generate.ts of S0); packages/tracks/test 161 passed (23 files).
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
2. analyzeScan tells room, plants, object, cityAbove and street apart on four synthetic scans, finds the TOP of a fuzzy
   ground shell where qualityMap's old rule does not, and keeps the air beside a table out of the territory. Proof:
   `npx vitest run packages/tracks/test/scan.test.ts`; last result 5 passed; NEG OK (scan.ts absent; run 1's scan.ts).
3. On the 12 real scans the kind matches the hand label 11 of 14 times (x1 and x15). Proof: `cd tools/bench && npx tsx
   src/scan-kind-audit.ts`; last result MATCH 11/14 (evidence/2026-11-19/gen4/scan-kinds.json).
4. planCourse lays a closed course (start = finish), with no gate outside the scanned territory or under the ground, at
   the level's opening (10 / 6 / 4 D of a 65 mm whoop) in a room; a city from above gets no gate within 4 m of its fuzzy
   ground where the old path (qualityMap + fitCourse) fails the same rules; a skull on a table and a plant tray at x1 get a
   course. Proof: `npx vitest run packages/tracks/test/plan.test.ts`; last result 6 passed; NEG OK.
5. The g1 path is unchanged: `npx vitest run packages/tracks/test`; last result 161 passed.

## Not verified

- Whether 5dfeb49b's core (-50.1, 9.3, -7.7), radius 20 m, lies on the skull: no coordinates of the skull are known to
  this lane (a drawn look in stage A3 or the acceptance can show it). Kind labels are a person's reading of the catalogue
  notes, not the owner's check.

- No person, phone or real controller took part; no page was opened (gen4b wires planCourse into the worker).

- planCourse on real scans (time, gates per level) is not measured yet: stage A3 (gen4-place-audit.ts).

## For the lead

- Files outside the owned list: packages/tracks/test/scan-worlds.ts (new: the four synthetic scans shared by scan.test.ts
  and plan.test.ts; worlds.ts itself is not touched; A2 gave the skull and plant worlds air above them, 2 m and 1.5 m).
- LEVELS.elements is read only as on/off (beginner: none; medium and pro: elements.ts's own draw of all kinds):
  composeElements takes no kind list and elements.ts is not this lane's file. Need: a `kinds` filter in ComposeInput.
- generate.ts changes beyond the option: none on the old path (place absent: every line as before; 161 tests green).
- Differences from the design: ScanAnalysis has one more field, `measures` (ScanMeasures: what the kind was decided by),
  so the audit can show it; gen4b does not read it.
- Deploy order: page only (packages/tracks is bundled into the page and its worker).

## Cost notes

- A2: about 25 replies; most went to the synthetic skull and tray giving no course (no air over them in the test grid,
  then the height cap against the walk's free radius). Cheaper: a TEMP tsx script over all worlds x levels printing one
  line per plan from the first edit; never run neg_control.py beside another vitest run (it swaps files under it).

- A1 (run 2, done): about 40 replies; most went to finding that the walls are solid (the profile and map printouts
  showed it at once) and to the synthetic skull's core (sitting on the table's edge). Cheaper: print --profile first for
  any new measure; debug a pure function with a tsx script under TEMP that imports by absolute path (tsx -e prints nothing).

- A1 (run 1, left): about 35 replies; most went to the synthetic worlds (a signed-hash bug gave 54 % fuzz instead of 10 %)
  and to finding the micro-greens id (a repo-wide grep timed out: grep docs/wip only). Cheaper: print the real scans'
  per-layer cover profile BEFORE writing kind rules, so the rules are designed from data in one pass.
- S0: about 12 replies; the neg_control call needs `npx.cmd`, not `npx`, on this Windows shell (one wasted call).
