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

Stage 2 RC2-protocol-and-webusb-source
- [x] 1. packages/input/src/dji-duml.ts (build, parse with CRC8 and CRC16, stream reader, stick decode to -1..1, HID
  description of the six axes) and packages/input/test/dji-duml.test.ts on both recordings (685 stick replies) and
  reference vectors: 8 passed, NEG OK, tsc of packages/input clean. Commit 38609d93.
- [x] 2. apps/fly/src/devices/dji-rc2-source.ts (DjiRc2Device: WebUSB source shaped as a WebHID device, so HidSource,
  the wizard, the check screen and profiles read it unchanged; findSavedRc2 for a later visit) and
  tools/bench/test/app-dji-rc2.test.ts (fake USBDevice replaying the recorded frames, moving sticks, refused claim,
  silent controller, unplug disarms the real Controls by the stale rule, close releases, reconnect): 8 passed,
  NEG OK. tsc of apps/fly clean. Commit 5cfb4b1e.
- [x] 3. Helper block (ui/usb-look-block.ts, devices/usb-look.ts): part 'sticks' and verdict 'rc2' for DJI + FF.43.01,
  "Fly with this controller", claim failure and silent controller in plain words in en/es/pl/ru, "Send this list"
  stays, the old "cannot read it yet" line gone. tools/bench/test/app-usb-look.test.ts + fly-parity: 23 passed,
  NEG OK (old usb-look.ts, block and the four locale files). Commit 5cfb4b1e.
- [x] 4. Lead patch for the wiring outside this lane's paths: evidence/2026-11-13/rc2/lead-wiring.patch.txt (radio.ts,
  app/input.ts). Applied on this branch: tsc of apps/fly clean, app-centre-throttle, app-known-controller,
  app-switches, sonic-review-input 55 passed; then reverted (not committed in code). Commit fecd4d0e.

Stage 3 RC3-windows-path-and-probe (path (ii): adb stayed offline, the native read worked)
- [x] 1. tools/rc-bridge/ (rc_bridge.py, start-rc-bridge.cmd, README.md, test_rc_bridge.py): DJI's libusb0_dji.dll via
  ctypes, ws://127.0.0.1:47310/, origins https://gsfpv.flyreelstudio.eu and http://localhost[:port] only, Host
  127.0.0.1/localhost only, read-only, controller held only while a page is connected. Unit tests 10 passed, NEG OK.
  Real controller through the real bridge: 633 stick messages in 10 s (63.3/s), state 'reading', all six at 1024
  (U:/Temp/gsfpv-rc2/out/bridge-real.json, a scratch client as an allowed page).
- [x] 2. Page side: apps/fly/src/devices/dji-rc2-bridge.ts (Rc2BridgeDevice, WebHID-shaped like DjiRc2Device, same
  profile key), helper button "Fly through the RC bridge" (connects only on the press), texts nobridge / nocontroller,
  claimFailed points to the bridge; en/es/pl/ru. tools/bench/test/app-dji-rc2-bridge.test.ts + app-usb-look +
  app-dji-rc2: 23 passed, NEG OK; tsc of apps/fly clean.
- [x] 3. CSP: deploy/nginx.conf map $gsfpv_rc_bridge (" ws://127.0.0.1:47310" for /{lang}/fly/ only, "" elsewhere),
  used in $gsfpv_csp_rest's connect-src. apps/api/tests/test_nginx_rc_bridge.py (5 tests incl. 3 planted-fault
  controls) + test_nginx_routes/rooms/tracks: 34 passed; NEG OK on the old nginx.conf. Measured in the bench Chrome
  (headless, release build of this branch served by serve-csp with the lead patch): the page served with the release
  CSP opened ws://127.0.0.1:47310 with no CSP message (bridge.cspQuiet true). Commit 6bafc64f.
