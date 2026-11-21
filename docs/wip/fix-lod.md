# fix-lod: detail and loading speed on big streamed scans (train 4)

Question: since the last two releases (car 2 267923c3, engine 852821e5) does a pilot on Lublin
(2f1ddf5f) see less detail or wait longer, or does the live check pause-rise-lublin measure at the
wrong moment when the scan reveals late?

## Status

- [x] S0 the copy: branch fix-lod from origin/main 511a44cb, packages/sonic-fpv at its pin 53a56759, pnpm install (playcanvas 2.24.2)
- [x] S1 builds B = 267923c3 and C = 852821e5 in U:/Temp/gsfpv-train4/fix-lod, two pauserise runs each against serve-csp, one picture a build, answer with numbers (below, "S1 answer")
  - [x] builds: worktrees U:/Temp/gsfpv-train4/fix-lod/wB (267923c3, playcanvas 2.23.2, splat-transform 3.6.4) and wC (852821e5, 2.24.2, 3.12.0), each `node scripts/build-release.mjs` + walls; B and C differ only in the two engine pins (`git diff --stat 267923c3 852821e5 -- packages apps scripts`: 3 files, package.json x2 and lod.test.ts)
  - [x] the four runs B1 C1 B2 C2 (U:/Temp/gsfpv-train4/fix-lod/runs.sh, judge.cjs = the pauserise judge), the two pictures; evidence/2026-11-19/fix-lod/s1-pauserise-b-c.json
- [x] S2 the repair of the check and its proof (commits 8630e106 and the S2 closing commit); gates once (--only for what was touched); clean tree
  - [x] tools/bench/scripts/loadq-probe.mjs (+ loadq-hold.mjs, test tools/bench/test/loadq-hold.test.ts, NEG OK): a switch AT=x,y,z (absolute held place; the pose of the passing 2026-11-16 run, [146.5, 202, -97], yaw -86.6, pitch -35) so the check no longer depends on where the page starts the craft; areaWanted null when the engine has no `optimalLod` (2.24 removed it: the field silently repeated areaLevel)
  - [x] deploy/live-checks.sh pauserise: use AT; the pass rule unchanged; its line now names the scan's best 5 s download rate and says "not judged" under 3 MB/s (test: the judge on four synthetic runs, NEG OK against 8630e106)
  - [x] proof: one run against the live site (read only) with the pinned place: it FAILS (0.49 M in the flight, 0.81 M in the pause), because the line delivered 0.61 MB/s; see "S2 answer". A passing proof needs a line of about 14 MB/s (the 2026-11-16 run): not available on this PC today
  - [x] the worktrees wB, wC removed (`git worktree remove --force`), their dist folders with them; evidence/2026-11-19/fix-lod/s2-live-at-and-line.json; gates

## S1 answer

Neither engine nor car 2: the check now flies over a different place. Not (1): B and C draw the same at the
same budget and look the same. Not a loss for pilots: the check's place moved with car 1.

| run | build | reveal s | flight drawn (10-25 s after reveal, min..max) | pause drawn | after Continue | files/s | held place |
|---|---|---|---|---|---|---|---|
| B1 | 267923c3, 2.23.2 | 12.6 | 234 063..668 704 | 937 613 | 937 613, 1 063 089, 1 074 992 | 10.3 | [92.4, 153.7, -104] |
| B2 | 267923c3, 2.23.2 | 7.5 | 170 551..270 203 | 595 072 | 595 072, 609 116, 773 582 | 10.0 | same |
| C1 | 852821e5, 2.24.2 | 16.6 | 221 429..466 175 | 727 463 | 727 463, 742 974, 790 532 | 13.1 | same |
| C2 | 852821e5, 2.24.2 | 9.5 | 221 429..505 776 | 900 710 | 932 342, 948 003, 948 003 | 15.1 | same |
| live 2026-11-16 (7af2aad5, pass) | 2.23.x | 26.0 | 2 446 023 | 9 854 257 | 9.85, 8.94, 4.85 M | | [146.5, 202, -97] |

