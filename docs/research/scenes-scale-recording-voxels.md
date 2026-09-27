# Research B: items 9, 10, 11, 14, 19, 24 (2026-09-25)

Everything marked **measured** was run today on this machine (i9-7980XE, RTX 4090 "lovelace", Windows 10,
system Chrome 153 via Playwright, Node 22.13). Scripts and raw outputs: `.cache/v02/rb-*` (listed per
section). Nothing was sent to our server; the live site was only opened as an origin to run `fetch()` in.

## 0. Short answers

| Item | Answer in one line |
|---|---|
| 9 | superspl.at lists scenes from `https://playcanvas.com/api/splats/explore`; its CORS is an origin allowlist (superspl.at, playcanvas.com). **From a page on gsfpv.flyreelstudio.eu the browser cannot read it (measured: `TypeError: Failed to fetch`).** An in-app copy of their catalogue needs PlayCanvas' permission (decision D15 still holds). What works today without it: embed superspl.at/search in an iframe (it allows framing), but our page cannot learn which scene was opened in it. |
| 10 | "Random highly-rated SuperSplat scene" needs the same API, so: not from the browser without permission. There are no ratings anyway, only likes (`starred`), views, comments. Buildable now: next favourite / history / admin-curated list. |
| 11 | Scale the collision by rewriting only the voxel metadata (grid origin and voxel size; octree arrays shared). **Measured: 20 000/20 000 identical hit decisions and ray hits** vs. the original world mapped through the same similarity. Splat entity gets the same scale + translation. Engine LOD already handles uniform scale. |
| 14 | File System Access API: `showDirectoryPicker` + handle in IndexedDB + `requestPermission` on the next visit (needs a click or key press; radio/gamepad input does not count). Chromium desktop only; Chrome 122+ can offer "Allow on every visit". Fallback: download as today. Recording stays showcase-only (D34). |
| 19 | **The current recorder breaks above 30 fps**: it declares a 30 fps track, and Mediabunny snaps timestamps to it (measured: 60 frames/s in → 29 duplicate timestamps per second). 60 fps needs a 60 Hz track, 60 Hz frame pacing and a disk target. Hardware H.264 at a declared 60 fps is offered only up to 1920x1080 here. The clean solution is to render the video from the input log (deterministic replay) at exactly 60 fps. |
| 24 | A voxel is solid when the Gaussians around it sum to >= 10 % opacity at the voxel's point nearest to each Gaussian, so faint large Gaussians (floaters, sky, haze, reflections) become solid blobs. **Measured:** hundreds to tens of thousands of disconnected clusters per scene. An overlay is practical as chunked meshes of exposed voxel faces around the drone, styled in the fragment shader; hiding the scan does not touch collision. |
| 8 (side finding) | **Root cause found:** 9d09ab82 is published as version 2; the CDN serves only `/v2/…` (`/v1/…` is 403) and `resolveScene` hard-codes `v1`. 14 % (trending) and 19 % (walkable) of the top-100 lists have version > 1 (up to v7). |

---

## 1. SuperSplat listing (items 9, 10) and scene versions (item 8)

Scripts: `rb-sniff.mjs`, `rb-apiurl.mjs`, `rb-explore.mjs`, `rb-cors.mjs`, `rb-live-cors.mjs`, `rb-iframe*.mjs`,
`rb-boot.mjs`, `rb-terms.mjs`; outputs `rb-home.*`, `rb-search.*`, `rb-explore*.json`, `rb-iframe*.png`, `rb-js/`.

### 1.1 Which API the site uses (measured)

- superspl.at is a React Router app; route loaders render the first page server-side, the client then pages
  with fetch. Its bootstrap data has `apiUrl: "https://playcanvas.com/api"` (in the SSR HTML of `/search`).
- The listing call is `exploreSplats` in `/assets/api-DCvEC4sD.js`:
  `GET https://playcanvas.com/api/splats/explore?skip=&limit=&sort=&order=&time=&features=&search=&userId=&softwareToolId=&unlisted=&incomplete=`,
  header `Accept: application/json`, `Authorization: Bearer` only when logged in.
- Seen live on `https://superspl.at/search?sort=likes&features=walkable`:
  `…/splats/explore?skip=0&limit=32&sort=starred&order=-1&features=walkable`, then `skip=32&limit=16`.
