# Lane gpu-select: the simulator draws on the integrated GPU of a hybrid laptop

Brief: `docs/wip/gpu-select-brief.md`. Branch `gpu-select` from `origin/main` 2a5ac433, worked on the owner's laptop
(clone `C:\dev\ShramkoGSFPV`; the checkout `C:\dev\gsfpv-dji` of lane dji-rc3 was left alone).
Labels: [measured] on this laptop on 2026-11-13; [reference] read in code or documentation; [owner] the owner's report, not reproduced.
Raw files: `evidence/2026-11-13/gpu-select/` (user name masked; no serial numbers; other programs counted, never named).

## Status

- [x] 0. Laptop state: both display adapters enabled and working, nothing to repair.
- [x] 1. Measured before any change: the owner's Chrome, a stock Chrome, Edge and Firefox all draw on the Intel chip.
- [x] 2a. The browser's own switch (the flag `force-high-performance-gpu`) puts Chrome and Edge on the NVIDIA card: measured as
  a command-line switch and through the flags page itself, the way a pilot does it.
- [x] 2b. Closed without measuring, by the owner's decision of 2026-11-14: pilots will not change Windows or browser
  settings, so the product has to cope with the card it is given, and it does (the device class picks the budget, the
  governor lowers it, the note says it and can be silenced; a page cannot pick the card itself, step 1). The agent changes
  no Windows setting itself. Windows' per-application preference and battery power stay unmeasured; the one automatic way
  found is a desktop wrapper that starts Chromium with the switch of step 2a (`docs/wip/laptop-handoff.md`).
- [x] 3. Product: rule, note on every visit, the line that stays, the software case, the bug report's block; reviewed by six
  readers and three verifiers, every confirmed finding acted on; unit tests, negative control, the page run and all gates pass.
- [x] 4. Handback: this file.

Commits: 29dd30e3 (steps 0 to 3a), 1d8f6cdb (step 2a, frames on both GPUs, Firefox), 7d4f693d (review fixes, probes,
measurements), 43958c56 (the owner's settings on both GPUs, gates, handback), and the commit that carries this file (the
Windows link tested again from a closed Settings).

## Facts (measured)

### The laptop

Razer Blade 15 Advanced (Mid 2021), i7-11800H, 16 GB, Windows 11 Home 25H2 (26200.9711), panel 2560x1440 at 165 Hz, scale
150 %. Intel(R) UHD Graphics (8086:9A60) driver 32.0.101.7088; NVIDIA GeForce RTX 3070 Laptop GPU (10DE:249D, 8 GB) driver
32.0.16.1742 (617.42). AC power, battery full, plan Balanced with the "Best performance" overlay. Both adapters `Status OK`:
the Intel adapter the owner had disabled is enabled again, step 0 had nothing to repair.
Browsers: Chrome 140.0.7339.81 (the default browser; its updater has had a newer build waiting for about 14 months), Edge
157.0.4341.46 (never started by this user before the probes), Firefox 160.0.
`HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (read only): six entries, none for chrome.exe, msedge.exe or firefox.exe.
The flag `force-high-performance-gpu` is `Disabled` in Chrome and in Edge. NVIDIA Control Panel's preferred processor was not read.

### Which card a browser draws on

Four independent readings each time: the adapter the page gets (`requestAdapter` with high-performance, low-power and no
option), WebGL's renderer string, Windows' GPU counters of the browser's GPU process per adapter while a canvas draws, and
`nvidia-smi`; for Chrome and Edge also `chrome://gpu` as text.

