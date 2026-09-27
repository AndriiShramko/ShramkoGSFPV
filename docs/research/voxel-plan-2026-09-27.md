# Fine voxels: why the drone does not get under a chair, what an in-browser re-bake costs, and the plan

Task B, item 4 of Andrii's message 7 (2026-09-26). Measured 2026-09-27 01:20–01:50 on Andrii's PC
(i9-7980XE, RTX 4090 24 GB, 256 GB RAM; DaVinci Resolve was rendering on the same GPU the whole time).
Scripts, raw logs and baked files are in `C:/dev/ShramkoGSFPV/.cache/lat-vox/vox-c/` (`logs/matrix.jsonl` holds
every bake result). Code read-only: live code = `C:/dev/gsfpv-wizard` (branch fix/wizard-user-paced),
v0.3 work = `C:/dev/ShramkoGSFPV` (main + uncommitted). "Not measured" is written where I did not measure.

## 0. Short answers

1. **Under a chair the drone is blocked by the chair legs, and the voxel size decides how much room the legs leave. There are no floaters under the seats, and the drone's collision body is not too big.**
   - Measured lane: the width of the strip that the body's centre can take to fly straight under the seat.
   - Winter Garden (3.2 cm voxels): the drone fits under all 4 dining chairs. The lanes are 13–19 cm, so the body must stay within about ±7–9 cm of the ideal line.
   - Modlinek red room (5 cm voxels): the lanes are 2.5 and 8.5 cm, so passing is practically impossible there.
   - At 1.6 cm: Modlinek lanes grow to 7 and 15.5 cm (×2–3). Winter Garden lanes grow by only 1.5–4 cm (to 14.5–23 cm).
   - Andrii's ~250 ms input-to-photon delay (Task A: A9 median 252 ms) means ~50 cm of travel at 2 m/s before a correction lands. That is probably a large part of "I can't get under" in the Winter Garden, where a lane exists. This point is inferred, not measured by me.
2. **Finer voxels are enough; the floater filter (G.3) is not needed for chairs.**
   - Under every seat, 0–0.05 % of the sample points are solid, at every size.
   - Finer grids split surfaces into dust: 57 → 3 197 components from 5 → 0.8 cm on 39e63ce9. So a floater filter on fine grids must count physical volume, not blocks.
3. **The target size is 1.6 cm (2 cm fallback), not 0.8 cm.**
   - At 2 cm the lanes already reach 86–94 % of their 0.8 cm width.
   - The contact query per 1 ms physics tick costs 16–40 µs at 3.2–1.6 cm and 168–220 µs at 0.8 cm (p99 up to 0.73 ms).
   - The octree has 5× more nodes at half the voxel size.
   - Small leaks in the floor start at ≤ 1.6 cm, but the whole body never falls through.
4. **An in-browser re-bake is feasible for small and medium scenes, and for big scenes only as local tiles.**
   - Modlinek (3.8 M Gaussians): 10–14 s in Node for any size from 3.2 to 0.8 cm. That is ≈ 13–18 s expected in the browser (calibration factor 1.33, not measured in the browser at fine sizes).
   - Winter Garden (15.4 M): 1.6 cm takes 50 s in Node. 1.2 cm is impossible for the whole scene: the octree needs more than 16 777 216 nodes.
   - Tunis (43 M): no whole-scene bake at any size. The Gaussian buffer is 2.75 GB, above the 2 GiB GPU limit, and the library then returns an **empty** octree as "success".
   - A 16 m local tile of Tunis at 1.6 cm: 18.7 s. A 4 m tile around the Winter Garden table at 0.8 cm: 12.4 s.