- All four local runs fail the pauserise judge on the same step as the live site today: the count after Continue
  rises, because the pause never draws more than the flight budget of 2.5 M (it draws under 1.1 M at a 10 M budget).
- B is as low as C, so the engine (852821e5) did not bring it. The C build asks more files (979, 998 against
  712, 651) and loads them faster (13-15 files/s against 10), with none left pending at the end (B: 20-33).
- The held place differs: the probe holds the camera 140 m above the craft's start. Since car 1 (release
  aa18f1e4 of 2026-11-19; commit 675cdf5d, tails4 T2, `placeStart` in packages/collision/src/start.ts, already in
  ac11d2c2) an overview camera no longer is the start: Lublin's 62 m overview start moves down its line onto the
  ground (the doc comment of start.ts names 2f1ddf5f). So "140 m up" is now [92.4, 153.7, -104], not
  [146.5, 202, -97]; that view stays at LOD level 8-9 (areaLevel) where the old one reached 6.8 in the flight
  and 4.8 in the pause, and only about 14-25 MB of files are wanted there instead of 75-290 MB.
- The live reveal of 45 s is not a regression: the passing run of 2026-11-16 revealed at 26 s, its first run at
  56.5 s (U:/Temp/gsfpv-train3/live-7af2aad5-r2); local builds reveal at 7.5-16.6 s on the same CDN.
- Pictures (U:/Temp/gsfpv-train4/shots/fix-lod-B-pause.png, fix-lod-C-pause.png, 40 s after the reveal, in the
  pause): the same oblique view over Lublin's old town and cathedral, the same roofs and the same blur at the
  edge; C is not coarser than B.
- The probe's areaWanted is not comparable across engines: playcanvas 2.24 has no `optimalLod` field
  (`grep -c optimalLod` in its build: 0, in 2.23.2: 16), so for C it repeats areaLevel. No product code reads it.
- The car 2 commits did not touch where the craft starts or how files stream (session/index.ts diff since 7af2aad5:
  only the cancel plumbing and placeStart from car 1).

## S2 answer

The held place was only half the story. With the pinned place (AT 146.5,202,-97, yaw -86.6) the live site still
fails today: reveal 44.1 s, flight 489 748, pause 806 647, after Continue 806 647 x3; 981 files, 27.4 MB. The same
place on 2026-11-16 had 75 MB loaded and 2.45 M drawn 4.3 s after the reveal. The difference is this PC's line:

| run | scan download, best 5 s | result |
|---|---|---|
| live 2026-11-16, 7af2aad5 (passing) | 14.05 MB/s | pass |
| live 2026-11-21 12:35, 852821e5 (ship-car0 r2) | 0.69 MB/s | fail |
| local B1 267923c3 / C2 852821e5 (S1) | 0.71 / 0.70 MB/s | fail / fail |
| live 2026-11-21, pinned place (S2) | 0.61 MB/s | fail |

A Cloudflare download test from this PC during the stage: 20 MB in 36.5 s (0.55 MB/s); Lublin's lod-meta.json from the
scan CDN: 0.60 MB/s. About 15 lanes of train 4 share the line (the S1 install read 39 KiB/s from the registry). At
0.6 MB/s the scan cannot bring the pause's detail within the check's 20 s, whatever the engine; the 45 s reveal is
the page's own files at that rate too. So: answer (3) in substance. The page is fine, and B and C draw the same on the
same line. The check measured this PC's line and, since car 1, a different place. Repair: the check holds its passing
run's place and its line says when the line was too slow to judge; the pass rule is as strict as before.

Picture U:/Temp/gsfpv-train4/shots/fix-lod-live-AT-pause.png (live, pinned place, 40 s after the reveal, in the pause):
the wide oblique view over Lublin's old town and cathedral, as in the passing run; the roofs are readable, the near
edge still soft while files arrive.

