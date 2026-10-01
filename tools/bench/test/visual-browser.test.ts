// The browser gate of the visual and latency harnesses (tools/bench/scripts/visual-browser.mjs, review
// C18): without system Chrome or with software GL they refuse to run unless BENCH_BROWSER=bundled says
// so, and then their output says counts: false. Fake file systems and fake pages; the real browser
// check is tools/bench/src/accept-v03-leadfix.ts. Negative control: chrome.mjs's plain pickBrowser, which
// these harnesses called before, hands the bundled Chromium over without a word.
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';
import { NoGpuError, browserRecord, isSoftwareGl, pickHarnessBrowser } from '../scripts/visual-browser.mjs';

const CLOUD_ENV = { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' };
const CLOUD_EXE = join('/opt/pw-browsers', 'chromium-1194', 'chrome-linux', 'chrome');
const cloud = { platform: 'linux', exists: (p: string) => p === CLOUD_EXE, realpath: (p: string) => p, list: () => ['chromium-1194'] };
const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\andri\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' };
const WIN_CHROME = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
const win = { platform: 'win32', exists: (p: string) => p === WIN_CHROME, realpath: (p: string) => p, list: () => [] };

// renderer strings as Chrome reports them (WEBGL_debug_renderer_info)
const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const page = (renderer: string | null) => ({ evaluate: async <T>(f: () => T): Promise<T> => (String(f).includes('navigator') ? 'UA' : renderer) as T });

describe('the visual / latency gate', () => {
    it('knows software GL from a GPU', () => {
        for (const r of [SWIFTSHADER, 'Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver', null, '']) expect(isSoftwareGl(r), String(r)).toBe(true);
        for (const r of [NVIDIA, 'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M2']) expect(isSoftwareGl(r), r).toBe(false);
    });

    it('without system Chrome a visual harness refuses; BENCH_BROWSER=bundled runs it; a logic check runs anyway', () => {
        expect(() => pickHarnessBrowser({ env: CLOUD_ENV, ...cloud })).toThrow(NoGpuError);
        expect(pickHarnessBrowser({ env: { ...CLOUD_ENV, BENCH_BROWSER: 'bundled' }, ...cloud }).kind).toBe('bundled-chromium');
        expect(pickHarnessBrowser({ env: CLOUD_ENV, ...cloud }, false).kind).toBe('bundled-chromium');
        expect(pickHarnessBrowser({ env: WIN_ENV, ...win }).kind).toBe('system-chrome');
        // control: what the harnesses called before hands the bundled Chromium over silently
        expect(pickBrowser({ env: CLOUD_ENV, ...cloud }).kind).toBe('bundled-chromium');
    });

    it('records the browser and its GL; software GL is refused for a visual run, marked when allowed', async () => {
        const sys = pickBrowser({ env: WIN_ENV, ...win });
        const ok = await browserRecord(sys, page(NVIDIA), { version: '141.0', env: WIN_ENV });
        expect(ok).toMatchObject({ kind: 'system-chrome', version: '141.0', executable: WIN_CHROME, userAgent: 'UA', webgl: NVIDIA, softwareGl: false, counts: true });
        // system Chrome that fell back to SwiftShader (no usable GPU): refused
        await expect(browserRecord(sys, page(SWIFTSHADER), { env: WIN_ENV })).rejects.toThrow(NoGpuError);
        await expect(browserRecord(sys, page(null), { env: WIN_ENV })).rejects.toThrow(/no WebGL/);
        // a logic check records it and goes on
        expect(await browserRecord(sys, page(SWIFTSHADER), { visual: false, env: WIN_ENV })).toMatchObject({ softwareGl: true, counts: false });
        // asked for on purpose: it runs, says it does not count, and says so loudly
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const bundled = pickBrowser({ env: { ...CLOUD_ENV, BENCH_BROWSER: 'bundled' }, ...cloud });
        const marked = await browserRecord(bundled, page(SWIFTSHADER), { env: { BENCH_BROWSER: 'bundled' } });
        expect(marked).toMatchObject({ kind: 'bundled-chromium', softwareGl: true, counts: false });
        expect(warn.mock.calls.join(' ')).toMatch(/NOT A REAL-GPU RUN/);
        warn.mockRestore();
    });
});
