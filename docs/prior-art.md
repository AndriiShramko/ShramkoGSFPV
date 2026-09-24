# Prior art

Checked in September 2026. We credit earlier work and say plainly how this project differs.

## SuperSplat viewer (PlayCanvas, MIT)

The official viewer for SuperSplat scenes. It already has sparse-voxel collision with ray, sphere and capsule queries, a swept "sphere mover", walk and fly camera modes, and basic gamepad input. It has no drone model. ShramkoGSFPV builds on this code rather than replacing it.

## SplatFPV (Rouf0x/splatfpv, MIT)

A browser FPV experiment on PlayCanvas 2.21 (repository created 2026-07-22, last commit 2026-07-26). It proved the concept: play, settings and a controller calibration screen, touch sticks, WebXR and motor sound. Read from its source:

- rotation: angular velocity eased toward the stick target (first-order), single thrust force along the body axis;
- rates: flat max-rate per axis plus expo;
- default craft: about 377 g, thrust-to-weight 3.3 (5″ class);
- collision: voxels rebuilt from the point cloud at every launch (10 cm), point test; hitting geometry stops or deflects the craft but does not end the flight;
- input: Gamepad API polled once per frame.

ShramkoGSFPV differs in the flight model (motors, mixer, rate PID, real rate curves), in using the platform's official collision with a swept test and real crashes, in small-craft defaults, and in WebHID input.

## Classic FPV simulators

Liftoff, VelociDrone, Uncrashed, DRL Simulator and others set the bar for how FPV should feel. They use hand-built maps and native installs. We use their public behaviour (calibration flow, rate models, respawn) as the reference for "feels right", not their code.

## Research

Robotics research uses radiance fields and Gaussian splats as photoreal environments for drone navigation and sim-to-real training. Those projects target robot learning, not a pilot with a radio.
