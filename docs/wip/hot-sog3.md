# hot-sog3: open SuperSplat scans in SOG version 3 (engine bump)

Design: C:/dev/.gsfpv-lanes/designs/t7-scene-open.md (Repair, smallest change). Owner's words: the lane prompt (2026-11-20).

## Status

- [x] S1 the bump (f0e84dce): playcanvas 2.23.2 -> 2.24.2 (packages/render-pc/package.json, apps/fly/package.json), @playcanvas/splat-transform 3.6.4 -> 3.12.0 (apps/fly/package.json), lock with one engine (`pnpm why playcanvas`), typecheck and the gates without a browser, repairs of what the new engine breaks, the "unsupported SOG version" error mapped to the plain unsupported-format line if it is a few lines.
- [x] S2 the proof on the whole app (hot-sog3-scans.mjs a-e): a 7/7, b pass but B15 (fails the same on the old build), c pass, d pass (a39abad1 bakes; 98f74d54 stops cleanly, as slow on the old library), e pass. No repair of code was needed.
- [ ] S3 the hand-over: DONE live check scans-open (e8768aac) with its live negative control (fails for the five v3 ids); the sections below; merge 66448801 (docs only). THEN origin/main moved: train 4 car 2 (267923c3) merged in a963cbca, 148 code files (apps/fly, apps/api, tools/bench), NO change of any package.json or pnpm-lock.yaml (the lock still holds one engine 2.24.2, no 2.23.2). Conflicts only in evidence/2026-11-20/b-fly*: car 2 wrote accept-fly evidence under the same names; main's files kept, ours moved to evidence/2026-11-20/hot-sog3/. Submodule synced to 53a56759.
  LEFT for the next run (in this order): `pnpm install --frozen-lockfile`; `pnpm -r typecheck`; `pnpm vitest run` (log to temp); kill the servers (pids in U:/Temp/gsfpv-train4/hot-sog3/serve7000.pid, serve7001.pid), `node scripts/build-release.mjs`, serve-csp on 7000; repeat S2 a) (`bash U:/Temp/gsfpv-train4/hot-sog3/run-a.sh` or the scans-open line of deploy/live-checks.sh against localhost:7000) and b) (`bash run-bcde.sh b`; car 2 repaired B15 for the late start, 89b2203f, so it should pass now). `git fetch` once more; then write U:/Temp/gsfpv-train4/hot-sog3.json (.tmp + rename): sha = the head, api [], rooms false, nginx false, package_sha "", live_only "scans-open,walls-published-probe,pause-rise-lublin", held [].

