# Lane fix3a (train 3): two findings of integration A

Worktree C:/dev/gsfpv-rooms, branch fix3a from origin/main ca5760fd. Submodule packages/sonic-fpv at 598a98f9.
Logs and JSON of the runs: U:/Temp/gsfpv-train3/fix3a/. Evidence for git: evidence/2026-11-15/fix3a/.

## Status

Stage X1-walls-store
- [x] release build of ca5760fd (dist without any dist/walls folder), server 5780 (5c1ef83e)
- [x] probe tools/bench/scripts/walls-store-probe.mjs: build by the page's own action (default: the walls box
      button; --start shiftg, --start url), reload, fresh tab; --reload-at in-use reloads at the first look that sees
      the walls in use (the integrator's way) (5c1ef83e)
- [x] measure: Tunis (has shipped walls, nothing to store), Wroclaw button, Wroclaw Shift+G with reload at in-use
- [x] cause (below, measured in part)
- [x] fix: apps/fly/src/wallcache.ts keepBuilt (key made again when missing, result ok/key/ms/bytes/error);
      apps/fly/src/walls.ts startKeep before queue() in runBase and runRefine, showKeep after endProgress (line
      adds bake.keeping when the write runs past 2 s, the owner's rule, and bake.notKept when it fails; mode 'off'
      keeps nothing and says nothing, as before); hook w.storing, w.lastStore; keys bake.keeping and bake.notKept in
      en, es, pl, ru. Unit test tools/bench/test/walls.test.ts (4 new, 23 passed); negative control with
      origin/main wallcache.ts: 3 failed by AssertionError; tsc apps/fly exit 0.
- [x] probe records w.storing and w.lastStore; exit 0 also needs the build's write ok and either at most 2 s
      (KEEP_NOTE_S, the owner's rule, not a measurement) or the line said "Keeping them in this browser" (0f27d294)
- [x] proof on Wroclaw 70b50d42, release build of 07cc5d41, server 5780, no dist/walls, both exit 0:
      button (evidence/2026-11-15/fix3a/walls-store-70b50d42-button-fixed.json): built 63 s, in use 74.3 s, store
      write 645 ms, 58294590 bytes, row there 74.8 s; reload: cache, bakes 0, in use 4.3 s after open; fresh tab:
      cache, bakes 0, 4.6 s. Shift+G with reload at in-use (...-shiftg-fixed.json): built 69 s, in use 81.4 s, write
      343 ms; reload cache 4.3 s, fresh tab cache 4.8 s, bakes 0. Both writes under 2 s, so the keeping note did not
      show (correct). gates.py --only vitest,architecture,i18n,b18: all PASS (vitest 162 s).
- Negative control of the probe on the old build: not run (budget). The old-build runs of the first pass passed
  too on a quiet PC; the probe's new 'kept' check fails on origin/main only because w.lastStore does not exist there.
- Seen, not fixed: at the in-use look the write was still running in both runs (storing true, rows 0): queue()
  swaps at once when the craft is parked, so the window is the write time itself (0.3 to 0.65 s measured). A reload
  inside that window may still lose the walls; the reload of the shiftg run came in that window and still found
  them (IndexedDB finished the transaction). A guess, not reproduced.
- Bake time was 63 to 69 s here against 156 s in the first pass (a lighter way, line "rough"; the machine's saved
  bake speed changes the plan). Not examined.

Stage 2 (gate 1 not in sight on Tunis seed 1): not started.

## Measured

Server: node tools/bench/scripts/serve-csp.mjs dist 5780, release of ca5760fd, no dist/walls folder at all.
- Tunis 887f27aa has shipped walls: the page opens with walls state 'none', source 'shipped' and stays so (probe
  log m1-tunis-button.log, 330 s). No base build is offered there, so built walls cannot be stored on Tunis; the
  store holds only refined walls there, and the plan on this PC offers no refine. The proof is Wroclaw only.
- Wroclaw 70b50d42, the walls box button (evidence/2026-11-15/fix3a/walls-store-70b50d42-button.json): ready 6.0 s,
  first state offer, cacheMiss absent, key input set (scan meta etag "509be231..."), cacheKind idb, quota 10296 MB;
  in use at 172.9 s (line "Walls built in 156 s"); the store row (58294590 bytes stored) was there at the first look
  after in-use; reload: source cache, bakes 0, in use 5.1 s after open; fresh tab: source cache, bakes 0, 7.5 s.
  Probe exit 0.
- Wroclaw, Shift+G, reload at in-use (walls-store-70b50d42-shiftg-reload-at-in-use.json): in use at 118.9 s, the
  store had NO row at the in-use look; the reload that followed still found it: reload cache 5.7 s, fresh tab cache
  6.5 s, bakes 0. Probe exit 0. The etag and the key were the same in all opens.

## Cause

- Measured: the walls go in use before the store write starts. apps/fly/src/walls.ts:416 queue() sets state
  'in-use' (onSwap, walls.ts:336), the line says built (walls.ts:423), and only then walls.ts:425 starts
  `void remember(...)`, a fire-and-forget IndexedDB write of 58.3 MB (wallcache.ts:222-224: data row, meta row,
  evict). Nothing waits for it and nothing shows it; a reload or a closed tab inside that window loses the walls.
- Guess, not reproduced: the integrator's reload came on the first 500 ms poll after in-use while the gates loaded
  the CPU (train3-lead.md: "Probes ran while the gates ran"), so the write had not finished. My two runs on a quiet PC
  did not lose it.
- Ruled out by measurement on the pilot's path: cacheKind memory (it is idb), an etag change (same in all opens), a
  null key input (set before the build).
- Not hit on the pilot's path but real (lead's reading): mode 'off' (walls.ts:588, only ?simradio / ?lat=1) and a
  failed size request (walls.ts:591-595) leave w.keyInput null, and remember() returns at once (walls.ts:367): such
  a build is never stored and nothing says so.

## Fix plan (left)

1. walls.ts runBase and runRefine: start the store write the moment the bake result exists (before queue and
   endProgress); hook fields w.storing (boolean) and w.lastStore {ok, key, ms, bytes, error} (test data, like
   lastBake) so the probe measures the write time.
2. Key missing at the end of a build: try sceneSize once more and make the key; still none, or put() threw: the
   walls line adds a new key bake.notKept in en, es, pl, ru ("The walls fly now, but this browser could not keep
   them: the next visit builds them again." and real translations).
3. If the measured write time is over 2 s: while it runs the line adds a short "keeping them in this browser" part
   (new key, four languages); the done line comes back when it ends.
4. Unit test of the order and the not-kept line (logic in a small pure helper if mountWalls is too heavy to test),
   negative control against origin/main, typecheck of apps/fly, a6-reference not needed (no flight code).
5. Probe: add a check that the store row exists within N s of in-use (N measured), rerun Wroclaw button and
   shiftg --reload-at in-use; evidence JSON; gates.py --only vitest,architecture,i18n,b18.

## Cost notes
- X1 first pass: most turns went to the first Tunis runs (no progress output, 560 s timeout each; Tunis has shipped
  walls, so nothing to build). A one-line check of walls.source before a long run would have saved two runs.
- X1 pass 2: a negative control by git checkout HEAD wiped an uncommitted edit (one turn lost) and a new walls line hit
  the plain-lines test (no "could not"); commit before any file swap, and grep tools/bench/test for rules on bake.* keys first.
