# Lane tracks, train 2: edit, fork, votes, admin (branch tracks-edit)

Design: docs/wip/tracks-plan.md 2.6, 2.8, 2.9, 2.10, 2.11; requirements R6, R7, R8. Worktree C:/dev/gsfpv-rooms, ports 5720-5739.

## Status

Stage T1-api (server side):
- [x] S1 tracks.py: validator for pilot courses (author.kind person, name 2-32, title 3-60, NFC, letters/marks/digits and a
      few signs, no web address, short blocklist), 60 gates, gate at most 20 m; versions, fork with origin, authorship marks,
      votes, broken reports, admin actions in the store; tracks_admin.py; server.py routes and rates; fixtures; tests
      test_tracks_edit.py (21 new), test_tracks.py adapted. Run: 40 tests OK.
- [ ] S2 TS twin packages/tracks/src/server.ts + fixtures.test.ts; vitest of packages/tracks; typecheck.
- [ ] S3 negative control of the new tests on origin/main; docs/tracks-api.md and deploy/README.md contract rows.

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

## Not verified

- Nothing on a deployed server; no browser run (server stage).

## Cost notes
