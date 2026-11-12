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
- [ ] H2 the lesson menu names each item's key; its opening line says the same actions have keys
- [ ] H3 X: from a lesson to the main menu (the start screen) in one press, then "Main menu ... the lesson is saved"
- [ ] H4 the sound lost in a lesson (context not running, tab hidden): said on the return, with Z to repeat
- [ ] gates: typecheck, the touched tests, i18n; the words check of the new lines (`listen-words --sim`)

## Decisions

- X for the main menu: free in `keymap.ts` (no binding, not a flying key); H is the HUD, Shift+Escape leaves full screen in browsers.
- The existing key `sonic.say.lessonKeys` is kept (its text and parameters change), so the bench pages that wait for it still find it.
- "Off" leaves out the line at the lesson's start too: K still says every key.

## Tests run

- `sonic-hints.test.ts` 4 of 4; with the old `key-names.ts`, `lessons.ts`, `keymap.ts`, `doc.ts` and locales 0 of 4.
- `sonic-lesson-keys.test.ts` + `sonic-start-screen.test.ts` 58 of 58 after updating their expectations (the new line's text, 15 settings stops, B5's wait bound 10 s to 20 s for the longer queue); `packages/prefs` keymap and catalogue tests updated for the sixth mode key.
