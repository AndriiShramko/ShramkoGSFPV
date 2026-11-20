# hot-sog3: open SuperSplat scans in SOG version 3 (engine bump)

Design: C:/dev/.gsfpv-lanes/designs/t7-scene-open.md (Repair, smallest change). Owner's words: the lane prompt (2026-11-20).

## Status

- [x] S1 the bump (f0e84dce): playcanvas 2.23.2 -> 2.24.2 (packages/render-pc/package.json, apps/fly/package.json), @playcanvas/splat-transform 3.6.4 -> 3.12.0 (apps/fly/package.json), lock with one engine (`pnpm why playcanvas`), typecheck and the gates without a browser, repairs of what the new engine breaks, the "unsupported SOG version" error mapped to the plain unsupported-format line if it is a few lines.
- [ ] S2 the proof on the whole app (hot-sog3-scans.mjs a-e).
- [ ] S3 the hand-over (live check scans-open, merge origin/main, this file, U:/Temp/gsfpv-train4/hot-sog3.json).

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

Not written yet (S3).

## Live checks

Not written yet (S3).

## What the owner should try

Not written yet (S3).

## Not verified

Everything so far: the bump is not installed.

## For the lead

- Run 1 used the submodule init in this copy (read-only use of packages/sonic-fpv, no edit).

## Cost notes

- S1 run 3: about 20 replies, most of them the pnpm hang (pnpm 11 string fetch-timeout bug). Cheaper: use the typed flag --fetch-timeout=N from the start.
- S1 run 1: 8 replies, ended by the limit-reserve hook; the reading of the three docs was the cost. Cheaper: the next run reads only this file and the Repair part of the design.
