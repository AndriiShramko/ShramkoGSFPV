# Lane lod-view: the splat budget goes to what is in the frame

Branch `lod-view`, cut from `gpu-select` (43958c56) on the owner's laptop, 2026-11-13; pushed with the owner's word on
2026-11-14 (main untouched). A trial merge onto main 197c2760 has no conflicts.
Labels: [measured] on this laptop; [reference] read in code or documentation.
Raw files: `evidence/2026-11-13/lod-view/`: every run's JSON, and eight pictures (Lublin at 1 M, engine against product:
the 40 m place, looking down, after the 185 degree turn; Wroclaw at 4 M, the level view). The other pictures the JSON
files name, and the PNGs the scores are made from, stay on the laptop under `.cache/lod-view` (25 MB, not committed).

## The owner's request (translated, shortened)

"Lublin, 250 M splats: when I fly a little higher and see the whole scan, the quality is terrible, I suppose because of the
limit of splats per device. Spend the budget (700 k on a tablet, 1 M) on what is in the frame, do not load what is behind,
preload what is to the left and right so that a sharp turn finds it there. Is there anything like this in SuperSplat? If
not, who has it, which open projects? If nobody, build it. Stress-test on Lublin: the best quality in the frame, and no
emptiness when the drone turns fast left, right, up or down."

## Status

- [x] What exists elsewhere: read (section below).
- [x] The engine as it is, measured on Lublin from above the roofs (where the budget goes, pictures, turns).
- [x] Experiments in the live page (the probe replaces the engine's distance at run time): the frame's priority, the
  distance falloff, a look-ahead from the turn rate.
- [x] Product: `packages/render-pc/src/view-lod.ts`, wired into the renderer and the app, on by default, `?viewlod=0`
  switches it off; 33 unit tests; measured again as the product (the Vite dev server) against the same reference.
- [x] Gates on this branch, on the laptop: `pnpm -r typecheck`, the unit tests (296 files, 4586 tests: 4571 pass, 15 skipped,
  none fail; run again after the review's fix), `check-architecture`, `gen-catalog --check`, the site's `i18n:check` and B18 pass. The API's Python tests
  were not run again (no Python file changed since `gpu-select`, where they passed). The first full run caught two things
  this lane had to follow: the report's unit test (`tools/bench/test/app-lod.test.ts`) and the list of URL parameters
  (`packages/prefs/src/url.ts` gains `viewlod`).
- [x] Pushed on 2026-11-14 with the owner's word, then checked again against the engine's sources: the file priority sum
  and which end of it loads first, every reader of a node's distance (the budget balancer, the download rank, and the
  colour refresh of spherical harmonics, which only refreshes a node outside the frame less often), where `framerender`
  falls in the frame, the engine's own turn test, when the files' loader exists. One fault: the scan's multiplier followed
  the WISH for the frame's priority, not whether it was at work, so a rule that failed or could not run on the engine
  left multiplier 2 behind; now all three engine parameters follow `lodRule(active)`. Eight product values of the Lublin
  table were from an earlier run and are now those of `score-ref16-p1-off.json` (no conclusion changes). After the fix,
  in the page (Wroclaw at 1 M, `evidence/2026-11-14/lod-view/review-*.json`): with the rule at work the engine runs at
  penalty 1.001, angle 6 and multiplier 2; with `?viewlod=0` at 5, 90 and 3.
- [ ] Not done: a real phone or tablet; the lead's decision on the second engine-internals exception (render-pc's rule
  is the public engine API).

## What others do [reference, read 2026-11-13]

| Project | Licence | Rule |
|---|---|---|
| PlayCanvas engine up to 2.25 beta, SuperSplat viewer 1.43 | MIT | No rule for the frame. Camera direction counts only through `lodBehindPenalty` (nodes behind the camera plane); everything in front competes by distance alone, on screen or not. The viewer's own numbers: about 30 % of the budget outside the frame at penalty 5. A hook for a per-node rule was declined upstream (engine PR 8700). Downloads: tier, then the coarser level of the WHOLE scan, then nearest. |
| Spark 2 (World Labs, three.js) | MIT | A fixed budget filled best first by angular size times a weight that falls with the angle from the view axis (a cone, not the frame); coarse parents stand in for chunks not yet loaded; a resident pool several times the draw budget. A position prediction exists in the code and is switched off. |
| Babylon.js `GaussianSplattingStream` | Apache-2.0 | Streams the same `lod-meta.json`; nodes outside the frustum go to their coarsest level and stay drawn. |
| Aholo viewer, Babylon Lite | MIT, Apache-2.0 | Refine only nodes inside the frustum; Aholo unloads the rest and dropped its earlier outside and behind penalties. |
| CesiumJS (3D Tiles) | Apache-2.0 | No splat budget; requests ordered and deferred by the angle from the view axis, coarser error outside. |
| Gaussian Splat Lite | Apache-2.0 | Keeps the surroundings in the budget on purpose (ready for turns, at the cost of the view). |

