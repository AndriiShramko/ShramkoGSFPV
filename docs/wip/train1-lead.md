# Train 1: planning lead (status)

Plan: `docs/wip/train1-plan.md`. Base branch `train1-base`, worktree `C:/dev/gsfpv-train1-base`.

## Status

- [x] Base worktree from origin/main 8549533e; `pnpm install --frozen-lockfile` and `git submodule update --init` done there.
- [x] Designs copied and committed (`tracks-plan.md`, `rooms-plan.md`, `voice-feedback-plan.md`; ASCII, 0 non-ASCII lines).
      `docs/agent-map.md` was missing: the code map is section 2 of the plan.
- [x] Contract as code (commit "train 1 base: the contract between the lanes as code"): reserved keys, def files, feature
      stubs, page-hook types, locale namespaces, `tools/bench/test/train1-contract.test.ts`.
- [x] `docs/wip/train1-plan.md` written.
- [ ] Lanes tracks, rooms, voice (their own status files `docs/wip/tracks.md`, `rooms.md`, `voice.md`).
- [ ] Integration (level 3).

## Checks run by the planner (numbers printed by commands)

- Typecheck `@gsfpv/prefs`, `apps/fly`, `tools/bench`: exit 0 each, 0 `error TS` lines.
- `pnpm vitest run` on `train1-contract.test.ts`, `app-keys.test.ts`, `fly-parity.test.ts`, `packages/prefs/test`,
  `sonic-optin.test.ts`, `flight-ux.test.ts`: 20 files, 347 tests passed.
- Negative control of the contract test against origin/main (`keymap.ts` swapped): NEG OK.

## Not verified

- The whole suite, the gates, the release build and any browser run on the base (level 3 belongs to the integration stage).
- That the catalogue generator output is unchanged by the planned keys and the empty def files (not run).
- How the Python tests are started (see the header of `apps/api/tests/test_sessions.py`); Python version on this machine.
- Where the real walls of the bench tests come from (no `.cache/scenes` folder was found in the base or in `gsfpv-v03`).
- That two edits in the split places of `nginx.conf` and `keymap.test.ts` merge without a conflict (by construction only).

## Cost notes

- Most turns went into finding the shared lists (keymap table and its exact-table test, defs index, feature list, test hook)
  one grep at a time; a ready `docs/agent-map.md` with those lists and the test that pins each would have saved about 4 turns.
- `neg_control.py` needs `pnpm.cmd` after `--` on Windows (one lost run).
