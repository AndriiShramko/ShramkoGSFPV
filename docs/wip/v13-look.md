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

- [x] L1-1 (M41-19) no sticking in the lesson worlds: a bump pushes the craft out along the contact normal with a
  little bounce and lets it slide along the surface; after a hit at any angle (walls, pillars, ceiling, floor; 0 to 85
  degrees to the surface; 1 to 5 m/s) the craft is out of contact within 0.3 s with the stick released or pointed away.
  The scans' flight does not change (the reference hash, flight regression B6-B16). A collision probe test over those
  angles and speeds, no tunnelling through thin walls; its control (the v0.12 response) sticks and fails.
  - Why it stuck (measured on the v0.12 response, the page's own loop in Node: radio, Controls, the lesson pilot, the Sim
    at 1 kHz on walls-pillar): the drone's contact is an impulse at the touching duct, 0.033 m off the centre, so a 3 m/s
    hit on the pillar spun the craft at 41 rad/s; 0.15 s later its top faced the pillar and its own thrust held it there,
    within 1 mm, for 2 s with the stick pointed away (hundreds of contacts). And the lesson pilot's velocity loop kept what
    it asked into the pillar after the bounce (the ramped target -2.8 m/s, the integral -2.5 m/s^2), so even a bounce that
    did not spin flew the craft straight back into it.
  - The rule, two halves, both only in lesson worlds:
    - sim-core `ParamOverrides.bump: 'slide'` (`SimParams.bump`, `BumpRule`; absent = 'drone', the v0.12 contact, every
      scan): the centre of mass leaves the surface along its normal at 0.3 of the speed it came in at, at 0.3 m/s at least
      from a wall or a ceiling (a glancing hit at 5 m/s comes in at 0.44 m/s), its motion along the surface and its spin
      kept (no friction, no torque); a floor (normal y >= 0.7) keeps Coulomb friction and gets no push, so a lesson still
      lands. The respawn disc keeps its own rule. The contact event now carries the surface's normal (nx, ny, nz).
    - `apps/fly/src/sonic/lesson-world.ts` `LESSON_FLIGHT` = `{ bump: 'slide' }` in `BuiltinWorld.overrides`, which the
      session merges into every life it flies (`session/index.ts` `lifeOverrides`): every life header of a lesson world
      names the rule, so a replay flies it too; `lifeHeaderProblem` refuses a rule this build does not know.
    - The lesson pilot (`play/lesson-pilot.ts`, only when the model's bump is 'slide') hands every contact to
      `GameAssist.bump`: the velocity loop drops its target and integral into the wall, holds the stick's push into it off
      for 0.4 s (longer while the stick still pushes and the craft is within 0.3 m), and the altitude help keeps a held
      height 0.15 m off a bumped ceiling or floor, getting there at 0.5 m/s at least, and holds a climb into the ceiling
      off. A sink to the floor stays the pilot's. The game scheme of the ordinary flight never calls these.
  - Probe `tools/bench/test/sonic-bump.test.ts` (5 tests): 220 flights (walls-hall's wall, walls-pillar's pillar,
    walls-hall's ceiling and floor x 0, 30, 60, 85 degrees from the normal x 1 to 5 m/s x stick let go, pointed away, or
    pressed 0.5 s more first; the floor thrown at, not pressed: pressing into it is landing), 220 hits at 0.09 to 5.12
    m/s into the surface: out of contact (2 cm off every surface, no contact after) after at most 0.236 s. Thin walls
    (rings-first's tube, 0.2 m; shapes-square's bar, 0.15 m) at 1, 3, 5 m/s: 24 flights, out after at most 0.071 s.
    Deepest overlap of the body with the walls on any tick: 0.0 mm (no tunnelling); the detector's control (walls the
    flight flies through) reads 30 mm. Control in the test: the v0.12 response, pillar 52 of 60 flights stuck past 0.3 s
    (the owner's case, 3 m/s head-on and pointed away, among them). A lesson still lands: motors off 2.78 s after the
    stick goes down.
  - `packages/sim-core/test/model-bump.test.ts` (5 tests): a 3 m/s hit leaves at 0.3 of it, slides on, no spin (the drone's
    rule spins it over 5 rad/s); a glancing 0.3 m/s hit is pushed out at 0.3 m/s; a floor slows a sliding craft and lets
    it rest (hops under 3 mm); a life flown with the rule replays to its live hash and the same log without the rule in
    its header does not; an unknown rule is refused.
  - Controls broken once and restored: the slide rule a no-op (the probe's worst 0.972 s, fails); the pilot's bump
    handling off (worst 0.993 s, fails); the header check removed (the unknown rule passes, fails); a push on floors too
    (5.4 mm hops, fails); the floor lift while the stick sinks (never lands, hovers at 0.139 m, fails).
  - Unchanged elsewhere: `a6-reference` (the reference hash) and every sim-core test pass; the Fly by Sound tests (`sonic-*`,
    `sonicrec-*`, `packages/prefs/test/sonic.test.ts`) and `app-game`, `app-easy`: 626 pass, 10 skipped (as before: 8 need
    the scan, 2 are stage B's). The lesson rig (`sonic-lesson-rig.ts`, the real FlightSession) now flies the slide rule.
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

- L1-1 touches shared code, each change inert outside a lesson world: `packages/sim-core` (`ParamOverrides.bump`,
  `SimParams.bump`, `Sim.slide`, the contact event's normal, `lifeHeaderProblem`), `apps/fly/src/play/assist.ts`, `game.ts`
  (methods only a lesson's pilot calls), `play/lesson-pilot.ts`, `session/index.ts` (`BuiltinWorld.overrides`). No
  `SIM_CORE_VERSION` bump: no trace without the override changes (the reference hash holds); a lesson life now carries
  `bump: 'slide'` in its header, so its configHash differs from a v0.12 one, and a v0.12 lesson log still replays with
  the contact it was flown with.
- The scan lesson (free-garden) keeps the drone's own contact: its walls are the scan's, and the mode sets no override for
  a scan. If the owner wants the lesson bump there too, the mode would add `{ bump: 'slide' }` to the session's
  overrides while a scan lesson runs (v13-host's `mode.ts`).

## Needs from the package

(none yet)
