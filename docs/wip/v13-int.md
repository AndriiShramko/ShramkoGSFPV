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

- [x] 1. Engine reset at a new lesson and at a seek (v13-host's need 2): `FlyBySoundEngine.reset()` and the contract's
  optional `SonicEngine.reset?()` on s13-int with a package test and its control; the host calls `engine.reset?.()`
  before a lesson's first frame and where a replay opens a lesson or seeks; `sonic-int-replay` without its settle
  window, the safety layer matched from a lesson's first frame, with a control without the call.
  - Package part: s13-int 7980fab (the sound repo's `docs/dev/status-v0.13-int.md`, I1). `test/reset.test.ts` (5
    tests; control: the same frames without `reset()` voice the held ceiling and floor sectors at 0 and 280 ms, none at
    320 ms, and keep listing the last lesson's gate note) and the audio proof `engine-reset` (the real engine in headless
    Chrome: 0 of the 18 frames of the hold with a hazard of the last lesson; control without the reset 18 of 18).
  - The simulator's part (after step 2's gitlink): `LessonHost.open` resets the engine before `mode.enter()` (the bridge's
    clock starts at 0 there; the runner's first actions reach the engine after it, on the new clock); the replay player
    resets it when it takes the engine, when the next lesson of a recording starts (right before its first frame), at a
    seek (before the frame sought) and when it gives the engine back to the live flight. `BridgeEngine`, `ReplayEngine`
    and `PageEngine` carry `reset` (optional on the first two). The rig's `FakeEngine.reset()` is the real one's (the
    planner from nothing, the last frame forgotten), with `keepOnReset` for the control.
  - Measured (`sonic-int-replay`, the rig on the package at fe1613b): with the reset, rings-first 2369 frames, 99.8 % by
    kind and 99.8 % by sector over every frame (4 frames differ, all the host's touch ping), rings-line 181 frames, 100 %
    and 100 % from its first frame; no frame of either lesson's first 0.4 s with another hazard voice than the replay's.
    Control, the same flight with an engine that forgets nothing: rings-line 95.0 % by kind (8 frames of held hazards and
    1 the comparer counts as other), 9 frames of its first 0.4 s with rings-first's sectors (the ceiling up and front-up,
    the wall front and front-right). rings-first's own shares are the same with and without the reset (99.8 %): the
    difference to stage C's 96.8 % by sector comes with the new package and flight, not with the reset.
  - Controls in the code, each run once and restored: without the host's call the main test and the control fail
    (rings-line's start; the host's three calls); without the player's call at a lesson's start its test fails.
- [x] 2. The gitlink to s13-int's head; every simulator test on the new package with its expected values from the
  package; the sound panel's real elevations tested (`sonic-panels`).
  - The gitlink at fe1613b (s13-int: 7980fab the reset, fe1613b the words check's root, below). Full vitest on it: 246
    files, 4049 passed, 9 skipped (the 8 Winter Garden tests without `.cache/scenes/7a475d38/scene.voxel.bin`, and the
    site's built templates), none failed. No simulator test pins tunnel-gaps' or walls-pillar's version, the
    `heightDirection` setting, the wrong way between gates or the engine's panners (searched `tools/bench`, `apps/fly`):
    nothing to take from the package there. The one failure on the new package was the package's own
    `test/words.test.ts` run from the simulator's root (ENOENT for `tools/listen/key-lines-v013.json`: the words check
    took its root from the working directory); fixed in the package (fe1613b), 18 of 18 from both roots.
  - The sound panel: the open way's mark from the chime's own direction (the package's `plan.freeWay.dir`, the middle of
    the way) with the pilot's "Sound from above and below" on, from the plan's side with it off; the target note
    (`height.target`) on the radar too when it comes from its target (its cue's dir, `plan.height.target.dir`), as the
    target's, marked above or below by it; off, the height bar alone. `sonic-panels` 23 of 23 (4 new); controls in the
    code, each run once and restored: without the target note's rule 2 tests fail; without the elevation from the
    direction 3 fail (the new tunnel-gaps test among them).
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
| the package's `test/words.test.ts` as the simulator's vitest runs it (step 2) | none here: fixed in the package (s13-int fe1613b, the words check's root from its own file) | it failed twice with ENOENT from the simulator's root on the new package |
| `sonic-panels` "the open way: its side from the plan" (step 2) | title only: a way above or below sounds from ahead "with the pilot's Sound from above and below off" (was "today") | since s13-elev the chime comes from the way with the setting on |
| `sonic-int-replay` "rings-first to its pass, then rings-line" (step 1) | the settle window (holdMs + 100 ms after a lesson's open) is gone: the shares (98 % by kind, 85 % by sector) and W19's causes are taken over every frame; new: no frame of a lesson's first 0.4 s with other hazard voices than the replay's, sector and all (`hazardsDifferAtStart`); the host reset the engine 3 times (rings-first, its reopen, rings-line) | the host resets the engine at every open, so nothing of the lesson before is held at the next one's start |
| `sonic-int-replay` new control "the same flight with an engine that forgets nothing" (step 1) | records the same two lessons with `FakeEngine.keepOnReset`: rings-line's start holds rings-first's sectors (9 frames measured) | the control that fails without the call |
| `sonic-int-replay` "the player plays the lessons in turn" (step 1) | the fake engine logs frames and resets: a reset first, one right before rings-line's first frame, two in all while playing; at each seek a reset, then the frame sought; a reset at close | the player resets the engine where a lesson starts or the clock jumps |
| `sonic-lesson-rig` `FakeEngine` (step 1) | `reset()` as the package's (the planner from nothing, the last frame and its cues forgotten), `resets`, `keepOnReset` | the host calls the engine's reset at every lesson it opens |
| `sonic-panels` "real elevations from the package (s13-elev) ..." (step 2) | new, 4 tests: tunnel-gaps' open way above marked by its own direction (on) and by the plan's side (off), with the bare chime's control; the target note's mark follows `plan.height.target.dir` (above, below, level), and with the setting off it stays on the bar | the package now gives the panel real elevations (lane s13-elev's "Needs from the simulator") |

## Deferred

To v0.14 by the lead (not done here):

- v13-host's need 1: the host's touch ping, which the replay never derives (one owner of the ping the replay can
  re-derive).
- v13-host's need 3: a cue the runner hands over at the end of speech is stamped at another time in the replay than live.
- v13-host's need 4: the package's word for a skipped lesson (`menu.lesson.skipped`).
- v13-look's need 1: the plan saying when the next target note sounds (the sound panel's height bar keeps the rhythm, not
  the phase).

## Decisions

- Step 2: the target note goes on the sound panel's radar when it has a direction (the package's `heightDirection` on): it
  comes from its target since s13-elev, and the radar's rule is "every active cue with a direction at its direction"; a
  deaf pilot sees where the note comes from (above or below, left or right) and not only the height on the bar. It is
  drawn as the target's (colour and glyph), so in a ring lesson it sits beside the gate's hum (the discs are pushed apart).
  Without a direction it stays on the height bar alone, as in v13-look. The page proofs of the panels (v13-look-page
  `panels`, `layout`) have not run with it: step 8.
