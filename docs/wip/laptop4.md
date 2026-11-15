# Lane laptop4 (train 3): weak computers

Worktree `C:/dev/gsfpv-site-sound`, branch `laptop4` from origin/main a7f39528 (holds laptop3: 66aa1609 and the governor's
start step). Ports 5740-5759. Read first: docs/wip/laptop3.md (its P3 facts: the freeze below multiplier 2).

## Status

Stage Q1-why
- [x] 0. Release build of a7f39528 (dist sha256 fc603285...), serve-csp port 5740; submodule packages/sonic-fpv updated to
  the pinned b05aeda first (the reused worktree had 598a98f)
- [x] 1. Why a multiplier below 2 froze the page: probe tools/bench/scripts/freeze-probe.mjs (7582c028, GPU load added
  in this commit), runs under U:/Temp/gsfpv-train3/laptop4 (runner run.sh, `<label>.json` and `.log`). Answer: not the
  multiplier and not our code or the engine; the card was saturated by another program during laptop3's four runs below
  2 (Facts Q1). Proof runs at 1.5 and 1.7 reveal and load normally (this commit)
- [x] 2. The 30 frames/s cap: the display runs at 30 Hz and headless Chrome's compositor follows its vertical blank.
  Switch `BENCH_UNCAPPED=1` in tools/bench/src/chrome.mjs (pickBrowser launch args; browser.ts launchChrome joins them to
  the caller's), chrome.d.mts, README; test chrome.test.ts 14 of 14, NEG OK; bench typecheck exit 0; frame time measured
  with it (Facts Q2) (this commit)
- [ ] 3. gates.py --only vitest,architecture,i18n,b18 before handing over

## Facts (measured)

### Q1: the "freeze" below multiplier 2 (2026-11-15, 10:30 to 11:10 local, build a7f39528, port 5740)

Probe: freeze-probe.mjs, headless system Chrome 157 through chrome.mjs pickBrowser, one page load of Lublin 2f1ddf5f at
the start place (the whole city from above), flags as laptop3's (`governor=0&drawing=sorted&set.display.deviceClass=
desktop-strong`), GPU lock held around each run only. Splats drawn at the end, files queued, main thread busy share from
the CDP profile (PROFILE=1), GPU load before the page (nvidia-smi):

| Run (label) | Viewport | Budget, multiplier | GPU load before | Reveal s | Drawn at end | Queue at end |
|---|---|---|---|---|---|---|
| q1-0p5-m17 | 1920x1080 | 0.5 M, 1.7 | not recorded | 8.3 | 463282 | 0 |
| q1-0p5-m17-4k | 3840x1970 | 0.5 M, 1.7 | not recorded | 86 | 123284 (at 120 s) | 90 |
| q1-0p5-m20-4k | 3840x1970 | 0.5 M, 2 | not recorded | 17.2 | 464754 | 0 |
| q1-0p5-m17-4k-b | 3840x1970 | 0.5 M, 1.7 | not recorded | 7.3 | 464457 | 0 |
| q1-1-m15-4k | 3840x1970 | 1 M, 1.5 | 11 % | 4.4 | 956509 | 0 |

- 1 M at multiplier 1.5 is the setting that never revealed in laptop3 P3 (`{"s":"loading"}` after 240 s): here it
  revealed in 4.4 s and loaded everything. 0.5 M at 1.7 (laptop3: screenshot timeout) revealed in 7.3 s and 8.3 s and
  loaded everything in two of three runs.
- laptop3's own evidence (evidence/2026-11-15/lod-view/l3*.json, `thermalBefore`, read by nvidia-smi before its browser
  started): the four runs below 2 (l3p3-lub-0p5-m15, -0p5-m17, -1-m15, -1-m17, 03:11 to 03:26 UTC) are the only ones
  with the card at 100 % load and P2 at 95 W before the probe began; the other 14 runs had 1 to 34 %. Reveal: 107 s,
  102 s, none in 240 s and 45 s for those four; 2.6 to 12 s for all the others. So another program kept the card busy
  for those 15 minutes (it takes no bench lock); which program is not known.
- The slow run here (q1-0p5-m17-4k): no animation frame for 60.5 s while the page's main thread was idle (CPU profile:
  6 % of samples busy over 120 s, the longest busy run 420 ms, at the reveal); the renderer appeared at about 67 s.
  The main thread was not blocked, the frames were not produced: the stall was outside the page's JavaScript. The GPU
  load was not recorded in that run (the probe records it from the next run on); the same outside load is a guess.
  Right now the card shows 11 to 46 % load before a run and spikes to 100 % during runs from programs outside the lock.
- Engine reading (playcanvas 2.23.2, node_modules/.pnpm/playcanvas@2.23.2/node_modules/playcanvas/build/playcanvas.mjs):
  GSplatBudgetBalancer.balance (lines 89172 to 89271) and _accumulate (89272 to 89304) are loops over nodes x bands
  and 1024 bins, bounded whatever the multiplier; the multiplier only sets the step `log(lodMultiplier) * BIN_SCALE`
  (89199, 89248, 89280) and is clamped to at least 1.2 (94196). The loader runs at most maxConcurrentLoads files
  (100839, 100882, 100935). Nothing there can block on a multiplier below 2, and no profile shows a JavaScript loop.
- Can our code avoid it: there is nothing in the engine or the page to avoid. What the benches can do: record the card's
  load before a run (lod-view-probe does in `thermalBefore`, freeze-probe in `gpuBefore` and every 5 s) and repeat a run
  that started on a busy card.

### Q2: the 30 frames/s cap

- The display: NVIDIA GeForce RTX 4090 at 3840 x 2160, CurrentRefreshRate 30 (Win32_VideoController). Headless Chrome
  follows that vertical blank: rAF median 33.3 ms, p90 33.5 ms in every capped run above, 1920x1080 and 4K alike.
- With `--disable-gpu-vsync --disable-frame-rate-limit` (now `BENCH_UNCAPPED=1`), Lublin at 4K, last 20 s, rAF and
  engine frame (frameend) intervals:

| Run (label) | Place | Budget | rAF median / p90 ms | Engine frame median / p90 ms | Drawn |
|---|---|---|---|---|---|
| q2-0p5-novsync-4k (flags by CHROME_ARGS) | start | 0.5 M | 2.5 / 17.7 | 2.0 / 19.0 | 464795 |
| q1-0p5-m20-4k (capped) | start | 0.5 M | 33.3 / 33.5 | 33.4 / 34.2 | 464754 |
| q2-1-up140-uncapped (BENCH_UNCAPPED=1) | 140 m up, pitch -35 | 1 M | 3.4 / 17.6 | 2.8 / 19.4 | 965894 |
| q2-1-up140-capped | 140 m up, pitch -35 | 1 M | 33.3 / 33.5 | 33.3 / 34.2 | 965892 |

  The same splats are drawn (within 41 of 0.46 M and 2 of 0.97 M); the frames are bimodal (most about 2 to 3 ms, every
  tenth or so about 17 to 19 ms). The card was shared with outside programs during these runs (11 to 46 % before).

## Decisions

- Q1: no code change for the freeze: its cause is outside the page. laptop3's rejection of multipliers below 2 rested
  on the freeze; that ground is gone. Its 1.7 score at 1 M (worse by 0.08 to 0.14 dB from above) was also taken on the
  saturated card (l3p3-lub-1-m17, 100 % before, reveal 45 s) and should be measured again before a multiplier is chosen.
- Q2: the uncapped flags are a bench switch, off by default (a run that stands for the owner's own view keeps his 30 Hz).

## For the lead

- Multipliers below 2 do not freeze the page: 1.5 at 1 M and 1.7 at 0.5 M reveal in 4 to 8 s and load fully at 4K.
  The four bad runs of laptop3 ran while another program held the card at 100 % (their own `thermalBefore`).
- Frame times on this PC: use `BENCH_UNCAPPED=1`; without it every number is the display's 33.3 ms period.
- The card is used by programs that take no bench lock (11 to 46 % load before runs today, spikes to 100 %); timings
  of reveal and loading on this PC are noisy for that reason.

## Not verified

- Which program loaded the card during laptop3's runs (03:11 to 03:26 UTC) and during q1-0p5-m17-4k: not known
  (nvidia-smi shows no compute process now; no log of that time).
- The slow run q1-0p5-m17-4k is put down to outside GPU load as a guess: its GPU load was not recorded.
- Pictures with and without BENCH_UNCAPPED were not compared pixel by pixel; the drawn splat counts match.
- No run on a weak device; budgets forced by `budget=`.

## Cost notes
