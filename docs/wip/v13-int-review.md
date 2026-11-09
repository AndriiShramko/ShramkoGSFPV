# v0.13 review of v13-int (independent review, wave 2 as it will ship)

Reviewer: one agent, one pass over the simulator diff `cb67b0d..v13-int` (head `c324225`: v13-host, v13-look and v13-int's own
commits) and the sound package's `512d7d2..ecb2ffb` in `C:/dev/sonic-s13-int` (branch `s13-int`). Nothing fixed here: the next agent
fixes. Every finding was confirmed by a probe (a Node test kept outside the commit and deleted, a page run on a local release build, or
an exact reading of the code path with the inputs that reach it). What a sound or a voice feels like to a person is not judged here:
the probes read what the engine was asked to say, what reached `speechSynthesis.speak` and what the code does.

## Status

- [x] Read: the lane docs' final status and open items (v13-host, v13-look, v13-int), the plan; the diff by area (lessons, feature,
  lesson menu, start screen, spoken list, mode, bridge, key names, store, prefs doc, progress panel, look panels, attitude display
  geometry, sound panel kinds, session lesson flight, sim-core bump, analytic collision shortcut, assists, lesson pilot, replay player,
  replay control, frames, locales of the new keys); the package's engine reset, planner reset, contract.
- [x] Seven findings, each confirmed (F1 to F4 major, F5 and F6 minor, F7 a nit); the refuted claims; what was not read.
- [x] Node probes: a temporary vitest file on the lesson rig (`tools/bench/test/zz-review-probe.test.ts`, deleted, never committed)
  for F1 (with its control) and F3.
- [x] Page probes on a local release build of the head (`dist/release.json` sha c54d8d9 = `c324225` + this file, sound package
  ecb2ffb; `serve-csp.mjs dist 5461`; headless system Chrome 156.0.8078.80; the GPU lock held by the probe): the start screen over a
  running lesson and the lesson keys (P1), where the focus goes when it closes (P2), the lesson menu's cut lines with the browser's real
  voice (P3 and its control), the progress panel during a replay (P4), "Sound from above and below" live and at start (P5), B at the
  path's first lesson (P6). The probe script was a temporary `tools/bench/src/zz-review-page.ts` (deleted, never committed); its raw
  output stayed in the session's temporary folder, the numbers that matter are written below. Afterwards the server was stopped, the
  build outputs (`dist`, `dist.tgz`, `SHA256SUMS`, `apps/fly/dist`, `apps/site/out`) removed from C:, the lock free.

## Findings

### F1 (major) Lines of the lesson cut by the lesson menu are never said: Escape early in a lesson loses its task

- Where: `apps/fly/src/sonic/lesson-menu.ts:112` (`open()` says `sonic.say.menuOpen` with interrupt) with `apps/fly/src/sonic/bridge.ts`
  `pauseState` (the resume reports the end of speech once the queue is empty, `bridge.ts:329`) and `say()` (`bridge.ts:465`: an interrupt ends every
  queued line). A lesson hands its title, the keys line and the first part of its task to the voice at once; the menu's first line cuts
  all of them; at the resume the runner hears one end of speech and goes on to its next part. The lines that were cut are never handed
  to the voice again.
- Failure: a blind pilot hears "Hold your height. Escape: menu. Z: repeat the task. N: next.", presses Escape (the line just invited
  it), hears the menu, presses Escape again: the lesson goes on with intro.3 ("About once a second, a short note marks the best
  height...") and the goal. The two lines that say what the height tone means (`lesson.hover-height.intro.1` "Now you fly, but
  gently. The drone levels itself, so you only choose height..." and `intro.2` "The tone you hear is your height. A higher tone means
  higher up...") were never said. Nothing tells him he missed them.
- Probe: a vitest probe on the lesson rig (the real flight model, mode, bridge, host and the package's runner; the fake engine queues
  lines like `speechSynthesis` and an interrupt ends the queue), hover-height opened, the lesson menu built as `feature.ts` builds it
  (the page's pause stack, `syncPause`), Escape at 1.5 s, Escape at 1.7 s, then 120 s of lesson until the first attempt flies. The
  engine's schedule replayed: title said whole, `sonic.say.lessonKeys` cut while being said, `intro.1` (due at 4.6 s) and `intro.2` (due
  at 10.4 s) never started, and neither handed to the voice again after the menu; the lesson then said `intro.3` at 30.4 s, the goal at
  48.0 s and "Go." at 50.7 s. Control, the same run without the menu: all six lines said whole, `intro.3` at 41.5 s.
- Page probe P3 (the release, the browser's own voice at speed 1, every utterance's `start`, `end` and `error` events recorded):
  hover-height opened from its start screen button, Escape 1.2 s after the keys line was handed, Escape 0.3 s later. "Hold your
  height" started and ended with `error: interrupted` at 1.22 s; the keys line, `intro.1` and `intro.2` were handed once (before the
  menu) and never started; none of them was handed again; `intro.3` started at 45.0 s, the goal at 63.3 s, "Go." at 66.5 s. Control
  (same page, no menu): all of them started (the keys line at 1.65 s, `intro.1` at 8.6 s, `intro.2` at 16.1 s). Seen on the way: the
  menu's own lines run on after the menu is closed: "Lesson menu. The up and down arrows move..." spoke from 1.27 to 8.77 s and
  "Resume. Item 1 of 8." from 8.83 to 12.02 s, though the menu closed at about 1.7 s; the lesson waited for them (its next part came
  only after its queue ran empty).
