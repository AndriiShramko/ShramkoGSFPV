// v0.7 lane D2 in a real browser (system Chrome; the Vite dev server of apps/fly, lab page
// apps/fly/lab/d2-ui.html: no scan, no flight). Start the server first:
//   cd apps/fly && npx vite --port 5297 --strictPort
//   FLY_BASE=http://localhost:5297/fly/ npx tsx src/accept-v07-d2.ts
// R1 the rates editor in Settings: five types, the type's own field names, the drone's rates shown,
//    an edit stored as CLI integers with the full-stick rate and the chart following; control: text
//    that is no number is refused and the field keeps its value.
// R2 a type switch converts (Actual -> Quick keeps the max rate within 10 deg/s) and says how far the
//    curves differ; Copy as CLI puts `set rates_type = QUICK` on the clipboard; back to the drone's rates.
// S1 Switches from Controls (radio in use): the wizard's arm (CH5) is the default; "Flip to assign"
//    moves arm to CH6 and the flight mode to CH5 by flipping them; Save hands over a profile whose
//    frames arm on CH6 and pick the mode on CH5; control: without a flip nothing is reassigned.
// S2 the live bar follows the channel; the Betaflight aux import applies ARM / ANGLE / HORIZON and
//    lists the rest; a phone-width screen has no sideways scroll.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, writeEvidence } from './evidence';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5297/fly/';
const SHOTS = process.env.SHOTS_DIR ?? null; // screenshots for a person to look at (not evidence)
const out: Record<string, unknown> = {};
let all = true;
const check = (id: string, pass: boolean, detail: Record<string, unknown>): void => {
    out[id] = { pass, ...detail };
    all &&= pass;
    console.log(`${id} ${pass ? 'PASS' : 'FAIL'}`, JSON.stringify(detail).slice(0, 700));
};