- Other endpoints in the same module: `splats/{hash}` (PUT), `/settings`, `/related`, `/downloads…`, `/assets`,
  `/assets/voxel/generate`, `/republish`, `splats/liked`, `star`, `comments`, `users/{name}`, `splat-tools/software`.
  `GET /api/splats/<hash>` answers 404 (there is no public single-scene GET).

### 1.2 Filters, sorts, paging (from the site's code and UI screenshot `rb-search.png`)

| UI | Parameter |
|---|---|
| Downloadable / Walkable toggles | `features=downloadable`, `features=walkable` (comma list) |
| Time: All time / Year / Month / Week / Day | `time=all|year|month|week|day` (`all` is omitted; default in /search: month) |
| Sort: Trending | `sort=trending&order=-1` (forces `time=all`) |
| Newest / Oldest | `sort=createdAt&order=-1 / 1` |
| Most viewed | `sort=views&order=-1` |
| Most liked | `sort=starred&order=-1` |
| Largest / Smallest | `sort=size&order=-1 / 1` |
| Search box | `search=<text>` (matches descriptions too: "drone" returned a snow village) |
| User page, software pages | `userId=`, `softwareToolId=` (e.g. `postshot`; list at `/api/splat-tools/software`) |
| Home collections | Walkable Worlds = `features=walkable`; Free Downloads = `features=downloadable`; Best of the Week = `sort=views&time=week`; All-Time Greats = `sort=views&time=all` |

- No tags, no categories in requests (an unused `["indoor","outdoor","object"]` list exists in the bundle), **no
  ratings**: only `starred` (likes), `views`, `comments`, `downloadCount`.
- Paging: `skip`/`limit`, first page 32, then 16; response `{ result: [...], pagination: { skip, limit, total } }`.
  Totals today: all 15 836; walkable all-time 1 283; walkable this week 69; downloadable 2 229.
- Rate limit headers: `ratelimit-policy: 120;w=60` (120 requests per 60 s).

### 1.3 Fields per scene (measured, 22–23 keys)

`hash`, `title`, `description`, `version` (content version, see 1.6), `thumbnails {xl,l,m,s,mov}` (webp on
`s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/<hash>/v<version>/<size>.webp`, `mov` = animated),
`task {status,message}`, `voxelTask {status,requestedAt}` (or null/absent), `format` (`ssog` streamed LOD,
`sog`, `sogs`, `compressed.ply`, empty), `size` (bytes), `lodCounts` (splats per LOD level), `shBands`, `views`,
`comments`, `starred`, `downloadCount`, `listed`, `downloads {enabled, license}` (licence codes seen: `by`,
`by-sa`, `by-nd`, `by-nc`, `by-nc-sa`, `by-nc-nd`, or `null` when downloads are off), `completedAt`, `createdAt`,
`modifiedAt`, `softwareToolIds`, `user {id, username}`, `starId`.

- "Has collision": there is no boolean. `features=walkable` matched scenes with `voxelTask` missing too (52 of
  the top-100 walkable), and every one of 12 probed had `scene.voxel.json` at its version. So "walkable" =
  collision file exists; our existing ranged-GET probe of the voxel file is the reliable test.
- Sample stats (top 100 walkable by views): versions {1: 81, 2: 13, 3: 3, 4: 1, 6: 1, 7: 1}; formats
  {sog 54, ssog 37, sogs 2, compressed.ply 2, empty 5}; size median 96 MB, max 1.5 GB. Top-100 trending:
  versions {1: 86, 2: 11, 3: 2, 4: 1}, size median 104 MB, max 2.6 GB.
- The CDN `settings.json` has no title, author or licence (keys: version, tonemapping, highPrecisionRendering,
  background, postEffectSettings, animTracks, cameras, annotations, startMode). Title/author/licence are only
  in the API.

### 1.4 CORS: can the visitor's browser read it? (measured)

| Request (from a page on `https://gsfpv.flyreelstudio.eu`) | Result |
|---|---|
| `playcanvas.com/api/splats/explore…` | `TypeError: Failed to fetch`; console: no `Access-Control-Allow-Origin` |
| same with `mode: 'no-cors'` | opaque response, status 0, body unreadable |
| `playcanvas.com/api/splats/<hash>/related` | blocked (as in docs/measured-facts.md) |
| `superspl.at/s?id=<hash>` (viewer page with URLs) | blocked |
| CDN `…/9d09ab82/v2/settings.json` | 200, readable |
| thumbnail `images.playcanvas.com/splat/…/s.webp` | 200, `ACAO: *` |

