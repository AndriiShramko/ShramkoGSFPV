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
| v13-host | simulator | `C:/dev/gsfpv-v13-host` | `v03-lead` 093fbbd | stage A done at aac4261 (gates exit 0; W16: tunnel-long's collider 16 % over its 10 s bench plan, 0.039 ms a frame, to v13-look; two needs from the package: a touch ping the replay derives, an engine reset at a new lesson); running: stage A (gitlink to 16c01a1 with `world.cavities`, W20 tests, W11, W12, W18, W16 measured), B (N/B/Z/I, go, pause, progress panel, Escape spoken menu, speech through the engine), C (pause item target, start screen, spoken settings with W13, W9/W10/W19, page proofs); lane doc `docs/wip/v13-host.md` | wf_9e36e296-b1f, running |
| v13-look | simulator | `C:/dev/gsfpv-v13-look` | v13-host stage A aac4261 | running (owner, message 42: in this release): L1 M41-19 bounce and slide, W17 page flight, M41-23 look, frame cost with W16; L2 M41-24 attitude display, M41-25 sound panel (W14), prefs, page proofs; lane doc `docs/wip/v13-look.md` | wf_ec1080e5-d22, running |
| s13-elev | sound | `C:/dev/sonic-s13-elev` | `main` 16c01a1 | running: E1 direction for up and down, E2 voices, review, fixes | wf_0149f60b-cbc, running |

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
- Owner, message 42 (vault brief): the look goes into this release ("how will people test it without it"; deaf pilots
  need the sound panel, low-vision pilots the attitude display), and 85 % weekly use is fine. So v0.13 ships the core
  and the look (M41-19, 23, 24, 25). The earlier "look after the reset" is withdrawn.
- Owner, message 42: keep the direction of the sound for up and down on top of the pitch. Sound repo lane s13-elev
  (worktree `C:/dev/sonic-s13-elev`, base `main` 16c01a1, wf_0149f60b-cbc): every up/down cue also comes from its
  real direction through the HRTF (broadband to about 16 kHz), pitch unchanged, a pref to turn it off; wrong way
  between close gates (LINE_UP_M scaled to the spacing); es/pl/ru line lengths and a TTS-to-Whisper round trip once
  the voices exist. Its result goes to `main` after gh_precheck, then the simulator's gitlink moves again.
- Owner, message 42: install the es, pl and ru voices. `Install-Language` and `Add-WindowsCapability` need elevation,
  which this session cannot get; the agent's access to Windows Settings came back denied. A one-click installer is on
  the owner's desktop (`Install-Shramko-Voices.cmd`, worker `U:/Temp/shramko-voices/install-voices.ps1`, log
  `install.log` there; one UAC "Yes"). Headless Chrome lists only the local Windows voices (no Google network
  voices), so the voices are needed for any es/pl/ru check. Done 2026-11-08 17:55 UTC: es-ES Helena, Laura, Pablo;
  pl-PL Adam, Paulina; ru-RU Irina, Pavel (OneCore), no restart; headless Chrome lists all of them. The desktop
  installer is removed. s13-elev E2 measures and round-trips the package's lines; the integrated review hears the
  simulator's K help and menu lines in es, pl and ru.
- In a lesson B is "previous step" (M41-6); the feedback form stays in the pause menu and in the ordinary simulator.

## Open from v12-optin (needs people or voices this machine does not have)

- A real NVDA or JAWS test (R5).
- A native reading of the es, pl and ru menu lines (R8 g).
- The K help lines heard in es, pl and ru.

## Next

1. Done: the sound repo merged, reviewed, fixed, prechecked and pushed (`main` 16c01a1).
2. Done: v12-optin merged into `v03-lead` (c2b1e54).
3. v13-host (running, three stages), v13-look (from stage A's head, two stages), s13-elev (sound repo). Ceiling 85 %.
4. s13-elev to the sound repo's `main` after gh_precheck; push.
5. Integration branch `v13-int` from `v03-lead`: merge v13-host, merge v13-look, move the gitlink to the new sound
   `main`, show the new prefs (up/down direction, sound panel, attitude display) in the mode's spoken settings list.
   One independent review of the integrated wave 2, then fixes.
6. All gates, accept-fly B6-B16, page proofs, the es/pl/ru voice checks if the voices are installed, `deploy/ship.sh`,
   live checks, report to the owner.
