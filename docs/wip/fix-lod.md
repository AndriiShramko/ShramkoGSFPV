# fix-lod: detail and loading speed on big streamed scans (train 4)

Question: since the last two releases (car 2 267923c3, engine 852821e5) does a pilot on Lublin
(2f1ddf5f) see less detail or wait longer, or does the live check pause-rise-lublin measure at the
wrong moment when the scan reveals late?

## Status

- [x] S0 the copy: branch fix-lod from origin/main 511a44cb, packages/sonic-fpv at its pin 53a56759, pnpm install (playcanvas 2.24.2)
- [x] S1 builds B = 267923c3 and C = 852821e5 in U:/Temp/gsfpv-train4/fix-lod, two pauserise runs each against serve-csp, one picture a build, answer with numbers (below, "S1 answer")
  - [x] builds: worktrees U:/Temp/gsfpv-train4/fix-lod/wB (267923c3, playcanvas 2.23.2, splat-transform 3.6.4) and wC (852821e5, 2.24.2, 3.12.0), each `node scripts/build-release.mjs` + walls; B and C differ only in the two engine pins (`git diff --stat 267923c3 852821e5 -- packages apps scripts`: 3 files, package.json x2 and lod.test.ts)
  - [x] the four runs B1 C1 B2 C2 (U:/Temp/gsfpv-train4/fix-lod/runs.sh, judge.cjs = the pauserise judge), the two pictures; evidence/2026-11-19/fix-lod/s1-pauserise-b-c.json
- [ ] S2 the repair of the check and its proof; gates once (--only for what was touched); clean tree. Plan:
  - [ ] tools/bench/scripts/loadq-probe.mjs: a switch AT=x,y,z (absolute held place; the pose of the passing 2026-11-16 run, [146.5, 202, -97], yaw -86.6, pitch -35) so the check no longer depends on where the page starts the craft; areaWanted null when the engine has no `optimalLod` (2.24 removed it: the field silently repeated areaLevel)
  - [ ] deploy/live-checks.sh pauserise: use AT, the judge unchanged (as strict)
  - [ ] proof: one run against the live site (read only) passes; the old arguments failed there twice today (the negative control)
  - [ ] the worktrees wB, wC removed (`git worktree remove`) and their dist folders gone; gates; For the lead

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

## What the owner does

Nothing for this lane: no page change. (Filled in S2.)

## Claims

1. On the same place and budget, release 852821e5 (playcanvas 2.24.2) draws as many splats as 267923c3 (2.23.2)
   on Lublin and loads its files faster. Proof: `sh U:/Temp/gsfpv-train4/fix-lod/runs.sh` under the GPU lock;
   last result in evidence/2026-11-19/fix-lod/s1-pauserise-b-c.json (table above).
2. pause-rise-lublin fails today because the held place moved with car 1's placeStart, not because of the engine or
   car 2. Proof: the `hold` field of the four runs against the 2026-11-16 run in the same evidence file. (S2 proves it
   with the pinned place on the live site.)

## Not verified

- No person, phone, weak device or real controller took part; the weak class is emulated (deviceClass=desktop-weak)
  on this PC's RTX 4090, headless.
- The pilot's own view at the new start (1.5 m over the ground) was not measured for detail; it is car 1's
  deliberate start, not this lane's question.
- Other big streamed scans were not measured; the cause found is per check (the held place), not per engine.

## For the lead

(filled in S2)

## Cost notes

- S0: 6 replies; nothing costly.
- S1: about 35 replies; the C install failed twice on a slow registry (two parallel installs, then 39 KiB/s), a
  sequential install with `--fetch-timeout 900000 --network-concurrency 4` worked. Cheaper: install worktrees one
  at a time; compare the `hold` pose of a failing run with the last passing run before building anything.
