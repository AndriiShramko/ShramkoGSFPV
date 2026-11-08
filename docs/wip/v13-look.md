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
  - Physics benches rerun (AGENTS.md: a physics change): A2, A4 and A5 PASS (`evidence/2026-11-08/a2-collision-formats.json`,
    `a4-physics.json`, `a5-tunnelling.json`: 200 000 passes, 0 penetrations); A3 (the rate curves) untouched. The run
    rewrote `evidence/latest.json`'s tunnelling item (same value, its method's top speed 34.16 m/s and date).
- [x] L1-2 (W17) a headless page flight on a release build: full stick in walls-hall from the start to the first touch
  (the model says 2 to 3 s: measured); a respawn in tunnel-gaps' free way under a block rests at the respawn point and is
  not stuck.
  - Found on the way, fixed: the lesson pilot's take-off from within 0.5 m of the ground climbed a 1 m hop blind to what
    is above. tunnel-long's runner respawns a craft at two points 0.35 m under a block's edge (and two on a block's top
    0.35 m under the ceiling): the hop met the block over the rear ducts, and a touch in a tunnel re-centres the craft to
    that same point, so it would hop into it again (a loop). At take-off the lesson pilot now looks up over the body's
    footprint (`play/lesson-pilot.ts` `rayClearanceUp`: five rays, the centre's alone misses a block at its edge;
    `LessonEnv.above`, wired in `app/input.ts`) and the hop goes to the middle of the way at most (`play/game.ts`
    `liftoff`, `GameSense.ceilingM`; the game scheme gives none and keeps its 1 m). Tests (`sonic-bump.test.ts`, W17):
    the four points hover within 6 mm with the motors on and W flies on 3.7 m, nothing above touched; control in the
    test: v0.12's hop touches the block at 2 of the 4 (strayed 0.32 m); 0.5 m inside a block's footprint: 0 of 2
    touched, v0.12's hop 2 of 2. Broken once: the centre ray alone (the first version) touched at 2 of 4, failing.
  - Page, release build 8b8dd60 on `serve-csp.mjs dist 5420`, headless system Chrome 156, GPU lock held, new
    `tools/bench/src/v13-look-page.ts bump`: 14 of 14 (`evidence/2026-11-08/v13-look-bump.json`, three small JPEGs in
    `v13-look-bump/`).
    - walls-hall, W held from the start at rest: **the first touch 2.63 s** after the stick went full (2.60, 2.57 and
      2.63 s over three runs), in the flight model's own ticks (2626); top speed 3.18 m/s (cap 3), 5.9 m flown, the
      front wall (normal +z). The worlds' model said 2 to 3 s.
    - tunnel-gaps (block 3, a 1.2 m way) and tunnel-long (block 3 at x 58.25-59.25, a 0.7 m way): the craft put where
      the runner puts one, W in short pulses just past the track point (marked passed), Space into the ceiling further
      on (a touch): the runner re-centres it under the block, at (0, 0.6, -20.25) and (59.25, 0.35, -46). There, motors
      on, 2.5 s with the sticks centred: within 1.2 cm and 6 mm of the place, no touch, no second re-centre; then W for
      2 s flies it on 3.76 and 3.75 m, no touch. No page error.
    - Not done: the same page run on a stage A build (v0.12's hop) as a page-level control; the Node test above is the
      control.
- [x] L1-3 (M41-23) the lesson rooms and tunnels look like a game, cheaply: block textures (procedural), a checker
  floor, hemisphere ambient light plus one sun, soft fog, coloured pillars and rings, no shadows. Low vision: luminance
  contrast at least 3:1 between floor and walls and between obstacles and what is behind them, measured on the page's
  pictures. Screenshots of walls-hall, corridor, tunnel-gaps and rings-heights (small JPEGs in `evidence/`, full-size
  pictures kept local).
  - New `apps/fly/src/sonic/look.ts` (pure, Node-tested): 0.5 m blocks on walls and ceilings (a procedural 256 px texture
    over 2 m: a shade per block, a dark joint, a lit and a shaded bevel), a 0.5 m checker floor, both in world metres so
    the blocks line up and show the room's size; a hemisphere (sky 1, ground 0.55) plus one sun (0.15, from 0.4/0.8/0.45),
    no shadows, baked per vertex (the world and the sun stand still; a flat face is exact) under unlit materials; objects
    get a softer rig of their own; soft linear fog from 12 to 60 m toward the sky colour, which is also every lesson
    world's clear colour (`lesson-world.ts` `LESSON_BACKGROUND`, and `tonemapping: 'linear'` so a scan flown before
    cannot leave its own). Colours for low vision, three steps 3:1 apart: a dark checker floor, slate walls, a darker
    ceiling, bright obstacles (pillars amber, gates yellow, the next gate white-yellow, blocks cyan, zones green).
  - `apps/fly/src/sonic/primitives.ts` `PrimitiveStage`: the room of each role (floor, walls, ceiling) is ONE mesh of the
    slabs' faces toward the hollow (`Prim.facing`, set by `slabOf` and the open world's slabs), an object's part a mesh
    of its own with its light baked as float vertex colours, the target lit by its material as before; the scene's fog
    set while a lesson world's room is shown and given back on clear and dispose (a scan lesson's gates alone leave the
    fog as it is); `paint('roles')`, one flat colour per kind of surface and no fog, for measuring (registered on
    `window.__gsfpv.sonicLook` when the page has its test hook; feature.ts untouched). The Prim lists and every
    geometry test stay as they were (`sonic-primitives`, 105 of 105); `count` still counts primitives.
  - On paper, new `tools/bench/test/sonic-look.test.ts` (9 tests): floor against walls 3.18:1, the floor's bright squares
    against the darkest wall 3.04:1, obstacles (mean over all normals) against the lightest wall, the floor and the
    ceiling: pillars 3.23, blocks 3.31, gates 3.69, the next gate 4.79; the patterns repeat and tile; every room quad of
    walls-hall, the corridor, tunnel-gaps, tunnel-long and hover-height on the hollow's boundary, facing into it, wound
    counter-clockwise from inside (control in the test: the triangles reversed are caught); the baked light follows an
    object's rotation. The first run caught two faults, fixed: every face 5 cm into the rock (a sign) and a palette
    0.05 short of 3:1. Broken once and restored: the floor's albedo as the walls' fails the contrast test.
  - On the page, `v13-look-page.ts look`, release build of c1c9349 with this step, 15 of 15
    (`evidence/2026-11-08/v13-look-look.json`; per lesson a JPEG as the pilot sees it and one of the view alone in
    `v13-look-look/`; the full-size PNGs of the look and the role paint kept on U:, `U:/Temp/gsfpv-v13-look/look/2026-11-08`):
    mean relative luminance of each kind of surface in the page's own picture, the role paint as the mask:
    | lesson (view) | floor | walls | ceiling | floor : walls | obstacle : what is behind it |
    |---|---|---|---|---|---|
    | walls-hall (from near the back) | 0.0068 | 0.129 | 0.032 | 3.15 | (none) |
    | corridor (the first pillar 4.5 m ahead) | 0.0068 | 0.127 | 0.032 | 3.11 | pillar 0.594 against 0.049: 6.49 |
    | tunnel-gaps (block 1 4.25 m ahead) | 0.0068 | 0.125 | 0.033 | 3.08 | block 0.617 against 0.079: 5.18 |
    | rings-heights (the start) | 0.0075 | 0.129 | 0.033 | 3.11 | the rings 0.826 against 0.091: 6.23 |
    The first page run showed every object black (`Mesh.fromGeometry` takes a geometry's colours as 8 bits: a light of
    0.8 became 0): the check of 3:1 failed there (1.98 to 2.57), fixed by building the object meshes like the room's.
