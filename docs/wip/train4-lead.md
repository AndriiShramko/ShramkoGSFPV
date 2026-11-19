# Train 4: lead note (handoff)

The owner's messages 64 to 67 of 2026-11-19 (vault brief, verbatim): finish what was left and build the new brief (course generator, course editor, voxel view, messages, cancel of a loading scene, the site's Fly now on the sound page, the quick sound lesson, a Minecraft trial), fast, with many agents at once, and cheap on checks. Train 3's end and its leftovers: the first bullet of STATE.md.

## How it runs

- Designs: five agents on the API key wrote C:/dev/.gsfpv-lanes/designs/gen4.md, edit4.md, voxux4.md, sound6.md, mc4.md (causes proven from the code, the change, owned files, stages, checks).
- Fifteen lanes are built at the same time, each in its own work copy on its own branch (the owner lifted the rule of three agents for this train). Start: 2026-11-19 14:16 UTC.
- The conductor has no model: vault tool .claude/tools/gsfpv/train4.py, Windows task ShramkoGsfpvTrain every minute, plan C:/dev/.gsfpv-lanes/train4.json. One agent run is one stage (`claude -p`, opus, shell and file tools only) and ends with LANE-STAGE-DONE or LANE-DONE; the next stage is a new run with a clean context. After a lane the conductor starts its independent check `r-<lane>`; after all checks the integration `int4`. Since 16:25 UTC the train ships in TWO CARS: job `car1` (prompt t4-car1.md) merges the lanes whose checks say SHIP when it starts, runs the full check and hands over in U:/Temp/gsfpv-train4/int4-car1.json; the lead releases it; job `int4` is car 2: the rest on top of car 1, with its own full check and hand-over (the early pass `int4-early` was retired before it ran).
- Events: U:/Temp/gsfpv-train4/events.log; lines with WAKE are for the lead. Status: `python -X utf8 <vault>/.claude/tools/gsfpv/train4.py status`. Park a job: `set --name X --state hold`; give it back: `--state wait`. `add` and `set` take the tick's lock (since 15:30 UTC), so they are safe while the train runs. Never run `tick --dry-run` on the live plan: it writes the events of finished runs a second time.
- Prompts: C:/dev/.gsfpv-lanes/prompts/train4-common.md (the rules of every job), t4-<lane>.md, t4-r-<lane>.md, t4-int4.md. They are made by the vault tool train4_setup.py.

## Lanes

| Lane | Work copy | What the pilot gets |
|---|---|---|
| gen4a | C:/dev/gsfpv-rooms | a course at the scale he flies now, never a refusal; gates in the best scanned part, start and finish together; above the roofs in a city scanned from a drone, inside a room, between the leaves |
| gen4b | C:/dev/gsfpv-sonic-beacon | difficulty levels, compact or whole scan, a question before a course is replaced, progress, the start of the course shown |
| edit4a | C:/dev/gsfpv-loadq | the view moves only when the pilot moves it; one gizmo; view controls as in Blender |
| edit4b | C:/dev/gsfpv-ui | an empty course, delete all gates, a visible test flight button, gate numbers that are seen |
| edit4s | C:/dev/gsfpv-v12-optin | autosave with versions, the offer to make the corrections, the cause of the save failure |
| edit4c | C:/dev/gsfpv-v13-host | a new gate at the right angle, warnings, double and triple gates, a pole, a flag, styles |
| vox4 | C:/dev/gsfpv-site-sound | voxels only without the frozen picture and holes, Lublin's hole under the craft, light and shade |
| ux4a | C:/dev/gsfpv-v13-look | one message service: readable, long enough, a list of the last messages |
| ux4b | C:/dev/gsfpv-voice | cancel a loading scene; a new pick replaces it at once |
| site4 | C:/dev/gsfpv-train1-base | Fly now on the sound page opens Fly by Sound; an audit of such links; the cookie banner at 320 px |
| sound6 | C:/dev/gsfpv-center-throttle and the package copy C:/dev/ShramkoSonicFPV (branch quick1) | the quick lesson by default, no question about behind and in front, Firefox; closes lane sonic5 |
| mc4 | C:/dev/ShramkoSplatCraft (a new repository, not published) | a trial piece of Lublin as Minecraft blocks: schematic files and pictures |
| menu4 | C:/dev/gsfpv-t4-menu | the menu for new pilots of docs/wip/menu-plan.md |
| tails4 | C:/dev/gsfpv-t4-tails | leftovers of train 2 that need no server and no person |
| head4 | C:/dev/gsfpv-t4-head | head tracking with a web camera for Fly by Sound, off by default |

Integration: C:/dev/gsfpv-v13-int, branch train4, status docs/wip/train4-int.md on that branch, hand-over file U:/Temp/gsfpv-train4/int4.json.

## Decisions of the lead

- sonic5, point W1.6: the package's rule 'a speed cap is at most the ear pilot's median top speed divided by 1.25' stays; the lessons at 6 to 12 m/s are not built now; the lane closes with what is proven (stage 0 of lane sound6).
- Minecraft: this train builds the trial and its pictures only. The loader of Minecraft worlds in the simulator and the browser tool start after the owner's yes to the trial (his own condition).
- Not in this train: an ear pilot faster than 6 m/s; the controller helper without Python and the window with the real DJI RC 2 (the owner must be present); the course a probe saved on the live site (the lead removes it).

## Checks, the cheap way

Rules for every job are in train4-common.md: a test with a negative control beside every change; only the touched tests inside a stage; the gates once a lane; probes without drawing wherever the picture is not judged and at most one drawn run a stage (one GPU lock for all); the check reads the diff and the lane's claims and runs three claims and two negative controls again; all gates, one build and the flight regression once on the merged train; CI runs the whole suite before the deploy.

