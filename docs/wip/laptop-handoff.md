# Hand-off from the owner's laptop: lanes gpu-select and lod-view

Branch `laptop-handoff`, 2026-11-14: lane gpu-select (head 2ed2f47e), lane lod-view (head 5bdbb007, reviewed) and main
197c2760 merged into one branch, without conflicts. The work on the laptop is finished; nothing was deployed from it.
This file is for the agent that takes the work into main and onto the live site, and for the one that continues it.
Labels: [measured] on the laptop (i7-11800H, Intel UHD + RTX 3070 Laptop); [reference] read in code or on the web.

## Taking it into main

1. Squash-merge `laptop-handoff` into main (one commit). Squash, not merge: an early commit of gpu-select (29dd30e3)
   carried other programs' names in an evidence file; a later commit removed them, a squash keeps them out of main's
   history. If main has moved: `git merge origin/main` into this branch first.
2. Gates (all passed on this merged tree, see the end of this file):
   `pnpm -r typecheck`; `node node_modules/vitest/vitest.mjs run`; `node scripts/check-architecture.mjs`;
   `pnpm --filter @gsfpv/site i18n:check`; `node --import tsx scripts/gen-catalog.ts --check`;
   `cd tools/bench && SITE=x npx tsx src/accept-repo.ts` (B18).
3. The lead's own live checks and deploy, as usual. After the deploy, on the live site:
   - a streamed scan (Lublin `2f1ddf5f`, Wroclaw `70b50d42`): `window.__gsfpv.lod().view` has `active: true`,
     `failed: null`, `missing: []`, and `calls` grows while the view turns;
   - the same with `&viewlod=0`: `active: false`, and the engine's parameters are the old ones (penalty 5, angle 90,
     multiplier 3). The probe reads them: `node tools/bench/scripts/lod-view-probe.mjs --site <site> --scene 70b50d42
     --budget 1 --product --no-turns --heights 0 --label check-on` (and `--query "&viewlod=0" --label check-off`);
     it writes `product.engine` into `evidence/<date>/lod-view/<label>.json`;
   - on a gaming laptop (screen of 140 Hz or more) that draws on its integrated chip, the graphics note shows on the start
     screen with "How to switch" and "Do not show again"; on a laptop with no sign of a card nothing shows (the page run
     `tools/bench/src/sonic-gpuhint-page.ts` checks both, 26 checks: `LAB=<site> npx tsx src/sonic-gpuhint-page.ts` in
     `tools/bench`).
