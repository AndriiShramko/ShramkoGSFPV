# Agent map: entry points of the simulator and Fly by Sound

Names, not line numbers. Paths are relative to the repo root; `pkg/` is `packages/sonic-fpv` (the ShramkoSonicFPV repo, never edited here).

## 1. Where a frame goes

Input to physics:
- Devices: `apps/fly/src/devices/hid.ts` `HidSource`, `gamepad.ts` `GamepadSource`, `keyboard.ts` `KeyboardSource`, `touch.ts` `TouchSticks`, `fakehid.ts` (probe device), `reconnect.ts` `findSavedHid`/`findSavedGamepad`, `known.ts` `choiceOffer`.
- `apps/fly/src/controls.ts` `Controls`: `raw(f)` (profile mapping + arm latch, radio/gamepad), `channels(ch, t)` (touch, keyboard, sim radio), `toggleArm()` (Space, on-screen ARM), private `push()` -> `fill()` (forced or pilot mode on ch[5]) -> `assist` -> `gate.update` (`ArmGate`, `packages/input/src/calib.ts`) -> `session.input(out, t)`. `restartGate()` when the arm channel changes owner.
- `Controls.assist` users (only these): `app/input.ts` `InputHost.setLesson` (installs `LessonPilot.apply`) and `InputHost.installStyle` (installs `CentrePilot.apply` for hid/gamepad in the 'centred' style); `play/lesson-pilot.ts`, `play/centre-pilot.ts` (comments). Lesson wins: `installStyle` returns while a lesson runs.
- `apps/fly/src/app/input.ts` `InputHost`: `start`, `use`, `openRadio`, `setPlay` (prefs input.play), `setLesson(assists|null)` (null resets the centre pilot, reinstalls the style, restarts the gate if motors are off), `setThrottleStyle`/`settleStyle` (a style change waits for disarm), getters `throttleStyle`, `centrePilot`, `lessonPilot`.
- Throttle style resolution: `app/builtin/throttle-style.ts` (calls `settleStyle` every frame, `ctx.hook.throttle`).
- Pilots: `play/easy.ts` `EasyPilot` (touch, easy play), `play/game-pilot.ts` `GamePilot` (keyboard+mouse) which owns `play/game.ts` `GameAssist` (velocity loop, height hold); `play/lesson-pilot.ts` `LessonPilot` (also owns a `GameAssist`); `play/centre-pilot.ts` `CentrePilot` (composes a `LessonPilot`, field `pilot`, built by `centreAssists`). Key tables for flying: `play/keys.ts` `GAME_KEYS`, `MODE2_KEYS`.
- Physics: `apps/fly/src/session/index.ts` `FlightSession.input` -> `packages/sim-core/src/runner.ts` `Runner` (1 kHz fixed step, input log, trace hash) -> `sim.ts` `Sim`. Assists are input: the log holds post-assist channels; replay never runs an assist.

Physics to sound (only on a `?sonic=` page):
- `apps/fly/src/sonic/feature.ts` `installSonicFlight`: on ctx event 'frame', `mode.frame(now)` then `host.frame(sample)` if a lesson is active, else `mode.hear(sample)`.
- `sonic/mode.ts` `SonicMode.frame` (R long press, `bridge.frame()` sample, touches), `SonicMode.hear(sample, input?)` -> `bridge.engine.update(...)` with target and `beacon`; `hearCost()` times it.
- `sonic/lessons.ts` `LessonHost.frame(sample)`: `runner.step` -> `bridge.events` -> `drain`/`act` -> builds the input (`run.demoFrame` or sample+world+target+beacon) -> `mode.hear`. This, not mode.ts, is the lesson frame.
- `sonic/bridge.ts` `SonicBridge` (samples, touches, replay markers, silence), page audio `sonic/audio.ts` `SonicAudio`.
- Package: `pkg/src/cues/planner.ts` `CuePlanner` (pure, replay re-derives it), engine `pkg/src/audio/engine.ts` `FlyBySoundEngine` / `createSonicEngine`.

## 2. Who builds each screen

