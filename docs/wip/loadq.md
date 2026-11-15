# Lane loadq (train 3): a scan loads to the detail the pilot set, and the page says what it is doing

Worktree `C:/dev/gsfpv-loadq`, branch `loadq` from origin/main f286dd49. Ports 5820-5839. Runs and logs under
U:/Temp/gsfpv-train3/loadq, pictures under U:/Temp/gsfpv-train3/shots.

## Status

Stage L1-measure (no product change)
- [x] 0. Typecheck (pnpm -r typecheck exit 0) and release build of 0605d06f (dist sha256 b5b7abab...), serve-csp on 5820 with the Wroclaw walls stand-in in dist/walls
- [x] 1. Probe tools/bench/scripts/loadq-probe.mjs (every second: drawn, budget, who set it, levels, files, bytes)
- [~] 2. (a) Wroclaw 70b50d42 spawn, 120 s: desktop-strong, desktop-weak, 16 M by hand; scores against 16 M
- [ ] 3. (b) what lowers a hand-set 16 M; five loads as is, five with every tenth file failing
- [ ] 4. (c) what the page tells the pilot today
- [ ] 5. (d) G5 scores at 1366x768 and 1920x1080; G6 at rest, measured with a test switch
- [ ] 6. Design from the numbers

Items 3 and 4 are in work ([~]): facts below; the drop, stall, G5 and G6 runs are left.

Left (for the next run of L1, in this order):
- Batch runner U:/Temp/gsfpv-train3/loadq/batch.sh (each run through run.sh: its own GPU lock, skips a label whose
  `<label>.json` exists). Restart: release build, `cp -r U:/Temp/gsfpv-train2/walls/release/70b50d42 dist/walls/`,
  serve-csp dist 5820, `nohup bash U:/Temp/gsfpv-train3/loadq/batch.sh > batch.log &`. Done: lq-wro-ref16, -strong,
  -weak, -16, -16live, -16slow, -16unc, lq-rep1..3 (check the JSON files for more). Left: lq-rep4..5, lq-drop1..5,
  lq-drop1try, lq-stall, G5 (lq-g5-*), G6 (lq-g6-lub-0.5, -1). Runs were slow: other lanes held the GPU lock (3 runs
  in 20 minutes, 20:10 to 20:30).
- Then score: `lod-view-score.mjs --ref lq-g5-lub-16-<size> lq-g5-lub-0.5-<size> lq-g5-lub-1-<size>` (and wro), and
  `--ref lq-g5-lub-16-1920x1080 lq-g6-lub-0.5 lq-g6-lub-1` for rest5/10/20 and move0/1 (the reference writes those
  names as aliases of its end picture); the table of the drop and stall runs; item 6 the design.

Stage L2-build
- [ ] (after L1)

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
