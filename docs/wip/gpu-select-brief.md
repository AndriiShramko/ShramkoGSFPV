# Brief for the agent on the owner's laptop: the simulator draws on the Intel GPU, not on the NVIDIA one

Written by the lead on 2026-11-13 for an agent that runs ON THE LAPTOP (hybrid graphics: Intel integrated + NVIDIA RTX).
The lead works on another PC with one NVIDIA card and cannot reproduce this. Everything you need is in this repository;
the owner's vault is not required.

## The owner's words (translated; the original is in his vault, brief message 48)

"I started the simulator on the laptop, the one where everything was slow. Now the processor is less loaded and the
graphics card is loaded more, but it is the integrated Intel card, not the NVIDIA. Why is the more powerful card not
used? I tried to disable the integrated card in Device Manager, rebooted, started the simulator, and it does not see
the RTX card at all: everything fell on the processor. Fix the problem with the automatic choice of the best card, so
that a user with a good graphics card does not end up on the weak one that also sits in the laptop."

## What is known

Read in the code (main, release 73beb77e):

- The renderer already asks for the fast card: `packages/render-pc/src/renderer.ts` (createGraphicsDevice with
  `powerPreference: 'high-performance'`), the drone studio too (`apps/fly/src/drones3d/studio.ts`).
- A hint exists since v0.12. Rule: `gpuSwitchHintDue` in `packages/render-pc/src/device-class.ts` (due only for
  Windows + WebGPU + an Intel integrated adapter; NOT due for a software adapter, for Intel Arc, for other vendors).
  Note on the screen: `apps/fly/src/app/builtin/gpu-hint.ts` (+ `.css`), spoken version and the "seen" mark:
  `apps/fly/src/sonic/gpu-hint.ts`, words: `packages/i18n/locales/fly/gpuhint/{en,es,pl,ru}.json`.
  The note is shown ONCE per browser (a mark in localStorage) and goes away after 90 s.
- Page hook for tests: `window.__gsfpv.gpuHint.check(over?, {force})`, `.seen()`, `.reset()`, `.open()`.
- Adapter info the page collects: `apps/fly/src/app/diagnostics.ts`, `apps/fly/src/sonic-session/session.ts`,
  device class: `classifyDevice` in `packages/render-pc/src/device-class.ts`.

Read in the documentation (the lead's web search of 2026-11-13, not measured on a laptop):

- Chrome's "WebGPU: Troubleshooting tips and fixes" page says that on Windows the `powerPreference` option has no
  effect in `requestAdapter()`, and names the workaround `chrome://flags/#force-high-performance-gpu`. The same page
  lists as a Windows limit that Chrome does not use several GPU adapters at once (chromium issue 329211593).
- Windows keeps a per-application choice in Settings > System > Display > Graphics; the page opens with the address
  `ms-settings:display-advancedgraphics`. The choices are stored per user under
  `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (one value per executable path). The lead did NOT verify the
  value format: set it once through the Settings page and read back what Windows wrote.

The lead's guesses (verify, do not trust):

- The laptop is a hybrid (Optimus-style) design: the panel is wired to the Intel chip. With the Intel device disabled
  Windows falls back to the basic display driver and the browser loses hardware acceleration, so the page ran on a
  software adapter. In that state the hint is not due (`fallback-adapter`), so the page said nothing useful.
- The hint was shown once on an earlier visit and was never shown again.

## Step 0. Put the laptop back into a sane state

1. List the display devices and their state (`Get-PnpDevice -Class Display`, `Get-CimInstance Win32_VideoController`).
2. If the Intel adapter is still disabled, it must be enabled again (Device Manager > Display adapters > Enable
   device). That needs administrator rights: do not elevate and do not work around it; tell the owner in one line
   what to click, then go on.

Rules for this machine: do not install or remove drivers, do not disable devices, do not change BIOS settings, no
elevation. A per-user graphics preference for the browser (Step 2) is allowed: it is the owner's request and it is
undone in the same Settings page.

## Step 1. Measure before changing anything

Write the results to `docs/wip/gpu-select.md` (section "Facts (measured)") and the raw files to
`evidence/<date>/gpu-select/`. Mask the user name in paths and any serial number.

1. Windows version, the two GPUs with driver versions, AC power or battery, the Windows power mode.
2. The browsers the owner uses (Chrome, Edge, others) with versions.
3. Which GPU the browser really draws on. Use at least two independent readings:
   - the page: open `https://gsfpv.flyreelstudio.eu/en/fly/` in the owner's normal browser (not a headless one: a
     headless or automation-launched browser may get another GPU) and read
     `(await navigator.gpu.requestAdapter({powerPreference:'high-performance'})).info`, the same with `'low-power'`
     and with no option, and `window.__gsfpv.gpuHint.check()`;
   - the system: `nvidia-smi` (is a browser process in its list while the simulator flies?), or the Windows GPU
     counters per process (`Get-Counter '\GPU Engine(*)\Utilization Percentage'`), and `chrome://gpu` saved as text.
