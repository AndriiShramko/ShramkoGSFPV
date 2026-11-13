# Train 2, wave 1: integration and lead note

Worktree C:/dev/gsfpv-v03, branch main. Lanes merged here: connect (with rc2-lna), tracks-edit, sound-any, sound-page. Ports
5760-5779. Logs U:/Temp/gsfpv-train2/int/, evidence evidence/2026-11-13/train2/, pictures U:/Temp/gsfpv-train2/shots/.

## Status

- [x] 1. git fetch: origin/main had not moved (2a5ac433)
- [x] 2a. sound package: branch train2 (b6ab45c) merged into its main as 598a98f (a no-ff merge commit with the same tree as
  b6ab45c); package suite 1309 passed, 4 skipped (64 files), typecheck exit 0; package main pushed (its origin/main 598a98f)
- [x] 2b. four lanes merged with --no-ff, no conflict: connect 3605eb55, tracks-edit 7500a6ac, sound-any c06a85a4,
  sound-page 25522c97
- [x] 2c. pin packages/sonic-fpv b6ab45c -> 598a98f; the sound page says the new rules again (62af8373)
- [x] 2d. the owner's seam fix: the lap clock and its lines are hidden under the pause menu and every other window (6aabd2dc)
- [x] 3. all gates: first run red (vitest main-audit, architecture), fixed in 9205b3c8, second run exit 0 with B18 PASS
- [~] 4. local release 9205b3c8 built; probes passed: accept-fly, pause-over-course, sonic-optin A (after a probe fix),
  rc2-probe, connect-probe, tracks-page, r9. Failed: r10 (13 of 14). LEFT: sonic-v13-page A, rooms-two-page,
  mouse-free-probe, centre-throttle-probe all, fast-radio-probe, wizard-auto-check, hid-source-probe (the GPU lock was held
  by another lane); the command is in Probes
- [x] 5. deploy/live-checks.sh for this release (not run)
- [x] 6. this note (Probes gets the rest of the results from the next worker)
- [ ] 7. push main: NOT done. The simulator main is 6 merge and 7 integration commits ahead of origin/main, all local.
  Next worker: run the left probes, write them into Probes, then `git push origin main` and check with git fetch

## Merged

- connect, head 93c57ecf (contains rc2-lna b05df5e6): merge 3605eb55. tracks-edit, head d79b5ca4: merge 7500a6ac. sound-any,
  head 6cc1e1bd: merge c06a85a4. sound-page, head 6eafe445: merge 25522c97.
- Sound package C:/dev/ShramkoSonicFPV: main 378cc50 -> 598a98f (parents 378cc50 and b6ab45c), pushed. The two modified
  evidence files in its working tree were left uncommitted. The simulator pin is 598a98f.
- After the pin (62af8373): sound.how.items[4] in the four locales/site files says the motor is silent at first and is
  switched on in the settings; sound.fig.gates.text[2] names nose-first again and says that backing up or sliding aside is
  never called the wrong way; SoundFigure.tsx draws the two lower panels again; apps/site/scripts/verify.mjs expects two
  speech bubbles.
- Seam fix (6aabd2dc): apps/fly/src/course/cover.ts (coveredBy: pause reasons menu, panel, controls, export, help),
  course/hud.ts cover(), course/hud.css, app/builtin/course.ts. Test tools/bench/test/course-hud-cover.test.ts (2 passed);
  negative control NEG OK (ref origin/main, course.ts, hud.css, hud.ts). Page probe
  tools/bench/scripts/pause-over-course-probe.mjs (it carries its own control: with the class taken off the block is drawn
  over the menu again).
- Two gates the lanes left red (9205b3c8): (1) main-audit.test.ts: lane sound read `location.search` in
  app/builtin/sonic-flight.ts and sonic/feature.ts; both now read `new URL(location.href).search` as the other features do.
  The link parameter `sg` is not in the audit's list of page parameters (it is read only on a sound page): the lead may want
  it listed. (2) check-architecture.mjs: packages/tracks/src/format.ts used Math.hypot (now Math.sqrt of the sum);
  packages/tracks/src/editor.ts uses Math.sin, cos, atan2 for the yaw turn of a gate. DECISION FOR THE LEAD: I named
  editor.ts in the check next to check.ts (an edit is saved as numbers, nothing derives it again from a seed). The other
  way is trig from the sound package inside editor.ts; tracks may import only itself, collision and the sound package.
