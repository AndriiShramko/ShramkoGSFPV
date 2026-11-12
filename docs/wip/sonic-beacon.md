---
type: lane
status: in work
summary: "Fly by Sound, beacon to the next target, stage 1: the target hum folded into the front half circle, an octave higher on course, pointing at the next track point where the goal has no gate (owner's complaint of 2026-11-10: no direction in the tunnels)."
created: 2026-11-12
---

# Lane sonic-beacon

Simulator branch `sonic-beacon` from `origin/main` 6f33594 (worktree `C:/dev/gsfpv-sonic-beacon`). Package branch `sonic-beacon` from its `main` b102ce6 (worktree `C:/dev/sonic-beacon`). Inputs (untracked, not committed): `gsfpv-v03/docs/wip/sonic-beacon-plan.md` (plan tied to code lines) and `in-direction-spec.md` (design, variant A).

## Status

### S1 setup and the package core
- [x] worktrees (`C:/dev/sonic-beacon` from package main b102ce6, `C:/dev/gsfpv-sonic-beacon` from origin/main 6f33594), package `pnpm install --frozen-lockfile` exit 0, this file
- [x] findings on the plan's open points (prefs in the session and replay, runner prefs, height code and a zone target, submodule pin): F1-F5 below
- [x] `src/cues/beacon.ts` (`beaconBearing`, `foldToFront`, `turnDeg`, `trackCorners`, `beaconPointIndex` for S2) with Node tests: package 5eb0a6e
- [x] preference `beacon`: contract comment (`SonicPrefs.beacon`), default true, `KEYS`/`ADDED_KEYS`/check in `src/prefs/prefs.ts`; `menu.setting.beacon` and `-what` in en, es, pl, ru; catalogue: package 5eb0a6e. Locale lint 0 problems (537 keys)
- [x] `targetVoice`: fold and on-course octave (+`scale.steps.length` steps through `note()`) under `prefs.beacon`: package 5eb0a6e. Test `test/beacon.test.ts` 28 of 28: beacon false = b102ce6's plan, hash of every frame, on 11 flights (4 new beacon flights + the 7 placement flights; fixture `test/fixtures/beacon-b102ce6.json` made by the planner of b102ce6 before the change); target 150 left sounds from 90 left; 0, 5, -5, 8 degrees an octave above 12; tempo, level, filter unchanged; turning on the spot never from behind. Negative control: with the old `planner.ts`, `prefs.ts`, `contract.ts` 10 of 28 fail (every behaviour test; the 18 that pass are the pure `beacon.ts` tests and the beacon-false equalities). Also run: typecheck 0; `elevation, prefs, locales, cues, named-sounds, session, replay, replay-v012, lessons, review, direction, i18n-format` all pass (161 + 201 + 23)

### S2 package: where the beacon points, preview, lessons, replay
- [ ] `SonicFrameInput.beacon?` (new optional field; `target` untouched); planner hums at `beacon ?? target`
- [ ] `runner.beaconTarget()`: the next track point (world checkpoints, else lesson checkpoints, else course gates), preferring the next corner or a point at least 6 m ahead
- [ ] `targetAfter()` in the goal tracker; preview note (about 0.4 s, about 10 dB under the gate note) from the folded direction after a gate
- [ ] `beacon` written into the session recording and used by the replay
- [ ] layer `target` on in the corridor, every tunnel lesson and every walls lesson with a track or checkpoint goal, as new lesson versions; old recordings replay as older-build; list of lessons still silent about direction

### S3 simulator
- [ ] submodule pinned to the package branch; `mode.ts` passes `runner.beaconTarget()`; setting `sonic-beacon` on the start screen; typecheck and the touched tests

### S4 listener and review
- [ ] proofs: side of the beacon, fold, on-course octave, no silence in a tunnel, hum audible over motor and room tone at 40 m (raise the hum's floor in beacon mode only if not); words check of the new lines
- [ ] notes for the lead before the merge

## Findings

- F1 prefs in the session and the replay: yes. `SonicPrefs` is the manifest's `settings` (`src/session/manifest.ts:66`, checked by `validatePrefs` at `:181`), and the replay hands it to its planner (`src/replay/rebuild.ts:111` `prefs: manifest.settings`, `src/replay/replay.ts:191`). So `prefs.beacon` is recorded and replayed with no new field, as soon as `validatePrefs` knows the key (decision 8 holds by construction). A recording made before this lane has no `beacon`, which reads as on.
- F2 what the replay compares: per frame the SET of cue ids (`src/replay/compare.ts:259-283`), not directions or pitches. Fold and the on-course octave keep the id `target.hum`, so they cannot change a replay verdict. What can: a new cue id (the preview note, S2) and the layer `target` switched on in a lesson (new `target.hum` frames): both are S2 matters (new lesson versions; the preview must not tip the cue share of an old recording under 95 %, or it must go out only in new lesson versions).
- F3 how the runner gets preferences: it does not get `SonicPrefs`; `RunnerOptions` (`src/lesson/runner.ts:224-258`) carries copies of single fields (`path`, `speechRate`). Stage 1 needs none in the runner: `beaconTarget()` can be computed always, and the planner alone decides by `prefs.beacon` whether to use it (beacon false: the planner reads `input.target` as today).
- F4 the height code and a zone target: `targetHeightM` (`src/cues/height.ts:62-65`) uses the target only when `isGate` (an `order` and a kind ring, square or cube-frame); a `zone` falls back to the band centre. A track point put into `target` would therefore move the height note to the band centre and change the shape layer (`shapeObject` reads `input.target`): the beacon goes into a new field `beacon`, `target` stays (decision 5 confirmed).
- F6 for S3: `SonicPrefs` got a new optional key `beacon`; the simulator's own prefs code (`packages/prefs`, the start screen) may keep its own key list or validation and must learn the key, or a stored `beacon: false` could be dropped.
- F5 submodule pin: `gsfpv` `origin/main` 6f33594 pins `packages/sonic-fpv` at b102ce6362ad, which is the package `main` b102ce6. Line numbers of the plan match this tree.

## Decisions

- D1 on course compares the azimuth only (left-right, within 8 degrees); elevation is the height note's job. A target straight above or below has no side and is never on course.
- D2 a target exactly behind (azimuth 180) folds to the right ear, so the fold never leaves a direction undecided; in flight it holds there for a frame at most.
- D3 a corner is the 3D turn of the way between neighbouring points (a climb or a dive of more than 20 degrees counts), since tunnels with gaps change height.
- D4 the glossary previews and lesson plays of `target.hum` and `target.off` go through the same fold and octave (they let the pilot hear what flying will sound like); with beacon false they are b102ce6's (flight `beacon-previews` in the fixture).
- D5 `v013Prefs` (the elevation test's v0.13 prefs) now sets `beacon: false`, since absent reads as on and v0.13 had no beacon.
- D6 the on-course octave is `scale.steps.length` scale steps through `note()` (5 in the pentatonic themes, exactly 12 semitones; clamped at the top of the scale like every other offset).

## Cost notes

- S1 (about 25 replies): most turns went into finding a way to prove "beacon false = today" (the placement-flight hash fixture of lane s13-elev was the template; reading `test/helpers/placement.ts` and `elevation.test.ts` first would have saved two rounds). Cheaper: the plan could name the fixture pattern and the files the defaults test pins (`test/prefs.test.ts`).
