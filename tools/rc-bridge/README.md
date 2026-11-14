# Shramko RC bridge

Fly ShramkoGSFPV with a DJI RC 2 (the controller with a screen that comes with the Avata 360) on Windows,
with no driver change.

Flown by the owner with his RC 2 on 2026-11-13 (live site, release 73beb77e, docs/wip/connect.md).

## Why it exists

The RC 2 has no game-controller (HID) part. Its sticks answer a DJI (DUML) request on USB interface 0
(class FF.43.01). On Linux, macOS, ChromeOS and Android the page should be able to open that interface itself over
WebUSB ("Fly with this controller" in the helper; not tested yet). On Windows with DJI Assistant 2 installed, that interface uses DJI's
own libusb0 driver, and Chrome can only open interfaces that use Windows' generic driver (WinUSB). This program
reads the sticks through DJI's own 64-bit `libusb0_dji.dll` and hands them to the page over a local WebSocket.
Measured on 2026-11-13 on the owner's PC with his RC 2: 633 stick messages in 10 s (docs/wip/rc2.md).

## Start it

The pilot sees this program as "the helper program for DJI controllers".

1. Needs Windows 10/11, 64-bit Python 3.8+ and DJI Assistant 2 installed; close DJI Assistant 2. No administrator
   rights.
2. In the simulator press "Connect my controller" (Controls) and pick the DJI controller. When Chrome cannot open it
   (Windows with DJI Assistant 2), the page offers the helper: "Download start-dji-helper.cmd" and "Download
   dji-helper.py" (this folder's `rc_bridge.py`, saved under that name). Both into one folder. From a clone, the two
   files of this folder work the same.
3. Connect the RC 2 with a data cable and switch it on.
4. Double-click `start-dji-helper.cmd` and leave its window open. It looks at the controller once and says
   "Your DJI controller answers. Now open the simulator and press 'Connect my controller'.", or what is missing in
   plain words; when the page reads the sticks it says "Your DJI controller is read: ...".
5. The page connects by itself while its Controls screen is open (or press "Fly with the helper program").

What `start-dji-helper.cmd` does: runs the newest `dji-helper*.py` or `rc_bridge*.py` next to it with the first Python
that really runs (`py -3`, `python`, `python3`; a clean Windows has `python.exe` stubs in
`%LOCALAPPDATA%\Microsoft\WindowsApps` that only print "Python was not found" and end with 9009). No Python: it says
so, names the Microsoft Store page (Python 3.13, 9PNRBTZXMB4Z) and python.org, and opens the Store only on Y. Once,
it offers "start with Windows" (default N after 20 s); Y writes one file, `Shramko DJI helper.cmd`, in the pilot's
own Startup folder (Win+R, `shell:startup` to remove it). Nothing else is written except the marker
`%LOCALAPPDATA%\ShramkoGSFPV\helper-autostart-asked.txt`.

Notes. Standard library only, nothing to install. If Chrome asks whether the site may reach apps on this device,
allow it. The first time, the wizard asks you to move each stick (as for any controller); later visits open the
check screen. The RC 2's buttons are not read. Its left stick springs to the centre, so the simulator uses the
centred-throttle style: the stick starts the motors, no ARM press is needed.

`python rc_bridge.py --dll <path>` points at another copy of `libusb0_dji.dll`; `--port` changes the port (the page
always uses 47310). `--replay <frames.json> [--wiggle]` plays a recording instead of the controller (tests, e.g.
`packages/input/test/fixtures/dji-rc2/frames-rest.json`); `--dev` also accepts pages from http://localhost[:port]
(a local build). Only the DJI RC 2 (USB 2CA3:1021) is opened; `--other-dji` lets the helper try another DJI device on
DJI's driver when no RC 2 is there (untested, only the stick request is sent, never the drone 2CA3:0020): DJI's
driver also lists drones, goggles and air units, so this is never done by default. A second copy started while one
runs says "already running in another window" and ends.

## Safety

- Listens on 127.0.0.1 only; nothing on the network can connect.
- Accepts only the pages https://gsfpv.flyreelstudio.eu and https://gsfpv-staging.flyreelstudio.eu (the browser's
  Origin header; http://localhost[:port] only with `--dev`), and only under the Host 127.0.0.1:<port> or
  localhost:<port>.
- A page that stops taking data for 0.5 s is dropped, so it cannot hold up another page; a page that sends anything
  but close, ping or pong, or a frame longer than 125 bytes, is disconnected.
- Before it walks DJI's driver structures it checks that the bytes at the measured offset are a USB device
  descriptor; another `libusb0_dji.dll` version is refused with a plain message instead of a wrong read.
- Only stick answers in the recorded layout (result 0, channel numbers 1..6, values 324..1724) are passed on.
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