4. Two decisions for the lead: lane lod-view reaches engine internals (the octree instance's `evaluateNodeDistances`,
   `requestFile`, the world's `_lodUpdateRequested`): a second exception to "public engine API only" in render-pc, and
   `docs/decisions.md` has no entry for it yet. And whether the graphics note stays as it is (the owner: pilots will not
   change settings; the note is shown until silenced and costs one click to silence).

## What the two lanes do

### gpu-select (report `docs/wip/gpu-select.md`)

- [measured] On a hybrid laptop Chrome 140, Edge 157 and Firefox 160 give the page ONE adapter, the integrated one,
  whatever `powerPreference` asks. A page cannot pick the card. Chrome and Edge move to the NVIDIA card with the switch
  `--force_high_performance_gpu` (the flag `force-high-performance-gpu`): Winter Garden 40.4 frames/s at 0.94 M, half
  resolution, on Intel against 129.3 frames/s at 3.95 M on NVIDIA. The NVIDIA card throttles after about 25 s: every GPU
  number names the card's heat.
- Product: the device class knows Intel's integrated chips from its discrete ones (Arc), names the adapter the page got,
  and on an integrated chip WITH A SIGN OF A FASTER CARD (a screen of 140 Hz or more, or Tiger Lake-H's chip; the owner,
  2026-11-14: never tell a pilot without a card to look for one) the start screen and the flight say that this computer
  most likely has a faster card, that the browser leaves it unused, what it gives, and how to switch it on in the browser
  (the flag address with a Copy button) or in Windows, every visit until it is switched or silenced; with no sign there
  is no note. A software renderer has its own words; the bug report carries a `gpu` block. Files:
  `packages/render-pc/src/device-class.ts`, `apps/fly/src/sonic/gpu-hint.ts`, `apps/fly/src/app/builtin/gpu-hint.ts`
  (and `.css`), `apps/fly/src/app/graphics-report.ts`, `apps/fly/src/app/diagnostics.ts`, locales
  `packages/i18n/locales/fly/gpuhint/*` and four `sonic.say.gpu*` keys.
- Closed without measuring (the owner): Windows' per-application graphics preference and battery power.
- Fully automatic switching exists only outside the page: a desktop wrapper (Electron, or WebView2) that starts Chromium
  with `--force_high_performance_gpu`. [reference: the same switch was measured in Chrome; not tried in a wrapper]

### lod-view (report `docs/wip/lod-view.md`)

- The owner's request: on a small splat budget (0.7 M on a tablet, 1 M) spend it on what is in the frame, keep the
  surroundings ready for sharp turns, load what is near first.
- Product: `packages/render-pc/src/view-lod.ts`, on by default, `?viewlod=0` switches it off for a load. It wraps the
  engine's choice of detail (PlayCanvas 2.23.2 gsplat-unified): nodes outside the frame count as further away (half a
  level coarser 25 degrees beyond the frame's edge, three levels from 80 degrees and behind: coarse, never nothing); while
  the view turns, the frame is widened toward the turn by a quarter of a second of its rate; a new choice is asked after
  6 degrees of turn; files load nearest first. The renderer sets the engine's parameters by `lodRule(active)`: with the
  rule at work penalty 1.001, angle 6, multiplier 2; off, failed, or on an engine without the members, the old 5, 90, 3.
  Either way: `lodUnderfillLimit` 2 and six parallel downloads (two on a phone or tablet).
- [measured] Same budget, PSNR on luma against a 16 M picture from the same place: Lublin (259 M splats) after turns
  +0.5 to +3.0 dB, from above with the whole city in view +0.2 to +0.5 dB, at the highest place 0.07 to 0.15 dB below; Wroclaw at
  street level +1.1 to +3.7 dB. What is near in the frame: 0.61 M splats three seconds after the reveal instead of 0.01 M.
- An engine bump: 2.24 replaced `evaluateNodeDistances` by a hierarchy walk; the rule then reports `missing`, switches
  itself off and the engine's own rule and parameters run, until the wrapper is moved.

## The owner's questions of 2026-11-14, answered

### Why not Spark 2, Babylon.js or Aholo?

- They are other engines, not parts that plug into ours. Spark 2 (World Labs, MIT) is a three.js renderer with its own
  streamed format (`.rad`, a precomputed tree read by HTTP range requests); Babylon.js streams the same `lod-meta.json`
  as PlayCanvas but is a whole engine; Aholo and Babylon Lite likewise. Moving the simulator means rewriting
  `packages/render-pc` and everything drawn through it, and for Spark re-encoding every scan. [reference]
- Their main idea for this case, the budget spent on what is in view, is now in our renderer (lod-view), with a
  look-ahead from the turn rate that none of them has. From above, with the whole city in the frame, that idea gains
  little: the budget is already in the frame. What is left for "Lublin from above on a weak device" is how the budget is
  spread inside the frame, and what the device can draw at all: tasks 1 and 2 below.
- Worth taking from them as ideas (not as code): Spark's choice by projected size (best first) and its resident pool
  larger than the draw budget, its foveation; Babylon's budget LOD that knows several cameras (9.23); Aholo's refinement
  only inside the frustum (here: a stronger far factor, measured worse right after a snap turn without the look-ahead).

### VR (Quest 3)

- PlayCanvas, three.js with Spark and Babylon.js all run in the Quest browser through WebXR; the engine does not decide
  whether Lublin works in a headset. [reference]
- The headset's GPU does: every splat is drawn for two eyes at 72 to 90 Hz. Reports for Quest 3 in the browser range from
  0.1 to 0.4 M splats already too slow (Babylon.js forum, date unclear) to a 1.7 M scene that worked (PlayCanvas
  forum); a guideline quoted for Spark is 1 M or less. Anecdotal: to be measured on the device. [reference]
- The simulator has no VR mode yet (no WebXR session in `apps/` or `packages/`). PlayCanvas has one
  (`CameraComponent.startXr`). For lod-view in a headset: the frame is the two eyes' views (XR views have their own
  asymmetric projections, so `camera.fov` and `aspectRatio` do not describe them), the look-ahead comes from the head's
  turn rate (head turns are fast), and detail can fall from the lens centre, where a Quest lens is sharp (foveation).