5. **GPU safety is the biggest risk found.**
   - A GPU TDR happened during my 9d09ab82 1.2 cm bake: Windows event 4101 at 01:36:59, "nvlddmkm stopped responding and has successfully recovered", and my process got DXGI_ERROR_DEVICE_REMOVED. The cause is not isolated, because Resolve was rendering on the same GPU. The same scene's whole GPU stage at 1.6 cm took only 8.9 s.
   - Earlier tonight there were two bugchecks 0x116 (VIDEO_TDR_FAILURE) at ~23:57 and ~00:15. Both came during the previous agents' bake runs (`vox`, `vox-b`; their logs stop mid-bake), while TdrLevel was still 1.
   - **Resolve's render should be checked.**
   - Any auto-bake must survive device loss and stay inside a tested envelope.

## 1. The showcase collisions (shipped by SuperSplat)

| scene | format | voxel | grid (m) | nodes | .bin | solid |
|---|---|---|---|---|---|---|
| 39e63ce9 Modlinek red room | 1.0 | 5 cm | 25.4 × 10.2 × 18.0 | 46 796 | 0.4 MB | 1.17 M voxels |
| 7a475d38 Winter Garden | 1.0 | 3.2 cm | 162.4 × 29.2 × 122.9 | 2 070 758 | 18.3 MB | 72.4 M |
| 887f27aa Tunis | 1.1 | 5 cm | 224 × 54.6 × 174.2 | 4 139 739 | 32.2 MB | 400.8 M |
| 9d09ab82 | 1.1, splat-transform 3.4.2 | 5 cm | 28.6 × 8.8 × 17.0 | 106 975 | 0.7 MB | 77.8 % of the grid is solid (made with exterior fill/carve) |

Two checks that my bakes reproduce what SuperSplat ships (same library):

- My own 3.2 cm bake of 7a475d38 gives the same lanes as the shipped file.
- My 5 cm bake of 39e63ce9 does the same (tables below). So the shipped collisions line up with the SOG data the renderer draws.

## 2. Why not under the chair (item 1)

Method: `vox-c/probe.ts`, `legs.ts`, `under.ts`, `holes.ts`, `slice.ts`.

- **Body:** the Pavo20 Pro compound body of `packages/sim-core/src/params.ts:130-138`: 4 duct spheres r 30 mm at (±33.1, 0, ±33.1) mm plus a body sphere r 25 mm. That makes it 126 mm wide at yaw 0 (154 mm diagonal) and 60 mm tall.
- **Overlap test:** the flight model's own, `sphereOverlaps` in `packages/collision/src/world.ts:28`.
- **Lane:** the body is yawed along the direction of travel. It must fit at every 5 mm step of a straight line crossing the whole seat footprint. This is checked in 4 directions and at 3 heights inside the fit band, and the widest lane is reported.
- **Negative control:** the solid pouf next to the chairs (1.45, 1.0) gives no fit band and a 0 cm lane.

**Winter Garden (7a475d38)**

- Chairs are found as seat slabs in the band map `vox-c/img/wg-table-032.png`.
- The floor is at y ≈ −0.26 to −0.29.
- Seat undersides are 29–38 cm above the floor at 3.2 cm.

| chair (centre x,z) | 3.2 shipped | 3.2 my bake | 2 cm | 1.6 cm | 1.6 cm, 4 m tile | 0.8 cm, 4 m tile |
|---|---|---|---|---|---|---|
| A (0.16, 1.39) | 15 | 15 | 17 | 18 | 18 | 19.5 |
| B (0.97, 1.50) | 13 | 13 | 15.5 | 14.5 | 14.5 | 16.5 |
| C (0.10, 3.35) | 16.5 | 16.5 | 18.5 | 19.5 | 19.5 | 20.5 |
| D (0.815, 3.40) | 19 | 19 | 21.5 | 23 | 23 | 23.5 |

- Values are the widest lane in cm.
- Fit band of the body centre at 3.2 cm: 3–35 cm above the floor. At 0.8 cm the top of the band rises by 1–2 cm.
- The 4 m tile bake gives the same best lanes as the whole-scene 1.6 cm bake (single directions within 1 cm), so local tiles are valid.

**Modlinek red room (39e63ce9)**

- Floor y ≈ −0.15 at 5 cm and −0.18 to −0.19 at fine sizes.
- Under-seat height is 30 cm at 5 cm and about 33–35 cm at fine sizes.

