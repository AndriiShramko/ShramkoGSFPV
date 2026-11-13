# Lane rc2: DJI RC 2 flies the simulator

Worktree: C:/dev/gsfpv-train1-base (reused train 1 worktree, branch rc2 from origin/main 41372830).
Scratch (not in git): U:/Temp/gsfpv-rc2 (ref = reference clone, venv, scripts, out).

Labels used below: [measured] = read from the owner's real RC 2 on this PC on 2026-11-13;
[reference] = taken from github.com/rusty407/dji-rc2-linux-joystick (MIT, read only, never run);
[assumed] = not measured.

## Status

Stage 1 RC1-hardware-and-protocol
- [x] 1. Reference cloned to U:/Temp/gsfpv-rc2/ref and read (duml.py, rc2link.py, rc2_joystick.py, README). Commit 5a4e2bf6.
- [x] 2. Native read-only stick read on the real device through libusb0_dji: works, 293/293 and 392/392 replies, evidence/2026-11-13/rc2/frames-rest*.json. Commit 5a4e2bf6.
- [x] 3. ADB: adb.exe 1.0.41 found at U:/tools/platform-tools; the controller is listed but stays "offline" (3 checks over about 10 minutes). No getevent possible. Commit 5a4e2bf6.
- [x] 4. Verdict written below. Commit 5a4e2bf6.

