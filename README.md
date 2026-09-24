# ShramkoGSFPV — open-source FPV drone simulator for 3D Gaussian Splatting scenes

**Fly a real-feeling FPV drone through any photoreal 3D Gaussian Splatting scan, right in your browser.** ShramkoGSFPV loads scenes straight from [SuperSplat](https://superspl.at), gives you quadcopter physics with rates and PID like the sims pilots train on, solid voxel collisions where you actually crash, and control from your own radio (EdgeTX over WebHID), a gamepad or touch sticks. Built on WebGPU and the MIT-licensed PlayCanvas engine. Created by [Andrii Shramko](https://www.linkedin.com/in/andrii-shramko/).

> **Status: pre-alpha.** Research, architecture and the first code-level measurements are done (September 2026). The flyable web app is being built now. Everything below is marked either **measured** (verified by running code) or **planned** (not built yet) — nothing is claimed that has not been checked.

---

## Why this exists

FPV pilots train in simulators like Liftoff or VelociDrone because the physics and stick response feel right. But those sims only let you fly the maps someone built for them. Meanwhile, people publish thousands of real places as 3D Gaussian Splatting scans — rooms, villas, streets, whole city blocks — and today you can only walk or orbit through them.

ShramkoGSFPV joins the two: pick a real scanned place, arm, and fly it with a drone that behaves like the one in your hands. Rehearse a tricky indoor line before you fly it for real. Plan a cinematic shot in the actual location. Or just fly your own house on the Moon.

The default craft is a **BetaFPV Pavo20 Pro** class 2.2″ cinewhoop, because most published scans are rooms and streets, where a 5″ freestyle quad has no space to move.

## What is measured today

All numbers from runs on 2026-09-21/22, RTX 4090, system Chrome with WebGPU. Details and raw data: [`docs/measured-facts.md`](docs/measured-facts.md).

| Check | Result |
|---|---|
| A SuperSplat scene loads into a third-party page (not superspl.at) | ✅ yes, straight from the SuperSplat CDN, no proxy |
| Collision data is public and loads cross-origin | ✅ `Access-Control-Allow-Origin: *` on scene and voxel data |
| WebGPU active, Gaussian sort on the GPU (not a silent CPU fallback) | ✅ `gsplat.currentRenderer === 2` |
| Load time, 3.8 M-Gaussian villa interior (LOD streamed) | **1.2–1.9 s** |
| How close a drone can fly to a wall on the official 5 cm voxel collision | clearance tracks craft size: **42.5 mm radius → 72 mm median** centre-to-surface |
| Tunnelling if you only test frame endpoints | rare but **not zero** → swept collision is mandatory |
| Frame cost under hard acro rotation | ⚠️ **not measured yet** — the test browser was vsync-pinned at ~58 Hz |

## How it works (planned architecture)

```
superspl.at scene id / link
        │  scene bootstrap: content URL, collision URL, camera pose
        ▼
┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ render        │   │ sim-core (no DOM) │   │ input             │
│ PlayCanvas    │◄──│ rigid body, 4     │◄──│ WebHID (EdgeTX)   │
│ WebGPU, GPU   │   │ motors, mixer,    │   │ Gamepad API       │
│ radix sort,   │   │ rate PID, rates   │   │ touch sticks      │
│ LOD streaming │   │ curves, gravity,  │   │ simulated radio   │
└──────────────┘   │ record / replay   │   └──────────────────┘
                   └─────────┬─────────┘
                             ▼
                   ┌───────────────────┐
                   │ collision          │
                   │ sparse voxel octree│
                   │ swept sphere/capsule│
                   │ crash by impact    │
                   └───────────────────┘
```

- **Scenes:** any public SuperSplat scene by link or id; scenes that already carry voxel collision fly immediately, the rest get collision baked later in the browser.
- **Physics:** an own flight model — four motors with spin-up lag, X mixer, rate PID, Betaflight / Actual / KISS / Raceflight rate curves re-implemented from their published formulas. Acro by default, angle mode for beginners.
- **Crashes:** impact speed decides a crash; the craft then tumbles and settles, and you respawn instantly.
- **Gravity:** Earth, Moon, Mars, zero-g or your own value.
- **Recording:** stick inputs for deterministic replay, plus the flight trajectory.
- **Cinematic mode:** maximum scan quality, slow flight, capture — for planning real shots.

Decisions and their reasons: [`docs/decisions.md`](docs/decisions.md). Honest list of what can go wrong: [`docs/warnings.md`](docs/warnings.md).

## Why build it this way

| | ShramkoGSFPV (planned) | Walking in the SuperSplat viewer | Browser splat FPV demos (2026) | Classic FPV sims |
|---|---|---|---|---|
| Real scanned places | any public SuperSplat scene | yes | yes, one file at a time | fixed maps |
| Drone model | 4 motors, mixer, rate PID | none (walk / fly camera) | first-order rate filter | full |
| Your own rates | Betaflight / Actual / KISS / Raceflight curves | — | flat max-rate + expo | yes |
| Hit a wall | crash, tumble, respawn | slide along it | stop / slide, no crash | crash |
| Collision source | official voxel octree, swept test | official voxel octree | rebuilt at load, point test | hand-made meshes |
| Radio input | WebHID + Gamepad API | gamepad (2 sticks) | Gamepad API | USB joystick |
| Install | none, open a link | none | none | yes |
| Source | MIT | MIT | varies | closed |

Facts in this table are dated September 2026. Prior-art notes: [`docs/prior-art.md`](docs/prior-art.md).

## Questions people ask

**How can I fly an FPV drone through my own 3D scan?**
Publish the scan on SuperSplat (or use any public scene there), paste its link into ShramkoGSFPV, connect your radio and fly. No install.

**Is there a browser FPV simulator for Gaussian splatting scenes?**
Yes — that is exactly what this project is. It runs on WebGPU in Chrome or Edge.

**Can I use my RadioMaster / EdgeTX radio in the browser?**
Yes, planned via WebHID with a Gamepad API fallback: set the radio to USB Joystick mode and run the calibration wizard. WebHID works in Chromium-based browsers only.

**Do I crash when I hit a wall, or do I fly through it?**
You crash. Collisions use the scene's voxel octree with a swept test, so a fast drone cannot tunnel through thin geometry between frames.

**Can I fly without a radio?**
Yes — touch sticks on a tablet or phone, or a gamepad.

**Will it feel like my real drone?**
That is the goal: pick a preset (Pavo20 Pro, Pavo20 Pro II, Pavo Pico, Meteor65) or enter your own rates and weights. Presets mark every number as measured, manufacturer-stated or estimated.

**Is it free?**
Yes. MIT license, open source.

## For your AI agent

Copy this into your coding agent to get the measurement harness running locally:

```text
Clone https://github.com/AndriiShramko/ShramkoGSFPV and read README.md,
docs/measured-facts.md and tools/probe/README.md. Follow tools/probe/README.md
exactly to run the probe against SuperSplat scene 39e63ce9 in system Chrome
with WebGPU. Report: status, gsplat.currentRenderer, load time, clearance by
radius, tunnelling counts, and the idle vsync cadence (negative control).
Do not report any frame-cost number that equals the idle cadence.
```

## Contributing

Pre-alpha, so the most useful help right now is measurements on other hardware (non-NVIDIA GPUs, Macs, 144/240 Hz displays), radios in USB joystick mode, and flight-model review from pilots. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Author and collaboration

**Andrii Shramko** — FPV pilot and 3D/4D Gaussian Splatting specialist, the author and maintainer of ShramkoGSFPV.

I am passionate about this idea and open to interesting connections and ready to help teams bring incredible projects to life. If you are a **simulator developer, drone maker, 3DGS platform, researcher, investor or FPV school** — let's talk about partnership, integration, licensing, sponsorship or funding. I am ready to assemble and lead a team around it.

- **LinkedIn:** https://www.linkedin.com/in/andrii-shramko/
- **Book a call:** https://calendar.app.google/Ff729HqGk4RpzPNDA
- **Email:** zmei116@gmail.com
- **GitHub:** https://github.com/AndriiShramko

## License and credits

Code is released under the [MIT License](LICENSE) © 2026 Andrii Shramko. If you use this project, keep the copyright notice and please credit **Andrii Shramko** with a link to this repository; citation metadata is in [`CITATION.cff`](CITATION.cff).

Built on the MIT-licensed [PlayCanvas Engine](https://github.com/playcanvas/engine), [SuperSplat viewer](https://github.com/playcanvas/supersplat-viewer) and [splat-transform](https://github.com/playcanvas/splat-transform) — see [`NOTICE`](NOTICE). Thanks to [SplatFPV](https://github.com/Rouf0x/splatfpv), an earlier browser experiment that proved the idea works. Scenes remain the property of their authors and are shown with their license and attribution.

Product names (SuperSplat, PlayCanvas, Betaflight, EdgeTX, RadioMaster, BetaFPV, Liftoff, VelociDrone, DJI) belong to their owners and are used only to describe compatibility. This project is not affiliated with or endorsed by any of them.
