# v0.13 v13-int: the integrated branch (v13-host + v13-look + s13-elev), the engine reset, the new settings, the words

Plan: `docs/wip/v13-plan.md` (items M41-n); lead: `docs/wip/v13-lead.md`; the merged lanes: `docs/wip/v13-host.md`,
`docs/wip/v13-look.md`; the sound lane s13-elev: the sound repo's `docs/dev/status-v0.13-elev.md`.

Worktree `C:/dev/gsfpv-v13-int`, branch `v13-int`, base 8497cb4 (v03-lead cb67b0d + merge cc2a3ab of v13-host 6c164a0 +
merge 8497cb4 of v13-look 022a8d2; no conflict; gates pass on it, 3935 tests). The sound package's changes are made in the
sound worktree `C:/dev/sonic-s13-int`, branch `s13-int` (from s13-elev's head 512d7d2), committed there, and reach this
branch by moving the gitlink `packages/sonic-fpv`; nothing is edited inside `packages/sonic-fpv`. Not pushed, nothing
deployed, the live site and API never opened.

## Status

Steps 1 to 7 are this agent's; 8 to 12 belong to the next agent (the lead's prompt names them; the list below is the
lead's "Next" 5 and 6 as this branch sees them).

- [x] 1. Engine reset at a new lesson and at a seek (v13-host's need 2): `FlyBySoundEngine.reset()` and the contract's
  optional `SonicEngine.reset?()` on s13-int with a package test and its control; the host calls `engine.reset?.()`
  before a lesson's first frame and where a replay opens a lesson or seeks; `sonic-int-replay` without its settle
  window, the safety layer matched from a lesson's first frame, with a control without the call.
  - Package part: s13-int 7980fab (the sound repo's `docs/dev/status-v0.13-int.md`, I1). `test/reset.test.ts` (5
    tests; control: the same frames without `reset()` voice the held ceiling and floor sectors at 0 and 280 ms, none at
    320 ms, and keep listing the last lesson's gate note) and the audio proof `engine-reset` (the real engine in headless
    Chrome: 0 of the 18 frames of the hold with a hazard of the last lesson; control without the reset 18 of 18).
  - The simulator's part (after step 2's gitlink): `LessonHost.open` resets the engine before `mode.enter()` (the bridge's
    clock starts at 0 there; the runner's first actions reach the engine after it, on the new clock); the replay player
    resets it when it takes the engine, when the next lesson of a recording starts (right before its first frame), at a
    seek (before the frame sought) and when it gives the engine back to the live flight. `BridgeEngine`, `ReplayEngine`
    and `PageEngine` carry `reset` (optional on the first two). The rig's `FakeEngine.reset()` is the real one's (the
    planner from nothing, the last frame forgotten), with `keepOnReset` for the control.
  - Measured (`sonic-int-replay`, the rig on the package at fe1613b): with the reset, rings-first 2369 frames, 99.8 % by
    kind and 99.8 % by sector over every frame (4 frames differ, all the host's touch ping), rings-line 181 frames, 100 %
    and 100 % from its first frame; no frame of either lesson's first 0.4 s with another hazard voice than the replay's.
    Control, the same flight with an engine that forgets nothing: rings-line 95.0 % by kind (8 frames of held hazards and
    1 the comparer counts as other), 9 frames of its first 0.4 s with rings-first's sectors (the ceiling up and front-up,
    the wall front and front-right). rings-first's own shares are the same with and without the reset (99.8 %): the
    difference to stage C's 96.8 % by sector comes with the new package and flight, not with the reset.
  - Controls in the code, each run once and restored: without the host's call the main test and the control fail
    (rings-line's start; the host's three calls); without the player's call at a lesson's start its test fails.
- [x] 2. The gitlink to s13-int's head; every simulator test on the new package with its expected values from the
  package; the sound panel's real elevations tested (`sonic-panels`).
  - The gitlink at fe1613b (s13-int: 7980fab the reset, fe1613b the words check's root, below). Full vitest on it: 246
    files, 4049 passed, 9 skipped (the 8 Winter Garden tests without `.cache/scenes/7a475d38/scene.voxel.bin`, and the
    site's built templates), none failed. No simulator test pins tunnel-gaps' or walls-pillar's version, the
    `heightDirection` setting, the wrong way between gates or the engine's panners (searched `tools/bench`, `apps/fly`):
    nothing to take from the package there. The one failure on the new package was the package's own
    `test/words.test.ts` run from the simulator's root (ENOENT for `tools/listen/key-lines-v013.json`: the words check
    took its root from the working directory); fixed in the package (fe1613b), 18 of 18 from both roots.
  - The sound panel: the open way's mark from the chime's own direction (the package's `plan.freeWay.dir`, the middle of
    the way) with the pilot's "Sound from above and below" on, from the plan's side with it off; the target note
    (`height.target`) on the radar too when it comes from its target (its cue's dir, `plan.height.target.dir`), as the
    target's, marked above or below by it; off, the height bar alone. `sonic-panels` 23 of 23 (4 new); controls in the
    code, each run once and restored: without the target note's rule 2 tests fail; without the elevation from the
    direction 3 fail (the new tunnel-gaps test among them).
- [x] 3. Settings: the sound panel, the attitude display and the package's `heightDirection` in the start screen's
  settings and the spoken list; said with section, "Item n of N" and value; saved and read back after a reload; the
  reader's native controls with "my screen reader speaks".
  - The start screen's settings (`start-screen.ts`), three check boxes, each a stop of the spoken list: "Sound from above
    and below" (`sonic-height-direction`, the package's `menu.setting.height-direction`, its description
    `menu.setting.height-direction-what` under the box and said after the value; `SonicSetup.update({ heightDirection })`:
    checked by the package's validator, applied to the engine at once, saved with the whole sound document, read by the
    engine made at the next start) after the target height note; "Sound panel: see every sound" and "Horizon and height
    display" (`sonic-look-soundPanel`, `sonic-look-attitude`, v13-look's `LOOK_PANEL_LABELS`, `panelOn`, `setPanel` on
    the setup's store: the collection 'sonic', keys `soundPanel` and `attitude`; the page's panels follow the store's
    change at once) after "what the sound turns with". The settings have 14 stops (were 11).
  - `sonic-start-screen` 16 of 16 (3 new): each said with "Settings." when the focus comes from another section, its value
    and "Item 10, 12, 13 of 14"; Enter and the arrows off and on, said, applied (the engine got `heightDirection: false`),
    saved, read back by a new setup and screen on the same store; with "my screen reader speaks" Enter is left to the page,
    a click (the page's Space) changes and saves each, the voice says nothing. Controls in the code, each run once and
    restored: the direction box not applied, 2 tests fail; the panels not saved, 2 fail; a value said with the reader on, 2
    fail.
  - The page proof `sonic-v13-page.ts` C counts "Item n of 14" now (was 11); not run here (step 8).
- [x] 4. The scan lesson's contact: free-garden flies with the lesson contact `{ bump: 'slide' }` while a lesson runs on
  a scan; every other flight unchanged.
  - `FlightSession.setLessonFlight(rules | null)`: a lesson's flight rules merged into every life like a built-in world's
    (`lifeOverrides`), a 'life' setting that reports a change only when what the next life flies with changes; null by
    default, so every flight outside a lesson is the same flight (the a6 reference test passes; B12 and B15's crash rules
    untouched). `SonicMode.enter()` sets `LESSON_FLIGHT` for a lesson whose world is a scan and applies it at once
    (`applyLifeSettings`: a new life where the craft flies, else a new flight model at the spawn); `leave()` clears it. A
    lesson world brings the rule itself: no new life for it.
  - `sonic-scan-bump` (new, 2 tests): on a scan stand-in (walls-pillar's room as voxels through a `VoxelContactWorld`, no
    rules of its own, as the lesson rig flies a scan) the mode's free-garden makes the next lives 'slide' (headers too, a
    respawn keeps it), leave() gives the drone's contact back, walls-hall's own session starts no life. Flown by the lesson
    pilot (free-garden's assists) into the pillar at 0, 30, 60 degrees, 2, 3, 4 m/s, the stick let go or pointed away: in
    the lesson all 18 out of contact in 0.016 to 0.034 s; control, the drone's own contact (no lesson): 18 of 18 never out
    within the 1 s watch. Control in the code (the mode's call removed): both tests fail.
  - The Winter Garden's real walls: copied (read only) from v13-look's worktree cache into this worktree's `.cache/scenes/
    7a475d38` (no download), so the 8 garden tests run here now; with step 4 all pass (the lesson passed end to end through
    the host, eight gates, no touch), and one new: the lesson flies the scan 'slide', the drone's contact after `close()`.
- [x] 5. Reset over a running lesson: after "Reset my progress" every lesson is new, the one under the screen too.
  - The start screen tells the flight page after Yes has cleared the saved progress (`bind`'s new `onReset`, also on
    `ScreenPort`); the feature hands it to `LessonHost.progressReset()`: the runner under the screen keeps its old counts
    in memory, so it saves nothing more (not at its next attempt, block or pass, nor when it is left); closed with Escape or
    Back the screen's `onClose` now also calls `LessonHost.restartAfterReset()`: that lesson starts again from its
    beginning with a new runner from what is saved now (nothing), the way back of G kept; a lesson chosen on the screen
    opens as before and the one left saves nothing.
  - `sonic-reset-running` (new, 3 tests, the lesson rig): rings-first flown to a counted attempt, the reset, then closed:
    the lesson restarts at 0 and its next counted attempt is saved as the first (successes 1); another lesson chosen: the
    old runner counts one more under the screen and saves none of it, nor when left. Control (the reset not told to the
    flight page, as before): the next counted attempt saves the old count + 1 back, and leaving saves it again.
    `sonic-start-screen` one more: Yes calls `onReset` once with every lesson already cleared, No and Escape never.
    Controls in the code, each run once and restored: the save guard at an event off, 1 test fails; at leaving off, 2;
    no restart, 1; the screen not telling, 1.
  - Not held by a Node test: the two lines in `feature.ts` that wire `onReset` and the restart on `onClose` (the page's
    feature runs only in the page proofs): step 8 should check it on the page (the lesson menu's Lesson list over a lesson,
    Reset, Yes, Escape: the lesson's title is said again and its progress panel shows attempt 1, counted 0).
- [x] 6. Words heard by the local voices: "the key" before a key's name in es, pl, ru; one register in Russian; the
  mode's name in Russian and Polish; the words check before and after.
  - fcc511f (the decisions and the words: "## Decisions"). Russian: 70 lines changed (36 out of the formal register, 29
    with the mode's name, 14 with the key's word; three reworded for what the voice did not say: the wired headphones
    with the word headphones, "ask the question again", "send the recording to the author"); Polish: 42 lines (the name in
    29, the key's word in 14, "resume" as "resume the flight"); Spanish: the key's word in 14 lines. The new key
    `sonic.start.name` (four languages) names the mode in the start screen's h1, its spoken anchor and the page title.
  - The words check (the sound repo's `listen-words --sim` on this branch's locales; s13-int ea9ae36 and 43ed9a3 made it
    read `fly/soniclook` too and fill the new parameter `{here}`; `sonic.say.text` only carries a text and is no line):

    | | lines | heard exactly | mean rate | over the bound 0.2 |
    |---|---|---|---|---|
    | en, David, before (2c565b3) | 268 | 249 | 0.0092 | 4 |
    | en, after (fcc511f) | 269 | 250 | 0.0091 | 4 |
    | es, Helena, before | 268 | 251 | 0.0137 | 4 |
    | es, after | 269 | 254 | 0.0128 | 4 |
    | pl, Paulina, before | 268 | 248 | 0.0227 | 10 |
    | pl, after | 269 | 254 | 0.0133 | 5 |
    | ru, Irina, before | 268 | 219 | 0.0603 | 22 |
    | ru, after | 269 | 245 | 0.0266 | 10 |

    s13-elev's run on v13-host e7612d3 had 249 lines and 4, 4, 9, 21 over the bound; the soniclook line "1.5 m" adds one
    in Polish and in Russian (heard as the voice reads it, "1,5 metra").
  - Still over the bound after, none fixable by a rewording:
    - Whisper writes it otherwise, the voice said it (no reader needed): en `sonic.copyKeys`, `copyKeysMac` ("Control and
      C" written "Control-N-C"), `sonicrec.state.savedDisk` ("Save to Disk"), `sonicrec.channel.status.retrying` ("We'll
      try again"); es `sonic.link.titleStart` ("FlybySound" as one word), `sonicrec.channel.telegram` ("TELAGRAM"); pl and
      ru `soniclook.metres` ("1,5 metra" for "1.5 m", which only the panel shows); ru `sonicrec.channel.telegram`,
      `channel.name`, `transfer.stored`, `transfer.delivered` (the brand written in Cyrillic).
    - A habit of the voice or a word alone, for a native reader: es `sonic.copyKeysMac` ("Comando y C" heard "Comando
      IC"), `sonicrec.send.notice.cancelled` ("No se envio" heard as "Nos envio"); pl `sonic.copyKeys` ("Kontroli C"),
      `sonicrec.key.Tab` (heard "Tabulator"), `sonicrec.status.starting` (Chrome's own button name, kept, heard "ZZW-L"),
      `sonicrec.channel.status.retrying` (heard in the first person); ru `sonic.copyKeys` and `copyKeysMac` (Irina mangles
      "Command"), `sonic.progress.counted` ("counted" split in two; the package's own word in its status lines, kept
      alike), `sonic.menu.page` ("low-vision" split; the item must use the site page's words, a test holds it),
      `sonicrec.key.Tab` (heard "Tap").
  - A machine check is no native reader: every line changed here in Russian and Polish (the name in both, the register
    in Russian, the key's word in the three) needs a native reading, as do the habits above. The key's word in the
    simulator's lines is held by the word rate only: `--sim` has no key rule of its own (the package's lines have one),
    so a key's name lost in a long line can stay under the bound.
- [x] 7. Gates on the head; the sound repo's checks on s13-int.
  - The gitlink at s13-int ecb2ffb (2b7fae2; since fe1613b the package changed only in tools, docs and evidence). `gates.py`
    on 2b7fae2: exit 0: typecheck; vitest 248 files, 4068 passed, 1 skipped (the site's built templates; the 9 Winter
    Garden tests run here); api-unittest 420 (3 skipped); architecture; i18n; catalog; B18 PASS (the run's change of
    `evidence/2026-11-08/b-repo-b18.json` given back).
  - The sound repo on ecb2ffb: `pnpm typecheck` clean; `pnpm test` 50 files, 1172 tests; locale lint 0 problems (4
    languages, 526 keys); layout 0; `GPU_LOCK=C:/dev/.gpu-lock pnpm proof:audio` 3 files, 9 tests (8 audio proofs with
    `engine-reset`, each failing on its control; the demo's checks); `pnpm listen` 9 of 9 (evidence keyed again,
    d0f4d5a92ed7, every measured number as before). Its notes: `docs/dev/status-v0.13-int.md` there (I1 to I3).
- [x] 8. Places on the page: the layout check with v13-host's real progress panel, and what it found fixed.
  - `tools/bench/src/v13-look-page.ts layout` no longer lays v13-look's stand-in over the page: the page's own progress panel (the
    mode draws it from the runner's view: the title and four rows, Lesson, Step, Attempt, Counted) is measured, `v13-look-progress-standin.css`
    is deleted. Rule at each of the 8 sizes, dark and light: each of the three panels (progress, attitude display, sound panel) inside the
    page, clear of the view's centre (the middle 30 % x 30 %), the captions (the last three lines the lesson said, as they stand when its
    attempt begins, as v13-look measured them), the page's controls (top bar, corners, recorder button and row), the touch sticks and the
    other two panels; the take-off line, the telemetry and the key strip may be covered where there is no room (reported). New checks: the
    progress panel is there with its five lines, white on black (dark) or black on white (light), 15 px or more; `LAYOUT_LANG=<en|es|pl|ru>`
    runs the same page in another language (an extra, TAG=<lang>).
  - Control, the old CSS under the new check (`evidence/2026-11-09/v13-look-layout-before.json`, 86 of 96, pictures in
    `v13-look-layout-before/`): the real panel fails at 5 sizes in both schemes: 1280x720 (the second caption, 212 px2: the panel began
    5 px too high), 960x540 (the captions' second line, 4357 px2: v13-look's finding), a phone upright (the recorder's row, 1902 px2), a phone
    upright with touch sticks (the left stick, 15327 px2: v13-look's finding) and a phone on its side (the captions, 868 px2); the
    attitude display and the sound panel pass everywhere, as v13-look found.
  - The places now (sonic.css `.sonic-progress`, look.css): wide and tall (over 600 px: 1280x720, 1366x768, 1920x1080) the progress panel
    12 px under halfway down at the left edge, the sound panel under it (its formula takes the 12 px), the attitude display at the bottom
    right as before; 501 to 600 px high (960x540, a 1080p screen at 200 % zoom) the sound panel first of a row at the bottom left and
    the progress panel to its right in the small form (15 px), both under the captions' lowest line (the stack did not fit), the sound
    panel's size one variable (`--sonic-sounds-u`) both files read; up to 500 px high and wider than a phone (844x390) the progress panel
    at the bottom left, alone; 640x360 as before; a phone upright (390x844) the progress panel 132 px up over the take-off line (before:
    over the recorder's row), the sound panel over it; a phone upright with touch sticks the progress panel over the telemetry line, left of
    the view's centre (35 % of the width less 8 px), small form; the recorder's row and the take-off line stand at the right edge there
    (the same 50 % of the width, the take-off line one line), which frees the left side. After: `evidence/2026-11-09/v13-look-layout.json`
    **96 of 96** (pictures in `v13-look-layout/`, 16 small JPEGs: 8 sizes, dark and light, the progress panel in every one), on the release
    of ba1654b with this step's CSS (the final run on the head is step 12's).
  - `sonic-panels` 25 of 25 (2 new, "v13-int step 8"): the arithmetic the two CSS files share (the sound panel's formula 101 + 12 px, the row's
    left from the canvas factor 0.8 x 1.36 and the box's 2 x (6 + 3) px, the sticks' stack 16 + 19 + 8 px over the sticks, the recorder row moved
    only by the touch rule) agrees; control in the test: each of the four numbers changed in one file alone is caught.
  - Measured, not fixed (extra, English is the record): the same layout in other languages, dark only, `v13-look-layout-ru|pl|es.json`:
    ru 42 of 48, pl 46, es 44. The longer captions (Russian and Spanish wrap to more lines) reach into the progress panel's top right
    corner at 1280x720 (ru 2156 px2, es 1516, pl 1304) and 1366x768 (14 to 79 px2), into the attitude display at 960x540 (ru and es, 2989
    px2) and 640x360 (2170 px2), and in ru at 640x360 the progress panel (148 px wide) meets the sound panel (587 px2). The captions lie over
    the panels there for the 12 s a line stays (z-index 5 over 4); a deaf pilot reads the captions, so they win. Not seen at all: a page height
    between 601 and about 705 px (a laptop window) or a width not among the eight; the places were tuned to these eight.
  - Seen on the way, not this step's: the recorder's toggle ("Recording") lies over the right stick and the take-off line's right end on a
    phone upright (`sonicrec-toggle`, 111 x 44 at 265, 730 on the phone with sticks), as before this step.
- [ ] 9. The page proofs that still expect v0.12 (`sonic-int-page.ts` I, `sonic-lessons-page.ts` Z and I).
- [ ] 10. `sonic-v13-page.ts` part C: the three new switches by keys through the spoken list; part E in the dark scheme.
- [ ] 11. The replay in a page: the v0.12 fixture (older-build sentence, recorded lines in order, a seek), a recording made on this build.
- [ ] 12. One run of everything on a release build of the head under the GPU lock, gates exit 0, this Status.
- Later, the lead's, not this job's: flight regression accept-fly B6 to B16 on a local release of the final head, one independent review of
  the integrated branch and its fixes, the sound repo's s13-int to its `main` after gh_precheck (the lead pushes), the gitlink on that commit,
  the merge into `v03-lead`.

## Changed tests

Each changed expectation takes its value from the package or names its reason; each kept control still fails.

| Test | Change | Why |
|---|---|---|
| the package's `test/words.test.ts` as the simulator's vitest runs it (step 2) | none here: fixed in the package (s13-int fe1613b, the words check's root from its own file) | it failed twice with ENOENT from the simulator's root on the new package |
| `sonic-panels` "the open way: its side from the plan" (step 2) | title only: a way above or below sounds from ahead "with the pilot's Sound from above and below off" (was "today") | since s13-elev the chime comes from the way with the setting on |
| `sonic-int-replay` "rings-first to its pass, then rings-line" (step 1) | the settle window (holdMs + 100 ms after a lesson's open) is gone: the shares (98 % by kind, 85 % by sector) and W19's causes are taken over every frame; new: no frame of a lesson's first 0.4 s with other hazard voices than the replay's, sector and all (`hazardsDifferAtStart`); the host reset the engine 3 times (rings-first, its reopen, rings-line) | the host resets the engine at every open, so nothing of the lesson before is held at the next one's start |
| `sonic-int-replay` new control "the same flight with an engine that forgets nothing" (step 1) | records the same two lessons with `FakeEngine.keepOnReset`: rings-line's start holds rings-first's sectors (9 frames measured) | the control that fails without the call |
| `sonic-int-replay` "the player plays the lessons in turn" (step 1) | the fake engine logs frames and resets: a reset first, one right before rings-line's first frame, two in all while playing; at each seek a reset, then the frame sought; a reset at close | the player resets the engine where a lesson starts or the clock jumps |
| `sonic-lesson-rig` `FakeEngine` (step 1) | `reset()` as the package's (the planner from nothing, the last frame and its cues forgotten), `resets`, `keepOnReset` | the host calls the engine's reset at every lesson it opens |
| `sonic-start-screen` C3 "the first key ... Down goes through every stop" and the reader's control (step 3) | `STOPS` has the three new switches; the settings' place "Item n of 14" (was 11), the 14 counted from the screen's own stops | three settings more (step 3) |
| `sonic-start-screen` new: "v13-int step 3: sound from above and below, the sound panel and the attitude display ..." (3 tests) | new | step 3 |
| page proof `tools/bench/src/sonic-v13-page.ts` C (step 3) | "Item n of 14" (was 11) in the settings walk and the target note's line | three settings more; not run here (step 8) |
| `sonic-optin` "its words (review R8)" and "its words: the cut line ..." (step 6) | the item and the key list's L and K lines begin with the mode's name taken from the dictionary (`sonic.start.name` of the language), was the fixed "Fly by Sound: " | Russian and Polish name the mode in their own words |
| `sonic-reset-running` (step 5) | new, 3 tests | the reset over a running lesson |
| `sonic-start-screen` new: "v13-int step 5: Reset my progress over a flight tells the flight page" (step 5) | new | the screen's `onReset` |
| `sonic-scan-bump` (step 4) | new, 2 tests | the scan lesson's contact |
| `sonic-garden` "Winter Garden at x5, on its real walls" (step 4) | one test more: the lesson flies the scan 'slide', the drone's contact before and after; the 8 tests run here now (the walls' cache is in this worktree) | step 4 on the real scan |
| `sonic-panels` "real elevations from the package (s13-elev) ..." (step 2) | new, 4 tests: tunnel-gaps' open way above marked by its own direction (on) and by the plan's side (off), with the bare chime's control; the target note's mark follows `plan.height.target.dir` (above, below, level), and with the setting off it stays on the bar | the package now gives the panel real elevations (lane s13-elev's "Needs from the simulator") |

## Deferred

To v0.14 by the lead (not done here):

- v13-host's need 1: the host's touch ping, which the replay never derives (one owner of the ping the replay can
  re-derive).
- v13-host's need 3: a cue the runner hands over at the end of speech is stamped at another time in the replay than live.
- v13-host's need 4: the package's word for a skipped lesson (`menu.lesson.skipped`).
- v13-look's need 1: the plan saying when the next target note sounds (the sound panel's height bar keeps the rhythm, not
  the phase).

## Decisions

- Step 6 (c), the mode's name (the words themselves are in the locales; B18 keeps Cyrillic and Polish letters there):
  Russian names the mode "Polyot po zvuku" ("flight by sound"), Polish "Lot na sluch" (with the Polish l: "flight by
  ear"; `sonic.start.name` in `fly/sonic/ru.json` and `pl.json`), in every Fly by Sound file of the simulator
  (`fly/sonic`, `sonicentry`, `sonickeys`, `sonicrec`) and in the site's and the admin page's files of those languages
  (`site/ru.json`, `site/pl.json`: the nav, the page about the mode, the privacy section; `admin/sessions`). Why: the
  local voices garble the English name (Irina in 10 of the 21 Russian lines over the bound in s13-elev's run, Paulina
  "Flajby", "O Fly by Sound" heard as "Offline Sound"), and a blind pilot hears the name far more often than he reads
  it. Where a case is needed the name stands, in quotes, after the word for "mode" in its own form, so it is always said
  and written the same. The English name stays once: on the page about the mode where it says what the mode is and
  links its source ("Shramko Fly by Sound", the package's and the repository's name, and its GitHub link). Spanish keeps
  "Fly by Sound": Helena says it, and the one Spanish line over the bound with it was heard right and written as one
  word ("FlybySound"). The start screen's h1 and the page title take the new simulator key `sonic.start.name` (four
  languages) instead of the package's `app.name`, which still says "Fly by Sound" in every language, as does its
  `menu.welcome` (the package's own lines are not changed in this step; the simulator does not say `menu.welcome`). The
  Polish name is a non-native choice: a native reader decides.
- Step 6 (b): every Fly by Sound line of the simulator in Russian speaks to the pilot as the package does (the informal
  "ty": "press" as the package's K help says it, "your settings" in the informal); the site's pages keep the formal "vy"
  (they speak to visitors, outside the mode). A button stays in the infinitive ("Send the recording to the author"),
  which has no register.
- Step 6 (a): "the key" before a key's name in Spanish ("la tecla", "las teclas"), Polish ("klawisz", "klawisze") and
  Russian ("klavisha" in its cases), the plural before a combination (`{copy}` = "Control and C"); a button's name is
  not a key and keeps its own words.
- Step 2: the target note goes on the sound panel's radar when it has a direction (the package's `heightDirection` on): it
  comes from its target since s13-elev, and the radar's rule is "every active cue with a direction at its direction"; a
  deaf pilot sees where the note comes from (above or below, left or right) and not only the height on the bar. It is
  drawn as the target's (colour and glyph), so in a ring lesson it sits beside the gate's hum (the discs are pushed apart).
  Without a direction it stays on the height bar alone, as in v13-look. The page proofs of the panels (v13-look-page
  `panels`, `layout`) have not run with it: step 8.
