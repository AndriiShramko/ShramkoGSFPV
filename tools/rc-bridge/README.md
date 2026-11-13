# Shramko RC bridge

Fly ShramkoGSFPV with a DJI RC 2 (the controller with a screen that comes with the Avata 360) on Windows,
with no driver change.

## Why it exists

The RC 2 has no game-controller (HID) part. Its sticks answer a DJI (DUML) request on USB interface 0
(class FF.43.01). On Linux, macOS, ChromeOS and Android the page can open that interface itself over WebUSB
("Fly with this controller" in the helper). On Windows with DJI Assistant 2 installed, that interface uses DJI's
own libusb0 driver, and Chrome can only open interfaces that use Windows' generic driver (WinUSB). This program
reads the sticks through DJI's own 64-bit `libusb0_dji.dll` and hands them to the page over a local WebSocket.
Measured on 2026-11-13 on the owner's PC with his RC 2: 633 stick messages in 10 s (docs/wip/rc2.md).

## Start it

1. Windows 10 or 11, 64-bit Python 3.8 or newer (`py` or `python` on PATH), DJI Assistant 2 (Consumer Drones Series)
   installed. Nothing else: standard library only.
2. Connect the RC 2 with a data cable and switch it on. Close DJI Assistant 2 (it may hold the interface).
3. Double-click `start-rc-bridge.cmd`. The window says `Shramko RC bridge on ws://127.0.0.1:47310/`. Leave it open.
4. On https://gsfpv.flyreelstudio.eu open the simulator, Controls, "My controller is not in the list",
   "Fly through the RC bridge". If Chrome asks whether the site may reach apps on this device, allow it.
5. The first time, the wizard asks you to move each stick (as for any controller); later visits open the check screen.
   The RC 2's buttons are not read: arm with Space or the on-screen ARM. Its left stick springs to the centre, so the
   simulator uses the centred-throttle style.

`python rc_bridge.py --dll <path>` points at another copy of `libusb0_dji.dll`; `--port` changes the port (the page
always uses 47310). `--replay <frames.json> [--wiggle]` plays a recording instead of the controller (tests).

## Safety

- Listens on 127.0.0.1 only; nothing on the network can connect.
- Accepts only the pages https://gsfpv.flyreelstudio.eu and http://localhost[:port] (the browser's Origin header),
  and only under the Host 127.0.0.1:<port> or localhost:<port>.
- Read-only towards the controller: the only frame it sends is the DUML stick request (set 06, id 01, empty payload).
  No settings, no firmware, nothing written.
- Opens the controller only while a page is connected and lets it go when the last page leaves.

## Messages (text, JSON, one per WebSocket message)

| Message | When |
|---|---|
| `{"hello":"shramko-rc-bridge","version":1}` | once, after the handshake |
| `{"state":"reading"}` | the controller answers |
| `{"state":"no-controller","why":"..."}` | not found or busy; retried every 2 s |
| `{"v":[roll,pitch,throttle,yaw,leftDial,rightDial]}` | every stick answer, raw 364..1684, centre 1024 |

## Tests

`python -X utf8 -m unittest tools/rc-bridge/test_rc_bridge.py` (from the repo root): DUML frames against the stage 1
recording, the origin and host rules, a real handshake on 127.0.0.1 with the recording replayed. The page side:
`tools/bench/test/app-dji-rc2-bridge.test.ts`; in a browser: `tools/bench/scripts/rc2-probe.mjs`.
