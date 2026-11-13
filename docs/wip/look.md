# Lane look (train 1C): what a second pilot sees

Worktree C:/dev/gsfpv-rooms, branch look from origin/main bbc9e75e. Ports 5600-5619 (the rooms rig of rooms-serve.ts picks free ports itself).

## Status

- [x] L1.1 Reproduced locally (a0d74980 + this commit): `tools/bench/src/rooms-shot-live.ts` local mode (LOOK=before|after, no SITE) on a release of bbc9e75e; U:/Temp/gsfpv-train1c/shots/look-before-start.png shows a flat grey box across the middle of B's view.
- [x] L1.2 Distance table (below), evidence/2026-11-13/train1c/rooms-look-before.json.
- [x] L1.3 Near rule `nearAlpha` in apps/fly/src/rooms/remote-stage.ts (NEAR_HIDE_M 0.4, fade 0.2 m), tags.ts uses it; a paused pilot is not drawn grey (interp.ts).
- [~] L1.4 Model: body, two diagonal arms, four light rotor discs, light nose; per-drone materials for the fade. Proof pictures on the after-release: left.
- [~] L1.5 Unit test tools/bench/test/rooms-look.test.ts (5 tests pass; negative control NEG OK with old tags.ts + interp.ts: 3 fail by assertion). rooms-two-page nearHidden/tagAtDistance: left.

## Notes

Why grey: a paused pilot (start screen, menu, or the probe's pause) sends the same tick again; RemoteTrack treated a pose older
than the 250 ms extrapolation as a lost connection (frozen, grey). Why flat and across the view: at one start point B's camera
sits inside A's drone; the arms (1 cm thick, 25 cm long) and the nose box are seen edge-on from a few cm.

Distance table, old code (release bbc9e75e), scene 39e63ce9, B paused 0.05 m over the start looking level at yaw 105 deg (8.72 m
free by the voxel ray), A placed d m along B's view, turned 135 deg; share = box of the pixels that differ (level 40) from the same
view with A behind B (tags hidden in both), over 1280x800; the noise control (two reference shots) differed in 0 pixels.

| d (m) | share of view | pixels | note |
|---|---|---|---|
| 0 | 0 (camera inside the model: faces culled) | 0 | at the real start the nose box shows: grey square about 220x170 px (3.7 %) |
| 0.25 | 0.0672 | 19073 | grey arm and body across the middle |
| 0.5 | 0.0129 | 4384 | |
| 1 | 0.0031 | 1069 | |
| 2 | 0.0007 | 315 | grey sliver, hard to see |
| 4 | 0.0002 | 77 | |
| 8 | 0 | 22 | invisible grey |

Threshold: blocking = a box over 2 % of the view (wider than a seventh of the view across its middle); share ~ 0.0032 / d^2 from
the table gives 2 % at 0.4 m, so NEAR_HIDE_M = 0.4 and a fade band of 0.2 m (whole at 0.6 m, about 0.9 %).

## Cost notes
