# Lane ux4b (train 4): cancel a scene that is loading

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part ux4b. Owner's words: brief lines 565-566 (complaint U2:
"I picked the wrong scene, I cannot cancel, I wait long for it and its walls; I want to cancel and pick another").

## Status

- [x] B-1 abort plumbing: apps/fly/src/app/scene-load.ts (LoadCancelled, abortable, LoadRun), SessionOptions.signal
      (session/index.ts), SessionLoader signal (session/loader.ts), bakeBase signal + BakeCancelledError (bake.ts),
      walls.ts one stop per session aborted on dispose. Test tools/bench/test/scene-load.test.ts (NEG OK). commit: B-1 (this commit)
- [ ] B-2 UI and flow: ui/loading.ts Cancel button (Esc on the card), scene-host.ts LoadRun (a pick or N during a
      load replaces it; Cancel opens the picker; closing it goes back), test-hook sceneSwitch state 'cancelled',
      locales fly/load load.cancel, load.cancel.back, load.cancel.done; pure afterCancel() in scene-load.ts + test.
- [ ] B-3 acceptance: tools/bench/scripts/ux4b-cancel-probe.mjs (after merging vox4), 1536x730 dsf 1.25, mouse,
      steps 1-7 of the design; live run as the negative control.

Notes (design vs code):
- B-1: the design names bake.ts bakeBase "add signal if it lacks one": it had only a per-step stop for the time-out;
  an outer `signal` now also races the step, so a bake on the page (that cannot stop) is left at once too.
- B-1: walls state gains 'stopped' (the session went while its bake ran) so no failure line is set.

## What the owner does

(B-2)

## Claims

1. Every await of a scene load (lookup, splats, walls, wind) rejects at once with LoadCancelled when the load's
   signal aborts, and the scene lookup and the walls downloads are fetched with that signal; a walls bake ends
   with its session without trying a lighter step. Proof: `npx vitest run tools/bench/test/scene-load.test.ts`
   (7 passed); negative control on origin/main's bake.ts, session/index.ts, session/loader.ts, walls.ts: NEG OK.

## Not verified

(filled at B-3)

## For the lead

Files changed outside the owned list: none so far.

## Cost notes

- B-1: most replies went to reading the load path across five files; a design excerpt with the exact await lines
  would have saved three reads. neg_control.py needs the test command as one quoted string on Windows (npx).
