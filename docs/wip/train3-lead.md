# Train 3: lead note

Source: the owner's message 51 (2026-11-14) after he flew release 4e9148cd1005 (main f91273cf). His points: progress of the walls build and of the course generation; gates spread over the well-scanned extent at eye level; the course tied to the respawn; a course editor like ordinary 3D editors inside the same scene; the laptop agent's branches and weak computers; Fly by Sound in any scene; the consultant's advice; fast flight by sound.

## Status

- [x] Wave 1 (night of 2026-11-14): lanes editor3, course3, sonic3 built their code; one review each; fixes started. No lane finished its browser proof (the GPU lock was held for 24 minutes around a Node audit; the walls build of Wroclaw holds the page's main thread for 13.5 s, 10 s and up to 21 s).
- [x] Wave 2 (2026-11-15, 00:36 to 04:16 UTC), three chains. course3f finished all four stages; laptop3 is accepted (a big scan from above at 0.5 to 1 M is still smeared in the near part); hearing: the design document docs/wip/sonic-headtrack-plan.md on branch sonic3; editor3f and sonic3f did not finish their browser proofs because the proofs found real faults (the gate bar hides after a drag, a second Space does not disarm, a gate added by a floor click stands behind the camera; no course by sound on a real scan was ever counted as passed: the earlier 'passed' rows were lessons that moved on after a failure).
- [x] Integration A (course3 and laptop3): main ca5760fd, live since 2026-11-15 05:48 UTC as release a1c494cdd368; deploy/live-checks.sh 15 of 15 PASS (U:/Temp/gsfpv-train3/live-ca5760fd). Section 'Integration A' below.
- [x] Wave 3 (2026-11-15, 04:16 to 07:28 UTC): lanes editor3g (C:/dev/gsfpv-voice, branch editor3) and sonic3g (C:/dev/gsfpv-center-throttle, branch sonic3), three narrow stages each with up to three passes. sonic3 is ready: the ear pilot flies a course made by N to its end with a counted pass on Wroclaw, Tunis and Housefly at 5 m/s; the switch in place keeps the speed; speed lessons and the lesson turn-listen. editor3 works on Wroclaw (handles, bar, kinds, copy, delete, undo, a gate by a floor click, the pad's test flight, Save) and has faults on Tunis (Save refused, turn rings, no click target), an unreadable Size tool and the flight's windows over the edit view.
- [x] Integration B (sonic3 with the sound package): main a7f39528, package b05aeda, live since 2026-11-15 08:45 UTC as release 6ee5c711d7d3. Section 'Integration B (sonic3)' below; the live checks and the repair of the probe's flight on Tunis are in STATE.md, first bullet.
- [~] Wave 4 (from 2026-11-15 07:28 UTC): lane fix3a (C:/dev/gsfpv-rooms, branch fix3a from main ca5760fd: the walls store, the guide to the next gate, gate 1 nearest to the scan's spawn; status docs/wip/fix3a.md); lane editor3h (C:/dev/gsfpv-voice, branch editor3: Tunis, the Size tool, the flight's windows hidden in the edit mode, the whole owner's path once more); lane laptop4 (C:/dev/gsfpv-site-sound, branch laptop4 from main a7f39528: a big scan from above at 0.5 to 1 M), started 09:10 UTC when integration B freed a slot.
- [~] Lane editor3h ended 2026-11-15 10:05 UTC with no stage finished (branch editor3 at e4639107): the handles are larger than the gate, two turn rings are edge-on and give no turn, parts of the flight stay in the edit view, the keyboard test flight does not leave the ground, Save on Tunis is refused on the start leg (generator and check: lane fix3a's follow-up). The lead looked at editor3-size-1920.png and editor3-turn-1920.png and wrote decisions D1 to D8 into lane editor3i (framing of the selected gate, handles as in ordinary 3D editors, the selected gate marked, edge-on rings can be taken, the flight's parts out of the edit view, the top bar's line, the phone, the keyboard test flight). Lane editor3i runs from 10:10 UTC (workflow run wf_584b0c34-376), three stages I1-gizmo, I2-clean, I3-prove, one review.
- [x] Lane fix3a finished 2026-11-15 about 10:13 UTC (branch fix3a at 8b58340b in C:/dev/gsfpv-rooms, not merged): the walls store write starts before the walls go in use and the walls line says 'keeping' and 'not kept'; the guide chip at the screen edge ('Gate 1 . 17 m' with an arrow; the lead looked at fix3a-gate1-tunis.png and fix3a-gate1-behind.png); a closed ring starts at the gate next to the spawn where the check allows it (1 of 33 rings; the guide leads on the others); review FX-1 to FX-5 fixed; tracks-page 46 of 46. Cost note of the lane: 38 minutes waiting for the GPU lock.
- [~] Lane fix3b (the same worktree and branch, from 10:13 UTC): a generated course passes the Save check untouched by construction (Tunis: every gate 1 refused on the start leg in the page), gates out of foliage (Tunis palm crowns), proof on Tunis and Wroclaw; stages Y1-save-check, Y2-free-gates, Y3-prove, one review.
- [x] Lane laptop4 finished 2026-11-15 about 10:39 UTC (branch laptop4 at a2aaed8b in C:/dev/gsfpv-site-sound, not merged; no product change: bench tooling BENCH_UNCAPPED, lod-view-score --rows, freeze-probe, and the measurement switch ?viewlodrim= that is off). Measured on Lublin 2f1ddf5f from above: sharing the same budget differently inside the frame does not sharpen the near half (multipliers 1.7 and 1.5, rim 2 and 4: the near half gains 0 to +0.2 dB, the far half loses 0.4 to 1.6 dB; no candidate is better by eye); doubling the budget from 0.5 M to 1 M gives the near half +1.48 dB; the freeze below multiplier 2 that lane laptop3 saw came from another program holding the GPU at 100 %. The lead compared laptop4-lublin-above-0p5M-after.png with laptop3-lublin-above-16M.png: at 0.5 M the city is recognisable and smeared, most at the frame's edges. The levers left are outside the page's budget rule: a scan exported with finer middle levels (the owner's data on superspl.at: his decision) or a larger budget for weak devices. A question for the owner at the end of the train.
- [~] Lane sonic4 (C:/dev/gsfpv-center-throttle, new branch sonic4 from main; package branch train4; from 10:39 UTC): Fly by Sound at FPV speed (the owner's message 51: the mess of sounds at speed, a guiding line, distances by time, speed lessons): the mess measured, leads in seconds, the stream rule at speed, the line guide, lessons after speed-4; a counted course by ear on Wroclaw at 8 m/s (must) and 12 m/s (aim). Stages V1-measure, V2-build, V3-prove, one review.
- [~] The owner's messages 52 and 53 (2026-11-15, after he flew release 6ee5c711d7d3; verbatim in the vault brief): two keys make gates (Shift+G in the ordinary flight, N in Fly by Sound) and N put a second set of gates over the first; gates stand over the head though the cloud is dense at eye level near the ground; gates at the poor ends of streets; 'wrong way' is said when he flies back to a gate he missed. Decisions of the lead: one course in the scene, owned by the course feature, and Fly by Sound takes it with its progress; one key, Shift+G, in every mode (N a silent second key in the sound mode); 'eye level' is a number, a gate centre 1.2 to 2.0 m above the ground; no gate and no leg where the scan's quality is under a measured threshold; 'wrong way' is judged against the next gate not passed, never while the craft comes nearer to it, and a missed gate gets one plain line on where it is. Lanes from 11:10 UTC: onecourse (C:/dev/gsfpv-center-throttle, branch sonic4, package branch train4; stages O1-one-course, O2-wrong-way, one review; workflow run wf_2db8f860-5f5) and fix3b rewritten (C:/dev/gsfpv-rooms, branch fix3a; Y1-save-check continues from 6584e5cf, Y2-gate-places, Y3-prove; run wf_73dd896e-b41). Lane sonic4 (Fly by Sound at FPV speed) was stopped in its first stage (measuring commits up to 98a065b3 on branch sonic4) and goes on after lane onecourse in the same worktree.
- [ ] The owner's message 54 (2026-11-15 about 11:16 UTC; verbatim in the vault brief): he ticked 'My screen reader speaks' to silence the narrator and then could not fly for the waits; he wants a way to fly by sound alone once he has learned the keys. Decisions of the lead (in lane quiet of the workflow script, Q1 to Q6): a setting 'Narrator' On or Off (sounds only); nothing in a flight ever waits for a line in any setting; with the narrator off every spoken event has a sound; one key switches it in flight; a lesson of the list switches the narrator on for itself; one hint after the first finished course. Lane quiet (stages K1-no-waits, K2-sounds-prove, one review) starts in C:/dev/gsfpv-center-throttle on branch sonic4 when lane onecourse ends; lane sonic4 (FPV speed) after it.
- [~] The session of the lead restarted about 13:00 UTC; the three runs were resumed at 13:09 UTC with resumeFromRunId (editor3i wf_584b0c34-376: branch editor3 at 6f56f8b2, stage I3 written; onecourse wf_2db8f860-5f5: branch sonic4 at 8695f71f, review fixes written; fix3b wf_73dd896e-b41: branch fix3a at 3ddbd3e8, stage Y3 written). The package branch train4 holds, under lane onecourse's commit 74a05dd, the first build commit of the stopped lane sonic4 (7678880: leads in seconds from 4.5 m/s, one guide and one danger at speed): the integration names it and repeats the counted runs at 5 m/s.
- [ ] The owner's messages 55 and 56 (verbatim in the vault brief): the start and the finish of a course cannot be told; the lap's time large on the screen as in Liftoff, without disturbing; the microgreens scan (enlarged many times) gives 'no places'; a live board of the leaders when pilots fly together. Decisions of the lead are in the lanes of the workflow script: course4 (S1 to S7: the checkered START / FINISH gate, the lit next gate, the lap's time in the upper middle for 1.5 s with the gain or loss against the best lap and a setting large, small, off, a results card, generator lengths as multiples of the craft's size in the scan; stages C1-start-finish, C2-scaled-scans; C:/dev/gsfpv-rooms, branch fix3a, after lane fix3b) and race (L1 to L6: the course is the room's, laps go to all through the rooms service, a board at the left edge, a banner on a lead change; stages R1-share, R2-board; C:/dev/gsfpv-site-sound, new branch race; the rooms service changes: release-rooms.sh). Confirmed from other simulators: Liftoff's HUD lap timer flashes green or red against the best time (its update 1.5.12); VelociDrone points an arrow to the next gate off screen. Order of the queue as slots free: quiet (sound worktree), course4 (rooms worktree), race, then sonic4.
- [ ] The owner's message 57 (verbatim in the vault brief): a room scan gives no course though gates for a whoop fit there (which scan is not known: the speech recognition wrote its name as it heard it); gates as at competitions: upright and flat squares, small tunnels, several rings. Decisions of the lead, added to lane course4: S8 Shift+G gives a course on every scan of the catalogue, the generator steps down a ladder of gate sizes to the free space (the craft's collision size is the lower bound; a small craft for small rooms is the lead's decision if the numbers ask for it); S9 the generator composes elements (upright square, ring, flat square of kind dive, cube, a tunnel of three to five rings, two gates one over the other) by shares, with the kinds the format already has; a new kind is not built. Lane course4 now has four stages: C1-start-finish, C2-scaled-scans, C3-every-scan, C4-elements.
- [x] Lane fix3b ended about 14:15 UTC (branch fix3a at c83340a2 in C:/dev/gsfpv-rooms, ready for the integration): a generated course is never refused by the Save check untouched (fitCourse ends with the Save's own check; the Tunis refusal the editor lane saw came from an edited course); gate centres at eye level on true-scale scans (the lead looked at fix3b-wroclaw-pilot.png and -pilot-2.png: the rings stand in front of the eyes near the ground); no gate and no leg in the poorly scanned part (thresholds are estimates); review FY-1 to FY-6 fixed (a thinned course of 4 to 5 gates is not taken, the best-lap key follows the generator version, an unproven course loses the gates the check names). Left, given to lane course4 stage C0: no gate in leaves (one ring in a conifer), 1 to 3 gates of 24 at 3.1 to 4.8 m over the tile ground, the thresholds against pictures, the Lublin start pocket, the Opole page run, the page check on the head.
- [~] Lane onecourse ended about 13:55 UTC (branch sonic4 at fefeeceb): one course in the scene and Shift+G in every mode built, 'wrong way' judged against the next gate, review OC-1 to OC-6 answered; proofs left. Lane onecourse2 (one stage, no review, from 14:05 UTC, run wf_ad653607-df5) closes it: the lead's decision on OC-3: the package pin of this release is the commit with the 'wrong way' rule alone (branch train4-d7only ab2d6ac; new working branch train5), the speed design commit 7678880 stays on train4 for lane sonic4.
- [~] Lane course4 runs from 14:16 UTC (C:/dev/gsfpv-rooms, branch fix3a, run wf_065e9152-3dc), five stages: C0-places-left, C1-start-finish, C2-scaled-scans, C3-every-scan, C4-elements.
- [x] Integration C (fix3a with fix3b, onecourse, laptop4): main d245d9ec, package main 878f055; the CI's secret scan failed on it (67 false positives in the walls-store probe's evidence: 64-hex cache keys), the lead listed them in .gitleaksignore and changed the probe (f286dd49); live since 2026-11-15 16:25 UTC as release 5eadbf9e9d01 = main f286dd49 (302 smoke checks, neighbours equal). The live checks run at the time of this line; STATE.md gets the bullet with their numbers. Section 'Integration C' below.
- [x] Lanes ended, not merged: editor3i (branch editor3 at e4b4b341: the edit view reads as a 3D editor; left for lane editor3j, which runs from 16:00 UTC: the y ring turns nothing, the gate leaves the frame after a size change, the size handles); quiet (branch sonic4 at fbaf59ad, package train5 at 293ebae: with the narrator off nothing is voiced and nothing waits; left for lane quiet2, which runs from 16:15 UTC: sounds for the warnings, the key, the hint, captions, the live region); course4 (branch fix3a at e78da76a: START / FINISH, the lap splash and the card built but never seen in a browser; scaled scans, the gate size ladder, elements; left for lane course5, which runs from 16:53 UTC, stages Z1-see, Z2-scans, Z3-elements).
- [ ] The owner's message 58 (verbatim in the vault brief): the gates are always drawn behind the voxels; the voxel view shows only the near rows; Wroclaw on his RTX laptop does not load to full quality even with 16 M set by hand. Lanes in the workflow script, queued: voxview (C:/dev/gsfpv-site-sound, new branch voxview; V1 to V3) and loadq (C:/dev/gsfpv-loadq, branch loadq, made by the lead from f286dd49; G1 to G4). Then race and sonic4 while the weekly limit keeps 15 to 20 % free (54 % used at 16:10 UTC).
- [~] RESUME AFTER A RESTART OF THE CLAUDE APP (it happened at about 13:00 and 18:15 UTC on 2026-11-15; the workflows live in the app's process and stop with it). First: python -X utf8 U:/documents/Obsidian/AndriiShramko/.claude/tools/gsfpv/gsfpv_lanes.py status (a lane shown as supervised with a running process is NOT resumed in the app: two agents in one worktree). Then Workflow({scriptPath: the train script, resumeFromRunId, args}) for each run still open: editor3j = wf_83b1ef28-548 with args {chains: [[editor3j]]}; course5 = wf_7f8ed0fb-93c with args {chains: [[course5]]}; integration D = wf_3d27c340-53a (args: integrate train3d and the brief, as printed in its task notification). The lane supervisor (gsfpv_lanes.py: a registry in C:/dev/.gsfpv-lanes, stage prompts dumped by dump_prompts.mjs, a model-free tick that starts a lane as its own claude.exe -p process when the lead's session process is gone, and queued lanes when a slot is free) is written and tested (self-test 5 of 5, a dry run, one real one-line launch) and RUNS as the Windows task ShramkoGsfpvLanes every 5 minutes and at logon (the owner allowed it at 18:33 UTC after the safety classifier had refused it; log U:/Temp/gsfpv-supervisor/tick.log). Registered: editor3j, course5 and integration-d as the lead's (in-app), loadq and voxview as queued: the supervisor starts a queued lane by itself when fewer than three run. When a lead-run lane ends, mark it: gsfpv_lanes.py done --name <lane>.
- [x] Lane quiet3 ended 18:32 UTC (branch sonic4 at 1ad74390, package train5 293ebae): the narrator setting is built and proven in a browser, rows 1 to 10. Left: the hint's 'never on the second course' in a browser; probe observations (the d7 backing-up case with the narrator off; the Tunis lift-off of r11's switch-off check).
- [x] Integration D (the narrator): main 4e6ef171, package main e334c6e; live since 2026-11-15 20:05 UTC as release 786a70d70908 (CI green, 302 smoke checks, neighbours equal). The live checks run at the time of this line; STATE.md gets the bullet with their numbers.
- [x] Lanes ended in the app, not merged: editor3j (branch editor3 at 8ea44111: the lead looked at editor3-turn-1920.png: the selected gate framed at an angle with a yellow outline, three coloured turn rings, thin arrows; a click near the selected gate selects, the gate is framed again after a size change, a crash in the test flight comes back to the edit view; NOT proven: that all three open rings turn the gate) and course5 (branch fix3a at 26bb9bbe: the lead looked at course4-start-gate.png and course4-lap-splash.png: a checkered START ring with its banner and number plate, the lap's time large in the upper middle; elements with a keyboard pilot; the gate ladder sized by the flown craft; review CV-1 to CV-5 fixed, among them CV-2 by 'Fly by Sound takes no course with elements', which the lead reverses in lane mix).
- [x] Lane mix ended (branch fix3a at 601a1151): Fly by Sound takes every course of the scene with its progress; a flat square and a cube count by a ball of their size plus 1.5 m only in the sound mode; the ear pilot flew a course with elements made in the ordinary flight to its end on Wroclaw; the run's time large at FINISH of an open course.
- [~] RUNS OPEN NOW (resume them after a restart, see the RESUME line above): integration E = wf_c878ac4a-ac9 (args: integrate train3e and the brief, as printed in its task notification), from 21:26 UTC: fix3a at 601a1151, then editor3 at 8ea44111; if an open turn ring of the editor turns nothing after one repair, the editor is not released. Under the supervisor (its own processes; do not resume in the app): loadq (stage L2) and voxview (stage X2); queued there: uiaudit. Weekly limit 65 % at 21:26 UTC, recorded in the supervisor (it stops starting queued lanes at 75 %).
- [ ] Integration E after lane mix: editor3 at 8ea44111 and fix3a at lane mix's head; prove the editor's three open turn rings by the gate's rotation and the seam of the editor with START / FINISH and the elements. Then the queue of the owner's message 61 (the vault plan note lists it): voxview, loadq, uiaudit, race, sonic4 (its lane text must be rewritten for the package's branches), menu, the leftovers of train 2, head tracking, the RC 2 window with the owner.
- [x] Published walls of the nine catalogue scans are live since 2026-11-15: lighter re-bakes assembled by the lead in U:/Temp/gsfpv-train3/walls/release (148,581,855 bytes with the .gz copies; Wroclaw 17,615,280 raw and 9,670,306 gzip at 10 cm); deploy/release-walls.sh copies the .gz and checks the hub's free room first (7.1 GB free before the upload). Local pre-check and the live page probe: all nine pass (source published, no build, 20 passes at 25 m/s stop at the walls). The walls-published-probe of deploy/live-checks.sh passes from now on.
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
Wave 2, window 2026-11-15 00:36 to 04:16 UTC: 99 USD at API prices; 21 workflow agents 85.2 USD (997 calls, 47 per agent on average, context up to 389 k), the lead 13.6 USD in 33 steps. 71 % of the cost fell on calls at a context of 150 to 300 k: the line 'at most 30 replies per stage' in a prompt does not hold; a stage's budget is set by the size of its task.
Wave 3, window 2026-11-15 04:16 to 07:28 UTC: 65 USD at API prices; workflow agents 55.2 USD on 1040 calls (0.053 USD a call against 0.085 in wave 2; no agent context over 150 k), the lead 9.9 USD in 52 steps. What changed: a stage is one or two named points in a given order, up to three passes by a fresh agent per stage, runs with rendering off take no GPU lock.

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
- [x] Probes: U:/Temp/gsfpv-train3/integA/run2.sh and run3.sh, summary2.txt (one line per probe with its exit code).
- [x] deploy/live-checks.sh: lod-view on and off on 2f1ddf5f and 70b50d42 and course-path-probe on Wroclaw, not run. Field
  names checked against train3a-lub-on.json (view active true, failed null, missing [], calls 112) and train3a-lub-off.json
  (active false, calls 0, engine lodBehindPenalty 5, lodUpdateAngle 90, lodMultiplier 3): all present.
- [x] Probe JSON in evidence/2026-11-15/train3a/ (23 files) and evidence/2026-11-15/lod-view/*train3a*.json; no JPG or PNG.

Gates: gates.py exit 0, 'B18 PASS' 1 line, on the merged tree with seams a and b (before the evidence commit).

Probes (local release of 595bdac0 code, nine published walls in dist/walls, server 5760; exit codes from summary2.txt):
- accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16: exit 0, 10 of 10; first line 'accept-fly target: http://localhost:5760'.
- course-path-probe: Wroclaw build in the browser exit 0, Wroclaw published exit 0, Tunis exit 0 (numbers under Measured).
- walls-published-probe, nine scans: exit 0, 9 pass, ready 3.3 to 12.6 s, no 404.
- governor-start-probe (in one lock hold): exit 0, all=true (weak starts at the remembered step 4, strong at the top).
- lod-view-probe Lublin 2f1ddf5f at 1 M, rule on and viewlod=0, reference 16 M; lod-view-score exit 0. PSNR over the scan,
  off / on: after the spin 18.41 / 19.97 dB, yaw 185 19.01 / 21.12, yaw 95 18.33 / 19.72, pitch down 18.58 / 20.13; from
  above about equal (up140 19.47 / 19.43, up40 19.77 / 20.14); pitch up worse with the rule (26.05 / 23.08).
- sonic-int-review r9: exit 0, 11 of 11 (Fly by Sound works after the walls and renderer changes).
- rooms-two-page exit 0; centre-throttle-probe all exit 0; hid-source-probe exit 0; wizard-auto-check exit 0;
  tools/bench/test/a6-reference.test.ts 1 passed (hash unchanged).
- mouse-free-probe: exit 1, 78 PASS, 0 FAIL, then the timeout in the rooms entry (pause.rooms not visible): the same
  failure as train 2b (train2b-lead.md, a local release has no rooms service); not a seam of this train.
- tracks-page: exit 1, 44 of 46. FAIL 'A look (link seed 1, 24 gates)': the course is loaded (HUD 'Gate 1 of 24') but
  no gate is in the spawn view of Tunis (next 0 px, later 11 against 8 px). FAIL 'E camera: after Tab the camera looks at
  the newly selected gate' (px under the minimum). Both passed in train 2b; the cause is course3's new generator (the
  seed-1 course of g1.1 now lies outside the start view), not a seam between the lanes. Picture looked at:
  U:/Temp/gsfpv-tracks-page/2026-11-15/a-seed1-on.png. Not chased (see Not verified).
- Walls store (run3.sh, server 5762, Wroclaw folder out of dist/walls): the worker build finished in 220.2 s (state
  in-use, source bake); after a reload and in a fresh page of the same profile the walls did NOT come from the cache:
  state 'offer', source 'none' after 62 s in both. dist/walls has 9 folders again.

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

Live checks: deploy/live-checks.sh gained lod-view on and off on 2f1ddf5f and 70b50d42 (read only: the probe opens the
page, turns and reads lod()) and course-path-probe on Wroclaw (the course is generated in the page and never saved). The
editor's Save and the votes stay out. Not run.

Pictures for the lead:
- U:/Temp/gsfpv-train3/shots/train3a-walls-line.png (walls line over the sky, looked at: readable)
- U:/Temp/gsfpv-train3/shots/train3a-course-start.png (course note under the walls box, looked at: no overlap)
- U:/Temp/gsfpv-tracks-page/2026-11-15/a-seed1-on.png (the seed-1 course: no gate in the spawn view)
- C:/dev/gsfpv-v03/evidence/2026-11-15/lod-view/train3a-lub-on-turn-yaw185-end.jpg and train3a-lub-off-turn-yaw185-end.jpg
  (not in git; the rule on and off after a turn)

What the owner should try:
- Open a catalogue scan: the walls come by download; a line says what happens.
- Open a scan outside the catalogue: the walls build without freezing the page; the line shows the step, the share and
  the time left (on Wroclaw this took about 2.5 to 3.5 minutes here).
- Wroclaw, press Shift+G: a course in a few seconds with its progress line; gates along the streets at eye level.
  Press Shift+G again: a course of the same size (24 gates).
- Crash, then respawn (R): the course goes on from the gate you reached.
- Weak computer: the picture after turns and in streets is sharper (about 1 to 2 dB in our measure). Not yet: a big scan
  from above at 0.5 to 1 million splats, the near part is still smeared (a separate lane works on it).

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
- Walls store: walls built by the worker are not read back from IndexedDB after a reload or in a fresh page (state
  offer, source none after 62 s; evidence/2026-11-15/train3a/walls-cache-70b50d42.json). Cause not found
  (apps/fly/src/walls.ts and wallcache.ts); a pilot on a scan outside the catalogue rebuilds the walls on every visit.
- tracks-page A look and E camera (above): the probe's seed-1 view or the generator's start point needs a decision of
  the lead; not chased.
- mouse-free rooms entry on a local release without a rooms service: still not checked (since train 2b).
- Forest Floor ab5efa0e: STEPS=forest not run (no per-life record in course-path-probe).

Cost notes: worker 1 spent its turns on finding each probe's arguments (one probe at a time) and on blocking waits of
10 minutes that hit the tool's limit; a table of probe command lines in docs/agent-map.md would have saved about 8 turns.
Worker 2 spent most turns waiting on run2 and run3 in 10-minute blocks and on reading the two failed probes; one waiter
script that prints a short result table at its end would have saved about 5 turns.

## Integration B (sonic3)

### Merged
- sonic3 head 2cea7293 as eccb1f34 (--no-ff, no conflicts; git merged fly/sonic locales and sonic-int-lazy.test.ts by
  itself). It can not make the live site worse: Fly by Sound is opt-in (Backslash or the pause item); the parts that
  did not pass below are runs of the ear pilot, not faults of the ordinary flight.
- Sound package: branch train3 0af508a merged into the package main as 7c27300 (--no-ff), package suite 69 files passed
  (1 skipped), 1349 tests passed (4 skipped); pushed. The typecheck gate then found 3 errors in package tests under
  tsconfig.node.json (test/gate-aim.test.ts material 'gate', test/speed-ladder.test.ts maxSpeedMps possibly null; the
  lane had not run that config): fixed on train3 as 57a108d (types only, the two files 11 of 11, package tsc 0), merged
  into the package main as b05aeda, pushed. The negative control is the first gate run (typecheck FAIL on 7c27300).
  Pin: ada88fe0 (7c27300), then cf61115b (b05aeda, on the pushed package main). The two evidence files of the package
  worktree are left uncommitted.
- c40cb85d: gen-catalog after the merge (31 shortcut keys; README.md, llms.txt, docs/settings.md, features.json, site ru).
- e7f71d92: two read-only sound checks in deploy/live-checks.sh (below).
- Seams: the course seams (a) belong to the held lanes; apps/fly/src/session and packages/sim-core unchanged by sonic3,
  a6-reference 1 of 1 PASS (hash held); locales: i18n gate PASS; docs/decisions.md not touched by sonic3.

### Held back
- fix3a, editor3, laptop4 (the brief): not merged, not read. Left out with them: the editor chain, walls-store-probe,
  the guide to gate 1, lod-view-probe and lod-view-score, and their pictures.

### Gates
- Full run on ada88fe0 (U:/Temp/gsfpv-gates-20261115-083241): vitest PASS 140 s, api-unittest PASS 245 s, architecture,
  i18n PASS, B18 PASS; typecheck FAIL (package tests, fixed above), catalog FAIL (stale, regenerated above).
- After the fixes, gates.py --only typecheck,catalog,b18 on cf61115b: all PASS (U:/Temp/gsfpv-train3/train3b/gates2.log).

### Probes
Release ada88fe0 (sonic 7c27300, built 07:32 UTC) with the nine published walls in dist/walls, http://localhost:5760/en.
The head after it differs by the catalog files, the package test types and docs only (not rebuilt). Summary
U:/Temp/gsfpv-train3/train3b/summary.txt; evidence evidence/2026-11-15/train3b/.

| Probe | Result |
|---|---|
| accept-fly B6 B7 B9..B16 (first line: target http://localhost:5760) | 10 of 10 PASS |
| sonic r11 Wroclaw 70b50d42, 5 m/s, render ON | 10 of 10: on 7.02 -> 7.84 m/s, 0 lives; N to gate 1 25.4 s; 24 gates COUNTED, 0 misses, 120 s, median 3.77 m/s; off 5.13 -> 5.13 |
| sonic r11 Tunis 887f27aa, 5 m/s, render off | 10 of 10: on 1.64 -> 2.76, 0 lives; N 29.4 s; COUNTED, 1 miss, 193 s, median 3.9 m/s; off 5.13 -> 5.13 |
| sonic r11 Tunis 887f27aa, 5 m/s, render ON | 9 of 10: on 3.58 -> 5.1, 0 lives; N 25.4 s; not counted: 13 gates in the 300 s cap, 1 miss, still flying, median 2.2 m/s |
| sonic r11 Housefly d10c5638, 5 m/s, render off | 9 of 10: on 7.0 -> 7.75, 0 lives; N 47.5 s; not counted: 3 misses, moved on after 4 gates (79 s); off 5.25 -> 5.25 |
| sonic r12 speed-1..4, turn-listen | 11 of 11: speed-1..4 counted on attempt 1 (median 1.49, 2.5, 3.52, 4.48 m/s); turn-listen counted on attempt 3 |
| sonic-int-review r9 | 11 of 11 |
| lesson list (lessons-shot.mjs, U:/Temp/gsfpv-train3/train3b) | 34 lesson buttons, speed-1..4 and turn-listen present, 0 page errors |
| course-path-probe Wroclaw / Tunis | PASS / PASS (course at 5.5 s / 9.6 s, 24 gates each, no bake) |
| walls-published-probe | 9 of 9 |
| governor-start-probe | PASS |
| centre-throttle-probe all | PASS |
| hid-source-probe | exit 0 |
| wizard-auto-check | exit 0 |
| rooms-two-page | PASS |
| mouse-free-probe | FAIL: timeout on [data-action="pause.rooms"] (no rooms service locally; the same failure sonic3 S3 item 3 had on origin/main and on its dist) |
| tracks-page | 44 of 46 (A look, E camera; integration A had the same 44 of 46) |
| a6-reference | 1 of 1 PASS |

The two new live checks, their own function text, run against this release (port 5775, render off):
sonic-in-place-tunis PASS (r11 quick 8 of 8, 28 s), sonic-course-wroclaw PASS (both named checks; 8 of 10 overall, the
flight is cut at 60 s by design; 120 s). U:/Temp/gsfpv-train3/train3b/livecheck-local/.

### Deploy order for the lead
- git diff --stat ca5760fd..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api apps/rooms packages/i18n/locales:
  13 files, all locales (fly/keys, fly/sonic, fly/sonicentry in four languages, site/ru.json). They ship in the static
  release.
- nginx: no. API: no files, release-api.sh not needed, --locales not needed. Rooms: no. Walls: nothing new.
- Ship the static release of main as for integration A, then bash deploy/live-checks.sh <outdir> (two checks more:
  sonic-in-place-tunis, sonic-course-wroclaw; rendering off, no GPU lock, about 3 minutes together).

### Live checks
- sonic-in-place-tunis: r11 with Z5_QUICK=1 on Tunis: Backslash gives the free flight by sound, no new life, speed kept.
- sonic-course-wroclaw: r11 on Wroclaw with a 60 s flight: N makes a course and gate 1 is the hum's target.
- Read for both: r11 presses only flight keys (Enter on the Controls screen's keyboard choice, W, Q or E, Backslash, N,
  Space, arrows); the sound mode fetches only static track and walls files; nothing is sent or saved.

### Pictures for the lead
- U:/Temp/gsfpv-train3/shots/train3b-sound-lessons.png: the lesson list, Hover with "Turn a little and listen" (7 of 33),
  Rings with Speed 1 to Speed 4 (26 to 29 of 33).
- U:/Temp/gsfpv-train3/shots/train3b-sound-wroclaw.png: Wroclaw street drawn, "Stage 24 passed", "New best time: 1
  minute 56 seconds", Counted 1 of 1.

### What the owner should try
- Wroclaw from the catalogue: fly as always, press Backslash: Fly by Sound switches on, the craft keeps its speed.
- Press N: in about 25 s the hum of gate 1; turn with Q and E until the hum is in the middle, fly with W; 24 gates.
- Backslash again: Fly by Sound switches off, speed kept.
- Tunis: the same keys; with the picture switched off (render off) a course counted at up to 5 m/s.
- Escape, "Fly by Sound lessons": "Turn a little and listen" (lesson 7) and Speed 1 to Speed 4 (lessons 26 to 29).

### Not verified
- Housefly d10c5638 on this build: not counted (3 misses, moved on after 4 gates); the lane counted it at 5 m/s on an
  earlier build (S2). N to gate 1 took 47.5 s (lane: 60 to 125 s).
- Tunis with rendering on: 13 gates in the 300 s cap, not counted (the lane did not run it).
- The budget's open-way chime has no offline audio proof (lane LEFT 1).
- HUD altitude below zero after landing at the course end: -0.1 m in train3b-sound-wroclaw.png (lane: -0.3 Wroclaw,
  -0.9 Tunis); cause not measured.
- Nothing was heard by a human ear; es, pl, ru lesson lines only by the package's words check.
- mouse-free rooms entry and tracks-page A look and E camera, as above. The probes ran on the dist of ada88fe0, not of
  the final head (see Probes). deploy/live-checks.sh was not run against the live site.

Cost notes: the package typecheck under tsconfig.node.json was found only by the full gates after the build; running
the package's own typecheck beside its test suite before the merge would have saved a gate rerun and a second package
push.

## Integration C (fix3a with fix3b, onecourse, laptop4)

Worktree C:/dev/gsfpv-v03, branch main, from 8df388d2 (origin/main did not move). Logs U:/Temp/gsfpv-train3/int-c,
evidence JSON evidence/2026-11-15/train3c/.

Merged
- Package first: C:/dev/ShramkoSonicFPV main <- train5 (--no-ff) = 878f055, pushed (origin/main 878f055). Package tests
  1355 passed, 4 skipped; tsc tsconfig.core.json, tsconfig.json, tsconfig.node.json: 0 errors each. README line 131
  unchanged (same md5 before and after); the two modified evidence files stay uncommitted; worktree back on train4.
  train4 (74a05dd with 7678880) not merged. The simulator's pin stays ab2d6ac: it is the second parent of 878f055, so a
  commit of the pushed main; no pin commit needed.
- fix3a at c83340a2 (lanes fix3a and fix3b): dd8a0b1c. No conflict.
- sonic4 at 704f2043 (lanes onecourse and onecourse2, with the two measuring commits of lane sonic4): c672dca3. No
  conflict (course.ts, hook.ts, sonic-int-review.ts and the four fly/course and fly/sonic locales merged by git itself).
- laptop4 at a2aaed8b: b7c918e6. No conflict. Its one line in apps/fly/src/session/index.ts passes the off switch
  ?viewlodrim= to the renderer; flight untouched (a6-reference passes).
- Seam work: bda6eac0 (onecourse-probe reads the guide's gate and the Save check after Shift+G in Fly by Sound and
  takes a picture after the second Shift+G; deploy/live-checks.sh, see Live checks). No product code changed by the
  integration. docs/decisions.md: no lane added a decision (no number to renumber).

Held back: editor3 (its review fixes run in C:/dev/gsfpv-voice), course4 (commits after c83340a2 not taken), quiet, race,
the speed lane sonic4 (package commit 7678880 on train4). Not read, not merged.

Gates: gates.py on b7c918e6 (all three merges), exit 0: typecheck, vitest, api-unittest, architecture, i18n, catalog,
B18 PASS (logs U:\Temp\gsfpv-gates-20261115-160422). Locale keys after the merge: fly/course 135 in en, es, pl, ru;
fly/sonic 117 in each.

Probes (release build of b7c918e6 plus the onecourse-probe change, build exit 0 in 81 s; dist/walls = the nine published
scan folders of U:/Temp/gsfpv-train3/walls/release copied with cp -r; Tunis on its shipped walls; servers 5760 and 5768,
r11/r9/r12 on 5761 to 5765; summary files int-c/summary.txt and summary2.txt):
- a6-reference: 1 passed (hash held).
- onecourse-probe, Wroclaw, render on under the lock: Shift+G 24 gates; the scripted pilot passed gates 1 and 2 (next 1,
  2); Backslash: next 2, the hum's target g3, the guide's gate 2 (= g3): seam (d) holds; the sound mode's own prims 0 in
  every step (one gate set); Shift+G in the sound mode: new seed, 24 gates, target g1, guide gate 0, Save check problems
  0 untouched (seam (e)); N: new seed, target g1, prims 0; Backslash off keeps the course; no course: the lines
  inPlaceIntro and lessonKeysFree, nothing made. Page errors 0. Render-off run: the same except that the scripted pilot
  passed no gate on a 19-gate course (next 0 after both passes; the render-on run passed both).
- d7-probe (D7_SG=9w94zz, render off): exit 0; generator 3 gives this link seed a new course (1554327750, not the lane's
  598369679). Gate 1 counted; case (a) said "The gate is behind you" once (2.08 s), no wrong way, but the course went
  back to gate 1 (next 1 to 0, a rewind is the guess, not measured), so cases (b), (c), (d) ran at next 0 and said
  nothing (wrongWay 0, gateBehind 0); (lap) next 0 to 1, no lap. The four cases are not proven on this course: see Not
  verified.
- save-check-probe --push: Wroclaw Shift+G to course 10.1 s, 24 gates, problems 0, gate 1 pushed into the wall 2.83 m
  away: 3 problems, untouched again 0; Tunis 5 s, 24 gates, problems 0, pushed: 3 problems, again 0.
- course-path-probe: Wroclaw 24 of 24 gate centres in 1.2-2.0 m (+-0.1; heights 1.6 to 2.0 m), course at 7.1 s, runs
  failing 0; Tunis 24 of 24 (1.6 to 2.0 m), 7 s, runs failing 0. Exit 0 both.
- gate-place-probe Wroclaw (pilot view of gate 1): exit 0; the first two regenerated courses have 24 and 13 gates, every one in the eye band (1.6 to 2.0 m).
- gate-guide-probe --shiftg: Wroclaw 6 of 6, Tunis 6 of 6.
- walls-store-probe Tunis: exit 0, shipped true, shippedOk true (153 s).
- walls-published-probe, all nine published scans on the local copy: 9 of 9 pass (source published, no build).
- pause-over-course-probe (render off): pass true at 1920 and 844 wide.
- accept-fly B6 B7 B9 to B16, first line "accept-fly target: http://localhost:5768": 10 of 10 true.
- tracks-page: 45 of 46; FAIL 'E camera: after Tab ...' (the old editor's camera; lane editor3 replaces it), the same
  row lane fix3b reported.
- sonic-int-review r9 11 of 11 (185 s); r12 9 of 9 (159 s); r11 Wroclaw Shift+G 5 m/s, cap 600 s: 10 of 10, the ear pilot
  flew the course to its end and the lap was counted at 167 s; r11 Wroclaw N: 10 of 10 (275 s); r11 Tunis Shift+G: 10 of
  10 (178 s).
- lod-view-probe on Lublin 2f1ddf5f: on active true, failed none, missing 0, calls 107; off (&viewlod=0) active false,
  penalty 5, angle 90, multiplier 3: both pass the lodcheck rule of live-checks.sh.
- The local server on 5760 ended without a line in its log after course-path Tunis; walls-store, walls-published,
  accept-fly and lod-view met a refused connection and were run again on 5768 (run2.sh, a check of the server before each).

Deploy order for the lead (git diff --stat a7f39528..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api apps/rooms
packages/i18n/locales): nginx no; API no (apps/api not changed, release-api.sh not needed, --locales not needed: the
changed locales are fly/course, fly/sonic and fly/*.json of the static release, not bot or mail); rooms no. Ship the
static release of main (the usual release build and upload); the published walls are already on the server and are not
part of this release. Then deploy/live-checks.sh.

Live checks (deploy/live-checks.sh, bda6eac0, not run): course-path-wroclaw now runs cpband (the probe plus a read of
the first course's gate-centre heights: every centre in 1.2-2.0 m +-0.1 m); new gate-guide-wroclaw (Shift+G and Escape
only); new one-course (onecourse-probe with NOCOURSE=0, render off, flight keys only; checks one gate set after
Backslash and after Shift+G in Fly by Sound); the sound checks press Shift+G (Z5_COURSE_KEY=Shift+KeyG) and a new
sonic-course-wroclaw-n keeps one N press. Every probe added reads only: no Save, Send or Create is pressed, nothing is
stored on the server (the Save check read is the page's own check of a copy).

Pictures for the lead (looked at):
- U:/Temp/gsfpv-train3/shots/train3c-gates-eye-wroclaw.png: pilot view on Wroclaw by the cathedral, gate 1 (green) and
  the teal gates at eye level in front of the camera over the grass, not over the head.
- U:/Temp/gsfpv-train3/shots/train3c-one-course.png: Fly by Sound after Shift+G, two gates passed, Backslash and Shift+G
  again: one set of teal gates, the guide chip "Gate 1 . 18 m"; the three spoken captions cover the clock block (known).
- U:/Temp/gsfpv-train3/shots/train3c-guide.png: Wroclaw after Shift+G, gate 1 behind: the chip "Gate 1 . 11 m" with the
  turn mark at the left edge.

What the owner should try
- Wroclaw, Shift+G: in about 7 to 10 s a course of 24 gates stands in the streets at eye height.
- If gate 1 is not in view, the chip at the screen edge says "Gate 1" and the metres, with an arrow to turn.
- Fly through two gates, then Backslash: Fly by Sound goes on, the hum leads to the next gate of the same course, no
  second set of gates appears.
- In Fly by Sound press Shift+G (or N): a new course replaces the old one; the hum leads to gate 1.
- Backslash again: Fly by Sound goes off, the course and its count stay.
- The check before Save finds no problem in a course made by Shift+G, in the flight and in Fly by Sound (Save itself
  was not pressed in these runs).

Not verified
- d7-probe on the merged build: only case (a)'s "The gate is behind you" was heard once; the course went back to gate 1
  after it, so cases (b), (c), (d) and the lap ran at gate 1 and proved nothing (the lane's proof was on the old
  generator's course). Not chased: the probe's scripted moves (7 m beside, 4.5 m over) were written for the old course.
- The scripted pilot of onecourse-probe passed no gate with render off (19-gate course); with render on it passed both.
- The captions of the sound mode stack three lines over the course's clock block (lane quiet).
- The ear pilot gets wedged at walls near gate 1 on some random Wroclaw courses (not seen in these three r11 runs).
- A failed generate said in Fly by Sound: never run in a browser.
- No gate in leaves is not built (one ring in a conifer; lane course4). One to three gates of 24 on Wroclaw stand 3.1 to
  4.8 m high against the tile ground (lane course4); in these runs the straight ray found 1.6 to 2.0 m.
- The quality thresholds are estimates. tracks-page 'E camera after Tab' fails (lane editor3).
- Gate heights of a course made by Shift+G inside Fly by Sound were not measured in the page; it is the same generate
  call as in the flight and its Save check gave 0 problems.
- Nothing was heard by a human ear. deploy/live-checks.sh not run (by rule). Why the local server on 5760 stopped: not
  found.

Cost notes: the longest part was waiting for the probe runs (about 55 minutes in two background scripts); a server
check before each probe in the first script would have saved the second script and four reruns.

## Integration D (the narrator setting: lanes quiet, quiet2, quiet3)

Merged
- Sound package C:/dev/ShramkoSonicFPV: branch train5 (293ebae, the narrator setting and the free flight start) merged into
  its main with --no-ff as e334c6e; npm test 71 files passed, 1 skipped (1358 tests passed, 4 skipped); tsc -p
  tsconfig.core.json, tsconfig.json, tsconfig.node.json all exit 0; plain push of main 878f055..e334c6e (origin/main =
  e334c6e). Branch train4 (7678880) not merged. README.md unchanged against 878f055 (diff empty), the added lines are ASCII,
  no model name. The two modified evidence files left uncommitted; the work tree is back on train4.
- Simulator: lane sonic4 at 1ad74390 merged with --no-ff as c7606bf9, no conflict (course.ts merged by git: the spoken lap
  line, the one-course interface and the guide are kept; the lane's change adds a sound kind to the lines only). Package pin
  packages/sonic-fpv stays 293ebae: it is on the pushed main (parent of e334c6e; git branch -r --contains 293ebae lists
  origin/main), the tree of e334c6e is the same code, so no pin commit was needed.
- Live check narrator-off added in deploy/live-checks.sh (5eee34e5).

Held back (not merged, not read): editor3 (lane editor3j), fix3a (lane course5), voxview, loadq, race, the speed design
of lane sonic4 (package branch train4, commit 7678880).

Gates (gates.py on the merged tree)
- First run (build running beside it): typecheck, api-unittest, architecture, i18n, catalog, b18 (B18 PASS), leaks PASS;
  vitest FAIL 1 of 5047: tools/bench/test/app-dji-rc2.test.ts 'answers 60 ms late' (rc.late 5, expected 0; real timers under
  the build's load; the merge touches no HID or RC 2 file). The file alone: 15 of 15 passed.
- Second run with this section and the evidence staged: all PASS but leaks (21 lines in 7 files: the lesson keys
  'lesson.scan-free.intro.1' and the like in quiet-probe ENTRY=scan outputs match the CI scan's generic-api-key rule).
  Those 7 files (s-*.json, pic-set.json) are kept out of git in U:/Temp/gsfpv-train3/int-d/evidence-not-in-git; their
  numbers are in evidence/2026-11-15/train3d/scan-entry-summary.json. Third run: exit 0, typecheck, vitest, api-unittest,
  architecture, i18n, catalog, b18 (B18 PASS), leaks all PASS (U:/Temp/gsfpv-train3/int-d/gates3.log).

Probes (release build of 9206d8ca exit 0 (= c7606bf9 plus a lead note line; release sha256 b76745f0c40b), nine published wall folders in dist/walls, serve-csp 5760; summary
U:/Temp/gsfpv-train3/int-d/summary.txt, every probe exit 0 but r11 Tunis narrator on; evidence
evidence/2026-11-15/train3d/)
- Narrator off, quiet-probe Backslash on Wroclaw / Tunis: voice 0 / 0 lines and live regions 0 / 0 lines from the press to
  10 s; the craft over 0.5 m/s 0.69 / 0.68 s after the press with W held from it; course by Shift+G ready +33.62 / +9.32 s
  and the hum of g1 in the same sample (0 s apart); K and I spoken (17 / 17 lines in the flight, K's list and I's two
  lines and "Narrator on." of the second Shift+V); Shift+V off then on; saved narrator false at the end; 0 page errors.
- Ear pilot r11 narrator off at 5 m/s: Wroclaw 12 of 12 (24 gates, flown g1 to g24, laps 1, counted, 170 s; voice only
  the engine's empty warm-up; sounds answer yes, checkpoint for the course ready, fanfare at the end), Tunis 12 of 12
  (24 gates, 107 s, same sounds).
- r12 narrator off speed-1: 5 of 5 (opened 1.3 s, passed at attempt 1 in 53 s, the lesson speaks, the narrator setting is
  off again after it).
- My screen reader speaks with the narrator on (quiet-probe READER=1, Wroclaw): voice 0, 385 writes to live regions in
  the first 10 s, the craft moves 0.80 s after the press, course and hum +10.78 s.
- Free flight of the sound page (ENTRY=scan) on Wroclaw / Tunis, narrator on, off and screen reader: the craft moves 0.47
  to 0.60 s after the page is ready in all six; narrator off: voice 0 / 0, live regions only before ready (last at 0.90 /
  0.99 s, "The scan is ready"; ready 1.68 / 1.77 s); course and hum in the same sample in all six.
- Narrator on, as on main: r9 11 of 11; r12 9 of 9; r11 Wroclaw Shift+G 10 of 10; r11 Tunis Shift+G 9 of 10 (see Not
  verified); onecourse-probe (render off) exit 0, one set of gates after Backslash and after Shift+G; d7-probe exit 0;
  pause-over-course-probe pass (1920 and 844); course-path-probe Wroclaw: 24 of 24 gates in the 1.2 to 2 m band, longest
  silence 2.6 s; accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all true against http://localhost:5760;
  a6-reference 1 passed.
- Captions (quiet-probe RENDER=on RECTS=1, Wroclaw, course by Shift+G): one caption of 1 row at 1920x1080, 1280x720,
  844x390, no overlap with the course's clock block.

Deploy order for the lead (git diff --stat f286dd49..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api apps/rooms
packages/i18n/locales)
- nginx: no. API: no file (release-api.sh not needed, no --locales: only packages/i18n/locales/fly/sonic and
  fly/sonickeys changed, they ship in the static bundle). Rooms: no.
- Ship the static release of main only.

Live checks: one new check narrator-off (quiet-probe NARRATOR=off on Wroclaw: no line with words to the voice and none to
a live region from Backslash to 10 s, the craft moves within the 2 s that W is held from the press). Read in its source:
it presses only flight keys (Backslash, W, Shift+G), the narrator is set in the probe browser's localStorage, nothing is
sent or saved on the server. The same check passed on the local copy (voice 0, live 0, moved at 0.69 s). Not run against
the live site (by rule).

Pictures for the lead (looked at)
- U:/Temp/gsfpv-train3/shots/train3d-narrator-setting.png: the Settings of the sound start page, "Narrator" ticked between
  "My screen reader speaks" and "Motor sound", its help text "Off: sounds only. In a flight nothing is spoken and nothing
  waits for a line; the lessons keep their words." right after the label.
- U:/Temp/gsfpv-train3/shots/train3d-captions.png: Wroclaw with a course of 24 gates; the clock block "0:00.00, Lap 1 of 1,
  Gate 1 of 24" at the top centre and one caption row "Recording is off." under it, both readable.

What the owner should try
- On the sound page open Settings and untick "Narrator" (or in a flight press Shift+V: two notes down).
- Open Wroclaw, press Backslash: two notes up, the craft flies at once, nothing is spoken.
- Press Shift+G: a short chime when the course is ready and the hum of gate 1 starts with it; fly to the hum.
- At the end of the course you hear the finish notes.
- Press K for the keys and I for the status: they are spoken even with the narrator off.
- Press Shift+V: "Narrator on."; press it again: two notes down, quiet again.
- Open a lesson from the lesson list (Speed 1): it speaks; after it the narrator is off again.

Not verified
- r11 Tunis narrator on (Shift+G): 9 of 10; the switch-off check after the course failed because the craft was not
  moving (0.36 m/s before and after, a crash life just before); the lane saw the same probe precondition fail on Tunis
  with the narrator off (0.08 m/s). Not chased. My r11 Tunis narrator off passed 12 of 12.
- d7-probe narrator on: after case (a) the next gate went back to gate 1 and cases (b), (c), (d) and the lap ran at
  gate 1 (as in integration C, the probe's scripted moves). Narrator off: (lap) next 3 to 0, laps 1; the lane's
  observation (next 3 to 0 after the backing-up case) did not repeat in this run.
- The hint "never on the second course" was not run in a browser (r11 flies one course).
- On Tunis the lane's lift-off before the switch-off speed check did not take the craft up (lane's run; see above).
- No caption long enough to need the two-row clamp was shown (all captions here were one row).
- The Narrator help text starts right after its label, not in the column of the other help texts (cosmetic).
- No real screen reader, no human ear, no native check of the es, pl, ru words. deploy/live-checks.sh not run (by rule).
- mouse-free-probe, tracks-page, walls-published-probe, walls-store-probe, the editor chain, centre-throttle-probe,
  rooms-two-page, wizard-auto-check, hid-source-probe, governor-start-probe, lod-view: not run in this integration (the
  brief's probe list for D did not name them; editor3, fix3a and laptop4 were not merged).

Cost notes: most turns went to waiting for the probe script (about 75 minutes); running the gates first and the probes
after them kept one script and no reruns, but the gates' vitest still met the build's load.

## Integration E (the edit mode; START / FINISH and the lap's time; scans and elements)

Status (integration E worker 1 stopped at a clean point; a fresh worker continues from "Left"):
- [x] Merged fix3a 601a1151 with --no-ff: 44d76fce (no conflict).
- [x] Merged editor3 8ea44111 with --no-ff: 8b4d7eb3. Conflicts in apps/fly/src/app/builtin/course.ts (frame(): the
      editing flag of editor3 and run.byEar of lane mix kept; the guide keeps fix3a's gate role) and
      apps/fly/src/course/view.ts (fix3a's START / FINISH paints kept, the selected gate takes the editor's yellow).
      The fly/course locales merged by themselves (all four).
- [x] Seam a in the same commit: the editor's test flight shows the lap clock, its splash and the guide to the next gate
      again (apps/fly/src/course/editor/fly-mode.ts flyShows(true).lapClock true); the best lap is still not written there
      (course.ts 'end.best && shows.writeBest'); the edit view hides the clock, the splash and the guide (showEd calls
      hud.update(null), which clears both). Test tools/bench/test/editor3-flying.test.ts 13 of 13; negative control with
      fly-mode.ts of 8ea44111: NEG OK.
- [x] Seam b: git diff 4e6ef171..HEAD -- apps/fly/src/session lists no file. Seam d: docs/decisions.md has no change
      since 4e6ef171 (no new numbers).
- [x] Gates on 8b4d7eb3 (log U:/Temp/gsfpv-train3/e/gates1.log): typecheck, vitest, api-unittest, architecture, i18n,
      b18 ('B18 PASS'), leaks PASS; catalog FAIL (stale features.json, docs/settings.md, README.md, llms.txt, site llms.txt).
      Regenerated with gen-catalog in the commit of this line; catalog gate then PASS. The dist that run.sh built is of
      8b4d7eb3, before this regeneration: its site catalog pages are stale (the fly page is not affected); rebuild before
      the pictures of the site or the release.
- [x] Seam d tooling (16d044b6, worker 2): one hook field course.editor.pose (apps/fly/src/course/hook.ts, written in
      showEd of apps/fly/src/app/builtin/course.ts from gateFlownPose of the course state, not the view's stand-in);
      editor3-prove.ts drags each ring 60, 100 and 140 px and records gateDeg (the gate's own rotation before and after)
      and gate100ok (at least 20 degrees at 100 px). Typecheck of apps/fly and tools/bench clean. [ ] The run on a build
      that has the field (the dist of run.sh does not: its Tunis run gives gateDeg null).
- [x] Live checks (worker 2): deploy/live-checks.sh gets edit-mode-wroclaw (editor3-smoke.ts, read-only by its header and
      by its code: no click on data-top save, no /api call) and sonic-eye-course-wroclaw (r11 with Z5_COURSE_FIRST=1);
      gate-guide-probe.mjs now also checks 'gate 1 is START' (hook course.look().roles), so the existing gate-guide-wroclaw
      line covers the START role. bash -n passes; not run.
- [~] Release build and probes: U:/Temp/gsfpv-train3/e/run.sh runs detached (summary U:/Temp/gsfpv-train3/e/summary.txt,
      one line per probe with its exit code; logs beside it; evidence JSON in evidence/2026-11-15/train3e/; raw shots in
      U:/Temp/gsfpv-train3/shots/train3e-raw). It builds, copies the nine published wall folders into dist/walls, serves
      5760, runs the editor chain (editor3-prove.ts FULL=1, one lock hold per scene, Wroclaw then Tunis; its own pictures
      go to U:/Temp/gsfpv-train3/shots/editor3-*-1920.png), course-path both scans, gate-guide (Shift+G Wroclaw),
      course-finish (3 sizes), course-keys, pause-over-course, save-check with --push on both scans, mouse-free,
      walls-store Tunis, walls-published, onecourse, d7, quiet-probe narrator off, tracks-page, accept-fly B6-B16, then
      sonic-int-review r9, r11 (Z5_COURSE_FIRST on and with the narrator off, Shift+G Wroclaw and Tunis), r12 on ports
      5761-5766. It writes ALLDONE as its last line. Do not start it again while it runs (check with ps for run.sh).

Deploy order for the lead (from git diff --stat 4e6ef171..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api
apps/rooms packages/i18n/locales): only packages/i18n/locales/fly/course/{en,es,pl,ru}.json changed, and they ship in the
static site bundle. nginx: no. API: no file for release-api.sh, no --locales (it carries only apps/api/locales and the
bot and mail locales). rooms: no. Then ship the static release.

Left (exact, in order):
1. Read gates1.log tail (exit 0; 'B18 PASS'); fix a seam if a gate fails.
2. Seam d of the brief (the three turn rings): editor3-prove.ts measures each ring by the view's stand-in quaternion
   (src/editor3-prove.ts lines 337-354, drags of 60 and 140 px), which is what review EJ-1 called self-checking. Needed: the
   gate's own rotation read before and after a 100 px drag along each ring, at least 20 degrees each, on both scans.
   No hook gives the selected gate's flown rotation today (edHook fields in apps/fly/src/app/builtin/course.ts near line
   865); the smallest change is one hook field there (the selected gate's flown pose from gateFlownPose) plus the probe
   reading it. If a ring turns nothing after ONE seam-size repair: reset main to 44d76fce, release fix3a alone, say so first.
3. When summary.txt has ALLDONE: read each line; pictures train3e-editor.png, train3e-editor-element.png,
   train3e-start-gate.png, train3e-lap-splash.png, train3e-elements.png (copy from the raw shots after looking at them;
   the flat square selected and the START gate beside an ordinary one may need one extra page shot).
4. Probes not in run.sh yet: centre-throttle-probe all, rooms-two-page, wizard-auto-check, hid-source-probe,
   governor-start-probe (in the lock), lod-view-probe on and off once. Skip the rc2 bridge (port 47310).
5. deploy/live-checks.sh: the three read-only checks of the brief (edit mode on Wroclaw without Save; START role of gate 1
   after Shift+G; Fly by Sound over an ordinary-flight course aims at its next gate), after reading each probe's source.
6. The rest of this section (Gates, Probes, Live checks, Pictures, What the owner should try, Not verified with the brief's
   known list), commit evidence JSON (not PNG), full gates with leaks as a separate command, plain push of main.

Cost notes: worker 1 used most turns on finding the probe recipes in the lanes' long status files and temp folders
(mix/chain3.sh, editor3/fx3c/chain.sh, int-d/run.sh were the useful ones); a per-lane 'how to rerun' block would save
about 6 turns.
