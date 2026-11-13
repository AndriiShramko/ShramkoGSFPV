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

## For the lead

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

## Cost notes
