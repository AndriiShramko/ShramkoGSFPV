# Latency: where the 300-400 ms comes from and how to remove it (task A)

Agent: latency-trace, 2026-09-27 01:20-02:05 CEST. Code read in `C:/dev/gsfpv-wizard` (branch `fix/wizard-user-paced`, = live release) and checked against `C:/dev/ShramkoGSFPV` (main + v0.3 wave 1, same renderer/session/runner timing code; HUD moved to `apps/fly/src/ui/hud.ts:239`, governor to `apps/fly/src/app/builtin/quality.ts:21-41`). Nothing in either repo was edited. Scripts and raw data: `C:/dev/ShramkoGSFPV/.cache/lat-vox/latency-trace/` (`probe.mjs`, `pages.mjs`, `trace.mjs`, `labframe.mjs`, `gpuload.ps1`, `out/*.json`).

## 0. Short answer

1. **"30 ms" in the HUD is the frame interval, not latency.** F3 (`apps/fly/src/main.ts:647`) shows `frame p50 … ms` (`apps/fly/src/ui/flight.ts:276`, from `session.ts:709-715` = median gap between frames). His display runs 3840x2160 at **30 Hz**, so the gap is 33.3 ms. The real input -> presentation is 3-4 such frames. Chrome's own presentation timestamp, measured today on the live page: **median 120 ms** for the page as it loads. The A9 capture on 2026-09-24 measured **252 ms** with DaVinci Resolve loading the GPU.
2. **Three causes explain the 187 ms gap between 252 ms and the 65 ms blank-page floor** (details in section 3):
   - **~100 ms:** frames queued behind another GPU user (DaVinci Resolve).
   - **~67 ms:** Chrome's compositor stays in a slow state after the scene loads, which adds 2 frames.
   - **~20 ms:** a WebGPU canvas presents 1 frame later than a DOM repaint.

   The 30 Hz display turns every frame of delay into 33 ms.
