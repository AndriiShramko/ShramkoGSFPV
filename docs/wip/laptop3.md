# Lane laptop3 (train 3, wave 2): taking in the laptop hand-off

Worktree `C:/dev/gsfpv-site-sound`, branch `laptop3` from origin/main 1de775ed. Ports 5740-5759.

## Status

Stage P1-take-in
- [x] 1. Squash of origin/laptop-handoff (6c859e96) onto origin/main 1de775ed, one commit; lockfile unchanged
- [x] 2. All gates (gates.py exit 0) and a6-reference (on 6ddf601d; this commit records them)
- [x] 3. docs/decisions.md D91: second exception to "public engine API only" in render-pc (this commit)
- [x] 4. Second review of packages/render-pc/src/view-lod.ts and its wiring; one fix with test and negative control (this commit)

Stage P2-measure-here
- [x] 1. Release build of ebcee4ad (dist sha256 f62b80e5...), served by serve-csp on port 5740
- [x] 2. The laptop's probes on this PC (runner U:/Temp/gsfpv-train3/laptop3/run-p2.sh, logs beside it): Lublin and
  Wroclaw at 0.5 M and 1 M, rule on and `&viewlod=0`, and a 16 M reference; scores by lod-view-score.mjs (this commit)
- [x] 3. Table next to the laptop's numbers, pictures in U:/Temp/gsfpv-train3/shots, what a person sees in each pair
  (this commit; evidence/2026-11-15/lod-view/l3-*.json and score-l3-*.json)

