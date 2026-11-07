# v0.12 lane v12-flight: independent review

Reviewer's Status file. Scope: `git diff v03-lead..v12-flight` (160 files; the lane's head when this review began: 53d3455). Rules of the review: one defect, one test that fails before the fix, one fix, one commit; no push, no deploy, no SSH, no live admin; a step runs only the checks it touches; every number below is measured here or labelled an estimate; how anything sounds is not judged.

## Status

- [x] 0 Read the plan (sections 4.2, 8, 9), the spec, the package's AGENTS.md and replay core, the lane's Status, and the lane's code that matters most: every changed file outside `apps/fly/src/sonic/` (input path, session, sound, flight, boot, prefs, render-pc, collision) and `bridge.ts`, `mode.ts`, `lessons.ts`, `start.ts`, `start-screen.ts`, `entry.ts`, `captions.ts`, `audio.ts`, `store.ts`, `scan-lesson.ts`, `scan-world.ts`, `lesson-world.ts`, `lesson-pilot.ts`, the feature `sonic-flight.ts`, the GPU hint (both files), `analytic.ts`, `normal.ts`, the PrimitiveStage half of `primitives.ts`.
- [ ] 1 D2 the bridge's speech counter survives the mode starting again (a line of the lesson that was left ends after the next lesson began)
- [ ] 2 D1 the keyboard stand-in of Fly by Sound is not remembered as the pilot's input
- [ ] 3 D4 the start screen over a running flight keeps Space and the arrow keys for itself
- [ ] 4 D3 a lesson that does not open at the entry is said in the pilot's language, by the engine's voice
- [ ] 5 lane acceptance once (the checks the fixes touch: typecheck, the sonic and input tests, a6-reference, i18n parity, catalog, B18, accept-fly on a local build)

## Findings

(filled in as each defect is proved and fixed)

## Refuted claims and probes that found nothing

(filled in)

## Not read, not verified

(filled in)

## Needs from sonic-core

None found by this review.
