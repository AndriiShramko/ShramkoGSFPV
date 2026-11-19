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
- [ ] B-3 acceptance: tools/bench/scripts/ux4b-cancel-probe.mjs (after merging vox4), 1536x730 dsf 1.25, mouse,
      steps 1-7 of the design; live run as the negative control.

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

## Not verified

(filled at B-3)

## For the lead

Files changed outside the owned list: apps/fly/src/app/context.ts (one doc line: SceneSwitcher.busy now means
"the next scene is being chosen"; no type change).
Not done, not owned: the first page load (apps/fly/src/app/flight.ts) has no Cancel; its stall actions (Retry,
Pick another scan) stay as they were.

## Cost notes

- B-1: most replies went to reading the load path across five files; a design excerpt with the exact await lines
  would have saved three reads. neg_control.py needs the test command as one quoted string on Windows (npx).
- B-2: about 20 replies, most on the scene-host restructure (load vs runLoad, the failure path's nested back load
  would deadlock on its own run); writing tests with Edit, not a python one-liner, saved a failed round.
