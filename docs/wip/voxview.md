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
- [x] X2.5 Release builds (this run): dist of 6d2da583 (sha256 d21624ca2d74...) kept as
  U:/Temp/gsfpv-train2/voxview/dist-x2; "before" = the same tree with the X2 sources of f7064fd6 put back (sha256
  9532f0faab64..., U:/Temp/gsfpv-train2/voxview/dist-before), both with the stand-in walls in walls/, served by
  serve-csp on 5740 (after) and 5741 (before). Probe tools/bench/scripts/voxview-depth-probe.mjs --far (commit
  9aa094ed and this commit: the 60 m eye looks down with pitch -40, game.ts GIMBAL_MIN_DEG -60 says negative is down).
- [x] X2.6 Measured on Wroclaw 70b50d42 in the browser, voxels alone, BENCH_UNCAPPED=1, 1280x800 (Facts X2 browser).
  Pictures looked at (U:/Temp/gsfpv-train3/shots): voxview-far-before.png, voxview-far.png, voxview-street.png,
  voxview-far-weak.png.
- [x] X2.7 Left 1, 2, 4 built (this commit), not yet run in a browser. Group meshes: packages/collision/src/overlay.ts
  FAR_GROUP (level 1: groups of 2 chunks a side; level 2: 4 then 2; level 3: 8, 4, then 2), groupKey/groupOfKey
  (negative keys), overlapKeys, groupPlan (a group is one mesh when every occupied chunk in its area is at its level;
  a mixed area falls back to the next smaller side), planChunks option groups (the whole view). Measured with
  tools/bench/scripts/voxview-cells.ts --plan on the Wroclaw stand-in from the grid's centre
  (U:/Temp/gsfpv-train2/voxview/plan-groups.json): 27236 chunks (per level 400 / 1666 / 6666 / 18504) -> 5993
  meshes with {2:2, 3:4}, 4920 with {1:2, 2:2, 3:4}, 5461 with {1:2, 2:4, 3:8}, 2852 with the fallback sides
  (per level 400 / 593 / 1038 / 821). The worker builds a group as one chunk of side x size voxels
  (apps/fly/src/voxels.worker.ts, message field group). apps/fly/src/voxels.ts: in the whole view a mesh leaves
  only when the wanted meshes over the same chunks are on screen (overlapKeys); groups stay out of the per-chunk
  size averages; uploads per frame 8 in the whole view (WHOLE_UPLOADS_PER_FRAME, estimate; the 20000-face cap per
  frame stays). Share: apps/fly/src/voxel-keeper.ts drawnShare counts chunks on screen at their planned level
  (a mesh in the upload queue is not counted, VoxelOverlay.pending), groups by their members; stats
  meshesPerLevel. Tests: packages/collision/test/voxview-whole.test.ts (+6) and tools/bench/test/voxview-keeper.test.ts
  (+2), with overlay.test.ts 31 passed. Negative controls: the overlay.ts of 97b62626 has no groupPlan (TypeError,
  no assertion possible); groupPlan without its one-level check fails "expected 8 to be 7"; drawnShare counting a
  group as one chunk fails "expected 3 to be 10". Typecheck apps/fly, packages/collision, packages/render-pc: 0 errors.
- [x] X2.8 Time left in the walls line (commit 3be318ba): voxels.fillLeft in packages/i18n/locales/fly/{en,es,pl,ru}.json
  appended to voxels.statusWhole while the share is under 100; apps/fly/src/voxel-keeper.ts fillLeftS (test +1,
  mutation control: dividing by 100 instead of the share fails "expected 2 to be 6"); the share is 0 before the
  first plan (it read 100 while the grid was prepared). a6-reference PASS; gates.py --only architecture,i18n,b18,leaks
  PASS (U:/Temp/gsfpv-gates-20261115-234714).
- [x] X2.9 Browser after (release 854214b2 and 3be318ba, port 5742, Facts X2 after). Pictures looked at:
  voxview-far.png, voxview-street.png, voxview-far-weak.png (Wroclaw), voxview-tunis.png.