From Node with an `Origin` header: `https://superspl.at` and `https://playcanvas.com` get their origin echoed in
`Access-Control-Allow-Origin` (+ `allow-credentials: true`); gsfpv, example.com and no-origin get none. It is an
explicit allowlist, so the clean path is to ask PlayCanvas to add our origin.

Our own CSP (report-only today, `deploy/nginx.conf`) would also need `connect-src https://playcanvas.com` for
the API and `frame-src https://superspl.at` for an iframe; `img-src` already allows the S3 thumbnails.

### 1.5 Terms and robots

- `superspl.at/robots.txt`: `Disallow: /api/` (plus /manage, /admin, /login, /auth/), `Crawl-delay: 1`. The API
  itself is on playcanvas.com, whose robots.txt allows everything.
- PlayCanvas Terms of Use (`https://playcanvas.com/terms`, saved `rb-terms.txt`): (a) no robots, spiders,
  crawlers, scrapers "or other automated means or interface" to access the Services (rb-terms.txt line 125); (b) API use,
  including through a third-party product, is bound by the Terms, and account data is accessed via "authorized
  APIs" (line 141); (c) do not abuse or exceed API calls (line 135). A third-party site calling their
  undocumented listing API, with CORS saying no, is not something we should do without their written OK.
  Our rule (the server never contacts SuperSplat) and D15 both point the same way.

### 1.6 Scene versions: root cause of item 8 (measured)

- 9d09ab82: API `version: 2`, `format: ssog`. CDN `v2/settings.json`, `v2/lod-meta.json` → 206; `v2/scene.voxel.json` → 206;
  every `v1/…` → 403. SuperSplat's own viewer page points at `…/9d09ab82/v2/lod-meta.json` and `…/v2/scene.voxel.json`.
- ff1d0393 (v7): v1…v6 and v8 → 403, v7 → 206. Old versions are deleted; only the current one is served.
- `packages/scenes/src/index.ts` lines 122–125 build every URL with `/v1/`, so any republished scene reads as
  "not found". Fix: probe `settings.json` for v1 first (86 % of scenes), then v2…v8 in parallel (all CDN, ACAO `*`),
  and keep the found version for content, collision and thumbnails; remember it per scene in history.

### 1.7 Embedding superspl.at (measured, `rb-iframe*.mjs`)

- `superspl.at/search` sends no `X-Frame-Options` and no CSP `frame-ancestors`: it renders in an iframe on our
  origin, with its own filters and sorts (headed and headless Chrome).
- Our page cannot read which scene the visitor opened: after a click the frame was at `superspl.at/scene/c67edb74`,
  while `iframe.contentWindow.location.href` threw `SecurityError`. Picking needs a user step (copy link → paste
  into our field; the paste event needs no clipboard permission). Drag-and-drop of a card out of the iframe was
  not tested.
- In the first 2 of 4 runs the list inside the frame stayed empty ("No scenes match these filters") and the
  console showed superspl.at's own API request failing CORS inside the frame; in the next 2 runs the API answers
  carried their origin in ACAO and the last run showed 96 cards. Cause unknown (their side).
- Opening a scene inside the frame loads their full viewer (WebGPU) into our tab next to our renderer.

### 1.8 What is buildable for 9/10 without permission

- 9: a "SuperSplat" tab that embeds `superspl.at/search?features=walkable&sort=likes` (their UI, their filters)
  plus a paste box and a "Fly" button; or a link out to the same URL in a new tab. Needs `frame-src` in our CSP.
- 10: "next favourite" and "next from history" from local data; "random good scene" from an admin-curated list
  shipped with the app (id, version, title, author, licence typed/checked by the admin; thumbnails from the S3
  pattern above). A live "random highly-liked" needs the explore API → permission first.

---

## 2. Scene scale around the drone (item 11)

Script: `rb-scale.ts` (run with tsx); output `rb-scale.txt`.

### 2.1 Collision: rewrite the metadata, share the octree

