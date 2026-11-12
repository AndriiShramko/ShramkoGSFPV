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
- [x] `SonicFrameInput.beacon?` (new optional field; `target` untouched); the planner hums at `input.beacon` when the beacon is on and the field is present, else at `target` (an older host or recording, or beacon false: as before): package 13e558d
- [x] `runner.beaconTarget()` (also optional `LessonRunner.beaconTarget?()` in the contract): `target()` when the goal has a gate or zone, else the next track point after the last passed one (world checkpoints, else lesson checkpoints, else course gates), the next corner or the first point at least 6 m ahead; where the line from the craft to it runs through a solid (corridor pillars) it steps back to a nearer track point (`beaconPointIndex(..., clear)`, `lineClear` in `src/cues/beacon.ts`): package 13e558d, c82a198
- [x] `GoalTracker.targetAfter?()` (pass-gates, timed-course: the gate after the next within the lap); the runner's gate cue event carries `nextDir` (listener frame) when there is one; the planner adds one hum note after the gate note: 0.4 s, 10 dB under it, from the folded direction, beacon on only. Cue id `target.hum` (no new id, decision D7): package 13e558d
- [x] the setting in the recording and the replay: `prefs.beacon` is in `manifest.settings` (F1); the replay now passes `beacon: runner.beaconTarget()` to its planner (`src/replay/replay.ts`), the test host too (`test/helpers/record.ts`, option `oldHost` for a host from before the lane): package 13e558d
- [x] layer `target` on in `corridor` (v2 to v3) and the six tunnels (`tunnel-wide`, `-narrow`, `-narrower`, `-bends`, `-long` v1 to v2, `tunnel-gaps` v2 to v3); `test/lessons.test.ts` version table updated; `named-sounds` and `silence-layers` green: package 13e558d
- [x] tests `test/beacon-target.test.ts` 10 of 10 (package c82a198, 08fd46c): every flying frame of the truth bot in the corridor and the six tunnels has a beacon, never through a solid (sampled every 0.1 m), at a corner, 6 m ahead, the last point or stepped back; gate and zone goals: beacon = target; planner reads `beacon`, ignores it with beacon off (plan identical); preview note numbers and fold, nothing with beacon off; an old tunnel recording (old host, no key, v1) replays `older-build`, an old `rings-course` recording `pass` (with the preview derived), beacon off and on both `pass`, the flipped setting `fail`. Negative control: on S1's `src` and `lessons` (5eb0a6e) 8 of 10 fail (the 2 that pass are the beacon-off equalities). Without the line-of-sight step back the corridor had 37 of 2147 frames through a pillar
- [x] whole package: typecheck 0; `pnpm test` 1251 of 1253. The 2 failures come from S1's two new lines (`menu.setting.beacon`, `-what`: 537 keys against 535 in the evidence): `test/words.test.ts` (evidence `VL-4-words.json`) and `test/lesson-schedule.test.ts` (TTS length fixtures `test/fixtures/tts-*.json`). They need `measure-tts.ps1` and `pnpm listen:words` with the GPU lock: moved to S4
- lessons still silent about direction (no track, no checkpoint goal; out of stage 1): `walls-hall` (approach-stop), `walls-pillar` (around a pillar), `walls-row` (fly-distance), `hover-height` (hold-height), `move-speed` (fly-distance, then a zone: the hum layer is off there), scans without a track file. The walls lessons have no world checkpoints, no lesson checkpoints and no gates

### Contract changes for S3 (package 13e558d, `src/contract.ts`)
1. `SonicFrameInput.beacon?: SonicObject | null` (new, optional). The simulator fills it in `mode.ts` (plan: `:209`) with `this.bridge.runner?.beaconTarget?.() ?? null`, next to `target`.
2. `LessonRunner.beaconTarget?(): SonicObject | null` (new, optional method; the package's runner has it).
3. `CueEvent` `{ kind: 'gate' }` got an optional `nextDir?: Vec3 | null`. The simulator only forwards the runner's cue actions; if it builds gate cue events itself anywhere, nothing breaks (the field is optional).
4. `SonicPrefs.beacon?: boolean` (from S1): the simulator's prefs code must keep the key (F6).
5. Lesson versions changed: `corridor` 3, `tunnel-gaps` 3, the other five tunnels 2. Any simulator test or fixture that pins these versions or the layer list of these lessons needs the new numbers.

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

- F7 (S2) the walls lessons (`walls-hall`, `walls-pillar`, `walls-row`) have neither a world track nor lesson checkpoints nor gates, so decision 6's "walls lessons with a track or a checkpoint goal" is none of them; their layers are unchanged.
- F8 (S2) the corridor's world track runs between pillars with turns under 20 degrees, so "the next corner or 6 m ahead" alone put the beacon behind a pillar in 37 of 2147 truth-bot frames; the tunnels had none.
- F9 (S2) the replay's cue comparison is by id sets per frame (F2); the hum voice is in every flying frame of a lesson with a target, so a hum note added after a gate changes no frame's set: an old `rings-course` recording still replays `pass`.

## Decisions

- D1 on course compares the azimuth only (left-right, within 8 degrees); elevation is the height note's job. A target straight above or below has no side and is never on course.
- D2 a target exactly behind (azimuth 180) folds to the right ear, so the fold never leaves a direction undecided; in flight it holds there for a frame at most.
- D3 a corner is the 3D turn of the way between neighbouring points (a climb or a dive of more than 20 degrees counts), since tunnels with gaps change height.
- D4 the glossary previews and lesson plays of `target.hum` and `target.off` go through the same fold and octave (they let the pilot hear what flying will sound like); with beacon false they are b102ce6's (flight `beacon-previews` in the fixture).
- D5 `v013Prefs` (the elevation test's v0.13 prefs) now sets `beacon: false`, since absent reads as on and v0.13 had no beacon.
- D6 the on-course octave is `scale.steps.length` scale steps through `note()` (5 in the pentatonic themes, exactly 12 semitones; clamped at the top of the scale like every other offset).

- D7 (S2) the preview after a gate is a note of the hum itself (cue id `target.hum`, the hum's timbre and note), not a new sound: no new cue id to name in the glossary and in the first lesson of each path, no new versions of the rings and shapes lessons, and old recordings of those lessons still replay `pass` (F9). Heard as "the hum, once, from where the target after the next one is".
- D8 (S2) the line-of-sight step back (`lineClear`, every 0.1 m, an estimate) uses the world's `sdf` when it has one (analytic worlds); a scan world without `sdf` gets the corner/6 m rule only.
- D9 (S2) between attempts the track beacon points at the track's first candidate from the craft (as `target()` keeps the first target sounding, M41-10); `passedPoint` is used only while flying.
- D10 (S2) the beacon object for a track point is a `zone` 1 x 1 x 1 m with `order: null`, id `beacon:<point id>`; it is never put into `target`, so the height note and the shape layer are unchanged (F4).

## Cost notes

- S1 (about 25 replies): most turns went into finding a way to prove "beacon false = today" (the placement-flight hash fixture of lane s13-elev was the template; reading `test/helpers/placement.ts` and `elevation.test.ts` first would have saved two rounds). Cheaper: the plan could name the fixture pattern and the files the defaults test pins (`test/prefs.test.ts`).
- S2 (about 40 replies): most turns went into the replay side (how recordings are made and compared, how to make an "old" recording) and into the corridor's pillars found by the through-wall check. Cheaper: the plan could have said that replay compares cue id sets only (so a hum note keeps old recordings green) and that `RecordingHost` is the recording fixture maker; a probe of each lesson's track source up front (one vitest file writing to a file, since vitest swallows console output here) saved a round.
