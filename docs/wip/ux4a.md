# Lane ux4a (train 4): one message service for the flight page

Design: C:/dev/.gsfpv-lanes/designs/voxux4.md, part ux4a. Owner's words: brief lines 555-556 (complaint U1: the
messages are tiny and gone before he reads them; a problem must say what it is and whom to tell).

## Status

- [x] A-1 logic + service + delegate (messages-logic.ts, ui/messages.ts, Hud.flash -> tell, fly.css, app/builtin/hud.ts reporter, locales fly/messages) - commit e217ce05 "ux4a A-1"
- [x] A-2 kinds + history + key (course.ts call sites, ui/messages-panel.ts, top.ts button, keymap.ts Shift+H, keys locales) - commit 6818d5f9 "ux4a A-2"
- [x] A-3 acceptance tools/bench/scripts/ux4a-messages-probe.mjs (render off, Wroclaw 70b50d42, mouse, 1536x730 dsf 1.25 and 844x390) - commits 9c0b9210, 1be55d00, 587d00ac, 6edf14ea, 5f5640db and the closing "ux4a A-3 (6)"

What A-3 found and repaired (each one a probe step that failed first):
- A problem written without a fix line had none: withFix gives it "If it comes again, send it to the author" (9c0b9210).
- A course worker whose script did not load was kept: the next Shift+G waited 150 s for the watchdog. It is dropped now (1be55d00).
- The flight holds the mouse (pointer lock); the pilot's Esc frees it and opens the pause menu, which covered the
  problem line and its buttons. Now a window over the flight (pause menu, a panel, Controls, the key card) keeps the
  lines waiting under it with their time stopped (MessageLog.setCovered), the pause menu has a "Messages" item, and
  opening the list takes its problems off the screen (they stay in the list with "Send to the author") (587d00ac).
- Esc did not close the Messages list: panel-head closeTop closes the highest layer and the walls menu (z 40) was it.
  The list stands at z 50 now (6edf14ea).
- At 844 px the side stack (12 px + 32vw) reached 1 px into the middle third: its width is min(30vw, 300px).

Notes on the design vs the code:
- The design's old-note test (course-hud-note.test.ts) is pure arithmetic and stays green untouched.
- Node tests mount the Hud in a fake DOM without `window`: MessageCenter.mount and render skip the window parts there.
- Hud.flash keeps its name and second argument (now unused, `_ms`); the same text twice while shown is one line.
- The top-row buttons are made in app/builtin/top.ts (not ui/top-row.ts, which only measures): the Messages button is one line there (no train-4 design owns top.ts).
- A problem is never rewritten under its key: a later progress line under the same key retires it (it stays in the list) and starts a new line.
- No DOM test of the list: the fake DOM (tools/bench/test/helpers/fake-dom.ts) has no events and one compound selector; the list is covered by the A-3 probe.
- Shift+H takes the H of a pilot descending with Shift (the trade the design names); tools/bench/test/app-keys.test.ts control now uses O for H.
- Probes that read `.hud-note` textContent now read every line of the stack joined (problems first, then newest).
- Design step 4 says the problem's own "Send to the author" opens the form; in the flight the mouse is held, so the
  pilot's path is Esc, Messages (menu item or top-row button), "Send to the author" in the list. The line's own
  button and cross work where the cursor is free (touch, no pointer lock).