- S2 a) DONE (run 5, 2026-11-20 22:40 CEST). The probe of run 4 failed every id, v2 too: it opened the page without  and stayed on the first-visit warning (repair a0, the URL of walls-published-probe.mjs). New build (dist/, sha c17d5ddd, port 7000): 7/7 PASS (U:/Temp/gsfpv-train4/hot-sog3/scans-new.json): f924b0f5 999606 splats drawn, 78 % of pixels lit, 41 s; 593f8c06 623310, 100 %, 21 s; a39abad1 996301, 99 %, 33 s; 28ad27ed 993627, 79 %, 38 s; 98f74d54 206179, 100 %, 10 s; 143e76b0 300000, 15 %, 10 s; 70b50d42 152391, 100 %, 11 s; no console error, no CSP report. Pictures U:/Temp/gsfpv-train4/shots/hot-sog3-<id>.png. Negative control: a SECOND BUILD of origin/main a59bd3db (old/, port 7001; origin/main d72fe5f8 differs only in docs/wip/train4-lead.md and one more note), MAXS=120: every v3 id FAILS as the design says (f924b0f5, 593f8c06: status ready, 0 splats drawn = black scene; a39abad1, 28ad27ed, 98f74d54: status loading forever), the v2 ids 143e76b0 and 70b50d42 PASS (scans-old.json; pictures hot-sog3-old-<id>.png).
Where run 5 stopped (2026-11-20 ~23:30 CEST, limit-reserve hook at 97 %, reset 2026-11-21 03:30 CEST; this note is UNCOMMITTED, commit it first). Committed: e8768aac live check scans-open in deploy/live-checks.sh (S3 item 1 written; its negative control is still to be read).
- b) accept-fly on port 7000 (log U:/Temp/gsfpv-train4/hot-sog3/b-fly.log, first line "accept-fly target: http://localhost:7000"): B6 B7 B9-B14 B16 PASS, B15 FAIL: only its LSB control did not fire (tamperedValue -1, differs false). The flight is bit-identical to 11-13..11-19 (crash at the same place, speed 8.5656, 5631 records) but started ~15 400 ticks later (flip at 21073, earlier ~5700), so at tick 10000 the drone still sat at throttle -1 and one LSB there changes nothing: a bench timing artefact, not physics (sim-core does not use the engine). Failed evidence kept in hot-sog3/b15-run1-fail.json. A B15 rerun was started in the background (log b15-rerun.log, EXIT line at the end): read it. If it fails the same way, run B15 on the OLD build (SITE=http://localhost:7001) to show it is not the bump; if it fails there too, record it under For the lead (B15_TICK=10000 assumes the scenario starts before tick ~5700).
- c) PASS: walls-published-probe.mjs on 2f1ddf5f (Lublin, 20 cm walls) and 70b50d42 (Wroclaw, 10 cm): published walls, no bake, tunnelSelfTest 20 passes 0 penetrations, no error (c-walls.json).
- d) NOT DONE: walls-store-probe.mjs --start url on 98f74d54 stopped after 29.8 s with the bake still running ("Step 3 of 3 ... still working", d-bake.json). The probe's wait for 'in-use' is short (read walls-store-probe.mjs lines 62-90 for its limit); rerun with a longer wait or read hook.walls until state in-use/error. Also check: apps/fly/src/bake.ts:11 BAKE_TOOL is still the string 'splat-transform@3.6.4' while the library is 3.12.0; find whether it feeds a store key or the published walls version before changing it (if it does, leave it and note it for n-scan).
- e) PASS (run 6 read it): loadq-probe.mjs on 70b50d42, GOV=0, SECS=60, three runs per build, samples 10 s or more after reveal (44 each). Median frame time new 2.6 / 2.6 / 2.5 ms, old 2.6 / 2.5 / 2.5 ms; p90 17.6-17.7 ms on both. No rise over 5 %. The new engine draws more splats in the same view (median 336 650-399 016 against 296 077) at the same frame time. No errors.
- Live negative control of scans-open DONE (run 6 read it): on https://gsfpv.flyreelstudio.eu it FAILS as it must: f924b0f5, 593f8c06 "status ready, splats drawn 0"; a39abad1, 28ad27ed, 98f74d54 "status loading" for 120 s; 143e76b0 and 70b50d42 PASS (U:/Temp/gsfpv-train4/hot-sog3/live-neg/scans-open.json).
- b) DONE. B15 rerun on the new build: FAIL again the same way (b15-rerun.log). B15 on the OLD build (origin/main, port 7001, first line "accept-fly target: http://localhost:7001"): FAIL the same way (flip at tick 25625, crash at the same speed 8.565648919042033 as the new build's flight; evidence kept outside the repo in U:/Temp/gsfpv-train4/hot-sog3/b15-old-evidence/, as it is not this build). So B15's failure is not the bump: its LSB control at tick 10000 assumes the flight starts earlier than it does on this machine today (For the lead). evidence/2026-11-20/ holds the new build's b) run (B6 B7 B9-B14 B16 pass).
- d) run 6, diagnostic bake-diag.mjs (temp only, logs the bake hook): 98f74d54 reaches Step 3 (voxelise) and stops after the step limit of 180 s (BakeTimeoutError "build step stopped", the plain line "The walls did not come out this time"): a clean end, no hang. The v3 read is sound: splat-transform 3.12 in Node decodes 98f74d54 to 206 179 rows, core 135 x 49 x 112 m (6e9 cells at 5 cm; 143e76b0 has 1.6e7). The owner's scan a39abad1 (v3) BAKES TO THE END on the new build: 995 801 Gaussians, 18 030 687 solid voxels, read 1.2 s, voxelise 2.2 s, walls in use (d2-a39.json). A/B of the voxeliser in Node on the same PLY (RTX 4090): 3.6.4 and 3.12.0 write a BYTE-IDENTICAL voxel.bin (48.6 MB), voxelise 19.8 s and 18.6 s. So BAKE_TOOL (apps/fly/src/bake.ts:11, part of the walls store key in wallcache.ts:67) stays 'splat-transform@3.6.4': the output is the same, a new key would only throw away the walls pilots keep. Full-data A/B (voxel-ab.sh, all 206 K rows with the floaters out to 125 m, no crop): BOTH libraries run past 900 s and are stopped (3.6.4 exit 124, 3.12.0 exit 124). So 98f74d54 is slow to voxelise because of its extent, with either library: not a regression of the bump (before it, the scan did not even open). d) DONE: the bake of a v3 scan runs to its end (a39abad1 walls in use; 98f74d54 ends cleanly at the step limit). Left to n-scan: walls of very large v3 scans.
- Next (older note): b-e by U:/Temp/gsfpv-train4/hot-sog3/run-bcde.sh [b|c|d|e] (logs b-fly.log, c-walls.*, d-bake.*, e-ft/ and e-<port>-<i>.log). Servers: serve-csp port 7000 (new) and 7001 (old), pids in serve7000.pid / serve7001.pid.