3. **The biggest code fix is one line of behaviour, and it is measured.** Skip one `requestAnimationFrame` after loading and after any main-thread hitch. On the live page, rAF -> presentation drops from **100 ms to 33 ms**: 3.0 frames down to 1.0 frame, in 18 of 18 windows before the skip and 26 of 26 after. Input -> presentation drops from **120 ms to 48 ms** median.
4. **The biggest hardware fix needs Andrii.** His monitor is a Samsung U28D590 connected by **HDMI**. At 3840x2160 Windows offers only 23/24/25/29/30 Hz. The monitor does 4K at **60 Hz over DisplayPort 1.2**, and it has no 75 Hz mode at 4K. A DisplayPort cable halves every frame-quantised stage.
5. **Everything below was measured without Andrii and without screen capture.** I used Event Timing (Chrome's presentation feedback), a Chrome trace (cc scheduler state), timestamp queries and onSubmittedWorkDone. Only the radio, the monitor setting and a glass-to-glass camera test need him.

## 1. Conditions of my measurements

- RTX 4090, Chrome 153.0.8010.53, Windows 10.
- Display 3840x2160 @ 30 Hz: `EnumDisplaySettings` read-only, `WmiMonitorConnectionParams.VideoOutputTechnology = 5` (HDMI), monitor `WmiMonitorID` = SAM U28D590 (2014).
- Playwright with system Chrome, headed, window 1100x720. The viewport was emulated at 2560x1440 CSS with dpr 1.5, which is Andrii's 3840x2160 at 150 %.
  - **A real maximised window was not measured.** The desktop was in active use (user idle 0 s at 01:53), so I did not cover it.
- Keys were injected over CDP (`Input.dispatchKeyEvent` F13) and went through the simulator's `?lat=1` keyboard path. Scene 39e63ce9. `governor=0` unless noted. Beacons were answered locally.
- **DaVinci Resolve was rendering during every fly window** ("710 Steps — 8K60"). Windows GPU-engine counters for Resolve: 3D 22-31 %, copy 74-89 %, video-encode 30-42 %. nvidia-smi showed 89-93 % utilisation.
- 45 key presses per window at random phase; about 280 frames per window.
- Validity guard: the probe brings the window to the front and measures only at a 30 Hz rAF rate. One earlier run fell to 1 Hz while covered and was discarded.
- Also checked without Playwright's default Chrome switches (`STOCK=1`: field trials on, no automation flags). The results were identical (`out/stock-flags.json`).

## 2. The path, stage by stage (P = display period: 33.3 ms now, 16.7 ms at 60 Hz)

| # | Stage | Code | 30 Hz | 60 Hz (estimate) | Can queue whole frames? |
|---|---|---|---|---|---|
| 1 | Radio stick -> USB report | EdgeTX firmware | 1-4 ms, from the source code (sec. 6), **not measured** | same | no |
| 2 | USB -> Chrome -> page | WebHID `hid.ts:64-81` (event, `e.timeStamp`); Gamepad `gamepad.ts:56-65` (own poll >= 2 ms + Chromium 4 ms poll) | WebHID not measured; Gamepad about +3 ms average (arithmetic); CDP key -> handler 0.3-0.5 ms measured | same | no |
| 3 | Controls -> arm gate -> SimClock queue | `controls.ts:175-185`, `session.ts:419-422`, `simclock.ts:50-61` | < 0.1 ms, stamped at the event time | same | no |
| 4 | Wait for the next rAF (all samples up to frame start are consumed in that frame) | `session.ts:200,435-446`, `simclock.ts:74-91` | **measured p50 16-20 ms, p95 30-33 ms** (uniform 0..P) | 8.3 avg, 16.7 max | no (half a frame on average) |
| 5 | Physics 1 kHz catch-up + camera pose | `runner.ts:146-188` (cap 250 steps, `:12`), `session.ts:446-461` | inside the CPU tick below | same | no (a stall > 250 ms is skipped, not replayed) |
| 6 | PlayCanvas update + encode + submit | PlayCanvas `app-base.js` tick; `webgpu-graphics-device.js:366-395` | **CPU tick p50 1.1-1.2 ms, p95 1.5-1.9 ms** (all fly windows) | same | no |
| 7 | GPU render (splats, GPU sort) | render-pc; canvas size `renderer.ts:174,192-199` | **GPU busy p50 2.0-7.7 ms, p95 3.7-14.6 ms; submit -> GPU done p50 5.5-11.7 ms** (table 4a) | same ms; P = 16.7 ms: p95 15.8 ms at 5760x3240 near a wall barely fits | **YES**: when GPU time > P, or another app uses the GPU. Measured 3-6 frames in flight (4b, 4c) |
| 8 | Chrome compositor (cc + Viz): rAF -> presentation | Chrome | **as loaded: 3 frames = 100 ms; after a hitch: 2 frames = 67 ms; recovered: 1 frame = 33 ms** | 50 / 33 / 17 ms | **YES**: the "high-latency" state adds 1-2 frames (sec. 4d) |
| 9 | DWM composition + scan-out (presentation -> what Desktop Duplication sees) | Windows | about 1 P, 33-41 ms. Derived from the A9 blank floor (65 ms, capture) minus today's DOM event -> presentation (p50 24-32 ms); **not directly measured** | about 17 ms | 1 frame |
| 10 | Panel | U28D590, TN, 1 ms GtG per spec | **not measured** | | |

Estimated input -> screen (stages 1-9, no GPU contention):

| State | 30 Hz | 60 Hz (estimate) |
|---|---|---|
| As loaded | 2 + 17 + 100 + 33 ≈ **152 ms** (Event Timing 120 + 33) | ≈ **77 ms** |
| Recovered | 2 + 17 + 33 + 33 ≈ **85 ms** (Event Timing 48 + 33 = 81) | ≈ **44 ms** |

Add the GPU queue when Resolve or another app loads the GPU: A9 +100 ms; measured spikes up to +530 ms.

Input sampling is not "too early". The physics consumes every sample stamped before `performance.now()` at the start of the frame that renders it: `session.ts:446` -> `simclock.ts:77-88`, and the sample is applied at the first 1 ms tick at or after its time (`runner.ts:162-170`). The only structural wait is stage 4: half a frame on average.

## 3. Why 252 ms when the floor is 65 ms (A9, 2026-09-24), ranked

The A9 stages were: input -> physics 15.8 ms, physics -> frame end 0.6 ms, frame end -> GPU done 100.1 ms, GPU done -> output 136.2 ms. The gap to the floor is 187 ms:

| Rank | Cause | Share of the 187 ms | Evidence |
|---|---|---|---|
| 1 | **GPU queue behind another GPU user** | +100 ms, 53 % | A9 frame end -> GPU done = 100.1 ms, about 3 frames. The A9 fly window was only 960x720 CSS, so this was not our own pixel cost; DaVinci Resolve was open. Today, with Resolve rendering, the queue is usually absent (submit -> done 6-12 ms). One 10 s window (01:25, yaw 600 deg/s, 5760x3240) had up to 6 frames in flight, submit -> done p95 394 ms / max 533 ms, rAF interval p95 100 ms, nvidia-smi 88 %, event -> presentation p95 232 ms / max 328 ms (`out/smoke-fly.json`). Our governor (`governor.ts:72`) only reacts to late rAF, and rAF stays at 30 Hz while the queue grows. |
| 2 | **Chrome compositor stuck in main-thread high-latency mode after loading** | +2 frames = +67 ms, 36 % | Mechanism in 4d. A9's GPU done -> output (136 ms) fits it: today, GPU done -> presentation as loaded is 87-90 ms, plus about 33 ms of DWM, gives 120-123 ms. |
| 3 | **WebGPU canvas vs DOM repaint** | about +20 ms, 11 % | The floor page repaints DOM cells in the key handler: event -> presentation p50 24-32 ms. The best WebGPU state still presents 1 frame after the rAF. |
| 4 | Our CPU (1.2 ms) and GPU (3-8 ms) time | inside stage 3 | Costs latency only when it exceeds P. |

The sum is 100 + 67 + 20 ≈ 187 ms, matching the measured gap. Every item except the GPU milliseconds scales with P, so at 30 Hz everything is 2x what it would be at 60 Hz.

Why it *feels* like 300-400 ms:

- The A9 p95 was 295 ms and the max 341 ms, with spikes when Resolve works.
- The radio (1-4 ms) and the panel are not in those numbers.
- 30 fps motion reads as sluggish on its own.
- Not measured: whether the flight model's response matches his real quad. Motor tau is an estimate of 15 ms (`presets/pavo20pro-3s.json` `motor_tau_ms`), and the feed-forward is PT1 30 Hz (`sim.ts:81`). A real quad has similar dynamics, so these are not "latency", but brief item 21 says the feel is off.

## 4. Measurements (raw data: `.cache/lat-vox/latency-trace/out/`)

### 4a. Live page, `out/main-emu.json`

Event -> presentation (ET) is Chrome Event Timing. rAF -> presentation is ET minus the event's wait for the rAF that consumed it, in frames of 33.3 ms. All windows had frames in flight p50 0, rAF interval 33.3 ms, CPU tick 1.1-1.2 ms, and event -> consuming rAF p50 16-21 ms.

| Window | Canvas px | GPU busy p50/p95 ms | Submit -> GPU done p50 ms | Event -> GPU done p50 ms | ET p50/p95 ms | rAF -> presentation |
|---|---|---|---|---|---|---|
| F1 as loaded, hover, scale 1 | 5760x3240 | 7.7 / 14.6 | 11.2 | 34.9 | **120 / 136** | **3.01 frames** |
| F2 as loaded, yaw 600 deg/s | 5760x3240 | 4.9 / 10.5 | 9.1 | 28.9 | **120 / 128** | **3.00** |
| F3 one rAF skipped, hover | 5760x3240 | 8.0 / 14.1 | 11.7 | 33.7 | **48 / 64** | **1.02** |
| F4 yaw, s1 | 5760x3240 | 5.4 / 13.0 | 9.6 | 29.5 | 48 / 64 | 1.01 |
| F5 yaw, s0.667 (= dpr fix) | 3840x2160 | 2.8 / 5.8 | 6.3 | 25.3 | 48 / 64 | 0.97 |
| F6 yaw, s0.5 | 2880x1620 | 2.0 / 3.7 | 5.5 | 24.3 | 48 / 64 | 1.01 |
| F7 yaw, s0.667, budget 1.5M | 3840x2160 | 2.5 / 4.1 | 5.9 | 26.0 | 48 / 64 | 0.98 |
| F8 yaw, governor on (as shipped) | 5760x3240 | 5.4 / 10.3 | 10.9 | 34.2 | 56 / 64 | 0.98 |

- The HUD's own `frameStats` read p50 33.3 ms in every window: the "30 ms".
- The governor stayed at step 0. It never fires at 30 Hz on this GPU, because frames are not late.

### 4b. Controls on synthetic pages (served from a Playwright route; `out/main-emu.json`, `cfg-*.json`, `overlay-test2.json`)

- **DOM floor** (key handler repaints a 16 px marker): ET p50 24-32 ms.
- **Minimal WebGPU canvas at 3840x2160** (key consumed at the next rAF, like the simulator): rAF -> presentation 1 or 2 frames (33 or 67 ms). The state varied between runs and depended on start-up long tasks.
  - No effect from: a DOM overlay on top, a canvas larger than the device (5760x3240), or `alphaMode` premultiplied.
  - PlayCanvas's exact canvas config (usage COPY_SRC|COPY_DST, `viewFormats` srgb, toneMapping) is **inconclusive**: +1-2 frames over the base page in 2 of 3 runs, equal in the third. It is not the root cause. On the fly page, reconfiguring usage to RENDER_ATTACHMENT did not help, and one skipped rAF fixes the page with the config unchanged.
- **Positive control, GPU-bound** (fragment shader set to 42 ms per frame at P = 33 ms):
  - frames in flight p50 3, max 5
  - submit -> GPU done p50 156 ms, p95 247 ms
  - rAF -> presentation 3.95 frames, ET p50 160 ms
  - rAF interval p95 100 ms

  This is the queueing mechanism that a latency-aware governor must prevent.

### 4c. Lab frame page on the local release lab build

Built into scratch, served by `vite preview` on port 5361 (stopped afterwards). `out/labframe.json`: release engine, 0 validation scopes, timestamp-query supported, per-pass times.

| Scenario | Canvas | GPU busy p50 / p95 ms | CPU tick p50 |
|---|---|---|---|
| yaw 600 deg/s (bot, real physics) | 5760x3240 | 4.9 / 10.0 | 1.1 ms |
| yaw 600 | 3840x2160 | 2.6 / 5.3 | 1.1 ms |
| yaw 600 | 2880x1620 | 1.7 / 3.2 | 1.1 ms |
| wall 0.3 m | 5760x3240 | 8.65 / 15.8 | 1.0 ms |
| wall 0.3 m | 3840x2160 | 4.6 / 7.9 | 1.0 ms |
| wall 0.3 m | 2880x1620 | 2.9 / 4.8 | 1.0 ms |

- The negative control fires: more pixels always gives more GPU time. The repeat at scale 1 reproduced within 3 %.
- The splat raster pass `_f` is 85-96 % of GPU time. The projector and sort passes take 0.07-0.13 ms each (Chrome quantises timestamps to 0.066 ms).

### 4d. Why the page is stuck at 3 frames (Chrome trace, `out/trsched.json`, `out/tr1.json`)

PipelineReporter, BeginImplFrame -> presentation for frames with a main frame:

| Page | PipelineReporter |
|---|---|
| Fly page | 100.0 ms |
| Minimal WebGPU page | 33.3 ms (66.7 ms in another run) |

On the fly page:

- `EndActivateToSubmitCompositorFrame` = 29.3 ms, against 0.2 ms on the minimal page.
- The cc scheduler state has `main_thread_missed_last_deadline = true` in 767 of 774 states, with the `MainThreadLatency` counter = 1. On the minimal page it is false in 811 of 811 states.
- `pending_submit_frames = 1` in 575 of 774 states.
- 254 reporters for 128 main frames (tr1).
- No `SkipBeginMainFrameToReduceLatency` event: Chrome never tried to recover.

This is cc's "main thread high-latency mode": each main frame is drawn one BeginFrame later. Viz adds another frame on top of that.

Entry and exit, measured on the live page (`out/reentry.json`, `fly-skipraf.json`, `stock-flags.json`, `spin-fly.json`):

- **Entry:** loading, or any single main-thread task of 40 ms or more (40, 60 and 150 ms tested) puts it at 2-3 frames.
- **Exit:** one skipped rAF of 34 or 100 ms returns it to 1 frame, and it stays there. It survived scale and budget changes, yaw, pause and resume, and a 20 ms per frame CPU burn.
- **Not causes:**
  - the gamepad `MessageChannel` poll loop (`gamepad.ts:56-65`: 1.0 frame with it running)
  - the keyboard's 2 ms `setInterval` (`keyboard.ts:59`)
  - the HUD DOM
  - `alphaMode`
  - the GPU profiler
- Crash, respawn, menus and window switches were **not measured**. They probably re-enter the state, because they run long tasks.

## 5. Fixes, in order of effect

The table gives the effect at 30 Hz / 60 Hz. Each fix has an acceptance test with a negative control.

| # | Fix | Where | Effect | Test / control |
|---|---|---|---|---|
| 1 | **DisplayPort cable** (Andrii) -> 3840x2160 @ 60 Hz. Alternative today over HDMI: 2560x1440 @ 60 Hz. | monitor | Every frame-quantised stage halves: about 152 -> 77 ms as loaded, 85 -> 44 ms with fix 2. 75 Hz is not offered at 4K (only at <= 1280x1024). | The probe reads the display period (rAF 16.7 ms). lat.py output-rate step. |
| 2 | **Latency guard: skip exactly one rAF** (cancel `app.frameRequestId`, re-request after about 1 P). Run it (a) at the reveal (`session.ts:210-216`), (b) after any frame with interval > 1.5 P or rAF lateness > P/2, or a long-animation-frame entry, (c) after closing Controls, pause or menus and on `visibilitychange` -> visible. Rate-limit to 1 per second. SimClock absorbs the gap (`simclock.ts:74-91`). | `renderer.ts` (new `recoverLatency()`), trigger in `main.ts:400-408`. v0.3: `app/builtin/quality.ts:41` or a new builtin. | **-67 ms / -33 ms** (rAF -> presentation 3 -> 1 frames). Costs one repeated frame per event. | Probe: rAF -> presentation <= 1.2 frames 3 s after load and 3 s after an injected 60 ms task. Control: guard off gives >= 2 frames (measured 2.0-3.0). |
| 3 | **Never queue on the GPU.** Keep one `onSubmittedWorkDone` per frame (already in `latency.ts:56`, instrumentation only). If the previous frame is not done at rAF, do not render this one: `app.autoRender=false; app.renderNextFrame=…`, physics keeps stepping. **Latency-aware governor:** step down when submit -> GPU done > 0.5 P over 250 ms, not only on late rAF (`governor.ts:72`). HUD note: "GPU busy (another app, e.g. a DaVinci render)". | `renderer.ts`, `governor.ts`, `main.ts:329-347` | Caps the A9 +100 ms and the 400-530 ms spikes at <= 1 P plus GPU time. | Synthetic 42 ms GPU load: in flight 3-5 -> <= 1; submit -> done 156 ms -> < P + GPU time. Control: cap off. |
| 4 | **Fix the dpr-squared back buffer.** `renderer.ts:174` sets `device.maxPixelRatio = devicePixelRatio`, and `renderer.ts:193-194` already multiplies CSS px by dpr. PlayCanvas `graphics-device.js:446-449` then multiplies by `min(maxPixelRatio, dpr)` again. At dpr 1.5 the result is 5760x3240 = 2.25x the pixels (4x at dpr 2, 9x at dpr 3). Set `device.maxPixelRatio = 1`. | `renderer.ts:174` | No latency change at 30 Hz on a 4090. GPU busy about halves: wall p95 15.8 -> 7.9 ms, which is the headroom 60 Hz needs; it decides GPU-bound or not on weaker GPUs. | Lab frame page: canvas px = CSS x dpr; GPU busy ratio about 0.53 (measured 2.6/4.9 and 4.6/8.65). |
| 5 | **HUD: show the latency, not the frame gap.** "input -> screen ≈ N ms" = radio 2 + 0.5 P + (1 + extra) P + max(0, submit->done − P) + 1 P. Show "display 30 Hz — connect DisplayPort for 60 Hz" when P > 20 ms. With keyboard input, show the measured Event Timing value (the same method as the probe). | `flight.ts:276` (v0.3 `ui/hud.ts:239`), `session.ts:709-715`, F3 `main.ts:647` | Stops "30 ms" from being read as latency. | Probe ET + 1 P agrees with the HUD estimate within ±1 P. |
| 6 | **"Low latency" preset**: guard on, in-flight cap 1, scale <= native (after fix 4), budget <= 2.5M, detail auto, target GPU time <= 0.5 P. Suggest fullscreen (effect **not measured**). | settings + `quality.ts` | 2 + 3 + 4 together | same tests |
| 7 | Input: keep WebHID as the main path. Gamepad adds Chromium's 4 ms poll (`gamepad_provider.cc:78`) plus our >= 2 ms poll, about +3 ms average (arithmetic). Nothing to fix in sampling (sec. 2). | `hid.ts`, `gamepad.ts` | about 3 ms | not measured on hardware |

## 6. Autonomous measurement plan

- **A. Capture-free, any time, no human** (what I ran): `node .cache/lat-vox/latency-trace/probe.mjs <label> emu '<plan>'`, plus `trace.mjs` for cc and Viz stages. It gives Chrome presentation times, frames in flight, GPU time and cc state. Run it before and after fixes 2-5 with the controls in the table. It cannot see DWM, scan-out or the panel.
- **B. `tools/latency/lat.py` (SendInput + Desktop Duplication), before and after on this PC, no human.** Run it only when the desktop is free: no other agents' visible windows, and the Resolve render finished, because Resolve changes the result by about +100 ms. Use `--n 220` on the current build and on the build with fixes 2-4.
  - Existing controls: lagFrames=2 (+2 P) and the blank floor.
  - New control: `?guard=0` vs `1`, interleaved. Expected: -2 P.
  - Expected at 30 Hz: 252 ms -> about 85 ms (as loaded without contention, about 150 ms).
  - Note: it measures DWM output, not photons.
- **What neither A nor B can see: the radio's own delay.** EdgeTX `radio/src/targets/common/arm/stm32/usbd_hid_joystick.c:224` has `bInterval: Polling Interval (1 ms)`, and `:310` sets `bInterval = 1`. The mixer period is 1 ms in USB-joystick mode (`radio/src/mixer_scheduler.h:26-27`: default 4000 us, joystick 1000 us). With an active RF module, the module's period wins (`mixer_scheduler.cpp:69-86`). `usbJoystickUpdate()` runs once per mixer cycle (`tasks/mixer_task.cpp:193-197`). So the report rate is 1000 Hz with RF off and the module rate with RF on (e.g. 250-500 Hz for ELRS): **about 1-4 ms**, derived from source, **not measured**. Also not measured: the Windows HID stack and WebHID delivery (about 1 ms, unknown), and panel processing plus pixel response (spec: 1 ms GtG TN).
- **Only Andrii can:**
  1. Connect the monitor by DisplayPort and pick 3840x2160 @ 60 Hz, or pick 2560x1440 @ 60 Hz now. We are forbidden to change display settings.
  2. Not fly while Resolve renders.
  3. Optionally, film a 240 fps phone video of the stick and the screen together: the only glass-to-glass measurement that includes the radio and the panel.
  4. Say the radio model, the EdgeTX version, and whether the RF module is on.

## 7. Not measured (say so, do not claim)

- A real maximised window with native dpr (only emulated 2560x1440 @ 1.5).
- 60 Hz behaviour (not available; the display must not be changed).
- Whether crashes, respawns, menus or window switches re-enter the slow state.
- The radio and the WebHID stack on hardware.
- Panel latency.
- Fullscreen / DirectComposition overlay.
- Windows without Resolve rendering.
- The DWM stage directly (derived only).

Side effect to report: at 01:20 `chrome.exe --version` (used to read the version) opened one empty New Tab in Andrii's running Chrome window. It could not be closed from here: the tab is outside the automation group, and Chrome is read-only for computer-use.
