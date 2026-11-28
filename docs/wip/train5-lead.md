# Train 5: lead note (start here)

Written 2026-11-26 12:50 UTC by the lead of train 4, whose chat had grown to about 60 % of its context. The owner's
rule (vault brief, message 78): a lead whose context grows hands the work to a new chat; the lead keeps the smallest
context it can and gets short, exact results from the workers. History, only when needed: docs/wip/train4-lead.md
(336 lines; read its last State section by slice, never whole). The owner's words are in the vault brief
the verbatim brief in the vault's project folder of the FPV simulator (`01 - Projects/FPV-*3DGS*/`, the one file whose
name ends with `ShramkoGSFPV (...).md`), messages 77 to 80 at its end (read them by slice:
`grep -nE "^## 2026-11-2[56], \S+ (7[789]|80) "`). THIS NOTE STAYS IN LATIN LETTERS: Cyrillic in the repo's docs fails
gate B18 for every lane; name a vault note by words, not by its Russian file name.

## Lead 2, state at 2026-11-26 17:45 UTC (it overrides the sections below where they differ)

- Vault git is repaired: merge 2bd2a8a, backup ref `backup/main-20261126-1828`, `main` level with `origin/main`.
- The week's control: the conductor has a DAILY SHARE (`train4.py plan --share`; skill gsfpv, references/train.md). New
  model runs start only while the weekly percent is under 25 % at 2026-11-26 18:00 UTC plus 8.5 points a day; the plan's
  limit_stop is 80 (the hook's border for work outside publications is 83). The event SHARE (once a day) wakes nobody.
  The reading at 17:40 UTC: 20 %. Agents started inside the lead's chat are NOT held by it: `limit_reserve.py status`
  before each. API credits: none left (both grants burned), everything runs on the subscription.
- W4 is DONE: skills limit-safe-work 2.7.0 (the model table, the lead's ceiling and hand-over, no closing question, the
  line of spend) and gsfpv 2.2.0 (the section about the train's lead); vault commits 1fd4b93 and 032258a.
- Jobs added (prompts C:/dev/.gsfpv-lanes/prompts/t10-*.md; opus, but w5-inv is sonnet):
  - fix-fly (priority 1, copy gsfpv-t7-hot) and r-fix-fly: the accept-fly failure, page or probe.
  - w1-diag (2, copy gsfpv-t7-n-share; its document C:/dev/.gsfpv-lanes/designs/w1-diag.md) and r-w1-diag, which tries
    to refute the diagnosis. S1 (Rule, History) was done at 17:36 UTC.
  - w3-wash (3, copy gsfpv-t7-base, --wake): W3 step 1.
  - w2-pilot (4, copy gsfpv-t8-tutor-air) and r-w2-pilot: W2's three APPLY decisions in ONE lane (the ground default,
    the camera line, the catalogue from the pause menu).
  - w5-inv (5, reads C:/dev/gsfpv-v03, writes one vault note in the project's research folder): W5's inventory.
- The watcher wakes on FAILED, HOLD, END, `DONE r-fix-*`, `WAKE DONE w<N>-*`, `DONE r-w<N>-*`.
- NEXT, at the wakes:
  1. r-fix-fly's verdict. Page: release the repair (ship_chain.sh). Probe only: it rides the next car. The result goes
     into STATE.md's first bullet.
  2. w3-wash done: W3 step 2 is ONE agent with the web inside the lead's chat (model sonnet) that collects sources on
     prop wash and on 65 mm whoops of the Air65 class (mass, motors, props, battery, thrust to weight, rates, public
     blackbox logs) into a vault note; then an opus lane builds the model and the preset (step 3). While such an agent
     runs: `plan --max-parallel 2` (the norm is 3 at once, the conductor counts only its own).
  3. r-w1-diag says SHIP: plan the repair lanes from the design page of the document (the owner's ideas a to d) and the
     next car: n-save and n-scan (both SHIP), W1's repair, w2-pilot, fix-fly.
  4. W5 after w5-inv: two web research agents (sonnet: cutting a splat scan into named objects; physics and breaking
     on splats in a browser), one opus design of the staged plan (a small first stage, the MCP design), one critic pass
     (agent gs-critic, model opus). The plan is a vault note in the project folder. No building.
- The owner: the first report of this chat carried car 5's path and the three questions of t8-plan Part D. One question
  is open with him, by button: whether the lead answers Dawid in the Facebook thread (a group comment, so the rules of
  the fb-engage skill apply).

### 2026-11-26 17:50 UTC: w3-wash is done (one run), W3 step 2 runs

- The finding (C:/dev/gsfpv-t7-base, branch w3-wash, docs/wip/w3-wash.md, 'For the lead'): the prop wash model exists
  since feec5618 (2026-10-16, packages/sim-core/src/wake.ts). Nothing removed it: it is opt-in per preset (D38,
  docs/decisions.md:76) and only nazgulf5v3, machr5sport and taurusx8 carry it. The default craft pavo20pro-3s (the
  default since bcef1bf6) never had it; the setting physics.propWash does nothing on any whoop. A preset air65-1s
  already exists (no prop wash in it). Term ON with the 5-inch estimates on Pavo20: thrust -5.7 %, 2.1 deg/s: too
  weak to feel, so the size needs a model change, not only three preset fields.
- DECIDED (the lead; the owner asked for a physically right prop wash, message 78): prop wash becomes ON by default on
  every craft, scaled by class. That moves the determinism hash of a6-reference (1d01ca5b -> a new one) and needs a
  SIM_CORE_VERSION bump: accepted, the new hash is recorded by the lane of step 3; old recordings become older-build.
- W3 step 2 runs as an agent inside the lead's chat (general-purpose, model sonnet, with the web): sources on prop wash
  by class (the vortex ring state against v_h, the shake band, ducts) and the data of a 65 mm whoop of the Air65
  class, blackbox logs. Its note (W3-SOURCES below): the vault, project folder, research/, the ShramkoGSFPV note about prop wash and
  65 mm whoops with the sources. The conductor is at `--max-parallel 2` while it runs: put it back to 3 after.
- NEXT for W3: step 3 as an opus lane in C:/dev/gsfpv-t7-base on branch w3-wash (prompt to write from the note's last
  table): the model scaled by disc loading, the presets (pavo20pro-3s, air65-1s and the 5-inch ones re-based), a test
  with a negative control, the new a6 hash; its check r-w3-model.

### 2026-11-26 18:05 UTC: W3 step 2 came back, step 3 is queued

- The research note is in the vault (W3-SOURCES, each number
  marked measured, manufacturer, community or estimate). The main numbers: thrust is lost between 0.5 and 1.7 v_c/v_h
  with the peak at 1.2 to 1.4, up to 20 % (Veismann 2022, a 152 mm rotor); fluctuations begin near 0.4 v_h on a 63 g
  quad (arXiv 1909.09069); v_h at hover: whoop 5.68, Pavo20 7.85, 5-inch 7.03 m/s; the Air65 hovers at 35 % throttle,
  17.3 g dry, thrust to weight about 4.7 (the preset's 3.5 is low). Champion editions exist: V1 (30000 KV, 17.9 g)
  and Air65 II Champion (36000 KV, 16.6 g, the maker claims 6.3).
- Its gaps: the size and time scale of the thrust FLUCTUATION, the maker's own pages (HTTP 429), the frequency pilots
  see. A second agent (w3-research-2, sonnet) appends them to the same note; its last action creates
  U:/Temp/gsfpv-train4/w3-research-2.done, the file that releases w3-model.
- Public blackbox logs were not found by the web search: job w3-bbl (opus, priority 4, writes only to
  U:/Temp/gsfpv-train4/w3-bbl and one vault note in the same research folder, about the blackbox logs of 65 mm whoops) looks in GitHub issues with gh,
  decodes with the official viewer's parser taken as source, measures by script. 'No public log exists' is a valid end.
- Queued: w3-model (priority 3, copy gsfpv-t7-base, branch w3-wash, prompt t10-w3-model.md, three stages: the model,
  the presets and the new a6 hash, the numbers and the pilot) and r-w3-model.
- 18:08 UTC: the second pass is back and in the note (three added sections, the table corrected); the
  conductor is at 3 again and w3-model is released. Its numbers: the thrust's standard deviation over hover thrust
  rises from 0.03 to about 0.10 at the peak ratio (Veismann 2022, read off figures); 20 to 50 rotor revolutions a
  cycle (Stack 2004), so about 7 to 23 Hz on a whoop (an estimate); pilots report 20 to 100 Hz on 5-inch quads. The
  maker's pages, opened in the built-in browser: Air65 17.3 g, battery 7.11 g, thrust to weight 5.26 (Freestyle),
  5.82 (Race), 6.4 (Champion); motor 0702SE II 23000 KV 32.0 g at 4 V with the 1219S-3P propeller; camera 25 to 50
  degrees. Still no source: the shake of a 31 mm rotor, the gyro swing in deg/s, a whoop's prop wash frequency.
- State at 18:08 UTC, the week at 23 %: fix-fly in S2, w1-diag in S3 (its last), w2-pilot has S1 and S2, w3-model,
  w3-bbl and w5-inv are ready and wait for a slot.

### 2026-11-26 18:35 UTC: W1's diagnosis stands (r-w1-diag: SHIP), the repair lanes are queued; fix-fly: the probe

- THE CAUSE (C:/dev/.gsfpv-lanes/designs/w1-diag.md; the check U:/Temp/gsfpv-train4/reviews/w1-diag.md): car 3
  (72d4babf) made planCourse walk from `a.core`, the detail-richest window of the voxels (scan.ts:317, plan.ts:311); the
  spawn, which is the camera the scan's author set, is never read. A scan whose roughest place is a badly captured
  fringe gets every course there: scan eb5f51dc, gate 1 at 540 m from the camera; with the anchor at the spawn 2 m,
  and a mean splat rank of 0.99 instead of 0.50. The check repeated it with its own seed (0.45 to 0.99) and on Wroclaw
  (0.82 to 0.96). The picture: U:/Temp/gsfpv-train4/shots/w1-diag-eb5f51dc-live-old-neg.png (sent to the owner).
- DECIDED. R1 is lane w1-anchor (priority 1; copy gsfpv-t7-n-share, branch w1-anchor from w1-diag): the anchor is the
  pilot's place (the spawn when parked), every caller of planCourse is listed, the link carries the anchor, links of
  the old form keep their course. Then r-w1-anchor, then R2, lane w1-dialog (Here, the default; Whole scan; Add here;
  the owner's idea (d) is one line of text), and r-w1-dialog. NOT queued yet: R3 (a forbid map made from the splats,
  the quality map stops attracting; large), n-route rebased on R1, and the test system as one command with a ledger
  and a reference in the gsfpv skill (its seed: tools/bench/src/w1-diag-measure.ts; the document's section Test
  system). Plan them when r-w1-anchor says SHIP.
- fix-fly's answer: the PROBE, not the page. The live page reaches `load` in 0.1 to 0.7 s; with the repaired probe the
  ten items pass twice on the live site. No release is needed; branch fix-fly (copy gsfpv-t7-hot) rides the next car.
  r-fix-fly runs.
- The next car (car 6), when their checks say SHIP: fix-fly, w1-anchor, w2-pilot, n-save, n-scan; w1-dialog and
  w3-model if they are ready by then. Its integration prompt is still to write (patterns: prompts/t6-car4.md,
  prompts/t8-car5.md).
- The week is AT the daily line (25 %): new runs start only as the line climbs, 0.35 points an hour. w1-anchor goes
  first by priority.
- B18: this note held Cyrillic (a vault path) from its first version and failed gate b18 in every lane. It is in
  Latin letters now; a lane on an older base still sees that one failure and train4-common.md tells it to pass by.

- 18:45 UTC: r-fix-fly says SHIP (the probe only, no release); STATE.md has a bullet for it. The week is at 26 %,
  over the line (25.2): everything waits for the line but a job marked `train4.py set --name N --share-free on`
  (new: for the owner's first priority only; the plan's stop still holds). w1-anchor and r-w1-anchor carry the
  mark. Take it off when r-w1-anchor is done; give it to the car's integration job if the line still holds then.

### 2026-11-26 19:45 UTC: w1-anchor is checked (SHIP); car 6 is queued and its job releases it

- w1-anchor (R1): r-w1-anchor says SHIP, no repair was needed. Scan eb5f51dc by mouse: gate 1 at 3.3 m from the camera
  (live: 492.6 m); 30 m away and paused: 3.8 m from the drone; a link lays the same gates in a fresh browser; links of
  the old form lay their old course gate for gate (hashes). Ranks of the gates: eb5f51dc 0.50 to 0.99, Lublin 0.62 to
  0.96, Tunis 0.89 to 0.92. Page only. Left for R3: on Tunis 6 of 18 courses start 12 to 20 m off the anchor.
- w3-model is done (4 runs); r-w3-model waits for the line.
- CAR 6 is fix-fly and w1-anchor ONLY (the lead's order: the generator's repair goes live first; n-save, n-scan,
  w2-pilot, w1-dialog and w3-model ride car 7). Jobs: car6 (prompt prompts/t10-car6.md: a header for this car, then
  the body of t8-car5.md; copy gsfpv-v13-int; share-free) and ship-car6 (a command: ship_handover.py with
  U:/Temp/gsfpv-train4/int4-car6.json, out folder U:/Temp/gsfpv-train4/ship-car6). The watcher wakes on
  `DONE ship-car6`, on FAILED and on RETRY-LATER.
- UNTIL ship-car6 IS DONE: no commit to C:/dev/gsfpv-v03 outside docs/ (ship_handover.py stops with exit 40 when
  origin/main holds a path outside docs/, evidence/ and the locales that the candidate lacks: STATE.md counts), and
  no edit of the lead copy while the ship job itself runs (exit 12).
- AFTER the release: the last lines of U:/Temp/gsfpv-train4/ship-car6/ship.log and live.log; STATE.md's first bullet
  (car 6 live, the checks, what is not verified); the owner's path from docs/wip/train4-int.md, 'What the owner
  should try', Car 6; take share-free off car6; then plan car 7 and W1's R3, the n-route rebase and the test system.
- The week: 29 % at 19:35 UTC (26 % at 18:41: the chain above the line, and other consumers). The line allows 25.6 %:
  w1-dialog, r-w3-model, w2-pilot, w3-bbl and w5-inv wait until about midday of 2026-11-27.

### 2026-11-26 21:15 UTC: CAR 6 IS LIVE (94727c6c); one live check failed and is rerun; disk C; this chat is detached

- Live: release.json sha 94727c6c, built 2026-11-26T20:26:21Z, the sound package 9ac7876 (unchanged). ship.log: CI
  success, 302 checks passed, neighbours equal. Live checks: 8 of 9 PASS (accept-fly, w1-anchor-accept,
  gen4-generate-dialog, one-course, course-path-wroclaw, gate-guide-wroclaw, n-share-sound-link,
  tutor-air-first-flight). FAIL sonic-course-wroclaw, the item 'the switch on in the air starts no new life and keeps
  the speed': at the press the craft already drifted sideways (velocity x -1.92 m/s; in car 5's run -0.03), flew 30 m
  on and crashed before the first cue. No course exists at that moment, so the generator is not in it. The check is
  rerun twice from the int copy in the background of the lead's chat (U:/Temp/gsfpv-train4/ship-car6/live-r2 and
  live-r3). Both PASS: a flaky probe, say so in STATE.md and go on. A FAIL again: a repair lane by the pattern of
  prompts/t10-fix-fly.md (page or probe), priority 1, share-free.
- The owner's path: docs/wip/train4-int.md, 'What the owner should try', Car 6 (scan eb5f51dc, Shift+G; fly, pause,
  Shift+G; the link). Not verified: the same file, 'Not verified', Car 6.
- Disk C fell to 4.9 GB during the car (the watcher's disk floor woke the lead). 21 build folders (apps/fly/dist, dist)
  were removed in the train's lane copies: 6.8 GB free. The watcher runs with a floor of 3 GB now
  (`lead_watch.sh 0 3`). NOT done: removing the work copies of lanes that are merged and released (about 47 worktrees,
  about 1.8 GB each by du; how much is real with pnpm's hard links was not measured). It needs its own careful session
  with the disk-c skill: each copy checked for uncommitted files first; never the lead copy, the int copy, or the copy
  of a job that waits, is ready, held or running.
- The week: 35 % at 21:11 UTC; the line allows 26.1 %. Every job but a share-free one waits for the line: until about
  the evening of 2026-11-27 if nothing else spends. No job that is left carries share-free.
- This chat is a top-level session (the old lead detached it; checked with detach_session 'self'): the end of its
  turns wakes no other chat. A new lead chat checks the same at once.
- NEXT: car 7 is w1-dialog, w2-pilot, w3-model, n-save and n-scan (when their checks say SHIP; its prompt by the
  pattern of prompts/t10-car6-header.txt plus the body of t8-car5.md). W1's R3, the n-route rebase and the test
  system are still to plan. W3: r-w3-model and w3-bbl wait for the line. W5: w5-inv waits for the line; then two web
  research agents, the design and the critic.
- HAND-OVER: this chat has grown; the next wake after a long pause would rewrite its whole context. The next lead is
  a NEW chat started from this note; this chat leaves no watcher behind once the rerun above is answered.

### 2026-11-26 21:30 UTC: the reruns of sonic-course-wroclaw PASS twice; the watcher is quiet now

- Both reruns on the live site say LIVE CHECKS: PASS (live-r2, live-r3): the failure was the probe's flight before the
  press (a sideways drift that depends on timing: -1.92 m/s in the failed run, 0.10 and -0.62 in the two that passed),
  not the page. Car 6 stands: 9 of 9 named checks pass, one of them on the second try. A small repair of that probe
  (hold the heading before the press) is worth a lane when the week allows: it will fail a release again some day.
- The watcher runs as `LEAD_WATCH_QUIET=1 bash lead_watch.sh 0 3`: it wakes only on FAILED, BLOCKED, HOLD, LIMIT, END
  and on a release (not on each lane's end), so that this grown chat is woken once, not six times. At END (every job
  done, failed or held) the lead plans car 7 from the review files in U:/Temp/gsfpv-train4/reviews/.
- A new lead chat is the better place for car 7: start it with 'you are the lead of ShramkoGSFPV, begin with
  C:/dev/gsfpv-v03/docs/wip/train5-lead.md and the gsfpv skill'; this note is complete for that.

### 2026-11-27 00:00 UTC: disk C and the week are eaten by another pipeline, not by the train

- Disk C fell to 1.3 GB at 23:19 UTC with the train idle. A worker (opus) found the cause: the session transcripts of
  the stock pipeline, C:/Users/andri/.claude/projects/U--Stock-anon-S*-names (100 folders, 28 GB, 1.5 to 1.9 GB an
  hour, a new folder about every 10 minutes; unattended `claude -p --model sonnet` runs). It still grows.
- Freed 21 GB (20.5 GB free at 23:55 UTC): 12 simulator copies removed, each merged into origin/main and clean
  (gsfpv-ga, gsfpv-outreach, gsfpv-sonic-beacon, gsfpv-t4-head, gsfpv-t4-menu, gsfpv-t4-tails, gsfpv-t8-tutor-moment,
  gsfpv-train1-base, gsfpv-ui, gsfpv-v12-optin, gsfpv-v13-host, gsfpv-v13-look; no branch deleted; 35 copies remain);
  three folders moved to U: behind junctions by the disk-c skill's offload.py (ms-playwright 2.5 GB, so the bench
  browsers now load from U:; BambuStudioBeta 3.4 GB; Autodesk 7.1 GB). Tables and logs: U:/Temp/claude/disk-c-free/.
  gsfpv-t7-hot (fix-fly, merged and released) may be removed too: it stayed only because it was on the list.
- NOT solved: the transcripts refill C: in about 10 to 13 hours. The disk-c skill forbids touching ~/.claude/projects
  without the owner's word; the owner was told; a note is on the coop board for the stock pipeline's session. The
  watcher's disk floor is 5 GB again.
- THE WEEK: 43 % at 23:55 UTC (35 % at 21:11) with the train idle: about 2.7 points an hour go to other consumers,
  the stock pipeline first of all. The train's line is on the TOTAL reading (26.9 % now), so the train does not start
  while that goes on, and the hook stops all work outside publications at 83 %. The lead does not lift the line by
  himself: which pipeline gets the week is the owner's call. He was told in the report of 2026-11-27 00:00 UTC.

### 2026-11-28 16:30 UTC: the owner's message 81; the lead's own line starved the train for 43 hours; the queue is set to car 8

- THE STALL. From 2026-11-26 21:11 to 2026-11-28 16:04 UTC nothing ran: the daily share stood on the TOTAL weekly
  reading, and other pipelines (the stock pipeline first) raised it from 35 % to 57 %. The owner (message 81, the end
  of the vault brief): why did you stop, where is the automatic continuation until all is done, repair the skills.
  DONE: `plan --share-off` (the plan's stop stays 80; the hook's border is 85 % today). The skills say it now (gsfpv
  2.3.0, limit-safe-work 2.8.0, vault commit e7c95c9): the queue is set up whole and ahead; the line only when the
  queue is bigger than the rest of the week.
- THE QUEUE RUNS BY ITSELF TO CAR 8; a lead is needed only on FAILED, HOLD and a release.
  Car 7: n-scan, n-save, w2-pilot, w3-model, w1-dialog. Job car7 (prompts/t10-car7.md) waits for r-w1-dialog,
  r-w2-pilot and r-w3-model; then ship-car7.
  Car 8: w6-mode3 (stick modes 1 to 4, default 2; copy gsfpv-t7-hot) and w6-latency (video and control latency, off
  by default, presets by FPV system; the same copy, on top of w6-mode3; released by the file
  U:/Temp/gsfpv-train4/w6-latency-research.done, which exists), their checks (prompts t10-r-w6-mode3.md and
  t10-r-w6-latency.md). Job car8 (prompts/t10-car8.md) waits for r-w6-latency and ship-car7; then ship-car8.
  From before: w1-dialog (started 16:04 UTC), r-w3-model, w2-pilot (S3 and S4 left), w3-bbl, w5-inv.
- NOT QUEUED YET; the next lead queues it at once and ahead, as car 9, from C:/dev/.gsfpv-lanes/designs/w1-diag.md:
  W1's R3 (a forbid map from the splats; large), n-route rebased on the anchor, the generator's test system (one
  command, a ledger, a reference for the gsfpv skill; its seed is tools/bench/src/w1-diag-measure.ts), a repair of
  the flaky probe sonic-course-wroclaw. W5 after w5-inv: two web research agents (sonnet), one opus design of the
  staged plan, one critic (agent gs-critic, model opus); the plan is a vault note; no building.
- THE PILOT ON FACEBOOK (message 81): group TINY WHOOP, post 4719458264941818. The engage job had answered him once
  (thanks, use the form). The reply 'taken into work' by the owner's word is item RR-2026-11-28-01 (open) in the
  vault, FB groups area, campaigns/gsfpv/reply-requests.md; the engage job's prompt
  (.claude/tools/fb/engage_prompt.md) reads `open` lines now (vault commit 04bf037). NOT verified that the reply was
  posted: look for `sent` in that item. The reply 'it is live' is automatic: after ship-car8 append to his line in
  the FB groups area, reports/feature-requests.md: `; shipped <date> <release>: <where the settings are, how to
  change them>` (the words: docs/wip/train4-int.md, Car 8, 'For the answer to the pilot').
- Research notes in the vault (project folder, research/): prop wash and whoops; the latency of FPV links (presets:
  analog 20 ms measured, HDZero 15 the maker's model, Walksnail 25 community, DJI O3 30 the maker, DJI O4 28
  measured; control 7 ms is an estimate; no other simulator was found to have such a setting).
- Another session releases on this repository too: lane sr-quiet went live on 2026-11-27 (8e65a181, on top of car 6).
  Cars merge origin/main first; ship_handover.py stops with exit 40 when origin/main holds code the candidate lacks.
- The week: 58 % at 16:00 UTC (the top model alone 11 %); the reset is 2026-12-03 12:00 UTC. The queue to car 8 is
  about 30 runs. Disk C: 45 GB free.
- THIS CHAT IS AT 51 % OF ITS WINDOW (511 thousand tokens): it hands over now and leaves no watcher. The next lead
  is a new chat started by this one.

### 2026-11-28 16:25 UTC (real clock): lead 3 took over; car 9 is queued whole

- LEAD 3 is a new chat (top level, checked). Its watcher: `LEAD_WATCH_QUIET=1 bash lead_watch.sh 0 5`, in its
  background. State at 16:21: w1-dialog (S1 done), w2-pilot (S2 done), w6-mode3 (S1 done) run; r-w3-model is done.
- CAR 9 IS QUEUED: 10 jobs, prompts C:/dev/.gsfpv-lanes/prompts/t10-<job>.md, the car's header t10-car9-header.txt.
  The chain in copy C:/dev/gsfpv-t7-n-route, each branch on the one before:
  w1-gentest (the generator's test system: one command `tools/bench/src/gen-quality.ts`, sets quick and full, anchors
  at the spawn and at flown places, thresholds with an exit code, the ledger evidence/gen-quality/ledger.jsonl, the
  reference docs/gen-quality.md; base origin/main, no dependency, priority 6), then
  w1-forbid (R3: a mass map from the splats forbids poor tiles; the roughness no longer filters or scores; the link
  says that the map was used; it merges the dialog of car 7 first), then
  n-route2 (branch n-route2 from the failed n-route: the merge of w1-forbid, the anchor and the score, the page asks
  for the route, the old S5b left list with an open course before the walk, n-path merged in its S5 with the seam;
  up to 10 runs).
  fix-sonic-probe in copy C:/dev/gsfpv-t7-n-scan (opus, effort medium): the flight before the press without timing.
  Each lane has its check r-<lane>. car9 waits for the four checks and ship-car8; ship-car9 is ship_handover.py with
  U:/Temp/gsfpv-train4/int4-car9.json.
- DECISIONS. (1) The test system goes FIRST: R3 and n-route2 are judged by one command against the ledger; a
  threshold that the generator breaks is a finding and is never softened. (2) The judge's splat measure (tools/bench)
  and the generator's map (packages/tracks/src/splat-density.ts) do not import each other. (3) n-path (SHIP since
  train 4) rides inside n-route2: the car must not merge n-route or n-path by themselves. (4) The old n-level (the
  three-way level switch in the pause menu and the chip) is NOT queued: plan it as car 10 from n-route2's 'For the
  lead'; its prompt t7-n-level.md is older than car 7's dialog and must be written again. (5) One car for the four
  lanes: one more car costs a full check and a release.
- A LANE THAT STANDS ON ANOTHER WAITS FOR ITS SHIP, not for the end of its check: the conductor counts a check that
  said HOLD as done. So the checks r-w1-dialog, r-w1-gentest and r-w1-forbid write
  U:/Temp/gsfpv-train4/reviews/<lane>.ship when they say SHIP (and delete it on HOLD); w1-forbid waits for
  w1-gentest.ship and w1-dialog.ship, n-route2 for w1-forbid.ship. On a HOLD: the repair lane in the same copy, the
  check reset (`set --state wait --reset-runs --after-add fix-<lane>`); the next lane starts by itself when the
  .ship file comes. The conductor does not keep two jobs out of one work copy: jobs of one copy are chained by
  --after (they are).
- AFTER r-w1-gentest says SHIP: the lead writes references/gen-quality.md of the gsfpv skill from the lane's 'For the
  lead' (ten lines) and names it in SKILL.md (the vault's .claude/rules/skills.md; run the lint).
