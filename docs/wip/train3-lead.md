# Train 3: lead note

Source: the owner's message 51 (2026-11-14) after he flew release 4e9148cd1005 (main f91273cf). His points: progress of the walls build and of the course generation; gates spread over the well-scanned extent at eye level; the course tied to the respawn; a course editor like ordinary 3D editors inside the same scene; the laptop agent's branches and weak computers; Fly by Sound in any scene; the consultant's advice; fast flight by sound.

## Status

- [x] Wave 1 (night of 2026-11-14): lanes editor3, course3, sonic3 built their code; one review each; fixes started. No lane finished its browser proof (the GPU lock was held for 24 minutes around a Node audit; the walls build of Wroclaw holds the page's main thread for 13.5 s, 10 s and up to 21 s).
- [~] Wave 2 (2026-11-15), three chains: course3f; editor3f then laptop; sonic3f then hearing (a design document only).
- [x] Published walls of the nine catalogue scans are live since 2026-11-15: lighter re-bakes assembled by the lead in U:/Temp/gsfpv-train3/walls/release (148,581,855 bytes with the .gz copies; Wroclaw 17,615,280 raw and 9,670,306 gzip at 10 cm); deploy/release-walls.sh copies the .gz and checks the hub's free room first (7.1 GB free before the upload). Local pre-check and the live page probe: all nine pass (source published, no build, 20 passes at 25 m/s stop at the walls). The walls-published-probe of deploy/live-checks.sh passes from now on.
- [ ] Integration of train 3 (branches editor3, course3, sonic3 with the package's branch train3, laptop3), then the release by the lead.
- [ ] Lane menu (R29): moved to the next train; it touches the entry points that the sound and editor lanes change now. Parked branch menu in C:/dev/gsfpv-tracks.

## Branches after wave 1

| Lane | Worktree | Head | Status file |
|---|---|---|---|
| editor3 | C:/dev/gsfpv-voice | bb670ead | docs/wip/editor3.md |
| course3 | C:/dev/gsfpv-rooms | ec64aa44 | docs/wip/course3.md |
| sonic3 | C:/dev/gsfpv-center-throttle | 2065b16d (package branch train3, 2e1618f) | docs/wip/sonic3.md, docs/wip/sonic3-plan.md |
| laptop3 (wave 2) | C:/dev/gsfpv-site-sound | from origin/main, squash of origin/laptop-handoff | docs/wip/laptop3.md |

## Decisions of the lead

- The walls bake leaves the main thread (a worker, or slices where a call cannot move); the walls box always carries a sign of life that the compositor runs.
- The edit mode shows one set of handles at a time (Move, Turn, Size); the side window with the keys is closed when the mode opens.
- Races in rooms keep restarting with every life; they are switched off in the product (RACE_ON false).
- The sound package: lanes do not push; the integration merges the package's branch train3 into its main, pushes it and moves the pin.
- The laptop branch: the second exception to the rule of the public engine API in packages/render-pc is accepted (the view rule switches itself off when the engine's members are missing; the engine's version is pinned). The graphics note stays as the owner set it on the laptop. The branch comes in as one squash commit, as its hand-off file asks.
- Published walls: Wroclaw and University of Opole at 10 cm, ba7aa29d and 0230d903 at 20 cm, eb5f51dc and 1994c65c at 40 cm, Lublin 2f1ddf5f stays at 20 cm (its 40 cm bake failed with a GPU error), Forest Floor and Housefly at 5 cm.

## Cost

Wave 1, window 2026-11-14 20:30 to 2026-11-15 00:36 UTC: 89 USD at API prices; 31 workflow agents 68.9 USD (context up to 158 k each), the lead 20.5 USD in 28 steps at a context of up to 624 k.
