# v0.8: a cinelifter, a 5-inch race quad and a 5-inch freestyle quad

Research notes, 2026-10-16, for the owner's item 9 of message 21 (`docs/wip/v08-plan.md`): "add a cinelifter (the
heavy one most often flown with a big camera) with its physics, and two 5-inch drones (racing, freestyle): the most
popular models, their specs". Presets: `packages/sim-core/presets/{nazgulf5v3-6s,machr5sport-6s,taurusx8-komodo-6s}.json`.
Every number in them carries its own `source` (`manufacturer`, `estimate`, `bf-default`) and, where one exists, a link.
Nothing here is endorsed by iFlight, RED or anyone else; "class" means the numbers follow public specs.

## 1. Which models

No maker publishes sales, so "most popular" was judged from what the community and the shops show.

| Role | Preset | Why this one |
|---|---|---|
| Cinelifter | **iFlight Taurus X8 (V3, O4, 6S) with a RED Komodo** | The ready-to-fly X8 cinelifter that appears most often in shop listings for Komodo-class cameras (Taurus X8, X8 Pro, X8 V3 O4); other cinelifters (iFlight Centurion X8, KinomatiX, home builds on Shendrones Siccario-type frames) are X8s of the same size: 8-inch props, 6S or 8S, 31xx motors of 1000-1300KV. Cinelifter guide: "most cinelifters use an X8 layout ... 6S or 8S ... 8 to 10-inch props", "28xx to 31xx stators with 1000 to 1300KV". The RED Komodo 6K is the camera named everywhere (Netflix's *Red Notice*, Northside's Matterhorn flight). |
| 5-inch race | **iFlight Mach R5 Sport (6S)** | Racers build their own quads, so there is no single best seller. The MultiGP field in 2023: Five33 LightSwitch V2 frames (12-15 % of competitive racers), MCK/Hyper Kronos (18 % of Nationals pilots), Five33 2207 1960KV motors (20 % of Nationals pilots), HQ R38 props, 6S 1050-1300 mAh high-C packs (Joshua Bardwell's racing list). The Mach R5 Sport is the ready-to-fly racer built exactly like that (210 mm, 2207 2050KV, 5.1-inch race props, 6S 1400) and the only one with a full published spec sheet. |
| 5-inch freestyle | **iFlight Nazgul Evoque F5 V3 (O4 Pro, 6S)** | The 5-inch freestyle quad most guides of 2026 recommend first (frame roundups rank the Evoque F5 first for DJI O4 builds; the Nazgul line is the usual "first 5-inch"). GEPRC Mark5 and Vapor D5 are the usual alternatives, with the same layout (2207 of 1750-1960KV, 5.1-inch tri-blades, 6S). |

## 2. Published numbers

### Cinelifter: iFlight Taurus X8 V3 O4 6S + RED Komodo 6K

From iFlight's product page (https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973, read 2026-10-16):
wheelbase 400 mm; 337 x 330 x 112 mm; weight 1989 g; take-off weight 2872 g with a 6S 5600 mAh pack (so the pack is
883 g); 8 x XING2 3110 1250KV; HQ 8x4x3 props; BLITZ E80 80 A 4-in-1 ESCs (two, redundant: "one remaining ESC and
four motors can still carry the camera back"); BLITZ H7 Pro; maximum payload 3 kg; **"Max hover time approx. 5.5 min
with 2 kg load and 6S 5600 mAh battery"**; max speed 150 km/h (manual mode, load not stated); camera mount 5-35 deg.
Motor: XING2 3110, 12N14P, 38.72 x 24.6 mm, 80 g (rcdrone.top listing); no thrust table for the 1250KV was found.
RED Komodo 6K body: 2.1 lb, about 950 g without port cap and media (AbelCine, Lensrentals).

The preset carries 2 kg of camera (Komodo body + lens, media, ND, plate): the load of iFlight's own hover-time figure.
All-up weight 2872 + 2000 = **4872 g**.

### 5-inch race: iFlight Mach R5 Sport 6S

From the fpv24 listing of iFlight's spec (https://fpv24.com/en/iflight/iflight-mach-r5-sport-6s-race-drone-copter-fpv-pnp)
and the iFlight HDZero listing: wheelbase 210 mm; 148 x 148 x 51 mm; about 295-300 g without battery; take-off weight
**525 g** with a 6S 1400 mAh pack; R5 2207 2050KV; Nazgul R5 V2 props (5.1 x 3.8, 3 blades, 4.2 g, 129 mm disk:
https://pyrodrone.com/products/iflight-nazgul-r5-v2-5-1-5138-tri-blade-propellers-2cw-2ccw); BLITZ E55R 55 A ESC;
top speed 208 km/h (maker's claim); hover time about 12 min on 6S 1400 with no load.
Context (https://www.fpvknowitall.com/fpv-shopping-list-five-inch-racing/): Five33 2207 1960KV, HypeTrain 2207.5
2021KV, RCInPower 2207 2100KV; "a motor from about 1900 to 2200 kv" on 6S; 6S 1300-1400 mAh packs. Oscar Liang
(https://oscarliang.com/best-5-inch-fpv-drone-parts/): "For racing or more aggressive freestyle flying opt for
1950KV-2050KV"; Tattu R-Line 6S 1050 mAh "favored by many top FPV racers". A race at full throttle lasts about 1:30
(miniquadtestbench, Five33 2207).

### 5-inch freestyle: iFlight Nazgul Evoque F5 V3 O4 6S

From the Defiance RC listing of iFlight's spec (https://www.defiancerc.com/products/iflight-nazgul-evoque-f5-v3-o4-6s-hd-bnf):
DeadCat (default) / True X geometry, wheelbase 236 mm DC / 239 mm X; weight **492 g**; take-off weight **736 g** with a
6S 1480 mAh pack; XING2 2207 1750KV; Nazgul F5 props (5.1 x 3.5, 3 blades, 3.9 g); Borg Mini 60 A ESC; DJI O4 Air
Unit Pro; camera angle 10-45 deg; max speed 190 km/h (maker's claim); max hover time 12-13 min (6S 1480, no load).
Oscar Liang: "1750KV is great on 6S" for freestyle.

### Motor thrust (for thrust-to-weight)

No maker publishes a full-throttle thrust figure for these exact motor + prop pairs. Benches of the same class:
- 2207 of 1800-2050KV on a 5-inch prop at 6S: 1.85-2.1 kg peak (miniquadtestbench Sunnysky E-R2207: 2098 g at 46 A;
  a maker's bench of a 1900KV 2207.5: 1856 g at 44 A). iFlight's own XING2 2207 1855KV table: 864 g at 50 %, 1021 g at
  60 % throttle at 24 V; peak 35 A / 842 W.
- 31xx of 1100-1300KV on an 8x4x3 at 6S: about 3.0-3.2 kg alone (Scorpion MII-3011-1100: "up to 3200 g on HQ 8x4x3" at
  6S; Surpass S3110 1280KV: 3820 g on 8x4x3, voltage not stated).
- The lower prop of a coaxial pair works in the upper one's wash: a pair gives about 1.6 times one prop alone.

## 3. From the numbers to the presets

The model is the existing quad X (`sim.ts`); nothing new is needed to read the presets except prop wash (section 4).

| | Freestyle `nazgulf5v3-6s` | Race `machr5sport-6s` | Cinelifter `taurusx8-komodo-6s` |
|---|---|---|---|
| All-up weight | 736 g (manufacturer) | 525 g (manufacturer) | 4872 g (manufacturer + 2 kg camera) |
| Thrust / weight | **8** (bench 4 x 1.75 kg / 0.736 = 9.5 static, about 0.84 of it under a loaded pack) | **12.5** (4 x 1.95 kg / 0.525 = 14.9 static) | **3.3** (4 pairs x 1.6 x 3.0 kg = 19 kg static, about 16 kg in flight / 4.87 kg) |
| Inertia roll-pitch / yaw, kg m^2 | 1.6e-3 / 2.8e-3 | 1.15e-3 / 1.95e-3 | 0.036 / 0.045 |
| Motor lag tau | 17 ms | 15 ms | **50 ms** |
| Rotor inertia (per thrust point) | 6e-6 | 6e-6 | 1.2e-4 (two rotors) |
| Torque / thrust kappa | 0.012 m | 0.013 m | 0.0165 m (pair) |
| Rotor drag | 0.51 1/s | 0.59 1/s | 0.31 1/s |
| Drag area horizontal / vertical | 200 / 430 cm^2 | 150 / 320 cm^2 | 350 / 2800 cm^2 |
| Pack, resistance per cell | 6S 1480, 5 mOhm | 6S 1400, 4 mOhm | 6S 5600, 2.5 mOhm |
| Rates | Betaflight default (670 deg/s) | Betaflight default | Actual 50 / 350 deg/s, expo 0.3; yaw 300 |
| PID | Betaflight default (made on 5-inch quads) | Betaflight default | P 45 / I 45 / D 70 / F 60 (roll), tuned in the simulator |
| Camera uptilt | 30 deg | 35 deg | 10 deg |
| Crash threshold | 5 m/s | 5 m/s | 3 m/s |
| Prop wash | loss 0.25, shake 0.3 | loss 0.25, shake 0.3 | loss 0.3, shake 0.3 |

How each estimate was made:
- **Inertia**: sum of parts (motors and props at the arm ends as points, arms as rods, plates, air unit, the pack as a
  box above the centre; the cinelifter's 2 kg camera as a 10 cm cube above and ahead of the centre).
- **Motor lag**: the linearised spin-up time constant tau = J / (Kt^2 / R + 2 Q0 / w0) with J the rotor + prop inertia,
  Kt = 60 / (2 pi KV), R the winding resistance (about 45-60 mOhm), Q0 / w0 the hover torque and speed: 14 ms for a 2207
  2050KV with a 4.2 g prop, about 50 ms for a 3110 1250KV with a 14 g 8-inch tri-blade.
- **Rotor inertia**: prop about 0.2 m R^2 (tapered blades), bell about m r^2 at its magnet radius.
- **kappa**: Q / T = (Cq / Ct) x diameter (about 0.09 for 5-inch tri-blades, 0.07 for an 8x4); the cinelifter's pair a
  little higher (the lower prop needs more torque for its thrust). Checked against hover current: the model draws
  48.9 A in a cinelifter hover = 5.8 min on 85 % of 5600 mAh (iFlight: 5.5 min); 5.7 A on the freestyle quad = 13.4 min
  (iFlight: 12-13 min); 4.0 A on the racer = 18 min (iFlight says about 12; bench efficiencies of 2207s at hover thrust,
  6-7 g/W, support the model's lower current, so it was left).
- **Rotor drag**: momentum theory sqrt(g rho A / m) times 0.55, the share Faessler, Franchi and Scaramuzza measured on
  an open-prop quad (https://arxiv.org/abs/1712.02402; the existing whoop presets use the same method).
- **Drag areas**: the vertical one sets the top speed (at full tilt the craft flies belly-first) and stands in for the
  props unloading at speed, which the model does not have. Targets: race about 180 km/h (maker: 208; GPS logs of 6S
  racers mostly 150-180), freestyle about 150 km/h (maker: 190), cinelifter about 105 km/h with the camera (maker: 150,
  load not stated).
- **Cinelifter PID**: with Betaflight's defaults the heavy, slow craft overshoots 18-33 % on a roll stick with a
  realistic 80 ms thumb ramp. A grid over P, I, D and F in the simulator: the overshoot comes mostly from the I-term
  winding up while the craft lags; P 45, I 45, D 70, F 60 brings it to about 8-10 % (full stick) with one crossing,
  which is how cinelifter pilots describe their tunes ("reduce P gains, increase D gains", rates "around 200 to 400
  degrees per second": https://www.unmannedtechshop.co.uk/blogs/knowledge-base/cinelifter-fpv-drone-heavy-lift-build-guide).
- **Cinelifter angle mode** (review R4, after the PID above was tuned on acro steps only): angle mode is everyone's
  default, and with Betaflight's angle_feedforward 50 the cinelifter overshot the 60 deg limit by 10 % (66.1 deg) and
  swung 5.9 deg past level when the stick was released (the whoop and the 5-inch quads: 60.0-60.2 deg, 0 deg). The
  angle feed-forward asks for a tilt rate the slow craft cannot follow, then the rate loop catches up past the target.
  The preset sets `level: { angle_feedforward: 30 }` (a preset field read by `compileParams`; only the angle
  feed-forward pair, the level numbers the pilot sets stay Betaflight's): 60.0 deg, no crossing, 0 deg past level for
  ramps of 0, 80 and 200 ms. Lowering angle strength instead (angle_p_gain 30) also cures it but makes the self-levelling
  softer everywhere; the feed-forward is the term that over-drives.
- **The 5-inch PIDs and rates** stay Betaflight's defaults: they are made on 5-inch quads, both makers ship Betaflight
  presets, and racers and freestylers fly their own rates (paste `diff all`).

## 4. Prop wash (`packages/sim-core/src/wake.ts`)

Momentum theory: a rotor disk of area A making thrust T pushes air down at the induced velocity v_i = sqrt(T / (2 rho A)).
Sinking along its axis at v_d between about 0.25 v_i and 2 v_i, the rotor flies into its own wake (vortex ring state):
thrust drops and fluctuates, worst near v_d = v_i, gone once the craft moves sideways faster than about v_i. In the
model, the wake intensity k (0..1) is a smooth bump over v_d / v_i, divided by 1 + 4 (v_side / v_i)^2; every rotor's
thrust is multiplied by 1 - wake_loss x k, and a turbulent roll and pitch torque of wake_shake x k x (one rotor's
thrust) x (arm) is added with a seeded noise of the tick. v_i follows the thrust the rotors make right now, so a craft
that chops the throttle falls through without loss and meets its wake when it throttles up: the classic "dive, then
catch it, and it shakes and sinks". Only presets that carry `wake_loss` / `wake_shake` (and `prop_diameter_mm`) have the
term; the six whoop presets do not, and their flight is bit for bit the one before (A6 hash `1d01ca5b...`).

Measured in the simulator (Node, still air): a 2 s drop with the motors at idle, then the stick at 1.3 x hover:

| | height lost, wash on | wash off | shake (rms roll/pitch rate in the wash) |
|---|---|---|---|
| Freestyle | 17.1 m | 11.7 m | 8 deg/s |
| Race | 17.5 m | 11.5 m | 5.5 deg/s |
| Cinelifter | 16.5 m | 13.2 m | 11.6 deg/s |

With full throttle instead (a punch-out) the wash costs little height (1.6 vs 1.5 m on the freestyle quad): at full
thrust v_i is so large that the sink rate falls below its band almost at once.

## 5. What the simulator shows (Node probe, fresh pack, still air)

| | Freestyle | Race | Cinelifter | Pavo20 Pro (default, for scale) |
|---|---|---|---|---|
| Hover throttle, full pack (motor command) | 24.8 % | 17.9 % | 41.1 % | 32.7 % |
| Picker card (the stick, as the HUD's THR): full pack / 15 % left | 25 / 32 % | 18 / 23 % | 41 / 53 % | 28 / 39 % (thr_mid 65, expo 20) |
| Roll, full stick step: t63 / overshoot | 15 ms / 1.3 % (670 deg/s) | 12 ms / 1.2 % | 44 ms / 9.7 % (350 deg/s) | 19 ms / 1.8 % |
| Angle mode, full roll (80 ms ramp): peak / past level on release | 60.2 deg / 0.05 deg | 60.2 deg / 0.06 deg | 60.0 deg / 0 deg | 60.0 deg / 0 deg |
| Climb after 8 s full throttle | 41.6 m/s | 51.2 m/s | 24.4 m/s | 24.2 m/s |
| Top speed, level | 150 km/h | 177 km/h | 101 km/h | 92 km/h |
| Hover current / time on 85 % of the pack | 5.7 A / 13.4 min | 4.0 A / 18 min | 48.9 A / 5.8 min | 3.5 A / 8.0 min |

The unit tests (`packages/sim-core/test/model-drones-v08.test.ts`) pin these with bands and negative controls.

## 6. What would make them better: data from pilots who fly them

Everything marked estimate can be fitted to a real flight: thrust-to-weight and hover throttle from a blackbox log
(motor output and `rcCommand` in a hover, `vbatLatest` for the sag), the motor lag from bidirectional DShot eRPM after
a throttle step, rotor drag from a coast-down, the tune and rates from `diff all` (the simulator imports it already).
The simulator asks for exactly that (the drone picker's and the settings' "Help us tune this drone", the feedback
dialog's "Drone physics" kind): `diff all` as text, a link to a blackbox log, the rates and a few words. The method for
the whoops is in `blackbox-fit.md`; the same tools apply.

## Sources

- iFlight Taurus X8 V3 O4 6S: https://shop.iflight.com/Taurus-X8-V3-O3-HD-Cinelifter-BNF-Pro1973
- iFlight XING2 3110: https://rcdrone.top/pl/products/iflight-xing2-3110-fpv-motor
- Cinelifter build guide (layout, motors, rates): https://www.unmannedtechshop.co.uk/blogs/knowledge-base/cinelifter-fpv-drone-heavy-lift-build-guide
- Scorpion MII-3011-1100 (8x4x3 at 6S): https://www.scorpionsystem.com/catalog/multicopter/motor_5/MII_30/MII_3011_1100/
- RED Komodo 6K weight: https://www.abelcine.com/buy/cameras-accessories/digital-cinema-cameras/red-komodo-6k-digital-cinema-camera-rf-mount-2, https://www.lensrentals.com/rent/red-komodo-6k-monochrome-standard
- Northside's Komodo cinelifter over the Matterhorn: https://dronexl.co/2026/02/05/northside-red-komodo-cinelifter-matterhorn/
- iFlight Mach R5 Sport: https://fpv24.com/en/iflight/iflight-mach-r5-sport-6s-race-drone-copter-fpv-pnp
- Nazgul R5 V2 props: https://pyrodrone.com/products/iflight-nazgul-r5-v2-5-1-5138-tri-blade-propellers-2cw-2ccw
- 5-inch racing parts and MultiGP usage: https://www.fpvknowitall.com/fpv-shopping-list-five-inch-racing/
- Five33 2207 bench: https://www.miniquadtestbench.com/five33-headsup-2207-1950kv.html
- iFlight Nazgul Evoque F5 V3 O4 6S: https://www.defiancerc.com/products/iflight-nazgul-evoque-f5-v3-o4-6s-hd-bnf
- Nazgul F5 props: https://www.getfpv.com/iflight-nazgul-f5-5x3-5x3-3-blade-5-1-propeller-set-of-4.html
- Best 5-inch parts (KV guidance, packs): https://oscarliang.com/best-5-inch-fpv-drone-parts/
- XING2 2207 prop tables: https://thingbits.in/products/iflight-xing2-2207-unibell-fpv-brushless-motor
- Rotor drag: Faessler, Franchi, Scaramuzza, RA-L 2018, https://arxiv.org/abs/1712.02402

The guide for the next drone, and for fitting one to a pilot's report: [`../adding-a-drone.md`](../adding-a-drone.md).