Nobody found predicts from the turn rate (yaw rate); fast turns are covered elsewhere by a coarse layer that is always
there and by generous caches. So the frame's rule had to be built here, and the look-ahead is this lane's own.

## Facts (measured)

Scan Lublin `2f1ddf5f`: 258.95 M splats, 13 levels (each half the one before: level 8 is 1.01 M, level 12 is 0.06 M), 9534
nodes, 2076 files, about 1100 by 860 m. Camera: the scan's start place (already above the roofs), 40 m and 140 m higher
looking down 20 and 35 degrees, then turns from the 40 m place: yaw 95 and 185 degrees in one frame, pitch up and down, a
spin at 360 degrees/s. Lens 115 degrees horizontal, picture 2561x1238. Probe: `tools/bench/scripts/lod-view-probe.mjs`.

### Where the budget goes with the engine's rule

At 1 M (Intel chip, the weak device at hand), the whole city in the picture: 70 to 81 % of the drawn splats belong to nodes
in the frame. The level shown is about 8 everywhere (the budget IS level 8 of the whole scan): the picture is coarse
because the budget is small, not because it is wasted. Within the frame it is spread unevenly: at the 40 m place the 245
nodes within 100 m, about half of the picture, get 0.12 M splats; the 3434 nodes beyond 400 m, a few percent of it, get 0.09 M.

