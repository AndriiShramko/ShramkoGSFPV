# ShramkoGSFPV screenshots

Real screenshots of the live simulator at https://gsfpv.flyreelstudio.eu, taken on 2026-09-27 (the release built from commit `ac6b57e`) by [`tools/bench/src/screens.ts`](../../tools/bench/src/screens.ts) in system Chrome (desktop 1920×1080, phone-sized 390×844). The same files are on the [landing page](https://gsfpv.flyreelstudio.eu/en/#gallery) with captions in four languages. To take them again after a release: `npx tsx tools/bench/src/screens.ts`.

The calibration screens use the simulator's built-in simulated EdgeTX radio (`?simradio=raw`) and the flights are flown by its test pilot (`?simradio=scenario`), so the same screens can be taken again the same way after a release. This file is written by the same script.

## Desktop (21)

<table>
<tr>
<td width="50%" valign="top"><a href="flight-tunis.webp"><img src="flight-tunis.webp" alt="Tunis old town"></a><br><sub><b>Tunis old town</b> — The flight view on Andrii's Tunis scan: arm state and flight mode, battery voltage and flight time, throttle, speed, altitude and the keys.</sub></td>
<td width="50%" valign="top"><a href="flight-villa.webp"><img src="flight-villa.webp" alt="Modlinek Villa"></a><br><sub><b>Modlinek Villa</b> — A 2.2-inch cinewhoop in a real attic room; the scan's credit and its walls line sit at the bottom left.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="flight-garden.webp"><img src="flight-garden.webp" alt="Winter Garden"></a><br><sub><b>Winter Garden</b> — Glass roof, plants and furniture, with the walls SuperSplat publishes for this scan: 3.2 cm voxels you really crash into.</sub></td>
<td width="50%" valign="top"><a href="picker.webp"><img src="picker.webp" alt="Choose a scan"></a><br><sub><b>Choose a scan</b> — Andrii's scans, recent and favourite ones, filters for walls, type and flown, or a pasted SuperSplat link.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="loading.webp"><img src="loading.webp" alt="Loading"></a><br><sub><b>Loading</b> — What is downloading, megabytes done and in total, the speed, and the scan and its walls counted apart.</sub></td>
<td width="50%" valign="top"><a href="controls.webp"><img src="controls.webp" alt="Controls"></a><br><sub><b>Controls</b> — A radio over USB (EdgeTX), a gamepad, touch sticks or the keyboard, each with a one-line hint.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="wizard-stir.webp"><img src="wizard-stir.webp" alt="Calibration: stir the sticks"></a><br><sub><b>Calibration: stir the sticks</b> — The drawn radio shows what to do, and the channel bars follow the reports (here a simulated EdgeTX radio).</sub></td>
<td width="50%" valign="top"><a href="wizard-throttle.webp"><img src="wizard-throttle.webp" alt="Throttle found"></a><br><sub><b>Throttle found</b> — Each stick is found by moving it: the wizard names the channel, offers Reverse and moves on when the stick is back.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="wizard-arm.webp"><img src="wizard-arm.webp" alt="Arm switch"></a><br><sub><b>Arm switch</b> — Flip the switch you arm with ON and back OFF, pick its channel, or skip the step and arm with Space.</sub></td>
<td width="50%" valign="top"><a href="wizard-check.webp"><img src="wizard-check.webp" alt="Check before flying"></a><br><sub><b>Check before flying</b> — Every channel with a live bar and buttons to reverse or redo it, the arm state, and the profile to download or load.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="arm-card.webp"><img src="arm-card.webp" alt="Ready to arm"></a><br><sub><b>Ready to arm</b> — Disarmed with a radio, a card lists what arming still needs: sticks let go, throttle down, the arm switch.</sub></td>
<td width="50%" valign="top"><a href="keys.webp"><img src="keys.webp" alt="Keyboard"></a><br><sub><b>Keyboard</b> — Every flying key on screen: Space arms, W and S throttle, A and D yaw, the arrows tilt, M switches self-levelling.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="walls.webp"><img src="walls.webp" alt="Walls"></a><br><sub><b>Walls</b> — The walls line says which walls fly and offers finer ones with a time estimate; stored walls move to another PC as a zip.</sub></td>
<td width="50%" valign="top"><a href="pause.webp"><img src="pause.webp" alt="Pause menu"></a><br><sub><b>Pause menu</b> — Continue, restart, scan, drone, controls, settings, replays, measurements, Betaflight import and cinema mode, with their keys.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="settings.webp"><img src="settings.webp" alt="Settings"></a><br><sub><b>Settings</b> — Field of view and uptilt, HUD, stable frame or detail, gravity, crash threshold, motor spin-up, drag and PID for each axis.</sub></td>
<td width="50%" valign="top"><a href="drones.webp"><img src="drones.webp" alt="Six drones"></a><br><sub><b>Six drones</b> — BetaFPV-class presets with a rate curve each; every number says where it comes from: manufacturer, measured or estimate.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="betaflight.webp"><img src="betaflight.webp" alt="Betaflight import"></a><br><sub><b>Betaflight import</b> — Paste a CLI diff and its rates and PID fly the quad; every setting the simulator does not use is listed (here a test diff).</sub></td>
<td width="50%" valign="top"><a href="measure.webp"><img src="measure.webp" alt="Measurements"></a><br><sub><b>Measurements</b> — Renderer, display refresh, frame times, physics rate, load time, the walls in use and a tunnelling self-test, copyable as JSON.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="cinema.webp"><img src="cinema.webp" alt="Cinema mode"></a><br><sub><b>Cinema mode</b> — Full detail, automatic quality off, no HUD; Record saves an MP4 with the scan's credit in the picture.</sub></td>
<td width="50%" valign="top"><a href="crash.webp"><img src="crash.webp" alt="Crash"></a><br><sub><b>Crash</b> — The impact speed decides; the wreck tumbles with debris, then respawn, a 10-second replay or the flight log.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="replays.webp"><img src="replays.webp" alt="Replays"></a><br><sub><b>Replays</b> — A saved flight plays again from its stick inputs alone; its trajectory exports as CSV or JSON.</sub></td>
</tr>
</table>

## Phone-sized screen (5)

<table>
<tr>
<td width="50%" valign="top"><a href="m-flight.webp"><img src="m-flight.webp" alt="Phone-sized screen" width="260"></a><br><sub><b>Phone-sized screen</b> — The same flight view in portrait, 390 pixels wide.</sub></td>
<td width="50%" valign="top"><a href="m-touch.webp"><img src="m-touch.webp" alt="Touch sticks" width="260"></a><br><sub><b>Touch sticks</b> — Two pads and an ARM button; on touch the quad flies self-levelling (ANGLE).</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="m-pause.webp"><img src="m-pause.webp" alt="Pause menu on a phone" width="260"></a><br><sub><b>Pause menu on a phone</b> — The whole menu fits on a phone screen.</sub></td>
<td width="50%" valign="top"><a href="m-crash.webp"><img src="m-crash.webp" alt="Crash on a phone" width="260"></a><br><sub><b>Crash on a phone</b> — Impact speed, debris and the crash panel on a small screen.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="m-picker.webp"><img src="m-picker.webp" alt="Scans on a phone" width="260"></a><br><sub><b>Scans on a phone</b> — Paste a link or pick a scan on a small screen.</sub></td>
</tr>
</table>
