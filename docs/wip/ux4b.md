# Lane ux4b (train 4): cancel a scene that is loading

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part ux4b. Owner's words: brief lines 565-566 (complaint U2:
"I picked the wrong scene, I cannot cancel, I wait long for it and its walls; I want to cancel and pick another").

## Status

- [x] B-1 abort plumbing: apps/fly/src/app/scene-load.ts (LoadCancelled, abortable, LoadRun), SessionOptions.signal
      (session/index.ts), SessionLoader signal (session/loader.ts), bakeBase signal + BakeCancelledError (bake.ts),
      walls.ts one stop per session aborted on dispose. Test tools/bench/test/scene-load.test.ts (NEG OK). commit: B-1 (this commit)
- [x] B-2 UI and flow: ui/loading.ts Cancel button (Esc on the card), scene-host.ts LoadSlot/LoadRun (a pick or N
      during a load replaces it; Cancel opens the picker; closing it goes back), test-hook sceneSwitch state
      'cancelled', locales fly/load load.cancel, load.cancel.key, load.cancel.back, load.cancel.done; pure
      afterCancel() and LoadSlot in scene-load.ts + tests (NEG OK against B-1). commit: B-2 (this commit)
- [x] B-3 acceptance: tools/bench/scripts/ux4b-cancel-probe.mjs, 1536x730 dsf 1.25, mouse, steps 1-7 of the design
      plus step 8 (no page error while the list stands after a Cancel); local 8/8 PASS, live 8/8 FAIL (negative
      control). Found and fixed on the way: play/game-pilot.ts threw "reading 'armed'" every key frame with no model
      (test app-play.test.ts, NEG OK). commits b06260e2, 7ee93d1c, c5c40eaa, 3de17c1f, and this one.

Notes (design vs code):
- B-1: the design names bake.ts bakeBase "add signal if it lacks one": it had only a per-step stop for the time-out;
  an outer `signal` now also races the step, so a bake on the page (that cannot stop) is left at once too.
- B-1: walls state gains 'stopped' (the session went while its bake ran) so no failure line is set.
- B-2: afterCancel(why) takes no `from`: inside SceneHost there is always a scene left; the first page load is
  apps/fly/src/app/flight.ts (not owned) and gets no Cancel (see For the lead).
- B-2: the design's "busyNow no longer refuses" is LoadSlot (pure, tested): the last pick wins, the next load
  waits for the replaced one's `settled`, so two loads never share the renderer. SceneHost.busy now means only
  "the next scene is being chosen", so key N (app/builtin/rotation.ts checks scenes.busy) replaces a load.
- B-2: openPicker() during a load (the pause menu's Change scan) is the pilot's Cancel; Esc on the card is skipped
  while a #ui .panel or an open dialog is up (that one closes itself).
- B-2: a fourth key load.cancel.key ("key Esc") for the button's title, so the word 'key' stands before Esc.
- B-3: vox4 was not on origin/main when B-3 ran (origin/main a1f2a804), so the probe ran on this branch alone; the
  design says the no-leak check is re-run after the merge (see For the lead).
- B-3: ?render=off never downloads the scan, so steps 1-6 (a download is what is cancelled) run drawn; only step 7
  (844x390) uses ?render=off, with Lublin's requests held 8 s so the card stays up.
- B-3: Lublin 2f1ddf5f has no card in the local picker (the catalogue comes from the live proxy): locally the probe
  types its id in the list's field (a pilot's paste); on live it clicks the card.

## What the owner does

1. Flying a scene, he opens the scene list (pause menu, Change scan) and picks a scene by mistake. The small
   loading card shows its picture, the progress and a "Cancel" button from the first moment.
2. He clicks Cancel (or presses key Esc). The card goes at once, a line says "Loading stopped. Pick another scene,
   or close the list to go back.", and the scene list is open.
3. He picks another scene: it loads as any pick does. Or he closes the list with its cross (or key Esc): the scene
   he flew before loads again and a line says "Back to <its name>".
4. While a scene loads he presses key N or picks a scene again: the load stops at once and the new scene loads.

## Claims

1. Every await of a scene load (lookup, splats, walls, wind) rejects at once with LoadCancelled when the load's
   signal aborts, and the scene lookup and the walls downloads are fetched with that signal; a walls bake ends
   with its session without trying a lighter step. Proof: `npx vitest run tools/bench/test/scene-load.test.ts`
   (7 passed); negative control on origin/main's bake.ts, session/index.ts, session/loader.ts, walls.ts: NEG OK.

2. A pick or key N during a load cancels it at once ('replaced') and the new load starts only once the old one
   unwound; three quick picks: the last wins, the middle one never begins; Cancel stops the load under way at once
   (why 'pilot') and opens the scene list (afterCancel); a cancel is no failure (no recordFailure, no
   rotation.failed line, hook.sceneSwitch state 'cancelled'); the card has Cancel (data-action load-cancel, key
   Esc) in en, es, pl, ru. Proof: `npx vitest run tools/bench/test/scene-load.test.ts` (12 passed); negative
   control on B-1's scene-host.ts, loading.ts, scene-load.ts: NEG OK. Neighbours app-prefs, flight-ux,
   scene-scale-default: 64 passed.

