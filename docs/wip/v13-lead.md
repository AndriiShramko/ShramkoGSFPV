# v0.13 lead handoff: Fly by Sound after the owner's flight (message 41)

Plan and item ids (M41-n): `docs/wip/v13-plan.md`. The owner's words: the vault brief, message 41. The vault's v0.13
status note (message 41) carries the same table for the owner.

## Where things stand (2026-11-08, 17:35 UTC)

- Live: v0.12 (release of 047ee57). Nothing of v0.13 is live.
- `v03-lead`: v12-optin merged at c2b1e54, all gates pass on it. Not pushed.
- Sound repo `main` 16c01a1, pushed: s13-lessons, s13-sound and s13-worlds merged (s13-merge), one review of the
  integrated branch (ab7f591: 3 majors, 3 minors, 1 nit, none refuted), all fixed; 1062 tests, 9 audio proofs, listen
  8 of 8 (inputs fa57e9492aa8). gh_precheck over 7d4b4b9..16c01a1: two W hits in `locales/es.json`, both the key
  `lesson.*.pass` followed by a Spanish praise line, read under a mask and allowed once; the word "token" is SAPI's
  voice token; three zips are synthetic session fixtures. No key, no machine path but `GPU_LOCK`'s default.
- The simulator's gitlink `packages/sonic-fpv` is still 1eea4d5 on `v03-lead`; v13-host moves it.
- Weekly use: 56 % when v0.13 started, 60 % when s13-worlds started, 66 % after wave 1, 70 % when v13-host started.
  No new lane above 70 %, ceiling 80 %.

| Lane | Repo | Worktree | Base | State | Workflow run |
|---|---|---|---|---|---|
| v12-optin | simulator | `C:/dev/gsfpv-v12-optin` | 8ce53fb | merged into `v03-lead` (c2b1e54); head 4b5f8b5, review R1-R12 fixed | wf_3528a8f9-924, finished |
| s13-lessons | sound | `C:/dev/sonic-s13-lessons` | `main` 7d4b4b9 | done: steps 1-10, review e180dbf (R1-R15), fixes; head 14e00f0; 656 tests, 9 audio proofs, lint and layout 0 | wf_662547d0-d8a, finished |
| s13-sound | sound | `C:/dev/sonic-s13-sound` | `main` 7d4b4b9 | done: steps 1-10, review 41952b7 (2 blockers, 6 majors, 8 minors, none refuted), fixes; head 3c73658; 674 tests, 9 proofs, listen 8 of 8 | wf_662547d0-d8a, finished |
| s13-worlds | sound | `C:/dev/sonic-s13-worlds` | s13-lessons eee530b | done: steps 1-8, review 030f7d0 (1 blocker, 9 majors, 7 minors, none refuted), fixes; head 067278f; 879 tests (7 merged cases skip until track-end exists); M4, M6 and R5 are the lead's merge items (lane doc "For the lead's merge") | wf_6179959f-d4a, finished |
| s13-merge | sound | `C:/dev/sonic-s13-merge` | `main` 7d4b4b9 | done: merges, merge items, review ab7f591, fixes; head 16c01a1 = `main`, pushed | wf_15bb2572-e79, wf_586638f5-472, finished |
| v13-host | simulator | `C:/dev/gsfpv-v13-host` | `v03-lead` 093fbbd | running: stage A (gitlink to 16c01a1 with `world.cavities`, W20 tests, W11, W12, W18, W16 measured), B (N/B/Z/I, go, pause, progress panel, Escape spoken menu, speech through the engine), C (pause item target, start screen, spoken settings with W13, W9/W10/W19, page proofs); lane doc `docs/wip/v13-host.md` | wf_9e36e296-b1f, running |
| v13-look | simulator | | after v13-host | after the weekly reset (2026-11-12 12:00 UTC): M41-19, 23, 24, 25, W14, W16's fix if needed, W17 | |

## Decisions taken

- s13-worlds starts from s13-lessons at eee530b, so its lesson files are written in lesson format 2 and need no
  migration. Merge order in the sound repo: s13-lessons, s13-sound, s13-worlds.
- The world's checkpoint list: `AnalyticWorld.checkpoints?: readonly WorldCheckpoint[]`,
  `WorldCheckpoint { pos: Vec3; dir: Vec3; stage?: number }`, `stage = k` only on the checkpoint that ends stage k.
  The runner (s13-lessons) feature-detects it for wrong way, respawn and stages.
- The package hands out the cavity boxes of each lesson world; the simulator stops mirroring the generators
  (`apps/fly/src/sonic/primitives.ts` `cavityBoxes()`), which v13-look switches over. Until then the simulator's
  mirror test fails on version 2 worlds, as expected.
- Generators keep building every published version, so v0.12 recordings still rebuild and verify.
- The pause menu item from v12-optin opens `/{lang}/sound/`; M41-1 wants `/{lang}/fly/?sonic=start`: v13-host
  changes the target.
- The hub volume stays 10 GB (owner, message 41); nothing moves to it in this stage.
- Merge of the sound lanes (s13-merge): s13-sound's planner wins over s13-lessons' placeholder cues; lesson JSON
  takes `layers` from s13-sound and the rest from s13-lessons (one version 2); `walls-hall` is now the smallest room
  (s13-worlds: "A small room", stop within 1.5 m) and its lines say to fly slowly until the knocks start
  (time-to-contact rule); a recording of an older build gets its own replay verdict instead of FAIL.
- Wave 2 within the ceiling: when the sound repo is merged, the core of v13-host goes first (gitlink move with the
  switch to `world.cavities`, the simulator's sonic tests on the new package, the lesson keys and spoken menu, the pause
  item target, the motor hookup, the replay verdict, 28 lessons on the start screen, M41-19 no sticking). The visual
  items (M41-23 voxel look, M41-24 horizon, M41-25 sound panel) start after the weekly reset unless use allows.
- The lanes' notes (`docs/wip/*` of the sound repo) were never in its public `main`; stage 1 published its notes as
  `docs/dev/status-*.md` and `review-*.md`. v0.13 follows that: the lane notes move to `docs/dev/` at the end of the
  merge, after a secrets check over every new commit.

- No separate `v13-base` branch: v13-host's first commit moves the gitlink with the switch to `world.cavities`
  (review W1 + W2) and the lane updates the simulator tests (W20) on the same branch.
- v0.13 ships the core (lessons, sound, rooms, tunnels, keys, spoken menu, start screen, settings, replay verdict); the
  look (M41-19, 23, 24, 25) ships after the weekly reset as the next release.
- In a lesson B is "previous step" (M41-6); the feedback form stays in the pause menu and in the ordinary simulator.

## Open from v12-optin (needs people or voices this machine does not have)

- A real NVDA or JAWS test (R5).
- A native reading of the es, pl and ru menu lines (R8 g).
- The K help lines heard in es, pl and ru.

## Next

1. Done: the sound repo merged, reviewed, fixed, prechecked and pushed (`main` 16c01a1).
2. Done: v12-optin merged into `v03-lead` (c2b1e54).
3. v13-host (running, three stages). When it ends: check the weekly use; at 78 % or less one review of the lane and
   its fixes, else after the reset. Review and fixes: a second workflow, same worktree.
4. Merge v13-host into `v03-lead`, all gates, accept-fly B6-B16, page proofs, `deploy/ship.sh`, live checks, report
   to the owner.
5. After the reset: v13-look, one review, fixes, release.