Every query in the vendored `VoxelCollision` maps world → voxel index only through `gridMin` and
`voxelResolution` (constructor, `isFreeAt`, `queryRay`, `resolveDeepestPenetration`); the octree is walked by
index. Our own `sphereOverlaps` and `forEachSolidVoxel` (`packages/collision/src/world.ts` 28, 157) read the same
two fields. So a scaled world is a new `VoxelCollision` over the **same** `nodes`/`leafData` arrays with:

```
T(w) = s*w + t            (t = P*(1 - s) keeps pivot P fixed)
file space: v1.1 = world; v1.0 (FlippedVoxelCollision) = world with x, y negated, so t_file = (-tx, -ty, tz)
gridMin' = s*gridMin + t_file,  voxelResolution' = s*voxelResolution,  gridMax' = gridMin' + n*res'
new VoxelCollision(meta', col.nodes, col.leafData)  // or FlippedVoxelCollision for 1.0; no copy, no vendored edit
```

**Measured** (20 000 random points per run, radius 3–23 cm scaled by s, rays 10 m, 3 000 swept segments):

| Scene (format) | s, pivot | isFreeAt | querySphere hit/miss | queryRay hit point error | sweepOne |
|---|---|---|---|---|---|
| 39e63ce9 (1.0, flipped) | 1.5 | 20000/20000 | 20000/20000 | 6.7e-14 m | 3000/3000 |
| 39e63ce9 | 0.5 | 20000/20000 | 20000/20000 | 3.7e-15 m | 3000/3000 |
| 887f27aa (1.1) | 0.7 | 20000/20000 | 20000/20000 | 1.5e-13 m | 3000/3000 |
| 887f27aa | 2.0 | 20000/20000 | 20000/20000 | 7.5e-13 m | 3000/3000 |
| negative control 39e63ce9 | 1.0 | 20000/20000 | push vectors 0/1959 differ | 0 | 3000/3000 |

The push-out *vector* of `querySphere` (upstream iterative depenetration) differs for 139 of 1 959 hits at s=1.5
and 1 of 614 at s=2 (max 0.23 m / 0.30 m): its constants are absolute metres (`PENETRATION_EPSILON` 1e-4,
`normalAt` grows 2–20 mm) and ties between equally deep voxels break differently. Contact detection (our sweep)
is identical. The scaled world is simply its own world: fine for flying, but a replay must use the same scale.

### 2.2 Rendering

- `renderer.ts` 234 creates the splat entity with `setLocalEulerAngles(0, 0, 180)` at scale 1. PlayCanvas world
  = t + R·(s·p), and a uniform scale commutes with R, so set `position = t`, `localScale = (s, s, s)`, keep the
  rotation. Collision and render then agree by construction.
- The engine's LOD handles uniform scale: `gsplat-octree-instance.js` 208 reads `getWorldTransform().getScale().x`,
  transforms the camera into local space (223–226) and converts distances back with `* uniformScale` (267). Only
  uniform scale is supported there.

### 2.3 Around the drone, persistence, spawn, physics, logs

- Store the scene transform as `{s, t}` (not "scale + pivot"): rescaling by k around the drone D composes to
  `s2 = k*s1`, `t2 = D*(1-k) + k*t1`. Persist per scene id + version.
- Scaling **up** around D keeps the drone free (the free ball around D grows). Scaling **down** shrinks it by k: the
  drone can end inside a wall → run `findSphereSpawn` / push out after every rescale below 1.
- Physics stays in metres: gravity, craft, rates unchanged. The voxel size becomes s*5 cm (s=3 → 15 cm blocks),
  so clearance granularity changes with s (docs/measured-facts.md §4: clearance scales with voxel size).
- Everything positional must go through T when s or t change: spawn, authored camera, safe points / 5-s-back
  history (items 16/23), HUD altitude base, crash floor (`forEachSolidVoxel` and `queryRay` already follow),
  baked collision (`installCollision`).
- Logs: `LogHeader` (`packages/sim-core/src/runner.ts` 21) has `collisionSha256` of the bytes, which do not change
  with scale; `startReplay` (`session.ts` 516–518) checks only simCore + sha. Without a header field
  (`sceneTransform: [s, tx, ty, tz]`, also in `configHash`) a replay under another scale silently diverges.
  A rescale mid-flight should start a new log (as `installCollision` does) or be written as a log event.