| chair | 5 shipped | 5 my bake | 3.2 | 2 | 1.6 | 1.2 | 0.8 |
|---|---|---|---|---|---|---|---|
| L (−2.80, 0.60) | 8.5 | 8.5 | 12 | 15 | 15.5 | 17 | 17.5 |
| R (−1.87, 0.50) | 2.5 | 2.5 | 3.5 | 7.5 | 7 | 8 | 8.5 |

Values are the widest lane in cm.

**Where the room goes**

- **Leg inflation.** The voxelizer adds Gaussian density at the point of each voxel that is closest to the Gaussian, and a voxel is solid at ≥ 0.1 summed opacity. See `@playcanvas/splat-transform/dist/index.mjs:14159` and `:14245`. So every surface grows outward by up to about a voxel. Measured leg cross-section (√area):

  | voxel size | Winter Garden legs | Modlinek legs |
  |---|---|---|
  | 5 cm | not baked | 8.7–12.6 cm |
  | 3.2 cm | 7.2–10.1 cm | 5.7–8.5 cm |
  | 2 cm | 6.0–7.5 cm | not measured |
  | 1.6 cm | 6.0–6.6 cm | 4.8–6.4 cm |
  | 0.8 cm | not measured | 3.6–5.6 cm |

- **Floaters under the seats: none.** 0 % solid samples at 3.2 and 1.6 cm in Winter Garden (0.05 % under chair B at 1.6). 0–0.05 % in Modlinek at 5 and 1.6 cm.
- **Body size is not the cause.**
  - Horizontally the collider is 126 mm wide. Derived from the manufacturer's wheelbase of 93.7 mm (+ ≈ 62 mm duct), the real width is ≈ 128 mm. BetaFPV's page gives no overall dimensions, so the real size is not measured.
  - Vertically the spheres make it 60 mm tall, taller than the real frame. That is irrelevant under 29–38 cm seats.
  - The remaining limit is geometric: in Modlinek chair R the legs are ~28 cm apart, which leaves 8.5 cm even at 0.8 cm voxels.
- **Scale is fine.** Winter Garden seat top ≈ 45 cm above the floor (0.196 − (−0.252)), a normal chair.
- **I could not confirm which chair Andrii tried.** The brief does not name the scene.

**Side effects of finer grids**

| | 5 cm | 3.2 cm | 2 cm | 1.6 cm | 1.2 cm | 0.8 cm |
|---|---|---|---|---|---|---|
| Floor leaks, r 12 mm sphere sinks > 10 cm (39e63ce9, 2.1 × 1.2 m around the chairs) | 0 | 0.05 % | 0.12 % | 0.65 % | 1.16 % | 1.68 % |
| Floor leaks, r 25 mm sphere sinks > 10 cm | 0 | 0 | 0 | 0 | 0.12 % | 0.12 % |
| Whole body drops through the floor | never | never | never | never | never | never |
| Components on 39e63ce9 | 57 | 152 | — | 613 | — | 3 197 |
| of which smaller than 1 L | 0 | 0 | — | 450 | — | 3 029 |
| Contact sweep µs per 1 ms tick, 3 / 10 m/s, path under chair D: mean | — | 24 / 16 | 36 / 38 | 32 / 40 | — | 168 / 220 |
| same, p99 | — | 174 / 57 | 152 / 90 | 91 / 126 | — | 469 / 727 |

- The whole-body drop test used a 3 cm grid.
- The sweep is the call the sim makes (`packages/sim-core/src/sim.ts:445`) at DT = 1 ms. At 0.8 cm it would take 17–22 % of a core on average.

## 3. Bake time and memory (item 2)

**Setup**