- Generated catalogue files after the merge (e35be658): README.md, llms.txt, docs/settings.md, apps/site/public/llms.txt,
  apps/site/src/generated/features.json (npx tsx scripts/gen-catalog.ts: 75 settings, 30 shortcut keys, 12 flying keys).
  Commit 8b02da87 names these files in its message by mistake; it holds only the probe's launch line.
- T1 note checked: apps/fly/src/course/store.ts line 50 keeps every row with an integer version of 1 or more.

## Held back

- None of the four lanes. Lanes walls and rooms2 are not in this merge (still building).
- Not done from the task: PG-10 (es 320x700: the cookie banner covers half of the start button of the sound page) is not
  fixed: no site-wide rule was tried (reply budget). The helper's two download links were not pressed in a browser: the
  files are packed into the page's script (apps/fly/src/devices/helper-files.ts), so there is no file address to fetch;
  a probe that presses both links and compares the saved bytes is still missing.

## Gates

python -X utf8 C:/Users/andri/.claude/skills/gsfpv/scripts/gates.py --repo C:/dev/gsfpv-v03
- Run 1 at 8b02da87: exit 1. vitest 1 failed, 4607 passed, 14 skipped (308 files): packages/prefs/test/main-audit.test.ts
  'app/env.ts is the only fly source that reads the query string'. architecture: 'tracks generator uses non-deterministic
  Math' for editor.ts and format.ts. typecheck, api-unittest, i18n, catalog, b18 passed.
- Run 2 at 9205b3c8: exit 0; typecheck, vitest, api-unittest, architecture, i18n, catalog PASS; line 'B18 PASS'. Logs
  U:/Temp/gsfpv-gates-20261113-231418 (or the folder of 23:14), copy of the summary U:/Temp/gsfpv-train2/int/logs/gates.log.

## Probes

Local release 9205b3c8 on http://localhost:5760 (serve-csp). One line per probe with its exit code:
U:/Temp/gsfpv-train2/int/logs/summary-run2.txt; logs next to it; evidence JSON in evidence/2026-11-13/train2/.
- accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 (SITE = the local address): exit 0, all ten true.
- pause-over-course-probe: exit 0, 8 of 8 at 1920x1080 and 844x390 (shown in flight, hidden under the menu, drawn over the
  menu again with the class taken off, back after the menu). Both pictures looked at: no lap clock and no lap lines over
  the menu. Seen and not changed: the 4 s flash note of a new course ("Gates: 24. Fly through gate 1 ...") shows faintly
  through the top edge of the menu at 844x390; it is the HUD's flash note (apps/fly/src/ui/hud.ts), not the lap block.
- sonic-optin-page part A: run 1 exit 1, 12 of 13 (a plain G "changed the note"). Cause: the probe's first key J has a
  binding since train 1 (throttle.style; also on origin/main and on release 73beb77e) and on the keyboard it shows a note;
  that note ran out during the G press. The pause probe read the note before and after a plain G: the same text. So this
  train did not cause it; the probe now waits 9 s after J. Run 2: exit 0, 13 of 13.
- sonic-int-review r10 (a course by sound): exit 1, 13 of 14. FAIL 'the course was flown to its end by the hum': at the end
  the phase was flying, the target gate 4, two stage lines. A course by sound has still not been flown to its end in a
  browser; whether the probe's pilot or the page is at fault is not known. Passed: the scan link, both orders of the
  start screen, the free flight, N to "course ready", gate 1 told by its note, backing up not called the wrong way, no
  "last lesson" line.
- rc2-probe usb,refused,bridge,bridge-lna (replay helper on port 5771 through RC2_BRIDGE_PORT; the owner's helper on 47310
  was not touched): exit 0, 19 of 19.
- connect-probe (its own helper on 5772): exit 0, 15 of 15.
- tracks-page: exit 0, 40 of 40. sonic-int-review r9: exit 0, 11 of 11 (205 s).
- sonic-v13-page part A: no result, it ended with an error while another lane held the GPU lock (log
  U:/Temp/gsfpv-train2/int/logs/v13.log).
