# w1-diag (train 5): diagnosis of the course generator's place

Lane prompt: the lead's W1 (docs/wip/train5-lead.md). Diagnosis document: C:/dev/.gsfpv-lanes/designs/w1-diag.md.
Temp folder: U:/Temp/gsfpv-train4/w1-diag. Ports 7340-7359. No generator or page code is changed in this lane.

## Status

- [x] S1 points 1 and 2: Rule and History in the diagnosis document (reading and git only), d8b72bcb
- [x] S2 point 3: tools/bench/src/w1-diag-measure.ts (2bf4cb38, frame fix in the S2 closing commit); run
  U:/Temp/gsfpv-train4/w1-diag/run1 (table.tsv, summary.json, top-<id>.png, all five looked at); numbers and one
  phrase per picture in the document's 'Measurement'
- [x] S3 points 4 to 7 (7650f17a script version `neg`; closing commit 'w1-diag S3: cause proven'): negative control
  in the scratch copy U:/Temp/gsfpv-train4/w1-diag/neg (plan.ts, one change: `a.core` := the spawn), run
  U:/Temp/gsfpv-train4/w1-diag/neg-run on eb5f51dc, 2f1ddf5f and 887f27aa (the near-core control); n-route / n-path
  read; design proposal and test system in the document; For the lead below; evidence/2026-11-19/w1-diag/*.json

S1 findings, in short: the asked course (planCourse, packages/tracks/src/plan.ts:336) starts its walk at the scan
analysis' `core` (plan.ts:311 startOf; scan.ts:317-349), the window richest in voxel roughness (solid runs per column
plus surface steps). The spawn (the author's camera, session/index.ts:468 findSpawn) is sent to the worker but never
read by planCourse. The release of 2026-11-16 (efd17add) grew every course from the spawn (qualityBounds(quality,
spawn), flood and walk from the spawn). The change went live with car 3 (72d4babf, 2026-11-21); cars 1, 2 and 5 did
not touch the generator.

S2 findings, in short (5 scans, 90 live + 15 old courses, density from the splats, not from the generator): the live
anchor `a.core` lies 485 m from the author's camera on the wide scan eb5f51dc at splat-density rank 0.00 (camera 1.00),
454 m on Lublin; every live course there starts at the core whatever the seed or level (gate 1 539-541 m from the
spawn), mean gate rank 0.50 against 0.99 for the 2026-11-16 generator. Where the core is near the camera (Tunis 25 m,
the room 5 m) both versions lay in the good part. 0 refusals, 0 hangs, 0 gates in walls.

## What the owner does

Nothing in this lane: it changes no page. He reads the diagnosis document and the one picture named under For the lead.

## Claims

1. The live asked course ignores the spawn: `grep -n spawn packages/tracks/src/plan.ts` shows no read of `input.spawn`
   (result 2026-11-26: two hits, both a local parameter name).
2. Only car 3 changed the generator after 2026-11-16: `git log --oneline efd17add..72d4babf -- packages/tracks/src/plan.ts packages/tracks/src/scan.ts`
   (result: 35 commits on the tracks folder, all gen4a, gen4b, gap-gen; car 1 and car 2 only editor commits).

3. On the wide scan the live course starts far from the author's camera in a poorly scanned place, the old one at the
   camera: `cd tools/bench && npx tsx src/w1-diag-measure.ts --scenes eb5f51dc --out <dir>` (result 2026-11-26:
   live meanRank 0.50, medGate1ToStartM 540.63, coreRank 0; old meanRank 0.99, medGate1ToStartM 8.38).
4. The anchor `a.core` is the cause: the same planCourse with only `a.core` := the spawn (scratch copy
   U:/Temp/gsfpv-train4/w1-diag/neg) lays the far-core scans in the good part, the near-core scan barely moves:
   `cd tools/bench && npx tsx src/w1-diag-measure.ts --scenes eb5f51dc,2f1ddf5f,887f27aa --versions neg --out <dir>`
   then `--versions live,old,neg --report-only` (result 2026-11-26: meanRank live -> neg eb5f51dc 0.50 -> 0.99,
   2f1ddf5f 0.62 -> 0.96, 887f27aa 0.89 -> 0.92; median gate1 to spawn 540.6 -> 2.1 m, 453.5 -> 4.2 m, 34.2 -> 4.0 m;
   refusals 0, hangs 0; evidence/2026-11-19/w1-diag/neg-control-summary.json).

## Not verified

- n-route making it worse is by reading its diff only (its copy was not run). That the roughness quality map ranks
  badly captured tiles high is shown for the core (eb5f51dc core rank 0.00) and by live gates passing the filter at rank
  0.14-0.67, not by a tile-by-tile correlation of the map against the splat density.
- The proposed repairs (R1 to R3) are not built or measured beyond the scratch-copy anchor switch.
- Gates (gates.py, 2026-11-26): architecture, i18n, leaks PASS; tools/bench typecheck PASS. typecheck (apps/fly
  src/sonic) and vitest (14 failed, all import @shramko/sonic-fpv: sonic-*, size-flown) FAIL because this copy's
  submodule work tree is at 53a5675 while origin/main pins 9ac7876, which its local remote (C:/dev/gsfpv-t7-base) does
  not hold; this lane's diff against origin/main (4 files: the bench script, this note, 2 evidence JSON) is imported by
  no test. B18 FAIL only on docs/wip/train5-lead.md (the lead's note on origin/main has Cyrillic); this lane's files pass.
  The S1 commit 4c8edc2d had recorded that stale pin by mistake; it is restored to 9ac7876 in a later commit.
- 'Well scanned' is splat opacity mass per tile column; on Lublin (coarse LOD 5) the frame check is inconclusive (0.08
  against 0.01), so its ranks are weak. Wroclaw is read at LOD 2.
- The old generator ran on today's collision and sonic-fpv packages (the pin moved from 293ebae to 53a5675), not the
  exact bytes of 2026-11-16; levels did not exist then, so old = 3 courses a scan.
- Legs through walls are straight lines between gate centres, not the flown path. Plans in Node, not in the page worker.
- No person, phone or real controller took part.

## For the lead

Cause: car 3 (72d4babf, 2026-11-21) made planCourse walk from `a.core`, the roughest window of the voxels
(scan.ts:317, plan.ts:311), and it never reads the spawn (the author's camera). On scans whose roughest place is a badly
captured fringe, every seed and level lands there; before, the course grew from the author's camera.
Proof (one change in a scratch copy, anchor := the spawn): eb5f51dc mean splat rank 0.50 -> 0.99 and gate 1 540 m ->
2 m from the camera; Lublin 0.62 -> 0.96; the near-core control Tunis 0.89 -> 0.92.
Open: U:/Temp/gsfpv-train4/shots/w1-diag-eb5f51dc-live-old-neg.png (left live in the dark field, middle old and right
neg on the bright scan at the camera). Document: C:/dev/.gsfpv-lanes/designs/w1-diag.md (Cause, Design, Test system).
Not proven: that n-route makes it worse (read only); a tile-by-tile check of the roughness map against splat density.
Lanes: R1 anchor = the pilot's place, link carries it (small, first); R2 dialog Here / Whole scan / Add here (medium,
after R1); R3 forbid map from the splats, quality stops attracting (large); n-route rebased on R1; gen-quality skill
from tools/bench/src/w1-diag-measure.ts (small). Files changed: tools/bench/src/w1-diag-measure.ts (new, bench only),
docs/wip/w1-diag.md, evidence/2026-11-19/w1-diag/*.json. Nothing to deploy. Gates: see Not verified (sonic pin of this copy).

## Cost notes

- S1: about 20 replies; most went to tracing the anchor through plan.ts and scan.ts. A one-line agent-map entry for the
  generator chain (dialog -> worker -> planCourse -> analyzeScan.core) would have saved half.
- S2: about 35 replies; most went to running the old generator from a temp extract (pnpm's relative links need three
  junctions) and to the splat frame (the data table is (-x, -y, z) of the flown walls for every scan, found by the
  on-walls check). A bench helper 'splats in the flown frame' would save both next time.
- S3: about 30 replies; most went to the scratch copy's pnpm links (two sibling junctions, as for the old extract) and to
  fitting the document in 150 lines. A bench option '--tracks <dir>' that sets up those junctions itself would save it.
- Review: about 25 replies; most went to the second scratch copy (junctions by hand, the script's NEG_ROOT edited and
  reverted to run it). A '--tracks <dir>' option on w1-diag-measure.ts would have made the alternative test one command.

## Review

Verdict: SHIP (independent check, 2026-11-26; full file U:/Temp/gsfpv-train4/reviews/w1-diag.md).
- PROVEN: the Shift+G chain ends in planCourse, which never reads the spawn and starts from a.core (plan.ts:311-344).
- PROVEN: the old extract is byte-identical to efd17add packages/tracks/src (16 files); the neg copy differs in one hunk.
- PROVEN with seed 7 (not used by the lane): eb5f51dc live 0.45 / 540.6 m -> neg 0.99 / 6.1 m (old 0.98 / 19.9 m);
  Wroclaw 70b50d42 (not in the lane's neg run) 0.82 / 47.7 m -> 0.96 / 9.2 m.
- PROVEN: the other candidate, the roughness quality filter, is not the cause: a.quality := 1 with a.core kept leaves
  eb5f51dc at 0.45 / 540.6 m (identical to live), Wroclaw 0.79 / 47.7 m.
- Side finding: on eb5f51dc the live gates lie 203 m below the core and 229 m below the camera (a floater layer).
- DOUBT: R3 (splat forbid map) does not follow from the proven cause; the old generator's 'sometimes not' is not
  reproduced; Lublin's ranks are weak (LOD 5); old ran with today's placeStart spawn.