Follow-up (after the merge, other lanes' files): scene-host rotation.failed, walls.ts bake.failed and the voxels
failure lines should call tell({ kind: 'problem', from, text, fix }) instead of hud.flash.

## What the owner does

1. Open https://gsfpv.flyreelstudio.eu/en/fly/?scene=70b50d42 on the laptop. Click into the scene: the mouse is
   taken for flying.
2. Press key Esc, click "Generate course" in the menu. At the top centre a line in large letters (16 px) says
   "Course: finding the free space. Step 1 of 2, 8 %..." and counts up in place: one line, not a new one each second.
3. When the course is ready the line says "Gates: N. Fly through START to start the clock..." and stays about 8 s
   (a longer line stays longer, 4 to 15 s; the pointer on a line stops its time).
4. If something goes wrong (for example the course did not come out) the line gets an amber edge, says what happened,
   "If it comes again, send it to the author", a "Send to the author" button and a 44 px cross. It stays until closed.
5. Press key Esc: the menu opens and the lines wait under it (none lies over the menu, their time stops).
   Click "Messages" in the menu (or the envelope button in the top row: it shows the count of problems not read).
   The list shows every line, newest first, with its time; a problem has "Send to the author", which opens the
   report form with the text, what to do, the feature and the scene already written. Nothing is sent until he
   presses Send in the form.
6. Key Shift+H opens and closes the list in the flight; its cross and key Esc close it. Problems seen in the list
   leave the screen.
7. On a phone on its side (844x390) the lines stand in the left third, clear of the OSD text and the top-row
   buttons, never in the middle of the view.

## Claims

1. A message stays between 4 and 15 s by its length, a problem until closed, progress lines replace in place, the
   log keeps 50, at most 3 lines on screen with problems first; a problem without a fix line gets one; under a window
   no line shows and no time runs; opening the list takes problems off the screen. Proof:
   `npx vitest run tools/bench/test/messages-logic.test.ts` - 17 passed; negative control against the commit before
   each change (`neg_control.py --ref HEAD --files apps/fly/src/messages-logic.ts`): NEG OK twice (A-3 (1), A-3 (3)).
2. Shift+H opens the Messages list and is bound once; H alone stays the HUD key; a course problem replaced by the next
   progress line stays in the list. Proof: `npx vitest run packages/prefs/test/keymap.test.ts tools/bench/test/messages-logic.test.ts`
   - passed; negative control on the A-1 commit (keymap.ts, messages-logic.ts): NEG OK (5 failed).
3. The pilot's path with the mouse passes on the local release at 1536x730 (device scale 1.25) and at 844x390: all 6
   steps at both sizes. Proof: `node tools/bench/scripts/ux4a-messages-probe.mjs http://localhost:6040/en <out.json>`
   on `node scripts/build-release.mjs` of 6edf14ea - PASS 12/12, evidence/2026-11-19/ux4a/messages-probe-local.json.
4. The same probe against the live site (the code before this train) fails the steps this lane repairs: 11 of 12 FAIL
   (step 6 passes at 1536 there; at 844 the old note stands in the middle third). Evidence
   evidence/2026-11-19/ux4a/messages-probe-live.json. On live step 4 stops at the missing Messages item, steps 1-3
   see no new line because the old page keeps the dead course worker (the A-3 (2) repair), step 5 finds no button.
5. The tests that import a changed file pass: `npx vitest run --changed origin/main` - 102 of 103 files; the one
   left, tools/bench/test/scene-default.test.ts, needs python on PATH and passes with it (19 files, 282 tests with
   packages/i18n and packages/prefs). `pnpm --filter ./apps/fly typecheck` passes.
6. The flight, the keys and the session still pass accept-fly on the local release (the keys changed in A-2):
   `cd tools/bench && SITE=http://localhost:6040 npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16`
   - first line "accept-fly target: http://localhost:6040", B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 PASS (10 of 10).
7. The repository gates pass on the staged tree: `gates.py --only typecheck,vitest,architecture,i18n,b18,leaks,catalog`
   - typecheck, architecture, i18n, catalog, b18, leaks PASS; vitest 405 of 408 files (5333 tests) passed, the 3 left
   (tools/bench/test/rooms-open-vote, rooms-race, rooms-socket: "rooms.py did not start" under the full suite's load)
   pass alone: `npx vitest run` of those 3 files - 15 passed. This lane changed no apps/api file.

## Not verified

- No person, phone or real controller took part: every check ran in headless Chrome, the mouse and keys synthesised by
  Playwright; 844x390 was a mouse at that window size, not a touch screen.
- The line's own "Send to the author" button and cross are measured (44x44, not covered) but pressed only in the list:
  in the flight the page holds the mouse, so the probe takes the pilot's Esc path.
- No picture was judged (?render=off): no screenshot was taken.
- Other languages than English were not walked; the four locale files have the same keys (i18n gate).

## For the lead

- Files changed outside the design's ux4a list: apps/fly/src/app/builtin/top.ts (one button, A-2), new
  apps/fly/src/ui/messages-panel.ts, packages/prefs/test/keymap.test.ts, tools/bench/test/app-keys.test.ts, the
  generated catalogue (README.md, llms.txt, apps/site/public/llms.txt, apps/site/src/generated/features.json,
  docs/settings.md, packages/i18n/locales/site/pl.json and ru.json), new tools/bench/scripts/ux4a-messages-probe.mjs,
  evidence/2026-11-19/ux4a/.
- course.ts (owned) changed in A-3 outside the design's call sites: the worker onerror drops the worker (1be55d00).
- fly.css: the Messages list has z-index 50 (above the walls menu, 40; below the consent card, 70).
- Deploy order: page only. No API, rooms, nginx or sound package change.
- Live checks after the deploy: `node tools/bench/scripts/ux4a-messages-probe.mjs https://gsfpv.flyreelstudio.eu/en <out.json>`
  must print pass true (12 PASS); it only generates a course inside the page and opens the report form, never sends.
- After the merge with vox4 and ux4b: their problem lines (walls bake failed, voxels failed, scene load cancel) should
  move to tell({ kind: 'problem', from, text, fix }) (follow-up list above).

## Review

Verdict: SHIP (independent check, after one repair). Full review: U:/Temp/gsfpv-train4/reviews/ux4a.md.

- Re-run: claim 1 and 2 unit tests (71 passed); negative controls with neg_control.py: keymap.ts at origin/main -> NEG OK,
  messages-logic.ts at e217ce05 -> NEG OK. Claim 3 probe on a build of this head: PASS at both sizes, plus two review steps.
- Review step 7 (what a pilot does that the lane did not walk): with the pause menu up, key Shift+H (named on its
  Messages item) opens the list at one press, Esc closes it: PASS at both sizes.
- PROVEN and repaired: in the course editor's edit mode a key that works only in flight (KeyRouter.block, editfix E4)
  was told as a problem: three keys (Shift+H, Shift+N, P) left three amber lines that never went, each with
  "If it comes again, send it to the author" and a Send button, though each line says what to press. Now
  messages-logic.ts refusal() (kind info, one key per feature: the next refusal replaces it, it goes by its reading
  time) and course.ts say(text, 'key'); save and vote failures stay problems. Test: messages-logic.test.ts "a refused
  key" (with refusal() giving kind problem it fails: 1 failed). Probe step 8: FAIL on the old build (3 lines, 3
  problems, still there after 16 s: evidence/2026-11-19/ux4a/review-probe-neg-refusal.json), PASS on the repaired
  build at both sizes (16 of 16 steps: evidence/2026-11-19/ux4a/review-probe-local.json).
- DOUBT: probe step 6 at 1536x730 failed in 2 of 5 runs: the first problem line (533..1004 px) lay over the right
  part of the top row (from 892 px) for 2-3 s with note-crowded still false; not reproduced in 3 instrumented runs.
- The live check after the deploy: the probe now has 8 steps a size and must print pass true (16 PASS).
- tools/bench/test/editfix-e4.test.ts pins the text of course.ts's key block: its regex now reads say(..., 'key').
- Gates on the staged review tree (`gates.py --only typecheck,vitest,architecture,b18,leaks`): typecheck,
  architecture, b18, leaks PASS; vitest 405 of 408 files: editfix-e4 (the pin above, then repaired) and
  rooms-race, rooms-socket ("rooms.py did not start" under the full suite's load, as in claim 7). Alone, after the
  pin's repair: `npx vitest run` of editfix-e4, messages-logic, rooms-race, rooms-socket - 34 passed. The full suite
  was not run a second time.

## Cost notes

- A-1: most replies went to finding the consumers of `.hud-note` and the fake-DOM tests that mount the Hud without a window; a list of the Node tests that mount ui/hud.ts in the design would save two runs.
- A-2: most replies went to the course.ts call sites and the keymap tables (three fixed lists in keymap.test.ts plus the Shift control in app-keys.test.ts); naming those tests in the design would save two runs.
- A-3: most replies went to the probe meeting the pointer lock (the canvas takes every click until Esc) and to Esc picking the walls menu; a design that names the pointer lock and panel-head closeTop's z rule would have saved one build and about eight replies.
- Review: most replies went to a wrong first finding (Shift+H in the edit mode is blocked on purpose by KeyRouter.block, not by dialogOpen); naming the edit mode's key block in the design would have saved one build and four replies.
