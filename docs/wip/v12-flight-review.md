# v0.12 lane v12-flight: independent review

Reviewer's Status file. Scope: `git diff v03-lead..v12-flight` (160 files; the lane's head when this review began: 53d3455). Rules of the review: one defect, one test that fails before the fix, one fix, one commit; no push, no deploy, no SSH, no live admin; a step runs only the checks it touches; every number below is measured here or labelled an estimate; how anything sounds is not judged.

## Status

- [x] 0 Read the plan (sections 4.2, 8, 9), the spec, the package's AGENTS.md and replay core, the lane's Status, and the lane's code that matters most: every changed file outside `apps/fly/src/sonic/` (input path, session, sound, flight, boot, prefs, render-pc, collision) and `bridge.ts`, `mode.ts`, `lessons.ts`, `start.ts`, `start-screen.ts`, `entry.ts`, `captions.ts`, `audio.ts`, `store.ts`, `scan-lesson.ts`, `scan-world.ts`, `lesson-world.ts`, `lesson-pilot.ts`, the feature `sonic-flight.ts`, the GPU hint (both files), `analytic.ts`, `normal.ts`, the PrimitiveStage half of `primitives.ts`.
- [x] 1 D2 the bridge's speech counter survives the mode starting again (a line of the lesson that was left ends after the next lesson began)
- [ ] 2 D1 the keyboard stand-in of Fly by Sound is not remembered as the pilot's input
- [ ] 3 D4 the start screen over a running flight keeps Space and the arrow keys for itself
- [ ] 4 D3 a lesson that does not open at the entry is said in the pilot's language, by the engine's voice
- [ ] 5 lane acceptance once (the checks the fixes touch: typecheck, the sonic and input tests, a6-reference, i18n parity, catalog, B18, accept-fly on a local build)

## Findings

### D2 (fixed): a line of the lesson that was left ends the NEW lesson's speech early (`sonic/bridge.ts`)

- Defect: `SonicBridge.start()` resets the speech count to 0 for every lesson (`SonicMode.enter()`), but a `say()` of the lesson that was left is still in flight (G, or a lesson chosen on the start screen over the flight) and when it ends (cut by speechSynthesis.cancel, or on its own) its `finally` took one off the new lesson's count and, at 0, sent a `speech.end` marker and called `runner.spoken(t)` of the NEW runner while the new lesson's own line was still being said: the runner goes on before its intro is over, and the recording carries a marker that is not the host's real end of speech.
- Test that failed before the fix (and passes after): `tools/bench/test/sonic-bridge.test.ts` "review D2" (unit, fake engine: a `speech.end` at t 0 appeared while the new lesson's line was in the queue) and `tools/bench/test/sonic-lessons.test.ts` "review D2" (the real host, mode, bridge and runner on the real flight model; only the engine and the drawing are fakes): G while the intro of rings-first is being said, then the glossary's first three `speech.end` markers: `[true, true, true]` for "the engine is still speaking" before the fix, `[false, false, false]` after. Controls that pass both before and after: the same lessons with no lesson left behind (clean open of ears-glossary), lines of one lesson counted as before, a line ending after `stop()` says nothing.
- Fix: a run counter (`epoch`, bumped by `start()` and `stop()`); a `say()` takes its own run's number and only a line of the current run changes the count or reports the end of speech.
- Checks run: `sonic-bridge` (15), `sonic-lessons` (23), `sonic-mode` (5): 43 pass; typecheck of `@gsfpv/fly` and `@gsfpv/bench`.

### D2b (fixed): G, or a lesson chosen on the start screen, does not cut what the lesson left was saying (`sonic/lessons.ts`)

- Found while proving D2: after the D2 fix the first `speech.end` of the glossary opened with G at t 16 ms came at 75 s of page time, a clean open's at 12.9 s (probe on the lesson rig, FakeEngine queued like speechSynthesis). A lesson says 4 to 6 lines at once when it opens (probe over the 20 analytic lessons: 4 lines in 16 of them, 5 in four, 6 in the corridor), the runner marks none of them `interrupt` at `begin()` (only N and an answer interrupt, `interruptNext`), so the new lesson's lines queue BEHIND the old intro: a blind pilot who presses G to reach the glossary, or picks another lesson, first hears the rest of the old lesson's intro (here about a minute).
- Test that failed before the fix: `sonic-lessons.test.ts` "review D2b" (the first line of the glossary opened by G while the intro of rings-first is being said has `interrupt: true`, the other lines do not, and its first end of speech comes within 20 s). Control that passes before and after: a lesson opened while nothing is being said (a clean open, or after the previous one finished) queues its lines with no interrupt.
- Fix: `LessonHost.open()` reads the bridge's speech queue before `mode.enter()`; when it is not empty the first `say` of the new runner carries `interrupt` (one flag, cleared after the first line and after `enter()`).
- Checks run: `sonic-lessons` (25), `sonic-bridge` (15), `sonic-mode` (5): 45 pass; typechecks.

## Refuted claims and probes that found nothing

(filled in)

## Not read, not verified

(filled in)

## Needs from sonic-core

None found by this review.
