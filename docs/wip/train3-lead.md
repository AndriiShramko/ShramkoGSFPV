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

## Integration A (course3 and laptop3)

Status (worker 1 stopped at its step budget; a fresh worker continues from here):
- [x] origin/main had not moved (1de775ed). Submodule packages/sonic-fpv at 598a98f9 (main's pin).
- [x] Merged with --no-ff: course3 18e6a876 (b3c9f9cb), laptop3 17a448bf (2a6310a5). No conflicts. D91 is laptop3's only
  decision number; course3 took none: no renumbering.
- [x] Seams a and b (595bdac0): fly.css `.bake-status:not(:empty)` carries the note backdrop; ui/top-row.ts `noteCrowded`
  puts the HUD note under the walls box while the box shows a line. Tests in tools/bench/test/flight-ux.test.ts (44 of 44
  pass), negative control NEG OK (both new tests fail on origin/main's fly.css and top-row.ts).
- [x] Gates once on b3c9f9cb..595bdac0 merged tree: gates.py exit 0, 'B18 PASS' 1 line (log U:/Temp/gsfpv-train3/integA/gates.log).
- [x] Release build (exit 0) and the nine published walls copied into dist/walls.
- [~] Probes: U:/Temp/gsfpv-train3/integA/run2.sh (server 5760), one line per probe in summary2.txt, logs and JSON under
  U:/Temp/gsfpv-train3/integA/ and its ev/. Done when stopped: cp-build 0, cp-wroclaw 0, cp-tunis 0, walls-published 0,
  governor-start 0, centre-throttle 0, mouse-free 1 (read its log: mouse-free.log). Still running: hid-source, wizard,
  lod-on, lod-off, lod-ref, lod-score, accept-fly, sonic-r9, rooms-two, tracks-page, a6. Then run3.sh (server 5762) repeats
  the walls store check (its first try, walls-cache 1, never started the build: the radio screen held Shift+G; fixed).
- [~] deploy/live-checks.sh: lod-view on and off on 2f1ddf5f and 70b50d42 and course-path-probe on Wroclaw added, not run.
  Left: confirm the field names it reads (page.lod.view.active, failed, missing, calls; product.engine lodBehindPenalty,
  lodUpdateAngle, lodMultiplier) against evidence/2026-11-15/lod-view/train3a-lub-on.json and -off.json.
- [ ] Left: copy the probe JSON into evidence/2026-11-15/train3a/ (JSON only; lod-view writes JPGs under
  evidence/2026-11-15/lod-view/: keep them out of the commit), write the parts below from the results, push main.

Measured so far:
- Wroclaw 70b50d42 with its folder out of dist/walls (course-path-probe, NOBOT=1 REGEN=1): walls built in the worker,
  read 95.8 s, voxelize 44.8 s, total 140.6 s, 5 cm level 2; gates drawn 153 s after Shift+G; the shown text never stood
  still longer than 2.0 s; the page answered the probe within 1.6 s; one long task, 268 ms. One regeneration: 24 gates,
  149.7 m.
- Wroclaw with the published walls: gates 6.1 s after Shift+G, 24 gates; regenerations 24/207.2 m, 24/82.0 m, 24/175.8 m
  (one of three much smaller, as course3's Left 5 saw on built walls). Tunis 887f27aa: 7.0 s, 24 gates; regenerations
  24/97.8, 24/97.0, 24/97.0 m. Crash with respawn: kind 'rewind', next gate 3 before the crash in both.
- Pictures looked at: U:/Temp/gsfpv-train3/shots/train3a-walls-line.png (the walls line "reading the scan. Step 2 of 3,
  19 %" on its dark backdrop over the sky, readable), U:/Temp/gsfpv-train3/shots/train3a-course-start.png (the end line
  "Walls built in 141 s ..." in the box and the course note "finding the free space. Step 1 of 2, 11 %" under it, no
  overlap).

Deploy order for the lead (git diff --stat f91273cf..HEAD): deploy/nginx.conf and deploy/compose.yml unchanged: nginx no.
apps/api: only tests/fixtures/tracks/valid-generated-quality.json (a test fixture): no release-api.sh, no --locales (the
changed locales are fly/course, fly/gpuhint and fly/sonic, built into the static site). apps/rooms unchanged: rooms no.
Static ship only; the published walls are already live.

Not verified (so far):
- Lane laptop3's 13 localStorage keys that packages/prefs/test/migrate.test.ts cannot see (its scan reads one-part keys):
  gsfpv.hint.macro (app/macro-hint.ts), gsfpv.tour.probe (app/tour.ts), gsfpv.course.best and gsfpv.course.offered
  (course/link.ts), gsfpv.course.voter, gsfpv.course.votes and gsfpv.course.tokens (course/store.ts), gsfpv.rooms.nick
  (rooms/nick.ts), gsfpv.hint.gpu, gsfpv.hint.soft and gsfpv.hint.said (sonic/gpu-hint.ts), gsfpv.sonicrec.profile
  (sonic-session/consent.ts), gsfpv.rooms.host.* (builtin/rooms.ts, sessionStorage). For the next train.
- Course size (lead decision 1): COURSE_DEFAULTS.gatesMax stays 24; 24 gates cover about 180 to 210 m of street
  (course3 F3 pass 2); more gates on big scans is an open product question for the next train.
- course3 Left 4: the pilot's rewind went back 12.9 s instead of respawn.rewindS (the course followed it correctly).
  course3 Left 5: on walls built in the browser one regeneration of four spanned 103.8 m against 171 to 198 m.
- Forest Floor ab5efa0e (lead decision 3): course-path-probe has no record of each life's director decision (no STEPS
  switch); not run, cause not named.
- The lane laptop3 merge brings changes to packages/i18n/locales/fly/gpuhint/* and the GPU hint files of the laptop agent
  (its squash); this integration did not edit them.
- Probes ran while the gates ran (CPU shared): the timing numbers of cp-build may be longer than on a quiet PC.

Cost notes: worker 1 spent its turns on finding each probe's arguments (one probe at a time) and on blocking waits of
10 minutes that hit the tool's limit; a table of probe command lines in docs/agent-map.md would have saved about 8 turns.