- Fix suggestion: the lesson's speech is not the menu's to drop. Either (a) the bridge keeps the lesson lines it handed and that did not
  end (it already counts them per run) and hands them again at the resume, before it reports the end of speech; or (b) at the resume
  after a pause that cut the lesson's speech, the runner repeats the current part of its task (the package's `repeat` already knows the
  step's lines) instead of taking the cut as its end. The same cut happens under K (`help.keys`, the first line interrupts) and the
  start screen opened over a lesson; I and Z cut too, but Z says the task again by design. A Node test: the probe above with the menu
  must say `intro.1` and `intro.2` after the resume; its control (no menu) passes today. Closing the menu (Escape, Resume) should also
  cut the menu's own lines that are still queued (one interrupting nothing-line, or the bridge's cut of the menu's run).

### F2 (major) On the start screen opened over a lesson, N, B and Z still move the lesson under it; two B open another lesson

- Where: the mode's handlers have no "screen up" guard (`apps/fly/src/sonic/mode.ts:139` N, `:152` B, `:156` Z; also G in
  `apps/fly/src/sonic/feature.ts:386`), the start screen takes only its own keys (`apps/fly/src/sonic/start-screen.ts:115`: the list's
  arrows, Enter, Escape) and lets every other key go on to the page's key router, which routes to the last handler of the action
  (`apps/fly/src/app/keys.ts` `run`), and nothing blocks the router while the screen is up (only `.screen.radio` does,
  `apps/fly/src/app/flight.ts:87`). New in v0.13: B was the feedback form's key there, guarded by `dialogOpen()` (it did nothing over the
  screen); now it is the lesson's `previous`; Z now says the whole task; and two of the lesson menu's items (Lesson list, Sound settings)
  lead to this screen over the flight. The lesson menu itself takes every key (its capture listener), so the screen is the hole.
- Failure: a blind pilot in rings-first opens the lesson menu, Sound settings, and presses B ("back", the key he was taught): the lesson
  goes back to its task behind the screen and says it over the settings list; a second B leaves rings-first and opens tunnel-long (the
  lesson before it on the full path) behind the screen, whose title, keys line and whole task are spoken over the list; N starts its
  first attempt. The screen stays up with the focus on "Settings" all the while; Escape then puts him in tunnel-long's flight, not in his
  lesson. Each move is written to a recording as a key, so a recording replays it, but the pilot never chose it.
- Page probe P1 (the release, keyboard only): rings-first flown to its first attempt (`phase` flying), Escape, six Downs, Enter: the
  screen shown, the focus on the settings' h2, the flight paused. B: events `key previous`, `speech lesson.rings-first.title`,
  `intro.1`; phase flying -> intro; the voice was given "Your first ring" and "Now the ring. A low hum comes from the middle of the
  ring...". B again: `key previous`, `lesson leave rings-first`, `lesson open tunnel-long`, its title, the keys line, intro.1 to 3 and
  the goal handed to the voice; `lesson` = tunnel-long. Z: tunnel-long's task again. N: `attempt-start tunnel-long`, "Go.", phase flying.
  After each key the screen was still shown and the focus still on "Settings". Escape: the screen closed on tunnel-long, flying.
  Control in the same page: with the lesson menu up, B wrote no event and the phase stayed flying.
