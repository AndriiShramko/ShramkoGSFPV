---
type: wip
status: active
summary: Lane connect - any controller plugged in goes through the setup and flies; stage C1 turns the owner's real DJI RC 2 session into evidence and a regression test
created: 2026-11-13
---
# Lane connect

Branch `connect` from `rc2-lna` b05df5e6 (origin/main 2a5ac433 was already in it: 0 commits to merge), worktree
`C:/dev/gsfpv-train1-base`. Ports 5780-5799.

## Status
- [x] C1.1 rc_bridge.py `--replay` takes a `--record` file at its recorded pace, `--start`/`--end` seconds; tests; fixture `packages/input/test/fixtures/dji-rc2/owner-session-2026-11-13.jsonl` (session 2, seconds 0-205)
- [x] C1.2 replay of session 2 on a local release of b05df5e6 (the live logic): `tools/bench/scripts/rc2-session-probe.mjs` (62905033, f890d090), timeline below; screenshots `U:/Temp/gsfpv-train2/shots/connect-session-a-*.png`
- [x] C1.3 (f890d090) verdict below; the bottom path fixed in the wizard (`packages/input/src/spring.ts`, `calib.ts`); `packages/input/test/owner-rc2-session.test.ts` 12 passed; neg control NEG OK (old calib.ts: 'bottom'); packages/input 262 of 262; a6-reference with app-centre-throttle, -ui, app-hid-source, app-known-controller, app-dji-rc2-lna 68 of 68; typecheck input and fly 0
  - [x] page proof of the fix: the "obey" record (`U:/Temp/gsfpv-train2/connect/obey.jsonl`, the owner's record with the throttle at 364 from 9.0 to 14.5 s) on the old build, run `obey-old` (`U:/Temp/gsfpv-train2/connect/session-obey-old.json`): Let go measured with the throttle at the bottom, check at 54.3 s, throttleRest 'bottom', after Fly 'zero' why 'wizard' to 80 s (the bug on a page, 0 page errors). Same record on a release of adf12c25 (source of f890d090), run `obey-new` (`U:/Temp/gsfpv-train2/connect/session-obey-new.json`, fly 70, end 140): Let go done 12.0 s with the throttle at 364, check 54.3 s, throttleRest 'centre', check screen "Chosen automatically: your throttle stick rests in the centre", at Fly 70.1 'centred' why 'wizard', 70.7 why 'seen'; armed 85.2 (throttle 1282), 4.67 m at 90; 0 page errors, 8980 answers. Shots `U:/Temp/gsfpv-train2/shots/connect-session-obey-new-{check,flight-100}.png`
  - [x] centre-throttle-probe.mjs on the same release, :5780, under the GPU lock (`U:/Temp/gsfpv-train2/connect/centre-new.json`): pass, dji-centred 4 of 4, dji-flip 5 of 5, dji-bottom 3 of 3 checks, 0 page errors
- [x] C1.4 (c3bca3d3 adds `logB` to the session probe) rates in Facts; the page logs one 36-byte record per physics tick that received any answer, identical or not; measured growth 1616 B/s; verdict in For the lead

Stage C2-auto-connect:
- [x] C2.1 "The flow" below (today and new)
- [x] C2.2 code (25c3b21b): `devices/usb-look.ts` routeOf, helperOffered, `untested`, the ?rcbridge switch retired (rcBridgeOn removed; RC_BRIDGE_KEY kept only as a name for migrate.ts); `ui/usb-look-block.ts` pickDji (USB chooser, stick channel, refused claim goes on to the helper by itself), quietHelper and the quiet watch (2000 ms between tries, chosen, not measured), the helper section built only when offered; `ui/radio.ts` "Connect my controller" (radio-connect: HID chooser, then the DJI USB chooser, a second press when Chrome wants one), autoFind once per screen (granted HID, granted RC 2 over WebUSB, else the quiet helper with a saved RC 2 setup), the pad watch opens ANY pad once per pad and screen; `app/input.ts` findSavedRc2Helper in resumeInput (only with the permission granted or absent); `tools/rc-bridge/start-rc-bridge.cmd` renamed `start-dji-helper.cmd`; locales fly/usb en/es/pl/ru: 7 new keys, 9 texts without the word bridge
  - checks: new `tools/bench/test/app-connect.test.ts` 6 tests; with app-usb-look, app-dji-rc2-bridge, app-dji-rc2-lna, app-dji-rc2, app-known-controller, app-hid-source, a6-reference, packages/prefs migrate: 89 of 89 passed; neg control NEG OK (old usb-look.ts and usb-look-block.ts: 6 of 6 failed, the routing tests by a missing export, the block tests by assertions); typecheck apps/fly 0
- [x] C2.3 (d7ae87a9) local release of fe8b30e2 (build-release.mjs, sha256 f1429e54..., 1903 files), server :5780, under the GPU lock (`U:/Temp/gsfpv-train2/connect/run-c2.sh`, sum `run-c2.sum`): hid-source-probe exit 0, 9 of 9 runs pass; wizard-auto-check exit 0 (nobuttons, human, dji end on check, 0 errors); rc2-probe usb,refused,bridge,bridge-lna 19 of 19 checks (`connect/rc2-c2.json`). rc2-probe changed: RC2_BRIDGE_PORT sends the page's helper socket to the probe's own helper (5781; the owner's real helper holds 47310) with bypassCSP; refused expects 'helper program' and no word bridge; bridge accepts an auto connect at load (measured: none on http://localhost, Chrome says 'prompt' there, the press connected, check screen, 185 frames in 2 s); bridge-lna and bridge-nogrant reach the helper after a refused claim (a fresh profile offers it only then); usb writes `<out>-state.json` for connect-probe
- [x] C2.4 (d7ae87a9 and this commit) `tools/bench/scripts/connect-probe.mjs` 13 of 13 checks (`connect/connect-c2b.json`): pad: Controls screen first, an unknown gamepad shown after 2 s opens the wizard with no press (2957 ms after load); returning: rc2-probe's saved state, Local Network Access faked 'granted', replay helper on 5782: straight to flight with no press (2750 ms), 188 answers in 2 s; nohelper: one press of radio-connect (HID chooser 1, USB chooser 1, claim 1) gives data-state nobridge with '1. Double-click', no word bridge on the screen; helper started 3 s later: the wizard (stir/ready) 613 ms after, no second press. First run of nohelper failed without the 'granted' fake: headless Chrome on http://localhost answers 'prompt' for loopback-network, so the page shows the asking line and waits for Allow (by design: no retry may raise the question)
- [x] C2.5 `U:/Temp/gsfpv-train2/shots/connect-c2-controls-1920x1080.png` and `-844x390.png` looked at: 'Connect my controller' is the first, big green button with its hint under it, the old ways below, 'My controller is not in the list' as a closed details line at the end; at 844x390 the button and hint fit the first screen. An empty band of about 70 px under each hint (the empty status lines) is the old layout's. Also connect-c2-nohelper-line.png, connect-c2-{pad,returning,nohelper}.png
- [x] C2.6 (c) on the helper side: `tools/rc-bridge/rc_bridge.py` pick_device: the RC 2 (2CA3:1021) first, else the first other 2CA3 device that is not in NOT_CONTROLLERS (the drone 2CA3:0020), logged as an untested DJI controller, only the stick request sent; test_rc_bridge.py 23 of 23 OK; neg control NEG OK (old rc_bridge.py: Duml 1 error, pick_device missing). Not run against a real other DJI controller (none here)

Stage C3-helper-start:
- [x] C3.1 (37668e3b) `tools/rc-bridge/start-dji-helper.cmd`: finds the first Python that really runs (`py -3`, `python`, `python3`, 3.8+), says how to get one, offers start with Windows once (Y only; one file in the pilot's own Startup folder); `rc_bridge.py` first_look at start (one stick answer, then let go, before listening), plain() words for every reason, READ_LINE when the page reads the controller, no word bridge in the window; `tools/rc-bridge/.gitattributes` keeps the .cmd CRLF; test_rc_bridge.py 32 of 32 OK (9 new: Start 5, StartCmd 4 run the real .cmd with APPDATA/LOCALAPPDATA in a temp folder); neg control NEG OK (old rc_bridge.py and .cmd: 5 failures, 4 errors)
- [x] C3.2 (d530c22a) the page gives the two files itself (`apps/fly/src/devices/helper-files.ts`, Vite ?raw, a separate chunk loaded when the helper is offered; the program saved as `dji-helper.py`, the .cmd with CRLF); the public repository raw link until then; `usb.rc2.helperFile`, `usb.rc2.helperNeeds` new, `bridgeWhy`, `bridgeGet` changed in en, es, pl, ru; app-connect 8 of 8 (2 new), app-usb-look 11 of 11, typecheck apps/fly 0; neg control NEG OK (old usb-look-block.ts)
- [x] C3.3 README "Start it" for the new start; this status (The flow as built, For the lead: no-Python options, the owner's window)
- [x] C3.4 local release of d530c22a (build-release.mjs exit 0, 1907 files, sha256 1de88d83...): the two files are their own chunks `dist/fly/assets/start-dji-helper-*.js` and `rc_bridge-*.js`, not in main
- [ ] left for the lead: the C3 release in a browser (press the download links; not run in a browser in this stage)

Stage fixes (review CN-1..CN-11):
- [x] CN-1 stands (reproduced: the new test fails on the old spring.ts for low x0.93 and high x0.9). SpringWatch keeps the landings raw and judges the spread with the last range seen; owner-rc2-session.test.ts 15 of 15 (3 new: low x0.93, high x0.9, control x0.95); NEG OK (old spring.ts: 2 failed); packages/input 265 of 265; typecheck input 0
- [x] CN-2 partly: `expect(pads).toBeGreaterThan(0)`; SAME_TOL stays 0.03 (estimate), no real gamepad here to measure. Measured on the simulated pilots (owner-rc2-session.test.ts with SAME_TOL swapped): 0.1 and 0.12 pass all, 0.15 fails only the hand-made "two landing values" unit case, 0.2 and 0.3 fail 1 and 2 of 50 (owner-rc2-session plus packages/input/test/calib*)
- [x] CN-3, CN-8, CN-9, CN-10 (helper part) stand; `tools/rc-bridge/rc_bridge.py`: only 2CA3:1021 is opened, another DJI device only with `--other-dji` (so first_look never opens one by default); the port is taken before first_look, a second copy prints "The helper is already running in another window" and ends with 1, no traceback; "page connected" said once until the state changes; docstring (name, first look at start, RC 2 only, second copy). README. test_rc_bridge.py 34 of 34 (3 new/changed); NEG OK (old rc_bridge.py: 3 failed)
- [x] CN-4 stands (by reading: watchPads opened any pad as a gamepad; autoFind took hidList[0]). New `apps/fly/src/devices/auto-route.ts` autoRoute: a granted HID device with a saved setup (key prefix `hid:<vid>:<pid>:<name>:`) first, then a pad with a saved setup or a known table, then any granted HID device, then the pad. `ui/radio.ts`: the pad watch asks navigator.hid.getDevices() and autoRoute before it opens the pad (openFoundPad); autoFind leaves a pad with its own saved setup to the pad watch. app-connect 9 of 9 (1 new); NEG OK only by the missing module (the rule is a new file; the screen itself is not driven by a unit test); typecheck apps/fly 0. Not run in a browser
- [x] CN-5, CN-6, CN-7 stand (by reading; each new test fails on the old usb-look-block.ts by an assertion). `ui/usb-look-block.ts`: pickDji scrolls the opened block into view, a refused claim scrolls the helper section into view (scrollIntoView, block start); a press during a quiet helper try closes that try and goes on; "Fly with this controller" on the details road goes on to the helper after a refused claim. `ui/radio.ts` connectAny writes `usb.connect.below` under the button for 'shown', 'trying', 'failed' (new key in en, es, pl, ru; app-usb-look's key list). app-connect 12 of 12 (3 new), with app-usb-look, app-dji-rc2-bridge, app-dji-rc2-lna 34 of 34; neg control: old usb-look-block.ts, the 3 new tests failed (AssertionError); typecheck apps/fly 0. Not run in a browser (no screenshot of the scrolled state)
- [x] CN-10 stands: spring.ts says 59 (6ed4a62b), Facts say where the snap numbers come from, rc_bridge.py docstring updated (5bf64c18)
- [~] page probes (pass 2): connect-probe.mjs gets two nohelper checks (lineUnderButton: the `usb.connect.below` text under the button; helperLineInView: the helper's line inside the 1600x900 viewport after the press); run script `U:/Temp/gsfpv-train2/connect/run-fix.sh`, sum `run-fix.sum`. Run 1 on a release of dab27e1e (build exit 0, :5780, GPU lock 22:37-22:42): hid-source-probe exit 0; wizard-auto-check exit 0; centre-throttle-probe pass (dji-centred 4 of 4, dji-flip 5 of 5, dji-bottom 3 of 3); rc2-probe 18 of 19 (bridge.connected false: the first poll saw 'asking', the check screen came with 186 answers in 2 s; a race in the probe, fixed: it waits past 'asking'); connect-probe 14 of 15 (lineUnderButton true; helperLineInView false: the scroll to the helper section stopped at the page's end and the "1. Double-click" line, written after it, stayed under the fold, shot connect-c2-nohelper-line.png). Fix: a failed press-driven try brings its own line into view (block nearest; usb-look-block.ts), app-connect 12 of 12 with the new assertion plus app-usb-look 23 of 23, NEG OK (old usb-look-block.ts), typecheck fly 0. Was: a local release of 41d861b0 (node scripts/build-release.mjs), serve-csp on :5780, under the GPU lock: connect-probe.mjs (pad, returning, nohelper: the line under the button is now `usb.connect.below` text, the helper section scrolled into view), rc2-probe usb,refused,bridge,bridge-lna, centre-throttle-probe (spring.ts changed), wizard-auto-check. Same commands as `U:/Temp/gsfpv-train2/connect/run-c2.sh`
- For the lead from the fixes: CN-2 needs one real gamepad's landing spread (a few releases from each side) to set SAME_TOL; the simulated pilots pass up to 0.12. CN-3 trade-off: an untested DJI controller whose claim the page saw refused reaches the helper section, but the helper only opens it with `--other-dji` (the page does not say so yet)
- [x] CN-11 stands as a test-text problem: the owner's test step in For the lead now says what a saved from-zero choice looks like and asks whether he pressed J (no code change: a saved choice beating a new wizard is the design)

## Facts (measured)
Record `U:/Temp/gsfpv-train2/rc2/rc2-rec-20261113.jsonl` (67134 lines), split at the first gap over 3 s
(`U:/Temp/gsfpv-train2/connect/persec.py`):
- session 1: lines 0-2954, 46.4 s; stir at 3-14 s, then every value 1024 to the end (the wizard did not get further).
- session 2: lines 2955-67133, 1004.4 s (about 17 minutes, not 9), 64179 answers, 63.9 answers/s, median gap 15 ms,
  longest gap 157 ms, 11037 gaps of 0 ms (two answers with the same ms), 60106 of 64178 answers equal to the one
  before. Throttle: 91.8 % of answers exactly 1024, 7.2 % below 1004, 0.85 % above 1044.
- session 2 by second (throttle T, yaw Y, pitch P, roll R, left dial L): 1-8 all sticks stirred; 9-12 rest; 13-14 T at
  the bottom; 16-17 T at the top; 19-21 T at the bottom; 23-24 Y high; 27-28 P high; 30-31 R high; 50-54 L up, down,
  up; 59 T bottom; 65-66 L up then down; 84-86 T up (to 1684); 87-89 L up; 90-93 T at the bottom; 94-99 T 447-1110;
  111-135 T mostly 364-1024; 143-154 T bottom and back; 155-198 flight with R, P, Y corrections and T between 485 and
  1099 (medians 506-935, below the centre); 228-243 sticks to the ends again.
- Fixture: the first 205 s of session 2, 13105 lines, t rebased to 0.
- Spring snaps in session 2 (from the last sample beyond half the travel to the first within 0.15 of the middle):
  16 to 95 ms over 59 returns of the four sticks (throttle 39, yaw 6, pitch 7, roll 7); every rest is exactly 1024.
  Measured in stage C1 with a scratch script that was not kept (the session split is `persec.py`); review CN-10 asked
  for its name: not recoverable, so the 59 and the 16-95 ms are stage C1's printed numbers and RETURN_MS 200 stays an
  estimate (spring.ts says so). spring.ts's comment said 60; corrected to 59.

Replay of session 2 (run `a`, `U:/Temp/gsfpv-train2/connect/session-a.json`): local release of b05df5e6 on :5780, the
bridge `--replay <fixture> --dev --port 5781`, headless Chrome 157.0.8103.52 (bypassCSP; the page's socket to 47310
sent to 5781, because the owner's real bridge holds 47310), scene 887f27aa, Fly pressed at record 70.1 s. 12812
answers reached the page in 200 s (64.1 per second), 0 page errors.
- Wizard (record seconds): stir 0.7-9.5; Let go active 11.0, measured 11.7 with every stick at 1024; throttle screen
  12.6, its push began at 14.1 with the throttle at 364 (he lowered it first, then up: done 16.7 at 1684; the screen
  then wants it down: 19-20, yaw screen 20.0); yaw push 23.8, pitch 28.3, roll 31.3; arm screen 33.4-53.4 (the left
  dial: on = dial down, -1); check screen 54.3. On the check screen he lowered the throttle (59, the check's
  "throttle low") and flipped the dial down and up (65-66).
- Stored: throttle ch 3 not inverted, min -1 max 1 (center = bottom); yaw ch 4, pitch ch 2, roll ch 1; arm = axis
  ch 5 threshold -0.75 on below; throttleRest 'centre'; no mode switch, no known entry.
- Style: 'zero' (why none) while on the Controls screen (no profile); at Fly 70.1 'centred' why 'wizard'; at 70.7
  'centred' why 'seen' (RestWatch: centre). It stayed centred to the end.
- Motors and height: armed 85.2 (throttle up, the centred start), 4.67 m by 88; throttle to the bottom at 90 ->
  crashed at about 92 (full descent into the ground); respawn 4.11 m; armed 117.5, held 4.11 m with the stick at the
  centre to 160; from 160 the stick below the centre: down to the ground by 164, then the motors start and stop
  about every 0.5 to 3 s (armed/disarmed 13 times 166-197) while the stick stays 0.2-0.7 below the centre.

C1.4, the page's handling of 64 answers per second (run `obey-new`, record pace, release adf12c25):
- Controller 63.9 answers/s (record); page 64.1 answers/s handled (8980 in 140 s; run `a` 12812 in 200 s); longest
  gap in session 2 157 ms; gaps over 100 ms: 3 in 1004 s (193.4 s: 140 ms; 472.1 s: 155 and 157 ms), over 50 ms: 13.
- Path of one answer (read in code): `controls.ts` push -> arm gate update -> `session.input` -> `simclock.ts` push
  (ring buffer, no allocation) -> `runner.enqueue` (one `Float32Array.from` per answer) -> `Runner.stepOnce`
  (`packages/sim-core/src/runner.ts:741-756`) writes one 36-byte record per 1 ms tick that received any answer,
  identical to the one before or not.
- Flight log the runner keeps (`bytesKept()`, sampled every 100 ms): 65520 B at 70.1 s, 178308 B at 139.9 s:
  1616 B/s (44.9 records/s of 36 B; answers that land in the same tick share one record). Cap `DEFAULT_MAX_BYTES`
  32 MiB: reached after about 5.8 h of flight at this rate (arithmetic on the measured 1616 B/s).
- A held gamepad already sends a keep-alive every 20 ms (`apps/fly/src/devices/gamepad.ts` KEEPALIVE_MS), 50/s;
  the identical answers are also the bridge's keep-alive for the 100 ms stale gate (`controls.ts` tick).

C3, what a Windows pilot needs today (measured on this PC, `U:/Temp/gsfpv-train2/connect/c3/clean-path.cmd`):
- With PATH = System32 plus `%LOCALAPPDATA%\Microsoft\WindowsApps` (what a clean Windows 10/11 has; no `py.exe` in
  C:\Windows): `where py` exit 1; `where python` exit 0 (finds the App Installer stub
  `AppInstallerPythonRedirector.exe`); running `python -c ...` and `python3 -c ...` print "Python was not found; run
  without arguments to install from the Microsoft Store, ..." and exit 9009. So "where" lies on a clean Windows; the
  .cmd runs each candidate.
- Microsoft Store ids checked by their page titles: 9PNRBTZXMB4Z "Python 3.13", 9NCVDN91XZQP "Python 3.12".
- Public repository today (HTTP HEAD): `tools/rc-bridge/rc_bridge.py` 200, `start-rc-bridge.cmd` 200,
  `start-dji-helper.cmd` 404 (this lane's name is not on main yet), README 200.
- This PC: `py -0p` lists only 3.11 per user (`AppData\Local\Programs\Python\Python311`), installed without admin.

## The flow
Every way a controller reaches the page before C2 (code of rc2-lna b05df5e6), what the pilot pressed, and what a
browser lets a page do with no press:
- Gamepad API (`devices/gamepad.ts`, `devices/reconnect.ts` findSavedGamepad): no press, no chooser. Chrome shows a
  pad to the page only after a button or stick move on it (the Gamepad API's "gamepad user gesture"; reconnect.ts
  header: "a gamepad appears on its own once an axis is off centre"). Before C2 the Controls screen opened a pad by
  itself only when it was a RECOGNISED controller (`ui/radio.ts` watchPads: `recognise(...).device.mapping`); any
  other pad needed the press "Gamepad" first.
- WebHID (`devices/hid.ts` request, HID_CHOOSER_FILTERS): a press on "Radio or controller over USB" and a pick in
  Chrome's chooser (requestDevice needs a user activation). A device granted once comes back with
  `navigator.hid.getDevices()` with no press; before C2 only on page load and only with a saved setup
  (reconnect.ts findSavedHid); a granted device with no saved setup still needed the press.
- Known devices (`devices/known.ts`, `@gsfpv/input` recognise): not a way of its own; a recognised device opens on its
  known setup's check screen instead of the wizard.
- WebUSB look (`ui/usb-look-block.ts`): open the details "My controller is not in the list", press "Look at my DJI
  controller", pick in Chrome's USB chooser (vendor 2CA3). Shows what the device offers; no reading.
- The RC 2's WebUSB source (`devices/dji-rc2-source.ts`): after the look, a second press "Fly with this controller"
  (claim of FF.43.01). A granted RC 2 comes back with `navigator.usb.getDevices()` (no press) on load when a saved
  setup names it (findSavedRc2). On Windows with DJI Assistant 2 the claim fails (the channel is DJI's driver's).
- The RC bridge (`devices/dji-rc2-bridge.ts`, tools/rc-bridge): only with `?rcbridge=1` once in the address; then a
  press "Fly through the RC bridge". The socket to ws://127.0.0.1:47310 from the public https site needs Chrome's
  Local Network Access permission ('loopback-network', rc2-lna): the first attempt makes Chrome ask, Allow once, then
  'granted' is remembered for the site and later attempts ask nothing. `navigator.permissions.query` reads the state
  with no question (rc2-lna, `lnaStatus`).
So the owner's RC 2 on Windows took: Controls -> open the details -> Look -> pick in Chrome's list -> Fly with this
controller (refused) -> (?rcbridge=1 in the address, reload) -> start the program -> Fly through the RC bridge ->
Allow -> wizard.

The new flow (C2):
- On load (`app/input.ts` resumeInput): as before a trusted saved setup flies at once; new, a saved RC 2 setup also
  comes through the helper program when the permission is already 'granted' (or the browser has no such
  permission). A 'prompt' state is never tried on load: no question on load.
- The Controls screen with no controller in use (`ui/radio.ts` autoFind, once per screen): a granted HID device ->
  check screen (saved) or wizard (new); else a granted RC 2 over WebUSB that claims -> the same; else, with a saved RC
  2 setup or a granted RC 2 that did not claim, a quiet try of the helper (granted only), which keeps trying every
  2 s while the screen is open. The pad watch opens ANY pad that appears (recognised: known setup; else the wizard),
  once per pad and screen, so Back from its wizard does not reopen it.
- "Connect my controller" (primary, top of the Controls screen, which is also the start screen when nothing was
  found on load): Chrome's HID chooser (radios, game controllers); picked -> check screen or wizard. Nothing picked ->
  Chrome's USB chooser for DJI at once; if Chrome wants a fresh press for it, the button says "Look for my DJI
  controller" and one more press opens it. Picked: a joystick part -> it says to pick it in the first list; DJI's
  stick channel -> claimed at once -> wizard; claim refused -> the helper program route by itself (Chrome's question
  if not yet answered); the helper not running -> one line with the two steps ("1. Double-click start-dji-helper.cmd
  ... 2. Leave its window open"), the button "Fly with the helper program" as the retry, and the quiet watch that
  connects by itself once the program runs. Anything else -> the look with "Send this list" (the old details block,
  opened, for support).
- The routing rule in one place: `devices/usb-look.ts` routeOf (hid / rc2usb / report) and helperOffered (claim
  failed on a DJI stick channel, or a saved RC 2 setup). No ?rcbridge switch any more.

The flow as built (end of C3), Windows with DJI Assistant 2 and an RC 2, first time:
1. Controls -> "Connect my controller" -> Chrome's HID list (nothing to pick) -> Chrome's USB list -> DJI RC 2 ->
   the claim is refused -> the helper section opens by itself: why (one line), "Download start-dji-helper.cmd",
   "Download dji-helper.py" (one press each, saved by the page itself), what it needs (Python 3.8+, no admin),
   "Fly with the helper program", and the status line "1. Double-click ... 2. Leave its window open".
2. Double-click start-dji-helper.cmd: no Python -> the window names the Store and python.org and opens the Store on
   Y; Python there -> once "start with Windows?" (N by itself in 20 s) -> "Your DJI controller answers. Now open the
   simulator and press 'Connect my controller'." or the missing thing in plain words (DJI Assistant 2 not installed,
   close DJI Assistant 2, connect and switch on).
3. The page's quiet watch (every 2 s) connects by itself once Chrome's Local Network Access is 'granted'; the first
   time Chrome asks (Allow) after the press "Fly with the helper program". The window says "Your DJI controller is
   read". The wizard walks on the sticks; the spring throttle is stored 'centre' (C1.3); check screen; Fly.
Later visits: the saved RC 2 setup plus 'granted' -> straight to flight on load if the helper runs (with start with
Windows it does).

Owner's session 2 against the page, as replayed: Controls -> "Fly through the RC bridge" -> the wizard walks on the
sticks (no presses) -> check screen at 54 s -> Fly. The screens line up with every move in his record (each move
comes right after its screen), so the replay's timeline is taken as his.

## Decisions
- C1.1: a record replay starts at the page's connection (the bridge opens its source when a page connects), as the
  real bridge's record starts when the first answer is passed on. At the record's end the source returns nothing, so
  the bridge says "no answer" as for a controller switched off. The read loop skips its 10 ms poll pause for a paced
  source (`paced = True`), else answers with the same ms would drift.

- C1.3: the fix sits in the wizard, where the rest is stored: a throttle seen to snap back to the same middle from
  above and from below (SpringWatch: past half the travel, inside 0.15 within RETURN_MS 200 ms, then still 500 ms
  within 0.04; all landings within SAME_TOL 0.03) is stored as rest 'centre' whatever the Let go step sampled.
  resolveStyle is unchanged, so review M4 stays: a centre seen now never beats a wizard bottom; a radio throttle
  with no spring never shows the snap (40 simulated pilots of sim/human.ts, 0 radios read as a spring, every
  gamepad-like pilot read as one). RETURN_MS and SAME_TOL are estimates (RETURN_MS = twice the owner's longest
  measured snap, 95 ms).
- The wizard's Let go text ("Thumbs off, throttle all the way down") was not changed: with the fix it no longer
  decides the style of a spring stick.

## For the lead
- Verdict on the lead's reading: NOT reproduced. The replay of his record through the page (logic of release
  73beb77e plus the LNA page change) measured Let go at 11.7 s with the throttle at 1024 (he lowered it at 13.0, on
  the throttle screen), stored rest 'centre' and flew 'centred' (why: wizard, then seen). What his hands did in
  flight (throttle held 0.2-0.7 below the centre for 45 s, arming moves) looks like an FPV pilot, and the page under
  the centred style keeps the drone on the ground there with the motors starting and stopping; whether his live page
  flew 'zero' cannot be read from the record (no clicks, no style in it). Two ways his live page could have been
  'zero' that the record cannot show: a saved choice 'zero' on that profile from an earlier session (Recalibrate and
  Set again keep it), or a press of "Change to From zero" on the check screen.
- The path the lead described is real one second away: a pilot who obeys "throttle all the way down" at Let go at
  once gets rest 'bottom' and 'zero' (old calib.ts on the "obey" variant of his record: 'bottom'). Fixed at the cause
  (f890d090); proven on a page: the obey record on the new release stores 'centre' and flies 'centred' (Status), and
  centre-throttle-probe passes 3 of 3 variants (the FPV from-zero variants included).
- C1.4 verdict: nothing in the page's handling of 64 answers/s is wasteful enough to change. The cost per answer is
  a few small calls and one 32-byte allocation; the log grows 1.6 KB/s, comparable to a held gamepad's 50/s
  keep-alive. Dropping repeats would save at most the record bytes (the log), not the gate's keep-alive; that change
  sits in `packages/sim-core/src/runner.ts` (stepOnce: skip a record equal to lastApplied), outside this lane, and is
  not recommended now (log readers and the replay hash were not checked for it).
- Not in this lane: session 2 has 3 answer gaps over 100 ms (140 ms at 193.4 s, during his level flight); the stale
  gate in `controls.ts` tick disarms after 100 ms of silence, so such a gap may disarm an armed drone. Whether one of
  the 13 disarms at 166-197 s in the replay came from it was not separated.
- Seen on the check screen at 1600x900 (shot `connect-session-obey-new-check.png`): the throttle-style row is half
  under the sticky Fly bar (its text shows through behind the buttons).
- Not in this lane's files, found by the replay: in the centred style a stick held below the centre on the ground
  makes the motors start and stop every 0.5-3 s (13 times in 31 s), and full down from 4.7 m crashed (about 92 s);
  both are `apps/fly/src/play/centre-pilot.ts` / AutoArm behaviour.
- The owner's real bridge (python rc_bridge.py --record U:\Temp\gsfpv-train2\rc2\rc2-rec-20261113.jsonl, PID 38364)
  was still listening on 47310 during this stage; it was not touched. The probe uses its own port.

- Lane connect C2 done in code and probes; not on a real controller. The helper's own window (rc_bridge.py main())
  still prints 'Shramko RC bridge' and "'My controller is not in the list', 'Fly through the RC bridge'": the pilot
  reads that window. Next small step: say 'Shramko helper for DJI controllers' and 'press Connect my controller'.
- The old details block (usb-rc2-fly) says on a refused claim "the simulator tries it now" (usb.rc2.claimBridge) but
  only the Connect road tries the helper by itself; the details road shows the helper button instead.
- On the live https site a first-time pilot gets Chrome's Local Network Access question at the first helper try;
  the page then waits on the asking line. Measured headless on http://localhost: 'prompt' as well, so a page served
  from localhost never auto-connects without the press either (rc2-probe bridge, autoConnected false).

- C3 done: the helper window now says "Shramko helper for DJI controllers" and "press 'Connect my controller'" (the
  C2 note above is closed). The file is still `start-dji-helper.cmd` (C2's name, the page's texts use it), not
  start-rc-bridge.cmd; the old name stays on the public repository's main until this lane is merged and pushed.
- C3, a version that needs no Python (nothing built or installed here; prices are estimates from public price lists
  as remembered, not measured):
  a) Python's "embeddable package" (python.org zip, about 11 MB for 3.13, an estimate) unpacked next to the helper,
     the .cmd calls its python.exe. No install, no admin, no packer. python.exe is signed by the Python Software
     Foundation, so SmartScreen has nothing to stop; the pilot unpacks a zip (extract all) and double-clicks the .cmd.
     Cost: host one zip per Python version (GitHub release asset), a few lines in the .cmd. Cheapest real option.
  b) PyInstaller one-file .exe (about 8-12 MB, an estimate): one file to double-click. Unsigned and new, Windows
     SmartScreen shows "Windows protected your PC" (More info -> Run anyway) on the first start, Chrome may say the
     file is not commonly downloaded, and PyInstaller one-file exes are often flagged by antivirus heuristics. Cost:
     a Windows build step per release.
  c) Nuitka (compiled to C, needs a C compiler): smaller, fewer antivirus flags than b), the same SmartScreen screen.
  d) A small native exe (Go or Rust, about 700 lines of Python ported, 2-5 MB): no runtime at all; same SmartScreen
     screen unless signed. Cost: the port and its tests.
  e) Code signing for b), c) or d): an OV certificate (roughly 200-400 USD a year, an estimate) shows a publisher
     name but SmartScreen still warns until reputation builds; Microsoft's Trusted/Artifact Signing (roughly 10 USD a
     month, an estimate; eligibility rules for individuals apply) builds reputation faster. Without signing every
     packed exe gets the SmartScreen screen on its first start.
  Today's .cmd on its first start: a downloaded .cmd carries the Mark of the Web; Windows usually shows "Open File -
  Security Warning" (publisher could not be verified, Run) or SmartScreen; not seen here (see Not verified).