## Next tasks, in the order of the gain expected

1. The budget inside the frame, from above (Lublin at 1 M, the start, 40 m and 140 m places): with multiplier 2 the far
   part of the frame still gets more splats per pixel than the near part. Measure multipliers between 1.5 and 2 with
   every node in the frame kept at least at its coarsest level (at 1.5 the first try left 3 % of the picture empty: find
   out whether the balancer's bin range or the LOD range dropped them), or a rule by projected size in the same wrapper.
   Done when: PSNR against the 16 M reference not below lod-view's at any place and higher at 140 m.
2. A resident pool larger than the draw budget: `cooldownTicks` is the engine's 100 frames, so a turn back after a
   second or two loads its files again (from the browser's cache while it still has them). Raise it on desktop, cap it by memory on phones, tablets and a headset. Done when: a turn
   back within 10 s fetches nothing and peak memory on a phone stays within its limit.
3. VR mode, its own lane: the WebXR session, lod-view from the XR views (both eyes), the head's turn rate, a foveation
   term, and the budget for Quest 3 measured on the device (start at 0.5 to 1 M; the governor steps down from there).
4. lod-view on a real phone or tablet (not done: the weak device on the laptop was its Intel chip).
5. Optional: a desktop wrapper that starts Chromium on the discrete card (gpu-select above).

## How the measurements were made

- Dev server: Vite on port 5342, page `/fly/` (the live site and a release build: `/en/fly/`).
- `tools/bench/scripts/lod-view-probe.mjs`: places (start, `--heights`), turns (yaw 95 and 185 in one frame, pitch, a
  spin; `--no-turns` skips them), where the budget goes, pictures (PNGs in `.cache/lod-view`, small JPEGs in evidence);
  `--product` measures a build as it is, `--query "&viewlod=0"` the same build with the engine's rule. A reference run is
  the same probe at `--budget 16` with `--hold`. `lod-view-score.mjs --ref <reference label> <labels...>` scores the
  pictures (PSNR on luma). `gpu-select-fly.mjs` measures frames and the load order; `gpu-select-probe.mjs` which adapter
  a browser gives; `gpu-select-switch.mjs` the switch and the Windows link.
- GPU numbers only in a visible browser window in front (a hidden or covered window draws about one frame a second), with
  the card's heat named; one GPU run at a time.

## Gates on this branch

Ran on 2026-11-14 on this merged tree (gpu-select 2ed2f47e, lod-view 5bdbb007, main 197c2760, the submodule
`packages/sonic-fpv` at main's 598a98f9), all with exit 0, last after the graphics note's change (the sign of a second
card): `pnpm -r typecheck`; vitest, 325 files and 4818 tests (4802 pass, 16 skipped, none fail); the page run of the
graphics note, 26/26; check-architecture; the site's i18n:check (1193 strings x 4 locales); gen-catalog --check;
B18 PASS. The API's Python tests were not run here: the two lanes change no Python file (the gpu-select lane ran them,
458 passed).

## Sources [reference, read 2026-11-14]

- Spark 2.0: https://www.worldlabs.ai/blog/spark-2.0, https://sparkjs.dev/docs/new-features-2.0/
- PlayCanvas streamed LOD: https://developer.playcanvas.com/user-manual/gaussian-splatting/building/lod-streaming/
- Quest 3 reports: https://forum.babylonjs.com/t/the-future-of-gs-in-bbl/60666?page=2,
  https://forum.playcanvas.com/t/confetti-like-noise-rendering-gaussian-splats-in-vr/38649
- Babylon.js 9.23 (budget LOD for several cameras): https://gamedev.net/news/5369-babylonjs-9230-released/
