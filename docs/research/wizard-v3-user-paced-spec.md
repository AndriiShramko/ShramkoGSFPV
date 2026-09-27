# Calibration wizard v3, user-paced: implementation spec (2026-09-26)

Scratch spec for the implementers (gitignored). Worktree `C:/dev/gsfpv-wizard`, branch
`fix/wizard-user-paced`, base `60fa9de`. Follow it literally. Where it says "must", a test checks it.
Ground rules as before: English in code, short why-comments, plain DOM via `h()`, no new
dependencies, no Cyrillic/Polish letters outside `packages/i18n/locales/`, scratch in `.cache/wz/`.

--------------------------------------------------------------------------------------------------

## 0. Why

Andrii (experienced FPV pilot, Liftoff user) on the live v0.2 with his real radio, 2026-09-26:
"I cannot keep up with these steps, it passes them BY ITSELF, even if I did not move the sticks at
all, or moved them only a tiny bit. That is not how Liftoff does it. Rework it." Screenshot: "Let go"
already ticked, "4 Throttle" active, "Throttle all the way up".

Measured on HEAD `60fa9de` with the simulated people (the model, NOT his radio). Scripts and raw
output: `.cache/wz/head-probe.ts|.out`, `head-slow.ts|.out`, `still-probe.ts|.out`.

| Probe | HEAD result |
|---|---|
| A. Stirs, then hands off, no button, throttle parked at -1, -0.6, -0.2, 0, 0.3, 0.6, 1 | "Let go" ends BY ITSELF 2.5 s after it appears in 7 of 7 (centre @3.1 s, throttle push @5.6 s). This is his screenshot. The push itself is not taken with idle hands (0 of 7). |
| B. Same, pressing every enabled escape every 1.5 s, 90 s | 0 of 3 past the throttle push, no profile (only "Pick" was ever offered). |
| C. Throttle parked where "Let go" left it, then a small move of 5..25 % of FULL travel, held 3 s | parked at 60 % of travel: +20 % and +25 % taken as "all the way up"; parked at 40 %: a 25 % move DOWN taken as "up" = reversed throttle (after the 2 s "doubt hold"); parked at 0 %, 20 %, 50 %: nothing taken. |
| D. Yaw / pitch from the centre, held 3 s | 5..55 % of half travel ignored, 62 % taken (PUSH 0.60 measured from the range middle). |
| E. The sticks follow every screen, NO button ever pressed | reaches the check screen WITH a profile at 16.6 s. Screen sequence: stir 3.1 s, let go 2.5 s, each push 0.9..1.2 s, each "let go of the stick" 0.8..1.0 s, arm 3.6 s. |
| F. Time on each screen, 200 grid people, p10 / p50 | stir 3.6 / 4.1 s, let go 2.5 / 2.5 s, stick release screens 0.80 / 0.81 s, pushes p50 1.4..2.9 s. A screen that lives 0.8 s cannot be read. |
| G. 150 SLOW people (reaction 3..15 s to every screen) | 150 correct. The person model always ends up doing what the screen says, so a runaway screen does not show up as a wrong mapping in the model. This is why the tests below check the pacing itself (no screen change without a command), not only the final mapping. |

Root causes in HEAD `calib.ts`:
1. Nothing waits for the pilot: stir ends 2.5 s after the first move once four sticks reach 90 %;
   "Let go" captures after 800 ms still + 2 s shown; every release / throttle-down / arm-off screen
   passes as soon as the stick is back (a self-centring stick springs back BY ITSELF); a 500 ms check
   mark then opens the next screen (`OK_MS`).
2. A push is measured from the MIDDLE of the stirred range (`dm`, `PUSH 0.60`), not from where the
   stick rests, so a throttle parked mid needs only 20..25 % of its travel.
3. Acceptance on time alone: `THROTTLE_DOUBT_HOLD_MS` (a throttle resting at an end after a small
   move becomes "up" after 2 s), `THR_LATE_MS`, `ARM_SOON_WAIT_MS` ("the levels stand" after 2 s with
   no move), `CENTRE_MIN_MS`, `STIR_MIN_MS`, `OK_MS`.

--------------------------------------------------------------------------------------------------

## 1. The seven rules and where each is met

| # | Rule (non-negotiable) | Met by | Checked by |
|---|---|---|---|
| 1 | Nothing advances on its own: each step begins with the pilot's Start (big button, Enter/Space) and ends with the pilot's Next after a visible result | stages ready -> active -> done (2); commands only (4); invariant I1 | paced.test (a), (e); B10b |
| 2 | Only a real movement counts: >= 70 % of the reach from the rest, held >= 400 ms; < 30 % ignored, shown as "further" with a live gauge; no acceptance because time passed or a stick stayed still | push rule 3.5; TUNING cleanup 3.11; invariant I2 | paced.test (b); calib.test push cases |
| 3 | Centre measured only on the pilot's press AND all self-centring sticks still (<= 2 % for 500 ms); if one moves, say which | 3.2, 3.7, 3.8 | calib.test centre cases |
| 4 | Stir ends with the pilot's Done, enabled once every stick axis covered >= 80 % of its range (live bars), never automatically | 3.6 | paced.test (a) A2; calib.test stir |
| 5 | Result screen: four sticks as labelled live bars (thr/yaw/pit/roll), each with Reverse and Set again; arm row with live ON/OFF, Skip if no switch | 5.5 | calib.test redo/reverse; UI check |
| 6 | Every screen keeps Back / Start again / Close | 5.2 | UI check at every stage |
| 7 | The drawing keeps showing WHAT to move and WHERE until the movement is accepted | 5.4 (`target`, `preview`, `gauge`) | UI screenshots per stage |

--------------------------------------------------------------------------------------------------

## 2. Flow: steps and stages

Steps stay `connect stir centre throttle yaw pitch roll arm check` (the steps list, `STEP_IDS`).
Every step except connect and check has three stages. `ready`: the instruction and the drawing,
nothing is measured or taken. `active`: measuring, live feedback. `done`: the result with a check
mark, live, until the pilot presses Next.

| Step / stage | Pilot sees (say) | Primary button (Enter/Space) | What ends the stage | Refused with a named reason when |
|---|---|---|---|---|
| connect | Waiting for the radio | none | first frame -> stir/ready (the only automatic change; nothing is taken) | - |
| stir/ready | Stir both sticks | Start | Start | no frames yet |
| stir/active | Stir both sticks into every corner (+ 4 live coverage bars) | Done (disabled until 3.6) | Done | - (disabled, the bars say why) |
| stir/done | Sticks found: CH1-CH4 · switches CH5 | Next | Next | - |
| centre/ready | Let go of both sticks, throttle all the way down | Start | Start | - |
| centre/active | same + a still/moving dot per stick | Measure | Measure accepted (3.7) | a stick moves; two sticks held at their ends; a non-centring stick parked mid |
| centre/done | Centres measured (offset per stick in %) | Next | Next | - |
| fn/ready (throttle, yaw, pitch, roll) | Throttle: all the way down, then Start / Yaw: hands off, then Start | Start | Start accepted (3.4) | a free stick moves, is held, or (throttle) is parked mid |
| fn/active | Throttle all the way up / Yaw right / Pitch forward / Roll right + gauge | Next (disabled) | the push accepted (3.5): the one frame-driven change | - |
| fn/done | Throttle = CH3 (live bar, Reverse) · "bring it back down" / "let go" | Next | Next accepted (3.8) | throttle not down (radio) / the stick not let go or still moving |
| arm/ready | Arm switch: put it OFF (disarmed), then Start | Start | Start | a switch channel is moving |
| arm/active | Flip your arm switch ON | Next (disabled) | a flip accepted (3.9): frame-driven | - |
| arm/done | Arm = CH5 (live ON/OFF, Reverse) · "flip it back OFF" | Next | Next accepted (3.9) | a level switch reads ON |
| check | Check: everything follows your sticks (rows of 5.5) | Fly | Fly (the UI saves) | - |