---

## 3. Recording: 60 fps and auto-record to a folder (items 14, 19)

Scripts: `rb-snap.mjs`, `rb-rec60.mjs`, `rb-hwcap.mjs`, `rb-hwnofr.mjs`, `rb-docs*.mjs`; outputs `rb-rec60.json`,
`rb-hwcap.txt`, `rb-hwnofr.txt`, `rb-docs.json`.

### 3.1 What the recorder does today

- `cinema.ts` 24: encoder `framerate: 30`, bitrate `w*h*30*0.15`; 67: `BufferTarget` + `fastStart: 'in-memory'`
  (whole MP4 in RAM, then a Blob copy for the download in `main.ts` ~504); 70: `addVideoTrack(track, { frameRate: 30 })`;
  85: drops frames when `encodeQueueSize > 8`; 103: key frame every 60 frames.
- `main.ts` 471 adds a frame on **every** `frameend`, i.e. at the display/render rate (60, 144 …).
- Mediabunny doc (`VideoTrackMetadata.frameRate`, `dist/mediabunny.d.ts` ~5362): timestamps are snapped to this
  rate; adding more frames than it allows gives several frames with the same timestamp.
- **Measured** (`rb-snap.mjs`, Mediabunny 1.59.1): 60 packets at 60 fps into a 30 fps track → 29 duplicate
  timestamps (0, .033, .033, .067, .067 …); into a 60 fps track or an unset rate → 0 duplicates.
- The kept phase-D file (`evidence/2026-09-24/d/cinema-887f27aa.mp4`, ffprobe): `time_base 1/30`, 179 frames,
  177 steps of 33.3 ms: fine only because that flight rendered at ~30 fps (full detail, 80 M splats). At a
  normal 60/144 Hz render the current code writes broken timing.
- Memory: Mediabunny's guide says `BufferTarget` suits files under ~100 MB and large outputs can crash the page;
  it recommends `StreamTarget`. At 1080p60 and 0.15 bit/pixel the stream is ~18.7 Mbit/s ≈ 140 MB per minute.

### 3.2 Can this machine encode 60 fps? (measured, Chrome 153, `rb-rec60.mjs`, `rb-hwcap.mjs`, `rb-hwnofr.mjs`)

`VideoEncoder.isConfigSupported`, `hardwareAcceleration: 'prefer-hardware'`:

| Size | declared 60 fps | declared 30 fps | no framerate |
|---|---|---|---|
| 1280x720, 1920x1080 | yes (H.264, HEVC) | yes | yes |
| 1920x1200, 2048x1152, 2560x1440, 3840x2160 | **no** | yes | yes |

So Chrome here offers hardware H.264 at a declared 60 fps only up to 1920x1080 (level `avc1.640034`/`…33`/`…2a`
all fine at 1080p). With `prefer-software`, H.264 is accepted at every size (OpenH264). VP9 hardware: no. HEVC and AV1 hardware follow the same
pattern as H.264 (60 fps declared: up to 1080p only).

Throughput (240–300 synthetic moving frames, queue kept <= 6; the numbers include drawing the test pattern, so
they are lower bounds for the encoder):

| Size | hardware, framerate 60 declared | hardware, no framerate | software (OpenH264, 18-core CPU) |
|---|---|---|---|
| 1920x1080 | 145 fps | 120 fps | 106 fps |
| 2560x1440 | not offered | 97 fps | 59 fps |
| 3840x2160 | not offered | 55 fps | 25 fps |

Capture cost per frame from a WebGPU canvas in the same task (median/p95): `drawImage` to the 2D compositor
0.1/0.1 ms, `new VideoFrame(offscreen2d)` 0.1/0.2 ms, `new VideoFrame(webgpuCanvas)` 0.0/0.1 ms, at 1080p and
1440p (CPU-side submit time; GPU copy time not visible). Not measured: pacing on a real 60/144 Hz display (the
automated window ran rAF at 30 Hz), and any machine other than this one.

### 3.3 What 60 fps needs

- Track `frameRate: 60`, encoder `framerate: 60` (at <= 1920x1080; above that omit `framerate` or record at 1080p),
  bitrate scaled for 60, key frame every 60–120 frames.
