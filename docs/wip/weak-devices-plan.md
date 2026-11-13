# Stage 5 "Weak devices": plan (R32, owner message 38)

Checked against the working copy and PlayCanvas 2.23.2 (`pnpm-lock.yaml`, `node_modules/.pnpm/playcanvas@2.23.2`). No code changed.
No weak device was available: every measured number below comes from the RTX 4090 PC; anything else is marked "estimate".
Owner's item: "scenes more detailed and smoother on weak devices: frustum culling, octree, LOD with frame-centre priority, cache; stochastic must work with it".

## 1. What exists today, item by item of the owner's message

| Owner's words | Status | Where (code) | Note |
|---|---|---|---|
| Frustum pyramid, what is outside is culled | yes (WebGPU) | engine `GSplatHybridRenderer.sortAndProjectForCamera` -> `_runFrustumCulling` (planes from the camera) -> `intervalCompaction.dispatchCompact(frustumCuller, ...)`; only when `world.hasBounds` | Culls per octree node interval before sorting. WebGL (CPU sort) path: no culling found (previous note, not re-read). |
| Scene split into an octree, chunks inside chunks | partly | `lod-meta.json` -> engine `GSplatOctree`; our check `packages/render-pc/src/lod.ts` `lodMetaProblem` | Only streamed SOG scans. A single `meta.json` SOG has no tree (`LodState.kind` 'meta', mode 'single'). The culler takes flat leaf bounds (`boundsGroups`); a hierarchical "big node out, children out" early exit was not found. |
| Then individual splats outside the camera are culled | yes | stochastic: `vendor/supersplat-viewer/render/shaders/projector.ts` (per-node bit on the CPU, per-splat alpha/size/contribution cull, previous-frame occlusion grid); sorted: engine projection | Sorted per-splat clip not read in shader code (Not verified). |
| LOD chosen by camera distance | yes | engine `GSplatOctreeInstance.evaluateNodeDistances` + budget balancer; ours `renderer.ts` constructor: `splatBudgetMode = GSPLAT_BUDGET_TARGET`, `splatBudget` from the preset | Budget is a target: detail is raised until the budget is filled. |
| Priority: closer to the frame centre loads the finest level first | no | `evaluateNodeDistances`: penalty only when `dot(forward, toNode) < 0` (behind); ours `lodBehindPenalty = 5`, `lodUpdateAngle = 90`. Load order: `requestFile` priority = `tier + (lodLevel + distanceRank) / lodLevels`, distanceRank from the same penalised distance | Inside the front hemisphere a node at the screen edge, or outside a 115 deg FOV but in front, gets the same priority as the centre. |
| Cache everything, no constant LOD switching | partly | engine `cooldownTicks = 100` (unused files stay before unload; we keep the default), `lodUpdateDistance = 1` (default), `lodUpdateAngle = 90`, `lodUnderfillLimit = 0` (no coarser fallback, default), `lodDistanceShrink = 0.75` (default); our `FrameGovernor` steps down after 1 s and up only after 5 s calm (`DEFAULT_GOVERNOR`) | No hysteresis band per node: a node at a level boundary can flip each re-evaluation. Switch rate never measured. |
| Stochastic works with this | yes, 4090 only | `renderer.ts` `setStochastic` -> `accum.ts` / `stochastic-splat-renderer.ts` take the engine's LOD, streaming and work buffer (`docs/wip/v11-s.md`); TAA caps history on a resident-set change (`taaMoveMax`) | Governor never turns stochastic off. Benefit on weak GPUs not measured; v11-s withdrew the 40-66 % GPU saving. |

