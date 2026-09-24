# Warnings — what can go wrong

An honest list. If something here worries you, open an issue.

## Technical limits

- **Chrome and Edge only for radios.** WebHID is not available in Safari or Firefox; there you can still view scenes and fly with touch sticks or a gamepad.
- **A fast display matters.** On a 60 Hz screen one frame alone is 16.7 ms; on 30 Hz it is 33 ms. For the lowest latency use 120–144 Hz with variable refresh off.
- **Frame cost under hard acro is not measured yet.** Heavy scenes (tens of millions of Gaussians, hundreds of MB) may need reduced detail to keep a steady frame rate.
- **Flying very close to a wall is expensive to render** (many overlapping splats fill the screen).
- **Scans have holes.** Places the scanner never saw — above cupboards, under tables, the outside of a room scan — look wrong or empty. Thin objects (railings, wires, chair legs) may be missing from collision or look thicker than they are.
- **Not every scene has collision yet.** Scenes without it are flagged; baking collision in the browser is planned.
- **Scene scale.** Scans from LiDAR devices are metric; photogrammetry scans may not be, which makes the physics feel wrong.

## Legal

- **Scenes belong to their authors.** The app shows the author and licence of every scene. Do not publish scans of private places or people without permission.
- **Names of products and firmware** are used only to describe compatibility.

## Health

- **Motion sickness.** FPV on a screen or in a headset can cause nausea. Take breaks.
- **Photosensitivity.** Crashes use short visual effects; a reduced-effects option will be provided.

## It is a simulator

It does not replace real training, local drone rules or common sense. Never practise over people.
