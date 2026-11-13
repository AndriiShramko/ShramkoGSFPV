# Lane look (train 1C): what a second pilot sees

Worktree C:/dev/gsfpv-rooms, branch look from origin/main bbc9e75e. Ports 5600-5619 (the rooms rig of rooms-serve.ts picks free ports itself).

## Status

- [x] L1.1 Reproduced locally (a0d74980 + this commit): `tools/bench/src/rooms-shot-live.ts` local mode (LOOK=before|after, no SITE) on a release of bbc9e75e; U:/Temp/gsfpv-train1c/shots/look-before-start.png shows a flat grey box across the middle of B's view.
- [x] L1.2 Distance table (below), evidence/2026-11-13/train1c/rooms-look-before.json.
- [x] L1.3 Near rule `nearAlpha` in apps/fly/src/rooms/remote-stage.ts (98bbe062, retuned 67169a7e: NEAR_HIDE_M 0.6 m from the after table, fade band 0.2 m an estimate); tags.ts uses the same function; a paused pilot is not drawn grey (interp.ts). Hook field rooms.drawn (slot, distM, alpha, box, share) for the probes.
- [x] L1.4 Model (98bbe062, 67169a7e): dark slot-coloured body and two diagonal arms, four light rotor discs (0.127 m) over the motors (0.25 m diagonal), light nose on -z, rotated by the remote's quaternion; per-drone materials for the fade. Proof pictures (d9a34993 probe): U:/Temp/gsfpv-train1c/shots/look-after-start.png, look-remote-2m.png, look-remote-4m.png, look-remote-8m.png.
- [x] L1.5 Unit test tools/bench/test/rooms-look.test.ts (5 passed; negative control NEG OK with origin/main tags.ts + interp.ts: 3 of 5 fail, AssertionError). rooms-two-page.ts nearHidden + tagAtDistance (6e8aa418, 64c7cd36): 17 of 17 checks pass on the local release 67169a7e, evidence/2026-11-13/train1c/rooms-two-page.json.
- [x] L2.1 (ba68ff3d) Course hint vs lap block (TR-11): apps/fly/src/course/hud.ts watches the flash note (#ui class/style, the note's
  text and hidden) and sets --course-push from course/note-slot.ts pushUnderNote (block top >= note bottom + 6 px, held until a
  resize); hud.css adds it to the fixed slot. Unit test tools/bench/test/course-hud-note.test.ts 3 passed.
- [x] L2.2 (ba68ff3d, ccbaa0a2) tracks-page.ts hintClearOfTimer (all four languages, 1920x1080, 1366x768, 844x390 as a touch phone; HINT_ONLY=1 runs it alone).
- [x] L2.2 negative control: release built with origin/main hud.ts + hud.css (bbc9e75e), HINT_ONLY=1 tracks-page: FAIL, 6 of 12
  meet (en, pl, ru at 1366x768 and 844x390: note 86..135.7 px, lap block from 120 px; 1920x1080 clear, note 44..93.7; es clear,
  its hint is one line, 31 px). evidence/2026-11-13/train1c/tracks-page-hint-origin-main.json.
- [x] L2.3 U:/Temp/gsfpv-train1c/shots/look-course-1920.png, -1366.png, -844.png (en, the tallest hint: en, pl, ru 50 px, es 31 px).
  1920: hint 44..93.7 px, lap block from 120 (no push). 1366 and 844 (note under the buttons): hint ends 135.7, block from 142.
- [x] L2.4 full tracks-page on the local release of ccbaa0a2: 19/19 checks pass, hintClearOfTimer 12 of 12 clear; evidence/2026-11-13/train1c/tracks-page.json.
- [x] Fix LK-1 (a2cb31e8; major, stands: .course-hud is position absolute, H hides it by CSS only, the .hud-note stays up under
  hud-off): course/hud.ts clearNote returns when the block has no offsetParent; note-slot.ts pushUnderNote holds the push for a
  block box of zero height. Unit test course-hud-note.test.ts 4 passed; negative control NEG OK (old note-slot.ts: the LK-1 case
  fails by an assertion). tracks-page hintClearOfTimer presses H twice and requires the block's top unchanged within 1 px.
- [x] Fix LK-2 (c6c873c4; minor, stands): remote-stage.ts show() keeps distM and alpha on the drone and builds no boxes and no
  drawn list per frame; rooms.drawn is a getter (Object.defineProperty, enumerable, configurable) set once per hook object,
  deleted in dispose(). No unit test (RemoteStage needs a PlayCanvas app); the rooms-two-page probe reads drawn.
- [x] Fix LK-3 (a2cb31e8 + this commit; minor, stands): first-tuning lines marked replaced, A pitched nose down instead of level,
  the 0.2 m fade band called an estimate. Typecheck apps/fly and tools/bench clean.
- [ ] Fixes probes: local release of the fixes, tracks-page HINT_ONLY=1 and rooms-two-page.

## Notes

Why grey: a paused pilot (start screen, menu, or the probe's pause) sends the same tick again; RemoteTrack treated a pose older
than the 250 ms extrapolation as a lost connection (frozen, grey). Why flat and across the view: at one start point B's camera
sits inside A's drone; the arms (1 cm thick, 25 cm long) and the nose box are seen edge-on from a few cm.

Distance table, old code (release bbc9e75e), scene 39e63ce9, B paused 0.05 m over the start looking level at yaw 105 deg (8.72 m
free by the voxel ray), A placed d m along B's view with B's body attitude (pitched nose down by the camera uptilt, not level; review LK-3) turned 135 deg; share = box of the pixels that differ (level 40) from the same
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
Replaced (review LK-3): that first tuning was on the old model; the code now has NEAR_HIDE_M 0.6 and NEAR_FADE_M 0.2, so a drone
is whole at 0.8 m (from the after table below). The 0.2 m fade band is an estimate in both tunings, not measured.

After (release 67169a7e, the new model, same view; A pitched nose down by the camera uptilt, turned 135 deg), evidence/2026-11-13/train1c/rooms-look-after.json:

| d (m) | share (pixels) | share (hook rooms.drawn, 3D box) | alpha | tag |
|---|---|---|---|---|
| 0 | 0 | 1 (camera inside) | 0 | none |
| 0.25 | 0 | 0.354 | 0 | none |
| 0.5 | 0 | 0.053 | 0 | none |
| 1 | 0.0069 | 0.0111 | 1 | Pilot-nnnn, inside the view |
| 2 | 0.0016 | 0.0026 | 1 | yes |
| 4 | 0.0004 | 0.0006 | 1 | yes |
| 8 | 0.0001 | 0.0002 | 1 | yes |

The new model's box is about twice the old one's (rotor discs): share ~ 0.0069 / d^2, 2 % at 0.59 m, hence NEAR_HIDE_M 0.6.
What the pictures show: start: no drone, no tag, nothing across the view (before: a grey square in the middle). 2 m (A pitched
25 deg nose down): a dark red X with four pink rotor discs under the tag, reads as a quad, about 60 px. 4 m: a red and pink spot of
about 30 px under the tag. 8 m: a few pixels under the tag; the tag is what finds it (true scale of a 5-inch quad at 8 m).

## Cost notes
- Most turns: finding a free 8 m line of sight in the small scan (camera inside the ceiling, then the voxel ray search) and the fresh-release rebuilds; a ready probe hook that sets a remote pose at a camera-relative distance would have saved about 6 turns.
- L2: most turns went to waiting for the GPU lock (6 x 20 s) and one probe run lost to esbuild __name in page.evaluate; a shared helper for reading element boxes in the page would have saved a full rebuild-free rerun.
