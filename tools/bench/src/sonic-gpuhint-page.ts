// The GPU hint in the real page (v0.12 Fly by Sound, lane v12-flight step 11, docs/wip/v12-plan.md 2.12 and 4.2; lane gpu-select,
// docs/wip/gpu-select.md), headless Chrome on this PC's real GPU (BENCH_VISIBLE=1 shows the window). The rule has its truth table in
// packages/render-pc/test/gpu-hint.test.ts and the words, the memory and the plan their tests in tools/bench/test/sonic-gpuhint.test.ts;
// here the page's part, on whatever this computer is:
//   - the real device: the page's own reading names the adapter, and the note came by itself exactly when a hint is due (the owner's
//     PC is NVIDIA: none; a hybrid laptop on its integrated chip: the note, by itself);
//   - asked as an Intel laptop on Windows would be (the hook lays an adapter over what the device says): the note comes with the
//     adapter's name, both ways to switch, the browser's address as text with a copy button that copies it (read back from the
//     clipboard), Windows' graphics page as a link (ms-settings:display-advancedgraphics), "Got it" and "Do not show again";
//   - every visit: not twice in one visit, again in the next one; "Do not show again" holds over a reload of the page;
//   - asked as a browser that draws on the processor: the software note (why, the browser's own switch as text, Device Manager), with
//     no "Do not show again";
//   - controls in the page: the Intel adapter as Arc, on macOS, with no WebGPU: no note;
//   - the line that stays: in the pause menu and on the start screen (the scan picker), naming this computer's real adapter;
//   - in Fly by Sound the engine says the short line aloud (a speech event of the mode and a caption) while the note stays on screen,
//     and the other line for the software case.
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

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
/** An Intel laptop on Windows as Chrome reports it (the model hidden, WebGL names it): the hybrid laptop of docs/wip/gpu-select.md. */
const INTEL = { vendor: 'intel', architecture: 'gen-12lp', device: '', description: '', isFallback: false, maxBufferSize: 2 ** 31 };
const LAPTOP = { gpu: INTEL, glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)', userAgent: WIN_UA, platform: 'Windows', webgpu: true };
/** The same laptop with graphics acceleration off: no WebGPU adapter, WebGL on SwiftShader (as Chrome 140 gave it). */
const SOFTWARE = { gpu: null, webgpu: false, glRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', userAgent: WIN_UA, platform: 'Windows' };

type Reading = { due: boolean; reason: string; kind: string; hint: string | null; name: string; note: string | null; shown: boolean };
type Hook = { check(over?: Record<string, unknown>, o?: { force?: boolean }): Reading; seen(): boolean; memory(): string | null; reset(): void; open(): boolean };
const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 400)}`);
};
const ask = (page: Page, over?: Record<string, unknown>, o?: { force?: boolean }): Promise<Reading> => page.evaluate(([a, b]) => (window as unknown as { __gsfpv: { gpuHint: Hook } }).__gsfpv.gpuHint.check(a as Record<string, unknown> | undefined, b as { force?: boolean } | undefined), [over, o] as const);
const call = <T>(page: Page, f: 'seen' | 'memory' | 'reset' | 'open'): Promise<T> => page.evaluate((fn) => (window as unknown as { __gsfpv: { gpuHint: Record<string, () => unknown> } }).__gsfpv.gpuHint[fn]!(), f) as Promise<T>;
/** The note over the flight as the page shows it: its words, address, link and buttons. */
const noteOf = (page: Page, sel = '[data-testid="gpu-hint"]'): Promise<{ text: string; kind: string | null; address: string | null; link: string | null; buttons: string[] } | null> =>
    page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return {
            text: el.textContent ?? '',
            kind: el.getAttribute('data-note'),
            address: el.querySelector('[data-testid="gpu-hint-address"]')?.textContent ?? null,
            link: el.querySelector('[data-testid="gpu-hint-settings"]')?.getAttribute('href') ?? null,
            buttons: [...el.querySelectorAll('button')].map((b) => b.getAttribute('data-action') ?? '')
        };
    }, sel);
const flying = async (page: Page, url: string): Promise<void> => {
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'ready', undefined, { timeout: 240000 });
    const kb = page.getByRole('button', { name: 'Keyboard' });
    if (await kb.count()) await kb.first().click();
    await sleep(2500); // past the page's own check at 1.5 s
};

await lock();
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LAB });
    const page = L.page;

    // ---- the plain simulator on Winter Garden (the page that is not Fly by Sound): this computer as it is
    await flying(page, `${LAB}/fly/?scene=7a475d38&nowarn=1`);
    const own = await noteOf(page);
    const real = await ask(page);
    const ownHint = real.hint !== null;
    /** this computer draws the page on a faster card (the rule's own words for it) */
    const realFast = real.hint === null && real.kind === 'other' && (real.reason === 'not-intel' || real.reason === 'intel-discrete');
    check(`this computer: the page reads its real adapter ("${real.name}", ${real.kind}, ${real.reason}), and the note came by itself exactly when a hint is due (${ownHint ? 'due here: it came' : 'not due here: none'})`, real.name.length > 0 && ownHint === (own !== null) && (own === null || own.kind === real.note), { real, note: own ? { kind: own.kind, address: own.address } : null });
    await call<void>(page, 'reset');

    // ---- asked as an Intel laptop on Windows would be
    const intel = await ask(page, LAPTOP);
    check('asked as an Intel laptop on Windows would be: the hint is due, the switch note comes, the adapter is named from WebGL', intel.due && intel.shown && intel.note === 'switch' && intel.kind === 'integrated' && intel.name === 'Intel(R) UHD Graphics' && (await call<boolean>(page, 'open')), intel);
    const note = await noteOf(page);
    check(
        'the note names the integrated chip and the other card, and gives both ways: the browser\'s address as text, Windows\' graphics page as a link with the path as words; then "Got it" and "Do not show again"',
        !!note && /integrated graphics chip \(Intel\(R\) UHD Graphics\)/.test(note.text) && /NVIDIA or AMD/.test(note.text) && note.address === 'chrome://flags/#force-high-performance-gpu' && note.link === 'ms-settings:display-advancedgraphics' && /Settings, System, Display, Graphics/.test(note.text) && /High performance/.test(note.text) && note.buttons.join(',') === 'gpu-hint-copy,gpu-hint-ok,gpu-hint-never',
        note
    );
    writeFileSync(join(OUT, 'note.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
    await page.click('[data-action="gpu-hint-copy"]');
    await sleep(300);
    const clip = await page.evaluate(async () => ({ clipboard: await navigator.clipboard.readText(), status: document.querySelector('[data-testid="gpu-hint-status"]')?.textContent ?? '' }));
    check('Copy puts the address on the clipboard (read back) and says so', clip.clipboard === 'chrome://flags/#force-high-performance-gpu' && /Copied/.test(clip.status), clip);
    await page.click('[data-action="gpu-hint-ok"]');
    await sleep(200);
    check('Got it closes the note and remembers nothing', (await page.$('[data-testid="gpu-hint"]')) === null && !(await call<boolean>(page, 'open')) && (await call<string | null>(page, 'memory')) === null, undefined);
    const again = await ask(page, LAPTOP);
    check('not twice in one visit: asked again as the same laptop, the hint is still due but the note does not come by itself', again.due && !again.shown && again.note === 'switch', again);
    const forced = await ask(page, LAPTOP, { force: true });
    check('(the test hook can show it again on purpose)', forced.shown && (await call<boolean>(page, 'open')), forced);
    await page.click('[data-action="gpu-hint-never"]');
    await sleep(200);
    check('"Do not show again" closes the note and is remembered by the browser', (await page.$('[data-testid="gpu-hint"]')) === null && (await call<boolean>(page, 'seen')) && (await page.evaluate(() => localStorage.getItem('gsfpv.hint.gpu'))) === 'off', undefined);

    // ---- the next visit (a real reload of the page): "Do not show again" holds; without it the note comes again
    await flying(page, `${LAB}/fly/?scene=7a475d38&nowarn=1`);
    const afterOff = await ask(page, LAPTOP);
    const memAfterOff = await call<string | null>(page, 'memory');
    // this computer itself decides what the browser remembers: on a faster card "Do not show again" ends, and a fall back is said
    check(
        realFast
            ? 'the next visit after "Do not show again", on this computer\'s faster card: the choice has ended (remembered: fast), and asked as the laptop the note comes as the fall-back note'
            : 'the next visit after "Do not show again": the choice holds (remembered: off), and asked as the laptop the hint is due but stays away',
        realFast ? memAfterOff === 'fast' && afterOff.due && afterOff.shown && afterOff.note === 'back' : memAfterOff === 'off' && afterOff.due && !afterOff.shown,
        { memory: memAfterOff, afterOff }
    );
    // a browser that never said "Do not show again", and holds the mark of v0.12 ("shown once"): told again on a new visit
    await page.evaluate(() => localStorage.setItem('gsfpv.hint.gpu', '1'));
    await flying(page, `${LAB}/fly/?scene=7a475d38&nowarn=1`);
    const nextVisit = await ask(page, LAPTOP);
    check('a new visit of a browser that only holds the v0.12 mark ("shown once"): asked as the laptop, the note comes again (every visit while due)', nextVisit.due && (nextVisit.shown || ownHint) && (await call<boolean>(page, 'open')) && !(await call<boolean>(page, 'seen')), { nextVisit, ownHint });
    await call<void>(page, 'reset');

    // ---- the browser draws on the processor
    const soft = await ask(page, SOFTWARE);
    const softNote = await noteOf(page);
    check(
        'asked as a browser that draws on the processor (no WebGPU adapter, WebGL on SwiftShader): the software note comes: why, the browser\'s own switch as text, Device Manager, and no "Do not show again"',
        !soft.due && soft.hint === 'software' && soft.note === 'software' && soft.shown && !!softNote && softNote.kind === 'software' && /on the processor \(SwiftShader\)/.test(softNote.text) && softNote.address === 'chrome://settings/system' && softNote.link === null && /Device Manager/.test(softNote.text) && softNote.buttons.join(',') === 'gpu-hint-copy,gpu-hint-ok',
        { soft, softNote }
    );
    writeFileSync(join(OUT, 'note-software.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
    await call<void>(page, 'reset');
    // controls: the same Intel adapter where the hint must stay quiet
    const memBefore = await call<string | null>(page, 'memory');
    const arc = await ask(page, { ...LAPTOP, gpu: { ...INTEL, architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770 Graphics' }, glRenderer: '' });
    const mac = await ask(page, { ...LAPTOP, userAgent: MAC_UA, platform: 'macOS' });
    const noGpu = await ask(page, { ...LAPTOP, webgpu: false });
    const nvidia = await ask(page, { ...LAPTOP, gpu: { ...INTEL, vendor: 'nvidia', architecture: 'ampere' }, glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x0000249D) Direct3D11 vs_5_0 ps_5_0, D3D11)' });
    check('controls in the page: the Intel adapter as Arc, on macOS, with no WebGPU, and the laptop after the switch (NVIDIA): no note', !arc.due && arc.reason === 'intel-discrete' && !mac.due && mac.reason === 'not-windows' && !noGpu.due && noGpu.reason === 'no-webgpu' && !nvidia.due && nvidia.reason === 'not-intel' && nvidia.name === 'NVIDIA GeForce RTX 3070 Laptop GPU' && [arc, mac, noGpu, nvidia].every((r) => r.hint === null && !r.shown) && (await page.$('[data-testid="gpu-hint"]')) === null, { arc, mac, noGpu, nvidia });
    const memAfter = await call<string | null>(page, 'memory');
    check('asking "as another computer" (here: as the laptop after its switch, NVIDIA) never writes this browser\'s memory: only the page\'s own reading does', memAfter === memBefore || (realFast && memAfter === 'fast'), { before: memBefore, after: memAfter, realFast });

    // ---- the line that stays: the pause menu
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-testid="gpu-row"]', { timeout: 5000 }).catch(() => undefined);
    const row = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="gpu-row"]');
        return el ? { text: el.querySelector('[data-testid="gpu-line-text"]')?.textContent ?? '', kind: el.querySelector('[data-testid="gpu-line"]')?.getAttribute('data-kind') ?? null, note: el.querySelector('[data-testid="gpu-line"]')?.getAttribute('data-note') ?? null, warn: el.querySelector('[data-testid="gpu-line-warn"]')?.textContent ?? null, how: !!el.querySelector('[data-action="gpu-line-how"]') } : null;
    });
    check(`the pause menu has the line that stays, naming this computer's adapter ("Graphics: ${real.name}"), with the warning and its button exactly when a hint is due here`, !!row && row.text.startsWith('Graphics: ') && row.text.includes(real.name) && row.kind === real.kind && (row.note !== '') === ownHint && row.how === ownHint && (row.warn !== null) === ownHint, row);
    if (row?.how) {
        await page.click('[data-testid="gpu-row"] [data-action="gpu-line-how"]');
        await sleep(200);
        const inMenu = await noteOf(page, '[data-testid="gpu-line-note"]');
        check('in the pause menu the button opens the same note in place (the address, the Windows link)', !!inMenu && inMenu.address === 'chrome://flags/#force-high-performance-gpu' && (real.note === 'software' || inMenu.link === 'ms-settings:display-advancedgraphics'), inMenu);
    }
    writeFileSync(join(OUT, 'pause-row.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
    await page.keyboard.press('KeyP');

    // ---- the line that stays: the start screen (the scan picker)
    await page.goto(`${LAB}/fly/?nowarn=1`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'picker', undefined, { timeout: 60000 });
    await page.waitForSelector('[data-testid="gpu-line"]', { timeout: 15000 }).catch(() => undefined);
    const start = await page.evaluate(() => {
        const el = document.querySelector('.scenes [data-testid="gpu-line"]');
        return el ? { text: el.querySelector('[data-testid="gpu-line-text"]')?.textContent ?? '', kind: el.getAttribute('data-kind'), note: el.getAttribute('data-note'), afterTitle: el.previousElementSibling?.tagName === 'H1', how: !!el.querySelector('[data-action="gpu-line-how"]') } : null;
    });
    check(`the start screen (the scan picker) has the same line under its title, naming this computer's adapter, with the button exactly when a hint is due here`, !!start && start.text.startsWith('Graphics: ') && start.text.includes(real.name) && start.afterTitle && start.how === ownHint, start);
    if (start?.how) {
        await page.click('.scenes [data-action="gpu-line-how"]');
        await sleep(200);
        const inStart = await noteOf(page, '.scenes [data-testid="gpu-line-note"]');
        check('on the start screen the button opens the note in place (the address, the Windows link)', !!inStart && inStart.address !== null && (real.note === 'software' || inStart.link === 'ms-settings:display-advancedgraphics'), inStart);
    }
    writeFileSync(join(OUT, 'start-line.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));

    // ---- in Fly by Sound: the engine says it
    await page.goto(`${LAB}/fly/?sonic=hover-height&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson === 'hover-height'; }, undefined, { timeout: 90000 });
    await sleep(2500);
    check(`in Fly by Sound on this computer: the note came by itself exactly when a hint is due here`, ((await page.$('[data-testid="gpu-hint"]')) !== null) === ownHint, undefined);
    await call<void>(page, 'reset');
    const mode = await ask(page, LAPTOP, { force: true });
    await sleep(900);
    const spoken = (key: string): Promise<{ kind: string; key?: string; text?: string }[]> => page.evaluate((k) => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { events: { kind: string; key?: string; text?: string }[] } } }).__gsfpv.sonic(true).events.filter((e) => e.kind === 'speech' && e.key === k), key);
    const said = await spoken('sonic.say.gpuHint');
    const caps = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption')].map((e) => e.textContent ?? ''));
    check('in Fly by Sound the note comes and the engine says the short line (a speech event of the mode with the Windows way, and its caption)', mode.shown && said.length >= 1 && /Settings, System, Display, Graphics, choose the browser, Options, High performance/.test(said[said.length - 1]!.text ?? '') && caps.some((c) => /Intel graphics chip/.test(c)), { said: said.map((s) => s.text), captions: caps.length });
    writeFileSync(join(OUT, 'note-in-mode.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
    await call<void>(page, 'reset');
    const modeSoft = await ask(page, SOFTWARE, { force: true });
    await sleep(900);
    const saidSoft = await spoken('sonic.say.gpuSoftware');
    check('in Fly by Sound the software note has its own spoken line (the processor draws; graphics acceleration and Device Manager)', modeSoft.shown && modeSoft.note === 'software' && saidSoft.length === 1 && /on the processor, not on a graphics card/.test(saidSoft[0]!.text ?? ''), { said: saidSoft.map((s) => s.text) });

    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource/.test(l));
    check('no console error in the page', errors.length === 0, errors.slice(0, 5));
    const file = writeEvidence(NAME, {
        step: 'lane gpu-select: the GPU hint in the real page (the note on every visit, the line that stays, the software case)',
        page: `${LAB}/fly/ (Vite dev server)`,
        note: 'the real device gets what its own reading says (the owner\'s NVIDIA PC: no hint; a hybrid laptop on its integrated chip: the note by itself); another computer is asked for through the page\'s test hook, which lays signals over what the device says and runs the same code (rule, note, copy, memory, line); headless Chrome runs muted, a spoken line is a speech event and a caption',
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
