# Train 1B: lead note (integration at level 3)

Lanes from origin/main 41372830; main was at 691261d8 (train 1 live) when merged. Ready: mouse-free
(C:/dev/gsfpv-tracks), rooms-public (C:/dev/gsfpv-rooms). Held back, NOT merged: rc2 (C:/dev/gsfpv-train1-base,
branch rc2), see "## Held back". Condition for rooms-public: docs/wip/train1-lead.md line 8 reads
"ROOMS LIVE CHECK: PASS" (checked 2026-11-13), so it was merged.

## Status

- [x] 1. fetch; main = origin/main 691261d8, no tracked changes; docs/agent-map.md B18 clean (ASCII only), committed 54aea3a2
- [x] 2. merge --no-ff mouse-free (40e0834c), then rooms-public (c38aa2c0), no conflicts; rc2 held back
- [x] 3. seams: b9b2f36b (see "## Integration fixes"); chords: rooms.panel Digit9 and rooms.who Digit0 bound once
  (packages/prefs/src/keymap.ts), keymap tests in vitest; gen-catalog --check up to date (catalog gate)
- [x] 4. all gates once, exit 0 (numbers below)
- [x] 5. local release + probes, evidence/2026-11-13/train1b/ (numbers below)
- [x] 6. this note complete
- [ ] 7. push main

## Merged

- 40e0834c lane mouse-free: a window that needs the mouse gets the mouse (play/mouse-look.ts CURSOR_WINDOWS: every
  .panel, Controls, drones, scenes, aria-modal dialogs, Fly by Sound start and lesson menu, crash view, export bar).
  Fixes the owner's report of 2026-11-13 (report form from "My controller is not in the list" had no cursor).
- c38aa2c0 lane rooms-public: rooms menu public (no ?rooms=1 needed; still read), keys 9 (Fly with others) and 0 (who
  is around) instead of Shift+L / Shift+O, room-only link (rooms/link.ts), welcome line in a lesson.

## Integration fixes (b9b2f36b)

- apps/fly/src/rooms/api.ts listRooms: a 200 without a rooms array is an error ('bad-body'), not a null value (the
  rooms panel threw "Cannot read properties of null (reading 'rooms')" on a server with no rooms API; mouse-free's lead
  item). Test tools/bench/test/rooms-list-body.test.ts, negative control NEG OK on the merged code before the fix.
- tools/bench/scripts/mouse-free-probe.mjs (MF-R6): rooms entry starts without &rooms=1 and presses Digit9 first
  (Shift+L, then the menu, as fallbacks). Run: opened by '9'.
- tools/bench/src/rooms-two-page.ts (RP-2): new check nineNotTypedInName (the #rooms-nick field equals the stored name
  after Digit9 opened the panel). Run: true.

## Gates (once, after the seam fix; logs U:/Temp/gsfpv-gates-20261113-130542)

typecheck PASS; vitest 288 files passed, 1 skipped; 4432 tests passed, 14 skipped; api-unittest 453 OK; architecture
PASS; i18n PASS; catalog PASS; B18 PASS (outside [], placeholders []).

## Probes (local release b9b2f36b, serve-csp port 5455, headless; logs U:/Temp/gsfpv-train1b/logs)

- accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16: 10 of 10 (first line "accept-fly target: http://localhost:5455").
- mouse-free-probe.mjs: 84 of 84 checks (helper form: mouse free, cursor auto; rooms by key 9 without ?rooms=1).
- centre-throttle-probe.mjs: pass (dji-centred, dji-flip, dji-bottom, 0 errors each).
- wizard-auto-check.mjs /en: 3 runs (nobuttons, human, dji), 23 screens each, 0 errors, end on the check screen.
- hid-source-probe.mjs /en: pass, 8 of 8 runs (dji, dji-windows, edgetx, dji-other, dji-none, dji-pad-chooser,
  dji-pad-cancel, dji-pad-nopick).
- tracks-page: 18 of 18. rooms-two-page: pass, 15 of 15 checks (incl. nineNotTypedInName, three controls fired).
- sonic-int-review r9: 11 of 11.
- rc2-probe.mjs: NOT run (lane rc2 held back; the script is not on main).
Screenshots worth a look (not in git): U:/Temp/gsfpv-train1b/shots/mouse-free/mouse-free-helper-form.png,
U:/Temp/gsfpv-train1b/shots/accept/b6-887f27aa.jpg, U:/Temp/gsfpv-train1b/shots/accept/b14-375x812.jpg.

## Deploy order for the lead (nothing of it was run here)

- deploy/nginx.conf, apps/api and apps/rooms did NOT change in this train: no release-nginx.sh, no release-api.sh, no
  release-rooms.sh. Only the static release: `bash deploy/ship.sh` (with the neighbour snapshots, as in train 1).
- This release IS train 1's step 5 (rooms menu public). Your own live note lists three things to fix BEFORE the rooms
  menu goes to everyone; lane rooms-public did NOT address them: (1) two pilots share the start point (the remote drone
  is a large grey shape across the view); (2) no picture yet of the other drone with its name tag at normal distance;
  (3) TR-11 course hint over the lap timer. Your call: ship now (mouse fix for the owner) and fix them in train 2, or
  wait.

## Live checks after the deploy

- release.json equals the pushed sha; accept-fly B6..B16 with SITE=https://gsfpv.flyreelstudio.eu.
- mouse-free-probe.mjs against https://gsfpv.flyreelstudio.eu/en (it only opens windows; the helper's Send is not
  pressed by the probe: check that in the script before running it on live).
- Two browsers without ?rooms=1: key 9 opens the panel, A creates, B opens the link, B sees A (train1-live.ts with the
  new keys); key 0 says who is around.
- SITE=https://gsfpv.flyreelstudio.eu npx tsx src/sonic-int-review.ts r9.

## What the owner should try by hand (after the deploy)

- With the DJI RC 2 plugged in: Controls, "My controller is not in the list": the report form now shows a cursor and
  Send can be clicked without leaving the browser (also B, the pause menu's Feedback and Settings). The RC 2 itself does
  NOT fly yet (lane rc2 held back); nothing local to start for this train.
- Key 9 over the flight: "Fly with others", no ?rooms=1; key 0: who is around.

## Held back

- rc2 (branch rc2, 20 commits, C:/dev/gsfpv-train1-base): blocker RC2-R1 outside the lane: the centred-throttle ground
  probe (apps/fly/src/play/ground.ts groundClearance via VoxelContactWorld.sweep, 20 m with a 10.05 m cover sphere) costs
  88-434 ms against a 33 ms input interval in 887f27aa above about 6 m and freezes the page; rc2-probe usb.climbs fails.
  Its lead items (lead-wiring.patch.txt, serve-csp patch, nginx map $gsfpv_rc_bridge, usb.rc2.lost line, RC bridge
  download decision) wait for that fix. Do not announce the RC 2 as flying.

## Not verified

- Live site: nothing deployed here; every number above is the local release on this PC.
- A real mouse and cursor on a real screen, Firefox and Safari pointer lock (headless Chromium only).
- A screen reader announcing each window; Fly by Sound with keys 9 and 0 (RP-3: not walked in a page).
- The real DJI RC 2 (lane held back; only fakes in the probes).
- The lead's three rooms items above (spawn overlap, name tag picture, TR-11): not looked at.

## Cost notes

- Integration: the probe chain (19 min) ran as one background script; most turns went to sorting evidence because the
  probes write to evidence/<date>/ by default (and one untracked foreign file got swept and put back). Cheaper: an
  EVIDENCE_DIR variable honoured by every probe.
