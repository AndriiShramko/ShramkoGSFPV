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
- [ ] simulator typecheck (gates `--only typecheck,architecture`)
- [ ] left for the lead: `pnpm listen:words` in the package (the words evidence test `test/words.test.ts` fails until it is run again: 534 lines now, 526 heard), `pnpm proof:audio` and `pnpm listen` (the new answer sound), the page check `tools/bench/src/sonic-int-review.ts` (a digit during the sound in headless Chrome), all gates, review

## Notes

- The answer sound and words come from the runner, so the replay re-derives them from the recorded answers. A refused digit leaves no event; its line is recorded speech the runner did not derive, which the replay treats as the host's own. Recordings made before this change lack `answer.got` and the reminders: replayed with the new runner their speech differs (`ears-headphones` and `ears-glossary` are version 3, so those are told apart as another lesson version). The v0.12 timing (`speechWait: 'v012'`) keeps the old behaviour.
- A digit in a flying lesson (no question) now gets "Not taken. There is nothing to answer now." with the "no" sound.
- Not measured: how the answer sound sounds (no `proof:audio` or `listen` run; the planner draws it from the target timbre, two notes about 0.3 s).
