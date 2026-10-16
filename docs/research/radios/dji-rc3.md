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
that is Phase E step 1 (docs/phase-e-real-radio.md).

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
  simulator "did not see" the controller. **Now** every non-EdgeTX HID device is read through its own
  report descriptor (`packages/input/src/hid-layout.ts`, `makeHidReader`); EdgeTX radios keep their
  fixed layout. On Windows the device calls itself "HID Interface" (measured) and the profile is
  named `USB 2ca3:1021`. On macOS and Linux the name is expected to come from the USB product string
  "DJI Virtual Joystick" (Linux may put the maker in front: "DJI DJI Virtual Joystick"); not checked.

## Tests without the hardware

- `packages/input/test/hid-layout.test.ts`: the DJI descriptor's layout, hand-written known-answer
  reports, order and bit alignment from the descriptor, 662 frames of the real stir recording
  (`test/fixtures/dji-rc3-stir.ts`) through the 13-byte report, the wizard's stir on that real trace,
  48 simulated people through the whole wizard; negative controls through the EdgeTX reader (no report
  read, the wizard stays at connect, every person hangs).
- Page level: `?simradio=raw&device=dji` (fake radio of `apps/fly/src/devices/fakehid.ts` sending the
  same report through the same reader).
