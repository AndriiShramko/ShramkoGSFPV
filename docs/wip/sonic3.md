# Lane sonic3 (train 3): Fly by Sound in any scene, in place

Worktree C:/dev/gsfpv-center-throttle, branch sonic3 (from origin/main f91273cf). Package repo C:/dev/ShramkoSonicFPV, branch
train3 (from its main 197c2760). Design: docs/wip/sonic3-plan.md.

## Status

Stage Z1-any-scene-in-place:
- [x] Step 1: owner's path walked on the LIVE site (read only), Tunis 887f27aa and Wroclaw 70b50d42; findings in
  sonic3-plan.md "What stops a pilot today"; probe tools/bench/scripts/sonic-walk-probe.mjs (this commit).
- [x] Step 3: package README line "Spatial-audio consultant: Bartlomiej Mroz (Gdansk University of Technology)" (Polish
  letters in README.md), earlier sentence removed; test/docs.test.ts holds it. Package commit 2ec8653 on train3.
- [x] Step 2: the in-place switch (this commit). Backslash (KEYMAP action flyBySound.toggle, when 'always') and the pause item
  "Fly by Sound here" switch the mode on over the running flight: sonic/in-place-model.ts InPlaceSwitch (pure) and
  sonic/in-place.ts (wiring, loaded by import() at the first press); free flight = scan-free template on the scene flown now at
  its size (a built-in world too: no package change was needed, scanFreeLesson takes any scene id); feature.ts scanLesson gives
  the craft's pose as the start when `here`; lessons.ts openFree(lesson, { here }) keeps it for every reopen (walls in, failed
  course). First-timer line sonic.say.inPlaceIntro once (store.ts fliesBySound). Lesson menu Leave and X switch off / open the
  lessons tab when there is no start screen. Second pause item "Fly by Sound lessons" keeps the new-tab link.
- [x] Pin of packages/sonic-fpv moved to package train3 2ec8653 (this commit).
- [x] gates.py --only vitest,architecture,i18n,b18 on 98ef20d8: all four PASS (vitest 197 s), logs U:/Temp/gsfpv-gates-20261114-221332.
- [ ] Browser proof (own stage, release build first) on Tunis and Wroclaw with the walls stand-in.

## Facts (measured)

- Live walk, sonic-walk-probe.mjs, 2026-11-14, results U:/Temp/gsfpv-train3/sonic3/walk-live-887f27aa.json and
  walk-live-70b50d42.json: pause item href /en/fly/?sonic=scan&scene=<id>&sz=1, target _blank, a new tab opened (newTab true)
  on both scans; the new tab showed the start screen with "Start the course from the beginning" first; status stayed loading
  and no sound line for 271 s with nothing pressed (steps 6 to 7, 24 s to 295 s on Tunis).
- Wroclaw 70b50d42 live: walls 0.0 MB downloaded, top bar "No walls yet: C builds them.", walls off.
- Package docs test: 10 of 10 passed with the new README; on main's README it fails by an assertion (negative control).
- Step 2 unit tests: sonic-in-place, sonic-optin, sonic-int-lazy, sonic-walls-free, sonic-scan-free, sonic-scan-course, keymap,
  app-keys: 8 files, 100 of 100 passed. Typecheck apps/fly and packages/prefs: 0 errors each.
- Negative controls (neg_control.py, ref origin/main) for sonic-in-place.test.ts: keymap.ts NEG OK (expected null to be
  'flyBySound.toggle'); sonic-flight.ts NEG OK (expect(item.href).toBeUndefined fails); lessons.ts NEG OK (craft back at the
  spawn: 0.0002 m, expected over 3 m). Logs U:/Temp/gsfpv-train3/sonic3/neg-*.log.
- The runner itself places the craft at its start pose when a lesson begins (package runner.ts begin, 'place' action), so
  keeping the position needs the start = the craft's pose (feature.ts scanLesson `here`), not only skipping mode.place.

## Decisions

- In place = install sonic/feature.ts installSonicFlight on the running flight context after the press (the KeyRouter's sonic
  option is already a live function of sonicEntry()), not a new page.
- Action name flyBySound.toggle, not sonic.inPlace: app-keys.test.ts holds that no 'sonic.*' action is listed on an ordinary
  page, and this key must be listed on every page.
- Switching on in place opens the free flight with its own assists (velocity control, 5 m/s top as scan-free.json sets): the
  speed stages of this train change that, not this step.
- Key Backslash: every plain letter is bound (keymap.ts) and no binding names Backslash (grep 'Slash' in keymap.ts: 0). Not
  Shift plus S: Shift is a flying key in the game scheme (app/keys.ts shiftIsFlying note), that chord would fire while descending.

## For the lead

- Step 2 is built (98ef20d8); the browser proof is the next stage (release build first; Tunis 887f27aa and Wroclaw 70b50d42
  with the walls stand-in): fly, Backslash, intro and first cue heard, pose unchanged, walls build spoken on Wroclaw, N a course,
  Backslash off.
- The pin points at package train3 2ec8653, which is only in C:/dev/ShramkoSonicFPV (not pushed): the package branch must reach
  its origin before the merge.
- Old tests changed on purpose (the owner's message 51 overrides v12-optin's "one quiet link, no key"): sonic-optin.test.ts and
  sonic-int-lazy.test.ts now expect two items and the in-place key; sonic-lesson-rig.ts honours `here` as feature.ts does.

## Not verified

- The live walk did not reach the first cue: the probe looked for '.screen button' and the start screen uses other markup, so it
  pressed nothing in the new tab. The screenshots show the screen; what the second press does was read in code (lessons.ts open,
  mode.place(start)), not seen in a browser.
- Backslash on Polish and Russian keyboard layouts (code Backslash exists on both; its printed cap not checked).
- Nothing of step 2 was seen in a browser yet: the sound starting from a key press after the import() (Chrome's autoplay rule
  with sticky activation), the built-in world's walls heard through ScanSonicWorld, the menu label switching to "Switch off",
  X and the lesson menu's Lessons item opening the new tab, the respawn at the craft's own pose when the runner begins (the
  craft stops dead for a moment: velocity reset).
- a6-reference.test.ts not run: only the keymap gained a binding; flight, input devices and collision code are unchanged.

## Cost notes

- 2026-11-14 Z1: most replies went to reading the sound mode's entry chain (boot, start, feature, lessons) before design; a
  short agent-map section "how the mode is installed and what it needs at install time" would have saved four reads.
- 2026-11-14 Z1 pass 2: the most replies went to old tests that pinned the replaced design (optin, int-lazy) and to the stale
  submodule checkout (scanFreeLesson missing until the pin moved); moving the pin first and grepping tests for the item id
  before editing would have saved four replies.
