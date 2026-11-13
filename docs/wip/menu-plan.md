# Menu plan: three kinds of new pilot (stage 3, owner requirement R29)

Plan only, no code changed. Read on the working-copy branch of `gsfpv-v03`, 2026-11-13. Every count below was taken from the code named beside it; section 5 lists what was not checked.

## 1. Inventory

### 1.1 Screens

| Screen | File, builder | Items now |
|---|---|---|
| First-visit notice "Before you fly" | `ui/panels.ts` `warningModal`, called in `app/boot.ts` when `gsfpv.warned` is not set and no `?nowarn` / `?simradio` / `?lat` | 1 text, 1 button (`warning-ok`) |
| Scene picker | `ui/scenes.ts`, `ui/picker-tabs.ts`, `ui/scenes-superspl.ts`; `showPicker` in `app/boot.ts` | tabs and cards, not counted |
| Controls screen + wizard + check screen | `ui/radio.ts` `RadioScreen`, opened by `InputHost.openRadio` (`app/input.ts`; `openRadio(true)` on load when no saved device) | 4 device choices (HID, gamepad, touch, keyboard) + USB look block; with a device in use: throttle-style row + 4 buttons (Fly, Recalibrate, Reverse, Switches); wizard screens one step each |
| How to fly / key card | `ui/controls-card.ts` `buildHowToFlyCard`, builtin `app/builtin/how-to-fly.ts` | keys of the input in use, "Do not show again" box (`input.howToFly`) |
| Top row | `app/builtin/top.ts` | 5 buttons: fullscreen, settings, feedback, controls, pause |
| HUD and arm card | `ui/hud.ts` `Hud`, `app/flight.ts` | 9 testids: arm-offer, key-card, latency, display hint, detail, drawing, input, link hint, acro-throttle |
| Mode chip | `ui/mode-chip.ts`, `app/builtin/modes.ts` | 1 chip |
| Pause menu (summary panel) | `ui/pause.ts` `pauseMenu`, `app/menu.ts` `PauseMenu`; items registered by builtins with `order` and `section` (flight, scene, setup, tools; the section is stored but not drawn) | 24 items on an ordinary page + contact link; +1 `pause.rooms` when rooms are shown, +1 `pause.sceneDefault` for an admin, +lesson items on a sound page; plus stats column, all-keys block, rows (drone, scale, share, video) |
| Settings | `ui/settings/screen.ts` `SettingsScreen` (+ `model.ts`, `editors.ts`, `rates-editor.ts`, `data.ts`) | 75 shipped settings in 11 groups + Data; search over id, label, help, option names; `?focus=<id>` deep link |
| Feedback form | `app/builtin/feedback.ts` `openFeedback(ctx, kind)` | 3 forms (report, idea, lead), 3 to 6 fields each |
| Fly by Sound start screen | `sonic/start-screen.ts` `StartScreen`, sections start, headphones, lessons, settings | settings list: 15 fields + 1 collapsed "layers" part (its sliders are stops only while open) = 16 stops, pinned in `tools/bench/test/sonic-start-screen.test.ts` ("Item n of 16") |

Pause menu items (id, order): continue 10, restart 20, rewind 21, scene 30, scene.next 31, scene.random 32, scene.favourite 33, share 35, drone 40, radio 50, howtofly 55, settings 60, replays 70, course 72, course.toggle 73, course.load 74, course.save 75, measure 80, import 90, cinema 100, record 101, sound 104, feedback 110, flyBySound 120.

### 1.2 Settings schema and keys