- [x] X2.10 Time left from the meshes' pace of the last 2 s (commits 41d67990, 8febc1b2, 80a27f9a; Left 1).
- [x] X2.11 accept-fly B6-B16 (10 PASS), walls-published-probe (3 pass), typecheck, a6-reference, gates (Left 2).
- [x] X2 closed (this commit). Every stage of the lane is finished.

## Facts X2 after (release 854214b2 / 3be318ba, voxels alone, BENCH_UNCAPPED=1, 1280x800, port 5742)

Results U:/Temp/gsfpv-train2/voxview/far-x2c.json, far-x2c-weak.json, far-x2d-tunis.json, far-x2d.json (logs beside).
- Wroclaw 70b50d42, street eye: 27236 of 27236 wall chunks on screen, to 231 m (the farthest wall chunk), chunks per
  level 158 / 1145 / 4367 / 21566 in meshes 158 / 423 / 655 / 632 (1868 draws, before 27236), 1.24 M faces. Frame
  6.2 and 6.4 ms mean (p95 17-18) against 28.5 ms before; the scan alone 5.4 to 7.2 ms. From the switch to the far
  end on screen: 16.5 s (3be318ba; the first 7 s prepare the grid, share 0) and 10.2 s (854214b2), before 214.6 s.
  Share over time (3be318ba): 2 % at 9.2 s, 19 % at 11.3 s, 71 % at 14.4 s, 96 % at 15.5 s, 100 % at 16.5 s.
- Wroclaw 60 m up, looking down 40 deg: 27236 chunks to 236 m, meshes 174 / 478 / 1089 / 877, frame 9.9 ms (p95 34)
  against 33.3 ms before; the swap after the move took 4.2 s, share 77 % to 100 %, the far part stayed drawn.
- Weak device forced (voxels.setDetail(0.125), the keeper's floor, 60 m up): 27236 chunks to 236 m, per level
  48 / 110 / 458 / 26620, meshes 48 / 102 / 331 / 660, 0.38 M faces, frame 9.6 ms (p95 34). The far part stays.
- Tunis 887f27aa (shipped 5 cm walls), street eye: 5340 of 5340 chunks to 116 m, per level 417 / 1455 / 3468 / 0,
  1048 meshes, frame 3.6 ms (scan alone 5.6 ms), full 5.1 s after the switch. 60 m up: 5340 to 130 m, 1540 meshes,
  frame 5.1 ms, swap 3.0 s.
- V3 rule (apps/fly/src/voxel-keeper.ts): a mean frame over 40 ms in a 1 s look halves the near budgets' share (floor
  1/8), 4 looks in a row under 20 ms double it; the coarsest level always holds every chunk. On this PC the frames
  stay 4 to 10 ms, so the keeper never acted; its thresholds are estimates (no weak device was used).