- **Harness:** `vox-c/bakebench.mjs` makes the same library calls as `apps/fly/src/bake.ts:59-73`: `readFile` (lod) → `selectLod(0)` → `materializeToDataTable` → `writeVoxel` into a `MemoryFileSystem`.
- **Library and device:** @playcanvas/splat-transform 3.6.4 on a Dawn WebGPU device created the way the CLI creates it.
- **Reading:** the scene mirror is served over local HTTP with Range support, so the read goes through the browser's fetch path.
- **Columns:** "pg" means only the position and geometric columns are loaded, which is what the CLI does (`dist/cli.mjs:50680`). A 5 cm bake of 39e63ce9 gave a bit-identical `.bin` with all columns and with pg.
- **Timing:** "writeVoxel" includes ≈ 0.4 s of Dawn device creation, which the browser does not pay because it reuses the renderer's device. Download from the CDN is not included: the mirror was local.

**Results**

| scene · Gaussians · LOD-0 bytes | voxel | read s | writeVoxel s | total s | .bin MB | octree nodes | peak RSS | GPU buffer |
|---|---|---|---|---|---|---|---|---|
| 39e63ce9 · 3.80 M · 43 MB (no SH) | 3.2 | 2.3 | 6.8 | 9.1 | 1.2 | 0.13 M | 1.10 GB | 0.25 GB |
| | 2 | 2.5 | 8.1 | 10.6 | 3.6 | 0.41 M | 1.04 GB | 0.25 GB |
| | 1.6 | 2.6 | 7.3 | 9.9 | 6.1 | 0.69 M | 1.11 GB | 0.25 GB |
| | 1.2 | 2.4 | 9.1 | 11.6 | 11.9 | 1.36 M | 1.09 GB | 0.26 GB |
| | 0.8 | 2.5 | 11.2 | 13.7 | 30.3 | 3.55 M | 1.15 GB | 0.26 GB |
| 7a475d38 · 15.40 M · 233 MB | 3.2 | 10.9 | 28.9 | 39.8 | 19.0 | 2.16 M | 2.65 GB (pg) | 0.97 GB |
| | 3.2, **all columns (bake.ts today)** | 21.3 | 30.9 | 52.2 | 19.0 | 2.16 M | **5.60 GB** | 0.97 GB |
| | 2 | 9.7 | 34.7 | 44.4 | 55.5 | 6.47 M | 2.65 GB | 0.97 GB |
| | 1.6 | 9.9 | 39.8 | 49.8 | 92.1 | 10.85 M | 2.65 GB | 0.96 GB |
| | 1.2 | fails after 62 s | | | | 21.09 M > 16 777 216 | 2.65 GB | |
| | 0.8 | not run (fails the same way) | | | | | | |
| 9d09ab82 · 14.96 M · 266 MB | 5 | 10.6 | 26.7 | 37.3 | 4.7 | 0.54 M | 2.59 GB | 0.94 GB |
| | 3.2 | 10.2 | 28.7 | 38.9 | 12.2 | 1.45 M | 2.59 GB | 0.94 GB |
| | 2 | 10.1 | 31.4 | 41.6 | 33.4 | 4.12 M | 2.59 GB | 0.94 GB |
| | 1.6 | 10.4 | 34.4 | 44.8 | 53.6 | 6.71 M | 2.59 GB | 0.94 GB |
| | 1.2 | GPU device removed (TDR) after 97 s | | | | | | |
| 887f27aa · 43.03 M · 665 MB | 5 | 27.9 | 64.2 | 92.0 | **0 (empty!)** | 0 | 4.62 GB | 2.75 GB requested > 2 GiB |
| **Local tiles, pruned LOD-0 read** | | | | | | | | |
| 7a475d38, 4 m box around the table: 13/24 files, 127 MB, 8.43 M read, 2.00 M in box | 1.6 | 7.7 | 4.2 | 11.8 | 0.3 | 35 K | 0.66 GB | 0.13 GB |
| | 0.8 | 7.7 | 4.6 | 12.4 | 1.8 | 188 K | 0.64 GB | 0.13 GB |
| 887f27aa, 16 m box around the spawn: 13/72 files, 127 MB, 8.22 M read, 4.77 M in box | 1.6 | 7.8 | 10.9 | 18.7 | 10.1 | 1.15 M | 1.30 GB | 0.31 GB |

