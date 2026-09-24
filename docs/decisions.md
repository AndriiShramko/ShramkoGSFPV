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