- Pacing on a fixed 60 Hz grid: take the first rendered frame at or after `t0 + k/60 s`, stamp it `k/60` (constant
  frame rate, which DaVinci Resolve handles; VFR it handles poorly). If the render is slower than 60, either repeat
  the previous frame for missed slots or leave gaps; count them and show them.
- On a 144 Hz display the chosen frames are 2 or 3 display frames apart (13.9 / 20.8 ms), up to 6.9 ms off the
  grid → visible micro-judder at speed. Fix: set the camera pose for the grid time on captured frames (the sim runs
  at 1 kHz, pose history is cheap), or:
- **Best: export from the flight log.** The flight is deterministic from its input log (already saved as
  `.gsfpvlog`, `main.ts` ~677; `session.startReplay`). An "export video" pass can step the replay by exactly
  1/60 s per rendered frame, wait for the engine's `frame:ready` (sorted, LOD resident) and encode at any size with
  no dropped frames and no load on the live flight. Caveats: `crashview.ts` 98 steps the crash on
  `performance.now()` (Rapier build is deterministic, the clock is not); the scene transform, scene version and
  collision hash must be in the log header.

### 3.4 Auto-record into the last chosen folder (File System Access API)

Sources: MDN `Window.showDirectoryPicker`, `FileSystemHandle.requestPermission`, `FileSystemFileHandle.createWritable`;
Chrome "The File System Access API" and "Persistent permissions for the File System Access API" (T. Steiner);
WHATWG File System spec; HTML spec "activation triggering input event"; Mediabunny "Writing media files".

- `showDirectoryPicker({ id, mode: 'readwrite', startIn: 'videos' })`: secure context, transient user activation
  required (else `SecurityError`), MDN marks it "Limited availability". Chrome says the API runs on most Chromium
  browsers (Windows, macOS, ChromeOS, Linux, Android); Firefox and Safari have no picker (they do have the origin
  private file system: Chrome doc support table 86 / 111 / 15.2).
- Handles are serializable: store the directory handle in IndexedDB. On the next visit `queryPermission()` is
  usually `'prompt'` ("permissions are not always persisted between sessions"); `requestPermission()` needs a
  transient activation.
- Activation comes only from trusted `keydown` (not Esc), `mousedown`, mouse `pointerdown`, non-mouse
  `pointerup`, `touchend` (HTML spec). **Radio input (Gamepad/WebHID) does not count**, so arming cannot unlock
  the folder. Ask on the click that starts the flight (the "Fly" button), before the scene loads; the activation
  window is "at most a few seconds".
- Chrome 122+: a three-way prompt ("Allow this time / Allow on every visit / Don't allow") is shown when the site
  stored the handle in IndexedDB on a previous visit, or re-requests after Chrome auto-revoked access because the
  tab was in the background for a while (one-time-permission logic). Installed web apps persist automatically.
  After 3 denials/dismissals it falls back to the normal prompt. Relevant: Andrii switches windows a lot (item 22),
  so re-check `queryPermission` at every record start.
- Writing: `dir.getFileHandle(name, { create: true })` → `createWritable()`; Mediabunny's `StreamTarget` chunks
  are `{ type: 'write', data, position }`, the same shape `FileSystemWritableFileStream` accepts, with backpressure;
  use `fastStart: false` (or `'fragmented'`), not `'in-memory'`. Nothing reaches the real file until `close()`:
  writes go to a temporary swap file that replaces the target on close (spec + MDN). A tab crash mid-recording
  loses that recording; splitting long flights into files bounds the loss.
- Fallback when there is no picker or the permission is refused: today's download link (Blob) or record into
  OPFS and offer the file after the flight.
- Licence: D34 limits recording to showcase scenes; for pasted scenes the licence is unknown (API not readable),
  so auto-record must stay off there.

---

## 4. Voxel overlay and phantom walls (item 24)

Scripts: `rb-voxstat.ts`, `rb-faces.ts`; outputs `rb-voxstat-*.json`, `rb-faces.txt`.

### 4.1 Why voxels appear where there is nothing to see

From `@playcanvas/splat-transform` 3.6.4 (`dist/index.mjs`), the tool and defaults SuperSplat and our bake use:

