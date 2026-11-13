# Train 1: lead note (planning, then integration at level 3)

Plan: `docs/wip/train1-plan.md`. Base branch `train1-base`, worktree `C:/dev/gsfpv-train1-base`. Lanes merged into main in the
plan's order: voice, tracks, rooms. Held back: none.

## Status

- [x] Planning: base worktree from origin/main 8549533e, designs committed, contract as code (`train1-contract.test.ts`), plan written.
- [x] Lanes tracks, rooms, voice (status files `docs/wip/tracks.md`, `rooms.md`, `voice.md`), each with one review.
- [x] I1. main clean at origin/main 8549533e; the untracked designs rooms-plan.md, tracks-plan.md, voice-feedback-plan.md were
      byte-identical to train1-base and were deleted before the merge (the other untracked docs are not train 1's).
- [x] I2. Sound package: branch voice-feedback (d28d9c2) merged --no-ff into package main = 378cc50 (typecheck exit 0; tests
      62 files passed 1 skipped, 1300 passed 4 skipped), pushed to the public remote.
- [x] I3. On main: merge train1-base 0d63c361, voice cade079d, tracks, rooms (no conflicts); pin packages/sonic-fpv -> 378cc50
      (fbed1010); pnpm install --frozen-lockfile exit 0.
- [x] I4/I5a. First gates run on the merge: FAIL vitest (4 of 4410 tests) and catalog (stale); fixed below, catalogue regenerated.
- [x] I5b. All gates on fb028968: exit 0 (typecheck, vitest 284 files passed 1 skipped / 4396 tests passed 14 skipped, api-unittest
      453 OK, architecture, i18n, catalog, B18 PASS). Also `python -m unittest discover -s apps/rooms/tests`: 53 tests OK.
- [ ] I6. Local release (build of fb028968, sha256 18c32f08...; serve-csp dist 5471):
  - [x] accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 against http://localhost:5471: 10 of 10 PASS (evidence/2026-11-13/train1/b-fly-*.json).
  - [x] Plan probe 3, tracks-page.ts run 2 on the same dist: 18/18 (evidence train1/tracks-page-run2.json), C1 C2 C3 fire.
        C2 cause: the probe predates lane review TR-3 (5836fa89), which makes the page skip a refused newest row and load the
        next saved one; the page loaded A's 887f27aa-cc02d13d, never the moved 887f27aa-96a928cc (skipped true). The probe now
        accepts 'refused' or 'skipped to A's row', never the moved id (823e7997). C3: the route patches any /fly/assets/*.js.
  - [x] Plan probe 5 (voice): analysis.json and summary.md identical in the pin 378cc50 and the lane d28d9c2 (sha256
        f93ccfc5a94c / 46ca50a9a64f; evidence train1/voice-probe5.json).
  - Run 1 history: tracks-page.ts run 1 on the merge: 16/18 (evidence train1/tracks-page-run1.json). FAILS:
        C3 'patched false': the probe patched only main-*.js, and the integration moved the feature into its own chunk; the route now
        patches any /fly/assets/*.js (tools/bench/src/tracks-page.ts, uncommitted before this commit, NOT re-run yet).
        C2 'the moved course is refused in the page': the page refused nothing visible: source 'server', loaded A's saved id
        887f27aa-9e7a42f2 instead of the moved 887f27aa-bf38a155, problem null. Likely cause (not proven): loadServer in
        builtin/course.ts falls back to the next row (index + 1) when a row fails, so a refused newest row ends as the older good
        course; or the page accepted the moved course's check and the fallback is elsewhere. The lane's run 5 had 18/18 with a
        different course (gate 3 near [4, 3.2, 2.6]; this run gate 8 near [24, 14.8, -10.6]). NEXT: read the 'check' result path
        for checkFor.kind 'server' in builtin/course.ts, decide whether the probe or the page is wrong, fix with a test, re-run
        tracks-page.ts (rebuild dist first: node scripts/build-release.mjs).
  - [ ] Plan probe 1: `cd tools/bench && npx tsx src/rooms-two-page.ts` (own rig and GPU lock) with its three controls.
  - [ ] Plan probe 2 (tracks with rooms in one room) and probe 4 (?sonic= scan page with a course: CourseHook.beaconPoints > 0;
        tracks-page A already printed 'A beacon points > 0 63' on the merge) plus sonic-v13-page.ts.
  - [ ] Plan probe 5: voice `pnpm analyze -- test/fixtures/session-voice-two-lessons.zip --out <dir> --transcript
        test/fixtures/voice-two-lessons.transcript.json` in packages/sonic-fpv (378cc50) vs C:/dev/sonic-voice (d28d9c2): same digest.
  - [ ] Regression: sonic-int-review.ts r9 (11 of 11), centre-throttle-probe.mjs (no own lock: wrap in the GPU lock);
        wizard-auto-check.mjs and hid-source-probe.mjs with /en (keymap changed: course keys shipped).
- [ ] I7. Deploy order, live checks, owner tries, not verified (this note).
- [ ] I8. Push main.

## Integration fixes (seams no lane could see alone)

- `packages/prefs/test/keymap.test.ts:160`: the courses' Shift+T / Shift+G are shipped `always`, so on a ?sonic= page they route
  `course.*`; the test now allows exactly SHIPPED_BY_TRACKS there (lane tracks' measured one-line fix; the feature itself ignores
  the keys while ctx.sonic is set, tracks review R2). Option (a) of TR-7 (a KeyWhen 'not sonic') is left for train 2.
- main-audit (app/env.ts is the only query-string reader): `builtin/course.ts` read `location.search` itself (its `course=` link, read
  back after its own replaceState). `env.ts` got `liveSearch()`; course.ts reads through it.
- sonic-int-lazy (the main chunk holds nothing of Fly by Sound): (a) the courses' feature reached the sound package
  (`course/run.ts` trackToObjects) and the mode's shapes (`course/view.ts` shapePrims): `features.ts` now installs
  `builtin/course-lazy.ts`, a stub that loads `builtin/course.ts` as its own chunk and installs it into the same flight (nothing
  if that flight ended first); (b) the rooms' announcer imported sayVia from `sonic-session/platform.ts`: sayVia moved to
  `app/say-via.ts` (type-only imports), platform.ts re-exports it; (c) `sonic.say.text` (handed to the engine only while Fly by
  Sound runs) joins ONLY_IN_MODE of the test.
- `train1-contract.test.ts`: the feature list's import may be `./builtin/<ns>-lazy`.
- Tests: keymap, main-audit, sonic-int-lazy, train1-contract 4 files 55 passed; with the course/tracks/rooms tests 14 files.
  Negative control: sonic-int-lazy + main-audit against the merge's features.ts, announce.ts, course.ts: NEG OK.

## Not verified (planning stage, kept)

- Where the real walls of the bench tests come from (no `.cache/scenes` folder in the base or in `gsfpv-v03`).

## Cost notes

- Integration run 1 (about 40 replies, stopped in I6): most turns went into the four seam failures the lanes could not see
  (main chunk closure, query-string audit, keymap test) and reading probe internals; a lane-side run of sonic-int-lazy.test.ts
  and main-audit.test.ts on a trial merge of all three lanes would have caught them before level 3.

- Planning: most turns went into finding the shared lists one grep at a time; a ready `docs/agent-map.md` would have saved about
  4 turns. `neg_control.py` needs `pnpm.cmd` (or `node node_modules/vitest/vitest.mjs`) after `--` on Windows.