Presses for a full run: stir 3, centre 3, four sticks 2 each, arm 2, Fly 1 = 17. Liftoff needs about 7
clicks; Andrii's rule 1 asks for Start + Next per step, so it is 17, all on Enter/Space.

Back (every stage; `back()` returns false only when there is nothing before, then the UI shows the
device choice): active -> ready of the same step (nothing kept); done -> ready of the same step (its
capture discarded: "set again"); ready -> done of the previous step (its capture kept, its result
shown again); check -> arm/done. While redoing from the check (`state.redoing`): Back from the redone
step's ready returns to the check with the capture as before the redo.

Redo (check only, "Set again" per row): `redo(fn | 'arm')` drops that capture, frees its channel and
opens that step's ready with `redoing = true`; its Next returns to the check (profile rebuilt).

Skip (arm ready/active, "Skip: arm with Space"): arm = key -> arm/done (result "Space / ARM button")
-> Next -> check. On the check, the arm row of a skipped arm has "Set up a switch" = `redo('arm')`.

--------------------------------------------------------------------------------------------------

## 3. Measurement rules

### 3.1 Units
Axes in [-1, 1]. Per channel, collected over the whole run: `min`, `max` (as today), `mid = (max + min) / 2`,
`half = max((max - min) / 2, 0.05)`. `v` = the raw value of the last frame. `sm` = the smoothed value
(3.2). Percentages shown to the pilot are of `half` (sticks) or of the full span (throttle bar).

### 3.2 Stillness (rule 3)
`sm[i]`: EMA of `v[i]` with `STILL_TAU_MS = 80` (per-frame k = 1 - exp(-dt / 80)). Still window on `sm`
exactly like today's raw window: when `max(sm) - min(sm)` since `stillSince2[i]` exceeds
`STILL_TOL = 0.04` (2 % of the -1..1 span, QGC settle 20 / 1000), the window restarts at this frame.
`isStill(i) = now - stillSince2[i] >= STILL_MS (500)`. `ChannelLive.still` = `isStill`.

