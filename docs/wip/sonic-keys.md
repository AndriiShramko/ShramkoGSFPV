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
- [ ] review and merge (the lead)

## Notes

- The answer sound and words come from the runner, so the replay re-derives them from the recorded answers. A refused digit leaves no event; its line is recorded speech the runner did not derive, which the replay treats as the host's own. Recordings made before this change lack `answer.got` and the reminders: replayed with the new runner their speech differs (`ears-headphones` and `ears-glossary` are version 3, so those are told apart as another lesson version). The v0.12 timing (`speechWait: 'v012'`) keeps the old behaviour.
- A digit in a flying lesson (no question) now gets "Not taken. There is nothing to answer now." with the "no" sound.
- Not measured: how the answer sound sounds (no `proof:audio` or `listen` run; the planner draws it from the target timbre, two notes about 0.3 s).
