# w1-diag (train 5): diagnosis of the course generator's place

Lane prompt: the lead's W1 (docs/wip/train5-lead.md). Diagnosis document: C:/dev/.gsfpv-lanes/designs/w1-diag.md.
Temp folder: U:/Temp/gsfpv-train4/w1-diag. Ports 7340-7359. No generator or page code is changed in this lane.

## Status

- [x] S1 points 1 and 2: Rule and History in the diagnosis document (reading and git only), d8b72bcb
- [x] S2 point 3: tools/bench/src/w1-diag-measure.ts (2bf4cb38, frame fix in the S2 closing commit); run
  U:/Temp/gsfpv-train4/w1-diag/run1 (table.tsv, summary.json, top-<id>.png, all five looked at); numbers and one
  phrase per picture in the document's 'Measurement'
- [ ] S3 points 4 to 7: the cause with a negative control (scratch copy U:/Temp/gsfpv-train4/w1-diag/neg, plan.ts: `a.core` := the spawn; script version `neg`; run neg-run started on eb5f51dc, 2f1ddf5f and 887f27aa as the unmoved control); then n-route / n-path,
  startOf -> the spawn; rerun w1-diag-measure on eb5f51dc and 2f1ddf5f), n-route / n-path, the design proposal, the
  test system, For the lead

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

## Not verified

- S1 is reading and git only; S2 measured that the core lies in a poorly scanned place on 2 of 5 scans (wide, Lublin),
  that it is the CAUSE waits for the S3 negative control.
- 'Well scanned' is splat opacity mass per tile column; on Lublin (coarse LOD 5) the frame check is inconclusive (0.08
  against 0.01), so its ranks are weak. Wroclaw is read at LOD 2.
- The old generator ran on today's collision and sonic-fpv packages (the pin moved from 293ebae to 53a5675), not the
  exact bytes of 2026-11-16; levels did not exist then, so old = 3 courses a scan.
- Legs through walls are straight lines between gate centres, not the flown path. Plans in Node, not in the page worker.
- No person, phone or real controller took part.

## For the lead

(S3)

## Cost notes

- S1: about 20 replies; most went to tracing the anchor through plan.ts and scan.ts. A one-line agent-map entry for the
  generator chain (dialog -> worker -> planCourse -> analyzeScan.core) would have saved half.
- S2: about 35 replies; most went to running the old generator from a temp extract (pnpm's relative links need three
  junctions) and to the splat frame (the data table is (-x, -y, z) of the flown walls for every scan, found by the
  on-walls check). A bench helper 'splats in the flown frame' would save both next time.
