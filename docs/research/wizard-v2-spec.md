# Calibration wizard v2: implementation spec (2026-09-25)

Scratch spec for the implementers (gitignored). Follow it literally. Where it says "must", tests check it.
Inputs merged: `diag-wizard/` (400 simulated people vs HEAD), `ux-research.md` + `mock.html` (screens,
drawing), the loading diag (context only). Repo HEAD at the time of writing: `ce4b8d2`.

Why this exists, in one paragraph: on Andrii's first run with his real radio the wizard froze on
"Let go of the sticks" (screenshot 2: bar full, 500 reports/s). Step 2 averaged the stick "centres"
over a fixed 1 s while his hands were still moving, step 4 then waited forever for the sticks to come
back to those wrong centres, with no message and no button. The diag reproduces it: HEAD hangs for
92.9 % of people who are still stirring when step 2 starts, and gets 20.3 % of all mappings wrong.
The new wizard measures only when things are still, always says what is wrong after a few seconds,
always offers a way out, and shows on a drawing of a radio which stick to move and where.

Ground rules (repeat of the task rules that matter here): English in code and docs, short "why"
comments, plain DOM via `h()`, no new dependencies, no Cyrillic/Polish letters outside
`packages/i18n/locales/`, our own drawing and our own words (nothing copied from Liftoff or any other
product), scratch scripts in `.cache/radio-ux/`.

--------------------------------------------------------------------------------------------------

## 0. Files and owners (suggested split; the orchestrator decides)

| Owner | Files | Notes |
|---|---|---|
| CORE | `packages/input/src/calib.ts` | the state machine, section A + B |
| CORE | `packages/input/src/sim/human.ts` (new), `packages/input/src/sim/index.ts` (+1 export line) | human model, section F |
| CORE | `packages/input/test/calib.test.ts`, `packages/input/test/human.test.ts`, `packages/input/test/sweep.ts`, `packages/input/test/fixtures/calib-head.ts` (all new) | tests, section F |
| UI | `apps/fly/src/ui/radio.ts`, `apps/fly/src/ui/radioart.ts` + `apps/fly/src/ui/radioart.css` (new), `apps/fly/src/ui/wizard.css` (new) | section C |
| UI | `apps/fly/src/devices/fakehid.ts`, `apps/fly/src/devices/hid.ts` | robot + bad-report counter |
| UI | `packages/i18n/locales/fly/{en,es,pl,ru}.json` | ALL keys of section D, including the HUD ones. SHARED with the loading implementer: re-read right before every Edit, append only |
| HUD | `apps/fly/src/ui/flight.ts`, `apps/fly/src/ui/hud-arm.css` (new), `apps/fly/src/controls.ts`, `apps/fly/src/devices/keyboard.ts` | section E |
| HUD | `apps/fly/src/main.ts` | SHARED with the loading implementer: small targeted Edits, re-read before each |

Contracts between owners: section B (calib.ts API, incl. `ArmLatch`), section C.4 (radioart.ts API)
and section E.1 (controls.ts exports `getStickMode`, `setStickMode`, `ArmView`, used by radio.ts and
flight.ts). Code against them; do not wait for the other owner.

Unchanged and must stay working: `mapFrame`, `channelOrder`, `ArmGate` (behaviour), `RawFrame`,
`AxisMap`, `Profile.version = 1`, localStorage key `gsfpv.profiles.v1`, `RadioScreen.runWizard(key,
name, subscribe, rate, kind)`, `RadioScreen.onDone`, `RadioScreen.wizard`, `wizard.state.step === 6`
+ `state.profile` + `state.message` + `state.error` (read by `tools/bench/src/accept-fly.ts` B10/B11),
the button `[data-action="wizard-done"]`, `FakeEdgeTx` query params `order inv offset noise rate broken`.

--------------------------------------------------------------------------------------------------

## A. The state machine (packages/input/src/calib.ts)

### A.1 Units and per-channel bookkeeping

Raw axes are normalised to [-1, 1] (as today). For channel i the wizard keeps, over all frames since
the current `stir` entry:

- `mins[i]`, `maxs[i]`; `h[i] = max(0.05, (maxs[i] - mins[i]) / 2)` (half travel), `mid[i] = (maxs[i] + mins[i]) / 2`.
- `cover[i] = (maxs[i] - mins[i]) / 2` (1.0 = both ends reached).
- Deflection from the middle: `dm(i) = (v - mid[i]) / h[i]`. Deflection from rest: `dr(i) = (v - rest[i]) / h[i]`.

Every "d" threshold below is in units of `h[i]`.

Still tracker (every channel, every frame, O(1), no allocation):
```
if (max(wMax[i], v) - min(wMin[i], v) > STILL_P2P) { stillSince[i] = t; wMin[i] = wMax[i] = v; wSum[i] = v; wN[i] = 1; }
else { wMin[i] = min(wMin[i], v); wMax[i] = max(wMax[i], v); wSum[i] += v; wN[i]++; }
stillMs(i)      = t - stillSince[i]
stillInPhase(i) = t - max(stillSince[i], phaseT0)     // a hold only counts from the moment the screen changed
stillMean(i)    = wSum[i] / wN[i]
```
"Current" value for escapes: EMA with tau 150 ms: `cur[i] += (v - cur[i]) * (1 - exp(-dt / 150))`.
Buttons: per bit b (0..23) keep `bitVal[b]`, `bitSince[b]` (time of the last change), and for the arm
step the press list (section A.6). Update bits only when `f.buttons !== lastButtons`.

