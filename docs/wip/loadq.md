# Lane loadq (train 3): a scan loads to the detail the pilot set, and the page says what it is doing

Worktree `C:/dev/gsfpv-loadq`, branch `loadq` from origin/main f286dd49. Ports 5820-5839. Runs and logs under
U:/Temp/gsfpv-train3/loadq, pictures under U:/Temp/gsfpv-train3/shots.

## Status

Stage L1-measure (no product change)
- [x] 0. Typecheck (pnpm -r typecheck exit 0) and release build of 0605d06f (dist sha256 b5b7abab...), serve-csp on 5820 with the Wroclaw walls stand-in in dist/walls
- [x] 1. Probe tools/bench/scripts/loadq-probe.mjs (every second: drawn, budget, who set it, levels, files, bytes) (a1a570e2)
- [x] 2. (a) Wroclaw 70b50d42 spawn, 120 s: desktop-strong, desktop-weak, 16 M by hand; scores against 16 M (0772fe9a)
- [x] 3. (b) what lowers a hand-set 16 M; five loads as is, five with every tenth file failing, one stalling (L1 close commit)
- [x] 4. (c) what the page tells the pilot today (L1 close commit)
- [x] 5. (d) G5 scores at 1366x768 and 1920x1080; G6 at rest, measured with the probe's STILL switch (L1 close commit)
- [x] 6. Design from the numbers: section "Design for L2" (L1 close commit)

Stage L1 is finished. The runs of items 3 to 5 ran 20:45 to 21:30 on build 0605d06f (product code unchanged since).
Hand-over gates (gates.py --only vitest,architecture,i18n,b18) on 0d08dad1: all PASS (vitest 118 s; Python must be on
PATH for tools/bench/test/rooms-socket.test.ts, it spawns `python`).

Stage L2-build
- [x] 0. Release build at the start (bebb7646, dist sha256 a2d8e503..., U:/Temp/gsfpv-train3/loadq/build-l2a.log). The
  pilot's view before the change is L1 (a) (same product code); not walked again.
- [x] 1. G1 to G4 built, unit tests and negative controls (d79b10df):
  - G1 apps/fly/src/app/detail-rule.ts drawPlan, used by apps/fly/src/app/quality.ts apply: a budget from the setting
    (builtin/drawing.ts passes from.budget === 'setting') is drawn at its splats and full render scale whatever the
    governor's step; the governor keeps counting; Quality.keeperSlow after 3 s at a lower step (estimate);
    Quality.release() is the line's press "Let the page choose" (holds until the setting changes).
  - G2 apps/fly/src/app/builtin/detail.ts: one line on the credit (where "Walls 5 cm" lives), every 0.5 s; states and
    texts in detail-rule.ts detailState/detailLine, i18n packages/i18n/locales/fly/detail/{en,es,pl,ru}.json; full and
    no-finer show 4 s (estimate) then hide; hook window.__gsfpv.detail().
  - G3 packages/render-pc/src/stream-keeper.ts, ticked 4 times a second by renderer.ts onFrameUpdate: the engine's
    immediate retries off (loader.maxRetries 0), a failed file asked again after 0.5, 1, 2, 4, 8 s (estimate), a file
    with no answer for 20 s (estimate) taken out of its slot and counted, given up after the last pause until the
    line's "Try again" (renderer.retryFailedFiles). Counts in renderer.streamStats().
  - G4: not hand-set: drawPlan as before; the line shows only files that did not arrive.
  - Tests: packages/render-pc/test/stream-keeper.test.ts (4), tools/bench/test/loadq-detail.test.ts (7); all pass with
    fly-parity, render-pc, app-lod, drawing-ask (419 tests). Negative controls (the files are new, so by mutation):
    pin line removed: "expected { scale: 0.5, budgetM: 6 } to deeply equal { scale: 1, budgetM: 16 }"; constant pause
    and no stall cut: "expected 500 to be greater than or equal to 1000", "expected true to be false"; G4 guard
    removed: "expected 'coming' to be 'hidden'". tsc of render-pc and apps/fly exit 0; check-architecture ok;
    a1-api-check 71 checked, no problems.
