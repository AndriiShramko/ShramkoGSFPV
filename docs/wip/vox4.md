# Lane vox4 (train 4): the voxel view

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part vox4. Owner's words: brief lines 565-566 (voxels only shows a frozen
picture of the scan with holes through it; the voxels look flat), 577-578 (Lublin: a hole right under the craft).

## Status

- [x] V-1 render side: voxels-only stops the scan drawing (no frozen picture), SplatLoadGuard for ux4b, sun and fog (commit 3a3105d6)
- [x] V-2 the Lublin hole (experiment first, then the fix by its decision) and per-vertex ambient occlusion
  - [x] V-2a experiment (below) and the fix by its decision H1: VoxelStats.near/nearWalls, the panel says why (commit fc3d3742)
  - [x] V-2b per-vertex ambient occlusion: apps/fly/src/voxel-ao.ts (vertexAo, quadAo, cellWindow, chunkAo), the worker shades levels 0 and 1, packChunk multiplies RGB by AO_SHADE, the overlay Entry keeps the array for writeColors (commit 729e0730)
- [x] V-3 acceptance probe tools/bench/scripts/vox4-probe.mjs (drawn run, 1536x730 dsf 1.25, mouse), live negative control;
  its Lublin step reads stats.nearWalls (expect 'thin' at the spawn) and the panel line voxels.nearThin, not the design's 60 % pixel block
  - [x] probe written (steps 1-6; step 5 compares fog on/off in one build, AO has no frame cost) (commits f53e0c28, c83233c1)
  - [x] build f53e0c28 (the probe is not in the page), one locked drawn run: local 6/6 PASS, live 5 FAIL + panel PASS;
    evidence/2026-11-19/vox4/v3-probe-local.json and v3-probe-live.json (commit: the one that holds this line)

## Acceptance V-3 (2026-11-19)

