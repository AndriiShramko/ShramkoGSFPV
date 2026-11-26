# Train 5: lead note (start here)

Written 2026-11-26 12:50 UTC by the lead of train 4, whose chat had grown to about 60 % of its context. The owner's
rule (vault brief, message 78): a lead whose context grows hands the work to a new chat; the lead keeps the smallest
context it can and gets short, exact results from the workers. History, only when needed: docs/wip/train4-lead.md
(336 lines; read its last State section by slice, never whole). The owner's words are in the vault brief
`01 - Projects/FPV-симулятор в 3DGS-сценах/Бриф Андрія — ShramkoGSFPV (дословно).md`, messages 77 to 79 at its end
(read those three by slice: `grep -n "сообщение 7[789]"`).

## How the lead works (the owner's economy rule, to be written into the skills: W4)

- The lead runs on the top model (Fable); every worker is Opus or Sonnet. NEVER leave `model` out of an Agent call or
  a Workflow agent(): left out, it inherits the lead's model, the dearest one. Conductor jobs carry `--model opus`.
- Opus: diagnosis, design, an independent check, an integration, hard code. Sonnet: edits by a finished spec, probe
  and build runs, collecting data and web pages, tables, repeated conversions. No model at all: releases, live checks,
  counting, log reading (scripts).
- Hand over at 50 % of the context (the owner: 59 % is already too much): a lead note like this one, then a new chat.
- Wake only for: a release done, FAILED, HOLD, a repair lane done. One status command, small outputs. Do not read
  STATE.md whole (its bullets are 3 to 5 KB each): `sed -n '7p' STATE.md | cut -c1-600`.
