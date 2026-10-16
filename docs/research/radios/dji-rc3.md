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
the middle). One switch input of the simulator is one axis or one bit, so such a switch is **not**
one channel: a pair would be a new input kind for saved profiles, Betaflight's channel numbers and
every screen that names a channel, and which bits pair is neither in the descriptor nor measured.
It is usable as two inputs, the way Betaflight's modes work: on the Switches screen an Angle range on
one end's bit and a Horizon range on the other's give Angle / Acro / Horizon over the three positions
(test through the DJI reader). "Flip to assign" takes the bit that came on when a switch goes from
one end to the other. The setup wizard's own mode switch (one input) sees only one end's bit:
2 positions. Known limitation.

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
