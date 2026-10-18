// The Controls screen and F3 say how a controller's reports arrive (v0.9 lane E, the owner's item 12: a
// Radiomaster GX12 over Bluetooth feels about 300 ms late), on a release build in this machine's Chrome.
// No hardware: a fake gamepad in the page (an init script) with the DJI controller's ids, so it is
// recognised and opens its check screen by itself (no wizard), sends reports on a schedule of its own:
//   usb      a report every ~1 ms (a cable at 1000 Hz)
//   usb100   every 10 ms with 0.2 ms of timer noise (a wired joystick at 100 Hz: its mean sits on the old 10 ms line)
//   ble90    every ~11 ms with +-3 ms of jitter (Bluetooth LE at ~90 Hz: a link that delivers on time)
//   ble50    every ~20 ms with +-6 ms of jitter
//   ble30    every ~33 ms with +-8 ms of jitter
//   bunches  3-6 reports within 1.5 ms every 50-100 ms (Bluetooth LE in bunches)
// Gamepad.timestamp is the report's time (as Chromium's raw input stamps it) and the values move with
// every report. The page is the logic-only test mode (?render=off): no GPU, nothing here is about the
// picture. Per run, checked: the check screen's line ("reports every .. ms, jitter .., longest gap ..")
// and its note about a cable; after Fly and F3, F3's line and note. The cables (1000 and 100 Hz) and the
// healthy Bluetooth link (11 ms) must get NO note on either (the negative controls: the page cannot tell
// a cable from Bluetooth, so the note is about the cadence); the slow (20, 33 ms) and the bunched
// timelines must get one that names the measured numbers; the note is in the page's language (compared
// with the locale file, read here, not typed here).
// Usage: node link-line-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <outDir> [--only a,b]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v.split(','); };
const only = flag('--only');
const base = args[0] ?? 'http://localhost:5390/en';
const outDir = args[1] ?? ROOT + '/.cache/link-line-probe';
mkdirSync(outDir, { recursive: true });
const runs = (name) => !only || only.includes(name);
const lang = base.match(/\/(en|es|pl|ru)\/?$/)?.[1] ?? 'en';
const strings = JSON.parse(readFileSync(`${ROOT}/packages/i18n/locales/fly/link/${lang}.json`, 'utf8'));
/** The words of a string before its first placeholder: what a page in this language must start the note with. */
const lead = (key) => strings[key].split('{')[0];
const DJI_ID = 'HID Interface (Vendor: 2ca3 Product: 1021)';

/** In the page: the fake DJI pad whose reports follow `cfg.kind`'s schedule. */
function installPad(cfg) {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const times = [];
    const t0 = performance.now();
    let t = t0 + 50;
    const end = t0 + 120000;
    if (cfg.kind === 'bunches') {
        for (; t < end; t += 50 + rnd() * 50) { const k = 3 + Math.floor(rnd() * 4); for (let i = 0; i < k; i++) times.push(t + (i / k) * 1.5); }
    } else {
        const gap = { usb: 1, usb100: 10, ble90: 11.1, ble50: 20, ble30: 33.3 }[cfg.kind];
        const jit = { usb: 0.3, usb100: 0.4, ble90: 6, ble50: 12, ble30: 16 }[cfg.kind];
        for (; t < end; t += gap + (rnd() - 0.5) * jit) times.push(t);
    }
    const s = { present: sessionStorage.getItem('__padShown') === '1' };
    const last = (now) => { let lo = 0, hi = times.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= now) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
    const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return i === 4 || i === 6; }, get value() { return i === 4 || i === 6 ? 1 : 0; }, touched: false }));
    const pad = {
        id: cfg.id, index: 0, connected: true, mapping: '', vibrationActuator: null,
        // the throttle (axis 2) rests at the bottom with a hair of movement so every report differs
        get axes() { const i = last(performance.now()); return [Math.sin(i * 0.37) * 0.01, 0, -1 + (i % 7) * 0.001, 0, 0]; },
        buttons,
        get timestamp() { const i = last(performance.now()); return i < 0 ? t0 : times[i]; }
    };
    window.__pad = { show() { s.present = true; sessionStorage.setItem('__padShown', '1'); } };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? pad : null, null, null, null], configurable: true });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = { what: 'the Controls screen and F3 say how the reports arrive (link-line-probe.mjs)', base, lang, runs: {} };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
