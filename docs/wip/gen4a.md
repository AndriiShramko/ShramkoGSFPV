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
- [x] A3 tight scans and evidence: no-room + fitSize, shrunk ladder to 4 D, gen4-place-audit.ts over 12 scenes x 3 levels
  x 2 spreads x 3 seeds -> evidence/2026-11-19/gen4/place.json, PASS/FAIL per rule; ms per plan <= FIT_BUDGET_MS; the
  gates once before LANE-DONE.
  - [x] no-room + fitSize: fitSizeFor (the first FIT_SIZES step over the size reaching FIT_SLACK x size / ratio; ratio =
    the largest free radius of any free zone cell against the 4 D ring's need); plan.test.ts crowdedPocket (posts every
    0.4 m in a closed 2 x 1.2 x 2 m pocket): no-room at x1 with fitSize 3, a shrunk course at x3. Found on the way: the
    free-space box cut at the footprint's edge left a closed pocket 'badly scanned' at every size (enclosure rays left
    the box): zoneBox now pads a tile and an opening at each side. plan.test 8 passed, tracks 163 passed, NEG OK
    (plan.ts of A2). Commit: the one after d1617af3.
  - [x] gen4-place-audit.ts written (commit a60c5d30): 12 scans x 3 levels x 2 spreads x seeds 1-3, a 65 mm whoop, rules
    course/inside/ground/detail/nearCore/loop/opening/gates/server/time (+ cityLow Lublin, room Winter Garden, x1 skull).
    Its first scene (housefly d10c5638) found a start in a pocket under the fly (the flood reached 2-83 cells): planCourse
    now also tries a start one opening over the core's roof (startsOf) and keeps the one with more zone cells; housefly
    6 of 6 courses. Same commit.
  - [x] Run 1 of the audit (code of a60c5d30; log U:/Temp/gsfpv-train4/gen4a/place-run1.log, JSON place-run1.json there
    when it ended) found composed elements past the level's gatesMax (17-42 gates for medium 14 / pro 24): fixed,
    CoursePlace.maxGates = LEVELS gatesMax goes to composeElements (commit b534123b; tracks 163 passed).
  - [x] LEFT 1 (run 1's audit: PLANS 216 FAILED 96; course 42 fail, gates 39, detail 16, x1 15, ground 1, server 1):
    no course on Laval castle eb5f51dc, 1994c65c wide and 5dfeb49b at x1. Found by a trace hook (removed): (a) the 1 km
    scans' zone box (whole scan) made 3.2 m free cells against a 0.85 m whoop gate: usable 0. clipBox now clips the box to
    the course's own reach around the start (gates x legMax / 2 + legMax) and shrinks it until maxCells cells of
    max(blockM, CELL_PER_OPENING 0.5 x opening) hold it: Laval 8 gates in 1.7 s (was NO-ROOM after 37 s), 1994c65c wide 8
    gates in 1.1 s. (b) 5dfeb49b at x1 (a 20 m skull in a 117 m bowl, kind room): the free space's enclosure rays (19 of
    26 hit within 12 m) left a thin shell, 265 usable cells; planCourse now passes enclosureMin 0: the analysis'
    territory (footprint, ground, ceiling, roof) is the one 'scanned' rule. 8 gates in 7.8 s (was 1 gate in 123 s). (c)
    a street start sits at eye height (startOf), not half way to a 'ceiling' of sky floaters 88 m up (Laval). plan.test
    clipBox test; tracks 164 passed.
  - [x] LEFT 2: 'server' FAIL on 1994c65c pro compact seed 1: 'gates[19]: the leg to the next gate must be at most 60
    m' (the closing leg; the walk wandered out to the 127 m zone). generate.ts closeAt (place only) skips an end whose leg
    to gate 1 is over server.ts MAX_LEG_M; plan.ts keeps the walk within max(gates x mean leg / pi, 30 m) of the start
    (loopR). Seeds 1-3: 24, 14, 24 gates, validateServerTrack ok. plan.test '2 km city' (cityFromAbove at x20, pro, seeds
    1-3: no leg issue, >= gatesMin): NEG OK against 6f9d06f0; tracks 165 passed; typecheck clean. Found on the way: at
    x20 the format refuses a whoop's gate (side 0.021 < 0.05 scene units): For the lead.
  - [x] Audit run 2 (code of 6f9d06f0; U:/Temp/gsfpv-train4/gen4a/place-run2.json): PLANS 216 FAILED 39 (run 1: 96);
    course 212/216, time 216/216, x1 18/18, cityLow 18/18, inside/ground/loop/opening all PASS. FAIL: detail 13 (Forest
    Floor ab5efa0e plants, goodShare 0.4-0.75), gates 13 (Wroclaw 70b50d42 beginner 6: 1 gate; 9baef54b medium 4: 1
    gate; 39e63ce9 beginner wide 2; eb5f51dc medium 1), room 8 (Winter Garden 7a475d38 medium/pro: gates outside the
    glass), NO-ROOM 4 (1994c65c pro wide 3, 70b50d42 pro wide 1), server 1 (fixed in 5190a972).
  - [x] Fixes after run 2 (plan.ts only; commit after 5190a972): (a) the tiers are walked in turn at the same opening
    before it shrinks (a zone with enough cells can be a broken sheet): 9baef54b medium 14/14/12 gates (was 1), Wroclaw
    16 of 18 plans PASS (focused run, stopped early: U:/Temp/gsfpv-train4/gen4a/place-run3a.log); (b) the kind rule is
    never dropped for room, cityAbove and plants (topTier 1; Winter Garden's gates outside came from tier 2), and only a
    scan with no course at all under it is laid again with tier 2 (plan.test plant tray at x1 keeps its course). Tried
    and reverted: the most open start near the core (generate.ts): it shrank the room's beginner course. tracks 165 passed.
  - [x] LEFT 3a: Wroclaw 70b50d42 beginner seed 1 closed at 1 gate (no late gate of a street walk sees the start). Fix
    (plan.ts): at the loosest tier of an opening whose walk stayed under gatesMin, WALK_VARIANTS - 1 = 2 more walks with
    seeds derived from the asked one (walkSeed; version '.w<v>'), before the opening shrinks; the same link lays the same
    course. Wroclaw seed 1 focused audit: 6 of 6 PASS, beginner 3 gates (U:/Temp/gsfpv-train4/gen4a/wro-v.json).
  - [x] LEFT 3b: plan.test 'a short walk is walked again' (room beginner seeds 4 and 12: shrunk before, not now): NEG OK
    against 18aec1d6. The tier fallback and the kept kind rule (9076951a) keep the audit rows as proof (no cheap world).
    tracks 167 passed, typecheck clean. Commit: the one after 18aec1d6.
  - [x] LEFT 3c: Forest Floor ab5efa0e detail. Cause: the plants rule (under the leaves' top) holds 0-9 cells for a whoop
    gate at x1, so every course fell to the old tier 2, which dropped the quality rule with the kind rule (350 of 682
    tiles are good: the map is fine). Fix (plan.ts): tier 2 = no kind rule, quality kept; tier 3 (LOOSEST_TIER) = both
    dropped; the ladder is walked in passes (LadderPass): the quality-keeping tiers over every opening first, a pass that
    drops a rule only when no course at all was laid (room and object: quality dropped at the same opening, their kind
    rule bounds the scanned part; a bare room's floor and a skull's table read poor); each walked tier tries
    WALK_VARIANTS seeds. Forest Floor + Wroclaw seed 1: 12 of 12 PASS (ff6.json); Forest Floor beginner now 2 gates on
    good tiles at the ladder's floor (was 5 gates, 0.4-0.6 good). plan.test 'every gate on a well-scanned tile' (city pro
    wide seed 2; old 0.933): NEG OK against 095a7624; tracks 168 passed. Synthetic old/new comparison: only that plan
    differs (goodcmp.log).
  - [x] Audit run 4 (code of c8cbfa55; U:/Temp/gsfpv-train4/gen4a/place-run4.json, log place-run4.log): PLANS 216 FAILED
    21. course 3 (1994c65c pro wide NO-ROOM), room 7 (Winter Garden 7a475d38 pro x6 + medium wide 2: gates outside the
    ceiling), server 1 (2f1ddf5f pro wide 3), gates 4 (70b50d42 beginner seed 3: 2 gates; eb5f51dc medium seed 3: 6
    gates; both at the level's opening, the whole ladder walked), nearCore 6 (39e63ce9 medium and pro compact: the
    compact ask fell back to the whole room, start 4-7 m from a 3.2 m core).
  - [x] Fixes after run 4: (a) generate.ts asks the zone at the position the gate is STORED at (toScan rounds to the mm):
    Winter Garden's tile edge at z -7.168 had cell centres a hair inside it stored on it, in the next tile (no ceiling):
    pro compact 1 now 12 gates all under the ceiling in 3 s (was 9, 7 outside, 12 s). (b) plan.ts walkReach: the free
    box's half size is the walk's reach + one leg, not the loop laid out straight: 1994c65c pro wide (voxel 0.8 m) had a
    260 m box of 3.2 m cells: now 24 gates in 1.8 s (was NO-ROOM). 2f1ddf5f pro wide 3 now passes the server (24 gates).
    A first guess (coarse cells over Winter Garden) was wrong: a trace showed 0.256 m cells in both boxes. plan.test 'stored
    at' and 'walkReach' NEG OK against c8cbfa55; tracks 170 passed; typecheck clean.
  - [x] Audit run 5 (code of 5fd34aaa; U:/Temp/gsfpv-train4/gen4a/place-run5.json, log place-run5.log): PLANS 216
    FAILED 13. course 216/216, room 18/18, inside, ground, detail, loop, opening, time, cityLow, x1 all PASS. FAIL: server
    1 (2f1ddf5f pro wide seed 2: the walk's own 61 m leg from gate 1 to gate 2), gates 6 (70b50d42 beginner seed 3 x2
    spreads: 2 gates; eb5f51dc medium seeds 2-3 x2 spreads: 6 gates), nearCore 6 (39e63ce9 compact medium and pro).
  - [x] Fix after run 5 (plan.ts): legsWithinServer (the server's own leg rule, flown m) and planCourse keeps no course that
    breaks it; Lublin pro wide 2 now 24 gates, server ok. A guard on the composed elements alone was tried and reverted (the
    long leg is the walk's). plan.test 'legsWithinServer' NEG OK against 5fd34aaa; tracks 171 passed; typecheck clean.
  - [x] LEFT 3 done: audit run 6 (code of b34b5386) -> evidence/2026-11-19/gen4/place.json: PLANS 216 FAILED 12. course,
    inside, ground, detail, loop, opening, server, time 216/216; cityLow 18/18 (Lublin), room 18/18 (Winter Garden), x1
    18/18 (5dfeb49b). The 12 FAILs are named in Not verified (gates 6, nearCore 6). Max ms per plan 42.6 s (Winter Garden; FIT_BUDGET_MS 120 s
    holds for all 216). Log U:/Temp/gsfpv-train4/gen4a/place-run6.log.
  - [x] LEFT 4: gates once on cdcc4c31 (U:/Temp/gsfpv-gates-20261119-232620): typecheck, vitest, i18n, b18, leaks PASS;
    architecture FAILED on two comments in scan.ts ('window' followed by '.' or '(' reads as the DOM to rule 8). Comments
    reworded (no code changed); `node scripts/check-architecture.mjs`: architecture rules: ok. The other five not run
    again (only comments changed). dist deleted. Commit: the one after cdcc4c31.

Differences from the design: planCourse and placementStats live in plan.ts (design section 3), not in request.ts
(section 0 lists them there); both come out of '@gsfpv/tracks' the same. The stub's onStep gives estMs 0 for 'analyse'
and 'free' (the page keeps its own rates until A2).

## What the owner does

Nothing on the page from this lane alone: gen4a is the generator's core inside packages/tracks (no page, no key, no
text). After gen4b wires it in: in any scan, key Shift+G (or the pause menu's 'Generate') opens the 'Generate a course'
dialog; he presses Beginner, Medium or Pro and Compact or Whole scene; the course appears closed (the finish is the
start), with gates sized for his craft, in the best scanned part: inside a room, over and between the roofs of a city
filmed from above, between the leaves of plants, never outside the scan. A scan with no room for his craft at this size
does not refuse: the dialog names the Scene size where the course fits (gen4b's part).

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
   course. Proof: `npx vitest run packages/tracks/test/plan.test.ts`; last result 16 passed (b34b5386); NEG OK.
5. The g1 path is unchanged: `npx vitest run packages/tracks/test`; last result 171 passed (b34b5386; the g1 tests unchanged).
6. A 1 km scan flown at x1 by a whoop gets a course: the free box is clipped to the course's reach with cells near the
   gate's size (clipBox), and the analysis' territory is the free space's one 'scanned' rule. Proof: `npx vitest run
   packages/tracks/test/plan.test.ts -t clipBox` (1 passed); on the real scans the audit: Laval eb5f51dc 8 gates in 1.7 s,
   5dfeb49b at x1 8 gates in 7.8 s (both NO-ROOM or 1 gate before); audit run 2: course 212/216, x1 18/18, time 216/216.
7. Every leg of an asked course, the closing one too, keeps the server's 60 m. Proof: `npx vitest run
   packages/tracks/test/plan.test.ts -t "2 km city"`; last result 1 passed; NEG OK against 6f9d06f0.
8. Every gate of an asked course stands in its zone at the position it is stored at (a cell centre a hair inside a zone
   edge no longer lands on the far side after the mm rounding: Winter Garden's room rule). Proof: `npx vitest run
   packages/tracks/test/plan.test.ts -t "stored at"`; last result 1 passed; NEG OK against c8cbfa55.
9. A pro wide course on a 1 km scan gets a free box of its walk's reach and one leg (walkReach), not of its loop laid out
   straight. Proof: `npx vitest run packages/tracks/test/plan.test.ts -t walkReach`; last result 1 passed; NEG OK against
   c8cbfa55. On the real scan 1994c65c pro wide seed 1: 24 gates in 1.8 s (NO-ROOM before).
10. On the 12 catalogue scans x 3 levels x 2 spreads x seeds 1-3 (216 plans, a 65 mm whoop) every plan gets a closed
   course inside the scanned territory, over the ground, at the level's opening, that the server accepts, within 120 s;
   Winter Garden's gates all stand under its ceiling, Lublin's none near its fuzzy ground, the skull at x1 has a course.
   Proof: `cd tools/bench && npx tsx src/gen4-place-audit.ts`; last result (b34b5386) PLANS 216 FAILED 12, the 12 named
   in Not verified (evidence/2026-11-19/gen4/place.json).
11. The release gates hold on this branch. Proof: `python -X utf8 C:/Users/andri/.claude/skills/gsfpv/scripts/gates.py
   --repo C:/dev/gsfpv-rooms --only typecheck,vitest,architecture,i18n,b18,leaks`; last result: all PASS except
   architecture (two comments in scan.ts), which passes after the comment fix (`node scripts/check-architecture.mjs`: ok).

## Not verified

- Whether 5dfeb49b's core (-50.1, 9.3, -7.7), radius 20 m, lies on the skull: no coordinates of the skull are known to
  this lane (a drawn look in stage A3 or the acceptance can show it). Kind labels are a person's reading of the catalogue
  notes, not the owner's check.

- No person, phone or real controller took part; no page was opened (gen4b wires planCourse into the worker).

- Audit run 6 (evidence/2026-11-19/gen4/place.json) FAILs 12 of 216 plans, left as they are:
  (a) gates 6: a course under the level's gatesMin at the level's own opening, after the whole opening ladder and 3 walk
  seeds per tier were tried with the quality rule kept (G3 wins over the count: the tiers that drop the quality rule are
  walked only when no course at all was laid). Wroclaw 70b50d42 beginner seed 3 (compact and wide): 2 gates of 5;
  Laval eb5f51dc medium seeds 2 and 3 (compact and wide): 6 gates of 8. Every one is closed, inside, on good tiles,
  server ok. The pilot gets a short course, not a refusal; another seed gives a full one (seeds 1-2 / 1 pass).
  (b) nearCore 6: 39e63ce9 (the CC BY fixture, kind room) compact medium and pro, seeds 1-3: the start is 3.7-7.4 m from a
  core of radius 3.2 m. The compact ask kept under gatesMin in the core's zone and was laid over the whole room (A2's
  designed fallback: 'a bare room's core is a corner'); the start is then the zone cell nearest the core. Not measured:
  whether any whoop-gate cell under the ceiling lies within 3.2 m of that core (a free-space trace of the compact ask).
- The kept kind rule for cityAbove and plants (9076951a) has no synthetic-world unit test; the audit rows of Lublin
  (cityLow) and Winter Garden (room) are its proof.
- The Save of a whoop course flown over x5.6 is refused by the format's gate-size rule (For the lead); not tested here
  past validateServerTrack.

## For the lead

- Files outside the owned list: packages/tracks/test/scan-worlds.ts (new: the four synthetic scans shared by scan.test.ts
  and plan.test.ts; worlds.ts itself is not touched; A2 gave the skull and plant worlds air above them, 2 m and 1.5 m).
- The track format checks a gate's size in SCENE units (format.ts shape: side/diameter >= 0.05, bar/tube >= 0.005;
  apps/api/tracks.py line ~211 the same), while legs are checked in flown m (x transform scale). A 65 mm whoop's 4 D
  square is 0.34 m with a 0.028 m bar flown: at a Scene size over x5.6 its bar, over x6.8 its side, is under the limit, so
  the Save refuses every whoop course on the skull flown at x15 (the owner's G1 case). Need (format owner + API deploy):
  check sizes as size x transform[0] in both files. Not changed here (not this lane's files).
- LEVELS.elements is read only as on/off (beginner: none; medium and pro: elements.ts's own draw of all kinds):
  composeElements takes no kind list and elements.ts is not this lane's file. Need: a `kinds` filter in ComposeInput.
- generate.ts changes beyond the option: none on the old path (place absent: every line as before; the g1 tests green
  unchanged). Inside the option: the zone filter, the start nearest the core, reachM, climbMax, closeAt, maxGates and
  the composed elements' zone check.
- Live checks after deploy: none of this lane's own (no page); gen4b's acceptance probe (gen4-accept-probe.mjs) covers
  the dialog that calls planCourse.
- Differences from the design: ScanAnalysis has one more field, `measures` (ScanMeasures: what the kind was decided by),
  so the audit can show it; gen4b does not read it.
- Deploy order: page only (packages/tracks is bundled into the page and its worker).

## Cost notes

- A3 (run 4, done): about 8 replies; the gates found the architecture rule's DOM regex on a comment's word 'window'.
  Cheaper: run `node scripts/check-architecture.mjs` (1 s) right after any comment edit in packages/tracks.

- A3 (run 3, left): about 60 replies; most went to a wrong first cause for Winter Garden (coarse cells): a box change
  'fixed' it by moving the cell grid. Cheaper: trace the zone predicate at the stored gate position and the walk's
  WalkInfo FIRST (env-gated lines), before changing a size; wait on the 20-minute audit with one until-loop.
- A3 (run 2, left): about 50 replies; most went to Wroclaw beginner (toggling one change at a time on a 15 s trace, then
  a direct run on run 1's files). Cheaper: when a fix regresses a scan, run the old commit's files on it FIRST (git show
  into place, one trace) and diff the walk info, before toggling suspects one by one.

- A3 (run 1, left): about 50 replies; most went to the synthetic no-room world (a pocket under 1 m x unit is no
  territory; the free box cut at the footprint made it 'badly scanned') and to waiting on the 216-plan audit (30-60 s a
  plan on the 1 km scans). Cheaper: run the audit per scene with --scenes in the background from the start and trace
  free.stats with an env-gated line at once; never wait in 10 s loops longer than 9 minutes.

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
