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

Stage T3-editor-ui (page side, apps/fly/src/course/**):
- [x] U1 (04235d61) editor on the page: course/editor/keys.ts (key table of tracks-plan 2.11; arrows move by the world axis
      nearest to the view; Shift 1 m; Ctrl+Z/Y; Enter save; Esc leave, twice when unsaved), texts.ts and words.ts (a locale
      key for every refusal and problem code), panel.ts and editor.css (selected gate, problems, live region, the key table as
      buttons, name and title, "Save as my course", "Save for everyone", the scene's courses with created by / edited by
      marks and votes, "Edit" per row). builtin/course.ts: Shift+B (keymap `course.edit`) and the pause menu item open it;
      flight paused (reason 'panel'), key router blocked, every change re-proven with wallsCheck; save as kind person:
      create, fork (parent = the saved course) or new version (edit token kept in this tab only); votes. store.ts: rows of
      any integer version >= 1 (was 1 only), saveMine, vote, voterId, myVotes, rememberVote (localStorage keys
      gsfpv.course.voter, gsfpv.course.votes). hook.ts: CourseHook.editor. mouse-look.ts CURSOR_WINDOWS gains
      '.course-editor'. Locales: 81 new keys in en, es, pl, ru. Test tools/bench/test/tracks-editor-ui.test.ts (8 tests).
      Runs: that test + tracks-review + app-mouse-free: 25 passed; packages/prefs keymap + migrate: 53 passed; tsc
      apps/fly, packages/prefs, tools/bench exit 0; 0 non-ASCII bytes in 12 changed code files. Negative control
      (neg_control.py, ref origin/main, files store.ts mouse-look.ts, vitest with --root tools/bench): NEG OK, failed by
      assertion (`expected [...] to include '.course-editor'`; the log keeps only the tail, so the store tests' failures on
      the old code are not shown).
- [x] U2 (086a35d2, fadb5dec) tools/bench/src/tracks-page.ts section E (EDITOR_ONLY=1 runs it alone; the full run does it
      after C3): link seed g1.1 on 887f27aa (19 gates), Shift+B, "Save for everyone" from the window (the parent), ArrowUp
      moves gate 1, Insert adds one (first try refused 'placement', after Tab 19 -> 20), Delete back to 19, name "Probe
      Pilot" and "Save as my course" (a fork, new id, source server), the fork's row says "created by the generator" and
      "edited by Probe Pilot (pilot)", vote up ("+ 1", aria-pressed true, hook.editor.votes 1), window layout at 1920x1080
      and 844x390 (inside the view or scrolls, 23 key buttons, 0 overlapping, smallest key font 11.25 px at 844), reload and
      reopen: "+ 1" and aria-pressed true. Run 1 found a bug the checks let through (the row said "created by null
      (generator)" and "edited by Probe Pilot (generator)": the server's mark kinds are 'pilot' and 'generator' with name
      null, words.ts knew only 'person'); fixed in fadb5dec: texts.ts markParts (pure, tested), words.ts markText, store.ts
      CourseMark.name nullable, en/es kind.generator "the generator"/"el generador"; the probe now checks the exact en words.
      The window background is opaque (run 1: the HUD's Back/Controls/Pause and REC buttons read through it).
      Runs: release build exit 0; `EDITOR_ONLY=1 SONIC_PORTS=5720-5739 EVIDENCE_NAME=tracks-editor-u2 npx tsx
      src/tracks-page.ts` 12/12 checks passed (evidence/2026-11-13/tracks-editor-u2.json, not committed); vitest
      tracks-editor-ui.test.ts 9 passed; tsc apps/fly and tools/bench exit 0; 0 non-ASCII bytes in 6 changed code files.
      Negative control: neg_control.py ref origin/main, file texts.ts: NEG OK (by import, texts.ts has no markParts there);
      mutation control (markParts back to the old logic: only 'person', name passed through): 1 failed by AssertionError,
      8 passed, file restored. Screenshots U:/Temp/gsfpv-train2/shots/tracks-editor-1920.png and tracks-editor-844.png
      looked at: the keys are readable, nothing reads through the window; see For the lead for what the HUD shows.
- [ ] U3 left (not built in U1): the orbit camera around the selected gate (the drone camera stays), red drawing of a failing
      gate (view.ts has no 'bad' paint yet; problems are shown as text), pillar pairs as key 4 (key 4 is cube for now),
      Space "drop here" in flight, voting only after a completed lap (tracks-plan 2.9; offered on every row now).


Stage T4-admin (admin tab apps/fly/src/admin/tracks/**, page link):
- [x] A1 (this commit) the admin's Tracks tab ("Courses"): tracks/model.ts (pure: rows, marks, order new/votes/broken, search,
      title check 3-60, rename body, editor link, scene order), tracks/api.ts (TracksAdminClient on tracks_admin.py's 7 routes),
      tracks/tab.ts (scene picker with counts, order, search, Refresh; per row: title, id, gates, length, created, "created by" /
      "edited by" marks, votes +up/-down and broken reports, versions list, hidden note (admin or scene cap), fork origin;
      buttons Open in the editor (new tab; for a hidden course a note to show it first), Hide/Show, Rename (new version marked
      admin, the creator kept), Reset votes, Reset broken reports, Delete vN per version, Delete the course; deletes and resets
      ask "sure?" and need a second click within 6 s). main.ts: sixth tab 'tracks'. Locales admin/tracks/{en,es,pl,ru}.json
      (56 keys each); packages/i18n/test/admin-parity.test.ts namespace list gains 'tracks'.
      Page: course/link.ts serverOfLink (course=<scene>-<8 hex>) and editOfLink (edit=1); builtin/course.ts loads the linked
      served course once the scene's list and the walls are there, opens the editor when edit=1, and does NOT fall back to
      another saved course when the linked one fails (loadServer `only`); fly locale course.link.missing in en, es, pl, ru.
      Test tools/bench/test/admin-tracks.test.ts (10 tests). Runs: that test 10 passed; packages/i18n vitest 22 passed (after the
      parity list fix; 1 failed before it); tracks-editor-ui + tracks-review 17 passed; tsc apps/fly exit 0, tsc tools/bench exit
      0; 0 non-ASCII bytes in 8 changed code files. Negative control: neg_control.py ref origin/main, file course/link.ts: NEG OK
      (exit 1, old link.ts has no serverOfLink). Mutation control on model.ts (markParts shows any kind's name; rename without
      NFC): 2 of 10 failed by AssertionError, file restored.
- [x] A2 (5655f1f0 and the status commit) browser check of the tab on a local copy: tools/bench/src/tracks-admin.ts (release
      dist/ under serve-csp with the admin CSP, the real server.Handler on a temporary DATA_DIR through tracks-serve.ts, which
      gained an `apiEnv` argument; ADMIN_PASSWORD_HASH of the test password from .cache/admin-test.json, this tree's or the
      lead copy's, read only; Telegram and mail settings blanked; takes C:/dev/.gpu-lock itself). Seeds valid-basic.json (A),
      a pilot's fork of A with version 2 (B) and one vote, logs in, opens Courses: 15 checks (rows, B's marks "created by the
      generator; edited by Ann (a pilot)", versions, votes, the Open link /en/fly/?scene=39e63ce9&course=A&edit=1 target
      _blank answering 200, layout at 1920x1080 and 844x390 with 15 row buttons and 0 outside the view, hide (public list
      leaves A out) and show, rename (public v2 file has the new title, "edited by the admin"), reset votes and both deletes
      with the first click only asking, no error or outside request from the tab on). Runs 2 to 7 found two bugs, fixed in
      5655f1f0: (1) tab.ts drew the rows while busy and never again, so every button stayed disabled after the first action
      (run 2: Show disabled after Hide; now redrawn in `finally`); (2) a generated course's rename was refused by the server
      ('title: must match Course [0-9a-z-]{1,24}': a generator's file keeps that title), so renamed() writes it as a person's
      file named ADMIN_AUTHOR_NAME 'Admin' with generator null (model.ts); the server's marks still say the admin. Final run 8:
      `SONIC_PORTS=5720-5739 npx tsx src/tracks-admin.ts` 15/15 passed, exit 0 (evidence/2026-11-13/tracks-admin.json, not
      committed). Unit test tools/bench/test/admin-tracks.test.ts 11 passed (1 new); negative control neg_control.py ref HEAD
      (before the fix) file model.ts: NEG OK. The run before the tab.ts fix is that fix's negative control (run 2 failed on
      the disabled Show). tsc apps/fly and tools/bench exit 0; 0 non-ASCII bytes in 5 changed code files. Screenshots
      U:/Temp/gsfpv-train2/shots/tracks-admin-1920.png and tracks-admin-844.png, the 844 one looked at: rows, marks and
      buttons readable, the buttons wrap inside the row.
- [ ] A3 left: a page run of the admin's link (course=<id>&edit=1 loads the served course and opens the editor). Plan: in
      tools/bench/src/tracks-page.ts section E, after the fork is saved, open /en/fly/?scene=887f27aa&course=<fork id>&edit=1
      in a fresh page and wait for hook.editor open with the fork's track id (needs the scene 887f27aa with walls; the fixture
      scene 39e63ce9 gives no walls, so the admin probe cannot do it). EDITOR_ONLY=1 runs E alone (about 5 minutes).
- [ ] Left of R6-R8 after this stage: see "What the owner can do now" below.

What the owner can do now (after the release of this branch; this list replaces the older one below where they differ):
- Generate: Shift+G (or pause menu) lays a new course on a scan with walls; Shift+T shows or hides one (the scene's saved
  course first).
- Open the editor: Shift+B (or pause menu "Edit course"); the flight pauses, the take-off prompt goes, the window sits on
  the right under the top buttons (Pause, Controls, Share stay clickable).
- Select: Tab / Shift+Tab; the selected gate is magenta in the scan, a gate that fails the walls check is red (orange when
  selected), the window names the problem.
- Move: arrows on the floor plane (Shift: 1 m), PageUp / PageDown up and down, Q / E turn 15 deg; 1-4 shape, + / - size.
- Add: Insert or I (4 m ahead of the selected gate). Delete: Delete or Backspace. Undo / redo: Ctrl+Z / Ctrl+Y.
- Save his own copy: a name in the window, then "Save as my course" (or Enter): his course or a fork with "created by" /
  "edited by" marks; again later = a new version of it (the edit token stays in this browser).
- Save for everyone: "Save for everyone" stores an unchanged generated course for the scene.
- Vote: + / - on a row of the window's list, only for a course he has flown a full lap of in this browser; before that the
  row says "Fly a lap of this course to vote".
- Leave: Esc (twice with unsaved changes; inside the window the first Esc gives the focus back). F6 enters the window.
- Admin: signed in at /admin/ on the same browser, tab Courses lists every course per scene (versions, marks, votes,
  broken reports; hide/show, rename, delete a version or the course, reset votes or reports). "Open in the editor" opens
  course=<id>.v<n>&edit=1 with the editor open; there "Save as the admin's version" stores the edited gates as the next
  version, marked "edited by admin", the creator kept.

Still NOT done of R6-R8 after F1-finish: the orbit camera around the selected gate; pillar pairs (key 4 is a cube frame);
Space "drop here" in flight; the /2 format on the server (marks live in meta.json); a hidden course cannot be opened in
the editor from the admin (show it first); the vote-after-lap rule is a UI rule (tracks-plan 2.9), the server takes any
vote.

Left for the next wave (one line each):
- Orbit camera: arrows orbit the selected gate while the drone camera stays (tracks-plan 2.11); needs a camera mode in render-pc.
- Pillar pairs as `objects` of the /2 format and key 4 (the editing model has none; the /1 file cannot hold them).
- Space "drop here": a gate at the drone's pose 1 m ahead while flying with the editor armed (needs a flight-time key route).
- Server-side /2 files, and opening a hidden course in the editor from the admin (an admin read of the file route).

Older list (stage T4):
- Simulator, any scan with walls: Shift+T shows or hides a course (the scene's saved one first), Shift+G a new generated one (packages/prefs keymap.ts), Shift+B (or
  pause menu "Edit course") opens the editor over the paused flight: Tab / Shift+Tab select a gate, arrows move it on the floor
  plane (Shift: 1 m steps), PageUp/PageDown up and down, Q/E turn 15 deg, 1-4 shape (4 = cube frame), +/- size, Insert or I adds
  a gate 4 m ahead, Delete or Backspace removes one, Ctrl+Z / Ctrl+Y undo and redo, Enter saves, Esc leaves (twice with unsaved
  changes). Every change is re-proven on the scan's walls; a refused one says why. "Save as my course" (with a name) stores a
  pilot's course or a fork with "created by" / "edited by" marks; "Save for everyone" stores an unchanged generated course; the
  window lists the scene's courses with marks and +/- votes and an Edit button per row. (The key list is course/editor/keys.ts;
  read it there for the exact keys.)
- Admin /admin/, tab Courses: per scene every course with versions, marks, votes, broken reports; hide/show, rename, delete a
  version or the course, reset votes or broken reports, open a course in the editor (new tab, editor already open).
- Still NOT done of R6-R8: R6 an admin edit of the gates themselves saved as an admin version from the editor (the editor saves
  as a pilot; the admin's rename is the only admin version today; an admin edit in place needs the editor to post to
  /api/admin/tracks/<id>/versions when the admin is signed in); orbit camera and red/selected paint of a gate (T3 U3); pillar
  pairs; Space "drop here"; R7 voting only after a completed lap (offered on every row now); the /2 format on the server
  (marks live in meta.json); a hidden course cannot be opened in the editor from the admin (show it first); the admin's
  link opening the editor was not run in a browser (A3). The admin tab itself was checked in a browser on a local copy (A2).

Stage fixes (review findings TK-1..TK-12 of train 2):
- [x] F1 server: TK-8 (tracks.py vote: the address's voter kept for the course's life, VOTE_ADDR_CAP 5000 newest, an
      estimate), TK-9 (server.py page.isascii() and isdigit()), TK-11 a (create() refuses any parent of a generator body).
      Test apps/api/tests/test_tracks_fixes.py (4 tests) and test_tracks_edit.py's vote test (the next-day control now
      expects 429). Runs: test_tracks_fixes 6 OK (incl. the inherited Http test), test_tracks_edit + test_tracks 40 OK.
      Negative control neg_control.py --ref HEAD, files tracks.py server.py: NEG OK (1 failure, 2 errors).
- [x] F2 page parts with a pure test: TK-2 (store.ts siteStorage(): the storage getter read inside try, used as the
      default of voterId, myVotes, rememberVote), TK-7 (store.ts myTokens/rememberToken, localStorage key
      gsfpv.course.tokens, id -> token, newest TOKENS_KEPT = 50), TK-5 (link.ts servedOfLink reads course=<id>.v<n>;
      admin model.ts editorLink(locale, scene, id, version) and tab.ts passes r.version; course.ts loads a linked version
      directly with loadServer(-1, true, {id, version}); a link without a version still looks the id up in the list),
      TK-3 (keys.ts keyRoute: Tab and Shift+Tab pass when the focus is in the window, Esc there blurs first, Enter/Space on a
      button pass; F6 = command focus-window, panel.focusName(), new key row 'F6'), TK-12 (model.ts confirmStep and
      CONFIRM_GUARD_MS 600, an estimate; tab.ts ignores the confirming click sooner than that). Locales en/es/pl/ru: 3 new
      keys course.edit.key.window, course.edit.unsavedAgain, course.edit.nothing.
      Test tools/bench/test/tracks-fixes.test.ts (8 tests). Runs: vitest tracks-fixes + tracks-editor-ui + admin-tracks +
      tracks-review 36 passed; packages/prefs migrate.test.ts 23 passed; tsc apps/fly and tools/bench exit 0; 0 non-ASCII
      bytes in 11 changed code files (server.py's 2 are on origin/main already). Negative control neg_control.py --ref
      HEAD, files store.ts link.ts keys.ts model.ts: NEG OK (by import, `confirmStep is not a function`); mutation
      control (the 5 defaults back to globalThis.localStorage): 1 failed by `SecurityError: storage blocked`, 7 passed,
      file restored.
- [x] F3 course.ts without a unit test (the feature needs the page): TK-1 closeEdit(not quiet) puts run back to edSource
      (the course editing started from or was saved as) with its best lap; TK-4 one guard `ask()` for Esc, G and a row's
      Edit (twice when unsaved; G also waits while busy), reopenAfter = false in fail() and closeEdit(), openRow calls
      loadServer(i, true); TK-6 showEd keeps edSource's id, version, parent, author, title and generator on the edited
      gates; TK-10 'Save as my course' refuses with course.edit.nothing when nothing changed, the course is on the server
      and the title is the same; TK-11 b a person's body sends generator: null; TK-7 tokens from localStorage.
      Typecheck above.
- [x] F4 (6926fda8) page probe tracks-page.ts section E gains the TK-3 check (F6 to the name field, Tab walks the window
      with the gate kept, Esc gives the focus back with the editor open). Runs: release build exit 0 (sha 6926fda8);
      `EDITOR_ONLY=1 SONIC_PORTS=5720-5739 EVIDENCE_NAME=tracks-editor-fixes npx tsx src/tracks-page.ts` 13/13 checks
      passed (evidence/2026-11-13/tracks-editor-fixes.json, not committed; 24 key buttons, 0 overlapping at 1920x1080).
- Refuted: none of TK-1..TK-12 (each read in the code and confirmed; TK-8 is the plan's rule as written, changed as the
  review asked).

Stage F1-finish (the lane's last stage):
- [x] P1 (d83eb7e6) HUD under the editor: ui/hud.ts update() gains `panel` (flight.ts passes pause reason 'panel'): no
      take-off prompt while a window pauses the flight. editor.css: the window starts under the top-right row
      (var --top-row-bottom of ui/top-row.ts), the save row is sticky at the window's bottom edge, and on low windows
      (max-height 500 or max-width 640) the window keeps 56 px left of the lone sound button (a3a96a92). HUD files touched
      outside the lane: apps/fly/src/ui/hud.ts (one parameter, one condition), apps/fly/src/app/flight.ts (one argument).
- [x] P2 (d83eb7e6) R6/R7/R8 parts: course/editor/rules.ts (pure): editPaints (selected magenta, failing red, failing
      selected orange; colours in view.ts PAINT are design choices, not measured), badGates (a leg in a wall marks both
      ends), lappedIds/mayVote (voting only after a completed lap, tracks-plan 2.9: read from the best-lap keys
      gsfpv.course.best, no new localStorage key), adminVersionBody (the admin's version: served id, next version, person
      file under ADMIN_AUTHOR_NAME, generator null). view.ts paintEdit; panel.ts "Save as the admin's version" (shown only
      when adminHinted() and GET /api/admin/session answer, as scene-default.ts does), vote buttons disabled with "Fly a
      lap of this course to vote"; course.ts saveAdmin posts to /api/admin/tracks/<id>/versions (TracksAdminClient).
      Locales en/es/pl/ru: 4 keys (course.edit.saveAdmin, savedAdmin, adminFirst, voteAfterLap).
      Test tools/bench/test/tracks-finish.test.ts (5 tests). Runs: tracks-finish + tracks-editor-ui + tracks-fixes 22
      passed; tsc apps/fly exit 0, tsc tools/bench exit 0; 0 non-ASCII bytes in the 9 changed code files (ui/hud.ts keeps
      its 11 of origin). Negative control neg_control.py --ref HEAD, files rules.ts link.ts en.json: NEG OK (by import,
      rules.ts absent); mutation control (selected-bad dropped, lappedIds takes any key): 2 of 5 failed by AssertionError,
      file restored.
- [x] P3 (d9c6b40d, dcadd124, 4th commit) probe tracks-page.ts: E checks the empty .gate-msg, the paint, no vote before
      a lap, then a best lap written as a flown lap leaves it and the vote; at both sizes no top button under the window
      and both save buttons in view unscrolled. New E3 adminLinkFlow (A3): signs in on the local copy's /admin/ with the
      TEST password (.cache/admin-test.json of the lead copy, read only), opens course=<fork>.v1&edit=1, checks the
      served course loaded and the editor open, moves a gate, "Save as the admin's version": v2 on the server under
      'Admin', row "edited by admin". Run 1: 12/13 (the probe's Esc only returned the focus); run 2: 20/21 (844x390: the
      sound button under the window; fixed in a3a96a92).
- [x] P4 local release built at a3a96a92 (exit 0); the whole tracks-page probe once on it (hint flights, A-C3, E, E3):
      `SONIC_PORTS=5720-5739 EVIDENCE_NAME=tracks-page-finish npx tsx src/tracks-page.ts` 40/40 checks passed, exit 0
      (evidence/2026-11-13/tracks-page-finish.json, not committed; a run before it waited 9 minutes for a GPU lock held by
      another lane and stopped). apps/api: `python -m unittest discover -s apps/api/tests` 485 tests OK.
      Screenshots of that run, looked at:
      tracks-editor-1920.png: the window starts under the top row, Share, Settings, Feedback, Controls and Pause are all
      free, no take-off prompt, rows without a lap show "Fly a lap of this course to vote".
      tracks-editor-844.png: Share, Feedback, Controls, Pause and the sound button are free beside and above the window, the
      save row with both buttons sits at the window's bottom while the key table scrolls under it.
      The magenta selected gate is out of the camera's view in both shots (gate 1 is behind the drone); its paint is checked
      through the hook only.
## Decisions

- T3: the editor key is Shift+B (no flying key, no Fly by Sound letter; Shift+E would take yaw from a pilot descending with
  Shift). Key 3 is the dive turn, key 4 the cube frame (the editing model has no pillar pair). Insert also on I, Delete
  also on Backspace (laptops). "Save for everyone" stays for an unchanged generated course; a changed one is saved only
  as a pilot's course with a name (the generator's mark would be false). A vote on the same arrow again takes it back.

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

- T4: the admin's rename is a new version through POST /api/admin/tracks/<id>/versions with the latest file and the new title (no
  separate rename route: a served version's file is immutable, tracks-plan 2.6). "Open in the editor" is a link to the
  simulator page (/<lang>/fly/?scene=..&course=<id>&edit=1) in a new tab; the public list is used there, so a hidden course is
  shown first. Deletes and resets: two clicks, the server wants {confirm: true} as well.
## For the lead

- F1-finish release: site release (apps/fly page and admin); API release of the whole branch with the files relative to
  apps/api: `server.py`, `tracks.py`, `tracks_admin.py` (new module; see the note below about --compose). F1-finish itself
  changed no API file. apps/api python tests: `python -m unittest discover -s apps/api/tests` ran 485 tests OK (229.8 s).
- F1-finish touches HUD files outside the lane: apps/fly/src/ui/hud.ts (update() gains `panel`, the take-off line is empty
  while a window pauses the flight; this also hides it under the How to fly card and the feedback and drone panels, which
  pause with the same reason) and apps/fly/src/app/flight.ts (passes `this.stack.reasons.includes('panel')`). No flight,
  input or collision code: a6-reference not run.
- The page probe tracks-page.ts now starts its API with the TEST admin hash from .cache/admin-test.json (this tree, else
  the lead copy, read only) for section E3; without that file E3 fails and says why.

- T4 A2: a rename of a GENERATED course writes the file as a person's ('Admin', generator null), because the server keeps a
  generator file's title to "Course <x>"; meta.json keeps creator generator and editor admin, so lists show "created by the
  generator; edited by the admin". The admin's first tab (Scenes) loads 3 catalogue pictures from s3-eu-west-1.amazonaws.com
  (images.playcanvas.com/splat/<scene>/v1/m.webp) even after the switch to Courses; the probe lists them and does not count
  them. Release of A1+A2: the page (admin and fly) needs a site release; apps/api of T1 an API release.

- T3 U2 screenshots: (1) the HUD's "Click to fly, or press W or Space to take off" prompt stays on screen under the open
  editor (the flight is paused, so it is wrong there) and at 844x390 the window cuts it in half; the prompt is HUD code
  outside this lane: hide it while pause reason 'panel' is set. (2) The window (top right, z-index 30) covers the HUD's
  top-right buttons (share, Back, Controls, Pause) at both sizes; Esc leaves the editor, so nothing is lost, but the share
  button is half covered at 1920. (3) At 844x390 the name fields, the save buttons and the list are reached by scrolling the
  window. (4) The selected gate is not marked in the scene (U3: orbit camera and red/selected paint).
- The full tracks-page run (hint flights, A-C3, then E) was not run here (about 11 minutes plus E); EDITOR_ONLY=1 runs E alone.
  docs/agent-map.md line 64 could name EDITOR_ONLY.

- T3 U1 touches files outside apps/fly/src/course: packages/prefs/src/keymap.ts (one binding `course.edit` Shift+B, status
  shipped) and packages/prefs/test/keymap.test.ts (lane tracks' own lists TRAIN1 and SHIPPED_BY_TRACKS only);
  apps/fly/src/play/mouse-look.ts (CURSOR_WINDOWS + '.course-editor', as the task asked). No flight, input or collision
  code: a6-reference not run. store.ts now keeps rows of version 2+ (the item above is done).

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

- T4 A1: the tab was not opened in a browser (A2 left): layout, the two-click confirm, the new-tab link, every route through the
  real handler from the page. The page's course=<id>&edit=1 path was not run in a browser (only the parser is tested); whether
  the scene's list arrives after the walls on a cold load (the link waits for a refresh with walls; the session event refreshes
  again) is reasoned from the code, not observed. The es/pl/ru admin texts were not read back on the page.
- Stage fixes: a new localStorage key gsfpv.course.tokens (edit tokens, newest 50; review TK-7). The vote rule changed on
  the server (TK-8): an address keeps its voter for the course's life (was one UTC day), meta.json keeps at most 5000 address
  bindings per course (an estimate); the stale "day" field of existing meta.json files is left and no longer read. The
  admin's "Open in the editor" link is now course=<id>.v<n>&edit=1 (TK-5); old links without .v<n> still work through the
  list. After a mouse click on a window button, Tab walks the window's buttons (TK-3); Esc first returns the focus.
## Not verified

- F1-finish: the red paint of a failing gate is checked by the unit test and the hook only; no probe made a gate fail in a
  browser (the editor refuses a new wall problem, so a red gate needs a course that is already bad there). The paint colours
  were not read from pixels. The vote-after-lap rule was checked with a best lap written into localStorage, not with a
  flown lap. es, pl, ru texts of the 4 new keys were not read on the page. The admin save of a course hidden by the admin
  and the admin's "Nothing changed" refusal were not run. The take-off prompt under the How to fly card (same pause
  reason) was not looked at.

- T4 A2: the admin tab was run in English only (es, pl, ru texts not read on the page); the 1920 screenshot was not looked at
  (the 844 one was); the Open link was checked by its href and a 200 answer, not by opening the editor (A3); reset of broken
  reports and the scene picker with more than one scene were not clicked.

- Nothing on a deployed server; no browser run (server stage).
- Whether release-api.sh plus the running container pick up a NEW module (tracks_admin.py) without --compose: the script
  copies the named files; the container's view of apps/api was not read.
- The full api-unittest suite and the gates were not run (integration runs them); only the six test modules above.
- The blocklist and the allowed signs are a first guess, not measured against real pilot names.

- T2: the cost of wallsCheck per edit on a real scan (the full proof without free radii, every change) was not measured;
  the plan's "touched gate and its two legs" shortcut is not built. Only analytic rooms (test/worlds.ts) were used.
- T2: no browser run, no page; whether the sound package's future /2 matches this one is not known.

- T3 U1/U2: the browser run (U2) covers the window, ArrowUp, Insert, Delete, Tab, the fork, the marks, the vote and the
  reload. Not checked: that ArrowUp moves the gate away from the camera (forwardOf takes the body's -Z as forward; only
  "changed, not refused" is checked), the main-thread cost of wallsCheck per key press on a real scan (not timed), mouse
  clicks on the key buttons (the probe uses the keyboard and clicks only save and vote), the other three languages in the
  page, Esc twice with unsaved changes, and the full tracks-page run with E after the other sections.
- T3 U1: the full key table on a ?sonic= page was not exercised (the feature ignores Shift+B when ctx.sonic is set).
- Stage fixes: the course.ts parts TK-1 (Esc twice with changes flies the source again), TK-4 (G and a row's Edit ask
  first; no reopen after a failure), TK-6 (saved identity flown), TK-10 (nothing-changed refusal), TK-11 b (generator
  null) have no unit test and no probe check; they are read from the code and typechecked, and the probe's existing
  section E (save for everyone, edit, save as my course, vote, reload) passed 13/13 with them. Not run: a real browser
  with site storage blocked (TK-2 is tested with a throwing getter in node), the admin link with .v<n> opened in a
  browser, the admin double click in a browser (TK-12 is tested as the pure confirmStep), a reload keeping the token
  (TK-7 tested on a memory store), the other three languages' new texts on the page.

## Cost notes

- F1-finish (about 45 replies, over budget): most turns went to the Edit tool refusing edits on files only read through
  Bash (one wasted batch of 9 edits) and to three probe runs (the probe's own Esc, the lone sound button at 844x390, a GPU
  lock held by another lane for 9 minutes). Cheaper: open every file to be edited with the Read tool in the first batch;
  read fly.css's small-screen rules for the top row before placing a window at the right edge.

- T4 A2 (about 33 replies): most turns went to 8 probe runs, each finding one thing (seed body, disabled buttons, the server's
  generator title rule, the Scenes tab's pictures). Cheaper: try the admin's rename body against TrackStore in Python before the
  browser run, and have the probe print the page's status line on every wait timeout from the start.

- T4-admin A1 (about 30 replies): most turns went to reading the admin pattern, the API row shape and the course feature's
  load path before writing; two turns to non-ASCII escapes the Write tool turned into real characters in a test. Cheaper: one
  scout note with the admin tab pattern and the row shape; write test strings with \u escapes through a fix script at once;
  leave the browser probe to its own stage from the start.

- T3-editor-ui U2 (about 30 replies): the probe passed on the first run; most turns went to reading the probe and the
  course feature again and to the Edit tool's read-before-edit on files only grepped. Cheaper: Read the exact slice of
  every file to be edited in the first batch; check list texts by their exact words from the start (a loose "includes the
  name" check let "created by null" through).

- T3-editor-ui U1 (about 40 replies, over budget): most turns went to reading the course feature, keymap, mouse rule and
  API row shape, and to shell quoting (a heredoc with a large patch failed; the i18n module needs `location`, so the
  locale tables moved to texts.ts; neg_control with `bash -c` ran WSL bash and gave a false NEG OK). Cheaper: write
  patch scripts with the Write tool from the start, keep i18n-free tables in their own module, run neg_control with
  `node vitest.mjs run --root <pkg>` directly.

- T2-editor-core (about 25 replies): most turns went to the quaternion sign (a full turn writes -q; the generator's
  table writes w < 0) and a debug test whose console output vitest swallowed. Cheaper: compare rotations up to sign
  from the start; print debug values through an assertion message, not console.log.

- T1-api (about 35 replies): most turns went to the shared-fixture contract (the TS validator enforces the format's
  succession rule the Python port lacked, found only by the vitest run) and to escape sequences turning into real
  non-ASCII characters in a Python test and a heredoc (fixed with a script). Cheaper: run the TS fixture test right after
  changing fixtures; keep non-ASCII test strings in JSON fixtures written by a script; edit docs with the Edit tool only.
- Stage fixes (about 28 replies): most turns went to reading course.ts once in full and to the many small Edit calls on it;
  the first negative control against origin/main was useless (the whole lane is missing there), --ref HEAD was the right
  ref. Cheaper: give each finding's fix as a small pure helper from the start, and take --ref HEAD for a fix stage.
