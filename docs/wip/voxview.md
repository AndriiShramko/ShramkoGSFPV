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
- [x] X1.7a Esc and chip (commit 6988977b): Esc closes the open panel and only the panel (keydown in capture,
  apps/fly/src/walls.ts); the chip closes it (a real click: open true -> false at 1366x768 and 844x390, script
  U:/Temp/gsfpv-train2/voxview/chipdbg.mjs; the "before" chip failure was the probe's forced open, not the page).
- [x] X1.7b Panel probe after (release 6988977b, port 5740, rendering off, U:/Temp/gsfpv-train2/voxview/panel-after.json):
  menu rectangle l,t,r,b and close button at 1366x768 16,168,296,684 close 245,175 44x44; 1280x720 16,120,296,636;
  844x390 16,105,296,382 (content 514 px in 275 px, scrolls); 390x844 16,217,296,733. At every size: menu in view,
  close in view and on top (elementFromPoint), close button, Esc and chip each close it. Pictures voxview-panel-1366.png
  (the panel above the chip, name, minus and cross at its top right; its lower edge covers part of the credit line, the
  chip stays free) and voxview-panel-844.png (under the chip at the top, header and cross visible, the rest scrolls)
  in U:/Temp/gsfpv-train3/shots, looked at.
- [x] X1.7c (superseded by X1.7e, which ran the fixed probe) Depth probe after (release 6988977b, Wroclaw 70b50d42, 18 gates after Shift+G in 19 s, 4 min under the lock,
  U:/Temp/gsfpv-train2/voxview/depth-after.json): depthItems 36 (the gates' and arrows' copies). Eye 2 (12 m from gate
  1, yaw 285, voxels alone): 7 sample points that the rays put behind a wall, 7 right, none shows the gate; marked points
  1 (506,375) A 69,117,121 B 69,117,121 C 166,255,25 and 2 (519,378) A 63,107,111 = B (wall shown, gate hidden; before
  the fix the same kind of point showed the gate through the wall). voxview-depth-2-marked.png looked at: the wall is
  solid wire (dim faces, bright edges), the next gate (lime) stands behind the building corner and only its outer edge
  shows past it; the teal gates and orange arrows in the street stand in front of the floor voxels, which show through
  their rings. Eye 1 (5 m, used also for the over-the-scan picture) faced away again (guide: gate behind at 147 deg),
  so voxview-depth-1.png and voxview-depth-scan.png have 0 points: probe fault, fixed in this commit (the yaw is chosen
  by the guide's bearing after 1.2 s; the camera follows the held yaw with a lag), not yet run.
- [x] X1.7d Probe aim found by measure (U:/Temp/gsfpv-train2/voxview/aimdbg.mjs, aimdbg.log): with a course on, the
  camera follows the game aim (apps/fly/src/app/builtin/play.ts: yawDeg = g.aimYawDeg), not the held quaternion; the
  camera forward stayed 1,0,0.06 at held yaws 0/90/180/270. The probe's aim now carries yawDeg = -yaw (this commit).
- [x] X1.7e Depth probe after (release 6988977b, Wroclaw 70b50d42, U:/Temp/gsfpv-train2/voxview/depth-after3.json and
  depth-after4.json, the probe now also takes the scan alone at the same eye). Voxels alone: run 3 eye 1 (8 m) 8 of 8
  right (8 behind a wall, none shown), eye 2 (12 m) 10 of 10 right (8 in front shown, 2 behind hidden); run 4 eye 1
  (16 m) 12 of 12 (6 in front shown, 6 behind hidden), eye 2 12 of 12 (12 in front shown). Marked pixels run 4 eye 1:
  (631,384) in front A 66,102,10 = C, B 0,0,0; (623,400) behind A 78,132,136 = B (wall), C gate. Run 3 eye 2: (640,376)
  in front A 166,255,25 = C, B 59,101,104; (622,412) behind A 25,43,48 = B; (640,424) in front A 166,255,25 = C.
  Over the scan (run 4 eye 1): 6 of 6 in front shown, 6 of 6 behind ALSO shown, e.g. (623,400) A 162,253,75 (gate);
  the scan alone (voxels off, same eye, voxview-depth-scanonly.png) shows the same 6 behind points: A 166,255,25.
  So over the scan the gate behind a wall shows because the scan's splats do not hide it, with or without voxels.
  Pictures looked at: voxview-depth-1-marked.png (run 3: the gate edge-on behind a tree trunk, the trunk hides it, only
  a sliver past the trunk's edge shows); voxview-depth-2-marked.png (run 3: the lime gate in front of the far wall in
  full, its lower left hidden by a nearer low wall; the teal gate on the left hides the voxels behind it);
  voxview-depth-scan-marked.png (run 3: over the scan the lime gate is drawn over the tree trunk in front of it: wrong,
  see Left 1). Run 4 overwrote the same file names. The guide chip: "Gate 1 (dot) 8 m" (hook shown false: in frame, near).
- [x] X1.8 Typecheck apps/fly and packages/render-pc: 0 errors. a6-reference, voxview-panel, voxel-depth tests: 10
  passed. gates.py --only vitest,architecture,i18n,b18,leaks (U:/Temp/gsfpv-gates-20261115-215628): architecture,
  i18n, b18, leaks PASS; vitest FAIL in tools/bench/test/app-dji-rc2.test.ts only ("answers 60 ms late ... 1097ms",
  a real-timer test of the input lane, run beside a browser probe; not touched here). Python: the gates need
  C:/Users/andri/AppData/Local/Programs/Python/Python311 on PATH (no "python" on PATH in this shell).
  vitest re-run alone (no probe beside it, this commit): PASS, 116 s, U:/Temp/gsfpv-gates-20261115-221113; so the
  app-dji-rc2.test.ts failure was load from the probe beside it.
- [x] X1 closed (this commit). The gate behind a wall over the scan is handed to the lead (For the lead, item 3):
  its cause is in the splat drawing (packages/render-pc/src/renderer.ts, accum.ts), outside this lane.
- [x] X2.1 Release build of f7064fd6 (node scripts/build-release.mjs, sha256 d96c4708b187...), log
  U:/Temp/gsfpv-train2/voxview/build-x2a.log. Not yet served nor run in a browser (dist/walls not copied yet).
- [x] X2.2 Measured the walls data (tools/bench/scripts/voxview-cells.ts, Node, no browser, Facts X2):
  Wroclaw stand-in 70b50d42 holds 27236 occupied chunks; the old view plans at most the 20 m radius (934 chunks in X1).
- [x] X2.3 Built (this commit), not yet run in a browser: far levels 2 and 3 (cubes of 8 and 16 voxels) in
  packages/collision/src/mesh.ts (buildChunkBlockFaces option merge) and overlay.ts (COARSE_LEVELS, overlayLevels,
  levelCellVoxels; planChunks option whole: no radius, past the fine and block budgets level 2 while farQuads lasts,
  then the coarsest level for every remaining chunk; ChunkPlan.perLevel, farQuads). apps/fly/src/voxels.ts: the
  view of voxels alone (no preview) plans the whole scene; a feed keeps the worker busy after each chunk (before, at
  most 4 chunks were asked per 150 ms plan); in the whole view no chunk is removed before its new level lands; stats
  whole, wallChunks, plannedChunks, drawnChunks, share, perLevel, farthestM, drawnFarM, detail, frameMs.
  V3 keeper apps/fly/src/voxel-keeper.ts (pure): a mean frame over 40 ms in a 1 s look halves the share of the
  budgets (floor 1/8), 4 looks in a row under 20 ms double it; all three numbers are estimates, not measured on a
  weak device. The share multiplies fineQuads, coarseQuads and farQuads (250000, estimate); the coarsest level is
  never cut. Hook voxels.setDetail(d) forces the share (apps/fly/src/app/test-hook.ts, app/builtin/voxels.ts).
  Walls line: voxels.statusWhole in packages/i18n/locales/fly/{en,es,pl,ru}.json ("... the whole scene: {share}%
  drawn, to {m} m ...").
- [x] X2.4 Unit tests: packages/collision/test/voxview-whole.test.ts (6: far cubes cover every wall cell = merged
  brute-force faces at merge 1, 2, 4; cube edges on 16-voxel lines; every occupied chunk planned once at any radius
  and budget; nearest at level 0, levels never finer with distance; a smaller budget moves chunks coarser, none
  leave) and tools/bench/test/voxview-keeper.test.ts (3). With overlay.test.ts: 23 passed. Negative control: with
  origin/main overlay.ts and mesh.ts, 6 of 6 fail (5 by assertion, e.g. "expected 7186 to be 656", "expected +0 to
  be 144"; one TypeError reading lod). The keeper is a new file (no old version to put back). Typecheck apps/fly and packages/collision: 0
  errors each.

## Facts X2 (measured, Node)

tools/bench/scripts/voxview-cells.ts on U:/Temp/gsfpv-train2/walls/release/70b50d42/v1 (51 s, result
U:/Temp/gsfpv-train2/voxview/cells-70b50d42.json): 5 cm voxels, grid 5908 x 496 x 7508 voxels = 295 x 25 x 375 m,
324781154 solid voxels, 8611537 solid blocks, chunk 48 voxels (2.4 m), 124 x 11 x 157 chunks, 27236 occupied.
Whole scene quads: level 1 (blocks of 4) 5487897 (worker time 19.3 s in Node), level 2 (8 voxels) 1472858 (10.1 s),
level 3 (16 voxels) 489565 (11.5 s). So the whole scan at level 3 is about 1 M triangles but 27236 chunks; one mesh
instance per chunk may make the draw calls the limit (a guess, not measured: measure the frame time first, X2 left 1).

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

Stage X2-whole-scene, in this order (the code of X2.3 is committed, nothing of it was seen in a browser yet):
1. Rebuild the release (dist holds f7064fd6, without X2.3), copy U:/Temp/gsfpv-train2/walls/release into dist/walls,
   serve on 5740. Measure with BENCH_UNCAPPED=1 on Wroclaw 70b50d42 in the voxels-alone view (key V twice): cells
   and chunks drawn (stats wallChunks, plannedChunks, drawnChunks, perLevel, farthestM, drawnFarM), frame time at the
   spawn and 60 m up, time from the switch to share 100. The "before" numbers come from origin/main's release (a
   second build or the X1 facts: 934 chunks to 20 m). A new probe is needed (voxview-depth-probe.mjs has the open,
   the hold and the stats; add a --far mode with the 60 m eye, the street eye and setDetail(0.125)).
2. If the frame time with 27236 chunk meshes is too long (draw calls), merge far chunks into group meshes (a level
   3 chunk of 4x4x4 chunks is a chunk of 192 voxels: overlayChunk works on it with merge 4), keyed apart from the
   chunks; only then.
3. Tunis 887f27aa (no published walls: the walls build themselves, 5 cm): the same numbers.
4. Pictures voxview-far-before.png, voxview-far.png, voxview-street.png, voxview-tunis.png, each looked at.
5. The weak device: setDetail(0.125) and show the far part stays (drawnFarM, perLevel).
6. accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (SITE=http://localhost:5740/en), walls-published-probe on the
   local copy, typecheck apps/fly and packages/collision, gates.py --only vitest,architecture,i18n,b18,leaks,
   a6-reference. Status: What the owner does, Not verified, For the lead.
- Seen, not in this list: packages/sonic-fpv was checked out at b05aeda (not the pin 293ebae) in this worktree; X1 put
  it back on the pin with git submodule update (clean working tree, nothing lost).

## For the lead

- Changed outside the voxel view in X2: packages/collision/src/mesh.ts (buildChunkBlockFaces option merge; facesFromOcc
  takes any cell size) and packages/collision/src/overlay.ts (far levels, whole-scene plan): not vendored files;
  apps/fly/src/app/test-hook.ts (voxels.setDetail in the hook type); packages/i18n/locales/fly/{en,es,pl,ru}.json
  (voxels.statusWhole).
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
- Over the scan, a gate behind a scan wall shows through it, with the voxels on AND with them off (X1.7e: 6 of 6
  points behind a wall show the gate colour 166,255,25 in the scan alone). The voxels-only view is right (12 of 12).
  The cause is in how the splats share depth with the World opaque items (packages/render-pc/src/renderer.ts and
  accum.ts: which splat drawing is active and whether it is depth-tested against the gates); not measured further,
  outside this lane. Options for the lead: accept the scan's own behaviour over the scan; or let the voxel overlay
  hide gate pixels behind voxel faces in the over-the-scan view (voxel faces depth-only, then full-colour copies of the
  gates after them, with the World gates hidden in that mode: needs a change in course/view.ts beyond depth settings).

## Not verified

- No weak device and no touch device were used. The depth was proven on Wroclaw only (Tunis 887f27aa not run in X1).
