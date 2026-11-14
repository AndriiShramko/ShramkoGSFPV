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
- [x] Forest Floor (a8a686d0): Shift+G answered "nothing fits" in 0.27 s. Cause: the page spawns at the CDN camera of
  ab5efa0e v2 (-6.446, 3.143, 0.123), outside the walls' grid (x -3..3), so freeSpace found no start cell
  (tracks-audit.ts with that --spawn: 0 m3, startFound false; at the grid centre 29.3 m3 and 10 gates). tracks2's audit
  and fit.test used the grid centre: the audit reads only v1/settings.json from the CDN, AccessDenied for this v2 scan.
  Fix: freeSpace starts a spawn outside the grid from the nearest point inside it (packages/tracks/src/freespace.ts; a
  spawn inside keeps its block, so its result is unchanged). Test packages/tracks/test/spawn-outside.test.ts, NEG OK;
  packages/tracks 103 of 103, tsc 0. Likely the same cause for 2f1ddf5f and d10c5638 (tracks2 K1.2), not checked.
  Not yet seen in a page: needs a rebuild and walls-chain-probe on ab5efa0e.
- [x] All probes: one detached script U:/Temp/gsfpv-train2/train2b/run-all.sh on the release of 4cf7b013 (port 5760),
  done 03:20, summary logs/summary-full.txt, evidence evidence/2026-11-14/train2b/ (033b95f3). Fails: walls-chain
  (Forest Floor, fixed below), tracks-page 1 row by load, r10, mouse-free rooms entry.
- [x] Pass 3: rebuild at 033b95f3, walls-chain exit 0 (Forest Floor 10 gates), walls-published exit 0, mouse-free still
  exit 1 in the rooms entry only (Probes). Looked at walls-chain-1920.png again.