let failed = 0;
const check = (name, pass, detail) => { if (!pass) failed++; console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); return { name, pass, ...detail }; };

for (const kind of ['usb', 'usb100', 'ble90', 'ble50', 'ble30', 'bunches']) {
    if (!runs(kind)) continue;
    console.log(kind);
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installPad, { kind, id: DJI_ID });
    await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1&render=off`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice'), null, { timeout: 120000 });
    await page.evaluate(() => window.__pad.show());
    await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(4500); // the meter needs ~20 gaps; the line is rewritten twice a second
    const screen = await page.evaluate(() => {
        const note = document.querySelector('[data-testid=link-note]');
        return {
            check: window.__gsfpv?.radio?.wizard?.state?.id ?? null,
            rate: document.querySelector('.wz-rate')?.textContent ?? null,
            line: document.querySelector('[data-testid=link-line]')?.textContent ?? null,
            noteShown: !!note && !note.hidden && note.offsetParent !== null,
            note: note?.textContent ?? ''
        };
    });
    await page.screenshot({ path: `${outDir}/${kind}-check.png` });
    await page.locator('[data-testid=link-line]').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `${outDir}/${kind}-check-foot.png` });
    const cable = kind === 'usb' || kind === 'usb100' || kind === 'ble90'; // no note: the two cables and a link that delivers on time
    const rows = [];
    rows.push(check('check screen opened', screen.check === 'check', { id: screen.check }));
    rows.push(check('the line of numbers is shown', !!screen.line && /\d/.test(screen.line) && screen.line.startsWith(lead('link.line')), { line: screen.line }));
    if (cable) rows.push(check(`control: ${kind} gets no note on the check screen`, !screen.noteShown, { noteShown: screen.noteShown }));
    else {
        const lead2 = lead(kind === 'bunches' ? 'link.note.bursty' : 'link.note.slow');
        rows.push(check('the note is shown, in the page language, with measured numbers', screen.noteShown && screen.note.startsWith(lead2) && !/\{/.test(screen.note) && /\d/.test(screen.note.slice(lead2.length)), { note: screen.note }));
    }
    const want = { usb100: 10, ble90: 11, ble50: 20, ble30: 33 }[kind];
    if (want) {
        const m = screen.line?.match(/(\d+(?:\.\d+)?)/);
        rows.push(check(`the interval is the timeline's (~${want} ms)`, !!m && Math.abs(Number(m[1]) - want) < want * 0.25, { first: m?.[1] }));
    }
    // Fly, then F3
    await page.locator('[data-action=wizard-done]').click();
    await page.waitForFunction(() => window.__gsfpv?.controls?.source === 'gamepad' && !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => undefined);
    await page.keyboard.press('F3');
    await page.waitForTimeout(3500);
    const f3 = await page.evaluate(() => {
        const line = document.querySelector('[data-testid=input-line]');
        const hint = document.querySelector('[data-testid=link-hint]');
        return {
            source: window.__gsfpv?.controls?.source ?? null,
            lineShown: !!line && !line.hidden && line.offsetParent !== null,
            line: line?.textContent ?? '',
            hintShown: !!hint && !hint.hidden && hint.offsetParent !== null,
            hint: hint?.textContent ?? ''
        };
    });
    await page.screenshot({ path: `${outDir}/${kind}-f3.png` });
    rows.push(check('flying with the gamepad', f3.source === 'gamepad', { source: f3.source }));
    rows.push(check('F3 shows the numbers', f3.lineShown && /\d/.test(f3.line) && f3.line.startsWith(lead('link.f3')), { line: f3.line }));
    if (cable) rows.push(check(`control: ${kind} gets no note on F3`, !f3.hintShown, { hintShown: f3.hintShown }));
    else rows.push(check('F3 shows the note', f3.hintShown && f3.hint.startsWith(lead(kind === 'bunches' ? 'link.note.bursty' : 'link.note.slow')), { hint: f3.hint }));
    rows.push(check('no page errors', errors.length === 0, { errors }));
    out.runs[kind] = { screen, f3, rows };
    await ctx.close();
}
await browser.close();
out.failed = failed;
writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
