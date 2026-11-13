# Train 2, wave 1: integration and lead note

Worktree C:/dev/gsfpv-v03, branch main. Lanes merged here: connect (with rc2-lna), tracks-edit, sound-any, sound-page. Ports
5760-5779. Logs U:/Temp/gsfpv-train2/int/, evidence evidence/2026-11-13/train2/, pictures U:/Temp/gsfpv-train2/shots/.

## Status

- [x] 1. git fetch: origin/main had not moved (2a5ac433)
- [x] 2a. sound package: branch train2 (b6ab45c) merged into its main as 598a98f (no-ff, same tree as b6ab45c); package suite
  1309 passed, 4 skipped (64 files), typecheck exit 0; package main pushed (origin/main 598a98f)
- [x] 2b. four lanes merged with --no-ff, no conflict: connect 3605eb55, tracks-edit 7500a6ac, sound-any c06a85a4,
  sound-page 25522c97
- [x] 2c. pin packages/sonic-fpv b6ab45c -> 598a98f; the sound page says the new rules again (motor off at first, backing up
  is never the wrong way; two lower panels in the gates figure; verify.mjs expects two speech bubbles)
- [x] 2d. seam fix from the owner: the course's lap clock and lines are hidden while a window pauses the flight
  (apps/fly/src/course/cover.ts, hud.ts cover(), hud.css, app/builtin/course.ts); unit test
  tools/bench/test/course-hud-cover.test.ts; page probe tools/bench/scripts/pause-over-course-probe.mjs
- [~] 3. all gates once
- [ ] 4. local release, all probes as one background script (U:/Temp/gsfpv-train2/int/run-all.sh, summary
  U:/Temp/gsfpv-train2/int/logs/summary.txt)
- [ ] 5. deploy/live-checks.sh for this release
- [ ] 6. this note: every section filled
- [ ] 7. push main

## Merged

See Status 2a to 2d; the full text comes with step 6.

## Cost notes

- Integration: reading four status files took one reply of about 30 KB; a find over U:/Temp printed 400 folder names (use
  a narrower path).
