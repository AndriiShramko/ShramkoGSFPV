# Train 4 integration

## Status

Car 1 (job int4-car1, work copy C:/dev/gsfpv-v13-int, branch train4 from e3201fec).

- [x] S1 the merges (car 1: the lanes whose review said SHIP when S1 reached them): 71e9f0d0 site4, 37d6c672 edit4b,
      8eaa97c5 menu4, b174107b tails4, 3e7a7c6e head4; the car 1 list is closed (a second look at the review files after
      the last merge found no new SHIP); every merged lane head is an ancestor of HEAD; pnpm install --frozen-lockfile,
      gen-catalog (everything up to date, no change) and pnpm -r typecheck (rc 0) on 3e7a7c6e
- [x] S2 the seams between car 1 lanes, the one full check, on 4707f7d2 (no source change was needed: see Seams):
      gates typecheck, api-unittest, architecture, i18n, catalog, b18, leaks PASS; vitest 5383 tests passed, 4 files
      failed only at server start (rooms-open-vote, rooms-race, rooms-socket: "rooms.py did not start"; scene-default:
      beforeAll 30 s timeout), all four start a Python server and ran beside the release build; the same four files
      alone afterwards: 4 files, 26 tests PASS; no car 1 lane touched them or apps/api/rooms. a6-reference.test.ts holds
      its hash (PASS). One release build (sha 4707f7d2, 1948 files) with the nine walls, served on :6180. Probes on it,
      evidence/2026-11-19/int4-car1/: site4-links 11/11 PASS (steps sound, soundall, band, person, lang, banner; the
      scene step needs a local API, not run), edit4b-probe 12/12 PASS (render off), menu4-first-minute 15/15 PASS,
      tails4-review-start 9/9 PASS, tails4-helper-download 12/12 PASS, head4-accept 12/12 PASS (fake camera clip, render
      off). accept-fly on http://localhost:6180: B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS (evidence b-fly-*.json).
      No picture taken: no step judged a picture.
- [x] S3 the hand-over: Deploy order, Live checks (six new read-only checks in deploy/live-checks.sh, all six FAIL on
      the live site before the release: the negative control), What the owner should try, Not verified;
      U:/Temp/gsfpv-train4/int4-car1.json written for this head. dist was already deleted after S2.