- [x] L1-4 (W16) frame cost: the page's frame time with the new look in tunnel-long, the corridor and rings-heights
  within v0.12's frame budget; tunnel-long's collider (16 % over its plan of 20 ms per 10 s of flight) brought under
  without changing the world's voxel size, or the whole frame shown in budget, the decision written with its numbers.
  - [x] The collider, brought under in the simulator, voxel size unchanged (0.05 m): `tools/bench/test/sonic-tunnel-cost.ts`,
    A6's flights (62 track points, a disarmed craft let go along the track at 2.5 m/s and 0.5 m/s toward the left wall, 1 s
    each), best of 9: **16.41 ms for 10 s of flight** (plan 20 ms; A6 23.24), the same answers as the voxels with no shortcut
    (`evidence/2026-11-08/sonic-tunnel-cost.json`, `bump: 'lesson'`). Two parts, each measured on its own:
    - the flights now fly the lesson world's own rule (L1-1's bump 'slide', as the session flies it): the craft bounces off
      the walls instead of grinding along them, 618 contacts instead of 2806, 67 018 queries instead of 82 494: 20.61 ms
      without the shortcut below (still over);
    - `packages/collision/src/analytic.ts` `AnalyticContactWorld.sweep` and `pushOut`: one test for the whole body, a ball
      that holds every sphere's first sweep test, free when it lies within the free radius at its centre, from the cell's
      kept distance, else the last distance asked (1-Lipschitz bounds, the craft's queries come millimetres apart), else
      one call of the world's distance at the point (`AnalyticVoxelCollision.freeWithin`). In tunnel-long's 0.7 m ways the
      0.4 m cells rarely tell, the point's distance mostly does: 20.61 -> 16.41 ms. With the drone's own contact (A6's
      flights as flown then, `DRONE_BUMP=1`) it changes nothing (23.33 ms): grinding along a wall is all voxel walks.
    - v0.12's hall (`tools/bench/test/sonic-world-cost.ts`, `evidence/2026-11-07/sonic-world-cost.json` written again): in
      the open 2.43 ms (was 3.46), along and into a wall 14.54 ms (was 13.35: the body test that fails near a wall costs a
      little), both under the plan's 20 ms; in vitest the ratios to the uncached lookup are 0.13 (open, bound 0.5) and 0.73
      (wall, bound 1.25).
    - Exactness: new `tools/bench/test/sonic-tunnel-walls.test.ts`: tunnel-long's flights (12 track points, 11 750 queries)
      get the same answers from the session's world as from the voxels with no shortcut, the distance at the point asked
      884 times; control in the test: the shortcut over a distance that lies (walls 0.3 m further off) differs. Broken once
      and restored: the body test with a tenth of its reach fails the first test. `sonic-world.test.ts` (the voxel
      agreement, the replays of a flight on rebuilt walls, the ratios) passes unchanged.
  - [x] The page's frame time with the new look: `v13-look-page.ts cost`, six views along each world's track (the craft
    parked there), 2.5 s of frames each, headless Chrome 156 on this machine's GPU (the display paces frames at 30 Hz:
    33.3 ms), the engine's CPU time per frame (frameupdate to frameend: the flight model, the mode and its planner, the
    scene, the draw's encoding) and the GPU time of the render passes (WebGPU timestamps; with the developer features
    flag, stock Chrome rounds them to 0.066 ms here, more than these frames take):
    | world | v0.12's look (8b8dd60) CPU p50 / p95 | new look (c1c9349) CPU p50 / p95, a repeat | new look GPU p50 / p95 | planner p95 |
    |---|---|---|---|---|
    | tunnel-long | 1.6 / 2.1 ms | 1.5 / 2.2, 1.5 / 2.4 ms | 0.028 / 0.094 ms | 0.6 ms |
    | corridor | 1.5 / 2.0 ms | 1.4 / 1.9, 1.4 / 2.1 ms | 0.035 / 0.12 ms | 0.4 ms |
    | rings-heights | 1.4 / 1.9 ms | 1.6 / 2.7 (one 12.6 ms frame), 1.4 / 2.0 ms | 0.019 / 0.103 ms | 0.6 ms |
    The look costs no measurable CPU (within run-to-run spread) and about 0.1 ms of GPU at p95; no frame was missed (the
    governor stayed at its first step, render scale 1). v0.12's frame budget (the 60 Hz frame of 16.7 ms, the planner's
    1 ms at p95, the collider's 20 ms per 10 s): the whole frame stays under 2.5 ms at p95 on this machine, the planner
    at 0.6 ms in the page. Evidence: `evidence/2026-11-08/v13-look-cost-v012-look.json`, `v13-look-cost.json`,
    `v13-look-cost-repeat.json` and a JPEG of each world's first view beside each (v0.12's look and the new one).
  - Decision (W16): the collider is brought under its plan in the simulator (above, 16.41 ms per 10 s), and the page
    shows the whole frame in budget besides; no change of the world's voxel size is needed.
