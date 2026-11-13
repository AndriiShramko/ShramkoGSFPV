---
type: wip
status: active
summary: Lane connect - any controller plugged in goes through the setup and flies; stage C1 turns the owner's real DJI RC 2 session into evidence and a regression test
created: 2026-11-13
---
# Lane connect

Branch `connect` from `rc2-lna` b05df5e6 (origin/main 2a5ac433 was already in it: 0 commits to merge), worktree
`C:/dev/gsfpv-train1-base`. Ports 5780-5799.

## Status
- [x] C1.1 rc_bridge.py `--replay` takes a `--record` file at its recorded pace, `--start`/`--end` seconds; tests; fixture `packages/input/test/fixtures/dji-rc2/owner-session-2026-11-13.jsonl` (session 2, seconds 0-205)
- [ ] C1.2 replay session 2 against a local release in a headless page that walks the wizard; timeline
- [ ] C1.3 verdict on the lead's reading; fix at the cause; unit tests with the owner's record and FPV counter-cases; centre-throttle-probe, a6-reference
- [ ] C1.4 stick rate, handled rate, longest gap, waste in the page's handling

## Facts (measured)
Record `U:/Temp/gsfpv-train2/rc2/rc2-rec-20261113.jsonl` (67134 lines), split at the first gap over 3 s
(`U:/Temp/gsfpv-train2/connect/persec.py`):
- session 1: lines 0-2954, 46.4 s; stir at 3-14 s, then every value 1024 to the end (the wizard did not get further).
- session 2: lines 2955-67133, 1004.4 s (about 17 minutes, not 9), 64179 answers, 63.9 answers/s, median gap 15 ms,
  longest gap 157 ms, 11037 gaps of 0 ms (two answers with the same ms), 60106 of 64178 answers equal to the one
  before. Throttle: 91.8 % of answers exactly 1024, 7.2 % below 1004, 0.85 % above 1044.
- session 2 by second (throttle T, yaw Y, pitch P, roll R, left dial L): 1-8 all sticks stirred; 9-12 rest; 13-14 T at
  the bottom; 16-17 T at the top; 19-21 T at the bottom; 23-24 Y high; 27-28 P high; 30-31 R high; 50-54 L up, down,
  up; 59 T bottom; 65-66 L up then down; 84-86 T up (to 1684); 87-89 L up; 90-93 T at the bottom; 94-99 T 447-1110;
  111-135 T mostly 364-1024; 143-154 T bottom and back; 155-198 flight with R, P, Y corrections and T between 485 and
  1099 (medians 506-935, below the centre); 228-243 sticks to the ends again.
- Fixture: the first 205 s of session 2, 13105 lines, t rebased to 0.

## The flow

## Decisions
- C1.1: a record replay starts at the page's connection (the bridge opens its source when a page connects), as the
  real bridge's record starts when the first answer is passed on. At the record's end the source returns nothing, so
  the bridge says "no answer" as for a controller switched off. The read loop skips its 10 ms poll pause for a paced
  source (`paced = True`), else answers with the same ms would drift.

## For the lead

## Not verified

## Cost notes