3. The keyboard game pilot sends nothing and throws nothing while the session has no flight model (a scene switch,
   or the scene list after a Cancel); before, every key frame threw `Cannot read properties of undefined (reading 'armed')`
   (the live site: 337 during one load, 250 in 3 s on the list). Proof: `npx vitest run
   tools/bench/test/app-play.test.ts` (26 passed); negative control on origin/main's play/game-pilot.ts: NEG OK.

4. The pilot's path with the mouse at 1536x730, device scale 1.25 (pointer lock by a click into the scene): flying
   Wroclaw, key P, Change scan, Lublin: Cancel shows at once (78x44, in view, not covered); a click on it closes the
   card within 7 ms, the list is open, "Loading stopped..." is shown, hook state 'cancelled' why 'pilot'; from 1 s
   after, no request to Lublin's 5 CDN folders for 2 s; no Lublin asset, 0 gsplat entities, no bake; the list's
   cross (44x44) brings Wroclaw back in 7.8 s with "Back to ..."; Lublin again and key N while it loads: the next
   scene (39e63ce9) flies, no Lublin asset, 1 entity; at 844x390 Cancel is in view and not covered; no page error
   while the list stands after a Cancel. Proof: `node tools/bench/scripts/ux4b-cancel-probe.mjs
   http://localhost:6060/en evidence/2026-11-19/ux4b/cancel-local.json` (from tools/bench, local release of
   c5c40eaa's code, GPU lock): pass, 8 of 8. The same probe on https://gsfpv.flyreelstudio.eu/en
   (evidence/2026-11-19/ux4b/cancel-live.json): 8 of 8 FAIL (no Cancel; a pick and key N during a load are
   ignored; 337 + 250 page errors). Steps 3 and 4 fail there only because there is no Cancel to press.

5. The flight, the keys and the session still pass the acceptance: `cd tools/bench && SITE=http://localhost:6060
   npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16` (first line "accept-fly target:
   http://localhost:6060"): B6-B14 PASS in one run, B15 B16 PASS in a second run (the first was cut by its time-out
   during B15, see Cost notes); evidence evidence/2026-11-19/ux4b/b-fly-*.json (the summary is of the second run;
   its pictures in U:/Temp/gsfpv-train4/shots/ux4b-accept-fly, not looked at: the probe judges them).

6. The gates on the staged tree (gates.py --only typecheck,vitest,architecture,i18n,b18,leaks): typecheck,
   architecture, i18n PASS; vitest 5317 tests passed, but 3 files failed to start rooms.py within their wait under the
   load of 15 lanes (rooms-open-vote, rooms-race, rooms-socket; alone: 15 of 15 passed; this lane touches no rooms
   file); b18 failed on the word for an unset value in this file, fixed, b18 alone then PASS; leaks: one hit,
   MERGED_KEY = 'gsfpv.library.merged.v1' in scene-host.ts, a localStorage key name already on origin/main (false
   positive: the file is in this diff).

## Not verified

- No person, phone or real controller took part; every run was headless Chrome on this PC.
- Step 4 cancelled before Lublin's splat asset existed (0 assets before the click, at 2.5 s): a cancel after the
  asset was added, and a late engine 'load' after the cancel, are not exercised by this run. That leak guard is
  vox4's SplatLoadGuard (renderer.ts), not merged here; the design says the check is re-run after the merge.
- A cancel during a walls bake (no scene of the run baked: the shipped walls were in dist/walls) is proven only by
  the unit test (scene-load.test.ts: the bake ends with its session).
- The touch path (a phone's tap on Cancel) and Esc on the card in a real browser: only the 844x390 layout was checked.

## For the lead

Files changed outside the owned list: apps/fly/src/app/context.ts (one doc line: SceneSwitcher.busy now means
"the next scene is being chosen"; no type change); apps/fly/src/play/game-pilot.ts (B-3: `if (!sim) return` as
EasyPilot already has) and its test in tools/bench/test/app-play.test.ts.
Not done, not owned: the first page load (apps/fly/src/app/flight.ts) has no Cancel; its stall actions (Retry,
Pick another scan) stay as they were.
Deploy: page only (apps/fly). No API, rooms, nginx or sound package change.
After the merge with vox4: re-run `node tools/bench/scripts/ux4b-cancel-probe.mjs <local>/en <out>` (drawn, GPU
lock) and, if possible, with a later Cancel (the probe's sleep before the click, now 2.5 s) so the asset exists.
Live checks after deploy: the same probe against the live site must pass 8 of 8; accept-fly B6 B7 B9-B16.
Gates: the leaks gate flags scene-host.ts MERGED_KEY (a storage key name from origin/main, not a secret); the rooms
tests time out starting rooms.py under load and pass alone.

## Cost notes

- B-1: most replies went to reading the load path across five files; a design excerpt with the exact await lines
  would have saved three reads. neg_control.py needs the test command as one quoted string on Windows (npx).
- B-2: about 20 replies, most on the scene-host restructure (load vs runLoad, the failure path's nested back load
  would deadlock on its own run); writing tests with Edit, not a python one-liner, saved a failed round.
- B-3: about 35 replies; most went to finding the per-frame "armed" error (the probe first logged messages without
  stacks) and to a second build plus a second drawn run after the fix and after tightening step 6 (it passed on live
  without a load under way). Logging the error stack and requiring each step's precondition from the start would
  have saved one build and one drawn run. accept-fly takes the GPU lock itself: wrapped in the lock it waited on
  me until its `timeout` cut it (20 min lost); never wrap it.
