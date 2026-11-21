# tutor-say (train 4): say only what is new

Lane of the Fly by Sound tutorial after the first outside feedback (plan C:/dev/.gsfpv-lanes/designs/t8-plan.md Part A1,
Part B 1, Part C 2, 6, 7; brief t8-tutor-brief.md decisions 1, 7, 8, 9 outside moments). Base t7-base
03624451b8deb79d179cc9a5d07adf22f1383773; n-share merged in S1.

## Status

- [x] S1 measure and contract
  - [x] merge n-share (merge commit on tutor-say, before 11f871bd)
  - [x] (a) 11f871bd tools/bench/test/sonic-said-between-steps.test.ts: fails on the base, 4 of 4 (walls-hall: the keys line at
        step 1/2 -> 2/2; ears-headphones then walls-hall: the keys line 4 times in one session)
  - [x] (b) tools/bench/scripts/tutor-say-ax.mjs on a build of t7-base + n-share (the say path is the base's):
        evidence/2026-11-20/tutor-say/ax-base.json, 6 of 6 step changes FAIL.
        CAUSE: (1) the narrator says sonic.say.lessonKeys after the first line of EVERY step (voice), and with "my screen
        reader speaks" the same line is appended to div[data-testid=sonic-captions] role log (announced); (2) div#ui
        (role region, aria-live polite, index.html:13) announces the flight HUD's text at every step change and all the
        time (DISARMED, ANGLE, volts and timer, THR/ALT: 37-40 mutations in each 3 s window); (3) at a lesson change (N on
        the last step opens the next lesson) #ui gets 11 buttons added (the REC bar: F9, Auto, Choose a folder) and the
        focus moves body -> div[data-testid=sonic-flight]. The AX tree's named nodes do not change between two steps of
        one lesson (axAdded empty): the progress panel is not named in the AX tree.
  - [x] (c) the contract commit: SonicState.guide (packages/prefs doc.ts, test packages/prefs/test/sonic-guide.test.ts,
        NEG OK on the base), apps/fly/src/sonic/guide.ts, apps/fly/src/sonic/said-once.ts; prefs and fly typecheck rc 0;
        marker U:/Temp/gsfpv-train4/tutor-say-contract.txt
- [ ] S2 the repair (keys line once a session; only the instruction between steps; #ui quiet in a lesson; progress panel one line)
  - [x] (a) 340e8bca the line of keys once a visit (lessons.ts keysDue/keysId + LessonHost.said: SaidOnce, ids 'keys.lesson' and
        'keys.free'): sonic-said-between-steps 4/4 and sonic-hints (H1 rewritten to the new rule; it asserted keys at every
        step) pass; NEG OK on the base (lessons.ts swapped). Fly typecheck rc 0.
  - [ ] (b) #ui quiet while a lesson runs. The code differs from the plan: the quiet predicate lives in feature.ts:308
        (quietLive, not mine) and live-quiet.ts only receives it. Plan for my side without feature.ts: a named hold in
        live-quiet.ts (class LessonHold + module instance, like ui/messages.ts `messages`), quietLiveRegion quiets when
        quiet() || hold.held; the hold's predicate is registered by followProgress (progress-panel.ts, called by feature.ts
        :427 with progressNow(mode, ...)): held = a lesson shown && !mode.bridge.paused (progressNow's mode arg widened to
        `bridge?: { paused }`, the real arg is the mode). Test with the LiveElement fakes of sonic-quiet2.test.ts + NEG.
  - [ ] (c) HUD news while held reaches the captions (plan Part D risk 4): mode notes and in-place flashes go through
        ui/messages.ts tell() into .msg-stack (role status, inside #ui); relay in captions.ts: messages.watch +
        messages.log.visible(performance.now()), each new (id, at) while the hold is held -> captions.add(text [+ fix]).
        Test: tell() during a held lesson -> one caption line; not held -> none (no double announcement).
  - [ ] (d) progress-panel.ts one large line, the current instruction, no counters, not rebuilt when unchanged. LessonView
        has no instruction text: the host's say path (lessons.ts act 'say') knows the step's first non-title line; it needs
        its translated text (engine.onSpeech gives (line, text) in feature.ts; the panel's text() is the page t(), which
        does not know package keys). Pick one channel and name it; simplest: a LessonNow record next to the hold
        (instruction text + watch) written from the say path via bridge.say's resolved text or the captions add.
        Update tests naming sonic.progress rows (sonic-progress*.test.ts, sonic-review-v13.test.ts F5).
  - [ ] (e) the AX probe on my build (tutor-say-ax.mjs, build once) -> evidence ax-repaired.json; commit.
- [ ] S3 the start screen and short speech (title + main button at open; row redraw; Start flying / All lessons / Continue;
      Guide row; sonic-say-length.test.ts)
- [ ] S4 the acceptance by mouse (tutor-say-accept.mjs local and live; two pictures; gates once; What the owner should try)

## What the owner does

(S4)

## Claims

(S2-S4)

## Not verified

No person, phone or real controller took part; the screen reader path is measured through the captions region and the
Chrome accessibility tree, not with a real screen reader.

## For the lead

(none yet)

## Cost notes
- S1: the most replies went to reading the rig and the old probe to write the test and the AX probe; a shared "lesson page probe" helper (open a lesson, press N, read the hook) would make it cheaper.
- S2 run 1: the most replies went to finding where #ui's quiet rule and HUD news live (feature.ts, ui/messages.ts, hud.ts) after the plan placed them in live-quiet.ts; the design is now written in Status (b)-(d), so the next run builds without re-reading them.