- w5-inv has priority 2 now (one sonnet run, it writes the inventory note into the vault project folder,
  research/). When the note is there: W5 by the project-kickoff skill, no building: two research agents with the
  web (sonnet), one design of the staged plan (opus), one critic (agent gs-critic, opus); the plan is a vault note.
  While the lead's agents run, narrow the train (`plan --max-parallel N`, three agents at once in all) and put 3 back.
- The pilot's Facebook item RR-2026-11-28-01 was still `open` at 16:22 UTC (it was written about 16:10). Look
  again at each wake; no `sent` by 2026-11-29 16:00 UTC: find with the fb-engage skill why the reply job did not
  take the line.
- The week: 57 % at 16:21 UTC. A run costs about 1.5 USD by the CLI's count (median 8 minutes, 40 replies); the
  queue to car 9 is about 55 runs.

### 2026-11-28 16:55 UTC: W5's staged plan is written; its cheap probes are queued; the train is at 3 again

- W5 (message 79), no building: the inventory (job w5-inv, one sonnet run), two web research agents (sonnet), the
  design of the staged plan (opus), an independent critic (agent gs-critic, opus): ten findings, all accepted by the
  designer after a check against the code. In the vault's project folder: the plan note (its name starts with
  'ShramkoGSFPV', then 'objects and MCP', then 'plan of stages', in Russian) and three notes in research/. Vault
  commit 7eb75e2; the lead's decision stands under message 79 of the brief.
