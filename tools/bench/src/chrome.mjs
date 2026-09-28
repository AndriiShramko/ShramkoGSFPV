// Which browser the Playwright harnesses drive (tools/bench/README.md). Plain JS so the site's
// scripts (apps/site/scripts/*.mjs, run with node) share it with the TypeScript drivers.
//
// System Chrome (Playwright's channel 'chrome') whenever it is installed: the owner's Windows PC,
// and every run that counts for a visual or latency check. Where it is not (the cloud container:
// no Chrome, no GPU), Playwright's bundled Chromium: the build this Playwright expects when it is
// there, else the newest chromium-* under PLAYWRIGHT_BROWSERS_PATH (the container has
// /opt/pw-browsers/chromium-1194, older than this Playwright's build). BENCH_BROWSER=chrome |
// bundled | <path to an executable> overrides the choice. Never installs anything: no
// `playwright install`. Headful windows need a display: run under `xvfb-run -a` where there is none.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

/** Where Playwright's channel 'chrome' finds Google Chrome (its registry's paths), per platform. */
export function systemChromePaths(env = process.env, platform = process.platform) {
    if (platform === 'win32') {
        return [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean).map((d) => join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    return ['/opt/google/chrome/chrome'];
}

/** A Playwright build (chromium-<revision>/...), wherever it is linked from. */
export function isPlaywrightBuild(path) {
    return /[\\/]chromium(?:_headless_shell)?-\d+[\\/]/.test(path);
}

/** Folders Playwright keeps its browsers in: PLAYWRIGHT_BROWSERS_PATH, else its per-user cache. */
export function browserRoots(env = process.env, platform = process.platform) {
    const set = env.PLAYWRIGHT_BROWSERS_PATH;
    if (set && set !== '0') return [set];
    const home = os.homedir();
    if (platform === 'win32') return [join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright')];
    if (platform === 'darwin') return [join(home, 'Library', 'Caches', 'ms-playwright')];
    return [join(env.XDG_CACHE_HOME ?? join(home, '.cache'), 'ms-playwright')];
}

const EXES = {
    linux: [['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome']],
    win32: [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']],
    darwin: [['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]
};

/** The newest bundled Chromium (chromium-<revision>, not the headless shell) in the roots, or null. */
export function bundledChromium(env = process.env, platform = process.platform, exists = existsSync, list = readdirSync) {
    const found = [];
    for (const root of browserRoots(env, platform)) {
        let names = [];
        try {
            names = list(root);
        } catch {
            continue;
        }
        for (const n of names) {
            const m = /^chromium-(\d+)$/.exec(n);
            if (!m) continue;
            for (const parts of EXES[platform] ?? EXES.linux) {
                const p = join(root, n, ...parts);
                if (exists(p)) {
                    found.push({ revision: Number(m[1]), path: p });
                    break;
                }
            }
        }
    }
    found.sort((a, b) => b.revision - a.revision);
    return found[0]?.path ?? null;
}

/**
 * The browser to launch: `launch` goes into chromium.launch() / launchPersistentContext() as is.
 * `expected`: chromium.executablePath(), the build this Playwright wants (used when it is there).
 * kind 'system-chrome' | 'bundled-chromium' | 'custom' (BENCH_BROWSER=<path>); `executable` is
 * where it is (for the evidence).
 */
export function pickBrowser(o = {}) {
    const env = o.env ?? process.env;
    const platform = o.platform ?? process.platform;
    const exists = o.exists ?? existsSync;
    const force = env.BENCH_BROWSER;
    const real = (p) => {
        try {
            return (o.realpath ?? realpathSync)(p);
        } catch {
            return p;
        }
    };
    // a Chrome path that is only a link to a Playwright Chromium (the cloud container has
    // /opt/google/chrome/chrome -> /opt/pw-browsers/chromium-1194/...) is not system Chrome
    const linked = systemChromePaths(env, platform).find((p) => exists(p) && isPlaywrightBuild(real(p))) ?? null;
    const system = systemChromePaths(env, platform).find((p) => exists(p) && !isPlaywrightBuild(real(p))) ?? null;
    const bundled = () => (o.expected && exists(o.expected) ? o.expected : bundledChromium(env, platform, exists, o.list ?? readdirSync));
    if (force && force !== 'chrome' && force !== 'bundled') {
        if (!exists(force)) throw new Error(`BENCH_BROWSER=${force}: no such executable`);
        return { kind: 'custom', launch: { executablePath: force }, executable: force, why: 'BENCH_BROWSER' };
    }
    if (force === 'chrome' || (force !== 'bundled' && system)) {
        return { kind: 'system-chrome', launch: { channel: 'chrome' }, executable: system, why: force === 'chrome' ? 'BENCH_BROWSER' : 'installed' };
    }
    const b = bundled();
    if (!b) throw new Error('no browser for the harness: install Google Chrome, or point PLAYWRIGHT_BROWSERS_PATH at a folder with a Playwright chromium-<revision> build (never `playwright install` here)');
    const why = force === 'bundled' ? 'BENCH_BROWSER' : linked ? `no system Chrome (${linked} links to a Playwright build)` : 'no system Chrome';
    return { kind: 'bundled-chromium', launch: { executablePath: b }, executable: b, why };
}

/** One line for logs and evidence: which browser, which build, where. */
export function describeBrowser(pick, version) {
    return { kind: pick.kind, version: version ?? null, executable: pick.executable, why: pick.why };
}
