# Lane head4: head tracking with a web camera for Fly by Sound (train 4)

Design: docs/wip/sonic-headtrack-plan.md part 1 (1.2 to 1.4). Owner's words: the brief named in the lane prompt.
Host code: apps/fly/src/sonic/head/. The sound package (packages/sonic-fpv) is not edited by this lane.

## Status

Stages (adapted from plan 1.4; at most 4; see "Differences from the design"):

- [x] H1 head pose math in the host: HeadPose, the head's axes, the turn of the page's AudioListener (ListenerTurn), one-euro
  smoothing, centre and recentre, clamp, a lost face held 0.5 s then glided back over 0.3 s, the face matrix to yaw, pitch
  and roll. Test tools/bench/test/sonic-head-pose.test.ts (7 tests), NEG OK on origin/main. Commit 1657b1e8.
- [x] H2 the setting "Turn my head to listen" in the sound settings, OFF by default; switching it on speaks first (what the
  camera is for, that no picture leaves the computer, that the browser will ask), only then asks for the camera; the
  spoken result; the key to recentre (Shift+H); the face-lost line; the camera stops when switched off or the page is
  hidden; ListenerTurn applied per tracker result; with the setting off no head code is loaded (import('./tracking')).
  Files head/switch.ts, types.ts, tracking.ts, page.ts; tests tools/bench/test/sonic-head-switch.test.ts (13) and one row
  test in sonic-start-screen.test.ts; NEG OK on origin/main. Commit: see git log (head4 H2). Until H3 the tracker factory
  in head/page.ts rejects, so switching on says "the face tracker did not start" and turns the setting back off.
