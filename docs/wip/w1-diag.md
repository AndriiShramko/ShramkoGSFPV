# w1-diag (train 5): diagnosis of the course generator's place

Lane prompt: the lead's W1 (docs/wip/train5-lead.md). Diagnosis document: C:/dev/.gsfpv-lanes/designs/w1-diag.md.
Temp folder: U:/Temp/gsfpv-train4/w1-diag. Ports 7340-7359. No generator or page code is changed in this lane.

## Status

- [x] S1 points 1 and 2: Rule and History in the diagnosis document (reading and git only)
- [ ] S2 point 3: the measuring script in tools/bench, the table file, the pictures from above
- [ ] S3 points 4 to 7: the cause with a negative control, n-route / n-path, the design proposal, the test system, For the lead

S1 findings, in short: the asked course (planCourse, packages/tracks/src/plan.ts:336) starts its walk at the scan
analysis' `core` (plan.ts:311 startOf; scan.ts:317-349), the window richest in voxel roughness (solid runs per column
plus surface steps). The spawn (the author's camera, session/index.ts:468 findSpawn) is sent to the worker but never
read by planCourse. The release of 2026-11-16 (efd17add) grew every course from the spawn (qualityBounds(quality,
spawn), flood and walk from the spawn). The change went live with car 3 (72d4babf, 2026-11-21); cars 1, 2 and 5 did
not touch the generator.

## What the owner does

Nothing in this lane: it changes no page. He reads the diagnosis document and the one picture named under For the lead.

## Claims

1. The live asked course ignores the spawn: `grep -n spawn packages/tracks/src/plan.ts` shows no read of `input.spawn`
   (result 2026-11-26: two hits, both a local parameter name).
2. Only car 3 changed the generator after 2026-11-16: `git log --oneline efd17add..72d4babf -- packages/tracks/src/plan.ts packages/tracks/src/scan.ts`
   (result: 35 commits on the tracks folder, all gen4a, gen4b, gap-gen; car 1 and car 2 only editor commits).

## Not verified

- S1 is reading and git only: the claim that the core lies in the outskirts is a hypothesis until S2 measures it.
- No person, phone or real controller took part.

## For the lead

(S3)

## Cost notes

- S1: about 20 replies; most went to tracing the anchor through plan.ts and scan.ts. A one-line agent-map entry for the
  generator chain (dialog -> worker -> planCourse -> analyzeScan.core) would have saved half.