- Pictures (U:/Temp/gsfpv-train3/shots), looked at: voxview-far.png (60 m over Wroclaw: the whole city in voxels to
  the horizon, only courtyards and the sky black; voxview-far-before.png showed a patch under the craft only);
  voxview-street.png (near walls per voxel, the street's far end filled with larger cubes, no hole);
  voxview-far-weak.png (same coverage as voxview-far.png, coarser near ground); voxview-tunis.png (60 m over Tunis:
  the whole old town in voxels to the scan's edge).

## Facts X2 (browser, Wroclaw 70b50d42, stand-in 5 cm walls, BENCH_UNCAPPED=1, 1280x800)

Results U:/Temp/gsfpv-train2/voxview/far-before.json, far-before2.json, far-x2a.json, far-x2b.json (logs beside them).
Frame time = mean and p95 of requestAnimationFrame gaps over 3 s.
- The scan alone at the spawn: 6.0 to 7.2 ms mean, p95 18 ms (all runs).
- Before (X1 code), street eye: 934 chunks, 775827 faces, to 20.0 m, settled 42.5 s, frame 4.1 ms (p95 17.5).
  60 m up looking down 40 deg: 1116 chunks, 849567 faces, to 59.5 m, settled 49.6 s, frame 7.4 ms (p95 18.1).
- After (X2 code), street eye: every one of the 27236 wall chunks drawn (wallChunks = plannedChunks = drawnChunks
  = meshes 27236), farthest wall chunk 231 m and drawn to 231 m, per level (0 per voxel, 1 blocks of 4, 2 cubes of
  8, 3 cubes of 16) 158 / 1125 / 4314 / 21639, 1486364 faces; meshes on screen over time 3313 at 20 s, 11281 at 61 s,
  19495 at 123 s, 26575 at 205 s, all at 214.6 s. Frame 28.5 ms mean, p95 56.1.
  60 m up: 27236 chunks, to 235.7 m, per level 174 / 943 / 4349 / 21770, 1489480 faces, frame 33.3 ms (p95 57.6).
- Weak device forced (voxels.setDetail(0.125), 60 m up): the far part stays: 27236 chunks, to 235.7 m, per level
  48 / 123 / 470 / 26595, 612267 faces; frame 30.1 ms (p95 59.2), the same as at full detail (29.5 ms).
- So the frame cost is the number of meshes (27236 draw calls), not the faces: 1.49 M -> 0.61 M faces changed nothing.
  The keeper saw 27 to 31 ms and did not act (its rule acts over 40 ms).
- The share in the walls line is wrong: it read 100 % at 25 s while 4325 of 27236 meshes were on screen. It counts
  the worker's results (apps/fly/src/voxels.ts stats(): loaded is set when a result arrives, line 530), not the
  uploads; the uploads wait in the overlay's queue at most 2 per frame (packages/render-pc/src/voxel-overlay.ts:117
  maxUploadsPerFrame = 2; level 3 chunks hold about 23 faces each, so the count cap, not the 20000-face cap, rules).
- Pictures: voxview-far-before.png (60 m up, before): only a patch of voxels right below the craft, black everywhere
  else. voxview-far.png (same eye, after): the whole city in voxels to the horizon, near streets fine, far blocks as
  larger cubes, floaters in red. voxview-street.png (street eye, after): the near walls per voxel, the street's far
  end now filled with walls and two more gates in it, where the before picture (voxview-before-street.png) had
  black holes past 20 m. voxview-far-weak.png (detail 0.125): the same coverage as voxview-far.png, the near
  ground in coarser cubes.

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

Stage X2-whole-scene: closed (this commit); nothing left in this lane. Done items kept for the record:
1. [x] Time left from the pace of the last 2 s (this commit): apps/fly/src/voxel-keeper.ts fillLeftS(samples, now,
   share) and trimFillSamples, FILL_PACE_MS 2000 (estimate); apps/fly/src/voxels.ts keeps the readings; falls back to
   the pace since the start when the last 2 s brought nothing. tools/bench/test/voxview-keeper.test.ts 9 passed;
   control with the voxel-keeper.ts of HEAD: "expected null to be 37", "expected null to be 9". Probe midLine picks
   the text with "drawn,". Typecheck apps/fly 0 errors. Browser rerun on 70b50d42: item 1b.
1b. [x] Rerun on release 41d67990 (sha256 bb32ce7c27b5..., port 5742, FAR_PHASES=spawn, BENCH_UNCAPPED=1,
   U:/Temp/gsfpv-train2/voxview/far-x2e.json): full at 16.5 s (27236 of 27236 chunks to 231 m, 1889 meshes),
   frame 7.6 ms (scan alone 7.1). Time left by the chunk share's 2 s pace: 202 s at 1 % (9.2 s), 40 s at 5 %,
   12 s at 16 %, 11 s at 20 %, 4 s at 48 %, 1 s at 73 %; real: 7.3, 6.2, 5.2, 4.2, 2.1, 1.1 s. Still too high
   early: the share counts chunks, the fill is paced by meshes (281 of 1889 meshes at 1 %). From the same series
   the mesh count gives about 11 s at 1 % and 4 s at 5 % (worked by hand, an estimate).
1c. [x] The pace is read from the share of meshes on screen (this commit): drawnShare returns meshShare
   (apps/fly/src/voxel-keeper.ts), apps/fly/src/voxels.ts feeds it to fillLeftS; the walls line's percent stays the
   chunk share. Test +1 (10 passed); control with the HEAD voxel-keeper.ts: `expected undefined to be 50`.
   Typecheck apps/fly 0 errors.
1d. [x] Rerun on release 8febc1b2 (sha256 88f50793dd63..., port 5742, FAR_PHASES=spawn, BENCH_UNCAPPED=1,
   U:/Temp/gsfpv-train2/voxview/far-x2f.json): full at 12.2 s after the switch (27236 of 27236 chunks to 231 m,
   1854 meshes), frame 9.5 ms mean (p95 34). Time left by the mesh pace: none shown at 1 % (7.1 s, first reading),
   3 s at 12 % (8.2 s, real 4.0), 1 s at 24 % (real 3.0), 1 s at 61 % (real 2.0), 1 s at 97 %. So it now runs
   slightly short instead of 27 times too long.
2. [x] accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 on the release 8febc1b2 (SITE=http://localhost:5742, its first
   line "accept-fly target: http://localhost:5742", it took the GPU lock itself): all 10 PASS
   (U:/Temp/gsfpv-train2/voxview/accept-fly-x2.log; its evidence files under evidence/2026-11-15, the UTC date, b-fly-*.json, are left untracked).
   walls-published-probe on the local copy (GPU lock, U:/Temp/gsfpv-train2/voxview/walls-published-x2.json):
   70b50d42, ab5efa0e, d10c5638 pass, published walls 200, no build, 20 tunnel passes and 0 penetrations each (the
   other 6 stand-in ids not flown). Typecheck apps/fly, packages/collision, packages/render-pc: 0 errors each.
   a6-reference: 1 passed. gates.py --only vitest,architecture,i18n,b18,leaks (U:/Temp/gsfpv-gates-20261116-010127):
   vitest 189 s, architecture, i18n, leaks PASS; b18 failed on the word for a missing value in this file's record of
   a test message; quoted as code, b18 alone PASS (U:/Temp/gsfpv-gates-20261116-010542).
3. [x] Status: What the owner does, Not verified, For the lead (this commit).
- Seen, not in this list: packages/sonic-fpv was checked out at b05aeda (not the pin 293ebae) in this worktree; X1 put
  it back on the pin with git submodule update (clean working tree, nothing lost).

## For the lead

- Changed outside the voxel view in X2: packages/collision/src/mesh.ts (buildChunkBlockFaces option merge; facesFromOcc
  takes any cell size) and packages/collision/src/overlay.ts (far levels, whole-scene plan): not vendored files;
  apps/fly/src/app/test-hook.ts (voxels.setDetail in the hook type); packages/i18n/locales/fly/{en,es,pl,ru}.json
  (voxels.statusWhole, voxels.fillLeft); packages/render-pc/src/voxel-overlay.ts (pending(key)).
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

## What the owner does

1. Open a scan (Wroclaw 70b50d42 or Tunis 887f27aa) and press Shift+G for a course, or just fly.
2. Press V twice (off -> over the scan -> voxels only), or press the walls chip on the credit line at the bottom left
   and choose "Voxels only". The whole scan appears in voxels: the near streets per voxel at once, the far part in
   larger cubes within seconds; the walls line in the panel says how much is drawn ("the whole scene: 61% drawn,
   to 231 m") and about how many seconds are left, then 100 %.
3. Fly. A gate in front of a wall hides the wall; a gate behind a wall is hidden by it. The guide chip at the top
   still points to the next gate.
4. The panel: the minus folds it, the cross at its top right closes it, Esc closes it, the chip closes it too. On a
   small screen it stays inside the view and scrolls inside itself.
5. On a weak laptop nothing to do: if frames get slow, the near detail is lowered by itself; the far part stays.

## Not verified

- No weak device and no touch device were used: the weak case was forced (voxels.setDetail(0.125)) on this PC
  (i9-7980XE, frames 4 to 10 ms), so the keeper's thresholds (40 ms, 20 ms, floor 1/8) are estimates that never
  acted on a real slow frame.
- The depth (V1) was proven on Wroclaw only (Tunis 887f27aa not run for depth). Over the scan a gate behind a scan
  wall shows (For the lead, item on the splats).
- The time left was measured on Wroclaw from the street only; at 1 % no number is shown yet (one reading).

## voxview2 (stage V1-review: an independent review of lane voxview after the merge of origin/main)

Branch voxview, worktree C:/dev/gsfpv-site-sound, ports 5740-5759 (server on 5745). Release of the merge e47427ca
(node scripts/build-release.mjs, sha256 5e45a33549bb..., stand-in walls U:/Temp/gsfpv-train2/walls/release copied
into dist/walls, 9 scans). Logs and JSON under U:/Temp/gsfpv-train2/voxview2/, pictures in U:/Temp/gsfpv-train3/shots.

### Status (voxview2)

- [x] R1 Merge origin/main c1893e12 (commit e47427ca, no conflict); packages/sonic-fpv on its pin 293ebae; typecheck
  apps/fly, packages/render-pc, packages/collision 0 errors each; release build e47427ca with the stand-in walls.
- [x] R2 The branch touches nothing in the generator, packages/tracks, apps/fly/src/course/editor, apps/fly/src/sonic or
  apps/fly/src/rooms (git diff --name-only 4e6ef171 b7de2b80: none of these paths).
- [x] R3 Probes (commits 51c4be9f, b14f5070): tools/bench/scripts/voxview2-probe.mjs (per frame, the visible World render
  items without a visible depth copy; Esc with the panel open in a flight, a pause and the edit mode; pictures) and
  tools/bench/scripts/voxview-depth-probe.mjs --far takes FAR_UP_M (the height of the 'up' phase) and reads the JS heap.
- [x] R4 VR-1 / V7: a change made before the measurement (15f881d8) was reverted after R5 showed no fault (see Findings).
- [x] R5 Browser review run on Wroclaw 70b50d42 (release e47427ca, port 5745, 1280x800, BENCH_UNCAPPED=1, GPU lock
  02:05:13-02:05:54; U:/Temp/gsfpv-train2/voxview2/review-wroclaw.json and .log). Numbers in Findings VR-1, VR-2.
- [x] R6 V6 build (this commit): the depth copies are synced in every update while the voxels show.
  packages/render-pc/src/voxel-depth.ts (DEPTH_SYNC_EVERY 1, depthSyncDue), voxel-overlay.ts update();
  test packages/render-pc/test/voxview2-depth-sync.test.ts (1 test, 24 cases); control with the voxel-depth.ts of
  a884e8ff: "expected 'undefined' to be 'function'". voxel-depth.test.ts 2 passed. Typecheck packages/render-pc,
  apps/fly 0 errors. Browser after: not yet run (Left).
- [x] R6b Release c2de1b6c (sha256 5169e65da53f..., stand-in walls in dist/walls), port 5745, BENCH_UNCAPPED=1, GPU lock
  02:12:43-02:14:04. voxview2-probe on Wroclaw (U:/Temp/gsfpv-train2/voxview2/review2-wroclaw.json): start 0 of 1807
  frames without a depth copy (189 items); edit mode, 4 arrow presses 0 of 115/148/183/153 frames, Tab 0 of 267; Esc
  in a flight, a pause and the edit mode closes only the panel (3 of 3). Frame with the voxels alone, whole scene at
  the street (voxview-depth-probe --far, FAR_PHASES=spawn, far2-wroclaw.json): mean 7.2 ms, p95 18.3 ms, against the
  scan alone in the same run 7.3 / 18.3 ms (lane X2's run before the every-frame sync: 6.2 ms); full in 11.2 s,
  27236 of 27236 chunks, JS heap 439 MB.
- [x] R6c VR-6 (this commit): fly.css hides the voxel legend in the edit view (body:has(.course-editor:not(.ce-flying)));
  test tools/bench/test/voxview2-legend.test.ts (2 passed); control with fly.css of origin/main: "expected undefined
  to be defined". Panel probe (--panel) has an edit-mode pass (Shift+G, Shift+B, panel open: the editor window, top
  bar and gate bar against the panel, its cross and the legend). Browser after: R8.
LEFT (voxview2, exact, in this order):
- [ ] R7 Lublin 2f1ddf5f voxels alone at the spawn and 140 m up (far probe, FAR_PHASES=spawn,up FAR_UP_M=140);
  Housefly d10c5638 (its walls are in the stand-in set).
- [ ] R8 Depth probe on Wroclaw and Tunis 887f27aa; panel probe at the four sizes; pictures voxview2-start.png,
  voxview2-edit.png, voxview2-lublin.png looked at.
- [ ] R9 accept-fly B6 B7 B9-B16, pause-over-course-probe, mouse-free-probe, editor3-smoke, walls-published-probe,
  typecheck, gates.py --only vitest,architecture,i18n,b18,leaks, a6-reference.
- [ ] R10 Frame time on Wroclaw with the view off, branch against main (BENCH_UNCAPPED=1).

### Findings (voxview2)

- VR-1 (V7, NO fault, measured; the change was a guess and is reverted): apps/fly/src/walls.ts:184-190 closed the panel on Esc with
  stopPropagation in a window capture listener. The edit mode listens on the window in the capture phase too
  (apps/fly/src/course/editor/view-mouse.ts:182, top-bar.ts:61); stopPropagation does not stop other listeners of the
  same target, so one Esc closed the panel AND left the edit mode. Now apps/fly/src/ui/voxel-panel.ts panelEsc uses
  stopImmediatePropagation. Measured on the release e47427ca (R5): Esc with the panel open closed only the panel in a
  flight (no pause opened), in a pause (the pause menu stayed) and in the edit mode (edit mode stayed open); Esc
  without the panel opened the pause, a second Esc closed it. So V7 holds on the code as it was (the edit mode does not
  act on that Esc; why was not read). 15f881d8 reverted; nothing changed for Esc.
- VR-2 (V6, real, measured, fixed in R6): packages/render-pc/src/voxel-overlay.ts:416 syncs the depth copies every 10th
  update. A copy shares the node of its source, so a gate whose node moves keeps its depth in the same frame; but
  apps/fly/src/course/view.ts:346-372 destroys and makes anew the number plate and the chevrons at every change of the
  next gate, and show() makes all gates anew: such items are drawn without depth for up to 9 frames. Measured (R5, Wroclaw, 32 gates, voxels alone): in a flight
  0 of 1858 frames lacked a copy (157 items); in the edit mode each arrow press rebuilt all gates and 10, 9, 7 and 3
  frames (of 104-190 counted after each press) had ALL 156 items without a depth copy; Tab to the next gate 5 frames
  with 146 of 146 missing. A pilot sees the voxels paint over every gate for those frames (a flicker after each edit).
- VR-3 (no fault, code read): the gates, banners, plates and chevrons are opaque unlit materials (course/view.ts
  214-250: no blend, no alpha test), so a full depth copy of them hides exactly what they cover.
- VR-4 (no fault by code read; frame time not yet measured, R10): with the voxel view off the overlay is not made
  (apps/fly/src/voxels.ts:366, made on the first switch on); after a switch off both layers are disabled and the copies
  dropped (voxel-overlay.ts:253-258); update() syncs only while the voxel layer is on.
- VR-5 (to be seen in voxview2-edit.png): the edit mode's handles are PlayCanvas gizmos in their own layer
  (view-mouse.ts:109, Gizmo.createLayer), not in World, so they get no depth copy and stay on top of the voxels.
- VR-6 (real, picture, fixed in R6c): voxview2-edit.png (release c2de1b6c, 1280x800, Wroclaw): in the edit view the
  course editor's window (course/editor/editor.css:3-21, top right, z 30) lies over the voxel legend
  (fly.css:284, top right): the legend's last two lines peek out under the window's header. Now the legend is hidden
  while the edit view is open, as the flight's HUD is (editor.css:223-228, D5); back in the test flight and after Exit.
- VR-7 (by the lead's decision D7, not this lane's file; for the lead): at 844x390 in the edit view a click on the
  'Walls 5 cm' chip opens nothing (course/editor/editor.css:232-234 hides the panel below 500 px height; panel probe
  panel2-before.json: the details is open, the menu has no box). Rule of the owner (an action leads on): the chip
  could say why or leave in the edit view there. Not changed here.
- VR-8 (no fault of the panel; for the lead): at 390x844 in the edit view the gate bar (.ce-gatebar, l 8 r 550) is
  wider than the 390 px view, and the open panel (z 40) lies over its left part; the panel's cross is on top and
  closes it (closeOnTop true). At 1366x768, 1280x720 no edit-mode control touches the panel.
- Doubt D-1 (not shown): a gate hidden behind voxel walls has the guide chip at the top pointing to it (a DOM element,
  always on top); nothing else leads to it. Not measured whether the chip is visible in the edit mode.