Car 2 (job int4, work copy C:/dev/gsfpv-v13-int, branch train4 on car 1's head 2716e78e and the lead's release merge
aa18f1e4 of origin/main; the lead's change of 17:50 UTC: car 2 takes the lanes whose review says SHIP, the rest is car 3).

- [x] S1 the merges: adb19dd6 ux4a, c164d5ed ux4b, fa53187d vox4, a246294a edit4a, 4383f155 edit4s, 0a1848ce edit4c,
      2540dea0 sound6 (resumed after the outage: the sound6 merge was half done; its two conflicts finished, the package
      checked out at the new pin). Car 3: gen4a (no review file, both looks), gen4b (needs gen4a). The car 2 list is
      closed. Every merged lane head is an ancestor of HEAD; pnpm -r typecheck rc 0 on 2540dea0; sonic start tests 44/44.
- [ ] S2 the seams between car 2 lanes (and with car 1), the one full check, the two failed live checks of car 1.
      Done so far: origin/main's lead note a3806503 merged; seams b3e62a93 (Messages on Shift+L), the K help line for
      Shift+H, dfeb1d03 (drag cancel closes the live tag; seam 'saved'; edit4a-camera); the two live checks' probes
      repaired (edit4b-probe step 10 on live, edit-mouse-probe d.controls through the Course menu); the window under the
      top bar on a small view (30ae9183, 56e6ed71); the probes out of date (see Seams). Release build of 56e6ed71 with the
      nine walls on :6180; every lane probe and accept-fly on it (U:/Temp/gsfpv-train4/int4/probes4.sh, logs4): edit4a 13
      and edit4c s8 failed at 844x390 with walls (the window under the bar lay over the gates and the Add list: repaired,
      the window narrows beside the bar); head4-accept and sound6-walk 11 out of date (repaired in the probes); accept-fly
      stopped at B10 on a page load timeout. Left: a new release build, the probes again, the gates once on the final tree.
- [ ] S3 the hand-over (Car 2 parts, U:/Temp/gsfpv-train4/int4.json)

## Progress

Car 1 (one line a lane, in the merge order)

- site4: merged 71e9f0d0 (review SHIP), no conflict
- ux4a: car 2 (review Verdict: HOLD when S1 reached it, and again after the last merge)
- ux4b: car 2 (review Verdict: HOLD, both looks)
- vox4: car 2 (no review file, both looks)
- gen4a: car 2 (no review file, both looks)
- gen4b: car 2, needs gen4a (review SHIP, but on a tree without gen4a planCourse is the S0 stub that uses only the seed: the level and spread buttons of the Generate dialog would change nothing)
- edit4a: car 2 (no review file, both looks)
- edit4b: merged 37d6c672 (review SHIP); one conflict, evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output): edit4b's file taken whole, S2's gates write it again; no source conflict
- edit4s: car 2 (review Verdict: HOLD, both looks)
- edit4c: car 2 (no review file, both looks)
- menu4: merged 8eaa97c5 (review SHIP); the same b-repo-b18.json add/add conflict only, menu4's file taken whole
- tails4: merged b174107b (review SHIP), no conflict
- head4: merged 3e7a7c6e (review SHIP), no conflict (adds @mediapipe/tasks-vision 1.2.3 to apps/fly and the lock)
- sound6: car 2 (no review file, both looks)

