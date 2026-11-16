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
- [x] 3. Release build of 3314a9a7 (dist sha256 a473ce6c..., U:/Temp/gsfpv-train3/loadq/build-l2c.log; the runs lq2-16,
  -drop, -slow, -strong, -strong-still, -lub-* ran on 000b96fd/592243c2, product code the same but for the network
  line), serve-csp 5820 with the Wroclaw walls stand-in in dist/walls, probe loadq-probe.mjs, one GPU lock per run
  (U:/Temp/gsfpv-train3/loadq/run2.sh, batch-l2.sh, batch-l2b.sh; samples lq2-*.json there). Wroclaw spawn 1920x1080:
  - 16 M by hand (lq2-16, G6 off): drawn 15.59 M (L1: 15.59), engine budget 16, governor step 0, settled 40.5 s after
    the reveal, the line 'Detail: 0.5 of 16 M, files to go: 141, about 31 s' at 3 s and 'Detail: full for your
    setting' from 42 s. Slowest file of fault-free runs: 3.2, 1.9, 1.3, 1.9 s (lq2-16, -slow, -strong, -strong-still)
    against STREAM_STALL_MS 20 s.
  - Every tenth file fails three times (lq2-drop, DROP=10): ends full, 15.59 M, settled 62.4 s after the reveal (L1:
    0 of 5 such loads finished in 60 s, 10.75 to 15.57 M). 564 failed requests, nothing given up.
  - Frames low (lq2-slow50, +50 ms of CPU a frame): the governor wanted 6 M (step 4); the page kept 16 M and at 10 s
    the line said 'Detail: kept at your setting. The picture is slower than your screen' + 'Let the page choose'; the
    press at 23 s: engine budget 16 -> 6 M, render scale 0.5, line 'Detail: 6.4 of 16 M, lowered to keep the flight
    smooth'. (+30 ms, lq2-slow: frames stayed at the 30 Hz period of the headless display, the governor never wanted
    less: no held state; the run proves only the full path.)
  - Untouched pilot, desktop-strong (lq2-strong, G6 off): 3.89 M drawn of 4 M (L1 3.89 M), settled 14.2 s, the line
    hidden, score 30.65 dB against lq-wro-ref16 (L1 30.65; U:/Temp/gsfpv-train3/loadq/score-l2-wro.txt). G4 holds.
  - G6 on the untouched pilot (lq2-strong-still): at rest the budget rose 4 -> 16 M (memory cap 16 at
    deviceMemory 8); a push to 2 m/s: the engine budget was back at 4 M in the next frame (framesToBase 1), drawn 15.59
    M then 4.74 M 12 frames later.
  - Stalled files: NOT fixed under the local stand-in. lq2-stall1 (each tenth file unanswered on its first request
    only) and lq2-stall (never answered): 144 and 224 requests in 120 and 200 s, every one distinct, reveal at 72 s,
    0.02 to 0.03 M drawn at the end. The keeper cut 18 and 41 stalls and unloaded them, but no stalled file was ever
    requested a second time. What the pilot sees now: 'Detail: files that did not arrive: 6. Trying again' from 1.6 s
    (it said only 'files to go' before 3314a9a7). Cause is a guess, not measured: the hung requests keep the browser's
    six connections to the HTTP/1.1 local server (the engine's XHR is not aborted by unload, playcanvas Http), so
    nothing else is sent; the CDN speaks HTTP/2, where this would not block. See left.
- [x] 4. Pictures in U:/Temp/gsfpv-train3/shots, each looked at:
  - loadq-loading.png: the street still blurry and smeared, under 'Walls 5 cm' the line 'Detail: 0.5 of 16 M, files to
    go: 141, about 31 s'.
  - loadq-full.png: the same street sharp to the cathedral towers, the line 'Detail: full for your setting'.
  - loadq-held.png: the street mostly sharp, the line 'Detail: kept at your setting. The picture is slower than your
    screen' with the button 'Let the page choose' beside it.
  - loadq-lowered.png (lq2-slow50 after the press), loadq-network.png (lq2-stall1): taken, not looked at.
  - G6, Lublin 2f1ddf5f from 140 m up, pitch -35, base 0.5 M, 1920x1080, governor off, BENCH_UNCAPPED=1:
    loadq-still-before.png (G6 off, 60 s): roofs and streets are coarse smeared blobs; loadq-still-after.png (G6 on,
    45 s after the reveal, at rest): the same view sharp, single cars, crosswalks and roof tiles readable. Scores against
    lq-g5-lub-16-1920x1080 (U:/Temp/gsfpv-train3/loadq/score-l2-lub.txt): before 17.97 dB; G6 on at 5, 10, 20, 45 s
    after the reveal (the rest began during the load): 22.14, 24.73, 51.96, 51.97 dB; 8 s after the push 17.77 dB.
    After the push the engine budget was 0.5 M in the next frame; drawn 15.78 M, then 14.46 M (12 frames), 9.87 M (30),
    5.58 M (60): the engine sheds the extra splats over about 60 uncapped frames, as L1 measured.
  - Typecheck render-pc, apps/fly exit 0 after 3314a9a7; tools/bench/test/a6-reference.test.ts passes (1 test).
- [x] 5. Checks. gates.py --only vitest,architecture,i18n,b18,leaks on 11da9c15
  (U:/Temp/gsfpv-gates-20261115-224649): architecture, i18n, B18, leaks PASS; vitest 5002 passed, 14 skipped, 1 failed:
  packages/render-pc/test/lod.test.ts:124 (lodMetaProblem under 50 ms of a real timer; not this lane's file, from
  6d50b814) failed while the machine was loaded; the file alone passes 33 of 33. a6-reference passed after 3314a9a7
  (item 4); no flight, input or collision code changed since. The first runner (22:36 to 23:30) lost its server while
  it waited for the lock; its governor-start and accept-fly died on ERR_CONNECTION_REFUSED. Browser checks again on a
  fresh release build of e33208d2 (dist sha256 1d3d1f0c..., U:/Temp/gsfpv-train3/loadq/build-l2d.log, Wroclaw walls
  stand-in in dist/walls), 23:33 to 00:15 (U:/Temp/gsfpv-train3/loadq/run-item5.sh, run-item6.sh, gov2.sh):
  - accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 against http://localhost:5820 (its first line): all 10 PASS
    (U:/Temp/gsfpv-train3/loadq/accept-fly.log).
  - governor-start with G6 on as shipped: FAILED all=false: W1 and S1 never stepped down under the 1.4-period
    overload (stepAfterOverload 0, msToLowest null), so nothing was remembered. Cause measured by the setting: the
    probe's craft sits still (input=touch, unarmed), G6 holds the still budget and by its design the governor does not
    count frames at rest. The probe checks the governor of a flight, so it now loads with set.display.stillDetail=0
    (tools/bench/scripts/governor-start-probe.mjs). Again: PASS all=true (weakRemembered, weakStartsThere,
    strongRemembered, strongStartsAtTop; evidence/2026-11-15/lod-view/lq5-governor-start.json). Consequence for a
    pilot: the step the governor remembers per device is learned in flight only, not while the craft waits at the
    start (by design of G6).
  - lod-view on and off, 1 M, desktop-strong, G6 off (lq6-*; score-item6-lub.txt, score-item6-wro.txt; PSNR luma over
    the scan against laptop3's l3-lub-ref16 / l3-wro-ref16): Lublin 2f1ddf5f start 19.66 on / 19.43 off (laptop3 P2
    19.65 / 19.44), 40 m up 20.13 / 19.77, 140 m up 19.43 / 19.47; Wroclaw 70b50d42 start 24.98 / 24.80 (laptop3 24.98
    / 24.80), 8 m up 26.10 / 25.22. laptop3's numbers hold.
  - The same with G6 on as shipped (lq5-*, score-item5-*.txt): the probe holds the camera still, so G6 raised the
    detail: Lublin start 73.33 on / 32.27 off, 140 m up 57.56 / 33.54; Wroclaw start up0 69.55 / 41.05 dB. The on/off
    gap there is the time spent at rest, not the view rule; any lod-view comparison of the view rule needs
    set.display.stillDetail=0 in its query from now on.
  - Hand-over gates.py --only vitest,architecture,i18n,b18,leaks on eceb4f6f (U:/Temp/gsfpv-gates-20261116-001704,
    Python 3.11 on PATH): architecture, i18n, B18, leaks PASS; vitest 5001 passed, 16 skipped, 1 file failed:
    tools/bench/test/rooms-socket.test.ts "rooms.py did not start" (its start wait ran out under the full run; not this
    lane's file, unchanged against origin/main); alone it passes 2 of 2. lod.test.ts passed this time.
  - governor-start, typecheck (render-pc, apps/fly exit 0 after 3314a9a7; since then only a bench script and docs),
    a6-reference (item 4) done. Servers 5820, 5821, 5822 stopped by the runners' traps (no node process of this
    worktree left).
- [x] 6. 'What the owner does', 'Not verified', every changed file (sections at the end) (11da9c15). The Splat budget
  help said the line is "at the bottom left"; the pictures show it under the scene credit at the top left: the four
  texts now say "under the scene's credit" (11da9c15). loadq-lowered.png looked at: the sharp street, the line
  'Detail: 6.4 of 16 M, lowered to keep the flight smooth'. loadq-network.png looked at: a black, smeared street (a few
  coarse splats), the line 'Detail: files that did not arrive: 6. Trying again'.
Stage L2 is finished. Left, for the lead (not this stage's to fix):
1. Stalled files (one line, not chased): under the local HTTP/1.1 server a file that never answers blocks the load
   though the keeper cuts it (item 3, lq2-stall1, lq2-stall); suspect the hung XHR in the engine (playcanvas Http, not
   aborted by GSplatAssetLoader.unload) holding the browser's six connections. Not measured on HTTP/2; the line names it.
2. gen-catalog --check is stale for the new setting display.stillDetail: the lead runs scripts/gen-catalog.ts.
3. Any bench that holds the camera still and measures the flight's detail or the governor (lod-view-probe,
   governor-start-probe, freeze-probe) sees G6 unless its query has set.display.stillDetail=0; governor-start-probe has
   it now, the others do not (lod-view runs above passed it through --query).

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

## What the owner does

1. Open Wroclaw (70b50d42) as before. A line under the scene's credit, below "Walls 5 cm", says how far the detail
   has come: "Detail: 0.5 of 16 M, files to go: 141, about 31 s". Nothing to press; it counts down while you fly.
2. To have it all: Settings, Display, Splat budget, "16 million splats". The page keeps that number. When every file is
   in, the line says "Detail: full for your setting" for a few seconds and hides.
3. If the laptop cannot draw 16 M smoothly, the page still draws 16 M and the line says "Detail: kept at your setting.
   The picture is slower than your screen" with one button, "Let the page choose". Press it and the page lowers the
   detail until the flight is smooth; the line then says how much it draws ("6.4 of 16 M, lowered to keep the flight
   smooth"). Choosing a number in Splat budget again gives the number back.
4. If the network loses files, the page asks for them again by itself and the line says "files that did not arrive:
   6. Trying again". If they still do not come, the line says to check the connection and has a "Try again" button.
5. Hover still or press Pause to look around: the line says "Detail: sharper while you hold still" and the picture
   sharpens over a few seconds; the first stick move brings the flight's detail back. Settings, Display, "More detail
   at rest" switches this off.

## Not verified

- The owner's laptop was not used. Every number in this file is from this PC (RTX 4090, headless Chrome, display
  paced at 30 Hz, or BENCH_UNCAPPED=1 where said), with the device class forced through `set.display.deviceClass=`.
  How often the "kept" state shows on a 144 Hz RTX laptop is not measured.
- Stalled files under HTTP/2 (the CDN): not measured. Under the local HTTP/1.1 server a file that never answers still
  blocks the load (left, item 3); the line names it, the load does not finish.
- The memory cap of G6 (navigator.deviceMemory under 4 / 8 GB) was not met on a device with that memory: this PC
  reports 8.
- Phones and tablets: the line and G6 were not walked on a touch device.

## Files changed by this lane (against the merge base f286dd49)

- apps/fly/src/app/detail-rule.ts (new): drawPlan (G1), detailState and detailLine (G2), StillRise and stillCapM (G6).
- apps/fly/src/app/builtin/detail.ts (new): the detail line under the scene credit, its two buttons.
- apps/fly/src/app/builtin/still.ts (new): G6 at rest, setting display.stillDetail.
- apps/fly/src/app/quality.ts: hand-set budget kept, keeperSlow, release(), the still budget.
- apps/fly/src/app/builtin/drawing.ts: tells Quality whether the budget comes from the setting.
- apps/fly/src/app/features.ts: registers detail and still. apps/fly/src/app/test-hook.ts: window.__gsfpv.detail().
- packages/render-pc/src/stream-keeper.ts (new): retries with growing pause, stall cut, counts (G3);
  packages/render-pc/src/renderer.ts (ticks it, loader.maxRetries 0, streamStats, retryFailedFiles);
  packages/render-pc/src/index.ts (exports).
- packages/prefs/src/defs/display.ts: display.stillDetail; packages/prefs/test/defs.test.ts (count 83).
- packages/i18n/locales/fly/detail/{en,es,pl,ru}.json (new); packages/i18n/locales/fly/drawing/{en,es,pl,ru}.json
  (Splat budget help: a hand-set number is kept; where the line is).
- tests: packages/render-pc/test/stream-keeper.test.ts, tools/bench/test/loadq-detail.test.ts (new).
- probe: tools/bench/scripts/loadq-probe.mjs (new); tools/bench/scripts/governor-start-probe.mjs (loads with G6 off).
  Evidence: evidence/2026-11-15/lod-view/score-lq-*.json, lq5-*.json (G6 on), lq6-*.json (G6 off),
  score-l3-*-lq5-*.json, score-l3-*-lq6-*.json, lq5-governor-start.json.
- For the lead to run: scripts/gen-catalog.ts (the catalogue outputs are stale for display.stillDetail).

# Part loadq2 (train 3): independent review of lane loadq, the keeper's rules R1 and R2

Same worktree and branch, ports 5820-5839, runs and logs under U:/Temp/gsfpv-train3/loadq2.

## Status (loadq2)

Stage R1-keeper
- [x] 0. Merge origin/main c1893e12 (3fea63e2; one conflict, the settings count in packages/prefs/test/defs.test.ts: 84
  with course.lapSplash and display.stillDetail, prefs tests 247 pass); submodule packages/sonic-fpv moved to main's
  pin 293ebaea (without it apps/fly did not typecheck); typecheck of apps/fly and render-pc exit 0.
- [x] 1. Review findings (below, LR-1 to LR-7) and the rules today (R1, R2 below).
- [x] 2. R1, R2 and the real findings built with unit tests and negative controls (this commit).
- [ ] 3. Browser, Wroclaw 70b50d42, before and after: spawn 120 s and street flight, uncapped and +30 ms; retry counts;
  hand-set 16 M proof; the line at 1366x768 and 844x390.
- [ ] 4. governor-start-probe, gates.py --only vitest,architecture,i18n,b18,leaks, a6-reference.

## The rules the code had (state before loadq2)

- R1: packages/render-pc/src/governor.ts onFrame (line 204 at ef46486f): `missed = held || dt > 1.25 * period`, the
  period the 5th percentile of the last 30 s of intervals. No floor: with the frame rate free the learned period was
  2.5 ms and every tenth frame of 17.8 ms stepped a hand-set 16 M to 6 M at scale 0.5 within 4 s (L1, lq-wro-16unc).
  A held frame (the GPU queue) counted as missed whatever the interval.
- R2: governor.ts onFrame (line 225 at ef46486f): a step up after every 5 s with at most 1 % missed frames, a step down
  after 1 s with more than 10 %; nothing remembers an alternation. L1 lq-wro-16live: 16 -> 12 M at 49 s, up 54, down
  57, up 62, down 67, up 72 s; 2816 requests for 2000 files.

## Findings (loadq2 review of f286dd49...ef46486f and governor.ts)

- LR-1 (real, fixed) apps/fly/src/app/detail-rule.ts detailState: 'still' ranked above 'coming'. The craft is still at
  the start while the scan loads, so a pilot who set 16 M by hand read 'Detail: sharper while you hold still' while
  141 files were still to come: a wrong cause. Test tools/bench/test/loadq-detail.test.ts 'LR-1' (old code: "expected
  'still' to be 'coming'"). Now a hand-set budget with files to come says 'coming' at rest too.
- LR-2 (real, fixed) R1 above. MIN_JUDGED_PERIOD_MS = 1000/60 (the lead's estimate); a held frame is missed only when
  it and the interval before it together pass 1.25 judged periods (a 144 Hz screen showing 72 pictures a second is
  smooth). Tests packages/render-pc/test/governor-loadq2.test.ts 'R1' (old code: steps down, 4 changes).
- LR-3 (real, fixed) governor.ts onFrame: after a gap over 1 s (a tab switch, and with G6 every rest: Quality did not
  feed the governor at rest) the next judged frames formed the whole down window, so one late frame (ratio 1 of 1)
  stepped the detail down. With G6 every move after rest begins with the extra splats being shed (about 60 frames, L2
  measured): the keeper stepped down after each rest. Test 'LR-3 ... one late frame right after a gap' (old code:
  "expected [ { t: 8066.7, step: 1 } ] to deeply equal []"). Now FrameGovernor.rest(t) (Quality calls it each frame
  at rest) and a gap restart the down window: a step down needs a whole second of judged frames after it.
- LR-4 (real, fixed) apps/fly/src/app/builtin/still.ts with detail-rule.ts StillRise: the rise began 1 s after the craft
  was still, whatever the keeper had judged; at rest the keeper counts nothing. A weak device waiting at the start
  never had its frames judged: governor-start-probe failed with G6 on (L2 item 5: stepAfterOverload 0), so its flight
  began at the top step and spent its first seconds stepping down. Now the rise waits for FrameGovernor.calm (the
  keeper judges, a whole down window since its last change and no step down due; off or at the lowest step: calm).
  Test 'LR-4' (old code: "expected 5.0625 to be +0"). The step remembered for the next load is still learned in
  flight only (needs 10 s of judged frames with no streaming): a doubt, not changed.
- LR-5 (real, fixed) R2 above. FrameGovernor.upWaitMs: a step down within FLAP_MS 10 s of a step up doubles it (5 s at
  the start) up to MAX_UP_WAIT_MS 120 s; a step up that held UP_HELD_MS 60 s puts it back (estimates of the lead).
  Tests 'R2' (old code: waits [5,5,5,5,5,5,5] against [5,10,20,40,80,120,120]).
- LR-6 (doubt, not changed) the 'still' state shows for an untouched pilot (G4 said such a pilot sees only the network
  line): the line appears after each hover of more than 1 s and hides at the move (ticked every 0.5 s). Not measured
  as a flicker in a browser.
- LR-7 (doubt, not changed) drawPlan pinned draws settingBudgetM = top x (0.25 + 0.75 x display.quality): with the
  Quality slider under 1 a hand-set 16 M draws less (10 M at 0.5) while the 'coming' line says 'of 16 M'. It is the
  pilot's own slider, not a silent rule.
- Retries (stream-keeper.ts): 1 request and at most 5 retries (0.5, 1, 2, 4, 8 s) a file, then given up until the
  press: at most 6 requests a failing file from the code; the browser count is item 3.
- Where an untouched pilot's flight differs from main f286dd49 (G6 on by default): at rest the budget rises x1.5 a
  second to the memory cap (16 M at deviceMemory 8) at the top render scale; the keeper does not judge at rest; the
  'still' line shows at rest; after the move the engine sheds the extra splats over about 60 frames (stage R2-rest
  measures what that costs); failed files are retried with pauses and stalls cut after 20 s (G3, loader.maxRetries 0).