- Agents at once: 3 (the conductor's max_parallel). The week was spent in 30 hours last time (49 % to 97 %): decide a
  daily share before releasing lanes; the publications of the owner's Facebook pipeline live on the same week.

## Live (2026-11-26)

`main` 3cc6b51b, sound package 9ac7876, built 2026-11-21 20:36 UTC: car 5 (the tutorial lanes tutor-say, tutor-moment,
tutor-air and n-share) on top of cars 1 to 3 and the hot repair. STATE.md has the entries of every car.
Live checks of car 5: 14 of 15 PASS; FAIL accept-fly (one run, on a day this PC's line gave 0.55 MB/s). A second run
was started 2026-11-26 about 12:50 UTC with no model: read U:/Temp/gsfpv-train4/ship-car5/live-r2.log (file
live-r2.done appears when it ends). PASS: write it into STATE.md's first bullet. FAIL again: a repair lane on the live
code at priority 1 (the pattern: prompts/t9-fix-gizmo13.md and its check; page or probe).

## The conductor now (`python -X utf8 <vault>/.claude/tools/gsfpv/train4.py status`)

- Running since the week's reset: n-route (run 10 of 12, stage S5b: the pro level never lays a route course, one plan
  hangs) and fix-n-save (the editor's top bar covered four page buttons on a laptop view; then r-n-save runs again).
- car4 waits for r-n-route and r-n-save; n-scan and n-path are done and checked. ship-car4 follows car4 by itself.
- PARKED (state hold): n-level, gap-editor, gap-msgs, gap-voxels, gap-ui and their checks r-*. Minecraft: all held.
- DECIDE FIRST: n-route and n-path change the course generator, which the owner now calls worse than before (W1).
  Do not let car 4 release generator changes before W1's diagnosis says what is wrong; n-save and n-scan are free of it
  (car4's prompt leaves out a lane whose check is not SHIP; to keep a lane out, set its check to hold).
- Commands, the fair queue, own stops, the lead's watcher and the release scripts: the gsfpv skill, references/train.md
  and references/lessons.md. Watcher: `bash <vault>/.claude/tools/gsfpv/lead_watch.sh 0 5` in the background.
- Lessons of train 4 that cost releases: never run gates.py in C:/dev/gsfpv-v03 (the lead copy; ship_chain.sh now puts
  tracked evidence back); do not edit the lead copy while a ship job runs; a release job's log is
  U:/Temp/gsfpv-train4/runs/ship-<car>-*.log.

## The owner's new work (messages 77, 78, 79 of 2026-11-25), as packages

W1, the course generator (message 77; first priority: it is live and he flew it). His finding: since car 3 the gates
are ALWAYS laid in the poorly scanned outskirts of a scan; before it was sometimes good, sometimes bad. Nobody has
looked at the cause yet. Step 1, a diagnosis lane (Opus): which rule picks the place now (gen4a's 'best scanned part':
what it measures), why it prefers the outskirts, what changed against the release of 2026-11-16; pictures from above
with the gates on five scans. His ideas to design in: (a) the camera the scan's author set on SuperSplat stands in a
well scanned place: use it as the anchor; (b) 'generate here', around the drone; (c) Shift+G over an existing course
asks: add more here, where the drone is, or all from scratch; (d) offer to fly to the wanted place, pause, generate
there. The lead's first take: the pilot's place is the default anchor (at the first load that is the author's camera),
the quality map only forbids, never attracts; the dialog offers Here / Whole scan / Add here.
He also asks for a test system the agents run themselves and improve without end, 'a skill or a sub-skill': a fixed
set of scans, seeds and levels; numbers per course (share of gates in the well scanned zone, distance of gate 1 from
the pilot, gates and legs in walls, seconds, refusals, hangs); pictures from above and from the pilot's eye judged by
an Opus agent against his words; negative controls; a ledger of findings. Pieces that exist:
tools/bench/src/gen4-place-audit.ts (it hangs on one plan: n-route's S5b), course-path-probe, save-check-probe,
tools/bench/scripts/gap-gen-accept.mjs, the live check gen4-generate-dialog.

W2, a pilot's feedback (message 77, Polish). He says: flying a 3D scan is great; the better textures load slowly (maybe
his line); he found no way to choose a scene again, only next or random; the camera angle setting was hard to find;
the drone is damaged too fast when it touches the ground, a lower sensitivity near the ground by default would be
better. The lead's take, for the owner to confirm in one question: APPLY a scene chooser in flight (the catalogue from
the pause menu); APPLY a softer default for touching the ground (measure the present thresholds first; walls stay);
APPLY one line that names the camera angle where a new pilot looks (the first-minute menu of menu4); DO NOT change the
loading for his line: detail streams by the line's speed (fix-lod measured it), answer him so.

W3, prop wash and whoops (message 78). 'Why is there no physically right prop wash? We had it and it is gone.' Step 1:
`git log -S` for prop wash in packages/sim-core: was it there, when and why it went (a craft preset at zero, a flight
style that skips it). Step 2, research with sources (Sonnet collects, Opus builds the model): where prop wash shows
(descent through the own wake, a throttle punch after a dive or a flip) and its size by disc loading; a 65 mm whoop of
the class of BetaFPV's Air65 Champion: mass, motors, props, battery, thrust to weight, rates; public Betaflight
blackbox logs of such whoops for step response and thrust curves. Step 3: a craft preset and the model, each number
with its source or marked as an estimate; the determinism test tools/bench/test/a6-reference.test.ts keeps its hash at
default settings.

W4, the economy rule itself (message 78): write the part 'How the lead works' above into the skills limit-safe-work
(the lead's context ceiling, the hand-over, the model table with 'when Sonnet') and gsfpv (the lead's routine), by
.claude/rules/skills.md (lint after the edit). His words are already in limit-safe-work/references/lessons.md. When a
new model appears, the table is measured again. Small, do it early: it shapes every later job.

W5, the vision (message 79): the tool turns point clouds into physically right, NAMED objects (cup, spoon, table top,
legs) that an AI agent reaches through an MCP server ('find every metal chain', 'the flowers that bloom red', 'walls of
red brick', 'what stands on the kitchen table') and can change; glass breaks and falls, pieces come off a wall, the
physics can be exaggerated for fun. This is a new direction, not a lane: run the project-kickoff skill (inventory of
what exists: walls voxels, collision, the block worlds of ShramkoSplatCraft; research of 3DGS segmentation and of
physics on splats; an MCP design) and bring the owner a staged plan with a small first stage. No building before it.

## First actions, in order

1. Read the three messages in the brief. Read live-r2.log. `train4.py status` (first lines and the jobs not done).
2. Tell the owner in one short message what is live since 2026-11-21 (he has not been told: the old chat was stopped
   by the weekly limit), with his path through the tutorial ('What the owner should try', the Car 5 part of
   docs/wip/train4-int.md) and the three questions for the feedback's author and the testers (designs/t8-plan.md,
   Part D). Still open from before: whether to answer that author in the Facebook thread.
3. W4 (small). Then W1's diagnosis lane and W3's step 1 as conductor jobs; W2 as one question to the owner; W5 by the
   project-kickoff skill.
4. Decide about car 4 and the parked lanes after W1's diagnosis; write the decision here.
