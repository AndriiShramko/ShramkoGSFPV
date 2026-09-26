# Warnings — what can go wrong

An honest list. If something here worries you, open an issue.

## Technical limits

- **Chrome and Edge only for radios.** WebHID is not available in Safari or Firefox. Radios have been tested only in desktop Chrome with a simulated EdgeTX radio (Edge not run yet). Firefox 155 renders the scene with WebGPU and the app offers a gamepad or touch sticks there (flying in Firefox not tested yet). Touch sticks were tested only in desktop Chrome's touch emulation, and only for arming, both sticks at once and the pause button: holding a hover with them was not checked (the craft sat 0.3–3.3 m above its hover target). Safari, iPad and Android browsers have not been tested yet.
- **A fast display matters.** On a 60 Hz screen one frame alone is 16.7 ms; on 30 Hz it is 33 ms. For the lowest latency use 120–144 Hz with variable refresh off.
- **Frame cost under hard acro is not measured yet.** Heavy scenes (tens of millions of Gaussians, hundreds of MB) may need reduced detail to keep a steady frame rate.
- **Flying very close to a wall is expensive to render** (many overlapping splats fill the screen).
- **Scans have holes.** Places the scanner never saw — above cupboards, under tables, the outside of a room scan — look wrong or empty. Thin objects (railings, wires, chair legs) may be missing from collision or look thicker than they are.
- **Not every scene has collision yet.** Scenes without it are flagged. One click builds walls in the browser for scans up to 4 M Gaussians (about 25 s for a 2.1 M scan on a desktop GPU); bigger scans can only be flown through.
- **Scene scale.** Scans from LiDAR devices are metric; photogrammetry scans may not be, which makes the physics feel wrong.

## Legal

- **Scenes belong to their authors.** The app shows the author and licence of every scene. Do not publish scans of private places or people without permission.
- **Names of products and firmware** are used only to describe compatibility.

## Health

- **Motion sickness.** FPV on a screen or in a headset can cause nausea. Take breaks.
- **Photosensitivity.** Crashes use short visual effects. Measured over 50 crashes: at most 2 flashes per second, under the WCAG limit of 3 (whole frame and quarters, `evidence/2026-09-24/b-fly-b17.json`). The system reduced-motion setting and the reduced-motion switch in the settings calm the crash camera (not tested yet).

## It is a simulator

It does not replace real training, local drone rules or common sense. Never practise over people.
