# v0.12 lead: Fly by Sound, stage 1

Handoff of the lead. Plan: `docs/wip/v12-plan.md` (sections 8 and 9 override earlier text).

## Done

- sonic-core: `shramko-fly-by-sound-fpv` main 3959930 (stage1-rc1 41aa53e plus publication docs), 577 Node tests, 9 audio proofs, independent review with 8 fixes. Published on GitHub as public after a full-history secrets scan.

- sonic-core 1eea4d5 (pushed): the spoken lines the lanes asked for (`survey.howto` without "say the number", `survey.howto-voice`, `survey.mic-on`, `send.none`, `send.cancelled`). The gitlink still points at 3959930; v12-int moves it.
- Both lanes merged into v03-lead: 8610380 (v12-flight ac59e8d), 5dc92fc (v12-feedback 970adbc). No file was changed by both lanes, no conflict.
- v12-int merged (c6ddeba, pushed to `main` 2026-11-08): the seams joined, lazy loading (+1.46 % gzip start-up script), replay lesson by lesson, the screen-reader queue, delivery robustness, scan credits, end-to-end run 35 of 35; the review fixed 5 defects (`docs/wip/v12-int-review.md`). The lead accepts the two step-5 choices: a recording opens the running lesson again from its beginning, and the survey how-to stays keys only.
- deploy.sh (60ff0a6): the uploaded archives of releases no longer kept are pruned (incoming had 1.1 GB on a disk at 93 %).

## Running

- Nothing for v0.12: released 2026-11-08 on the owner's word (message 40).

## Next for the lead

1. The sound repo's README says the mode is live (link to `/en/sound/`), CHANGELOG, `gh_repo.py patch --homepage`.
2. Owner's message 40 (2026-11-08): (a) ordinary pilots must not meet Fly by Sound unless they choose it: the five sound keys are listed for everyone
   (`when: 'always'` in `packages/prefs/src/keymap.ts`), there is no quiet way in from the simulator, and blind pilots need a link that carries the
   mode, the lesson and the scene to share with each other (lane v12-optin); (b) a virtual listener: the sound judged the way a person would hear it
   (localization by a panel of measured HRTFs, masking, cue confusion, speech over the mix, musicality, loudness, an audio-only pilot), so testers
   get working solutions, not raw builds (research, then a rig in the sound repo).

## Left open after v12-int (not blocking the release)

- From the review's "Left open": a failed load of the recorder's chunk is silent (323 gzip bytes left of the size target for a new key); `rec.started`, `rec.stopped`, `rec.saved` queue behind lesson speech; T during an open replay starts a recording; replay edge cases (a recording begun with no lesson, a piece with no frames, saved progress not in the manifest); Z after I repeats the recording line; a WebGPU `createBindGroup` error after a scan change from the pause menu in a lesson page (`PrimitiveStage` suspected; ordinary pages do not load it).
- Needs from sonic-core: `engine.say()` with `selfVoice` off should queue like `speechSynthesis`; the replay comparer should judge a hazard voice by its kind (rings lessons replay 92-99 % of cue ids); hover-height's timers drift on replay.

## Status

