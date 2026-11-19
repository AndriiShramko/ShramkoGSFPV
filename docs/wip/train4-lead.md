# Train 4: lead note (handoff)

The owner's messages 64 to 67 of 2026-11-19 (vault brief, verbatim): finish what was left and build the new brief (course generator, course editor, voxel view, messages, cancel of a loading scene, the site's Fly now on the sound page, the quick sound lesson, a Minecraft trial), fast, with many agents at once, and cheap on checks. Train 3's end and its leftovers: the first bullet of STATE.md.

## How it runs

- Designs: five agents on the API key wrote C:/dev/.gsfpv-lanes/designs/gen4.md, edit4.md, voxux4.md, sound6.md, mc4.md (causes proven from the code, the change, owned files, stages, checks).
- Fifteen lanes are built at the same time, each in its own work copy on its own branch (the owner lifted the rule of three agents for this train). Start: 2026-11-19 14:16 UTC.
- The conductor has no model: vault tool .claude/tools/gsfpv/train4.py, Windows task ShramkoGsfpvTrain every minute, plan C:/dev/.gsfpv-lanes/train4.json. One agent run is one stage (`claude -p`, opus, shell and file tools only) and ends with LANE-STAGE-DONE or LANE-DONE; the next stage is a new run with a clean context. After a lane the conductor starts its independent check `r-<lane>`; after all checks the integration `int4`.
- Events: U:/Temp/gsfpv-train4/events.log; lines with WAKE are for the lead. Status: `python -X utf8 <vault>/.claude/tools/gsfpv/train4.py status`. Park a job: `set --name X --state hold`; give it back: `--state wait`.
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
- WAKE DONE mc4: look at the pictures U:/Temp/gsfpv-train4/shots/mc4-*.png, show them to the owner, ask for his yes.
- WAKE DONE int4: read 'Deploy order' in docs/wip/train4-int.md; push the sound package's main first when the order names it; release the API files when it names them; then the vault tool ship_chain.sh with the sha and the live checks of int4.json; then STATE.md, this note, the vault notes.
- WAKE LIMIT: the weekly limit reached 80 %: tell the owner, start nothing.

## Not verified at the start

The estimate of the end (about 4 hours after the start) and of the cost (about 65 agent runs) are estimates. No lane has run with this conductor before: its first events are the proof.
