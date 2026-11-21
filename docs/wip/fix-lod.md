# fix-lod: detail and loading speed on big streamed scans (train 4)

Question: since the last two releases (car 2 267923c3, engine 852821e5) does a pilot on Lublin
(2f1ddf5f) see less detail or wait longer, or does the live check pause-rise-lublin measure at the
wrong moment when the scan reveals late?

## Status

- [x] S0 the copy: branch fix-lod from origin/main 511a44cb, packages/sonic-fpv at its pin 53a56759, pnpm install (playcanvas 2.24.2)
- [ ] S1 builds B = 267923c3 and C = 852821e5 in U:/Temp/gsfpv-train4/fix-lod, two pauserise runs each against serve-csp, one picture a build, answer (1), (2) or (3) with numbers
  - [x] builds: worktrees U:/Temp/gsfpv-train4/fix-lod/wB (267923c3, playcanvas 2.23.2, splat-transform 3.6.4) and wC (852821e5, 2.24.2, 3.12.0), each `node scripts/build-release.mjs` + walls; B and C differ only in the two engine pins (`git diff --stat 267923c3 852821e5 -- packages apps scripts`: 3 files, package.json x2 and lod.test.ts)
  - [ ] the four runs B1 C1 B2 C2 (U:/Temp/gsfpv-train4/fix-lod/runs.sh, judge.cjs = the pauserise judge) and the two pictures
- [ ] S2 the repair and its proof; gates once (--only for what was touched); clean tree

## What the owner does

(filled in S2)

## Claims

(filled in S1 and S2)

## Not verified

(filled in S1 and S2)

## For the lead

(filled in S2)

## Cost notes

- S0: 6 replies; nothing costly.
