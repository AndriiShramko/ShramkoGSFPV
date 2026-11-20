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

## State, 2026-11-19 21:50 UTC: after the outage (READ THIS FIRST)

What happened. At about 18:00 UTC the owner's subscription stopped working ('payment is past due'): every run of the train and three agents of the audit workflow failed. Since 20:05 UTC runs pass again, on another plan: 'Max' instead of 'Ultra'. It has a FIVE-HOUR window (23 % used at 21:31 UTC, it resets at 01:30 UTC) beside the weekly one (3 %, resets 2026-11-26 12:00 UTC). Estimate from one data point: about twenty agent runs fit into one five-hour window, so order matters more than width now. The old lead session holds 540 thousand tokens of context: each of its steps is too dear on this plan; a new small session leads from here.

The owner's words since (vault brief): message 70: Minecraft is a secondary task, everything else that is important comes first, 'use 98 % of the subscription today'; message 71: 'remove it, up to 98 %' (the reserve for Facebook publications: done with `limit_reserve.py allow-priority`; the hook pauses at 98 %, the conductor starts nothing new from 97 %); message 72: 'continue everything from where you stopped and use everything that was done'.

What is live. Car 1 = release aa18f1e4 since 17:28 UTC (site4, edit4b, menu4, tails4, head4; nginx released): CI success, 302 smoke checks, neighbours equal. Live checks: 10 of 12 PASS; FAIL: edit4b-course-life at step 10-pointed and the older edit-mouse-wroclaw at step d.controls (logs U:/Temp/gsfpv-train4/ship-car1/live/). Car 2's S2 settles both (its prompt, points 5 to 7). STATE.md's top is STALE (it still names 89c9c86e): the next lead adds car 1 and each later car.

The plan now (`train4.py status`; max_parallel 3; main brief first):
- int4 = car 2 (ux4a, ux4b, vox4, edit4a, edit4s, edit4c, sound6; the outage caught it in the middle of merging edit4a), then ship-car2: a job WITHOUT a model: the vault tool ship_handover.py reads U:/Temp/gsfpv-train4/int4.json, pushes the sound package's main when the hand-over names its head, builds SHIP_FLAGS (API files, rooms, nginx) and runs ship_chain.sh with the named live checks. It ends with exit 0 also when the page is live and a live check failed: then U:/Temp/gsfpv-train4/ship-car2/LIVE-CHECKS-FAILED.txt exists. It has only run dry so far.
- gen4a (its last stage A3), r-gen4a, car3 (gen4a and gen4b), ship-car3 (the same script with int4-car3.json; it waits for ship-car2).
- The owner's-eye jobs (they LOOK at pictures against his words and write verdict.json): eye-view is done: U:/Temp/gsfpv-train4/eye-view/verdict.json: three points OK (no frozen picture, cancel of loading, messages), two NOT as he asked: light and shade are still flat in the default Wireframe style, and the hole under the craft in Lublin and Wroclaw is still there (his line 577: only a note explains it). eye-editor and eye-gen4a wait for a free slot.
- plan-gaps: reads C:/dev/.gsfpv-lanes/designs/t6-audit.json (the audit of the whole brief: 83 wishes, 26 done, 57 open of which 26 are high: most 'open' ones are built and wait for cars 2 and 3) and writes designs/t6-gaps-plan.md (Part A is the wish-by-wish table the owner asked for), the prompts t6-*.md and HELD jobs gap-*, r-gap-*, car4. Release the gap lanes one or two at a time in its order.
- Minecraft: EVERYTHING HELD (the owner's priority). Done so far: mc4, mclook and its check, mcseed, mcread, mcwalls, mcmesh, mcview with checks, mcui (U1a, U1b), mcworld to W3 (W4 is the check with the game's own server file: the owner said yes, U:/Temp/gsfpv-train4/mcworld/owner-yes.txt), mcvox to V3a, mcbig B1, mcweb to S2, mctruth T1. Resume in the order of designs/mc5-plan.md with `set --name <job> --state wait`, after the main brief or on the owner's word.

The conductor learned today: WAKE HOLD for a check without 'Verdict: SHIP'; `add` and `set` take the tick's lock; cars (an integration takes the lanes that are ready); a job's own lower limit (`limit_stop` in the job); an outage (a run that never reached the model) is waited out 10, 20, 40, then 60 minutes at a time, up to 14 times, and does not use up the job's runs; releases as jobs without a model.