**Stage split, 7a475d38 at 1.6 cm**

| stage | time |
|---|---|
| read | 9.9 s |
| column transform and extents (before the library's "Build voxels" scope) | ≈ 9.7 s |
| BVH (CPU, one thread) | 9.8 s |
| GPU voxelize | 9.1 s |
| block cleanup | 4.9 s |
| octree | 1.4 s |

About 70 % is CPU-side JavaScript/WASM, mostly single-threaded, so a background bake must not run on the main thread.

**Browser factor and scene load times**

- Browser factor: phase C measured 723068d7 (2.14 M, 5 cm) at 25.2 s in the browser against 18.9 s in the CLI, with identical output (`evidence/2026-09-24/c-bake.json`). That is ×1.33. It is not measured at fine sizes and not on other PCs.
- Scene load for comparison (`evidence/2026-09-24|26/b-fly-b6.json`, loadMs):

  | scene | cold (09-24) | warm (09-26) |
  |---|---|---|
  | 39e63ce9 | 1.7–4.4 s | 1.0–1.6 s |
  | 7a475d38 | 2.9–8.5 s | 1.5–1.7 s |
  | 887f27aa | 3.0–19.2 s | 1.6–2.0 s |

**Extrapolation to 5 / 10 / 20 M Gaussians** (this PC, whole scene, 1.6 cm)

| Gaussians | Node | browser (×1.33) | LOD-0 download | GPU buffer | peak RSS (pg) |
|---|---|---|---|---|---|
| 5 M | ≈ 15 s | ≈ 20 s | ≈ 75 MB | 0.32 GB | ≈ 0.9 GB |
| 10 M | ≈ 30 s | ≈ 40 s | ≈ 150 MB | 0.64 GB | ≈ 1.7 GB |
| 20 M | ≈ 60 s | ≈ 80 s | ≈ 300 MB | 1.28 GB | ≈ 3.5 GB |

- Time is ≈ 3 s per million Gaussians in Node: 2.0–2.6 s/M read + prep + BVH, plus 0.5–1.0 s/M for the voxel stages at 1.6 cm. The voxel size changes the total by only 10–40 % for these scenes.
- Download is ≈ 15 MB per million Gaussians with SH, 11 MB without. The time depends on bandwidth.
- Memory: RSS ≈ 0.17 GB per million with pg and 0.36 GB per million with all columns. The GPU buffer is 64 B per Gaussian.
- On a mid-range PC the CPU stages are probably 1.5–2× slower. Not measured.

**Limits**

1. **GPU buffer.**
   - The voxelizer uploads all Gaussians into one storage buffer of N × 64 B (`index.mjs:14281`, `:14359`).
   - Dawn on this RTX 4090 reports maxBufferSize = maxStorageBufferBindingSize = 2 GiB, so N ≤ 33.5 M.
   - Above that the library logs validation errors and returns an empty octree as success (887f27aa).
   - PlayCanvas requests the adapter's maximum limits, so Chrome should behave the same. Not measured in Chrome.
2. **Octree format.**
   - At most 16 777 216 nodes, because offsets are 24-bit (`index.mjs:34925`, `:35146`).
   - Node count grows as v^−2.33 (fit on 7a475d38: 2.33 and 2.32).
   - So the finest whole-scene size can be predicted before baking from the shipped file: `v_min ≈ v_ship × (nodeCount / 16 777 216)^(1/2.33)`.
   - Predictions: 39e63ce9 0.40 cm, **7a475d38 1.30 cm** (measured: 1.6 works, 1.2 fails), 887f27aa 2.74 cm, 9d09ab82 ≈ 1.1 cm (from my 1.6 cm bake).
   - The .bin is ≈ 9 bytes per node, so it stays under ≈ 150 MB below the ceiling. It gzips to ≈ 40 % (92 → 37–40 MB).
3. **CPU memory.** The rates are above. A browser tab's ceiling for ArrayBuffers is not measured. `bake.ts:9` caps at 4 M Gaussians, but see the bugs below.
4. **WASM.** Only the WebP decoder is WASM. It reads the whole 233–665 MB mirrors fine, so it is not the limit.
5. **TDR / device loss.**
   - The library caps each dispatch flush at 256 batches or 2 M indices so that it stays under Windows' ~2 s TDR on slower GPUs (`index.mjs:16905-16912`). This PC has TdrDelay 60 s, TdrLevel 3.
   - Even so, the 9d09ab82 1.2 cm run lost the device. The earlier 0x116 bugchecks are above.
   - A browser bake that shares the renderer's device (today's `main.ts:278`) would lose rendering too.
