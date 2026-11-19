# Lane vox4 (train 4): the voxel view

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part vox4. Owner's words: brief lines 565-566 (voxels only shows a frozen
picture of the scan with holes through it; the voxels look flat), 577-578 (Lublin: a hole right under the craft).

## Status

- [x] V-1 render side: voxels-only stops the scan drawing (no frozen picture), SplatLoadGuard for ux4b, sun and fog (commit 3a3105d6)
- [ ] V-2 the Lublin hole (experiment first, then the fix by its decision) and per-vertex ambient occlusion
  - [x] V-2a experiment (below) and the fix by its decision H1: VoxelStats.near/nearWalls, the panel says why (commit fc3d3742)
  - [ ] V-2b per-vertex ambient occlusion: apps/fly/src/voxel-ao.ts vertexAo + voxel-ao.test.ts, worker samples occupancy, packChunk multiplies RGB, Entry keeps the array for writeColors
- [ ] V-3 acceptance probe tools/bench/scripts/vox4-probe.mjs (drawn run, 1536x730 dsf 1.25, mouse), live negative control;
  its Lublin step reads stats.nearWalls (expect 'thin' at the spawn) and the panel line voxels.nearThin, not the design's 60 % pixel block

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

Notes on the design vs the code:
- chunksNear is the column under and around the camera, not the 27-box of the design: in Lublin the craft flies over the grid.
- The fog reach is max(plan radius, farthest planned chunk) (voxels.ts replan): in the whole view the radius alone is short of the far chunks.
- The look values (VOXEL_GLOW) and the fog range (voxelFog) live in voxel-colors.ts (pure), so Node tests reach them.
- Wire at opacity below 1 in voxels only stays edges only (no faces to light); wire at full opacity already had lit faces (wireBack).

## What the owner does

1. Opens a scene with walls (for example Wroclaw), clicks the walls chip, clicks "Voxels only".
2. Sees the voxels in front of the scene's plain background colour: no still picture of the scan behind them, no holes
   through the walls. The cube faces facing the sun are brighter than the sides; far voxels fade into the background.
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

## Not verified

- Nothing of V-1 was drawn yet: the frozen picture's absence and the shading are judged in V-3's GPU probe.
- The panel line on Lublin was not seen on a page yet (the stage's one build was the experiment's, before the fix): V-3.
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
- Deploy order: page only.

## Cost notes

- V-1: the most replies went to finding the voxel view's lines in the 230 KB brief (Cyrillic grep in bash hung); next time Grep the brief with a phrase and offset only.
- V-2a: the most replies went to the experiment's reach (the page hook wraps the controller, the 27-box was empty over the grid); a Node plan script on the baked walls (vox4-plan.ts) answered in one run: start there.