- [x] H3 the tracker in a worker (MediaPipe Face Landmarker 1.2.3, wasm and model served from our own origin under
  /fly/headtrack/, pinned by size and sha256 in head/assets.ts, copied or fetched once by apps/fly/vite-headtrack.ts;
  frames posted as ImageBitmap, one at a time; only numbers come back), the "loading" line past 1 s, the lab page
  apps/fly/lab/head.html and the probe tools/bench/scripts/head4-tracker.mjs with a fake camera (Motion-JPEG made from a
  still portrait through Chrome's --use-file-for-fake-video-capture): PASS, evidence/2026-11-19/head4/tracker.json.
  Test tools/bench/test/sonic-head-tracker.test.ts (6), NEG OK on origin/main and on 777c5893 (the loading line).
  Commits d7c8f19d and head4 H3 (see git log).
- [x] H4 deploy/nginx.conf camera=(self) on the simulator page only, the serve-csp run (the prompt path works, other pages
  refuse), the acceptance, the parts below completed, the gates.
  - [x] H4a nginx camera=(self) in `location ~ ^/(en|es|pl|ru)/fly/` only; tests apps/api/tests/test_nginx_routes.py
    (camera_of, 2 new tests, 19 OK) and tools/bench/test/sonicrec-headers.test.ts (5 OK), both NEG OK on origin/main;
    the microphone controls of sonicrec-headers.ts and sonicrec-serve.ts follow the new text; deploy/README.md row.
  - [x] H4b one release build, serve-csp on 6142, the acceptance probe tools/bench/scripts/head4-accept.mjs (mouse,
    1536x730 at 1.25, 12 steps): PASS, evidence/2026-11-19/head4/accept.json; the same probe on the live site: 10 steps
    FAIL (the lane's), 2 PASS (true before: nothing loads, other pages refuse), evidence/2026-11-19/head4/accept-live.json.
    The privacy sentence in four languages: docs/wip/head4-privacy.json.
  - [x] H4c the gates (typecheck, vitest, architecture, i18n, b18, leaks, catalog, api-unittest), once: all PASS but vitest,
    1 failed of 5360 (packages/prefs/test/catalog.test.ts pins the sound mode's keys; H2 had not added Shift+H). Fixed
    (sonic.headCentre and Shift+H in its lists, the control's count 7 -> 8): 10 of 10, NEG OK on origin/main's keymap.ts;
    the full vitest was not run again (the one changed input is that test file; the other 409 files passed).
    Commits aabad1af (H4a), 3b55b890 (H4b), head4 H4c (see git log).

### Differences from the design

- The plan names R as the recentre key; R is taken in the sound mode (its long press, mode.ts). Shift+H is used (H for head;
  bound nowhere, same place on QWERTY, QWERTZ, AZERTY, Polish and Spanish layouts), as Shift+V for the narrator.
- A setting left on from an earlier visit starts at load only when the browser already allows the camera (Permissions API
  'granted'); otherwise it is saved off without a word, so the page never asks at load.

- Plan H1 puts the rotation inside the sound package (headPose in SonicFrameInput, applied before pannerDirection and the
  ILD gain). This lane may not edit the package, so the host turns the AudioListener instead (the engine writes the
  listener once, at graph build, engine.ts around line 497, and never again). Limit: the package's ILD boost (near
  hazards up to 6 dB, beacon side 2 dB, line side 10 dB) still follows the craft-frame side. Written under For the lead.
- H3: the tracker runs on the CPU (delegate 'CPU'), so the scene keeps the GPU; the GPU delegate was not measured.
  Pictures come from a video element off the page (requestVideoFrameCallback, createImageBitmap), not an OffscreenCanvas.
  The module worker loads MediaPipe's module build of the runtime (vision_wasm_module_internal.*): a module worker has no
  importScripts, and MediaPipe then falls back to import(). Only the SIMD build is shipped.
- Plan H2 (an offline rig run with pnpm listen inside the package) is package work; it is replaced by the host's setting
  and switch-on flow. The lead prompt asks for a setting in the sound settings; the plan said a menu item: the prompt wins.

## What the owner does

1. Open https://gsfpv.flyreelstudio.eu/en/fly/?sonic=start (or the pause menu's Fly by Sound item). Headphones on, a web
   camera on the computer.
2. In the navigation choose Settings (mouse or Tab, Enter). The settings list has "Turn my head to listen", off. With it
   off nothing of the head tracking is downloaded and the camera is not touched.
3. Tick it. The voice says what the camera is for, that no picture leaves the computer, and that the browser will ask.
   Then the browser asks for the camera: choose Allow. The first time "Loading the face tracker, about 8 megabytes" is said
   if it takes more than a second; then "Head tracking on. Face the screen; to centre again later, press key Shift+H."
4. Start a lesson (Start the course from the beginning). Face the screen and press key Shift+H: "Centred." Turn your head left and
   right: a sound ahead of the drone should stay where it is in the room, not turn with your head.
5. Move out of the camera's view: "Head lost. Sounds follow the drone until your face is back." (once, with the narrator
   on); the sound glides back to the drone's own front in about a second.
6. Untick the setting (or close or hide the tab): "Head tracking off. The camera is closed." The camera's light goes out.
7. If you choose Block in step 3, the voice says the camera was not allowed and how to allow it by the icon left of the
   address; the setting is off again.

## Claims

1. A voice at bearing 30 degrees is heard straight ahead when the head turns 30 degrees right, and at 30 with the head
   straight (the listener's own view computed as the Web Audio spec does). Proof:
   `npx vitest run tools/bench/test/sonic-head-pose.test.ts`; last result 7 of 7 passed, NEG OK on origin/main.

2. "Turn my head to listen" is off by default and loads nothing; switching on says the explanation before the camera is
   asked, then the result; refusals (not allowed, no camera, busy, tracker failed) are said and turn it back off; off and a
   hidden page stop the camera; Shift+H centres or says how to turn it on; a lost face is said once with the narrator on.
   Proof: `npx vitest run tools/bench/test/sonic-head-switch.test.ts tools/bench/test/sonic-start-screen.test.ts`; last
   result 13 + 25 passed, NEG OK on origin/main.

3. The face tracker reads a fake camera in a worker and turns the listener: on a clip of a still portrait turned in its
   plane, 16 pictures a second were read, 43 ms of worker time a picture (p95 52), a face found in 100 % of the face
   pictures and in 4 % of the faceless second, "head lost" said, roll follows the picture with r -1.000 and gain -1.001
   (the roll sign of poseFromFaceMatrix holds), camera picture to listener turn 48 ms p50 (69 p95; Web Audio's own output
   latency 40 ms comes on top), the tracker ready 0.8 s after the start (1.3 s with a cold dev server). Proof:
   `node tools/bench/scripts/head4-tracker.mjs http://localhost:6141 <portrait.jpg> evidence/2026-11-19/head4/tracker.json 12`
   with `cd apps/fly && npx vite --port 6141 --strictPort` running; last result PASS. The same probe with the clip Chrome
   could not open said no-camera and FAILED (exit 1).

4. The worker answers with numbers only, closes every picture, skips a time that does not grow; the page moves one
   picture at a time, skips pictures while the worker reads, ends the worker on a failed load and on stop; the loading line
   is said only past a second. Proof: `npx vitest run tools/bench/test/sonic-head-tracker.test.ts`; last result 6 of 6,
   NEG OK on origin/main and, for the loading line, on 777c5893.

5. Only the simulator page may ask for the camera: deploy/nginx.conf sends camera=(self) in `location ~ ^/(en|es|pl|ru)/fly/`
   and camera=() everywhere else (the site, the assets, the admin, the scene pages). Proof:
   `cd apps/api && python -X utf8 -m unittest tests.test_nginx_routes` (19 OK) and
   `npx vitest run tools/bench/test/sonicrec-headers.test.ts` (5 passed); both NEG OK on origin/main.

6. The pilot's path on the release served under the live policy (serve-csp), with the mouse at 1536x730, scale 1.25, a fake
   camera: the row is there and off; off, nothing of it is downloaded and no camera opened; the explanation is said before
   the camera is asked; the camera opens and "on" is said; the tracker's files come from /fly/headtrack/ on our origin;
   nothing is sent while the camera runs (no request but GET, none to another origin); a second click ends the camera's
   track and says "off"; on again, a lesson started with the mouse, a click into the scene, key Shift+H says "Centred.";
   in the lesson the AudioListener's up vector moves with the rolling portrait (range 0.457); the landing page's
   getUserMedia is refused (NotAllowedError); a browser that refuses the camera hears the "not allowed" line and the row
   is off again. Proof: `node tools/bench/scripts/head4-accept.mjs http://localhost:6142 <out.json>` with
   `node tools/bench/scripts/serve-csp.mjs dist 6142` on a `node scripts/build-release.mjs` build; last result PASS
   (12 of 12), evidence/2026-11-19/head4/accept.json. Control: the same probe on https://gsfpv.flyreelstudio.eu FAILS the
   10 steps of this lane (no row, camera=() on the page) and passes the 2 that were true before; accept-live.json.

## Not verified

- No person, no camera, no phone and no real controller took part. The roll sign is now measured (claim 3); the signs of
  yaw and pitch are still a reasoned guess: a flat picture cannot turn the head left or right (yaw read -3.3 to 0.2
  degrees, pitch -4.8 to -2.6 on the clip). A clip of a real head turn would settle them.
- The worker times (43 ms a picture) are one desktop's CPU in headless Chrome; integrated GPU machines and phones are not
  measured, the GPU delegate is not measured.
- The browser's camera question itself was answered by Chrome's flag (--use-fake-ui-for-media-stream), which also reports
  the permission as granted before it is asked: the real prompt and a pilot's Allow click were not seen. The refusal was
  Playwright's own (no flag), not a pilot's Block click. Speech was a stand-in (headless Chrome has no voice): the lines'
  order and words are checked, not their sound.
- The listener's turn was measured by its numbers; nobody listened to it. Firefox and Safari were not run.
- The fake clip's portrait is MediaPipe's sample photo (https://storage.googleapis.com/mediapipe-assets/portrait.jpg),
  kept only in the TEMP folder, not in the repository.

## For the lead

- Files changed outside apps/fly/src/sonic/head (H2): apps/fly/src/sonic/start-screen.ts (one settings row, the last before
  the sounds' volume part: `sonic-head`; lane sound6 edits this file too: merge by keeping both), entry.ts (a `head` field
  on SonicSetup), start.ts and in-place.ts (attachHead after each `new SonicSetup`, dispose on the in-place stop),
  feature.ts (the Shift+H key), apps/fly/src/i18n.ts and sonic/texts.ts (the namespace sonichead rides the start chunk),
  packages/prefs/src/doc.ts (SonicState.headTrack, only true kept), packages/prefs/src/keymap.ts (sonic.headCentre
  Shift+H), tests packages/prefs/test/keymap.test.ts, tools/bench/test/app-keys.test.ts,
  tools/bench/test/sonic-start-screen.test.ts (settings count 17 -> 18, "Item n of 18", the STOPS list, a head stand-in).
- The spoken key help (mode-keys.ts) does not list Shift+H yet: sound6 owns that list.
- H3: a new dependency of apps/fly, @mediapipe/tasks-vision 1.2.3 (Apache-2.0), exact, in apps/fly/package.json and
  pnpm-lock.yaml; apps/fly/vite.config.ts gets the plugin headTrackAssets() (apps/fly/vite-headtrack.ts). The build
  fetches the model once from https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
  (cached in node_modules/.cache/gsfpv-headtrack, checked by sha256; CI needs the network for it once a cache) and copies
  the wasm from the package. Files under /fly/headtrack/: vision_wasm_module_internal.wasm 14,665,738 bytes (about
  4.1 MB after gzip; build-release gzips .wasm), vision_wasm_module_internal.js 336,662, face_landmarker.task 3,758,596;
  the worker chunk is measured at the H4 build. Downloaded only when the pilot turns the setting on.
- H3: a new spoken line sonichead.say.loading in en, es, pl, ru.
- H4 nginx (deploy/nginx.conf, `location ~ ^/(en|es|pl|ru)/fly/` only), the exact line now:
  `add_header Permissions-Policy "hid=(self), gamepad=(self), fullscreen=(self), screen-wake-lock=(self), camera=(self), microphone=(self), geolocation=(), usb=(self), serial=(), bluetooth=(), xr-spatial-tracking=()" always;`
  Every other location keeps camera=(). CSP: no change. The page's policy already has script-src 'wasm-unsafe-eval' (the
  wasm), worker-src 'self' blob: (the worker /fly/assets/face-worker-*.js), connect-src 'self' (the files under
  /fly/headtrack/); the camera's MediaStream on a video element is not a media-src load. The probe ran under that
  enforced policy. /fly/headtrack/*.wasm falls in `location ~ \.wasm$` (immutable cache, gzip_static), the .js and
  .task files in `location /` (no-cache, ETag): the file names carry no hash, so they revalidate.
  Limit: the .wasm's name carries no hash but its cache is immutable for a year, so a later MediaPipe version must move
  the folder (HEAD_ASSET_DIR in apps/fly/src/sonic/head/assets.ts, e.g. headtrack/1.2.4/), not overwrite the file.
- H4 download, measured on the build (only when the pilot turns the setting on): over the wire with gzip_static about
  8.06 MB (vision_wasm_module_internal.wasm.gz 4,168,800; face_landmarker.task 3,758,596, not gzipped; the runtime's .js.gz
  81,181; the chunks face-worker 45,447, tracking 1,955, face-tracker 925 bytes gzipped); 18.9 MB unpacked (wasm
  14,665,738, task 3,758,596, runtime .js 336,662, face-worker 154,936, tracking 4,949, face-tracker 1,890).
- H4 privacy page: one new paragraph in privacy.sections[7] (Fly by Sound) of packages/i18n/locales/site/{en,es,pl,ru}.json,
  after its first paragraph; the exact words in four languages are docs/wip/head4-privacy.json (JSON escapes keep this
  repository's docs ASCII; JSON.parse gives the text). The English, exactly: "Turn my head to listen" (off until you turn
  it on) uses your web camera only to know where your head points. The pictures are read in the page on your own device
  and are never recorded, stored or sent; the face tracker (about 8 MB) is downloaded from this site the first time, and
  the camera closes when you turn the setting off or leave the page.
- H4 files outside the head folder: deploy/nginx.conf, deploy/README.md (the nginx table and the curl check),
  apps/api/tests/test_nginx_routes.py (camera_of and two tests), tools/bench/src/sonicrec-headers.ts and
  tools/bench/src/sonicrec-serve.ts (their microphone controls replace the new policy text),
  tools/bench/test/sonicrec-headers.test.ts, packages/prefs/test/catalog.test.ts (the sound keys list gets Shift+H);
  new tools/bench/scripts/head4-accept.mjs, docs/wip/head4-privacy.json.
- Deploy order: page and nginx together (the release, then deploy/nginx.conf: upload, nginx -t, reload). nginx alone is
  harmless (no page asks for the camera before this release); the page alone says "the camera was not allowed" and
  turns the setting off. No API files, no rooms; the sound package is not changed.
- Live checks after the deploy: `curl -sI https://gsfpv.flyreelstudio.eu/en/fly/ | grep -i permissions-policy`
  (camera=(self)); the same for /en/privacy/ (camera=()); `node tools/bench/scripts/head4-accept.mjs
  https://gsfpv.flyreelstudio.eu <out.json> <clip.mjpeg>` must PASS 12 of 12 (the clip: head4-tracker.mjs makes it
  from any face photo given to it; it stays outside the repository).

- Sound package (lane sound6 or later): an optional headPose in SonicFrameInput, applied per voice before pannerDirection
  and the ILD side gain, would make the ILD boost follow the head too; the host would then pass the pose instead of
  turning the listener.

## Cost notes

- H4: the most replies went to the probe's first run (the listener read before any sound had started; Chrome's fake
  camera answer reporting 'granted' before the ask) and to a pinned key list the gates found (catalog.test.ts); a line in
  agent-map naming catalog.test.ts beside keymap.test.ts for a new sonic key would have saved the gate round.

- H3: the most replies went to the probe's own bugs (a fit that could not start, a relative clip path Chrome could not
  open, a favicon 404) and to the MediaPipe mock not reaching the worker from tools/bench; a core taking its landmarker as
  an argument from the start, and absolute TEMP paths for every file Chrome opens, would have saved five replies.

- H2: the most replies went to the start screen test harness (pinned stops, a second setup, the lazy import's timing); a
  line in agent-map naming STOPS and the reload setup at line 606 beside the pinned count would have saved two runs.
- H1: the most replies went to finding where a head turn can enter without editing the package (engine.ts update and
  render); a line in the plan naming the listener as the host's only lever would have saved three reads.