- Fix suggestion: while the start screen is shown over a flight, the lesson's keys are not the lesson's: either the mode's N, B, Z (and
  G, R) handlers take `when: () => !dialogOpen()` (the router then gives the key to the handler before, which is guarded), or the
  screen, while shown, stops every key it does not use in its capture listener (as the lesson menu and the survey do), keeping only
  the browser's own shortcuts and Tab. A page or Node test: the screen over a running lesson, B, N, Z, G: no `key` event, no lesson
  event, no line handed to the voice; control: the same keys with the screen hidden move the lesson.

### F3 (major) B at the first step of the path's first lesson leaves a dead lesson behind the start screen

- Where: `apps/fly/src/sonic/lessons.ts:493-495` (`go('previous')` with no lesson before: `showMenu()`, the runner that left is kept as
  `this.runner`) and `:474-476` (the same for `advance()` with no lesson after: N from the last lesson of the path that was not passed);
  `apps/fly/src/sonic/feature.ts:308-311` (`onClose` restarts a lesson only after a progress reset). The package's runner, once it has
  left, ignores every key (`byKey`: `if (!this.began || this.left) return this.drain()`), and its phase stays what it was.
- Failure: a new blind pilot starts the course (ears-headphones, lesson 1 of 28), tries B in its first step: the start screen opens
  (its name is said). He presses Escape to go back to his lesson: the flight page is back, but the lesson is dead. N, B and Z write their
  key events and nothing happens; the lesson menu's Repeat the task, Next step, Previous step and Next lesson do nothing; nothing is
  said. The progress panel still shows "Lesson 1 of 28, Step 1 of 4", as if the lesson ran. Only the lesson menu's Lesson list (or
  Leave the mode) gets him out. The same by the same code (exact reading): N from the path's last lesson that was not passed (`advance()`
  with no lesson after), and the menu's Next lesson there.
- Page probe P6 (the release, keyboard only): ears-headphones opened, B 1.5 s in: the start screen shown; Escape: the screen hidden,
  the lesson ears-headphones, phase `intro`, the panel "Headphone check / Lesson 1 of 28 / Step 1 of 4" (and the focus on the body,
  F4 again). Then N, Z, and the lesson menu's Next lesson (Escape, four Downs, Enter) over about 10 s: the events were `key next`,
  `key repeat`, the menu's pause, its six lines, its resume and `key next-lesson`; no lesson event; the voice was given only the menu's
  lines; phase still `intro`, lesson still ears-headphones.
- Probe: a vitest probe on the lesson rig: `lessonPaths().full[0]` (ears-headphones) opened, 0.8 s, B (`feedback.open`): `showMenu`
  called once, `host.active` true, phase `intro`; the screen's close as `onClose` does it (`restartAfterReset()`: false); then N, Z, B,
  the menu's Next lesson and Repeat the task over 29 s of lesson time: the mode wrote the five `key` events (next, repeat, previous,
  next-lesson, repeat) and nothing else: no lesson event, no line handed to the engine; phase still `intro`, lesson still
  ears-headphones.
- Fix suggestion: a runner that has left must not stay the host's lesson: when `go`/`advance` ends at the start screen, close the
  lesson (`close()`, the mode off, the panels hidden) or keep the old lesson only to restart it from its beginning when the screen is
  closed (as `restartAfterReset` does for a reset). Or the runner's `previous` in the path's first lesson says that there is no lesson
  before and stays. A Node test: B at the path's first lesson's first step, the screen closed, N: a lesson event or a line follows.

### F4 (major) When the start screen closes over a flight, the focus is left on the page's body, not on the flight's region

- Where: `apps/fly/src/sonic/feature.ts:283-286` `closeMenu()`: `screen.hide()` sets `hidden` and `inert` on the screen
  (`apps/fly/src/sonic/start-screen.ts:725`), then `focusFlight()` (`feature.ts:266-271`) returns early because
  `document.activeElement` is still the screen's focused control at that moment (the browser moves the focus off a hidden element
  only at its next rendering step), and the 'pause' event of the resume calls it under the same condition. The code is v0.12's, but in
  v0.13 the lesson menu's Lesson list and Sound settings send the pilot to this screen and back.
- Failure: the region with `role="application"` exists so that a screen reader in browse mode passes the flight's single-letter keys on
  (review R5, `feature.ts:254-258`). After Sound settings and Escape the focus is on the body: by that design note, a pilot whose own
  screen reader speaks then has N, B, Z, I, K and the arrows taken by the reader's quick keys until something moves the focus (not tried
  with a real NVDA or JAWS here).