Stage 2, stage 3: not started (scope comes from the lead's train plan).

## Verdict of stage 1

(a) Native read on this PC: WORKS [measured]. Stack: Python 3.11 ctypes ->
DJI's libusb0_dji.dll 4.8.13 amd64 (DJI Assistant 2 folder Drivers/Drivers_Other/DJI_BULK/amd64)
-> kernel driver libusb0_dji.sys (service Running, inf oem131.inf, driver version 4.8.13.0).
- Device path published by the driver: \\.\libusb0-0001--0x2ca3-0x1021 (plain libusb0 prefix, not renamed) [measured].
- pyusb 1.3.1 with this DLL crashes (access violation) when it reads the device descriptor: DJI's build
  keeps the device descriptor at offset 1048 of struct usb_device, pyusb expects 536 [measured by
  layout_probe.py]. Calling the libusb0 C API directly with ctypes works.
- C:/Windows/System32/libusb0.dll is a 32-bit (i386) file, unusable from 64-bit processes [measured with `file`].
- Calls made: usb_open, GET_DESCRIPTOR config (standard), usb_set_configuration(1) (standard, returned 0,
  config 1 was already the only one), claim interface 0, bulk write of the stick request only, bulk read,
  release, close. The serial string was never requested.
- Run 1: 15 s, 293 requests, 293 stick replies, 323 frames total, 19.6 replies/s at 50 ms pacing.
  Run 2: 20 s, 392 requests, 392 replies, 433 frames. [measured]
- Sticks did NOT move: all six channels stayed exactly 1024 in both runs (35 s). Nobody touched the sticks;
  the decode of moving sticks is from the reference only.

(b) ADB [measured]: adb.exe exists (U:/tools/platform-tools/adb.exe, version 1.0.41). `adb devices -l`
lists the RC 2 (serial masked) as `offline transport_id:1` on three checks, never `unauthorized` or
`device`. So no getevent: whether the sticks appear as Android input events is unknown.
Possible reasons [assumed]: the debugging prompt is not shown on DJI's launcher, or DJI firmware keeps adbd
in a locked state.

(c) A browser on this PC as it is [assumed, not measured in a browser this stage]:
- MI_00 (FF.43.01, the stick channel) is bound to libusb0_dji. Chrome's WebUSB on Windows only opens
  interfaces bound to WinUSB, so the page cannot claim the stick channel. webusbWindowsAsIs = false.
- MI_02 (FF.42.01, ADB) is WinUSB through MS_COMP_WINUSB: claimable by WebUSB with no install, but it only
  carries ADB (which needs authorization on the controller and today is offline), and only one
  program can hold it (adb.exe server or the browser).
- No HID interface: WebHID and the Gamepad API see nothing.
- What does work on this PC as is: a small native helper reading MI_00 through libusb0_dji (exactly the
  ctypes recorder in evidence/2026-11-13/rc2/rc2_read_ctypes.py.txt) and handing frames to the page
  over a local WebSocket. That is the candidate for stage 3 (tools/rc-bridge, one connect-src entry).

(d) Other systems [assumed unless marked]:
- Windows without DJI Assistant: MI_00 is a vendor-class interface with no compatible id, so it has no
  driver (Device Manager "unknown"); WebUSB still cannot claim it; only a WinUSB/libusb install would help,
  which the pilot must do himself (we never change a PC).
- Linux: the reference claims interface 0 with pyusb and no kernel driver [reference]; Chrome WebUSB can
  claim it with a udev rule granting access (the reference ships 70-rc2-joystick.rules) [assumed].
- macOS, ChromeOS, Android Chrome: vendor interfaces have no kernel driver, WebUSB can claim interface 0
  with no install [assumed].

(e) Frame layout and stick decode
DUML v1, little-endian [reference, confirmed by the bytes below: crc8 and crc16 checked by the parser on
every received frame, measured]:
- 0: 0x55; 1-2: length (low 10 bits, whole frame incl. crc16) | version 1 << 10; 3: crc8 of bytes 0-2
  (CRC-8/Maxim reflected poly 0x8C, seed 0x77); 4: sender; 5: receiver; 6-7: sequence;
  8: command type (0x40 request, bit 7 = response); 9: command set; 10: command id; 11..: payload;
  last 2: crc16 of everything before (CRC-16 reflected poly 0x8408, seed 0x3692).
- Interface 0, bulk OUT 0x01, bulk IN 0x81, max packet 512 [measured from the configuration descriptor].
- Stick request, the only frame sent [measured bytes]: 55 0d 04 33 0a 06 eb 34 40 06 01 74 24
  (PC 0x0a -> RC 0x06, seq 0x34eb then +1 per request, request, set 06 id 01, empty payload).
- Stick reply [measured bytes]: 55 20 04 7b 06 0a eb 34 80 06 01
  00 00 04 01 00 04 02 00 04 03 00 04 04 00 04 05 00 04 06 ce d2
  32 bytes, RC -> PC, the sequence of the request echoed, type 0x80, set 06 id 01, payload 19 bytes.
  Payload byte 0 = 0x00 (result code, [assumed] ok). Six u16 LE at payload offsets 1, 4, 7, 10, 13, 16
  [reference; at rest all = 0x0400 = 1024, measured]. Bytes at offsets 3, 6, 9, 12, 15, 18 are 01..06
  [measured; meaning assumed: channel index].
- Channels in order: roll, pitch, throttle, yaw, left dial, right dial [reference].
- Range 364..1684, centre 1024 [reference; centre 1024 measured on all six at rest].
  Throttle rests at 1024, i.e. the RC 2 throttle stick is spring-centred [measured value; spring assumed],
  so it pairs with the centre-throttle styles (docs/wip/center-throttle.md).
- Unsolicited frames [measured]: about one per second each of set 00 id 81 and id 82, 168 bytes,
  sender 0x0d -> receiver 0x2a, type 0x40, payload starts with ASCII "rc3331". Not for the PC: the
  decoder must skip every frame that is not a 06/01 response with our sequence.
- The reference also allowlists "simulator mode on" (06 24 01) but says the RC 2 does not need it
  [reference]; it was NOT sent here.

## Decisions
- Used DJI's 64-bit libusb0_dji.dll through ctypes after pyusb crashed on its struct layout (measured);
  no driver change, nothing installed except pyusb in a scratch venv under U:/Temp.
- Recorder scripts are committed as evidence (*.py.txt, so no linter or gate treats them as repo code).
- Request pacing 50 ms was my choice for the recording (estimate, not a product number).

## For the lead before the merge
- Nothing yet (stage 1 touched only docs/wip/rc2.md and evidence/2026-11-13/rc2/).

## Not verified
- Stick decode while sticks move (nobody touched them during 35 s of recording): offsets, range and
  direction of each axis are from the reference only.
- WebUSB claim behaviour in a real browser (MI_00 refused, MI_02 allowed): assumed from how Chrome works on
  Windows, not tried this stage.
- Latency from request to reply: not measured (only that every reply arrived inside the 100 ms window).
- ADB input events: adb state stayed offline.
- Other OSes: all assumed.

## Cost notes
- Stage 1: most turns went to pyusb crashing on DJI's libusb0 build (3 turns to find the struct offset);
  starting straight with ctypes on the libusb0 C API would have saved them. Total about 17 replies.
