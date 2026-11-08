# v0.13 v13-host: the simulator on the v0.13 sound package (owner's message 41)

Plan: `docs/wip/v13-plan.md` (items M41-n, lanes, checks); lead: `docs/wip/v13-lead.md`. The package's merge review lists
every simulator change as W1 to W20 (`C:/dev/ShramkoSonicFPV/docs/dev/review-v0.13-merge.md`, "The simulator against
this branch" and "Wave 2: one list"); the API the host needs: the package's `docs/dev/status-v0.13-lessons.md`,
`status-v0.13-sound.md` and `status-v0.13-worlds.md`.

Worktree `C:/dev/gsfpv-v13-host`, branch `v13-host`, cut from `v03-lead` 093fbbd. The sound package is the submodule
`packages/sonic-fpv`, moved here from 1eea4d5 to 16c01a1 (the package's public `main`, v0.13): never edited here;
what the package itself must change goes under "Needs from the package".

The lane runs in three stages, one agent each: A, the simulator on the v0.13 package (gitlink, the hollow from
`world.cavities`, the simulator's Fly by Sound tests, the touched samples, the motor bus, the 28 lessons, the cost
bench); B, the lesson keys and the spoken menus (W3 to W8, W13, W15, M41-1 to M41-4, M41-7); C, the panels and the page
proofs.

## Status

### Stage A

- [x] A1 (W1, W2) the gitlink at 16c01a1; the room drawn from `world.cavities` (`apps/fly/src/sonic/primitives.ts`
  `cavityBoxes`, the mirror `corridorCavities` and the switch by generator deleted; `Cavity` is the package's
  `CavityBox`); `pnpm -r typecheck` passes with no other change (the review found the same: the app compiles against
  the package as it is)
  - `tools/bench/test/sonic-primitives.test.ts`: the 18 tunnel cases pass (6 tunnels x 3: free where `solidAt` says,
    faces on real walls, every wall a ray hits drawn); the mirrored-corridor control still fails the mirror (wrong >
    100) and the one-face-left-out control still finds rays uncovered. Control of the switch: the file as it was at
    093fbbd (the mirror) fails exactly those 18 cases (21 failures with the 3 object cases of A2).
  - tunnel-long's "every wall a ray hits has a drawn face" got 255 hits, 300 wanted, with the mirror and with the
    package's boxes alike (the hits do not depend on the faces): its bounds are 1 % free air at 0.3 m from a wall
    (102 x 4.4 x 65 m), so 20 000 draws found about 250 ray origins. The draws are now up to 200 000, still stopping
    at 1500 free origins (no other world needed more than 70 000); both assertions stand.
- [ ] A2 (W20) the simulator's Fly by Sound tests pass on the new package
- [ ] A3 (W11) `FrameSampler.take` keeps every sample with `touched`
- [ ] A4 (W12, M41-16) the mode's motor into `engine.motorInput ?? auxInput`, on by default
- [ ] A5 (W18) the start screen lists the 28 lessons by order and the fast path of 8
- [ ] A6 (W16) one run of the analytic cost benches over the new worlds, against v0.12's frame budget
- [ ] A7 full gates exit 0; stage A's status final

### Stage B

(the next agent fills this)

### Stage C

(the next agent fills this)

## Changed tests

Each changed expectation takes its value from the package; each kept control still fails.

| Test | Change | Why |
|---|---|---|
| `sonic-primitives` "every wall a ray hits has a drawn face" | up to 200 000 draws for the 1500 free ray origins (was 20 000) | tunnel-long's bounds are 1 % free air; 300 hits are still wanted, no face missed |

## Needs from the package

(none yet)