## What the owner does

Nothing on the page: no page change in this lane. What changes is the live check pause-rise-lublin: after the next
release its line ends with "scan MB/s best 5 s <rate>", and when the line was too slow it adds "FAIL, not judged: the
line was too slow to load the scan (under 3 MB/s); run again on a faster line". Then run it again when no other
downloads run on the PC (`LIVE_ONLY=pause-rise-lublin bash deploy/live-checks.sh <outdir>`).

## Claims

1. On the same line and the same place, release 852821e5 (playcanvas 2.24.2) draws as many splats as 267923c3
   (2.23.2) on Lublin and is not coarser. Proof: `sh U:/Temp/gsfpv-train4/fix-lod/runs.sh` under the GPU lock; last
   result evidence/2026-11-19/fix-lod/s1-pauserise-b-c.json (B 0.60-0.94 M, C 0.73-0.90 M in the pause).
2. Every failed pause-rise-lublin run had a scan download of 0.6-0.7 MB/s; the passing run of 2026-11-16 had 14 MB/s.
   Proof: the pauserise judge of this branch on the five result files (S2 answer table); last result in
   evidence/2026-11-19/fix-lod/s2-live-at-and-line.json.
3. The check holds the passing run's place whatever the page's start, and its judge keeps its pass rule and names a
   slow line. Proof: `npx vitest run tools/bench/test/loadq-hold.test.ts`; last result 5 passed; neg_control NEG OK
   against origin/main (all three files) and against 8630e106 (deploy/live-checks.sh).

## Not verified

- No person, phone, weak device or real controller took part; the weak class is emulated (deviceClass=desktop-weak)
  on this PC's RTX 4090, headless.
- No passing run of the repaired check: this PC's line gave 0.55-0.7 MB/s all stage; the claim that the pinned place
  passes on a fast line rests on the 2026-11-16 run at the same pose (14 MB/s, 2.45 M then 9.85 M).
- Whether pilots on slow lines wait longer than before: not measured on a fast line for C; on the same slow line B and
  C were alike (S1).
- The pilot's own view at the new start (1.5 m over the ground) was not measured for detail; it is car 1's
  deliberate start, not this lane's question.
- Other big streamed scans were not measured.

## For the lead

- Answer: no loss for pilots. B (267923c3) and C (852821e5) draw alike on the same line (pause 0.60-0.94 M against
  0.73-0.90 M). Every failed run downloaded at 0.6-0.7 MB/s; the 2026-11-16 pass downloaded at 14 MB/s. The check
  measured this PC's crowded line, and since car 1 a moved place.
- Pilots on the live site today: not worse off on Lublin or on any scan this lane measured. Not measured: other big
  streamed scans on a fast line.
- Files changed (all outside product code): tools/bench/scripts/loadq-hold.mjs (new), tools/bench/scripts/loadq-probe.mjs,
  tools/bench/test/loadq-hold.test.ts (new), deploy/live-checks.sh (pauserise), evidence/2026-11-19/fix-lod/*.json,
  docs/wip/fix-lod.md.
- Release: nothing to deploy for pilots (no page, API, rooms, nginx or sound-package change); merge for the check.
  Live check to run after a release, on a quiet line: pause-rise-lublin. If it says "not judged", the line was slow,
  not the page.

## Cost notes

- S0: 6 replies; nothing costly.
- S1: about 35 replies; the C install failed twice on a slow registry (two parallel installs, then 39 KiB/s), a
  sequential install with `--fetch-timeout 900000 --network-concurrency 4` worked. Cheaper: install worktrees one
  at a time; compare the `hold` pose of a failing run with the last passing run before building anything.
- S2: about 35 replies; the S1 hypothesis (the place alone) failed on the live run, and the line speed was found only
  then. Cheaper: measure the line (one curl of a 20 MB file) before any drawn run, and compare MB per second of the
  scan with the last passing run first.

