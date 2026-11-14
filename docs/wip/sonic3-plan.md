# Lane sonic3: Fly by Sound switched on in place (train 3, stage Z1)

The owner (message 51): "I already said that this flying by sound must be switched on for any scene." Today the way in is a
link to a new tab with a start screen (walk below). The design: one key and the pause item switch the mode ON IN PLACE, in the
same tab, scene and position; the same key switches it off. The `?sonic=` pages stay for the lessons.

## What stops a pilot today (live walk of 2026-11-14, release 4e9148cd1005)

Probe `tools/bench/scripts/sonic-walk-probe.mjs`, results `U:/Temp/gsfpv-train3/sonic3/walk-live-<scene>.json`, shots
`U:/Temp/gsfpv-train3/shots/sonic-walk-<scene>-<n>-<step>.png`. Same seven steps on Tunis 887f27aa and Wroclaw 70b50d42:

1. `/en/fly/?scene=<id>`: "Before you fly" warning, press Understood (fresh profile only).
2. Scan download (Tunis 19.1 MB with walls 6.1 MB; Wroclaw scan only, walls 0.0 MB).
3. "The scan is ready. How will you fly?" controls question; press Keyboard.
4. Flight. Wroclaw's top bar: "No walls yet: C builds them." Walls (collisions) off.
5. Escape: pause menu; the last tools item "Fly by Sound: blind and low-vision pilots (opens in a new tab)",
   href `/en/fly/?sonic=scan&scene=<id>&sz=1`, target _blank.
6. The press opens a NEW TAB (the flown tab stays paused behind it). The new tab shows the mode's start screen: "Start the course
   from the beginning (Lesson 1 of 28)" first and highlighted, "I already fly by sound: fly this scan" second, the path choice,
   the headphone check. Nothing sounds; status stays `loading` (4.5 minutes, nothing pressed).
7. Only a second press ("fly this scan") starts the free flight, which loads the scan again from the network and places the craft
   at the scan's own spawn (lessons.ts open: `mode.place(start)`), not where the pilot was.

What stops him: (a) a new tab (a blind pilot loses the flown tab; a screen reader announces a new document); (b) a start screen
whose first and highlighted button is the course from lesson 1, not this scene; (c) a second press; (d) a second download and a
new position; (e) silence until (c). On Wroclaw additionally the walls are built only after (c).

## The direct road (design)

Entry points (main chunk, `apps/fly/src/app/builtin/sonic-flight.ts`, shim only):
- Key: new KEYMAP action `sonic.inPlace`, `when: 'always'`, Backslash (every plain letter is bound; not Shift plus S: in the game scheme Shift
  descends and keys.ts reads Shift+<letter> as a chord first, so that chord would fire while descending and pitching back). Add to `packages/prefs/test/keymap.test.ts` DESIGN_TABLE and `tools/bench/test/app-keys.test.ts`.
- Pause item `pause.flyBySound` becomes an action item (no href, no new tab), label "Fly by Sound here (Backslash)"; when on,
  "Switch off Fly by Sound". A second item keeps "Lessons (opens in a new tab)" to `/{lang}/fly/?sonic=start`.
- The press (a user gesture) calls `switchOn(ctx)`: `import('../../sonic/lazy-start')`, then `loadMode()`; both chunks exist.

In the lazy chunk, new `apps/fly/src/sonic/in-place.ts`:
- `switchOn(ctx, deps)`: builds `SonicSetup(prefs, locale, new Captions())`, `await setup.audio.start()`;
  `setSonicEntry({ setup, lessonId: SCAN_FREE_ID, world: null, free, freeOf, screen: null })` so the KeyRouter's
  `sonic: () => sonicEntry() !== null` (app/flight.ts) makes Z I G X live at once; then `installSonicFlight(ctx, entry)` and
  keep its returned `off`.
- `free` = `scanFreeLesson(sceneId, [ctx.session.transform.s, 0, 0, 0])`; a built-in world (no scan) uses the same template with
  the built-in id (package change: scanFreeLesson for kind 'builtin', or a `free-here` template; decide in the package).
- Position kept: `LessonHost.openFree(lesson, { here: true })` passes `start = mode.pose()` (the craft's pose now) and skips
  `mode.place(start)` (lessons.ts open, the scan branch).
- Scan prefs: `forceScanPrefs` only sets walls on; the size is the pilot's (no reload). A scan without walls: lessons.ts
  `wallsForFree` already builds them through `this.p.walls` (app/walls-then.ts `wallsThen`, called, not changed) with
  sonic.say.wallsBuilding / wallsStill / wallsIn, and the flight goes on.
- First-timer (no saved progress and `fliesBySound` unset, store.ts): one spoken introduction line, new key
  `sonic.say.inPlaceIntro` in en es pl ru: "Fly by Sound is on. Backslash switches it off, N makes a course, K says all keys. The
  lessons teach it step by step: Escape, then Lessons." Then `setFliesBySound(prefs)` so it is said once.
- `switchOff()`: `off()`, `setSonicEntry(null)`, `setup.audio` closed, `document.body.classList.remove('sonic-mode')`,
  scan prefs cleared (`clearScanPrefs`); the flight goes on where it is.
- installSonicFlight with `screen: null`: `showMenu` already returns early without a screen; X (home) must then open the lessons
  page in the same tab only after saying so; Escape in the free flight opens the lesson menu (exists).

Tests (unit, each with a negative control on origin/main):
- `tools/bench/test/sonic-in-place.test.ts`: the pause item has no href and runs switchOn; the key toggles; entry set and
  cleared; openFree here keeps the pose (fake mode); the intro line once for a first-timer, never for a pilot with progress.
- keymap tables: Backslash present, no conflict (`keymapProblems` empty).

Browser proof (own stage, release build first): Tunis and Wroclaw (walls stand-in `U:/Temp/gsfpv-train2/walls/release/70b50d42`,
served as in docs/wip/walls.md): fly, Backslash, hear the intro and the first cue within seconds, position unchanged
(`__gsfpv.session` pose before and after), Wroclaw says the walls build and goes on, N makes a course, Backslash off.
