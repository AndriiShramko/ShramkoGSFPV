# Research A: facts for v0.3 (items 3, 7, 13, 15, 16, 18, 20, 23)

Read-only study of the working tree on 2026-09-25 (uncommitted "radio wave" included). Line numbers are
of the current files. Two reproductions were run in Node against the real `FlightSession` class with a
stub renderer (`.cache/v02/freeze-repro.ts`, `.cache/v02/safepoint-repro.ts`, run with
`cd apps/fly && ../../node_modules/.bin/tsx ../../.cache/v02/<file>.ts`). No dev server was started.

## 0. Three defects found on the way (all reproduced, numbers below)

1. **Sim frozen after any rebuild done while paused** (explains item 22, second half: "I change
   something in settings and the throttle stops working, only arming works").
   `buildSim()` sets `t0 = performance.now()` (session.ts:387); `pause(false)` then adds the whole pause
   length on top: `t0 += now - pausedAt` (session.ts:416). Every caller rebuilds while paused and
   resumes afterwards: Settings Apply (main.ts:405-406), Restart (main.ts:379), Drone pick
   (main.ts:387-391), Betaflight import (main.ts:443 inside the paused import panel, main.ts:449-450),
   bake (main.ts:221, session.ts:510, main.ts:246). Result: `toSimUs(now)` is negative for as long as
   the menu was open, so `advanceTo()` takes no step.
   Measured: pause 30 s, Apply -> `t0 - now = 30000 ms`; tick stays 0 at +1 s and +29 s; first physics
   tick at +29 990 ms. Arm-off/arm-on/throttle samples sent during the freeze all land on the first tick
   (runner.ts:165-170 keeps only the last), the sim never sees the off->on edge (sim.ts:154, 182), so
   after the freeze the craft is still DISARMED (`armed 0` at +31 s). Control: the same rebuild without a
   pause steps normally (110 ticks after 110 ms).
2. **Settings panel shows and re-applies wrong values**: `settingsFrom()` hard-codes `hud: true`
   (main.ts:103), `quality: 0.7` (main.ts:105) and reads `reducedMotion` from `matchMedia` again
   (main.ts:111). Reopening Settings and pressing Apply turns the HUD back on, resets reduced motion,
   and LOWERS quality: at load the effective quality is 1.0 (`userMaxScale = renderScale = 1`,
   `userBudget = 4`, main.ts:281-282) but the panel says 0.7 and Apply writes scale 0.85 / budget 3.1
   (main.ts:400-401).
3. **Safe point almost never updates**: `trackSafePoint()` runs once per rendered frame and returns
   unless the frame ends exactly on a multiple of 500 ticks (session.ts:471). Measured over 60 s of
   hover (ideal 120 updates): regular frames 0 / 0 / 0 at 30 / 60 / 144 Hz; with +-2 ms jitter 4-6 at
   30 Hz, 3-5 at 60 Hz, 12-22 at 144 Hz. So "From the last safe point" (main.ts:330) is usually 10-20 s
   old or absent. Any "5 s before the crash" feature must sample per tick (Runner.onStep,
   runner.ts:111-112, 187), not per frame.

## (a) Every user-tunable setting today

| Setting | UI | Lives in | Persists? |
|---|---|---|---|
| Language | Settings select (flight.ts:182-185) | cookie `NEXT_LOCALE`, 1 year (i18n.ts:35-41) | yes; the change reloads the page (flight.ts:185), which drops all overrides |
| Camera FOV 70-150 | slider (flight.ts:238) | `session.overrides.fovDeg` (main.ts:403) | no (memory) |
| Camera uptilt 0-50 | slider (flight.ts:239) | `overrides.uptiltDeg` | no |
| Show HUD | checkbox (flight.ts:240) | `hud.visible` (main.ts:398) | no; panel always shows `true` (main.ts:103) |
| Units | field exists (flight.ts:169), no control | always 'metric' (main.ts:104) | n/a |
| Quality 0-1 | slider (flight.ts:225) | `userMaxScale/userBudget` (main.ts:400-401) | no; panel always shows 0.7 |
| Gravity earth/moon/mars/zero | select (flight.ts:195-197) | `overrides.gravity`; also `?g=` (main.ts:172-179) | URL only if typed |
| Gravity mode honest/same-TWR/auto-throttle | select (flight.ts:199-201) | `overrides.gravityMode`; `?gm=` | URL only if typed |
| Crash threshold 2-10 m/s | slider (flight.ts:230) | `overrides.vCrash` -> `params.vCrash` (params.ts:185) | no |
| Motor tau 8-30 ms | slider (flight.ts:231) | `overrides.tauMs` | no |
| Drag x0.5-2 | slider (flight.ts:232) | `overrides.cdaScale` | no |
| PID P/I/D/F x3 axes | 12 inputs (flight.ts:215-222) | `overrides.pid` | no; kept when the drone changes (main.ts:387), so another drone inherits them |
| Reduced motion | checkbox (flight.ts:212-214) | `crash.reducedMotion` (main.ts:399) | no; re-read from the OS each time |
| Drone preset (6) | Drone picker (drone.ts) | `session.presetId` + `?drone=` via replaceState (main.ts:388-390) | URL only; "Change scan" does `location.search = ''` (main.ts:380) and loses it |
| Rates / PID / throttle mid+expo from a BF diff | Import panel (main.ts:435-463) | `overrides.rates/pid/throttle` | no |
| Cinema mode | pause item (main.ts:422-426, 472-482) | `cinemaOn` | no |
| Frame stats | F3 (main.ts:515) | Hud class toggle | no |
| Quality governor | `?governor=0` only (main.ts:278) | `governor.enabled` | URL only |
| Radio profile (axes, inversion, arm input) | wizard | localStorage `gsfpv.profiles.v1` by device key (controls.ts:10, 30-47); download/load file (controls.ts:53-73) | yes |
| Stick mode 1/2 (drawings only) | wizard button (radio.ts:288) | localStorage `gsfpv.stickMode` (controls.ts:11-28) | yes |
| Angle mode (radio) | none: the wizard writes `angleMode: null` (calib.ts:931) | `mapFrame` ch[5] (calib.ts:1163) | radio pilots are always ACRO |
| Angle mode (keyboard) | M toggles (keyboard.ts:36) | KeyboardSource field | no |
| Angle mode (touch) | fixed ON (touch.ts:13) | - | - |
| Scene history, favourites, picker filter | picker (ui/scenes.ts) | localStorage `gsfpv.history.v1` / `gsfpv.favourites.v1` / `gsfpv.filter.v1` (scenes/index.ts:164-166) | yes |
| First-visit warning | modal | `gsfpv.warned` (main.ts:146, 153) | yes |
| Last saved flight log | crash overlay "Save" | `gsfpv.lastLog` (main.ts:671) | yes (one) |
| Scene settings / walls cache | automatic | Cache Storage `gsfpv-scenes-v1` (scenes/index.ts:65, 70-95) | yes |
| Render scale | `?scale=` (main.ts:182) | renderer | URL only |

Nothing else is persisted. `navigator.hid.getDevices()` (the call that returns an already granted radio
without the chooser) is declared (webhid.d.ts:30) but never used.

### Why item 20 happens ("Crash threshold and other settings come back to defaults after a while")

1. All physics/camera settings live only in `session.overrides` (session.ts:119). Any page reload loses
   them: "Change scan" (main.ts:380), a language change (flight.ts:185), Retry/Back on the loading screen
   (main.ts:167-168). Changing the scan is the everyday path, so "after a while" = the next scan.
   (Not verified, possible extra path: Chrome Memory Saver discarding a background tab also reloads it.)
2. Reopening Settings shows HUD/quality/reduced-motion defaults and Apply writes them back (defect 2).
3. Closing Settings with the X throws the edits away (flight.ts:181 only resumes; Apply at flight.ts:242).
4. Every Apply rebuilds the flight model at the spawn with a fresh log (main.ts:404-405 ->
   session.ts:394-400), even for FOV or HUD, and then freezes the sim (defect 1).
Reset-one/reset-all needs the preset value per field: `PRESETS[id].fields[key].value`
(params.ts:7-22) is the default for physics fields; UI-only fields need their own defaults table.

## (b) Angle / horizon: ours vs Betaflight 4.5.1

Ours (sim.ts): ch[5] > 0.5 = angle mode on roll and pitch (sim.ts:8-10, 213-222); target =
`ch * 55 deg` linear (ANGLE_MAX_DEG, sim.ts:91), setpoint = `(target - current) * 5` deg/s
(ANGLE_GAIN, sim.ts:92); yaw stays a rate axis; no horizon; no angle feedforward; the rate PID's F term
still acts on the changing angle setpoint (sim.ts:400-406). HUD label reads `sim.ch[5]`
(flight.ts:101). Mode is a channel, so it is already in the input log (runner.ts:31, 177) and a mode
chosen in the UI can be injected in `Controls.push` (controls.ts:142-153) without breaking replays.

Betaflight 4.5.1 (source at tag 4.5.1; copies in `.cache/v02/bf/`):
- `angle_limit` default 60 deg, CLI range 10-85 (pid.c:138; settings.c:1169). Angle target =
  `angle_limit * acroSetpoint / maxRate`, i.e. the acro rate curve (expo) shapes the stick-to-angle map
  (pid.c:387-388, maxRcRateInv from pid_init.c:254).
- Level strength `angle_p_gain` = `pid[PID_LEVEL].P`, default 50 -> angleGain = P/10 = 5 deg/s per deg
  (pid.c:128 `[PID_LEVEL] = { 50, 75, 75, 50 }`; pid_init.c:286; settings.c:1166). Our 5 matches.
- `angle_feedforward` = PID_LEVEL.F 50 -> gain 0.5 (pid_init.c:287), PT3 filtered with cutoff
  1000/(2*pi*angle_feedforward_smoothing_ms=80) ~ 2 Hz (pid.c:224, pid_init.c:242-243, pid.c:381-384).
- Output `angleRate` PT3 filtered at ATTITUDE_CUTOFF_HZ = 50 (pid_init.c:57, 241; pid.c:408).
- `angle_earth_ref` 100 (pid.c:225): yaw setpoint scaled by cos(max angle target) and fed into
  roll/pitch via sin(other axis target) for coordinated turns (pid.c:399-404, 903-915).
- Rate-PID feedforward is forced to 0 on axes in angle mode (pid.c:998-1009); ours is not.
- Horizon: strength = max((horizon_limit_degrees - inclination)/limit, 0)
  * max((horizon_limit_sticks - maxStickDeflection)/limit_sticks, horizon_ignore_sticks)
  * horizon_level_strength, then a PT1 with `horizon_delay_ms` on increases only (pid.c:347-366);
  setpoint = acro*(1-s) + angleRate*s (pid.c:413-414). Defaults: `horizon_level_strength` = PID_LEVEL.I
  75 -> 0.75 (pid_init.c:290; settings.c:1172), `horizon_limit_sticks` = PID_LEVEL.D 75 -> leveling
  gone at 75 % stick (pid_init.c:293-294; settings.c:1173), `horizon_limit_degrees` 135 (pid.c:151),
  `horizon_ignore_sticks` off (pid.c:152), `horizon_delay_ms` 500 (pid.c:226).
- `level_race_mode` (settings.c:1234): angle on roll only (pid.c:815-819, 898-901).
- Acro trainer (angle limit in acro, default 20 deg, pid.c:161, 527-560) exists too.
Velocidrone describes its Horizon as "at 80% of stick throw the self levelling deactivates" and binds
Angle/Horizon/Rate/Acro to keys 1-4 plus a click on the on-screen bank box that cycles modes (manual,
vd.txt:1127-1134) - the same interaction as item 15.

## (c) Other simulators

| Behaviour | Liftoff | VelociDrone | Uncrashed | DRL Sim |
|---|---|---|---|---|
| Start / spawn | Walking mode: place the drone anywhere before take-off (0.5.0, 2016-06-24) [L1]; custom spawn points (0.3.4) [L2] | Combat spawn pads (vd.txt:1371-1377); E = custom reset point at the current position; Shift+L lock/unlock quad in place (vd.txt:1601, 1607-1609) | Bindable "save the current location for future respawn points" (2.3, 2024-12-09) [U1] | Podium start ("drones briefly getting stuck on podium"), "respawned in the air" fixed as a bug (3.1) [D1] |
| Crash respawn | R reset; reset delay "in game it takes 3 seconds" (dev, 2016-06-05) [L4]; multiplayer race: results screen 2 s after pressing reset (was 3 s, 0.7.2) [L3] | Auto arming (default): "always armed", crash -> "automatically reset to the last gate"; manual arming: no reset, turtle mode (vd.txt:773-780) | Reset faces the next gate; double reset -> last valid gate (2.22, 2.4) [U2][U3] | R = reset/unflip, Alt+R = restart (DRL staff, 2019-10-21) [D2]; "Fast Race Restart" toggle (3.2) [D3] |
| Auto reset when stuck | Dev: resets itself "after crashing at a certain speed" or "when you are laying still with the top part of the drone against something (i.e. upside down on the ground, or sticking against a wall)" (2018-10-17) [L5]; cannot be turned off, it "mostly serves those who are new" (2018-01-23) [L6] | not found | not found | not found |
| Crash off | "God mode" since 0.2.0 [L7] (no drone destruction: room option "allow god mode" vs "drone destruction mayhem", 0.6.1 [L14]); Purist Race disables it (0.10.14) [L8] | Prop damage only in Single Class, 25 % steps (vd.txt:825-829) | Default was bump-not-crash; "Propeller damage -> Disabled" option added 2025 (dev Riodeluz, 2025-05-20) [U4] | not found |
| Rewind | T: "rewind the path of your drone for up to 10 seconds, and afterwards continue flying" (0.12.6, 2017-11-29), can be disabled per room/purist [L9]; key moved to Y (1.2.8, 2020-02-19) [L10] | not found | not found | not found (replay markers for crashes, 4.1) |
| Post-flight stats | Replay save after reset / on finish screen (1.3.0) [L11]; "flight log" with lipo state (0.12.8) [L12]; OSD stats screen: not found | "End of race statistics" setting (vd.txt:287) | not found | Fastest/slowest lap, number of crashes, finish percentile (3.9) [D4] |
| Mode memory | not found | modes on keys 1-4 (vd.txt:1127-1134) | "Flight modes (ACRO/Angle/3D) preferences are now retained across maps" (2.21) [U5] | not found |
| Shortcut display | Shortcuts listed in Button Setup (0.12.6 re-ordered them [L9]); defkey: Esc pause, R reset, Y rewind, A flight mode, V view, B LOS [L13] | Full table in the manual, "only operational in flight mode" (vd.txt:1551-1611) | not found | "Improved Keyboard Shortcuts with better documentation" (3.2) [D3] |
| Shortcut next to each menu item | not found in any of the four | | | |

### Betaflight OSD post-flight stats (4.5.1)
Order (osd.c:171-203): date/time, TIMER_1 (default "ON TIME"), TIMER_2 (default "TOTAL ARM")
(osd.c:111-116, 321-324), MAX ALTITUDE, MAX SPEED, MAX DISTANCE (from home), FLIGHT DISTANCE,
MIN BATTERY, END BATTERY, BATTERY, MIN RSSI, MAX CURRENT, USED MAH, BLACKBOX, BB LOG NUM, MAX G-FORCE,
MAX ESC TEMP, MAX ESC RPM, MIN LINK, PEAK FFT, MIN RSSI DBM, MIN RSNR, TOTAL FLIGHTS, TOTAL FLIGHT TIME,
TOTAL DISTANCE, USED WATT HOURS, BEST 3 CON, BEST LAP, 100% THRT TIME, 100% THRT COUNT, AVG THROTTLE
(labels osd.c:808-1042). Default ON: MAX SPEED, MIN BATTERY, MIN RSSI, MAX CURRENT, USED MAH, BLACKBOX,
BB LOG NUM, TIMER_2 (osd.c:335-343) plus the three throttle stats with USE_RC_STATS (osd.c:358-362).
Shown on disarm under "--- STATS ---" (osd.c:1092), for 60 s (osd.c:1231-1232), dismissed early by
throttle high, pitch high or the crash-flip switch (osd.c:1285-1291); suppressed after a
crash-detected disarm when the warnings element is visible (osd.c:1226-1230).
Computable in our sim per tick: armed time (ticks with S.armed), max altitude over spawn (S.py -
spawn[1]), max speed, max distance from spawn, flight distance (sum |dp|), min/end voltage (S.volt),
max current (S.amps), used mAh ((1 - S.soc) * capacity, soc survives respawns: sim.ts:165-171), max G
(dv per tick / g), full-throttle time/count and average throttle (sim.ch[2]); sim-only: crashes and
impact speeds (crash events, sim.ts:536-539), respawns, contacts.

## (d) How session / runner can carry items 16, 18, 23

Current facts:
- Spawn = the scene's authored camera, pushed out of walls (session.ts:352-365). `Sim.reset` parks the
  craft with `hold = 1`: no forces until the first arm (sim.ts:155, 194-197). Arming needs throttle
  <= 5 % (sim.ts:182-183), so the craft drops the moment it is armed - item 16.
- Respawn is logged: `Runner.respawn` pushes an odd-time record `tick*1000+1` with x, y, z, yaw rounded
  to float32 and then applies the SAME rounded values (runner.ts:137-143, record format runner.ts:31).
  Replay applies odd records before the next step (runner.ts:224-227; session.ts:535). Record order is
  monotonic (inputs for tick k have t = k*1000, respawn k*1000+1, next inputs (k+1)*1000). So ANY
  respawn - manual, automatic, "5 s earlier" - is replay-exact as long as it goes through
  `Runner.respawn`; the decision itself does not need to be deterministic, only logged.
- The trace hash covers the whole 50-double state after every tick (sim.ts:49-66; runner.ts:122, 185).
  Adding state slots (platform) changes every hash even when behaviour does not: bump
  `SIM_CORE_VERSION` (index.ts:10) and re-baseline A6 (reference d3d4e0e3..., evidence a6); old saved
  logs are then refused by `startReplay` (session.ts:518) - acceptable, but say so.
- `Sim.respawn` = full reset (level, zero velocity, filters and I-terms zeroed, `hold = 1`,
  `armSw = 1`) keeping only the battery (sim.ts:145-156, 165-171). `sim.ch` is NOT reset, so with the
  arm switch still on there is no off->on edge: after every respawn the pilot must flip the switch off
  and on (sim.ts:154, 180-188), and the page's ArmGate needs its own rising edge too
  (calib.ts:1223-1233, `crashed` block calib.ts:1229). This is the "button press" item 23 wants gone.

Invisible platform (16, 23):
- Must live inside sim-core (determinism). Cleanest reuse: a `ContactWorld` wrapper (interface
  sim.ts:28-38) that adds a horizontal disc at the platform height to `sweep`/`pushOut`, so resting,
  friction, bounce and "hard landing = crash" use the same contact code as a real floor
  (sim.ts:428-567). Its on/off state and position must be in `s` (hashed): e.g. platform x, y, z, radius,
  on. Turn it off deterministically when the craft rises above it by a margin or leaves the disc
  footprint (a function of state only).
- Resting contacts produce no events: a resting craft approaches at g*dt = 0.0098 m/s per tick, below
  the 0.05 m/s event threshold (sim.ts:540). No event spam from sitting on the platform.
- Must be opt-in: `measureTwr`, `dropTest`, `tunnelSelfTest` and the A-series harnesses call `reset()`
  and rely on `hold` / free fall (session.ts:581-615, 654-656). Carry the flag in the respawn record's
  unused ch[4..7] (runner.ts:140 writes zeros there, so old logs mean "no platform") and in the log
  header for the initial spawn (session.ts:367-377).

Rolling history for "respawn 5 s before the crash" (23):
- Respawn-at-position (level, still, on a platform) needs only (tick, x, y, z, yaw, safe?) samples, e.g.
  every 100 ms for 10 s, taken in `Runner.onStep` (runner.ts:111-112, 187; currently unused by the app).
  Reuse the safe-point test (sphere + 5 cm clear, `isFreeAt`, armed, no contact for 0.5 s:
  session.ts:469-477) per sample, and pick the newest safe sample with tick <= crashTick - 5000, falling
  back to older ones, then the spawn. The existing single `safePoint` is too stale to use (defect 3).
- A Liftoff-style rewind that continues WITH velocity and attitude cannot go through the current record:
  36-byte records carry float32 only (runner.ts:31, 37). Deterministic option: log "restore snapshot
  of tick k" and keep the same snapshot ring (full `s`, every N ticks) in both the live runner and
  `replay()` - both compute identical states, so the hash still matches.
- Memory note: `runner.trajectory` grows without limit, one object per 10 ticks (session.ts:386,
  runner.ts:186); stats and history should be incremental.

Auto-respawn 2 s after a crash (23):
- Crash event carries its tick (sim.ts:536-539); the wreck settles after 0.5 s at rest or 4 s at most
  (`rest` event, sim.ts:356-373). Today the overlay appears after a 1500 ms wall-clock `setTimeout`
  (main.ts:325-339). Drive the 2 s from sim ticks in `FlightSession.frame` (session.ts:420-466) so a
  pause or hidden tab does not fire it; call `afterCrashCleared()` first (main.ts:304-310) to drop the
  Rapier debris. With auto-respawn the 1.5 s overlay would flash for 0.5 s: suppress or replace it.
- R already means "back to the very start" (main.ts:514 -> `respawn(false)` -> spawn, session.ts:480-484).
- Acceptance B12 clicks `[data-action="respawn"]` on the overlay (tools/bench/src/accept-fly.ts:328-329):
  new defaults need a switch the harness can set.

Stuck detection (18):
- Liftoff's rule [L5]: still + top side against something. Our state gives: up-vector y component
  `r11 = 1 - 2(qx^2 + qz^2)` (sim.ts:202; `attitude()` sim.ts:642-655), speed, body rates. Contact events
  stop once at rest (see above), so use a proximity query (`collision.querySphere` with
  boundRadius + 2 cm, as session.ts:474) instead of `lastContactTick` (session.ts:145, 444).
  Candidate rule: |v| < 0.1 m/s and |w| < 1 rad/s for >= 1 s while touching and tilted > 60 deg
  (r11 < 0.5), or `crashed === 2` (settled wreck).
- Crash off (3): `vCrash` is a param (params.ts:47, 185; override params.ts:67); a "no crash" flag is
  safer than `vCrash = Infinity`, because `JSON.stringify(Infinity)` is `null` in the config hash
  (session.ts:372) and in any saved settings. Presets all use v_crash 4.0 m/s (estimate), v_bounce 1.5.
- HUD mode label for item 15: the top-left OSD is rebuilt with `innerHTML` every 100 ms
  (flight.ts:102) inside `#ui { pointer-events: none }` (fly.css:6-7): a clickable mode chip must be a
  separate `.interactive` element that is not re-created each update.

Keyboard today (for item 7): P / Esc pause toggle, R respawn, F3 frame stats (main.ts:512-516);
keyboard flying Space arm, M angle, W/S, A/D, arrows (keyboard.ts:2, 35-36); HUD hint text
`hud.keys` = "R respawn · P pause · F3 frame stats" (flight.ts:105). No pause-menu item has a key.

## Sources
- Betaflight 4.5.1: https://github.com/betaflight/betaflight/blob/4.5.1/src/main/flight/pid.c ,
  .../src/main/flight/pid_init.c , .../src/main/cli/settings.c , .../src/main/fc/parameter_names.h ,
  .../src/main/osd/osd.c , .../src/main/osd/osd.h (downloaded to `.cache/v02/bf/`).
- VelociDrone manual https://www.velocidrone.com/mobile_manual (text in `.cache/radio-ux/vd.txt`).
- Liftoff (Steam news API `ISteamNews/GetNewsForApp` appid 410340, saved `.cache/v02/liftoff-news.json`):
  [L1] https://store.steampowered.com/news/app/410340/view/250329347069625783 ;
  [L2] https://store.steampowered.com/news/app/410340/view/272838467474810394 ;
  [L3] https://store.steampowered.com/news/app/410340/view/91591419805519458 ;
  [L4] https://steamcommunity.com/app/410340/discussions/0/364040166687260626/ ;
  [L5] https://steamcommunity.com/app/410340/discussions/0/3145094199305251024 ;
  [L6] https://steamcommunity.com/app/410340/discussions/0/1693785035831049029/ ;
  [L7] https://store.steampowered.com/news/app/410340/view/377538367947590042 ;
  [L8] https://store.steampowered.com/news/app/410340/view/4249665521683313682 ;
  [L9] https://store.steampowered.com/news/app/410340/view/4249665521683312145 ;
  [L10] https://store.steampowered.com/news/app/410340/view/2578811485588732473 ;
  [L11] https://store.steampowered.com/news/app/410340/view/3715990047690720162 ;
  [L12] https://store.steampowered.com/news/app/410340/view/4249665521683311824 ;
  [L13] https://defkey.com/liftoff-fpv-drone-racing-shortcuts ;
  [L14] https://store.steampowered.com/news/app/410340/view/252584317726096119
- Uncrashed (appid 1682970, `.cache/v02/news-1682970.json`):
  [U1] https://store.steampowered.com/news/app/1682970/view/1785321795740939 ;
  [U2] https://store.steampowered.com/news/app/1682970/view/5688680204375807877 ;
  [U3] https://store.steampowered.com/news/app/1682970/view/1797185861643140 ;
  [U4] https://steamcommunity.com/app/1682970/discussions/0/599650671167331642 ;
  [U5] https://store.steampowered.com/news/app/1682970/view/5728086065180376046
- DRL Sim (appid 641780, `.cache/v02/news-641780.json`):
  [D1] https://store.steampowered.com/news/app/641780/view/2415533798126497436 ;
  [D2] https://steamcommunity.com/app/641780/discussions/0/1607148447825384896/ ;
  [D3] https://store.steampowered.com/news/app/641780/view/2412160539859464369 ;
  [D4] https://store.steampowered.com/news/app/641780/view/4093189984239959418
- Not read: Liftoff Facebook tip on shortcuts in Button Setup (page did not render; only its URL slug).