- GPU voxelizer (WGSL ~14080–14260): for each voxel, sum over Gaussians `opacity * exp(-0.5 * d^2)`, where d is
  the Mahalanobis distance from the Gaussian centre to the **closest point of the voxel** (not its centre);
  Gaussians count out to 3 sigma (`SIGMA_CUTOFF = 3`); `opacity = 1 - exp(-sum)`; solid if `>= opacityCutoff`
  (default 0.1).
- Consequences: one Gaussian with opacity 0.5 marks every voxel within ~1.8 sigma of its centre as solid, so a
  large, visually faint Gaussian (sky/background splat, haze, a floater) becomes a solid ball; many very faint
  overlapping Gaussians (each 2 %) add up past 10 %; thin surfaces are thickened by up to a voxel.
- Post-filter (`filterAndFillBlocks` ~35874): removes only voxels with no 6-connected neighbour and fills single
  holes. Clusters of two or more voxels stay. Carve / floor-fill / exterior-fill are optional (`navSeed`,
  `navCapsule`) and keep voxels that touch reachable air, which floaters in open air do.
- Known 3DGS artefacts that end up solid by the same rule (not measured here): reflections reconstructed as
  geometry behind glass, mirrors or water; semi-transparent glass; near-camera floaters from training.
- Another cause the overlay would expose: collision offset from the visible surface (wrong format flip, a
  transform not applied). Not observed in the scenes tested; noted because the overlay makes it visible at once.

**Measured**, connected components of occupied 4x4x4 blocks (26-neighbour), cross-checked against the repo's
`countSolidVoxels` (identical totals):

| Scene | Collision | Solid voxels | Components | Largest share | Clusters of <= 8 blocks | 9–512 blocks |
|---|---|---|---|---|---|---|
| 887f27aa Tunis | official v1.1, 5 cm | 400 844 675 | 569 | 95.2 % | 418 (1 685 voxels) | 116 (236 028) |
| 7a475d38 Winter Garden | official v1.0, 3.2 cm | 72 367 434 | 1 426 | 59.3 % | 1 255 (5 518) | 141 (138 073) |
| 39e63ce9 Modlinek room | official v1.0, 5 cm | 1 165 978 | 57 | 91.8 % | 39 (255) | 16 (56 407) |
| 723068d7 exterior | our in-browser bake, 5 cm | 261 895 692 | 20 299 | 75.4 % | 16 278 (130 418) | 3 580 (2 155 907) |

In the 723068d7 bake the grid reaches 578 m below the scan (`sceneBounds`), and one component of 2.2 M solid
voxels sits ~420 m below the scene: far background Gaussians voxelised into a blob. Not every separate component
is a floater (a tree or a lamp post can be separate), but the small ones in open air are the classic case.

### 4.2 How to draw it at interactive rates (PlayCanvas 2.22.4)

Measured size of the job, exposed faces (solid voxel next to empty) in a cube around the authored camera:

| Scene | Cube | Solid voxels | Exposed faces → triangles | Faces merged into 1-D runs → triangles |
|---|---|---|---|---|
| 887f27aa | 10 m | 1.73 M | 369 k → 0.74 M | 85 k → 0.17 M |
| 887f27aa | 20 m | 7.75 M | 1.40 M → 2.80 M | 411 k → 0.82 M |
| 39e63ce9 | 10 m | 0.52 M | 408 k → 0.82 M | 221 k → 0.44 M |
| 39e63ce9 | 20 m | 0.99 M | 770 k → 1.54 M | 430 k → 0.86 M |
| 7a475d38 (3.2 cm) | 10 m | 2.56 M | 2.36 M → 4.72 M | 1.37 M → 2.74 M |

- Instanced cubes of every solid voxel: millions of instances × 12 triangles, and PlayCanvas instancing submits all
  instances with no frustum culling (PlayCanvas manual, hardware instancing). Not viable.
- Chunked face meshes (e.g. 32³-voxel chunks, only exposed faces, runs/greedy merged), built in a worker near the
  drone and cached, each chunk its own `MeshInstance` so the engine culls it. Measured windows: 0.17–0.86 M
  triangles after 1-D run merging for the 5 cm scenes (20 m cube), 2.7 M for the 3.2 cm Winter Garden in a 10 m cube.
  Public API: `Mesh.setPositions/setNormals/setIndices` (Uint32 allowed), `ShaderMaterial` with
  `vertexWGSL/fragmentWGSL` (+ GLSL for WebGL2). Building from single `isVoxelSolid` calls is slow (~90 ns each:
  8 M lookups 0.7 s, 64 M lookups 4.9 s in Node), so walk the octree per block and use its 64-bit leaf masks.