- The plan in short. Stage 0: a setting 'Debris: off / real / exaggerated': cubes of the wall's colour fly from the
  hit point, in their own Rapier world; nothing is needed from the owner. Stage 1: the wall really breaks (inside the
  1 kHz step, in the replay log, SIM_CORE_VERSION goes up). 2: a named room. 3: a read-only MCP server. 4: objects
  break. 5: an agent edits through OAuth. 6: streets and parts. The main risk: the label 'splat to object' may not
  survive the LOD stream and the SOG packing.
- QUEUED: job w5-probes (opus, effort medium, priority 6, its own limit_stop 75, copy C:/dev/gsfpv-t7-n-path read
  only, prompt t10-w5-probes.md): the plan's probes P7, P1, P6, P2, P5. It writes one vault note in research/
  ('probes before building') and runs only when a slot is idle.
- NOT QUEUED: the building of stage 0. The lead's decision: it waits for the probes' note and for the owner's word
  on the plan (a new direction; the week is narrow). With both: stage 0 as a small train of 6 to 10 runs.
- While the lead's agents ran, the train stood at max_parallel 2 (16:27 to 16:44 UTC); it is 3 again.
- The lead's chat stood at 31 % of its window at 16:35 UTC, after queueing car 9 (nine prompts). The week: 60 %,
  Fable alone 13 %: the lead's own turns cost about 2 points of the week in 35 minutes. Keep the lead's turns short
  and its thinking small; hand over at 50 %.

## How the lead works (the owner's economy rule; written into the skills on 2026-11-26, W4 done)

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

1. Read the four messages in the brief (77 to 80: the grep of this note's first paragraph). `train4.py status`, first
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
