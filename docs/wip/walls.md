# Lane walls: walls for every scan

Worktree C:/dev/gsfpv-voice, branch walls (from origin/main 2a5ac433). Ports 5800-5819.

## Status

Stage W2-published:
- [x] Design (below, The way W2).
- [x] Offline bake tool tools/walls/bake-published.mjs (commit 3e85e9e6): splat-transform 3.6.4 CLI in Node on this PC's RTX 4090 (Dawn), level 0, crop to the dense core read from level 4, 5 / 10 / 20 cm ladder, manifest.json with sizes and sha256.
- [x] Loader order shipped, else published, else the page's build: apps/fly/src/session/loader.ts wallsPlaces / firstWalls / publishedWallsUrl, session wallsFrom, walls.ts source 'published', text bake.source.published in en/es/pl/ru (commit cb473792). Unit test tools/bench/test/walls-published.test.ts 7 passed; negative control NEG OK (loader.ts of 3e85e9e6). apps/fly tsc exit 0.
- [x] Delivery: deploy/nginx.conf location ^~ /walls/ (root /srv/releases, 404 when missing), deploy/release-walls.sh (commit 5dbe2a2f).
- [x] Page probe tools/bench/scripts/walls-published-probe.mjs (commit d2f2015a); run on a local release of 5dbe2a2f with Forest Floor as the stand-in: pass (see Facts W2).
- [~] Offline bakes (results in Facts W2). Done: ab5efa0e, d10c5638, eb5f51dc. Running detached at 22:51 (started by W2 worker 1, nohup): (a) node tools/walls/bake-published.mjs U:/Temp/gsfpv-train2/walls/published-c 70b50d42,9baef54b --voxel 0.1 (log U:/Temp/gsfpv-train2/walls/bake-c.log); (b) the batch ba7aa29d,0230d903,1994c65c,2f1ddf5f into U:/Temp/gsfpv-train2/walls/published-b (log bake-b.log). Read the logs and manifest.json of each dir first; do not start them again while their node processes live (wmic process where "name='node.exe'" get CommandLine | grep bake-published).
- [ ] Wroclaw probe: copy published-c/70b50d42 into dist/walls/ of a local release (build of the branch head; dist is not in git), serve-csp on 5800, then under the GPU lock: node tools/bench/scripts/walls-published-probe.mjs http://localhost:5800/en U:/Temp/gsfpv-train2/walls/probe-w2-b.json 70b50d42 d10c5638 (d10c5638 without its stand-in = the unpublished control).
- [x] Wroclaw failed at 10 cm too (published/70b50d42/v1/cli-100mm.log, 7 min 28 s): the same "Buffer size (2699252224) exceeds the max buffer size limit (2147483648)" in GpuVoxelization.uploadAllGaussians. That buffer holds every kept Gaussian (16 floats each), so the cell size cannot help: 2699252224 / 64 = 42175816 Gaussians = 97.9 % of level 0 inside the crop. The 10 cm (published-c) and 20 cm (published) reruns were stopped. Fix in tools/walls/bake-published.mjs: levelThatFits picks the finest LOD level whose kept Gaussians fit 2147483648 bytes, and a buffer error steps one level down at the same cell size (isGaussianBufferError). Test tools/bench/test/walls-bake-level.test.ts 5 passed, NEG OK. Commit: this one.
- [~] Rerun with the fix, started 22:54 (W2 worker 2, run_in_background): 70b50d42,9baef54b into U:/Temp/gsfpv-train2/walls/published-d (log bake-d.log); 0230d903,1994c65c,2f1ddf5f into published-e (log bake-e.log). The old batch published-b goes on with ba7aa29d (30.2 M at level 0 fits); stop it after ba7aa29d, its next three scans are in published-e.
- [ ] Fill For the lead with the final file list and sizes (manifest.json of published, published-b, published-c).

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

Facts W2 (measured 2026-11-13, this PC: RTX 4090, 274 GB RAM; tool tools/walls/bake-published.mjs, manifests in U:/Temp/gsfpv-train2/walls/published*/manifest.json):

| id | result | cell | json B | bin B | kept share (level 4) | s |
|---|---|---|---|---|---|---|
| ab5efa0e Forest Floor | ok, v2 | 5 cm | 630 | 70,392 (same bytes count as the browser bake of scout B) | single file, no crop | 11 |
| d10c5638 Housefly | ok, v1 | 5 cm | 634 | 1,045,292 | single file, no crop | 6 |
| eb5f51dc Laval Castle | ok, v1, level 0 | 20 cm (5 cm: more than 16,777,216 mixed blocks after 7.6 min; 10 cm the same) | 647 | 67,193,320 | 0.9848, box 1198 x 367 x 905 m | 800 |
| 70b50d42 Wroclaw | 5 cm failed after 12 min 53 s: "Buffer size (2699252224) exceeds the max buffer size limit (2147483648)"; 10 cm attempt cut at 22:51 (worker ended), rerun detached at 10 cm | | | | | |
| 9baef54b University of Opole | first try "fetch failed" (network); rerun detached | | | | | |

Page probe walls-published-probe.mjs on the local release of 5dbe2a2f (port 5800, U:/Temp/gsfpv-train2/walls/probe-w2-a.json), Forest Floor files as the stand-in in dist/walls/ab5efa0e/v2/: ab5efa0e ready in 4.9 s, source published, 5 cm, /walls/.../scene.voxel.json 200 and .bin 200, no bake, no page error, line "In use: 5 cm walls, ready for every pilot."; d10c5638 (nothing published) ready in 2.7 s, one 404 on /walls/, source none, state offer, no page error.

## The way

