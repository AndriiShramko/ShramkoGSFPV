# Lane walls: walls for every scan

Worktree C:/dev/gsfpv-voice, branch walls (from origin/main 2a5ac433). Ports 5800-5819.

## Status

Stage W3-lead-the-pilot:
- [x] Merge of tracks-edit (d79b5ca4) into walls: clean, no conflict (merge commit a0637555).
- [x] 1-4 code: apps/fly/src/walls-first.ts (ensureWalls, withWalls), WallsHook.build() and .line (walls.ts), app/walls-then.ts wallsThen(ctx, then); the course (Shift+G, menu, Shift+T load, Shift+B edit) builds walls first and goes on; C and V start the build; the ceiling and floater panels build first and open after; the build box keeps in sight in flight while it holds the offer or progress (fly.css .bake-box.keep); texts rewritten in en/es/pl/ru (course.noWalls replaced by course.wallsFirst, new walls.building; bake.done without the voxel count; no {msg} in walls and course entry lines). Test tools/bench/test/walls-first.test.ts 16 passed, NEG OK (origin/main course.ts, builtin walls.ts, voxels.ts, 8 locale files); walls, ladder, published tests 53 passed together; packages/i18n tests 22 passed; apps/fly tsc exit 0. Commit: this one.
- [x] Lead line in the walls box instead of a HUD note over it, no dead button during a build, button back and enabled after a failure (commit e744ad95; tests 40 passed with packages/i18n, tsc exit 0).
- [x] Page probe tools/bench/scripts/walls-chain-probe.mjs (commits 1e792157, 7959a2c1, e744ad95), run under the GPU lock on local releases (port 5800). Wroclaw passes; Forest Floor walls pass, its course does not (Facts W3).
- [ ] BLOCKED, outside this lane: Forest Floor gets walls in 9.8 s, then the course generator answers "nothing fits" at once. Cause: packages/tracks/src/generate.ts COURSE_DEFAULTS (gatesMin 4, spacingM 3 m, sizes in metres) against a scan whose whole walls grid is 6 x 5 x 5.8 m (scene.voxel.json gridBounds). A course on a small scan needs the generator (lane tracks) to scale its gates and legs to the free space, or the course entry to fly the scan at a bigger scene scale; neither is in this lane's files.

Stage W2-published:
- [x] Design (below, The way W2).
- [x] Offline bake tool tools/walls/bake-published.mjs (commit 3e85e9e6): splat-transform 3.6.4 CLI in Node on this PC's RTX 4090 (Dawn), level 0, crop to the dense core read from level 4, 5 / 10 / 20 cm ladder, manifest.json with sizes and sha256.
- [x] Loader order shipped, else published, else the page's build: apps/fly/src/session/loader.ts wallsPlaces / firstWalls / publishedWallsUrl, session wallsFrom, walls.ts source 'published', text bake.source.published in en/es/pl/ru (commit cb473792). Unit test tools/bench/test/walls-published.test.ts 7 passed; negative control NEG OK (loader.ts of 3e85e9e6). apps/fly tsc exit 0.
- [x] Delivery: deploy/nginx.conf location ^~ /walls/ (root /srv/releases, 404 when missing), deploy/release-walls.sh (commit 5dbe2a2f).
- [x] Page probe tools/bench/scripts/walls-published-probe.mjs (commit d2f2015a); run on a local release of 5dbe2a2f with Forest Floor as the stand-in: pass (see Facts W2).
- [~] Offline bakes (results in Facts W2). Done: ab5efa0e, d10c5638, eb5f51dc. Running detached at 22:51 (started by W2 worker 1, nohup): (a) node tools/walls/bake-published.mjs U:/Temp/gsfpv-train2/walls/published-c 70b50d42,9baef54b --voxel 0.1 (log U:/Temp/gsfpv-train2/walls/bake-c.log); (b) the batch ba7aa29d,0230d903,1994c65c,2f1ddf5f into U:/Temp/gsfpv-train2/walls/published-b (log bake-b.log). Read the logs and manifest.json of each dir first; do not start them again while their node processes live (wmic process where "name='node.exe'" get CommandLine | grep bake-published).
- [x] Wroclaw probe: published-d/70b50d42/v1 copied into dist/walls/70b50d42/v1/ of the local release (page code of 5dbe2a2f = branch head, no page change since), serve-csp on 5800, under the GPU lock: walls-published-probe.mjs 70b50d42 d10c5638 -> both pass (Facts W2, U:/Temp/gsfpv-train2/walls/probe-w2-b.json).
- [x] Wroclaw failed at 10 cm too (published/70b50d42/v1/cli-100mm.log, 7 min 28 s): the same "Buffer size (2699252224) exceeds the max buffer size limit (2147483648)" in GpuVoxelization.uploadAllGaussians. That buffer holds every kept Gaussian (16 floats each), so the cell size cannot help: 2699252224 / 64 = 42175816 Gaussians = 97.9 % of level 0 inside the crop. The 10 cm (published-c) and 20 cm (published) reruns were stopped. Fix in tools/walls/bake-published.mjs: levelThatFits picks the finest LOD level whose kept Gaussians fit 2147483648 bytes, and a buffer error steps one level down at the same cell size (isGaussianBufferError). Test tools/bench/test/walls-bake-level.test.ts 5 passed, NEG OK. Commit: this one.
- [x] Rerun with the fix (commit 7a9ead2f): 70b50d42 baked at level 1, 5 cm, 400 s into U:/Temp/gsfpv-train2/walls/published-d. ba7aa29d done in published-b at level 0, 5 cm; the old batch was stopped after it.
- [x] All 9 catalogue scans without shipped walls are baked (Facts W2): 0230d903, 2f1ddf5f (published-e), 9baef54b (published-f), 1994c65c (published-g). The tool now tries a scan again up to 3 times on "fetch failed" and logs its cause. None is left unbaked.
- [x] Gathered into one dir U:/Temp/gsfpv-train2/walls/release/ (9 scans, merged manifest.json, sha256 of every pair re-read and equal to the manifest; 490,725,112 bytes); For the lead filled.

