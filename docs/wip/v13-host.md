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
- [ ] B2 (W4) the 'go' action: N in a flying lesson moves on, B goes back, G goes and comes back, never a second advance
- [ ] B3 (W5, M41-6) N, B and Z call the runner, each a key event the replay reads first; the mode's keys win in a lesson;
  K names N, B, Z, I and Escape
- [ ] B4 (W6, M41-7) I says `runner.statusLine()`; a large high-contrast progress panel draws `runner.view()`
- [ ] B5 (W8) `runner.pause(t)` and `resume(t)` where the session's pause and resume are written; no `spoken` while paused
- [ ] B6 (M41-3) Escape: the spoken lesson menu; the line at every lesson's start
- [ ] B7 (W15) every line of the mode through `engine.say()`; a test fails on a `speechSynthesis` call outside the engine
- [ ] B8 tests for B1 to B7 complete, gates exit 0, stage B's status final

### Stage C

(the next agent fills this)

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
| `sonic-lessons` "G opens the sound glossary", "review I3" | skipped, marked for stage B | the glossary ends in a 'go' action the host does not take yet (W3, W4) |
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