const { browser } = await launchChrome({ headless: false });
const errors: string[] = [];
async function open(view: string, viewport = { width: 1280, height: 900 }): Promise<Page> {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${view}: ${e.message}`));
    // a failed request is named by its URL (the console only says "404"); the lab page has no favicon
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${view}: ${r.status()} ${r.url()}`); });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}: ${m.text()}`.slice(0, 300)); });
    await page.goto(`${BASE}lab/d2-ui.html?view=${view}`, { waitUntil: 'load' });
    return page;
}
type Rates = { type: string; roll: { rcRate: number; rate: number; expo: number }; rateLimit: number } | null;
const rates = (p: Page) => p.evaluate(() => (window as unknown as { __d2: { rates(): unknown } }).__d2.rates()) as Promise<Rates>;

// ------------------------------------------------------------------ R1, R2: the rates editor
{
    const p = await open('settings');
    await p.waitForSelector('[data-testid="rates-editor"]');
    const types = await p.$$eval('[data-testid="rates-type"] option', (o) => o.map((x) => (x as HTMLOptionElement).textContent));
    const heads = await p.$$eval('[data-testid="rates-table"] thead th', (o) => o.map((x) => x.textContent));
    const shown = { rc: await p.inputValue('[data-testid="rates-roll-rcRate"]'), max: await p.textContent('[data-testid="rates-max-roll"]') };
    const before = await p.getAttribute('[data-testid="rates-chart"] polyline.re-roll', 'points');
    if (SHOTS) await p.locator('[data-id="tune.rates"]').screenshot({ path: join(SHOTS, 'd2-rates-actual.png') });
    // an edit: roll max rate 800 deg/s
    await p.fill('[data-testid="rates-roll-rate"]', '800');
    await p.press('[data-testid="rates-roll-rate"]', 'Tab');
    const stored = await rates(p);
    const after = { max: await p.textContent('[data-testid="rates-max-roll"]'), points: await p.getAttribute('[data-testid="rates-chart"] polyline.re-roll', 'points') };
    // control: no number
    await p.fill('[data-testid="rates-pitch-rate"]', 'fast');
    await p.press('[data-testid="rates-pitch-rate"]', 'Tab');
    const refused = { value: await p.inputValue('[data-testid="rates-pitch-rate"]'), note: await p.textContent('.re-note'), stored: (await rates(p))?.type };
    check('R1', JSON.stringify(types) === JSON.stringify(['Betaflight', 'Raceflight', 'KISS', 'Actual', 'Quick'])
        && heads.some((x) => x?.startsWith('Center Sensitivity')) && heads.some((x) => x?.startsWith('Max Rate'))
        && shown.rc === '70' && /670/.test(shown.max ?? '') && stored?.type === 'ACTUAL' && stored.roll.rate === 80 && /800/.test(after.max ?? '')
        && !!before && before !== after.points && refused.value === '670' && /not a number/.test(refused.note ?? ''), { types, heads, shown, stored, after: { max: after.max }, refused });

    // R2: Actual -> Quick
    await p.selectOption('[data-testid="rates-type"]', 'QUICK');
    await p.waitForTimeout(300);
    const q = await rates(p);
    const quickHeads = await p.$$eval('[data-testid="rates-table"] thead th', (o) => o.map((x) => x.textContent));
    const note = await p.textContent('.re-note');
    const maxQ = await p.textContent('[data-testid="rates-max-roll"]');
    const qeVisible = await p.isVisible('[data-testid="rates-quick-expo"]');
    if (SHOTS) await p.locator('[data-id="tune.rates"]').screenshot({ path: join(SHOTS, 'd2-rates-quick.png') });
    await p.click('[data-action="rates-copy-cli"]');
    await p.waitForTimeout(200);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    await p.click('[data-action="rates-reset"]');
    await p.waitForTimeout(200);
    const reset = { stored: await rates(p), type: await p.inputValue('[data-testid="rates-type"]') };
    const maxNum = Number((maxQ ?? '').replace(/[^\d]/g, ''));
    check('R2', q?.type === 'QUICK' && Math.abs(maxNum - 800) <= 10 && /Switched from Actual to Quick/.test(note ?? '') && quickHeads.some((x) => x?.startsWith('RC Rate'))
        && qeVisible && /set rates_type = QUICK/.test(clip) && /set roll_srate = /.test(clip) && reset.stored === null && reset.type === 'ACTUAL',
        { quick: q, maxQ, note, clip: clip.split('\n').slice(0, 4), reset });
    // R3 Settings' Input group links to Switches (where the pilot looked for channel functions)
    await p.click('.set-rail-btn[data-group="input"]');
    const line = await p.textContent('[data-testid="switches-settings-line"]');
    await p.click('[data-action="settings-open-switches"]');
    const opened = await p.evaluate(() => (window as unknown as { __d2: { opened: unknown } }).__d2.opened);
    check('R3', /Switches of Lab EdgeTX radio/.test(line ?? '') && JSON.stringify(opened) === JSON.stringify([false, 'switches']), { line, opened });
    await p.context().close();
}

// ------------------------------------------------------------------ S1, S2: Switches
const ch = (o: Record<number, number>): number[] => {
    const a = [0, 0, -1, 0, -1, -1, -1, -1];
    for (const [i, v] of Object.entries(o)) a[Number(i)] = v;
    return a;
};
/** Hold a level for ms, sending reports every 8 ms (125 Hz, as a radio). */
async function hold(p: Page, axes: number[], ms: number): Promise<void> {
    const n = Math.ceil(ms / 8);
    for (let i = 0; i < n; i++) {
        await p.evaluate((a) => (window as unknown as { __d2: { send(a: number[]): void } }).__d2.send(a), axes);
        await p.waitForTimeout(8);
    }
}
const rowChannel = (p: Page, i: number) => p.$eval(`[data-testid="switches-row-${i}"] .swv-ch`, (s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');
{
    const p = await open('switches');
    await p.click('[data-action="radio-switches"]');
    await p.waitForSelector('[data-testid="switches-screen"]');
    await hold(p, ch({}), 120);
    const start = { arm: await rowChannel(p, 0), range: await p.textContent('[data-testid="switches-row-0"] .swv-val') };
    // control: waiting for a flip with no flip assigns nothing
    await p.click('[data-action="switches-flip-0"]');
    await hold(p, ch({}), 700);
    const noFlip = await rowChannel(p, 0);
    // flip CH6 (axis 5) off -> on: the arm row takes CH6 and the high band
    await hold(p, ch({ 5: -1 }), 400);
    await hold(p, ch({ 5: 1 }), 450);
    const armNow = { ch: await rowChannel(p, 0), range: await p.textContent('[data-testid="switches-row-0"] .swv-val'), on: await p.textContent('[data-testid="switches-on-0"]') };
    // the flight mode: flip CH5 (axis 4)
    await p.click('[data-action="switches-flip-mode"]');
    await hold(p, ch({ 4: -1, 5: 1 }), 400);
    await hold(p, ch({ 4: 1, 5: 1 }), 450);
    const modeSel = await p.$eval('[data-fn="mode"] .swv-ch', (s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? '');
    const positions = await p.$$eval('[data-fn="mode"] .swv-pos', (b) => b.map((x) => x.textContent));
    await hold(p, ch({ 4: 0, 5: 1 }), 100);
    const modeNow = await p.textContent('.swv-modenow');
    if (SHOTS) await p.screenshot({ path: join(SHOTS, 'd2-switches.png'), fullPage: true });
    await p.click('[data-action="switches-save"]');
    await p.waitForTimeout(200);
    const saved = await p.evaluate(() => (window as unknown as { __d2: { saved: unknown } }).__d2.saved) as { switches?: { ranges: { fn: string; input: { index: number }; lo: number; hi: number }[] } } | null;
    const map = (axes: number[]) => p.evaluate((a) => (window as unknown as { __d2: { map(a: number[]): number[] } }).__d2.map(a), axes);
    const frames = { ch6High_ch5Low: await map(ch({ 5: 1, 4: -1 })), ch6Low_ch5High: await map(ch({ 5: -1, 4: 1 })), ch6High_ch5Mid: await map(ch({ 5: 1, 4: 0 })) };
    check('S1', start.arm === 'CH5' && noFlip === 'CH5' && armNow.ch === 'CH6' && /1675.2100/.test(armNow.range ?? '') && armNow.on === 'ON'
        && modeSel === 'CH5' && positions.length === 3 && /HORIZON/.test(modeNow ?? '')
        && !!saved?.switches && JSON.stringify(frames) === JSON.stringify({ ch6High_ch5Low: [1, -1], ch6Low_ch5High: [-1, 1], ch6High_ch5Mid: [1, 0] }),
        { start, noFlip, armNow, modeSel, positions, modeNow, ranges: saved?.switches?.ranges, frames });
    await p.context().close();
}
{
    const p = await open('switches');
    await p.click('[data-action="radio-switches"]');
    await p.waitForSelector('[data-testid="switches-screen"]');
    const mark = async (u: number) => {
        await hold(p, ch({ 4: (u - 1500) / 512 }), 40);
        await p.waitForTimeout(60);
        return p.$eval('[data-testid="switches-row-0"] .swv-mark', (e) => (e as HTMLElement).style.left);
    };
    const marks = { low: await mark(988), high: await mark(2012) };
    const sbus = readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'fixtures', 'betafpv', 'pavo20pro-bf450-sbus-20250610.txt'), 'utf8');
    await p.click('.swv-importsec > summary');
    await p.fill('.swv-import', sbus);
    await p.click('[data-action="switches-import"]');
    await p.waitForTimeout(200);
    const imported = { arm: await rowChannel(p, 0), out: await p.textContent('.swv-import-out') };
    const wide = await p.evaluate(() => { const s = document.querySelector('.screen.radio') as HTMLElement; return { scroll: s.scrollWidth, client: s.clientWidth }; });
    await p.context().close();
    const phone = await open('switches', { width: 375, height: 812 });
    await phone.click('[data-action="radio-switches"]');
    await phone.waitForSelector('[data-testid="switches-screen"]');
    const narrow = await phone.evaluate(() => { const s = document.querySelector('.screen.radio') as HTMLElement; return { scroll: s.scrollWidth, client: s.clientWidth, doc: document.documentElement.scrollWidth, inner: innerWidth }; });
    if (SHOTS) await phone.screenshot({ path: join(SHOTS, 'd2-switches-phone.png'), fullPage: true });
    await phone.context().close();
    const pctLow = parseFloat(marks.low), pctHigh = parseFloat(marks.high);
    check('S2', Math.abs(pctLow - 7.33) < 0.5 && Math.abs(pctHigh - 92.67) < 0.5 && imported.arm === 'CH7' && /ARM CH7 1700.2100/.test(imported.out ?? '') && /BEEPER/.test(imported.out ?? '')
        && wide.scroll <= wide.client && narrow.scroll <= narrow.client && narrow.doc <= narrow.inner,
        { marks, imported, wide, narrow });
}

check('E', errors.length === 0, { errors });
await browser.close();
const file = writeEvidence('v07-d2-ui', { base: BASE, pass: all, checks: out });
console.log(all ? 'ALL PASS' : 'FAILED', file);
process.exit(all ? 0 : 1);