Car 2 (job int4, on top of car 1's head 2716e78e and the release merge aa18f1e4 of origin/main, fast-forward; one line a lane)

- site4: in car 1, its head is an ancestor of HEAD (no new commit)
- ux4a: merged adb19dd6 (review SHIP); only generated files conflicted (README.md, llms.txt, apps/site/public/llms.txt, docs/settings.md): ours, then gen-catalog; pnpm -r typecheck rc 0
- ux4b: merged c164d5ed (review SHIP), no conflict
- vox4: merged fa53187d (review SHIP), no conflict
- edit4a: merged a246294a (review SHIP); source conflicts with edit4b in apps/fly/src/app/builtin/course.ts and course/editor/texts.ts: edit4b's seam calls kept (pointAt on a wrong gate, TopBar fly/menu, SeamBus, emptyWaits, keyRoute), edit4a's rules kept (no aim/framedId/reframe, no tool switch on the gate bar, TOOLS keys gone, Esc during a drag returns first); edit4b's three framedId lines removed with the variable. pnpm -r typecheck rc 0. Seam breaks found by the tests, for S2: Shift+H bound to ux4a messages.open and head4 sonic.headCentre (keymap, app-keys tests); edit4a-camera counts edit4b's frameSelection provider (point.ts arrowPressed) as a second frameSel()
- edit4s: merged 4383f155 (review SHIP); edit4s was built without S0, so course.ts conflicted in 8 places with edit4b/edit4a: both sides kept and joined: the DraftKeeper is made after bus.emit('opened') and disposed before bus 'closed'; a restored draft also emits changed 'restore'; edit4s's regen command dropped (edit4b has no regen key: G is the Course menu's Generate, the seam's generate now calls keeper.beforeLoss('generate')); startNew calls keeper.beforeLoss('new'); the seam's applyEdit uses markChanged(by); pointAtWrong carries edit4b's empty-course words and refusedSave sends an empty course there; trackNow is nullable, the seam's trackNow throws when closed; saveFailed points at the gate by the seam's pointAt (edit4a: no aim); the probe hook edit4 = edit4b's parts plus s (keeper, save, fix). pnpm -r typecheck rc 0; editor tests 200/201 (the edit4a-camera seam above). Found for S2: no one emits the seam event 'saved' (life.ts listens: changedSinceSave stays true after a save)
- edit4c: merged 0a1848ce (review SHIP); conflicts in course.ts (imports; the bars: edit4b's TopBar and seam kept, edit4c's AddChooser, LiveWarnings and WarnBar made after them, its old GateBar/TopBar lines dropped; the probe hook has warn and add beside edit4; Esc: a drag first, then edit4b's keyRoute, then edit4c's escTarget question/adding) and course/view.ts (PAINT keeps flash and warn); placePiece uses markChanged('piece') and emits changed 'piece'. pnpm -r typecheck rc 0; editor and tracks tests 356/357 (the same edit4a-camera seam)
- gen4a: car 3 (no review file when S1 reached it)
- gen4b: car 3, needs gen4a (review SHIP, but without gen4a its level and spread buttons change nothing)
- sound6: merged 2540dea0 (review SHIP); conflicts: evidence/2026-11-19/b-repo-b18.json (add/add, a gate's output: ours, the gates write it again) and tools/bench/test/sonic-start-screen.test.ts (both kept: head4's rig and row test, sound6's path option, noWebAudio and S4 tests; settings count 18 = 17 + head4's row, sound6 adds no setting); the package pin moves 293ebaea -> 53a56759 (fetched from sound6's copy; not yet on the package's main)

## Seams

Car 1

The seams the integration prompt names (gen4b's Generate dialog in edit4b's editor, gen4b to gen4a, ux4a's message
service, edit4a's drag event to edit4c, the head4 and sound6 rows in the sound start screen) each have one side in car 2,
so they are car 2's to make real. Where car 1 lanes meet:
- menu4, tails4 and head4 all change packages/prefs (menu4: levels in defs; tails4: migrate.ts MACHINE_LOCAL_KEYS; head4:
  doc.ts SonicState.headTrack, keymap.ts Shift+H): merged without conflict. head4's headTrack is a field of the sonic
  collection, not a schema setting, so menu4's level table (levels.test.ts: every def has a level) needs no entry; head4
  adds no storage key, so tails4's every-key classification test holds. Proof: vitest on the merged tree.
- edit4b (KeyG removed), head4 (Shift+H) and menu4 (the generated catalogue): gen-catalog --check PASS on the merged
  tree, so docs/settings.md, llms.txt and features.json already agree with all three.
- edit4b, menu4 and head4 do not share a pause menu item: only menu4 changed pause.ts / menu.ts (menu-levels.ts
  PAUSE_LEVELS lists today's items; an unknown id falls to expert).
- For car 2: edit4b's seam.ts is the design's contract plus flashGate; parts/life-ask.ts askFirst is to be swapped for
  gen4's app/ask.ts at that merge; head4's start-screen row `sonic-head` and sound6's rows in start-screen.ts merge by
  keeping both (sonic-start-screen.test.ts counts 18 settings today); the spoken key help (sound6's mode-keys.ts) does
  not list Shift+H yet.

Car 2 (on car 1's head 2716e78e and release aa18f1e4; gen4a and gen4b are car 3, so the Generate dialog in the editor and
the dialog's options reaching gen4a's generator are car 3's seams)

- ux4a's message service x head4 (car 1): both bound Shift+H (messages.open always, sonic.headCentre on ?sonic= pages): the
  keymap and app-keys tests failed after the ux4a merge. head4's key is live since car 1 and said by the voice, so it stays;
  Messages moved to Shift+J (J for journal). Refused on the way by the repository's own rules: Shift+M (M is keyboard
  flying's shared key), Shift+L (rooms RV-1: a pilot holding Shift to descend keeps L = Share and O = Settings), Shift+I (no
  other action may take a shifted sound-mode letter T U I Z G). Plain J is a radio's or gamepad's throttle style and Shift
  is a flying key only while the keyboard flies, so Shift+J takes nothing from anyone; it also gives H back to a pilot
  descending with Shift (plain H, the HUD). Caps come from the keymap, so the pause menu's Messages item, the top-row
  button's title and the generated catalogue (docs/settings.md, README.md, features.json) follow. Tests: keymap.test.ts
  (Shift+J opens Messages, J alone stays the throttle style, Shift+H routes nothing off the sound page and centres the head
  on it), app-keys.test.ts, rooms-review and rooms-public unchanged and passing; NEG OK against the merged keymap.
- head4 x sound6's spoken key help (mode-keys.ts KEY_HELP): K did not name Shift+H. One line sonic.say.helpHead in en es pl ru,
  said after the narrator key. sonic-head-switch.test.ts (K names it with the page's cap; off the sound page no line),
  sonic-optin.test.ts's pinned list +1; NEG OK.
- ux4a's message service x the course and the editor: real. The course's lines go through tell() with COURSE_LINE
  (progress, done, problem from 'course'); the editor's refusals go to the top bar's line and, as problems from
  'course-editor', to the Messages list; edit4s's saveFailed says through the same path. Not done (ux4a's follow-up, not a
  seam break): vox4's voxel failure and ux4b's walls failure stay in their panels' status lines, logged as plain lines.
- edit4a's gizmo drag x edit4c's warnings: the HandleDrag event's move and end reach dragTo, which asks LiveWarnings during
  the drag and on the release. A cancelled drag (Esc, a right click: edit4a A2) left the live tag beside the gate, naming a
  place the gate no longer stood at: dragCancel now ends the live check and closes the tag. int4-seams.test.ts, NEG OK.
- edit4s's save x edit4b's seam: no one emitted the seam's 'saved', so life.ts kept 'unsaved' after a save and the next loss
  question called saved gates unsaved. Both saves (mine, admin) now emit it after keeper.saved. int4-seams.test.ts, NEG OK.
- edit4a's camera rule x edit4b's arrow: edit4a-camera.test.ts counted one frameSel() in course.ts; the second is the seam's
  frameSelection, which only a click on edit4b's edge arrow asks for (the pilot's own press). The test now names both and
  that point.ts calls it once.
- head4's start-screen row x sound6's rows: merged in S1 (sonic-start-screen.test.ts keeps both, 18 settings); the gates run
  it.
- edit4b's longer top bar (car 1) x the editor window on a small view (found by edit4a's step 13 at 844x390): the bar's
  seven buttons reach past x 400, where the window began beside it, so the window covered the bar's last buttons. On a
  view narrower than 900 px or lower than 500 px the window now starts under the bar (top-bar.ts place() writes the bar's
  bottom to --ce-topbar-bottom, editor.css uses it), 30ae9183. That first version also counted the bar's own bottom for
  --ce-below, so on a low view the bar pushed itself down to mid-view and edit4c's Add list under it ran past the
  bottom (edit4c s8 at 844x390): the bar is now watched for its size only, 56e6ed71. int4-seams.test.ts, NEG OK both.
  On the build with the nine walls the Walls chip puts the bar at y 109 (train 3 I2), so the window under it began at y 167:
  over the view's middle, where Home frames the gates (edit4a 13: no gate left to click), and over the cross of edit4c's
  Add list (s8). The window now stays at the top right and narrows to the room right of the bar (--ce-beside); only with
  less than 260 px (BESIDE_MIN: a phone upright, a long language) does it start under the bar. The room is measured from
  the window's own right edge (64 px in on a low view, left of the sound button: the first try from the view's edge left
  the window where it was). The same step found edit4a's hover tag lying on the gate bar when the hovered handle is just
  above it: the tag then goes above the pointer and the bar (view-mouse.ts). int4-seams.test.ts, NEG OK.
- edit4a's overview eye x the Add click (edit-mouse c.add, two runs of three on 5bab5cce): Home and the editor's first view
  frame the course without a wall test (frame.ts frameBox), so on some random Wroclaw courses the eye stood in a tree's
  voxels; every click then hit 0.107 m from the eye and the new gate stood at the eye, lifted behind the camera plane (out
  of view). The probe now records the editor's place for c.add. A first try (pass hits nearer than 1 m) still failed one
  run in two on 29945db2: hit 1.02 m. Measured on the release's walls in Node along both failing rays: scan on 5 and 6 of
  the eye's 6 axes within 0.75 m, leaves along the ray to 0.4 m and to 1.3 m, then 18.5 m and 3.3 m of free air. Now: when
  the first hit is nearer than 1 m the eye stands in the scan, and the ray goes on through it until it has crossed 1 m of
  free air (add-place.ts hitPastEye), for a gate and a piece. int4-add-eye.test.ts (both measured rays among its cases),
  NEG OK against 5bab5cce and against the first try.
- Probes out of date after a merge (the product right, the probe repaired, each with the reason in the probe): edit4s s9
  (key G no longer makes a course in the editor since edit4b: the probe takes Course, Generate a new course, Yes);
  edit4c and edit4a (since edit4a a click selects without framing and the one gizmo has a size box on each axis: edit4c
  presses F like the pilot, presses the move arrow itself, and on s2 takes Tab when a far gate's few pixels missed;
  edit4a step 11 clicks only gates that no handle of the selected gate covers); edit-mouse (the Keys table's rows press
  their key, Esc left the editor); vox4 step 3 and ux4b-cancel (tails4 moved Lublin's start onto the ground); head4-accept
  step 5 (sound6 replaced 'Start the course from the beginning' by Quick start, which the probe now clicks; also a live
  check); sound6-walk 11 (the prefs store writes 250 ms after a change: the walk now waits for the saved 'fast' as it
  already waited for 'full').
- Car 1's two failed live checks (release aa18f1e4), both the check out of date, not the product:
  - edit4b-course-life step 10-pointed: on the live site Save is never pressed, and the course of step 6 already had a
    problem (gate 1 in a wall), so the step tried nothing (how: [], the 'pointed' it read was step 9's). The probe now,
    on live only, undoes gates until no gate has a problem, then makes the problem the step judges (711f2520).
  - edit-mouse-wroclaw d.controls: 'courses' and 'keys' were 'not on screen' because edit4b (car 1) moved Courses and Keys
    into the top bar's Course menu; the probe now opens Course and presses the item, the pilot's path (711f2520).

## Deploy order

Car 1 (from the merged lanes' 'For the lead' and `git diff origin/main HEAD -- apps/api deploy packages/sonic-fpv`)

1. The sound package: nothing. The pin of packages/sonic-fpv is unchanged (293ebaea, the one origin/main has); sound6 is
   in car 2.
2. The page: one release of this head (apps/fly, the site with its scene templates, the generated catalogue). The build
   fetches MediaPipe's face model once from storage.googleapis.com (head4; cached in node_modules/.cache/gsfpv-headtrack,
   checked by sha256), so the build machine needs the network the first time. The release gains /fly/headtrack/ (about
   18.9 MB unpacked, 8 MB over the wire, downloaded only when a pilot turns "Turn my head to listen" on).
3. The API files: none. apps/api changes only in a test (apps/api/tests/test_nginx_routes.py); server.py is unchanged.
   The scene pages' fix (site4) is in the release folder's scene-templates, which the running API already reads.
4. Rooms: no (nothing under apps/api/rooms changed).
5. nginx: yes, after the page: upload deploy/nginx.conf, `nginx -t`, reload. One line changes, in
   `location ~ ^/(en|es|pl|ru)/fly/` only: Permissions-Policy camera=(self) (every other location keeps camera=()). The
   page alone works (the camera is refused, the setting says so and turns off); nginx alone is harmless.
6. Walls: no new walls; deploy/release-walls.sh need not run.

## Live checks

Car 1. After the release and the nginx reload: `LIVE_ONLY=<names> bash deploy/live-checks.sh <outdir>` with the names
below; the whole file after that as usual.

New in deploy/live-checks.sh (read-only, each honours LIVE_ONLY, a failed probe exits non-zero and FAILs its line):
- site4-links: site4-links.mjs, every main button of the sound, home, scene and supporter pages (13 steps on the live site)
- edit4b-course-life: edit4b-probe.mjs on 70b50d42, render off, under the GPU lock (Save is never pressed)
- menu4-first-minute: menu4-first-minute-probe.mjs, the first visit's question and the short menus
- tails4-start-moved: tails4-review-start.mjs, the moved starts of 2f1ddf5f, d10c5638, ab5efa0e
- head4-camera-headers: two HEAD requests, /en/fly/ has camera=(self), /en/privacy/ camera=()
- head4-accept: head4-accept.mjs with the fake camera clip HEAD4_CLIP (default U:/Temp/gsfpv-train4/head4/head4-clip.mjpeg)

Existing names that cover what changed: accept-fly (head4's Shift+H and tails4's start touch the keys and the session),
edit-mouse-wroclaw and edit-mode-wroclaw (edit4b changed the top bar and removed key G in the editor), sonic-in-place-tunis
and sonic-course-wroclaw (head4's start-screen row and SonicSetup.head), mouse-free-probe (menu4's pause menu).

Left out on purpose: tails4-helper-download.mjs (it fakes a USB device and rewrites the helper's socket; the file already
leaves connect-probe.mjs out for the same reason; the lane proved it locally, S2 again on the release build: PASS).

Negative control before the release, on 833acb8f against the live site (release 89c9c86e, the code before train 4):
`LIVE_ONLY=site4-links,edit4b-course-life,menu4-first-minute,tails4-start-moved,head4-camera-headers,head4-accept bash
deploy/live-checks.sh U:/Temp/gsfpv-train4/int4/live-neg`: all six FAIL, LIVE CHECKS: FAIL, exit 1, each on the steps its
lane repairs (evidence/2026-11-19/int4-car1/live-neg.json): site4-links 12 of 12 steps fail; edit4b-course-life 10 of 12;
menu4-first-minute 10 of 15; tails4-start-moved 3 of 9 (the three spawnOverGround); head4-accept 10 of 12 (offLoadsNothing
and otherPageRefuses pass, as on the lane's own live control); head4-camera-headers: /en/fly/ has camera=() today.
The lanes' own runs on the release build of 4707f7d2 (S2) gave the PASS side of the same probes.

## What the owner should try

Car 1, in the order of his messages (tails4: train 2's leftovers; menu4: brief line 373; head4: the head tracking plan;
site4: brief lines 533-536; edit4b: brief lines 541-556). No person, phone, camera or controller took part in any check.

1. The start of three scans (tails4). Open the scans 2f1ddf5f, d10c5638 and ab5efa0e: the drone stands about 1.5 m over
   the ground in the scan instead of hanging high in empty air. On the Controls screen, the helper's two download links
   save files that run.
2. The menu for new pilots (menu4). In a fresh browser profile (or after clearing the site's data) open the flight page:
   "Before you fly" asks "Have you flown FPV before?" with three answers. Click "Never. Keep it simple", answer the cookie
   question, click Keyboard, Start flying, click into the scene. Key P: 9 items and a line "More (18)"; click it, the rest
   opens. Click Settings: 11 rows and "Show all settings (67 more)"; type "uptilt" in the search: the camera uptilt row
   shows, marked "In the full menu". Later: Settings, Display, first row "Menu": Simple / Sim pilot / Everything. A pilot
   who visited before is never asked and keeps the full menus.
3. Turn my head to listen (head4). Headphones on, a web camera. Open /en/fly/?sonic=start, Settings, tick "Turn my head
   to listen": the voice explains first, then the browser asks for the camera: Allow. Start a lesson, face the screen,
   key Shift+H: "Centred." Turn your head: a sound ahead of the drone stays where it is in the room. Untick it: "Head
   tracking off. The camera is closed." and the camera's light goes out. Block instead of Allow: the voice says how to
   allow it by the icon left of the address.
4. The site's main buttons (site4). /en/sound/: the top menu's button says "Fly by Sound" and opens the Fly by Sound
   start; the same on /pl/, /es/, /ru/. On the phone /en/sound/ has a bar at the bottom with that button. The home page's
   Fly by Sound band has "Start Fly by Sound". A scene page (/en/scenes/39e63ce9/) or a supporter's page: the menu's
   button flies that scene. /en/sound/#sound-keys, "pl" in the menu: the Polish page at the same place.
5. The course's life in the editor (edit4b). A scan, Keyboard, click into the scene, take off, Shift+G, Shift+B. Every
   gate carries its number. Course on the top bar: New empty course, Delete all gates, Generate a new course, Overview,
   Courses, Keys. Delete all gates asks first; Yes, then Undo brings them back. New empty course: Add gate is on, two
   clicks on the floor give gates 1 and 2. Fly the course flies at once; the same button, Back to editing, returns. A
   refused Save that names a gate selects that gate, its number flashes 3 times, the view does not turn. Key G no longer
   makes a course in the editor (Course, Generate a new course does, with a question).

## Not verified

Car 1
- No person, phone, real web camera or real controller took part: head tracking was proven with Chrome's fake camera
  playing a clip of a still portrait (head4), the phone steps at phone sizes in headless Chrome only.
- The seams with car 2 lanes (gen4b's Generate dialog in the editor, ux4a's message service, edit4a's drag to edit4c's
  warnings, sound6's rows beside head4's in the sound start screen, Shift+H in the spoken key help) are car 2's.
- site4's 'scene' step needs an API; S2 ran it nowhere (the local build had no API); the live check runs it after the
  release.
- The positive side of the six new live checks waits for the release; before it only their negative side ran (below).
- Found by menu4, not repaired (not car 1's files): at 1536x730 the pause panel's rows stand above the item list, so
  even the 9 items of level first start near the bottom of the view; on a first visit the cookie question lies over the
  lower middle of the page.
- tails4's open product questions: the SuperSplat tab's filters, the rooms nickname and the best laps stay per browser
  (no schema setting carries them in an exported file): a decision for the lead.
- head4: the .wasm under /fly/headtrack/ has no hash in its name but an immutable cache; a later MediaPipe version must
  move the folder (HEAD_ASSET_DIR), not overwrite the file.

## Cost notes

- S1 (car 1): about 20 replies; the most went to deciding whether gen4b stands without gen4a (its status file and the
  plan.ts stub). Cheaper: a one-line 'needs: <lane>' field in each lane's status head, and gate B18 writing its evidence
  under the lane's own folder so that every merge does not meet the same add/add conflict in b-repo-b18.json.
- S2 (car 1): about 25 replies; the most went to the vitest gate failing on four server-start tests because the release
  build ran beside it. Cheaper: run the build after the gates, never at the same time; and give each probe a common
  JSON verdict shape (pass, steps[]) so one line reads them all.
- S3 (car 1): about 25 replies; the most went to collecting each probe's arguments and read-only claim from its header and
  to reading four verdict shapes (steps as an array, as a map of PASS/FAIL, with or without pass). Cheaper: each lane
  writing its live check as the ready live-checks.sh line in 'For the lead', and the common verdict shape noted for S2.

- S1 (car 2, resumed run): 12 replies; most went to the sound6 merge's package pin, whose commit existed only in sound6's
  copy (fetched from there). Cheaper: the lane writing its package head and where it lives into 'For the lead'.