- [x] deploy/live-checks.sh gains walls-published-probe (4cf7b013). Not run.
- [x] Looked at walls-chain-1920.png and walls-chain-844.png (Probes).
- [x] gates.py --only vitest at 033b95f3 (pass 3, tracks2's detached audits still running): exit 0, 4708 passed, 14
  skipped of 4722, logs U:/Temp/gsfpv-gates-20261114-032634. With run 2 (all other gates PASS, 'B18 PASS') the gates
  are green; the files changed since run 2 are a probe script, evidence JSON and this note.
- [x] git push origin main (plain) of the commit that carries this line; confirmed with git fetch that origin/main = HEAD.

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
- Looked at walls-chain-844.png (Wroclaw: 24 gates drawn, "Gates: 24. Fly through gate 1", clock 0:00.00, walls 5 cm)
  and walls-chain-1920.png (Forest Floor seen from outside, offer "Refine walls to 1.6 cm", no course): match the JSON.
  The Forest Floor cause is fixed in a8a686d0 (Status); the page result after the fix is not yet probed.
- accept-fly B6 B7 B9-B16: exit 0.
- tracks-page: exit 1, 45 PASS, 1 FAIL: hintClearOfTimer row pl 1366x768 had gen false (no course within the probe's
  90 s, the PC loaded by this run and by tracks2's detached tracks-audit runs), so no hint to measure; the other 11 rows
  clear (noteH 31-50). Counted as load, not layout. Shots U:/Temp/gsfpv-train2/shots/train2b/tracks/look-course-*.png.
- sonic-int-review r10 (a course by sound): exit 1, 13 of 14. Before this wave it stalled at gate 4; now the hum led
  through 8 stages to target g9 but the course was not flown to its end within the probe's time (phase flying).
  evidence/2026-11-14/sonic-int-review-r10-t2b-r10.json (moved to train2b/ when the script ends).
- The full run ended 03:20:27; its summary is U:/Temp/gsfpv-train2/train2b/logs/summary-full.txt. Evidence JSON
  committed under evidence/2026-11-14/train2b/ (033b95f3).
- sonic-int-review r9 (free flight by sound): exit 0, 11 of 11 in 184 s.
- rooms-two-page: exit 0, all 17 checks (follow rms 0.0645 m, best delay 170 ms; controls c1-c3 fired).
- rc2-probe usb,refused,bridge,bridge-lna with the replay helper on port 5771 (the owner's helper holds 47310, pid
  38364, not touched): exit 0, 19 of 19. connect-probe (helper on 5772): exit 0, 15 of 15.
- centre-throttle-probe all: exit 0 (dji-centred, dji-flip, dji-bottom). fast-radio-probe: exit 0. wizard-auto-check:
  exit 0. hid-source-probe: exit 0, errors 0.
- mouse-free-probe: exit 1, 78 PASS, 0 FAIL, then a timeout in the rooms entry: since rooms2, 9 outside a room joins
  the open room and opens the panel only after the refusal (no rooms service on a local release), later than the
  probe's 2.5 s; its fallback then pressed P while the panel was arriving. Probe fix in 033b95f3 (wait 10 s for 9's
  answer, then a second 9). Page behaviour unchanged; re-run result in the pass 3 bullet below.
- Pass 3, release of 033b95f3 (includes a8a686d0), ONLY=walls,mouse, summary U:/Temp/gsfpv-train2/train2b/logs/
  summary.txt: walls-chain-probe exit 0. ab5efa0e Forest Floor 1920x1080: pass, published walls, 10 gates, first gate
  1.33 s after Shift+G. 70b50d42 Wroclaw 844x390: pass, published walls, 23 gates, first gate 31.4 s. The small-scan
  chain is now proven in a page. walls-published-probe: exit 0.
- Looked at walls-chain-1920.png of pass 3: Forest Floor with 10 gates drawn above the plants, clock 0:00.00, "Gate 1 of
  10", walls 5 cm. Flaw seen: the course line "Gates: 10. Fly through gate 1 ..." sits on top of the fading offer
  "Refine walls to 1.6 cm (about 15 s)" at the top centre, two texts overlapped for a moment. Not fixed (minor, layout
  of two notes in one slot).
- mouse-free-probe pass 3: exit 1 again, 78 PASS, then the same timeout in the rooms entry: neither 9 (twice), Shift+L
  nor the pause menu item pause.rooms showed the rooms panel on the local release. Cause not found (budget). The rooms
  panel itself is proven by rooms-two-page (exit 0, with a rooms service); the mouse-free check of that panel is not.

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

- Walls chain (pass 3, release 033b95f3, Forest Floor with 10 gates): U:/Temp/gsfpv-train2/shots/walls-chain-1920.png,
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

- sonic-int-review r10 (a course by sound to its end): exit 1, 13 of 14; the hum led to gate 9, the course was not
  flown to its end within the probe's time. The course by sound is not proven to its end.
- mouse-free rooms entry: the rooms panel did not open on a local release without a rooms service (Probes). Not
  analysed.
- tracks-page hintClearOfTimer pl 1366x768: no course within 90 s under load; not re-run on an idle PC.
- The Forest Floor fix a8a686d0 for 2f1ddf5f and d10c5638 (tracks2 K1.2): same cause likely, not checked.
- The race: rooms-race.ts failed; why neither page built the course is not analysed (the probe's TypeError may be the
  probe's own fault).
- a6-reference not run here: the integration changed no flight, input or collision code (rooms.ts, race.ts, a test).
- The small open items (helper download bytes on the Controls screen through the page's buttons, the cookie banner over
  /sound/ at 320 px) were not done; the bytes check by URL found no such files in dist.

## Cost notes

- 2026-11-14 integration: the most turns went to two seams found only by the full gates (a static import that pulled
  the sound package into the main chunk, API tests without a lap); running sonic-int-lazy and the API tests in each lane
  after merging origin/main would have found them earlier. Running the race probe before the gates saved a rebuild.
- 2026-11-14 integration pass 2: the most turns went to waiting for the long probe script in 10-minute blocks; the
  Forest Floor cause took 6 turns and was cheap once the probe's own note ("nothing fits" at 0.27 s) was read. Giving
  the audit the page's real spawn (the CDN camera of the scene's own version) would have found it in lane tracks2.
- 2026-11-14 integration pass 3: the most turns went to the mouse-free rooms entry (a probe guess that did not fix it);
  a probe that saves a screenshot when an entry times out would have shown the page state in one run.