| Browser, how it was started | WebGPU adapter (high / low / none) | WebGL | Busy adapter by Windows' counters | In `nvidia-smi` |
|---|---|---|---|---|
| The owner's own Chrome 140 (his profile) | intel gen-12lp, all three | Intel(R) UHD Graphics | Intel only; no engine on NVIDIA | no |
| Chrome 140, fresh profile, visible | intel gen-12lp, all three | Intel(R) UHD Graphics | Intel only | no |
| Chrome 140, headless | the same as visible | the same | Intel only | no |
| Chrome 140 with `SHIM_MCCOMPAT=0x800000001` (NVIDIA's "run with") | intel gen-12lp, all three | Intel(R) UHD Graphics | Intel only | no |
| Chrome 140 with `--force-high-performance-gpu` | nvidia ampere, all three | NVIDIA GeForce RTX 3070 Laptop GPU | NVIDIA | yes |
| Chrome 140, flag set on `chrome://flags`, restarted, no switch | nvidia ampere | NVIDIA GeForce RTX 3070 Laptop GPU | (not read) | (not read) |
| Edge 157, fresh profile | intel gen-12lp, all three | Intel(R) UHD Graphics | Intel only | no |
| Edge 157 with `--force-high-performance-gpu` | nvidia ampere, all three | NVIDIA GeForce RTX 3070 Laptop GPU | NVIDIA | yes |
| Edge 157, flag set on `edge://flags`, restarted, no switch | nvidia ampere | NVIDIA GeForce RTX 3070 Laptop GPU | (not read) | (not read) |
| Firefox 160, fresh profile | hidden (every field empty) | "Intel(R) HD Graphics ..., or similar" | Intel for WebGL, for WebGPU high and for WebGPU low | no |

So on this laptop no browser honours `powerPreference`: a page gets exactly one adapter, the integrated one, until the
browser itself is switched. The lead's guess about the hint is confirmed too: the owner's Chrome held the mark
`gsfpv.hint.gpu = 1` (shown once), so the live site's hint, although due, never came again.
In the owner's own profile the device class is picked by hand as desktop-strong with a 1 M budget (the page's own reading is
desktop-weak: intel-integrated), so the page ran the heavier preset on the weaker chip.

A browser that draws on the processor (the owner's second experiment, reproduced with `--disable-gpu` and with ANGLE on
WARP, never by disabling a device): Chrome 140 gives the page NO WebGPU adapter at all, and WebGL names
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)` or
`ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)`. The old rule answered
`no-webgpu` there and the page said nothing.

### Before and after

Scene Winter Garden `7a475d38` on the live site, Chrome 140 started the normal way with a throwaway profile, a visible
maximized window, AC power, the craft parked at the start place. "Frames" are frames DRAWN per second: the engine ticks at
the browser's rate, but the renderer holds a tick while the GPU still works on the two frames before it, and the display
then repeats a picture. Files: `fly-garden-*.json`, `def-garden-*.json`, `owner-settings-*.json`.

| What is drawn | Intel UHD (the browser as it is) | NVIDIA RTX 3070 (the browser switched) |
|---|---|---|
| As shipped, a new pilot | 40.4 frames/s (between frames p50 24.6 ms, p95 48.2 ms), 48 % of ticks held; class desktop-weak; sorted drawing; the governor at its last step: 0.94 M splats at half resolution (1280x619); Intel 3D engine 91 % busy | 129.3 frames/s (p50 7.7 ms, p95 8.5 ms), no tick held; class desktop-strong; the accumulating drawing; 3.95 M splats of 4 M, governor step 0, backbuffer 2176x1052 in one run and 1536x743 in the other (the window is 2561x1238); NVIDIA 3D engine 50 % busy |
| The same work on both: 3.95 M splats, sorted, 2561x1238, governor off | 10.3 frames/s (p50 97.8 ms, p95 109 ms) | 85.9 frames/s from a cool card (p50 13.9 ms, p95 16.1 ms); 60.1 once the card was heat-soaked |
| The owner's display settings (class picked desktop-strong, 1 M, sorted) | 47.4 frames/s (p50 20.8 ms, p95 38.8 ms), 50 % of ticks held; the governor at its last step: 0.48 M splats at half resolution | 129.3 frames/s (p50 7.7 ms, p95 8.5 ms); 0.97 M splats at full resolution (2561x1238), governor step 0; 122 frames/s while turning |

The switch that worked: the browser's flag, in Chrome and in Edge, on AC power. After it the hint is not due
(`not-intel`, kind `other`, name "NVIDIA GeForce RTX 3070 Laptop GPU") and the device class reads desktop-strong by itself.
The owner's own Chrome could not be timed: the extension's tab was not in front of its window, Chrome ran it at one frame
a second and the page paused itself (`owner-chrome-before.json` holds its adapter readings and Windows' counters).

### The two ways to switch, tried end to end

- The flag, the way a pilot sets it (`chrome-flag-ui.json`, `edge-flag-ui.json`): the address
  `chrome://flags/#force-high-performance-gpu` opens on the flag ("Force High Performance GPU", platform Windows, choices
  Disabled and Enabled); after Enabled the page offers a button that restarts the browser, named "Relaunch" in Chrome and
  "Restart" in Edge; after the restart the adapter is nvidia ampere with nothing on the command line.
