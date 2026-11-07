# v0.12 lane v12-flight: Fly by Sound in the flight loop

Plan: `docs/wip/v12-plan.md`, section 4.2 (sections 8 and 9 override earlier text). The sound package is the git submodule `packages/sonic-fpv`: read its `docs/design/stage-1-spec.md` (section 13 overrides the sections above it), its `AGENTS.md` and `src/contract.ts` before using it. How this repository is worked on: the gsfpv skill (gates, headless browser runs, `SITE` not `BASE`, B18, locales, determinism).

Worktree `C:/dev/gsfpv-v12-flight`, branch `v12-flight`, cut from `v03-lead` a1ea872 (lead step 0: the submodule, the seams, the five keys). Depends on: step 0 (done) and sonic-core `main` 3959930.

## Owns

`apps/fly/src/sonic/**`, `apps/fly/src/play/**`, `apps/fly/src/controls.ts`, `apps/fly/src/session/**`, `apps/fly/src/audio/**`, `apps/fly/src/app/{input,flight,boot}.ts`, `apps/fly/src/app/builtin/{sonic-flight,gpu-hint,sound}.ts`, `apps/fly/public/sonic/**`, `packages/collision/**`, `packages/render-pc/**`, `packages/prefs/**` except `keymap.ts`, `packages/i18n/locales/fly/{sonic,gpuhint}/**`, `tools/bench/{src,test}/sonic-*`. Dictionary key prefixes: `sonic.*`, `gpuhint.*` (the feedback lane has `sonicrec.*`, `admin.sessions.*`; the lead has `keys.sonic.*`).

Not yours: `features.ts`, `context.ts`, `sonic-context.ts` and `keymap.ts` (the seams are in place: the three feature stubs, `ctx.sonic`, the `sonicSample` and `sonicEvent` events, the keys T U I Z G with their labels), `packages/sonic-fpv`, `C:/dev/ShramkoSonicFPV`, and every other worktree.

## Rules

- Commit locally, one commit per step, with the Status line of that step ticked in the same commit. Never push, deploy, SSH or log in to the live admin.
- Never edit the submodule or `C:/dev/ShramkoSonicFPV`. A change needed there goes under "Needs from sonic-core" below (reason and a failing test) and you work around it with a local adapter.
- Every hook you add is a no-op while the sound mode is off, so ordinary flight is unchanged: `tools/bench/test/a6-reference.test.ts` keeps its hash at default settings.
- A step runs only the checks its change touches, plus a negative control where it proves something; the lead runs every gate once before release. Browser runs are headless through `tools/bench/src/chrome.mjs` and hold `C:/dev/.gpu-lock` when they draw; local site checks use `SITE=http://localhost:<port>`. Long logs go to files.
- Texts for people only in `packages/i18n/locales/**` (en, es, pl, ru); Cyrillic or Polish letters outside locales fail B18 (write `\uXXXX` in tests).
- Every number you report is measured or labelled an estimate. How a sound feels cannot be judged by an agent: say so.
- Replay markers (plan section 9.5): the host emits a `lesson open` event, `key` events with the action `reset.checkpoint`, `reset.start` or `next`, and a `speech` event with the key `speech.end` whenever it calls `runner.spoken(t)`; it passes `say.interrupt` to speech and sends `setLayers({ on: [] })` when frames stop. Emit them as `sonicEvent`; the feedback lane records them.

## Status

- [x] 1 Built-in world: `analyticCollision` in `packages/collision`, `SessionOptions.world`, `apps/fly/src/sonic/lesson-world.ts`, tests `tools/bench/test/sonic-world.test.ts`
  - A voxel is solid where the world's `solidAt` says at its centre; 8^3-voxel cells are decided by the distance when no surface can cross them (1-Lipschitz), the others keep a bit mask; `AnalyticContactWorld` answers an overlap test "free" from the distance kept at the cell's centre. Exact: 20 000 voxels per world agree with `solidAt` in 7 lesson worlds (control: a distance that lies is caught), and a flight's 22 147 contact queries give the same answers on all three lookups.
  - `SessionOptions.world` (`BuiltinWorld`): no `resolveScene`, nothing drawn, walls named by the world digest, the lesson's start as the spawn; the session refuses a rescale, walls off, the floater filter, a ceiling and other walls while it flies one. `fly()` takes it (`FlyOptions.world`) and skips `recordOpen` and `scene_loaded`.
  - Measured (vitest, this PC, best of 5, queries of the flight replayed under one timer): a 10 s hall flight along and into a wall 15.3 to 16.0 ms (cells only 13.1 to 14.6, no cull 21.3 to 27.5); in the open 4.2 to 4.8 ms (cells only 8.9 to 11.6, no cull 19.6 to 26.0). Under the plan's 20 ms in both.
  - Touches: a hall wall within 1.5 mm of the distance function's surface, a pillar and a ring within half a voxel diagonal (control: walls 0.3 m off are caught). A lesson life with bumps and an R replays to its hash on walls rebuilt from the spec and on the plain contact world (controls: another world's digest is refused, the same log on other walls replays apart).
  - Found on the way: the game scheme's voxel ground probe (`play/ground.ts`, a 10 m sphere's cover test) costs 1.4 to 1.8 ms median per call on these walls; a ray of the world costs 0.006 ms. The lesson pilot (step 4) reads the ground with a ray.
