---
type: lane
status: plan
summary: "Throttle style for radios, gamepads and HID controllers: 'centred' (camera-drone feel, no arming gesture) or 'from zero' (FPV), auto by where the throttle rests; switched in five places. Owner's words of 2026-11-12."
created: 2026-11-12
---

# Lane center-throttle

Branch `center-throttle` from `origin/main` 6f33594, worktree `C:/dev/gsfpv-center-throttle`. Owner's words (2026-11-12): a DJI FPV Remote Controller 3 rests its left stick in the centre, the pilot does not know to lower it to arm; DJI camera-drone pilots need a "stick in the centre" style, FPV pilots keep "arm at zero throttle"; a DJI RC 3 should start as a camera drone; DJI screen controllers are not seen at all. Measured on the owner's PC: RC 3 = USB 2CA3:1021 with a HID game controller interface; 2CA3:0020 is the Avata 360 drone (no HID); no screen controller ever enumerated.

## 1. Today (origin/main 6f33594)

- **What the DJI pilot sees.** `knownProfile` (`packages/input/src/known-devices.ts:303`) maps the throttle linearly over the full range (`center: -1`, l.312), so the spring-centred stick reads `ch[2] = 0` (50 %). The DJI has no arm switch in the table: `arm` = `{kind:'key'}` or its start/stop button (l.322). `ArmGate.update` (`packages/input/src/calib.ts:1900`, l.1935) blocks with `'throttle'` while `(ch[2]+1)/2 > 0.05`. The HUD arm card (`apps/fly/src/ui/hud.ts:49-77`, class ArmCard) shows "To arm" with rows "Sticks let go", "Throttle down (50 %)" (`now`), "Flip the arm switch / Start/stop button" (`packages/i18n/locales/fly/en.json:195-214`). Nothing says why or offers another way: the pilot waits forever.
- **Arming for radios, gamepads, HID.** `Controls.raw` (`apps/fly/src/controls.ts`) maps the frame (`mapFrame`), `profileArmLevel` gives ch[4], `push` -> `prepare` (fill + optional `Controls.assist`, l.~400) -> `gate.update` -> `session.input(out)` (`apps/fly/src/session/index.ts:814`, the flight log). `Controls.play` ('easy'/'pilot') is never read for these sources.
- **Easy play (keys, touch).** `EasyPilot` (`apps/fly/src/play/easy.ts`): `AutoArm` (`play/assist.ts:256`, request -> edge -> arming with throttle held low -> on, retry 400 ms) and `AltitudeHelp` (`assist.ts:96`, vertical-speed PI, angle only via `helpFlies`). Keyboard game scheme: `GamePilot` (`play/game-pilot.ts`) with `GameAssist` (`play/game.ts:205`: velocity loop, "no keys: the loop brakes and holds", height by AltitudeHelp, caps from `input.gameSpeed`). Prefs `input.play`, `input.altitudeHelp`, `input.gameSpeed` (`packages/prefs/src/defs/play.ts`).
- **The same machinery already flies radios:** Fly by Sound's `LessonPilot` (`play/lesson-pilot.ts:118`) is installed in `Controls.assist` for every source by `InputHost.setLesson` (`apps/fly/src/app/input.ts:139-166`): `intentsOf` (l.107, deadband 0.08) reads the radio's channels as intents, AutoArm starts the motors on the first intent (`flyingIntent`, throttle above `START_LIFT` 0.25), 'velocity' = GameAssist (stops and holds), 'angle'/'horizon' + 'hold' = pilot's sticks with AltitudeHelp, 'own' = raw throttle, landing stops the motors. `setLesson(null)` sets `Controls.assist = null`.
- **What the wizard knows about rest.** Step 'centre' (`calib.ts` l.~1140-1159) stores each channel's rest (`this.rest[c]`) and `results.centre = {centres:[{ch,pct}], end}`; thresholds `TUNING.CENTRE_TOL` 0.15 and `END_TOL` 0.10 in halves of the range, stillness `STILL_TOL` 0.04 for `STILL_MS` 500 (l.155-170; docs/research/wizard-v3-user-paced-spec.md 3.3). The throttle's rest is not kept in the `Profile` (`calib.ts:62`): `buildProfile` (l.1548) sets throttle `center` to its low end. The check step's checks: `throttleLow`, `armOn`, `centred` (l.1617).
- **Known device.** `recognise` -> `knownProfile` (`known-devices.ts:254,303`); the table already says `throttleSprings: true` for the DJI (l.143, measured: Z exactly 0 between stirs; rest offsets X -11, Rx -8 of 660). `throttleSprings` is read nowhere today. The mode switch N/S/M = angle/horizon/acro (l.147, assumed bits 6/7).
- **Where things are built.** Controls screen, radio-in-use panel (Fly / Recalibrate / Reverse): `apps/fly/src/ui/radio.ts:255-267`. Check screen (wizard's last screen, and the known setup's only screen): `radio.ts` ~l.500-910, its mode-switch row `ui/mode-switch-row.ts` (l.910). Settings screen: generated from the schema (`ui/settings/model.ts`, deep link `?focus=<id>`, `screen.ts:158`). Summary panel = pause menu (`ui/pause.ts`, `ui/summary.ts` `modeChip` l.59, keys block l.89 lists every keymap binding). HUD mode chip: `ui/mode-chip.ts` (popover with the three modes and M). Arm card: `ui/hud.ts` ArmCard + `gateText` l.146. Builtins wiring settings to runtime: `app/builtin/*.ts` (modes.ts, play.ts).
- **Free keys.** Keymap `packages/prefs/src/keymap.ts`: used P Esc R Y Enter N Shift+N Shift+F M Space V C H [ ] F9 F3 O B L K F, sonic-only T U I Z G X, flying keys in `play/keys.ts` (W A S D Q E arrows Shift). **J** is bound nowhere (grep of apps/fly/src, packages/prefs, packages/input).
- **Recording and determinism.** Assists are input: `session.input` records the post-assist `out`, a replay replays channels and never runs an assist (`assist.ts` header); `a6-reference.test.ts` checks sim-core only. A new path in `Controls.assist` needs no `SIM_CORE_VERSION` bump, as lessons did not.