- `packages/prefs/src/defs/*.ts`: 82 defs (pinned by `defs.test.ts`, `SCHEMA.defs` length 82): 75 shipped, 7 planned (`respawn.showPad`, `recording.folder`, `stats.onDisarm`, `display.units`, `display.governor`, `display.latencyGuard`, `voxels.radiusM`). `course.ts` and `rooms.ts` hold no defs yet (empty arrays).
- Level flag today: `advanced?: boolean` in `schema.ts`, set on 15 defs (13 shipped). The simulator never reads it (no match in `apps/fly/src`); only `catalog.ts` and `scripts/gen-catalog.ts` use it (the "(advanced)" mark in `docs/settings.md`, the site badge `tune.adv` from the fly key `settings.advanced` = "Advanced").
- Groups: `GROUPS` in `schema.ts`, 11. Search: `ui/settings/model.ts` `matches` (all words in id + label + help + options, accents folded). No synonyms: "camera angle" does not find `camera.uptiltDeg` ("Camera uptilt").
- Keys: `KEYMAP` in `keymap.ts`, 30 shipped single-line entries (6 of them `when: 'sonic'`) + 2 planned (`rooms.panel`, `rooms.who`). Pinned by `keymap.test.ts` (`SHIPPED_AT_WAVE1`, `SHIPPED_IN_WAVE2`, `MODE_KEYS`, `SHIPPED_BY_TRACKS` = course.toggle Shift+T, course.generate Shift+G).
- Catalogue: `node --import tsx scripts/gen-catalog.ts` writes `features.json`, `docs/settings.md`, README block, both `llms.txt`, site `tune.count.*` and `tune.adv`.

### 1.3 First visit today

Desktop: "Before you fly" (one OK) -> scene picker -> scan loads -> Controls screen "The scan is ready. How will you fly?" (4 devices) -> How to fly card. A touch device without HID skips Controls (touch). A returning pilot's device flies at once. Nothing asks about experience. Remembered: `gsfpv.warned`, radio profiles (with throttle style), `input.play` (easy | pilot, default easy = EasyPilot on touch, GameAssist on keyboard), `input.altitudeHelp`, `input.howToFly`, `flight.mode` (default angle). `input.throttleStyle` is not stored (`persist: false`; the truth is per controller).

### 1.4 Already there for simplicity

Easy play and the pilot school (`input.play`, `input.altitudeHelp`), centred throttle (`input.throttleStyle`, J), Angle as default, drone presets as defaults of the physics numbers, the "layers" part on the sound start screen, the accordion on phones. No "show more" in settings or pause menu.

### 1.5 Settings by proposed level (first = first-time, sim = sim pilot, expert)

Counts: first 10, sim +23 (33 visible), expert +42 (75 visible). Planned defs get a level now, used when shipped.

| Ids | Level | Why |
|---|---|---|
| ui.language, display.reducedMotion | first | reading and motion comfort come before flying |
| input.play, input.altitudeHelp, input.gameSpeed, input.mouseSensitivity | first | the beginner's own controls: easy play, height help, speed, mouse |
| input.howToFly | first | brings the key card back |
| crash.enabled | first | "no crashes" is the calmest way to learn |
| sound.volume | first | everyone needs it |
| drone.current | first | small or big drone is a plain choice |
| flight.mode | sim | Angle / Horizon / Acro is a sim pilot's first question; M still works for everyone |
| tune.rates, tune.throttle | sim | rates and throttle curve are what other sims call "rates" and "throttle expo" |
| camera.uptiltDeg, camera.fovDeg | sim | camera angle and FOV are set in every racing sim |
| input.stickMode, input.throttleStyle, input.haptics, input.mouseInvertY | sim | stick mode and throttle habit of a radio pilot |
| respawn.auto, respawn.target, respawn.keepArmed, battery.refill | sim | reset habits after a crash |
| wind.mode, wind.speed | sim | a known challenge knob |
| display.hud, crosshair.shape | sim | OSD taste |
| sound.motors | sim | motor sound on or off |
| scene.walls, scene.ceiling, scenes.autoSwitch | sim | where a scan can be flown; C toggles walls for everyone |
| recording.resolution, recording.auto | sim | DVR for sharing |
| level.angleLimitDeg, level.strength, level.horizonStrength | expert | already advanced; Betaflight-level tuning |
| tune.pid | expert | PID tuning |
| physics.twr, physics.tauMs, physics.dragScale, physics.ductDrag, physics.propInertia, physics.propWash, physics.idlePct, physics.gravity, physics.gravityMode, drone.payload | expert | model numbers; mean little without a real quad to compare |
| physics.vCrash, respawn.delayS, respawn.rewindS, respawn.platform, respawn.unstuck | expert | fine crash rules |
| wind.fromDeg, wind.gust | expert | detail of wind |
| crosshair.size, crosshair.color, crosshair.opacity | expert | detail of the crosshair |
| display.quality, display.drawing, display.budget, display.deviceClass, display.frameStats | expert | rendering; defaults pick per device |
| scenes.rotation, scenes.order, scenes.allowNoWalls, scene.transform | expert | scene library rules and scan scale |
| scene.dropFloaters, scene.ceilingM, voxels.show, voxels.style, voxels.opacity, voxels.opacityOnly | expert | collision-grid tools |
| recording.fps, recording.splitMin, recording.authorNotice | expert | video detail |
| planned: stats.onDisarm, display.units (sim); respawn.showPad, recording.folder, display.governor, display.latencyGuard, voxels.radiusM (expert) | as shown | level fixed now so a ship needs no new decision |