- Windows' graphics page as a link (`chrome-link.json`, `edge-link.json`): a click on
  `<a href="ms-settings:display-advancedgraphics">` makes Edge ask "This site is trying to open Settings." with Open, Cancel
  and an "Always allow" box; with the origin allowed, the click opens Settings on System > Display > Graphics in both
  browsers. Without that consent nothing opens in either (no Settings window after the click). Chrome's question is not
  exposed to the tool that read Edge's, so its words were not read. (The files are of the second run, made with no
  Settings window open before it; the first run had one open and could not tell what the click had opened.)
- Windows' per-application preference: stored per user as `GpuPreference=2;` for high performance [reference]. Not set and
  not measured here.

### Streamed scans on this laptop (the owner's questions during the lane)

Scene Wroclaw `70b50d42`: 43.09 M splats, 10 levels of detail, 1624 nodes, 413 files. Camera at the start place, about
3 m above the ground. Files: `fly-wroclaw-*.json`, `def-wroclaw-*.json`, `tune-*.json`, `turn-*.json`.

How many splats each card holds (governor off, full resolution unless said):

| Splats drawn | Intel UHD | NVIDIA, from a cool card | NVIDIA, heat-soaked | NVIDIA memory in use |
|---|---|---|---|---|
| 2.4 M (render scale 0.85) | 16.3 frames/s, p95 72.8 ms | | | |
| 3.9 M | | 129 frames/s | 69.9 after three minutes at 82 C | 1.3 GB |
| 7.8 M | | 129 | 52.4 | 1.9 GB |
| 15.7 M | | 73 | 37.5 | 3.2 GB |
| 31.4 M | | 29 | 27 | 5.2 GB |

- As shipped the governor decides: Intel 42.3 frames/s at 0.86 M splats and half resolution; NVIDIA 122.6 frames/s at
  1.43 M splats and half resolution. The governor went to its last step on the NVIDIA card as well, although that card
  holds 3.9 M at full resolution: it counts held ticks as missed frames and does not excuse the streaming after the reveal
  or a turn, and it had not come back up when the run ended a minute later.
- Turns on the spot (slow 360, fast 720 at 360 degrees/s, snaps of 180 and 90), NVIDIA, 3.9 M: 74 to 87 frames/s (31 to
  45 % of ticks held), longest frame 45 to 114 ms; at rest in the same run 129. Intel at 2.4 M: 18.7 frames/s, longest 186 ms.
- The NVIDIA path runs at about 129 Hz (7.7 ms), not at the panel's 165 Hz.
- Heat: the card is at 66 to 72 C idle, reaches 80 C within the first 25 s of load, and the driver then reports
  "SW thermal slowdown": the graphics clock falls from about 1.7 GHz to 780 MHz. It cools by about 2 C a minute at rest.
  Every NVIDIA number above therefore names its thermal state; the files hold temperature, clock and power state.

In what order a streamed scan sharpens (the owner: "far parts load at full detail first, what is near comes last"):
confirmed, and it is the engine's rule. Engine 2.23.2 loads by tier, then the coarser level of the WHOLE scan before any
finer one, then nearest first; and with `lodUnderfillLimit` 0 a node shows its old level until the file of its final level
arrives. After the reveal (NVIDIA, 3.9 M): nodes beyond 25 m are at their level after 6.1 to 7.0 s, nodes under 8 m after
8.2 to 9.4 s. The mean level shown under 8 m (level 0 is the finest, the engine wants 3.95): 9 at the reveal, 8.3 after
2 s, 8.1 after 5 s.

