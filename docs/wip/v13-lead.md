# v0.13 lead handoff: Fly by Sound after the owner's flight (message 41)

Plan and item ids (M41-n): `docs/wip/v13-plan.md`. The owner's words: the vault brief, message 41. The vault's v0.13
status note (message 41) carries the same table for the owner.

## Where things stand (2026-11-08, 11:40 UTC)

- Live: v0.12 (release of 047ee57). Nothing of v0.13 is live.
- `v03-lead`: c11417c plus 3b111fa (the plan) and this handoff, not pushed.
- Sound repo `main` 7d4b4b9; the simulator's gitlink `packages/sonic-fpv` is 1eea4d5.
- Weekly use: 56 % when v0.13 started, 60 % when s13-worlds started. No new lane above 70 %, ceiling 80 %.

| Lane | Repo | Worktree | Base | State | Workflow run |
|---|---|---|---|---|---|
| v12-optin | simulator | `C:/dev/gsfpv-v12-optin` | 8ce53fb | done: built, reviewed (R1-R12), fixed; head 4b5f8b5; gates exit 0, page proof 46 of 46, B6-B16 10 of 10, site smoke 231 of 231; merges into `v03-lead` without conflict | wf_3528a8f9-924, finished |
| s13-lessons | sound | `C:/dev/sonic-s13-lessons` | `main` 7d4b4b9 | steps 1-4 of 10 at eee530b (pass rule, lesson format 2, progress view, navigation) | wf_662547d0-d8a, running |
| s13-sound | sound | `C:/dev/sonic-s13-sound` | `main` 7d4b4b9 | steps 1-7 of 10 at 00efe02 (height glide and target tone, time to contact, open-way chime, event sounds, motor, never silent) | wf_662547d0-d8a, running |
| s13-worlds | sound | `C:/dev/sonic-s13-worlds` | s13-lessons eee530b | started | wf_6179959f-d4a, running |
| v13-host, v13-look | simulator | | after wave 1 is merged | not started | |

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

## Open from v12-optin (needs people or voices this machine does not have)

- A real NVDA or JAWS test (R5).
- A native reading of the es, pl and ru menu lines (R8 g).
- The K help lines heard in es, pl and ru.

## Next

1. When wave 1 ends: read each lane's result and review; merge the three lanes into the sound repo `main`
   (`src/contract.ts` by union; lesson JSON by keys: s13-worlds for world, start, assists and the numbers that follow
   the geometry, s13-lessons for pass, intro, speech and checkpoint meaning; catalog and locales by keys); full checks;
   gh_precheck; push the sound repo; move the gitlink.
2. Merge v12-optin into `v03-lead`.
3. Wave 2: v13-host and v13-look (the plan's lane table), one review each, fixes.
4. Merge, all gates, accept-fly B6-B16, page proofs, `deploy/ship.sh`, live checks, report to the owner.
