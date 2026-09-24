# Measurement harness (probe)

The code that produced the numbers in [`docs/measured-facts.md`](../../docs/measured-facts.md). It loads a live SuperSplat scene into our own page, queries its voxel collision, and runs scripted flights while measuring.

It runs **inside a checkout of the SuperSplat viewer**, because it reuses that project's MIT collision module directly from source. It is measurement tooling, not the product.

## Run it

Requirements: Node 20+, Google Chrome with WebGPU (Windows or macOS), Git.

```bash
git clone -c core.autocrlf=false https://github.com/playcanvas/supersplat-viewer.git
cd supersplat-viewer
git checkout 9d8cc43            # v1.32.0, the version the numbers were taken on
npm install
npm run build
npm install --no-save playwright

# copy this folder in as ./probe
cp -r /path/to/ShramkoGSFPV/tools/probe ./probe

npx rollup -c probe/rollup.config.mjs          # builds probe/gsfpv.js (collision + helpers)
node probe/fetch-scene.mjs 39e63ce9 887f27aa   # caches scene bootstraps in probe/scenes/

npx serve -l 5188 -C . &                        # any static server on 5188 works
node probe/run.mjs "http://127.0.0.1:5188/probe?id=39e63ce9"
```

The result is written to `probe/last-result.json`. `PROBE_HEADLESS=1` runs Chrome headless.

## What it measures

| Probe | Output field | Meaning |
|---|---|---|
| Renderer | `renderer.gpuSortActive` | `true` only when the engine really sorts Gaussians on the GPU |
| Load | `loadMs` | time until the first complete frame |
| Clearance | `results.clearance.byRadius` | how close a sphere of each radius can get to surfaces |
| Tunnelling | `results.tunnelling` | collisions an endpoint-only test misses per speed |
| Frames | `results.frames` | presented frame times during scripted acro and wall-hugging |
| Negative control | `idleCadence_ms` | frame cadence of an empty page — if the flight numbers equal it, they measure vsync, not the scene |

## Files

| File | Role |
|---|---|
| `fetch-scene.mjs` | reads the `sse-bootstrap` block of `superspl.at/s?id=<id>` and caches content URL, collision URL, settings and start camera |
| `entry.ts` | exposes the viewer's collision loader plus clearance and sweep helpers on `window.__gsfpv` |
| `rollup.config.mjs` | bundles `entry.ts` |
| `index.html` | the test page: loads the scene, runs every probe, stores results on `window.__probe` |
| `run.mjs` | launches system Chrome through Playwright and writes `last-result.json` |

## Known gaps

- Frame cost is not isolated from vsync yet (see measured-facts §6).
- The frame probes drive the camera directly; the real drone model is not in the harness.