Where run 1 stopped (2026-11-20, stopped by the limit-reserve hook at 86 % of the 5-hour window, before its reset at 16:30 UTC):
- UNCOMMITTED in the tree: the three version lines are already edited in apps/fly/package.json and packages/render-pc/package.json (check with `git diff`). pnpm-lock.yaml is NOT updated yet.
- `git submodule update --init` was run (packages/sonic-fpv at 293ebaea, the pinned commit); without it pnpm install fails with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND.
- `pnpm install` then failed: the downloads of playcanvas-2.24.2.tgz, splat-transform-3.12.0.tgz and webgpu-0.6.2.tgz from registry.npmjs.org ended with "error (23)" and a timeout (log U:/Temp/gsfpv-train4/hot-sog3/install.log). Suspect a write error of the pnpm store on the full disk C (97 %), or the network. Next run: check `df -h /c`, `pnpm store path`, then retry `pnpm install` (if the store is the problem, `--store-dir` on U: is NOT allowed to change the lock; try freeing nothing outside the copy: ask nothing, retry once, then record it under For the lead).
- Nothing was typechecked, built or committed yet.

Run 3 (2026-11-20): the hang of runs 2 and 3 was pnpm 11.5.0 itself: `--config.fetch-timeout=600000` reaches the fetcher as a string and `AbortSignal.timeout` throws ERR_INVALID_ARG_TYPE, swallowed, so install waits forever with no socket open. `pnpm install --network-concurrency=2 --fetch-timeout=900000` (typed flag) finished in 2 min 7 s. `pnpm why playcanvas`: "Found 1 version of playcanvas" (2.24.2, used by fly, render-pc, splat-transform 3.12.0 and supersplat-viewer 1.35.0). `pnpm -r typecheck` passes with no code change: the new engine's types break nothing in our code. Gates vitest, architecture, i18n, b18, leaks: only packages/render-pc/test/lod.test.ts failed (2 cases): engine 2.24 rebuilds the LOD tree (gsplat-lod-tree.js) and no longer throws on a level without a file index or a level that is a number; it loads wrong data instead. Our check lodMetaProblem still refuses both, so the cases moved from ENGINE_THROWS to ENGINE_OPENS_BUT_BROKEN and the negative-control count went 8 -> 7 (33/33 pass). No source change was needed.

Where run 2 stopped (2026-11-20, stopped again by the limit-reserve hook at 99 % of the 5-hour window):
- Disk C has 14 GB free (98 %), so the store is not the cause. The network works but is slow: curl fetched playcanvas-2.24.2.tgz (13.3 MB) in 55 s. splat-transform 3.12.0 depends on webgpu 0.6.2 (137 MB unpacked) and @adobe/spz 0.3.1, so the install is a big download.
- Retried `pnpm install --config.fetch-timeout=600000` in the background (log U:/Temp/gsfpv-train4/hot-sog3/install2.log; the line `EXIT <code>` appears when it ends). After 20 min it still showed "resolved 17, reused 15, downloaded 0". Next run: read the log tail first. If there is no EXIT line, kill the pnpm node process and retry once with `--reporter=ndjson` to see which request hangs.
- Decision, the "unsupported SOG version" mapping: NOT done here. The only plain line is `scenes.unsupported` ("stored in SuperSplat's older PLY format"), so a newer SOG version shown with it would be a false message. A correct line needs a new key in en/es/pl/ru, so it is left to lane n-scan. On 2.24.2 the engine rejects a future version (sog.js:84-88) and does not hang, so a v4 scan gets the generic error line, not an endless loader. A clean way to add it: a typed UnsupportedFormatError in render-pc lod.ts beside BrokenFileError, thrown by renderer.ts loadSplat's asset error handler; `unsupported?` in ContentAttempt (scenes index.ts:40); noContentError maps it to 'unsupported'; a test in packages/scenes/test/content-error.test.ts.

