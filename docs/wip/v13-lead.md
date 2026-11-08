# v0.13 lead handoff: Fly by Sound after the owner's flight (message 41)

Plan and item ids (M41-n): `docs/wip/v13-plan.md`. The owner's words: the vault brief, message 41. The vault's v0.13
status note (message 41) carries the same table for the owner.

## Where things stand (2026-11-08, 14:15 UTC)

- Live: v0.12 (release of 047ee57). Nothing of v0.13 is live.
- `v03-lead`: v12-optin merged at c2b1e54 (no conflict); the full gates on it are running. Not pushed.
- Sound repo `main` 7d4b4b9; the simulator's gitlink `packages/sonic-fpv` is 1eea4d5.
- Weekly use: 56 % when v0.13 started, 60 % when s13-worlds started, 66 % after wave 1. No new lane above 70 %,
  ceiling 80 %.

| Lane | Repo | Worktree | Base | State | Workflow run |
|---|---|---|---|---|---|
| v12-optin | simulator | `C:/dev/gsfpv-v12-optin` | 8ce53fb | merged into `v03-lead` (c2b1e54); head 4b5f8b5, review R1-R12 fixed | wf_3528a8f9-924, finished |
| s13-lessons | sound | `C:/dev/sonic-s13-lessons` | `main` 7d4b4b9 | done: steps 1-10, review e180dbf (R1-R15), fixes; head 14e00f0; 656 tests, 9 audio proofs, lint and layout 0 | wf_662547d0-d8a, finished |
| s13-sound | sound | `C:/dev/sonic-s13-sound` | `main` 7d4b4b9 | done: steps 1-10, review 41952b7 (2 blockers, 6 majors, 8 minors, none refuted), fixes; head 3c73658; 674 tests, 9 proofs, listen 8 of 8 | wf_662547d0-d8a, finished |
| s13-worlds | sound | `C:/dev/sonic-s13-worlds` | s13-lessons eee530b | done: steps 1-8, review 030f7d0 (1 blocker, 9 majors, 7 minors, none refuted), fixes; head 067278f; 879 tests (7 merged cases skip until track-end exists); M4, M6 and R5 are the lead's merge items (lane doc "For the lead's merge") | wf_6179959f-d4a, finished |
| s13-merge | sound | `C:/dev/sonic-s13-merge` | `main` 7d4b4b9 | merging s13-lessons, then s13-sound; merge items; full checks | wf_15bb2572-e79, running |
| v13-host, v13-look | simulator | | after the sound repo is merged | not started | |

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

## Open from v12-optin (needs people or voices this machine does not have)

- A real NVDA or JAWS test (R5).
- A native reading of the es, pl and ru menu lines (R8 g).
- The K help lines heard in es, pl and ru.

## Next

1. s13-merge (running): s13-lessons and s13-sound. When s13-worlds ends: merge it into s13-merge (lesson JSON by
   keys: s13-worlds for world, start, assists and the numbers that follow the geometry, s13-lessons for pass, intro,
   speech and checkpoint meaning; catalog and locales by keys), its "for the lead's merge" items, s13-lessons' R5
   (corridor `goals[1]` = track-end), the new tunnels' and rings-heights' layers ('height', 'room'); full checks; one
   review of the integrated branch; fixes; gh_precheck over every new commit; `main` = s13-merge; push; move the
   gitlink in a `v13-base` branch for wave 2 (the simulator's sonic tests fail on the new package until v13-host and
   v13-look fix them).
2. Done: v12-optin merged into `v03-lead` (c2b1e54).
3. Wave 2: v13-host and v13-look (the plan's lane table), one review each, fixes.
4. Merge, all gates, accept-fly B6-B16, page proofs, `deploy/ship.sh`, live checks, report to the owner.
