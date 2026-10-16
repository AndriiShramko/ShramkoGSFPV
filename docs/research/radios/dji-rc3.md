# DJI RC 3 on USB (simulator mode) — device facts

Measured 2026-10-15 on the owner's PC (Windows 11 26200) with the owner's DJI controller (named by the
owner as the RC 3 family: DJI FPV Remote Controller 3 / RC Motion 3 / RC 3). Raw data and screenshots:
`evidence/2026-10-15/dji-rc3/` (`facts.json`, `winmm-40s-recording.csv`).

## Which model

The USB strings do not name the model: the composite device reports itself as **"DJI Virtual
Joystick"**, the HID interface as **"HID Interface"**, manufacturer "DJI", serial `123456789FEDCBA`
(a placeholder). So the exact model could not be read from the device; everything below is what this
controller sends, whatever its marketing name. What it has (4 stick axes, 1 wheel axis, buttons and
switches as button bits) fits a DJI FPV-style controller.

## What to do on the controller

Nothing special was needed: the controller switched on and plugged into the PC with a USB-C data cable
appeared at once as a Windows game controller (no driver install, no mode switch). Retailer and review
pages say the same for the FPV Remote Controller 3 with PC simulators (e.g.
https://www.comms-express.com/products/dji-fpv-remote-controller-3/,
https://www.aerovisiondrones.com/?p=3588). If nothing appears in Windows, the cable is charge-only or
the controller is off. If a storage / COM / RNDIS device appears but no game controller, the link works
and the controller is in another USB mode (not seen here, not checked).

## USB and HID (measured)

| | |
|---|---|
| USB | VID `0x2CA3` (DJI), PID `0x1021`, REV `0x0100`, composite (`usbccgp`) |
| Interface 0 | "BULK Interface", libusb-win32 driver ("DEVICE BULK" 5.0.0.7) — DJI's own channel, not used by browsers |
| Interface 2 | "HID Interface" → "HID-compliant game controller", HID usage page `0x01` usage `0x05` (**gamepad**) |
| Input report | 14 bytes with the report id (id 0: **13 data bytes**); no output or feature reports |
| Axes | 5 values, usages `0x30` X, `0x31` Y, `0x32` Z, `0x33` Rx, `0x34` Ry; **16 bits signed, logical −660..660**; physical range unset |
| Buttons | Button page `0x09`, usages 1..24, one bit each (3 bytes) |
| Rate | about 160 reports a second: the page probe in Chrome 152 read `getGamepads()` every ~4 ms (~250 a second) and saw 150–170 state changes a second while stirring; winmm, polled every 5–7 ms, saw 143–169 (near its own ceiling) |

Method: `hid.dll` (`HidD_GetAttributes`, `HidD_GetProductString`, `HidP_GetCaps`, `HidP_GetValueCaps`,
`HidP_GetButtonCaps`), winmm `joyGetDevCaps` / `joyGetPosEx`, PnP properties.

**Not measured:** the order of the fields inside the 13 bytes (the controller was unplugged before the
raw reports could be read). The simulator's reader takes the order from the descriptor the browser
gives, not from the fixture; the fixture (`packages/input/src/sim/devices.ts`, `DJI_RC3`) assumes axes
first, then the three button bytes. **Not yet run on the real controller:** the new WebHID path itself
(the browser's `device.collections` for this controller and its real reports through `makeHidReader`);
that is Phase E step 1 (docs/phase-e-real-radio.md). What is checked without it, and what is not: the
last two sections.

## Values (measured, 40 s recording)

- All four stick axes reach −660 and +660 (−1 and +1 in Chrome's Gamepad API).
- The fifth axis (Ry) is the **wheel**: it rests at 0, moves only when turned, reaches both ends, and is
  coarse (75 distinct values in the recording).
- At rest: X −11 and Rx −8 with a jitter of a few units; Y and Z exactly 0.
- Buttons: only bits 0..7 of the 24 ever changed. At rest **bits 4 and 6 read pressed (0x50)**. States
  seen: 0x00 0x10 0x20 0x40 0x50 0x54 0x58 0x60 0x61 0x62 0x64 0x68 0x6c 0x80 0x90 0xa0 — bits 4/5 and
  6/7 behave like switch positions, bits 0..3 like push buttons.
- **Not identified** (needs a one-control-at-a-time pass with the controller): which axis is which stick
  and function, whether the throttle stick springs to the middle, which bits are the flight-mode switch
  and which the buttons. The calibration wizard finds the sticks and the arm by itself.

## In the browser and the simulator

- **Chrome 152 (the Claude app's browser):** `navigator.getGamepads()` lists it at once as
  `HID Interface (Vendor: 2ca3 Product: 1021)`, mapping `""` (no standard mapping), 5 axes, 24 buttons.
  The simulator's "Gamepad" button started the wizard and the stir passed. At the Throttle step the
  owner's free movement kept showing "two channels move at once" (`wizard.hint.push.two`, 11 times in
  30 s); a clean one-stick push was not recorded, so this is not diagnosed.
- **Chrome 140 (the owner's Chrome):** with the controller at rest, a visible focused tab got
  `[null, null, null, null]` from `getGamepads()` and the simulator's gamepad source no frame in about
  4 s. Chrome exposes a pad only after an input; a run with a stick moved was not recorded.
- **WebHID ("Radio or controller over USB"):** not tried with the controller, before or after the fix.
  From the code at 4ab126c and the measured 13-byte report: the chooser's filters take any HID
  joystick / gamepad, so the controller should be offered; **before the fix** the simulator read every report with the EdgeTX
  layout (19 bytes, or 16 and more); the 13-byte reports were all refused, the radio screen said "The
  radio sends 13-byte reports we cannot read" and the wizard never left its first step — the
  simulator "did not see" the controller. **Now** every HID device, the EdgeTX radio too, is read
  through its own report descriptor (`packages/input/src/hid-layout.ts`, `makeHidReader`; the rules
  below); the fixed EdgeTX layout is only the fallback when the browser hands over no usable
  descriptor. On Windows the device calls itself "HID Interface" (measured), the profile is named
  `USB 2ca3:1021` and keyed `hid:2ca3:1021:HID Interface:13:d`. On macOS and Linux the name is
  expected to come from the USB product string "DJI Virtual Joystick" (Linux may put the maker in
  front: "DJI DJI Virtual Joystick"); not checked.

## How the simulator reads a HID controller (review fixes, 2026-10-16)

One rule for every device, no USB-id special case (`hid-layout.ts` header):

- Only top-level collections that are game controls are read: usage page 1, usage 4 joystick,
  5 gamepad or 8 multi-axis controller (the chooser's filters `HID_CHOOSER_FILTERS`, and what Chrome's
  Gamepad API takes). A combo receiver's mouse or keyboard collection takes no channel.
- Axes: Generic Desktop X..Wheel (0x30..0x38) and the positions of the Simulation Controls page
  (0x02: aileron, elevator, rudder, throttle, accelerator, brake, steering...), as Chrome's Gamepad
  API reads them; EdgeTX's Advanced mode and RC sim dongles put sticks there. At most 8, in report order.
- Scaling: the middle value of the logical range reads 0 (the upper of the two middle values for an
  even range, where unsigned HID axes rest), one unit is the distance to the minimum. So the DJI reads
  raw / 660, and EdgeTX Classic (0..2047) reads bit for bit as its fixed layout did (2047 reads
  1023/1024, as before): 20,000 random reports in each of 4 descriptor shapes, 0 differences.
- Buttons: only Button-page 1-bit fields, at most 24. Hat switches are skipped (a direction index
  with an out-of-range rest value is not a stick position; no RC radio sends one; a gamepad's d-pad
  comes through the Gamepad button). Array fields, constant fields and vendor pages are skipped,
  their bits counted so the fields behind them line up. Fields past a usage range take its maximum.
  A logical maximum the browser sign-extended (255 as 0x25 0xFF arrives as -1) is read unsigned in the
  field's size (Linux's rule). Buttons of several reports move up only when they collide.
- Profile keys: a descriptor-read device gets `:d` at the end (`hid:2ca3:1021:HID Interface:13:d`), so
  it never picks up a profile saved while the fixed layout misread its reports. A device whose
  descriptor reads exactly as the fixed EdgeTX layout (the EdgeTX radio in Classic mode) keeps the key
  and name it had (`hid:1209:4f54:<name>:19`): radios pilots calibrated before fly on with their
  saved profile (unit test, HidSource test with reconnect, page probe).

### The switches as button bits

Bits 4/5 and 6/7 behave like 3-position switches (one end's bit, the other end's bit, or neither in
the middle). Until v0.8 a switch input was one axis or one bit, so such a switch gave the wizard's
mode switch 2 positions. **Since v0.8 (lane B) it is one input of its own kind**, `{ kind: 'bits', lo,
hi }` (packages/input mode-switch.ts): lo on = low, neither = middle, hi on = high, 988 / 1500 / 2012 us
on the Switches screen. The three reasons it was skipped are solved: saved profiles stay version 1
(an older build drops what it cannot read and keeps the sticks), a device's channel table
(`Profile.channels`) gives a pair ONE Betaflight channel (the DJI's flight-mode switch is CH5 = AUX1,
as on a quad with the O4 air unit), and every screen names inputs through one function
(`inputName`). The mode-switch watch knows a recognised controller's pairs up front and learns an
unknown pair from an end-to-end flip (`packages/input/test/bits-switch.test.ts`).

## Which control is which (v0.8 lane B, 2026-10-16)

Every fact below is marked **measured** (from the owner's recording, re-run with
`python tools/radios/dji-recording.py`), **sourced** (a page, linked) or **assumed** (the reason given).
The simulator's known-controller table (`packages/input/src/known-devices.ts`) carries the same marks;
the check screen shows them so the owner can confirm on his controller in half a minute.

### The controller's controls (sourced)

DJI FPV Remote Controller 3 User Manual v1.0, 2024.04 (copy at
https://www.lensrentals.com/product-assets/874ea987-4063-4505-8cfd-fcddd02c7a19/1110698.pdf), page 5 and
pages 13-17: power button, C1 button (customizable: ESC beeping or turtle mode), two control sticks,
flight pause / RTH button, gimbal dial, **flight mode switch** (Normal / Sport / Manual, the figure lists
Manual, Sport, Normal from top to bottom; Manual is off by default and the M position then gives the
"custom mode", Sport by default), **C2 switch** (customizable, by default gimbal tilt up / recenter /
tilt down), start/stop button (Manual mode: "press the start/stop button twice" with the throttle at
its lowest to start and stop the motors), shutter/record button. Default stick mode: **Mode 2**. The
throttle stick **springs to the centre** unless the F1/F2 screws behind it are adjusted ("tighten the
screws behind the throttle stick to keep the stick from auto recentering", Manual mode section).
Supported simulators named there: Liftoff, Uncrashed, DRL, DCL.

Linux names it the same as Windows: `lsusb` shows `2ca3:1021 DJI Technology Co., Ltd. DJI Virtual
Joystick` (Liftoff forum, 2025-03-15,
https://steamcommunity.com/app/410340/discussions/1/640179666902122415/). **DJI uses 2ca3:1021 for other
controllers too** (an RC Motion 3 with only a bulk interface, https://github.com/v1kr4m-ai/DJI_RC_Motion_Bridge/issues/1;
the DJI RC 2 screen controller, https://github.com/rusty407/dji-rc2-linux-joystick), so the simulator
recognises the controller by its ids **and** the shape of its HID gamepad (5 axes of -660..660, buttons).

**The DJI FPV Remote Controller 2 (v0.8 review R6): its USB ids and HID shape were not found written.**
Searched 2026-10-16 (web search for its VID/PID, "DJI Virtual Joystick", lsusb, Hardware Ids, joy.cpl;
retailer pages, DJI forum, Steam forums): no page gives them. What is known: it works with simulators
over USB-C and DJI Virtual Flight on Windows names it (https://support.dji.com/help/content?customId=en-us03400008917&spaceId=34&re=US&lang=en),
and Uncrashed reads its axes 1-4 as roll, pitch, throttle, yaw (the Steam thread above), the same order
as the RC 3's. Not the same controller: the DJI RC 2 *screen* controller (Mini 4 Pro) enumerates as
2ca3:1021 too but has no HID interface at all (MTP, ADB and a DUML bulk interface; the GitHub project
above), and Liftoff's developer says it is not an input device (Steam, 2024-02-22,
https://steamcommunity.com/app/410340/discussions/1/4337599680238862343). So an FPV Remote Controller 2
that enumerates as 2ca3:1021 with five -660..660 axes would be recognised as the RC 3's entry. The entry
is therefore named for the family ("DJI FPV Remote Controller"), and the first note on its check screen
says the layout is the RC 3's: the sticks should match an FPV RC 2, its switch and button rows may not.
The RC Motion 3 shares the ids with a bulk interface only (above): no HID gamepad, never recognised.

### Which axis is which stick

- **measured: X and Rx are the two horizontal axes, Y and Z the two vertical ones.** While both sticks
  are stirred, horizontals move mirrored and verticals together: correlation X/Rx -0.86, Y/Z +0.84,
  every other pair between -0.30 and +0.26 (negative control, each axis shifted in time: -0.33..+0.02).
  At rest X and Rx sit a little off centre with a jitter (-11 and -8 units), Y and Z read exactly 0.
- **measured (weaker): X pairs with Y, Z with Rx.** The angle atan2 of a stick's two axes turns one way
  while it is stirred: X/Y 5 and Z/Rx 1 direction reversals, against X/Z 11 + Y/Rx 3 for the other
  pairing (control: 20-38). Both pairings trace circles in a perfect mirror stir, so this rests on
  the hands not being exactly in step.
- **sourced: X roll, Y pitch, Z throttle, Rx yaw** (Mode 2: right stick X/Y, left stick Z/Rx). Uncrashed's
  developer for the DJI FPV Remote Controller 2: "throttle: axis3, Roll: Axis1, Pitch: Axis2, Yaw:
  Axis4", confirmed by users (2021-09-03, https://steamcommunity.com/app/1682970/discussions/0/3037103480425804141).
  Consistent with both measurements above.
- **measured: the throttle stick rested in the centre** (Z exactly 0 between stirs, e.g. 1.0-1.4 s of
  the fixture): the owner's controller had the factory spring, so throttle in the middle = 50 %.
- **assumed: stick up and stick right read positive.** DJI's own RC units are 1024 +- 660 (the reports'
  -660..660), and in DJI's Onboard SDK virtual RC "move upwards" is 1684 on the throttle
  (https://developer.dji.com/onboard-sdk/documentation/Protocol-Documents/virtual-rc-protocol.html). Not
  measured: the recording does not say what the hands did. A wrong sign shows on the check screen at
  once (the bar moves the other way) and Reverse fixes it.
- **measured: the fifth axis (Ry) is the gimbal dial**; it has no Betaflight channel (Oscar Liang's
  readers: the dial cannot be mapped as an AUX channel).

### The switches and buttons

- **measured: bits 4/5 and 6/7 are two 3-position switches** (one end's bit, the other end's bit,
  neither = middle), bits 0..3 four push buttons. Both switches rested at their lower bit (0x50).
  Pair 6/7 passes through its middle (no bit) for 28-62 ms on every end-to-end flip (4 of 4) and sat
  in the middle for 120 ms once; pair 4/5 went end to end with no middle sample 3 times out of 3 at
  ~165 polls a second, and sat in its middle for 520 ms once.
- **sourced: the flight mode switch is a 3-position toggle and the C2 switch the other** (Oscar Liang,
  RC 3 + O4 air unit in Betaflight: "AUX1 - M/S/N Mode switch (top-left 3-position toggle)", "AUX2 -
  Top-right 3-position toggle", AUX3 the return-to-home button, AUX4 the start/stop button (a reader
  says it is the record button), AUX5 the C1 button; https://oscarliang.com/setup-dji-rc3-o4-betaflight/).
- **assumed: the flight mode switch is bits 6/7**, with bit 6 = N (Normal, where it rested), no bit =
  S, bit 7 = M. Reason: it behaves like a plain toggle passing through its middle detent, as a 3-way
  N/S/M toggle does; DJI ships the switch in N. In the simulator N -> Angle, S -> Horizon, M -> Acro
  (Normal is the self-levelling mode, Manual the full-manual one; Sport sits between).
- **assumed: buttons in the manual's order**: bit 0 C1, bit 1 flight pause / RTH, bit 2 start/stop,
  bit 3 shutter/record. Arm = the start/stop button (it starts the motors in DJI's Manual mode), a
  press toggles the arm (the simulator's arm gate still wants the throttle low).
- **Betaflight channels (sourced order, assumed bits)**: CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw,
  CH5 flight mode switch, CH6 C2 switch, CH7 pause / RTH, CH8 start/stop, CH9 C1.

### Feel: delay and sensitivity reported by others (sourced, not measured here)

- An RC 3 owner's yaw stick lagged in Manual mode only, and Liftoff reproduced it; DJI support asked
  to recalibrate the sticks in the goggles (DJI forum, 2024-07, https://forum.dji.com/thread-314556-1-1.html).
- A DJI FPV Remote Controller 2 read full deflection at about 10 % of the right stick's travel, in the
  goggles' calibration and in Velocidrone alike (DJI forum, https://forum.dji.com/thread-287422-1-1.html);
  an Uncrashed user fixed over-sensitive sticks by calibrating (same Steam thread as above, 2022-09-30).
- With the O4 air unit DJI claims 8 ms end to end; a review measured 9-11 ms (Race) and 12-15 ms
  (Standard) against 4-6 ms for ELRS at 500 Hz (https://blog.uavmodel.com/dji-fpv-remote-controller-3-complete-setup-and-review/).
  Over USB in simulator mode the controller sent about 160 reports a second (measured, above).

## Tests without the hardware

- `packages/input/test/hid-layout.test.ts`: the DJI descriptor's layout in both Chromium shapes
  (from the descriptor; Windows' one item per axis), hand-written known-answer reports, order and bit
  alignment from the descriptor, 662 frames of the real stir recording (`test/fixtures/dji-rc3-stir.ts`)
  through the 13-byte report, the wizard's stir on that real trace, 48 simulated people through the
  whole wizard; negative controls through the EdgeTX reader (no report read, the wizard stays at
  connect, every person hangs). The rules above on other shapes: EdgeTX Classic (4 shapes) and
  Advanced (built as `usb_joystick.cpp` builds it), a mouse + gamepad combo, DualShock 4 (hat, vendor
  fields), Xbox over Bluetooth (triggers on the Simulation page, a consumer bit), flight sticks and RC
  dongles, array fields, ranges and logical maxima written wrong, more than 8 axes or 24 buttons.
- `tools/bench/test/app-hid-source.test.ts`: HidSource with a fake WebHID device (open, the reader from
  `device.collections`, `e.reportId`, the key, the name, close), and reconnect at page load finding an
  EdgeTX profile saved under the old key; negative controls: no descriptor, an unknown report id, a
  DJI profile under the key without `:d`.
- Mutations: the reviewer's 15 breakages of `hid-layout.ts` (11 verbatim, 4 ported to the new text)
  and 19 more of the new rules and of HidSource: every one fails the tests.
- Page level, two paths: `?simradio=raw&device=dji` (fake radio of `apps/fly/src/devices/fakehid.ts`,
  its reports through `makeHidReader`), and `tools/bench/scripts/hid-source-probe.mjs`: a fake
  `navigator.hid` whose device sends 13-byte `inputreport` events with the DJI descriptor through the
  real HidSource (the USB button, request, open, the key, the name) to the check screen; the same
  with an EdgeTX radio; negative control: the DJI's reports without a descriptor are all refused.

## Still only verifiable with the real controller

- The descriptor Chrome really hands over for it (`device.collections`) on Windows, macOS and Linux,
  and the order of the fields in its 13 bytes (both fixture shapes assume axes first).
- Its real reports through the WebHID path to the check screen (Phase E step 1), the report rate
  there, and the name in the browser's list off Windows.
- Which axis is which stick, whether the throttle springs back, which bits are which switch and which
  are buttons, and whether bits 4/5 and 6/7 really are 3-position switches.
- Whether the Gamepad API path finishes the wizard (Chrome 140 exposed no pad at rest).

### The owner's 30-second check (v0.8)

Since v0.8 the controller is recognised and opens its check screen with the known layout (no wizard).
Everything marked "not confirmed yet" there is confirmed or corrected in half a minute on the real
controller, and each answer moves a fact in `packages/input/src/known-devices.ts` from assumed to
measured:

0. If a setup was saved for this controller before v0.8 (it was flown with the wizard's setup), the
   Controls screen opens by itself when the scene loads and says "Recognised: DJI FPV Remote
   Controller ... Use the known setup / Keep my setup" (the same offer is on the Controls screen's
   radio-in-use panel). Press **Use the known setup**: its check screen opens with the labelled
   controls, and steps 1-5 below are done there (Fly saves it). With no saved setup: open Controls
   and move a stick, the check screen opens by itself.
1. Move each stick: the four rows Roll / Pitch / Throttle / Yaw and the matching "Right stick left /
   right"... rows must follow; a bar that moves the other way = that direction is wrong (Reverse fixes it
   for this browser; tell us so it is fixed for everyone).
2. Flip the flight mode switch N / S / M: the "Flight mode switch" row must light low / middle / high
   and the Mode switch row read Angle / Horizon / Acro. If the C2 row lights instead, the two switches
   are the other way round (bits 4/5 and 6/7).
3. Press C1, pause / RTH, start/stop and shutter one at a time: each must light its own row. Which one
   lit for which press is the button order (assumed from the manual's order).
4. Throttle down, press start/stop: Arm ON; again: OFF.
5. In the browser's own list (chrome://gamepad or the Controls screen's rate): the reports per second
   while a stick moves (measured 150-170 on Windows with winmm).

Sending the result: the report button (B) on the check screen with "which row lit for which control"
is enough to fix the table for every pilot.
