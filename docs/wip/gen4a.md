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
- [ ] A1 analysis: scan.ts analyzeScan + scan.test.ts on worlds.ts worlds (room box, table+skull, city blocks on a 2 m
  fuzzy ground slab, plant stems); NEG groundTop over the slab is its top (qualityMap.ground fails); footprint excludes the
  air beside the table; scan-kind-audit.ts over 9 baked scans + 5dfeb49b, 7a475d38, micro-greens -> evidence; thresholds
  from it; hand labels in scan-kinds.json.
  - [x] analyzeScan (two passes over blocks: column cells -> trimmed extent; tiles x layers -> ground run, roofTop,
    ceiling, crisp x cover quality, footprint closed by 2 tiles, core, measures, scanKind). Commits 7da1c05c, 1da82a25 and the
    Status commit.
  - [x] scan.test.ts on packages/tracks/test/scan-worlds.ts (room, table+skull, skull at x15, city on a fuzzy 2 m slab with
    the qualityMap.ground control inside, plant tray): 5 passed. NEG with neg_control.py not run yet.
  - [x] scan-kind-audit.ts + scan-kinds.json (12 scans: 9 baked + 5dfeb49b, 7a475d38, 39e63ce9 from the CDN cache;
    micro-greens = Forest Floor ab5efa0e, fix3a.md line 762). Run 2: MATCH 4/14 (ab5efa0e x1/x15 plants, d10c5638 object,
    eb5f51dc street). Lublin 2f1ddf5f analysis 1.8 s, 5dfeb49b 3.7 s (under the design's 5 s).
  - [ ] LEFT: the kind rules do not hold on real walls (audit2 table in evidence/2026-11-19/gen4/scan-kinds.json):
    (1) coreFill is 0.19-0.88 on every scan, so 'plants' fires on 6 streets/rooms: needs a measure that only foliage has
    (e.g. share of layers with cover between 0.2 and 0.8 under roofTop, or fill measured in blocks of the zone only above
    groundTop); (2) rooms show ceilingShare 0.14 (7a475d38) and 0.29 (39e63ce9): the CEIL_COV 0.5 / free-run rule misses
    glass and partial ceilings; try cover >= 0.25 and measure in the core zone of radius 1 x coreRadiusM; (3) real walls are
    dense shells, voxels per occupied block 7-64 (crisp saturates at CRISP_FULL 16; raise it to ~48 or use the median);
    Lublin's ground (56) is denser than its roofs (33), so 'ground quality < roofs' must be read another way (e.g. the
    ground run's thickness in m x unit: a drone scan's fuzzy shell is thick); (4) 5dfeb49b: coreVoxelShare 0.07 over a
    132 m extent: the skull scene's core and object rule need the audit's core position checked against the skull (print
    core and the top tiles). Then set the thresholds, re-run the audit once, the NEG via neg_control.py on scan.ts.
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

- planCourse's stub is not run by a test of its own in S0 (it is the worker's code of today moved; A2 tests it). No person,
  phone or real controller took part.

## For the lead

- Files outside the owned list: packages/tracks/test/scan-worlds.ts (new: the four synthetic scans shared by scan.test.ts
  and plan.test.ts; worlds.ts itself is not touched).
- Differences from the design: ScanAnalysis has one more field, `measures` (ScanMeasures: what the kind was decided by),
  so the audit can show it; gen4b does not read it.
- Deploy order: page only (packages/tracks is bundled into the page and its worker).

## Cost notes

- A1 (run 1, left): about 35 replies; most went to the synthetic worlds (a signed-hash bug gave 54 % fuzz instead of 10 %)
  and to finding the micro-greens id (a repo-wide grep timed out: grep docs/wip only). Cheaper: print the real scans'
  per-layer cover profile BEFORE writing kind rules, so the rules are designed from data in one pass.
- S0: about 12 replies; the neg_control call needs `npx.cmd`, not `npx`, on this Windows shell (one wasted call).
