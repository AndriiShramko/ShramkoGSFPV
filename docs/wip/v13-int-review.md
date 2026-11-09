# v0.13 review of v13-int (independent review, wave 2 as it will ship)

Reviewer: one agent, one pass over the simulator diff `cb67b0d..v13-int` (head `c324225`: v13-host, v13-look and v13-int's own
commits) and the sound package's `512d7d2..ecb2ffb` in `C:/dev/sonic-s13-int` (branch `s13-int`). Nothing fixed here: the next agent
fixes. Every finding was confirmed by a probe (a Node test kept outside the commit and deleted, a page run on a local release build, or
an exact reading of the code path with the inputs that reach it). What a sound or a voice feels like to a person is not judged here:
the probes read what the engine was asked to say, what reached `speechSynthesis.speak` and what the code does.

## Status (work in progress)

- [x] Read: the lane docs' final status and open items (v13-host, v13-look, v13-int), the plan; the diff by area (lessons, feature,
  lesson menu, start screen, spoken list, mode, bridge, key names, store, prefs doc, progress panel, look panels, attitude display
  geometry, sound panel kinds, session lesson flight, sim-core bump, analytic collision shortcut, assists, lesson pilot, replay player,
  replay control, frames, locales of the new keys); the package's engine reset, planner reset, contract.
- [x] F1 confirmed by a Node probe and in the page; F2 to F5 confirmed (below).
- [x] Page probes on a local release build of the head (`dist/release.json` sha c54d8d9 = `c324225` + this file, sound package
  ecb2ffb; `serve-csp.mjs dist 5461`; headless system Chrome 156.0.8078.80; the GPU lock held by the probe): the start screen over a
  running lesson and the lesson keys (P1), where the focus goes when it closes (P2), the lesson menu's cut lines with the browser's real
  voice (P3 and its control), the progress panel during a replay (P4). The probe script was a temporary `tools/bench/src/zz-review-page.ts`
  (deleted, never committed); its raw output stayed in the session's temporary folder, the numbers that matter are written below.

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
  "Resume. Item 1 of 8." from 8.83 to 12.02 s, though the menu closed at about 1.5 s; the lesson waited for them (its next part came
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
  said. `I` still says "Lesson 1 of 28 ... Step 1" and the progress panel still shows it, as if the lesson ran. Only the lesson menu's
  Lesson list (or Leave the mode) gets him out.
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
  a page check during F1's replay: the panel hidden or naming rings-first.

## Refuted

(in progress)

## Not read

(in progress)
