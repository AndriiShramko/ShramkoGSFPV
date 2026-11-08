# v0.13 v13-int: the integrated branch (v13-host + v13-look + s13-elev), the engine reset, the new settings, the words

Plan: `docs/wip/v13-plan.md` (items M41-n); lead: `docs/wip/v13-lead.md`; the merged lanes: `docs/wip/v13-host.md`,
`docs/wip/v13-look.md`; the sound lane s13-elev: the sound repo's `docs/dev/status-v0.13-elev.md`.

Worktree `C:/dev/gsfpv-v13-int`, branch `v13-int`, base 8497cb4 (v03-lead cb67b0d + merge cc2a3ab of v13-host 6c164a0 +
merge 8497cb4 of v13-look 022a8d2; no conflict; gates pass on it, 3935 tests). The sound package's changes are made in the
sound worktree `C:/dev/sonic-s13-int`, branch `s13-int` (from s13-elev's head 512d7d2), committed there, and reach this
branch by moving the gitlink `packages/sonic-fpv`; nothing is edited inside `packages/sonic-fpv`. Not pushed, nothing
deployed, the live site and API never opened.

## Status

Steps 1 to 7 are this agent's; 8 to 12 belong to the next agent (the lead's prompt names them; the list below is the
lead's "Next" 5 and 6 as this branch sees them).

- [ ] 1. Engine reset at a new lesson and at a seek (v13-host's need 2): `FlyBySoundEngine.reset()` and the contract's
  optional `SonicEngine.reset?()` on s13-int with a package test and its control; the host calls `engine.reset?.()`
  before a lesson's first frame and where a replay opens a lesson or seeks; `sonic-int-replay` without its settle
  window, the safety layer matched from a lesson's first frame, with a control without the call.
- [ ] 2. The gitlink to s13-int's head; every simulator test on the new package with its expected values from the
  package; the sound panel's real elevations tested (`sonic-panels`).
- [ ] 3. Settings: the sound panel, the attitude display and the package's `heightDirection` in the start screen's
  settings and the spoken list; said with section, "Item n of N" and value; saved and read back after a reload; the
  reader's native controls with "my screen reader speaks".
- [ ] 4. The scan lesson's contact: free-garden flies with the lesson contact `{ bump: 'slide' }` while a lesson runs on
  a scan; every other flight unchanged.
- [ ] 5. Reset over a running lesson: after "Reset my progress" every lesson is new, the one under the screen too.
- [ ] 6. Words heard by the local voices: "the key" before a key's name in es, pl, ru; one register in Russian; the
  mode's name in Russian and Polish; the words check before and after.
- [ ] 7. Gates on the head; the sound repo's checks on s13-int.
- [ ] 8. (next agent) Page proofs on a local release build: the v13-host and v13-look page benches with the real progress
  panel (v13-look's stand-in goes), the two page proofs that still expect v0.12 lines (`sonic-int-page.ts`,
  `sonic-lessons-page.ts`), the new switches on the page.
- [ ] 9. (next agent) Flight regression accept-fly B6 to B16 on a local release (`SITE` the local address).
- [ ] 10. (next agent) One independent review of the integrated branch.
- [ ] 11. (next agent) The review's fixes, gates again.
- [ ] 12. (next agent) The sound repo's s13-int to its `main` after gh_precheck (the lead pushes), the gitlink on that
  commit, the merge into `v03-lead`.

## Changed tests

Each changed expectation takes its value from the package or names its reason; each kept control still fails.

| Test | Change | Why |
|---|---|---|

## Deferred

To v0.14 by the lead (not done here):

- v13-host's need 1: the host's touch ping, which the replay never derives (one owner of the ping the replay can
  re-derive).
- v13-host's need 3: a cue the runner hands over at the end of speech is stamped at another time in the replay than live.
- v13-host's need 4: the package's word for a skipped lesson (`menu.lesson.skipped`).
- v13-look's need 1: the plan saying when the next target note sounds (the sound panel's height bar keeps the rhythm, not
  the phase).

## Decisions

