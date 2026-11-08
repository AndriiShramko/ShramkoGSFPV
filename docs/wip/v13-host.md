# v0.13 v13-host: the simulator on the v0.13 sound package (owner's message 41)

Plan: `docs/wip/v13-plan.md` (items M41-n, lanes, checks); lead: `docs/wip/v13-lead.md`. The package's merge review lists
every simulator change as W1 to W20 (`C:/dev/ShramkoSonicFPV/docs/dev/review-v0.13-merge.md`, "The simulator against
this branch" and "Wave 2: one list"); the API the host needs: the package's `docs/dev/status-v0.13-lessons.md`,
`status-v0.13-sound.md` and `status-v0.13-worlds.md`.

Worktree `C:/dev/gsfpv-v13-host`, branch `v13-host`, cut from `v03-lead` 093fbbd. The sound package is the submodule
`packages/sonic-fpv`, moved here from 1eea4d5 to 16c01a1 (the package's public `main`, v0.13): never edited here;
what the package itself must change goes under "Needs from the package".

The lane runs in three stages, one agent each: A, the simulator on the v0.13 package (gitlink, the hollow from
`world.cavities`, the simulator's Fly by Sound tests, the touched samples, the motor bus, the 28 lessons, the cost
bench); B, the lesson keys and the spoken menus (W3 to W8, W13, W15, M41-1 to M41-4, M41-7); C, the panels and the page
proofs.

## Status

### Stage A

- [x] A1 (W1, W2) the gitlink at 16c01a1; the room drawn from `world.cavities` (`apps/fly/src/sonic/primitives.ts`
  `cavityBoxes`, the mirror `corridorCavities` and the switch by generator deleted; `Cavity` is the package's
  `CavityBox`); `pnpm -r typecheck` passes with no other change (the review found the same: the app compiles against
  the package as it is)
  - `tools/bench/test/sonic-primitives.test.ts`: the 18 tunnel cases pass (6 tunnels x 3: free where `solidAt` says,
    faces on real walls, every wall a ray hits drawn); the mirrored-corridor control still fails the mirror (wrong >
    100) and the one-face-left-out control still finds rays uncovered. Control of the switch: the file as it was at
    093fbbd (the mirror) fails exactly those 18 cases (21 failures with the 3 object cases of A2).
  - tunnel-long's "every wall a ray hits has a drawn face" got 255 hits, 300 wanted, with the mirror and with the
    package's boxes alike (the hits do not depend on the faces): its bounds are 1 % free air at 0.3 m from a wall
    (102 x 4.4 x 65 m), so 20 000 draws found about 250 ray origins. The draws are now up to 200 000, still stopping
    at 1500 free origins (no other world needed more than 70 000); both assertions stand.
- [x] A2 (W20) the simulator's Fly by Sound tests pass on the new package (in groups by file, each in "Changed tests"):
  599 tests, 585 pass, 10 skipped (8 as before, 2 marked for stage B), 4 fail, which A4 (`sonic-audio`, the motor's
  default) and A5 (`sonic-start`, the 28 lessons) took: after them none fails (A7)
  - On the new package before A2: 598 tests, 556 pass, 34 fail, 8 skipped (the 18 tunnel cases of the review's 52 were
    A1's). Two of the 34 belong to A4 (`sonic-audio`, the motor's default) and two to A5 (`sonic-start`, the 28 lessons).
  - [x] `sonic-lessons` and its rig: 24 of 26 pass, 2 skipped for stage B (G and review I3: the glossary ends in a 'go'
    action, W3 and W4). Controls broken once and restored: the rig's answerer without `repeat-cue` (module 0 fails), the
    move-speed pilot released 4 m past the zone's middle (fails), the wrong-height pilot at the ring's own height (the
    control fails: it passes the ring), the progress test run to the pass (fails: passed).
  - [x] `sonic-bridge`: 15 of 15. Its controls (the recording without its speech.end markers, without its keys) still fail
    the replay; the places of v0.12's hall (z = -10, -20 to -28.5) are rock in the new room, which is what failed before.
  - [x] `sonic-int-reader`: 4 of 4. Control broken once and restored: the task test on the engine's own waits (no
    sequential queue) ends the first part at its longest line (5472 ms, the sum 6844 ms) and fails.
  - [x] `sonic-int-replay`: 10 of 10. W19 pinned down (not a play's edge): rings-first's 29 of 2225 frames that differ by
    kind are the host's touch ping, which the replay never derives (11 frames, after each ring the craft flies on into
    the front wall between attempts), the open-way chime's hold from samples the recording does not keep (10), and the
    floor or the wall at a corner with the feed rate (9). Once rings-first passed, rings-line (never reached before) had
    9 of 181 frames off by kind at its start: the live engine still held rings-first's hazard sectors (the ceiling voiced
    with the craft at rest 2.2 m under it). Both package sides are under "Needs from the package". The test now holds the
    lesson's own cues on every frame (control in the test: one height cue in fifty dropped is caught) and the safety
    layer's shares once a lesson has settled: rings-first 98.7 % by kind, 85.7 % by sector; rings-line 100 %.
  - [x] `sonic-pilot`: 8 of 8. The caps test and its control (the speed cap left open flies past it, still failing the
    cap) fly an open world with walls-hall's start and assists; in walls-hall the craft met the wall (height 0.99 m off).
  - [x] `sonic-primitives`: the 3 object cases pass (105 of 105 with A1's). Their controls (the ring as the engine's
    torus, the pillar 0.3 m aside) still find the primitives off the surface.
  - [x] `sonic-world` (and `sonic-world-flight.ts`, `sonic-world-cost.ts`): 20 of 20, one new control (a lookup with no
    distance decides no cell: under the bound). The cost flights fly v0.12's hall, pinned (`costHall()`, the hall
    generator's version 1); the evidence script run once on it: 12.45 ms along the wall, 3.88 ms in the open (20 ms
    allowed; v0.12 measured 13.4 and 3.5), its evidence file restored (a re-run of 2026-11-07's).
  - [x] `sonicrec-recorder`: 39 of 39.
  - Found, not changed (for stage B): `sonic-session/replay-segments.ts` cuts a frame stamped at the next open's own time
    into the next lesson (`t < endT`). In the rig every switch has one (its clock stands while the host opens the next
    lesson), so rings-line's first frame is rings-first's last position, heard in rings-line's world by the replay. In
    the page the open comes after the frame by the swap or by a few microseconds, but a coarse timer could tie them.
- [x] A3 (W11) `FrameSampler.take` keeps every sample with `touched` (`apps/fly/src/sonic-session/frames.ts`): a touched
  sample between two due ones is kept too and moves no due time
  - Test, new `tools/bench/test/sonicrec-touch.test.ts`: a host loop as the simulator's (the package's runner and planner
    at 60 Hz, speech.end markers, the frames chosen by `FrameSampler`) flies tunnel-narrow along its world's track and
    flies into its side walls three times at 2 m/s (the straight legs at z = -5, x = 5 and x = 10), each touch on a
    sample that is not due: every touched sample is a frame, the replay re-derives every event (touches and resets 3 of
    3, each reset to a point `wN`), the verdict is pass. Control in the test: the same flight with the samples given to
    the sampler without their touch (the v0.12 rule) reads FAIL, "position differs" on the touches. Broken once and
    restored: `frames.ts` as at 093fbbd fails the first test.
  - `sonicrec-*` and `sonic-int-*`: 285 of 285 after it; rings-first's recording has one frame more (2226: the touched
    sample of a touch between attempts), its shares as before (98.7 % and 85.7 % settled).