## 2. Design

- **Preference** `input.throttleStyle`: enum `auto | centred | zero`, default `auto`, scope global, `persist: false`, `apply: 'live'`, `action: 'throttle.style'`, shown `settings, key, controls`. The store holds the style of the controller in use; the truth is per controller in its `Profile`: new optional `throttleStyle?: 'centred' | 'zero'` (pilot's choice; absent = auto) and `throttleRest?: 'centre' | 'bottom' | 'parked'` (measured). A new builtin `app/builtin/throttle-style.ts` copies the profile's choice into the store on every input change and writes a store change back into the profile (`saveProfile`). Profile stays version 1; `checkProfile` drops unknown values of both fields. Touch and keyboard: the setting does nothing (easy play already flies them); the row says so.
- **Detection (auto).** Resolved style = pilot's choice, else the rest seen on this connection, else `Profile.throttleRest` (wizard / known check), else the known table's `throttleSprings` (DJI -> centred), else `zero`. Rest rule on mapped `ch[2]` (-1..1, half range = 1): still = within `STILL_TOL` 0.04 for `STILL_MS` 500 (reused from `calib.ts` TUNING); `|ch2| <= CENTRE_TOL` 0.15 -> centre; `ch2 <= -(1 - END_TOL)` = -0.9 -> bottom; else parked (parked counts as zero). The DJI's measured offsets (1.7 %, 1.2 %) are inside 0.15. Connection rest is taken once, from the first still window while disarmed; it never changes the style in flight. Wizard: the throttle channel's `rest` from step 'centre' is saved as `throttleRest`; the known check screen saves the rest seen there.
- **Flight mapping (centred).** New `play/centre-pilot.ts`: a `CentrePilot` that owns one `LessonPilot` and, every frame, sets its assists from `Controls.flyingMode()` (the mode switch keeps working): angle -> `{control:'velocity', altitude:'hold', autoArm:true}` with caps from `input.gameSpeed` (`GAME_SPEEDS`, `KEY_TURN_DPS`), i.e. DJI Normal: sticks ask a speed, let go brakes and hovers; horizon -> `{control:'horizon', altitude:'hold'}` (own sticks, height held, idle when tipped: `UPRIGHT_MIN_COS`); acro -> `{control:'acro', altitude:'own'}` (raw throttle). Ground below by `play/ground.ts` `groundClearance` every 33 ms (as GamePilot), not lesson rays. Installed by `InputHost` in `Controls.assist` for hid and gamepad when the resolved style is centred and no lesson runs; a lesson replaces it and `setLesson(null)` puts it back. No new flight assist and no sim-core change.
- **Motor start and stop (centred).** AutoArm starts the motors on the first deliberate move (`flyingIntent`: a stick out of the 0.08 deadband or the throttle above 0.25). The radio's arm switch or the DJI start/stop button is not needed; its on->off edge stops the motors (`AutoArm.stop`); landing (hold down on the ground, `GameAssist.landed`) stops them too. A style flip while the motors run waits for the next disarm, crash or respawn (the chip says "after landing"); on the ground it applies at once.
- **Acro notice.** In centred style and acro the HUD shows one line: "Acro: the throttle is direct, the centre is half power."
- **The five places, one wording.** Names: centred = "Stick in the centre (camera drone)"; zero = "From zero (FPV)"; auto = "Automatic (by where your stick rests)". Explanations: centred = "The left stick springs to the centre: centre holds the height, up climbs, down descends. Let go and the drone stops and hovers. The motors start when you move a stick." zero = "As FPV pilots fly: the motors start (this is called arming) only with the left stick all the way down, and the stick sets the motors' power."
  - (a) Arm card: style zero, block `'throttle'`, `ch[2]` within 0.15 of the middle, still for 3 s (an estimate, to be checked on the owner's controller) -> the card adds "Your left stick is resting in the centre." "To fly like FPV, lower it all the way down: that starts the motors (arming)." and one button "Fly with the stick in the centre" (sets the profile's choice to centred).
  - (b) Controls screen, radio-in-use panel: a two-button choice (radio group) with the two names and one explanation line each, the current one pressed, "Automatic" noted under it when no choice was made.
  - (c) Settings screen: the schema row in group input, help = both explanations; deep link `?focus=input.throttleStyle`; the summary panel gets a row next to the mode chip: "Throttle: Stick in the centre".
  - (d) HUD mode chip: a second line with the style ("Stick in the centre" / "From zero"); its popover gets the two choices and the key J; J flips centred <-> zero (keymap `throttle.style`, label "Throttle: stick in the centre or from zero"); the pause menu lists J through the keymap.
  - (e) Check screen: a row "Throttle stick: rests in the centre, so you fly with the stick in the centre (camera drone)." / "... rests at the bottom, so you fly from zero (FPV)." with a button "Change to <other name>".
- **Strings** in `packages/i18n/locales/fly/` (new file `throttle/{en,es,pl,ru}.json`, plus mode-chip and arm lines); no "arm" without "start the motors". Catalogue generator rerun (README.md, llms.txt, docs/settings.md, features.json).

## 3. Build stages

**Stage 1, logic (no DOM).** Owns: `packages/input/src/throttle-style.ts` (rest classifier, `RestWatch`, `resolveStyle`), `packages/input/src/calib.ts` (save `throttleRest`), `known-devices.ts` (export `throttleSprings` to `resolveStyle`), `packages/input/src/index.ts`, `apps/fly/src/play/centre-pilot.ts`, `apps/fly/src/app/input.ts` (install, lesson precedence), `apps/fly/src/controls.ts` (Profile fields in `checkProfile`), `packages/prefs/src/defs/play.ts` (the setting), `packages/prefs/src/keymap.ts` (J), `apps/fly/src/app/builtin/throttle-style.ts`. Tests: `packages/input/test/throttle-style.test.ts` (DJI rest -11/-8/0 of 660 -> centre; Z at -660 -> bottom; 30 % -> parked; a moving stick decides nothing; choice beats rest beats table), `tools/bench/test/app-centre-throttle.test.ts` (real Sim, DJI channel stream with the throttle at 0 and no arm switch: armed after a pitch push; let go -> horizontal speed < 0.3 m/s within 3 s and height within 0.5 m of where it stopped; acro -> `out[2] == ch[2]`; horizon holds height; a lesson replaces it and `setLesson(null)` restores it; the recorded channels replay to the same trace hash), keymap/catalogue tests updated. Negative controls: the same stream with style zero never arms (block 'throttle'); CentrePilot with angle mapped to plain attitude (no velocity loop) drifts past the 0.3 m/s bound; the test files fail to load on origin/main.

**Stage 2, the five places.** Owns: `apps/fly/src/ui/hud.ts` (arm card offer, acro line), new `ui/arm-offer-logic.ts` (pure: when the offer shows), `ui/mode-chip.ts`, `ui/summary.ts`, `ui/radio.ts` (in-use panel choice, check row), new `ui/throttle-style-row.ts`, locales, catalogue output. Tests: `tools/bench/test/app-centre-throttle-ui.test.ts` (offer appears after 3 s still in the centre, not after 2.5 s, not when the stick moves, not in centred style; every new key in en/es/pl/ru; every en line with "arm" also says "motors"), `app-keys`, `app-summary`, `app-settings` updated. Negative control: the offer test with the old hud logic (no offer) fails; strings test with one locale missing fails. **Page probe**: two new runs in `tools/bench/scripts/hid-source-probe.mjs` with the fake DJI: `dji-centred` (throttle at the middle as shipped): check row says centred, Fly, chip "Stick in the centre", no arm card, a pitch push arms, J shows the arm card and after 3 s the offer, its button returns to centred; `dji-zero` (throttle held at -660 during connect): from zero, the classic arm card. Negative control: `dji-centred` against an origin/main build fails its chip and arming checks. Headless, under `C:/dev/.gpu-lock`.

## 4. Risks

- Gamepads: their left stick springs to the centre, so auto turns every saved gamepad to centred on its next connection. That is the owner's wish for spring sticks, but a gamepad FPV habit changes; J and the arm card flip it back and it is saved.
- A radio whose throttle rests mid without a spring (parked) stays from zero by rule; a pilot parking it at exactly the centre before connecting gets centred (one J press away).
- Velocity control commands tilts only angle mode makes; the DJI's S position (horizon) flips at full stick while the height is held: idle when tipped protects it, a person should try it.
- Conflicts: `play/lesson-pilot.ts` is reused, not edited; `app/input.ts` `setLesson` is touched (the sonic-beacon lane owns `apps/fly/src/sonic/**` only). J could be taken by another lane before the merge.
- 3 s for the offer and the 0.3 m/s / 0.5 m test bounds are estimates.

## 5. Screen controllers (owner's second question)

Not in this lane's build. Known (docs/research/radios/dji-rc3.md l.143-163): the DJI RC 2 screen controller enumerates as 2CA3:1021 with no HID interface (MTP, ADB, a DUML bulk interface), so no browser game-controller API can see it; the owner's PC never enumerated one at all (powered off or a charge-only port is possible). Possible routes, each needing a measurement on the owner's PC first: WebUSB on the bulk interface (Windows needs a WinUSB driver bound, which may break DJI's own apps), or Web Serial if a DJI VCOM port appears. Proposed: a separate research lane that plugs one in powered on and records what Windows lists. Stage 2 may add one plain line on the Controls screen: "DJI controllers with a screen do not show up as game controllers yet."

