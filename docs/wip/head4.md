# Lane head4: head tracking with a web camera for Fly by Sound (train 4)

Design: docs/wip/sonic-headtrack-plan.md part 1 (1.2 to 1.4). Owner's words: the brief named in the lane prompt.
Host code: apps/fly/src/sonic/head/. The sound package (packages/sonic-fpv) is not edited by this lane.

## Status

Stages (adapted from plan 1.4; at most 4; see "Differences from the design"):

- [x] H1 head pose math in the host: HeadPose, the head's axes, the turn of the page's AudioListener (ListenerTurn), one-euro
  smoothing, centre and recentre, clamp, a lost face held 0.5 s then glided back over 0.3 s, the face matrix to yaw, pitch
  and roll. Test tools/bench/test/sonic-head-pose.test.ts (7 tests), NEG OK on origin/main. Commit 1657b1e8.
- [x] H2 the setting "Turn my head to listen" in the sound settings, OFF by default; switching it on speaks first (what the
  camera is for, that no picture leaves the computer, that the browser will ask), only then asks for the camera; the
  spoken result; the key to recentre (Shift+H); the face-lost line; the camera stops when switched off or the page is
  hidden; ListenerTurn applied per tracker result; with the setting off no head code is loaded (import('./tracking')).
  Files head/switch.ts, types.ts, tracking.ts, page.ts; tests tools/bench/test/sonic-head-switch.test.ts (13) and one row
  test in sonic-start-screen.test.ts; NEG OK on origin/main. Commit: see git log (head4 H2). Until H3 the tracker factory
  in head/page.ts rejects, so switching on says "the face tracker did not start" and turns the setting back off.
- [ ] H3 the tracker in a worker (MediaPipe Face Landmarker, wasm and model served from our own origin, frames posted as
  ImageBitmap, only three numbers come back), a headless probe with a fake camera (a video file through Chrome's
  --use-file-for-fake-video-capture via tools/bench/src/chrome.mjs): pose per frame, frame time, share of frames with a
  face, motion-to-sound delay.
- [ ] H4 deploy/nginx.conf camera=(self) on the simulator page only, the serve-csp run (the prompt path works, other pages
  refuse), the acceptance, the parts below completed, the gates.

### Differences from the design

- The plan names R as the recentre key; R is taken in the sound mode (its long press, mode.ts). Shift+H is used (H for head;
  bound nowhere, same place on QWERTY, QWERTZ, AZERTY, Polish and Spanish layouts), as Shift+V for the narrator.
- A setting left on from an earlier visit starts at load only when the browser already allows the camera (Permissions API
  'granted'); otherwise it is saved off without a word, so the page never asks at load.

- Plan H1 puts the rotation inside the sound package (headPose in SonicFrameInput, applied before pannerDirection and the
  ILD gain). This lane may not edit the package, so the host turns the AudioListener instead (the engine writes the
  listener once, at graph build, engine.ts around line 497, and never again). Limit: the package's ILD boost (near
  hazards up to 6 dB, beacon side 2 dB, line side 10 dB) still follows the craft-frame side. Written under For the lead.
- Plan H2 (an offline rig run with pnpm listen inside the package) is package work; it is replaced by the host's setting
  and switch-on flow. The lead prompt asks for a setting in the sound settings; the plan said a menu item: the prompt wins.

## What the owner does

Filled in at stage H4.

## Claims

1. A voice at bearing 30 degrees is heard straight ahead when the head turns 30 degrees right, and at 30 with the head
   straight (the listener's own view computed as the Web Audio spec does). Proof:
   `npx vitest run tools/bench/test/sonic-head-pose.test.ts`; last result 7 of 7 passed, NEG OK on origin/main.

2. "Turn my head to listen" is off by default and loads nothing; switching on says the explanation before the camera is
   asked, then the result; refusals (not allowed, no camera, busy, tracker failed) are said and turn it back off; off and a
   hidden page stop the camera; Shift+H centres or says how to turn it on; a lost face is said once with the narrator on.
   Proof: `npx vitest run tools/bench/test/sonic-head-switch.test.ts tools/bench/test/sonic-start-screen.test.ts`; last
   result 13 + 25 passed, NEG OK on origin/main.

## Not verified

- No person, no camera, no phone and no real controller took part. The signs of yaw, pitch and roll read from the face
  matrix are a reasoned guess until the H3 probe plays a recorded head turn.

## For the lead

- Files changed outside apps/fly/src/sonic/head (H2): apps/fly/src/sonic/start-screen.ts (one settings row, the last before
  the sounds' volume part: `sonic-head`; lane sound6 edits this file too: merge by keeping both), entry.ts (a `head` field
  on SonicSetup), start.ts and in-place.ts (attachHead after each `new SonicSetup`, dispose on the in-place stop),
  feature.ts (the Shift+H key), apps/fly/src/i18n.ts and sonic/texts.ts (the namespace sonichead rides the start chunk),
  packages/prefs/src/doc.ts (SonicState.headTrack, only true kept), packages/prefs/src/keymap.ts (sonic.headCentre
  Shift+H), tests packages/prefs/test/keymap.test.ts, tools/bench/test/app-keys.test.ts,
  tools/bench/test/sonic-start-screen.test.ts (settings count 17 -> 18, "Item n of 18", the STOPS list, a head stand-in).
- The spoken key help (mode-keys.ts) does not list Shift+H yet: sound6 owns that list.

- Sound package (lane sound6 or later): an optional headPose in SonicFrameInput, applied per voice before pannerDirection
  and the ILD side gain, would make the ILD boost follow the head too; the host would then pass the pose instead of
  turning the listener.

## Cost notes

- H2: the most replies went to the start screen test harness (pinned stops, a second setup, the lazy import's timing); a
  line in agent-map naming STOPS and the reload setup at line 606 beside the pinned count would have saved two runs.
- H1: the most replies went to finding where a head turn can enter without editing the package (engine.ts update and
  render); a line in the plan naming the listener as the host's only lever would have saved three reads.
