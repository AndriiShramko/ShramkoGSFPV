# Lane n-scan: every SuperSplat scan opens, or says plainly why not

The owner's wish 5 of 2026-11-20 (C:/dev/.gsfpv-lanes/designs/t7-brief.md, Decision 5): the scan a39abad1 did not open;
every scan like it must open. Base: t7-base 03624451. Hand-over merged first: hot-sog3 d432c2d9 (engine playcanvas 2.24.2,
splat-transform 3.12.0, probe tools/bench/scripts/hot-sog3-scans.mjs, live check scans-open). The engine bump is not ours.

## Status

- [x] S1 the diagnosis (read, not repeated) and its reproduction in a unit test; the version check before loading. DONE in commit "n-scan S1" (after merge of hot-sog3 d432c2d9): render-pc lod.ts ENGINE_SOG_VERSIONS, sogVersionProblem, lodChunkVersionProblem, UnsupportedFormatError; renderer.ts loadSplat checks meta.json and the first chunk of lod-meta.json before the engine asset; scan-sog-version.test.ts 7 tests pass, render-pc 391 pass, typecheck passes, NEG OK (lod.ts at 03624451). The UnsupportedFormatError still reaches the picker as the generic engine text: its plain line is S3.
- [x] S2 the kinds: superspl-kinds.json with one real id per storage kind; resolveScene and the loader open each kind (compressed PLY opens, GSAF named as unsupported); unit tests + NEG. DONE in commit "n-scan S2":
  fixture 11 ids (a39abad1, 98f74d54 SOG v3; 143e76b0 SOG v2; 5c0f892e SOG v2 191 MB / 14.1 M; f924b0f5, 593f8c06 streamed v3
  1 and 4 levels; 70b50d42 streamed v2 10 levels; 2f1ddf5f streamed v2 13 levels 518 M; a5d25fb4, c67edb74 compressed PLY
  2.5 / 163 MB gzip; 5012e205 GSAF), CDN answers recorded read-only 2026-11-21 with curl -sI. Code: ContentKind 'ply'
  (content.ts, asked only when both JSON files are missing), resolveScene opens it and names GSAF 'unsupported'
  (index.ts UNSUPPORTED_FILES; a silent CDN about scene.gsaf is 'network'); formatVerdict 'legacy' for compressed.ply (opens when
  chosen, never picked at random or by the tour), 'unsupported' for gsaf, card badge "Does not open yet"; renderer.ts loadSplat
  reads a .ply (kind 'ply', the file's own bytes as the download count, plyBytes); bake.ts BakeKind with 'ply' (sceneSize reads
  'element vertex N' from the streamed header, readFile inputFormat 'ply'). Tests: packages/scenes/test/scan-kinds.test.ts (16),
  tools/bench/test/scan-ply-size.test.ts (5); scenes + render-pc + the ply test 616 pass; `vitest --changed HEAD` 94 files pass
  (scene-default needs python on PATH); typecheck scenes, render-pc, fly pass. NEG OK on 03624451 (10 tests fail there: both PLY
  kinds, GSAF, gsaf network, formats, the PLY size). No SOG version 1 id (means.shape) was found: the diagnosis names none.
  S3 needs: the PLY drawn (no unit test drives the engine's PLY parser; S4's acceptance opens a5d25fb4 and c67edb74).