- What the owner should try with his RC 2 (one short window, about 5 minutes, on a release with C3): close the old
  helper window; Controls -> "Connect my controller" -> pick the RC 2 in the second list -> press both "Download"
  buttons -> double-click start-dji-helper.cmd in Downloads -> answer the start-with-Windows question -> the window
  should say "Your DJI controller answers" -> back in the page it should connect by itself (or press "Fly with the
  helper program") -> the window says "Your DJI controller is read" -> the check screen opens (his setup is saved) ->
  Fly: the throttle style row should say centred. If it says from zero as your choice, that is a choice saved earlier
  on this controller (key J or the row; a new wizard keeps it by design): press J once. Tell us whether you pressed J or
  the row in the session of 2026-11-13 (seconds 160-197 of session 2 flew with the throttle below the centre in 95.9 %
  of answers, median raw 722: from-zero hover flying, review CN-11). Tell us what Windows and Chrome showed on the
  downloads and the first double-click.

## Not verified
- The live page's state during his session (style, saved choice, presses): only his stick record exists.
- CPU time per answer in the page (not profiled; the C1.4 verdict rests on the code path and the log growth).
- Whether the check screen's throttle-style row comes out from under the Fly bar by scrolling (one screenshot only).
- Which of the replay's disarms at 166-197 s came from the stale gate and which from the centred pilot.

- C2 with a real DJI RC 2 or another DJI controller: none was used (the owner's helper on 47310 was left alone);
  rc_bridge.py pick_device is tested on lists of ids only.
- The real Chrome order of choosers after one press (HID, then USB): the probe fakes both; whether Chrome on Windows
  wants a second press there is handled in code (SecurityError gives 'usb.connect.again') but not seen in a browser.
- C3: other DJI controllers (RC N3, RC-N2, Goggles' remotes): none here; the helper opens them untested (C2.6).
- C3: a real person answering Chrome's Local Network Access question (only faked in probes).
- C3: browsers other than Chrome (Edge, Opera, Firefox: no WebHID/WebUSB in Firefox; Local Network Access differs).
- C3: what Chrome shows when the pilot saves a .cmd and a .py (dangerous-file prompts) and what Windows shows on the
  first double-click of a downloaded .cmd (Mark of the Web): not run, it would put dialogs on the owner's desktop.
- C3: Microsoft Store Python loading DJI's libusb0_dji.dll from Program Files (only python.org Python was used).
- C3: the release with C3 in a browser: the build ran (see Status) but no probe pressed the download links.
- C3: the .cmd's "start with Windows" entry after a real Windows sign-in (tested only as the file it writes).

## Cost notes
- C1 first worker: most turns went to reading the wizard's centre and throttle steps and the throttle-style
  builtin before the replay could say what happened; the replay itself answered the question in one run.
  Cheaper: run the replay first and read code only where the timeline points.
- C1 pass 2: about 20 turns; the most went to waiting on the 6-minute build and the two page runs. Cheaper: the
  rebuild in the background as the first command (done), and the probe sampling `bytesKept()` from the start so the
  log size needed no extra run.
- C2 first worker: about 34 replies, stopped after the code step (C2.1, C2.2). Most turns went to patching three
  files through Python scripts (one heredoc broke, one anchor missed `clear(this.body)`, Edit refused files read
  only by cat). Cheaper: read the exact anchor lines with the Read tool first and patch with Edit; build the release
  in the background as the first command of C2.3.
- C2 pass 2: about 30 replies. Most went to the probe rerun waiting on the GPU lock and to learning that localhost
  answers 'prompt' for loopback-network. Cheaper: query the permission state in the page before writing a case that
  depends on it.
- C3: about 38 replies. The most went to a hanging negative control (a test that read three lines from a
  subprocess blocked forever on the old program) and to Edit refusing files seen only through cat. Cheaper: give
  every subprocess read in a test a kill timer from the start, and open files with Read before the first Edit.
- fixes: about 45 replies for 11 findings, no page probe run. The most went to Edit refusing files after a negative
  control swapped them (Read again needed) and to the neg-control summary hiding which tests failed (a verbose rerun).
  Cheaper: one Read of each file just before its edits, and run neg controls with `--reporter=verbose` from the start.
