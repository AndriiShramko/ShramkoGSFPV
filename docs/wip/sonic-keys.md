---
type: lane-status
lane: sonic-keys
plan: docs/wip/sonic-keys-plan.md
---

# sonic-keys: digits of the sound tutorial, stage 1 (keys and response)

Branch `sonic-keys` here (from `origin/main` 31b1453) and branch `sonic-keys` in `C:\dev\ShramkoSonicFPV` (from `main` 09535b7). The submodule `packages/sonic-fpv` is pinned to the package's branch commit, which exists only locally (not pushed): the lead pushes the package branch, or merges it into the package's `main`, before this branch can be merged.

## Status

- [x] (a) a digit pressed while the headphone check's sound plays answers the trial (runner: `early` asks; simulator: every digit in a running lesson goes to the runner, `digit-key.ts`, `lessons.ts`)
- [x] (b) every digit acknowledged: a new one-off cue `answer` (`target.answer`: up yes, down no, soft twice waiting) and the lines `answer.got` "Taken: n", `answer.skipped`, `answer.not-now`, `answer.range` in en, es, pl, ru
- [x] (c) no long silence: while a question waits, every 7 s (`ASK_REMIND_S`) the waiting sound and `answer.waiting` (keys 1..max, 0, and the repeat key); a timeout says `answer.timeout` before what follows
- [x] (d) a failed check asks again only the trials answered wrong or not at all, without the headphone intro; the repeat key (Z) replays a trial without the intro
- [x] (e) the headphone check asks left and right only (left, right, left); `intro.2` reworded in four locales; `ears-headphones` and `ears-glossary` version 3
- [x] package tests: `test/sonic-keys.test.ts` (9; 7 fail on the old runner, 2 are controls); suite 1199 of 1200, typecheck 0
- [x] simulator test: `sonic-int-digits.test.ts` new case (fails on the old handler); `sonic-int-digits`, `sonic-lesson-keys`, `sonic-start-screen`, `sonicrec-survey` green
- [x] simulator typecheck and architecture (gates `--only typecheck,architecture`: PASS); all 42 `tools/bench/test/sonic*` files: 727 tests, 0 failed after two expected updates (`sonic-lessons` host answer with no question now `true`, `sound-panel` kind of `target.answer`)
- [x] milestone check 2026-11-11 (package `sonic-keys` 1b68c8a, 29260f9, ced1110; pin moved 7dc38d7 → ced1110):
  - `pnpm listen:words` PASS: 534 lines in each locale, heard exactly en 527, es 519, pl 524, ru 519; 0 over the bound 0.2; 17 of 17 key lines each; the wrong-voice control 534 of 534 over the bound
  - `test/words.test.ts` 18 of 18; the package suite 1200 of 1200 (52 files)
  - `pnpm proof:audio` 9 of 9 (3 files); `pnpm listen` 9 of 9 checks (43 flights rendered again)
  - page check `sonic-int-review.ts` on the local release build (serve-csp, headless, GPU lock): new probe R6 (a digit during the headphone check's sound answers trial 1 before its question, "Taken: 1" said; 7 during the next sound said back with `answer.not-now`) 5 of 5; R1 4/4, R2 4/4, R3 4/4, R4 4/4; R5 3/3 with 100 % of 3013 frames on an idle machine
  - R5 note: in 3 runs made while `pnpm listen` / `proof:audio` loaded the machine, R5 found 1 frame of about 3016 beyond the comparer's one-frame slack (frame 3005, t 100.683 s: recorded none, re-derived the five `target.fanfare` notes, i.e. the pass fanfare two frames apart); events 40 of 40 and the panel's verdict pass every time. Load-sensitive, not seen idle; the replay hook now lists `cueMismatches` so a recurrence names the frame
  - all gates (gates.py): typecheck, vitest (253 files, 4120 passed, 10 skipped), api-unittest, architecture, i18n, catalog, B18 PASS. The first vitest run failed on the submodule's old words evidence; moving the pin fixed it
  - negative control: `sonic-int-digits.test.ts` of this branch on `origin/main` 31b1453 (package 09535b7), temporary worktree: the sonic-keys case fails (`expected false to be true`, 1 of 6), the rest pass; worktree removed
  - the local `main` ref is 1120 commits behind `origin/main` (not touched); compare with `origin/main`
- [ ] fixes after the review (`docs/wip/sonic-keys-review.md`, 2026-11-12; package `sonic-keys` from ced1110):
  - [x] B2: `ears-game` and `shapes-cube` version 3 (the only other lesson with questions, `ears-headphones`, was 3 already); package 05cce74. Test `test/sonic-keys-versions.test.ts`: recordings of both made with the runner of 09535b7 (fixtures `session-v2-*.zip`; `pass` on 09535b7) are `older-build` (failed before the bump: `fail`, 3 of 5 cases); control: the same recordings replayed as version 2 are `fail`
  - [x] I1, I2, I3 and the caveat to claim 2: package 78d4315 (runner `refuse`, `refusalWord`; replay `inputsOf`); `test/sonic-keys-refusals.test.ts` 10 tests, 9 failed on ced1110 (I2 reproduced the review's number: `answer.waiting` recorded at 48267 ms, re-derived at 47400 ms), all pass after
    - I1: while the lesson says its own lines, a refusal's word is held and said right after them; a newer refusal replaces it; one held word at most per run of the lesson's speech (further digits get the "no" sound only). Measured on `RecordingHost` (`ears-headphones`): 3 digits in 0.6 s, one word, the intro longer by one word at most; a digit every 1.3 s for 400 s, the intro ends one word later at most and the trials go on
    - I2: the refused digit is a replay input (the runner writes `key` with action `answer.refused`, code `Digit<n>`; `key` events are compared with nothing), and its word is outside the lesson's own speech (`ownHanded`: the reminders wait for nothing of it). Replay `pass`: a 9 in the 6th second of a 9 s wait; digits every 0.7 and 1.3 s (ears-headphones) and 1.3 and 2.9 s (ears-game), values 0 to 9 mixed. Before the input, the words matched but the "no" sound was not derived (cues 72 to 94 % of frames): the input was needed
    - I3: a digit out of 1 to 3 during a trial's sound gets `answer.need-123` ("Press 1, 2 or 3." / «Нужна клавиша 1, 2 или 3.», es, pl), said at once; a 2 after it is still trial 1's answer. Measured with the Windows voices into the length fixtures (en 2.635 s, es 3.205 s, pl 3.42 s, ru 3.51 s; control: `answer.not-now` ru measured again 4.47 s = fixture)
    - claim 2: when the lesson says nothing of its own the word comes right after the "no" sound, cutting a reminder or an earlier refusal (test: the queue runs empty one word after the second digit). Not done: cutting the lesson's own lines (intro, question, results) to say the word first. Determinism would hold (the word is outside the runner's clocks), but the browser's speech has one queue: putting a line first means cancelling and saying the cut line again from its start, so a digit every second would restart the same line for ever (I1). Such a word waits for the end of the lines handed in one batch (the intro's lines, a question's lines)
    - typecheck 0; locale lint 0 problems (535 keys); layout 0; `test/lesson-schedule.test.ts` counts moved by the new line (391 en lines, 477 es, pl, ru)
  - [x] checks after the fixes (2026-11-12), package `sonic-keys` 05cce74, 78d4315, a0d4b73, efd5137; pin moved ced1110 → efd5137 (efd5137 differs from 78d4315 in evidence only):
    - package suite: 1214 of 1215 on 78d4315 (only `test/words.test.ts`: the words evidence lacked the new line), then 1215 of 1215 (54 files) with the new evidence; typecheck 0, locale lint 0 (535 keys), layout 0
    - `pnpm listen:words` PASS: 535 lines in each locale, heard exactly en 528, es 520, pl 525, ru 520; 0 over the bound 0.2; 17 of 17 key lines each; the wrong-voice control 535 of 535 over the bound; `test/words.test.ts` 18 of 18
    - `pnpm proof:audio` 9 of 9 (3 files); `pnpm listen` 9 of 9 checks (43 flights rendered again: the lessons' versions and the runner changed)
    - simulator: `tools/bench/test/sonic*` 42 files, 717 passed, 10 skipped, 0 failed (on 78d4315); `pnpm -r typecheck` 0 errors; `scripts/check-architecture.mjs` ok
    - page probes on the local release build b6574b6 (`scripts/build-release.mjs`; serve-csp, headless, GPU lock): R6 5 of 5, now strict: 7 during trial 2's sound said back with `answer.need-123` and never `answer.not-now`, and its `key`/`answer.refused`/`Digit7` event recorded; R5 3 of 3 (40 of 40 events, 3016 frames, cues 100 %, the panel's verdict pass). Evidence `evidence/2026-11-12/sonic-int-review-r5.json`, `-r6.json`
    - not run again: R1 to R4, the full gates (vitest of the whole tree, api-unittest, catalog, B18); not listened by a human: the new line and how the held word sounds
- [ ] review and merge (the lead). Still blocking: B1, the package's `sonic-keys` (now efd5137) exists only locally, so the pin points at a commit GitHub lacks; the lead pushes the package branch or merges it into the package's `main` (and moves the pin if that makes a new commit)

## Notes

- The answer sound and words come from the runner, so the replay re-derives them from the recorded answers. A refused digit is a `key` event with the action `answer.refused` written by the runner (review I2): the replay refuses it again, so its "no" sound and word are derived too; the word stays outside the lesson's own speech, so the runner's clocks never wait for it. Recordings made before this change lack `answer.got` and the reminders: replayed with the new runner their speech differs, and every lesson that asks a question (`ears-headphones`, `ears-game`, `shapes-cube`) and `ears-glossary` are version 3, so those are told apart as another lesson version (review B2). The v0.12 timing (`speechWait: 'v012'`) keeps the old behaviour.
- A digit in a flying lesson (no question) now gets "Not taken. There is nothing to answer now." with the "no" sound.
- Not measured: how the answer sound sounds (no `proof:audio` or `listen` run; the planner draws it from the target timbre, two notes about 0.3 s).
