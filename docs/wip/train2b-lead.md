---
type: lead-note
status: in-work
summary: Train 2 wave 2 integration (tracks2, walls, rooms2) on main; race entry off; probes running; push left
created: 2026-11-14
---
# Train 2 wave 2: integration note for the lead

## Status

- [x] Resume check: origin/main = f0d8b146 = HEAD at start, worktree clean.
- [x] Merge tracks2 (--no-ff), then walls (one conflict in apps/fly/src/app/builtin/course.ts openEdit: walls' "no walls
  or no course: both come by themselves" kept together with tracks2's T2-4 "busy: open when it arrives"; merge 3c343b32),
  then rooms2 (no conflict; the sound pin stays 598a98f9, rooms2's stale 378cc50 did not win).
- [x] Sound package: branch train2 has 0 commits over its main; pin 598a98f9 unchanged, nothing to merge.
- [x] rooms-race.ts on the merged tree (SONIC_PORTS 5760-5779): FAIL (exit 1). Race entry switched off: 4cf7b013.
- [x] Gates run 1 at 4cf7b013: exit 1 (vitest 1 failed of 4718, api-unittest 2 errors, catalog stale). Seams fixed: 65b7fcca.
- [x] Gates run 2 at 65b7fcca: exit 1 only by a timing test under load (Gates); the rest PASS, 'B18 PASS'.
- [ ] Forest Floor: Shift+G gives no course in 300 s (Probes). Decide before the push: find the cause (course worker on
  the published 5 cm walls of ab5efa0e v2) or say in the release that small scans may get no course.
- [~] All probes: one detached script U:/Temp/gsfpv-train2/train2b/run-all.sh on the release of 4cf7b013 (port 5760),
  one line per probe in U:/Temp/gsfpv-train2/train2b/logs/summary.txt, evidence evidence/2026-11-14/train2b/.
- [x] deploy/live-checks.sh gains walls-published-probe (4cf7b013). Not run.
- [ ] Left for the next worker: (1) gates.py --only vitest on an idle PC (exit 0 needed); (2) when summary.txt says
  'done', fill Probes from it, LOOK at U:/Temp/gsfpv-train2/shots/walls-chain-1920.png and walls-chain-844.png, commit
  the evidence JSON (never PNG); (3) git push origin main (plain) and verify with git fetch that origin/main = HEAD.

## Merged

- tracks2 (C:/dev/gsfpv-rooms, head bc0c9e4e): generated gates passable on the generator's own path, small scans get a
  smaller course (scale down to 0.3, marginM on the track), the editor camera on the selected gate, vote after a lap on
  the server, review fixes T2-1 to T2-7. Missing (stages K1 and K2 unfinished, tree clean, its tests pass): the K1.1
  audits of all scans and the per-seed digest comparison, K1.2 why 2f1ddf5f and d10c5638 find no free space at spawn,
  K2.4 "drop a gate here" (needs the lead's key decision: Space is arm.toggle), K2.5 pillar pairs (needs the /2 format on
  the server). Open point: a person's save of an edited small course loses its margin (generator null).
- walls (C:/dev/gsfpv-voice, head 0de36307): walls of any size (ladder), published walls loader and delivery, the chain
  "an action that needs walls gets them" (Shift+G, C, V; wallsThen), free flight by sound builds walls. Missing (stage
  V1-finish unfinished, tree clean, gates passed in the lane): re-baked lighter files not copied into the release folder
  (3b), release-walls.sh does not ship scene.voxel.bin.gz (3c), walls-published-probe on all 9 scans (3d), the
  sonic-int-review case for free flight on a scan without walls (4b), accept-c and a6-reference rerun (5).
- rooms2 (C:/dev/gsfpv-center-throttle, head 3fb22df9): Q1 the open room by key 9 and the vote for the next scan; Q2
  the race server and page, entry OFF (below).

## Held back

- The race (rooms2 Q2) is in the tree but not reachable: apps/fly/src/rooms/race.ts RACE_ON = false. rooms-race.ts on
  the merged tree: both pages got the prep, neither built the course (aBuilt, bBuilt false), then a TypeError in
  page.evaluate (evidence/2026-11-14/rooms-race-train2b.json, log U:/Temp/gsfpv-train2/train2b/rooms-race.log). With the
  entry off app/builtin/rooms.ts does not load rooms/race-page.ts at all. Turn on: RACE_ON true after rooms-race.ts passes.
  With the race off, a scan proposal is 9 then Enter (Propose has the first focus); rooms-open-vote.ts presses Tab only
  when the race button has the focus.
- Branch menu (C:/dev/gsfpv-tracks): parked, not touched.

## Gates

python -X utf8 C:/Users/andri/.claude/skills/gsfpv/scripts/gates.py --repo C:/dev/gsfpv-v03
- Run 1 at 4cf7b013: exit 1. typecheck, architecture, i18n PASS, line 'B18 PASS'. vitest 1 failed, 4703 passed, 14
  skipped: sonic-int-lazy.test.ts (the main chunk reached sonic/look.ts, sonic/primitives.ts and @shramko/sonic-fpv
  through rooms/race-page.ts and course/view.ts). api-unittest: test_tracks_fixes tk8 (2) voted without a lap (403
  lap-first since tracks2 K2.2). catalog: features.json, docs/settings.md, README.md stale. Logs
  U:/Temp/gsfpv-gates-20261114-022951.
- Fixes 65b7fcca: race page loaded with import() only when RACE_ON (sonic-int-lazy NEG OK on the merge's files);
  tk8 bodies carry lap 5000 (test_tracks_fixes and test_tracks_edit OK); gen-catalog. tools/bench/test/
  rooms-race-off.test.ts new (NEG OK). tsc apps/fly and tools/bench exit 0.
- Run 2 at 65b7fcca: exit 1. typecheck, api-unittest, architecture, i18n, catalog PASS, line 'B18 PASS'. vitest 1
  failed of 4720: tools/bench/test/app-dji-rc2.test.ts 'answers 60 ms late' (expected 1 to be 0), a timing test; it ran
  while the probe script loaded the PC. No file of it or of controls changed in this wave (git diff 0bfec4f0..HEAD);
  alone it passes 15 of 15. Counted as load, not a seam; the next worker reruns gates.py --only vitest when the PC is idle.

## Probes

Local release of 4cf7b013 on http://localhost:5760 (serve-csp). It differs from the head 65b7fcca only by the static
import of the race page (same behaviour, race off in both) and generated catalog files. Stand-ins of the published
walls in dist/walls: ab5efa0e, 70b50d42, 9baef54b (153,900,630 bytes); d10c5638 left out as the unpublished control.
- rooms-race.ts: FAIL (Held back).
- walls-chain-probe: exit 1 (evidence/2026-11-14/train2b/walls-chain-probe.json). 70b50d42 Wroclaw at 844x390: pass,
  published walls, 24 gates, first gate drawn 39.6 s after Shift+G. ab5efa0e Forest Floor at 1920x1080: FAIL, published
  walls in, no course within the probe's 300 s (gates 0, fail timeout). So the chain on a small scan is NOT proven: the
  small-scan generator of tracks2 does not answer in the page within 300 s on Forest Floor. Not analysed (budget).
- walls-published-probe 70b50d42,ab5efa0e,9baef54b with d10c5638 unpublished: exit 0.
- Helper download bytes: the build has no start-dji-helper.cmd nor rc_bridge.py in dist (find found none), so the
  bytes check had nothing to compare; the page's links point at the public repository (wave 1 note).
- The rest: running, see Status. Order: walls-chain (ab5efa0e 1920x1080, 70b50d42 844x390), walls-published,
  accept-fly B6-B16, tracks-page, sonic-int-review r10 then r9, rooms-two-page, rc2-probe usb,refused,bridge,bridge-lna
  with the replay helper on 5771 (the owner's helper holds 47310, pid 38364, not touched), connect-probe, mouse-free,
  centre-throttle all, fast-radio, wizard-auto-check, hid-source-probe.

## Deploy order for the lead

From git diff --stat 0bfec4f0..HEAD -- deploy/nginx.conf deploy/compose.yml apps/api apps/rooms packages/i18n/locales:
1. nginx: yes, first. `bash deploy/release-nginx.sh` (new `location ^~ /walls/`, root /srv/releases, 404 when missing).
2. Walls: `bash deploy/release-walls.sh U:/Temp/gsfpv-train2/walls/release` (9 scans, json + bin each, 490,725,112 bytes
   on disk; per scan in docs/wip/walls.md For the lead, the biggest 1994c65c 132,800,044 bytes). The location sets no
   gzip, so the wire size is the disk size unless the hub's gzip types include the bin (not checked). The lighter
   re-bakes in U:/Temp/gsfpv-train2/walls/published-v1f2 are NOT in that folder yet (walls step 3b).
3. API: yes. `bash deploy/release-api.sh tracks.py` (vote needs a lap, PARAM_KEYS scale, legMinM, legMaxM). No
   --locales (apps/api/locales and the bot and mail locales unchanged; the changed locales are fly/* and ship in the
   page). No --compose (compose.yml unchanged). Between this step and the page an old page's vote gets 403 lap-first.
4. Rooms: yes. `bash deploy/release-rooms.sh` WITHOUT --compose (race.py, votes.py new; rooms.py changed; the race
   server is harmless with the page entry off).
5. The page: ship as usual.
6. `bash deploy/live-checks.sh <outdir>`.
Why published walls survive page releases (review WL-1): they live in releases/walls/ beside the release folders, not in
releases/<sha>/; deploy/deploy.sh only flips the releases/current symlink and its prune (line 171) lists releases with
`grep -Ev '^(current|walls$|\.)'`, so walls is never pruned; deploy/rollback.sh does not list walls and refuses it as an
id (line 25); deploy/ship.sh removes only its local .cache/release-<sha> and its hub lock.
After the walls release (read-only): `node tools/bench/scripts/walls-published-probe.mjs
https://gsfpv.flyreelstudio.eu/en <out.json> 70b50d42,ab5efa0e,9baef54b` (also inside live-checks.sh).

## Live checks

deploy/live-checks.sh keeps its checks and gains walls-published-probe (70b50d42, ab5efa0e, 9baef54b; its header says it
reads only and presses nothing that sends or saves; it flies the drone into the walls inside the page). Kept out: the
race, the editor and votes (they store data), walls-chain-probe (Shift+G makes a course; not confirmed it stores
nothing). The script was not run.

## Pictures for the lead

- Walls chain (this run overwrites them): U:/Temp/gsfpv-train2/shots/walls-chain-1920.png,
  U:/Temp/gsfpv-train2/shots/walls-chain-844.png, U:/Temp/gsfpv-train2/shots/walls-chain-1920-offer.png,
  U:/Temp/gsfpv-train2/shots/walls-chain-1920-build.png
- Published walls: U:/Temp/gsfpv-train2/shots/walls-w2-70b50d42.png, U:/Temp/gsfpv-train2/shots/walls-w2-ab5efa0e.png,
  U:/Temp/gsfpv-train2/shots/walls-w2-d10c5638.png, U:/Temp/gsfpv-train2/shots/walls-ladder-70b50d42.png,
  U:/Temp/gsfpv-train2/shots/walls-ladder-ab5efa0e.png
- Editor camera: U:/Temp/gsfpv-train2/shots/tracks2-editor-1920.png, U:/Temp/gsfpv-train2/shots/tracks2-editor-844.png
- This run: U:/Temp/gsfpv-train2/shots/train2b/ (tracks, connect, mouse-free, fast-radio, wizard, hid-source)

## What the owner should try

1. Wrong way (Fly by Sound, a lesson with gates): fly back nose-first for over a second: two falling note pairs and
   "You are flying back. Turn around." Backing up with S or sliding sideways says nothing.
2. Motor: Fly by Sound starts with the motor silent; "Motor sound" on the start screen or in the pause menu turns it on.
3. Any scan by sound: on a scan page Escape, the last item "Fly by Sound": a new tab for this scan. Enter starts a free
   flight. A scan without walls now builds them by itself and says so; then the course is offered.
4. A course by sound: in that free flight press N, wait for "Course ready", follow the hum. N again: another course.
5. Walls and courses: on Forest Floor or Wroclaw press Shift+G: walls come by themselves (at once where published), then
   a course is drawn. A small scan gets a smaller course instead of "nothing fits".
6. The editor: Shift+B (with no course it makes one first); Tab picks a gate and the camera turns to it; arrows move,
   Q and E turn, Ins adds, Del removes, Ctrl+Z undoes, F6 the window, Escape leaves.
7. Votes: a vote counts only after a flown lap of that course.
8. Rooms: key 9 takes you to the open room of your scan; in the room 9 then Enter proposes the next scan; others agree
   with 9 then Enter. The race is not in this release.
9. The page /en/sound/: five figures and the flight loop on the first screen.
10. DJI RC 2 window (docs/wip/rc2-lna.md, about 5 minutes, after the release): switch the RC 2 on; Chrome
    https://gsfpv.flyreelstudio.eu/en/fly/?rcbridge=1, Controls, "My controller is not in the list", "Fly through the RC
    bridge"; Allow; move the sticks as asked to the check screen; once each with a pause: left stick up, left stick left,
    right stick up, right stick left; fly a minute. The lead starts the bridge with --record before and reads it with
    tools/rc-bridge/analyze_record.py after.
- The owner's rule: the merged lines bake.doneNext, sonic.say.wallsBuilding and the course flash were read by the lanes;
  the race's line rooms.race.noCourse is unreachable with the race off. Not all new texts were read one by one here.

## Not verified

- The probes on this release (running when this note was written), the walls-chain screenshots (not looked at yet),
  gates run 2.
- sonic-int-review r10 (a course by sound to its end): in the run, result not read yet.
- The race: rooms-race.ts failed; why neither page built the course is not analysed (the probe's TypeError may be the
  probe's own fault).
- a6-reference not run here: the integration changed no flight, input or collision code (rooms.ts, race.ts, a test).
- The small open items (helper download bytes on the Controls screen through the page's buttons, the cookie banner over
  /sound/ at 320 px) were not done; the bytes check by URL found no such files in dist.

## Cost notes

- 2026-11-14 integration: the most turns went to two seams found only by the full gates (a static import that pulled
  the sound package into the main chunk, API tests without a lap); running sonic-int-lazy and the API tests in each lane
  after merging origin/main would have found them earlier. Running the race probe before the gates saved a rebuild.