Report rate independence: every rule is in milliseconds of `f.t`, never in frame counts (radios run
125..1000 Hz; Andrii's showed 500).

### A.2 Constants (export them as one `const TUNING = { ... } as const` so tests and the sweep print them)

| Name | Value | Meaning |
|---|---|---|
| STILL_P2P | 0.10 | still = peak-to-peak within 0.10 (5 % of full travel) |
| EMA_TAU_MS | 150 | "current position" for escapes |
| MOVING_SPAN | 0.30 | a channel "moves" (hint counting, first movement) |
| SWITCH_SPAN | 0.50 | min span of a switch |
| STICK_SPAN | 1.00 | min span of a stick |
| OTHER_FRAC | 0.10 | stick if at least this share of stir samples lies outside its 3 fullest of 32 bins |
| STIR_COVER | 0.90 | a stick is covered when `cover >= 0.9` |
| STIR_MIN_MS | 2500 | stir at least this long after the first movement |
| STIR_CONT_COVER | 0.50 | "Continue anyway" needs 4 sticks with at least this cover |
| STIR_HINT_MS | 12000 | hint + Continue |
| CENTRE_HOLD_MS | 800 | all sticks still this long |
| CENTRE_HINT_MS | 6000 | |
| CENTRE_ESCAPE_MS | 10000 | "Use the current position" |
| PUSH | 0.60 | pushed = `abs(dm) >= 0.6` |
| ARRIVE_FROM | 0.35 | a channel counts only after it was below this during the phase |
| QUIET | 0.35 | every other free stick: `abs(dr) < 0.35 or abs(dm) < 0.35` |
| STICK_HOLD_MS | 400 | yaw / pitch / roll push hold |
| THROTTLE_HOLD_MS | 700 | throttle push hold (longer than a "pull down first" dwell, see A.5) |
| TAKEN_HOLD_MS | 400 | an already-set channel pushed this long -> immediate hint |
| PUSH_HINT_MS | 5000 | |
| PUSH_ESCAPE_MS | 8000 | "Pick the channel by hand" |
| RELEASE_MID_TOL | 0.20 | back = `abs(dm) <= 0.2` ... |
| RELEASE_REST_TOL | 0.10 | ... or `abs(dr) <= 0.1` |
| RELEASE_HOLD_MS | 300 | |
| THR_DOWN_TOL | 0.20 | throttle within 0.2 h of its down end |
| THR_DOWN_HOLD_MS | 400 | |
| RELEASE_HINT_MS | 4000 | |
| RELEASE_ESCAPE_MS | 8000 | "Use the current position" / "Continue anyway" |
| ARM_JUMP | 0.50 | a switch level change is at least this big |
| ARM_SMALL | 0.15 | "moved only a little" hint |
| ARM_LEVEL_MS | 120 | a level counts when still this long (a 3-position switch passing its middle does not) |
| ARM_ON_HOLD_MS | 600 | new level held this long |
| ARM_OFF_TOL | 0.20 | back within 0.2 of the OFF level |
| ARM_OFF_HOLD_MS | 400 | |
| ARM_TAP_MS | 600 | a button press shorter than this is a tap |
| ARM_TAPS_WITHIN_MS | 4000 | two taps within this -> momentary button |
| ARM_HINT_MS | 8000 | "no switch" + how-to |
| ARM_OFF_HINT_MS | 5000 | |
| ARM_OFF_ESCAPE_MS | 8000 | |
| CONNECT_HINT_MS | 3000 | |
| OK_MS | 500 | check-mark pause after each success |
| CHECK_SUSPECT_MS | 3000 | throttle at >= 95 % and still this long in `check` -> hint |
| CLASSIFY_EVERY_MS | 100 | stir classification cadence |

These numbers come from the diag person model and the SimRadio; they are not measured on a real radio
yet. Say so in the calib.ts header comment.

### A.3 Steps and phases

Order of screens: `connect -> stir -> centre -> throttle(push, release) -> yaw(push, release) ->
pitch(push, release) -> roll(push, release) -> arm(on, off) -> check`.
Prompt order is `FNS = ['throttle', 'yaw', 'pitch', 'roll']` (changed from HEAD; left stick first in Mode 2).

Legacy numeric `step` (kept for main.ts / accept-fly / old readers): connect 1, stir 1, centre 2,
throttle|yaw|pitch|roll 3, arm 5, check 6. Value 4 is no longer produced (keep it in the `Step` type).
`message` = the say key (table below). `error` = `hint?.key ?? null`. `progress` = `hold`.

| id | phase | Done when | On success | say key (`message`) |
|---|---|---|---|---|
| connect | null | first frame | enter `stir` (no OK pause) | `wizard.say.connect` |
| stir | null | checked every 100 ms: >= 4 channels classified `stick` with `cover >= 0.9`, and `t - firstMoveT >= 2500` | freeze classes; `stickSet` = all `stick` channels | `wizard.say.stir` |
| centre | null | every channel in `stickSet` has `stillInPhase >= 800` | `rest[i] = stillMean(i)` for `stickSet` | `wizard.say.centre` |
| throttle | push | A.5 push rule, hold 700 ms | assign throttle (A.5) | `wizard.say.throttle.push` |
| throttle | release | throttle channel within `0.2 h` of its down end and `stillInPhase >= 400` | widen min/max | `wizard.say.throttle.release` |
| yaw, pitch, roll | push | A.5 push rule, hold 400 ms | assign fn with provisional `center = rest[c]` | `wizard.say.<fn>.push` |
| yaw, pitch, roll | release | channel c: `stillInPhase >= 300` and (`abs(dm) <= 0.2` or `abs(dr) <= 0.1`) | `rest[c] = stillMean(c)`, `center = rest[c]` (re-measured centre) | `wizard.say.release` |
| arm | on | A.6 | remember arm channel/bit + levels | `wizard.say.arm.on` |
| arm | off | A.6 | build ArmMap | `wizard.say.arm.off` |
| check | null | never by itself (Fly button) | - | `wizard.say.check` |

`firstMoveT`: first `t` in this stir entry at which any channel is `>= MOVING_SPAN` away from its first
value of this stir entry.

Entering `stir` (also after Back) resets mins/maxs, histograms, classes, `firstMoveT`, `stickSet`.

OK pause: on success set `ok = true`, `hold = 1`, remember the next (id, phase), `okUntil = t + OK_MS`.
While `ok`, frames still update the trackers and the live values but no condition is evaluated. When
`t >= okUntil` (in `feed` or `tick`) enter the next (id, phase). Exception: `connect -> stir` has no pause.

Entering any (id, phase): `phaseT0 = t`, `stuckMs = 0`, `hint = null`, `ok = false`, `hold = 0`,
reset the phase scratch (arrival flags, hold timers, `restrict`, maxima for hints) and push a trail
entry (A.8).

### A.4 Stir classification (switches never enter the stick race)

Per channel a 32-bin histogram over [-1, 1] of all stir frames: `bin = clamp(floor((v + 1) * 16), 0, 31)`.
Every 100 ms (and at the moment stir completes) classify:
```
span  = maxs[i] - mins[i]
other = 1 - (sum of the 3 largest bins) / (frames counted)
kind  = span >= STICK_SPAN && other >= OTHER_FRAC ? 'stick'
      : span >= SWITCH_SPAN && other < OTHER_FRAC ? 'switch'
      : 'idle'
```
Why it works: a stirred stick sweeps through many bins; a switch sits in 2-3 bins with single-frame
jumps. The diag showed HEAD putting the throttle on CH5 because the flicked arm switch spanned > 1.0.
Only `stickSet` channels ever take part in A.5; the arm step (A.6) may use any channel that is not
assigned to a stick function.

### A.5 Push rule (all four functions; mode-agnostic: whatever moves is that function)

Free channels F = `stickSet` minus channels already assigned. If `restrict !== null` (Pick by hand),
F = `[restrict]` and the QUIET condition is skipped.

Per phase and channel keep `armed[i]` ("arrived from the middle"): set when `abs(dm(i)) < ARRIVE_FROM`
at any frame of this phase. A channel parked at an end since the phase started never counts; this is
what stops a throttle that rests at the bottom (or a pot turned to an end) from being taken without a
movement.

Candidate this frame: exactly one channel c in F with `armed[c] && abs(dm(c)) >= PUSH`, and every other
channel j in F has `abs(dr(j)) < QUIET || abs(dm(j)) < QUIET`. (Two rest references so that a rest
polluted by a thumb, or a pot parked at an end, cannot block the quiet test.)

Hold: `holdStart` is set when the candidate (channel, sign of dm) first appears; any frame with no
candidate, a different channel or a different sign resets it. Success when
`t - holdStart >= THROTTLE_HOLD_MS` (throttle) or `STICK_HOLD_MS` (others). `hold = elapsed / needed`.

Assignment (sign s = sign of dm(c) at success; "up" for throttle and pitch, "right" for yaw and roll
are positive, as in HEAD):
```
throttle: { index: c, invert: s < 0, center: s < 0 ? maxs[c] : mins[c], min: mins[c], max: maxs[c] }
other fn: { index: c, invert: s < 0, center: rest[c], min: mins[c], max: maxs[c] }   // center re-measured in release
```
Throttle down end = `s > 0 ? mins[c] : maxs[c]`. After any success keep widening `mins/maxs` of
assigned channels with every frame (the profile takes the final values at `check`).

Why 700 ms for the throttle: a person whose throttle is already up and who is asked "up" often pulls
it down first; the diag model dwells there 150-400 ms before pushing up. A 700 ms hold ignores that
dwell and catches the real "up", which people hold until the screen changes. The check screen still
offers Reverse throttle and warns if the throttle rests at 100 % (A.7).

Live helper values in push: `leader` = the channel in F with the largest `abs(dm)` (ch index and
`mag = min(1, abs(dm))`); `maxLead` = the largest `abs(dm)` of any armed F channel in this phase.
"Taken": if an ASSIGNED channel was below ARRIVE_FROM in this phase and then stays at
`abs(dm) >= PUSH` for `TAKEN_HOLD_MS`, set hint `wizard.hint.push.taken` {fn: that channel's function}
immediately (not after 5 s); clear it when that channel is back below ARRIVE_FROM.

### A.6 Arm step (robust to noisy pots; no-switch path)

Candidates: every axis channel NOT assigned to a stick function (switches, idle channels, unassigned
extra sticks), and all 24 button bits.

Axis levels, per candidate channel i, evaluated every frame:
```
if (stillMs(i) >= ARM_LEVEL_MS) {
  m = stillMean(i)
  if (lvl[i] === null)                   { lvl[i] = m; lvlSince[i] = stillSince[i]; }
  else if (abs(m - lvl[i]) >= ARM_JUMP)  { prevLvl[i] = lvl[i]; lvl[i] = m; lvlSince[i] = stillSince[i]; changedInPhase[i] = true; }
  else                                    { lvl[i] = m; }            // same level, refined; lvlSince kept
}
maxExc[i] = max(maxExc[i], abs(v - (lvl[i] ?? v)))                  // for the "moved a little" hint
```
Levels are kept across the `on` and `off` phases (reset only on entering `arm/on`, where `lvl` starts
from the channel's current still level). A noisy pot never moves 0.5 between two still levels, so it can
never become the arm switch (HEAD armed itself 8 ms into a flight on such a pot).

Phase `on`, success (first match wins):
1. Axis: a channel with `changedInPhase[i]` and `t - lvlSince[i] >= ARM_ON_HOLD_MS`. Remember
   `armCh = i`, `onLvl = lvl[i]`, `offLvl = prevLvl[i]`. Go to `off`.
   (Someone whose switch was already ON flips it OFF, then ON again: the short OFF dwell does not reach
   600 ms, the final ON does, and the last change gives the right ON/OFF pair.)
2. Latching bit: bit b changed and has kept the new value for `ARM_ON_HOLD_MS`. `armBit = b`,
   `onVal = bitVal[b]`. Go to `off`.
3. Momentary bit: bit b had two complete presses (0 -> 1 -> 0), each 1-period shorter than
   `ARM_TAP_MS`, the second release within `ARM_TAPS_WITHIN_MS` of the first press, and is 0 now.
   Arm = `{ kind: 'button', bit: b, toggle: true }`; skip `off`, go to `check`.

Phase `off`, success:
- Axis: `abs(stillMean(armCh) - offLvl) <= ARM_OFF_TOL` and `stillInPhase(armCh) >= ARM_OFF_HOLD_MS`.
  Arm = `{ kind: 'axis', index: armCh, threshold: (onLvl + offLvl) / 2, onAbove: onLvl > offLvl }`.
- Bit: `bitVal[armBit] !== onVal` for `ARM_OFF_HOLD_MS`. Arm = `{ kind: 'button', bit: armBit, inverted: onVal === 0 || undefined }`.

Skip (button, any arm phase): Arm = `{ kind: 'key' }` (arm with Space or the on-screen ARM button,
section E). Go to `check`.

### A.7 Check

On entering `check`: build the profile (`version: 1`, `wizard: 2`, axes from `assigned` with current
mins/maxs, `arm`, `angleMode: null`, `deadband: 0`, `created`), set `state.profile`. The wizard does not
save anything (the UI saves on Fly; HEAD saved at once, so a wrong profile was reused forever).
Live values come from `mapFrame(profile, f, ...)`; `checks = { throttleLow: u <= 0.05, armOn,
centred: abs(roll), abs(pitch), abs(yaw) all <= 0.1 }` where `u = (ch[2] + 1) / 2` and `armOn` is
`armOn(profile.arm, f)` for axis and latching button, `null` for toggle and key.
Suspect throttle: `u >= 0.95` and the throttle channel `stillMs >= CHECK_SUSPECT_MS` -> hint
`wizard.hint.check.throttle` {pct: round(u*100)}.
`reverse(fn)`: axes -> flip `invert` (throttle also sets `center` to the new down end); `'arm'` -> axis
flips `onAbove`, button flips `inverted`, key: no-op. Update `state.profile` in place.

### A.8 Back, trail, escapes

Trail: entering any (id, phase) from `stir` on pushes `{ id, phase, snap }` where `snap` is a deep copy
of `{ assigned, rest, arm: { armCh, onLvl, offLvl, armBit, onVal, map } }` at entry (`map` = the
ArmMap built so far, or null). `back()`:
- during an OK pause: cancel it, restore the top entry's `snap`, re-enter the top entry (redo this
  screen, trail not pushed again); return true;
- else if `trail.length >= 2`: pop, restore the new top's `snap`, re-enter it (no push); return true;
- else return false (on `stir` or on a resumed `check`: the UI then cancels to the device choice).

Escapes (all set `hint = null` and act at the current time `now`):
- `cont()`: `stir` when `can.cont` -> succeed with `stickSet` = channels classified stick; `throttle/release`
  -> succeed; `arm/off` -> succeed with the levels seen.
- `useCurrent()`: `centre` -> `rest[i] = cur[i]` for `stickSet`, succeed; stick `release` ->
  `rest[c] = cur[c]`, succeed.
- `pick(ch)`: push phases only, `ch` in `freeChannels()`: `restrict = ch`, reset `armed`, hold, stuck timer.
- `skipArm()`: A.6 skip.
- `reverse(fn)`: A.7.
Methods called when not allowed do nothing.

### A.9 Hints (`hint = { key, params }`), shown after `stuckMs` (time in the phase)

| id/phase | at | key and params (first matching line) |
|---|---|---|
| connect | 3 s | `wizard.hint.noData` (the UI replaces it with `wizard.hint.badReport` {len} when the HID source counted unreadable reports) |
| stir | 12 s | channels with span >= MOVING_SPAN < 4 -> `wizard.hint.stir.few` {n}; else stick channels < 4 -> `wizard.hint.stir.few` {n: stick count}; else among the 4 stick channels with the largest span, the one with the lowest cover -> `wizard.hint.stir.coverage` {ch: i+1, pct: round(cover*100)} |
| centre | 6 s | the `stickSet` channel with the smallest `stillInPhase` -> `wizard.hint.centre.moving` {ch} |
| push | now | "taken" rule of A.5 |
| push | 5 s | throttle step and some F channel had `abs(dm) >= PUSH` at phase start and was never below ARRIVE_FROM -> `wizard.hint.throttle.already`; else two F channels were both at `abs(dm) >= PUSH` at the same time during the last 2 s -> `wizard.hint.push.two` {a, b}; else `0.3 <= maxLead < 0.6` -> `wizard.hint.push.short`; else `wizard.hint.push.none` |
| release (stick) | 4 s | `stillMs(c) < 300` -> `wizard.hint.release.moving`; else `wizard.hint.release.off` {fn, pct: round(abs(dm)*100)} |
| throttle/release | 4 s | `wizard.hint.throttle.down` {pct: round(100 * (v - down) / (up - down))} |
| arm/on | 8 s | some candidate had `ARM_SMALL <= maxExc < ARM_JUMP` -> `wizard.hint.arm.small` {ch}; else `wizard.hint.arm.none` (the UI also shows the how-to list) |
| arm/off | 5 s | `wizard.hint.arm.back` |
| check | live | suspect throttle (A.7) |

`{fn}` params carry the function id (`'roll'` etc.); the UI translates it with `wizard.axis.<fn>`.
`{ch}` params are 1-based channel numbers.

### A.10 What is enabled (`can`)

| id/phase | back | cont | useCurrent | pick | skipArm | fly | reverse |
|---|---|---|---|---|---|---|---|
| connect | no | - | - | - | - | - | - |
| stir | no (UI shows Cancel) | stuck >= 12 s and >= 4 stick channels (span >= 1.0) | - | - | - | - | - |
| centre | yes | - | stuck >= 10 s | - | - | - | - |
| push | yes | - | - | stuck >= 8 s | - | - | - |
| stick release | yes | - | stuck >= 8 s | - | - | - | - |
| throttle release | yes | stuck >= 8 s | - | - | - | - | - |
| arm/on | yes | - | - | - | always | - | - |
| arm/off | yes | stuck >= 8 s | - | - | always | - | - |
| check | trail >= 2 | - | - | - | - | yes | yes |

Result: no state waits silently. Every waiting state has a numeric hint within 12 s and an escape
within 12 s (Cancel / Start again are always on screen, section C).

### A.11 Pseudo-code of feed / tick

```
feed(f):
  if (!started) return state                       // start() not called yet (as HEAD step 0)
  now = max(now, f.t); dt = now - lastT; lastT = now
  if (nAxes === 0) init(min(8, f.axes.length))     // allocate once, all typed arrays
  track(f, dt)                                      // A.1 trackers, histograms only while id === 'stir'
  if (id === 'connect') enter('stir', null)
  if (ok) { if (now >= okUntil) enterPending(); else { live(f); return state } }
  evaluate(f)                                       // the rule of the current (id, phase); may call succeed()
  live(f)                                           // channels[], mapped, leader, checks, hold
  timers()                                          // stuckMs, hint, can
  return state

tick(t):                                            // UI calls every 250 ms with performance.now()
  if (!started) return state
  now = max(now, t)
  if (ok && now >= okUntil) enterPending()
  timers()
  return state
```
No allocation per frame (reuse `state`, `channels`, typed arrays). `state` is ONE mutable object
returned by every call (as HEAD). Frames can arrive at 1000 Hz: per-frame work O(nAxes + changed bits).

`live(f)`: `channels[i] = { v, lo: mins[i], hi: maxs[i], kind, fn, still: stillMs(i) >= 300, cover }`
(update fields in place); `mapped[fn]` for every assigned fn through the partial profile (same math as
`mapFrame`; unknown = NaN); `mapped.arm` = arm level if known, else null; `assigned[fn] = index`.

--------------------------------------------------------------------------------------------------

## B. TypeScript API (the contract)

```ts
// packages/input/src/calib.ts (additions and changes; everything else stays)
export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';
export const FNS: Fn[] = ['throttle', 'yaw', 'pitch', 'roll'];          // prompt order
export type StepId = 'connect' | 'stir' | 'centre' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'check';
export const STEP_IDS: StepId[] = ['connect', 'stir', 'centre', 'throttle', 'yaw', 'pitch', 'roll', 'arm', 'check'];
export type Phase = 'push' | 'release' | 'on' | 'off' | null;
export type Dir = 'up' | 'down' | 'right' | 'centre' | 'stir' | 'flip';
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;                          // legacy, see A.3

export type ArmMap =
    | { kind: 'axis'; index: number; threshold: number; onAbove: boolean }
    | { kind: 'button'; bit: number; toggle?: boolean; inverted?: boolean } // toggle: momentary, each press flips
    | { kind: 'key' };                                                      // no switch: Space / on-screen ARM

export interface Profile {                    // version stays 1; new fields optional (old saves stay valid)
    version: 1; deviceKey: string; deviceName: string;
    axes: Record<Fn, AxisMap>; arm: ArmMap | null; angleMode: ArmMap | null; deadband: number; created: string;
    mode?: 1 | 2;                             // stick mode chosen for the drawings; never used for mapping
    wizard?: number;                          // 2 = made by this wizard; absent = made by the first one
}

export interface Hint { key: string; params: Record<string, string | number> }
export type ChannelKind = 'stick' | 'switch' | 'idle';
export interface ChannelLive { v: number; lo: number; hi: number; cover: number; kind: ChannelKind; fn: Fn | 'arm' | null; still: boolean }
export interface Can { back: boolean; cont: boolean; useCurrent: boolean; pick: boolean; skipArm: boolean; fly: boolean; reverse: boolean }
export type ArmSource = { kind: 'ch'; n: number } | { kind: 'button'; n: number } | { kind: 'key' };  // n is 1-based

export interface WizardState {
    // legacy, still read by main.ts, fakehid, accept-fly
    step: Step;
    prompt: Fn | null;                        // push/release: the fn of the step, else null
    message: string;                          // say key (A.3)
    progress: number;                         // = hold
    error: string | null;                     // = hint?.key ?? null
    profile: Profile | null;                  // set on entering check
    // new
    id: StepId;
    phase: Phase;
    target: { what: Fn | 'arm' | 'sticks'; dir: Dir } | null;
    hold: number;                             // 0..1, drives the ring
    ok: boolean;                              // true during the OK pause
    stuckMs: number;
    hint: Hint | null;
    can: Can;
    channels: ChannelLive[];                  // length nAxes (0 until the first frame)
    mapped: { roll: number; pitch: number; throttle: number; yaw: number; arm: boolean | null }; // NaN = unknown
    assigned: Partial<Record<Fn, number>>;    // channel index per function so far
    armSource: ArmSource | null;
    leader: { ch: number; mag: number } | null;   // push only
    sticksDone: number;                       // stir: stick channels with cover >= 0.9 (UI shows "n of 4")
    checks: { throttleLow: boolean; armOn: boolean | null; centred: boolean } | null;  // check only
}

export class CalibrationWizard {
    state: WizardState;
    constructor(deviceKey: string, deviceName: string);   // unchanged
    /** Resume at the check screen with a saved profile (no trail: Back is disabled). */
    static resume(p: Profile): CalibrationWizard;
    start(t: number): void;              // enters 'connect'; the first feed enters 'stir'
    feed(f: RawFrame): WizardState;      // unchanged signature
    tick(t: number): WizardState;        // timers without frames (connect hint, OK pause end)
    back(): boolean;
    cont(): void;
    useCurrent(): void;
    pick(ch: number): void;
    skipArm(): void;
    reverse(what: Fn | 'arm'): void;
    freeChannels(): number[];            // push: channels in F (for the pick list)
}
export const TUNING: { readonly [k: string]: number };

/** Arm level from the profile's arm input; momentary buttons and the keyboard arm latch here. */
export class ArmLatch {
    on: boolean;                          // latched state for 'key' and toggle buttons
    level(arm: ArmMap | null, f: RawFrame | null): boolean;   // axis/level button: armOn(); toggle: flips on each press edge; key: this.on
    toggle(): void;                       // Space / on-screen ARM (only meaningful for kind 'key')
    reset(): void;                        // refused or ended request: back to off
}
export function armOn(a: ArmMap | null, f: RawFrame): boolean;  // + 'key' -> false, button honours `inverted`
```
`target` values: stir `{what:'sticks', dir:'stir'}`; centre `{what:'sticks', dir:'centre'}`; push
`{what: fn, dir: fn === 'throttle' || fn === 'pitch' ? 'up' : 'right'}`; stick release `{what: fn,
dir:'centre'}`; throttle release `{what:'throttle', dir:'down'}`; arm `{what:'arm', dir:'flip'}`;
connect and check `null`.

`resume(p)`: state `id:'check'`, `step: 6`, `profile: p`, trail empty, trackers initialised on the
first frame, live values from `mapFrame`. It lets the UI show a saved profile for checking instead of
using it blindly.

`parseProfile` (controls.ts) additionally rejects an `arm` whose `kind` is not `axis | button | key`.

--------------------------------------------------------------------------------------------------

## C. The UI (apps/fly/src/ui/radio.ts, radioart.ts, wizard.css)

### C.1 RadioScreen API (kept + small additions)

```ts
export class RadioScreen {
    readonly root: HTMLDivElement;
    onDone: ((c: RadioChoice) => void) | null;
    onClose: (() => void) | null;             // NEW: Esc / Close on the device choice
    wizard: CalibrationWizard | null;
    constructor(parent: HTMLElement, current?: RadioChoice | null);   // NEW optional arg: reuse its hid/gamepad
    runWizard(key: string, name: string, subscribe: (cb: (f: RawFrame) => void) => void, rate: () => number, kind: SourceKind): void;
    remove(): void;                           // also detaches listeners, timers, rAF (C.7)
}
```
`import './wizard.css';` at the top of radio.ts (Vite injects it; `vite/client` types cover it).

### C.2 Device choice screen

As today (four choices + the "Real radios" line), plus:
- Header row: `h1` "Controls" and a close button (`.panel-x`, aria-label `wizard.btn.close`,
  `data-action="radio-close"`) -> `onClose`.
- If `current` has a hid or gamepad with a profile: a block at the top: `radio.connected` {name},
  report rate, buttons `common.fly` (`data-action="radio-keep"` -> `onDone(current)`) and
  `radio.setupAgain` (`data-action="radio-setup"` -> runWizard with the same source).
- `connectHid` / `connectGamepad`: when a saved profile exists, do NOT hand it over silently. Run the
  check screen with `CalibrationWizard.resume(saved)` (same live drawing and bars), plus the line
  `radio.saved` {name} and, when `saved.wizard` is absent, `wizard.oldProfile`. Buttons: Fly,
  `radio.setupAgain`.
- Focus the first enabled button when the screen opens.

### C.3 Wizard layout

```
div.screen.radio.interactive[role=dialog][aria-modal=true][aria-labelledby=wz-title]
  div.wz
    ol.wz-steps                              9 items: Connect Stir Let-go Throttle Yaw Pitch Roll Arm Check
    div.wz-main
      div.wz-head
        h1#wz-title[tabindex=-1]             wizard.heading
        button.wz-mode[data-action=wizard-mode][aria-label=wizard.mode.change]   wizard.mode.2 | wizard.mode.1
      div.wz-live[aria-live=polite]
        p.wz-say                              t(state.message)
        p.wz-sub                              t(subKey(state, mode))   (C.5)
      div.wz-stage                            the drawing (C.4) + `wizard.stir.count` in stir
      p.wz-hint[role=status]                  t(hint.key, params); hidden when empty
      div.wz-extra                            how-to (arm none) | pick list | check list + function bars
      div.wz-chans                            CH1..CHn bars (C.6)
      p.wz-rate.muted.small                   radio.rate {hz}   + p.wz-kbd (wizard.kbd; hidden on coarse pointers)
      div.wz-actions                          buttons (C.5)
```
Background of `.screen.radio`: `rgba(7, 8, 10, .84)` (the scene, if loaded, stays faintly visible;
HEAD's 94-98 % made it look like a dead black page).

Desktop (>= 721 px): `.wz { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px;
max-width: 1100px; margin: 0 auto; }`. Steps list vertical: each `li` is a 22 px circle (number, or a
check when done) + label; current item: `aria-current="step"`, `background: var(--bg2)`,
`outline: 1px solid var(--accent)`; done: circle filled `--accent` with `--accent-ink` check;
skipped arm: dashed circle. `.wz-say` 26 px / 650; `.wz-sub` `--muted` 15 px; drawing
`width: 100%; max-height: 52vh`.
Phone (<= 720 px, checked at 375x812): single column; `.wz-steps` becomes a row of 28 px circles
(`display: flex; gap: 4px; overflow-x: auto`), only the current label visible; `.wz-say` 21 px;
drawing full width (343 px wide, about 214 px tall); `.wz-chans` 8 columns, gap 3 px, bar 40 px
high; `.wz-actions { position: sticky; bottom: 0; background: rgba(7,8,10,.95); padding: 8px 0
max(8px, env(safe-area-inset-bottom)); }` with buttons `flex: 1 1 0; min-height: 48px`. No element
may be wider than the viewport (every grid/flex child `min-width: 0`). Must: `scrollWidth <=
innerWidth` in every state at 375x812 and 1920x1080.

### C.4 The radio drawing (apps/fly/src/ui/radioart.ts, new; our own generic transmitter)

API (the HUD uses it too):
```ts
export type Side = 'L' | 'R';
export type ArtTarget =
    | { side: Side | 'both'; dir: 'up' | 'down' | 'right' | 'centre' | 'stir' }
    | { side: 'SW'; dir: 'flip' }
    | null;
export interface ArtState {
    mode: 1 | 2;
    target: ArtTarget;
    knobL: [number, number] | null;   // x (right +), y (up +) in -1..1; null = unknown: grey knob at centre
    knobR: [number, number] | null;
    hold: number;                     // 0..1 ring around the target knob (only for side L/R)
    ok: boolean;                      // check mark on the target
    sw: boolean | null;               // arm lever: ON (accent), OFF, null unknown (grey)
    tol: number;                      // dashed "let go here" circle, fraction of travel (0 = none)
    label: string;                    // aria-label (say + sub)
}
export interface RadioArt { readonly el: SVGSVGElement; set(s: ArtState): void }
export function radioArt(opts?: { mini?: boolean }): RadioArt;
export function sideOf(fn: 'roll' | 'pitch' | 'throttle' | 'yaw', mode: 1 | 2): Side;
    // Mode 2: throttle, yaw -> L; pitch, roll -> R.   Mode 1: pitch, yaw -> L; throttle, roll -> R.
export function knobsFrom(m: { roll: number; pitch: number; throttle: number; yaw: number }, mode: 1 | 2): { L: [number, number]; R: [number, number] };
    // horizontal: yaw on L, roll on R (both modes); vertical: throttle/pitch per sideOf; NaN -> 0
```
Built once with `document.createElementNS('http://www.w3.org/2000/svg', ...)` (a local `s(tag, attrs)`
helper; `h()` makes HTML only). `set()` only changes attributes and classes; it never rebuilds.

Geometry, `viewBox="0 0 400 250"`, `role="img"`:
- Body: `path d="M60 44 H340 Q384 44 384 92 V168 Q384 236 330 236 Q300 236 286 214 H114 Q100 236 70 236 Q16 236 16 168 V92 Q16 44 60 44 Z"` class `rb-body`.
- Shoulder switches: left `rect x=62 y=30 w=30 h=18 rx=5` + lever `line x1=77 y1=32 x2=77 y2=10` (class `rb-sw-lever`, OFF = `rotate(-25deg)`, ON = `rotate(25deg)`, pivot at the bottom: `transform-box: fill-box; transform-origin: 50% 100%`); right one at x=308 / lever x=323, decorative. When the target is SW: a ghost lever (same line, class `rb-ghost-lever`, dashed `--ghost`, animated `rb-flip`) over the left lever, and text "ARM" (`rb-lbl`, 11 px) at (77, 64).
- Screen: `rect x=172 y=56 w=56 h=30 rx=5` class `rb-screen`.
- Two wells, `g transform="translate(110 150)"` and `translate(290 150)`: `rect x=-58 y=-58 w=116 h=116 rx=18` (`rb-well`), travel circle `r=46` (`rb-ring`), cross lines to +-46 (`rb-cross`), ghost group, arrow path, tolerance circle, shaft `line 0,0 -> knob` (`rb-shaft`), knob `circle r=12` (`rb-knob`), hold ring `circle r=20` (`rb-hold`, `stroke-dasharray = hold*125.7 125.7`, rotated -90 deg so it fills clockwise from the top), ok mark `path d="M-8 0 L-2 6 L9 -6"` at the knob (`rb-ok`).
- Knob position: `(x * 46, -y * 46)`.
- Ghost: `circle r=12` class `rb-ghost` inside `g` with class `rb-g-up | rb-g-down | rb-g-right | rb-g-stir`; for `centre` a static ghost at (0,0) plus the tolerance circle `r = tol * 46` (dashed).
- Arrow beside the well so the knob never hides it: vertical `M x 34 L x -30` (up) or reversed (down) with `x = -70` on the left well and `x = +70` on the right well; horizontal `M -34 68 L 30 68`. Arrow head: one `marker` in `defs` (`path M0,0 L10,5 L0,10 z`, fill `--ghost`).
- Labels under the wells at y=244: Mode 2 "Throttle · Yaw" / "Pitch · Roll", Mode 1 "Pitch · Yaw" / "Throttle · Roll" built from `wizard.axis.*` joined with " · ".
- Target well: `rb-well target` (2.5 px `--ghost` stroke) and label `target`; with a single-side target the other well group gets `rb-dim` (opacity .35).
- Mini variant (`mini: true`, 96x60 CSS px): same body, wells, knobs, lever; no labels, arrows, ghosts, ring or "ARM" text; strokes 2x thicker so they survive the scale; a target well or switch still gets the `--ghost` stroke.

Styles of the drawing live in `radioart.css`, imported by radioart.ts (so the wizard and the HUD both
get them). The root `svg` has class `rb` (plus `rb-mini` for the mini variant). Colours (fly.css
variables where they exist): knob `--accent` with `--accent-ink` 2 px stroke; unknown knob `#6b7280`;
ghost, arrow, target stroke `--ghost`; ring and ok `--accent`; lever ON `--accent`, OFF `#9aa3ad`
(= `--muted`). Define on `svg.rb`: `--ghost: #7dd3fc; --rb-body: #151b23; --rb-edge: #2c3643;
--rb-well: #0b0f14;`. The hint box colours (`--hint-bg: #2a2108; --hint-edge: #5b4a12; --hint-fg:
#fde68a`) are defined on `.wz` in wizard.css.

Animation (CSS keyframes in radioart.css, moves in SVG user units = px):
`rb-up` / `rb-down` / `rb-right`: 1.6 s ease-in-out infinite, 0-15 % at 0, 55-85 % at 40 px, back at
100 %. `rb-stir`: 1.8 s linear infinite around a 40 px circle (4 keyframes). `rb-flip` on the ghost
lever: rotate -25 -> +25 deg, 1.4 s. `@media (prefers-reduced-motion: reduce)`: no animation; the ghost
stands at the end point (`transform: translate(0,-40px)` etc.), the stir ghost is hidden and the travel
circles get the `--ghost` stroke instead, the lever ghost stands at +25 deg. The hold ring and live knobs
still move (they are feedback, not decoration), without transitions.

### C.5 Screen by screen

Mode: chip in the header, default Mode 2, stored in localStorage `gsfpv.stickMode` ('1' | '2', try/catch,
helpers `getStickMode()` / `setStickMode()` exported from controls.ts). Changing it redraws labels,
sides and sub lines only. Saved into `profile.mode` on Fly.

Sub line key: `subKey(st, mode)`:
stir `wizard.sub.stir`; centre `wizard.sub.centre`; push `wizard.sub.<side>.<up|right>`; stick release
`wizard.sub.<side>.let`; throttle release `wizard.sub.<side>.down`; arm on `wizard.sub.arm.on`; arm off
`wizard.sub.arm.off`; check `wizard.sub.check`; connect none. `<side>` = `sideOf(fn, mode)`.

Drawing state per screen (`knobs*` from `knobsFrom(state.mapped, mode)`; axes not yet assigned stay 0;
a knob with no assigned axis at all is `null` = grey):

| Screen | target | knobs | extra | buttons (left to right) |
|---|---|---|---|---|
| connect | null | null, null | - | Cancel |
| stir | both/stir | null, null (the channel bars are the live feedback: mapping unknown) | `wizard.stir.count` {n: sticksDone} under the drawing | Cancel, [Continue anyway if can.cont], Start again |
| centre | both/centre, `tol: 0.2`; in addition the throttle side (by mode) shows the down ghost + down arrow | null, null | bars show a green dot when `still` | Back, [Use the current position], Start again |
| push | side of fn / up or right | assigned axes live; the target axis shows `leader.mag` along the target direction (magnitude only: the sign is not known yet) | ring = hold; pick panel when opened | Back, [Pick the channel by hand], Start again |
| stick release | side/centre, `tol: 0.2` | live | - | Back, [Use the current position], Start again |
| throttle release | side/down | live | - | Back, [Continue anyway], Start again |
| arm on/off | SW/flip | live | how-to list when hint is `arm.none` | Back, Skip: arm with Space, [Continue anyway on off], Start again |
| check | null | all live via the profile; lever = armOn | check list + function bars with Reverse | Fly (primary, large, focused), Back (or `radio.setupAgain` when resumed: `can.back` false), Start again, Download profile, Load profile |

Implementation note: one private `mount(wz, key, name, subscribe, rate, kind)` builds the screen for a
given wizard; `runWizard` = `mount(new CalibrationWizard(key, name), ...)` and the saved-profile path =
`mount(CalibrationWizard.resume(saved), ...)`. "Start again" and "Set up again" call `runWizard` with the
same arguments (a fresh wizard, as HEAD did).

OK pause: `ok` true -> the ok mark on the target, the steps list item gets its check at once.

Pick panel (push, after `can.pick`): title `wizard.pick.title` {fn}; one button per `freeChannels()`
entry: "CH n" + a live mini bar; `data-action="pick-ch-<n>"`; click -> `wz.pick(i)`, close panel.

How-to (arm, hint `arm.none`): `wizard.howto.title` + ordered list `wizard.howto.1..3` +
`wizard.howto.skip`; the Skip button gets `primary` style while this is shown.

Check list (live ticks, `aria-live=off`, each tick is a small inline SVG check path, not a font
glyph; pending rows show an empty 10 px circle): `wizard.check.throttle`, `wizard.check.arm` (or `wizard.check.armKey` for toggle/key),
`wizard.check.centre`. Function bars (as HEAD `showBars`): Throttle, Yaw, Pitch, Roll, Arm, each with a
small `wizard.btn.reverse` button (`data-action="reverse-<fn>"`, arm: `reverse-arm`; hidden for key).
Summary line: `wizard.summary` {order: channelOrder(p), arm: t(armSource key)}. The old
"Looks like Mode 2" text is gone (channel order says nothing about stick mode).

Fly (`data-action="wizard-done"`): set `p.mode = mode`, `saveProfile(p)`, then `onDone({ kind, profile: p, hid?, gamepad? })`.

data-action names: `wizard-back`, `wizard-cancel`, `wizard-continue`, `wizard-use-current`,
`wizard-pick`, `wizard-skip-arm`, `wizard-restart`, `wizard-mode`, `wizard-done`, `wizard-export`,
`wizard-import`, `reverse-<fn|arm>`, `pick-ch-<n>`, `radio-close`, `radio-keep`, `radio-setup`.
Hidden buttons are not rendered; buttons are enabled/disabled by `can` (never all disabled: Cancel or
Start again is always there).

Rendering: frames call `wz.feed(f)` only; one `requestAnimationFrame` loop renders the state (at most
once per frame; rebuild `.wz-extra` / `.wz-actions` only when `id|phase|hint.key|can` changed, update
attributes otherwise); a 250 ms `setInterval` calls `wz.tick(performance.now())`. `start(performance.now())`
is called when `runWizard` begins (not at the first frame). Report rate: `radio.rate` {hz} as today.
Bad reports: when `kind === 'hid'` and `this.hid.badReports > 0` while `state.id === 'connect'`, show
`wizard.hint.badReport` {len: this.hid.lastBadLen} instead of the state's hint.

### C.6 Channel bars (`.wz-chans`)

One cell per channel (CH1..CHn): a 56 px (phone 40 px) high track (`--line`); a translucent `--accent`
band from `lo` to `hi` (coverage); a 3 px `--fg` line at `v`; label "CHn" and, once assigned, the
function letter (T, R for yaw, E for pitch, A for roll, "ARM"). Cell outline `--accent` when `cover >=
0.9` and kind is stick; switch channels hatched (`repeating-linear-gradient`); a small dot turns
`--accent` when `still` (centre and release screens only). Hidden on `check` (the function bars replace
them).

### C.7 Keyboard, focus, screen reader, lifetime

- While mounted, a `keydown` listener on `window` with `{ capture: true }`: Escape -> Cancel (wizard ->
  device choice; device choice -> `onClose`); Backspace (when focus is not in an input) -> Back; for
  Escape, Backspace, KeyP, KeyR and Space call `e.stopPropagation()` so the flight shortcuts do not act
  behind the screen (main.ts also checks, section E.4).
- Focus: on `runWizard` focus `#wz-title`; do not move focus on step changes (hands are on the radio);
  on `check` focus the Fly button. Buttons are real `<button type="button">` with visible
  `:focus-visible` outlines (fly.css already styles `.btn`).
- Screen reader: `.wz-live` (say + sub) is `aria-live="polite"`; `.wz-hint` is `role="status"`; the
  hold ring is not announced; the SVG `aria-label` = say + sub; step items carry a visually hidden
  `wizard.steps.done` when done.
- `remove()`: cancel the rAF loop and the interval, remove the key listener, and unless the device was
  handed over by `onDone` or came from `current`: `hid.onFrame = null; hid.close(); gp.onFrame = null;
  gp.stop()`. (HEAD leaked listeners and gamepad loops each time Controls was opened.)

--------------------------------------------------------------------------------------------------

## D. i18n keys (append at the END of `packages/i18n/locales/fly/{en,es,pl,ru}.json`; key sets must stay equal)

Keep every existing key (old `wizard.step*`, `wizard.mode2` etc. just become unused). Translate es/pl/ru
yourself; keep `{placeholders}` as they are. EN texts:

```json
"wizard.heading": "Set up your radio",
"wizard.mode.1": "Mode 1: throttle on the right stick",
"wizard.mode.2": "Mode 2: throttle on the left stick",
"wizard.mode.change": "Change stick mode",
"wizard.steps.connect": "Connect",
"wizard.steps.stir": "Stir",
"wizard.steps.centre": "Let go",
"wizard.steps.throttle": "Throttle",
"wizard.steps.yaw": "Yaw",
"wizard.steps.pitch": "Pitch",
"wizard.steps.roll": "Roll",
"wizard.steps.arm": "Arm switch",
"wizard.steps.check": "Check",
"wizard.steps.done": "done",
"wizard.say.connect": "Waiting for the radio",
"wizard.say.stir": "Stir both sticks into every corner",
"wizard.say.centre": "Let go of both sticks",
"wizard.say.throttle.push": "Throttle all the way up",
"wizard.say.throttle.release": "Throttle all the way down",
"wizard.say.yaw.push": "Yaw right",
"wizard.say.pitch.push": "Pitch forward",
"wizard.say.roll.push": "Roll right",
"wizard.say.release": "Let go of the stick",
"wizard.say.arm.on": "Flip your arm switch ON",
"wizard.say.arm.off": "Now flip it OFF",
"wizard.say.check": "Check: the drawing follows your sticks",
"wizard.sub.stir": "Round and round, all the way to the edges, until the bars below turn green.",
"wizard.sub.centre": "Thumbs off the sticks. Leave the throttle all the way down.",
"wizard.sub.L.up": "Left stick up, all the way. Hold it there.",
"wizard.sub.R.up": "Right stick up, all the way. Hold it there.",
"wizard.sub.L.right": "Left stick to the right, all the way. Hold it there.",
"wizard.sub.R.right": "Right stick to the right, all the way. Hold it there.",
"wizard.sub.L.down": "Left stick all the way down.",
"wizard.sub.R.down": "Right stick all the way down.",
"wizard.sub.L.let": "Take your thumb off the left stick.",
"wizard.sub.R.let": "Take your thumb off the right stick.",
"wizard.sub.arm.on": "The switch you want to arm with. A button works too: press it twice.",
"wizard.sub.arm.off": "And leave it off.",
"wizard.sub.check": "Move the sticks: the knobs and bars must follow. Then press Fly.",
"wizard.hint.noData": "No data from the radio yet. On the radio choose USB Joystick (not USB Storage), then wait a second.",
"wizard.hint.badReport": "The radio sends {len}-byte reports we cannot read. In the radio's model settings set USB Joystick mode to Classic.",
"wizard.hint.stir.few": "Only {n} channels move like sticks. We need 4. Is the radio in USB Joystick mode?",
"wizard.hint.stir.coverage": "CH{ch} has reached only {pct} % of its travel. Push that stick all the way to both ends.",
"wizard.hint.centre.moving": "CH{ch} is still moving. Take your thumbs off and wait a second.",
"wizard.hint.push.none": "Nothing has moved far enough yet. Push all the way to the edge and hold.",
"wizard.hint.push.short": "Almost. Push all the way to the edge and hold until the ring is full.",
"wizard.hint.push.two": "CH{a} and CH{b} both move. Push straight, not diagonally.",
"wizard.hint.push.taken": "That moves {fn}, which is already set. Follow the drawing.",
"wizard.hint.throttle.already": "Throttle already up? Pull it all the way down, then push it all the way up again.",
"wizard.hint.throttle.down": "The throttle is at {pct} %. Pull it all the way down.",
"wizard.hint.release.moving": "The stick is still moving. Let go and wait a second.",
"wizard.hint.release.off": "{fn} is {pct} % off centre. Let go of the stick.",
"wizard.hint.arm.none": "No switch has moved. Your radio's model probably has no switch on a channel yet.",
"wizard.hint.arm.small": "CH{ch} moved only a little. Flip the switch all the way.",
"wizard.hint.arm.back": "Flip it back OFF and leave it there.",
"wizard.hint.check.throttle": "The throttle shows {pct} % while the stick rests. If the stick is down, press Reverse on Throttle.",
"wizard.howto.title": "To put a switch on channel 5 (EdgeTX):",
"wizard.howto.1": "On the radio open the model settings and go to the MIXES page.",
"wizard.howto.2": "Select CH5, edit it, choose Source and flip the switch you want: it fills in by itself.",
"wizard.howto.3": "Leave the menu, come back here and flip the switch.",
"wizard.howto.skip": "No switch at all? Skip this step: you will arm with the Space key or the ARM button on the screen.",
"wizard.btn.back": "Back",
"wizard.btn.cancel": "Cancel",
"wizard.btn.continue": "Continue anyway",
"wizard.btn.useCurrent": "Use the current position",
"wizard.btn.pick": "Pick the channel by hand",
"wizard.btn.skipArm": "Skip: arm with Space",
"wizard.btn.reverse": "Reverse",
"wizard.btn.close": "Close",
"wizard.pick.title": "Which channel moves when you push {fn}? Click it.",
"wizard.check.throttle": "Throttle all the way down: the throttle bar is empty",
"wizard.check.arm": "Flip the arm switch: Arm lights up",
"wizard.check.armKey": "Arm with Space or the ARM button",
"wizard.check.centre": "Sticks let go: the knobs sit in the middle",
"wizard.summary": "Channels {order} · arm: {arm}",
"wizard.armSource.ch": "CH{n}",
"wizard.armSource.button": "button {n}",
"wizard.armSource.key": "Space / ARM button",
"wizard.oldProfile": "This setup was made by an older version of the wizard. If anything looks wrong, set it up again.",
"wizard.kbd": "Backspace: back · Esc: cancel",
"wizard.stir.count": "{n} of 4 sticks done",
"radio.saved": "Saved setup found for {name}.",
"radio.setupAgain": "Set up again",
"radio.connected": "Connected: {name}",
"arm.card.title": "To arm",
"arm.row.centre": "Sticks let go",
"arm.row.throttle": "Throttle down ({pct} %)",
"arm.row.switch": "Flip the arm switch ({src})",
"arm.row.key": "Press Space or ARM",
"arm.disarmKey": "DISARM (Space)"
```
The EdgeTX menu names (MIXES, Source) are generic EdgeTX terms; the button that opens model settings
differs per radio (MDL on colour radios, MENU on older ones), so the text does not name a key. Not
verified on every radio: say so in the commit message.

Parity check (Git Bash, after `export PATH=/c/Users/andri/node-v22:$PATH`):
```
node -e "const f=require('fs');const k=l=>Object.keys(JSON.parse(f.readFileSync('packages/i18n/locales/fly/'+l+'.json','utf8'))).sort().join();const e=k('en');console.log(['es','pl','ru'].map(l=>l+':'+(k(l)===e)).join(' '))"
```
Must print `es:true pl:true ru:true`. (`pnpm --filter @gsfpv/site i18n:check` does not cover fly.)

--------------------------------------------------------------------------------------------------

## E. In flight while disarmed (flight.ts, controls.ts, keyboard.ts, main.ts)

### E.1 controls.ts

- Keep `ArmGate` usage. Add `private latch = new ArmLatch()`.
- `raw(f)`: after `mapFrame(...)`, `this.ch[4] = this.latch.level(this.profile.arm, f) ? 1 : -1`.
- `push()`: after `gate.update(...)`: if the profile arm is `key` or a toggle button and `latch.on &&
  !gate.armed` -> `latch.reset()` (a refused request does not stay pending; the card says why). Also
  reset the latch when `gate.block === 'crashed'` or `'stale'`.
- `setProfile(p)`: sets `profile`, `latch.reset()`. main.ts uses it instead of assigning `profile`.
- `toggleArm()`: only when `profile?.arm?.kind === 'key'`: `latch.toggle()`, then push the last
  channels at `performance.now()` so it acts at once.
- `view(): ArmView` with
  `interface ArmView { ch: Float32Array; armKind: 'axis' | 'button' | 'toggle' | 'key' | null; armLabel: string; mode: 1 | 2; source: Controls['source'] }`
  (`ch` = mapped channels before the gate; `armLabel` = "CH5" / "button 3" / t('wizard.armSource.key');
  `mode` = `profile.mode ?? getStickMode()`).
- `getStickMode(): 1 | 2`, `setStickMode(m)`: localStorage `gsfpv.stickMode`, try/catch, default 2.
- `parseProfile`: also reject an unknown `arm.kind`.

### E.2 keyboard.ts

- `passive = false` and `onArm: (() => void) | null = null`.
- `onDown`: first line `if (document.querySelector('.screen.radio')) return;` (no flying keys while the
  Controls screen is open). When `passive`: Space -> `onArm?.()` + `preventDefault()`; ignore every
  other flying key (a radio user's arrow keys must not override the radio). F13..F24 unchanged.
- `tick()` / `emit()`: do nothing when `passive`.
- Why: in HEAD the KeyboardSource is always on and calls `session.input` directly. With a radio, Space
  toggled the keyboard's own arm and sent one frame straight to the session past the arm gate, and
  arrow keys overrode the radio for as long as they were held.

### E.3 flight.ts (Hud)

`update(s, block, frameMs, view?: ArmView)`. When `view` is given and `view.source` is `hid` or
`gamepad`, the single `.gate-msg` line is replaced by a card (`.arm-card`, bottom centre, `bottom:
64px`, `max-width: min(92vw, 420px)`, `background: rgba(0,0,0,.6)`, `border: 1px solid var(--line)`,
`border-radius: 12px`, `padding: 8px 12px`, 14 px text, `role="status"`, hidden while armed, crashed,
in `body.cinema` and `body.clean`):

```
[mini radio 96x60]  To arm
                    (1) Sticks let go                 tick when block !== 'center'
                    (2) Throttle down (23 %)          tick when (ch[2]+1)/2 <= 0.05, live %
                    (3) Flip the arm switch (CH5)     or "Press Space or ARM" + button ARM for key
```
- Rows are `li` with a tick (done), a filled dot (the current one = the gate's block), or an empty
  dot. Block `stale | hidden | crashed | noProfile` -> the card shows only that reason (existing
  `arm.blocked.*` texts).
- Mini radio (`radioArt({ mini: true })`): live knobs from `knobsFrom` of `view.ch` (roll ch[0], pitch
  ch[1], throttle ch[2], yaw ch[3]) and `view.mode`; lever = `ch[4] > 0` (null for key); target:
  block `center` -> `{side:'both', dir:'centre'}`, `throttle` -> throttle side / `down`, `switch` ->
  `SW` / `flip`.
- Arm kind `key`: the card has a button "ARM" (`arm.button`, `data-action="hud-arm"`) -> `onArm`;
  while armed, a small button "DISARM (Space)" (`arm.disarmKey`, `data-action="hud-disarm"`) in the
  same place. `Hud` gets `onArm: (() => void) | null`.
- For touch, keyboard and sim sources the old `.gate-msg` line stays as it is.
- CSS for `.arm-card` goes into a new `apps/fly/src/ui/hud-arm.css` imported by flight.ts (the drawing's own styles come with radioart.ts).
- Update is already throttled to 10 Hz; build the card once, update text/attributes only.

### E.4 main.ts (small edits; the loading implementer edits the same file)

1. `const keyboard = new KeyboardSource(session);` (keep the instance).
2. `let lastChoice: RadioChoice | null = null;` `openRadio()`: return if a `.screen.radio` already
   exists; `new RadioScreen(ui, lastChoice)`; `r.onClose = () => { r.remove(); if (lastChoice)
   useChoice(lastChoice); session.pause(false); }`.
3. `useChoice(c)`: stop the previous device if it is a different one (`lastChoice.gamepad.stop()`,
   `lastChoice.hid.close()`); `controls.setProfile(c.profile)`; `keyboard.passive = c.kind === 'hid' ||
   c.kind === 'gamepad'`; `keyboard.onArm = () => controls.toggleArm()`; `hud.onArm = () =>
   controls.toggleArm()`; `lastChoice = c`.
4. Global `keydown`: first line `if (document.querySelector('.screen.radio')) return;`.
5. `hud.update(s, controls.block, s.frameStats(), controls.view())`.
6. `?simradio=raw`: pass `reactMs: Number(q.get('react') ?? 0)` and `armChannel: Number(q.get('armch')
   ?? 4)` to `FakeEdgeTx`; in its `onDone` use `controls.setProfile(c.profile)`.

### E.5 fakehid.ts (the robot follows the new states)

- `FakeRadioConfig` gains `reactMs?: number` (default 0). `armChannel: -1` = no switch: channel 5
  then sends 0.0 like a fresh EdgeTX model (other unused channels keep sending -1 as today).
- `autopilot` reads `id`, `phase`, `ok` from the followed state and adopts a new `(id, phase)` only
  `reactMs` after it appeared. Behaviour: connect nothing; stir: stir as today but `arm = false`;
  centre: A=E=R=0, T=-1; throttle push T=+1, throttle release T=-1; yaw/pitch/roll push that stick +1
  (others 0, T stays), release all 0; arm on `arm = true`; arm off `arm = false`; check nothing.
- `key` unchanged (`...:19`).

### E.6 hid.ts

`badReports = 0` and `lastBadLen = 0` on `HidSource`; `onReport`: when `parseEdgeTxReport` returns false,
count it and return. Nothing else changes (Advanced joystick layouts stay unsupported; section H).

--------------------------------------------------------------------------------------------------

## F. Human model, tests, acceptance

### F.1 packages/input/src/sim/human.ts (new; DOM-free, deterministic, uses `mulberry32` from signals.ts)

Port `.cache/radio-ux/diag-wizard/humans.ts` (read it first) with the changes below. Export it from
`sim/index.ts`. It must compile under `sim/tsconfig.nodom.json` (ES2022 lib, no DOM).

```ts
export type Stick = 'A' | 'E' | 'T' | 'R';
export type ArmKind = 'ch5-2pos' | 'ch5-3pos' | 'ch6-2pos' | 'button' | 'momentary' | 'none';
export type AuxKind = 'zero' | 'const' | 'switch' | 'pot' | 'potNearBin';
export interface HumanConfig {
    seed: number;
    order: string;                     // function letter on CH1..CH4, any of the 24 permutations of AETR
    inv: Record<Stick, boolean>;
    trim: Record<'A' | 'E' | 'R', number>;
    noise: number; rateHz: number; gamepadLike: boolean; arm: ArmKind; aux: AuxKind[];
    rtMean: number; stirReach: number; stopsStirAfterMs: number | null; flickInStir: boolean; leaveArmOn: boolean;
    rangeLimit: number; lowerThrottleInCentre: boolean; thumbRest: number;
    throttleUpReaction: 'downFirst' | 'wait'; residual: number; cross: number; patienceMs: number; slipProb: number;
}
export function randomHuman(seed: number, order: string, inv: Record<Stick, boolean>): HumanConfig;
export function idealHuman(order: string, inv: Record<Stick, boolean>): HumanConfig;
export type InstrKind = 'connect' | 'stir' | 'centre' | 'push' | 'release' | 'throttleDown' | 'armOn' | 'armOff' | 'armFlick' | 'check' | 'idle';
export interface Instruction { kind: InstrKind; fn: 'roll' | 'pitch' | 'throttle' | 'yaw' | null; hint: string | null; ok: boolean; flick?: boolean;
    can: { cont: boolean; useCurrent: boolean; pick: boolean; skipArm: boolean; fly: boolean } }
export type UiAction = { kind: 'cont' | 'useCurrent' | 'skipArm' | 'fly' } | { kind: 'pick'; ch: number };
export interface Adapter<W> { read(w: W): Instruction; act(w: W, a: UiAction): void; profile(w: W): Profile | null; where(w: W): string }
export function newWizardAdapter(): Adapter<CalibrationWizard>;
export interface Outcome { kind: 'correct' | 'wrong' | 'hang'; ms: number; where: string; problems: string[]; phaseMs: Record<string, number>; escapes: string[]; hints: string[] }
export function runHuman<W extends { start(t: number): void; feed(f: RawFrame): unknown; tick?(t: number): unknown }>(
    make: () => W, ad: Adapter<W>, cfg: HumanConfig, maxMs?: number /* 180000 */): Outcome;
export function judge(cfg: HumanConfig, p: Profile): string[];   // empty = correct
```

Distributions in `randomHuman` (seeded; order and inv come from the caller):

| Field | Distribution |
|---|---|
| gamepadLike | 8 %: 5 axes (CH6..8 read 0.0), float values (no 11-bit steps), throttle springs back to the middle, arm `momentary`, rate 125 or 250 Hz |
| rateHz (radio) | 250, 500, 500, 1000 (pick one) |
| arm (radio) | ch5-2pos 45 %, ch5-3pos 10 %, ch6-2pos 7 %, button (latching switch on CH9 = bit 0) 8 %, none 30 % (fresh model: CH5 = 0.0) |
| aux CH6..CH8 (not the arm) | zero 45 %, const +-1 15 %, switch 15 %, pot 15 % (value U(-0.95, 0.95), noise U(0.003, 0.01)), potNearBin 10 % (value k*0.25 + 0.125, k in -4..3, noise U(0.003, 0.01)) |
| trim A/E/R | U(-0.03, 0.03); noise sd U(0.002, 0.01) |
| rtMean | U(300, 1500) ms; each reaction `max(250, rtMean * U(0.8, 1.2))` |
| stirReach | U(0.85, 1.15) (below 0.9 needs the coverage hint) |
| stopsStirAfterMs | 35 %: U(4000, 9000), else null (keeps stirring while the stir text is shown) |
| flickInStir / leaveArmOn | 30 % flick the arm switch 1-4 times and aux switches once while stirring / 50 % of those leave it ON |
| rangeLimit | 3 %: all four sticks only reach U(0.70, 0.85) (radio weights < 100 %; needs Continue anyway) else 1 |
| lowerThrottleInCentre | 85 % |
| thumbRest | 10 %: one self-centring stick held still at U(0.05, 0.15) for U(1, 4) s in centre, else 0 |
| throttleUpReaction | 50/50 (when asked "up" with the throttle already up: pull down first with a U(150, 400) ms dwell, or wait for the hint) |
| residual / cross | U(0, 0.03) / U(0, 0.12) |
| patienceMs | U(2000, 6000): holds a push this long without a screen change, then lets go and retries after U(300, 800) ms |
| slipProb | 5 % per push: moves the other axis of the same gimbal first for U(100, 300) ms |

`idealHuman(order, inv)`: reaction 0 ms (no 250 ms floor), rate 500 Hz, radio (not gamepadLike),
`ch5-2pos`, aux all `zero`, trim 0, noise 0.002, stirReach 1.1, keeps stirring, no flicks, rangeLimit
1, lowers the throttle, thumbRest 0, residual 0, cross 0, push reach 1.0, patience infinite, no slips.
It is the Node twin of the SimRadio robot (positive control).

`newWizardAdapter()` maps `WizardState` -> `Instruction`: connect -> connect; stir -> stir; centre ->
centre; (fn, push) -> push; (throttle, release) -> throttleDown; (fn, release) -> release; (arm, on)
-> armOn; (arm, off) -> armOff; check -> check; `hint = state.hint?.key ?? null`, `ok = state.ok`,
`can` copied from `state.can`. `act`: cont -> `wz.cont()`, useCurrent -> `wz.useCurrent()`, pick ->
`wz.pick(ch)`, skipArm -> `wz.skipArm()`, fly -> marks the run finished (the UI would save and fly).

Behaviour (react to each changed `Instruction` after one reaction time, as the diag model does):
- stir: stir both sticks in circles (reach `stirReach * rangeLimit`) while the stir instruction is shown;
  `stopsStirAfterMs` people stop by themselves and wait; the `stir.coverage` hint -> reach 1.1 and stir
  again; if `can.cont` and still stuck 2-5 s after that remedy -> `cont`.
- centre: let go (spring back with `residual`), lower the throttle if `lowerThrottleInCentre`,
  `thumbRest` as above; hint `centre.moving` -> let go fully; `can.useCurrent` + stuck -> `useCurrent`.
- push: push the physical stick of `fn` towards + (reach U(0.88, 1.02)) with `cross` on the same gimbal
  and optional slip; hold until the instruction changes or `ok` appears (then let go after a 200-400 ms
  perception delay) or patience runs out; throttle already up -> `throttleUpReaction`; hints: `none` /
  `short` -> reach 1.0 and hold; `two` -> cross 0; `throttle.already` -> down then up; `can.pick` and
  stuck 3 s more -> `pick` the true channel (the person sees which bar moves).
- release: let go (spring sticks) / throttleDown: hold throttle at -1.05 (a springing throttle is held
  down until the instruction changes); `useCurrent` / `cont` when offered and stuck.
- armOn: flip the arm switch ON and hold it (already ON: flip OFF then ON with a 150-500 ms gap);
  momentary: two taps (press U(80, 250) ms, gap U(200, 600) ms); `none`: after the `arm.none` hint, read
  U(2000, 5000) ms, then `skipArm`. armOff: flip OFF and leave it.
- armFlick (HEAD only): flick 4 times, gaps U(150, 500) ms, repeat after U(1, 3) s.
- check: `fly` after a reaction + U(500, 2000) ms; on hint `check.throttle` press nothing (it must not
  happen; it counts as a problem).

Frames: CH1..CH4 = `order`/`inv`/`trim`/noise as the diag; EdgeTX 11-bit steps unless gamepadLike:
`raw = clamp(round(v * 1024) + 1024, 0, 2047); axis = (raw - 1024) / 1024` (the parser's formula);
bit 0 of `buttons` for `button` / `momentary`. One frame every `1000 / rateHz` ms, human physics stepped
with the same dt, `t` starts at 0, `start(0)` before the first frame, `tick(t)` every 250 ms if present.

`judge(cfg, p)` problems (empty = correct): each fn on the right channel index; `invert` right;
roll/pitch/yaw `abs(center - trim) / ((max - min) / 2) <= 0.05`; throttle through `mapFrame`: physical
down -> `u <= 0.05`, physical up -> `u >= 0.95`; arm: `none` -> `kind === 'key'`; axis kinds -> right
index, `armOn` true at the ON value and false at the OFF value (3-pos: also false at the middle);
`button` -> bit 0 level; `momentary` -> bit 0 with `toggle: true`.

`Outcome.kind`: `correct` when the wizard reached check, the person pressed Fly and `judge` is empty;
`wrong` when it reached check but `judge` is not empty; `hang` when `maxMs` passed. `phaseMs` = time per
`id/phase`; `escapes` and `hints` = what was used / shown (for the report).

### F.2 Negative-control fixture

`packages/input/test/fixtures/calib-head.ts` = a verbatim copy of HEAD's wizard:
`git show ce4b8d2:packages/input/src/calib.ts > packages/input/test/fixtures/calib-head.ts` (read-only
git; add one first-line comment: frozen copy of the wizard that hung on Andrii's radio on 2026-09-25,
negative control only). The HEAD adapter lives in `human.test.ts` / `sweep.ts`: step 1 -> `stir` with
`flick: true` (HEAD asked to flick every switch), 2 -> `centre`, 3 -> `push` of `prompt` (error
`wizard.waiting` -> hint `push.none`), 4 -> `release` of all sticks, 5 -> `armFlick`, 6 -> `check`; no
escapes exist, so `can` is all false.

### F.3 Unit tests (`packages/input/test/calib.test.ts`, vitest; must all pass)

1. Ideal person, all 24 orders x 16 inversion sets (384 runs, 500 Hz): 384 correct, each under 40 s.
2. Centre is taken only when still: a person still stirring 2 s into `centre` -> no capture during those
   2 s; captured rest within 0.02 of the true rest.
3. Push exclusivity: two stick channels held at 0.8 -> no assignment; hint `push.two` at 5 s.
4. Arrival: a channel parked at 0.9 at the phase start is not taken until it came back below 0.35.
5. Throttle already up + pull-down-first dwell of 450 ms -> throttle not inverted.
6. Release re-measures: thumb resting at 12 % during centre -> final roll/pitch/yaw centre within 0.03.
7. Switch vs stick: CH5 flicked 4 times during stir is classed `switch` and is never a stick candidate.
8. Noisy pot at -0.623 +- 0.5 % on CH8 with no arm switch: no arm assigned in 20 s; hint `arm.none` at
   8 s; `skipArm()` -> `arm.kind === 'key'`.
9. Momentary button: two 150 ms taps -> `{ kind: 'button', bit, toggle: true }`; latching (held 1 s,
   then released) -> toggle absent.
10. No silent waits: for every (id, phase) reached by the ideal person, hold the input in a state that
    does NOT satisfy that phase for 15 s (stir: nothing moves; centre: one stick keeps moving 0.3 at
    2 Hz; push: all sticks at rest; stick release: the stick held at 0.9; throttle release: throttle
    held up; arm on: nothing moves; arm off: switch held ON) -> `hint !== null` by 12 s, and at least
    one of `can.cont | useCurrent | pick | skipArm` is true by 12 s (stir with nothing moving is the one
    exception: only Cancel / Start again, which the UI always shows). Also no frames at all in
    `connect` -> `wizard.hint.noData` after 3 s via `tick`.
11. `back()`: from yaw/push -> throttle/push with `assigned.throttle` removed; during an OK pause ->
    same screen again with its capture undone; on stir -> false.
12. `ArmLatch`: key toggle; toggle-button flips on the press edge only; `reset()`.
13. Regression: `mapFrame` and `ArmGate` give HEAD's results for an axis-arm profile (copy one case from
    accept-fly B11: switch ON at load does not arm; mid throttle blocks).
14. Judge control: a correct profile with roll/pitch swapped, throttle inverted, or arm on CH6 instead
    of CH5 -> `judge` reports each one (the judge can fail).

`packages/input/test/human.test.ts`:
15. 384 random people (24 orders x 16 inversion sets, seeds 1..384, rates capped at 500 Hz for time):
    384 correct, 0 hang, 0 wrong, every run <= 120 s simulated, no single phase > 30 s.
16. Negative control: the first 200 of those people through the HEAD fixture: hang + wrong >= 50 %
    (expected about 85 %, diag). If it passes the HEAD wizard for most people, the model is too kind:
    stop and report, do not loosen the thresholds.
17. Positive control: the ideal person through the HEAD fixture for AETR/TAER with no inversion
    -> correct (the harness does reproduce the path known to pass, as the diag's SimRadio 20/20).

### F.4 Sweep (acceptance record; `packages/input/test/sweep.ts`, run with tsx, not part of vitest)

`pnpm exec tsx packages/input/test/sweep.ts --n 500 [--head 1000]` (Git Bash, node-v22 on PATH):
each of 500 people (seeds 1..500) runs all 24 orders, inversions drawn per run with p = 0.5 per stick
(12,000 runs, each person's own rate). Then the first `--head` runs through the HEAD fixture.
Prints progress every 1,000 runs and writes `.cache/radio-ux/sweep-new.json` / `sweep-head.json`
(summary + every non-correct run with its trace).

Acceptance (must):
- New wizard: 12,000 / 12,000 correct; 0 wrong; 0 hang; max run <= 120 s simulated; p95 <= 60 s;
  no phase > 30 s; the report lists p50/p95/max per phase and how often each hint and escape was used.
- HEAD fixture on the same people: hang + wrong >= 50 %.
- Print `TUNING` in the header of the report.
Expect several minutes of CPU. If a run fails, fix the rule, not the person model, unless the person
did something no real person would (then write down why in the sweep file header).

### F.5 Browser checks (on the port the orchestrator gives; never the live server)

1. `tools/bench/src/accept-fly.ts` B10 and B11 still pass (robot, react 0).
2. `/en/fly/?scene=39e63ce9&simradio=raw&react=700&nowarn=1` reaches `state.step === 6` within 60 s.
3. `...&simradio=raw&armch=-1`: arm screen shows `wizard.hint.arm.none` + how-to after 8 s; click
   `[data-action="wizard-skip-arm"]` -> check shows arm source "Space / ARM button"; after Fly,
   throttle down + Space -> ARMED, Space again -> DISARMED.
4. Playwright screenshots of connect, stir, centre, each push and release, arm on/off, arm none, check,
   pick panel, at 1920x1080 and 375x812 into `.cache/radio-ux/shots-v2/`; in each:
   `document.documentElement.scrollWidth <= innerWidth`, at least one enabled button, and on push
   screens exactly one `.rb-well.target`.
5. Keyboard: Esc in the wizard -> device choice; Esc again -> screen closed, flight resumed; KeyP and
   KeyR do nothing while the screen is open; Backspace goes back.
6. After Fly: no `.screen.radio` left; the arm card shows three rows and the mini radio; moving the
   fake sticks moves the mini knobs.

Commands (Git Bash, `export PATH=/c/Users/andri/node-v22:$PATH` first): typecheck `pnpm -r typecheck`; tests `pnpm exec vitest run packages/input`; i18n parity (D).

--------------------------------------------------------------------------------------------------

## G. Why these rules (short, for review)

- Measure only when still (A.1, A.3 centre/release): HEAD's fixed windows caused 161/400 hangs.
- Middle-of-range detection with an arrival rule (A.5) instead of "biggest move in 500 ms": HEAD took
  19.7 % of its assignments before the person had reacted.
- Hold times and an OK pause: the screen changes only after the condition held, then shows a check;
  people see that something happened (FPV.SkyDive users complain of the opposite).
- Stick/switch classification from the stir histogram: the arm switch can no longer win a stick step.
- Arm = two still levels 0.5 apart: noisy pots near a bin edge cannot arm the drone (HEAD: 226 arm/disarm
  toggles in 10 s in the diag).
- No-switch path with Skip + keyboard/on-screen ARM, and how to add a switch in EdgeTX: a fresh EdgeTX
  model mixes only the four sticks (`setDefaultMixes`), so CH5 sends a constant 0.0; HEAD waited
  forever (55 of 400 diag runs).
- Save on Fly, show saved profiles for checking: HEAD saved at once and reused wrong profiles forever.
- Mode only changes the drawing; detection stays mode-agnostic.

## H. Not covered here (say so, do not pretend)

- EdgeTX "Advanced" joystick layouts (4-5 axes: no frames; 8 axes: garbage) are not parsed; the UI only
  says so when reports fail to parse. The 8-axis Advanced garbage case is not detected at all.
- Angle mode detection (`angleMode` stays null).
- A throttle that springs to the middle (DJI default): works in the wizard, but arming then needs the
  stick held down; no special text.
- All thresholds are from the person model and SimRadio, not from Andrii's radio. First real-radio run:
  record the sweep-style trace (add `?wzlog=1` later if needed; not in this pass).
- Loading progress and opening Controls during loading belong to the loading implementer.
