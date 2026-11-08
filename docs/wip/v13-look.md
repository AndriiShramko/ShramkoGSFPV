# v0.13 v13-look: no sticking, the lesson rooms' look, the attitude display and the sound panel (owner's messages 41, 42)

Plan: `docs/wip/v13-plan.md` (M41-19, M41-23, M41-24, M41-25 and "Checks"); lead: `docs/wip/v13-lead.md`; the host
lane: `docs/wip/v13-host.md` (stage A, its A6 cost numbers). The package's merge review lists the simulator's items W1 to
W20 (`C:/dev/ShramkoSonicFPV/docs/dev/review-v0.13-merge.md`): this lane has W16 and W17; the panel's API (W14) is the
package's `docs/dev/status-v0.13-sound.md`, "API for the host (exact)".

Worktree `C:/dev/gsfpv-v13-look`, branch `v13-look`, cut from v13-host's stage A (aac4261: the simulator on the sound
package 16c01a1, every gate green). The package (`packages/sonic-fpv`) is never edited here: what it must change goes
under "Needs from the package".

Why this lane is in v0.13: the owner, message 42, on the look waiting for a later release: "How will people test or
check this without the look? ... It matters to me that this is the most finished version for training, for deaf
pilots, for blind pilots." So deaf pilots see the sounds (the sound panel), low-vision pilots read the attitude display,
sighted testers and helpers see rooms that look like a game. Message 41: a craft that bumps a pillar sticks to it and is
very hard to fly away from.

Two stages, one agent each: L1 (no sticking, the page flight of W17, the rooms' look, the frame cost of W16) and L2
(the attitude display, the sound panel, their page proofs).

Files: this lane writes `apps/fly/src/sonic/lesson-world.ts`, `primitives.ts`, the collision response of the lesson
worlds, and new files (`apps/fly/src/sonic/look*.ts`, `attitude.ts`, `sound-panel.ts`, `look.css`). It keeps off
v13-host's stages B and C (`C:/dev/gsfpv-v13-host`): `apps/fly/src/sonic/lessons.ts`, `mode-keys.ts`, `mode.ts`,
`bridge.ts`, `start-screen.ts`, `start-model.ts`, `entry.ts`, `apps/fly/src/sonic-session/*`; in
`packages/prefs/src/doc.ts` it only adds its own pref keys, in `feature.ts` one registration line per new panel.

## Status

### Stage L1

- [ ] L1-1 (M41-19) no sticking in the lesson worlds: a bump pushes the craft out along the contact normal with a
  little bounce and lets it slide along the surface; after a hit at any angle (walls, pillars, ceiling, floor; 0 to 85
  degrees to the surface; 1 to 5 m/s) the craft is out of contact within 0.3 s with the stick released or pointed away.
  The scans' flight does not change (the reference hash, flight regression B6-B16). A collision probe test over those
  angles and speeds, no tunnelling through thin walls; its control (the v0.12 response) sticks and fails.
- [ ] L1-2 (W17) a headless page flight on a release build: full stick in walls-hall from the start to the first touch
  (the model says 2 to 3 s: measured); a respawn in tunnel-gaps' free way under a block rests at the respawn point and is
  not stuck.
- [ ] L1-3 (M41-23) the lesson rooms and tunnels look like a game, cheaply: block textures (procedural), a checker
  floor, hemisphere ambient light plus one sun, soft fog, coloured pillars and rings, no shadows. Low vision: luminance
  contrast at least 3:1 between floor and walls and between obstacles and what is behind them, measured on the page's
  pictures. Screenshots of walls-hall, corridor, tunnel-gaps and rings-heights (small JPEGs in `evidence/`, full-size
  pictures kept local).
- [ ] L1-4 (W16) frame cost: the page's frame time with the new look in tunnel-long, the corridor and rings-heights
  within v0.12's frame budget; tunnel-long's collider (16 % over its plan of 20 ms per 10 s of flight) brought under
  without changing the world's voxel size, or the whole frame shown in budget, the decision written with its numbers.
- [ ] L1-5 gates exit 0; flight regression B6-B16 on a local build; L1's status final.

### Stage L2 (the next agent)

- [ ] L2-1 (M41-24) the attitude display for low vision (`apps/fly/src/sonic/attitude.ts`, new): a large high-contrast
  horizon (thick horizon line, ground and sky that differ in lightness, pitch marks), an altitude tape with the lesson's
  target band and the craft's mark, a climb arrow; drawn from the flight's state, no new sim state; contrast at least
  4.5:1 for its lines and marks, measured.
- [ ] L2-2 (M41-25, W14) the sound panel (`apps/fly/src/sonic/sound-panel.ts`, new): a top-down radar with each active
  cue at its direction (above or below marked for a cue whose direction has an elevation, so the panel shows more once
  the package's lane s13-elev gives the cues a 3D direction), the open way's side from `engine.plan.freeWay`; a height bar
  with the drone tone (`plan.height.heightM`, `hz`) and the target tone (`plan.height.target`, its note every
  `periodS`); a repeat step (`repeat-cue`) shows the cue's icon and name while it plays. Reads `PageEngine.plan` and the
  engine's events only.
- [ ] L2-3 the panels' prefs (show or hide, size; new keys in `packages/prefs/src/doc.ts` only) and their texts in
  `packages/i18n/locales/**` (en, es, pl, ru; es, pl and ru marked for a native reading); one registration line per
  panel in `feature.ts`; the new prefs listed under "For the lead" for the spoken settings list.
- [ ] L2-4 page proofs on a release build (headless, GPU lock): the attitude display follows a scripted climb, roll and
  pitch; the sound panel shows a hazard's side, the open way's side and the height and target tones as the engine plans
  them; a repeat step shows its cue; contrast measured on the pictures; the frame cost with both panels on.
- [ ] L2-5 gates exit 0; flight regression B6-B16; the lane's status final.

## For the lead

(filled as the lane goes)

## Needs from the package

(none yet)