Device knowledge today:
- `packages/render-pc/src/device-class.ts` `classifyDevice`: phone / tablet / desktop-weak / desktop-strong from user agent, touch, screen, WebGPU, adapter info, `deviceMemory`, cores, `maxBufferSize`. No timing at all: a guess from what the browser says.
- `presets.ts` `BUILTIN_PRESETS`: desktop-strong 4 M / scale 1; desktop-weak 2.5 M / 0.85; tablet 2 M / 0.85; phone 2 M / 0.7; all sorted. Owner overrides per class in the admin (`readDrawingDefaults`). The earlier note says the live catalogue sets stochastic for both desktop classes (Not verified here).
- `apps/fly/src/app/quality.ts` `Quality`: governor step x pilot Quality slider (`display.quality`) x preset scale; `setFrameDelay` burns CPU per frame (test hook).
- `governor.ts` `FrameGovernor`: missed frame = interval > 1.25 display periods, 60 intervals learned first, 5 steps (scale 1..0.5, budget 4..1.5 M scaled by the top). It starts at step 0 on every load: a weak device spends its first seconds missing frames on the way down.
- R30 GPU hint: `device-class.ts` `gpuSwitchHintDue`, `apps/fly/src/app/builtin/gpu-hint.ts` (Windows + WebGPU + Intel integrated: tell how to switch to the discrete GPU, once).
- Prefs `packages/prefs/src/defs/display.ts`: `display.quality`, `display.drawing`, `display.budget`, `display.deviceClass` (shipped); `display.governor` planned (URL `?governor=0` only).
- Reports: `window.__gsfpv.lod()` and the bug report's `lod` = `apps/fly/src/app/lod.ts` `lodReport` (kind, levels, range, mode, drawn, budgetM, loading, renderScale, topBudgetM, governorStep, governorBudgetM, settingBudgetM, streamHitches). Bug report `frames` (`diagnostics.ts` `collectDiagnostics`): renderHz, p50ms, p99ms, held (from `FlightSession.frameStats`). No p95, no LOD switch count, no device-check result.

## 2. Design

