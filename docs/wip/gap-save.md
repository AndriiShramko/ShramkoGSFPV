# Lane gap-save (train 4, gap lane; plan t6-gaps-plan.md Part B item 2)

The pilot gets: a course made or built at any Scene size (x15, x100, x0.1) saves under his name. Owner's words: brief
line 559 (saving a generated course must simply work) and 537-539 (he enlarges scenes x15).

## Status

- [x] S1 the size rule in flown metres in all three validators, one shared test table run against the package
      validator, server.ts and tracks.py, each with NEG against 2d752fcc (package: against its pin 53a5675).
      Main repo: the commit that adds this line; package branch gap-save head 7f20f89f6e7b60c61906439dd91d278399578282.
- [x] S2 the acceptance: tools/bench/scripts/gap-save-accept.mjs (local API as edit4s-probe.mjs starts it; release build;
      mouse at 1536x730, device scale 1.25): whoop, Scene size x15 by the page's control, 'New empty course', three gates
      by clicks, Save as 'gap-save x15': page says saved, GET /api/tracks lists it; the same at x100; 5 inch at x1 saves.
      NEG: the same probe on a build of 2d752fcc fails the x15 step. Commits 8d66d8ad, 6af800cd, the probe's last commit
      and the commit that adds this line. Result: every step PASS but x100 (FAIL, outside this lane: the page lays no
      course at x100 on this scan, so the editor does not open; see For the lead); NEG fires on s15small.

Design differences (the code wins):
- packages/tracks/src/format.ts holds no copy of the gate-size rule: its course format checks gates through the
  package's validateTrack. Its own 0.01-100 rule is for obstacle objects (pillars, boxes), not gates, and no save path
  in apps/fly uses validateCourse; not changed.
- The generator and the editor round a gate's scene-unit sizes to 0.001 (r3 in generate.ts, editor.ts): at x100 a
  whoop's 0.028 m bar is 0.00028 scene units and rounds to 0, which the format refuses at any rule. See For the lead.
- On this tree (car 2, before gen4a) the generator and the editor's new gate make 1.5 m gates whatever the drone, so at
  x15 they are 0.1 scene units and the OLD rule passes them: the probe's step that fails on the old code is the whoop
  pilot's smallest gates (key Minus to the editor's 0.5 m minimum, 0.039 scene units), s15small.

## What the owner does

1. Opens a scene, key P, Drone, the Meteor65 card's Fly; key P again, drags the Scene size slider to x15, key P.
2. Shift+B opens the editor. Course on the top bar, Generate a new course (or New empty course, Start empty; Add gate;
   a click into the scene for each gate, key W walks the view on). Key Minus makes the selected gate smaller, down to
   0.5 m.
3. Opens the editor's window, types the course title and his name, presses Save (and Correct when the page offers small
   corrections): the top line says 'Saved as your course: <title>, version 1. It is in Courses on the top bar'.
   Before this lane a whoop course with 0.5 m gates at x15 got 'The site did not take the course (invalid:
   gates[0].shape.side: must be at least 0.05, got 0.039 ...)', because a gate's size was checked in scene units.

## Claims

1. The sound package's validateTrack checks a gate's opening (0.05-100 m) and bar or tube (0.005-10 m) in flown metres
   = scene units x transform[0] (packages/sonic-fpv/src/track/validate.ts GATE_OPENING_M, GATE_BAR_M, flownSize); the
   refusal names 'm flown'. Proof: `npx vitest run packages/sonic-fpv/test/track.test.ts` (run with the two below:
   141 passed); NEG OK against 53a5675 (x15, x100 and the refusal test fail on the old code).
