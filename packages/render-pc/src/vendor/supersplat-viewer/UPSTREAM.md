# Vendored upstream code: SuperSplat viewer's stochastic splat renderer

| | |
|---|---|
| Project | [playcanvas/supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) |
| Release | v1.38.0 |
| Commit | `88482a6e4a145520cddf4d9c3d9e00481ae558c1` (2026-10-21 12:01 +01:00) |
| License | MIT, Copyright (c) 2011-2026 PlayCanvas Ltd. (full text: [`LICENSE-supersplat-viewer`](LICENSE-supersplat-viewer), git blob `a034c81d2731`, the same text as upstream's `LICENSE`) |
| Engine | upstream builds against `playcanvas` 2.23.3 (peer `^2.23.0`); this repo pins 2.23.2 |
| Status upstream | experimental (added by PR #314, 2026-09-26; 1.35.0, which `packages/collision` vendors, does not contain it) |

What it is: a WebGPU splat renderer that takes the engine's LOD, streaming and work buffer as they are and draws the
resident splats itself: compute projection with culling, a counting depth order, an unsorted opaque raster in which each
fragment is kept with the probability of its alpha, a temporal resolve (TAA history, 256 frames at rest, 16 moving) and a
compose quad that applies the engine's tone map once. Our adapter around it: `packages/render-pc/src/accum.ts`. Design and
measurements: `docs/wip/v11-s.md`.

## Files (under `src/render/` upstream, same relative layout here in `render/`)

| file | git blob at the pinned commit | local change |
|---|---|---|
| `stochastic-splat-renderer.ts` | `4ecc457e540a07b02960dd7a53063491f05a080b` | 5 edits on 4 marked lines (below) |
| `resident-set.ts` | `830531af626c161c86b74225216747504aa67f53` | 1 edit on 1 marked line |
| `splat-source.ts` | `50e660389a99a68f6721a13827bb269ed968442b` | none |
| `splat-source-workbuffer.ts` | `7eca4ab9769d70160f9e07b1fe88bb4478c94c77` | none |
| `xr-rate-map.ts` | `89151f3105065b404e746a04c44421d7803523e6` | none (imported by the renderer; never runs here) |
| `shaders/projector.ts` | `96a8d875734d9e85d1e621770db7bb43528b4797` | none |
| `shaders/order.ts` | `b46e86d5200f7fafd2094e0e58164c1bad9a7a86` | none |
| `shaders/args.ts` | `0cb1bf2e7a52af855668c07b01d1662dd40c8fe1` | none |
| `shaders/raster.ts` | `fbb5f5b03ab6c8dceef8d8af2d3878dc8297fab2` | none |
| `shaders/taa.ts` | `3f42b226d18627c00932fa13ef542ec29467303c` | none |
| `shaders/compose.ts` | `f458b78c3e1ae1331259d6527d9ea332de2f0803` | none |
| `shaders/reduce.ts` | `8ecf134c92f21e2386094dc9db7b4a78bad783d6` | none |
| `shaders/interleave.ts` | `9cf219ea42807624630561088d25a4af81864eb1` | none (the mobile mode's pixel sets; imported by the renderer) |
| `shaders/warp.ts` | `ce16117a41a9c98c5a8895cf0c901cfb4ec7fc4d` | none (the XR foveation table; imported by taa, compose, projector) |

`packages/render-pc/test/vendor-upstream.test.ts` hashes the files with the git blob rule and fails when an unmodified file
differs from this table or when a modified file has lost or gained a `GSFPV:` marker.

## Local changes (all marked `// GSFPV:`; `grep -rn "GSFPV:" .` lists them)

Six one-line type edits in two vendored files (five in `stochastic-splat-renderer.ts` on four marker lines, one in
`resident-set.ts`), found by a scratch `tsc` of the upstream render folder against engine 2.23.2 under this repo's `strict` +
`noImplicitOverride` config, plus a seventh in our own stand-in `picker.ts` (not a vendored file): seven edits in all, six of them
in upstream's files. No logic changed. A diff of the two files against a fresh clone of the pinned commit shows exactly these and
nothing else (re-checked in the v0.11 fix round); `test/vendor-upstream.test.ts` counts marker LINES (4 + 1), not edits.
Line numbers: the local file's, with upstream's at the pinned commit in brackets (the markers add lines).

1. `resident-set.ts`, line 220 (upstream 219): `this.set!.files[i]` (possibly null inside a callback; the check above it rules null out).
2. `stochastic-splat-renderer.ts`, line 362 (upstream 361): `override execute()` on the raster pass.
3. `stochastic-splat-renderer.ts`, line 363 (upstream 362): `this.renderTarget ?? null` (the engine's types give `RenderTarget | null | undefined`). Items 2 and 3 share one marker line (361).
4. `stochastic-splat-renderer.ts`, line 381 (upstream 379): `override execute()` on the bind pass.
5. `stochastic-splat-renderer.ts`, line 2168 (upstream 2165): `device.backBuffer!.flipY`.
6. `stochastic-splat-renderer.ts`, line 2574 (upstream 2570): `interleaveMesh?.destroy()`.
7. `picker.ts` (our stand-in, below), line 30: `if (!cam) return;`.

## Stand-ins of ours (files upstream has, under the upstream names, so the vendored files stay byte-identical)

| file | stands for | why |
|---|---|---|
| `picker.ts` | upstream `src/picker.ts` (42 KB, a GPU picker with engine shader-chunk patches) | the renderer imports only `captureCameraSnapshot`, `createPickCameraSnapshot` and the `PickCameraSnapshot` type (about 20 lines, copied from upstream lines 325-332 and 435-452) |
| `render/splat-source-direct.ts` | upstream `src/render/splat-source-direct.ts` (33 KB) and `shaders/packed-source.ts` (12 KB), NOT vendored | upstream's default data path destroys the engine's own splat textures; handing the splats back to the engine's sorted drawing (REC, video export, share picture) would need inverse compute passes. The work-buffer source leaves the engine untouched. The stub's constructor throws; the adapter always passes `source: 'workbuffer'` |

## Update procedure (not automatic)

1. Shallow-clone upstream at the new tag into the gitignored `.cache/` and note the commit.
2. For each file above: `git diff --no-index` the old pinned blob (`git -C <clone> show <old>:src/render/<file>`) against the new
   one; read the change. Overwrite the unmodified files; for the two edited files overwrite and re-apply the `GSFPV:` edits (the
   old file with its markers is the list).
3. Check the stand-ins still match what the renderer imports (`grep -n "from '\.\./picker'\|splat-source-direct"`), check the engine
   members the renderer uses still exist in the engine version pinned here (`render-pc/src/accum.ts` `accumSupport` lists them), and
   run `pnpm -r typecheck`.
4. Update this file (commit, blobs, edits), `NOTICE`, the test table, and re-run the Stage 3 measurements
   (`tools/bench/src/v11-s-accum.ts`, `accept-v11-stochastic.ts`): an upstream change can move the picture.