- [x] S3 the device and the plain line (DONE, commits "n-scan S3 step 1" 224f8c20 and "n-scan S3 done"): lighter LOD level or one plain line (too-large / gone / unknown-format / network) through ux4a's lines and ux4b's Cancel; zero splats drawn is an error; n-scan-errors.mjs (stubbed 404, stubbed huge scan, render off) + unit tests + NEG.
  - [x] step 1, commit "n-scan S3 step 1": apps/fly/src/session/open-error.ts (OpenErrorKind, OpenError, openErrorOf, failureCode,
    failureText, openMessage, deviceSplatLimit, openCheck); render-pc lod.ts NoSplatsError + holdsNoSplats, renderer.ts rejects a
    single file of zero splats; session/index.ts runs openCheck before the scan loads (also ?render=off); the picker (ui/scenes.ts
    showError), the first load (flight.ts) and a switch (scene-host.ts: tell() of ux4a) use the reasons; locale scene.open.* x4.
    tools/bench/test/scan-open-error.test.ts 10 pass; NEG OK on 03624451; vitest --changed HEAD: 451 files pass after the two
    fixes (scene-load.test.ts text marker, wind-session's stub renderer has no graphicsDevice); typecheck render-pc, fly pass.
  - [x] step 2: tools/bench/scripts/n-scan-errors.mjs (a39abad1, ?render=off, the CDN answers stubbed in the page: gone = every
    file 404, huge = meta.json count 400 M, newer = SOG version 4, control = nothing stubbed). Local build of 224f8c20 on port
    6940: 4/4 PASS (evidence/2026-11-20/n-scan/n-scan-errors.json). The same probe on the live site: gone FAIL (errorCode
    not-found, the old line), huge FAIL and newer FAIL (status ready: no check), control PASS: the negative control of the probe.
  - Left for S4: the PLY drawn (a5d25fb4, c67edb74) and the zero-splat failure on a real engine are unit-tested only; a
    streamed scan whose chunks all fail to draw still says "ready" (only a single file is judged by holdsNoSplats).
- [x] S4 the acceptance: n-scan-accept.mjs by mouse at 1536x730 x1.25 on the local build (a39abad1 first) and against the live site (must FAIL a39abad1); one drawn picture; scans-open extended; gates once; "What the owner should try"; dist deleted.
  - [x] tools/bench/scripts/n-scan-accept.mjs (every id of superspl-kinds.json, a39abad1 first; Keyboard on the Controls
    screen by mouse, a click into the scene, sim.tick grows = the first flown frame; or the expected named line).
    RENDER=off on the local build 224f8c20: 11/11 PASS (evidence n-scan-accept-off-local.json). The same on the live
    site 72d4babf: 8 PASS, 3 FAIL (a5d25fb4, c67edb74 "older PLY format"; 5012e205 "does not exist"): the lane's
    negative control (n-scan-accept-off-live.json). Code differs from the prompt: the live site already holds hot-sog3
    (72d4babf contains d432c2d9), so a39abad1 opens there; the a39abad1 failures this lane repairs (gone, huge, newer
    version) FAIL on live in n-scan-errors.mjs (S3).
  - [x] deploy/live-checks.sh scans-open: hot-sog3-scans.mjs also draws a5d25fb4, c67edb74; then n-scan-accept.mjs render off.
  - [x] the drawn run on the local build 224f8c20 (GPU lock). Part 1 (stopped by the 10 min background limit while
    5c0f892e loaded; lock released by hand, it was this run's): a39abad1, 98f74d54, 143e76b0, f924b0f5, 593f8c06, 70b50d42,
    2f1ddf5f PASS flown and drawn (n-scan-accept-drawn-local-part1.json). Picture U:/Temp/gsfpv-train4/shots/n-scan-a39abad1.png:
    a bright exhibition hall with large brick-built dinosaur models, seen from the drone, HUD hidden. Part 2
    (n-scan-accept-drawn-local-part2.json): 5012e205 PASS (the GSAF line); 3 FAIL, found only when drawn:
    5c0f892e (single SOG v2, 191 MB, 14.1 M) still "loading" at 200 s; c67edb74 (compressed PLY 163 MB gzip) still
    "loading" at 200 s; a5d25fb4 (compressed PLY 2.5 MB) flown and splats drawn, but the picture 1.3 % lit (nearly empty).
  - [x] step 3, commit "n-scan S4 step 3" fa095e20 and "n-scan S4 done": the drawn rerun of the 3 ids (GPU lock, MAXS 400;
    evidence n-scan-accept-drawn-local-part3.json, build of 224f8c20 whose app code equals the final head's): no hang.
    5c0f892e (single SOG v2, 191 MB) downloads at about 0.47 MB/s, the bytes growing in every 20 s sample (186.6 of 190.9 MB
    at 400 s); c67edb74 (compressed PLY, 163 MB) downloads, prepares and is flown at 334 s (PASS); a5d25fb4 (compressed PLY,
    2.5 MB) is flown and drawn right: picture n-scan-a5d25fb4.png shows one standing person in a black motorcycle suit
    holding a helmet, upright, in the middle of the plain grey background (an object scan: 1.3 % of pixels lit is correct;
    the probe's empty-picture threshold MINLIT goes from 5 % to 0.5 %).
    The heavy single file (diagnosis Repair 5, "asks or says why"): it says why on the loading card that is on the screen
    during its download (ui/loading.ts: "Downloading the scan", "86 / 191 MB . 0.5 MB/s . about 3 min left", Cancel with
    key Esc of ux4b); a file too large for the device is refused before loading with scene.open.too-large (S3). Fa095e20
    also told a line scene.open.heavy through ux4a's tell(); a render-off probe of the rebuilt page showed that ux4a's
    lines wait under the loading card and Controls screen (messages-logic.ts setCovered), so that line would appear only
    after the download, stale: reverted in "n-scan S4 done" (open-error.ts, session/index.ts, flight.ts, scene-host.ts,
    locales and scan-open-error.test.ts back to a27cafc7). n-scan-accept.mjs keeps the judgement of a heavy file: drawn, its
    card must show "about N min left" with a visible Cancel; still downloading at MAXS with the bytes growing every 20 s is
    'slow-said' (PASS), never "endless".
  - [x] gates once (see Claims 5); dist deleted.

## Diagnosis (S1)

Read from C:/dev/.gsfpv-lanes/designs/t7-scene-open.md (confirmed by a second agent), not repeated:
- Cause: superspl.at publishes SOG version 3 since 2026-11-10 (a39abad1's meta.json: version 3, splat-transform v3.11.2).
  Engine 2.23.2 `framework/parsers/sog.js:84` treats every version other than 2 as version 1 and `upgradeMeta` reads
  `meta.means.shape[0]` (sog.js:40); v3 has no `shape`, the throw is unhandled (sog.js:183), the asset fires neither
  load nor error and packages/render-pc/src/renderer.ts loadSplat (new Asset at :531 on this head) never settles: endless
  "Downloading the scan 0.0 MB". Streamed v3 scans: the same throw per chunk, "ready" over a black scene.
- The engine bump to 2.24.2 (hot-sog3, merged here) reads versions 2 and 3 and calls back "unsupported SOG version N" for
  any other: a future version now rejects instead of hanging. Left to this lane (Repair 1-6 with the Independent check's
  corrections): a version check with a plain line before loading; zero splats drawn is an error; GSAF named as
  unsupported, not "does not exist" (packages/scenes/src/index.ts:250); compressed PLY opens (index.ts:249 refuses it
  today); a heavy single file asks or says why; fixtures and the wider id list.
- Reproduction: packages/render-pc/test/scan-sog-version.test.ts reads a39abad1's recorded meta.json
  (packages/scenes/test/fixtures/superspl-kinds.json) through the new check (render-pc lod.ts ENGINE_SOG_VERSIONS,
  sogVersionProblem) and drives the pinned engine's own SOG parser with it: on engine 2.23.2 version 3 is not read.

## What the owner does

1. Opens https://gsfpv.flyreelstudio.eu/en/fly/?scene=a39abad1 (after this train is deployed). The loading card shows
   "Downloading the scan" with MB, speed and time left; then "The scan is ready. How will you fly?". He clicks Keyboard
   (or his radio), clicks into the scene, and flies in the exhibition hall with the brick dinosaurs.
2. Opens ?scene=a5d25fb4 (an older upload stored as a compressed PLY): it opens and flies; before this lane the page said
   "older PLY format" and stopped. ?scene=c67edb74 (a compressed PLY of 163 MB) opens too, after a few minutes of
   download: the card shows "about N min left" and Cancel (key Esc) the whole time.
3. Opens ?scene=5012e205 (an animated GSAF scan): one line says the simulator cannot open this format yet and to choose
   another scan, instead of "this scan does not exist".
4. A scan that is gone, too large for the device or in a SOG version newer than the engine reads says so in one line with
   what to do next (scene.open.gone / too-large / unknown-format), at once, instead of an endless loader.

## Claims

1. Every storage kind of superspl.at opens or names its reason: 11 real ids in
   packages/scenes/test/fixtures/superspl-kinds.json. Command: `cd tools/bench && RENDER=off node
   scripts/n-scan-accept.mjs http://localhost:6940/en <out>` on the local build. Last result: 11/11 PASS
   (evidence/2026-11-20/n-scan/n-scan-accept-off-local.json).
2. Drawn, by mouse at 1536x730 x1.25 on the local build: a39abad1, 98f74d54, 143e76b0, f924b0f5, 593f8c06, 70b50d42,
   2f1ddf5f, c67edb74, a5d25fb4 flown and drawn, 5012e205 says its line; 5c0f892e (191 MB) still downloading with
   progress at 400 s. Command: the same with drawn mode under the GPU lock. Last results: part1 7/7 PASS, part2
   5012e205 PASS, part3 c67edb74 PASS at 334 s, a5d25fb4 drawn (judged by eye, the probe's old 5 % threshold said FAIL),
   5c0f892e not finished in 400 s (bytes growing every 20 s).
3. The same probe against the live site 72d4babf FAILs the kinds this lane repairs: 8 PASS, 3 FAIL (a5d25fb4,
   c67edb74 "older PLY format"; 5012e205 "does not exist") (n-scan-accept-off-live.json); n-scan-errors.mjs on live:
   gone, huge and newer FAIL, control PASS (S3). a39abad1 itself opens on live: hot-sog3 is already deployed there.
4. The repairs have unit tests that fail on the base 03624451: scan-sog-version.test.ts (S1), scan-kinds.test.ts and
   scan-ply-size.test.ts (S2), scan-open-error.test.ts (S3); each NEG OK (neg_control.py, recorded in Status).
5. Gates once on the final tree: `gates.py --only typecheck,vitest,architecture,i18n,b18,leaks`. Last result: all six PASS on 67dc9e1e (typecheck 48 s, vitest 140 s, architecture, i18n, b18, leaks).

## Not verified

No person, phone or real controller took part in this lane's checks; all runs are headless Chrome 157 on this
Windows desktop. 5c0f892e (single SOG v2, 191 MB, 14.1 M splats) was not seen flown: the CDN gave about 0.47 MB/s and
the probe's 400 s ended at 186.6 of 190.9 MB; its card text ("about N min left", Cancel) is read from ui/loading.ts and
the probe's new 'slow-said' judgement, not yet exercised in a drawn run (one drawn run a stage). The device limit
(deviceSplatLimit: texture side and navigator.deviceMemory, 3 M splats per GB) is an estimate, not measured on a phone.
The streamed scan whose chunks all fail to draw still says "ready" (only a single file is judged by holdsNoSplats).
No SOG version 1 scan (means.shape) was found on superspl.at.

## For the lead

- packages/render-pc/src/renderer.ts (not an owned file; the diagnosis's Repair 1 names it): loadSplat calls the version
  checks of lod.ts before `new Asset` (import line and 6 lines in start()).

- packages/render-pc/test/scan-sog-version.test.ts lives in render-pc (the check it tests is render-pc's lod.ts), not under
  packages/scenes/test as the prompt's owned pattern says; it reads the scenes fixture by relative path.

- S2, files outside the owned list: packages/scenes/src/content.ts (ContentKind 'ply'); packages/render-pc/src/renderer.ts
  (loadSplat reads .ply, plyBytes); apps/fly/src/bake.ts, bake-off-thread.ts, bake-worker.ts (BakeKind with 'ply',
  plyVertexCount); tests whose old expectation was "PLY is refused": packages/scenes/test/resolve.test.ts:165,
  superspl.test.ts:451, content.test.ts:17; new tools/bench/test/scan-ply-size.test.ts (bake.ts is tested from tools/bench);
  locale texts: fly `scenes.unsupported` (now GSAF, not PLY) and new fly/superspl `superspl.badge.unsupported`, all four languages.

- S3, files outside the owned list: apps/fly/src/session/index.ts (one block before the scan loads: openCheck with the device's
  limit), apps/fly/src/ui/scenes.ts showError (one line: failureText), apps/fly/src/app/flight.ts and app/scene-host.ts (the
  failure code is failureCode(e); scene-host tells the reason through ux4a's tell(), 2 lines; SceneError import dropped),
  packages/render-pc/package.json (export "./lod" so apps/fly reads the pure checks without the engine), render-pc lod.ts and
  renderer.ts (NoSplatsError, holdsNoSplats), tools/bench/test/scene-load.test.ts (its source-text marker follows the new line).
  Deploy order: page only. Live check after the deploy: scans-open (S4 extends it).

- S4: tools/bench/scripts/n-scan-accept.mjs is new (owned pattern n-scan-*). deploy/live-checks.sh scans-open (owned):
  hot-sog3-scans.mjs also draws a5d25fb4 and c67edb74, then n-scan-accept.mjs walks every kind with ?render=off; it fails
  on the live site until this train is deployed (the PLY kinds and GSAF). Deploy order: page only. Live checks after the
  deploy: scans-open.
- A heavy single file has no line of its own: the loading card (ui/loading.ts, gap-msgs) already shows size, speed,
  minutes left and Cancel. ux4a's lines wait under the card (messages-logic.ts setCovered), so a line told before the
  download is read only after it; a "Load anyway / Choose another" question on the card, if the lead wants one, is a
  change in ui/loading.ts.

## Cost notes
- S1: about 25 calls; most went to finding where the check belongs (renderer.ts vs scenes) and to neg_control needing `npx.cmd` on Windows (plain `npx` is not found by CreateProcess). Cheaper: the lane prompt could name renderer.ts as the check's place.
- S2: about 35 calls; most went to node -e edits whose backslashes the shell ate (a regex and a test pattern had to be fixed by hand) and to three old tests that held "PLY is refused". Cheaper: write edit scripts with the Write tool from the start; grep the tests for the behaviour before changing it.
- S4 run 1: about 45 calls; most went to the pilot's path (the Controls screen at "ready" pauses the flight until Keyboard is chosen; found by a debug shot) and to a drawn run of 11 ids killed at the 10 min background limit while it held the GPU lock. Cheaper: the design could name `[data-action="radio-keyboard"]` as the step after ready; start long drawn runs with a background timeout of 40 min and a per-id MAXS, and record loading progress from the first version of a probe.
- S3: about 40 calls; most went to finding where a failure reaches the pilot (three call sites: picker, first load, switch) and to two old tests that read source text or stub the renderer. Cheaper: the design could name the three call sites and say that ?render=off never runs the renderer's checks.
- S4 run 2: about 50 calls; most went to the heavy-file line: told through ux4a, rebuilt, then found by a probe that ux4a lines wait under the loading card, and reverted. Cheaper: the design could say where the pilot looks during a download (the loading card, gap-msgs) and that tell() is covered there.

- Review: about 45 calls; most went to waiting for the shared GPU lock and to a second build after the Cancel repair. Cheaper: the design could say that the first load's card has no Cancel (only switches do), so a probe of a heavy first load checks it from the start.

## Review

Verdict: SHIP (independent check, 2026-11-21; full text U:/Temp/gsfpv-train4/reviews/n-scan.md).
- PROVEN, repaired in 78351fc3: SuperSplatCatalog.randomTopRated (superspl.ts) used its own rule that let 'legacy'
  through, so the random SuperSplat button could draw a compressed PLY of up to 163 MB. Test in superspl.test.ts, NEG OK.
- PROVEN, repaired in the review commit: the first load's card (app/flight.ts) had no Cancel; a heavy scan that
  downloads steadily never stalls, so c67edb74 showed no Cancel and no "Choose another scan" for minutes (drawn probe
  tools/bench/scripts/n-scan-review-cancel.mjs on the old build: "no Cancel on the card during the download",
  evidence review-cancel-before.json). Now onCancel = the same as "Choose another scan"; on the new build Cancel was
  on the card and clicked, then the scene list "Choose a scan" opened (review-cancel-after.json; picture). Claim 2's
  c67edb74 PASS was recorded before n-scan-accept.mjs judged the Cancel.
- Drawn on a build of 78351fc3 by mouse: a39abad1, a5d25fb4, 143e76b0 PASS flown (review-accept-drawn.json).
- DOUBT: deviceSplatLimit (estimate) may refuse a large single SOG of the catalog on a low-memory phone;
  scene-host.ts and flight.ts are not owned files (listed under For the lead).

## What the owner should try

1. After the deploy open https://gsfpv.flyreelstudio.eu/en/fly/?scene=a39abad1: the hall with the brick dinosaurs opens and flies.
2. Open ?scene=a5d25fb4: an older upload (compressed PLY) now opens: a person in a motorcycle suit on grey.
3. Open ?scene=5012e205: one line says this animated format cannot open yet, with the way back to the scan list.
4. Open ?scene=c67edb74: a large scan; the card shows the minutes left and Cancel (key Esc) until it opens.