| Experiment (set in the page by the probe, not in the product) | Level shown under 8 m after 2 s / 3 s / 5 s | Near nodes at their level | Downloaded |
|---|---|---|---|
| NVIDIA as it is | 8.29 / 8.07 / 8.07 | 9.3 s | 284 MB, 892 files |
| NVIDIA, `lodUnderfillLimit` 2 | 8.39 / 6.05 / 4.63 | 9.4 s | 304 MB, 1027 files |
| NVIDIA, underfill 2 and 6 parallel loads (engine: 2) | 7.69 / 5.53 / 4.53 | 8.8 s | 309 MB, 1035 files |
| Intel as it is (2.4 M; wanted 4.53) | 8.37 / 8.22 / 7.15 | 8.1 s | 208 MB, 764 files |
| Intel, underfill 2 and 6 parallel loads | 5.88 / 5.19 / 4.69 | 6.8 s | 230 MB, 908 files |

A smaller `lodUpdateAngle` alone (30 instead of 90) changed nothing measurable in the turns.
View-dependent detail (the budget spent on what is in the frame, a preload ring for turns) is not in the engine or in the
SuperSplat viewer; it is the subject of the owner's next request and of a separate branch, not of this lane.

Two GPUs at once (the owner asked): not possible for a page. Chrome and Edge give a page one adapter and do not use
several at once [reference: the Chrome WebGPU troubleshooting page named in the brief]; on this laptop the Intel chip only
puts the finished picture on the panel. One fast card is the answer.

## What was changed on the laptop and how to undo it

- Nothing in Windows: no setting, no registry value, no driver, no device state, no power plan, no BIOS setting; nothing ran
  elevated. The graphics preferences were read, not written.
- The owner's Chrome: no flag, no setting and nothing in its profile was changed. The browser extension opened one tab on the
  live site and closed it; the window was brought to the front once for half a minute.
- Firefox updated itself from 142.0.1 to 160.0 when the probe first started it (its own updater). This cannot be undone here.
- Edge was started for the first time by this user, with throwaway profiles only; nothing of them is kept.
- A Windows Settings window that was open during the first link test was moved to System > Display > Graphics by it and
  left open. It was no longer there two hours later (the Settings program was not running); the second link test opened
  Settings itself and closed what it had opened.
- On disk: the clone `C:\dev\ShramkoGSFPV` with its `node_modules`, and throwaway browser profiles under its `.cache/gpu-select`
  (removed after each run). Deleting the folder removes all of it.
- A preview entry for the local dev server in the Claude desktop app's own folder (`.claude/launch.json` of the session's
  working folder, outside this repository); delete the entry to undo.

## Product changes

The page cannot choose the GPU, so it notices, says so on every visit until it is fixed, and makes the way out short.

Changed on 2026-11-14 at the owner's word ("if he has no choice of card, no such messages: do not mislead him"): the
switch note comes only where something says a faster card is there, and it says so plainly. An integrated chip alone is
no longer enough (`reason: 'no-second-card'`, no note, nothing said aloud; the line that stays still names the chip). The
signs (`secondCardSign` in device-class.ts): the screen's refresh rate of 140 Hz or more (measured by the page from
requestAnimationFrame when it loads, before a flight; gaming laptops have such screens and a card, ultrabooks go up to
120 Hz), or Intel's Tiger Lake-H chip, which is only made for laptops with a card (PCI ids 0x9A60, 0x9A68, 0x9A70 in
WebGL's name). A browser that drew on a faster card before ('fast' in its memory) still gets the fall back note. The note
opens with the sign ("This computer most likely has a faster graphics card (NVIDIA or AMD), as laptops with 165 Hz
screens do"), says the browser leaves that card unused, and what it gives (more detail, full resolution, more frames per
second); the spoken line names the browser's switch. [measured] On this laptop the page measured 167 Hz (said as its
panel's 165 Hz) and its chip is 0x9A60: both signs. The page run checks it, 26/26 (`evidence/2026-11-14/`), with a new
control: asked as an ultrabook (Iris Xe, 60 Hz), no note. Missed on purpose: a laptop with a card and a screen under
140 Hz (a budget gaming laptop) gets no note, rather than every laptop without a card getting a wrong one.

