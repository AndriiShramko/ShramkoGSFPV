# Lane gpu-select: the simulator draws on the integrated GPU of a hybrid laptop

Brief: `docs/wip/gpu-select-brief.md`. Branch `gpu-select` from `origin/main` 2a5ac433, worked on the owner's laptop
(clone `C:\dev\ShramkoGSFPV`, the checkout `C:\dev\gsfpv-dji` of lane dji-rc3 was left alone).
Labels: [measured] on this laptop on 2026-11-13; [reference] read in code or documentation; [owner] the owner's report, not reproduced.
Raw files: `evidence/2026-11-13/gpu-select/` (user name masked; no serial numbers).

## Status

- [x] 0. Laptop state: both display adapters enabled and working, nothing to repair.
- [x] 1. Measured before any change: the owner's Chrome, a stock Chrome, Edge and Firefox all draw on the Intel chip.
- [x] 2a. The browser's switch (`--force-high-performance-gpu`, the same as the flag) puts Chrome and Edge on the NVIDIA card.
- [ ] 2b. Windows' per-application graphics preference: waits for the owner's own clicks (see "For the owner").
- [x] 3a. Product: rule, note, the line that stays, the software case, the bug report's graphics block; unit tests pass.
- [x] 3b. Product after review (six reviewers, three verifiers; every confirmed finding acted on): the browser run of the
  page (`tools/bench/src/sonic-gpuhint-page.ts`) passes 24 of 24 on this laptop.
- [ ] 3c. Negative control and the full gates on the reviewed code.
- [ ] 4. Handback: the tables below completed, "For the owner", "For the lead", "Not verified".

(This file is filled in as the steps finish; the sections below are written with the final numbers at step 4.)

## Facts (measured), short form so far

- Windows 11 Home 25H2 (26200.9711), Razer Blade 15 Advanced (Mid 2021), i7-11800H, 16 GB; Intel(R) UHD Graphics driver
  32.0.101.7088, NVIDIA GeForce RTX 3070 Laptop GPU driver 32.0.16.1742 (617.42); on AC power, plan Balanced with the
  "Best performance" overlay. Both adapters `Status OK`.
- Browsers: Chrome 140.0.7339.81 (the default browser; an update to .129 has been waiting since 2025-09), Edge 157.0.4341.46
  (never started by this user before the probe), Firefox 160.0 (it updated itself from 142.0.1 when the probe first started it).
- The page gets ONE adapter whatever it asks for (`powerPreference` high-performance, low-power, none): `intel gen-12lp` in
  the owner's Chrome, in a stock Chrome and in Edge; WebGL the same (Intel(R) UHD Graphics). Windows' GPU counters agree: the
  browser's GPU process has no engine on the NVIDIA adapter at all, and `nvidia-smi` does not list it.
- With `--force-high-performance-gpu` the same Chrome and Edge give `nvidia ampere` for every request, WebGL names the RTX 3070,
  `chrome://gpu` marks GPU1 (NVIDIA) as ACTIVE, and `nvidia-smi` lists the browser's GPU process.
- The environment variable of NVIDIA's "Run with graphics processor" (`SHIM_MCCOMPAT`) changes nothing. A headless Chrome gets
  the same adapter as a visible one.
- A browser that draws on the processor (`--disable-gpu`, or ANGLE on WARP) has no WebGPU adapter at all and WebGL names
  SwiftShader or Microsoft Basic Render Driver: the old rule answered `no-webgpu` and the page said nothing.
- The owner's Chrome held the mark `gsfpv.hint.gpu = 1`: the hint had been shown once and was never shown again.

## Product changes so far

- `packages/render-pc/src/device-class.ts` (the hint part): the reading gains `kind`, `name`, `hint`; software graphics and AMD's
  integrated chips are recognised; names come from WebGL's renderer string.
- `apps/fly/src/sonic/gpu-hint.ts`: the words (three notes), the addresses, the browser's memory (`off`, `fast`), the plan.
- `apps/fly/src/app/builtin/gpu-hint.ts` and `.css`: the note on every visit with "Do not show again", Windows' graphics page as
  a link, the line that stays (start screen, pause menu), the software note, the bug report's lines.
- `packages/i18n/locales/fly/gpuhint/*` (25 keys in en, es, pl, ru) and three new spoken lines (`sonic.say.gpuSoftware`,
  `sonic.say.gpuHintAgain`, `sonic.say.gpuSoftwareAgain`).
- Outside the lane's own files, small: `apps/fly/src/app/boot.ts` (one call that puts the line on the scan picker),
  `apps/fly/src/app/diagnostics.ts` (the report's `browser.gpu` gains `name`, `kind`, `webgl`, `hint`),
  `tools/bench/test/sonic-int-lazy.test.ts` (the new spoken key in the allowed list).
- Tests: `packages/render-pc/test/gpu-hint.test.ts`, `tools/bench/test/sonic-gpuhint.test.ts`; page run `tools/bench/src/sonic-gpuhint-page.ts`.
- Probes: `tools/bench/scripts/gpu-select-probe.mjs` (which adapter a normally started browser draws on),
  `tools/bench/scripts/gpu-select-fly.mjs` (one scan: load order, frames drawn, turns).