- [x] 2. G6 built (000b96fd; probe switches 592243c2): apps/fly/src/app/detail-rule.ts StillRise and stillCapM, used by
  apps/fly/src/app/builtin/still.ts on every frame event (after Quality.frame, so a move is seen in the frame it happens
  and the base is set on the engine before the next frame is drawn). Still = speed under 0.3 m/s, turn rate under 15
  deg/s on every axis, roll, pitch and yaw sticks within 0.05 of centre and the throttle within 0.05 of where it was
  when rest began (all estimates), for 1 s; or the flight paused (the end of a pause is a move). Then x1.5 each second
  (as measured in L1) while the last second's median frame is under 66 ms (the lead's estimate), one step back when it
  is not, up to the memory cap (navigator.deviceMemory under 4 GB or 4: 4 M; under 8 or unknown: 8 M; 8 (Chrome's
  top answer): 16 M; estimate). While the still budget stands, Quality draws it at the top render scale and the
  governor neither counts frames nor remembers a settled step (slow still frames are chosen, not missed). The line
  says 'Detail: sharper while you hold still (2.5 M)' (state still, for every pilot). Setting: Settings, Display,
  'More detail at rest' (display.stillDetail, bool, on by default, advanced; label and help in en, es, pl, ru; defs.ts
  A8 row, V03_SHIPPED, count 83). The Splat budget help text now says a hand-set number is kept (G1) in all four.
  Tests: tools/bench/test/loadq-detail.test.ts 6 new (13 pass), prefs tests 273 pass, fly-parity pass, app-play,
  drawing-ask, public-ranges, app-lod, governor-start 61 pass; tsc apps/fly and packages/prefs exit 0. Negative controls
  by mutation (the rule is new): move ignored: 'expected 3.796875 to be +0'; frame bound ignored: 'expected 5.6953125 to
  be less than 1.6875'; line state removed: "expected 'hidden' to be 'still'". gen-catalog --check says the catalogue
  outputs are stale for the new setting (only the lead runs gen-catalog; see For the lead).
- [ ] 3. Release build of the change, then the browser proof on Wroclaw 70b50d42 (holds of at most 10 min, probe
  tools/bench/scripts/loadq-probe.mjs, port 5820): 16 M by hand reaches 15.59 M and the line says full; DROP=10 (3
  tries) and STALL=10 end full with the line showing the retries; the +30 ms frame run: the line says kept, the press
  works; an untouched pilot as L1 (a) (3.89 M, 30.65 dB). Record slowestMs of a fault-free run against STREAM_STALL_MS.
- [ ] 4. Pictures in U:/Temp/gsfpv-train3/shots: loadq-loading.png, loadq-full.png, loadq-held.png, each looked at.
- [ ] 5. accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16; lod-view on and off on Wroclaw and Lublin 2f1ddf5f;
  governor-start; a6-reference; gates.py --only vitest,architecture,i18n,b18,leaks.
- [ ] 6. 'What the owner does', 'not verified', every changed file under 'For the lead'. Commit.
Left for the next run of L2 (the reply budget of this run ended after item 1): items 2 to 6 above, in that order;
none of the new code has run in a browser yet (only typecheck and unit tests).

## Facts (measured)

### L1 (a), Wroclaw 70b50d42 at the spawn, 1920x1080, headless Chrome on the RTX 4090, display 30 Hz (20:00 to 20:45)

Probe tools/bench/scripts/loadq-probe.mjs, build 0605d06f on port 5820, camera held at the start place after the
reveal, governor ON (as a pilot has it) unless said. Per-second samples: U:/Temp/gsfpv-train3/loadq/<label>.json.
Score: lod-view-score.mjs against lq-wro-ref16 (16 M, governor off), PSNR luma over the scan, dB, full size
(U:/Temp/gsfpv-train3/loadq/score-a.txt).

