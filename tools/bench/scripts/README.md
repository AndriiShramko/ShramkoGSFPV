# Live checks outside the acceptance drivers

Small Playwright scripts (system Chrome, or Playwright's bundled Chromium where there is none: `../README.md`; headed) used for the v0.2/v0.3 releases. They read and
write only under the repo (`.cache/...`, gitignored). The acceptance drivers proper are
`../src/accept-*.ts` (B1-B23, C, D) and `../src/screens.ts` (the landing / README screenshots).

| Script | What it proves | Run |
|---|---|---|
| `serve-csp.mjs` | serves a release `dist/` with the SAME enforced CSP as `deploy/nginx.conf` (per-page hashes from `csp-hashes.conf`) | `node tools/bench/scripts/serve-csp.mjs dist 5320` |
| `csp-check.mjs` | 0 CSP violations on the landing and the simulator; control: an injected inline script is blocked | `node tools/bench/scripts/csp-check.mjs http://localhost:5320` (or the live site) |
| `wizard-auto-check.mjs` | the calibration wizard needs no button: a fake radio that presses nothing (`&nobuttons=1`) reaches the check screen; no Start/Next is ever shown | `node tools/bench/scripts/wizard-auto-check.mjs https://gsfpv.flyreelstudio.eu <outDir>` |
| `latency-walls-check.mjs` | latency guard on vs `?guard=0` (rAF -> present in frames, input -> screen estimate) and walls refine + cache across a real browser restart | `node tools/bench/scripts/latency-walls-check.mjs` |
| `landing-overlay-look.mjs` | landing screenshots (ru, 1440) + broken images, and the walls switch (C) / voxel overlay (V) on the live page | `node tools/bench/scripts/landing-overlay-look.mjs` |

Node: `export PATH=/c/Users/andri/node-v22:$PATH` on the build PC (Node 22). GPU safety: before a
heavy bake check `nvidia-smi` (the build PC blue-screened once with a heavy bake next to a DaVinci render).