Builtins are registered in `apps/fly/src/app/features.ts`.
- Controls screen + calibration wizard + check screen: `ui/radio.ts` `RadioScreen` (`open`, `mount(new CalibrationWizard)`, `checkPanel`, `openSwitches`); opened by `InputHost.openRadio` (and `app/test-modes.ts`). Rows inside it: `ui/throttle-style-row.ts` `throttleStyleRow`, `ui/mode-switch-row.ts`, `ui/known-panel.ts`, `ui/usb-look-block.ts`, `ui/switches.ts` `SwitchesView`, `ui/device-rate.ts`. Its report button calls `openFeedback`.
- How-to-fly / key card: `ui/controls-card.ts` `buildHowToFlyCard` (+ `controls-card-logic.ts`), builtin `app/builtin/how-to-fly.ts`.
- HUD and arm card: `ui/hud.ts` `Hud` (owns `ArmOffer` from `ui/arm-offer-logic.ts`), built in `app/flight.ts`; builtin `app/builtin/hud.ts`.
- Mode chip: `ui/mode-chip.ts` `ModeChip`, builtin `app/builtin/modes.ts` (`radioSwitch`).
- Pause menu: `ui/pause.ts` `pauseMenu`, driven by `app/menu.ts` `PauseMenu` (made in `app/flight.ts`).
- Summary: `ui/summary.ts` (`summaryText`, `modeChip`, `throttleChip`, `keysBlock`), builtin `app/builtin/summary.ts`.
- Settings: `ui/settings/screen.ts` `SettingsScreen` (+ `data.ts`, `model.ts`, `editors.ts`), builtin `app/builtin/settings.ts` `openSettings`.
- Report form: `app/builtin/feedback.ts` `openFeedback(ctx, kind, o)`.
- Fly by Sound start screen: `sonic/start-screen.ts` `StartScreen` (sections `startSection`, `headphonesSection`, `lessonsSection`, `settingsSection` = the settings list, `change(patch)` saves SonicPrefs), built by `sonic/start.ts` `startSonic`; model `sonic/start-model.ts`. Lesson menu: `sonic/lesson-menu.ts` `LessonMenu`. Panels: `sonic/look-panels.ts` `installAttitude`, `installSoundPanel`.
- Recorder / replay panel: `apps/fly/src/sonic-session/` (`recorder.ts` `Recorder`, `replay-control.ts` `ReplayControl`, `panel.ts`).

## 3. Settings and keys

- Settings schema: `packages/prefs/src/defs/*.ts` (one file per group, `defs/index.ts`), `schema.ts`, `migrate.ts`. Sound-mode prefs are the package's `SonicPrefs` (`pkg/src/prefs`), saved by `sonic/store.ts`.
- Keys: `packages/prefs/src/keymap.ts` `KEYMAP` (`when`: flight | crash | always | sonic), `keymapProblems`, `FLYING_CODES`; page router `apps/fly/src/app/keys.ts`. Sound-mode letters in KEYMAP: T U I Z G X (`when: 'sonic'`), J = `throttle.style` (always). N and B are read in `sonic/mode.ts` itself.
- Pinned tables: `packages/prefs/test/defs.test.ts` (`V03_SHIPPED` and later lists: add a shipped setting there), `packages/prefs/test/keymap.test.ts` (`DESIGN_TABLE`: add a key there), `tools/bench/test/app-keys.test.ts`, `tools/bench/test/sonic-start-screen.test.ts` (start screen settings count, now 16, and "Item n of 16" lines).
- New setting: defs file + label `set.<id>` in all four fly locales + defs.test list. New key: KEYMAP + `keys.*` label + keymap.test.
- Catalogue: `node --import tsx scripts/gen-catalog.ts` (writes stale outputs; `--check` is the CI gate). Writes `apps/site/src/generated/features.json`, `docs/settings.md`, README block `settings:start/end`, `llms.txt`, `apps/site/public/llms.txt`, `packages/i18n/locales/site/<lang>.json` (`tune.count.*`, `tune.adv` only). Only the lead runs it; vitest reads the committed files (`packages/prefs/test/catalogue-committed.ts`).

## 4. Text for people

- Simulator: `packages/i18n/locales/fly/<lang>.json` plus one folder per namespace `locales/fly/<ns>/<lang>.json` (sonic, sonickeys, sonicrec, throttle, usb, ...), merged by `apps/fly/src/i18n.ts`. Also `locales/{admin,bot,mail,scenepage,site}`.
- Parity: `packages/i18n/test/fly-parity.test.ts` (same keys and placeholders in en/es/pl/ru, a key in one file only), `admin-parity`, `api-parity`; site `apps/site/scripts/i18n-check.mjs`.
- Package: `pkg/locales/{en,es,pl,ru}.json`, keys in `pkg/src/i18n/catalog.ts`, `pkg/test/locales.test.ts`; page lines for the engine `sonic/host-lines.ts`.
- B18 (`tools/bench/src/accept-repo.ts`): no Cyrillic or Polish letters in any tracked text file outside a `locales/` path (docs/wip included), and no placeholder words in prose of .md/.txt (see the placeholder regex in accept-repo.ts; it also matches the JS keyword for a missing value and double braces, so do not write those words outside code).

## 5. Test recipes

