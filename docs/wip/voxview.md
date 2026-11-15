# Lane voxview: the voxel view is one 3D space with the gates, and it shows the whole scene

Branch voxview from origin/main 4e6ef171, worktree C:/dev/gsfpv-site-sound, ports 5740-5759.
Owner's messages 58 and 60 (2026-11-15); lead's decisions V1-V4. Stages: X1-depth (V1, V4), X2-whole-scene (V2, V3).

## Status

- [x] X1.1 Branch voxview created from origin/main; release build of origin/main (node scripts/build-release.mjs) with the
  stand-in walls U:/Temp/gsfpv-train2/walls/release copied into dist/walls; served by serve-csp on port 5740.
- [x] X1.2 Probe tools/bench/scripts/voxview-depth-probe.mjs (this commit): depth mode (layer and material facts, eye places
  found with rays through the walls, pixels of three pictures per eye) and --panel mode (panel rectangle and close control
  at 1366x768, 1280x720, 844x390, 390x844, rendering off, no GPU lock).
- [x] X1.3 Measured before (old code, Wroclaw 70b50d42, see Facts X1). Picture voxview-depth-2-before(-marked).png looked at.
- [x] X1.4 Probe fixes (commit of X1.5/X1.6): the yaw is chosen by projecting the gate centre (in front, nearest the
  middle); rings sampled at 12 angles, boxes at 5 places along the long axis; the stats line carries depthItems.
- [x] X1.5 V4 build (commit "voxview X1: V4 panel header ..."): apps/fly/src/walls.ts (the walls-more details: a header
  .walls-head with the name, a fold button data-action voxpanel-fold and a close cross data-action voxpanel-close, 44 px
  each; the body .walls-body folds), apps/fly/src/fly.css (.walls-menu fixed, overflow-y auto, sticky header), the
  placement apps/fly/src/ui/voxel-panel.ts (pure) with tools/bench/test/voxview-panel.test.ts (7 tests; negative control:
  the placement without the room limit fails 5 tests, "expected -192 to be greater than or equal to 8"). Texts
  voxels.panel.title/fold/unfold/close in packages/i18n/locales/fly/voxels en, es, pl, ru.
- [x] X1.6 V1 build (same commit): packages/render-pc/src/voxel-overlay.ts gets a second layer "GSFPV Voxel depth"
  right before "GSFPV Voxels"; it does the depth clear (the voxel layer no longer clears) and draws a depth-only copy
  (colour writes off) of every render item in the World layer, synced when shown and every 10th update; pure rule in
  packages/render-pc/src/voxel-depth.ts with packages/render-pc/test/voxel-depth.test.ts (negative control: nothing
  joins -> "expected false to be true"). The wire style in the voxels-only view at opacity 1 uses a material with dim
  lit opaque faces and bright edges (wireBack), so a gate behind a wall is hidden by it; over the scan the wire stays
  see-through. apps/fly/src/voxels.ts passes the voxels-only flag to setLook and shows depthItems in the stats.
  tools/bench/src/a1-api-check.ts: Entity.findComponents and Material red/green/blue/alphaWrite in USED (check passes, 76).
  Typecheck apps/fly and packages/render-pc: 0 errors (after git submodule update put packages/sonic-fpv back on its
  pin 293ebae; it was checked out at b05aeda, which gave 6 type errors in apps/fly/src/sonic and say-via.ts).
- [ ] X1.7 After-run of the depth probe on a new release build (GPU lock, at most 10 minutes): voxview-depth-1.png,
  voxview-depth-2.png, voxview-depth-scan.png, each looked at, three marked points per picture read as numbers; the
  guide chip shown. Panel probe after.
- [ ] X1.8 Typecheck (apps/fly, packages/render-pc), gates.py --only vitest,architecture,i18n,b18,leaks,
  tools/bench/test/a6-reference.test.ts, commit with Facts and For the lead.
- [ ] X2-whole-scene: not started.

## Facts X1 (before, origin/main 4e6ef171, release on port 5740, headless Chrome, 1280x800)