- NOT RUN: rooms-two-page, mouse-free-probe, centre-throttle-probe all, fast-radio-probe, wizard-auto-check,
  hid-source-probe. Another lane held C:/dev/.gpu-lock from about 23:54 until this stage ran out of replies (00:08).
  To run the rest on the same release: `SKIP_GATES=1 SKIP_BUILD=1 ONLY=v13,rooms,mouse,centre,fast,wizard,hid bash
  U:/Temp/gsfpv-train2/int/run-all.sh` (it writes summary.txt anew; dist is release 9205b3c8, only docs, the probe
  sonic-optin-page.ts and deploy/live-checks.sh changed after it).

## Deploy order for the lead

From git diff --stat 73beb77e..HEAD:
- nginx: no (deploy/nginx.conf unchanged). compose: unchanged. rooms: no (apps/rooms unchanged).
- API: yes, first. `bash deploy/release-api.sh tracks.py tracks_admin.py server.py`. No --locales (apps/api/locales and
  packages/i18n/locales/bot, mail unchanged). No --compose: tracks_admin.py is a new module; release-api.sh copies every
  named file with scp into the hub's api folder (the .prev copy is skipped for a file that is not there yet), compares
  sha256 and restarts the container; deploy/compose.yml mounts the whole folder (./api:/app:ro), so the container sees the
  new file after the restart. --undo for this release: name only server.py and tracks.py (tracks_admin.py has no .prev).
- Site: yes, after the API (apps/fly with the admin, apps/site; locales fly/course, fly/sonic, fly/usb, site,
  admin/tracks ship inside the build). The old page keeps working with the new API (lane tracks, For the lead).
- Then ship and run `bash deploy/live-checks.sh <outdir>`.
- The helper's download links point at the public repository's main until the page has loaded its own copies; the new
  file name start-dji-helper.cmd reaches that main with this push.

## Live checks

deploy/live-checks.sh keeps its seven checks and gains one GET: /en/sound/ carries five figures (measured on the local
release: 5). Left out, with the reason in the script's header: pause-over-course-probe (Shift+G; not confirmed that a
generated course stores nothing), the editor, the votes, the admin tab (they store data), sonic-int-review r10 (not
confirmed), connect-probe (local helper, CSP bypass), rc2-probe bridge and bridge-lna (local helper), sonic-optin-page
part A. The script was not run.

## Pictures for the lead

- Integration: U:/Temp/gsfpv-train2/shots/pause-over-course-1920.png, U:/Temp/gsfpv-train2/shots/pause-over-course-844.png
- Sound: U:/Temp/gsfpv-train2/shots/sound-start-first.png, U:/Temp/gsfpv-train2/shots/sound-start-experienced.png
- Tracks: U:/Temp/gsfpv-train2/shots/tracks-editor-1920.png, U:/Temp/gsfpv-train2/shots/tracks-editor-844.png,
  U:/Temp/gsfpv-train2/shots/tracks-admin-1920.png, U:/Temp/gsfpv-train2/shots/tracks-admin-844.png
- Page (taken before the pin moved: the gates figure there has one lower panel, the merged tree draws two):
  U:/Temp/gsfpv-train2/shots/sound-page-fix-en-1440-sheet.png, U:/Temp/gsfpv-train2/shots/sound-page-fix-en-1440-top.png,
  U:/Temp/gsfpv-train2/shots/sound-page-fix-es-320-top.png, U:/Temp/gsfpv-train2/shots/sound-fig-p2b-en-1440-gates.png
- Connect: U:/Temp/gsfpv-train2/shots/connect-c2-controls-1920x1080.png,
  U:/Temp/gsfpv-train2/shots/connect-c2-controls-844x390.png, U:/Temp/gsfpv-train2/shots/connect-c2-nohelper-line.png,
  U:/Temp/gsfpv-train2/shots/connect-c2-returning.png, U:/Temp/gsfpv-train2/shots/connect-session-obey-new-check.png

## What the owner should try

1. Wrong way (Fly by Sound, a lesson with gates): fly back along the track nose-first for more than a second: two falling
   pairs of notes and "You are flying back. Turn around." Back up with S or slide sideways: nothing is said.
2. Motor: in Fly by Sound the motor is silent at first. "Motor sound" on the start screen or in the pause menu switches it
   on. A pilot who flew before this release also starts with the motor off.