6. **Our collision loader and the sim.**
   - `open.ts:22-28` copies the .bin twice, and `session.ts:264-267` / `:510` concatenate it again for sha256. That is ≈ 4× the .bin in transient memory (≈ 370 MB for a 92 MB .bin), fine on desktop.
   - The sweep cost per tick is in the side-effects table above.
   - `installCollision` (`session.ts:507`) restarts the input log, because a replay needs the same walls. So any swap must happen at a respawn or disarm.

**Bugs in the current bake path**

- **B-1** `apps/fly/src/bake.ts:67` loads every column, SH included (15.4 M × 59 floats). Measured 5.6 GB against 2.65 GB for 7a475d38. Fix: `materializeToDataTable(src, pool, new Set(['position','geometric']))`; the output is identical. The download is not reduced: 233.4 MB either way, because the reader still fetched the shN files.
- **B-2** `bake.ts:40` reads `counts[0] ?? count ?? 0`. The lod-meta.json of all three showcase scenes has neither field, so the size guard sees 0 Gaussians and never refuses. Fix: sum the `lods['0'].count` of the tree leaves (15 400 551 for 7a475d38, 43 031 431 for 887f27aa).
- **B-3** `bake.ts:73` has no GPU error scope and no limit check. When N × 64 B exceeds maxBufferSize, it would install empty walls and report "walls built". Fix:
  - check `N*64 <= min(device.limits.maxBufferSize, maxStorageBufferBindingSize)` before starting;
  - wrap the call in `pushErrorScope('validation'|'out-of-memory')`;
  - refuse a result with `solidVoxels === 0`.
- **B-4** `bake.ts:73` hard-codes `voxelResolution: 0.05`.

## 4. Design (item 3)