| Run | Setting | End: drawn / budget in force / step / render scale | Settled, s after reveal | Requests / files, MB | Score t10 / t30 / t60 / end |
|---|---|---|---|---|---|
| lq-wro-ref16 | strong, 16 by hand, governor off | 15.59 M / 16 / - / 1 | 34.4 | 1904 / 1888, 927 | reference |
| lq-wro-strong | strong, untouched | 3.89 M / 4 / 0 / 1 | 21.0 | 1104 / 1096, 392 | 28.25 / 30.65 / 30.65 / 30.65 |
| lq-wro-weak | desktop-weak forced, untouched | 2.34 M / 2.5 / 0 / 0.85 | 15.2 | 968 / 952 | 27.30 / 27.54 / 27.54 / 27.54 |
| lq-wro-16 | strong, 16 stored | 15.59 M / 16 / 0 / 1 | 56.4 | 1952 / 1904, 941 | 22.12 / 39.93 / 71.70 / 71.97 |
| lq-wro-16live | strong, 16 set at 30 s (as the owner) | 15.50 M / 16 / 0 / 1 | 82.6 | 2816 / 2000, 1387 | 21.57 / 32.73 / 34.22 / 71.87 |
| lq-wro-16slow | 16 stored, +30 ms CPU a frame | 5.70 M / 6 / 4 / 0.5 | never calm in 120 s | 2368 / 1336, 1027 | 28.32 / 29.45 / 29.46 / 29.46 |
| lq-wro-16unc | 16 stored, BENCH_UNCAPPED=1 | 5.70 M / 6 / 4 / 0.5 | 21.1 | 1288 / 1256, 508 | 28.45 / 29.46 / 29.46 / 29.45 |
| lq-rep1..3 | strong, 16 stored | 15.59 M / 16 / 0 / 1 each | 56.6, 41.5, 44.5 | 2600, 2296, 2360 requests | not scored |

- The class: classifyDevice (packages/render-pc/src/device-class.ts) reads WebGPU, an Intel integrated adapter or not,
  navigator.deviceMemory, hardwareConcurrency, maxBufferSize. An RTX laptop whose browser runs on the NVIDIA card is
  'desktop-strong', the class of this PC (4 M, render scale 1); 'desktop-weak' only on Intel, no WebGPU, or two soft
  signs. The bench forces the class with `set.display.deviceClass=`.
- The owner's control: Settings, Display, Splat budget (pref `display.budget`: auto 1 2 4 8 16 32,
  packages/prefs/src/defs/display.ts:26). It becomes the governor's TOP (apps/fly/src/app/quality.ts setTopBudget);
  the steps scale with it: 16, 12, 10, 8, 6 M at render scale 1, 0.85, 0.7, 0.6, 0.5.