- Flight over a floor with real `Controls` and `Sim`: `tools/bench/test/app-centre-throttle.test.ts` (`Rig`: stub globals, dynamic import of `apps/fly/src/controls`, `new Sim(params(...), new FloorWorld())` from `tools/bench/test/game-loop.ts`, fake session object).
- Fake DOM: `tools/bench/test/helpers/fake-dom.ts` `fakeDocument`, `FakeElement`; `vi.stubGlobal('document', fakeDocument())`; examples `app-hud-knobs.test.ts`, `app-centre-throttle-ui.test.ts`, `app-usb-look.test.ts`.
- Wizard to the check screen: `runHuman(() => new CalibrationWizard('k','n',device), newWizardAdapter(), idealHuman('AETR', ...), 180000)` from `packages/input/src/sim/human.ts`; expect `o.kind === 'correct'`, then `w.state.profile`. Samples: `packages/input/test/throttle-style.test.ts`, `end-snap.test.ts`, `hid-layout.test.ts` (DJI).
- InputHost with a fake flight context: the lesson precedence test in `app-centre-throttle.test.ts` (no sonic rig needed).
- New setting keeps the old plan bit for bit: `pkg/test/helpers/placement.ts` (`flyPlacement`, `placementHashes`, `v013Prefs`) against `pkg/test/fixtures/placement-v013.json`; sample `pkg/test/elevation.test.ts`.
- Flight log replay: `Runner` logs `gsfpv-input-log/3`; `replay(sim, log, endTick)` returns the trace hash; a model change that changes traces bumps `SIM_CORE_VERSION` (`packages/sim-core/src/index.ts`) so old logs refuse.
- Sound recording replay: `sonic-session/replay-check.ts` `checkPackage`, verdict `replay-control.ts` `recordingVerdict` from the package's `replayVerdict` (`pkg/src/replay/compare.ts`): pass = re-derives; older-build = fails and every lesson-version/theme-version note is recorded lower than here; fail = anything else (a changed world under the same lesson version is fail). Old recordings go stale by a lesson or theme version bump or a generator change (generators are versioned, `pkg/src/world/generators.ts`). Missing host markers (lesson open, key, speech.end, pause/resume) fail on times. Tests: `tools/bench/test/sonicrec-replay.test.ts`, `sonicrec-replay-page.ts`.
- Listener (package): `pnpm listen` and `pnpm listen:words` take the GPU lock themselves (`GPU_LOCK`, default `C:/dev/.gpu-lock`); `pnpm proof:audio` takes it only if the lock's parent folder exists. Listen needs `SHRAMKO_LISTEN_PY`, `SHRAMKO_LISTEN_CACHE`.
- Page probes (`tools/bench`): `src/sonic-int-review.ts <r1..r9>` (own server on dist, `SITE=` for live), `src/accept-fly.ts` (`SITE`, default the live site; BASE is refused), `src/sonic-v13-page.ts`, `scripts/hid-source-probe.mjs <base with /en> <outDir> [runs]`, `scripts/centre-throttle-probe.mjs <base with /en> <out.json> [runs|all] [scene]`, `scripts/wizard-auto-check.mjs <base> <shotsDir>` (lead ran it on /en). Build first: `node scripts/build-release.mjs` (sonic-int-review reads `dist/release.json`).

## 6. Page hooks (`window.__gsfpv`, `apps/fly/src/app/test-hook.ts` `hook`)

- Shell fields: status, label, flight, endTick, hash, records, prefs, error, errorCode, loading, session, scenario, controls, radio, fake, touch, crash, info, lastCrash, events (last 500 runner events), savedLogs, saveLog, verifyLastLog, loops, bake, bakedBytes, runBake, downloadBaked, walls, wallsSwitch, voxels, trajectoryText, governor, lod, setFrameDelay, drawing, importDiff, cinema, scenes, sceneSwitch.
- Set by features via `ctx.hook.*`: touch, radio, throttle, play, sound, stats, statsSaved, share, wind, scale, ceiling, crosshair, floaters, howToFly, gpuHint, lastCrash, sceneDefault, sharedSettings, videoExport, voxels, wallsSwitch, drawing, importDiff, cinema; sonic pages: sonicRays, sonicLink, sonicPanels, `sonic(withEvents)`.
- `__gsfpv.sonic()` returns lesson, phase, attempt, touches, passed, asking, question, engine, target, hum (target.hum cues of the last plan: dir, distance, hz), beacon, cost, walls, craft state, speechQueue, lastLine, stagePrims, progress, panel, menu, events.

## 7. Traps

- Scene 39e63ce9 has something over the spawn: every climb stops about 0.29 m up. Height probes fly 887f27aa (`center-throttle.md`).
- Start screen settings count changes with every sound setting: update `sonic-start-screen.test.ts`; `sonic-v13-page.ts` reads N from "Item 1 of N".
- The corridor lesson intro is longer since the beacon lane: R9 waits up to 150 s for the flying phase.
- `setLesson(null)` restarts the arm gate when motors are off: a switch left on must be flipped again after a lesson.
- Locale files: Write refuses a file not read this session; read it first. Bash heredocs with quotes broke edits twice; use Edit/Write.
- Probes only pass on the final pin: run page probes on the merged tree before handing over (two stale probes cost the release lead).
- Under load the replay comparer once found one frame beyond its slack (sonic-keys R5); the hook's `cueMismatches` names it.
- `pkg/tools/*.ts` do not run under plain Node: use `node tools/run-tool.mjs <tool>`.
- Never edit `packages/sonic-fpv` here; change the package repo, then move the pin.

## Not found

- A single gates runner with `--only` (named in the lead note) was not located in `scripts/`; B18 itself is `tools/bench/src/accept-repo.ts`.
- No pnpm script for the catalogue; only the `node --import tsx` command.
- No throttle-style switch on the Fly by Sound start screen (center-throttle added no sound setting).
- The exact base path wizard-auto-check expects (default has no /en); not confirmed in code.
