// v0.12 Fly by Sound, lane v12-flight step 11 (docs/wip/v12-plan.md 2.12 and 4.2): the GPU hint in the real page, headless Chrome on this PC's
// real GPU. The rule has its truth table in packages/render-pc/test/gpu-hint.test.ts and the words their tests in tools/bench/test/sonic-gpuhint.test.ts; here
// the page's part: the real adapter of this PC is read and the rule applied to it (this PC is the owner's: NVIDIA, so no hint, the control of the whole
// feature, also after the page has settled); then the page is asked as an Intel laptop on Windows would be (the hook lays an Intel adapter over what the device
// says), and the note must come: both ways to switch, the browser's address as text, a copy button that copies it (read back from the clipboard), "Got it"
// that closes it, and the browser remembering it (asked again: not shown again). Controls in the page: the same Intel adapter on macOS, as Arc, as a software
// adapter, with no WebGPU: no note. In Fly by Sound the engine says the short line aloud (a speech event of the mode and a caption) while the note stays on screen.
// Evidence: evidence/<date>/sonic-gpuhint-page.json and screenshots next to it. Holds the GPU lock.
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-gpuhint-page.ts
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const NAME = 'sonic-gpuhint-page';
const OUT = join(REPO, 'evidence', today(), NAME);
mkdirSync(OUT, { recursive: true });

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};
const INIT = `(() => { window.__name = (f) => f; try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {} })();`;

const INTEL = { vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics 630', isFallback: false, maxBufferSize: 2 ** 31 };
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

type Reading = { due: boolean; reason: string; shown: boolean };
type Hook = { check(over?: Record<string, unknown>, o?: { force?: boolean }): Reading; seen(): boolean; reset(): void; open(): boolean };
const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};
const ask = (page: Page, over?: Record<string, unknown>, o?: { force?: boolean }): Promise<Reading> => page.evaluate(([a, b]) => (window as unknown as { __gsfpv: { gpuHint: Hook } }).__gsfpv.gpuHint.check(a as Record<string, unknown> | undefined, b as { force?: boolean } | undefined), [over, o] as const);
const call = <T>(page: Page, f: 'seen' | 'reset' | 'open'): Promise<T> => page.evaluate((fn) => (window as unknown as { __gsfpv: { gpuHint: Record<string, () => unknown> } }).__gsfpv.gpuHint[fn]!(), f) as Promise<T>;