- Rule, `packages/render-pc/src/device-class.ts` (the hint part): the reading gains `kind` (software, integrated, other),
  `name` (the model as WebGL names it, since Chrome hides the adapter's model), `approx` (a family name a browser rounded)
  and `hint` (`switch`, `software` or nothing). New: software graphics (a fallback adapter, or SwiftShader / Microsoft Basic
  Render Driver on WebGL with no named adapter), AMD's integrated chips by name, a hidden adapter (Firefox) read through
  WebGL's name as far as such a name can be believed, and Intel Arc cards by the architecture words Chrome really gives
  (`gen-12hp`, `xe-2hpg`).
- Words, addresses, memory and plan, `apps/fly/src/sonic/gpu-hint.ts`: three notes (switch, the same after a fall back from
  the faster card, software); the browser's flag address with the restart button's own word; Windows' graphics page as a
  link; what the switch costs and how to undo it; the browser's memory (`off`: "Do not show again"; `fast`: this browser
  drew on a faster card, which ends `off`, so a later fall back is told again); a choice of its own for the software note;
  what was said aloud. The mark of v0.12 (`1`, "shown once") reads as nothing.
- Page, `apps/fly/src/app/builtin/gpu-hint.ts` and `.css`: the note over the flight on every visit while due, once per page
  load, never over a paused flight, with "Got it" and "Do not show again"; the line that stays ("Graphics: Intel(R) UHD
  Graphics (integrated)") on the start screen and in the pause menu, with a warning and a button that opens the same note
  in place; the software note; in Fly by Sound the engine says the long line the first time and a short reminder on later
  visits; keyboard focus comes back when a note closes.
- Dictionaries: `packages/i18n/locales/fly/gpuhint/*` (25 keys in en, es, pl, ru) and in `locales/fly/sonic/*` the reworded
  `sonic.say.gpuHint` plus three new lines (`sonic.say.gpuSoftware`, `sonic.say.gpuHintAgain`, `sonic.say.gpuSoftwareAgain`).
  The Spanish and Polish lines were read by a reviewing model, not by a native speaker.
- Outside the lane's own files, small: `apps/fly/src/app/boot.ts` (one call, `graphicsOnStart(picker.root)`, in `showPicker`);
  the pause menu through its public `PauseMenu.addRow`; `apps/fly/src/app/diagnostics.ts` (the report's `browser.gpu` gains
  `name`, `kind`, `webgl`, `approx` and `hint { due, reason, says, memory }`, asked through the new small module
  `apps/fly/src/app/graphics-report.ts`); `tools/bench/test/sonic-int-lazy.test.ts`
  (the new spoken keys in its allowed list). `INTEL_DISCRETE` in `device-class.ts` is shared with `classifyDevice`: an Arc
  card in Chrome is now classed as a card there as well.
- New keys in the browser's storage: `gsfpv.hint.gpu.soft`, `gsfpv.hint.gpu.said` (beside `gsfpv.hint.gpu`).
- Test hook: `window.__gsfpv.gpuHint` gains `memory()` and `again()`; `check()` returns the note and whether it was shown.

Tests:
- `packages/render-pc/test/gpu-hint.test.ts` (the truth table, the laptop's real strings, software, hidden adapters, Arc,
  AMD, WebGL's names) and `tools/bench/test/sonic-gpuhint.test.ts` (addresses, words in four languages, memory, plan, the
  spoken line): 93 tests, all pass.
- Negative control: the same tests against `origin/main`'s version of the changed sources (rule, words module, both
  dictionaries): 25 pass, 32 fail by assertion, 36 fail because the function does not exist there. Sources restored after.
- Page run `tools/bench/src/sonic-gpuhint-page.ts` on this laptop (headless Chrome 140 on the Intel chip, the local dev
  server): 25 of 25. The real device gets its own note by itself; other computers are asked for through the hook, which
  lays signals over what the device says and runs the same code. Evidence `evidence/2026-11-13/sonic-gpuhint-page.json`
  with five pictures.
- Gates on the final code: `pnpm -r typecheck`, `vitest run` (295 files, 4553 tests: 4538 pass, 15 skipped, none fail),
  `check-architecture`, the site's `i18n:check`, `gen-catalog --check` and B18 (`accept-repo`: `B18 PASS`) pass. The API's
  Python tests (458, OK) ran on 7d4f693d; no Python file changed after. The first full run of the unit tests caught a
  fault of this lane: the bug report imported the hint's page module, which pulled a module that reads `screen` into
  fifteen tests that have no page. The report now asks through `apps/fly/src/app/graphics-report.ts`, which the hint's
  module fills when it loads. In one of three full runs a timing test of another lane (`tools/bench/test/app-dji-rc2.test.ts`,
  real timers) failed under the load of the whole suite on this laptop; alone it passes three times of three.

