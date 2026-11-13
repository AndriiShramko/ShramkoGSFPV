# Lane sound (train 2): sound-any

Worktree C:/dev/gsfpv-tracks, branch sound-any (from origin/main 2a5ac433). Sound package: C:/dev/ShramkoSonicFPV branch
train2 (from its main 378cc50). Ports 5700-5719. Facts: U:/Temp/gsfpv-train2/scout-A.md A1-A3; design
C:/dev/gsfpv-v03/docs/wip/sound2-plan.md.

## Status

Stage S1-direction-motor:
- [x] (a) package: wrong way only while flying nose-first (package train2 4c2ac75)
- [x] (b) package: motor sound off by default, marker motorChoice, old false-to-true migration removed (package train2 1ed6103; CHANGELOG line in it)
- [x] simulator: sound.ts pause switch and start-screen motor row save motorChoice; tests sonic-motor, sonic-audio, sonic-start-screen; probe seed sonic-optin-page (this commit)
- [x] pin packages/sonic-fpv 378cc50 -> 1ed6103 (this commit)
- [~] simulator sonic and sonicrec unit tests on the new pin (see Checks)

## Checks (numbers printed by the commands)

Package (C:/dev/ShramkoSonicFPV, node node_modules/vitest/vitest.mjs run):
- test/direction.test.ts: 63 passed (3 new cases: backing up nose forward at 1, 2, 3 m/s never told; sliding sideways never told; nose-first control told).
- Negative control (neg_control.py, ref main, src/lesson/runner.ts, -t "owner, train 2"): NEG OK.
- test/events.test.ts + test/repeat-plays.test.ts: 20 passed. test/replay*.test.ts (3 files): 27 passed. No replay hash changed, so no lesson version bump.
- test/prefs.test.ts: 37 passed; negative control (ref main, src/prefs/prefs.ts, -t "chose it"): NEG OK.
- Whole package suite: 1303 passed, 4 skipped (63 files, 26 s). npm run typecheck: no output (clean).

Simulator (this worktree, tools/bench):
- sonic-motor, sonic-audio, sonic-start-screen, sonic-optin: 86 passed.
- Negative control (ref origin/main, sound.ts + start-screen.ts, -t motorChoice): NEG OK.
- tsc apps/fly and tools/bench: no errors.

## Decisions

- Wrong way: the old condition (against the way forward faster than 0.5 m/s for 1 s) AND horizontal speed along the nose
  (headingBasis(yawDeg)) above the same 0.5 m/s, both over the same second; backSince resets when either fails. The
  threshold is the existing WRONG_WAY_MPS, no new number. Leg bookkeeping (legFlown) unchanged.
- Fixtures fixed on purpose, not the rule: the E3 controls ("lane's first rule tells the pilot who backs away") now turn
  round and fly away nose-first (backAway(p, 'turned')); the shipped E3 case checks both backing and turned (never told);
  the second-lap case turns to face ring 4 before flying back. All other old cases already flew nose-first (flyTo faces
  along the motion; turnTo(180) before flying back).
- No lesson version bump: replay tests and goldens unchanged; precedent: the s13-elev rule change (fabfbbe) was also
  unversioned. A real recording that contains a backing-up wrong-way cue would now replay as a mismatch under the same
  lesson version.
- Motor: motorChoice (optional boolean, ADDED key, default false). readPrefs keeps motorSound only when motorChoice is
  true, otherwise off (issue reported when a stored true has no marker). Strict validatePrefs never changes a recorded value.
- Lesson texts: package lessons/*.json and locales mention the motor only as setting names ("Motor sound", "Motor
  volume"); simulator sonic locales do not say the motor is heard by default. No text change.

## For the lead

- Pin moves to package commit 1ed6103 on branch train2 of C:/dev/ShramkoSonicFPV, which is NOT pushed (no push in this
  workflow): push the package branch (or merge it to the package main and push) before the simulator merge, or the
  submodule pin does not resolve for others.
- Every pilot who flew Fly by Sound before has motorSound true saved without motorChoice: after this release his motor is
  off until he switches it on (the owner asked for off by default).
- Package evidence/audio-proofs.json and evidence/demo-check.json carry a predecessor's uncommitted diff; my runs did not
  regenerate them; left uncommitted.

## Not verified

- No browser run: sonic-optin-page (probe seed changed) and page probes were not run (GPU lock, integration runs them).
- Real pilot recordings with backing up were not replayed (none at hand in the package fixtures).

## Cost notes

- S1: most turns went to quoting test patches (a heredoc ate the backslash of TS \' strings); a patch script written
  with Write from the start would have saved two turns.
