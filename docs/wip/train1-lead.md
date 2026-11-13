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
- [ ] I5b. All gates once more on the fixed tree.
- [ ] I6. Local release build, accept-fly, lane page probes, integration probes, regression probes.
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

- Planning: most turns went into finding the shared lists one grep at a time; a ready `docs/agent-map.md` would have saved about
  4 turns. `neg_control.py` needs `pnpm.cmd` (or `node node_modules/vitest/vitest.mjs`) after `--` on Windows.