- Styles in the fragment shader over the same mesh, from world position and face normal: solid shaded, voxel grid
  lines (`fract(worldPos / res)` near an edge), edges only (discard the rest = wireframe look), colour by height or
  distance to the drone, colour by component size (floaters in red). WebGPU has no point size (spec §23.2.5.1:
  one fragment per point) and lines are 1 px, so "points" and thick wires must be quads (PlayCanvas 2.22 also
  ships a `WideLine` renderer).
- Opacity: blended material with depth write on, in a layer drawn after the splats. Splats do not write depth, so
  the nearest voxel skin shows over the scan (x-ray), which is what an alignment check needs.
- Hide the scan and fly the voxels only: disable the splat entity; collision is CPU-side and unaffected.
- Draw a window (10–20 m) around the drone with a distance fade; the whole scene (400 M solid voxels for Tunis)
  is out of reach for a mesh. A fragment-shader ray march through the octree uploaded as data textures would show
  everything at a fixed cost per pixel (887f27aa: 8.4 M words ≈ 34 MB) but is far more work; not needed first.

### 4.3 How the overlay helps

- The pilot sees at once whether an invisible wall is a floater blob, a thick shell, sky, or an offset.
- Colour by component size makes floaters obvious; a user option "ignore small floating clusters" (drop components
  under N blocks) would remove them from collision. That changes the collision, so the parameter must go into the
  log header (same as the scale).
- For browser bakes (phase C), the same filter can run once after `writeVoxel`.

---

## 5. Sources

- superspl.at: `/robots.txt`; `/search` HTML (bootstrap `apiUrl`); `/assets/api-DCvEC4sD.js` (exploreSplats);
  `/assets/search-CpNLTOeQ.js` (sort map, page sizes 32/16); `/assets/useInfiniteScrollExplore-o72n4vQw.js`.
- `https://playcanvas.com/api/splats/explore` responses and headers (`rb-explore*.json`, `rb-cors.mjs`).
- PlayCanvas Terms of Use `https://playcanvas.com/terms` (saved as `rb-terms.txt`).
- PlayCanvas engine 2.22.4 `build/playcanvas/src/scene/gsplat-unified/gsplat-octree-instance.js` 208–271;
  `playcanvas.d.ts` (Mesh, ShaderMaterial, MeshInstance.setInstancing, WideLine);
  `https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/`.
- `@playcanvas/splat-transform` 3.6.4 `dist/index.mjs` (voxelizer WGSL, `computeGaussianExtents`,
  `filterAndFillBlocks`, `writeVoxel`), `dist/lib/writers/write-voxel.d.ts`, `dist/lib/voxel/filter-floaters.d.ts`.
- Vendored SuperSplat viewer collision (`packages/collision/src/vendor/`, v1.35.0).
- Mediabunny 1.59.1 `dist/mediabunny.d.ts` (VideoTrackMetadata.frameRate, StreamTarget);
  `https://mediabunny.dev/guide/writing-media-files`.
- MDN: `Window/showDirectoryPicker`, `FileSystemHandle/requestPermission`, `FileSystemFileHandle/createWritable`,
  `FileSystemWritableFileStream`.
- `https://developer.chrome.com/docs/capabilities/web-apis/file-system-access`;
  `https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api`.
- `https://fs.spec.whatwg.org/` (writes not visible until close);
  `https://html.spec.whatwg.org/multipage/interaction.html` (activation triggering input events);
  `https://www.w3.org/TR/webgpu/` §23.2.5.1 (point rasterization).
- Repo: `packages/scenes/src/index.ts` 122–125; `packages/render-pc/src/renderer.ts` 234; `apps/fly/src/cinema.ts`
  24/67/70/85/103; `apps/fly/src/main.ts` 471/484/504/677; `apps/fly/src/session.ts` (findSpawn, logHeader,
  trackSafePoint, respawn, installCollision, startReplay 516–518); `packages/sim-core/src/runner.ts` 21;
  `packages/collision/src/world.ts` 28/157; `docs/decisions.md` D15, D32, D34; `docs/measured-facts.md` §1–4.