4. The current per-app preference: `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (read only), the
   `force-high-performance-gpu` flag state, the NVIDIA Control Panel's preferred processor if it can be read.
5. Frame time in one fixed place of one scene (the HUD, F3 screen, or `tools/bench/src/a9-frame.ts`); keep the scene id.
6. Did the hint appear? `window.__gsfpv.gpuHint.seen()` and the `reason` of `check()`.

## Step 2. Make this laptop use the NVIDIA card (reversible, per user)

Try in this order and measure after each (repeat Step 1 items 3 and 5, with the browser fully restarted, all of its
processes gone):

1. Windows Settings > System > Display > Graphics: add the browser, Options, High performance.
2. The browser flag `chrome://flags/#force-high-performance-gpu` (Enabled, relaunch).

Write down which one works on this laptop, on AC and on battery, in Chrome and in Edge, and how to undo it.
If neither works, find out why (panel wiring, a BIOS graphics mode, a vendor utility that pins the browser to the
integrated chip) and report; do not change BIOS settings yourself.

## Step 3. Change the product so that other pilots do not get stuck here

A page cannot choose the GPU in Chrome on Windows; it can only detect the case and lead the pilot through the switch.
"Automatic" therefore means: the page notices by itself, says so every time until it is fixed, and the fix takes the
fewest possible clicks. Branch `gpu-select` from `origin/main`. Required:

1. The state is visible and stays visible: a line with the adapter name on the start screen and in the pause menu or
   settings ("Graphics: Intel UHD ... (integrated)"), with a warning when the rule is due. The note is shown on every
   visit while the rule is due, until the pilot presses "Do not show again". When the page later runs on NVIDIA or
   AMD, the mark is cleared so that a later regression is reported again.
2. One click to the right Windows page: measure on the laptop whether a link or button with
   `ms-settings:display-advancedgraphics` opens Windows' Graphics page from Chrome and from Edge (the browser asks
   before opening an external address). If it works, use it and keep the written steps as the fallback.
3. The software-adapter case (the owner's second experiment): when the adapter is a fallback one or WebGPU and WebGL
   run on the processor (adapter `isFallbackAdapter`, names such as SwiftShader or Microsoft Basic Render Driver),
   say plainly that the browser is drawing on the processor and why this usually happens (hardware acceleration off
   in the browser settings; the graphics driver disabled or missing), with the steps to fix it.
4. Measure, on this laptop, whether any request changes the adapter: `powerPreference` high / low / none in Chrome,
   Edge and Firefox. If some browser honours it, record the browser and version; the page already asks for
   high-performance.
5. After a successful switch the hint goes away by itself and the device class is re-read (weak to strong).
6. The Feedback report's device block names the adapter and whether the hint was due.
7. Words only in `packages/i18n/locales/**` in en, es, pl, ru; every other file ASCII only. Unit tests next to the
   existing ones (`gpuSwitchHintDue`, the note) with a negative control: the new tests fail on `origin/main`'s
   version of the changed files. In Fly by Sound the spoken version of the hint must still be said.

Files that are yours (the lead's train 2 will not touch them): `packages/render-pc/src/device-class.ts` (the hint
part), `apps/fly/src/app/builtin/gpu-hint.ts` and `.css`, `apps/fly/src/sonic/gpu-hint.ts`,
`packages/i18n/locales/fly/gpuhint/*`. If you need to change another file, keep the change small and name it in the
status file, because other lanes are editing the start screen, the pause menu and the settings at the same time.

## How to work in this repository

- Repository: https://github.com/AndriiShramko/ShramkoGSFPV (public). Clone into `C:\dev` with
  `git config core.autocrlf false`. Node 22, `pnpm install --frozen-lockfile`.
- Map of the code and of the probes for agents: `docs/agent-map.md`. Current state: `STATE.md` (top).
- Build: `node scripts/build-release.mjs`; serve with the production CSP:
  `node tools/bench/scripts/serve-csp.mjs dist <port>`; open `http://localhost:<port>/en/fly/`.
- Checks ("gates"), run from the repository root unless said otherwise: `pnpm -r typecheck`; `npx vitest run`;
  `python -m unittest discover -s apps/api/tests`; `node scripts/check-architecture.mjs`;
  `pnpm --filter @gsfpv/site i18n:check`; `node --import tsx scripts/gen-catalog.ts --check`;
  in `tools/bench`: `SITE=x npx tsx src/accept-repo.ts` (must print `B18 PASS`). Run what your change touches while
  you work and all of them once before the final push.
- Browser probes of the repository are headless by default (`tools/bench/src/chrome.mjs`); `BENCH_VISIBLE=1` shows
  the window. For THIS task the GPU choice must be measured in a normal visible browser, see Step 1.
- Commit after every finished step; keep a checklist in `docs/wip/gpu-select.md` section "Status" and update it in
  the same commit. Push the BRANCH `gpu-select` only. Never push `main`, never force-push, no deploy: the lead merges
  and releases, then asks you to check the live site on the laptop.
- Never log into the live admin. Never put secrets, serial numbers or personal paths into the repository.

## What to hand back

`docs/wip/gpu-select.md` on branch `gpu-select` with: Status; Facts (measured) with the before/after table (adapter,
frame time, which switch worked); What was changed on the laptop and how to undo it; Product changes (files, tests,
negative control); For the lead (what a release needs, what to check on the live site afterwards); Not verified.
Then tell the owner in a few lines, in Russian: which card the simulator uses now, what was switched, what the page
will show other pilots, and that the branch waits for the lead.
