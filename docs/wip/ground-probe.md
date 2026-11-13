# Lane ground-rc2, stage G1-ground-probe-cheap

Branch `ground-probe` from origin/main bbc9e75e. Worktree C:/dev/gsfpv-train1-base. Ports 5620-5639.
Logs and JSON of the runs: U:/Temp/gsfpv-train1c/ground-rc2/ (not in git).

## Status

- [x] 1. Measured first (script `tools/bench/src/ground-probe-cost.ts`, numbers under "Measured, old code").
- [ ] 2. Cost bound by design: (a) the sweep in pieces, (b) GroundCache. Old against new on a grid.
- [ ] 3. centre-throttle-probe.mjs on the local release (dji-centred, dji-flip, dji-bottom), a6-reference hash.
- [ ] 4. Probe "fast radio" (500 and 1000 reports a second for 20 s), negative control on a build of origin/main.
- [ ] 5. Unit tests for the cache and the cheap query, each with a negative control.

## Measured, old code (origin/main bbc9e75e)

Command: `node node_modules/tsx/dist/cli.mjs tools/bench/src/ground-probe-cost.ts <out.json>` (Node v22, this PC, scene
887f27aa, 5 cm voxels, 12 ground points around the spawn, body bottom 0.03 m). Output kept in
U:/Temp/gsfpv-train1c/ground-rc2/cost-old.json.

Milliseconds per groundClearance call (one 20 m sweep), by height above the ground:

| height m | p50 | p95 | max |
|---|---|---|---|
| 0.3 | 83.1 | 139.4 | 141.2 |
| 1 | 63.8 | 138.3 | 139.8 |
| 3 | 48.7 | 187.3 | 190.8 |
| 6.67 | 9.1 | 139.2 | 261.0 |
| 10 | 1.2 | 105.9 | 363.4 |
| 20 | 1.6 | 253.1 | 415.0 |

At 10 and 20 m only 4 of the 12 points see the ground at that height (the others have something in between).

Looks per second with the real CentrePilot (angle mode, sticks at rest) fed reports on the real clock, one thread
(a model of the page's input handler in Node: no rendering in it):

| height m | reports/s | looks/s | share of time in looks | reports handled/s |
|---|---|---|---|---|
| 1 | 60 | 14.6 | 0.990 | 14.6 |
| 1 | 125 | 14.5 | 0.995 | 14.5 |
| 1 | 250 | 13.8 | 0.997 | 13.8 |
| 1 | 500 | 14.2 | 0.998 | 14.2 |
| 1 | 1000 | 14.7 | 0.999 | 14.7 |
| 6.67 | 60 | 6.9 | 0.991 | 6.9 |
| 6.67 | 125 | 6.7 | 0.996 | 6.7 |
| 6.67 | 250 | 6.6 | 0.998 | 6.6 |
| 6.67 | 500 | 6.9 | 0.999 | 6.9 |
| 6.67 | 1000 | 6.9 | 0.999 | 6.9 |

Reading: a look takes longer than the 33 ms limit and longer than the gap between two reports even at 60 reports a
second, so every report that gets handled makes a look and the handler takes 99 % of the thread at every rate.

The same sweep cut into pieces with an early exit, ms per call over all heights and points (part "pieces"):

| piece m | p50 | p95 | max |
|---|---|---|---|
| 0.1 | 0.204 | 1.049 | 3.590 |
| 0.25 | 0.309 | 1.476 | 5.063 |
| 0.5 | 0.324 | 1.900 | 6.223 |
| 1 | 0.282 | 3.936 | 9.101 |
| 2 | 0.139 | 4.254 | 31.306 |

## Decisions

## Not verified

## Cost notes