2. server.ts (the page's mirror of the server) checks MAX_GATE_SIZE_M 20 in flown metres. Proof: `npx vitest run
   packages/tracks/test/size-flown.test.ts` over the shared table apps/api/tests/fixtures/track-sizes.json (20 rows:
   whoop and 5 inch at x1, 5.6, 15, 100, 0.1; refusals); NEG OK against 2d752fcc (the 3 m gate at x0.1 and the 25 m
   gate at x15 fail on the old code).
3. apps/api/tracks.py checks the same rules in flown metres (_scale, _flown_size, _shape, _bounds). Proof: `cd
   apps/api && python -m unittest discover -s tests -p "test_tracks*.py"`: 52 OK; NEG OK against 2d752fcc on
   test_tracks_sizes.py (7 failures on the old code).
4. A course stored before (scale 1) still passes: at s = 1 the flown value is the scene value itself, so every rule
   meets the same number; proof: packages/tracks/test/fixtures.test.ts and apps/api test_tracks.py test_every_fixture
   (all stored valid-*.json pass, all invalid-*.json are refused) in the runs of claims 2 and 3.
5. The max rules are scaled too (format 100 m and 10 m, server 20 m): they say how big a gate may be in the world the
   pilot flies, and unscaled they would refuse a plain 3 m gate on a scan shrunk to x0.1 (30 scene units) while letting
   a 25 m gate through on a scan enlarged x15; the table holds both rows.
6. Typecheck of both touched packages: `pnpm --filter @shramko/sonic-fpv --filter ./packages/tracks typecheck`: clean.
7. By mouse on a local release build with the local API, the courses save at every size the page reaches here, and GET
   /api/tracks?scene=70b50d42 lists each: the 5 inch's generated course at x1 ('gap-save 5in x1'), the whoop's generated
   course at x15.35 ('gap-save x15 gen', 1.5 m gates), a new empty course of three clicked gates ('gap-save x15'), and
   three clicked gates shrunk to 0.5 m flown, 0.039 scene units ('gap-save x15 small'); every save answered 201. Proof:
   `node tools/bench/scripts/gap-save-accept.mjs <dist> 70b50d42 <out.json>` -> open, x1.size, s5in.generatedSaved,
   whoop, x15.size, s15gen.generatedSaved, s15.emptySaved, s15small.whoopGatesSaved PASS; x100.size PASS (x99.73 by the
   slider), s100.emptySaved FAIL ('nothing fits': see Not verified). evidence/2026-11-19/gap-save/accept-local.json.
8. Negative control of the lane: the same probe on a build of 2d752fcc (server.ts and the package's validate.ts as they
   were, the API from `git archive 2d752fcc apps/api`, API_DIR) FAILS s15small.whoopGatesSaved: no POST, the line 'The
   site did not take the course (invalid: gates[0].shape.side: must be at least 0.05, got 0.039; ...)'; every other step
   as on the new build. evidence/2026-11-19/gap-save/accept-neg-2d752fcc.json.

## Not verified

- x100 by the page: the slider reaches x99.73, but on scan 70b50d42 the page lays no course there ('nothing fits'), and
  Shift+B opens the editor only on a course, so no course could be made at x100 by mouse (s100.emptySaved FAIL on both
  builds). The x100 rows are proved by the validators' shared table only (claims 1-3). Not this lane's files (the
  generator and the editor); see For the lead.
- Three clicked gates of the 5 inch at x1 on this scan were refused by the editor's own way checks (a wall between the
  start and gate 1), not by a size rule; the probe saves the 5 inch's generated course at x1 instead.
- The probe runs ?render=off: nothing was drawn, no picture was judged. The saving steps were run only against the local
  API: every step stores a course, so the probe refuses an https address and nothing was run against the live site.
- No person, phone or real controller took part.
- The live API's stored courses were not read: a course stored before at a scale other than 1 with a gate under 0.05 m
  flown would now be refused on load; none of the stored fixtures is such a course, and the generator never wrote one.

## For the lead

- Files changed outside the owned list: none (apps/api/tests/fixtures/track-sizes.json and test_tracks_sizes.py are
  apps/api tests of tracks).
- The sound package: branch gap-save in packages/sonic-fpv, head 7f20f89f6e7b60c61906439dd91d278399578282 (parent the
  old pin 53a5675, on no remote yet). It must reach the package's main together with car 4's package head (gap-sound
  edits other package files on its own package branch).
- Deploy order: the package head to the package's main first, then apps/api/tracks.py restarted (the server refuses a
  whoop course at x15 until it runs the new rule) BEFORE the page; then the page.
- Need (generator / editor owners: gap-gen, gap-editor): generate.ts and editor.ts round a gate's scene-unit sizes with
  r3 (0.001); at x100 a whoop's bar rounds to 0 and its side to 0.003 (0.3 m instead of 0.34 m). Round shapes to 1e-6
  (r6, as editor.ts already has) or round the flown size before dividing by the scale.
- Live checks after deploy: none that saves on the live site; S2's probe gap-save-accept.mjs is for a local build.
- Need (gap-editor): 'New empty course' keeps the transform of the course loaded before (emptyCourse in
  apps/fly/src/course/editor/parts/life-texts.ts spreads `like`; course.ts startNew keeps it) while the editor's checks
  use flownTransform(): after the pilot changes Scene size, the new course's gates are drawn at the wrong size (the
  top line said 'square, 23.0 m' for a new gate at x15 when the loaded course was made at x1) and the course is stored
  with the old scale. startNew should take the transform the pilot flies now.
- Need (gap-editor / gap-gen, the owner's no-dead-end rule): at Scene size x100 on scan 70b50d42 Shift+B makes a course
  first, the generator answers 'nothing fits', and the editor never opens, so the pilot cannot even place gates by hand
  at that size. The editor could open on an empty course when no course fits.

## Cost notes

- S1: the most replies went to finding which file holds which rule (three validators, two fixture readers that glob
  every JSON); a one-line map of the track validators in docs/agent-map.md would make it cheaper. npx needs npx.cmd
  inside neg_control.py on Windows.
- S2: the most replies went to the probe's page handles (pause menu, drone cards, the slider under a late-loading 3D
  card, the editor's way checks refusing clicked gates) and to finding that the old rule passes the default 1.5 m gates
  at x15; a shared probe helper for 'set Scene size' and 'place N gates' would make it cheaper.
