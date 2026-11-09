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
- [x] F1 confirmed by a Node probe (below).
- [ ] Page probes on a local release build of `c324225` (port 5461): the start screen over a running lesson and the lesson keys; the
  progress panel during a replay; the lesson menu's cut lines in the real page; where the focus goes when the start screen closes.

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
- Fix suggestion: the lesson's speech is not the menu's to drop. Either (a) the bridge keeps the lesson lines it handed and that did not
  end (it already counts them per run) and hands them again at the resume, before it reports the end of speech; or (b) at the resume
  after a pause that cut the lesson's speech, the runner repeats the current part of its task (the package's `repeat` already knows the
  step's lines) instead of taking the cut as its end. The same cut happens under K (`help.keys`, the first line interrupts) and the
  start screen opened over a lesson; I and Z cut too, but Z says the task again by design. A Node test: the probe above with the menu
  must say `intro.1` and `intro.2` after the resume; its control (no menu) passes today.

## Refuted

(in progress)

## Not read

(in progress)
