// The harnesses' browser choice (tools/bench/src/chrome.mjs): system Chrome whenever it is installed
// (the owner's Windows PC keeps exactly what it had), Playwright's bundled Chromium only where there
// is none (the cloud container). Fake file systems, no browser is started. Negative control: the old
// rule (channel 'chrome' always) picks a Chrome that is not there.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { browserRoots, bundledChromium, pickBrowser, systemChromePaths } from '../src/chrome.mjs';

const fs = (files: string[], dirs: Record<string, string[]> = {}) => ({
    exists: (p: string) => files.includes(p),
    realpath: (p: string) => p,
    list: (d: string) => {
        if (!(d in dirs)) throw new Error(`ENOENT ${d}`);
        return dirs[d];
    }
});

const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\andri\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' };
const WIN_CHROME = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const CLOUD_ENV = { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' };
const CLOUD_DIRS = { '/opt/pw-browsers': ['.links', 'chromium', 'chromium-1194', 'chromium_headless_shell-1194', 'ffmpeg-1011'] };
const CLOUD_EXE = join('/opt/pw-browsers', 'chromium-1194', 'chrome-linux', 'chrome');

describe('which browser the harnesses launch', () => {
    it('Windows with Chrome installed: system Chrome through the channel, as before', () => {
        const f = fs([WIN_CHROME]);
        const p = pickBrowser({ env: WIN_ENV, platform: 'win32', expected: 'C:\\pw\\chromium-1243\\chrome-win64\\chrome.exe', ...f });
        expect(p).toEqual({ kind: 'system-chrome', launch: { channel: 'chrome' }, executable: WIN_CHROME, why: 'installed' });
    });

    it('Linux with Chrome installed: system Chrome', () => {
        const p = pickBrowser({ env: CLOUD_ENV, platform: 'linux', ...fs(['/opt/google/chrome/chrome', CLOUD_EXE], CLOUD_DIRS) });
        expect(p.kind).toBe('system-chrome');
        expect(p.launch).toEqual({ channel: 'chrome' });
    });

    it('the cloud (no Chrome, an older bundled build): the newest chromium-* under PLAYWRIGHT_BROWSERS_PATH, never the headless shell', () => {
        const p = pickBrowser({ env: CLOUD_ENV, platform: 'linux', expected: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', ...fs([CLOUD_EXE], CLOUD_DIRS) });
        expect(p).toEqual({ kind: 'bundled-chromium', launch: { executablePath: CLOUD_EXE }, executable: CLOUD_EXE, why: 'no system Chrome' });
        const newer = join('/opt/pw-browsers', 'chromium-1300', 'chrome-linux64', 'chrome');
        expect(bundledChromium(CLOUD_ENV, 'linux', (x) => [CLOUD_EXE, newer].includes(x), () => [...CLOUD_DIRS['/opt/pw-browsers'], 'chromium-1300'])).toBe(newer);
    });

    it('a Chrome path that only links to a Playwright build is not system Chrome (the cloud container\'s /opt/google/chrome/chrome)', () => {
        const link = '/opt/google/chrome/chrome';
        const f = fs([link, CLOUD_EXE], CLOUD_DIRS);
        const p = pickBrowser({ env: CLOUD_ENV, platform: 'linux', ...f, realpath: (x) => (x === link ? CLOUD_EXE : x) });
        expect(p.kind).toBe('bundled-chromium');
        expect(p.launch).toEqual({ executablePath: CLOUD_EXE });
        expect(p.why).toMatch(/links to a Playwright build/);
        // control: the same path as a real install is system Chrome
        expect(pickBrowser({ env: CLOUD_ENV, platform: 'linux', ...f, realpath: (x) => x }).kind).toBe('system-chrome');
    });

    it('the build this Playwright expects wins over an older one when it is installed', () => {
        const want = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
        expect(pickBrowser({ env: CLOUD_ENV, platform: 'linux', expected: want, ...fs([CLOUD_EXE, want], CLOUD_DIRS) }).launch).toEqual({ executablePath: want });
    });

    it('BENCH_BROWSER overrides: bundled on a PC with Chrome, a path, chrome', () => {
        expect(pickBrowser({ env: { ...WIN_ENV, PLAYWRIGHT_BROWSERS_PATH: 'C:\\pw', BENCH_BROWSER: 'bundled' }, platform: 'win32', ...fs([WIN_CHROME, join('C:\\pw', 'chromium-1243', 'chrome-win64', 'chrome.exe')], { 'C:\\pw': ['chromium-1243'] }) }).kind).toBe('bundled-chromium');
        expect(pickBrowser({ env: { BENCH_BROWSER: '/usr/bin/chromium' }, platform: 'linux', ...fs(['/usr/bin/chromium']) })).toMatchObject({ kind: 'custom', launch: { executablePath: '/usr/bin/chromium' } });
        expect(() => pickBrowser({ env: { BENCH_BROWSER: '/nope' }, platform: 'linux', ...fs([]) })).toThrow(/no such executable/);
        expect(pickBrowser({ env: { ...CLOUD_ENV, BENCH_BROWSER: 'chrome' }, platform: 'linux', ...fs([CLOUD_EXE], CLOUD_DIRS) }).launch).toEqual({ channel: 'chrome' });
    });

    it('nothing at all: a clear error, never an install', () => {
        expect(() => pickBrowser({ env: CLOUD_ENV, platform: 'linux', ...fs([], CLOUD_DIRS) })).toThrow(/never `playwright install`/);
    });

    it('Playwright\'s own cache when PLAYWRIGHT_BROWSERS_PATH is not set', () => {
        expect(browserRoots(WIN_ENV, 'win32')).toEqual([join(WIN_ENV.LOCALAPPDATA, 'ms-playwright')]);
        expect(browserRoots({ XDG_CACHE_HOME: '/c' }, 'linux')).toEqual([join('/c', 'ms-playwright')]);
        expect(browserRoots(CLOUD_ENV, 'linux')).toEqual(['/opt/pw-browsers']);
        expect(systemChromePaths(WIN_ENV, 'win32')).toContain(WIN_CHROME);
    });

    it('control: the old rule (channel chrome always) picks a Chrome the cloud does not have', () => {
        const f = fs([CLOUD_EXE], CLOUD_DIRS);
        const old = { launch: { channel: 'chrome' } };
        const installed = systemChromePaths(CLOUD_ENV, 'linux').some((p) => f.exists(p));
        expect(installed).toBe(false);
        expect(pickBrowser({ env: CLOUD_ENV, platform: 'linux', ...f }).launch).not.toEqual(old.launch);
    });
});