Left over from the audit workflow (the outage killed them; nothing is lost but the runs): applying the token-economy research C:/dev/.gsfpv-lanes/designs/econ4.md to the skills, and the walk of car 1's five roads on the live site by mouse. Their full task texts are in the workflow script (SKILLS_TASK, LIVE_TASK): C:/Users/andri/.claude/projects/U--documents-Obsidian-AndriiShramko/7d2286ce-5ac6-4485-86e6-247656841e70/workflows/scripts/shramko-main-brief-audit-wf_14bc5fcb-16c.js . Run them as jobs when the cars are out.

Not verified: the estimate of twenty runs a window; ship_handover.py beyond its dry run; the outage rule beyond its unit test; whether car 2's hand-over names the API files of edit4s exactly (the script stops when a name is strange).

## Not verified at the start

The estimate of the end (about 4 hours after the start) and of the cost (about 65 agent runs) are estimates. No lane has run with this conductor before: its first events are the proof.

## State, 2026-11-20 12:15 UTC: the night, five new wishes, the new layout (READ THIS FIRST)

Live: still car 1, release aa18f1e4. STATE.md's top is stale (it names 89c9c86e): repair it when car 2 goes live.

The night. The subscription (Max) counts five-hour windows (resets seen at 01:30, 06:30, 11:30, next 16:30 UTC). int4
(car 2) merged its seven lanes at 21:40 and has been in S2 since: real seams between the four editor lanes (the editor
window under the top bar on a low view, a click's ray through scan near the eye, probes of one lane broken by another).
The window cut its long run three times (04:23, about 09:40, 11:21 UTC) and the conductor retried hourly. Its commits
are safe; each run continues from "## Status" of C:/dev/gsfpv-v13-int/docs/wip/train4-int.md. Restarted 11:41 UTC with a
stage-size rule in its prompt (about 40 tool calls, then LANE-STAGE-LEFT S2) and max_runs 14.
Done at night with SHIP: gap-gen, gap-save, gap-sound. Eyes done: eye-editor (8 not ok), eye-gen4a (3), eye-view (2).

The owner's messages 73 and 74 (vault brief): five wishes. The lead's decisions: C:/dev/.gsfpv-lanes/designs/t7-brief.md
(1 Save never refuses: fix all / save as is / show me; 2 a shared link opens the same scene, course and way of flying;
3 course level Beginner / Intermediate / Pro with rules; 4 the light path and path-first generation; 5 every superspl.at
scan opens; 6 the eyes' findings routed to lanes).

Jobs added 11:41 UTC: base7 (branch t7-base in C:/dev/gsfpv-t7-base = the integration head of 11:41 + gap-gen + gap-save
+ gap-sound + the joined package commit; writes U:/Temp/gsfpv-train4/t7-base.txt when its gates pass) and plan-new
(prompts/t7-plan.md: P1 plan designs/t7-plan.md, P2 prompts t7-*.md and the rewritten t4-car3.md and t6-car4.md,
P3 t7-copies.sh, the jobs, car3 after base7, car4 after the new checks; added with --wake).
New layout: car 3 = ONE merge of t7-base on the integration copy after car 2; car 4 = the new lanes + gap lanes 4-7
that say SHIP. Minecraft stays held.

Workflow wf_1638040d-a1f (shramko-t7-kickoff), started 11:41 UTC: (a) diagnosis of scene a39abad1 ->
designs/t7-scene-open.md with an independent check; (b) train4.py paced by the five-hour window (reads rate_limit_event
of the run logs: no new model runs from 90 %, a refused run waits for the reset; set --max-runs, --not-before), with a
review. Check its result before trusting either.

Watchers of this session: bunm3y3m2 (WAKE FAILED / HOLD / LIMIT), borl0ozyn (DONE ship-car*, WAKE DONE plan-new),
bme117exk (disk C under 10 GB).

On wake: ship-car2 done -> read U:/Temp/gsfpv-train4/ship-car2/ (ship.log, live.log, LIVE-CHECKS-FAILED.txt), check
release.json, repair STATE.md, tell the owner what is live and how it was checked. plan-new done -> read "For the lead"
of designs/t7-plan.md and `train4.py status`. Not done: the mouse walk of car 1's roads on the live site.

Cost facts (tools/gsfpv/run_cost.py in the vault): a run of 31-38 replies 0.2-0.3 M weighted tokens, 92-123 replies
0.9-1.5 M; a window holds about 12 M (an estimate).

## State, 2026-11-20 12:45 UTC: the scan's cause, the hot lane, the release guard

Scene a39abad1: superspl.at publishes SOG version 3 since 2026-11-10; playcanvas 2.23.2 cannot read it (endless loader,
or "ready" over black for streamed scans); 65 of 190 public scans fail. Diagnosis with an independent check:
C:/dev/.gsfpv-lanes/designs/t7-scene-open.md. Repair = playcanvas 2.24.2 + splat-transform 3.12.0, proven on the bare
engine only.
Hot lane: hot-copy (cmd) -> hot-sog3 (prompts/t7-hot-sog3.md, copy C:/dev/gsfpv-t7-hot from origin/main) -> r-hot-sog3
-> ship-car0 (cmd `bash C:/dev/.gsfpv-lanes/t7-hot.sh ship`: needs Verdict: SHIP, then ship_handover.py on
U:/Temp/gsfpv-train4/hot-sog3.json into U:/Temp/gsfpv-train4/ship-car0). n-scan waits for file hot-sog3.json and does
the rest of the repair list.
Release guard: ship_handover.py exits 40 when origin/main holds code the candidate does not contain (outside docs/,
*.md, packages/i18n/locales/); t4-int4.md, t4-car3.md and t6-car4.md got the paragraph MAIN MOVES (merge origin/main
before the hand-over, re-check when it brings code). --allow-moved-main overrides by hand.
Conductor: commit 7df1f38 in the vault paces by the five-hour window (status line 2; events WINDOW, RETRY-AFTER-WINDOW;
set --max-runs / --not-before). Priorities: integration jobs and the hot lane 1, new lanes 2, gap lanes 3.
plan-new is done: designs/t7-plan.md ("For the lead" at its end), six lanes n-route, n-save, n-scan, n-share, n-level,
n-path with checks r-n-*; open decisions taken as recommended (g3 links for path-first courses, g2 kept; the level in
the browser's prefs). Live is ac11d2c2 (car 1 + sound page texts of another session, released 11:50 UTC).
Watchers: b8em29xja (DONE ship-car*), bunm3y3m2 (WAKE FAILED / HOLD / LIMIT), bme117exk (disk C).

## State, 2026-11-20 16:50 UTC: the tutorial feedback, the window, what is queued (READ THIS FIRST)

Live: still ac11d2c2 (car 1 + the sound page texts of another session). Nothing of this train went live today: the
five-hour window ended about 14:15 UTC and every job waited until 16:30 (this window resets 21:30 UTC).
The owner raised the five-hour boundary (message 75): the hook's line is 97 % (limit_reserve.py priority --h5-line 97),
the conductor starts new runs up to 95 % (five_stop in the plan).
Incident 12:36-12:56 UTC: the hook's new five-hour publication reserve (its line was 85 %) refused the train's prompts.
The refusal text echoes the prompt, whose last line names the markers, so the conductor counted stages: n-route, n-save,
n-share and gap-editor lost all their runs with no work done. Repaired: gsfpv_lanes.last_result returns (no result, True)
for a text with operation blocked by hook (vault commit 00fa862); the runs were given back.
Message 76: the feedback of a low-vision pilot about the Fly by Sound tutorial (chaotic, too much at once, the menu
buttons read at every step, sounds should be brought in at the action with a pause). The owner's earlier wishes about
the lessons are built in sound6 (car 2) and gap-sound (t7-base) and are not live. Decisions: designs/t8-tutor-brief.md
(say only what is new; the first flight is the tutorial; one new sound at a time with the other layers silent; a moment
= freeze, one sentence, the sound alone, the task; a What is this sound key; at most eight moments; short speech; large
text for low vision; the numbers that prove it). Planner job plan-tutor (prompts/t8-plan.md) writes designs/t8-plan.md,
the lanes tutor-*, their checks, and car 5 if they cannot ride car 4.
Queue at 16:50 UTC: running n-route, n-path, hot-sog3; ready int4, n-save, n-share, plan-tutor, gap lanes 4-7.
THIS SESSION IS HEAVY (about 300 thousand tokens of context on the top model): its wake after a pause of three hours
took about a quarter of a five-hour window (38 % was seen nine minutes into the window; an estimate, not a measurement).
A new lead session should start from this file and should not set watchers that wake the old one.
Open for the owner: whether to answer the author of the feedback in the Facebook thread and invite him as a tester.
