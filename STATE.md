# STATE — /goal progress (resume from here)

Spec: vault `03 - Resources/Deployment/shramkogsfpv/spec.md` (+ 6 spec-*.md). Phases strictly A → B → C → D.

## Current

- **Live:** https://gsfpv.flyreelstudio.eu — release **e5fad2d5182f** = commit `8042182` (+ later commits on `main` are evidence/bench/docs only). Contains: no-click calibration wizard (sticks move it on), latency guard + honest HUD latency, walls refine to 1.6 cm with browser cache/export, walls on/off (C key; admin default per scan in `apps/fly/public/showcase.json`), voxel overlay (V key; overlay / voxels only, 4 styles, opacity), whole-file bake reads (brotli scenes), coarser grid for huge scans, governor 1.25-period threshold, landing + README with 30 real screenshots and parallax.
- **Acceptance:** A1-A9, B1-B23, C, D accepted on the live site; table `evidence/2026-09-27/acceptance-live-2026-09-27.json`; later releases re-checked: `evidence/2026-09-27/v03-*.json` (wizard auto, walls/voxels/landing, latency/walls). A9: LIMITED BY DISPLAY (the owner's 4K monitor runs 30 Hz over HDMI).
- **Last update:** 2026-10-01 (v0.3 continues on branch `shramkoclaude/determined-cannon-ns801h`, PR #3: see "Where v0.3 stands" below)

## Where v0.3 stands (2026-10-01, local session on the owner's PC)

- **Continue from branch `shramkoclaude/determined-cannon-ns801h` (PR #3), not from `wip/v03-wave1`.** `wip/v03-wave1` is the old,
  superseded snapshot (its `docs/wip/V03-WAVE1-STATUS.md` is history only).
- **Wave 1 is done** on PR #3 (prefs store with the 4 review must-fixes, app shell, sim-core model / lives / log /2 / director /
  history / stats, collision transform, namespaced i18n). W2-5 (settings catalogue on the site) and W4-3 (Betaflight dumps +
  blackbox tools) are done early. Lead contract step before wave 2 done: `ctx.prefs`, `ArmGate.keepArmedAfterCrash`,
  `FlightSession.setCamera` / `applyLifeSettings` / `stats`.
- **Open from wave 1:** accept-fly B12 negative control (the bot's slow dash tumbles into a crash since wave 1) and the B15 tamper
  control margin; both owned by W2-2. With the scan drawn on a GPU, B6 B7 B9 B10 B11 B13 B14 B16 pass on a local release build
  (`evidence/2026-10-01/v03-w1-render-accept.json`).
- **Review of the cloud work** (7 areas, every finding tried by 3 skeptics): 19 confirmed, 20 refuted; each confirmed one is owned
  by a wave-2 agent or the lead (vault build log `build-log-2026-09-27-cloud-v03.md`).
- **Wave 2** (W2-1 settings UI, W2-2 respawn, W2-3 modes, W2-4 summary) runs in worktrees `C:/dev/gsfpv-w2-*` on branches
  `w2-1`..`w2-4` (local only until merged into PR #3).


## Cloud session status (2026-10-01, read this before continuing from b7261ee)

- The cloud session (claude.ai/code, branch `shramkoclaude/determined-cannon-ns801h`, PR #3) hit the weekly limit on
  2026-09-28 08:22 UTC. The wave-2 agents it had just started (W2-1 settings UI, W2-2 respawn, W2-3 modes, W2-4 summary)
  **committed nothing**: start wave 2 from scratch on this branch.
- **W4-3 Betaflight + blackbox is done and merged** (`b46cd89`): `bfdiff.ts` reads the 9 BetaFPV Pavo20 Pro / Pro II
  factory dumps (4.5.0, 4.5.3, 2025.12.5, "2026.6.1"); `tools/blackbox/` = our own blackbox decoder (2,130 x 35 values
  identical to `blackbox_decode`), the model fit from a log, `docs/research/blackbox-fit.md` (how Andrii records and
  sends a log). Do not redo it.
- Open from the wave-2 lead step (`evidence/2026-09-28/v03-lead2-accept-fly.json`): B12 negative control (the slow
  0.75 m/s bot dash now crashes, reproducible in Node) and the B15 tamper control margin (9.0 mm vs 10 mm).
- Hub commands from a cloud session: vault workflow `gsfpv-hub` (`.github/gsfpv-hub/README.md` in the vault). From the
  owner's PC plain SSH works.
- After 2026-10-01 a local session on the owner's PC continues this work; the cloud session stood down to avoid duplicate
  work.

## Handoff — how any agent continues from git alone

1. **Repos.** Code: `github.com/AndriiShramko/ShramkoGSFPV` — `main` = live. v0.3 in progress: branch **`shramkoclaude/determined-cannon-ns801h`** (PR #3; state in "Where v0.3 stands" above). `wip/v03-wave1` is superseded. Vault (owner's notes, backlog, verbatim briefs): private repo `obsidian-vault-andriishramko`.
2. **What the owner asked for, with item numbers and status:** start at the vault note `03 - Resources/Deployment/shramkogsfpv/HANDOFF.md` — it links the backlog (item numbers, status), the owner's verbatim briefs (primary source; derived notes lose details), the build log with numbers and root causes (`build-logs/build-log-2026-09-25-real-radio.md`) and the acceptance table (`build-logs/acceptance-phase-b.md`).
3. **Plan for what is left:** `docs/architecture-v03.md` (parts A-I, waves in section J) + `docs/research/*` (why things are as they are). Next in order (wave 2 on PR #3): settings screen + modes + spawn platform / rewind respawn, flight stats, SuperSplat catalogue tab with filters / random highly rated / favourites (owner's decision 2026-09-27: legal terms do not block it), scene scale, 60 fps recording + auto folder, Pavo20 physics (needs the owner's `diff all` / blackbox).
4. **Checks:** `pnpm -r typecheck`, `npx vitest run` (711+ tests on PR #3), `node scripts/check-architecture.mjs`, `node scripts/check-licenses.mjs`, `pnpm --filter @gsfpv/site i18n:check`; live acceptance `tools/bench/src/accept-{site,fly,c,d,repo}.ts` (`SITE=https://gsfpv.flyreelstudio.eu npx tsx ...`); extra live checks `tools/bench/scripts/` (README there); screenshots `tools/bench/src/screens.ts`.
5. **Deploy:** CI builds `dist.tgz` + `SHA256SUMS` on every push to `main` (artifact `dist`); `deploy/README.md` = the procedure (nginx.conf first when it changes, `deploy/deploy.sh`, `deploy/rollback.sh`, neighbours snapshot/diff with `deploy/neighbours.py`). NOT in git on purpose: `deploy/hub.env` (hub address, SSH port/user/key path) and all secrets — the vault note `HANDOFF.md` above names where the owner keeps server access for agents; the secrets file itself is local only, never in any git repo. Rules: never touch other containers on the hub or `/home/fpv/proxy/`, never `git push --force`, spec-ops STOP rule: >= 2 GB free on the hub before a deploy.
6. **Traps met so far:** Git Bash rewrites env paths for native programs (do not `set -a; . hub.env` before python); tsx wraps page functions in `__name` (pass strings or shim it); Chrome cannot read one byte of a brotli/gzip file (use HEAD / whole-file reads); the owner's PC runs DaVinci renders on the same GPU (check `nvidia-smi` before heavy bakes); a real person is slower than any "human model" (never accept anything because time passed).
   - **Cloud container (Claude Code on the web):** no GPU (WebGL is software, the scan draws at about 1 frame/s), so flight checks run only in the logic-only mode (`?render=off`, `ACCEPT_RENDER=off` in accept-fly; never a visual or latency check; `tools/bench/README.md`); no system Chrome, so the bench falls back to Playwright's bundled Chromium (`/opt/pw-browsers`; `/opt/google/chrome/chrome` is only a link to it), headful under `xvfb-run -a`, never `playwright install`; Chromium has no H.264, so the site's hero-video checks fail there only; the egress proxy re-signs TLS, so certificate checks run from the hub or a GitHub runner; SSH only through the vault's gsfpv-hub workflow.

## v0.2 (Andrii's real-radio feedback, items 1, 2, 4, 5, 6, 8, 17, 22 + pause-menu keys)

| Item | Fix | Evidence |
|---|---|---|
| 2 wizard hung at "Let go of the sticks", unclear | new wizard (packages/input/src/calib.ts + ui/radio.ts, radio-art.ts): drawn radio, target stick + ghost motion, live knobs, human-paced, every screen has a hint and an escape within 12 s | human-model sweep 12 000/12 000 correct, old wizard 97.6 % fail on the same people (evidence/2026-09-26/v02-wizard-sweep-new.json); independent 3 000-session fuzz: throttle inverted 79 -> 0, silent 12 s screens 97 -> 0 (v02-recheck.json) |
| 4 loading without progress | stages, MB, speed, time left, stall hint, retry | v02-recheck.json, local 20 Mbit runs |
| 22 throttle dead after window switch / settings | root cause: model rebuilt while paused started its clock at -(pause length); plus stale input queue after a hitch; `apps/fly/src/simclock.ts` + tests with the old clock as control | packages/input/test/simclock.test.ts |
| 8 scene 9d09ab82 "does not exist" | SuperSplat versions (v2, v3...) + HEAD checks (Chrome cannot read 1 byte of a gzip file); walls from the CDN | packages/scenes/test (31 tests, 27/31 fail on the old resolver) |
| 1, 5, 6, 17 | channel Reverse, auto-reconnect of a known radio, close Controls (x / Esc), Recalibrate | evidence/2026-09-26/v02-browser/*.json |
| CSP | enforced per-page hashes; simulator 0 violations under the enforced policy (local server emulating nginx) | evidence/2026-09-26/v02-csp-enforced.json |

## Phase A

| # | Item | Status | Evidence |
|---|---|---|---|
| A1 | engine vs `createViewer` probe, DR | done: engine 4/4, createViewer 0/4; 70 PlayCanvas members public; DR D19 | evidence/2026-09-24/a1-engine-vs-createviewer.json |
| A2 | vendored collision, formats 1.0/1.1, floor from spawn; wrong-flip control | pass (local) | evidence/2026-09-24/a2-collision-formats.json |
| A3 | rates vs compiled Betaflight 4.5.1, 40 sets ±1e-9; x^5→x^3 control | pass (local) | evidence/2026-09-24/a3-rates-vectors.json |
| A4 | physics consistency + 4 controls | pass (local); the Moon hover 0.18 +-0.01 holds with an ideal battery (default battery sag gives 0.158, recorded as informational) | evidence/2026-09-24/a4-physics.json |
| A5 | tunnelling ≥10 000 passes/speed, independent oracle, endpoint control | pass (local): 200 000 passes, 0 penetrations; control tunnels 43 810 @1/30 s, 5 590 @1/144 s | evidence/2026-09-24/a5-tunnelling.json |
| A6 | determinism SHA-256 Node = Chrome, frame splits | pass: d3d4e0e3… identical in Node (30/60/144/240 Hz + replay) and Chrome (same + rAF-paced); Math.random control fired | evidence/2026-09-24/a6-determinism.json |
| A7 | bot pilot crash on 39e63ce9 + 887f27aa, PNG series; open-volume control | pass (local, visible system Chrome): crash 7.9 m/s and 9.0 m/s; open volume: no crash | evidence/2026-09-24/a7-bot-pilot-browser.json, evidence/2026-09-24/a7/ |
| A8 | clearance numbers for the compound body | recorded (not a gate): Pavo20 Pro median 103 mm centre-to-wall, +47 mm over its extent (39e63ce9) | evidence/2026-09-24/a8-clearance.json |
| A9 | latency status with numbers (output rate first) | LIMITED BY DISPLAY: output 30 Hz (dxdiag/WMI; DD 28.2 fps); median 252 ms, p95 295 ms; blank-page floor 65 ms; stages 15.8 / 0.6 / 100 / 136 ms; lagFrames=2 control +65.7 ms (expected +66.6) fired; DaVinci Resolve was open (VRAM/GPU load observed by hand, not recorded by lat.py). NOT DONE on the day: step 6 of the method (frame time via timestamp-query, 600 deg/s yaw and 0.3 m from a wall, GPU load x2/x4 control) | evidence/2026-09-24/a9-latency.json |

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

