# AGENT_SETUP.md — let your AI agent install, update and remove ShramkoGSFPV

You do not need to install anything to fly: open the website in Chrome or Edge. This file is for running your **own copy** (to change the physics, add a drone preset, or contribute). Give it to your coding agent (Claude Code, Codex, Cursor, …) as-is.

## Prompt to paste into your agent

> Set up ShramkoGSFPV for me by following https://github.com/AndriiShramko/ShramkoGSFPV/blob/main/AGENT_SETUP.md exactly. Install, run the checks, start the simulator locally and open it in Chrome. Do not change any system settings; ask me only if a step needs my password or a physical action.

## Install

Requirements: Git, Node.js 22.12+ (`.nvmrc`), pnpm 11 (`corepack enable`), Google Chrome or Microsoft Edge with WebGPU (Windows or macOS). About 1.5 GB of disk.

```bash
git clone -c core.autocrlf=false https://github.com/AndriiShramko/ShramkoGSFPV.git
cd ShramkoGSFPV
corepack enable
pnpm install --frozen-lockfile
pnpm -r typecheck
pnpm vitest run
```

All tests must pass. If `pnpm install` stops at "Ignored build scripts", the repository's `pnpm-workspace.yaml` already allows the one needed (`esbuild`); run `pnpm install` again.

## Run

```bash
pnpm --filter @gsfpv/fly dev
```

Open `http://localhost:5190/fly/?scene=39e63ce9` in Chrome. Keyboard: `Space` arm, `W`/`S` throttle, arrows roll/pitch, `A`/`D` yaw, `M` angle mode. Any SuperSplat scene works as `?scene=<id or link>`. A radio (EdgeTX in USB joystick mode), a gamepad or touch sticks are set up in the in-app wizard.

The landing page: `pnpm --filter @gsfpv/site dev` (port 3000).

## Update

```bash
git pull --rebase
pnpm install --frozen-lockfile
pnpm -r typecheck && pnpm vitest run
```

Read `CHANGELOG.md` / the release notes of the new tag. If `SIM_CORE_VERSION` changed, replays recorded with the old version are refused (by design).

## Share your work

Fork, branch, commit with tests, open a pull request against `main`. Physics changes need fresh evidence (`AGENTS.md` explains which harness). New drone presets are very welcome — every number needs its source.

## Remove

Delete the cloned folder. The simulator stores calibration, history and favourites only in your browser (site data for the origin you used); clear them in the browser's site settings. Nothing is stored on a server.

## Safety notes

- The simulator loads scene data from SuperSplat's public CDN; if that CDN changes, loading can stop (see `docs/warnings.md`).
- Flashing and motion: crashes and fast flight can cause motion sickness; the app respects `prefers-reduced-motion`.
- WebHID asks for permission per device; the site only reads the joystick report of the device you pick.