Why smoothed (measured, `still-probe.out`): at rest with noise sd 0.01 of half travel (the person
model's maximum) the RAW peak-to-peak over 500 ms exceeds 0.04 in 88..100 % of windows at 125..1000
reports/s, so rule 3 would refuse every Measure; with the 80 ms EMA the worst window is 0.021 (sd 0.01)
and 0.035 (sd 0.02, twice the model's maximum). Not measured on a real radio.

A pad that reports only changes (frozen Gamepad.timestamp) sends no frames while still: `tick(t)`
advances `now`, so stillness grows without frames (as today).

### 3.3 Where a channel rests
For stick channels (`kind === 'stick'` after the stir): `centred` = `|sm - mid| <= CENTRE_TOL (0.15) * half`;
`atEnd` = `|sm - mid| >= (1 - END_TOL (0.10)) * half`, side = sign; `parked` = neither. For a channel
with a measured `rest` (after centre/done), "held" means `|sm - rest| > CENTRE_TOL * half`.

### 3.4 Start of a push step (`begin()` on throttle / yaw / pitch / roll ready)
`free` = stick channels not assigned to another function (or the one picked, 3.5). `need` = number of
self-centring functions not yet assigned among yaw/pitch/roll (throttle step: 3; yaw: 3; pitch: 2
after yaw, etc.). `extra = free.length - need - (fn === 'throttle' ? 1 : 0)` (swept pots and the
like; normally 0).
Refuse (Verdict false, hint names the channel, first matching rule):
1. a free channel is not still -> `wizard.hint.begin.moving {ch}`;
2. more than `free.length - need` free channels are not centred (a stick is held) -> the one furthest
   from its middle: `wizard.hint.begin.held {ch, pct}`;
3. `fn === 'throttle'`, `extra === 0` and the one non-centred free channel is `parked` (a radio
   throttle left mid, or a thumb) -> `wizard.hint.begin.parked {ch, pct}` ("let go of it, or if it is
   the throttle, put it all the way down"). This is what removes HEAD's ambiguous "throttle parked
   mid" case (probe C): the throttle push then starts from an end or from a spring centre.
Accept: per free channel `base = sm`, `baseEnd = atEnd ? side : 0`; stage active; gauge reset.

### 3.5 The push (rule 2), every frame and every tick in fn/active
Per free channel j (only the picked one after `pick(ch)`):
- `d = v - base`; if `baseEnd != 0` only `sign(d) === -baseEnd` counts (a stick resting at an end can
  only go away from it; the other way gives `frac = 0`);
- `reach = d >= 0 ? max - base : base - min`, then `reach = max(reach, REACH_MIN 0.5)` (noise near a
  one-sided range can never make a push; any accepted push travels >= 0.35 absolute);
- `frac = min(1, |d| / reach)`.
Leader = the largest `frac`, `second` = the next. Zone: `frac < 0.10` rest, `< PUSH_TINY 0.30` tiny,
`< PUSH_ACCEPT 0.70` almost, else enough; `second >= TWO_FRAC 0.30` (no pick) -> zone two.
Hold: zone enough on the same channel and sign, continuously; any other zone resets it. `held` =
hold time / `HOLD_MS (400)`. Accept at `held >= 1`: `assign(fn, ch, sign)` with `invert = sign < 0`
(asks are always up / right); throttle `center = invert ? max : min`; others `center = rest[ch]`
(re-measured at Next, 3.8). Stage done, `result = { kind: 'fn', fn, ch, invert }`.
What this means for the pilot: the throttle resting at the bottom has the full span as reach, so 70 %
= 70 % throttle; a centred stick has its half as reach, so 70 % deflection. Deliberate deviation from
the literal rule 2 ("70 % of the collected HALF-range"): for a throttle resting at its end that would
accept 35 % throttle, which is not "all the way up"; the reach to the other end is stricter, never
looser. Tiny moves (5..25 % of the travel) reach at most frac 0.25: never accepted, the gauge says
"Further". Direction: the wizard sees only the channel's sign, so on a centred stick a push the other
way gives a reversed channel; the done stage shows it live (the bar moves the other way, 3.8) with
Reverse right there. This is Liftoff's rule too; "in the requested direction" can only be enforced
for a stick resting at an end (away from it).
Hints in fn/active (texts only, nothing taken): nothing ever reached frac 0.10 for `PUSH_HINT_MS` ->
`push.none`; the peak of the last attempt was in [0.30, 0.70) and the stick is back below 0.10 ->
`push.short {pct}` (pct = that peak); a channel reached frac >= 0.90 and fell below 0.70 before
`HOLD_MS` (a flick, or a throttle that was up at Start, pulled down and pushed back) -> `push.hold`.
Pushing an already assigned channel (frac from its rest >= 0.70 for `TAKEN_HOLD_MS`) sets hint
`wizard.hint.push.taken {fn}` and takes nothing.

### 3.6 Stir (rule 4)
`begin()` resets the ranges (today's `resetStir`). In active: `classify()` every 100 ms exactly as
today (`STICK_SPAN 1.0`, sweep test). `cover = (max - min) / 2`. A stick channel is `full` at
`cover >= STIR_COVER 0.80`. Low weights (a radio whose output stops below 80 %): `plateau` when
`cover >= 0.50` and, on each side, the value came back to within `PLATEAU_TOL 0.03` of that side's
extreme at least `PLATEAU_HITS 3` times after being >= 0.30 away from it, with the extreme grown by
less than `PLATEAU_TOL` since the first of those hits (it keeps hitting the same wall: a real end,
counted in movements, not in time). `can.next` (Done) = at least 4 stick channels, and the 4 widest
are each `full` or `plateau`. Live: `sticksDone` = count of `full`; per channel `cover` in the bars.
`next()` -> stir/done with `result = { kind: 'stir', sticks, switches, short }` (`short` = taken on
plateau); `stickSet` = all stick channels. No "Continue anyway" any more: with fewer than four sticks
Done stays disabled and the hint says which channel and how far (today's `stirHint`, after
`STIR_HINT_MS`), or `wizard.hint.stir.short {ch, pct}` for a plateau channel.

### 3.7 Centre (`next()` = Measure on centre/active; rule 3)
Over `stickSet`: refuse, first matching rule, naming the channel:
1. a channel not still -> `wizard.hint.centre.moving {ch}` (the one with the largest recent spread);
2. more than `stickSet.length - 3` channels not centred and two or more of them at an end ->
   `wizard.hint.centre.ends {a, b}`;
3. `stickSet.length === 4` and a channel `parked` -> `wizard.hint.centre.parked {ch, pct}`;
4. more than `stickSet.length - 3` not centred -> `wizard.hint.centre.held {ch, pct}`.
Accept: `rest[c] = sm[c]` for every stick channel; stage done; `result = { kind: 'centre', centres:
[{ ch, pct }] (rest offset from mid in % of half), end }` (`end` = the channel at an end, -1 none).
After `MEASURE_ANYWAY_AFTER (2)` refusals by rule 1 for the same channel, `can.measureAnyway`:
`measureAnyway()` takes `rest = sm` as it is (a stick that never settles; the pilot decides).

### 3.8 Next on a done stage
- stir/done, centre/done: always accepted.
- throttle/done: if `baseEnd != 0` (a radio throttle): accepted when the live throttle bar
  `u = (state.mapped.throttle + 1) / 2` is `<= THR_DOWN_MAX 0.10` and the channel is still; else `wizard.hint.next.thrDown {pct}` ("The throttle reads {pct} %. Pull it all the way down.
  Already down? Press Reverse."). If `baseEnd === 0` (a spring throttle): as a self-centring stick below.
  This is where a push taken the wrong way round becomes visible and is fixed by the pilot (Reverse on
  the result card), instead of HEAD's timers.
- yaw/pitch/roll/done (and a spring throttle): the pushed channel `|sm - rest| <= CENTRE_TOL * half`
  and still -> `rest[ch] = sm`, `center = rest` (the thumb is off now), accepted; else
  `wizard.hint.next.held {fn, pct}` or `wizard.hint.next.moving {fn}`.
- arm/done: a level arm (axis or level button) must read OFF (`mapped.arm === false`, computed with
  `armOn(map, frame)` of the map built at acceptance, so it matches the check and the flight), else
  `wizard.hint.next.armOn` ("Arm reads ON. Flip the switch OFF. Already OFF? Press Reverse."). Toggle
  button and key: always accepted.
Accepted Next opens the next step's ready, or the check when `redoing`.
`reverse(what)` on a done stage flips that capture (`assigned[fn].invert`, throttle `center` to the
other end; the arm map as today's check Reverse does); on the check it flips the profile as today.

### 3.9 Arm
`begin()` (arm/ready): refuse `wizard.hint.arm.moving {ch}` if a candidate channel (fn `null`) is not
still by the raw window (`ARM_LEVEL_MS`). Accept: baseline `L0[i] = stillMean(i)` for candidates,
`bitBase = buttons`; the pilot was told to put the switch OFF first, so `L0` IS the OFF level.
Active (every frame): today's `armLevels()` with `lvl` initialised to `L0` (not NaN), glitch filter
`ARM_FAR_MS` kept. A candidate whose still level moved `>= ARM_JUMP` from `L0` and stayed
`>= ARM_ON_HOLD_MS (600)` -> axis map `{ off: L0, on: lvl, threshold: off + 0.75 (on - off), onAbove }`.
A button bit changed from its base and held 600 ms -> level `{ bit, inverted: base === 1 }`. A press
released within `ARM_TAP_MS (600)` from base 0 -> toggle `{ bit, toggle: true }`. Stage done,
`result = { kind: 'arm', source }`. In arm/done the far end of a 3-position switch is still tracked
(today's `seenLo/seenHi`): a still level beyond ON by `ARM_JUMP / 2` becomes ON, so the middle reads OFF.
If a candidate left `L0` by `ARM_JUMP` and came back within 600 ms (a switch that was already ON and
got cycled), hint `wizard.hint.arm.wasOn` ("Was the switch ON when you pressed Start? Put it OFF,
press Back, then Start."). Hints `arm.none` / `arm.small` after `ARM_HINT_MS` as today.
Deleted: the whole arm "off" screen, `fixArmPolarity`, `offWait`, `ARM_REACT_MS`, `ARM_SOON_WAIT_MS`,
`ARM_OFF_*`, `ARM_TAPS_WITHIN_MS` (one tap is enough: the done stage shows the live state).

### 3.10 Check
As today: profile built on entry (`buildProfile`, `wizard: 2` kept so `main.ts` resumes it),
`mapped` and `checks` live, `reverse(what)`, hint `check.throttle`. New: `redo(what)`. `resume(p)`
seeds `min/max/rest` of the four profile channels from the profile (`min`, `max`, `center`) and
`stickSet` = those four, so Set again works on a saved profile too.

### 3.11 TUNING (export as today; tests and the sweep print it)

| Constant | Value | Source |
|---|---|---|
| STILL_TAU_MS / STILL_TOL / STILL_MS | 80 / 0.04 / 500 | rule 3 (QGC settle 20/1000, 500 ms); tau measured (3.2) |
| CENTRE_TOL / END_TOL | 0.15 / 0.10 of half | guess from the person model (thumb rest <= 0.15, residual <= 0.03, trims <= 0.03) |
| PUSH_ACCEPT / PUSH_TINY / TWO_FRAC / HOLD_MS | 0.70 / 0.30 / 0.30 / 400 | rule 2 (QGC move 300/1000 for "counts as moved") |
| REACH_MIN | 0.50 | keeps any accepted push >= 0.35 absolute |
| STIR_COVER / PLATEAU_TOL / PLATEAU_HITS | 0.80 / 0.03 / 3 | rule 4; plateau: guess, checked by the rangeLimit people |
| THR_DOWN_MAX | 0.10 | arm gate needs <= 5 %; 10 % leaves room for noise |
| MEASURE_ANYWAY_AFTER | 2 refusals | a pilot's decision, not a timer |
| kept: EMA_TAU_MS, STILL_P2P (raw, arm), MOVING_SPAN, SWITCH_SPAN, STICK_SPAN, OTHER_FRAC, STIR_SWEEP_BINS, ARM_JUMP, ARM_SMALL, ARM_LEVEL_MS, ARM_FAR_MS, ARM_ON_HOLD_MS, ARM_TAP_MS, RANGE_ONE_SIDED, TAKEN_HOLD_MS, CLASSIFY_EVERY_MS, HINT_MIN_MS, CONNECT_HINT_MS, CHECK_SUSPECT_MS | as today | |
| hint-only timers | STIR_HINT_MS 8000, PUSH_HINT_MS 5000, PUSH_PICK_MS 8000 (shows Pick), ARM_HINT_MS 8000 | a text or a button appears; nothing is taken |
| DELETED | STIR_MIN_MS, CENTRE_HOLD_MS, CENTRE_MIN_MS, CENTRE_HINT_MS, CENTRE_ESCAPE_MS, PUSH, ARRIVE_FROM, ARRIVE_STILL_MS, QUIET, STICK_HOLD_MS, THROTTLE_HOLD_MS, THROTTLE_DOUBT_HOLD_MS, THR_FLIP_STILL_MS, THR_LATE_MS, THR_AWAY_STILL_MS, PUSH_ESCAPE_MS, RELEASE_MID_TOL, RELEASE_REST_TOL, RELEASE_HOLD_MS, THR_DOWN_TOL, THR_DOWN_HOLD_MS, RELEASE_HINT_MS, RELEASE_ESCAPE_MS, ARM_OFF_TOL, ARM_OFF_HOLD_MS, ARM_REACT_MS, ARM_SOON_WAIT_MS, ARM_TAPS_WITHIN_MS, ARM_OFF_HINT_MS, ARM_OFF_ESCAPE_MS, OK_MS | every one of them either advanced a screen by itself or took a value because time passed |

--------------------------------------------------------------------------------------------------

## 4. TypeScript API (`packages/input/src/calib.ts`), the contract

```ts
export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';                        // unchanged
export const FNS: Fn[] = ['throttle', 'yaw', 'pitch', 'roll'];                 // unchanged
export type StepId = 'connect' | 'stir' | 'centre' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'check'; // unchanged
export const STEP_IDS: StepId[];                                               // unchanged
export type Stage = 'ready' | 'active' | 'done';
export type Dir = 'up' | 'down' | 'right' | 'centre' | 'stir' | 'on' | 'off' | 'flip';
export type Zone = 'rest' | 'tiny' | 'almost' | 'enough' | 'two';
export interface Gauge { ch: number; frac: number; sign: 1 | -1 | 0; zone: Zone; held: number; other: number } // other: 2nd channel for 'two', else -1
export type StepResult =
    | { kind: 'stir'; sticks: number[]; switches: number[]; short: number[] }
    | { kind: 'centre'; centres: { ch: number; pct: number }[]; end: number }
    | { kind: 'fn'; fn: Fn; ch: number; invert: boolean }
    | { kind: 'arm'; source: ArmSource };
export type Verdict = { ok: true } | { ok: false; hint: Hint };
export interface Can {
    begin: boolean; next: boolean; back: boolean; skipArm: boolean; pick: boolean;
    measureAnyway: boolean; reverse: boolean; redo: boolean; fly: boolean;
}
export interface WizardState {
    // legacy, read by main.ts, accept-fly B10/B11, smoke-ui: same meaning as today
    step: Step;            // connect/stir 1, centre 2, sticks 3, arm 5, check 6
    prompt: Fn | null;     // the fn of a stick step
    message: string;       // i18n key of the say line: wizard.say.<id>.<stage> (connect, check: wizard.say.<id>)
    progress: number;      // = hold
    error: string | null;  // = hint?.key ?? null
    profile: Profile | null; // check only
    // v3
    id: StepId;
    stage: Stage | null;   // null on connect and check
    target: { what: Fn | 'arm' | 'sticks'; dir: Dir } | null; // what the drawing animates (5.4):
                           // ready = the preparation if there is one (throttle: down, arm: off), else the coming move;
                           // active = the move; done = the follow-up (let go / throttle down / arm off); check: null
    preview: boolean;      // ready stage showing the coming move (dimmed ghost)
    gauge: Gauge | null;   // fn/active only
    hold: number;          // gauge.held, else 0
    result: StepResult | null; // done stage only
    redoing: boolean;
    hint: Hint | null;
    can: Can;
    stuckMs: number;       // ms in this stage (hint timers only)
    cmds: number;          // count of accepted commands (tests pair every stage change with it)
    channels: ChannelLive[]; // ChannelLive.still = 3.2; + cover, kind, fn as today
    mapped: { roll: number; pitch: number; throttle: number; yaw: number; arm: boolean | null }; // live from the done stage of the throttle on
    assigned: Partial<Record<Fn, number>>;
    inverted: Partial<Record<Fn, boolean>>;
    armSource: ArmSource | null;
    sticksDone: number;
    checks: { throttleLow: boolean; armOn: boolean | null; centred: boolean } | null;
}
// removed from WizardState: phase, ok, leader. Phase type removed.

export class CalibrationWizard {
    constructor(deviceKey: string, deviceName: string);
    static resume(p: Profile): CalibrationWizard;   // check, ranges seeded from p (3.10)
    start(t: number): void;        // lifecycle, name kept (runHuman, Rig, radio.ts call it): connect
    feed(f: RawFrame): WizardState; // measure; the ONLY stage changes here: connect -> stir/ready,
                                    // fn/active -> fn/done (3.5), arm/active -> arm/done (3.9)
    tick(t: number): WizardState;   // timers and hints; the push hold on a sparse pad; never a stage change
    begin(t?: number): Verdict;     // "Start" on a ready stage
    next(t?: number): Verdict;      // "Done" (stir/active), "Measure" (centre/active), "Next" (done stages)
    back(): boolean;                // 2; false = nothing before (UI: device choice). can.back is always true (rule 6)
    redo(what: Fn | 'arm'): Verdict; // check only
    skipArm(): Verdict;             // arm ready/active
    pick(ch: number): Verdict;      // fn/active: listen to this free channel only; the push is still needed
    measureAnyway(): Verdict;       // centre/active after MEASURE_ANYWAY_AFTER refusals
    reverse(what: Fn | 'arm'): void; // fn/done and arm/done (that line), check (any line)
    freeChannels(): number[];       // fn ready/active
}
// unchanged exports: RawFrame, AxisMap, ArmMap, Profile, Hint, ChannelKind, ChannelLive, ArmSource,
// channelOrder, mapFrame, armOn, ArmLatch, ArmGate, ArmBlock, TUNING (new contents).
// removed methods: cont(), useCurrent().
```
`t` on a command: `now = max(now, t)` when given, else the wizard's own clock (last frame / tick).
radio.ts passes `performance.now()`; the simulations pass their frame time or nothing.

Invariants (tests):
- I1: `(id, stage)` changes only inside a command call (each accepted command increments `cmds`), except
  the three frame changes listed at `feed`.
- I2: no acceptance depends on elapsed time alone. Durations in acceptance are only `HOLD_MS` (a stick
  held >= 70 %), `STILL_MS` (at a pilot's press), `ARM_ON_HOLD_MS` (a switch held at its new level),
  and the noise filters `ARM_LEVEL_MS` / `ARM_FAR_MS`.
- I3: a refused command changes no capture; its hint names a channel or function.
- I4: `profile !== null` only on check.

--------------------------------------------------------------------------------------------------

## 5. UI (`apps/fly/src/ui/radio.ts`, `radio-art.ts`, `wizard.css`)

### 5.1 Rendering
Unchanged frame: frames call `wz.feed(f)`; one rAF loop renders; a 250 ms interval calls `wz.tick`.
Delete `pushMag`, `arrived`, `startEnd` (the wizard now gives `gauge`). The sign `s2` that rebuilds the
buttons and the extra panel gains `stage`, `can.begin`, `can.next`, `can.measureAnyway`, `result` kind.

### 5.2 Buttons (every stage: Back, Start again, Close; rule 6)
Actions row, left to right: [primary] [secondary escapes] Back · Start again. Close is the x in the
header plus Esc, on every screen. The primary is `h('button', { class: 'btn primary big', 'data-primary': '', 'data-action': ... })`:

| Stage | Primary (`data-action`) | Secondary |
|---|---|---|
| stir/ready, centre/ready, fn/ready, arm/ready | Start (`wizard-start`) -> `wz.begin(now)` | arm: Skip (`wizard-skip-arm`) |
| stir/active | Done (`wizard-next`), disabled until `can.next` | - |
| centre/active | Measure (`wizard-next`) | Measure anyway (`wizard-measure-anyway`) when `can.measureAnyway` |
| fn/active, arm/active | Next (`wizard-next`), disabled | fn: Pick the channel (`wizard-pick`) when `can.pick`; arm: Skip |
| every done stage | Next (`wizard-next`) | - (Back = set this step again) |
| check | Fly (`wizard-done`, as today) | Download / Load profile |

A refused command shows its hint at once in `.wz-hint` (role=status). Removed buttons:
`wizard-continue`, `wizard-use-current`, `wizard-cancel` (Back on stir/ready goes to the device choice).

### 5.3 Keyboard and focus
- Enter or Space: press the primary if enabled (capture listener, `e.repeat` ignored, not when focus is
  on another button / input / select, where the browser's own activation runs). Space keeps its
  `stopPropagation` (flight arm key) and gets `preventDefault` (no scroll).
- After a stage change Enter/Space do nothing for `KEY_GUARD_MS = 300`: the capture listener calls
  `preventDefault` + `stopPropagation` for them, so not even the focused button's native activation
  runs (one bouncing press cannot press Start and then Next of the next stage).
- Focus moves to the primary on every stage change (Enter/Space then also work natively).
- Backspace: Back. Esc: Close. `.wz-kbd` text: `wizard.kbd` (5.6).

### 5.4 The drawing (`radio-art.ts`, rule 7)
`ArtState` gains `preview?: boolean` and `gauge?: { frac: number; zone: Zone } | null`.
- ready: `target` is the preparation when there is one (throttle: DOWN, arm: lever to OFF), drawn at
  full strength; otherwise the coming move with `preview` (ghost at 50 % opacity, `.rb-preview`). The
  target well outlined; over the drawing a "Press Start" chip (`wizard.pressStart`).
- active: ghost and arrow at full strength (today); a gauge bar along the arrow beside the target well
  (`.rb-gauge`, 8 px wide, same length as the arrow) with ticks at 30 % and 70 %; fill = `frac`; colour:
  tiny `--muted`, almost `--hint-fg` (amber), enough `--accent`; the hold ring fills with `held`. The
  target knob moves along the asked direction by `frac` (the sign is unknown until accepted).
- done: the check mark on the knob (today's `ok`); the ghost then shows the follow-up: "let go"
  (spring back) for a self-centring stick, "down" for a radio throttle, the lever to OFF for the arm.
- Knobs of assigned functions follow live (`mapped`), unknown ones grey (today).
Text under the drawing (`.wz-gauge-t`, aria-live off, updated at most every 150 ms): rest
`wizard.gauge.wait`, tiny/almost `wizard.gauge.further {pct}`, enough `wizard.gauge.hold`, two -> the
hint `wizard.hint.push.two {a, b}`.

### 5.5 Extra panel per stage
- stir/ready + stir/active: the mode question (today) and four coverage bars = the channel strip
  (today's `.wz-chans`), each cell green at `cover >= 0.80`; count `wizard.stir.count`.
- centre/active: the channel strip with dots: green still, amber moving, red parked/held.
- fn/ready, fn/active: the channel strip (the Liftoff dots: assigned ones labelled T/R/E/A).
- fn/done: a result card `.wz-result`: tick + `wizard.result.fn {fn, ch}`, small `wizard.result.inv`
  when inverted, the live bar of that function (throttle 0..100 %, others centred), Reverse toggle
  (today's `revToggle`), and the follow-up line `wizard.result.letGo` / `wizard.result.thrDown`.
- arm/done: card with `wizard.result.arm {src}`, live ON/OFF (today's `wz-armnow`), Reverse,
  `wizard.result.armTry`.
- stir/done, centre/done: card with `wizard.result.stir {list}` + `wizard.result.switches {list}`, or
  `wizard.result.centre` + one line per stick "CHn: +1.2 %" (+ `wizard.result.end {ch}`).
- check (rule 5): one row per function `.wz-row[data-fn]`: name (`wizard.axis.*`), "CHn", live bar,
  Reverse (`reverse-<fn>`), Set again (`wizard-redo-<fn>`); the arm row: "Arm", source, live ON/OFF,
  Reverse (`reverse-arm`, not for toggle), Set again (`wizard-redo-arm`); skipped arm: "Space / ARM
  button" + Set up a switch (`wizard-redo-arm`). Then today's check list (throttle low, arm, centred),
  summary line and the profile files.
Steps list: a step gets its tick when its stage is done or it lies before the current step.

### 5.6 i18n (`packages/i18n/locales/fly/{en,es,pl,ru}.json`, equal key sets; natural wording in each
language written by the implementer, not a word-for-word copy; append new keys, re-read before Edit)
New (EN):
```
wizard.btn.start "Start"            wizard.btn.next "Next"        wizard.btn.done "Done"
wizard.btn.measure "Measure"        wizard.btn.measureAnyway "Measure as it is"
wizard.btn.redo "Set again"         wizard.btn.redoArm "Set up a switch"
wizard.pressStart "Press Start"
wizard.say.stir.ready "Stir both sticks"                wizard.say.stir.active "Stir both sticks into every corner"
wizard.say.stir.done "Sticks found"                     wizard.say.centre.ready "Let go of both sticks"
wizard.say.centre.active "Let go of both sticks"        wizard.say.centre.done "Centres measured"
wizard.say.throttle.ready "Throttle: all the way down, then Start"   wizard.say.throttle.active "Throttle all the way up"
wizard.say.throttle.done "Throttle found"               wizard.say.yaw.ready "Yaw: hands off, then Start"
wizard.say.yaw.active "Yaw right"                       wizard.say.yaw.done "Yaw found"
wizard.say.pitch.ready "Pitch: hands off, then Start"   wizard.say.pitch.active "Pitch forward"   wizard.say.pitch.done "Pitch found"
wizard.say.roll.ready "Roll: hands off, then Start"     wizard.say.roll.active "Roll right"       wizard.say.roll.done "Roll found"
wizard.say.arm.ready "Arm switch: put it OFF, then Start"  wizard.say.arm.active "Flip your arm switch ON"  wizard.say.arm.done "Arm switch found"
wizard.sub.arm.ready "The switch you will arm with, in its disarmed position."
wizard.gauge.wait "Push the stick the way the drawing shows"
wizard.gauge.further "Further: {pct} % (needs 70 %)"
wizard.gauge.hold "Hold it there…"
wizard.result.stir "Sticks: {list}"      wizard.result.switches "Switches: {list}"
wizard.result.centre "Centres (0 % = the middle of the travel):"   wizard.result.end "CH{ch} rests at its end: that is the throttle."
wizard.result.fn "{fn} = CH{ch}"         wizard.result.inv "This channel runs the other way round; the simulator turns it round."
wizard.result.letGo "Let go of the stick, then press Next."   wizard.result.thrDown "Bring the throttle all the way down, then press Next."
wizard.result.arm "Arm = {src}"          wizard.result.armTry "Flip it back OFF: it must read OFF. Then press Next."
wizard.hint.begin.moving "CH{ch} is still moving. Hands off for a second, then Start."
wizard.hint.begin.held "Let go of CH{ch} first: it is at {pct} %."
wizard.hint.begin.parked "CH{ch} stays at {pct} %. Let go of it, or if it is the throttle, put it all the way down. Then Start."
wizard.hint.centre.ends "CH{a} and CH{b} are held at their ends. Let go of the sticks."
wizard.hint.centre.parked "CH{ch} stays at {pct} %. Let go of it, or if it is the throttle, put it all the way down."
wizard.hint.centre.held "Let go of CH{ch}: it is at {pct} %."
wizard.hint.next.held "Let go of the {fn} stick first: it is at {pct} %."
wizard.hint.next.moving "The {fn} stick is still moving. Wait a second."
wizard.hint.next.thrDown "The throttle reads {pct} %. Pull it all the way down. Already down? Press Reverse."
wizard.hint.next.armOn "Arm reads ON. Flip the switch OFF. Already OFF? Press Reverse."
wizard.hint.push.hold "Push all the way and hold it until the ring is full. Was the throttle up when you pressed Start? Put it down, press Back, then Start."
wizard.hint.arm.moving "A switch is moving. Leave the switches, then Start."
wizard.hint.arm.wasOn "Was the switch ON when you pressed Start? Put it OFF, press Back, then Start."
wizard.hint.stir.short "CH{ch} stops at {pct} %. If your radio limits it, press Done; otherwise stir to the very edges."
wizard.kbd "Enter or Space: the green button · Backspace: back · Esc: close"
```
Changed text (same key): `wizard.hint.push.short` -> "Almost: you reached {pct} %. Push all the way
and hold." (`pct` = the peak of the last attempt); `wizard.sub.stir` -> "Round and round, all the way
to the edges, until all four bars are green. Then press Done."; `wizard.sub.centre` -> "Thumbs off,
throttle all the way down. Then press Measure."; `wizard.sub.arm.off` -> "Flip it back OFF, then press
Next.". Kept as they are: `wizard.hint.centre.moving`, `wizard.sub.<L|R>.<up|right|down|let>` (the
side line by stick mode: ready/active of a push = up/right, done = let / down), `wizard.sub.arm.on`,
`wizard.sub.check`, every check/arm/howto/summary key.
Sub line per stage: stir -> `wizard.sub.stir`; centre -> `wizard.sub.centre`; fn ready/active ->
`wizard.sub.<side>.<up|right>`, but throttle ready -> `wizard.sub.<side>.down`; fn done ->
`wizard.sub.<side>.let` (throttle: `.down`); arm ready/active/done -> `wizard.sub.arm.ready|on|off`.
The locale files are NESTED JSON: `wizard.say.stir` and `wizard.say.centre` are strings today and must
be removed before `wizard.say.stir.ready` etc. can exist (same for any other string that becomes an
object). Remove keys no code uses any more (grep first): `wizard.btn.continue`, `wizard.btn.useCurrent`,
`wizard.btn.cancel`, `wizard.say.<fn>.push`, `wizard.say.throttle.release`, `wizard.say.release`,
`wizard.say.arm.on|off`, `wizard.say.stir`, `wizard.say.centre`, `wizard.hint.throttle.already|down`,
`wizard.hint.release.*`, `wizard.hint.arm.back`, and the first wizard's `wizard.step*`,
`wizard.mode2`, `wizard.ready`, `wizard.remap`, `wizard.title`, `wizard.waiting` if unused.

--------------------------------------------------------------------------------------------------

## 6. The simulated radio robot, the person model, main.ts

Both drive the wizard ONLY through the commands the buttons call. One dispatcher, exported from
`packages/input/src/sim/human.ts`, used by the Node harness AND the page:
```ts
export type UiAction =
    | { kind: 'begin' | 'next' | 'skipArm' | 'measureAnyway' | 'fly' }
    | { kind: 'pick'; ch: number }
    | { kind: 'reverse'; what: Fn | 'arm' }
    | { kind: 'cont' | 'useCurrent' };           // only for the frozen v2 fixture's adapter
export function act(w: CalibrationWizard, a: UiAction): void; // begin -> w.begin(), next -> w.next(), ...; fly: no-op (the UI saves)
```
`main.ts` (3 lines, owner decides): `fake.onAct = (a) => { const w = r.wizard; if (!w) return;
if (a.kind === 'fly') click [data-action="wizard-done"]; else act(w, a); }`, and parse `nobuttons=1`
and `react` (default 400) into the FakeEdgeTx config.

### 6.1 FakeEdgeTx robot (`apps/fly/src/devices/fakehid.ts`, `?simradio=raw`)
It reads `follow()` (the state, as today) and emits `onAct` actions; it never touches the wizard.
Per `(id, stage)`, `react` ms after the stage appears (or after its last action), one action:

| Stage | Hands (want) | Press |
|---|---|---|
| stir/ready | sticks centred, T -1, arm off | begin |
| stir/active | circles as today | next once `can.next` and >= one full circle done |
| stir/done, centre/done | sticks centred, T -1 | next |
| centre/ready | same | begin |
| centre/active | same | next 600 ms after its sticks reached their places; again after `react` if refused |
| fn/ready | centring sticks 0; throttle step: T -1 | begin |
| fn/active | the stick of fn to 1 (slewed as today) | - |
| fn/done | release (0; T back to -1) | next after 700 ms; again if refused |
| arm/ready | arm off | begin |
| arm/active | arm on | - |
| arm/done | arm off | next after 700 ms |
| check | - | none (Playwright clicks Fly / the human's fly) |

`nobuttons=1`: the robot moves exactly as above but never emits an action (page negative control).
`humanSeed`: the person model below (unchanged wiring, new `Instruction`).

### 6.2 Person model (`packages/input/src/sim/human.ts`)
- `Instruction` gains `stage: Stage | null`, `can.begin`, `can.next`, `can.measureAnyway`, and what the
  screen shows live: `thr: number` (the throttle bar 0..1, NaN before) and `armLive: boolean | null`.
  `instructionOf(st)` maps v3 states: connect, stir, centre, push (fn steps), arm (new kind), check.
  `sameIns` also compares `stage` and `can.begin/next/measureAnyway`.
- Every existing path stays for `stage === null` (the frozen first wizard and the frozen v2), so tests
  16, 17, fuzz-head and the v2 controls see exactly today's people.
- `HumanConfig` gets, appended and drawn in `randomHuman` AFTER every existing draw (the grid people
  keep their other traits): `thinkLo = U(300, 900)`, `thinkHi = thinkLo + U(400, 2000)` (ms before a
  press, drawn per press), `nextEarly = r() < 0.2` (sometimes presses Next before the stick is back,
  reads the refusal, fixes it, presses again), `armPrepSkip = leaveArmOn && r() < 0.3` (leaves the
  switch ON on arm/ready), and `slow: { lo: number; hi: number } | null = null`. When `slow` is set,
  every reaction to a screen change and every press waits `U(lo, hi)`. `idealHuman`: think 0 (one
  frame), no early, no skip.
- Staged behaviour (v3 only):
  - any ready: prepare, then press `begin` after think. Prep: fn steps release the centring sticks;
    throttle step lowers the radio throttle; arm lowers the switch to OFF unless `armPrepSkip`.
    Refusal hints: `begin.moving` wait and press again; `begin.held` release, press again;
    `begin.parked` lower the throttle, press again.
  - stir/active: today's stirring (early stop, flicks, hint reactions); press `next` after think
    once `can.next`, stirring until the press.
  - centre/active: today's `startCentre` (release, lower throttle, thumb rest), then `next`; on
    `centre.moving|ends|held|parked` release / lower and press again; press `measureAnyway` when offered.
  - fn/active: today's `startPush` (slip, cross, throttle already up, patience retry, hint reactions);
    on `push.hold`: lower the throttle, press Back, then Start again.
  - fn/done: let go (throttle: lower it), press `next` (with `nextEarly`: at once); on `next.thrDown`
    when its own throttle is down (`ax[2].p < -0.9`) and the bar reads > 0.5: press `reverse('throttle')`,
    then `next`; on `next.held|moving` wait and press again.
  - arm/active: today's `planSwitch('on')` / taps / Skip on `arm.none` (no switch); on `arm.wasOn`:
    switch OFF, Back, Start, flip ON.
  - arm/done: flip the switch back OFF; if `armLive` reads the opposite of its own switch, press
    `reverse('arm')`; then `next`.
  - check: if `armLive` disagrees with its own switch, `reverse('arm')`; then `fly` (today).
- `Outcome.problems` keeps "check.throttle hint" as a problem.

--------------------------------------------------------------------------------------------------

## 7. Tests: what changes

### 7.1 Fixtures and helpers
- NEW `packages/input/test/fixtures/calib-v2.ts` = `git show 60fa9de:packages/input/src/calib.ts`
  with a first line saying it is the frozen v2 (negative control only). A copy is at
  `.cache/wz/calib-v2-head.ts`.
- `helpers.ts`: `v2Adapter()` (today's `newWizardAdapter` + `instructionOf` for the v2 state, moved
  here and typed on the fixture), `runV2(cfg, maxMs)`; `newWizardAdapter()` in human.ts becomes the v3
  one (`act`); `slowHuman(i)` = `gridHuman(i, 250)` with `slow = { lo: 3000, hi: 15000 }`;
  `Watch`: wraps a wizard, records every `(id, stage)` change with `cmds` before/after, and lists the
  changes not caused by a command outside the three allowed frame changes (I1). `Rig` gains
  `press(a: UiAction): Verdict` and runs its wizard under `Watch`.
- `Presser` (test helper): every `U(1000, 3000)` ms presses the first enabled of begin, next,
  measureAnyway, pick(first free), skipArm. Never Back / Start again (they would only loop).

### 7.2 `calib.test.ts`, case by case
| Today | Fate |
|---|---|
| 1 ideal person, 384 runs < 40 s | keep; each < 40 s (ideal presses at once) |
| 2 centre only when still, true rest | rewrite: Measure while stirring refused `centre.moving`; 10 s still WITHOUT a press: still centre/active; press after letting go: rest within 0.02 |
| 3 two sticks at once | keep: no assignment; zone `two` at once, hint `push.two {a:1, b:4}` |
| 4 stick already pushed when the screen appears | rewrite: Start refused `begin.held {ch:4}` while yaw is at 90 %; let go, Start, push: taken |
| 5 throttle already up, pulled down first | rewrite: throttle up at Start (prep ignored), pulled down and held: taken reversed; done shows the bar full with the stick down, `next` refused `next.thrDown`, `reverse('throttle')`, `next` accepted, `judge` clean. Second case: pulled down for 300 ms and back up: nothing taken, hint `push.hold` |
| 6 thumb rest | keep: the centre re-measured at yaw/pitch/roll Next; `judge` clean |
| 7 arm switch flicked while stirring is a switch | keep (with presses) |
| 8 noisy pot, no switch, hint at 8 s, Skip -> key | keep: Skip -> arm/done -> next -> check, arm `{kind:'key'}` |
| 9 momentary tap toggles; latching is a level | rewrite for the baseline: one tap -> toggle; held 1 s -> level |
| 10 no screen waits silently: hint and a way out within 12 s | rewrite: for every stage with idle hands and no press, the stage is unchanged after 15 s AND the screen offers the next action: an enabled primary (Start / Measure / Next), or where the primary is disabled (stir/active, fn/active, arm/active) a hint within 12 s (`stir.*` at 8 s, `push.none` at 5 s, `arm.none` at 8 s). Back / Start again / Close are always there |
| 11 Back | rewrite to 2's table: active -> ready, done -> ready (capture dropped), ready -> previous done (capture kept), redo Back -> check |
| 12 ArmLatch, 13 mapFrame + ArmGate, 14 the judge can fail | keep as they are |
| switch ON, flipped OFF and straight back ON | replace: switch ON at Start (`armPrepSkip`): `arm.wasOn` hint; Back, OFF, Start, ON: correct |
| someone already still lowers the throttle late | replace: Measure pressed while the throttle is being lowered: refused `centre.moving {ch:3}`, then accepted |
| a movement under way when the push screen appears | replace: Start refused `begin.moving` while a free stick moves |
| hint does not flicker (HINT_MIN_MS) | keep, on the done-stage refusal / push hints |
| saved profile resumes at the check | keep + `redo('yaw')` on the resumed wizard works and returns to check |
| corner-to-corner stir | keep (+ Done press) |
| sticks that move but not like sticks: stir hint | keep hint keys; Done stays disabled |
| sparse pad finishes on tick() | keep: finishes with presses only; no measureAnyway |
| "Use the current position" on a sparse pad | replace: `measureAnyway` after 2 refusals takes the held value |
| stick still held at its end when "let go" appears | rewrite: Measure refused `centre.ends`; let go: accepted, rests right |
| one glitch sample on a pot | keep |
| long OFF pause then back ON swapped back | delete (no arm-off screen) |
| Reverse on a 3-position arm | keep |
| impatient throttle up for a moment, rests at the bottom | keep: 300 ms up is below HOLD_MS; held up: taken, not reversed |
| "Continue anyway" on throttle down | delete (no such screen) |
| only one stick stirred: Continue after 12 s | replace: Done disabled, hint names the unstirred channel, stir it: Done enabled |
| after Continue with one stick... | delete |
| momentary held 1 s | replace: taken as a level; done shows ON only while held; Back, tap: toggle |
| cycled OFF and back ON before OFF screen | delete |
| 3-position paused in its middle | keep (far end seen on arm/done) |
| "Throttle all the way down" not confirmed by an earlier movement | delete |
| back at OFF within ARM_REACT_MS | delete |
| 3-position far end before Back does not carry over | keep (Back from check to arm/done, then arm/ready) |
| NEW: plateau | a rangeLimit 0.75 radio: Done enabled by plateau, `short` lists the channels, `judge` clean |
| NEW: refused commands change nothing (I3) | snapshot of captures before/after every refusal equal |

`human.test.ts`: 15 (384 grid people) keep, budget each run <= 180 s and no single `(id, stage)`
longer than 30 s; 16, 17 keep (first wizard). `fuzz.test.ts`: keep, same budgets. `fuzz-head.test.ts`: keep.
`sweep.ts`: budgets as 15; `--slow` (the slow people), `--v2 N` (the frozen v2 as a second control).

### 7.3 NEW `packages/input/test/paced.test.ts`: the acceptance of section 8, (a) to (e).

--------------------------------------------------------------------------------------------------

## 8. Acceptance

(a) IDLE: never advanced, never past a push step, never a profile. All runs under `Watch`.
- A1: sticks at rest from the first frame (AETR, T -1, arm off, noise 0.005, 500 Hz), no press, 120 s:
  `stir/ready` the whole time after the first frame, profile null.
- A2: same hands, `Presser` for 120 s: never past `stir/active` (Done never enabled), profile null.
- A3: the ideal person does stir and centre by commands up to `throttle/ready`, then hands frozen with
  the throttle at p in {-1, -0.6, -0.2, 0, 0.3, 0.6, 1}, `Presser` for 120 s: `assigned` stays empty,
  never past the throttle push, profile null.
- A4: as A3 but frozen at yaw/ready, pitch/ready, roll/ready (earlier steps done properly): never
  past that push.
- A5: the ideal person with every click dropped (hands follow the screens, no press), 60 s:
  `stir/ready`, profile null.
- Pass: every run as stated AND zero I1 violations.

(b) TINY: never accepted.
- Throttle (base at the bottom end, and base centred for a spring throttle), yaw, pitch, roll: moves of
  d in {0.05, 0.10, 0.15, 0.20, 0.25} of the reach, both directions, 150 ms ramp, held 3 s, back,
  3 repetitions: nothing accepted; zone `tiny` while held.
- Almost band d in {0.35, 0.50, 0.65}: nothing accepted; zone `almost`; after the return, hint
  `push.short {pct}` within 1 s of it.
- A 0.9 flick held 300 ms: nothing accepted.
- Positive controls in the same test: d = 0.75 accepted 400..(400 + ramp + 3 frames) ms after passing
  0.70; d = 0.75 the other way on a centred base: accepted with `invert = true`.

(c) SLOW: 100 people `slowHuman(0..99)` (every reaction and press 3..15 s): all `correct`, no hang
(maxMs 900 000), zero I1 violations. The full grid through `sweep.ts --slow` is reported, not in CI.

(d) The existing people still map correctly: test 1 (384 ideal), test 15 (384 grid), fuzz (768),
all `correct`, each run <= 180 s, no `(id, stage)` > 30 s; `sweep.ts --n 500` (12 000 runs) all
correct, p95 and max run time reported as measured.

(e) NEGATIVE CONTROL, the frozen v2 (`fixtures/calib-v2.ts`) through the same harness must FAIL:
- A5 on v2: reaches check WITH a profile (today 16.6 s, probe E) -> fails "never a profile";
- A3 on v2 (the ideal person until v2's "Let go" screen, then frozen hands and the `Presser` on v2's
  own escapes): `centre -> throttle push` with no command 2.5 s after it appears (probe A) -> I1 violated;
- (b) on v2 with the throttle parked at +0.2: +20 % and +25 % taken; parked at -0.2: -25 % taken as
  reversed (probe C) -> fails (b).
The test asserts each of these FAILS on v2 (if one ever passes, the harness lost its teeth). Honest
limit: v2 does NOT fail the clause "idle hands never past a push step" on its own (probes A and B:
0 of 10); its (a) failures are the command invariant and the profile without a press. The first
wizard controls (16, 17, fuzz-head) stay.

Page level (accept-fly on the implementer's own port, never the live server):
- B10 as today (robot good TAER/E, other order, broken stick never reaches step 6); the robot presses
  through `onAct` -> `act()`.
- B10b NEW: `&nobuttons=1`: after 30 s `step 1`, `stage 'ready'`, no profile.
- B10c NEW: `&nobuttons=1`, Playwright polls every 500 ms and presses Enter whenever
  `[data-primary]` is enabled (never clicks; a refused press is simply repeated on the next poll):
  reaches step 6 with the right mapping within 90 s (keyboard wiring of rule 1).
- Screenshots of every stage at 1920x1080 and 375x812 (`.cache/wz/shots/`), `scrollWidth <= innerWidth`
  in all; every stage shows Back, Start again and Close (rule 6).

Before handing back: `pnpm -r typecheck` and `npx vitest run` green in `C:/dev/gsfpv-wizard`.

--------------------------------------------------------------------------------------------------

## 9. Not covered, residual risks (say so, do not pretend)
- Nothing here is measured on a real radio. The thresholds come from the rules, QGC and the person
  model; the noise tolerance (3.2) is measured on simulated noise only. The person model is kinder
  than people (probe G: slow people come out right even on HEAD).
- Throttle direction: a radio throttle parked within +-15 % of its middle is treated as centred, and a
  pull DOWN after Start then reads as a reversed throttle. It needs two ignored "throttle down"
  instructions, and it is caught visibly at throttle/done (Next refused until the bar reads down,
  Reverse there). Same for an arm switch left ON at Start (caught at arm/done).
- A push the other way on yaw / pitch / roll gives a reversed channel, as in Liftoff; the result card
  and the check rows show it live, Reverse / Set again fix it. The wizard cannot know which way the
  stick physically went.
- 17 presses. If Andrii finds that too many, the next step is a radio switch or button as Next
  (not in this spec).
- Stick mode is still chosen by the pilot (the drawing), never detected.

## 10. Files and owners (suggested; the orchestrator decides)
| Owner | Files |
|---|---|
| CORE | `packages/input/src/calib.ts` (3, 4), `packages/input/src/sim/human.ts` (6.2, `act`) |
| TESTS | `packages/input/test/{calib,human,fuzz,paced}.test.ts`, `helpers.ts`, `sweep.ts`, `fixtures/calib-v2.ts` |
| UI | `apps/fly/src/ui/radio.ts`, `radio-art.ts`, `wizard.css`, `apps/fly/src/devices/fakehid.ts` (6.1), locales (5.6) |
| SHARED, 3 lines | `apps/fly/src/main.ts` (6: `act()` dispatch, `nobuttons`, `react`) |
| BENCH | `tools/bench/src/accept-fly.ts` B10b / B10c, `smoke-ui.ts` unchanged (it waits for step 6 with the robot) |