await lock();
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LAB });
    const page = L.page;

    // ---- the plain simulator on Winter Garden (the page that is not Fly by Sound)
    await page.goto(`${LAB}/fly/?scene=7a475d38&nowarn=1`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'ready', undefined, { timeout: 240000 });
    const kb = page.getByRole('button', { name: 'Keyboard' });
    if (await kb.count()) await kb.first().click();
    await sleep(2500); // past the page's own check at 1.5 s
    const real = await page.evaluate(async () => {
        const nav = navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, unknown>; isFallbackAdapter?: boolean } | null> }; userAgentData?: { platform?: string } };
        const a = await nav.gpu?.requestAdapter();
        return { ua: navigator.userAgent, platform: nav.userAgentData?.platform ?? null, vendor: a?.info?.vendor ?? null, architecture: a?.info?.architecture ?? null, description: a?.info?.description ?? null, fallback: a?.isFallbackAdapter ?? null };
    });
    check(`this PC: the page's real adapter is read (${real.vendor} ${real.architecture}) on ${real.platform}: the rule says no hint (not Intel), and the page showed none by itself`, (await page.$('[data-testid="gpu-hint"]')) === null && (await call<boolean>(page, 'open')) === false && (await ask(page)).reason !== 'due', { real, reading: await ask(page) });

    const intel = await ask(page, { gpu: INTEL });
    check('asked as an Intel laptop on Windows would be: the hint is due and the note comes', intel.due && intel.shown && (await call<boolean>(page, 'open')), intel);
    const note = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="gpu-hint"]');
        return el ? { text: el.textContent ?? '', address: document.querySelector('[data-testid="gpu-hint-address"]')?.textContent ?? null, buttons: [...el.querySelectorAll('button')].map((b) => b.textContent) } : null;
    });
    check('the note says the Intel chip is drawing, names the other card, and gives both ways: the browser\'s address as text and Windows\' path to High performance', !!note && /Intel graphics chip/.test(note.text) && /NVIDIA or AMD/.test(note.text) && note.address === 'chrome://flags/#force-high-performance-gpu' && /Settings, System, Display, Graphics, choose this browser, Options, High performance/.test(note.text), note);
    writeFileSync(join(OUT, 'note.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
    await page.click('[data-action="gpu-hint-copy"]');
    await sleep(300);
    const clip = await page.evaluate(async () => ({ clipboard: await navigator.clipboard.readText(), status: document.querySelector('[data-testid="gpu-hint-status"]')?.textContent ?? '' }));
    check('Copy puts the address on the clipboard (read back) and says so', clip.clipboard === 'chrome://flags/#force-high-performance-gpu' && /Copied/.test(clip.status), clip);
    await page.click('[data-action="gpu-hint-ok"]');
    await sleep(200);
    check('Got it closes the note', (await page.$('[data-testid="gpu-hint"]')) === null && !(await call<boolean>(page, 'open')), undefined);
    const again = await ask(page, { gpu: INTEL });
    check('the browser remembers it: asked again as the same laptop, the hint is still due but not shown again; the note is in the browser\'s storage', again.due && !again.shown && (await call<boolean>(page, 'seen')) && (await page.evaluate(() => localStorage.getItem('gsfpv.hint.gpu'))) === '1', again);
    const forced = await ask(page, { gpu: INTEL }, { force: true });
    check('(the test hook can show it again on purpose)', forced.shown && (await call<boolean>(page, 'open')), forced);
    await call<void>(page, 'reset');
    // controls: the same Intel adapter where the hint must stay quiet
    const arc = await ask(page, { gpu: { ...INTEL, architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770 Graphics' } });
    const mac = await ask(page, { gpu: INTEL, userAgent: MAC_UA, platform: 'macOS' });
    const soft = await ask(page, { gpu: { ...INTEL, isFallback: true } });
    const noGpu = await ask(page, { gpu: INTEL, webgpu: false });
    check('controls in the page: the Intel adapter as Arc, on macOS, as a software adapter, with no WebGPU: no note', !arc.due && arc.reason === 'intel-discrete' && !mac.due && mac.reason === 'not-windows' && !soft.due && soft.reason === 'fallback-adapter' && !noGpu.due && noGpu.reason === 'no-webgpu' && (await page.$('[data-testid="gpu-hint"]')) === null, { arc, mac, soft, noGpu });

    // ---- in Fly by Sound: the engine says it
    await page.goto(`${LAB}/fly/?sonic=hover-height&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson === 'hover-height'; }, undefined, { timeout: 90000 });
    await sleep(2500);
    check('in Fly by Sound on this PC: no note and nothing said by itself (NVIDIA)', (await page.$('[data-testid="gpu-hint"]')) === null, undefined);
    await call<void>(page, 'reset');
    const mode = await ask(page, { gpu: INTEL }, { force: true });
    await sleep(900);
    const said = await page.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { events: { kind: string; key?: string; text?: string }[] } } }).__gsfpv.sonic(true).events.filter((e) => e.kind === 'speech' && e.key === 'sonic.say.gpuHint'));
    const caps = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption')].map((e) => e.textContent ?? ''));
    check('in Fly by Sound the note comes and the engine says the short line (a speech event of the mode with the Windows way, and its caption)', mode.shown && said.length === 1 && /Settings, System, Display, Graphics, choose the browser, Options, High performance/.test(said[0]!.text ?? '') && caps.some((c) => /Intel graphics chip/.test(c)), { said: said.map((s) => s.text), captions: caps.length });
    writeFileSync(join(OUT, 'note-in-mode.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));

    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource/.test(l));
    check('no console error in the page', errors.length === 0, errors.slice(0, 5));
    const file = writeEvidence(NAME, {
        step: 'v12-flight 11: the GPU hint in the real page',
        page: `${LAB}/fly/ (Vite dev server)`,
        note: 'this PC is the owner\'s (NVIDIA): the real device never gets the hint; an Intel laptop is asked for through the page\'s test hook, which lays an adapter over what the device says and runs the same code (rule, note, copy, memory, line); headless Chrome runs muted, the line is a speech event and a caption',
        adapter: real,
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
    await L.browser.close();
} finally {
    unlock();
}