- Page probe P2 (the release, the same page as P1): Escape on the screen over the flight: `document.activeElement` was BODY 0.1 s and
  1.1 s later (`hiddenScreen` true, not in the screen). Control in the same page: the lesson menu closed with Escape: the focus on
  `[data-testid="sonic-flight"]` (the region), because the menu removes its node (the focus leaves it at once).
- Fix suggestion: in `closeMenu()` blur the focused element of the screen (or move the focus to the region directly) before
  `focusFlight()`, or let `hide()` take the focus off itself; a page check: after Escape on the screen the active element is
  `sonic-flight`.

### F5 (minor) During a replay the progress panel shows the live lesson, not the flight being replayed

- Where: `apps/fly/src/sonic/feature.ts:326-331` (`followProgress` draws `h.runner.view()` whenever the mode is on; nothing hides it in
  playback); the attitude display hides in playback (`look-panels.ts` `!mode.inPlayback`), the sound panel shows the replay's sounds.
- Failure: a helper (or a low-vision pilot) replays a recording of rings-first while hover-height runs: the large panel in the left of
  the view says "Hold your height, Lesson 6 of 28, Step 2 of 2, Attempt 1, Counted 0 of 3" over the replayed rings-first flight, next to
  the sound panel showing rings-first's sounds.
- Page probe P4 (the release): hover-height flown to its first attempt, the recorder's "Open a recording file" with the package's
  `session-v012-rings-first.zip`, played 4 s (player `playing`, lesson rings-first, frame 105 of 643): the progress panel visible
  (`display: block`, 229 x 198 at 12, 273) with exactly the live text above; the attitude display `hidden`.
- Fix suggestion: hide the progress panel while `mode.inPlayback` (or draw the replayed lesson's view, which the player's runner has);
  a page check during F1's replay: the panel hidden or naming rings-first. The sound panel's "played three times" card reads the live
  runner's `view().playing` too (`look-panels.ts` `installSoundPanel`), the same seam.

### F6 (minor) The attitude display's horizon is the craft body's, not the camera's: with the default drone they differ by 20 degrees

