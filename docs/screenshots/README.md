# ShramkoGSFPV screenshots

Real screenshots of the simulator, taken on 2026-09-27 from a production build of commit `97294e0`, the release deployed to https://gsfpv.flyreelstudio.eu with these pictures, by [`tools/bench/src/screens.ts`](../../tools/bench/src/screens.ts) in system Chrome (desktop 1920×1080 at device scale 2, phone-sized 390×844). The same files are on the [landing page](https://gsfpv.flyreelstudio.eu/en/#gallery) with captions in four languages. To take them again after a release: `npx tsx tools/bench/src/screens.ts`.

Each menu has two files: `<name>-panel.webp` is the menu itself with a little of the scene around it (sharp enough to read), `<name>.webp` the whole screen. The calibration screens use the simulator's built-in simulated EdgeTX radio (`?simradio=raw`) and the flights are flown by its test pilot (`?simradio=scenario`), frozen while it is really flying, so the same screens can be taken again the same way after a release. This file is written by the same script.

## Desktop (25)

<table>
<tr>
<td width="50%" valign="top"><a href="pause.webp"><img src="pause-panel.webp" alt="Pause menu"></a><br><sub><b>Pause menu</b> — Continue, restart, scan, drone, controls, settings, replays, measurements, Betaflight import and cinema mode, with their keys. <a href="pause.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="settings.webp"><img src="settings-panel.webp" alt="Settings"></a><br><sub><b>Settings</b> — Field of view and uptilt, HUD, the walls and the voxel grid, stable frame or detail, gravity, crash threshold, motor spin-up, drag and PID for each axis. <a href="settings.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="drones.webp"><img src="drones-panel.webp" alt="Six drones"></a><br><sub><b>Six drones</b> — BetaFPV-class presets with a rate curve each; every number says where it comes from: manufacturer, measured or estimate. <a href="drones.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="wizard-stir.webp"><img src="wizard-stir-panel.webp" alt="Calibration: stir the sticks"></a><br><sub><b>Calibration: stir the sticks</b> — The drawn radio shows what to do, and the channel bars follow the reports (here a simulated EdgeTX radio). <a href="wizard-stir.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="wizard-throttle.webp"><img src="wizard-throttle-panel.webp" alt="Throttle found"></a><br><sub><b>Throttle found</b> — Each stick is found by moving it: the wizard names the channel, offers Reverse and moves on when the stick is back. <a href="wizard-throttle.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="wizard-arm.webp"><img src="wizard-arm-panel.webp" alt="Arm switch"></a><br><sub><b>Arm switch</b> — Flip the switch you arm with ON and back OFF, pick its channel, or skip the step and arm with Space. <a href="wizard-arm.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="wizard-check.webp"><img src="wizard-check-panel.webp" alt="Check before flying"></a><br><sub><b>Check before flying</b> — Every channel with a live bar and buttons to reverse or redo it, the arm state, and the profile to download or load. <a href="wizard-check.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="controls.webp"><img src="controls.webp" alt="Controls"></a><br><sub><b>Controls</b> — A radio over USB (EdgeTX), a gamepad, touch sticks or the keyboard, each with a one-line hint.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="arm-card.webp"><img src="arm-card-panel.webp" alt="Ready to arm"></a><br><sub><b>Ready to arm</b> — Disarmed with a radio, a card lists what arming still needs: sticks let go, throttle down, the arm switch. <a href="arm-card.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="keys.webp"><img src="keys-panel.webp" alt="Keyboard"></a><br><sub><b>Keyboard</b> — Every flying key on screen: Space arms, W and S throttle, A and D yaw, the arrows tilt, M self-levelling, V the voxel grid, C the walls. <a href="keys.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="walls.webp"><img src="walls-panel.webp" alt="Walls on or off"></a><br><sub><b>Walls on or off</b> — The walls line on the credit opens the walls menu: the walls (collisions) switch, the voxel grid and the stored walls. Here the walls are off (C): the drone flies through everything, no crashes. <a href="walls.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="voxels.webp"><img src="voxels.webp" alt="Voxel grid over the scan"></a><br><sub><b>Voxel grid over the scan</b> — The walls you crash into, drawn over Andrii's Tunis scan in height colours: V switches between off, over the scan and voxels only; the chip names the style and the voxel size.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="voxels-wire.webp"><img src="voxels-wire.webp" alt="Wireframe grid"></a><br><sub><b>Wireframe grid</b> — The Winter Garden's 3.2 cm walls as a wireframe over the scan: see where a wall really is before you fly the line.</sub></td>
<td width="50%" valign="top"><a href="voxels-only.webp"><img src="voxels-only.webp" alt="Voxels only"></a><br><sub><b>Voxels only</b> — The scan hidden and only its 5 cm walls left, as solid cubes (Modlinek Villa): fly the grid alone and see every surface you can hit.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="voxels-floaters.webp"><img src="voxels-floaters.webp" alt="Floaters in red"></a><br><sub><b>Floaters in red</b> — Pieces of the grid that touch nothing else and are smaller than 0.5 m³ turn red, so a phantom wall in the plants stands out.</sub></td>
<td width="50%" valign="top"><a href="betaflight.webp"><img src="betaflight-panel.webp" alt="Betaflight import"></a><br><sub><b>Betaflight import</b> — Paste a CLI diff and its rates and PID fly the quad; every setting the simulator does not use is listed (here a test diff). <a href="betaflight.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="measure.webp"><img src="measure-panel.webp" alt="Measurements"></a><br><sub><b>Measurements</b> — Renderer, display refresh, frame times, physics rate, load time, the walls in use and a tunnelling self-test, copyable as JSON. <a href="measure.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="replays.webp"><img src="replays-panel.webp" alt="Replays"></a><br><sub><b>Replays</b> — A saved flight plays again from its stick inputs alone; its trajectory exports as CSV or JSON. <a href="replays.webp">Whole screen</a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="picker.webp"><img src="picker.webp" alt="Choose a scan"></a><br><sub><b>Choose a scan</b> — Andrii's scans, recent and favourite ones, filters for walls, type and flown, or a pasted SuperSplat link.</sub></td>
<td width="50%" valign="top"><a href="loading.webp"><img src="loading.webp" alt="Loading"></a><br><sub><b>Loading</b> — What is downloading, megabytes done and in total, the speed, and the scan and its walls counted apart.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="crash.webp"><img src="crash-panel.webp" alt="Crash"></a><br><sub><b>Crash</b> — The impact speed decides; the wreck tumbles with debris, then respawn, a 10-second replay or the flight log. <a href="crash.webp">Whole screen</a>.</sub></td>
<td width="50%" valign="top"><a href="cinema.webp"><img src="cinema.webp" alt="Cinema mode"></a><br><sub><b>Cinema mode</b> — Full detail, automatic quality off, no HUD; Record saves an MP4 with the scan's credit in the picture.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="flight-tunis.webp"><img src="flight-tunis.webp" alt="Tunis old town"></a><br><sub><b>Tunis old town</b> — The flight view on Andrii's Tunis scan: arm state and flight mode, battery voltage and flight time, throttle, speed, altitude and the keys.</sub></td>
<td width="50%" valign="top"><a href="flight-villa.webp"><img src="flight-villa.webp" alt="Modlinek Villa"></a><br><sub><b>Modlinek Villa</b> — A 2.2-inch cinewhoop in a real attic room; the scan's credit and its walls line sit at the bottom left.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><a href="flight-garden.webp"><img src="flight-garden.webp" alt="Winter Garden"></a><br><sub><b>Winter Garden</b> — Glass roof, plants and furniture, with the walls SuperSplat publishes for this scan: 3.2 cm voxels you really crash into.</sub></td>
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
