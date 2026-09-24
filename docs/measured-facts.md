# Measured facts

Everything here was checked by running code or live requests on 2026-09-21/22. Machine: NVIDIA RTX 4090 (Lovelace), Windows 10, system Google Chrome driven by Playwright, PlayCanvas Engine 2.22.3, `@playcanvas/supersplat-viewer` 1.32.0. Anything not measured is labelled so.

## 1. SuperSplat serves everything a flight sim needs

| Resource | URL pattern | Cross-origin |
|---|---|---|
| Scene bootstrap (content URL, collision URL, settings, start camera) | `https://superspl.at/s?id=<hash>` → `<script id="sse-bootstrap">` JSON | fetched server-side |
| Gaussian data, LOD streamed | `https://d28zzqy0iyovbz.cloudfront.net/<hash>/v1/lod-meta.json` | `Access-Control-Allow-Origin: *` ✅ |
| Voxel collision metadata | `https://s3-eu-west-1.amazonaws.com/splats.playcanvas.com/<hash>/v1/scene.voxel.json` | `Access-Control-Allow-Origin: *` ✅ |
| Voxel collision data | `…/<hash>/v1/scene.voxel.bin` | `Access-Control-Allow-Origin: *` ✅ |
| Scene metadata API | `https://playcanvas.com/api/splats/<hash>/related` | **blocked** from a third-party origin ❌ |
| Scene listing / search API | `/api/splats` → 401, `/api/splats/search` → 404 | not public ❌ |

Verified with a real `fetch` from `https://example.com`: scene and collision returned 200, the metadata API failed CORS.

The scene metadata contains `voxelTask.status` — `"complete"` means the scene has collision. Whether a scene has collision is a property of that scene (the author ran the job), not of its type: interiors and exteriors both occur with and without it.

## 2. Collision data

A sparse voxel octree (`leafSize` 4, depth 7–11), versions `1.0` and `1.1` exist.

| Scene | Type | Voxel | `.voxel.bin` | Scene size (m) |
|---|---|---|---|---|
| `39e63ce9` Modlinek Villa room | interior | 5 cm | 256 KB | 25.3 × 10.0 × 17.7 |
| `7a475d38` Winter Garden | interior | 3.2 cm | 10.1 MB | 162 × 29 × 123 |
| `887f27aa` Tunis, 80 M splats | exterior | 5 cm | 13.7 MB | 224 × 55 × 174 |
| `723068d7`, `bd04e182` | exterior | none | — | — |

The collision query interface in the MIT SuperSplat viewer (`src/collision/collision.ts`): `queryRay`, `querySphere`, `queryCapsule`, `querySurfaceNormal`, `isFreeAt`, `voxelResolution`. Collision can also be generated for any splat with `splat-transform` (`--voxel-size`, `--voxel-floor-fill`, `--voxel-carve`, `--filter-floaters`, `--collision-mesh`).

## 3. The engine works from our own page

| Check | Result |
|---|---|
| `createViewer` with CDN content + collision URLs | loads, no errors |
| WebGPU | `isWebGPU: true` |
| Gaussian sort on GPU | `app.scene.gsplat.currentRenderer === 2` (`GSPLAT_RENDERER_RASTER_GPU_SORT`) |
| Load, 3.8 M Gaussians, 4 LOD levels | 1.17–1.93 s over several runs |
| Collision usable | `hasCollision: true`, `walkAllowed: true` |

## 4. How close can a drone fly to a wall?

From a free point, 200 evenly spread directions: find the surface with a ray, then the closest sphere centre the collision accepts. Ideal = the sphere's radius.

| Craft radius | Clearance median | p95 | Excess over radius |
|---|---|---|---|
| 10 mm | 14 mm | 44 mm | 4 mm |
| 20 mm | 28 mm | 80 mm | 8 mm |
| 42.5 mm | 72 mm | 220 mm | 29.5 mm |
| 60 mm | 104 mm | 370 mm | 44 mm |
| 90 mm | 160 mm | 614 mm | 70 mm |
| 150 mm | 272 mm | 1002 mm | 122 mm |

**Clearance scales with craft size and has no fixed floor.** The "carve" region used for spawn finding (`isFreeAt`) does not limit flight; flight collision is voxel occupancy. The official 5 cm data is good enough for small craft. High p95 values are corners and cluttered spots.

## 5. Tunnelling

Straight runs from the start point, one step = distance travelled in one 144 Hz frame.

| Speed | Step | Tests | Collisions missed by an endpoint-only test |
|---|---|---|---|
| 5 m/s | 34.7 mm | 2271 | 0 |
| 10 m/s | 69.4 mm | 1149 | 1 |
| 15 m/s | 104.2 mm | 776 | 0 |
| 25 m/s | 173.6 mm | 476 | 1 |

Rare, not zero → the simulator must sweep the collision shape along each step.

## 6. What could NOT be measured yet

- **Frame cost under acro.** Presented frame time was p50 17.2 ms — but an empty page in the same browser gave the same 17.2 ms (negative control), so the number is the window's vsync cadence, not the renderer's cost. Canvas upscaling was overridden by the viewer; the engine's GPU profiler returned a constant (58.182 ms every frame) and was discarded.
- **What the display actually runs at.** `dxdiag` reports 3840 × 2160 at 30 Hz on the test machine; the browser presented at ~58 Hz. The sources disagree.
- **End-to-end stick-to-photon latency.** Needs a real radio and a camera.

Raw result of the last run: [`measurements/2026-09-22-probe-result.json`](measurements/2026-09-22-probe-result.json).