W2 published walls (design): walls are built once on this PC by tools/walls/bake-published.mjs, which runs the splat-transform CLI in Node on the GPU (Dawn), reads level 0 of the scan straight from the CDN, and first crops the scan to its dense core (per axis the 0.5 % and 99.5 % quantiles of the level-4 positions plus 15 % of that span plus 5 m; settings, not measured), because a few floaters kilometres away make the voxeliser walk a bound of 13.5 km. The output is the format SuperSplat ships and the page builds and exports: scene.voxel.json + scene.voxel.bin. They live on the hub in releases/walls/<id>/v<N>/ (beside the releases, so a new release keeps them; one folder per scan version, so a new upload of a scan never gets old walls) and the site serves them from its own origin at /walls/<id>/v<N>/scene.voxel.json (deploy/nginx.conf location ^~ /walls/, 404 when missing, no-cache with ETag). deploy/release-walls.sh copies them there (temporary name, then rename) and compares sha256 local, hub and served. The page looks for walls in this order (loader.ts wallsPlaces / firstWalls): shipped by SuperSplat, else published here, else none and the walls box offers its own build (W1). A missing or broken published file only means "not published" and never stops a flight. No catalogue field and no admin screen: the 404 of one small JSON is the whole cost for a scan without published walls. Sizes: see Facts W2.

Provisional (the browser trials of step 2 are not run): a ladder of levels of detail. planBase lists the finest level whose Gaussians pass the GPU-buffer and memory gates, then every coarser level. bakeBase tries them in order; a GPU out-of-memory or validation error, a RangeError (allocation), a gate refusal or the octree format limit takes the next step by itself; inside each step the existing 5 / 10 / 20 cm coarsening handles the octree format limit. The last step is tried even past the estimate. A single-file scan has one step and is tried even past the estimate. The pilot sees the stages in plain words ("taking a lighter way for this big scan"), and after a rough build one line "The walls are rough in this scan". Numbers of agreement with the shipped walls: not measured yet (step 2).

## Decisions

- The LOD ladder first: every streamed scan already carries halved levels, selectLod of splat-transform reads one level without the others, and no new format code is needed. Blocks and a plain occupancy grid need an octree writer of our own; kept for step 3c if the trials show the lower level is too poor.
- bake.refused stays for the refine path only; the base bake cannot reach it any more.
- When every step runs out of room the pilot gets bake.noRoom (close other tabs, press again) instead of the library message.

## For the lead

Release of published walls (W2; nothing uploaded by the lane):
1. Release the page of this branch as usual (the loader asks /walls/<id>/v<N>/scene.voxel.json; until step 2 that path falls to location / and the page treats any answer that is not walls as "not published").
2. bash deploy/release-nginx.sh (deploy/nginx.conf now has location ^~ /walls/ with root /srv/releases).
3. bash deploy/release-walls.sh U:/Temp/gsfpv-train2/walls/published, then the same with published-b and published-c (each dir: <id>/v<N>/scene.voxel.json + .bin and manifest.json; only rows with ok:true go). The script prints local, hub and served sha256 per file and http 200, and a 404 for a scan with none; it exits 1 on any difference. The cli-*.log files beside the walls are not copied.
4. Check on the live site: /en/fly/?scene=70b50d42 and ?scene=ab5efa0e open with the walls line "In use: ... walls, ready for every pilot." and no build button; a scan with nothing published (e.g. 0230d903 if its bake failed) still shows the build offer. Probe: node tools/bench/scripts/walls-published-probe.mjs https://gsfpv.flyreelstudio.eu/en <out.json> 70b50d42,ab5efa0e (reads only).
Files and sizes so far: see Facts W2 (Laval bin 67 MB is the big one; Forest Floor 69 KB, Housefly 1.0 MB).

- apps/fly typecheck: 6 errors, all "Cannot find module '@gsfpv/tracks'" in src/course and src/sonic, none in files of this lane; this worktree's node_modules has no link for packages/tracks (pnpm install not re-run here).

## Not verified

- W2: deploy/release-walls.sh and the nginx location were not run (no SSH in this lane); the hub path $GSFPV_BASE/releases/walls being writable by the deploy user is an assumption. The page probe has no negative control on an old build (the unit test has one: NEG OK). Wroclaw with published walls was not opened in a page (its bake is not done). The crop settings (0.5 %, 15 %, 5 m) are chosen, not measured; that the drone stops at published walls in flight was not flown. The offline bakes did not take the GPU lock (Node CLI, not a browser).

- accept-c.ts after its change (cc852ca1) was not run (a gate; the lead runs it). The ladder run used a release built before cc852ca1, so the reworded refine line and bake.noRoom on the base path were not seen in a page.

- No headless Chrome run of the new ladder: whether level 2 of Wroclaw finishes, its time, peak memory and solid cells; the agreement with Tunis shipped walls.
- The drone stopping at built walls in flight (no page probe yet).

## Cost notes

- W2 worker 1: most turns went to waiting on big offline bakes whose CLI output is buffered by spawnSync until the end (no progress visible); start big bakes detached with nohup at the first turn, stream the CLI output to the log as it runs, and skip the 5 cm step for scans over 10 M Gaussians or wider than 500 m.

- W1 worker 2: most turns went to waiting on a Wroclaw bake that never ended (20 min) and to a probe crash from a tsx helper inside page.evaluate; pass every in-page script as a string and give a big-scan bake a 5 minute cap per step in the probe.
- W1 worker 1: most turns went to finding the voxel writer in the 3 MB splat-transform bundle (one grep printed a 3 MB line); grep that file only with cut -c1-150. A ready catalogue with content URLs and level counts would have saved four turns.
