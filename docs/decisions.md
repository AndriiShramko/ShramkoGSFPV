# Decisions

Each decision with the reason. Dated September 2026. The author's intent wins over any technical preference below.

| # | Decision | Why |
|---|---|---|
| D1 | **Pure browser first** (Chrome / Edge, WebGPU + WebHID); Electron only as a fallback | Zero install is the product. WebHID is event-driven, so the latency gap to a native app is about one frame, not tens of milliseconds. Three independent design reviews ranked the browser path first. |
| D2 | **Simulation core has no DOM** | Moving to Electron later is then a change of shell, not a rewrite. |
| D3 | **Build on PlayCanvas' own MIT bricks** (engine, SuperSplat viewer, splat-transform), not on a fork of an earlier splat-FPV demo | The long-term goal is to offer drone flight back to the SuperSplat project. Code shaped as contributions to their repositories is far easier to upstream than a third-party fork. |
| D4 | **MIT licence, own flight controller** re-implemented from published formulas | Linking real Betaflight (GPL-3.0) would make the whole product GPL and block contributing to MIT upstream. A real-firmware bridge can come later as a separate GPL module. |
| D5 | **Any public SuperSplat scene** by link or id | That is the point of the product: take a real place and fly it. Scenes with collision fly at once; collision for the rest is baked in the browser later. |
| D6 | **Official 5 cm voxel collision is good enough** to start | Measured: clearance tracks craft size (see measured-facts §4). Finer baking is an improvement, not a prerequisite. |
| D7 | **Swept collision test** | Measured: endpoint-only tests miss collisions at speed. |
| D8 | **Real crash**: impact speed decides; the craft tumbles with debris and settles; instant respawn | Hitting a wall must end the flight, as in real FPV. After the crash a rigid-body engine can take over the body, so it is not in the hot flight loop. |
| D9 | **Default craft: BetaFPV Pavo20 Pro class 2.2″ cinewhoop**, 3S | Most scans are rooms and streets. Presets also for Pavo20 Pro II, Pavo Pico and Meteor65. Every preset number is labelled measured / manufacturer / estimate. |
| D10 | **Rate curves**: Betaflight, Actual, KISS, Raceflight; acro default, angle mode available | Pilots should feel their own rates. |
| D11 | **Adjustable gravity**: Earth, Moon, Mars, zero, custom | Requested for fun and for "what if" flights. On the Moon the same craft has ~6× the thrust-to-weight, which the UI must explain. |
| D12 | **Record inputs (deterministic replay) and trajectory** | Replays, shot planning, and later leaderboards that can be verified. |
| D13 | **Cinematic mode**: max quality, slow flight, capture | For planning real shots in the real place. The quality slider otherwise lives in advanced settings; the default protects a stable frame rate. |
| D14 | **Input**: WebHID for EdgeTX radios, Gamepad API as compatibility, touch sticks, a simulated radio for automated tests; calibration wizard in the style of the well-known sims; profiles keyed by device fingerprint | The radio must just work; tests must run without a human. |
| D15 | **Scene catalogue**: local history, favourites and saved filters now; a full SuperSplat catalogue only with the platform's permission | There is no public listing API and the metadata API is not cross-origin. |
| D16 | **Acceptance by numbers**: latency, frame time, zero tunnelling, clearance | Measurable success instead of endless tuning. For testing, ~33 ms end-to-end is acceptable; ≤25 ms median on a 144 Hz display is the product target. |
| D17 | **Windows first**, macOS after the first release | The same code runs in Chrome on macOS; performance is claimed only after measuring on a real Mac. |

## Build-time decisions (September 2026, phase A)

Each one was taken while building, with the measurement that justified it. Evidence files live in [`evidence/`](../evidence/).

| # | Decision | Why |
|---|---|---|
| D18 | **Shell = Next.js static export (landing, 4 languages); simulator = separate Vite app at `/{locale}/fly/`, no framework** | SEO/GEO and hreflang for the landing; no hydration in the hot loop; the same simulator bundle can later move into an Electron shell or upstream into SuperSplat's framework-free viewer. |
| D19 | **Render with the PlayCanvas engine directly, not the viewer's `createViewer` wrapper** | Probe A1 on 4 measurable criteria: engine 4/4, `createViewer` 0/4 — the wrapper overwrites our camera pose every frame, reverts our render scale (1281×801 instead of 640×400 / 2560×1600), makes the flight model download the collision a second time, and exposes the camera only as an internal entity. A static check found every PlayCanvas member we use public (70 checked). [`a1-engine-vs-createviewer.json`](../evidence/2026-09-24/a1-engine-vs-createviewer.json) |
| D20 | **Swept collision = provable cover, not a ray** | A sphere moving along a segment lies inside spheres of radius *r + h* spaced *2h* along it, so if every inflated sphere is free the whole swept volume is free. Hit intervals are bisected to 0.25 mm. The overlap test is our own code, so the oracle (upstream `querySphere`) stays independent. 200 000 passes, 0 penetrations. [`a5-tunnelling.json`](../evidence/2026-09-24/a5-tunnelling.json) |
| D21 | **Feed-forward scale is `0.013754 × F × 0.01`** | Betaflight 4.5.1 `pid_init.c:278` multiplies F by 0.01; without it a stick step saturated the PID for 30 ms and overshot 135 %. |
| D22 | **Betaflight's default filter chains in the PID loop** (gyro PT1 250 + PT1 500 Hz; D-term PT1 75–150 Hz dynamic + PT1 150 Hz) | The sensor stays ideal, but the controller now has the phase lag a real flight controller has. With an unfiltered gyro even Kp × 3 did not ring; with the defaults Kp × 3 rings (overshoot 7.9 %, 2 crossings) while the stock tune stays clean (1.4 %, none). |
| D23 | **Rotation integrated through world-frame angular momentum** | Plain explicit Euler on `Iω̇ = τ − ω×Iω` drifted 1.7 % in |L| over 10 s of torque-free tumbling; integrating L in the world frame keeps it to 9e-13. |
| D24 | **Nominal thrust is defined at the loaded full-throttle voltage of a fresh pack** | That is how a thrust-to-weight ratio is measured on a stand, so the craft shows its stated TWR at full throttle with a fresh battery and sags as the pack drains. The Moon-hover consistency check uses an ideal battery (0.1817 vs expected 0.18). |
| D25 | **The craft is parked at the spawn until the first arm** | Otherwise it falls while the pilot calibrates a radio. Part of the simulated state, so replays are unaffected. |
| D26 | **Latency marker = four 8×8 px black/white cells in the Immediate layer** | Black and white survive tone mapping and colour management, so the capture decodes bits, not colours. The Immediate layer is drawn after the gsplat pass (the UI and World layers were covered by splats). |
| D27 | **Coarse level of detail first, full detail after the engine reports the coarse level resident** | Same reveal the SuperSplat viewer uses, driven by the public `frame:ready` event; a 3.8 M-Gaussian room is visible in about 2.5 s. |
| D28 | **Determinism: sim-core uses only + − × ÷ and `Math.sqrt`, plus its own fdlibm-derived sin/cos/atan2/exp and a pure-JS SHA-256** | The trace hash is identical in Node and Chrome and across frame splits of 30/60/144/240 Hz; adding `Math.random` to one step changes it. [`a6-determinism.json`](../evidence/2026-09-24/a6-determinism.json) |