When the view leaves the city (the turns), the engine's rule wastes most of it: after the 185 degree turn 0.14 M of 0.97 M
drawn splats are in the frame; looking down, 0.22 M. Nodes behind are only about 1.5 levels coarser (penalty 5 at the
engine's distance multiplier 3), nodes beside the frame not coarser at all.

### The same budget spent by the frame: pictures scored against a 16 M reference

PSNR on luma over the scan's pixels, dB (higher is closer to the 16 M picture from the same place); NVIDIA card, sorted
drawing at full resolution in every run, so that only the choice of detail differs. `tools/bench/scripts/lod-view-score.mjs`,
files `score-ref16-*.json`. "Product" is this branch on the dev server; "engine" the same build with `?viewlod=0`, which
scores like the live site (19.10, 19.53, 19.16 at the three places).

| Picture | 1 M engine | 1 M product | 4 M engine | 4 M product |
|---|---|---|---|---|
| start place (whole city) | 19.09 | 19.29 | 22.91 | 23.17 |
| 40 m higher | 19.54 | 19.89 | 23.37 | 23.88 |
| 140 m higher | 19.16 | 19.09 | 23.02 | 22.87 |
| yaw 95: at once / after 1.5 s / settled | 18.14 | 19.00 / 19.49 / 19.49 | 21.47 | 22.72 / 23.53 / 23.53 |
| yaw 185: at once / after 1.5 s / settled | 18.86 | 20.21 / 20.99 / 20.99 | 21.46 | 23.30 / 23.58 / 24.49 |
| pitch down 35: at once / after 1.5 s / settled | 18.62 | 19.14 / 20.24 / 20.24 | 21.60 | 22.39 / 24.14 / 24.14 |

(The engine's pictures do not change after a turn: it keeps what it chose.) In splats: after the 185 degree turn the
product has 0.37 M of its 0.96 M in the frame against the engine's 0.14 M, and 1.38 M against 0.52 M at 4 M; looking
down, 0.41 M against 0.22 M. With the whole city in view the gain is small (87 % of the budget in the frame instead of
81 %), and at the highest place the picture is 0.1 dB further from the reference: the steeper falloff takes a little from
the far field.

Experiments before the product (the probe's own rule in the live page, `n1-*`, `n4-*`, `lublin-1m-*`):
- the frame's priority alone at the engine's multiplier 3 (ring 0.43 level, far out 2.5 levels): +0.1 to +0.3 dB with the
  whole city in view, +1.1 to +2.0 dB settled after turns;
- the distance falloff alone (multiplier 2 or 1.5, no frame rule): within 0.25 dB either way, and at 1.5 the far field
  starts to lose nodes (3 % of the picture empty);
- both, with a strong far factor (4 levels): the best settled pictures (+2.6 dB after yaw 185 at 1 M, +4.0 at 4 M) and
  the worst right after a snap turn (1.2 to 3.8 dB BELOW the engine for the first second or two). The product's values
  (0.5 and 3 levels) sit between the two, and with `lodUnderfillLimit` 2 and six parallel loads its pictures are above
  the engine's from the first moment after a turn.

### Street level (Wroclaw `70b50d42`, 43 M splats, 4 M budget)

The same score at the scan's start place (3 m above the ground), level view and 8 m up, against the product at 16 M from
the same places. At street level more of a scan is outside the frame, and the gain is larger than from above: 86 % of the
drawn splats are in the frame (3.35 M) against 67 % (2.61 M).

| Picture | engine | product |
|---|---|---|
| start place | 29.32 | 30.38 |
| level view | 28.71 | 31.19 |
| 8 m up, looking down 15 | 29.40 | 30.96 |
| yaw 95: at once / after 1.5 s / settled | 26.36 / 28.20 / 29.39 | 28.54 / 31.82 / 32.58 |
| yaw 185: at once / after 1.5 s / settled | 28.17 / 28.52 / 30.27 | 29.44 / 30.72 / 31.85 |
| pitch down: at once / settled | 29.10 / 29.10 | 31.13 / 32.76 |
| after the spin | 29.70 | 32.11 / 33.14 |

Frames at 4 M, card heat-soaked in both: 41.5 to 43 a second against 43.6 to 48.5 (more splats in the frame to draw).

### What loads first after the picture appears (Wroclaw, 4 M, the start place)

The owner's other complaint ("the far parts load at full detail first, what is near comes last"), in splats shown within
8 m of the camera and in the frame, by time after the reveal (`gpu-select-fly.mjs`; files `fly-wroclaw-*.json` here and
`tune-nvidia-base.json` of lane gpu-select for the live site):

| Seconds after the reveal | about 2 | about 3 | about 4 | about 6 | about 9 | settled |
|---|---|---|---|---|---|---|
| Live site (engine's rule and order, no underfill, 2 loads) | 0.01 M | 0.01 M | 0.01 M | 0.02 M | 0.64 M | 0.73 M |
| This build with `?viewlod=0` (engine's rule and order, underfill 2, 6 loads) | 0.01 M | 0.08 M | | 0.27 M | 0.64 M | 0.73 M |
| Product (the frame's priority, nearest first) | 0.09 M | 0.61 M | 1.00 M | 1.53 M | 1.57 M | 1.54 M |

On the live site the nodes outside the frame hold 1.26 M splats six seconds in, while the near field in the frame holds
0.02 M. The product gives the near field in the frame twice as many splats in the end (1.54 M against 0.73 M: the budget
that was outside the frame) and has 0.61 M of them there before three seconds are over. It fetches more for it (404 MB
against 304 MB) and everything is at its final level after 10.9 s against 8.9 s.

### Turns

- The product asks the engine for a new choice once the view has turned 6 degrees (at most every 50 ms) and widens the
  frame toward the turn by a quarter of a second of the present rate (at most 90 degrees). In the product runs: 62 and 63
  choices asked for over the whole turn sequence; its own part of a choice takes 0.8 to 1 ms for Lublin's 9534 nodes on
  this laptop's processor (the engine's own part 0.25 to 0.36 ms).
- No hole after any turn: the share of the picture covered by nodes that show nothing stays under 0.5 % right after each
  turn, as with the engine (those are nodes with no splats at coarse levels).
- Time until the new view is within a quarter of a level of its settled detail: already there at the first sample (about
  0.9 s after the turn, behind the turn's first picture) for yaw 95, pitch up and the stop of the spin; 1.3 to 1.5 s looking
  down; 2.3 s at 1 M and 3.8 s at 4 M for yaw 185, the slowest (61 and 82 files to fetch). During that time the picture is
  already above the engine's.
- Frames: with more splats in the frame the same budget costs a little more to draw (4 M, 40 m place: 37.6 frames/s
  against 39.5; start place 49.8 against 49.8; the NVIDIA card was heat-soaked in both). After the 185 degree turn the
  engine's picture runs faster only because it draws a third of the splats.
- On the Intel chip at 1 M (probe's rule): 25.8 frames/s against 26.5 at the 40 m place; during the spin 37.9 against 48.7.

## Product changes

- `packages/render-pc/src/view-lod.ts` (new): the frame's priority. It wraps the engine's
  `GSplatOctreeInstance.evaluateNodeDistances` (on the prototype, once), lets the engine compute its distances and
  multiplies the distance of every node outside the frame: nothing inside, half a level coarser at 25 degrees beyond the
  edge (the ring), three levels coarser from 80 degrees on and behind. Levels become a factor through the scan's own
  `lodMultiplier`. `tick()` once per frame follows the turn (axis and rate from the view axis), widens the frame toward
  it, and asks for a new choice (`world._lodUpdateRequested`, `markInstancesNeedLodUpdate`) after 6 degrees of turn, 12 of
  roll, or when a turn ends, at most every 50 ms. `viewLodMissing` names what an engine lacks; then nothing is installed.
  A fault inside switches it off for good and is reported; it never throws into the engine's update.
  The download order too: the engine's `requestFile` is called with another rank (`nearFirstRank`), so that its own sum,
  tier + (level + rank) / levels, comes out as "nearest first by the frame's distance" for a node's wanted level and for
  its next finer level alike, instead of "the coarser level of the whole scan first, a node's next level last". A node that
  shows nothing keeps the engine's order (coarse first fills holes).
- `packages/render-pc/src/renderer.ts`: makes the `ViewLod`, ticks it at `framerender` (after the engine's `update`,
  before its `render`, where the choice is made). The engine's parameters follow whether it is at work (`lodRule` in
  view-lod.ts): at work `lodBehindPenalty` 1.001 (ours covers "behind"; at 1 the engine stops looking at turns),
  `lodUpdateAngle` 6 and the scan's `lodMultiplier` 2; off, failed, or on an engine without the members, 5, 90 and 3 as
  before. New either way: `lodUnderfillLimit` 2 (was the engine's 0) and `setParallelLoads` (the loader's private
  `maxConcurrentLoads`, by name); also `setViewLod`, `viewLodStats`. The header names the second exception to "public engine API only".
- `packages/render-pc/src/index.ts`: exports.
- App: `apps/fly/src/app/flight.ts` passes `?viewlod=0` to the session, `apps/fly/src/session/index.ts` to the renderer
  (the same path as `?accum=`), and `packages/prefs/src/url.ts` lists the parameter; `apps/fly/src/app/builtin/drawing.ts`
  sets six parallel loads, two on a phone or tablet; `apps/fly/src/app/lod.ts` adds `view` (the stats) to the report of
  `window.__gsfpv.lod()` and of a bug report.
- Tests: `packages/render-pc/test/view-lod.test.ts`, 33: the engine's parameters with the rule at work and without it
  (control: the engine's own, as before the lane), the geometry, the factor, the turn and its look-ahead, the
  download order (the engine's own sum with the near-first rank), and the wrapper on a stand-in for the engine's instance
  (kept in the frame, multiplied outside, the scan's own multiplier, asks on turn and roll and not too often, the leading
  side of a turn kept and the trailing side not, files asked nearest first, a fault caught, dispose). Controls: no levels
  to lose and switched off change nothing; the engine's order puts a far node's coarse file before a near node's fine one.
- Probes: `tools/bench/scripts/lod-view-probe.mjs` (places, turns, where the budget is, pictures; `--product` measures a
  build as it is), `lod-view-score.mjs` (PSNR against a reference run); `gpu-select-fly.mjs` gains `--path` and `--lane`.

## Not verified

- A real phone or tablet: the weak device here was the laptop's Intel chip. Whether a tablet's limit is the GPU, the CPU
  sort or memory decides how much of the gain it sees.
- Turn rates above 360 degrees/s as a drone really turns (the snaps here are one frame, harder than any real turn; the
  spin is 360 degrees/s). The look-ahead is covered by unit tests and by the spin, not by a flown flight.
- Scenes other than Lublin and Wroclaw; the accumulating (stochastic) drawing with the frame's priority (every picture
  here is the sorted drawing; each new choice changes the resident set, which the accumulating renderer's history
  follows); cinema mode and video export (they use the finest level everywhere, where the factor changes nothing).
- `cooldownTicks` (how long an unused file stays loaded) was left at the engine's 100 frames; a turn back within a few
  seconds re-reads files from the browser's cache.
- An engine bump: 2.24 replaced `evaluateNodeDistances` by a hierarchy walk (`measureTreeNode`); `viewLodMissing` will say
  so and the engine's own rule will run until the wrapper is moved.

## For the lead

- The owner asked for this ("if nobody has it, build it"), which is his decision on the second engine-internals
  exception; `docs/decisions.md` has no entry for it yet.
- `?viewlod=0` gives the old behaviour for a load (the engine's rule, multiplier 3, penalty 5, angle 90), and so does a
  rule that failed or cannot run on the engine (the report's `view.failed` and `view.missing` say which).
  `lodUnderfillLimit` 2 and the parallel loads stay on either way.
- The governor sees more splats in the frame for the same budget, most of all when the view leaves the scan: it will step
  down sooner there. Its steps were not retuned.