`BENCH_UNCAPPED=1 node tools/bench/scripts/vox4-probe.mjs <base>/en <out.json> [shots] [tag]`, 1536x730 at dsf 1.25, mouse only
(the controls screen's keyboard, the walls chip, "Voxels only", then the click into the scene: pointer lock held).

| Step | localhost:6020 (this branch) | live (before this train) |
|---|---|---|
| 1 frozen: plan why, accum, canvas with the voxel layers off | PASS hidden, accum off, 100 % background | FAIL accum/ok, 0 % background (the scan) |
| 2 moved 3 m: still background | PASS 100 % | FAIL 0 % |
| 3 Lublin: near chunks drawn, nearWalls thin, panel says it, "Over the scan" brings the scan | PASS (cover 3.6 %) | FAIL (no nearWalls, no line) |
| 4 shading: top vs side luma, fog on/off ratio near and far | PASS 200 vs 128 (36 %); near 1.00, far 0.72 | FAIL (fog none; top/side 32 % already) |
| 5 cost: frame ms fog on vs off, uncapped | PASS 5.21 vs 5.23 ms | FAIL (no fog); 10.2 ms: the scan still drawn |
| 6 panel cross 44 px at 1536x730 and 844x390 | PASS | PASS (not a repair of this lane) |

Differences from the design's steps (the code and the scene decide):
- Step 1 does not pick 12 background pixels between voxels: it turns the two voxel layers off for a moment and
  reads the canvas (DOM hidden); a frozen scan shows everywhere then.
- Step 4's fog: no voxel of Wroclaw lies past 80 % of the reach in view depth (the engine fogs by depth), so the rule
  is "the same pixels with the fog on and off": < 30 m ratio >= 0.97, >= 100 m <= 0.85 (bins: 100-150 m 126 vs 169,
  150-250 m 107 vs 169). The design's rule is reported (designFarWithin30) where it has samples.
- Step 5 compares fog on and off in one build (one build a stage); AO is in the vertex colours and costs no frame time.
- The mouse path picks the mode before the scene click: after the pointer lock, Esc opens the pause menu, which is
  modal and lies over the walls chip at 1536x730 (For the lead).
Pictures (U:/Temp/gsfpv-train4/shots, looked at once each): vox4-wroclaw-only.png shows the wireframe voxels of the
street on a plain black background with lit faces, no scan behind them; vox4-lublin-only.png shows ground islands in
black with the panel and the legend saying the walls are almost empty under the craft and to pick "Over the scan".
The first, failed run's vox4-wroclaw-nolayers.png showed the scan still drawn: the probe's click had gone to the pause
menu, so voxels only was never on (a probe fault, fixed).

## Experiment V-2 (the Lublin hole, 2f1ddf5f, 2026-11-19)

- Page run (`node tools/bench/scripts/vox4-near.mjs http://localhost:6020/en 2f1ddf5f out.json 20 render=off`, build f5550bda):
  camera = spawn (146.52, 62.04, -96.97); voxels only planned the whole scene (33210 chunks, share 100 after 20 s).
  The design's 27-chunk box around the camera was EMPTY: the walls grid of Lublin ends at y 26.4 m, the craft is 36 m over it.
- Node run (`npx tsx tools/bench/scripts/vox4-plan.ts <walls>/2f1ddf5f/v1 146.52 62.04 -96.97 1,0.125 --map`):
  the 3x3 chunk columns under the craft (19 m square) hold only 4 wall chunks of 39, 211, 48, 37 faces at level 0
  (a full floor there is 9216); the plan draws them at level 0, ranks 2..27 of the feed, at share 1 and 1/8 alike.
  The map shows wide empty columns around the spawn, full ones far away.
- Decision: H1 (the walls themselves hold almost nothing under the craft; plan, queue and coarse levels are sound:
  H2 and H3 do not hold). Fix: VoxelStats.near (the column under the camera, collision chunksNear) and nearWalls
  (voxel-near.ts: 'thin' when the drawn faces cover < 10 % of the floor); the panel status line then says the
  walls are almost empty under the craft, the craft will not hit the ground there, and in voxels only to pick
  "Over the scan" to see the scan. Why the bake keeps so little ground there is a walls-bake question (For the lead).

## Measurement V-2b (AO cost in the worker, 2026-11-19)

`npx tsx tools/bench/scripts/vox4-ao-cost.ts <walls>/<scene>/v1 x y z 150` (150 nearest occupied chunks, Node):
- Lublin 2f1ddf5f at the spawn: level 0 +26 % (95 ms over 369 ms of meshing), level 1 +42 %; 60 % of vertices shaded.
- Wroclaw 70b50d42 at (0, 2, 0): level 0 +40 % (209 over 526 ms), level 1 +46 %; 62 % shaded.
- A first version that asked the octree per sample (isVoxelSolid) cost +57 % / +108 %; the chunk's own window of
  cells with a one-cell halo (cellWindow, read once by forEachBlock) brought it into the design's 30..60 %, with the
  same shaded share (the two agree).

Notes on the design vs the code:
- chunksNear is the column under and around the camera, not the 27-box of the design: in Lublin the craft flies over the grid.
- The fog reach is max(plan radius, farthest planned chunk) (voxels.ts replan): in the whole view the radius alone is short of the far chunks.
- The look values (VOXEL_GLOW) and the fog range (voxelFog) live in voxel-colors.ts (pure), so Node tests reach them.
- Level 0 quads are runs of faces along one axis (mesh.ts), not single faces: AO is right at each run's ends and
  blends along the run. The design's "merged quads get AO 0" holds for levels 2 and up and group meshes only.
- chunkAo takes the chunk and its size (not BlockComponents): the window is filled from the octree's blocks.
- voxel-ao.test.ts lives in tools/bench/test (apps/fly has no test folder in the vitest include).
- Wire at opacity below 1 in voxels only stays edges only (no faces to light); wire at full opacity already had lit faces (wireBack).

## What the owner does

1. Opens a scene with walls (for example Wroclaw), picks the keyboard on the controls screen, clicks the walls chip
   ("Walls 10 cm", bottom left), clicks "Voxels only" (or presses key V), then clicks into the scene to fly.
2. Sees the voxels in front of the scene's plain background colour: no still picture of the scan behind them, no holes
   through the walls. The cube faces facing the sun are brighter than the sides; far voxels fade into the background;
   corners where a wall meets the floor, and inner corners, are darker (down to half), so steps and edges read.
3. Clicks "Voxels only" off: the scan comes back with the drawing he had chosen (stochastic stays stochastic).
4. Opens Lublin (2f1ddf5f), clicks the walls chip, clicks "Voxels only": the panel's status line says the walls are almost
   empty under the craft (the scan is thin there), that the craft will not hit the ground there, and to pick
   "Over the scan" to see the scan; one click on that button shows the scan with the voxels over it.

## Claims

1. In voxels only the accumulating renderer is switched off (plan why 'hidden'), so no frozen picture is drawn behind the voxels.
   Proof: `npx vitest run packages/render-pc/test/accum-policy.test.ts` - pass; negative control NEG OK (old policy returns accum).
2. A scan load that was unloaded (or overtaken by a newer load) rejects with SplatLoadCancelled and adds no entity.
   Proof: `npx vitest run packages/render-pc/test/splat-load-guard.test.ts` - pass; NEG OK (the file is absent on origin/main).
3. The voxels-only materials glow less (solid 0.05) and fog linearly from 30 m to the plan's reach in the background colour.
   Proof: `npx vitest run packages/render-pc/test/voxel-colors.test.ts` - pass; NEG OK.
4. The new engine members (Scene.fog, FogParams fields, StandardMaterial.useFog) are public API.
   Proof: `cd tools/bench && npx tsx src/a1-api-check.ts` - pass, 83 checked.
5. The view measures the column under the craft (also over the top of the grid, also format 1.0) and calls the Lublin
   spawn's walls thin (335 faces over 9 columns of 1024 voxel squares).
   Proof: `npx vitest run tools/bench/test/vox4-near.test.ts` - 8 pass; NEG OK against f5550bda (the 27-box chunksNear).
   Neighbours: `npx vitest run packages/collision/test/overlay.test.ts tools/bench/test/voxview-panel.test.ts packages/i18n` - 43 pass.

6. Every corner of a voxel quad (levels 0 and 1) carries an occlusion level 0..3 from the three cells in front of it
   (0fps rule), on v1.1 and flipped v1.0 grids; the colour bytes are scaled by AO_SHADE [1, .82, .66, .5] and keep
   the shading through a style change; coarse levels are unshaded.
   Proof: `npx vitest run tools/bench/test/voxel-ao.test.ts packages/render-pc/test/voxel-colors.test.ts` - 14 pass;
   NEG OK against fa1aa897 (voxel-ao.ts absent, old voxel-colors.ts). Neighbours: packages/prefs/test/main-audit.test.ts
   pass (20 with voxel-colors); apps/fly and render-pc typecheck pass; scripts/check-architecture.mjs ok.
7. AO adds 26..46 % to a chunk's worker time and nothing per frame. Proof: tools/bench/scripts/vox4-ao-cost.ts (Measurement V-2b).
8. On the page, with the mouse at 1536x730 dsf 1.25: voxels only draws no scan (canvas is the background where no voxel
   is, also after a 3 m move), Lublin's panel says the walls are thin under the craft and "Over the scan" brings the
   scan back, top faces are 36 % brighter than sides, far voxels fade (0.72) and near ones do not (1.00), the fog costs
   0.0 ms a frame, the panel's 44 px cross closes it at 1536x730 and 844x390.
   Proof: `BENCH_UNCAPPED=1 node tools/bench/scripts/vox4-probe.mjs http://localhost:6020/en out.json` - 6/6 PASS;
   negative control: the same against https://gsfpv.flyreelstudio.eu/en - steps 1-5 FAIL, 6 PASS (Acceptance V-3).
9. Voxels only is cheaper than before: 5.2 ms a frame here against 10.2 ms on live in the same view (the scan is no
   longer drawn behind the voxels). Proof: step 5 of the same two runs (headless, this PC, uncapped).

## Not verified

- The AO corners were not judged on screen by a measure of their own: step 4 measures top against side faces (AO
  included) and no picture of the solid style was saved; whether the shading "reads" is the owner's judgement.
- The AO cost was measured in Node, not in the page's worker on a weak laptop; the frame times are of this PC's GPU
  in headless Chrome, not of a weak laptop.
- The fog's design rule (voxels past 80 % of the reach within 30 % of the background) had no samples at Wroclaw's
  spawn; the on/off ratio stands for it (Acceptance V-3).
- The design's frame cost against the V-1 build was not measured (one build a stage): fog on/off in one build instead.
- The owner may have had the floater filter on for Lublin; the experiment ran with it off (dropped null). With it on,
  the existing "pieces dropped" text stands beside the new line.
- No person, phone or real controller took part.

## For the lead

- Files changed outside the owned files: tools/bench/src/a1-api-check.ts (three engine members added, the design asks for it);
  apps/fly/src/ui/voxels.ts (the voxel panel's status line, nearLine; no lane owns it in the design's table).
- Walls bake question (not this lane): Lublin 2f1ddf5f's walls hold almost no cells under its spawn (Experiment V-2);
  whether the scan really has no ground there or the bake drops it needs a look at the bake's density rule.
- Contract for ux4b: packages/render-pc exports SplatLoadGuard, SplatLoadCancelled, isSplatLoadCancelled; renderer.unloadSplat()
  cancels a loadSplat() under way (it rejects with SplatLoadCancelled).
- New probe tools/bench/scripts/vox4-probe.mjs (and vox4-near.mjs, vox4-plan.ts, vox4-ao-cost.ts from V-2): bench only.
- Not this lane's files, seen in V-3: (a) after the pointer lock, Esc opens the pause menu, which is modal and lies over
  the walls chip at 1536x730, so in a pause the voxel panel cannot be reached by the mouse (key V still works);
  (b) the open walls panel at 1536x730 lies over the bottom of the "Scene by its author" link (walls.ts placePanel, ux4b's file).
- Deploy order: page only.
- Live checks after the deploy: `BENCH_UNCAPPED=1 node tools/bench/scripts/vox4-probe.mjs https://gsfpv.flyreelstudio.eu/en out.json`
  must give 6/6 PASS (read-only: it saves, sends and creates nothing; the voxel mode is a browser setting of the probe's own profile).

## Cost notes

- V-1: the most replies went to finding the voxel view's lines in the 230 KB brief (Cyrillic grep in bash hung); next time Grep the brief with a phrase and offset only.
- V-2a: the most replies went to the experiment's reach (the page hook wraps the controller, the 27-box was empty over the grid); a Node plan script on the baked walls (vox4-plan.ts) answered in one run: start there.
- V-3: the most replies went to the probe's own faults (data: fetch blocked by the CSP, the pause menu over the chip after the lock, too few far voxels for the fog rule); ?render=off still draws the voxels, so the whole probe was debugged without the GPU lock: do that before the locked run.
- V-2b: the most replies went to finding how the faces are built (runs, DIRS, flip) and to a second pass for the cost (octree per sample was +108 %); next time read mesh.ts facesFromOcc first and sample a halo window from the start.
