# v0.12 review of v12-int (independent review)

Reviewer: one agent, one pass over `e681e9b..v12-int` (14 commits, 76 files outside `evidence/`, head when the review began: `1fe8fbc`), worktree `C:/dev/gsfpv-v12-int`. Rules as in `docs/wip/v12-int.md`: commit locally, never push, deploy, SSH, log in to the live admin or send a request to the live site or API; one commit per defect, with a test that fails before the fix; the sound package is never edited (a need goes under "Needs from sonic-core"). What a sound feels like is not judged here: headless Chrome is muted.

## Status

- [x] 0 Read: the plan (sections 8 and 9), the lead's handoff, the Status, "Needs from sonic-core", "Left open" and "Risks" of both lanes and of their reviews, `packages/sonic-fpv/AGENTS.md` and `src/contract.ts`, the gsfpv skill and its traps; then the whole int diff outside `evidence/`: `boot.ts`, the feature shim and `sonic/feature.ts` (diffed against the old feature body: moved as it was, apart from the seams), `entry-state.ts`, `lazy-start.ts`, `unavailable.ts`, `start.ts`, `i18n.ts`, `sonic-status.ts`, `sonic-view.ts`, `lessons.ts`, `bridge.ts` (the sequential queue), `lesson-world.ts`, `sonic.css`, `sonic-session/{session,recorder,survey,survey-view,clock,registry,reasons,save,texts,panel,send-control,upload,replay-segments,replay-check,replay-control,replay-player,replay-host}.ts` (diffs, and in full where a finding came from them), the four `sonicrec` dictionaries, `apps/api/{session_delivery,sessions}.py` (the diff and the code around it), and the package's `replay/{rebuild,compare}.ts`, `audio/engine.ts` `say`, `audio/speech.ts`.
- [x] I1 keyboard: a digit pressed for the recorder's survey also answered the question the lesson had asked

## Findings

### I1 (keyboard, fixed) The survey's digits answered the lesson's pending question as well

- Defect. The mode installs a `keydown` handler on the window (capture phase) when it starts, so that a digit answers the question a lesson has asked (module 0 asks all the time) and 0 skips it. The recorder's survey puts its own capture on the same window much later, when a recording is stopped, and says in its header that it takes every key "before the key router and keyboard flying". A browser runs the listeners of one target and phase in the order they were added, and `stopImmediatePropagation` only keeps the ones AFTER it from running: the mode's handler, added first, ran first. So a recording stopped while the lesson was asking (the owner's school test: children spend the first session in module 0) gave the survey's "1" for yes to the lesson as an answer, and every digit after it to the next question, with the lesson's feedback and its next question spoken over the survey. The same held for the start screen over a flight, a replay and the pause menu: any digit pressed while the flight was held answered the question behind them.
- Probe (refuting attempt, real page: release build `d63663e` behind `serve-csp.mjs`, headless Chrome 156 with a fake microphone, keyboard only, `tools/bench/src/sonic-int-review.ts r1`, evidence `evidence/2026-11-08/sonic-int-review-r1-before.json`): ears-headphones, T T records, the intro skipped with N, the first question pending, T stops, the survey is offered, 1, 3, 3 pressed. The lesson received `answer ears-headphones:1:1:side value 1 via key` and `asking` went false after the "yes": 3 of 4 checks, the failing one this. Control in a page of its own (no survey): the same digit answers the question, so the probe can see a lesson answer.
- Test that failed before the fix: `tools/bench/test/sonic-int-digits.test.ts` (5 tests), the mode's handler and the survey's capture on one fake window that runs listeners in the order they were added, as a browser does. Before: "while the survey runs its digits answer the survey and not the lesson" failed (`expected [ 1 ] to deeply equal []`). Controls that pass before and after: with the flight running a digit answers (and 0 skips); a handler that does not look at the pause (the feature as it was) runs before the survey's capture and answers for it; a held key, a shortcut, a text field and a page with no question are not answers.
- Fix: the handler moved out of `sonic/feature.ts` into `sonic/digit-key.ts` (`digitAnswerHandler`, same rules) and told whether the flight is held (`ctx.session.paused`): a question waits with the flight, and a digit belongs to what is on top of it (the survey, the start screen, a replay, the pause menu). The survey holds the flight (`ctx.pause('panel')`) before it listens, so nothing else is needed on its side. After the survey the flight goes on and the question is still waiting.
- Checks run: `sonic-int-digits` 5, `sonic-mode`, `sonic-lessons` (37 tests in the three files); typecheck of every package; architecture; page run on a release build of the tree with the fix: 4 of 4 (`evidence/2026-11-08/sonic-int-review-r1.json`: no lesson answer, `asking` still true after the survey's digits).

## Refuted

Each was a suspicion tested by reading the code or by a probe, and found to be fine.

- Ordinary flight changed with the mode off: `tools/bench/test/a6-reference.test.ts` passes (hash `1d01ca5b`); the start-up script, measured here with `tools/bench/scripts/main-closure.mjs dist/fly/assets` on the build of `d63663e`, is 2,944,016 bytes, gzip level 9 850,944 (+1.46 % over 838,687), the numbers of the Status to the byte; the static import closure of `main-*.js` holds `api`, `texture`, `entity`, `constants`, `storage-buffer` and no chunk with the sound package (`builtin-*`, `lazy-start-*`, `feature-*`, `session-*`); no module outside `sonic-session/` calls `t('sonicrec...')`, so taking that namespace out of the eager glob loses no text for an ordinary page.
- The yes of the survey's offer cut off `survey.mic-on`: it can be cut (the offer takes the first key, as a lane test says) but only by a pilot who answers before the sentence ends, and the sentence is said again on every survey; not a defect.
- Two copies of a recording to the owner, or a lost one, from the stale-claim rule of step 8: read `_release_stale`, `_claim`, `_sent`, `_failed`, `_reindex`, `due`, `resend` and `recover`. The thread that sends for a channel is the only one that looks at its claims, so a claim it finds is a record that was not written; `resend` replaces the channel's record whole (`staleRequeues` goes with it); a failed write in `_claim` raises into `_loop`, which catches it and tries again after 2 s. Two copies after a lost record is the stated price.
- The idle reservation sweep taking an upload that is receiving a chunk: `put_chunk` registers `_inflight` under `_mu`, `_drop_idle` looks at it under the session's lock; the window between the two costs a chunk the client sends again after the 404 (`unknown`) that makes it start again, never a recording.

## Left open

(filled in as the review goes)

## Needs from sonic-core

(none so far)

## Not read

(filled in at the end)