### 2.1 Device check at start (first release)
- When: the first flight on this browser, after the reveal, in the first 10 s of normal flying (estimate). No separate test screen: the pilot flies, the page measures.
- What: frame intervals and held frames (the governor's own inputs), p50 and p95, plus the governor step where it settled at the end of the window, the drawing in use (sorted / accum / engine), class, GPU name (`gpuName`), render scale, budget, scene id and content kind.
- Decision: remember the settled step per browser (localStorage, versioned: gpu name + class + release major). Next load starts the governor at that step (new `FrameGovernor.startAt(step)`), so a weak device does not begin with missed frames. The governor still moves up after 5 s calm, so a wrong start costs at most a few seconds (estimate from `DEFAULT_GOVERNOR`).
- Re-check: when the GPU name or class changes, or when the pilot presses "Check again" (Settings, Display). The pilot keeps every existing control: Device class, Quality, Render, Splat budget.
- Optional (owner decision 2): send the anonymous result (gpu name, class, drawing, step, p50, p95, scene id) to our API, so real weak-device numbers appear.
- Words for the pilot (one line, once, then only in F3): "This computer draws scans slowly. We started at 70 % resolution and 2 M splats so the flight stays smooth. Change it in Settings > Display." When nothing is lowered: no message. F3 adds: "device check: step 2 of 4, p95 31 ms".

### 2.2 LOD budget with frame-centre priority
- The engine has no public hook for an angular priority; only `lodBehindPenalty` (behind hemisphere) and `lodUpdateAngle`. AGENTS.md: render-pc uses the public engine API only (`a1-api-check.ts`).
- Step A (public API, no engine change): raise `lodBehindPenalty` and lower `lodUpdateAngle` (90 -> 30 deg, estimate) so that more of the budget goes forward; measure.
- Step B (engine change): an angular penalty instead of the behind-only one: factor = 1 + k * clamp((angle - a0) / (a1 - a0), 0, 1), a0 = a small cone around the view axis, a1 = half FOV plus a margin (values estimate). The same distance drives the load queue (`distanceRank`), so the centre also loads first, exactly the owner's words. Prototype it as a bench-only override of `evaluateNodeDistances` to measure the gain; ship either as an upstream PlayCanvas PR or as a `pnpm patch` (owner decision 1).
- Risk on fast yaw: off-centre nodes are coarser, a fast turn shows coarse detail until the queue catches up. Mitigation: penalty capped (k small, estimate 2-3), `lodUnderfillLimit = 1` so a loaded coarser level shows instead of a hole.

### 2.3 Against LOD flicker
- Measure first (2.5 metric "LOD switches per minute"); tune only if the count is high.
- Public knobs in `renderer.ts` constructor: `lodUpdateDistance` (1 m today: at 20 m/s an FPV craft re-evaluates about every 3 frames at 60 Hz, estimate), `cooldownTicks` (100 today, more = more VRAM), `lodUnderfillLimit` (0 today). Governor budget steps also move every node's LOD: its 1 s / 5 s windows stay.
- A true per-node hysteresis band (switch finer at d, coarser only at d * 1.15, estimate) needs the same engine change as 2.2 Step B: bundle them.

### 2.4 Scenes without LOD (single `meta.json`)
- The budget does not lower them (engine docs per the earlier note: rendered in full; Not verified in code). Only render scale and the drawing help.
- Pilot words (F3 already says "single"): on a device below desktop-strong, once per scene: "This scan has no levels of detail, so it is drawn in full; resolution is lowered to keep it smooth."
- Count such scenes in the catalogue with the browser bench (opens each scene from the public CDN, reads `lod().kind`); our own scans: convert with the `/3dgs-sog-lod` skill.

### 2.5 Stochastic
- Centre priority and flicker tuning change only which nodes are resident; the accumulating renderer takes the resident set as is, so no change there. Fewer switches also means fewer TAA history caps (less colour lag).
- The device check measures the drawing actually in use; whether desktop-weak should be sorted or stochastic is decided by its data (owner decision 3).
- Re-run `accept-v11-stochastic.ts` V2, V3, V7 after any LOD change.

## 3. Verifying without a weak device

Honestly emulated on the 4090 PC (visible system Chrome, as the existing benches do; headless WebGPU on this PC Not verified):
- render scale and pixel count (a9 already scales pixels by sqrt(2) and 2 as its control);
- splat budget caps, preset by class (`display.deviceClass`, `?budget=`), governor on/off (`?governor=0`);
- CPU load: `__gsfpv.setFrameDelay(ms)` and CDP `Emulation.setCPUThrottlingRate` (4x, 6x);
- network: CDP network throttling for streaming order and the first view;
- a phone user agent and viewport (`probe-v08-lod.ts` `PHONE=1`).
Not emulated: integrated-GPU fill rate and memory bandwidth, shared memory limits and eviction, thermal throttling, driver quirks, the browser picking the integrated GPU (R30), real 30/60 Hz panel behaviour of laptops. Frame times from the 4090 are never published as weak-device numbers.

Benches to reuse: `tools/bench/src/a9-frame.ts` (lab `frame.html`, GPU timestamp per pass, median/p95, negative control 2x/4x pixels); `probe-v08-lod.ts` (per-level splats from `nodeInfos`, governor, fps, bytes, VRAM; `LABEL`, `SETTLE_S`, `QS`); `accept-v08-lod.ts` (L1-L4); `accept-v11-stochastic.ts` (V1-V9). New: `probe-v5-weak.ts` adds p95, splats per frame, splats in the frustum, LOD switches per minute (count of nodes whose `currentLod` changed, internals read-only as probe-v08-lod does).

Scenes: `ba7aa29d` (Opole cathedral, streamed, 10 levels, measured in v08-c), `39e63ce9` (small interior, `lod-meta.json` per the 2026-09-22 probe), `2f1ddf5f` (Lublin, 259 M), `7a475d38`, `224aba38` (v11-s set); one single-file scene, to be found by the count in 2.4.
Paths: a fixed pose path per scene (hover, 360 deg yaw, 20 m/s straight, fast yaw), 60 s each, 3 repeats.
Metrics before / after: frame interval p50 and p95, held frames, governor steps and changes, splats drawn, splats in the frustum / drawn (the share wasted outside the frame), finest level in the centre 20 % of the screen, LOD switches per minute, VRAM, bytes.
Negative controls: (a) the "after" build with the new parameters set back to today's values must reproduce "before" within run-to-run spread; (b) a deliberately inverted penalty (edges preferred) must lower centre detail, or the centre metric is blind; (c) `cooldownTicks = 0` must raise switches per minute, or the switch counter is blind; (d) device check with `setFrameDelay(40)` must pick a lower step, with 0 it must stay at the top.
Real weak-device data: only from the device check reports (2.1) or a pilot's bug report.

## 4. Stages

Branch 1 `v5-devcheck` (first release, smallest useful: a weak device starts where it will end up, and we learn real numbers):
- Owns: `apps/fly/src/app/device-check.ts` (new), `apps/fly/src/app/quality.ts`, `packages/render-pc/src/governor.ts` (`startAt`), `apps/fly/src/app/diagnostics.ts` (p95, device check), `apps/fly/src/app/lod.ts` (F3 line), `packages/prefs/src/defs/display.ts` + `defs.test.ts`, `packages/i18n/locales/fly/devcheck/*` (four languages), `tools/bench/src/accept-v5-devcheck.ts`.
- Contracts: `DeviceCheckResult { v: 1; gpu: string; cls: DeviceClass; drawing: 'sorted' | 'engine' | 'accum'; step: number; p50ms: number; p95ms: number; scene: string; kind: 'lod-meta' | 'meta'; at: string }`; `__gsfpv.deviceCheck()` returns it or `{ status }`; `FlightSession.frameStats()` gains `p95`.

Branch 2 `v5-lod-measure` (parallel with 1):
- Owns: `tools/bench/src/probe-v5-weak.ts`, `docs/wip/weak-devices-results.md`, the scene count of 2.4, and the public-API knob table (2.2 Step A, 2.3) as `renderer.ts` constructor values behind `?lodAngle=`, `?lodPenalty=`, `?underfill=` for benches only.
- Contract: evidence `evidence/<date>/v5-weak-<label>.json` with the metrics of section 3.

Branch 3 `v5-centre-lod` (after 2 shows the off-centre share is worth it, and after owner decision 1):
- Owns: the engine change (upstream PR or `patches/playcanvas@2.23.2.patch`), `renderer.ts` parameter wiring, `a1-api-check.ts` allowance, re-runs of `accept-v08-lod.ts` and `accept-v11-stochastic.ts`.

## 5. Risks, owner decisions, Not verified

Risks:
- A remembered low step on a device that got faster (driver, power plug): the governor climbs back after 5 s calm; "Check again" resets.
- Centre priority can make a fast turn look coarse; capped penalty and underfill fallback, measured on the fast-yaw path.
- An engine patch breaks on the next PlayCanvas bump; the accumulating renderer already depends on engine internals (v11-s). Upstream PR preferred.
- Anonymous reports: GPU name plus scene is a fingerprint risk; send coarse fields only, and only with the pilot's consent.

Owner decisions (default in brackets):
1. Engine change for centre priority: upstream PR only, or also a local `pnpm patch` until it lands. [Measure first with the bench override; patch only if centre detail at the same budget rises clearly and fast yaw is not worse.]
2. Send device-check results to our API. [Yes, anonymous coarse fields, opt-out in Settings.]
3. Drawing for desktop-weak. [Sorted, until device-check data from at least a few weak devices says stochastic is faster.]

Not verified:
- Any frame time on a weak or integrated GPU; the 4090 is the only measured device.
- The live catalogue's preset overrides (earlier note says stochastic for both desktop classes).
- Culling on the WebGL CPU-sort renderer; per-splat clipping in the sorted vertex stage; whether the culler skips children of a culled node.
- That single-file SOG ignores the splat budget (from PlayCanvas docs via the earlier note, not from code).
- How many catalogue scenes are single-file; that `39e63ce9` is still streamed today.
- WebGPU in headless Chrome on this PC; `frame-timing.ts` GPU timestamps outside the lab page.
