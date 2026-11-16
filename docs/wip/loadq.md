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
- [x] 2b. Typecheck apps/fly and render-pc on 05b0c7ad exit 0 (U:/Temp/gsfpv-train3/loadq2/tc3.log); tests
  packages/render-pc/test (all), loadq-detail, app-lod, drawing-ask, fly-parity: 422 pass. Probe switch FLY / FLYV /
  FLYSECS and OUT in tools/bench/scripts/loadq-probe.mjs (the held camera moves along its start heading, the craft's sim
  speed is kept at 2 m/s so the still rule sees a flight; a hook flight, not the keyboard) (this commit).
- [~] 3. Browser runs. Done: the release build of 05b0c7ad (the AFTER code; sha256 in
  U:/Temp/gsfpv-train3/loadq2/build-before.log, a copy with the Wroclaw walls stand-in in
  U:/Temp/gsfpv-train3/loadq2/dist-after-05b0c7ad). Left, in this order:
  a. [x] BEFORE build: the four files of 3fea63e2 (governor.ts, quality.ts, detail-rule.ts, builtin/still.ts) in place,
     release build (sha256 531a4818..., U:/Temp/gsfpv-train3/loadq2/build-before-3fea.log; the bundle has no
     'upWaitMs', the after bundle has it), copied to U:/Temp/gsfpv-train3/loadq2/dist-before-3fea63e2 with the Wroclaw
     walls stand-in, the four files restored. Runs b to d: U:/Temp/gsfpv-train3/loadq2/batch.sh (before on 5820, after
     on 5821, run.sh takes one GPU lock per run), results in U:/Temp/gsfpv-train3/loadq2/runs.
  Measured in run 2 of this stage (01:20 to 02:10, samples U:/Temp/gsfpv-train3/loadq2/runs/<label>.json, summary
  script U:/Temp/gsfpv-train3/loadq2/sum.mjs; Wroclaw spawn, 1920x1080, untouched desktop-strong, BENCH_UNCAPPED=1, the
  hook flight from 120 s for 60 s; frame medians are per second, from the probe's own rAF):
  - k-before (3fea63e2): no step in 120 s at the spawn (the craft is still: G6 holds the rise, the keeper does not judge
    at rest); in flight 0->1->2->3->4 at 121, 122, 123, 124 s while the medians were 3.0 to 7.0 ms; end: step 4, 1.5 M at
    render scale 0.5, 1.40 M drawn; 3296 requests for 2128 distinct files.
  - k-after (05b0c7ad): in flight down 0->1 at 123 s, 1->2 at 124 s, 2->3 at 130 s (medians 4.2 to 6.3 ms, the loader
    queue 25 to 30 files), up at 147, 152, 157 s, down at 158 s, up at 169 s (the wait after that alternation was 11 s:
    R2's doubled 10 s); end: step 0, 4 M, 3.88 M drawn; 3936 requests for 2240 distinct files. R1 does NOT hold in the
    browser: 4 steps down while the frames came at 150 to 300 a second.
  - k-after-govlog (STILLOFF=1, flight from 5 s): again a step down 0->1 at 6 s with medians 2.6 / 4.8 ms, up at 33 s.
    Its keeper log is empty: hook.governor did not exist yet at the reveal (the probe now wraps it when it appears).
  - Every run, before and after: the per-second 90th percentile frame is 17.2 to 18.2 ms while the median is about
    3 ms (about one frame in ten takes about 17.8 ms). Guess, not measured: the steps down come from those frames plus
    the loader's upload hitches while files stream (the held rule adds the interval before), more than 10 % of a
    second's frames over 1.25 x 16.7 ms. The keeper log (GOVLOG) decides it.
  - k-before-d30 (+30 ms CPU a frame): 3 steps down at 125 to 128 s with medians 37 to 41 ms (as it should), no
    alternation, end step 4. k-after-d30: the probe's setFrameDelay came before the hook existed, so the delay was not
    applied (medians 2.9 ms; kept as runs/k-after-d30-nodelay.json, 0 steps); the probe now retries it each second.
  - k-after-drop10 (every tenth file always fails, 120 s): 858 requests for 571 distinct files, 344 failed answers
    (about 57 failing files, about 6 requests each: the bound of the code, 1 + 5 retries); the reveal took 40.3 s; the
    end picture timed out, so the end state is missing from the json.
  - loadq2-line-1366 and loadq2-line-844 (16 M by hand, picture at 6 s, U:/Temp/gsfpv-train3/shots/<label>-ui.png,
    looked at): 1366x768: credit, 'Walls 5 cm', 'Detail: 4.4 of 16 M, files to go: 121, about 21 s' under each other at
    the top left, nothing overlaps; the text inherits .attribution font-size 12px (apps/fly/src/fly.css:129). 844x390:
    the Detail line lies on the telemetry line 'THR 0% 0.0 m/s ALT 0.0 m' (finding LR-8 below). The scene had the
    School block, no course: the course clock block was not on screen, not checked.
  - governor-start-probe on the after code (scene 39e63ce9): PASS all=true
    (evidence/2026-11-16/lod-view/loadq2-governor-start.json).
  - Not run (the GPU lock was held by other lanes for their whole wait): k-after-drop1, k-after-16slow50.
  b. One GPU lock per run, OUT=U:/Temp/gsfpv-train3/loadq2, BENCH_UNCAPPED=1, untouched desktop-strong, SECS=180 FLY=120
     FLYSECS=60 (120 s at the spawn, then 60 s along the street): before and after, as is and with DELAY=30. Table: the
     governor step per second (govStep), asked against distinct files, drawn at the end; after: no step down while the
     frame median is under 16.7 ms; with DELAY=30 one step down, no alternation.
  c. After only: DROP=10 DROPTRIES=999 SECS=120 and DROP=1 DROPTRIES=999 SECS=120: requests against files (the bound
     from the code is 6 a failing file).
  d. After only: PILOT=16 DELAY=50 PRESSAT=25 UISTATES=kept:loadq2-kept,lowered:loadq2-lowered SECS=60 (the L2 lq2-slow50
     proof again); VW=1366 VH=768 and VW=844 VH=390 with PILOT=16 UIAT=6 SECS=15 for the line's size and overlap (look at
     each picture; course clock block not on this scene: say so).
- [ ] 3e. LEFT for the next run, in this order (dists and scripts in U:/Temp/gsfpv-train3/loadq2: serve
  dist-after-05b0c7ad on a port of 5820-5839, run.sh <label> <port> takes one GPU lock per run; delete a run's json
  before running it again):
  1. [x] Done in run 3. k-after-govlog2 (STILLOFF, flight from 5 s): no step change; 195 of 6765 judged frames
     missed, all held. k-after-govlog3 (SECS=180 FLY=120 FLYSECS=60 GOVLOG=1, the AFTER build 05b0c7ad): down 0->1 at
     126.5 s, 1->2 127.5, 2->3 128.5, 3->4 129.7, up again 147 to 163 s; 204 of 9155 judged frames missed, every one a
     held frame of 16.8 to 18.3 ms after a short one (the two 21 to 26 ms, over 1.25 x 16.7), while the down window held
     130 to 140 frames (about 95 pictures a second). The period floor alone is not R1. Fix: governor.ts MIN_SMOOTH_FPS 60,
     tooSlow(): no step down while the down window drew 60 or more pictures a second (judged frames not held); calm()
     uses the same rule. Test 'the measured Wroclaw flight' in governor-loadq2.test.ts (the measured sequence; the code of
     05b0c7ad: "expected [ ...(4) ] to deeply equal []"); render-pc tests 373 pass. Was: res.govlog says which judged frames the keeper
     counted as missed at each step down (held or not, their intervals). Fix R1 in packages/render-pc/src/governor.ts
     by what it shows, a unit test built from the measured frame sequence in
     packages/render-pc/test/governor-loadq2.test.ts with a negative control, typecheck, release build.
  2. [x] Release build of 930a93d7 (sha256 6d727bc6..., U:/Temp/gsfpv-train3/loadq2/build-930a.log; copy with the
     Wroclaw walls stand-in in U:/Temp/gsfpv-train3/loadq2/dist-after-930a93d7, served on 5828). Runs (runs/k2-*.json,
     same probe and settings as item 3):
     - k2-after (120 s at the spawn, then the 60 s hook flight, GOVLOG=1): ONE step down, 0->1 at 125.8 s, at the first
       move after the 120 s rest; its down window had 61 judged frames, 8 missed, fewer than 60 drawn (frames over a
       second after the rest: the extra splats of 'More detail at rest' being shed, stage R2-rest's R4 measures it); up
       again at 148.8 s; no alternation. Was (05b0c7ad): 4 steps down and 4 up with an alternation; (3fea63e2): 4 down.
       End: step 0, 4 M at scale 1, 3.89 M drawn. Requests 3496 for 2272 distinct files, 0 failed.
     - k2-after-d30 (+30 ms CPU a frame, applied from the start): 0->1->2->3->4 at 5.3, 6.3, 7.3, 8.3 s (1533 of 1680
       judged frames missed, 19 to 23 frames a window), never up again: one series down, no alternation. End 1.5 M at
       scale 0.5, 1.41 M drawn.
  3. [x] k2-after-drop1 (every file always fails, 120 s): 558 requests for 84 distinct files (6.6 a file, 4.65 a second);
     the line said 'Detail: files that did not arrive: 78. Trying again'. Bound: about 6 to 7 requests a failing file
     (1 + 5 retries of stream-keeper.ts, the rest the engine asking a node again), no flood. k-after-drop10 (item 3):
     858 for 571. k2-after-16slow50 (16 M by hand, +50 ms): kept at 16 M, the line 'Detail: kept at your setting. The
     picture is slower than your screen' with 'Let the page choose' at 7.4 s; the press at 28 s gave the keeper's 6 M
     (the line then 'Detail: sharper while you hold still (7.4 M)': the craft stood still). Pictures
     U:/Temp/gsfpv-train3/shots/loadq2-kept2.png, loadq2-lowered2.png.
  4. [x] LR-8 fixed in apps/fly/src/fly.css (a short window, max-height 500 px: the walls line and the Detail line on one
     row). loadq2-line-844b (844x390, 16 M by hand, picture at 6 s, rects from the probe's UIRECTS): credit 44..101,
     walls 61..101, Detail line x 98..340 y 61..79, telemetry y 111..130: nothing overlaps (detailOver []). Looked at
     (U:/Temp/gsfpv-train3/shots/loadq2-line-844b-ui.png): 'Detail: 4.6 of 16 M, files to go: 122, about 20 s' right of
     'Walls 5 cm', above 'THR 0% 0.0 m/s ALT 0'; the Detail text sits about 10 px higher than 'Walls 5 cm'.
     loadq2-line-1366b (1366x768): credit 138..215, walls 155..195, Detail 197..215, telemetry 489..508: no overlap.
     Font 12 px (inherited from .attribution). The course clock block of a course scene was not on screen: not checked.
  5. Left, a new fault, not built (one line): requests repeat files with no failure and no keeper step: 256 re-asks in
     the 40 s flight of k-after-govlog2 (no step change), 1224 in k2-after. Guess, not measured: the engine drops files
     of nodes that leave the view or the budget and asks them again on return (packages/render-pc streaming, engine
     octree cache); the next stage or the lead decides.
- [x] 3e. Done in run 3 (items 1 to 4 above; 5 is a new fault left for the lead).
- [x] 4. On 930a93d7: governor-start-probe PASS all=true (weakRemembered, weakStartsThere, strongRemembered,
  strongStartsAtTop; evidence/2026-11-16/lod-view/loadq2-governor-start.json); typecheck render-pc and apps/fly exit 0;
  tools/bench/test/a6-reference.test.ts pass (hash unchanged); gates.py --only vitest,architecture,i18n,b18,leaks:
  architecture, i18n, b18, leaks PASS; vitest 384 files pass, 5 failed only because of this run's Python (no python
  on PATH; C:/Python312 prints 'Could not find platform independent libraries' on stderr, which
  superspl.test.ts and the rooms tests reject); the 5 (rooms-open-vote, rooms-race, rooms-socket, scene-default,
  superspl) pass with Python 3.11 on PATH: 57 tests (U:/Temp/gsfpv-train3/loadq2/py5.log). Stage R1-keeper finished.
- Files changed by loadq2 (R1-keeper): packages/render-pc/src/governor.ts, packages/render-pc/test/governor-loadq2.test.ts,
  apps/fly/src/app/detail-rule.ts, apps/fly/src/app/builtin/still.ts, apps/fly/src/app/quality.ts, apps/fly/src/fly.css,
  tools/bench/test/loadq-detail.test.ts, tools/bench/scripts/loadq-probe.mjs, packages/prefs/test/defs.test.ts (merge),
  docs/wip/loadq.md, evidence/2026-11-16/lod-view/loadq2-governor-start.json.
- Not verified in R1-keeper: the owner's laptop (144 Hz screen, RTX on a laptop) was not used; the flight was the probe's
  hook flight, not the keyboard; Tunis 887f27aa was not flown; the course clock block next to the Detail line was not on
  screen; the 10 px vertical offset of the Detail line beside 'Walls 5 cm' in a short window is left as is.

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
- LR-8 (real, left) apps/fly/src/app/builtin/detail.ts puts the Detail line under 'Walls 5 cm' on the credit; in a
  short window with touch sticks (844x390) the credit sits under the OSD's top line (apps/fly/src/fly.css:228) and its
  third line falls on the telemetry 'THR 0% 0.0 m/s ALT 0.0 m' (.osd.bl, fly.css:215): a pilot on a phone on its side
  reads two texts printed over each other (picture U:/Temp/gsfpv-train3/shots/loadq2-line-844-ui.png).
- LR-2 (R1) measured in the browser after the fix: it does NOT hold yet (item 3, k-after, k-after-govlog); left 3e.1.
- Retries (stream-keeper.ts): 1 request and at most 5 retries (0.5, 1, 2, 4, 8 s) a file, then given up until the
  press: at most 6 requests a failing file from the code; the browser count is item 3.
- Where an untouched pilot's flight differs from main f286dd49 (G6 on by default): at rest the budget rises x1.5 a
  second to the memory cap (16 M at deviceMemory 8) at the top render scale; the keeper does not judge at rest; the
  'still' line shows at rest; after the move the engine sheds the extra splats over about 60 frames (stage R2-rest
  measures what that costs); failed files are retried with pauses and stalls cut after 20 s (G3, loader.maxRetries 0).

## Status (loadq2, stage R2-rest)

- [x] 0. Release build: the code of HEAD f14eeedf equals 930a93d7 (git diff --stat 930a93d7 f14eeedf -- apps packages is
  empty), so its release U:/Temp/gsfpv-train3/loadq2/dist-after-930a93d7 (with the Wroclaw walls stand-in) is the BEFORE
  build of this stage, served on 5830. origin/main moved to b2e7a73b (course keys); not merged in this stage.
- [x] 1. Probe switches (tools/bench/scripts/loadq-probe.mjs): CPU (CDP Emulation.setCPUThrottlingRate from the page's
  start), MOVELOGMS (3500: the move log runs 3 s after the push), res.move.first1s (median, 90th percentile, worst frame
  of the first second after the push), within10pctMs (time until the splats drawn are within 10 % of the flight's
  budget), peakBudgetM, heapMB, vramMB, perFrame. Batch U:/Temp/gsfpv-train3/loadq2/rest.sh (Lublin 2f1ddf5f 140 m up
  pitch -35 and Wroclaw street, desktop-weak 2.5 M scale 0.85 and phone 2 M scale 0.7 (the lowest class, presets.ts),
  CPU 1 and 4, the rise on and off, push at 45 s after the reveal), runs in U:/Temp/gsfpv-train3/loadq2/rest.
- [x] 2. R3 and R5 built (this commit): detail-rule.ts stillTopM (at most 4 times the flight's budget, 2 on a phone or
  tablet class, never above the memory cap), StillRise.frame(touch) and the view's own turn and move (viewTurnDegS,
  viewSpeed: a move also in a pause); still.ts reads the camera each frame and listens to renderer.onGpuTrouble (new in
  packages/render-pc/src/renderer.ts: the engine's devicelost, WebGPU device.lost, an uncapturederror with
  GPUOutOfMemoryError): with the still budget standing it puts the flight's budget back, stores display.stillDetail off
  and the line says detail.stilloff for 10 s (en, es, pl, ru). Tests tools/bench/test/loadq-detail.test.ts 'loadq2
  R2-rest' (19 pass); negative control with the detail-rule.ts of f14eeedf: 4 fail by assertion ("expected 16 to be
  10", "expected 'hidden' to be 'stilloff'", ...). Typecheck apps/fly and render-pc exit 0.
- [x] 2b. Probe switch FAULTAT (s after the reveal: a synthetic GPUUncapturedErrorEvent with a GPUOutOfMemoryError on the
  engine's WebGPU device, then the still state, budget, setting, stored keys and the detail line 1.5 s later, picture
  <label>-fault.png in the shots dir). Release build of 17e5304a (sha256 3a8c22d1..., U:/Temp/gsfpv-train3/loadq2/build-r2.log),
  copy with the Wroclaw walls stand-in in U:/Temp/gsfpv-train3/loadq2/dist-after-17e5304a.
- [x] 3. Measurement BEFORE (dist-after-930a93d7). Done 2 of 16 runs in run 1 (the GPU lock was shared with other lanes: about 12
  minutes a run). Lublin 2f1ddf5f 140 m up, desktop-weak (2.5 M, scale 0.85), CPU 1, push at 45 s:
  - rise ON: the rise reached 16 M (the memory cap; 6.4 times the flight's 2.5 M); 15.78 M drawn before the push; JS heap
    325 MB; vramMB null (the engine's count is not readable). First second after the push: 127 frames, median 2.5 ms,
    90th percentile 19.8 ms, worst 31.9 ms; drawn 15.8 M at the push, 12.5 M after 10 frames, 9.1 M after 80 frames
    (0.63 s), 3.6 M after 2.35 s; within 10 % of 2.5 M after 3088 ms.
  - rise OFF: first second after the push 144 frames, median 1.7 ms, 90th percentile 19.3 ms, worst 21.0 ms; 2.45 M
    drawn; JS heap 96 MB. On against off: median 2.5 / 1.7 = 1.47 (R4 allows 1.25: FAILS for this case, before R3);
    worst 31.9 against 21.0 + 50 (holds). The after runs show whether the R3 cap (10 M here) is enough.
  - Cause of the slow shedding, from the engine source (playcanvas 2.23.2 build/playcanvas.mjs applyLodChanges, read,
    not measured): a node keeps its fine file until its coarser file is resident; files unused for cooldownTicks (100)
    update ticks are unloaded, so at rest the flight's coarse files are dropped and after the move are loaded again, 2
    at a time (maxConcurrentLoads 2). The engine's cooldown entries cannot be shortened once set
    (updateCooldownTick counts down what was set), so raising app.scene.gsplat.cooldownTicks during rest would keep the
    files for good: not built. Whether R4 holds is decided by the table (worst frame 31.9 ms on is within off + 50 ms
    if off's worst is above -18 ms, i.e. always; the median rule needs the off run).
- [x] 3a. Measured in run 2 of this stage (03:00 to 04:30; batch U:/Temp/gsfpv-train3/loadq2/rest-all.sh, table script
  U:/Temp/gsfpv-train3/loadq2/rest-table.mjs, table U:/Temp/gsfpv-train3/loadq2/rest-table.txt; first second after the
  push; BEFORE = 930a93d7 (no R3), AFTER = 17e5304a (R3 cap 4x); Lublin 2f1ddf5f 140 m up, pitch -35, desktop-weak):
  | run | frames | median | p90 | worst | within 10 % | peak | flight | heap |
  | lub c1 off, before | 144 | 1.7 | 19.3 | 21.0 | 0 | 2.5 M | 2.5 M | 96 MB |
  | lub c1 off, after | 137 | 2.3 | 19.6 | 22.4 | 0 | 2.5 M | 2.5 M | 124 MB |
  | lub c1 on, before | 127 | 2.5 | 19.8 | 31.9 | 3088 ms | 16 M | 2.5 M | 325 MB |
  | lub c1 on, after | 124 | 2.6 | 19.5 | 48.5 | 2551 ms | 10 M | 2.5 M | 255 MB |
  | lub c4 off, before | 99 | 8.3 | 23.1 | 27.9 | 0 | 0.94 M | 0.94 M | 76 MB |
  | lub c4 on, before | 9 | 118.4 | 211.1 | 211.1 | not reached in 3 s | 16 M | 0.94 M | 417 MB |
  | lub c4 on, after | 21 | 36.6 | 74.4 | 157.9 | not reached in 3 s | 3.75 M | 0.94 M | 182 MB |
  | lub phone c1 off, before | 153 | 1.9 | 19.5 | 22.3 | 0 | 2 M | 2 M | 93 MB |
  | lub phone c1 on, before | 120 | 2.6 | 20.7 | 34.4 | 2061 ms | 16 M | 2 M | 354 MB |
  | wro c1 off, before | 142 | 2.0 | 19.5 | 21.1 | 0 | 2.5 M | 2.5 M | 251 MB |
  | wro c1 on, before | 131 | 2.4 | 19.5 | 26.2 | 991 ms | 16 M | 2.5 M | 591 MB |
  | wro c1 on, after | 146 | 2.5 | 19.9 | 28.4 | 38 ms | 10 M | 2.5 M | 454 MB |
  (frame times in ms; c4 = CDP Emulation.setCPUThrottlingRate 4; the graphics card cannot be slowed here; vramMB is null:
  the engine's own count is not readable through the hook; with CPU x4 the keeper had lowered the flight to 0.94 M.)
  - R4 at CPU 1 holds after R3: Lublin 2.6 / 2.3 = 1.13 x, worst +26.1 ms (same build); Wroclaw 2.5 / 2.0 = 1.25 x,
    worst +7.3 ms. The two 'off' runs of one setup differ by 35 % (median 1.7 and 2.3 ms): at CPU 1 on this RTX 4090 the
    median rule is within the noise between runs.
  - R4 at CPU x4 FAILS before and after R3: Lublin 36.6 against 8.3 ms (4.41 x; before R3 14.3 x), worst +130 ms (before
    +183 ms). R3's cap (3.75 M here) cuts the cost to a third but does not meet the rule.
  - Device fault in the browser (r-after-fault.json, FAULTAT=40, a synthetic GPUUncapturedErrorEvent with a
    GPUOutOfMemoryError on the engine's WebGPU device, Lublin desktop-weak): before still 10 M, engine 10 M; 1.5 s after:
    engine 2.5 M (the flight's budget), display.stillDetail false and stored in gsfpv.prefs.v1, the line 'Detail: back to
    the flight's detail. The graphics card ran short of memory, so "More detail at rest" is now off on this device'
    (picture U:/Temp/gsfpv-train3/shots/loadq2-stilloff.png). A real device loss was not caused.
  - Pictures, looked at: loadq2-rest-weak.png (Lublin from above, desktop-weak at rest after the rise, 10 M): roofs,
    the market square and the road markings are sharp. loadq2-flight-weak.png (the same eye, rise off, 2.5 M): the same
    city, softer; the square's cobbles and the far right buildings smear. loadq2-line.png (Wroclaw, 1366x768, touch
    sticks): the credit, 'Walls 5 cm' and 'Detail: 4.8 of 16 M, files to go: 118, about 22 s' stacked under the course
    clock 'School 1/4', nothing overlaps.
- [x] 3b. R4 by its order (run 3 of this stage). (1) Shedding in the move frame: not possible from the page (item 3).
  (2) A frame bound of 33 ms at rest would not act: the measured medians at rest at 3.75 M with the CPU x4 were 8.6 to
  13.7 ms (r-after-lub-desktop-weak-c4-on.json, 23 to 49 s after the reveal). A smaller cap: a release with
  STILL_TIMES_BASE 2 (U:/Temp/gsfpv-train3/loadq2/dist-cap2, build-cap2.log), Lublin desktop-weak CPU x4: on (rose to
  1.875 M, 2 times 0.94 M) median 53.0, p90 111.3, worst 137.2 ms against off median 12.0, p90 19.8, worst 27.7 ms (4.42
  times, worst +109.5 ms): FAILS (rest/r-cap2-*.json). (3) So the rise happens only while the flight is paused:
  apps/fly/src/app/detail-rule.ts StillRise.hover (false on the page; true keeps the hover rule for a later engine fix),
  cap back to 4 times; the line 'Detail: sharper while paused' and the setting's help in en, es, pl, ru say so. Test
  'loadq2 R4' in tools/bench/test/loadq-detail.test.ts (20 pass); negative control with the detail-rule.ts of 115feaa6:
  "expected 4 to be +0". Typecheck apps/fly exit 0. Probe switch PAUSEAT (P pauses; at MOVEAT P goes on, the first
  second measured from that press). Side effect, wanted: with no hover rise the keeper judges a hover again (LR-4).
- [ ] LEFT for the next run, in this order:
  1. (done in 3b) R4 by its order for the CPU x4 case. Shedding in the move frame: not possible from the page (engine source: a node
     keeps its fine file until the coarse one is resident again; see item 3 above). Next: STILL_FRAME_MS 66 -> 33 in
     apps/fly/src/app/detail-rule.ts (the rise stops while the median frame at rest is 33 ms or more) and the c4 pair
     again (r-after2-lub-desktop-weak-c4-on/off, a new release); if it still fails: the rise only while the flight is
     paused (StillRise: not paused -> no rise) and set.display.stillDetail.help in en, es, pl, ru says so; unit test and
     negative control for whichever is built; then the table again.
  2. The runs not done (run.sh skips done labels; serve dist-after-930a93d7 on 5830 and dist-after-17e5304a on 5831):
     before: wro desktop-weak c4 on/off, wro phone c1/c4 on/off, lub phone c4 on/off; after: lub phone c1/c4, wro
     desktop-weak c4, wro phone c1/c4 (the tail of U:/Temp/gsfpv-train3/loadq2/rest-after.sh after PRIODONE). If item 1
     changes the code, run the after runs on the new release instead.
  3. R5 in the browser: check boostM > base in the r-after-*-on.json (the held camera is a still view and rose: yes,
     10 M in lub c1 and wro c1); the app has no mouse look in a pause outside the course editor (not this lane's folder).
  4. accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (SITE=http://localhost:5831/en), governor-start-probe, lod-view on
     and off with set.display.stillDetail=0, freeze-probe if present, pause-over-course-probe, typecheck, gates.py
     --only vitest,architecture,i18n,b18,leaks, a6-reference, a1-api-check for renderer.ts onGpuTrouble.
  5. In this part: the findings with what was done, 'What the owner does' (item 5: the rise stops at 4 times the flight's
     detail, 2 on a phone; a graphics card that runs short of memory switches it off and the line says so), not
     verified, changed files, 'For the lead': which benches load with set.display.stillDetail=0.
- Files changed in R2-rest so far: apps/fly/src/app/detail-rule.ts, apps/fly/src/app/builtin/still.ts,
  apps/fly/src/app/builtin/detail.ts, apps/fly/src/app/builtin/drawing.ts, apps/fly/src/app/quality.ts,
  packages/render-pc/src/renderer.ts (onGpuTrouble), packages/i18n/locales/fly/detail/{en,es,pl,ru}.json,
  tools/bench/test/loadq-detail.test.ts, tools/bench/scripts/loadq-probe.mjs, docs/wip/loadq.md.
- Not checked yet: a1-api-check for renderer.ts onGpuTrouble (it reads device.wgpu, an engine field, through a cast).
