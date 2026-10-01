// The browser gate of the visual and latency harnesses (review C18): ../src/screens.ts (the landing
// and README pictures) and, here, latency-walls-check.mjs and landing-overlay-look.mjs. What they
// write means something only with a real GPU. On Playwright's bundled Chromium (the cloud container:
// no Chrome, no GPU) WebGL is SwiftShader and a scan draws at about 1 frame/s, and a system Chrome
// without a usable GPU falls back to software GL too. So these harnesses
//   1. refuse the bundled Chromium unless BENCH_BROWSER=bundled asks for it on purpose;
//   2. read the WebGL renderer the page really got, and refuse a software one the same way;
//   3. write both into their output (`browser`: kind, version, executable, why, userAgent, webgl,
//      softwareGl, counts), so a picture or a number taken without a GPU never passes for a real one.
// The logic checks here (csp-check, wizard-auto-check) run anywhere and record the same `browser`.
// Plain JS like chrome.mjs, so node runs the scripts as they are; types in visual-browser.d.mts.
import { describeBrowser, pickBrowser } from '../src/chrome.mjs';

/** WebGL renderers that rasterise on the CPU: SwiftShader (Chrome's own), Mesa llvmpipe / softpipe, Windows' Basic Render Driver. */
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver/i;

/** No WebGL at all counts as software: nothing the GPU drew. */
export function isSoftwareGl(renderer) {
    return typeof renderer !== 'string' || !renderer.trim() || SOFTWARE_GL.test(renderer);
}

/** A run without a GPU only when it was asked for: BENCH_BROWSER=bundled. */
export function softwareAllowed(env = process.env) {
    return env.BENCH_BROWSER === 'bundled';
}

export class NoGpuError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NoGpuError';
    }
}

/**
 * pickBrowser (chrome.mjs) for a harness; `o` is what pickBrowser takes. visual: its result is a
 * picture or a timing, so the bundled Chromium is refused unless softwareAllowed().
 */
export function pickHarnessBrowser(o = {}, visual = true) {
    const env = o.env ?? process.env;
    const pick = pickBrowser({ ...o, env });
    if (visual && pick.kind === 'bundled-chromium' && !softwareAllowed(env)) {
        throw new NoGpuError(`no system Chrome here (${pick.why}): this visual or latency harness would record the pictures and timings of Playwright's bundled Chromium, software GL, as real ones. Run it on a machine with Chrome and a GPU, or set BENCH_BROWSER=bundled to run anyway (its output then says counts: false).`);
    }
    return pick;
}

/** In the page: the WebGL renderer it really got (unmasked when the browser tells), or null without WebGL. */
export async function webglRenderer(page) {
    return page.evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') ?? c.getContext('webgl');
        if (!gl) return null;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
}

/**
 * The `browser` record of a harness's output, after a look at the GL of `page`. `info`: the browser as
 * describeBrowser() (or browser.ts launchChrome's `which`) names it; or a pick plus its version. For a
 * visual harness, software GL throws NoGpuError unless softwareAllowed(); when allowed, the record says
 * counts: false and a warning is printed that no one can miss.
 */
export async function browserRecord(info, page, o = {}) {
    const visual = o.visual ?? true;
    const env = o.env ?? process.env;
    const base = 'launch' in info ? describeBrowser(info, o.version) : { ...info };
    const webgl = await webglRenderer(page);
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
    const softwareGl = isSoftwareGl(webgl);
    const counts = !softwareGl && base.kind !== 'bundled-chromium';
    const rec = { ...base, userAgent, webgl, softwareGl, counts };
    if (visual && !counts) {
        const why = softwareGl ? `software GL (${webgl ?? 'no WebGL'})` : `${base.kind}, not system Chrome`;
        if (!softwareAllowed(env)) throw new NoGpuError(`the page runs on ${why}: refusing a visual or latency run (BENCH_BROWSER=bundled runs it anyway, marked counts: false)`);
        console.warn(`\n******** NOT A REAL-GPU RUN: ${why}. Pictures and timings from it do not count (browser.counts = false). ********\n`);
    }
    return rec;
}