- Where: `apps/fly/src/sonic/look-panels.ts` `installAttitude` (`pitchDeg: a.pitch`, sim-core's body attitude) and
  `apps/fly/src/sonic/attitude.ts` `horizonOf`; the view's camera is the body tilted up by the drone's camera uptilt
  (`apps/fly/src/session/index.ts:861` `setPose(..., this.cameraUptiltDeg)`, `packages/render-pc/src/renderer.ts:801-804` "tilted up by the
  FPV camera uptilt"). The lane's claim "the horizon is the one the craft's camera sees" was checked with a camera looking along the
  body's -z with no uptilt (`tools/bench/test/sonic-panels.test.ts:79-80`), and the page proof measured the display's own picture.
- Failure: the default drone (`pavo20pro-3s`, `camera_uptilt_deg` 20; every preset has 10 to 35) hovering level in a lesson: the
  display draws the horizon through its centre (pitch 0), while in the view the world's level lies 20 degrees below the view's centre; at
  cruise with the nose 20 degrees down the display shows a horizon lifted by 20 degrees of marks while the view looks level. A low-vision
  pilot comparing the two sees them disagree (the rooms of the analytic lessons show walls, not an open horizon; the scan lesson flies a
  real place).
- Probe: exact reading of the code path above with the default preset's input (uptilt 20 from `packages/sim-core/presets/pavo20pro-3s.json`;
  the mode sets no camera of its own, `MODE_PREFS` in `mode.ts:47`).
- Fix suggestion: a decision for the lead: either keep a true attitude indicator and correct the claim in the lane doc and the file's
  header (and say so to the testers), or draw the camera's horizon (lift by `pitch - uptilt`) so the instrument matches the view; the
  test's camera should then carry the uptilt.

### F7 (nit) On a phone the lesson menu and N, B, Z have no way in

- Where: the lesson menu opens only on the Escape key (`apps/fly/src/sonic/feature.ts:489`); no pause-menu item or touch control calls
  `mode.next`, `previous`, `repeat` or opens the lesson menu (searched `apps/fly/src` for menu items with the actions `scene.next`,
  `feedback.open`, `sonic.repeat`, `pause.toggle`: only the feedback form's item exists).
- Failure: a low-vision pilot on a phone can switch lessons through the pause menu's "Fly by Sound: lessons and settings", but cannot
  repeat the task, skip a step or go back a step (M41-5, M41-6) in a lesson.
- Probe: the search above (exact reading).
- Fix suggestion: a touch entry to the lesson menu (one button beside the recorder's, or the pause menu's item opening it when a
  lesson runs); or record it as a known limit of v0.13 for the testers.

## Refuted (claims tried and found to hold, with the probe)

- "Sound from above and below" applies live and at start (the lane said no page saw it): page probe P5, hover-height flying, the
  target note (`height.target`) on the sound panel's radar in 30 of 30 polls; the box turned off from the start screen over the flight
  (the lesson menu's Sound settings, Enter on it): 0 of 30 polls after Escape, `heightDirection` false in the saved document; after a
  reload and the lesson opened again: 0 of 30.
- The lesson menu keeps every key while it is up: P1's control, B with the menu up wrote no event and the phase stayed flying.
- The ordinary flight is not changed by the bump work: `GameAssist.bump` and `AltitudeHelp.bump` are called only from
  `LessonPilot.bumps`, which returns unless `sim.p.bump === 'slide'` (a lesson world's or the scan lesson's life); `liftoff` without
  `ceilingM` (the game scheme) keeps `TAKEOFF_HOP_M`; the moved `dt` line in `AltitudeHelp.follow` changes no state (exact reading; the
  a6 reference test and accept-fly B6 to B16 were not re-run here).
- The contact event's new `nx, ny, nz` reach no log or hash: the sim's events are read in memory only (`history.ts`, `stats.ts`,
  `lesson-pilot.ts`, `bridge.ts`, `selftest.ts`; searched `packages/sim-core/src`, `apps/fly/src`).
- `lifeOverrides()` is unchanged outside a lesson: `BuiltinWorld.overrides` is set only by `buildLessonWorld`; `lessonFlight` only by
  `SonicMode.enter` for a scan lesson, cleared by `leave()`; `lifeHeaderProblem` refuses an unknown bump rule.
- The sound panel knows every cue the package plays: the 26 cue ids in the package's `src/` (the literal ones and the two built from a
  material, `safety.${material}` of four classes, and a traced shape) all have a kind in `KIND_OF`.
- The sound panel shows no sound the paused engine stopped: the engine's pump plans the last frame again after `STALE_S` with the
  bridge's silent layers, so the plan's cues go (engine.ts `pump`); after `reset()` the plan is null and the panel draws a null plan.
- `soniclook` stays out of the main chunk: excluded from `i18n.ts`'s eager glob and added with the mode's chunk by `sonic/texts.ts`.
- Reset over a running lesson: `finish()`, `observe()` and `close()` all skip the forgotten runner; a lesson chosen after the reset
  opens from the cleared progress; the look panels' switches are not part of the reset (`resetProgress` writes only progress and current).
- The motor graph on the engine's context is never suspended or closed by the sound feature (`motor-sound.ts:236-241`, `shared`).
- The recorder's survey cannot be covered by the lesson menu although `dialogOpen()` does not list it: the survey takes every key in the
  capture phase (`survey-keys.ts`) and the recorder's panel stops its own Escape (`panel.ts`).
- The analytic collision shortcut stays exact by its construction: `freeWithin` answers "free" only inside a 1-Lipschitz bound of a
  distance with the voxel margin, else falls through to the full test; `sweep` is skipped only when every sphere's whole-segment cover
  lies in the free ball (exact reading; `sonic-world.test.ts`'s equality run was not re-run).
- The sound package's diff has no machine path, key, token or personal data (search of every added line).
- A v0.12 progress document keeps a passed lesson passed; only the counts of a lesson whose version changed start again, by the
  package's rule (`runner.ts:494-505`).

## Not read, not run, not judged

- Not read: the drawing code (`primitives.ts`, `look.ts`, `drawAttitude` past the horizon, `drawSounds`, `placeDiscs`), the CSS place
  rules but the progress panel's, `scan-lesson.ts`, the recorder (`sonic-session/*`) but `replay-player.ts`, `replay-control.ts`,
  `replay-view.ts` and `frames.ts`, sim-core's slide constants and the bump and tunnel tests, the bench pages beyond their helpers, most
  test files, the site's and the admin page's locale changes, the package's `tools/listen-words.ts`, `test/reset.test.ts` and its audio
  proof.
- Not run: gates, vitest beyond the probes, accept-fly, the a6 reference test, the layout and panel page proofs, the sound repo's
  checks; the lane docs' runs stand for them.
- Seen, not probed (for the fixer to look at, not findings): an older-build replay says every recorded speech event whole and queued
  (`replay-player.ts` `sayRecorded`, always `interrupt: false`), while live a line can have been cut (F1, I, Z, N): such a replay says
  lines the pilot never heard and drifts behind the flight. In a scan lesson every open after the first (a reopen at a recording's start,
  a restart after a reset) makes two new lives (`leave()` takes the lesson's bump off, `enter()` puts it back), each a 'life' event.
- Not judged: how any line, sound, caption or panel feels to a blind, deaf or low-vision pilot; a real screen reader (F4's consequence
  for NVDA and JAWS is the code's own design note, not tried); a real phone or browser zoom.

## Fixes

The fixer's pass (one agent): each finding and each known item K1 to K6 of the lead tried against the code first, then a test that
fails before the fix, the fix, the test passing, one commit per defect. Simulator commits on `v13-int`, the sound package's on `s13-int`
in `C:/dev/sonic-s13-int` (its checks and a CHANGELOG line, then the gitlink). Format: finding, commit, test, control.

- K1 (a flight dead ahead at a wall replays FAIL): holds. Cause: the two front-side sectors of the scene sampler tie on the wall's axis;
  a yaw under what a recording keeps (its quaternion to 1e-4) broke the tie toward one side live and stickiness kept that voice, while
  the replay of the rounded frame saw the tie exact and broke it by the order of the sectors (front-left first). Reproduced in Node
  before any fix: the lesson rig with a yaw of -1e-5 rad at the attempt's start replayed with 89.2 % of its sounds by id (front-right
  live, front-left in the replay), +1e-5 rad and none at 100 %. Not the frame rate, not the hold: the same flight at 60 and 30 Hz agrees
  once the tie is exact. Fixed at the cause in the package: two mirror sectors whose risks lie within 2 % of each other are one tie for
  turning on, holding, turning off and ranking (the voice's own urgency stays), the same code live and in the replay. Package s13-int
  c819995 (`test/mirror-tie.test.ts`, 12 tests; control `mirrorDeadBand: 0`: front-right live and front-left in the replay over 20
  frames; the code control, the band 0 by default, fails 3), gitlink eafd417; simulator `tools/bench/test/sonic-k1-straight.test.ts`
  (rings-first, W alone, a yaw the recording rounds away, the real FrameSampler and the file's rounding: 100 % of the sounds by id,
  verdict pass; control, the sampler's rule before the fix live and in the replay: front-right live, front-left replayed, under 95 %
  by id and 100 % by kind, verdict fail). The page's straight run: below, with the page proofs.
- K3 (the package's own Russian and Polish lines still say "Fly by Sound"): holds. Package s13-int eafd417: `app.name` and
  `menu.welcome` in ru and pl name the mode as the simulator does; their lengths measured again with Irina and Paulina (only those four
  values changed of 471 lines each: app.name ru 2.6 -> 2.08 s, pl 1.79 -> 1.675 s; menu.welcome ru 15.2 -> 15.405 s, pl 12.535 ->
  12.705 s); the words check (`pnpm listen:words`) hears all four exactly (before: Irina "F.L.Y.B.Y. Sound" and "FLUI BUI SOUND",
  Paulina "Flajby Sound", kept at 0 only by two records, now removed); ru 511 of 526 lines heard exactly (510), pl 516 (516), PASS.
  Test: `test/locales.test.ts` (the text kept from English is app.name in Spanish only; it failed on the rename until the expectation
  followed), `test/words.test.ts` (failed on the old evidence until the check ran again). How a native speaker hears the two names:
  not judged.
- F1 (major, the lesson menu drops the task's lines): holds. Traced in the bridge: a host line that interrupts ended the lesson's
  queued lines in the engine, and the resume reported the end of speech once the queue was empty, so the runner went on. Fixed in the
  bridge (the lesson's speech is not the host's to drop): `say()` knows the lesson's own lines (the host passes `lesson` for the
  runner's lines, its line at a lesson's start and the coarse-walls line) and keeps those handed and not ended; a host line that
  interrupts (the lesson menu, the start screen's spoken list, K's help, I) moves them to a list to say again. They are said again,
  whole and in order, once the host is done: at the resume (the first one cutting what the closed menu or screen still said, or after a
  host line said at the resume), and without a pause (I) when the host's lines end; a newer line of the lesson (N, Z, B, a menu item
  that moves the lesson) drops them; the end of speech comes after them. Escape and the menu's Resume say "Resume." (interrupting),
  which ends the menu's own lines (before: 10 s more of them after the close in the reviewer's page run). Test: `sonic-review-v13` F1
  (hover-height, Escape at 1.5 s and 1.7 s: the keys line, intro.1 and intro.2 said whole after the close, in order, before intro.3; the
  menu's two lines cut at the close; I during the task; the start screen over the task, its line cut at the close; the menu's Next step
  drops them), `sonic-int-reader` (I in reader mode: the cut lines read again, the end of speech after them). Control: the same lesson
  without the menu (all whole, before and after); the code control (the cut lines not kept, run once and restored) fails 3 of the 5 F1
  tests. Changed: `sonic-lesson-keys` B5 (after a pause that cut the task, the end of speech comes after the task said again, not at the
  resume), `sonic-int-reader` (a lesson's own interrupt and a host's are told apart). Not covered: the recorder's own lines go to the
  engine directly (`sonic-session/platform.ts` `sayVia`), not through the bridge, so its consent question still cuts what the lesson was
  saying (a recording that starts opens the lesson again from its beginning; a declined one does not).
- F2 (major, N, B, Z under the start screen move the lesson): holds. Fixed in the screen: while it is shown, its capture listener stops
  every key it does not use itself from reaching the page (the key router with the lesson's N, B, Z, G, R and the page's I, T, U, L, K,
  P, F), the latency harness's F13 to F24 excepted; the screen's own keys stay, and so do the browser's default actions (Tab, Enter on a
  button, a slider's arrows, a letter in a list). Test: `sonic-start-screen` "v13-int review F2" (over a lesson, B, N, Z, G, R, I, T, U,
  L, K, P and a digit stop at the screen and a router stand-in after it sees none; F13 goes on; Down and Escape still work). Control: the
  screen hidden, every key reaches the router; the code control (the stop removed) fails the test. In the page: `sonic-v13-page` R.
- F3 (major, a dead lesson after B at the path's first lesson): holds. Fixed in the host: a runner whose way out leads nowhere (B at the
  first step of the path's first lesson, N or the menu's Next lesson at the path's last lesson, the ladder's end after a pass) is kept as
  left for the start screen (`toMenu`), and when the screen is closed without a lesson chosen that lesson starts again from its beginning
  (`restartAfterScreen`, which v13-int step 5's restart after a reset became; `feature.ts` onClose). Test: `sonic-review-v13` F3
  (ears-headphones, B: the screen; closed: the lesson opened again, N moves it), `sonic-garden` (free-garden, the last lesson of both
  paths, N while flying: the screen; closed: opened again, N moves it). Control: a lesson still running under the screen is not started
  again; the code control (the runner not kept) fails both. Changed: `sonic-reset-running` (the method's new name).
- F4 (major, the focus left on the body after the start screen): holds. Fixed in the screen: `hide()` takes the focus off its own
  control at once, so the flight page's `focusFlight` finds the body and puts the focus on the flight's region. Test:
  `sonic-start-screen` "F4" (the fake DOM: the focus on the body after hide(); control: a control outside the screen keeps it); the code
  control (no blur) fails it. In the page: `sonic-v13-page` R (Escape on the screen over a lesson: the active element is the region).
  With NVDA or JAWS: not tried.
- F5 (minor, the progress panel shows the live lesson during a replay): holds. Fixed: the panel draws nothing while a replay plays
  (`progressNow`), and is drawn again the moment a replay takes the engine or gives it back (`PageRuntime`'s onPlayback); the sound
  panel's "played three times" card shows none of the live runner's during a replay (the same seam). Test: `sonic-review-v13` F5 (the
  rig: the panel's title, hidden at `playback(true)`, back at `playback(false)`). Control: no lesson running, hidden too; the code control
  (no playback check) fails it. In the page: `sonic-v13-page` R during a replay.
- F7 (nit, no way into the lesson menu on a phone): holds. Fixed: the pause menu (the top bar's Pause button) has "Lesson menu" as an
  item while a lesson runs (disabled otherwise); it opens the lesson menu once the pause menu has let the flight go, and its items are
  buttons a finger can press. No Node test (the item lives in `feature.ts`, which runs only in a page): `sonic-v13-page` R on a phone
  (390 x 844, touch): Pause, Lesson menu, Next step moves the lesson. Control there: the item is disabled with no lesson running.
- F6 (minor, the attitude display's horizon is the body's, the view's camera is tilted up): holds as read (the default drone's
  uptilt 20 degrees; the dial takes sim-core's body pitch). Decided, the drawing not changed: the dial stays a true attitude indicator
  (the craft's attitude whatever the camera, as an aircraft's instrument), because the pilot reads from it what the craft does: level
  flight reads level, a climb's nose-up reads nose-up. Drawing the camera's horizon instead (the pitch less the uptilt) would show a
  hovering craft 20 degrees nose-up. Corrected: the claim "the horizon the craft's camera sees" in `attitude.ts`'s header, the lane doc
  (`docs/wip/v13-look.md`) and `sonic-panels` (its camera looks along the body's axis). Test: `sonic-panels` "v13-int review F6" (level,
  20 degrees nose-up and 10 nose-down: the dial lifts the horizon by the body's pitch, the default drone's camera, uptilt read from its
  preset, sees it 20 degrees lower, a camera along the body agrees with the dial). For the testers' notes (the lead's): the dial and the
  view disagree by the camera's tilt by design. The lead may turn it.
- K2 (the captions over the panels in Spanish, Polish and Russian): holds (the layout check before the fix, all four languages and 13
  sizes, `evidence/2026-11-09/v13-look-layout-baseline.json`: the captions over the progress panel at 1280 x 720 in es 1516, pl 1304, ru
  2156 px2, at 1366 x 768 in all three, over the attitude display at 960 x 540 and 640 x 360 in es and ru, the Russian progress panel over
  the sound panel at 640 x 360). Fixed: `captions.ts` hides the oldest line shown (from the eye only; a screen reader still reads it) while
  a line shown meets a panel within 8 px, measured again when the page changes size; on a page wider than a phone and over 600 px high the
  captions take the page right of the left panel column (`min(30vw, 360px)` wide), centred in it, so they never reach the progress panel;
  at 640 x 360 the progress panel is at most 160 px wide and the sound panel right of that. The layout check runs all four languages
  (LAYOUT_LANG, default en,es,pl,ru). Test: `sonic-captions-fit` (Russian lines over the attitude display: the oldest hidden, the rest 8 px
  clear; English fits; the newest never hidden; refit on resize) with its controls (a panel beside the region or hidden limits nothing; the
  code control without the hiding fails 3 of 5); the page: the layout check below. What it costs: lines shown at the attempt's start (of 3)
  at 960 x 540 2 in every language, at 640 x 360 1, on a phone with sticks 2, on a tablet on its side 2, at 1280 x 601 2; 3 elsewhere.
- K4 (601 to 705 px high, a tablet with touch sticks): holds. The layout check gains three laptop windows (1366 x 657, 1280 x 601, 1536 x
  705) and two tablets with touch sticks (768 x 1024, 1024 x 768): before the fix the windows failed only by K2's captions; both tablets
  failed (the attitude display and the sound panel lay on the sticks, the recording bar and the view's centre: 33440 and 44880 px2 on the
  sticks). Fixed (look.css, a page wider than a phone and over 600 px high with touch sticks): the sound panel at the left over the
  progress panel (which stays at the left edge halfway down), the attitude display at the right over what stacks there (upright: the
  recording bar in the middle; on its side: the recorder's toggle), at most 1.62 x 140 px wide, clear of the view's centre. Test: the layout
  check (its control: the baseline run, where both tablets failed).
- K5 (the recorder's toggle over a touch stick): holds (on a phone upright with sticks 111 x 44 at 265, 730 over the right stick, 4435
  px2; on both tablets too). Fixed (sonicrec.css): with touch sticks the toggle stands right over the right stick, 8 px clear, its panel
  over it; on a phone the recording bar (and the take-off line with it) goes 15 px higher to make room, and the sound panel and the
  attitude display with them. The layout check gains a check of the toggle against the sticks and the arm button at every size with
  sticks (before: failing at all three; after: passing).
- K6 (hear the reworded Russian pause item back): done (the sound repo's words check, `listen-words --sim` on this branch's locales,
  Irina, Whisper large-v3, bound 0.2; report `evidence/2026-11-09/sonic-words-sim.json`). `sonic.menu.page` (the mode's name, a colon,
  then "for the blind, for the low-sighted" with a comma where step 6 had "and") is heard with the comma as a pause and the name whole,
  but the word for "low-sighted" split in two ("slabyi dyashchim"): rate 0.4, over the bound, the same split step 6's report listed before
  the comma; the item keeps the site page's words (a test holds it), so it is left for a native reader. Russian as a whole: 269 lines, 245
  heard exactly, mean rate 0.0268, 10 over the bound (step 6: 245, 0.0266, 10); English, Spanish, Polish as in step 6 (250, 254, 254
  heard exactly; 4, 4, 5 over). How the voices sound to a person: not judged.