- [x] 2 Bridge `apps/fly/src/sonic/bridge.ts`: `FlightSample` per frame, tick hook on `Runner.onStep`, touch debounce, `sonicSample` and `sonicEvent`
  - `SonicBridge` over a small view of the session (`BridgeSession`), output through `BridgeOut` (the page wires it to `ctx.events` 'sonicSample' and 'sonicEvent' in step 5). Samples: the shown model's state, t = whole ms of the mode clock since `start()` (runs on through pauses), tick the model's; `paused` while paused or replaying, with 'session' pause and resume events (the recorder writes start, end, recovered).
  - Touches: the tick hook on `Runner.onStep` (chained, given back on `stop()`, moved by `follow()` to each new runner: a new scene, a new flight model) reads the tick's own contacts; a contact after 500 ticks of quiet begins a touch; a respawn ends the quiet. With a lesson runner the runner writes the 'touch' event from `touched`; without one the bridge writes it by the runner's rule (six axis rays, speed, position).
  - Markers (plan 9.5): `begin(runner)` sends the runner's 'lesson open'; `key()`, `resetTo()` and `next()` send 'key' events with the package's `REPLAY_KEY_ACTIONS`, then the runner's events; `spoken()` sends the `speech.end` marker, then `runner.spoken(t)`'s events; `say()` passes `interrupt` and counts the queue; `silence()` sends `setLayers` with no layer when the frames stop (pause, playback, stop; the page adds a hidden tab).
  - Tests `tools/bench/test/sonic-bridge.test.ts`, 12: off does nothing (control: on does), samples mirror the model, debounce (control: 0.6 s apart are separate touches), the hook follows runners and chains, silence and speech queue, and walls-hall recorded through the bridge with N, R short, R long and a contact passes the package's `checkSession` (controls: without the speech.end markers, or without the key events, it fails); with the real `FlightSession` in a lesson world the model's contacts give touched samples and a rebuilt flight model gets the hook.
- [ ] 3 Scan world `apps/fly/src/sonic/scan-world.ts` and bench `tools/bench/src/sonic-rays.ts` (Winter Garden x5, 30 rays per sample, p95 under 1 ms)
- [ ] 4 Lesson pilot: `controls.ts` hook and forced mode, `play/lesson-pilot.ts`, numeric caps in `game.ts`, installed by `app/input.ts`
- [ ] 5 `app/builtin/sonic-flight.ts`: soft bump, easy play, touch ping and count, R short and long resets, N next step, [ ] locked
- [ ] 6 Primitives `apps/fly/src/sonic/primitives.ts`: own root, box, cylinder, torus, dark background, gates through the transform
- [ ] 7 Engine in the page: AudioContext from the start gesture, `ctx.sonic`, motor sound through `auxInput` and off by default, captions, screen-reader switch, `sonic` prefs collection
- [ ] 8 Entry and accessible start: `?sonic=` in `boot.ts`, classified in `url.ts`, the start screen outside `#ui`, keyboard-only headless run
- [ ] 9 Lesson worlds wired: the first lesson of each module passed end to end by a scripted pilot
- [ ] 10 Winter Garden: x5 in the mode, `apps/fly/public/sonic/tracks/7a475d38-rings-v1.json`, `tools/bench/src/sonic-track-check.ts`, lesson 7 timed
- [ ] 11 GPU hint: rule, truth-table tests with controls, feature, texts
- [ ] 12 Lane end: release build, `accept-fly` B6 B7 B9-B16 with `SITE` on the local build, a6-reference, Status

## Needs from sonic-core

None yet. Format: the change, the reason, and the failing test that proves it.

## Notes

Risks named in the plan (4.2): the built-in world path sits in every scan load (regression B6-B16); the assist hook sits in every pilot's input path; analytic `isVoxelSolid` inside 1 kHz sweeps; Winter Garden's 16 cm cells at x5; a hidden tab disarms (the gate), so AutoArm must re-arm; a radio pilot still needs one key press before any sound.
