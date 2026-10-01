# v0.3 wave 1 — work in progress (branch `wip/v03-wave1`)

> **Superseded (2026-10-01).** Everything below describes the branch `wip/v03-wave1` as it was on 2026-09-27. Wave 1 was
> finished and merged on branch `shramkoclaude/determined-cannon-ns801h` (PR #3): the 4 prefs must-fix items are fixed
> (a31799c, d7f8c8d, 6121bef, ca9b96e), W1-2 is merged (8856d18) and W1-4 is finished (7a1ccd4). Do not redo any of it;
> start from `STATE.md` "Where v0.3 stands".

This branch holds the unfinished v0.3 wave 1 ("foundations") exactly as the agents left it on
2026-09-26/27. It is **not** merged and **not** deployed. `main` (the live site) moved on without it:
the no-click calibration wizard, the latency guard, walls refine / on-off, the voxel overlay and the
screenshot landing all landed on `main` from branch `fix/wizard-user-paced`.

Base of this branch: `60fa9de` (main on 2026-09-26). Rebase or merge it onto the current `main`
before continuing; expect conflicts in `apps/fly/src/main.ts`, `apps/fly/src/ui/flight.ts` (split
here, edited on main), `packages/collision/src/*` (already on main in a later form) and the fly
dictionaries.

Plan and contracts: [`docs/architecture-v03.md`](../architecture-v03.md) (section J = the waves).

## State per agent (wave 1, design section J)

| Agent | Delivers | State |
|---|---|---|
| lead contracts | `packages/sim-core/src/contracts.ts`, `packages/prefs` skeleton + `keymap.ts`, empty i18n namespaces | done, green |
| W1-1 prefs | `packages/prefs/**` (A.1–A.6: store, schema defs, migrations, export/import, catalogue builder) | built, 394 tests green at the time; the adversarial review found **4 must-fix items, not fixed yet** — see `wave1-reports.json` (`prefsReview.mustFix`) |
| W1-2 app shell | `apps/fly/src/app/**`, split of `ui/flight.ts` into `ui/{hud,crash-overlay,pause,panels}.ts`, `i18n.ts` namespaces | **build interrupted** (session limit) — partial files, not typechecked as a whole; redo against the current `main` |
| W1-3 sim-core model | modes (acro/angle/horizon), platform, crash-off, battery soc, Pavo20 preset corrections, `SIM_CORE_VERSION` 0.2.0, A4/A6 re-runs (`evidence/2026-09-26/v03-a4-physics.json`, `v03-a6-determinism.json`) | built, own checks green; **its review did not run** |
| W1-4 sim-core log + respawn | `runner.ts` lives/log format /2, `history.ts`, `director.ts`, `stats.ts` | **build interrupted** — partial files |
| W1-5 collision | `transform.ts`, `mesh.ts`, `components.ts` + tests | built + review **pass**; `mesh.ts` / `components.ts` already on `main` (voxel overlay) |

`wave1-reports.json` next to this file: the agents' own reports and the prefs review.

`audit-fix-fly.patch`: an older, partial audit-fix change set (2026-09-24, before v0.2) kept for
reference only; most of it is superseded by v0.2.

## How to continue

1. `git checkout wip/v03-wave1 && git rebase main` (or merge) and resolve.
2. Re-run the prefs review's must-fix items, finish W1-2 shell and W1-4 log/respawn per section J.
3. Gates: `pnpm -r typecheck`, `npx vitest run`, `node scripts/check-architecture.mjs`.
4. Then waves 2-4 of section J; the owner's backlog with item numbers is in the vault note
   `01 - Projects/FPV-симулятор в 3DGS-сценах/ShramkoGSFPV — бэклог 2026-09-25.md`
   (vault repo `obsidian-vault-andriishramko`).