- [ ] 4. Page probe tools/bench/scripts/rc2-probe.mjs (written, committed). Last run on a local release build of this
  branch with both lead patches applied (evidence/2026-11-13/rc2/rc2-probe-branch.json): 13 of 14 checks pass
  (usb: verdict rc2, wizard to the check screen with key hid:2ca3:1021:DJI RC 2:12:d, one axis moves on the check
  screen; refused: the claim text; bridge (replay bridge, --wiggle): no socket on load, connected, check screen at
  once, 185 frames in 2 s, no CSP message). FAILS: usb.climbs. Left stick up from the centre: throttle style
  resolves 'centred' (why 'seen'), but centre.arm toggles 'arming'/'on' every 250 ms and the drone rises only 0.74 m
  then sinks (an earlier run rose 3 m in 1.25 s and then fell and crashed: rc2-probe-branch-earlier.json).
  Negative control: the same probe (usb,refused) against the lead's dist C:/dev/gsfpv-v03/dist (built 05:09, no
  RC 2 code in it) fails: usb.verdictRc2 false (rc2-probe-old-build.json).
  CAUSE FOUND (pass 2): the stale rule. The probe now records the gate's view every animation frame during the climb
  (__rc2Watch: age of Controls.lastSampleAt, frame interval, block reasons, answers per second). Measured on the
  build of 6bafc64f: max sample age 211 ms, 15 of 51 frames over 100 ms, blocks stale 2 / switch 20, about 20 frames/s
  (evidence rc2-probe-gap-watch.json; that run passed by luck). In flight the page runs timers only about 9 times a
  second (repliesPerS 9 in the climb against about 80/s on the setup screens, rc2-probe-inflight.json), and every
  answer needed a timer.
  Fixes committed: 0ae0d8f6 requests no longer wait for answers (RC2_INFLIGHT 4 out at once; unit test "answers
  130 ms late" in app-dji-rc2.test.ts, NEG OK: 14 frames instead of >15 on the old source); 0e01b73c a late wake
  fills every free slot (probe: usb pass, climb +3.3 m, but still stale 4, 9 answers/s: rc2-probe-inflight.json);
  a1b43eb1 the ask loop wakes on the timer OR the next animation frame (pause() in dji-rc2-source.ts) and the probe's
  fake answers by MessageChannel instead of a 2 ms timer. Unit tests 24 passed, tsc clean.
  PASS 3 (probe now logs each step to stderr, stops a run after 120 s, then pauses the page through CDP and records the
  stack and the frame arguments three times 3 s apart; RC2_FAKE_ANSWER=timer|message picks the fake): the hang is NOT
  in this lane's code and not in the fake. Measured on the release build of a1b43eb1 (dist 11:48): refused passes in
  0.5 s; usb with the TIMER fake hangs too, at the climb (wizard to check 21 s, flight starts at 30 s, then nothing).
  All three looks (evidence rc2-probe-hang-stacks.json, runs.usb.hungStack; commit c0d02140) are inside the centred pilot's ground probe:
  raw -> push -> prepare -> centreFn -> CentrePilot.apply -> LessonPilot.apply -> clearance -> groundClearance
  (apps/fly/src/play/ground.ts) -> VoxelContactWorld.sweep -> sweepOne -> overlap -> sphereOverlaps with r 10.05 m
  (PROBE_M 20: the cover sphere of a 20 m sweep). The arguments differ between looks (craft y 6.67, 5.89, 6.67 m), so
  it is not one endless call: the page spends all its time in repeated ground sweeps, one per input frame (each takes
  longer than LESSON_PROBE_EVERY_MS 33, so the 33 ms limit never skips one). The "timers about 9 a second in flight"
  of pass 2 is this same cost; a1b43eb1's animation-frame wake only adds asks, hence frames, hence sweeps.
  LEFT for the next pass: (1) revert a1b43eb1's pause()/pace in dji-rc2-source.ts (keep 0ae0d8f6 and 0e01b73c), run
  app-dji-rc2 + app-usb-look + app-dji-rc2-bridge and tsc of apps/fly, commit. (2) The ground probe's cost is the
  lead's (outside this lane, see For the lead): with a fix applied as a scratch patch, rebuild and run the probe's
  three runs, then the negative control against origin/main's dist, tick this line. Without that fix usb.climbs
  cannot pass on this scene. Old notes of pass 2 follow.
  (pass 2) with a1b43eb1 the probe HANGS (no output, killed by timeout 360 s, usb run alone, twice): page.evaluate
  never returns, so the page's main thread is probably busy. Unknown which half: (1) rebuild with a1b43eb1's
  source and the OLD fake (git show 0e01b73c:tools/bench/scripts/rc2-probe.mjs > a scratch copy), run usb only;
  (2) if that hangs, the rAF pause is the cause: revert pause() (keep 0ae0d8f6/0e01b73c) and look for another way
  past the starved timers (e.g. the source re-sends the last answer each animation frame while the controller
  answered within ~250 ms, like gamepad.ts; that is a safety decision: silence then disarms after ~350 ms);
  (3) if only the MessageChannel fake hangs, go back to the timer fake. Make the probe write its out file after
  each run so a hang leaves data. Then the probe's three runs, the negative control against origin/main's dist,
  tick this line. Build: apply lead-wiring.patch.txt and lead-serve-csp.patch.txt, node scripts/build-release.mjs,
  revert both (git checkout -- the three files) before committing. Bridge replay: python -X utf8
  tools/rc-bridge/rc_bridge.py --replay evidence/2026-11-13/rc2/frames-rest.json --wiggle.
- [x] 5. For the lead, Not verified, cost note written below.

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
- Stage 2: the RC 2 source is a WebHID-shaped device (DjiRc2Device: vendorId, productId, productName 'DJI RC 2',
  collections = RC2_HID_COLLECTIONS, open/close, inputreport events) instead of a new source kind. HidSource, the
  wizard, the check screen, profiles, LinkMeter and the stale disarm then work unchanged, and radio.ts needs only a
  pre-chosen device for connectHid. Profile key: hid:2ca3:1021:DJI RC 2:12:d.
- Six axes X Y Z Rx Ry Rz (roll, pitch, throttle, yaw, left dial, right dial, the reference's axis codes), logical
  364..1684. With six axes the known table does not take the RC 2 for the DJI FPV Remote Controller 3 (both 2CA3:1021):
  tested (recognise returns null). No known-table entry: the throttle style auto resolves 'centred' from the rest the
  wizard and the rest watch see (1024 = middle), as lane center-throttle does for any spring-centred stick.
- No buttons are read (their DUML is unknown): the pilot arms with Space or the on-screen ARM (key arm).
- Poll: one request in flight, next one after the answer or 100 ms (estimate), at most every 10 ms (reference default
  100 Hz, not measured here). First answer must come within 1500 ms (estimate) or the helper says 'silent'.
- HidSource.close() removes the last listener: DjiRc2Device then releases the interface and closes the device, so
  nothing polls in the background (radio.ts choose() lets go of owned sources this way).
- Stage 3 path (ii), the native bridge: adb stayed offline in stage 1, the libusb0_dji read worked. The bridge sends
  decoded raw values ({"v":[6]}), not DUML bytes; Rc2BridgeDevice turns them into the same 12-byte report as the WebUSB
  source, so both share one profile key. Port 47310 is a choice, not a measurement. Python standard library only,
  so the owner's existing 64-bit Python runs it with nothing installed.
- Stage 3 CSP: a second map ($gsfpv_rc_bridge on $uri) instead of a second copy of the whole policy, so the fly page
  alone gets the loopback source and the policy text stays in one place.
- dji-rc2-source.ts imports packages/input/src/dji-duml by relative path (precedent: apps/fly/src/voxels.worker.ts)
  because packages/input/src/index.ts is outside this lane.

## For the lead before the merge
- Apply evidence/2026-11-13/rc2/lead-wiring.patch.txt (git apply): without it the helper shows the RC 2's parts and
  verdict but no "Fly with this controller" button, and a later visit does not reconnect the RC 2. It changes
  apps/fly/src/ui/radio.ts (usbLookBlock gets the fly callback; connectHid takes an optional pre-chosen device) and
  apps/fly/src/app/input.ts (resumeInput tries findSavedRc2 after findSavedHid). Checked on this branch: tsc clean,
  4 test files that import radio.ts or input.ts, 55 passed.
- Optional: export './dji-duml' from packages/input/src/index.ts and switch the relative import in
  apps/fly/src/devices/dji-rc2-source.ts to '@gsfpv/input' (check name clashes first).
- No preference or key was added: the catalogue generator does not need to run for this stage.
- Stage 3: apply evidence/2026-11-13/rc2/lead-serve-csp.patch.txt to tools/bench/scripts/serve-csp.mjs (it fills
  $gsfpv_rc_bridge the way nginx's map does). Without it a local serve sends the literal "$gsfpv_rc_bridge" token in
  connect-src (Chrome ignores it), so the bridge is blocked locally while every other probe works as before.
- Stage 3, on the server: deploy/nginx.conf gains the map $gsfpv_rc_bridge and one variable in connect-src. Run
  `nginx -t` on the hub before reload (not possible here: no nginx on this PC). Nothing else changes on the server.
- Stage 3, how the owner starts it on his PC: DJI Assistant 2 is installed (its libusb0_dji driver is what the bridge
  uses); plug in the RC 2 and switch it on; double-click C:/dev/gsfpv-v03/tools/rc-bridge/start-rc-bridge.cmd (after
  the merge) and leave the window open; on the site: Controls, "My controller is not in the list", "Fly through the RC
  bridge". The first time the wizard runs; later the check screen opens at once. Arm: Space or the on-screen ARM is
  not needed in the centred style (the stick starts the motors). How other pilots get the program (a download, a
  release asset) is the lead's call: today it lives only in the repo.
- Stage 3, found by the rc2 probe, NOT this lane's code: the centred throttle style's ground probe
  (apps/fly/src/app/input.ts CentrePilot ground: groundClearance in apps/fly/src/play/ground.ts) sweeps a 0.05 m
  sphere 20 m down through VoxelContactWorld.sweep, whose first step tests a 10.05 m cover sphere voxel by voxel. In
  scene 887f27aa at about 6 m it costs more than its 33 ms interval, so every input frame runs it and the page stops
  answering (stacks in evidence/2026-11-13/rc2/rc2-probe-hang-stacks.json, runs.usb.hungStack). Any spring-centred radio with a fast
  report rate (WebHID 250-500 Hz) should hit it the same way [assumed, only the RC 2 fake was run]. Candidate fixes
  [not tried]: sweep in short pieces (e.g. 1 m, so each cover sphere is small) or a voxel column walk, or the lesson
  pilot's rayClearance on the scan's walls; and run the probe on the frame tick, not on every input frame.
  centre-throttle-probe.mjs should then also climb above 6 m once.
- Stage 3: the probe's usb.climbs still fails (Status, stage 3 step 4): do not ship the RC 2 path as "flies" before it
  passes.

## Not verified
- Stick decode while sticks move (nobody touched them during 35 s of recording): offsets, range and
  direction of each axis are from the reference only.
- WebUSB claim behaviour in a real browser (MI_00 refused, MI_02 allowed): assumed from how Chrome works on
  Windows, not tried this stage.
- Latency from request to reply: not measured (only that every reply arrived inside the 100 ms window).
- ADB input events: adb state stayed offline.
- Other OSes: all assumed.
- Stage 2: no browser run. The WebUSB source was only tested against a fake USBDevice in Node; what Chrome on this PC
  does at claimInterface (expected: refused, MI_00 is libusb0_dji) was not tried, and no page probe was run (the
  wiring patch is not applied on this branch, so a page could not show the fly action).
- Stage 2: the 10 ms poll and the 100 ms answer limit are not measured; the real answer time is unknown.
- Stage 2: whether WebUSB transferIn returns several DUML frames in one read on the real device is unknown; the
  stream reader handles both (tested).
- Stage 3: the page probe with the REAL controller through the real bridge: the RC 2 left the USB bus between the
  bridge's first real run (633 stick messages in 10 s, bridge-real-controller.json) and the probe (Get-PnpDevice
  lists no VID_2CA3 device; probably switched itself off). The probe's bridge run used the recorded replay.
- Stage 3: a moving stick through the bridge on the real controller (all six stayed at 1024).
- Stage 3: Chrome's local-network-access permission when the LIVE https page opens ws://127.0.0.1: the bench page
  was served from http://localhost, which is not a public origin, so no prompt could appear. Expected: Chrome asks
  once ("apps on this device"); the helper text tells the pilot to allow it. Not measured.
- Stage 3: nginx -t on the new map (no nginx here); the map with a variable inside $gsfpv_csp_rest is standard nginx.
- Stage 3: start-rc-bridge.cmd was not double-clicked (the bridge was started with python directly); the 32-bit
  Python refusal path was not run.

## Cost notes
- Stage 1: most turns went to pyusb crashing on DJI's libusb0 build (3 turns to find the struct offset);
  starting straight with ctypes on the libusb0 C API would have saved them. Total about 17 replies.
- Stage 2: about 33 replies. Most went to finding how a new source reaches the wizard (radio.ts, reconnect.ts,
  hid.ts, controls.ts read in slices) and to two test timing fixes (a replay of 293 answers at 10 ms is too slow for a
  2 s wait; Controls.tick treats one late tick as a stalled page, so the stale test needs a 10 ms ticker). The
  neg_control script needs the full node.exe path (npx is a .cmd Python cannot start). A code-map line saying
  "a new device = a WebHID-shaped object for HidSource" would have saved about 5 replies.
- Stage 3: about 42 replies, not finished (usb.climbs). Most went to page-probe iterations (5 runs of 1-2 min): the
  fake's throttle had to rest in the centre (the hid-source-probe hands rest it at the bottom, so the wizard chose
  from-zero), and a connected helper leaves the DOM (wait for the wizard, not the status line). Writing the probe
  with spring-centred hands and a frame-gap tap from the start would have saved 3 runs.
- Stage 3 pass 2: about 45 replies, not finished. Most went to four 3-6 min release-build + probe cycles, each changing
  two things at once (source and fake), so the last one hung with no way to tell which; the probe also writes its
  JSON only at the end, so a hang leaves nothing. Change one thing per build and write the out file after every run.
- Stage 3 pass 3: about 40 replies, not finished. Two 5-min blind waits on hung runs before the probe had step logs;
  then four 2.5-min runs to get a stack. A CDP Debugger.pause with frame arguments on hang, built into the probe from
  the start, would have found the ground sweep in one run instead of three passes of guessing at timers.