## 2. Design

### 2.1 How a pilot gets a menu, and changes it

- One new global setting `ui.menuLevel`: enum `first | sim | expert`, stored, shown in settings at every level
  (first row of Display), searchable ("menu", "simple", "advanced", "expert").
- Asked once, inside the existing "Before you fly" notice (no extra screen): "Have you flown FPV before?" with three
  buttons; each also accepts the notice. Fresh visitor default before answering: `first`.
- Inferred, never applied silently: when a radio or gamepad finishes the wizard, or a saved HID profile flies, and
  the level is `first`, the Controls screen shows one line "You fly a radio. Switch to the sim-pilot menu?" (Yes / No,
  asked once per level).
- "When he has got to know it": after 5 flights armed for at least 60 s each at level `first` (counter in the prefs
  store, not a setting), the pause menu shows one line "Show more of the menu?" (Yes / Not now; asked again after 10
  more flights, never more than twice). `sim` gets the same offer for `expert` after 20 flights.
- Change later: the Settings row, the "More" part of the pause menu ("Always show everything" link at its end), and
  `?focus=ui.menuLevel`.

### 2.2 What each level sees

| Screen | first | sim | expert |
|---|---|---|---|
| Before you fly | the question (3 buttons) | same | same |
| Controls | 4 devices, recommended one marked; Reverse, Switches and USB look under "More" | all, with sim terms in hints | all |
| How to fly card | keys of the input in use (as now) | + Mode 2 table and arm switch | same as sim |
| Pause menu | 8: continue, restart, scene, Controls, How to fly, Settings, Report, Fly by Sound | 16: + rewind, next scene, share, drone, replays, course, course on/off, sound (+rooms) | 24: + random, favourite, course load, save, measure, import, cinema, record |
| Settings | 10 rows + "Show all settings (65 more)" | 33 rows + "(42 more)" | 75 |
| HUD, top row | unchanged in release 1 | unchanged | unchanged |
| Fly by Sound list | 6 + "More settings" stop | 16 + the stop (open) | same as sim |

