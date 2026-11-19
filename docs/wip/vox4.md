# Lane vox4 (train 4): the voxel view

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part vox4. Owner's words: brief lines 565-566 (voxels only shows a frozen
picture of the scan with holes through it; the voxels look flat), 577-578 (Lublin: a hole right under the craft).

## Status

- [x] V-1 render side: voxels-only stops the scan drawing (no frozen picture), SplatLoadGuard for ux4b, sun and fog (commit: this one, "vox4 V-1")
- [ ] V-2 the Lublin hole (experiment first, then the fix by its decision) and per-vertex ambient occlusion
- [ ] V-3 acceptance probe tools/bench/scripts/vox4-probe.mjs (drawn run, 1536x730 dsf 1.25, mouse), live negative control

Notes on the design vs the code:
- The fog reach is max(plan radius, farthest planned chunk) (voxels.ts replan): in the whole view the radius alone is short of the far chunks.
- The look values (VOXEL_GLOW) and the fog range (voxelFog) live in voxel-colors.ts (pure), so Node tests reach them.
- Wire at opacity below 1 in voxels only stays edges only (no faces to light); wire at full opacity already had lit faces (wireBack).

## What the owner does

1. Opens a scene with walls (for example Wroclaw), clicks the walls chip, clicks "Voxels only".
2. Sees the voxels in front of the scene's plain background colour: no still picture of the scan behind them, no holes
   through the walls. The cube faces facing the sun are brighter than the sides; far voxels fade into the background.
3. Clicks "Voxels only" off: the scan comes back with the drawing he had chosen (stochastic stays stochastic).

## Claims

1. In voxels only the accumulating renderer is switched off (plan why 'hidden'), so no frozen picture is drawn behind the voxels.
   Proof: `npx vitest run packages/render-pc/test/accum-policy.test.ts` - pass; negative control NEG OK (old policy returns accum).
2. A scan load that was unloaded (or overtaken by a newer load) rejects with SplatLoadCancelled and adds no entity.
   Proof: `npx vitest run packages/render-pc/test/splat-load-guard.test.ts` - pass; NEG OK (the file is absent on origin/main).
3. The voxels-only materials glow less (solid 0.05) and fog linearly from 30 m to the plan's reach in the background colour.
   Proof: `npx vitest run packages/render-pc/test/voxel-colors.test.ts` - pass; NEG OK.
4. The new engine members (Scene.fog, FogParams fields, StandardMaterial.useFog) are public API.
   Proof: `cd tools/bench && npx tsx src/a1-api-check.ts` - pass, 83 checked.

## Not verified

- Nothing of V-1 was drawn yet: the frozen picture's absence and the shading are judged in V-3's GPU probe.
- No person, phone or real controller took part.

## For the lead

- Files changed outside the owned files: tools/bench/src/a1-api-check.ts (three engine members added, the design asks for it).
- Contract for ux4b: packages/render-pc exports SplatLoadGuard, SplatLoadCancelled, isSplatLoadCancelled; renderer.unloadSplat()
  cancels a loadSplat() under way (it rejects with SplatLoadCancelled).
- Deploy order: page only.

## Cost notes

- V-1: the most replies went to finding the voxel view's lines in the 230 KB brief (Cyrillic grep in bash hung); next time Grep the brief with a phrase and offset only.
