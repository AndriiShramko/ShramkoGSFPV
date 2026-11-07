# v0.12 v12-int: the two lanes of Fly by Sound joined

Plan: `docs/wip/v12-plan.md` (sections 8 and 9 override earlier text), lead: `docs/wip/v12-lead.md`. Inputs: the Status, "Needs from sonic-core", "Left open" and "Risks" of `docs/wip/v12-flight.md`, `v12-flight-review.md`, `v12-feedback.md`, `v12-feedback-review.md`. The sound package is the submodule `packages/sonic-fpv` (`@shramko/sonic-fpv`): read its `AGENTS.md` and `src/contract.ts` first.

Worktree `C:/dev/gsfpv-v12-int`, branch `v12-int`, cut from v03-lead e681e9b (both lanes merged with no conflict: 8610380 = v12-flight ac59e8d, 5dc92fc = v12-feedback 970adbc). Each lane was tested against stand-ins for the other; this branch is the first place they run together.

## Rules

- Commit locally after every finished step, with its Status line ticked in the same commit; never push, deploy, SSH, log in to the live admin, or send a request to the live site or API. Never `git add -A`: add your own paths. Untracked `evidence/` files of other sessions are not ours.
- `packages/sonic-fpv`: never edit a file inside it; only step 1 moves its gitlink. A need there goes under "Needs from sonic-core" (the change, the reason, the failing test) with a local adapter meanwhile.
- Node: `export PATH=$HOME/node-v22:$PATH`. Browser runs only headless through `tools/bench/src/chrome.mjs`; a run that draws holds `C:/dev/.gpu-lock`; ports 5400 to 5409 only. Page runs prefer a release build (`node scripts/build-release.mjs`, then `node tools/bench/scripts/serve-csp.mjs dist <port>`, `API_PROXY=http://127.0.0.1:<port>` when `/api` is needed). `accept-fly` reads `SITE` and prints its target first: it must be the local address.
- Texts for people only in `packages/i18n/locales/**` (en, es, pl, ru); spoken lesson, cue, survey, recording and sending lines come from the package dictionary (`packages/sonic-fpv/locales`). Cyrillic or Polish letters outside locales fail B18: tests build them from code points.
- Determinism: `tools/bench/test/a6-reference.test.ts` keeps its hash `1d01ca5b...` at default settings; with the sound mode off ordinary flight does not change. Generated files (README.md, llms.txt, docs/settings.md, features.json): change sources and run `node --import tsx scripts/gen-catalog.ts`.
- A step runs the checks its change touches plus a negative control where it proves something. Every number is measured here or labelled an estimate. How a sound feels is not judged by an agent.

## Status

- [x] 1 Gitlink to sonic-core 1eea4d5 (`survey.howto` keys only, `survey.howto-voice`, `survey.mic-on`, `send.none`, `send.cancelled`); app tests that read package lines; the voice command's yes-phrase safety test holds the new lines too
  - `packages/sonic-fpv` 3959930 -> 1eea4d5 (fetched from GitHub; the one commit between them changes only the four locales, `src/i18n/catalog.ts`, its locales test and the changelog).
  - `tools/bench/test/sonicrec-send.test.ts` "the app's own words can never be taken for the pilot's yes": the lines held against the spoken yes phrases are now every `send.*` line (13, was 11) plus `rec.saved`, `rec.stopped`, `rec.off`, `rec.minor`, `help.send`, `survey.mic-on`, `survey.howto`, `survey.howto-voice` (21 in each language); the five new keys are asserted by name, so a renamed key cannot drop out. No yes phrase is heard in any of them in en, es, pl, ru. Control: the same test with the submodule checked out at 3959930 fails in all four languages (the new keys are missing); back at 1eea4d5 it passes.
  - Run: the app tests that read package lines (`sonicrec-send`, `-survey`, `-feature`, `-recorder`, `-review`, `sonic-review`, `sonic-start`, `sonic-audio`): 8 files, 163 tests pass; the package's own tests through the root config 19 files, 577 pass; typecheck of `apps/fly` and `tools/bench` pass. With the new package `survey.howto` already says keys only ("Answer with a number key. Press Escape to skip a question."), so the survey stopped promising spoken numbers at this step.
- [ ] 2 The new lines in the recorder: `survey.howto` / `survey.howto-voice` by speech recognition, `survey.mic-on` before `survey.offer` while the voice records, `send.none` when U or Send finds nothing, `send.cancelled` when a send question is declined or withdrawn; each with a test that fails before
- [ ] 3 Key I (`sonic.status`): one press says the lesson line, then the recording line, through a seam both features use (status providers in order), not two handlers; a Node test and one page check
- [ ] 4 Lazy loading: a page not entered through `?sonic=` downloads neither the package nor the mode; a chunk that fails says `sonic.say.lessonFailed`; main chunk measured against 2,806,142 / 804,183 (target within +1.5 % gzip); the lanes' entry probes run once
- [ ] 5 Replay lesson by lesson: each lesson's world drawn, its events and cues re-derived against it, the voice in sync over the whole recording; an unknown lesson keeps today's sentence; page proof A then (N) B opened while C shows, with a control
- [ ] 6 Screen-reader mode: the host queues lines in `SonicBridge.say()` so the lesson waits for them in sequence; replay markers consistent; a recording made in that mode checks on replay; a test that fails before
- [ ] 7 (next agent: its task names it; notes for it below)
- [ ] 8 (next agent)
- [ ] 9 (next agent)
- [ ] 10 (next agent)
- [ ] 11 (next agent)
- [ ] 12 (next agent)

Left for v12-int by the lead's notes and not in steps 1 to 6 (candidates for 7 to 12, the next task decides): the time bound of `sonic-world.test.ts` "contact queries cost under 20 ms" that failed once inside the parallel gate (30.5 ms); an end-to-end run of the joined page (a lesson flown, recorded, surveyed, saved, uploaded to a local API, replayed); one independent review; every gate, a release build and `accept-fly` on it.

## Needs from sonic-core

(none yet)