Stage P3-weak-budget
- [x] 1. URL switches `?lodmul=` (the scan's multiplier while the frame's priority works, 1.2 to 4) and `?viewlodfar=`
  (the far field's levels, 0 to 12): view-lod.ts lodRule/viewLodParamsOf, renderer, session, flight.ts; test
  view-lod-switches.test.ts (NEG OK), render-pc and fly typecheck exit 0 (this commit)
- [x] 2. Multiplier 1.5 and 1.7 measured on Lublin at 0.5 M and 1 M (runner U:/Temp/gsfpv-train3/laptop3/run-p3.sh,
  build 66aa1609 on port 5741, against the P2 16 M reference): REJECTED, see Facts P3 (this commit)
- [ ] 3. Next candidate, not started: why a lower multiplier freezes the page (find the cause first, see "Left"), then the
  coarse cover of the frame and the budget inside it; the far field (`?viewlodfar=8`, runner set `far8`) not measured yet
- [ ] 4. Pictures laptop3-lublin-above-0p5M-after.png and -1M-after.png (runner set `after`), Wroclaw street check (set `wro`
  with MUL and TAG), accept-fly B6 B7 B9 to B16, a6-reference, gates vitest, architecture, i18n, b18; status table

Left for the next worker (P3): the runner is ready (`bash run-p3.sh build`, then serve-csp dist 5741, then
`run-p3.sh <set> score-lub`; one probe is about 4 minutes and takes the GPU lock itself). The switches are in the code;
the default is unchanged (multiplier 2, farLevels 3), so no product change is in yet. Candidates left: (a) the frozen page
at multiplier 1.5: cause unknown (balancer, loader or GPU), find it before trying a value below 2 again; (b) `?viewlodfar=8`
at 1 M (outside the frame only the coarse stand-in); (c) the governor starting at step 0 on every load
(weak-devices-plan.md line 23): a weak device's first seconds miss frames; start from the class's settled step.

## Facts (measured)

- The squashed tree has no other program's name: `git grep --cached -i "DJI|otherRows"` finds only this project's own
  lane names in docs/wip/gpu-select.md (gsfpv-dji, app-dji-rc2) and byte matches inside JPEGs; the `.exe` names in the
  evidence are chrome.exe, msedge.exe and firefox.exe only.

- Review fix, view-lod.ts: after a streamed scan was gone (a single-file scan flown next, or the gap of a scan change)
  the wrapper stayed on the engine's class, nothing chose through it, so the axis of the last choice never moved and a
  turned view asked the engine for a full update on every frame: the new test turns the view 20 frames 60 ms apart and
  the old code asked 20 times (`expected 20 to be +0`), the new code 0. view-lod.test.ts 34 of 34 pass; negative control
  NEG OK (neg_control.py, old view-lod.ts from HEAD 32160aae); render-pc typecheck exit 0.

- Gates (gates.py, 2026-11-15): first run FAIL typecheck and vitest (bench: `motorChoice` not in SonicPrefs,
  `scanFreeLesson is not a function`, 13 failures in 6 sonic-* files) because the worktree's submodule
  packages/sonic-fpv was checked out at 378cc50d, left by the merged sound lane, not at the pinned 598a98f9.
  After `git submodule update packages/sonic-fpv`: typecheck PASS, vitest PASS (324 files passed, 1 skipped;
  4807 tests passed, 14 skipped, 0 failed); api-unittest, architecture, i18n, catalog, B18 PASS in the first run
  (logs U:/Temp/gsfpv-gates-20261115-025028 and -025755). a6-reference.test.ts 1 of 1 pass (hash unchanged).

### P2: the laptop's measurement repeated on this PC (2026-11-15, 03:22 to 04:04)

Build ebcee4ad (release, serve-csp port 5740, `/en/fly/`), RTX 4090 (WebGPU nvidia lovelace), picture 3840x1970,
probe flags as the laptop's: `--variant force-hp --product --query "&drawing=sorted&set.display.deviceClass=desktop-strong"`
(plus `&viewlod=0` for "off"); Lublin places start, 40 m and 140 m up (pitch -20, -35), Wroclaw `--heights 0,8 --pitch 0,-15`;
reference: the same build at 16 M with `--hold 3`. Every probe run held the GPU lock itself (lod-view-probe.mjs lock()),
one run at a time, 1.5 to 3.5 minutes each. PSNR on luma over the scan's pixels, dB, against the 16 M picture
(lod-view-score.mjs); for a turn the value at the end of its hold (= settled), "at once" where it differs.

Lublin 2f1ddf5f (259 M splats), off / on:

| Picture | 0.5 M off | 0.5 M on | 1 M off | 1 M on | laptop 1 M engine | laptop 1 M product |
|---|---|---|---|---|---|---|
| start place (whole city) | 17.99 | 18.22 | 19.44 | 19.65 | 19.09 | 19.29 |
| 40 m up | 18.37 | 18.66 | 19.77 | 20.14 | 19.54 | 19.89 |
| 140 m up | 18.05 | 18.01 | 19.47 | 19.43 | 19.16 | 19.09 |
| yaw 95 (at once / settled for on) | 17.08 | 18.16 / 18.23 | 18.33 | 19.17 / 19.71 | 18.14 | 19.00 / 19.49 |
| yaw 185 | 17.94 | 19.23 / 19.75 | 19.01 | 20.36 / 21.15 | 18.86 | 20.21 / 20.99 |
| pitch down | 17.47 | 17.90 / 18.76 | 18.58 | 19.11 / 20.17 | 18.62 | 19.14 / 20.24 |
| after the spin | 17.20 | 18.49 / 18.63 | 18.40 | 19.42 / 19.98 | | |

Lublin splats in the frame of those drawn (M): start 0.34 of 0.47 off, 0.35 of 0.46 on (0.5 M); 0.70 of 0.97 off, 0.72
of 0.96 on (1 M); 140 m up 0.39 off / 0.40 on (0.5 M), 0.80 / 0.83 (1 M); after yaw 185: 0.07 off / 0.19 on (0.5 M),
0.14 / 0.37 (1 M, the laptop had the same 0.14 / 0.37). Bytes downloaded, whole run: 33.8 off / 82.9 on MB (0.5 M),
58.3 / 149.3 (1 M), 1875 (16 M); at the start place alone 24.4 / 28.0 (0.5 M), 39.2 / 45.2 (1 M), 468 (16 M).
Seconds to the picture (reveal) and then until nothing loads (settled) at the start place: 0.5 M off 5.4 + 4.1, on
7.9 + 8.1 (the first run of the series); 1 M off 3.7 + 2.8, on 2.8 + 4.5; 16 M 3.2 + 18.9. At the places above, 0.4 to 1.0 s.

Wroclaw 70b50d42 (43 M splats), street level, off / on:

| Picture | 0.5 M off | 0.5 M on | 1 M off | 1 M on |
|---|---|---|---|---|
| start place | 23.46 | 23.51 | 24.80 | 24.98 |
| level view at 3 m (up0) | 22.72 | 23.37 | 24.09 | 24.97 |
| 8 m up, looking down 15 | 23.48 | 24.08 | 25.22 | 26.09 |
| yaw 95 (at once / settled) | 21.13 / 22.22 | 22.73 / 22.77 | 22.32 / 23.84 | 23.91 / 24.64 |
| yaw 185 | 22.81 / 23.25 | 23.67 / 24.48 | 24.56 / 25.25 | 25.04 / 26.30 |
| pitch down | 22.58 | 23.96 / 24.12 | 24.38 | 25.90 |
| after the spin | 22.18 | 22.75 / 23.65 | 23.33 | 25.26 / 26.01 |

(The laptop measured Wroclaw at 4 M only: engine 28.71, product 31.19 at the level view; not the same budget.)
Wroclaw splats in the frame: level view 0.31 of 0.48 off, 0.37 of 0.44 on (0.5 M); 0.63 of 0.97 off, 0.84 of 0.97 on
(1 M). Bytes downloaded, whole run: 177.7 off / 278.1 on MB (0.5 M), 266.9 / 443.3 (1 M), 2356 (16 M); start place
alone 85.3 / 114.5 (0.5 M), 128.4 / 174.8 (1 M), 925 (16 M). Reveal + settled at the start: 0.5 M off 7.3 + 7.1, on
4.7 + 7.0; 1 M off 2.6 + 4.6, on 2.8 + 6.1; 16 M 2.6 + 29.4.

Frame time: 33.3 ms median (30 frames/s) in EVERY run, the 16 M reference included: on this PC the frame rate is capped
at 30 (the display's or the window's pacing), so the frame time says nothing about the rule's cost here.

Is the gain there on this PC too? Yes, and of the same size as on the laptop: at 1 M within 0.4 dB of the laptop's
values in every row, the same direction everywhere. With the whole city in view it is small (+0.2 to +0.4 dB at the
start and 40 m up) and gone at 140 m (-0.04 dB at both budgets); after turns it is large (+1.2 to +2.1 dB settled);
at street level +0.05 to +0.9 dB in place and +0.55 to +2.7 dB after turns. The price: 1.15 to 1.4 times the bytes at a
place, 1.6 to 2.6 times over a run with turns (the rule fetches the new view after a turn, the engine's rule does not).

What a person sees (pictures in U:/Temp/gsfpv-train3/shots, laptop3-lublin-above-* = the 140 m place,
laptop3-wroclaw-street-* = the level view at 3 m):
- Lublin 0.5 M on / off: the two pictures cannot be told apart. Both are chopped most at the bottom of the frame, the
  part nearest the camera: roofs and courtyards are smeared blobs, the street with the zebra crossings and the cars
  (sharp at 16 M) is a grey smear, the parking lot on the right has no cars. The far part (the park and the building
  at the top) looks close to the 16 M picture. So from above the budget is not wasted outside the frame (82 to 88 % is
  inside); it is spread over the frame evenly by distance, and the near half, which covers most of the screen, is
  what looks chopped.
- Lublin 1 M on / off: again the same picture; a little sharper than 0.5 M (cars in the parking lot appear, roof edges
  are cleaner), the near bottom edge and the left street still smeared.
- Wroclaw 0.5 M on / off: "on" is sharper close up: the wall lantern and its bracket on the pink chapel, the overhead
  wire and the paving on the right are visible; "off" loses the lantern, blurs the wire, and the cobbles in front are
  blobs. Both are far from 16 M on the nearest metres (road surface, the brick wall on the right). "Off" keeps a third
  of its splats outside the frame.
- Wroclaw 1 M on / off: "on" shows the cobbles and the paving on the right as stones and the drain grate on the left;
  "off" has the near road as smeared blobs, only the far towers are a touch crisper in "off" (the budget it keeps for
  the far field and behind).

### P3: the multiplier below 2 (2026-11-15, 04:11 to 04:27, build 66aa1609, port 5741)

Same probe flags as P2 plus `&lodmul=`; scored by lod-view-score.mjs against l3-lub-ref16 (U:/Temp/gsfpv-train3/laptop3/
score-p3-lub.txt). One run each, each probe held the GPU lock itself, about 4 minutes per run.
- 1 M, multiplier 1.7 vs 2 (P2 "on"): start 19.51 vs 19.65, 40 m up 20.06 vs 20.14, 140 m up 19.34 vs 19.43 dB: worse at
  every place from above by 0.08 to 0.14 dB.
- 0.5 M, multiplier 1.7 and 1.5: the run ended with `page.screenshot: Timeout 30000ms exceeded` (the page drew no frame
  for 30 s, a frozen page for a pilot); 1 M, multiplier 1.5: `the scan did not reveal: {"s":"loading"}`.
- Engine reading (playcanvas 2.23.2 build, GSplatBudgetBalancer.balance): every node keeps at least its coarsest level
  (the total starts at totalCoarsestCount; a budget below it gives every node its coarsest), so a node is never dropped
  by the choice; a hole is a file not loaded yet. Finer bands are added in the order of log(distance) - band * log(multiplier),
  so the multiplier is the rule "by size on the screen" already: the slope of that size per level.

## Decisions

- P3: a multiplier below 2 is not taken: 1.7 measured worse from above at 1 M, 1.5 and 1.7 at 0.5 M froze the page.
  The default stays 2; the switch stays for the measurement.

- D91 numbered after main's last D90; renumber at the merge if another lane took D91.
- `active` now also needs a streamed scan present, so on a single-file scan the renderer sets the engine's own rule
  (no effect on a scan without an octree) and `lod().view.active` is false there, as the hand-off's check expects for
  the off case only on streamed scans.

## For the lead

Review of view-lod.ts and its wiring (renderer.ts onViewLod, flight.ts `?viewlod`, app/lod.ts):
- Engine without the members: install() fails on viewLodMissing every frame (a cheap walk), `missing` names them, active
  stays false, the renderer keeps ENGINE_RULE. Read, and held by the existing unit test; no browser run on another engine.
- Scan not streamed: no octree instance, install() false, engine rule. After a streamed scan it was active with stale
  state and asked every frame: fixed (above).
- Scan change in flight: same engine class, the wrapper stays; the gap now resets the turn state; the new scan gets
  multiplier 2 when active flips back (onViewLod calls applyLodMultiplier). The pass at load (loadSplat line ~526) uses
  the last active value, corrected the next frame.
- Fly by Sound with rendering off: no frame drawn means no 'framerender', so tick never runs and nothing is asked; read
  only, no run.
- Room with a second drone: other drones are entities, the page has one camera (`addComponent('camera'` only in
  renderer.ts and the separate drones3d studio app, which has no splats), so the frame and the look-ahead are the one
  camera's. Note for VR or a second view: `after()` takes the engine's camera node but the look-ahead and the stored
  axis come from the renderer's own camera; a second camera drawing the same scan would mix them.
- Two SplatRenderers on one page would take the class-wide wrapper from each other every frame (ownership moves in
  install()); there is one (createRenderer, renderer.ts:373). Not changed.

P2, for the owner's question (Lublin from above on a 0.5 M to 1 M device): the frame's priority does not change that
picture. From above with the city in view the budget is already 82 to 88 % in the frame; what looks chopped is the near
half of the frame, which gets about the same level as the far field (level over the picture about 9 at 0.5 M, 8 at
1 M). The next lever is how the budget is shared INSIDE the frame (detail by size on screen, more for the near ground
that fills most of the picture, less for the far rim), not more culling outside it. The rule's clear gain is after
turns and at street level, and it costs 1.6 to 2.6 times the bytes over a flight with turns.

## Not verified

- No browser run in this stage (the stage asked for none): the review fix is held by the unit test only; the
  hand-off's live checks (`lod().view` active and calls growing on Lublin and Wroclaw, `&viewlod=0`) were not run on a
  local release.
- Fly by Sound with rendering off and the second-drone case: by reading the code, not by a run.
- The gates' api-unittest, architecture, i18n, catalog and B18 ran once, while the review fix was being written; B18
  and architecture ran after it was in place (by the run's timing), the other three do not read the files it changed.

- P2: the frame time of the rule on this PC: every run is capped at 30 frames/s (33.3 ms median, 16 M included), so its
  cost in milliseconds is not measured here (view-lod's own `lastMs` was 3.5 ms per evaluation in l3-lub-0p5-on, one
  sample). Why the cap is 30 was not looked into (display refresh or window pacing).
- P2: times (reveal, settled) were taken while this lane's probe held the GPU lock, but other lanes' CPU work and the
  network to the scan files were not controlled; one run per setting, no repeat, so differences under 1 s are noise.
  The 0.5 M "on" Lublin run was the first of the series.
- P2: a weak device itself (Intel chip) was not used here: the budgets were set by `budget=`, the card is an RTX 4090.

## Cost notes

- P1: the most turns went to the first gates run failing on a stale submodule checkout in a reused worktree; checking
  `git submodule status` right after creating the branch would have saved a gates run.
- P2: the most turns went to a first series lost to Git Bash turning `--path /en/fly/` into a Windows path (10 minutes,
  half of it waiting for another lane's lock); `MSYS2_ARG_CONV_EXCL='*'` in the runner from the start would have saved it.
- P3 (first worker): the most turns went to reading the engine's balancer and wiring a URL switch through four files; four probes of 4 minutes each gave one usable score (three runs froze or did not reveal). A short 1-minute probe (start place only, no turns) per candidate first would have found the freeze in a quarter of the time.