How the pilot switches: Shift+G makes the course (Wroclaw: 19 gates in 21 s from the page load); V cycles off -> over the
scan -> voxels only; the walls chip "Walls 5 cm" on the credit line (bottom left) opens the walls and voxel panel with the
same three choices. The probe sets the mode through window.__gsfpv.voxels.setMode, the same call the panel makes.

How it is drawn (read in the page, U:/Temp/gsfpv-train2/voxview/depth-before.json): layer order
0 World opaque, 1 Depth, 2 Skybox, 3 World transparent, 4 Immediate, 5 Immediate transparent, 6 UI; the voxel layer
"GSFPV Voxels" is inserted after World transparent with clearDepthBuffer true (packages/render-pc/src/voxel-overlay.ts:111),
materials depthTest true, depthWrite true, wire style BLEND_NORMAL with alphaTest. The gates: render components on layer 0
(World), materials depthTest true, depthWrite true, blend 3 (none). Cause of message 58: the voxel layer clears the depth
the gates wrote and draws after them, so every voxel paints over every gate, whatever their distance.

Distance drawn (voxels only, at the spawn): style wire, opacity 1, 5 cm walls (the stand-in), 934 chunks, 775827 faces,
per voxel to 7.6 m and per 4x4x4 block to 20.0 m (VoxelController.radiusM = 20 in apps/fly/src/voxels.ts:102, face budgets
fineQuads 600000 and coarseQuads 250000); settled in 44.2 s. What cuts the far part: the 20 m radius. The count of cells
the walls data holds against the cells drawn is measured in X2.

Pixels before (eye 2 of the probe, 5 m from gate 1 at yaw 270 deg; A gates and voxels, B voxels alone, C gate alone):
4 points on the gate; point 1 (618,457) gate in front by the rays: A 161,253,89 C 166,255,25 shown; point 2 (672,400) a wall
in front of the gate by the rays: A 156,252,154 B 83,140,143 C 166,255,25: the gate is shown through the wall (wrong);
point 3 (618,343) gate in front: A 165,255,44 shown. Eye 1 gave 0 points (probe fault X1.4a). What a person sees in
voxview-depth-2-before-marked.png: the lime next gate floats over the wire walls in full, also its right edge that stands
behind a wall, and the wire lines cross the rings, so nothing tells which is nearer.

Panel before (U:/Temp/gsfpv-train2/voxview/panel-before.json): no close control at any size; the menu is 250x463 px at
every size, overflow visible (does not scroll); at 844x390 its rectangle is top 105, bottom 569: out of the view; Esc
closes it at all four sizes; the chip closed it only at 844x390 in the probe's click.

## Left

X1.4 to X1.8 above, then stage X2.
- Seen, not in this list: packages/sonic-fpv shows as modified in git status (the submodule's checkout differs from the
  pin); not touched and not committed by this lane.

## For the lead

- Changed outside the voxel view: apps/fly/src/walls.ts (the panel's header, fold, close, placement: the block that
  builds 'walls-more'), apps/fly/src/fly.css (.walls-menu and the new .walls-head rules), tools/bench/src/a1-api-check.ts
  (five public members in USED). apps/fly/src/course/view.ts is NOT changed: its materials already have depthTest and
  depthWrite true; the depth comes from the copies in the voxel overlay.
- What each thing drawn in the scene does (V1): the gates and the arrows between them (course/view.ts, World layer) and
  other pilots' drones (rooms/remote-stage.ts, World layer) and the sound mode's shapes give their depth to the voxels
  (depth-only copies), so they hide voxels behind them and are covered by voxels in front of them. The guide chip is a
  DOM element on the screen, not in the scene: always on top. The editor's handles are DOM on the screen too (no render
  component in apps/fly/src/course/editor): they stay on top by design. The collision ceiling's plane is in the voxel
  layer itself (unchanged).

## Not verified

- Nothing was built yet for V1 or V4; the measures above are of the old code only.