**Collision stack per scene:** base (SuperSplat's shipped file, or a 5 cm bake) plus an optional refine layer.

- **Whole-scene refine:** used when it fits the limits and the time budget.
- **Local tile:** a 16 m cube around the drone, used otherwise.
  - Read only the LOD-0 SOG files whose tree leaves meet the box. The prune must keep every leaf of a kept file, because the reader checks the per-file count (`vox-c/prune.mjs`).
  - Bake only the Gaussians inside the box.
  - Trust the tile only inside its core, the box shrunk by 0.5 m, because the edges lose Gaussians from outside the box.
  - Serve queries through a `LayeredCollision`: a sphere whose AABB lies inside a tile core queries the tile, otherwise the base. `sphereOverlaps` / `querySphere` / `isFreeAt` sit behind one interface, and `VoxelContactWorld` (`world.ts:64`) takes that interface.
  - Collision identity = sha256(base) + the sorted tile hashes. It goes into the life header.
- **Target size:** 1.6 cm. Use 2 cm when `v_min` (from the predictor) is above 1.6 cm. Never go below 1.2 cm by default.

**When to bake**, decided after the scene is visible:

- Predicted browser time:
  - `T = bytesNotCached / measuredLoadBandwidth + N × k` in the browser;
  - `k` starts at 4 s per million Gaussians (1.6 cm, calibrated on this PC);
  - after every real bake, `k` is replaced by the measured s/M for this machine and kept in prefs.
- Hard gates, checked before anything else:
  - WebGPU is present;
  - `N*64 ≤ limits`;
  - predicted nodes ≤ 12 M, a safety margin under 16.78 M;
  - predicted RSS (0.17 GB/M) ≤ min(3 GB, navigator.deviceMemory/4).

  If a gate fails, fall back to a local tile. If the tile fails too, skip.

| situation | action |
|---|---|
| no shipped walls, whole bake ≤ 20 s (≈ 5 M Gaussians on this PC) | bake 5 cm base automatically (today's phase C button stays for bigger) |
| no shipped walls, bake long or refused | fly without walls, badge + button (as now) — Andrii's rule |
| shipped ≥ 4 cm and refine ≤ 20 s (or ≤ 1.5 × this load's visible time, whichever is larger) | **auto** refine to 1.6 cm in the background while the pilot is on the platform; swap at the next respawn/disarm; toast "Walls refined: 1.6 cm (was 5 cm), 13 s" |
| shipped ≥ 4 cm, refine 20 s – 3 min | offer "Refine walls to 1.6 cm — about N s"; keep flying on the old walls meanwhile |
| refine 3–10 min | offer with a warning "long: ~N min, the fans will spin"; confirmation needed |
| > 10 min, or a gate fails | whole scene refused; offer "Refine around me (16 m)" with its own estimate (Tunis: ~25 s) |
| shipped ≤ 3.2 cm | no auto; offer only (Winter Garden gains 1.5–4 cm of lane for ~1 min) |
| shipped ≤ 2 cm | nothing to do |

What the table gives for the showcase scenes:

| scene | action |
|---|---|
| Modlinek rooms | auto (≈ 13–18 s) |
| Winter Garden | offer (≈ 66 s whole, or a ≈ 16 s tile) |
| Tunis | tile offer (≈ 25 s) |
| 9d09ab82 | offer (≈ 60 s) |

**Where the bake runs**

- In a dedicated Worker with its own WebGPU device, not the renderer's, so that a device loss kills only the bake. The flight keeps the base walls and the UI says "refine failed, flying on the 5 cm walls".
- The flight model runs 1000 ticks per second on the main thread, which is why the bake leaves the main thread.
- Two things are not verified and need a prototype: whether splat-transform plus a PlayCanvas device on an OffscreenCanvas work in a Worker, and the frame-time cost of a background bake.
- Before the first auto-bake on a new machine, run a small calibration bake, such as a 4 m tile, so that a slow GPU is detected before a long run.

**Browser cache**

- **Store:** IndexedDB `gsfpv` → `blobs` (already reserved in `packages/prefs/src/browser.ts:156-162`). Values are Blobs: json, plus the bin gzipped with CompressionStream (≈ 40 % of raw).
- **Key:** sha256 of `{sceneId, version v<N>, lod-meta ETag, base-collision sha256 | 'none', voxel, opacity 0.1, 'splat-transform@3.6.4', box | 'full', dropFloaters}`.
- **Row:** `{bytesRaw, bytesStored, createdAt, lastUsedAt, bakeMs, gaussians, sha256}`, plus a small index for LRU.
- **Load order:** after `resolveScene`, compute the key and look it up. On a hit, install the walls with no bake at all.
- **Eviction:** LRU above min(1 GB, 10 % of `navigator.storage.estimate().quota`). Favourites are evicted last.
- **Persistence:** `navigator.storage.persist()` is requested on the first refine; `browser.ts:137` already does it on the first explicit change. Settings → Data shows "Walls cache: 3 scenes, 58 MB · Clear".
- **Private mode:** with IndexedDB blocked, the bake works in memory only.

**Moving to another PC**

- **Settings export:** the settings file stays JSON (A.4, `packages/prefs/src/store.ts:272` `exportFile`).
- **Walls export:** a second option, "Settings + walls", writes `gsfpv-backup-YYYY-MM-DD.zip` with:
  - `settings.json`, the A.4 document;
  - `walls/index.json`, with the keys, sha256 and sizes;
  - `walls/<key>.voxel.json`;
  - `walls/<key>.voxel.bin.gz`.

  splat-transform already exports `ZipFileSystem` / `ZipReadFileSystem`, which are loaded with the bake on demand.
- **Sizes:** Modlinek 1.6 cm ≈ 2 MB gzipped, Winter Garden whole 1.6 cm ≈ 40 MB, tiles 0.3–10 MB raw.
- **Import:**
  - the preview lists the walls;
  - every sha256 is verified;
  - walls whose key no longer matches the scene's current version/ETag are marked stale on the next load and not used.
- **Re-bake instead of import:** the per-scene choice (`scene.wallsVoxelCm`, and the tiles' centres) travels in the settings. A PC without the walls re-bakes them to the same bytes. The library is deterministic: identical output browser vs CLI (c-bake) and all vs pg (this run).

**Newer SuperSplat collision is picked up automatically**

- **Republish:** SuperSplat moves the scene to a new v<N> folder. `resolveScene` finds the highest one (`packages/scenes/src/index.ts:168-187`), so the key changes and the old refine is not used.
- **Same-folder overwrite:** `cachedFetch` revalidates by ETag on every load (`index.ts:75-96`). The new walls change the base sha256, so the key changes.
- **Choice between the two:**
  - if the new SuperSplat voxel is ≤ our target, use SuperSplat's and offer nothing;
  - if it is coarser, keep the refine offer.
- **Owner hint** for scenes above 3.2 cm: "If this is your scene: regenerate its collision on SuperSplat with a finer voxel; the simulator picks it up on the next load". Not verified: whether SuperSplat's UI lets an author pick the voxel size. 7a475d38 at 3.2 cm shows that non-default sizes exist. Our lanes suggest asking authors for 1.6–2 cm.

**Floater filter (G.3)**

- Not needed for this problem.
- If it runs on fine grids, its threshold must be physical (litres), not "blocks", because a block is 64 voxels whose size changes with the voxel.
- It needs a negative control on thin real objects: chair legs, plant stems.

## 5. Implementation order and tests

- **P0, small: bake.ts fixes B-1…B-4.**
  - Tests:
    - lod-meta without `counts` gives N from the tree (control: the file with counts gives the same N);
    - with limits faked below N × 64, the bake is refused and the walls are untouched (control: 39e63ce9 bakes);
    - a 1.6 cm bake of 39e63ce9 in the browser has the same sha256 as the Node bake (control: 2 cm differs).
- **P1, M: whole-scene refine with estimate / auto / offer, the IndexedDB cache, swap at respawn, i18n in 4 languages.**
  - Tests:
    - reload gives no second bake and the same sha;
    - a mocked new ETag gives a cache miss;
    - Modlinek chair lanes ≥ 7 cm after refine, checked by `probe.ts` in CI on the fixture (control: the pouf has no lane).
- **P2, M: zip export/import with settings, stale detection, Settings → Data.**
  - Tests:
    - a clean profile plus import gives no bake;
    - a stale version is not used;
    - a corrupted .bin is rejected by sha256.
- **P3, L: Worker bake plus local tiles (`LayeredCollision`).**
  - Tests:
    - tile lanes equal whole-scene lanes inside the core (measured equal on 4 chairs);
    - queries outside the core use the base;
    - device loss during the bake keeps the base walls and flying.
- **Budgets checked on every size change, with 0.8 cm as the negative control:**
  - sweep ≤ 60 µs mean per tick on this PC (1.6 cm: 32–40);
  - whole-body floor drop = 0;
  - r 25 mm leaks ≤ 0.2 %.

## 6. Not measured

- An in-browser bake at fine sizes (only Node; the ×1.33 factor comes from one 5 cm browser run).
- Chrome's WebGPU limits and tab memory ceiling on this PC.
- A bake inside a Worker.
- Frame time during a background bake.
- Any other PC.
- Whether SuperSplat lets authors choose the voxel size.
- Which chair Andrii tried.
- The real Pavo20 Pro outline.
- The cause of the 01:36:59 TDR (my bake or Resolve's render).
