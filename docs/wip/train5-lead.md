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
- Hand over at 50 % of the context (the owner: 59 % is already too much): a lead note like this one, then START the
  new chat yourself (start_session) and detach it. NEVER end a turn of a heavy chat with a question to the owner, not
  in the text and not as wrap_up buttons: his 'yes' makes the heavy chat read its whole context again. He forbade it
  on 2026-11-26 (message 80 in the brief; in short: decide with your agents and go on). The app refused to start a
  session (the turn was begun by a service, not by him): leave the card with no question and keep the work moving by
  conductor jobs and workers; do not wait for an answer.
- Decide yourself and write the decision down. A question to the owner only when the work cannot move without him
  (money, a password, a physical act, a fork with no sane default): one question, in a light chat, with the default
  already being done. Reports: short, by results, no question at the end.
- Wake only for: a release done, FAILED, HOLD, a repair lane done. One status command, small outputs. Do not read
  STATE.md whole (its bullets are 3 to 5 KB each): `sed -n '7p' STATE.md | cut -c1-600`.
- Agents at once: 3 (the conductor's max_parallel). The week was spent in 30 hours last time (49 % to 97 %): decide a
  daily share before releasing lanes; the publications of the owner's Facebook pipeline live on the same week.

## Live (2026-11-26)

`main` 3cc6b51b, sound package 9ac7876, built 2026-11-21 20:36 UTC: car 5 (the tutorial lanes tutor-say, tutor-moment,
tutor-air and n-share) on top of cars 1 to 3 and the hot repair. STATE.md has the entries of every car.
Live checks of car 5: 14 of 15 PASS; FAIL accept-fly, two runs of two (2026-11-21 on a 0.55 MB/s line; 2026-11-26
12:45 UTC on a fast line, no model). The second run: every scene-open line B6 is 'ready' in 1.2 to 1.9 s (nine
forms), then `page.goto: Timeout 30000ms exceeded` (line 24 of the 36 in
U:/Temp/gsfpv-train4/ship-car5/live-r2/accept-fly.log). Not known: which navigation it is, and whether the page or the
probe is at fault (car 5's tutorial changed the first flight; the owner flew the live site on 2026-11-25, message 77,
and did not report a broken flight). FIRST JOB: a repair lane on the live code at priority 1 (the pattern:
prompts/t9-fix-gizmo13.md and its check); then its result into STATE.md's first bullet.

## The conductor now (`python -X utf8 <vault>/.claude/tools/gsfpv/train4.py status`)

- State at 2026-11-26 17:25 UTC: NOTHING RUNS. n-route FAILED at 14:42 UTC (12 runs of 12, stage S5 still left: the
  pro level never lays a route course, one plan hangs). fix-n-save is done and r-n-save says SHIP; n-scan and n-path
  are done, their checks say SHIP. car4, ship-car4 and r-n-route were put on hold by the old lead (see DECIDED).
- PARKED (state hold): n-level, gap-editor, gap-msgs, gap-voxels, gap-ui and their checks r-*. Minecraft: all held.
- DECIDED by the old lead (2026-11-26; the owner: decide yourselves): car 4 as planned is NOT built. n-route and
  n-path change the course generator, which the owner now calls worse than before (W1); no generator change is
  released before W1's diagnosis. n-save and n-scan (free of it, both SHIP) go into the NEXT car together with W1's
  repair and W2's small fixes: one integration and one release instead of two. n-route gets no more runs: its open
  stage S5 is an input of W1's diagnosis (the lane's branch and note). The next car is a new job with its own prompt
  (pattern: prompts/t6-car4.md) whose `after` names only the checks it needs.
- The week: 19 % used at 17:15 UTC, five hours after the reset (the conductor's run logs saw 9 % at 14:33 UTC; the
  rest is the old heavy lead chat and the owner's other pipelines; nobody measured the split). Before any new lane:
  measure it by the limit-safe-work skill and set a daily share. Work outside publications stops at 83 %.
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
better. DECIDED (the owner, 2026-11-26: decide yourselves, do not ask): APPLY a scene chooser in flight (the catalogue from
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

W4, the economy rule itself (messages 78 and 80): write the part 'How the lead works' above into the skills
limit-safe-work (the lead's context ceiling; the hand-over with no closing question, the new chat started by the lead
itself; the model table with 'when Sonnet') and gsfpv (the lead's routine), by .claude/rules/skills.md (lint after the
edit). His words are already in limit-safe-work/references/lessons.md (two lines: 25.11 and 26.11) and in the memory
note heavy-chat-no-closing-question. When a
new model appears, the table is measured again. Small, do it early: it shapes every later job.

W5, the vision (message 79): the tool turns point clouds into physically right, NAMED objects (cup, spoon, table top,
legs) that an AI agent reaches through an MCP server ('find every metal chain', 'the flowers that bloom red', 'walls of
red brick', 'what stands on the kitchen table') and can change; glass breaks and falls, pieces come off a wall, the
physics can be exaggerated for fun. This is a new direction, not a lane: run the project-kickoff skill (inventory of
what exists: walls voxels, collision, the block worlds of ShramkoSplatCraft; research of 3DGS segmentation and of
physics on splats; an MCP design) and bring the owner a staged plan with a small first stage. No building before it.

## First actions, in order

1. Read the four messages in the brief (77 to 80: `grep -n "сообщение \(7[789]\|80\)"`). `train4.py status`, first
   lines only: nothing runs. Measure the week's spend (see 'The conductor now').
2. The repair lane for accept-fly (see 'Live'), priority 1.
3. W4 (small). Then W1's diagnosis lane and W3's step 1 as conductor jobs; W2 as lanes by the decision above; W5 by
   the project-kickoff skill (a staged plan as a file in the vault; take its defaults yourself).
4. The owner was told on 2026-11-26 what car 5 gives the pilot and the old lead's take on messages 77 to 79. Not yet
   told: his path through the tutorial ('What the owner should try', the Car 5 part of docs/wip/train4-int.md) and
   the three questions for the feedback's author and the testers (designs/t8-plan.md, Part D). Put them into the
   first report that carries a result, not into a message of their own. The answer to that author in the Facebook
   thread: the lead decides by the rules of the fb-engage skill.
5. The parked lanes stay parked until the next car is planned. Write each decision into this file.
