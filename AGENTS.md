# AGENTS.md — instructions for coding agents working in this repository

ShramkoGSFPV is an open-source (MIT) browser FPV drone simulator for 3D Gaussian Splatting scans published on SuperSplat. Author: Andrii Shramko. Read this file before changing anything.

## Layout

| Path | What | Rules |
|---|---|---|
| `packages/sim-core` | flight model: motors, X mixer, rate PID, rate curves, gravity, crash detection, record/replay | **No DOM.** Only `+ − × ÷`, `Math.sqrt` and `src/dmath.ts` in the step — never `Math.sin`, `Math.random`, `Date`. The trace hash must stay identical in Node and every browser. |
| `packages/collision` | vendored SuperSplat voxel collision (`src/vendor/`, MIT, **do not edit the logic**) + our swept test | Changes to vendored files: attribution/export only, listed in `UPSTREAM.md`. |
| `packages/render-pc` | PlayCanvas engine used directly | Public engine API only (checked by `tools/bench/src/a1-api-check.ts`). |
| `packages/scenes` | SuperSplat link parsing, CDN loading, history | Scenes are loaded **only** from the public CDN in the browser. Never add a server-side request to `superspl.at` or `playcanvas.com/api`, never crawl. |
| `packages/input` | radios, gamepad, touch, calibration, SimRadio + bot pilot | Every input becomes `{t_us, ch[8]}`; physics never knows the source. |
| `packages/crash` | Rapier crash aftermath (lazy) | The crash must still happen without it. |
| `apps/fly` | the simulator app (Vite, no framework) | `lab/` pages are measurement tools, not shipped. |
| `apps/site` | landing page (Next.js static export, EN/ES/PL/RU) | Numbers shown on the page come from `evidence/latest.json` at build time. |
| `tools/bench` | acceptance harnesses that write `evidence/` | Every check has a negative control that must fire. |
| `tools/latency` | stick-to-photon measurement (Windows, Desktop Duplication) | |
| `evidence/` | JSON/PNG proofs by date | Never hand-edit a number. |

## Before you open a pull request

```bash
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm vitest run          # unit tests + CI subset of the phase A harnesses
```

- Physics or collision change → run `npx tsx tools/bench/src/run.ts a2 a3 a4` and `npx tsx tools/bench/src/a5-run.ts` and commit the new evidence.
- Changing the model in a way that changes traces → bump `SIM_CORE_VERSION` in `packages/sim-core/src/index.ts` (old replays must refuse cleanly, not silently diverge).
- New preset numbers: every field needs `value` + `source` (`manufacturer`, `measured:<who>`, `estimate`, `bf-default`) and a link where one exists.
- Code and docs in English only. No secrets, tokens or personal data in commits.

## Licences you must respect

- Betaflight is GPL-3.0: formulas may be re-implemented, code may not be copied (see `docs/PROVENANCE.md`).
- No research-licensed Gaussian splatting code (Inria `diff-gaussian-rasterization` and derivatives). CI fails on it.
- Scene content belongs to its authors; nothing but the CC BY fixture of scene `39e63ce9` is stored here.

## Contact

Andrii Shramko — [LinkedIn](https://www.linkedin.com/in/andrii-shramko/) · [book a call](https://calendar.app.google/Ff729HqGk4RpzPNDA) · zmei116@gmail.com · [GitHub](https://github.com/AndriiShramko)