## Status

- [x] P1 worktree `C:/dev/gsfpv-center-throttle`, branch `center-throttle` from origin/main 6f33594 (no install yet)
- [x] P2 plan by code (this file, 4e4e7af)
- [ ] S1 logic: throttle-style.ts, wizard rest, CentrePilot, InputHost, the setting and J, builtin; tests and negative controls
- [ ] S2 the five places, strings in 4 languages, catalogue; UI tests; probe `dji-centred` / `dji-zero` with negative control

## For the lead before the merge

- The spoken settings list of Fly by Sound (sonic lane) could offer `input.throttleStyle`; not edited here.
- Screen controllers: a research lane (section 5).

## Decisions

- Velocity control (GameAssist) for angle and height hold only for horizon, so "stops drifting" holds in DJI's N position and S stays a plain attitude mode with height hold.
- One stored truth per controller in `Profile`, the setting `persist: false` as its view, so every surface reads one store key.
- Reuse `LessonPilot` unchanged (composed) instead of a second assist or editing a sonic-adjacent file.
- Rest thresholds reused from the wizard's TUNING, no new numbers except the 3 s offer delay (estimate).
- In flight a flip waits for the ground, so a flip never drops the drone.
- J for the flip key: the only letter free in every context.

## Not verified

- That the owner's RC 3 still rests at the centre today (the evidence is the 2026-10-15 recording).
- The DJI mode switch bits (assumed in the table) and the start/stop button bit, used for the stop edge.
- How the velocity loop feels at the DJI's 1.2-1.7 % rest offsets (inside the 0.08 deadband by numbers only).
- Anything about screen controllers on the owner's PC.

## Cost notes

- Plan stage: most turns went to locating the five UI places and the existing lesson machinery; a map of `Controls.assist` users and UI owners in STATE.md would have saved about five reads.