Pause menu rule: hidden items stay registered and stay in the DOM inside a collapsed `details` "More (n)"; their keys
(the menu binds an item's key while open, `app/menu.ts` `open`) and every global key keep working; Fly by Sound stays
at level first because it is the way in for blind pilots.

### 2.3 Nothing is lost

- Collapsed, never removed: settings rows above the level are rendered collapsed under "Show all settings"; the
  choice to open it lasts for the session.
- Search always searches all 75; a match above the level shows in place with a mark "In the full menu" and is
  usable at once (no level change).
- `?focus=<id>` of a hidden row opens the full list at that row (`focusTarget` keeps returning `row`).
- Keys never depend on the level (no KEYMAP change); shared links and imports still apply hidden settings.
- A hidden setting with a non-default value is shown at every level with a mark "Changed" so a pilot is never
  flying with an invisible change.

### 2.4 Words a pilot of another sim knows (shown as synonyms in search, and in help texts)

| Our name (id) | Other sims say | Source (opened page) |
|---|---|---|
| Flight mode Angle / Horizon / Acro (`flight.mode`) | Velocidrone: "Angle, Horizon or Rate"; Uncrashed: Acro / Angle, key A; DRL: beginner / intermediate / pro, "not an exact representation" of Angle, Horizon, Acro; DJI: Normal, Sport, Manual | velocidrone.com/mobile_manual; Steam Uncrashed 3816292165315812610; Steam DRL 1637536330477703760; droneblog.com/?p=1045936 |
| Camera uptilt (`camera.uptiltDeg`) | Velocidrone "Camera Angle", "camera tilt"; TRYP "angle ... of your camera" | apollomaniacs.com Velocidrone page; velocidrone.com/mobile_manual; Steam TRYP app 1881200 |
| Field of view (`camera.fovDeg`) | Velocidrone "Camera Field of View" | apollomaniacs.com |
| Rates (`tune.rates`) | Velocidrone "RC Rate", "Super Rate", "RC Expo", rate types actual, Betaflight, KISS; SkyDive "fine-tune your rates"; TRYP "Adjust your rates" | apollomaniacs.com; velocidrone.com/mobile_manual; Steam SkyDive 1278060; Steam TRYP 1881200 |
| Prop wash (`physics.propWash`) | Velocidrone "Prop Wash" (quad settings) | apollomaniacs.com |
| Drone physics numbers | Velocidrone "ADVANCED DRONE SETUP" from the in-game menu | apollomaniacs.com |

Keys: `set.<id>.also` per language (comma list, read by `searchText` only), e.g. `set.camera.uptiltDeg.also` =
"camera angle, camera tilt", `set.flight.mode.also` = "rate mode, self level, manual".

Other sims (opened pages): DJI Virtual Flight asks "beginner or a pro" on first launch and the beginner mode "explains everything in detail"; it can be restored in settings ("restore beginners guide") (droneblog.com/?p=1045936). DRL's developer says its beginner modes suit "no experience" and confuse experienced pilots (Steam DRL thread). Liftoff's developer said the old tutorials should be ignored and the tutorial drone needs much throttle on purpose (Steam Liftoff 3758850762509200041). Velocidrone has no beginner setup in its manual; "Profile 3" is a "softer prop profile for beginners" (velocidrone.com/mobile_manual). SkyDive's store page names "Flight School" (Steam 1278060).

### 2.5 Blind pilots (Fly by Sound start screen)

- The sighted question is not on the sound page. The list reads `ui.menuLevel` (default `first` for a new visitor).
- Level first: 6 stops (screen reader speaks, speech rate, calm, key hints, motor sound, captions), then a stop "More settings, 10 more. Enter opens." Enter opens a `details` like the layers part; the voice says "Opened. Item 7 of 17" and the next stop is the first newly shown one. Level sim and expert: open by default, 17 stops.
- "Item n of N" counts only the stops that are shown, as the layers part does now. Sound keys T U I Z G X, N, B, R long press do not change.

### 2.6 Words on screen (keys in `locales/fly/menu/<lang>.json`, en/es/pl/ru)

| Key | English |
|---|---|
| menu.level.ask | Have you flown FPV before? |
| menu.level.first | Never. Keep it simple |
| menu.level.first.hint | Few buttons, and the drone helps you fly. |
| menu.level.sim | Yes, in other simulators or for real |
| menu.level.sim.hint | Rates, camera angle, Acro and your radio, by the names you know. |
| menu.level.expert | Show me everything |
| menu.level.later | You can change this any time in Settings. |
| set.ui.menuLevel / .help | Menu / How much of the menus you see. Hidden items still work by their keys and by search. |
| set.ui.menuLevel.first / .sim / .expert | Simple / Sim pilot / Everything |
| menu.more / menu.fewer | More ({n}) / Fewer |
| prefs.showAll / prefs.inFull / prefs.changedHidden | Show all settings ({n} more) / In the full menu / Changed |
| menu.offer.radio | You fly a radio. Switch to the sim-pilot menu? |
| menu.offer.more | Show more of the menu? |
| sonic.settings.more | More settings, {n} more. Enter opens. |

## 3. Stages

Contract (lands first, on the base, like train 1's empty def files): `level: 'first' | 'sim' | 'expert'` in
`schema.ts` `Base`, required on every shipped def by `defineSettings`; `advanced` stays and must equal
`level === 'expert'` (checked) until the generator reads `level`; `MenuItem.level` in `app/context.ts`
(default `expert` when absent, so an item added later is never lost, only collapsed); setting `ui.menuLevel`.

| Branch | Owns | Does |
|---|---|---|
| A levels-schema | `packages/prefs/src/schema.ts`, `defs/*.ts` (the `level` field only), new `defs/menu.ts`, `defs/index.ts`, `packages/prefs/test/*`, `scripts/gen-catalog.ts` | field, check, the 82 levels of 1.5, `ui.menuLevel`, catalogue column; lead runs gen-catalog |
| B levels-ui | `apps/fly/src/ui/settings/*`, `ui/pause.ts`, `app/menu.ts`, `app/context.ts`, `ui/panels.ts`, `app/boot.ts`, `ui/radio.ts` (offer line), `item.level` in each `app/builtin/*` menu add, `locales/fly/menu/*`, `tools/bench/test/app-settings.test.ts`, new `app-menu-levels.test.ts` | question, settings filter, search marks, pause "More", offers |
| C levels-sonic | `apps/fly/src/sonic/start-screen.ts`, `sonic-start-screen.test.ts`, `tools/bench/src/sonic-v13-page.ts` | collapsed sound list |

First release (smallest useful): A + B without the two offers and without the Controls/How-to-fly changes: the
question, the Settings filter with search and "Show all", the pause "More", returning pilots at `expert`. Release 2:
C, the offers, synonyms, Controls "More".

Tests (each with a negative control that must fire):
- prefs: every shipped def has a level (planted def without one makes `defineSettings` throw); `LEVEL_TABLE` pins
  10 / 33 / 75 (a planted level change fails); `advanced` equals expert (a planted mismatch fails); defs length 83.
- settings model: `visibleDefs(schema, level)` counts; `matches` finds a hidden row; `focusTarget` of a hidden id is
  `row` (planted filter on search fails the test).
- pause menu (fake DOM): 8 / 16 / 24 visible buttons, all 24 in the DOM; F9 runs `pause.record` with the menu open at
  level first (planted "skip hidden items in open()" fails).
- i18n parity for the new keys (existing `fly-parity.test.ts`).
- Page probe `tools/bench/scripts/menu-levels-probe.mjs <base with /en>`: three fresh profiles answer the question
  with each button; each opens the pause menu (P) and Settings (O) and records visible counts, which must be three
  different numbers per screen; at level first, from flight, O then typing "uptilt" must show a focusable
  `camera.uptiltDeg` row (two actions), and O then "Show all settings" must too. Negative control: the same probe
  with all three profiles given `expert` must report "counts equal" and fail.

## 4. Risks and owner decisions

Risks: probes that press `warning-ok` (keep that action on the "first" button); "Item n of 16" pins and the sound
probe's N; a hidden changed value (handled by the "Changed" mark); two level fields while `advanced` lives.

Owner decisions (default in brackets):
1. Pilots who visited before this release: [`expert`, everything as today, one quiet chip "A simpler menu is in
   Settings"] or asked the question once.
2. Is `flight.mode` at level first? [no: sim; M and the mode chip still work for everyone].
3. The unlock offer: [after 5 flights of 60 s at first, 20 at sim; an offer, never automatic] or never offer.

## 5. Not verified

- Nothing was run: no tests, no build, no browser. Counts come from reading code; multi-line KEYMAP entries may be
  missed by the single-line count.
- Picker tabs, HUD lines per mode and feedback field counts per kind were not counted exactly; `pause.rooms` shows
  only when its `shown` flag holds (condition not read).
- Where a flight count could be stored for the offer; `stats.onDisarm` is planned and no stored flight counter was
  found.
- Competitor menus were not seen in the games: only the pages listed in 2.4 (manuals, store pages, Steam threads, one
  review). Nothing was found on an opened page about Liftoff's or TRYP's settings levels or a first-run question in
  Liftoff, Uncrashed, TRYP or SkyDive.
- Whether the sound page can read `ui.menuLevel` before its list is built (`sonic/start.ts` setup order).