3. Fly this scan by sound: on an ordinary page of a scan press Escape, take the last item "Fly by Sound: blind and
   low-vision pilots": a new tab opens for this scan at the size flown. Enter on the scan's button starts a free flight
   with the wall and height cues. Known: a scan without walls only gets a spoken line that says how to build them.
4. A course by sound: in that free flight press N. "Making a course" (up to about half a minute), then "Course ready.
   Gates: n, laps: k. The hum leads to gate 1". Follow the hum. N again: another course. I: where am I. Escape or X: the
   menu. Shift+G on the ordinary page before step 3 carries that course along. Known: a gate is told by its note, there is
   no spoken line at a gate; the hum points straight at the next gate, also through a wall.
5. The editor: on a scan page Shift+G makes a course, Shift+B opens the editor (the flight is paused). Tab picks a gate,
   the arrows move it, Q and E turn it, 1 2 3 4 change the shape, + and - the size, Insert adds a gate, Delete removes it,
   comma and period change the order, Ctrl+Z and Ctrl+Y undo and redo, G makes a new random course, F6 goes to the window
   (name, "Save as my course", "Save for everyone", the list), Escape leaves. The window lists every key.
6. Votes: after a flown lap of a saved course the course window lets you vote for it; the list shows the votes.
7. Admin, tab Courses: hide, rename (a new version), delete (two clicks), "Open in the editor". Checked on a local copy only.
8. Escape over a running course: the lap clock and its lines are no longer drawn over the pause menu.
9. The page /en/sound/: a flight loop on the first screen, five drawn figures (height, wall, hum, gates, keys), real
   flight strips. Known: on a 320 px phone in Spanish the cookie banner covers half of the start button until answered.
10. "Connect my controller" with the real DJI RC 2 (about 5 minutes, on the release): close the old helper window;
    Controls, "Connect my controller", pick the RC 2 in the second list, press both "Download" buttons, double-click
    start-dji-helper.cmd in Downloads, answer the start-with-Windows question; the window should say "Your DJI controller
    answers"; back in the page it should connect by itself (or press "Fly with the helper program"); the window says
    "Your DJI controller is read"; the check screen opens (the setup is saved); Fly: the throttle style row should say
    centred. If it says from zero as your choice, that is a choice saved earlier on this controller: press J once. Please
    tell us whether you pressed J or the row in the session of 2026-11-13, and what Windows and Chrome showed on the
    downloads and on the first double-click.
- Known, not changed here: 3 answer gaps over 100 ms in the real RC 2 session, and the stale gate in
  apps/fly/src/controls.ts disarms after 100 ms of silence; in the centred style a stick held below the centre on the
  ground makes the motors start and stop every 0.5 to 3 s (centre-pilot, AutoArm); at 1600x900 the throttle-style row of
  the check screen is half under the sticky Fly bar.
- The owner's rule (few presses, an action fulfils its own precondition): a scan without walls on the sound page only
  says how to build walls, it does not build them (lane walls). The merged texts were not read one by one against the rule.

## Not verified

- The sound page after the pin move was not looked at in a browser (no new screenshot of the two-panel gates figure);
  the new es, pl, ru sentences are the agent's, not a native speaker's.
- The helper's two downloads as saved bytes (see Held back). PG-10 not fixed.
- Whether Shift+G on a deployed site stores the generated course was not read from the code; that is why the pause probe
  is not a live check.
- Seven probes did not run on the merged tree (see Probes, NOT RUN) and r10 fails one check: a course by sound flown to
  its end is not shown in a browser. The gates were not run again after the last commits (docs, one probe file, evidence
  JSON, deploy/live-checks.sh); gates b18, i18n and catalog were run on them.
- Nothing ran on the deployed site; deploy/live-checks.sh was not run. No real controller, no real Chrome question.
- The lanes' own lists stand: docs/wip/sound-any.md, tracks-edit.md, sound-page.md, connect.md, rc2-lna.md, "Not verified".

## Cost notes

- Integration: the two red gates of the lanes cost a second full run (gates, build, every probe from the start) and about
  four replies; a lane that runs `gates.py --only vitest,architecture` before it hands over makes that free. A find over
  U:/Temp printed 400 folder names (use a narrower path). A process filter that named the run script also matched the
  shell that ran the filter.
