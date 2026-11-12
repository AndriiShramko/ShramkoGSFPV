---
type: lane
status: in progress
summary: "Fly by Sound, stage 2 of the keys plan: the keys said aloud at every step, in the lesson menu, X to the main menu, the lost sound said on return (owner's complaint of 2026-11-10)."
created: 2026-11-12
---

# Lane sonic-hints

Branch `sonic-hints` from `origin/main` 751f647 (the local `main` is stale; `origin/main` = `v03-lead`). Input: `docs/wip/sonic-keys-plan.md`, section 4 and stage 2. The sound package is not changed: every line here is the simulator's (`packages/i18n/locales/fly/sonic`, `sonickeys`).

## Status

- [x] H1 step keys: one short line after the first line of every step (`lessons.ts`, step = `runner.view().step`), never twice in a step; names next, back, repeat, the lesson menu, the main menu; setting "Key hints at the start of each step: brief / off" in the spoken settings list (`key-hints.ts`, `SonicState.keyHints`). Tests `tools/bench/test/sonic-hints.test.ts` H1 (4 of 4 fail on the old sources, pass on the new)
- [x] H2 the lesson menu names each item's key ("Next step, key N"; Resume Escape, Repeat Z, Next step N, Previous step B, Lesson list X; on the button too, for a screen reader); its opening line says the same actions have keys without the menu (`lesson-menu.ts` keyOf, `sonic.say.menuItemKey`)
- [x] H3 X (`sonic.home`): from a lesson to the main menu (the start screen) in one press, then "Main menu of Fly by Sound. The lesson ... is saved: Continue takes you back to it." (`lesson-menu.ts` goHome/homeKey); the lesson menu's Lesson list says the same; K names X (`sonic.say.helpHome`)
- [x] H4 the sound lost in a lesson (context not running, tab hidden): said once on the return, with Z to repeat (`sound-gap.ts`; feature.ts checks at every visibility change and once a second, asks a suspended context to resume on the return and the next key)
- [ ] gates: typecheck, the touched tests, i18n; the words check of the new lines (`listen-words --sim`)

## Decisions

- X for the main menu: free in `keymap.ts` (no binding, not a flying key); H is the HUD, Shift+Escape leaves full screen in browsers.
- The existing key `sonic.say.lessonKeys` is kept (its text and parameters change), so the bench pages that wait for it still find it.
- "Off" leaves out the line at the lesson's start too: K still says every key.

## Tests run

- H2-H4: `sonic-hints.test.ts` 11 of 11; with the old `lesson-menu.ts`, `mode-keys.ts`, `keymap.ts` and locales 9 of 11 fail (the 2 that pass are H1 tests whose code was not reverted), without `sound-gap.ts` the file does not load. Together with `sonic-lesson-keys`, `sonic-start-screen` and `packages/prefs`: 314 of 314. `tsc -p apps/fly` 0.

- `sonic-hints.test.ts` 4 of 4; with the old `key-names.ts`, `lessons.ts`, `keymap.ts`, `doc.ts` and locales 0 of 4.
- `sonic-lesson-keys.test.ts` + `sonic-start-screen.test.ts` 58 of 58 after updating their expectations (the new line's text, 15 settings stops, B5's wait bound 10 s to 20 s for the longer queue); `packages/prefs` keymap and catalogue tests updated for the sixth mode key.