- Where the hand-set value is lost (b): the governor (packages/render-pc/src/governor.ts onFrame). It steps down when
  over 10 % of the last second's frames came later than 1.25 display periods; frames that stalled on a streamed file
  count too. lq-wro-16slow: 16 to 6 M and scale 0.5 within 7 s of the reveal (p90 frame 66.5 ms on a 33.3 ms period),
  then 6 and 8 M in turn every 5 to 10 s for 120 s: each step up asks files, each step down drops them; the scan never
  finishes (2368 requests for 1336 files). lq-wro-16unc: with the frame rate free on this RTX 4090 the learned period
  is about 2.5 ms and every tenth frame takes about 17.8 ms, so the governor went to 6 M and scale 0.5 in 4 s: a
  high-refresh screen (the owner's laptop) judges each frame against its own short period. Its end picture
  (29.46 dB) is worse than the untouched 4 M picture (30.65 dB), the half resolution costs more than the splats gain.
- lq-wro-16live: after the setting at 30 s the streaming hitches (22 frames/s, median 33.3 ms) made the governor go
  16 to 12 M at 49 s, up at 54, down at 57, up at 62, down at 67, up at 72 s; dropped files were asked again (2816
  requests for 2000 files, 1.39 GB against 0.94 GB) and the picture settled 52 s after the setting. "Sometimes it
  loads" is this mechanism: whether the governor holds still long enough depends on that minute's frames (a guess for
  the owner's laptop, measured here only).
- With the governor content (30 Hz display, no extra load) 16 M by hand loaded fully in 5 of 5 loads (lq-wro-16,
  lq-rep1..3, ref16): 15.59 M drawn, end picture 71.9 dB (equal to the reference). No class cap, no memory cap and
  not the view rule of laptop3 (it orders the budget, never lowered the count) lowered it.
- The engine's file loader (playcanvas 2.23.2 GSplatAssetLoader, build line 100835 on): a failed file is asked again
  at once, twice, with no pause (maxRetries 2), then kept in `_failed` and never asked again while the scan is loaded;
  a file that never answers keeps one of the 6 download slots for good (no timeout). Its effect in the page: runs
  lq-drop* and lq-stall, left.
- (c) What the page tells today: "The scan is ready" with the bytes while the first view loads, then nothing about
  detail: in every run the notes (sampled every 5 s, `notes` in each JSON) are the flight HUD only, while detail
  streams for 20 to 80 s and while the governor holds a hand-set 16 M at 6 M. The F3 line (apps/fly/src/app/lod.ts
  lodLine) has the budget and "lowered", hidden unless F3 is pressed.
- (c) seen in a picture: U:/Temp/gsfpv-train3/shots/lq-wro-16slow-ui.png (60 s after the reveal, 16 M set by hand, the
  governor holding 6 M at half resolution): the credit, "Walls 5 cm", the flight HUD; not one word about detail.
  In the stall run (below) the only text was the reveal's "Nothing arrived for 30 s, so you see what is here", then
  nothing while 0.01 M splats were drawn for the rest of the minute.

### L1 (b), failed and stalled files, Wroclaw spawn, 16 M by hand, 60 s each (20:43 to 21:00)

The probe's switches intercept the scan's files (page.route): DROP=10 answers every tenth distinct file with 503 for
its first DROPTRIES requests (3 = the engine gives the file up; 1 = one failure), STALL=10 never answers every tenth.

| Run | Reveal, s | Settled | Drawn at 60 s, M | Queue / in flight / pending at 60 s | Requests / distinct / failed | Governor step at 60 s |
|---|---|---|---|---|---|---|
| lq-rep1..5 (no fault) | 3.2 | 56.6, 41.5, 44.5, 45.5, 53.6 s | 15.59 each | 0 / 0 / 0 | 2600, 2296, 2360, 2368, 2560 requests | 0 |
| lq-drop1 | 11.4 | no | 14.90 | 37 / 6 / 16 | 2109 / 1465 / 436 | 0 |
| lq-drop2 | 11.5 | no | 10.75 | 51 / 6 / 29 | 1742 / 1248 / 367 | 1 (12 M) |
| lq-drop3 | 11.5 | no | 10.97 | 54 / 6 / 30 | 1712 / 1281 / 383 | 1 (12 M) |
| lq-drop4 | 11.4 | no | 14.93 | 44 / 6 / 25 | 1818 / 1400 / 418 | 0 |
| lq-drop5 | 11.4 | no | 15.57 | 8 / 6 / 2 | 2359 / 1792 / 537 | 0 |
| lq-drop1try (one failure a file) | 4.3 | 51.6 s | 15.50 | 0 / 0 / 0 | 2547 / 1952 / 195 | 0 |
| lq-stall | 31.6 | no | 0.01 | 160 / 6 / 108 | 64 / 64 / 0 (6 never answered) | 0 |

- "Sometimes it loads, sometimes it does not" is reproduced with a failing share of the files: 0 of 5 loads finished
  in 60 s, the drawn count at 60 s spread from 10.75 to 15.57 M; without a fault 5 of 5 finished (41.5 to 56.6 s).
  The failed files cost three immediate requests each (436 failed requests for about 146 files in drop1), the reveal
  came 8 s later (11.4 s against 3.2 s) and the requests went at about two thirds of the rate (1435 against 2296 by
  52 s, drop2 against rep2). Why the queue drains slower than the share of failed files explains is a guess
  (the routed requests, or blocks waiting on a failed parent): not measured.
- One failure a file is absorbed today: the engine's immediate retry (GSplatAssetLoader maxRetries 2) loaded
  drop1try fully in 51.6 s.
- A file that never answers is never given up: six of them hold all six download slots (renderer parallelLoads,
  maxConcurrentLoads) for good. lq-stall drew 0.01 M for the whole minute; the page revealed only by its 30 s
  no-progress rule. Neither the XHR nor the texture image the engine uses has a timeout (playcanvas 2.23.2 build:
  Http._onError, ImgParser image.onerror; no xhr.timeout anywhere).
- The engine's public knobs, all unused by the page today: app.loader.maxRetries is passed to Asset.fetchArrayBuffer
  (Http retries with a pause of 2^n x 100 ms, at most 5 s); the texture handler's maxRetries (pause 2^n x 100 ms).
  After the octree loader gives a file up it sits in GSplatAssetLoader._failed (not public) until the scan unloads.

### L1 (d) G5: what a weak device's screen shows (21:00 to 21:30)

Probe runs lq-g5-*, governor off, budget by the link, held 60 s (the Lublin 1920x1080 reference again for 100 s: the
first run had 12.0 M of 15.76 M at 60 s and was thrown away). Lublin 2f1ddf5f from 140 m above the start, pitch -35;
Wroclaw at the spawn. PSNR luma over the scan against the 16 M picture at the same size, dB, full / quarter size
(U:/Temp/gsfpv-train3/loadq/score-g5.txt, score-g6.txt; evidence/2026-11-15/lod-view/score-*.json).

| View | Screen | 0.5 M | 1 M | Reference drawn |
|---|---|---|---|---|
| Lublin from above | 1366x768 | 18.02 / 24.33 (0.47 M drawn, level 9.2) | 19.29 / 26.23 (0.97 M, level 8.1) | 15.76 M |
| Lublin from above | 1920x1080 | 17.96 / 23.81 | 19.34 / 25.86 | 15.76 M |
| Wroclaw street | 1366x768 | 23.60 / 26.48 (0.44 M, level 7.5) | 25.21 / 28.75 (0.97 M, level 7.0) | 15.59 M |
| Wroclaw street | 1920x1080 | 23.55 / 25.76 | 25.10 / 27.85 | 15.59 M (lq-wro-ref16) |

- The smaller screen does not hide the coarse levels: Lublin at 1366x768 scores the same as at 1920x1080 (18.0 dB at
  0.5 M), 12 to 13 dB under the untouched 4 M Wroclaw picture's 30.65 dB. Doubling 0.5 to 1 M gives +1.3 to +1.6 dB
  on both screens, as laptop4 measured at 3840x1970.

### L1 (d) G6 measured: detail rising at rest, Lublin from above, 1920x1080, BENCH_UNCAPPED=1, governor off

Probe switch STILL=30 (test only, no product change): from 30 s after the reveal the budget x1.5 each second while the
last second's median frame is under 66 ms, up to 16 M; pictures at 5, 10, 20 s; then the base budget back and pictures
at 0.4 s (move0) and about 1 s (move1). Scored against the 15.76 M reference above.

| Base | At rest: drawn M at 5 / 10 / 20 s | Median frame, ms | Fetched at 20 s, MB | JS heap, MB | Score base / rest5 / rest10 / rest20, dB | After the move: drawn 0.4 s / 1 s; score |
|---|---|---|---|---|---|---|
| 0.5 M | 3.35 / 10.08 / 15.81 | 2.3 to 6.4 | 462 | 61 to 351 | 17.88 / 22.82 / 26.07 / 47.45 | 11.86 / 2.05 M; 23.56 / 17.76 |
| 1 M | 5.41 / 9.59 / 11.67 | 2.2 to 7.4 | 337 | 82 to 307 | 18.63 / 23.92 / 25.75 / 26.75 | 9.22 / 3.52 M; 25.50 / 18.90 |

- The bar (at least +1 dB at rest at 0.5 M) is passed: +4.9 dB after 5 s, +8.2 after 10 s, +29.6 after 20 s (equal to
  the reference) on this PC. Caveat: on the RTX 4090 the 66 ms bound never bound (frames at most 7.4 ms), so the rise
  went to the 16 M cap. On a weak device the rise stops where its median frame reaches the bound: by the G5 doubling
  rule a device that draws 0.5 M in 16 ms has room for about 2 M under 66 ms, about +3 dB (estimate, interpolated, not
  measured on such a device). The engine's GPU memory count was not readable here (vramMB null).
- Falling back is not one frame: the budget is set back at once, but the engine sheds the extra splats over about
  1 s (0.5 M base: 11.86 M still drawn after 0.4 s, 2.05 M after about 1 s). The pilot sees the sharper picture thin
  out in that second (scores 23.56, then 17.76); the frame time in that second was not sampled.

## Design for L2 (from the numbers above)

Where the hand-set value is lost:
1. The governor (packages/render-pc/src/governor.ts onFrame, applied in apps/fly/src/app/quality.ts apply): the
   setting is only its top step; missed frames, streaming hitches included, step it down to 12, 10, 8, 6 M and render
   scale 0.85 to 0.5 (lq-wro-16slow, -16unc, -16live). Each step up asks files again, each step down drops them.
2. The engine's file loader: a file failed three times is given up for the life of the scan (lq-drop*); a file that
   never answers holds a download slot for good (lq-stall).
3. Not lowered by: the device class (the setting replaces the class's top), a memory cap (none exists), the view rule
   of laptop3 (it orders, never lowers the count).

G1, the hand-set value kept: when the budget comes from the pilot's setting (display.budget not auto, drawing.ts
`from` = setting), Quality pins it: apply() draws the setting's splats and render scale whatever the governor's step;
the governor keeps counting frames. If its step stays above 0 for 3 s (estimate) the line says the frames are slower
than the screen and offers "Let the page choose": one press unpins for this flight (the governor works under the
pilot's top, the setting stays); the line then names the keeper while it holds less. Not pinned (auto): no change.

G2, the line, where the walls line lives (under the credit, apps/fly/src/app/builtin/walls.ts), one line, plain words:
- coming: "Detail: 6.2 of 16 M, 14 files to go, about 20 s" (time from the file rate over the last 5 s; shown while
  files are pending and the setting was set by hand, or for anyone while the network state below holds);
- full: "Detail: full for your setting", 4 s (estimate), then hidden; when the setting asks more than the scan holds
  for this view and nothing is pending: "Detail: full: this scan has no finer level here";
- held by the keeper: "Detail: kept at your setting; the picture is slower than your screen" + [Let the page choose];
  after the press, while lowered: "Detail: 6 of 16 M: lowered to keep the flight smooth";
- network: "Detail: 12 files did not arrive, trying again"; after the last try: "Detail: 12 files did not arrive"
  + [Try again] (one press asks them again);
- memory: only if the device refuses memory (no such case measured here); a press to set a lower budget.

G3, the retry rule: a failed file is asked again up to 5 times with a pause of 0.5, 1, 2, 4, 8 s (estimate); a file
with no answer in 20 s (estimate; L2 measures the slowest file of a fault-free run first) is cancelled and counted as
failed, so it frees its download slot. The line counts them; after the last try the [Try again] press. This changes
the page for every pilot: the measured fault hits everyone (a few stalled files stop the whole scan).

G4: an untouched pilot keeps the class preset and the governor as today; only the network line, the retry rule and
the stall timeout are new for him.

G6 is built (bar passed, numbers above): still = speed under 0.3 m/s and turn rate under 15 deg/s on every axis for
1 s (estimate), or the page paused; the budget rises x1.5 a second while the last second's median frame stays under
66 ms (the lead's estimate) and under a cap by device memory (navigator.deviceMemory 4 or less: 4 M, 8: 8 M, more:
16 M; estimate); a stick move or unpause sets the base back in the same frame (the engine then sheds in about 1 s,
measured); a setting switches it off. The line shows it: "Detail: sharpening while you hover".

## For the lead (G7, not the page's to do)

- Levels four times apart: from 0.5 M the next level of the whole frame costs about 2 M; one doubling of the budget
  buys 1.3 to 1.6 dB (G5) because only part of the frame moves a level. Scans exported with levels two times apart
  would let a 0.5 to 1 M budget move the whole frame one step (estimate: about the gain of one doubling now, +1.5 dB,
  without its cost).
- The coarse level is what a weak device shows over most of a city from above: Lublin at 0.5 M is 18 dB from the
  16 M picture at 1366x768 (the same at 1920x1080). Coarse splats fitted to the picture (trained at that level)
  rather than merged from the fine ones would raise exactly this number; not measurable in the page.
- Lower resolution does not buy quality: Lublin at 1366x768 scores no better than at 1920x1080, and the governor's
  half render scale with 6 M (29.46 dB) is worse than 4 M at full scale (30.65 dB, Wroclaw street).
- Rest time is the cheapest quality: +4.9 dB after 5 s at rest on this PC (G6).
