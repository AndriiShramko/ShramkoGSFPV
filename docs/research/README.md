# Research and design notes

Written by the agents that built v0.2 / v0.3 (2026-09-25..27). They explain *why* the code is the
way it is; the plan for what is left is [`../architecture-v03.md`](../architecture-v03.md).

| File | What |
|---|---|
| `wizard-v2-spec.md` | the v0.2 calibration wizard (human-paced, drawn radio); superseded by v3 |
| `wizard-v3-user-paced-spec.md` | v3: every step started by the pilot; then "auto" pacing (the sticks move it on, no Start/Next) replaced the buttons, see `packages/input/src/calib.ts` `auto` |
| `latency-plan-2026-09-27.md` | why control latency felt 300-400 ms (compositor stuck 3 frames, 4K@30 Hz over HDMI, GPU queue behind DaVinci); the latency guard and HUD came from it |
| `voxel-plan-2026-09-27.md` | why the drone could not pass under chairs (voxel inflation), bake cost per voxel size, refine / cache / export plan |
| `settings-modes-respawn.md` | settings inventory, flight modes, spawn platform, rewind respawn, post-flight stats (v0.3 parts A-D) |
| `scenes-scale-recording-voxels.md` | SuperSplat catalogue API and CORS, scene scale, 60 fps recording, voxel overlay (v0.3 parts E-G) |
| `physics-pavo20.md` | BetaFPV Pavo20 Pro / Pro II data and how our model differs (v0.3 part H) |