- [x] A4 (W12, M41-16) the mode's motor into `engine.motorInput ?? auxInput`, on by default
  - `apps/fly/src/app/builtin/sound.ts` `startOnEngine`: the motor's graph into the engine's motor bus (`motorInput`), or
    the plain input node of an engine without one; on by default through the package (`SonicPrefs.motorSound` true, and
    a v0.12 document's false read as true by the package's `readPrefs`); `PageEngine` (`apps/fly/src/sonic/audio.ts`)
    picks `motorInput` and `plan` (the panel of M41-25 reads `plan`).
  - Test, new `tools/bench/test/sonic-motor.test.ts`: the motor feature installed on a page of the mode (fakes for the
    page and the graph): with the package's default settings the motor plays, its master into `motorInput` once, not into
    `auxInput` nor the speakers. Controls in the test: an engine with no motor bus gets it on `auxInput`; the motor turned
    off makes no graph. Broken once and restored: `sound.ts` as at 093fbbd (into `auxInput`) fails the first test.
  - `sonic-audio`: the two motor defaults expect the motor on (W12's check); 38 of 38.
- [x] A5 (W18) the start screen lists the 28 lessons by order and the fast path of 8
  - `apps/fly/src/sonic/start-model.ts` already lists every shipped lesson by `order` (the full path's place) and marks
    the fast path from the lesson files: no code change but its comments (and `start-screen.ts`'s "21 lessons").
  - `sonic-start` (12 of 12) takes the counts from the package (`SHIPPED_LESSON_IDS.length`, `lessonPaths()`), pins 28
    and 8, and holds the fast lessons in the path's own order. Controls broken once and restored: a model that lists only
    the fast path's lessons on that path fails "every shipped lesson" (8 of 28); a stale fast mark (tunnel-gaps left
    out) fails the fast path. (Dropping the sort by `order` fails nothing: the package's list is in that order already.)
  - The page proof `tools/bench/src/sonic-start-keyboard.ts` (not a gate, not run here) counts the package's lessons
    instead of 21.
- [x] A6 (W16) one run of the analytic cost benches over the new worlds, against v0.12's frame budget (measure only;
  this machine: Intel i9-7980XE, Node 22.13, the same as v0.12's evidence)
  - The planner per frame (`tools/bench/src/sonic-analytic-cost.ts`, every layer on, 4000 free points a world at 3 m/s;
    budget p95 under 1 ms a frame): all 22 analytic worlds pass (`evidence/2026-11-08/sonic-analytic-cost.json`). The
    path rays and the open-way probes cost 2 to 3 times v0.12's per frame. Worst: tunnel-long p95 0.765 ms, p99
    0.988 ms, max 1.36 ms (0.235 ms of headroom at p95); the corridor p95 0.636 ms (v0.12: 0.227); walls-row 0.335,
    tunnel-bends 0.322, tunnel-gaps 0.318; the rings, shapes and halls 0.14 to 0.29 (v0.12: 0.07 to 0.13). A CPU slower
    by a third would take tunnel-long over the budget at p95.
  - tunnel-long's walls (new `tools/bench/test/sonic-tunnel-cost.ts`, `evidence/2026-11-08/sonic-tunnel-cost.json`):
    its collider (0.05 m voxels, bounds 101.6 x 4.4 x 65.1 m, 233 million voxels, cells classified on demand) builds in
    5.6 ms. A disarmed craft let go along the track at its 62 points (2.5 m/s and 0.5 m/s toward the left wall, 1 s each:
    82 494 contact queries, 2806 contacts) costs 23.24 ms for 10 s of flight as the session flies (cells only 27.89, no
    cull 121.47; the same answers): OVER the plan's 20 ms by 3.2 ms (16 %). A query costs about 3 times one in v0.12's
    hall (the 0.05 m voxels: 8 times the voxels in each cell, and in 0.7 m ways nearly every cell by the craft is
    crossed by a wall). Per 60 Hz frame that is 0.039 ms. Not a one-line setting (the voxel size is the world's spec,
    in the package's lesson file, and the replay rebuilds at it): for lane v13-look, with the frame cost of the look.
- [x] A7 full gates exit 0; stage A's status final
  - `gates.py --repo C:/dev/gsfpv-v13-host` on f131bb1, exit 0: typecheck PASS; vitest PASS, 3833 passed, 11 skipped
    (3844: the 2 of stage B, 8 that need the Winter Garden scan's walls in `.cache`, 1 that needs a tool or a build
    this machine's run lacks, all as before); api-unittest, architecture, i18n, catalog PASS; B18 PASS
    (`evidence/2026-11-08/b-repo-b18.json`).
  - The Fly by Sound tests (`sonic-*`, `sonicrec-*`, `packages/prefs/test/sonic.test.ts`): 604 tests, 594 pass, 10
    skipped (8 need the scan, 2 are stage B's), none fails.
  - No line a person reads was added or changed (no locale key): nothing waits for a native reading from stage A.

#### Stage A, final

Done: A1 to A7, one commit each (A2 in eight commits by file and its status). Not pushed, nothing deployed, the live
site and the other worktrees untouched; `packages/sonic-fpv` only moved to 16c01a1, never edited.

Left for stage B, with the reason:

1. The two skipped `sonic-lessons` tests (G's way back, review I3) come back with W3 (`createLessonRunner`'s `path`,
   `keys`, `returnTo`, `speechRate`) and W4 (the 'go' action): until then the glossary ends in a 'go' the host drops,
   and N in any flying lesson is a dead end.
2. W5 to W8, W13 to W15 as the review lists them (B, Z, the Escape menu and its keys recorded for the replay; I and the
   progress panel from `runner.view()`; `skipped` kept in the saved progress, W7; the pause and resume of the runner;
   the mode's settings `motorGainDb` and `heightTarget`; every line through `engine.say()`), and W9 and W10 (the replay
   of an older lesson version speaks its recorded lines; the "recorded with an older build" verdict line).
3. When the package answers "Needs from the package" 2 (an engine reset), call it in `LessonHost.open` and drop the
   settle window of `sonic-int-replay`; when it answers 1 (the touch ping), follow it in `SonicMode.touched()`.
4. `sonic-session/replay-segments.ts`: a frame stamped at the next open's own time (the "Found" note in A2).
5. Stage C: the page proofs, `tools/bench/src/sonic-start-keyboard.ts` among them (its counts follow the package now,
   not run here).

For lane v13-look (A6): tunnel-long's contact queries are 16 % over the plan's 20 ms for 10 s of flight, and the
planner's headroom there is 0.235 ms at p95; M41-19 and M41-23 as planned.

### Stage B

The pilot's keys and the lesson menu (W3 to W6, W8, W15, M41-3, M41-6, M41-7), one commit a step. Tests in the new
`tools/bench/test/sonic-lesson-keys.test.ts` (the lesson rig where it has the part, plain fakes where it has none), each
with its control (the rule broken once in the code, the test seen failing, the code restored).

- [x] B1 (W3) the runner gets the pilot's path, the names of his keys, his speaking speed and the lesson G left
  - `apps/fly/src/sonic/lessons.ts` `runnerOptions()` (new, pure): `createLessonRunner` gets `path` (the pilot's,
    `SonicPrefs.path`), `speechRate` (`SonicPrefs.speechRate`), `keys` (`LessonPage.keyNames()`) and `returnTo` (the opener's
    `returnTo`, the lesson G left) besides what it had; `apps/fly/src/sonic/feature.ts` gives the page's.
  - New `apps/fly/src/sonic/key-names.ts` `KeyNames`: the name of a key is what the pilot's keyboard layout types on its place
    (`navigator.keyboard.getLayoutMap()` where the browser has it, asked again when the window comes back), else the key
    table's cap (the router's `caps()`, the US place); a named key by its name in the page's language (`sonic.key.Escape`,
    new in the four locales). N, B and Z are `scene.next`, `feedback.open` and `sonic.repeat`; no cap: the runner's own N, B, Z.
  - Tests (`sonic-lesson-keys` B1, 6): the names with no layout, a German one (Z's place types Y), a French one (W), a place
    with nothing printable; the browser's layout map asked, absent and refused; `runnerOptions` from a page; rings-first stands
    6 of 8 on the fast path and 20 of 28 on the full one; hover-height's go-on offer after three failures names N as the page
    names it (J). Controls broken once and restored: `path` left out of the options (the path tests fail), `keys` left out (the
    offer says N), the layout ignored (Y and W become Z): 5 of the 6 fail; the sixth is the "no cap off the mode" control.
- [x] B2 (W4) the 'go' action: N in a flying lesson moves on, B goes back, G goes and comes back, never a second advance
  - `apps/fly/src/sonic/lessons.ts` `act()` takes `{ kind: 'go', to }`: 'next' is `advance()` (the lesson G left first, then
    `lessonAfter(id, path)`, the lesson the runner's pass line names, then the start screen; was `nextLesson` on the path, else
    the full ladder's, which differs only where a path ends early), 'previous' is the new `go()`: the lesson G left, else
    `lessonBefore(id, path)`, else the start screen. The move is made once the runner has handed out the rest of its actions
    (a microtask, as the package's demo host does). One move per runner (`movedFrom`): a second 'go', a 'go' while another
    lesson is being opened, and `checkPassed()` after a 'go' or after the pass's own move change nothing.
  - Tests: `sonic-lessons` "G opens the sound glossary" and "review I3" are back (N pressed while the glossary runs; the
    glossary's runner is left neither passed nor skipped). New in `sonic-lesson-keys` (B2, 5): N while flying opens the next
    lesson on the path (rings-first to rings-line, once; the lesson left skipped, its `leave` event out; it was a dead end);
    B in the task opens the lesson before (rings-line to rings-first); B in the first lesson of the path opens the start
    screen; B in the glossary opened by G goes back to the lesson G left (not ears-headphones, the lesson before the glossary);
    N pressed after a pass while the host's own move swaps in the next lesson opens nothing over it (no start screen, one open
    of shapes-series). Controls broken once and restored: the 'go' dropped (6 tests fail, the 5 that move and I3); no guard
    (the start screen opens over the next lesson); 'previous' without the way back (ears-headphones opens).
  - Changed: `sonic-int-reader` "a lesson flown in this mode re-derives on replay" presses N in the task, not while flying
    (N while flying now leaves rings-first: the recording held rings-line's open, which the one-lesson replay cannot derive).
  - The Fly by Sound tests after it: 615, 607 pass, 8 skipped (the scan's 8), none fails.
- [x] B3 (W5, M41-6) N, B and Z call the runner, each a key event the replay reads first; the mode's keys win in a lesson;
  K names N, B, Z, I and Escape
  - `apps/fly/src/sonic/bridge.ts` `keyCall()`: the key event with its `REPLAY_KEY_ACTIONS` action, then the runner's call at
    the same t, its events, its actions taken: `next` (N), new `previous` (B), `repeatTask` (Z), `nextLesson` (the lesson menu,
    B6; B3's `previousLesson` went again in B6: the menu has no Previous lesson, B from the first step is the lesson before).
    `apps/fly/src/sonic/mode.ts`: while a lesson runs the mode holds `feedback.open` (B: the step before)
    and `sonic.repeat` (Z: `runner.repeat(t)`, the step's whole task with its sounds, no longer the bridge's last line) beside
    N, each once per press. B is the feedback form's key everywhere else (`packages/prefs` keymap); in a lesson the mode's
    handler is the router's last, so it wins, and the pause menu's "Report a bug" item still opens the form (its own key while
    the menu is up, and its button); when the lesson ends, B is the form's again. `feature.ts`: the install-time Z handler is
    gone (the mode's), the key list names N and B as the lesson's (`keys.sonic.next`, `keys.sonic.previous`), Z's label says
    the task (`keys.sonic.repeat`), four languages each.
  - K (`mode-keys.ts` `KEY_HELP`): N, B, Z, I first, then G, R, T, U, L, each with the page's name for its key (`KeyNames`);
    B and Z are the page's own lines (`sonic.say.helpPrevious`, `sonic.say.helpRepeat`: the package's `help.repeat` still says
    "the last line"). Escape's line comes with its menu (B6).
  - Tests (`sonic-lesson-keys` B3, 5): N, B and Z each write their key event (next, previous, repeat) as the first event of the
    press, the runner's after it, a held key's repeats nothing; Z while flying says the title, every intro line, plays each
    named sound `REPEAT_PLAYS` times and says "Go on.", the same attempt going on; B while flying goes back to the task, the
    attempt dropped uncounted, one attempt-start after it; rings-first flown with N, Z, B, N and passed replays PASS with no
    diff, and without its key events it does not (in the test); B in a lesson is the lesson's, the page's feedback handler
    runs again once the lesson ends. Controls broken once and restored: the key event written after the runner's call (the
    first test fails), Z as the last line (4 fail), B not held by the mode (4 fail).
  - Changed: `sonic-lessons` "N skips the intro, I says ..., Z says the task again" (Z presses the key and expects the
    task's title first with interrupt, the attempt listening; was the last line again); `sonic-optin` K's lines (the new
    order and names, B's and Z's lines the page's; the control on an ordinary page names N, B, R, L).
  - Lines for a native reading (es, pl, ru): `sonic.say.helpPrevious`, `sonic.say.helpRepeat`, `keys.sonic.next`,
    `keys.sonic.previous`, `keys.sonic.repeat`, and B1's `sonic.key.Escape`.
  - The Fly by Sound tests with the key and locale tests after it: 694, 686 pass, 8 skipped (the scan's), none fails.
- [x] B4 (W6, M41-7) I says `runner.statusLine()`; a large high-contrast progress panel draws `runner.view()`
  - `apps/fly/src/sonic/lessons.ts` `status()` is the runner's `statusLine()` ("Lesson 20 of 28: Your first ring. Step 2 of 2.
    Attempt 2. Counted 1 of 3."; the lesson and the step in the task and in module 0), `status.none` with no lesson; I says it
    through the page's status board and the mode's voice (`bridge.say` -> `engine.say`), as before. The host's own translator
    is gone with the old line.
  - New `apps/fly/src/sonic/progress-panel.ts`: `progressRows(view)` (lesson k of n and step k of N always; in a flying lesson
    "Attempt k" once one began and "Counted m of r"), `ProgressPanel` (the title and the rows, drawn only when the text
    changed, hidden while no lesson runs) and `followProgress` (drawn at once and at every event the mode writes: every
    attempt's start, pass and failure is one). `feature.ts` puts it outside #ui (the flight's live region: a screen reader is
    not read every change; I and the attempt lines say it), the test hook gives its text (`sonic().panel`). New words
    `sonic.progress.*` in the four languages. `sonic.css`: at the left edge halfway down (low on the left on a narrow page),
    at most 30 % of the width, so the view's centre, the captions and the corners' telemetry stay clear; bold 18 to 28 px
    white on opaque black with a white edge and a black outline (21:1, reads over a dark and a light scene), black on white
    under `prefers-color-scheme: light`, the system's colours under `forced-colors`.
  - Tests (`sonic-lesson-keys` B4, 4; the panel on `tools/bench/test/sonic-fake-dom.ts`, a small stand-in for the DOM): the
    rows of a flying lesson, its task and module 0, the words in four languages; I through the board says the runner's line
    (the step in the task; "Lesson 20 of 28", "Attempt 2. Counted 1 of 3." after the first counted attempt), interrupting;
    the panel hidden before a lesson, then at every attempt's start "Attempt k" and at every counted one "Counted k of 3",
    the numbers I says; its place and colours in `sonic.css`. Controls broken once and restored: `status()` with the v0.12
    line (the I test fails), the panel drawn once and never again (the follow test fails).
  - Changed: `sonic-lessons` "N skips the intro, I says ..." expects the runner's step line (`status.progress-step`, the
    lesson's place on the path), was `status.lesson`.
  - Not seen in a page yet: the panel's place over a real flight and its size on a phone are stage C's page proof.
- [x] B5 (W8) `runner.pause(t)` and `resume(t)` where the session's pause and resume are written; no `spoken` while paused
  - `apps/fly/src/sonic/bridge.ts` `pauseState()`: where the bridge writes the session's pause or resume it calls
    `runner.pause(t)` or `runner.resume(t)` at the same t; after a resume it reports the end of speech once (the speech.end
    marker and `runner.spoken`) when the queue is empty, else when it runs empty. `spoken()` does nothing while paused (the
    queue then holds the lesson menu's, K's or I's lines). New `syncPause()`: the page calls it on its 'pause' event
    (`feature.ts`), so the pause reaches the runner when the flight is held, not at the next frame (the menus speak at once).
    A lesson opened while the flight is paused (a recording started under its consent dialog opens the lesson again) writes
    the pause right after its open and pauses the runner, so it waits from its start; the resume comes with the flight's.
  - Tests (`sonic-lesson-keys` B5, 6): the pause and the resume reach the runner at once, at the session events' t; a question
    of ears-headphones asked before a 60 s pause is still open a second after it and is skipped 20 s of lesson time after it
    was asked (within a second); no speech.end while paused (a menu line cut the task and ended) and no named sound starts,
    one marker at the resume's own t, then the task's sound plays; resumed while a line is still said: no marker at the
    resume, one when it ends; a lesson opened in a pause has its pause after its open, says nothing more and stays in the
    task 20 s, goes on after the resume; rings-first paused 70 s (its attempt limit is 60 s) in its first attempt then flown
    through the ring: the attempt passes, and the recording replays PASS, without its session events the replay fails the
    attempt (in the test). Controls broken once and restored: the runner not told (4 fail), the end of speech while paused
    (2 fail), a lesson opened in a pause not paused (1 fails).
- [x] B6 (M41-3) Escape: the spoken lesson menu; the line at every lesson's start
  - New `apps/fly/src/sonic/lesson-menu.ts`: `LessonMenu` (Resume, Repeat the task, Next step, Previous step, Next lesson,
    Lesson list, Sound settings, Leave the mode), `DomLessonMenuView`, `runItem`, `pauseKey`. Escape in a lesson holds the
    flight first (the page's 'menu' pause; the runner waits with it at once, B5), then the view and the voice: "Lesson menu.
    The up and down arrows move, Enter chooses, Escape goes back to the lesson." cutting the lesson's speech, then "Resume. Item
    1 of 8." The arrows (and Tab) move round the ends, Home and End go to them, each item said on focus by the mode's voice
    (`menu.item`, the package's line, through the mode's speech queue and `engine.say`), cutting the one before; Enter, Space
    or a click choose, Escape resumes; a held Escape or Enter acts once. With "my screen reader speaks" the voice says the
    menu's name and how it works, not the items: the reader reads the focused item (no item said twice). For a screen reader:
    a modal dialog (`role=dialog`, `aria-modal`, labelled by its heading) holding a `role=menu` of eight `role=menuitem`
    buttons with `aria-posinset` and `aria-setsize`, the focus on the item (one in the tab order); outside #ui. While it is up
    it takes every key at the window's capture phase (the page's keys, N, B, Z, I, the digits wait) and is a dialog to the
    page (`apps/fly/src/devices/keyboard.ts` `dialogOpen` knows `.sonic-menu`: the keyboard does not fly the arrows).
  - The items: Repeat the task, Next step, Previous step and Next lesson let the flight go, then call the runner as Z, N, B
    and the runner's `nextLesson` do, recorded as those keys with the code that chose them (Enter, Space, Click); Lesson list
    and Sound settings open the mode's start screen (on its settings: `StartScreen.show(section)`, `ScreenPort.show`), which
    holds the flight itself, before the menu lets it go; Leave the mode saves the lesson (`LessonHost.close`) and opens
    `/{lang}/fly/`, the start screen's own "Leave Fly by Sound" address. P, the same binding as Escape, still opens the
    simulator's pause menu (its feedback form and the rest); over a dialog, the pause menu or with no lesson Escape is the
    page's as before. The key list names the binding "lesson menu (Esc), pause menu (P)" in the mode; K says Escape's line
    first (`sonic.say.helpMenu`). `sonic.css`: the menu in the middle, opaque, large, the focused item outlined and filled.
  - The line at every lesson's start (`lessons.ts`): right after the lesson's title, queued, "Escape: menu. Z: repeat the task.
    N: next." (`sonic.say.lessonKeys`) with the pilot's names (`KeyNames.lessonStart`, the page's `lessonKeys`); also for the
    glossary opened by G and for a lesson opened again at a recording's start.
  - Tests (`sonic-lesson-keys` B6, 8, the menu's view on `sonic-fake-dom.ts`): Escape holds the flight and pauses the runner
    at once, says the menu's name (interrupting) and Resume, the arrows, Tab, Home and End say each item and go round, the
    focus on the item said, a letter does nothing, a held Escape does not close it, Escape resumes and the lesson goes on;
    the dialog, its heading, the menu of eight named items in their places, the focus moving, the reader's mode leaving the
    items to the reader, a click choosing; rings-first flown with the menu's Next step, Repeat the task, Previous step, Next
    step and passed: the keys next, repeat, previous, next with the code Enter, four pauses and resumes, replays PASS, and not
    without its key events (in the test); Next lesson recorded as next-lesson, the lesson left skipped, rings-line opened;
    Lesson list and Sound settings with the flight held throughout (never let go between the menu and the screen), Leave the
    mode saving the progress; P the pause menu, Escape's repeat nothing; `dialogOpen` with the menu up; the line at the start
    after the title with the pilot's names (Y for Z on a German layout), not cutting, in the glossary too, and every menu word
    in the four languages. Controls broken once and restored: the menu not holding the flight (3 fail), the start screen let
    go of before it holds the flight together with the items not said on focus (2 fail), no line of the keys (1 fails),
    `dialogOpen` without the menu (1 fails).
  - Changed: `sonic-optin` K (Escape's line first, "Esc" on the key table; the ordinary page's control names Esc, N, B, R,
    L); `sonic-lesson-rig` `FakeEngine` speaks with the engine's dictionaries (`engineDicts()`: the page's own lines too, as
    the real engine); `sonic-int-replay` "rings-first to its pass, then rings-line": the pilot listens to the task, then flies
    (see "Changed tests" and "Needs from the package" 3).
  - Lines for a native reading (es, pl, ru): `sonic.say.menuTitle`, `menuOpen`, the eight item names, `helpMenu`,
    `lessonKeys`, `keys.sonic.menu`.
  - Not seen in a page yet: the menu over a real flight with a real screen reader (NVDA, JAWS) and the voice: stage C's page
    proof (and the open "real NVDA or JAWS test" of v12-optin).
- [x] B7 (W15) every line of the mode through `engine.say()`; a test fails on a `speechSynthesis` call outside the engine
  - Every line stage B adds goes through the mode's speech queue to `engine.say()` (the theme's voice level): the lesson
    menu's (`feature.ts` `sayLine`: `bridge.say` while a lesson runs, else `engine.say`), I's (the status board, as before),
    K's (as before) and the line at a lesson's start (`bridge.say`); the progress panel is drawn, not said. No code change
    was needed for it; the check is new.
  - Test (`sonic-lesson-keys` B7, 3): every `.ts` under `apps/fly/src` (comments taken out) names the browser's voice
    (`speechSynthesis`, `SpeechSynthesisUtterance`) only in the two places the engine cannot speak: the empty utterance that
    unlocks speech in the press that makes the engine (`sonic/audio.ts`, two lines, checked to say nothing) and the note
    that Fly by Sound did not load (`sonic/unavailable.ts`, which cannot reach the engine: checked to import nothing of the
    package); a planted call in the menu, the status board and the start screen, and a non-empty unlock, are each found, a
    comment is not (in the test); the menu's, I's, K's lines and the line at a lesson's start reach the rig's engine, each
    with its text from the engine's dictionaries. Control broken once and restored: a `speechSynthesis.speak` of the
    focused item added to `lesson-menu.ts` fails the first test, naming its line.
- [x] B8 tests for B1 to B7 complete, gates exit 0, stage B's status final
  - Each step's tests came with it (`tools/bench/test/sonic-lesson-keys.test.ts`, 37 tests: B1 6, B2 5, B3 5, B4 4, B5 6,
    B6 8, B7 3; the lesson rig where it has the part, `tools/bench/test/sonic-fake-dom.ts` for the panel and the menu's view),
    each with its control broken once and restored (listed under each step), and the two glossary tests of `sonic-lessons`
    are back. One letter in a test written as an escape (B18's rule).
  - `gates.py --repo C:/dev/gsfpv-v13-host` on 0896abe, exit 0: typecheck PASS; vitest PASS, 3872 passed, 9 skipped (3881:
    stage A's 3833 and 11, plus the 37 new and the 2 glossary tests back; the 9 are the 8 that need the Winter Garden scan's
    walls in `.cache` and the 1 that needs a tool or a build this machine's run lacks, as before); api-unittest,
    architecture, i18n, catalog PASS; B18 PASS (`evidence/2026-11-08/b-repo-b18.json`).

#### Stage B, final

Done: B1 to B7, one commit each, and B8 (an escape, then this status with the gates). Not pushed, nothing deployed, the live
site and the other worktrees untouched; `packages/sonic-fpv` not touched (still 16c01a1). Outside `apps/fly/src/sonic/*`
stage B changed `apps/fly/src/devices/keyboard.ts` (`dialogOpen` knows the lesson menu) and the tests in `tools/bench/test`.

Left for stage C, with the reason:

1. The page proofs of stage B's parts, in headless Chrome: the lesson menu over a real flight (Escape, the voice, the focus,
   the keys it takes, P still the pause menu, the start screen from Lesson list and Sound settings, Leave the mode), the
   progress panel's place and size on a wide page and a phone, in a dark and a light scene, the line at a lesson's start,
   K's new order, and with a real screen reader (NVDA or JAWS: still open from v12-optin). Three page proofs still expect
   v0.12 here (not gates, not run in stage B): `tools/bench/src/sonic-int-page.ts:164` and `:182` (I as `status.lesson`;
   it is `status.progress-step` or `status.progress` now), `tools/bench/src/sonic-lessons-page.ts:282-291` (Z as the last
   line again; it is the task again, the key 'repeat'; I with "Attempt n" in `status.lesson`), `tools/bench/src/sonic-optin-page.ts:395-398`
   (`status.lesson`) and `:427` (K's v0.12 order; now Escape, N, B, Z, I, G, R, T, U, L).
2. W7, `skipped` kept: the runner marks a lesson left forward with N or the menu's Next lesson as skipped (`progress().skipped`),
   but the prefs drop the field when they save it (`packages/prefs/src/doc.ts:212-221` `validSonicProgress`), so after a reload
   the start screen cannot show it; with M41-2's states on the start screen (`start-model.ts` `stateOf`).
3. Not in stage B's list: M41-1 (the pause menu's way in to `/{lang}/fly/?sonic=start`), M41-2 (the start screen's course
   from zero, Continue, the states, Reset), M41-4 (the start screen and the mode's settings as a spoken list; the lesson menu's
   Sound settings opens the start screen on its settings until then) with W13 (`motorGainDb`, `heightTarget`), W9 and W10
   (the replay of an older lesson version, its verdict line), W14 and M41-24, M41-25 (the panels).
4. A native reading of the es, pl and ru lines stage B added: `sonic.key.Escape`, `sonic.say.helpPrevious`,
   `sonic.say.helpRepeat`, `sonic.say.helpMenu`, `sonic.say.lessonKeys`, `sonic.say.menuTitle`, `sonic.say.menuOpen`, the eight
   `sonic.say.menu*` items, `sonic.progress.*` (5), `keys.sonic.next`, `keys.sonic.previous`, `keys.sonic.repeat`,
   `keys.sonic.menu`.
5. "Needs from the package" 1 to 3 (3 is new: a cue the replay derives at a speech.end marker is stamped at the last recorded
   frame, the live engine's at its last live frame; a named sound's play can end two recorded frames apart).

### Stage C

The way in, the start screen, the settings, the replay page and the page proofs of the whole lane (M41-1, M41-2, M41-4, W7, W9,
W10, W13, W19), one commit a step. The start screen's own tests are in the new `tools/bench/test/sonic-start-screen.test.ts`: the
real `StartScreen` and `SonicSetup` on `tools/bench/test/sonic-fake-dom.ts` (grown in C1 to a document with text nodes, simple
selectors, form controls, focus with its `focusin`, and a window whose capture listeners hear a key first), an in-memory prefs
store and an engine that records what it is asked to say.

- [x] C1 (M41-1) the pause menu's item opens the mode's start screen `/{lang}/fly/?sonic=start` in a new tab
  - `apps/fly/src/app/builtin/sonic-flight.ts`: `pause.flyBySound` is a link to `modeStartPage()` (new; was `soundPage()`, the
    page about the mode); `run()` opens the same with `_blank` and `noopener`. The menu draws it as a link with target _blank and
    the visually hidden "(opens in a new tab)" (`pause.newTab`, v12-optin R8), which is how it says so; its words stay review R8's
    one line. The page about the mode stays linked from the start screen's footer ("About Fly by Sound and its source code").
  - Tests: `sonic-optin` "an ordinary page gets exactly one item": the link is `/{lang}/fly/?sonic=start` in the four languages,
    the page reads it as the start screen (`parseSonicParam`), not the page about the mode, and `run()` opens it in a new tab. New
    `sonic-start-screen` C1: the footer links `/{lang}/sound/` and `/{lang}/fly/` in the screen's language, in four languages,
    and the screen's window listener goes with it. Controls broken once and restored: the item's link back to `soundPage` (the
    first fails), the footer without the About link (the second fails).
  - `sonic-int-lazy`: one title (the link's target); `sonic-lesson-keys` and `sonic-review` still pass on the grown stand-in DOM.
- [x] C2 (M41-2, W7) the start screen: the course from the beginning, Continue, the 28 lessons with their states, Reset with a
  confirm; `skipped` kept in the saved progress; "Lesson N of 28" shown and spoken
  - `packages/prefs/src/doc.ts` `validSonicProgress`: a lesson's `skipped` is kept when it is a boolean (true or false), left out
    otherwise, the lesson kept (W7; `SonicLessonProgress.skipped?`). Kept false too: the runner's progress carries `skipped: false`,
    and `saveProgress` compares with what the store holds, so dropping false would write the progress at every event.
  - `apps/fly/src/sonic/start-model.ts`: the state 'skipped' (passed; the lesson the pilot is on is in progress; skipped while the
    runner keeps it so, until it is passed; begun is in progress; else new), and `lessonPlace(id, path)`, "Lesson N of 28" by the
    rule of the runner's view (on the pilot's path when the lesson is on it, else on the full one), on every `LessonRow`.
    `store.ts` `resetProgress()`: every lesson's progress and the current lesson cleared, the sound settings kept.
  - `apps/fly/src/sonic/start-screen.ts`: "Continue: <lesson>" (its place and state under it) first when the pilot has begun;
    "Start the course from the beginning" ("Lesson 1 of 28: <title>.", and "Your progress is kept." once he has begun) opens the
    path's first lesson and touches no progress; every lesson button says its place and its state (passed, skipped, in progress,
    not started; a skipped one dashed in `sonic.css`); after the lessons, "Reset my progress" asks first in a group labelled by its
    question, the focus on "No, keep my progress", then "Yes, reset my progress"; No and Escape keep everything (over a flight the
    first Escape answers No, the next closes the screen); Yes resets, draws the screen again (every lesson new, no Continue), says
    so in the status line and puts the focus on the course's first button. Shown here and read by a screen reader (the buttons'
    names, the status line); the mode's voice says it with C3's spoken list.
  - Tests: `packages/prefs/test/sonic.test.ts` (a skipped lesson through a write, a reload, an export and an import; true and false
    kept, none for a v0.12 lesson, a non-boolean left out); `sonic-start` (the skipped state; the place equals the runner's view for
    all 28 lessons on both paths); `sonic-start-screen` C2 (5: before any lesson; Continue and the course with the progress kept;
    the 28 lessons in the path's order with "Lesson N of 28" and the four states, skipped read back from an exported and imported
    document; Reset asked, No, Escape, Yes; over a flight Escape in the question answers No). Controls broken once and restored:
    `skipped` dropped by the prefs (the prefs test and the read-back test fail), the skipped state ignored by `stateOf` (2 fail),
    the place counted on the full path only (the place test fails), Reset without its question (2 fail), Continue with the
    package's "Continue where I stopped" (1 fails).
  - Lines for a native reading (es, pl, ru): `sonic.start.course`, `.courseWhat`, `.courseKeeps`, `.continue`,
    `sonic.lessons.skipped`, `sonic.reset.button`, `.ask`, `.yes`, `.no`, `.done`, `.kept`. The count in pl and ru is in
    parentheses ("lekcjach (28)"), so no plural form depends on it.
  - Over a flight a reset clears the saved progress, but the lesson that runs keeps its runner's counts and saves them at its next
    event (that one lesson reads in progress again): not changed.
- [x] C3 (M41-4, W13) the start screen and the mode's settings a spoken list; Motor volume and Target height note
  - New `apps/fly/src/sonic/spoken-list.ts` `SpokenList`: the screen's stops in the page's order (the Tab order: the navigation,
    the Start buttons and the path, the headphone check, the 28 lessons and Reset, the settings, the footer; the 14 volume and
    pitch sliders only while their part is open). Down and Up move (round the ends; from a heading to the stop after or before
    it), Home and End go to the ends, Left and Right move a setting one step (a slider by its step, a choice to the one before or
    after, a box off and on, the path to the other one; "That is the limit." at an end), Enter gives a setting its next value (a
    button or a link keeps its own Enter). Every stop the focus reaches is said, however it came (these keys, Tab, a click, the
    navigation's jump to a heading, the page): the section's name when the focus comes into one, the words, "Item n of N" in the
    section ("Settings. Motor volume: 0 dB. Item 8 of 11."); a lesson by its title, place and state, no item number. The first key
    of a fresh page starts the sound in that press (the speech waits for a user activation) and the voice first says how the list
    works (`sonic.say.listHelp`), the stop after it. With "my screen reader speaks" the list takes no key and the voice says no stop
    and no value: the page keeps the keys a reader user knows and the reader reads the focus (the lesson menu's rule, B6).
  - `apps/fly/src/sonic/start-screen.ts`: every control registers as a stop as it is drawn; every value a setting takes is said
    once it is applied and saved ("Motor volume: -3 dB"), whether by the list's keys or the page's own (Space, a click); the reset
    question and its answers are said before the stop the focus goes to (which then does not cut them). Escape goes back with the
    voice and with a reader: out of the reset question, off the screen over a flight, else to the first of the Start buttons (from
    there, nothing). Lines through the engine only (`sonic.say.text` carries a text the page put together; W15): the engine's own
    `say` on the entry page, over a flight the page's (`ScreenPort.bind`'s new `say`: `feature.ts` gives `sayLine`, the lesson's
    speech queue while one runs, as the lesson menu's).
  - W13: "Motor volume" (`menu.setting.motor-level`, `motorGainDb`, -24 to 6 dB in 3 dB steps, after "Motor sound") and "Target
    height note" (`menu.setting.height-target`, `heightTarget`, on unless it is false), through `SonicSetup.update` like the others,
    so saved and read back. Found and fixed on the way: each volume and pitch slider built its change from the settings as they were
    when the screen was drawn, so a second slider moved without a new drawing dropped the first one's change; each change now starts
    from what is set.
  - Tests (`sonic-start-screen` C3, 7): the first key of a fresh page (the sound started, the list's help, then the stop, queued);
    Down through all 52 stops of a fresh screen in the page's order and round, one line each with the section's name on entry and
    "Item n of N", Up, Home, End; a focus by the page, a click and the navigation's jump said, Down and Up from a heading; Motor volume
    from 0 up to its limit and down through every 3 dB step to -24 and its limit, the target note by Enter, a theme by Right and its
    limit by Left, a box by a click said, all saved, read back by a new setup and a new screen; the sliders stops only while their part
    is open, a second slider keeping the first one's change, the path by Left and Right; Escape back to Continue (and nothing more
    from there), over a flight closing; the reset question said before No, the reset said before the next stop; with "my screen reader
    speaks" no key taken and nothing said (Escape still back), and over a flight the page's voice, not the engine's. Controls broken
    once and restored: no line on a focus (6 fail), no line for a new value (2), 1 dB steps for the motor (1), the list's keys on with
    a reader (1), the engine's voice over a flight (1), no section names (4), Escape not going back (2).
  - Lines for a native reading (es, pl, ru): `sonic.say.listHelp` (`sonic.say.text` is `{text}` in every language).
  - Not seen in a page yet: C6's page proof (the real DOM's focus events, the voice's lines from `engine.say`, a real reader still
    open).
- [x] C4 (W9, W19) the replay of an older lesson version speaks the recorded lines; rings-first's cue kinds pinned down
  - W9, `apps/fly/src/sonic-session/replay-player.ts`: a lesson of the recording whose notes say `lesson-version` with the recorded
    version below this build's (`olderLesson()`) is played with the lines the pilot heard: every recorded `speech` event but the
    speech.end markers (`recordedLines()`: the host's own lines among them), its text at its time on the package clock (through the
    engine: `sonic.say.text` with the text, queued as they were), and none of the lines this build's runner works out for it; once per
    replay, when such a lesson starts to play, `sonic.say.replayOlder` says it was recorded with version k of the lesson and this build
    has version m. A seek passes the lines before it; a replay from the start says them again; a stalled page does not say lines over
    half a second old in a burst; a recording of several lessons says each lesson's own lines. Its cues stay the ones this build works
    out from the frames (the package's ask names only the speech). The recorded text is said in the language it was recorded in, by the
    voice of the page's language (a recording of another language: not handled).
  - Tests (`sonicrec-replay` W9, 4): each v0.12 fixture of the package (`session-v012-rings-first.zip`, `-walls-hall.zip`) played to
    its end: first the older-version line once, with the versions, then every recorded line in order (7 and 8), each never before its
    time and at most one display frame after it, and nothing else (this build's worked-out lines, counted by an independent
    `Replayer`, none said), its cues still played; a seek to 20 s says the lines after it only, a replay from the start all again and
    the older line still once; a 25 s stall says fewer lines than were due; control in the test: the same recording claiming this
    build's version says the worked-out lines (equal to an independent `Replayer`'s) and nothing recorded. Controls broken once and
    restored: no older lessons found (3 fail), the worked-out lines said too (2 fail), no older-version line (3 fail), a seek that does
    not pass the lines before it (1 fails).
  - W19, `tools/bench/test/sonic-int-replay.test.ts` (the review asked to explain rings-first's cue kinds by the edges of the three
    plays or to fix them with W9, never only to lower the bound): pinned down as a rule of the test, not a comment. New
    `kindDifferences()` lists every frame whose cues differ by kind (the comparer's classShare, with its slack) and names its cause:
    the host's touch ping (`safety.touch`, which the replay never derives: "Needs from the package" 1), the open-way chime held from a
    sample the recording does not keep (`safety.free`), a hazard voice taken for another kind at a corner (wall, floor, ceiling,
    object), or 'other'. The test holds, for each lesson once settled, that these are exactly the frames the comparer counts and that
    none is 'other' (a play's edge would be: the lesson's own cues, every play of a named sound among them, agree on every frame by
    `beyondSafety`). Measured with stage B's flight: rings-first 16 of 2357 settled frames by kind (99.3 %; 96.8 % by sector), the touch
    ping 5 and the chime's hold 11; rings-line none once settled (its first 9 frames are the live engine's held sectors, "Needs from
    the package" 2). Stage A's flight had 29 of 2225 (touch 11, chime 10, hazard kinds 9). W9 changes none of them: it is what the player
    says, not what the replay derives. Control in the test: a lesson cue a frame short (a play's edge) and a reset cue a frame early are
    both 'other'; broken once and restored: the chime's hold not named (the test fails on rings-first).
  - Lines for a native reading (es, pl, ru): `sonic.say.replayOlder`.
- [x] C5 (W10) the replay page's summary from `replayVerdict`: pass, recorded with an older build, fail
  - `apps/fly/src/sonic-session/replay-control.ts`: the summary's sentence comes from the package's verdict (`replayVerdict` of each
    compared lesson; new `recordingVerdict()`: a recording fails when one of its lessons fails, else it is "recorded with an older
    build" when one of them is, else it passes; the checks added up into one would let one lesson's older version hide another's
    failure with this build's own version). `ReplayViewState.check` carries the `verdict`. New sentence
    `sonicrec.replay.check.older` (four languages): "Recorded with an older build of the lessons: this build cannot check it, which
    says nothing against the flight. It is played as it was recorded, with the lines the pilot heard." `replay-view.ts` marks the
    status line as bad for an error and a FAIL only, not for an older build.
  - Test (`sonicrec-replay` "the replay as the helper uses it", C5): this build's recording PASS; the package's v0.12 rings-first
    fixture opened as a file reads the older-build sentence (verdict 'older-build', the details line the package's "recorded with an
    older build"); the same flight as this build's recording moved 6 m (its flight file rewritten) reads FAIL; control in the test:
    the sentence from `ok` alone would call the v0.12 recording a FAIL; `recordingVerdict` of two lessons (older and failing: fail;
    older and passing: older build; both passing: pass). Controls broken once and restored: the sentence from `ok` alone (fails), the
    older build put before a failure in `recordingVerdict` (fails).
  - Lines for a native reading (es, pl, ru): `sonicrec.replay.check.older`.
- [ ] C6 page proofs in headless Chrome on a release build
- [ ] C7 gates exit 0; "## Final status"

## Changed tests

Each changed expectation takes its value from the package; each kept control still fails.

| Test | Change | Why |
|---|---|---|
| `sonic-primitives` "every wall a ray hits has a drawn face" | up to 200 000 draws for the 1500 free ray origins (was 20 000) | tunnel-long's bounds are 1 % free air; 300 hits are still wanted, no face missed |
| `sonic-lesson-rig` `FakeEngine.lastPreviewDir` | also reads the last `repeat-cue` | module 0's trial sound is a `repeat-cue` since v0.13 (M41-5); the answerer read only `preview` and answered blind |
| `sonic-lessons` module 0, ears-headphones | `repeat-cue` plays = the lesson's trials x `REPEAT_PLAYS` (9), each with a direction | was "3 or more previews"; M41-5 |
| `sonic-lessons` module 1, hover-height | attempt passes = `pass.required` (3); goals met >= it | was 4 of 5: format 2 counts r in total |
| `sonic-lessons` module 2, move-speed | the pilot lets go a metre short of the middle of the world's zone (was at 9 m); passes = `pass.required`; manual-start lives >= it | the zone is 7 m out and 6 m deep now (was 6 to 22 m) |
| `sonic-lessons` module 3, walls-hall | the pilot stops 0.5 m inside `stopWithinM` (1.0 m, was 2.4 m); passes = `pass.required`; the engine got the lesson's layers (safety, height, room, voice) | the small room and its 1.5 m stop; the layers of M41-10 (was "safety only") |
| `sonic-lessons` module 4, corridor | passes = `pass.required` (1); a touch resets to a point `wN` of the world's list (N at most its length); one reset to the start or more (was 2); every checkpoint of the lesson reached (cp-1 to cp-6) | r = 1, the corridor ends at `track-end`, respawn near the crash (M41-20) |
| `sonic-lessons` module 5, rings-first | gates = `pass.required` (3) | was 8 of 10 |
| `sonic-lessons` control, wrong height | the pilot leaves the respawn platform, sinks under the ring (half its lowest edge, from the world's ring) and flies on; asserts it really flew past the ring below it, and 2 failed attempts or more | the room is 5.2 m high and the ring 5.5 m ahead: the climb toward 7 m crossed the ring inside it |
| `sonic-lessons` "a restart is not a touch" | its wall control waits until the lesson flies, then flies sideways into the side wall | the first attempt begins at the start (a flight in the task is put back); straight on, the ring's plane ends every attempt before the front wall, and between attempts nothing is a touch |
| `sonic-lessons` "progress is saved at every attempt" | runs to one counted attempt short of the pass (r - 1) | three counted attempts pass the lesson now |
| `sonic-lessons` "G opens the sound glossary", "review I3" | skipped, marked for stage B; back in stage B (B2): N is pressed only while the glossary runs, and the glossary's runner is left not skipped | the glossary ends in a 'go' action (W3, W4); a press after the way back would be rings-first's own N, which moves on since B2 |
| `sonic-lessons` "N skips the intro, I says where the pilot is, Z ..." (stage B, B3 and B4) | Z pressed as a key: its key event `repeat`, the task's title said first with interrupt, more lines after it, the attempt listening; I is `status.progress-step` with the lesson's place on the path (was `status.lesson`) | Z is the runner's repeat since v0.13 (W5): the step's whole task, not the bridge's last line; I is the runner's status line (W6) |
| `sonic-optin` K in the mode and its control (stage B, B3 and B6) | the lines Escape, N, B, Z, I, G, R, T, U, L in that order (Escape alone of its binding, with the menu's line), B's and Z's the page's own; on an ordinary page Esc, N, B, R, L | K names the lesson menu and the keys that move a lesson first; B and Z do new things |
| `sonic-lesson-rig` `FakeEngine` (stage B, B6) | speaks with the engine's dictionaries, `engineDicts()` (was the package's alone) | the real engine speaks the page's own lines too (host-lines.ts), and stage B says more of them: their texts and read times are the real ones now |
| `sonic-int-replay` "rings-first to its pass, then rings-line" (stage B, B6) | the pilot listens to the task, then flies through the ring (was: flying from the open); the bounds stay (98 % by kind, 85 % by sector, every lesson cue); measured 99.8 % and 98.5 % (rings-line 100 % settled) | since stage B every lesson's start says one more line (3.4 s), in which the pilot flying from the open flew on into the front wall over and over, in a part of the flight that is no attempt's (a flight in the task is put back at the first attempt's start): 97.3 % by kind, all of W19's known kinds (the open-way chime's hold 31 frames, the touch ping 13, wall and floor flips 18). Between attempts it still flies on into the wall after each ring |
| `sonic-int-reader` "a lesson flown in this mode re-derives on replay" (stage B, B2) | N pressed in the task (it starts the first attempt), not after three attempts while flying; the recording is asserted to hold one lesson and one key | N while flying leaves the lesson and the host opens the next one: the recording held rings-line's open |
| `sonic-bridge` "the bridge writes the touch event by the runner's rule" | the craft on the floor halfway from the start to the front wall (the world's landmarks) | z = -10 is rock in the 10 x 12 m room: the touch read 'wall' |
| `sonic-bridge` "walls-hall with N, R short, R long and a contact" and its two controls | N in the task; the flight from the landmarks: a stop 1 m before the front wall's middle, a contact on the way back to the start, R short past it, R long, the stop again | N while flying leaves the lesson (M41-6); v0.12's flight (z -20 to -27.5) was beyond the room |
| `sonic-bridge` "a flight into the hall's wall" | the craft reset 1.5 m before the front wall's middle (the landmark) | was z = -28.5, rock now |
| `sonic-int-replay` "rings-first to its pass, then rings-line" | the lesson's own cues (every id but `safety.*`) agree on every frame within the comparer's slack, with a control in the test; the shares are taken once a lesson has settled (holdMs + 100 ms after its open) at 98 % by kind and 85 % by sector (were 99 % and 90 % over all frames); gates >= `pass.required` (was 8) | W19: the frames that differ are the safety layer only, each kind of difference named in the test (the touch ping and the held sectors are the package's, see below); the small rooms voice walls on most frames, so more sectors flip |
| `sonic-int-replay` control "the same glossary heard over a floor" | the craft at `ALWAYS_HEARD_M` (0.8 m) over the floor, was 1.5 m | M41-13: a still craft hears a surface by its time to contact, or within 0.8 m |
| `sonic-pilot` "walls-hall caps" and its control | flown in an open world (a floor, walls-hall's start) with walls-hall's assists | 5 s of full stick is 15 m at 3 m/s; walls-hall is a 10 x 12 m room |
| `sonic-primitives` "rays that hit an object land on its primitives" (rings-first, shapes-square) and the ring control | ray origins 4 to 10 m from an object drawn until 4000 are free (up to 40 000 draws; was 4000 draws) | in the 10 x 12.5 m rooms most such points lie in the walls: 60 to 73 hits, 100 wanted |
| `sonic-world` "N: 20 000 voxels near the surfaces and anywhere agree" | the cells the distance decided: more than 1000, or a quarter of the world's cells when it has fewer than 4000 (was 1000) | v0.13's rooms have 1890 to 2565 cells in all; the distance decided 682 to 922. Control (new): with no distance no cell is decided, under the bound |
| `sonic-world` the cost of the sweeps (4 tests), `sonic-world-flight.ts`, `sonic-world-cost.ts` | flown in v0.12's hall, pinned (`makeSpec('hall', {}, 0, 1)`) | the flights' places (z = -26, 10; x -15 to 15) are v0.12's 40 x 60 m hall; in the 10 x 12 m room they start in the rock |
| `sonicrec-recorder` "records a flight with the pilot's voice" | the manifest's lesson version is `getLesson('walls-hall').version` (2), was 1 | walls-hall is version 2 since v0.13 |
| `sonic-audio` "the defaults when nothing is saved" and "silent unless the settings ask", retitled | `motorSound` true by default (was false); the off mix still has a zero master | M41-16: the motor on by default in the mode |
| `sonic-start` "all 21 shipped lessons", "the fast path marks six" | `SHIPPED_LESSON_IDS.length` (28) and `lessonPaths().fast` (8), both also pinned; the fast lessons in the path's order | W18: six tunnels and rings-heights more, a fast path of 8 |
| `sonic-int-reader` "the intro", now "the task" | every part of the task up to the first attempt: each part's end of speech at the sum of its lines (within 40 ms), as many parts as the lesson's intro gives (a part ends at a line that names a sound), the attempt after the last part | the task is said in parts since M41-5: the first part has 2 lines, the test wanted 4 or more |

## Needs from the package

1. The host's touch ping is never derived by the replay. The simulator's mode pings every touched sample
   (`apps/fly/src/sonic/mode.ts` `touched()`, `engine.cue({ kind: 'touch' })`), in the task and between attempts too,
   where the runner records no touch event; the replay feeds the runner a touched sample at a recorded touch event but
   plays no touch cue (`src/replay/replay.ts` `Replayer.step`), the runner pushes no touch cue action (`src/lesson/runner.ts`
   `fly()`), and the package's own test host does not ping (`test/helpers/record.ts`). Shown by
   `tools/bench/test/sonic-int-replay.test.ts` (rings-first: 11 of its 29 frames that differ by kind). Ask: one owner of the
   touch ping that the replay can re-derive (for example a touch cue action from the runner at every touched sample, in
   every phase, with the touch recorded, and the host then not pinging on its own).
2. The engine is never reset at a new lesson. Each lesson restarts the host's frame clock; the sampler keeps every active
   sector `holdMs` (300 ms) on when the clock goes back (`src/sense/sampler.ts:386`, meant for a seek), and nothing calls
   `CuePlanner.reset()` (`src/cues/planner.ts:392`, "a new lesson, a seek"): `FlyBySoundEngine` (`src/audio/engine.ts`) has
   no reset a host could call. So the first 0.3 s of the next lesson voice the last one's sectors with the new geometry
   (rings-first to rings-line in the rig: `safety.ceiling:up` and `front-up` for 12 live frames with the craft at rest 2.2 m
   under the ceiling), which the replay, a fresh planner per lesson, does not derive (rings-line: 9 of 181 frames by kind,
   left out of the shares in `sonic-int-replay`). Ask: `reset()` on the engine for the host to call when it opens a lesson
   (or a reset when the frame clock goes back); the simulator then calls it in `LessonHost.open`.
3. (stage B) A cue the runner hands over at the end of speech starts at another time in the replay than live. Live, the
   engine stamps a one-off cue with its last frame's time (`src/audio/engine.ts:978` `cue()`: `lastInput.sample.t`, at most a
   live frame, about 16 ms, before the call); the replay stamps it with the planner's last plan, the last RECORDED frame before
   the input (`src/replay/replay.ts:224` `this.planner.cue(a.event)`, `t = lastT`: up to 33 ms before the speech.end marker
   that started it). A named sound's play (a `repeat-cue`, M41-5) then ends up to two recorded frames earlier in the replay,
   past the comparer's one-frame slack, and the lesson's own cues disagree on a frame: seen in the rig's rings-first flight of
   `sonic-int-replay` with the keys line left out at the recording's reopen (a variant of B6 not kept: frame 1427,
   `target.note` recorded 2 frames longer than derived, right after the speech.end at 47 296 ms). Which flights show it
   depends on where the markers fall on the 33 ms grid. Ask: stamp a cue the replay derives at its input's own time
   (`this.planner.cue(a.event, t)` with the marker's t), and let a host give the engine the time of a cue (or stamp it at the
   call); until then a flight can fail the "every lesson cue on every frame" check by chance.
