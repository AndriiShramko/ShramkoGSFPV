# Lane tracks, train 2: edit, fork, votes, admin (branch tracks-edit)

Design: docs/wip/tracks-plan.md 2.6, 2.8, 2.9, 2.10, 2.11; requirements R6, R7, R8. Worktree C:/dev/gsfpv-rooms, ports 5720-5739.

## Status

Stage T1-api (server side):
- [x] S1 tracks.py: validator for pilot courses (author.kind person, name 2-32, title 3-60, NFC, letters/marks/digits and a
      few signs, no web address, short blocklist), 60 gates, gate at most 20 m; versions, fork with origin, authorship marks,
      votes, broken reports, admin actions in the store; tracks_admin.py; server.py routes and rates; fixtures; tests
      test_tracks_edit.py (21 new), test_tracks.py adapted. Run: 40 tests OK.
- [x] S2 TS twin packages/tracks/src/server.ts (textIssues, 60 gates, 20 m, person kind) + fixtures.test.ts; the Python port
      gained the format's succession rule (version n names n - 1 of the same id), found by the TS fixture run; version
      numbers never reused after a delete. Fixtures: 13 new or renamed (valid-person-fork, valid-person-version-2,
      valid-person-unicode, valid-version-2; invalid-author-agent, invalid-200-gates, invalid-gate-size-21,
      invalid-generator-parent, invalid-person-*). Runs: python unittest test_tracks + test_tracks_edit 40 OK; vitest
      packages/tracks 5 files 69 tests before the succession fix (1 failed, fixed), fixtures.test.ts 49 passed after;
      tsc packages/tracks exit 0.
- [x] S3 negative controls (neg_control.py, ref origin/main): test_tracks_edit on old tracks.py + server.py: NEG OK
      (5 failures, 16 errors: the errors are missing routes and methods); fixtures.test.ts on old server.ts: NEG OK
      (7 failed). docs/tracks-api.md rewritten to the new contract; deploy/README.md row updated.
- [x] S4 (5635c676) apps/api/tests/test_admin_routes.py pins the admin route set: the 7 tracks routes added. Run:
      test_admin_routes, test_nginx_tracks, test_sessions_admin, test_admin, test_tracks, test_tracks_edit: 75 tests OK.
