# STATE — /goal progress (resume from here)

Spec: vault `03 - Resources/Deployment/shramkogsfpv/spec.md` (+ 6 spec-*.md). Phases strictly A → B → C → D.

## Current

- **Phase:** A done; B done on the live site except the final B3 re-run and B22/B23; C and D built and checked locally, live re-run in progress (release 80e5f46 = hub release 7f070213f299)
- **Live:** https://gsfpv.flyreelstudio.eu (hub dir and address in the gitignored `deploy/hub.env`)
- **Last update:** 2026-09-24

## Phase A

| # | Item | Status | Evidence |
|---|---|---|---|
| A1 | engine vs `createViewer` probe, DR | done: engine 4/4, createViewer 0/4; 70 PlayCanvas members public; DR D19 | evidence/2026-09-24/a1-engine-vs-createviewer.json |
| A2 | vendored collision, formats 1.0/1.1, floor from spawn; wrong-flip control | pass (local) | evidence/2026-09-24/a2-collision-formats.json |
| A3 | rates vs compiled Betaflight 4.5.1, 40 sets ±1e-9; x^5→x^3 control | pass (local) | evidence/2026-09-24/a3-rates-vectors.json |
| A4 | physics consistency + 4 controls | pass (local) | evidence/2026-09-24/a4-physics.json |
| A5 | tunnelling ≥10 000 passes/speed, independent oracle, endpoint control | pass (local): 200 000 passes, 0 penetrations; control tunnels 43 810 @1/30 s, 5 590 @1/144 s | evidence/2026-09-24/a5-tunnelling.json |
| A6 | determinism SHA-256 Node = Chrome, frame splits | pass: d3d4e0e3… identical in Node (30/60/144/240 Hz + replay) and Chrome (same + rAF-paced); Math.random control fired | evidence/2026-09-24/a6-determinism.json |
| A7 | bot pilot crash on 39e63ce9 + 887f27aa, PNG series; open-volume control | pass (local, visible system Chrome): crash 7.9 m/s and 9.0 m/s; open volume: no crash | evidence/2026-09-24/a7-bot-pilot-browser.json, evidence/2026-09-24/a7/ |
| A8 | clearance numbers for the compound body | recorded (not a gate): Pavo20 Pro median 103 mm centre-to-wall, +47 mm over its extent (39e63ce9) | evidence/2026-09-24/a8-clearance.json |
| A9 | latency status with numbers (output rate first) | LIMITED BY DISPLAY: output 30 Hz (dxdiag/WMI; DD 28.2 fps); median 252 ms, p95 295 ms; blank-page floor 65 ms; stages 15.8 / 0.6 / 100 / 136 ms; lagFrames=2 control +65.7 ms (expected +66.6) fired; measured with DaVinci Resolve holding 22.4 GB VRAM | evidence/2026-09-24/a9-latency.json |

## Decisions taken during the build (also in docs/decisions.md)

- FF scale is `0.013754 * F * 0.01` (Betaflight 4.5.1 `pid_init.c:278`); the spec formula omitted `* 0.01`.
- Gyro filters added (BF default PT1 250 + PT1 500 Hz) and D-term chain uses BF defaults (PT1 75–150 dyn + PT1 150) instead of the spec's PT1 100 Hz estimate.
- Rotation integrated through world-frame angular momentum (|L| drift 9e-13 over 10 s; plain Euler drifted 1.7 %).
- A2 floor probe also requires the scan to surround the spawn (≥12/16 horizontal rays): a wrong flip is a point reflection and still finds *a* floor.
- Oscillation in the PID step check = ≥2 crossings of the ±2 % band after reaching the setpoint.

## Phase B (live, https://gsfpv.flyreelstudio.eu)

Full table with numbers and controls: vault `03 - Resources/Deployment/shramkogsfpv/build-logs/acceptance-phase-b.md`; evidence `evidence/2026-09-24/b-*.json`, `b19-ci.json`, `b20-secret-scan.json`, `b21-neighbours-backup-rollback.json`.

- Deploy: `bash deploy/deploy.sh <dist.tgz> <SHA256SUMS>` (artifact from CI), rollback `bash deploy/rollback.sh <sha12>`, neighbours `python deploy/neighbours.py snap|diff` with `--stable` over all BEFORE snapshots.
- Acceptance drivers: `tools/bench/src/accept-fly.ts` (B6-B17), `accept-site.ts` (B1-B5), `accept-repo.ts` (B18); `SITE=` selects the site, `LOCAL_FLY=1` the Vite dev server.
- Open: B3 re-run after the "Open scene" fix (release 80e5f46); B22 (vault + HEAD == origin), B23 (site and repo open in Andrii's Chrome).

## Phases C and D

- C: `accept-c.ts` (bake 723068d7 in the tab, compare with the splat-transform 3.6.4 CLI, refusal on bd04e182); A5/A8 on the baked files with `A5_SCENES=723068d7-baked A5_EVIDENCE=c-a5-baked` / `A8_SCENES=… A8_EVIDENCE=c-a8-baked`. Locally: bin identical to the CLI, 50 000 passes 0 penetrations.
- D: `accept-d.ts [cinema governor diff trajectory]`. Betaflight import: `packages/sim-core/src/bfdiff.ts` (30 tests, built and cross-checked by a workflow against the firmware source).

