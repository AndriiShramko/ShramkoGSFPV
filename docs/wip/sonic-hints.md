---
type: lane
status: ready for review
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
- [x] gates: `pnpm -r typecheck` exit 0; `vitest run sonic keys i18n catalog packages/prefs` 119 files, 2253 passed, 11 skipped, 2 failed (app-keys and sonic-optin counted five mode keys), both updated: 42 of 42; `check-architecture.mjs` ok; no Cyrillic outside the locales in the changed files (B18 not run: it reads the public repository through the GitHub API)
- [x] the words check of the new lines: `listen-words --sim` (package branch `sonic-hints` 898dcd3: sample values for previous, home, label; tool only), 1108 simulator lines, Windows voices + Whisper large-v3 on the GPU. Every new line under the bound 0.2: en lessonKeys 0.167 (heard "keys, and next, be back, z repeat, escape menu, x main menu": N and B heard as "and" and "be"), en soundBack 0.083, pl homeBack 0.067, ru lessonKeys 0.083; ru menuItemKey 0.25 ("klavisha" heard "klavishi", the key N heard as a word), the rest heard exactly. Report not committed (the tool writes a report for the simulator, not evidence)
- [x] the lead's review (2026-11-12): H1-H4 confirmed in the code. The hint is a host line (`bridge.say` with `lesson: true`), which the replay check leaves out of its comparison (`compare.ts` hostOnly), so no lesson version changes: the runner's lines are the same and old recordings re-derive as before. X: no other binding in `keymap.ts`, the package or the app; `when` keeps it off over a dialog, the pause menu and the lesson menu. The audio context is suspended only by a hidden tab (the motors' graph); a menu pause does not suspend it, so the sound-gap line is not said after the menu. Found: only the key names' intelligibility (below)
- [x] the key-name rule (lead, 2026-11-12): the word for a key right before a key's name, and the name ends its sentence. Variants said and heard (`listen-words --sim` on a copy with 9 forms x 4 languages): "N next, B back" and "Next: N." lose N/B in English; "Next, key N." and "Next step. Key N" are heard exactly in en, es, pl and ru. Now `sonic.say.lessonKeys` "Next, key N. Back, key B. Repeat, key Z. Menu, key Escape. Main menu, key X." (16 words at most in each language) and `sonic.say.menuItemKey` "{label}. Key {key}"; en `soundBack` "Press {key} to hear the task of this step again." Test `sonic-hints.test.ts` KEY_RULE for both lines in 4 languages (3 of 11 fail on the old lines). Package: HEARD ru "Eskeyp" (the Russian spelling of Escape, in Cyrillic) heard "Escape" (Whisper writes the key's Latin name). Result on the 1108 simulator lines: every line of this lane heard exactly in 4 languages except pl homeBack 0.067 (glowne heard glowny; no key)
- [x] new page probe R8 (`tools/bench/src/sonic-int-review.ts r8`): the keys line after step 1's first line, not again on Z, once more on N; X shows the start screen and says `sonic.say.homeBack`; the lesson offered on it. Negative control on the live site before the release (4d188f0, package 3115137): 5 of 8, the N, X and homeBack checks fail (`evidence/2026-11-12/sonic-int-review-r8-live-before-4d188f0.json`)
- [x] merge (lead, 2026-11-12): package `sonic-hints` merged into its `main` b102ce6 and pushed (tools/listen-words.ts only: --sim samples, SIM_HEARD; package typecheck 0, test/words.test.ts 18 of 18); submodule pinned at b102ce6; `main` 980d399 = `git merge --no-ff sonic-hints`. All gates once: typecheck, vitest (256 files, 4146 passed, 10 skipped), api-unittest, architecture, i18n, catalog, B18 PASS. Local release build 980d399 (sonic b102ce6, serve-csp, headless): accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all true (target `http://localhost:5431`); probes R1 4/4, R2 4/4, R3 4/4, R4 4/4, R5 3/3, R6 6/6, R7 5/5, R8 8/8
- [x] release and live checks (lead, 2026-11-12): pushed `main` 57d461c; CI 43238429059 green; `deploy/ship.sh 57d461c`: release 4e21e699fa8f (previous 3244586a3037), enforced CSP carries the 8 new hashes, neighbours equal (45 containers, 46 vhosts), 302 checks. Live `release.json` `{"sha":"57d461c1","sonic":"b102ce6"}`. On live (headless): accept-fly B6-B16 all pass (target `https://gsfpv.flyreelstudio.eu`); probes R8 8 of 8, R6 6 of 6, R1 4 of 4 (evidence `*-live.json`). Lane closed. Open: a human listening to the new lines; es and pl wording by a native speaker; pl homeBack 0.067 in the words check (no key in it)

## For the lead before the merge

- A human listening: the step line after each step's first line, the menu items with keys, X and the line after it, the sound-gap line after a hidden tab.
- The bench pages (`sonic-v13-page.ts`, `sonic-int-review.ts`) and accept-fly were not run; the full `vitest run` was not run (only the files above).
- es and pl wording by a native speaker.
- The package branch `sonic-hints` (898dcd3, `tools/listen-words.ts` only, not pushed): merge it in the package; the submodule pin was not moved (the simulator does not run the tool, and an unpushed commit cannot be pinned).
- en: N and B inside the dense keys line are heard as "and" and "be" by Whisper; a human should judge if "Keys: N next, ..." needs commas or "key N".

## Decisions

- X for the main menu: free in `keymap.ts` (no binding, not a flying key); H is the HUD, Shift+Escape leaves full screen in browsers.
- The existing key `sonic.say.lessonKeys` is kept (its text and parameters change), so the bench pages that wait for it still find it.
- "Off" leaves out the line at the lesson's start too: K still says every key.

## Tests run

- H2-H4: `sonic-hints.test.ts` 11 of 11; with the old `lesson-menu.ts`, `mode-keys.ts`, `keymap.ts` and locales 9 of 11 fail (the 2 that pass are H1 tests whose code was not reverted), without `sound-gap.ts` the file does not load. Together with `sonic-lesson-keys`, `sonic-start-screen` and `packages/prefs`: 314 of 314. `tsc -p apps/fly` 0.

- `sonic-hints.test.ts` 4 of 4; with the old `key-names.ts`, `lessons.ts`, `keymap.ts`, `doc.ts` and locales 0 of 4.
- `sonic-lesson-keys.test.ts` + `sonic-start-screen.test.ts` 58 of 58 after updating their expectations (the new line's text, 15 settings stops, B5's wait bound 10 s to 20 s for the longer queue); `packages/prefs` keymap and catalogue tests updated for the sixth mode key.