## What the lead does at each event

- WAKE FAILED or BLOCKED: read the job's log U:/Temp/gsfpv-train4/runs/<job>-*.jsonl (its last result line), repair the cause, `set --name <job> --state wait`.
- WAKE HOLD r-<lane>: the check ended without 'Verdict: SHIP', so the integration would leave the lane out. Read U:/Temp/gsfpv-train4/reviews/<lane>.md; write C:/dev/.gsfpv-lanes/prompts/t4-fix-<lane>.md (a short repair order for exactly the left list, on top of the lane's own prompt); `add --name fix-<lane> --worktree <the lane's work copy> --prompt <that file> --max-runs 3`; then `set --name r-<lane> --state wait --reset-runs --after-add fix-<lane>`: the check runs again after the repair, and int4 waits for it.
- WAKE DONE mc4: look at the pictures U:/Temp/gsfpv-train4/shots/mc4-*.png, show them to the owner, ask for his yes. Done at 15:27 UTC, see the state below.
- WAKE DONE car1: the same steps as for int4 in the next line, with the parts headed 'Car 1' of docs/wip/train4-int.md and the file int4-car1.json. Car 2 merges origin/main itself after the release.
- WAKE DONE mcint or int5 (the Minecraft integrations, when their jobs exist): read the hand-over U:/Temp/gsfpv-train4/mcint.json or int5.json and C:/dev/.gsfpv-lanes/designs/mc5-plan.md, part 'what the lead must do himself'.
- WAKE DONE int4: read 'Deploy order' in docs/wip/train4-int.md; push the sound package's main first when the order names it; release the API files when it names them; then the vault tool ship_chain.sh with the sha and the live checks of int4.json; then STATE.md, this note, the vault notes.
- WAKE LIMIT: the weekly limit reached 80 %: tell the owner, start nothing.

## State, 2026-11-19 15:30 UTC

- mc4 is done (C:/dev/ShramkoSplatCraft, docs/STATUS.md, no remote, nothing published). The six pictures went to the owner at 15:27 UTC with the honest verdict: the layout reads from above; from the street it is a corridor of stepped walls without windows, mostly grey. He has not answered yet. Nothing of Minecraft starts before his yes; nobody opened a schematic in the real game.
- Lanes menu4 and tails4 are done, the check of tails4 says SHIP; the other twelve lanes are in their second to fourth stage. The weekly limit went from 5 % to 14 % in the first 75 minutes.

## State, 2026-11-19 16:30 UTC

- The owner answered the Minecraft trial at 16:10 UTC: 'OK, build on. Start more agents so that all of it gets done faster' (message 68 in the vault brief). Lane mclook runs (the street look: facade colour by measurement, windows and doors, pitched roofs; prompt t5-mclook.md; work copy C:/dev/ShramkoSplatCraft, branch main). The designs of the rest are written by the lead session's Workflow shramko-minecraft-rest-design (run wf_1e396bd0-327): C:/dev/.gsfpv-lanes/designs/mc5-load.md (block worlds in the simulator), mc5-core.md (the whole Lublin, a voxelizer for any scan), mc5-web.md (the browser tool and its publication), mc5-plan.md. Its planner writes the prompts t5-*.md, makes work copies and registers HELD jobs (lanes, checks r-*, integrations mcint and int5): the lead reads mc5-plan.md and releases them with `set --name X --state wait`.
- Why two cars: measured at 16:10 UTC, an acceptance stage takes 60 to 95 minutes a run instead of 20 (ux4b 96, ux4a 93, edit4a 86) and a check 25 to 50 minutes; the video card is not the queue (RTX 4090 at 32 %). max_parallel is 24. The weekly limit is at 17 %.

## State, 2026-11-19 17:10 UTC

- The Minecraft work is planned in C:/dev/.gsfpv-lanes/designs/mc5-plan.md (thirteen lanes in two repositories, their contracts, the order, and part 4: what the lead does himself). 23 jobs were released at 17:06 UTC. Still HELD, with the moment to release them: mcfly and r-mcui when car 1 is on origin/main; int5 when r-mcui says SHIP (make C:/dev/gsfpv-t5-int first, plan part 4.3); mcjoin, r-mcjoin, mcapi, r-mcapi when car 2 is on origin/main (make C:/dev/gsfpv-t5-mcapi first); mctiles and r-mctiles after int5's first release.
- Car 1 merged site4, edit4b, menu4, tails4, head4; its full check passed at 17:06 UTC (head 8056d078). gen4b went to car 2: without gen4a its level and spread buttons change nothing. Car 1 changes deploy/nginx.conf (head4): release it with the vault tool ship_chain.sh and SHIP_FLAGS=--nginx (the chain then calls deploy/release-train.sh, which keeps the release order).
- The owner was asked at 17:15 UTC for one yes or no: may the agent check the world save with the game's own free server file (a portable Java on U:, Mojang's server file, the agreement flag in his name). On his yes: write U:/Temp/gsfpv-train4/mcworld/owner-yes.txt, then `set --name mcworld --state wait --reset-runs`. On no: nothing.
- More runs were given to gen4a (9), edit4a (9) and sound6 (10). Disk C has 23 GB free: a background watcher of the lead session wakes it under 10 GB. The weekly limit is at 25 %.

## Not verified at the start

The estimate of the end (about 4 hours after the start) and of the cost (about 65 agent runs) are estimates. No lane has run with this conductor before: its first events are the proof.