- [ ] Left of tracks-plan 2.8 for a later stage (not built here, estimates in the plan): total store cap 200 MB (the disk
      guard stands in), a per-client read rate (nginx), honeypot and time-to-submit on create. Client side (stages T2+):
      store.ts row filter, editor, fork/vote UI, admin tab apps/fly/src/admin/tracks/**.

Stage T2-editor-core (package side, packages/tracks):
- [x] E1 packages/tracks/src/format.ts: format `shramko-sonic-track/2` (Course): version 1 keys plus origin, editedBy,
      author kind admin, path, objects (pillar, box, order null), walls; validateCourse (the version 1 part through the sound
      package's validateTrack), readCourse (reads /1 and upgrades, reads /2), upgradeTrack (optional server marks),
      toTrackV1, writeCourse, courseDigest, asSaved (new version or fork with the marks). check.ts TrackReport gains
      `outside` (ids outside the walls' grid).
- [x] E2 packages/tracks/src/editor.ts: openEditor, edit (select, select-step, move per axis in steps, turn 15 deg, dive,
      shape, size, insert 4 m ahead, delete, order, undo, redo), canSave, wallsCheck (checkTrack without free radii),
      reportProblems; refusal codes placement, min-gates, max-gates, size-min, size-max, order-edge, same,
      nothing-to-undo, nothing-to-redo. Tests test/format.test.ts (8) and test/editor.test.ts (9). Run: vitest
      packages/tracks 7 files 88 tests passed; tsc packages/tracks exit 0; ASCII check 0 non-ASCII bytes in 5 files.
- [x] E3 negative control: neg_control.py, ref origin/main, files format.ts editor.ts index.ts check.ts: NEG OK (fails on
      the old code by import: `upgradeTrack is not a function`). In-test assertion controls: the check switched off lets
      the move into the floor through; a /2 file without format refused; a fork with origin null or editedBy null refused.
- [x] E4 mutation control: the refusal line removed from editor.ts (restored with git checkout HEAD after): editor.test.ts
      2 of 9 failed by assertion (the floor move and the old-problem control), 7 passed. Restored file: clean status.
- [ ] Left for the next stages: the page editor (apps/fly/src/course/editor/**: key table of tracks-plan 2.11, orbit
      camera, red gates, live region and locales en/es/pl/ru for every refusal and problem code), save/fork through the
      API (asSaved builds the file; today's server takes /1: send toTrackV1 and keep the marks in meta.json), vote UI,
      admin tab, store.ts version filter, pillar pairs as `objects`.

## Decisions

- The /1 track file cannot hold `origin`, `editedBy` or `author.kind admin` (the sound package's validateTrack refuses
  unknown keys; the package is a submodule, not edited here). Authorship marks live in the server's meta.json per course and
  in the list rows: `creator {kind, name}`, `editor {kind, name}`, kind `generator`, `pilot` or `admin`; `origin {id, version}`.
  The file keeps `author` (this version's) and `parent` (the source). The /2 format stays with stage 4.
- The body's id, version, parent and created are replaced by the server's; a body's version is held only to the format.
  A generated course never has a parent; a pilot's may.
- created by = the origin's creator for a fork (the first creator through forks of forks); edited by = the latest version's
  author when the course is a fork or has more than one version (tracks-plan 2.6).
- Only the name the pilot typed is stored; voter ids and client addresses are kept as keyed hashes (salt.bin on the volume).
- A full scene (300 visible) hides its oldest unrated course (tracks-plan 2.8), it no longer deletes it; the admin deletes.
- TR-6: scene ids are not checked against the catalogue (tracks-plan 2.7: pilots fly scenes outside it); the removal by the
  owner is now the admin's hide and delete.
- A train-1 course (v1.json without meta.json, e.g. 887f27aa-830e1273 on the live server) is read as a generated course
  without an edit token: listed, forkable, not editable in place. The train-1 index (v 1) is rebuilt as v 2.

- T2 format: /2 is defined in packages/tracks (the sound package is a submodule, not edited here), field names of
  tracks-plan 2.6, so the sound package can adopt it as is. The generator still writes /1 (the live server and the
  determinism digests read /1); readCourse upgrades it. Required /2 keys: origin and editedBy (null without a parent);
  path, objects, walls may be absent (read as null, [], null). Rule: a parent requires origin and editedBy, no parent
  forbids both. A /1 fork upgrades with origin = its parent (author null) unless the server's marks are given.
- T2 editor: only free-space problems (outside the grid, start, gate or leg in a wall) refuse a change, and only when
  they are new (keyed by code and gate or leg ids), so a course shown red can be repaired. A gate's axis off its leg in
  (gate-direction) and a missing start only block saving (tracks-plan 2.11: save refused while any gate fails).
  Undo and redo are not re-checked for refusal. Quaternions written by the editor are rounded to 1e-6 with w >= 0.
- T2 numbers in editor.ts are the plan's key table or estimates (MOVE_STEP_M 0.1, TURN_STEP_DEG 15, SIZE_STEP_M 0.1,
  MIN_OPENING_M 0.5, INSERT_AHEAD_M 4, UNDO_MAX 200, MIN_GATES 1 = validateTrack's least); MAX_OPENING_M and the most
  gates reuse server.ts (MAX_GATE_SIZE_M 20, SERVER_MAX_GATES 60). None measured.

## For the lead

- T2-editor-core touches only packages/tracks (src/format.ts, src/editor.ts new; src/check.ts TrackReport.outside added;
  src/index.ts exports). No flight, input or collision code: a6-reference not run. No locales yet: the refusal and problem
  codes (editor.ts EditRefusal, CourseProblem) need texts in the page stage.

- apps/fly/src/course/store.ts:35 keeps only rows with `version === 1`: once a course has version 2 the live client drops it
  from the list. Change to any integer version >= 1 in the editor stage (or before the API release).

- Release of this stage: API only, `bash deploy/release-api.sh apps/api/tracks.py apps/api/tracks_admin.py apps/api/server.py`
  (tracks_admin.py is a new file: check that release-api.sh copies a new module, or use --compose). Changed in apps/api:
  tracks.py, tracks_admin.py (new), server.py, tests/test_tracks.py, tests/test_tracks_edit.py (new),
  tests/fixtures/tracks/*. No API locales changed (apps/api/locales untouched); nginx unchanged (the existing
  `location ^~ /api/tracks` already takes GET and POST on every sub-path, 64k); no nginx release needed.
- The live client (store.ts) keeps working with the new list: extra row keys are ignored, `sort=top` without votes is the
  same order as newest first, the create answer gains `editToken` (ignored).
- TR-13/TR-8: the server side is `POST /api/tracks/<id>/broken` (counted per walls digest); the page-against-Node walls
  difference itself still needs the browser run (unchanged). TR-11 and TR-14 d have no server side. TR-14 f rest (worker
  error text untranslated) is page side.

## Not verified

- Nothing on a deployed server; no browser run (server stage).
- Whether release-api.sh plus the running container pick up a NEW module (tracks_admin.py) without --compose: the script
  copies the named files; the container's view of apps/api was not read.
- The full api-unittest suite and the gates were not run (integration runs them); only the six test modules above.
- The blocklist and the allowed signs are a first guess, not measured against real pilot names.

- T2: the cost of wallsCheck per edit on a real scan (the full proof without free radii, every change) was not measured;
  the plan's "touched gate and its two legs" shortcut is not built. Only analytic rooms (test/worlds.ts) were used.
- T2: no browser run, no page; whether the sound package's future /2 matches this one is not known.

## Cost notes

- T2-editor-core (about 25 replies): most turns went to the quaternion sign (a full turn writes -q; the generator's
  table writes w < 0) and a debug test whose console output vitest swallowed. Cheaper: compare rotations up to sign
  from the start; print debug values through an assertion message, not console.log.

- T1-api (about 35 replies): most turns went to the shared-fixture contract (the TS validator enforces the format's
  succession rule the Python port lacked, found only by the vitest run) and to escape sequences turning into real
  non-ASCII characters in a Python test and a heredoc (fixed with a script). Cheaper: run the TS fixture test right after
  changing fixtures; keep non-ASCII test strings in JSON fixtures written by a script; edit docs with the Edit tool only.