Stage W1-any-size:
- [x] 1. Measure the 13 catalogue scans (tools/bench/scripts/walls-scan-sizes.ts; output U:/Temp/gsfpv-train2/walls/sizes.json). Commit 9105c8c6.
- [x] 3a. The ladder in the page: apps/fly/src/bake.ts planBase / bakeBase / outOfRoom / isRough, level option of bakeCollision; apps/fly/src/walls.ts runBase uses bakeBase; texts bake.stage.lighter, bake.doneRough, bake.noRoom in en/es/pl/ru (bake.doneCoarse removed). Unit tests tools/bench/test/walls-ladder.test.ts (9 tests) with negative control NEG OK. Commit 9105c8c6.
- [x] Pass 2: probe tools/bench/scripts/walls-trials.ts (modes trials and ladder) and the hook __gsfpv.bakeTrial({level, voxelM}) in apps/fly/src/walls.ts (commit 12bcf69c). No walls line names Gaussians or a limit any more: bake.refused removed, bake.refine.refused reworded in en/es/pl/ru, refusedText of the base path gives bake.noRoom; accept-c.ts now expects a build under fake small limits, not a refusal (commit cc852ca1). apps/fly typecheck: no errors besides the known @gsfpv/tracks ones.
- [~] 3b. Ladder run (local release f2cbecd3+12bcf69c, port 5800, U:/Temp/gsfpv-train2/walls/ladder.json): Forest Floor done and stops the drone; Wroclaw did NOT finish in 20 min (see Facts). Next: crop step below, rebuild, rerun ladder.
- [ ] 3d. Crop before voxelising (new, from the Wroclaw run): drop the Gaussians outside a dense core bound (per-axis percentile of positions plus a margin) before writeVoxel, so the 13.5 km tree bound of Wroclaw becomes the city core. Then unit test the crop rule with a negative control, rebuild, rerun ladder for 70b50d42 and ab5efa0e.
- [ ] 2. Browser trials (the probe's first run died on a tsx helper inside page.evaluate after the first bake; fixed in cc852ca1, not rerun). Command, under the GPU lock with serve-csp on 5800: node node_modules/tsx/dist/cli.mjs tools/bench/scripts/walls-trials.ts http://localhost:5800 U:/Temp/gsfpv-train2/walls/trials.json trials "887f27aa:2@5,3@5,1@5,0@5;70b50d42:2@5,3@5,1@5,0@20". Rerun only after 3d (else Wroclaw hangs again).
- [ ] 2 (old text). Browser trials (headless Chrome, GPU lock) on Wroclaw 70b50d42 and Tunis 887f27aa: time, peak memory, solid cells per step; agreement of a lower-level bake with the shipped 5 cm walls of Tunis (share of solid cells in common at 5 cm). Candidates still to measure: coarser cell at level 0; lower LOD level (built); blocks; plain occupancy grid. Only the LOD ladder is built; the other three are not measured.
- [ ] 3b. Page probe on a local release (port 5800): ?bake=1 on /en?scene=70b50d42 and on ab5efa0e, wait for walls state in-use, read __gsfpv.walls.lastBake (level, tried, rough, ms, peakJsHeapMb), then fly the drone into a wall and see it stop. Template: the scout probe U:/Temp/gsfpv-train2/probe-b1.mjs.
- [ ] 3c. If the trials show a lower level gives walls too poor (agreement with Tunis shipped walls low), add blocks: split the level-0 Gaussians by space, bake each block, join the solid cells (needs an octree writer; packages/collision has only the reader as far as read).

## Facts (measured)

walls-scan-sizes.ts, 2026-11-13, Gaussians by level of detail (millions), from the CDN metadata:

| id | walls | levels | L0 | L1 | L2 | L3 | span of the tree bound, m |
|---|---|---|---|---|---|---|---|
| 887f27aa Tunis | shipped | 7 | 43.03 | 21.49 | 10.74 | 5.36 | 328 x 45 x 186 |
| 39e63ce9 Modlinek | shipped | 4 | 3.80 | 1.90 | 0.95 | 0.47 | 25 x 9 x 17 |
| 7a475d38 Winter Garden | shipped | 6 | 15.40 | 7.67 | 3.82 | 1.90 | 158 x 25 x 115 |
| b11e45d1 Yamato Koriyama | shipped | 7 | 24.41 | 12.18 | 6.08 | 3.03 | 479 x 69 x 587 |
| 70b50d42 Wroclaw | none | 10 | 43.09 | 21.55 | 10.77 | 5.39 | 13536 x 12547 x 13512 |
| ab5efa0e Forest Floor | none | 1 (single sog) | 4.02 | | | | |
| d10c5638 Housefly | none | 1 (single sog) | 0.96 | | | | |
| 2f1ddf5f Lublin 2025 | none | 13 | 258.95 | 129.48 | 64.74 | 32.37 | 1097 x 130 x 863 |
| ba7aa29d Opole Cathedral | none | 10 | 30.20 | 15.10 | 7.55 | 3.78 | 5933 x 5880 x 6004 |
| 9baef54b University of Opole | none | 9 | 23.18 | 11.59 | 5.80 | 2.90 | 4782 x 4665 x 4824 |
| 0230d903 Muster Truck Show | none | 10 | 38.19 | 19.09 | 9.55 | 4.77 | 9471 x 9399 x 9450 |
| eb5f51dc Laval Castle | none | 8 | 11.75 | 5.87 | 2.94 | 1.47 | 3757 x 2922 x 3666 |
| 1994c65c Osada Slavotovo | none | 11 | 59.74 | 29.87 | 14.94 | 7.47 | 6814 x 67388 x 4507 |

- Every level holds half the Gaussians of the level above (all 11 streamed scans).
- Which limit refuses Wroclaw today: the memory gate of bake.ts (GB_PER_MILLION 0.17 x Gaussians > memCapGb). On this PC (deviceMemory 8, cap 2 GB) the most is 11,764,705 Gaussians; Wroclaw has 43.09 M, 3.66 times over. The GPU-buffer gate (2 GiB / 64 B = 33.5 M) also refuses it. The owner's "17 million": 3 GB / 0.17 = 17.6 M (memCapGb 3) or 1 GiB / 64 = 16.8 M (a 1 GiB buffer GPU); which one his laptop hit is an inference, not measured.
- 9 of the 13 scans exceed 11.76 M at level 0 (Tunis, Winter Garden, Yamato, Wroclaw, Lublin, Opole Cathedral, University of Opole, Muster, Slavotovo); of the 9 without walls, 6 are refused today (Wroclaw, Lublin, Opole Cathedral, University of Opole, Muster, Slavotovo). Laval 11.75 M passes by 0.01 M.
- File sizes in MB: the catalogue rows read have no size field (scout-B table: Lublin 6492, Slavotovo 2916, Opole Cathedral 1199, University of Opole 922, Laval 488, Forest Floor 53, Housefly 16).
- First level that fits the 2 GB cap (planBase): Wroclaw 2, Tunis 2, Lublin 5, Opole Cathedral 2, University of Opole 1, Muster 2, Slavotovo 3, Laval 0, Forest Floor 0, Housefly 0.

Ladder run, walls-trials.ts ladder, 2026-11-13, local release, headless system Chrome, ?bake=1 on /en:
- ab5efa0e Forest Floor: built in 10.8 s (read 3.3 s, voxelise 7.4 s), level 0, 5 cm, tried 1, not rough, 4,019,918 Gaussians, 124,612 solid voxels, peak JS heap 602 MB. Drone into the walls: tunnelSelfTest(20 passes, 25 m/s) gave 20 contacts, 0 penetrations. Line shown: "Walls built in this browser: 0.1 million voxels in 11 s. Crashes are on."
- 70b50d42 Wroclaw: scene ready in 5.1 s; the bake was still in "voxelising on your GPU" after 1200 s (probe timeout), no error, no walls. The ladder had picked level 2 (10.77 M Gaussians, within the memory gate), so the Gaussian count is not what holds it. Cause, inference not measured: the tree bound is 13536 x 12547 x 13512 m; at 5 cm that is 2.7e5 cells per axis and the voxeliser walks that space. A per-Gaussian position histogram of Wroclaw was not taken.

Facts W3 (measured 2026-11-14, walls-chain-probe.mjs, headless system Chrome, ?set.input.howToFly=false, the probe closes the Controls screen with its x, then presses Shift+G once):
- Run 2 (release c5014547, U:/Temp/gsfpv-train2/walls/w3-chain-run2.json): ab5efa0e 1920x1080: after the Controls screen closed the walls box was shown (boxShown true, keep true, button "Build walls in this browser"); after Shift+G the box lines were "Building walls: reading the scan..." (0.0 s), "voxelising on your GPU" (7.8 s), "Walls built in this browser in 10 s. Crashes are on." (9.9 s); walls in use at 9.943 s, source bake; then the course: problem "nothing fits", HUD "No course fitted the free space this time. Shift+G tries another layout". No line said walls were missing; 0 page errors. 70b50d42 844x390 with published-walls stand-in (dist/walls/70b50d42/v1 from U:/Temp/gsfpv-train2/walls/release): no build, course generated, 21 gates, 72 entities drawn, Shift+G to first drawn gate 23.389 s, 0 page errors (pass false in that run only because the probe then asked for state in-use; published walls keep state none; criterion fixed in e744ad95, not rerun).
- Run 3 (release e744ad95, U:/Temp/gsfpv-train2/walls/w3-chain.json): ab5efa0e 1920x1080: walls in 9.763 s, lead line in the box "First the walls of this scan, then the course." above "Building walls: reading the scan..." with no button under it (shot walls-chain-1920-build.png); course "nothing fits" again.
- Forest Floor walls grid: 6.0 x 5.0 x 5.8 m (gridBounds of U:/Temp/gsfpv-train2/walls/release/ab5efa0e/v2/scene.voxel.json).
- Screenshots looked at: U:/Temp/gsfpv-train2/shots/walls-chain-1920.png (walls in, "Walls 5 cm", no course), walls-chain-1920-build.png (run 3), walls-chain-1920-build-run2.png (run 2: the HUD note covered the badge; fixed in e744ad95), walls-chain-844.png (Wroclaw, gates drawn, "Gates: 21").

Facts W2 (measured 2026-11-13, this PC: RTX 4090, 274 GB RAM; tool tools/walls/bake-published.mjs, manifests in U:/Temp/gsfpv-train2/walls/published*/manifest.json):

| id | result | cell | json B | bin B | kept share (level 4) | s |
|---|---|---|---|---|---|---|
| ab5efa0e Forest Floor | ok, v2 | 5 cm | 630 | 70,392 (same bytes count as the browser bake of scout B) | single file, no crop | 11 |
| d10c5638 Housefly | ok, v1 | 5 cm | 634 | 1,045,292 | single file, no crop | 6 |
| eb5f51dc Laval Castle | ok, v1, level 0 | 20 cm (5 cm: more than 16,777,216 mixed blocks after 7.6 min; 10 cm the same) | 647 | 67,193,320 | 0.9848, box 1198 x 367 x 905 m | 800 |
| 70b50d42 Wroclaw | ok, v1, level 1 (21,545,169 Gaussians; level 0 at 5 cm and 10 cm: "Buffer size (2699252224) exceeds the max buffer size limit (2147483648)") | 5 cm | 650 | 85,720,916 | 0.99254, box 292 x 100 x 374 m | 400 |
| ba7aa29d | ok, v1, level 0 (30,202,678) | 5 cm | 680 | 67,329,724 | 0.98831, box 480 x 523 x 558 m | 610 |
| 9baef54b University of Opole | ok, v1, level 0 (23,182,987), third try (published-f); "fetch failed" twice before although lod-meta.json and all 208 chunk meta.json answer 200 to curl | 5 cm | 666 | 68,107,376 | 0.99154, box 330 x 196 x 247 m | 416 |
| 2f1ddf5f | ok, v1, level 3 (258.95 M at level 0; level 3 is the first under the buffer) (published-e) | 20 cm (5 cm: more than 16,777,216 mixed blocks; 10 cm the same kind of limit) | 620 | 36,716,700 | 0.99919, box 1136 x 82 x 958 m | 1005 |
| 1994c65c | ok, v1, level 1 (59.7 M at level 0), second run with the fetch retry (published-g; first run "fetch failed") | 10 cm (5 cm over the octree limit) | 675 | 132,800,044 | 0.99059, box 1066 x 55 x 1112 m | 1063 |
| 0230d903 | ok, v1, level 1 (19,093,036; level 0 = 38.2 M over the buffer) (published-e) | 10 cm (5 cm: "Sparse octree node count (17384514) exceeds the Laine-Karras 24-bit baseOffset limit (16777216)") | 638 | 31,735,508 | 0.98806, box 960 x 417 x 1086 m | 578 |

Page probe on Wroclaw (2026-11-13 23:1x, same local release, U:/Temp/gsfpv-train2/walls/probe-w2-b.json): 70b50d42 pass, ready in 3.26 s, source published, 5 cm, /walls/70b50d42/v1/scene.voxel.json 200 and .bin 200, no bake in the browser, 0 page errors, line "In use: 5 cm walls, ready for every pilot." (state none: no refine offer for it); d10c5638 control pass, ready 2.47 s, one 404 on /walls/, source none, state offer, 0 errors.

Page probe walls-published-probe.mjs on the local release of 5dbe2a2f (port 5800, U:/Temp/gsfpv-train2/walls/probe-w2-a.json), Forest Floor files as the stand-in in dist/walls/ab5efa0e/v2/: ab5efa0e ready in 4.9 s, source published, 5 cm, /walls/.../scene.voxel.json 200 and .bin 200, no bake, no page error, line "In use: 5 cm walls, ready for every pilot."; d10c5638 (nothing published) ready in 2.7 s, one 404 on /walls/, source none, state offer, no page error.

## The way

W2 published walls (design): walls are built once on this PC by tools/walls/bake-published.mjs, which runs the splat-transform CLI in Node on the GPU (Dawn), reads level 0 of the scan straight from the CDN, and first crops the scan to its dense core (per axis the 0.5 % and 99.5 % quantiles of the level-4 positions plus 15 % of that span plus 5 m; settings, not measured), because a few floaters kilometres away make the voxeliser walk a bound of 13.5 km. The output is the format SuperSplat ships and the page builds and exports: scene.voxel.json + scene.voxel.bin. They live on the hub in releases/walls/<id>/v<N>/ (beside the releases, so a new release keeps them; one folder per scan version, so a new upload of a scan never gets old walls) and the site serves them from its own origin at /walls/<id>/v<N>/scene.voxel.json (deploy/nginx.conf location ^~ /walls/, 404 when missing, no-cache with ETag). deploy/release-walls.sh copies them there (temporary name, then rename) and compares sha256 local, hub and served. The page looks for walls in this order (loader.ts wallsPlaces / firstWalls): shipped by SuperSplat, else published here, else none and the walls box offers its own build (W1). A missing or broken published file only means "not published" and never stops a flight. No catalogue field and no admin screen: the 404 of one small JSON is the whole cost for a scan without published walls. Sizes: see Facts W2.

Provisional (the browser trials of step 2 are not run): a ladder of levels of detail. planBase lists the finest level whose Gaussians pass the GPU-buffer and memory gates, then every coarser level. bakeBase tries them in order; a GPU out-of-memory or validation error, a RangeError (allocation), a gate refusal or the octree format limit takes the next step by itself; inside each step the existing 5 / 10 / 20 cm coarsening handles the octree format limit. The last step is tried even past the estimate. A single-file scan has one step and is tried even past the estimate. The pilot sees the stages in plain words ("taking a lighter way for this big scan"), and after a rough build one line "The walls are rough in this scan". Numbers of agreement with the shipped walls: not measured yet (step 2).

## Decisions

- The LOD ladder first: every streamed scan already carries halved levels, selectLod of splat-transform reads one level without the others, and no new format code is needed. Blocks and a plain occupancy grid need an octree writer of our own; kept for step 3c if the trials show the lower level is too poor.
- bake.refused stays for the refine path only; the base bake cannot reach it any more.
- When every step runs out of room the pilot gets bake.noRoom (close other tabs, press again) instead of the library message.

## For the lead

W3 build function for other features (lane sound's free flight by sound):
1. `ctx.hook.walls?.build(lead?: string): Promise<boolean>` (apps/fly/src/walls.ts WallsHook.build): shipped or published walls at once, else the browser's store, else one build here with its progress in the walls box; concurrent calls share one build; true when ctx.session.collision is set.
2. Easier: `wallsThen(ctx, then)` from apps/fly/src/app/walls-then.ts runs `then` at once when walls are there, else after the build, only if the scene did not change; it returns 'now' | 'built' | 'failed' | 'moved'.
3. `lead` is one line shown in the walls box above the progress (say what comes after the walls, in all four languages); on 'failed' the box already says what to press (ctx.hook.walls.line holds it).
- W3 merged tracks-edit (merge a0637555, no conflict). Files outside the walls list touched for the rule "an action that needs walls gets them": apps/fly/src/app/builtin/course.ts (entry only, not apps/fly/src/course/**), voxels.ts, ceiling.ts, floaters.ts, apps/fly/src/fly.css (.bake-box.keep).
- W3 blocked item: see Status (generator in packages/tracks/src/generate.ts refuses a 6 m scan).

Release of published walls (W2; nothing uploaded by the lane):
1. Release the page of this branch as usual (the loader asks /walls/<id>/v<N>/scene.voxel.json; until step 2 that path falls to location / and the page treats any answer that is not walls as "not published").
2. bash deploy/release-nginx.sh (deploy/nginx.conf now has location ^~ /walls/ with root /srv/releases).
3. bash deploy/release-walls.sh U:/Temp/gsfpv-train2/walls/release (one dir with all 9 scans and one manifest.json; only rows with ok:true go, only scene.voxel.json + .bin are copied). The script prints local, hub and served sha256 per file and http 200; it exits 1 on any difference.
4. Check on the live site: node tools/bench/scripts/walls-published-probe.mjs https://gsfpv.flyreelstudio.eu/en <out.json> 70b50d42,ab5efa0e,9baef54b (reads only; each must pass: source published, walls files 200, no bake). By eye: /en/fly/?scene=70b50d42 opens with "In use: 5 cm walls, ready for every pilot." and no build button. The 4 scans with shipped walls (887f27aa, 39e63ce9, 7a475d38, b11e45d1) must still say shipped (the loader asks /walls/ only when nothing is shipped).
Files (U:/Temp/gsfpv-train2/walls/release/<id>/v<N>/, bin bytes; json 620-680 bytes each; total 490,725,112 bytes):
- ab5efa0e Forest Floor v2: 70,392 (level 0, 5 cm)
- d10c5638 Housefly v1: 1,045,292 (level 0, 5 cm)
- eb5f51dc Laval Castle v1: 67,193,320 (level 0, 20 cm)
- ba7aa29d v1: 67,329,724 (level 0, 5 cm)
- 70b50d42 Wroclaw v1: 85,720,916 (level 1, 5 cm)
- 0230d903 v1: 31,735,508 (level 1, 10 cm)
- 2f1ddf5f v1: 36,716,700 (level 3, 20 cm)
- 9baef54b University of Opole v1: 68,107,376 (level 0, 5 cm)
- 1994c65c v1: 132,800,044 (level 1, 10 cm; the biggest download a pilot gets with walls on)
sha256 (json+bin) of each is in release/manifest.json. A new scan version (v<N+1>) gets no published walls until it is baked again: node tools/walls/bake-published.mjs <dir> <id>, then step 3 with <dir>.

- apps/fly typecheck: 6 errors, all "Cannot find module '@gsfpv/tracks'" in src/course and src/sonic, none in files of this lane; this worktree's node_modules has no link for packages/tracks (pnpm install not re-run here).

## Not verified

- W3: the box staying in sight while the drone flies (#ui.hud-flying with .bake-box.keep) was not seen in a page: the probe never armed the drone. The menu item "Course: a new random course" was not pressed by the probe (it calls the same generate as Shift+G). C, V, the ceiling and floater panels on a scan without walls were not run in a page (unit tested only through withWalls). The course on Forest Floor never came (blocked, see Status), so the time from the key to the first gate exists only for Wroclaw. Wroclaw was not rerun after e744ad95 (that change touches only the build path, which a published scan does not take). accept-c.ts and accept-fly.ts were not run (gates; accept-fly reads the badge text from the dictionary).

- W2: deploy/release-walls.sh and the nginx location were not run (no SSH in this lane); the hub path $GSFPV_BASE/releases/walls being writable by the deploy user is an assumption. The page probe has no negative control on an old build (the unit test has one: NEG OK). Only Wroclaw (and Forest Floor before) was opened in a page with its published walls; the other 7 files were not loaded by the page (format is the same CLI output, sha256 checked). Walls from level 1 or 3 (70b50d42, 0230d903, 1994c65c, 2f1ddf5f) and at 10 or 20 cm were not compared with a level-0 5 cm bake; how close they follow the scan's surfaces is not measured. The crop settings (0.5 %, 15 %, 5 m) are chosen, not measured; that the drone stops at published walls in flight was not flown. The offline bakes did not take the GPU lock (Node CLI, not a browser).

- accept-c.ts after its change (cc852ca1) was not run (a gate; the lead runs it). The ladder run used a release built before cc852ca1, so the reworded refine line and bake.noRoom on the base path were not seen in a page.

- No headless Chrome run of the new ladder: whether level 2 of Wroclaw finishes, its time, peak memory and solid cells; the agreement with Tunis shipped walls.
- The drone stopping at built walls in flight (no page probe yet).

## Cost notes

- W3 worker: most turns and 15 minutes of GPU lock went to a first probe run that pressed Shift+G under the open Controls screen (it blocks the keys) and waited 10 minutes for nothing; a probe should close .screen.radio first and stop as soon as the feature reports a problem. Checking the scan's grid size against the course generator's metre defaults before the run would have shown the Forest Floor block at once.

- W2 worker 2: most turns went to waiting on bakes (Wroclaw 400 s, 1994c65c 1063 s, 2f1ddf5f 1005 s) and on two futile Wroclaw reruns at coarser cells left by worker 1; reading the CLI error line (uploadAllGaussians, a buffer of all Gaussians) before choosing the next attempt would have saved about 20 minutes of GPU and two turns.

- W2 worker 1: most turns went to waiting on big offline bakes whose CLI output is buffered by spawnSync until the end (no progress visible); start big bakes detached with nohup at the first turn, stream the CLI output to the log as it runs, and skip the 5 cm step for scans over 10 M Gaussians or wider than 500 m.

- W1 worker 2: most turns went to waiting on a Wroclaw bake that never ended (20 min) and to a probe crash from a tsx helper inside page.evaluate; pass every in-page script as a string and give a big-scan bake a 5 minute cap per step in the probe.
- W1 worker 1: most turns went to finding the voxel writer in the 3 MB splat-transform bundle (one grep printed a 3 MB line); grep that file only with cut -c1-150. A ready catalogue with content URLs and level counts would have saved four turns.