- [x] L1-5 gates exit 0; flight regression B6-B16 on a local build; L1's status final.
  - `gates.py --repo C:/dev/gsfpv-v13-look` on 8343ce5 (all of L1's code; logs `U:/Temp/gsfpv-gates-20261108-211626`):
    exit 0. typecheck 26 s; vitest 240 files, 3865 passed, 2 skipped (3867: the 23 new tests of this lane on A7's 3844;
    the 2 skipped are stage B's of v13-host; the nine that A7 skipped for want of the scan's walls in `.cache` and a build
    ran here), 146 s; api-unittest 420 OK; architecture ok; i18n 1087 strings x 4; catalog
    up to date; B18 PASS (`{"outside":[],"placeholders":[],"topics":14}`), its `evidence/2026-11-08/b-repo-b18.json` given
    back to the base's, not committed. No line a person reads was added or changed (no locale key): nothing waits for a
    native reading from stage L1.
  - Flight regression on the release of 8343ce5 (`release.json` sha 8343ce5, served by `serve-csp.mjs dist 5420`; the
    run's first line `accept-fly target: http://localhost:5420`, the GPU lock held and given back): B6, B7, B9, B10, B11,
    B12, B13, B14, B15 and B16 PASS, exit 0 (the tree dirty only by this doc and a test's header comment). The scans fly
    as before (v12-optin's run of the same items on its base): B12's crash at 8.668 m/s at the same point to the last
    digit, its control 498 contacts and no crash; B13 0 penetrations in 60 passes at 25 m/s; B15's crash the same speed and
    point (its tick later by the page's start), its log replayed in a new tab to the saved hash; B16 9.591 and 1.616 m/s^2
    (Earth, Moon); B9 the same thrust to weight to four places.
    Evidence: `evidence/2026-11-08/b-fly-*-v13-look.json`, `b-fly-summary-v13-look.json`, `v13-look-b-fly/` (the run's
    names moved beside v12-optin's `-optin` ones of the same day).

#### Stage L1, final

Done: L1-1 to L1-5, one commit each step (L1-2 in two, L1-4's collider before the look, the page frame time with L1-3).
Not pushed, nothing deployed, no SSH, never the live site; the other worktrees untouched; `packages/sonic-fpv` never
edited. Every check above ran here: Node tests in vitest, the page checks headless on local release builds served with
the enforced CSP (`serve-csp.mjs dist 5420`), the GPU lock held for every drawing run.

Left open, with the reason:

1. A page-level control of W17 (the same page run on a stage A build, v0.12's take-off hop): not run; the Node test's
   control shows v0.12's hop hitting the block at the runner's own respawn points.
2. The look's GPU time against v0.12's look with unrounded timestamps: v0.12's look was measured with stock Chrome, whose
   timestamps round to 0.066 ms here (both looks take about 0.1 ms or less of GPU per frame); the CPU comparison stands.
3. One machine only (Intel i9-7980XE, this GPU, a 30 Hz display): a weak laptop GPU or a phone was not measured. The look
   is unlit meshes, three per room and one per object part, two 256 px textures, linear fog.
4. The scan lesson (free-garden) keeps the drone's own contact (see "For the lead").
5. Stage L2: the attitude display, the sound panel, their prefs and texts, their page proofs (L2-1 to L2-5).

### Stage L2

- [ ] L2-1 (M41-24) the attitude display for low vision, only in the Fly by Sound mode (`apps/fly/src/sonic/attitude.ts`, new).
  - What the mode showed and why the owner found it unreadable (message 41: "the graphic shown now is completely unclear.
    There is no sense of the horizon, whether you climb or sink. Two black and grey parts"): in v0.12 (live) a lesson world
    was drawn as flat, untextured slabs, evenly lit (`StandardMaterial`, a diffuse colour and 0.28 of it as its own light),
    under a near-black clear colour (`LESSON_BACKGROUND` 0.02, 0.02, 0.03). hover-height, the first lesson that flies, is the
    open world: a floor and nothing else. So the view was a grey-green floor under a black field, split by the floor's far
    edge: the two parts. A flat even plane looks the same from every height and its edge stays at the screen's middle while
    the craft is level, so a climb or a sink changed nothing in the picture; no horizon line, no pitch or bank marks, no
    height scale, no sign of climbing. The only height on the page was the HUD's `ALT 0.0 m`, 15 px monospace in the bottom
    left corner. (The corridor of v0.12 shows the same flat fields: `evidence/2026-11-08/v13-look-cost-v012-look/corridor-cost-view.jpg`;
    hover-height of v0.12 was not rendered again.) L1-3 gave the rooms a checker floor and a sky (the squares shrink as the
    craft climbs); the display adds the instrument.
  - The display: a dial (a light sky over a dark ground, 9.3:1 apart; a thick horizon line, white between two black edges, so
    the white reads on the ground and the black on the sky; pitch marks every 10 degrees with their numbers, black on the sky,
    white on the ground; a bank scale on a dark bezel at 0, 10, 20, 30, 45 and 60 degrees and a sky pointer that turns with
    the horizon; the craft's yellow wings fixed in the middle), a height tape (the floor at the bottom, the room's top, from
    the world's hollow, at the top; in the open 4 m at least, growing a metre at a time; the lesson's band as a green bar with
    its two edges across the tape; the height to fly at, the package's `targetHeightM`: the next gate's centre, else the
    band's, as a cyan line; the craft as a yellow box with its height in the page's language, `1,5 m` in Polish), and a climb
    arrow from the craft's height (up or down, full length at 2 m/s, none under 0.1 m/s). Drawn on a canvas from the
    session's flight model (`attitude()`, `py` less the lesson's floor, `vy`), only when the picture changes (a tenth of a
    degree, a centimetre).
  - Shown while a lesson that flies runs (not in module 0's listening lessons, which fly nothing; not while a recording
    plays back); hidden from screen readers (`aria-hidden`), never takes a pointer, under the captions (z-index 4 and 5).
  - On paper (`tools/bench/test/sonic-panels.test.ts`): the horizon is the one the craft's camera sees: 75 attitudes (3
    headings x 5 pitches x 5 rolls) built as a body turned by a known pitch and roll, read back by sim-core's `attitude()`,
    two points of the world's horizon projected by a camera at that attitude: the display's tilt and lift agree within
    0.0001 degree (a right roll lifts the horizon's right end, a nose down lifts the horizon); control in the test: the
    roll's sign turned is caught (over 50 degrees off). The tape's places, the climb arrow's way and length. Contrast of
    every line and mark against what it lies on, dark and light page: the least 5.44:1 (the light page's band), the dial's
    9.32 to 18.42.
- [ ] L2-2 (M41-25, W14) the sound panel (`apps/fly/src/sonic/sound-panel.ts`, new): what the engine plans, never a guess.
  - A radar seen from above, the nose up: every active cue with a direction (`plan.cues`, the heading frame) at its
    direction and distance (rings at 1, 2 and 4 m, the rim 8 m), an icon and a colour per kind: wall (walls, obstacles, a
    touch), floor or ceiling, open way, target (the gate's hum and notes, the shape traces), checkpoint (and the re-centre),
    wrong way (and wrong side), praise (and the fanfare, a stage). A direction rising or falling 20 degrees or more carries
    an "above" or "below" mark; one within 25 degrees of straight up or down (the ceiling over the craft, the floor under
    it) goes to the top or bottom of the height bar. The open way's side is the plan's (`plan.freeWay.side`): the chime of a
    way above or below sounds from ahead today (its pitch says which), so the mark comes from the side; a cue whose
    direction has an elevation of its own (lane s13-elev) is marked by it with no change here. A cue without a direction
    (a touch, a checkpoint's chime, praise) shows on the craft for 1.2 s at least (a chime of 0.3 s is seen).
  - A height bar, floor to the room's top: the height tone (`plan.height.heightM`; jagged while the tone is rough, outside
    the band), the target note (`plan.height.target.heightM`), bolder for `noteS` of every `periodS`.
  - A step that plays a sound three times (M41-5; the runner's `view().playing`, held through the 1 s gaps): the sound's
    icon, its name in the glossary's words (the package's `cue.<id>.name`, four languages) and "2 of 3" over the radar.
  - On by default, in every lesson of the mode (the listening lessons too: the glossary is where a deaf pilot meets the
    sounds), hidden from screen readers (`aria-hidden`: the speech says it), never takes a pointer.
  - On paper (`sonic-panels.test.ts`): every cue the glossary names has a kind and the seven kinds are reached; the places
    (left on the left, front-right up and right, straight up on the bar's top, 45 degrees up marked above); with the real
    planner: walls-pillar 2.5 m before the pillar at 2 m/s (`safety.obstacle:front` ahead, the open way left),
    tunnel-gaps before block 1 (`plan.freeWay.side` up: the chime marked above), rings-heights (the target note at the first
    ring's height, on for `noteS` of `periodS`); control in the test: the chime from ahead with no side is not marked; every
    sound a lesson plays three times (its intro's cues) has its name in en, es, pl and ru, not by fallback. Contrast, dark
    and light page: the least 5.07:1 (the light page's praise), the dark page's 6.58 to 21.
- [ ] L2-3 the switches `soundPanel` and `attitude` (`apps/fly/src/sonic/look-prefs.ts`): in the prefs collection 'sonic'
  (`packages/prefs/src/doc.ts` `SonicState.soundPanel?`, `.attitude?`: absent means on, kept only when a boolean), so they
  travel with the settings file and need no catalogue rows; a change shows at once (the panels follow `collection.sonic`).
  Test: on by default, saved, read back by a new store on the same storage, each apart; a value that is not a boolean
  dropped. The panels' words in a namespace of their own, `packages/i18n/locales/fly/soniclook` (en, es, pl, ru; "Sounds",
  "{k} of {n}", "{v} m"), which comes with the mode's chunk like `sonic` and `sonickeys` (excluded in `apps/fly/src/i18n.ts`,
  added in `sonic/texts.ts`; test). `feature.ts`: one import and one registration line per panel.
  - Controls broken once and restored (`sonic-panels.test.ts`, each failing what it should): the roll's sign (3 tests), the
    pitch's (2), the tape upside down, the climb arrow the wrong way, a light-page colour under 4.5:1, the horizon's core
    grey (dark and light), the open way without the plan's side (2), the ceiling not on the bar, a switch not kept, the
    words in the main chunk.
- [ ] L2-4 page proofs on a release build (headless, GPU lock): the attitude display level, pitched and banked; the tape with
  the band and the climb arrow; the sound panel in walls-pillar (a wall and the open-way chime), in rings-heights (the
  target note on the height bar) and on a repeat step (icon and name); the places at several sizes, 200 % zoom and a
  phone, dark and light; contrast measured on the pictures; the frame time with both panels.
- [ ] L2-5 gates exit 0; flight regression B6-B16; the lane's status final.

## For the lead

- New prefs: none in stage L1 (the look has no setting; L2's panels will list theirs here for the spoken settings list).
- Shared code L1 touched, each change inert outside a lesson world: `packages/sim-core` (`ParamOverrides.bump`,
  `SimParams.bump`, `Sim.slide`, the contact event's normal, `lifeHeaderProblem`), `packages/collision/src/analytic.ts`
  (the whole-body shortcut, exact; only lesson worlds build an `AnalyticContactWorld`), `apps/fly/src/play/assist.ts`,
  `game.ts` (methods and a `GameSense.ceilingM` only a lesson's pilot uses), `play/lesson-pilot.ts`, `app/input.ts` (the
  pilot's `above` ray, one line), `session/index.ts` (`BuiltinWorld.overrides`). No `SIM_CORE_VERSION` bump: no trace
  without the override changes (the reference hash holds); a lesson life now carries `bump: 'slide'` in its header, so
  its configHash differs from a v0.12 one, and a v0.12 lesson log still replays with the contact it was flown with.
- Merge with v13-host's stages B and C: no file of theirs was touched (`feature.ts`, `lessons.ts`, `mode*.ts`, `bridge.ts`,
  `start-*.ts`, `entry.ts`, `sonic-session/*`, `packages/prefs/src/doc.ts` untouched). The stage registers its measuring
  switch on the page's test hook itself (`window.__gsfpv.sonicLook`, from `PrimitiveStage`'s constructor, removed on
  dispose). `evidence/latest.json` changed (the A5 rerun's tunnelling item): take the newer on a conflict.
- The scan lesson (free-garden) keeps the drone's own contact: its walls are the scan's, and the mode sets no override for
  a scan. If the owner wants the lesson bump there too, the mode would add `{ bump: 'slide' }` to the session's
  overrides while a scan lesson runs (v13-host's `mode.ts`).
- The look sets the scene's fog while a lesson world's room is on the stage and gives the scene's own back on clear and
  dispose; a lesson world's scene is now `tonemapping: 'linear'` and its clear colour the look's sky (was near black).
- Checks to keep in the release's list: `tools/bench/test/sonic-bump.test.ts` (M41-19, W17), `sonic-look.test.ts`,
  `sonic-tunnel-walls.test.ts`, `packages/sim-core/test/model-bump.test.ts`; the page benches
  `tools/bench/src/v13-look-page.ts bump | look | cost` on a local release (`SITE=http://localhost:<port>`, GPU lock).
- For stage L2: the scene the panels lie over is dark (floor relative luminance 0.007, walls 0.13, ceiling 0.03, sky 0.16);
  `v13-look-page.ts` has the page helpers (open a lesson by the keyboard, place the craft by the respawn path, decode
  a picture in a helper page) and the role paint to measure contrast; its `look` scenario's analysis takes any pair
  of pictures.

## Needs from the package

- None from stage L1. The lesson bump, the take-off in a low way and the look are the simulator's; the runner's respawn
  places (`RESPAWN_BEFORE_M` before a track point, under a block's edge in tunnel-gaps and tunnel-long) work as they are.
