# Lane sonic3 (train 3): Fly by Sound in any scene, in place

Worktree C:/dev/gsfpv-center-throttle, branch sonic3 (from origin/main f91273cf). Package repo C:/dev/ShramkoSonicFPV, branch
train3 (from its main 197c2760). Design: docs/wip/sonic3-plan.md.

## Status

Stage Z1-any-scene-in-place:
- [x] Step 1: owner's path walked on the LIVE site (read only), Tunis 887f27aa and Wroclaw 70b50d42; findings in
  sonic3-plan.md "What stops a pilot today"; probe tools/bench/scripts/sonic-walk-probe.mjs (this commit).
- [x] Step 3: package README line "Spatial-audio consultant: Bartlomiej Mroz (Gdansk University of Technology)" (Polish
  letters in README.md), earlier sentence removed; test/docs.test.ts holds it. Package commit 2ec8653 on train3.
- [ ] Step 2: the in-place switch. Left, in this order (details in sonic3-plan.md "The direct road"):
  1. Package (train3): a free template for a built-in world too (scanFreeLesson only takes a scan), plus locale key
     sonic.say.inPlaceIntro in pkg/locales en es pl ru if engine lines live there, else in packages/i18n/locales/fly/sonic.
  2. KEYMAP action sonic.inPlace (Shift+S, when 'always'); check KeyRouter shiftIsFlying (app/flight.ts) does not swallow
     Shift+S when Shift is a flight key; tables keymap.test.ts DESIGN_TABLE and app-keys.test.ts.
  3. apps/fly/src/sonic/in-place.ts switchOn/switchOff (setup, setSonicEntry, installSonicFlight, off).
  4. lessons.ts openFree(lesson, { here: true }): start = current pose, no mode.place.
  5. sonic-flight.ts: pause item becomes an action (on/off label), second item to the lessons page, key handler.
  6. First-timer intro line once (store.ts fliesBySound).
  7. Unit test tools/bench/test/sonic-in-place.test.ts with negative controls; typecheck apps/fly, packages/prefs.
  8. Move the pin of packages/sonic-fpv to the train3 commit.
  9. gates.py --only vitest,architecture,i18n,b18.
- [ ] Browser proof (own stage, release build first) on Tunis and Wroclaw with the walls stand-in.

## Facts (measured)

- Live walk, sonic-walk-probe.mjs, 2026-11-14, results U:/Temp/gsfpv-train3/sonic3/walk-live-887f27aa.json and
  walk-live-70b50d42.json: pause item href /en/fly/?sonic=scan&scene=<id>&sz=1, target _blank, a new tab opened (newTab true)
  on both scans; the new tab showed the start screen with "Start the course from the beginning" first; status stayed loading
  and no sound line for 271 s with nothing pressed (steps 6 to 7, 24 s to 295 s on Tunis).
- Wroclaw 70b50d42 live: walls 0.0 MB downloaded, top bar "No walls yet: C builds them.", walls off.
- Package docs test: 10 of 10 passed with the new README; on main's README it fails by an assertion (negative control).

## Decisions

- In place = install sonic/feature.ts installSonicFlight on the running flight context after the press (the KeyRouter's sonic
  option is already a live function of sonicEntry()), not a new page.
- Key Shift+S: every plain letter is bound (keymap.ts), Shift+S is not.

## For the lead

- Step 2 is not built yet: the stage stopped at the reply budget with step 1 and step 3 done. sonic3-plan.md names files and
  functions for the next worker.
- Package branch train3 has commit 2ec8653 (README); the pin is not moved yet.

## Not verified

- The live walk did not reach the first cue: the probe looked for '.screen button' and the start screen uses other markup, so it
  pressed nothing in the new tab. The screenshots show the screen; what the second press does was read in code (lessons.ts open,
  mode.place(start)), not seen in a browser.
- Shift+S under the KeyRouter's shiftIsFlying setting: not checked.
- gates.py was not run (no simulator source changed except a new probe script and docs).

## Cost notes

- 2026-11-14 Z1: most replies went to reading the sound mode's entry chain (boot, start, feature, lessons) before design; a
  short agent-map section "how the mode is installed and what it needs at install time" would have saved four reads.
