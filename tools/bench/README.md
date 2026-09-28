# tools/bench: measurements and acceptance drivers

- `src/accept-*.ts`: acceptance drivers (B1-B23, C, D, v0.3 items); `src/a*-*.ts`: phase A
  measurements; `src/screens.ts`: landing and README screenshots. Each writes
  `evidence/<date>/<name>.json` through `src/evidence.ts`.
- `test/*.test.ts`: vitest (run from the repo root: `npx vitest run`).
- `scripts/`: small live checks (their own README).

## Which browser

`src/chrome.mjs` picks it for every Playwright driver here and for `apps/site/scripts/*.mjs`:

1. **System Chrome** (Playwright channel `chrome`) whenever it is installed. This is the owner's
   Windows PC and every run that counts for a visual or latency check. Nothing changes there.
2. Otherwise **Playwright's bundled Chromium**: the build this Playwright expects when it is
   installed, else the newest `chromium-<revision>` under `PLAYWRIGHT_BROWSERS_PATH` (the cloud
   container: `/opt/pw-browsers/chromium-1194`, Chromium 141). A Chrome path that only links to
   a Playwright build (the container's `/opt/google/chrome/chrome`) counts as bundled.
3. `BENCH_BROWSER=chrome | bundled | <path to an executable>` overrides.

Windows stay headful. Where there is no display, run the driver under `xvfb-run -a`. Every
evidence file records the browser under `context.browser` (`kind`, `version`, `executable`, `why`).
Nothing here installs browsers: never run `playwright install`.

## Logic-only mode: `?render=off` (machines without a GPU)

Without a GPU (the cloud container: WebGPU has no adapter, WebGL is SwiftShader), the scan draws
at about 1 frame/s. The flight model follows the frame loop, so it falls to about 0.06-0.2x real
time, and every flight check times out.

`?render=off` is a test-only switch of the fly app (`apps/fly/src/app/test-modes.ts`,
`APP_URL_PARAMS_NOT_SETTINGS.render`). The scan is never downloaded or drawn, and the engine only
clears the frame. Everything else runs: walls, flight model, input, HUD and UI, crash handling,
the test hook. rAF then runs near 60 Hz and the flight model near 1000 steps/s
(`evidence/2026-09-28/v03-lead2-prefs-render.json`).

- **Never a visual or latency check.** The page shows a "TEST MODE ?render=off" tag,
  `__gsfpv.info.render` is `'off'`, and nothing about its picture, frame rate or latency counts.
- Nothing a visitor can reach links to it or builds it (`test/app-render-off.test.ts`).
- `accept-fly.ts` uses it only when asked, with `ACCEPT_RENDER=off`, and only for the
  flight-logic items B9-B17. The visual items B6 (renderer, frame not empty), B7 and B8 (pixel
  checks, Firefox) always draw the scan. Items run this way say `render: 'off'` in their
  evidence, and their screenshots end in `-render-off`.

## A local run in the cloud container

```bash
cd apps/fly && npx vite --port 5331 --strictPort --host 127.0.0.1 &   # one port per agent
cd tools/bench
xvfb-run -a env LOCAL_FLY=1 SITE=http://127.0.0.1:5331 npx tsx src/accept-v03-lead2.ts
xvfb-run -a env LOCAL_FLY=1 SITE=http://127.0.0.1:5331 ACCEPT_RENDER=off npx tsx src/accept-fly.ts B6 B7 ... B17
kill %1                                                               # stop the dev server
```

What still cannot pass there: see `evidence/2026-09-28/v03-lead2-accept-fly.json` (`limits`).