- [x] sonic-core published (3959930)
- [x] step 0: the submodule, the seams and the guards on v03-lead: work commit 3b12079, then this Status commit (local, not pushed; base f094005)
  - Submodule: `packages/sonic-fpv` from `https://github.com/AndriiShramko/shramko-fly-by-sound-fpv.git`, gitlink 3959930 (sonic-core `main`, detached HEAD, one commit after the tag stage1-rc1). The URL is GitHub's, so lane worktrees need no `-c protocol.file.allow=always`. `git submodule add` also wrote `submodule.packages/sonic-fpv.url` into the shared config of the main repository (`C:/dev/ShramkoGSFPV/.git/config`), which is what lets `git submodule update --init` work in every worktree.
  - `apps/fly` depends on `@shramko/sonic-fpv` (`workspace:*`). The lockfile gains 21 lines (one new importer, every version already in it); `pnpm install --frozen-lockfile` passes. The CI checkout has `submodules: true` (`canary.yml` checks nothing out).
  - Architecture rule 7 (`scripts/check-architecture.mjs`): `packages/sonic-fpv/src` imports only itself: no package, no `@gsfpv/*`, no `playcanvas`, no `node:` module, no relative path out of the package; `import 'x'` and `import('x')` are read too. `tools/bench/test/submodule-guards.test.ts` (12 tests) runs the real scripts on a temp copy: the rule passes on the real src and fires on 7 planted violations; with the rule pointed at a wrong folder and the build guard switched off, 8 of the 12 fail (mutation check, both restored).
  - `scripts/build-release.mjs` stops with "packages/sonic-fpv is missing: run git submodule update --init" when `packages/sonic-fpv/package.json` is missing (control in the same test file). `release.json` is now `{ sha, sonic, built }`, `sonic` being the submodule's HEAD (`nogit` when it has no git dir). A real run of the script (site and simulator, exit 0: 1822 files, 313 CSP pages) wrote `"sonic":"3959930"`.
  - Seams: `app/features.ts` appends `sonicFlight`, `sonicSession`, `gpuHint` (stubs `app/builtin/sonic-flight.ts`, `sonic-session.ts`, `gpu-hint.ts`; ids `sonic-flight`, `sonic-session`, `gpu-hint`; `install` empty). `app/sonic-context.ts` augments `AppEvents` (`sonicSample: FlightSample`, `sonicEvent: SessionEvent`) and `FlightContext` (`sonic?: SonicRuntime`) with the package's types; `app/context.ts` imports it type-only, so the augmentation exists in every program that reads those types. Checked with a planted typo of the event name, in the app's and in the bench's program: both refuse it (probes removed).
  - Keys: `packages/prefs/src/keymap.ts` ships `sonic.record` T, `sonic.send` U, `sonic.status` I, `sonic.repeat` Z, `sonic.glossary` G (`when: 'always'`); labels `keys.sonic.*` in `packages/i18n/locales/fly/sonickeys/{en,es,pl,ru}.json`, worded as the package's own help lines. No handler is registered yet, so pressing them does nothing until the lanes add theirs, but they are already listed (stats card, catalogue): do not release step 0 alone.
  - Catalogue regenerated by `node --import tsx scripts/gen-catalog.ts`: 39 keyboard keys (was 34). The generator also moved the plural word of the keys tile in `locales/site/pl.json` and `ru.json`.
  - README, `AGENT_SETUP.md` and `AGENTS.md`: clone with `--recursive`, `git submodule update --init`, the sound repository named and linked, "never edit `packages/sonic-fpv` here". `pnpm install` without the submodule stops with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` (tried on a scratch workspace).
  - All gates once (`gates.py`, exit 0, logs in `U:/Temp/gsfpv-gates-20261107-150214`): typecheck 13 projects, vitest 174 files and 2706 tests (577 of them the sound package's own, run through the root config), api-unittest 320 tests, architecture, i18n (1032 strings x 4 locales), catalog (74 settings, 29 shortcut keys and 12 flying keys), B18 PASS. B18 left an untracked `evidence/2026-11-07/b-repo-b18.json`, not committed.
  - Lanes: created from the head of the Status commit, each with `docs/wip/<lane>.md` (its checklist, ownership and rules). Only the lead moves the gitlink; a lane asks under "Needs from sonic-core". Nothing here is verified by ears: how a sound feels is for the owner to judge.
- [x] v12-flight merged (8610380): steps 1-12 and the review's 7 fixes; Status `docs/wip/v12-flight.md`, review `docs/wip/v12-flight-review.md`
- [x] v12-feedback merged (5dc92fc): steps 1-11 and the review's 7 fixes; Status `docs/wip/v12-feedback.md`, review `docs/wip/v12-feedback-review.md`
  - All gates on 5dc92fc (logs `U:/Temp/gsfpv-gates-20261107-214446`): typecheck, api-unittest, architecture, i18n, catalog, B18 pass; vitest 3215 pass and 1 fail: `sonic-world.test.ts` "contact queries cost under 20 ms" measured 30.5 ms while another vitest ran on the machine. The file alone passes twice. An absolute time bound inside the parallel gate is a flake; v12-int makes it robust.
- [x] v12-int merged (c6ddeba): the seams joined, lazy loading, end-to-end run, the review's 5 fixes
  - Secrets precheck on the staged merge: 9 password-shaped hits, all test data on a line after `"pass": true` (survey answers, gate times, line keys; checked by shape), allowed once; 22 secret words, all prose or names, no value; 30 evidence pictures (the repo's convention).
  - All gates on c6ddeba (logs `U:/Temp/gsfpv-gates-20261108-022534`): typecheck, vitest 205 files 3275 pass 8 skipped, api-unittest 420, architecture, i18n, catalog, B18 PASS. Pushed to `main`.
- [x] released and checked live (2026-11-08, `main` 047ee57): before it the hub's root disk had 1.9 GB free, under the API's 2 GB guard; the backups moved to the new 10 GB volume (the vault's note on the hub's disk and volume), data/sessions became a bind mount of the volume and the store measures free space there (d2f9db9), the predeploy backup leaves the recordings out (047ee57). API via the scratch release scripts, nginx, ship: neighbours equal, smoke 302; release.json, /sound/ x4, admin bundle sha, one marked test package to Telegram and the inbox (SHA equal), deleted. The release steps are now scripts: deploy/release-api.sh, deploy/release-nginx.sh, deploy/ship.sh (it was only in the gitignored .cache/).