Probes kept for the lead: `tools/bench/scripts/gpu-select-probe.mjs` (which adapter a normally started browser draws on),
`gpu-select-fly.mjs` (one scan: load order, frames drawn, turns, the card's heat), `gpu-select-switch.mjs` (the flag through
its page, the Windows link, WebGPU under load). All Windows only, visible browsers, throwaway profiles.

## For the owner

Nothing is switched in your own browser yet. Either way takes two clicks and is undone in the same place:

- In Chrome: open `chrome://flags/#force-high-performance-gpu`, choose Enabled, press Relaunch. Undo: choose Disabled.
- In Windows: Settings > System > Display > Graphics > Add desktop app >
  `C:\Program Files\Google\Chrome\Application\chrome.exe` > High performance; then close Chrome completely and start it
  again. Undo: the option that lets Windows decide, or remove the entry.

After either, the start screen of the simulator must read "Graphics: NVIDIA GeForce RTX 3070 Laptop GPU" with no warning.
Expect the fans: the NVIDIA card reaches 80 C in half a minute and then slows itself down.

## For the lead

- A release needs nothing but the merge and the usual build: no server change, no migration, no new dependency. Merge as
  ONE squashed commit: the first pushed commit (29dd30e3) carries the name of another program that was running on the
  laptop in ten evidence files (`nvidia-smi` rows); the files are clean from 7d4f693d on, and a squash keeps the name out
  of main's history. The branch was never force-pushed.
- On the live site afterwards, on the laptop: the start screen and the pause menu show the line with the warning and the
  button; the note comes by itself on every visit; "Open Windows graphics settings" asks and opens the Graphics page; after
  the switch the line names the NVIDIA card, the warning and the note are gone and `localStorage['gsfpv.hint.gpu']` is
  `fast`; the Feedback report's `browser.gpu` names the adapter. On the lead's NVIDIA desktop: the line without a warning,
  no note.
- The governor on a strong card: on Wroclaw as shipped it went to step 4 (1.43 M splats, half resolution) on the RTX 3070
  and stayed there, while the same card holds 3.9 M at full resolution at 129 frames/s. Held ticks during streaming and
  turns are counted as missed frames.
- Load order: `lodUnderfillLimit` 2 with more parallel loads brings what is near to a usable level in 2 to 3 s instead of
  staying at the coarsest level for 5 s and more, for about 9 % more bytes. Measured only as an experiment in the page;
  nothing in the product was changed.
- The owner's Chrome is 14 months behind (140; the updater has a newer build waiting). The simulator works there, but any
  WebGPU fix since then is missing.
- Not done: `apps/api/ownerbot.py` does not read the new fields of the report's graphics block.
- The lane's probes write big JSON files (about 3 MB of evidence in all).

## Not verified

- Windows' per-application graphics preference for a browser (does it move Chrome, Edge and Firefox to the NVIDIA card),
  and anything on battery power: both wait for the owner's own clicks.
- The frame rate in the owner's own Chrome profile, before or after: only its adapter readings were taken.
- The words of Chrome's own question before it opens Settings (that it asks, and opens nothing without consent, is
  measured; the dialog is not exposed to the tool that read Edge's).
- Whether the link raises the browser's "Leave site?" question while a recording runs (the page asks before unload then).
- Intel Arc cards, AMD integrated chips and the Arc chips of Core Ultra processors: read from names and from the strings of
  a Dawn build, no such hardware was at hand. What Firefox says after a switch to the NVIDIA card: not measured.
- A real screen reader with the note and the spoken lines; a native speaker's reading of the Spanish and Polish lines.
- NVIDIA Control Panel's "preferred graphics processor" was not read.
- In evidence files written before the measure was corrected (`def-*-cold.json`, `def-wroclaw-nvidia-4m-hot.json`,
  `fly-wroclaw-nvidia-32m.json`) the field `order` used an earlier rule that can read the coarse level of the reveal as
  sharp; their frame, splat and heat numbers are not affected. The load-order numbers above come from `tune-*.json`,
  `turn-*.json` and `def-wroclaw-nvidia-shipped-hot.json`, written with the corrected rule.
