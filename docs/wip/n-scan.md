# Lane n-scan: every SuperSplat scan opens, or says plainly why not

The owner's wish 5 of 2026-11-20 (C:/dev/.gsfpv-lanes/designs/t7-brief.md, Decision 5): the scan a39abad1 did not open;
every scan like it must open. Base: t7-base 03624451. Hand-over merged first: hot-sog3 d432c2d9 (engine playcanvas 2.24.2,
splat-transform 3.12.0, probe tools/bench/scripts/hot-sog3-scans.mjs, live check scans-open). The engine bump is not ours.

## Status

- [x] S1 the diagnosis (read, not repeated) and its reproduction in a unit test; the version check before loading. DONE in commit "n-scan S1" (after merge of hot-sog3 d432c2d9): render-pc lod.ts ENGINE_SOG_VERSIONS, sogVersionProblem, lodChunkVersionProblem, UnsupportedFormatError; renderer.ts loadSplat checks meta.json and the first chunk of lod-meta.json before the engine asset; scan-sog-version.test.ts 7 tests pass, render-pc 391 pass, typecheck passes, NEG OK (lod.ts at 03624451). The UnsupportedFormatError still reaches the picker as the generic engine text: its plain line is S3.
  S2 next: PLY (ContentKind 'ply': content.ts, renderer.ts isMeta/progress, bake.ts input), GSAF (index.ts:250 + formatVerdict), more kinds in superspl-kinds.json (a5d25fb4 PLY, c67edb74 PLY 163 MB, 5012e205 GSAF, 593f8c06 streamed v3 4 levels, 70b50d42 / 2f1ddf5f streamed v2, 5c0f892e 191 MB v2; record their CDN answers read-only with curl -sI into U:/Temp/gsfpv-train4/n-scan).
- [ ] S2 the kinds: superspl-kinds.json with one real id per storage kind; resolveScene and the loader open each kind (compressed PLY opens, GSAF named as unsupported); unit tests + NEG.
- [ ] S3 the device and the plain line: lighter LOD level or one plain line (too-large / gone / unknown-format / network) through ux4a's lines and ux4b's Cancel; zero splats drawn is an error; n-scan-errors.mjs (stubbed 404, stubbed huge scan, render off) + unit tests + NEG.
- [ ] S4 the acceptance: n-scan-accept.mjs by mouse at 1536x730 x1.25 on the local build (a39abad1 first) and against the live site (must FAIL a39abad1); one drawn picture; scans-open extended; gates once; "What the owner should try"; dist deleted.

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

(S4)

## Claims

(S4)

## Not verified

(S4) No person, phone or real controller took part in this lane's checks.

## For the lead

- packages/render-pc/src/renderer.ts (not an owned file; the diagnosis's Repair 1 names it): loadSplat calls the version
  checks of lod.ts before `new Asset` (import line and 6 lines in start()).

- packages/render-pc/test/scan-sog-version.test.ts lives in render-pc (the check it tests is render-pc's lod.ts), not under
  packages/scenes/test as the prompt's owned pattern says; it reads the scenes fixture by relative path.

## Cost notes
- S1: about 25 calls; most went to finding where the check belongs (renderer.ts vs scenes) and to neg_control needing `npx.cmd` on Windows (plain `npx` is not found by CreateProcess). Cheaper: the lane prompt could name renderer.ts as the check's place.
