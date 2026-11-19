# Lane sound6: Fly by Sound, the quick first lesson

Work copy C:/dev/gsfpv-center-throttle, branch sound6 (holds the 18 commits of lane sonic5, docs/wip/sonic5.md), ports
6160-6179, temp U:/Temp/gsfpv-train4/sound6. Package work copy C:/dev/ShramkoSonicFPV, branch quick1 (from train6 bd79c96;
the design says train6: the lane prompt wins). Design C:/dev/.gsfpv-lanes/designs/sound6.md. Owner's words: brief lines
531-532 (no "behind or in front" question; the quick lesson is the default; the long course is for those who need it).

## Status
- [x] S0 close sonic5 by the lead's decision of 2026-11-19 (docs/wip/sonic5.md W1.6, W1-build closed).
- [x] S1 the question about behind and in front gone from every lesson: package quick1 92bb012 (simulator commit of this
  line). The ears game asks left or right only (runner.ts SIDES, options SIDES.length); ears-walls brings the wall from
  left and right (sounds.ts APPROACHES); a shape in ears-shapes is named without a side (the design missed it: the old
  fallback said dir.front); turn-listen's intro hum from the right (its start already puts ring-1 at +104 deg on attempt
  1 and -76 deg on attempt 2; the design's text "on one side" fits it, start yaw unchanged); the cube's lines say near
  and far; headphones.q-front-back deleted. Versions ears-game 4, ears-walls 3, ears-shapes 3, turn-listen 3,
  shapes-cube 4. Ten lines measured with David, Helena, Paulina, Irina (test/fixtures/measure-tts.ps1, only the changed
  keys; the prompt's tools/measure-tts.ps1 does not exist). Test test/quick-path.test.ts 36 passed; NEG OK against
  bd79c96 (6 failed). 30 package test files that name these lessons, lines or fixtures: all pass except
  test/words.test.ts (its evidence evidence/listen/VL-4-words.json must be rewritten by `pnpm listen:words`: left for
  S5, after the lines of S2). Three tsc 0 errors. Pin not moved yet (S2 moves it with the host change).
- [x] S2 the quick path as the default, the full course second; the glossary entry of the cue 'speed.brake'.
  - [x] S2 package side: package quick1 64376d1 + 58b1d7f (simulator commit of this line). fast = ears-headphones,
    ears-walls, walls-hall, corridor, tunnel-gaps, rings-first, rings-course, free-garden (fastPath flags: ears-walls on,
    hover-height off); defaultPrefs path 'fast'. ears-headphones v4: title, one intro line (new text), "Sound 1 of 3",
    then the wall knocks (runner HEADPHONE_CUE = safety.wall); headphones.wired + os-spatial only from attempt 2 on,
    before its first trial (headphones.intro key deleted). ears-walls v4: intro.1 only. walls-hall v3: intro.1 (new
    text) plays height.tone and height.target (the design named only the tone; test/named-sounds.test.ts showed
    height.target first sounds in rings-first and only hover-height named it), then goal.1. Brake cue: CUE_IDS
    'speed.brake' after 'speed.tick', cue.speed.brake.name/.glossary, ears-glossary v4 plays it (planner: the speed
    preview carries brake: true for 'speed.brake'). Deleted keys: ears-headphones intro.2/goal.1, ears-walls
    intro.2/goal.1, walls-hall intro.2/intro.3, headphones.intro (catalog LESSONS specs: ears lessons goals 0; the
    locales test allows no goal line in module 0). Five lines measured with David, Helena, Paulina, Irina
    (measure_changed.py in the temp folder over test/fixtures/measure-tts.ps1). Tests moved with the data (counts,
    versions, the v0.12 walls-hall fixture's world test keeps only the lines this build has). quick-path.test.ts (c)
    3 new tests; NEG OK against 92bb012 (3/3 fail on the old lesson data, locales, catalog and prefs). The 51 test files
    that name these lessons, lines, paths, prefs or fixtures: 944 passed, 1 failed: test/words.test.ts (evidence
    VL-4-words.json is rewritten by `pnpm listen:words` in S5, as planned). Package tsc (three configs) 0 errors.
  - [x] S2 host side (simulator commit of this line): pin packages/sonic-fpv at 58b1d7f (local). start-screen.ts: the
    old "Start the course from the beginning" button and the path radios are gone; two buttons sonic-start-quick
    "Quick start" (primary when nothing else is; startPath('fast'): saves prefs.path, opens firstOf('fast')) and
    sonic-start-full "Full course" (startPath('full')), sub-lines menu.path.fast-what / full-what (+ courseKeeps when
    Continue exists); after Reset the focus goes to Quick start. start-model.ts: beginningId -> firstOf(path). Host
    keys sonic.start.quick, sonic.start.full added; sonic.start.course, sonic.start.courseWhat, sonic.path.legend
    removed (no other use). sound-panel.ts: 'speed.brake' has the kind 'tick' (sonic-panels.test.ts wants a kind for
    every glossary cue; the design did not list it). Tests: sonic-start-screen.test.ts (a, b, c of the design),
    sonic-start.test.ts (firstOf; fast path's second lesson ears-walls), sonicrec-recorder.test.ts (a new pilot's
    path is fast). NEG OK against HEAD 156dd1fd (start-screen.ts, start-model.ts, en.json). All 60 host test files
    tools/bench/test/sonic*: 867 tests, 0 failed. Probes moved to the new test ids (not run: S5 runs the walk):
    sonic-start-keyboard.ts, sonic-review-keys.ts, sonic-v13-page.ts, sonic-int-review.ts, sonic-optin-page.ts.
    pnpm --filter fly typecheck 0 errors; tools/bench tsc 0 errors.
- [x] S3 the seconds to the first wall sound, counted from lessonSchedule (test b): package quick1 8daf95d, pin
  packages/sonic-fpv at 8daf95d (local; simulator commit of this line). test/quick-path.test.ts (b) plays each path's
  lessons one after another through lessonSchedule with the four measured voices, every question answered right after
  it is read out. First wall knock at 58b1d7f: en 11.5 s, es 12.7 s, pl 11.9 s, ru 13.3 s: es and ru
  broke the design's 12 s, so the headphone check's intro.1 became "Headphones on, L on your left ear." (4 languages,
  measured 3.1 to 3.8 s, was 7.9 to 9.0 s). Now en 6.9, es 7.9, pl 7.1, ru 8.0 s on both paths. The quick path's
  small room flies 205.0 s after the press with David (headphone check 82.2 s with its 3 sounds, the walls 89.2 s,
  the room's intro 33.6 s; the design guessed 135 s): the test guards 210 s against new talk. NEG OK against 58b1d7f
  (locales + 4 fixtures swapped: es and ru fail). 17 package test files naming the lesson, locales or catalog: 277
  passed, 1 failed: test/words.test.ts (S5's `pnpm listen:words`, as planned). Package tsc (three configs) 0 errors.
  Host: only the key, not the text, is named (sonic-int-review.ts R7), nothing else to move.
- [x] S4 Firefox: package quick1 e4fce05, pin packages/sonic-fpv at e4fce05 (local; simulator commit of this line).
  Package: placeListener in a new DOM-free src/audio/listener.ts (the design put it in engine.ts and widened
  AudioContextLike: that type has no listener, and the Node tests cannot import the DOM-typed engine, so the helper has
  its own file and its own ListenerLike type): the AudioParams when all nine exist, else setPosition(0,0,0) and
  setOrientation(0,0,-1,0,1,0). test/listener.test.ts 5 passed (engine.start on a stand-in context with only the
  setters resolves, each setter called once); NEG OK against 8daf95d. Package tsc (three configs) 0 errors; the tests
  reading src/audio (beacon, reset, speech-voice) pass. Host: audio.ts AudioFailure 'none' | 'no-web-audio' |
  'engine-failed' (replaces the noAudio flag) and audioProblemKey; start-screen.ts showAudioProblem(): a visible
  note at the top of Start (sonic-audio-problem, was only the screen reader's live region) with the line
  sonic.start.engineFailed or noAudio and a primary 44 px button "Copy link" (sonic-copy-link, focused; the result
  linkCopied or copyFailed under it); start.ts and the headphone buttons call it. Keys sonic.start.engineFailed,
  copyLink, linkCopied, copyFailed in en, es, pl, ru. S2 leftover repaired: the host's headphone notes named the deleted
  package key headphones.intro (the raw key was shown); now lesson.ears-headphones.intro.1, and a test checks every
  package key start-screen.ts names in four languages. Tests sonic-start-screen.test.ts (5 new: (d), no Web Audio,
  Copy link both ways, no note when fine, keys) and sonic-audio.test.ts: 68 passed; NEG OK against HEAD 453e3ab5.
  All 60 host files tools/bench/test/sonic*: 862 passed, 10 skipped. fly typecheck and tools/bench tsc 0 errors.
  Not done here, for S5 (it builds anyway): the page in Playwright firefox (firefox-1543 is installed) with
  ?render=off: the engine running after a press; only if it plays, the site note names Firefox too.
- [x] S5 pin moved, package suite + listen:words, simulator gates, acceptance probe sonic-quick-walk; the Firefox page
  check of S4.
  - [x] Package full suite at e4fce05: 1422 passed, 1 failed (test/words.test.ts, its evidence waits for listen:words), 4
    skipped. listen:words needs SHRAMKO_LISTEN_PY=U:/venvs/shramko-listen/Scripts/python.exe and
    SHRAMKO_LISTEN_CACHE=U:/cache/shramko-listen (without them it stops at once); run 1 of this stage was still transcribing at the end of S5 run 1 (log U:/Temp/gsfpv-train4/sound6/listen-words.log; read its last line "words rc=" before starting it again).
  - [x] Release build at 0ba5bc66 in dist (walls copied); probe tools/bench/src/sonic-quick-walk.ts written (commit
    70ecaf3d + this one: speech timings in step 4, wait up to 60 s). Run (PORT=6161, temp walk1.json / walk2.json):
    chromium 2, 3, 5, 6, 7, 8 PASS; firefox 2, 3 PASS (the engine runs in Playwright's Firefox 1543 after the click,
    no page error: S4's fix works there). FAIL chromium/firefox 1 and chromium 9: the nav links (Start, Headphones,
    Lessons, Settings) and the footer links sonic-about, sonic-leave are under 44 px high (links, not buttons; not
    this lane's change). FAIL 4: the first wall knock comes 16.5 s after the click, not 6.9 s as S3 counted.
  - Cause of 4 (code, apps/fly/src/sonic/lessons.ts 709-723, case 'say'): the host says its keys line
    ("Next, key N. Back, key B. Repeat, key Z.", 9.9 s with David in headless Chrome) at the first line of EVERY
    lesson step; lessonSchedule (S3's count) does not hold host lines, and the runner's sound step does not wait for
    them, so the knock also plays under speech (walk2: title 1.4-3.1 s, keys line 3.2-13.1 s, intro.1 13.2-16.4 s,
    "Sound 1 of 3" queued at 12.4 s and started 16.5 s, the knock at 16.5 s, then a second keys line for the trial
    step). Claim 3 is not true in the page until this is fixed.
  - [x] (a) done in 154f5e59: lessons.ts keysDue(): a flying lesson says its keys every step as before; a listening
    lesson (world 'none', module 0) once a lesson, at the first step after its first sound or scene (repeat-cue, preview
    or a scene action). sonic-hints.test.ts: ears-headphones, ears-walls, ears-glossary, no keys before the first sound,
    then 1 in 5 steps; NEG OK against f9229f76. sonic-lesson-keys.test.ts: the glossary opened by G no longer says the
    keys with its title. All 60 host files tools/bench/test/sonic*: 864 passed, 10 skipped; fly typecheck 0 errors.
  - [x] (c) apps/fly/src/sonic/sonic.css: .sonic-start nav a, footer a min-height 44 px (inline-flex); proof: the walk.
  - [x] (b) package quick1 53a5675, pin packages/sonic-fpv at 53a5675 (local; simulator commit of this line). en
    cue.speed.brake.name "Brake notes" -> "Slow-down notes",
    measured with David 1.895 s (es, pl, ru re-measured: unchanged); package tests brake-planner, budget-wired,
    lesson-schedule, quick-path, locales: 84 passed. listen:words run 2 PASS (en 0 over 0.2, es, pl, ru 0; ru-by-David
    control 575 of 575 over, key control fires); its evidence evidence/listen/VL-4-words.json committed; test/words.test.ts
    18 passed.
  - [x] (d) release build at 7e8fb1f5 (walls copied), walk 8735ce0f: evidence/2026-11-19/sound6/sound6-walk.json: every
    step PASS, chromium 1-9 and firefox 1-4 (first wall knock 8.0 s after the click in Chromium, 8.8 s in Firefox;
    no small control at 1536x730 or 844x390; Firefox's engine running, no page error). Negative control, the same probe
    against the live site (read only): sound6-walk-live.json FAILS chromium 1, 2, 4, 6, 7, 8, 9 and firefox 1, 2, 4
    (small links; no Quick start; no wall knock within 12 s; ears-walls named no side; the glossary followed; Firefox's
    engine never started); chromium 3, 5 and firefox 3 pass there (not repaired by this lane).
  - [x] (e) gates at ce18b28c (staged tree): typecheck, vitest, architecture, i18n, catalog, b18, leaks all PASS (logs
    U:/Temp/gsfpv-gates-20261119-182638). Package full suite at 53a5675: 78 files, 1423 passed, 4 skipped, 0 failed;
    package tsc 0 errors. dist deleted.

Base: origin/main e3201fec differs from this branch only in STATE.md: not merged.

## What the owner does
1. Open https://gsfpv.flyreelstudio.eu/en/fly/?sonic=start (Chrome, Edge or Firefox), headphones on.
2. The Start screen shows two big buttons: "Quick start" (green, first) and "Full course". Click Quick start.
3. "Headphone check", one short line ("Headphones on, L on your left ear."), "Sound 1 of 3", and a wall knock about
   8 s after the click. Press key 1 for left, key 2 for right after each of the three knocks.
4. The walls lesson plays a wall coming from the left, the right, above and below, each named; never "in front" or
   "behind". The line of keys ("Next, key N. Back, key B. ...") comes once, after the first sound, not before it.
5. The small room (walls-hall) opens: the height tone and target, then you fly.
6. Key X back to Start: Continue first, then Quick start, then Full course. "Full course" still gives every lesson.
7. If the sound cannot start (an old browser), a note at the top of Start says so, names Chrome or Edge, and has a
   "Copy link" button.

## Claims
1. The package's quick path is headphones, the walls, the small room, then the flying lessons, and it is the default of
   new prefs; the headphone check plays a wall knock after one intro line. Proof (in C:/dev/ShramkoSonicFPV):
   `pnpm vitest run test/quick-path.test.ts`: 39 passed at 58b1d7f; NEG OK against 92bb012.
2. The start screen shows Quick start (first, primary for a new pilot) and Full course, no path radios; each press
   saves its path and opens its first lesson; a returning pilot sees Continue first. Proof: `npx vitest run
   tools/bench/test/sonic-start-screen.test.ts tools/bench/test/sonic-start.test.ts`: 38 passed; NEG OK against 156dd1fd.
3. After the press of either path the first wall knock comes within 12 s in every language (measured voices: en 6.9,
   es 7.9, pl 7.1, ru 8.0 s), and the quick path's small room flies within 210 s (205.0 s with David). Proof (in
   C:/dev/ShramkoSonicFPV): `pnpm vitest run test/quick-path.test.ts`: 44 passed at 8daf95d; NEG OK against 58b1d7f.
   In the page (claim 7) 8.0 s in Chromium, 8.8 s in Firefox, after the host's keys rule of claim 6.
4. The engine starts on a listener that has only setPosition and setOrientation (Firefox's), with the same pose. Proof
   (in C:/dev/ShramkoSonicFPV): `pnpm vitest run test/listener.test.ts`: 5 passed at e4fce05; NEG OK against 8daf95d.
5. When the sound does not start, the start screen shows what happened and the way on (Chrome or Edge, or a reload) at
   the top of Start with a focused Copy link button, not only in the screen reader's region; the headphone notes show
   no raw key. Proof: `npx vitest run tools/bench/test/sonic-start-screen.test.ts tools/bench/test/sonic-audio.test.ts`:
   68 passed; NEG OK against 453e3ab5.
6. A listening lesson (no world) says the line of keys once, after its first sound, not before every sound; flying
   lessons say it every step as before. Proof: `npx vitest run tools/bench/test/sonic-hints.test.ts -t listening`:
   3 passed; NEG OK against f9229f76.
7. A new pilot's quick path in the page with the mouse at 1536x730, scale 1.25: Quick start first and visible, sound on
   after one click, the first wall knock within 12 s (8.0 s Chromium, 8.8 s Firefox), the headphone check passes, the
   walls named left, right, up, down only, the small room next, Continue / Quick start / Full course on return, every
   control 44 px at 1536x730 and 844x390. Proof: `cd tools/bench && PORT=6161 npx tsx src/sonic-quick-walk.ts`
   (release build in dist): pass, evidence/2026-11-19/sound6/sound6-walk.json; against the live site it fails 10 steps
   (sound6-walk-live.json).
8. Every spoken line of the package is heard as written by Whisper in en, es, pl, ru (the brake cue's en name now
   "Slow-down notes"). Proof (in C:/dev/ShramkoSonicFPV, env SHRAMKO_LISTEN_PY and SHRAMKO_LISTEN_CACHE): `pnpm
   listen:words`: PASS at 53a5675, 0 lines over 0.2 in each language, both controls fire.

## Not verified
No person, phone or real controller took part in this lane. The walk ran in headless Chromium and Playwright's Firefox
with Windows voices; whether a real Firefox on a pilot's machine plays the 3D sound is not heard by anyone; Safari not
tried.

## For the lead
- Files changed outside the owned files: docs/wip/sonic5.md (the decision of W1.6 written in);
  apps/fly/src/sonic/sound-panel.ts (one line: the kind of 'speed.brake'); tools/bench/test/sonicrec-recorder.test.ts;
  the probes tools/bench/src/sonic-{start-keyboard,review-keys,v13-page,int-review,optin-page}.ts (new test ids);
  tools/bench/test/sonic-audio.test.ts (S4); S5: apps/fly/src/sonic/lessons.ts (keysDue), apps/fly/src/sonic/sonic.css
  (44 px links), tools/bench/test/sonic-hints.test.ts, tools/bench/test/sonic-lesson-keys.test.ts (one expectation),
  the new probe tools/bench/src/sonic-quick-walk.ts.
- THE SOUND PACKAGE FIRST: the package's head 53a5675 (branch quick1 of C:/dev/ShramkoSonicFPV, 15 commits on top of
  its origin/main e334c6e, a fast-forward) must be pushed to the package's main
  (github.com/AndriiShramko/shramko-fly-by-sound-fpv) BEFORE the page is released; the simulator's pin
  packages/sonic-fpv is 53a5675. Nothing was pushed. The package's evidence/audio-proofs.json and
  evidence/demo-check.json stay modified there, uncommitted (an earlier hand's; not re-run by this lane).
- Deploy order: the sound package push, then the page only (no API files, no rooms, no nginx).
- Live checks after the deploy: `cd tools/bench && SITE=https://gsfpv.flyreelstudio.eu npx tsx src/sonic-quick-walk.ts`
  (read only) must then pass every step.
- A question for the lead: the host's headphone check on the start screen still has a button "Play a sound behind"
  (sonic-hp-behind). It asks nothing, so S1 left it; if the owner's "no behind or in front" covers it too, it is one
  button and its line.

## Cost notes
- S0: reading the design, the sonic5 status and the brief took 4 replies; nothing would make it cheaper.
- S1: the count-based tests (lesson-schedule's measured counts, lessons' versions, progress steps) took 5 replies; the
  design could list them. Finding ring-1's position took 5 replies (a print script): a world dump helper would help.
- S2 package: 17 tests that pin counts (line totals, glossary steps and minutes, versions, the old fast path) took 6
  replies; one run of every test file that greps the changed names, then one edit script, is the cheapest order.
- S3: 14 replies; the package's vitest hides console.log, so a print helper writing a temp file cost 3 replies; the
  slow quick-path test (S1's every-lesson loop, 100 s) is the bulk of each run: `-t` on the new tests saves it.
- S2 host: 20 replies; reading the old test and probe slices took the most; a design listing every probe line that
  names a test id would save 4. One edit script per file group, then one run of tools/bench/test/sonic*, worked well.
- S4: 30 replies; the package's tsconfig.node.json (no DOM) refusing a test that imports engine.ts cost 4, and edit
  scripts whose anchors matched twice cost 3: a design naming the test tsconfig, and anchors checked with grep -c first.
- S5 run 1: 40 replies; finding how the page shows a lesson's sound (runner action 'cue' -> engine.cue -> hook
  oneShots) took 8, and listen:words' missing Python env 3: the design could name the hook fields a probe reads and the
  package's listen env paths.
- S5 run 2: 45 replies; finding why the first knock waited (the runner waits for the host speech queue) and which
  lessons have no question (ears-walls: scenes only) took 6: a design naming how a host line delays a runner sound would
  save them; listen:words re-says only changed lines (4 s with its cache), so it is cheap to re-run.