## Deploy order

1. The web release only: `node scripts/build-release.mjs` on this head, publish dist/ as every web release.
2. No API file (apps/api unchanged), no rooms, no nginx: the new engine needs no new line of the content security
   policy. Every S2 check ran under the enforced policy of deploy/nginx.conf (tools/bench/scripts/serve-csp.mjs) with
   no CSP report, the walls bake of the v3 scan a39abad1 included (splat-transform's webp.wasm as before).
3. After the release: the live checks below.

## Live checks

- `LIVE_ONLY=scans-open bash deploy/live-checks.sh <out>`: the new check (deploy/live-checks.sh, "run scans-open").
  It opens f924b0f5, 593f8c06 (streamed v3), a39abad1 (the owner's), 28ad27ed, 98f74d54 (single v3), 143e76b0, 70b50d42 (v2)
  and passes when each is ready, drawn (splats drawn over zero, over 5 % of the picture lit), with no console error and no CSP report.
  Negative control on the live site on 2026-11-21 (old engine 2.23.2): FAIL for all five v3 ids (a39abad1 "status loading" for 120 s),
  PASS for the two v2 ids. After the release it must pass 7/7.
- `walls-published-probe` (Wroclaw 70b50d42 and two more: published walls, the tunnel self-test) and `pause-rise-lublin`
  (Lublin 2f1ddf5f streams, pauses, rises): our own scenes still load and fly.

## What the owner should try

1. Open https://gsfpv.flyreelstudio.eu/en/fly/?scene=a39abad1: the scan appears (about 30 s on a first visit) and you fly it.
2. Press the walls button (or open it with ?bake=1): the walls build in a few seconds and crashes are on.
3. Open Lublin from the catalogue and fly a minute: it looks and flies as before.

## Not verified

- Real devices: phones, tablets, a weak laptop and Safari were not tried; every check ran headless Chrome on the RTX 4090 desktop.
- The other 60 of the 65 v3 scans of the design's list: only the seven ids above were opened.
- The walls of 98f74d54: the bake reads it and stops cleanly at the step limit of 180 s ("The walls did not come out this time");
  it is a large outdoor core (135 x 49 x 112 m) and the OLD library is just as slow on its data (see Status d). Not a regression: before the
  bump the scan did not open at all. For lane n-scan.
- The plain line for a future SOG version (v4): the engine 2.24.2 refuses it with an error (no endless loader), shown with
  the generic error line; a dedicated line needs a new locale key and is left to n-scan (Status, run 2 decision).

## For the lead

- Run 1 used the submodule init in this copy (read-only use of packages/sonic-fpv, no edit).
- B15 (accept-fly): see Status b. Its LSB control assumes the flight starts before tick 10000; on this machine it started later.

## Cost notes

- S2/S3 run 6: about 35 replies. Most went to d): the probe of the store does not show the bake's error, so a diagnostic page probe, a Node reader and a CLI A/B were needed; the two 900 s runs of the full-data A/B were waiting time. Cheaper: walls-store-probe.mjs could record w.lastBake (the error) in its JSON; the CLI A/B (same PLY through both library versions) answers "is the new library different" in one minute and should come first.

- S1 run 3: about 20 replies, most of them the pnpm hang (pnpm 11 string fetch-timeout bug). Cheaper: use the typed flag --fetch-timeout=N from the start.
- S1 run 1: 8 replies, ended by the limit-reserve hook; the reading of the three docs was the cost. Cheaper: the next run reads only this file and the Repair part of the design.
