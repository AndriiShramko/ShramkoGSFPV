// Lane center-throttle page probe (docs/wip/center-throttle.md, stage 2): a fake DJI FPV Remote Controller 3 on
// navigator.hid (its descriptor and 13-byte reports as in hid-source-probe.mjs; start/stop = button bit 2, a toggle; the
// mode switch held on bit 6 = N = angle) flies the page.
//   dji-centred  the throttle rests in the centre (+11 of 660, the measured DJI offset): the check screen says centred,
//                Fly, the HUD chip says "Stick in the centre", then the left stick pushed up for 2.5 s gets the drone into
//                the air (altitude +1 m or more, armed) with no stick lowered and no click on an arming control.
//   dji-flip     the same controller, then J flips to from zero on the ground: the chip says "From zero"; after 3.5 s at
//                rest in the centre the arm card offers the centred style; the stick pushed up does not start the motors;
//                lowered to the bottom with start/stop pressed, it arms as today, and up it climbs.
//   dji-bottom   the throttle held at the bottom from the connection on (screws tightened): from zero by the rest seen.
// Pass needs every check of every run. Against the live site (no lane build) dji-centred must fail at "gets into the air".
// The +1 m, 2.5 s and 3.5 s are estimates of "in the air" and "after the offer's 3 s", not measured on a person.
// Usage: node centre-throttle-probe.mjs <base with the locale, e.g. http://localhost:5391/en> <out.json> [run,run...|all] [scene]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5391/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/centre-throttle-probe.json';
const only = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
// the scene: open sky above the spawn (39e63ce9, the radio probes' scene, has something about 0.3 m over its spawn: a raw
// half-power climb stopped there too, measured 2026-11-12)
const scene = process.argv[5] ?? '887f27aa';
mkdirSync(dirname(outFile), { recursive: true });

const P1 = 0x00010000, P9 = 0x00090000;
const djiButtons = { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 24, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 };
const DJI = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34].map((u) => P1 | u), reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 }, djiButtons] }] }];
const REST = 11 / 660; // the DJI's measured rest offset (known-devices.ts)

/** In the page, before the app: navigator.hid with one fake DJI whose sticks the probe sets (window.__hands). */
function installFakeDji(cfg) {
    const hands = { A: 0, E: 0, T: cfg.T, R: 0, press: false };
    window.__hands = hands;
    const order = ['A', 'E', 'T', 'R']; // the DJI's X Y Z Rx: roll, pitch, throttle, yaw (TAER is the wizard's; the known table maps these)
    const report = () => {
        const b = new Uint8Array(13);
        const dv = new DataView(b.buffer);
        for (let i = 0; i < 4; i++) dv.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, hands[order[i]])) * 660), true);
        dv.setInt16(8, 0, true);
        b[10] = 0x50 | (hands.press ? 0x04 : 0); // bits 4 and 6 held (mode switch N), bit 2 start/stop
        return b;
    };
    class FakeHidDevice extends EventTarget {
        constructor() { super(); this.vendorId = 0x2ca3; this.productId = 0x1021; this.productName = 'HID Interface'; this.collections = cfg.collections; this.opened = false; this.timer = 0; }
        async open() {
            this.opened = true;
            this.timer = setInterval(() => {
                const e = new Event('inputreport');
                Object.defineProperties(e, { device: { value: this }, reportId: { value: 0 }, data: { value: new DataView(report().buffer) } });
                this.dispatchEvent(e);
            }, 6);
        }
        async close() { this.opened = false; clearInterval(this.timer); }
    }
    const dev = new FakeHidDevice();
    const hid = { requestDevice: async () => [dev], getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
}

const RUNS = [
    { name: 'dji-centred', T: REST },
    { name: 'dji-flip', T: REST },
    { name: 'dji-bottom', T: -1 }
];

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'centre-throttle-probe.mjs: a fake DJI FPV Remote Controller 3 on navigator.hid', base, scene, at: new Date().toISOString() };
{
    const c = await browser.newContext();
    out.browser = await browserRecord(pick, await c.newPage(), { visual: false, version: browser.version() });
    await c.close();
}
let allPass = true;
for (const run of RUNS.filter((r) => !only || only.includes(r.name))) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installFakeDji, { collections: DJI, T: run.T });
    const checks = {};
    const note = {};
    const t0 = Date.now();
    const hand = (o) => page.evaluate((x) => Object.assign(window.__hands, x), o);
    const state = () => page.evaluate(() => {
        const g = window.__gsfpv;
        const hd = g?.session?.hud?.();
        const chip = document.querySelector('[data-testid=mode-chip-throttle]');
        const offer = document.querySelector('[data-testid=arm-offer]');
        const card = document.querySelector('.arm-card');
        return {
            armed: !!hd?.armed, crashed: !!hd?.crashed, alt: hd?.altitude ?? null,
            chip: chip && !chip.hidden ? chip.textContent : null,
            offer: !!offer && !offer.hidden && !!card && !card.classList.contains('hidden'),
            armCard: !!card && !card.classList.contains('hidden'),
            cardText: card && !card.classList.contains('hidden') ? (card.querySelector('.reason')?.textContent ?? '') : '',
            steps: !!card && !card.querySelector('ol')?.hidden,
            centre: g?.throttle?.().centre ?? null,
            throttle: g?.throttle ? (({ now, pending, resolved, seen, setting }) => ({ now, pending, resolved, seen, setting }))(g.throttle()) : null
        };
    });
    try {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice button'), null, { timeout: 120000 });
        await page.locator('.screen.radio .choice button').first().click();
        await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 30000 });
        await page.waitForTimeout(1200); // the check screen watches where the throttle rests (0.5 s still)
        note.checkRow = await page.evaluate(() => { const r = document.querySelector('[data-testid=throttle-style-row]'); return r ? { style: r.getAttribute('data-style'), why: r.getAttribute('data-why'), title: r.querySelector('[data-testid=throttle-style-title]')?.textContent ?? '' } : null; });
        await page.locator('[data-action=wizard-done]').click();
        await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
        await page.waitForTimeout(1500); // the connection's rest watch
        const s0 = await state();
        note.start = s0;
        if (run.name === 'dji-centred') {
            checks.checkRowCentred = note.checkRow?.style === 'centred';
            checks.chipCentred = s0.chip === 'Stick in the centre';
            // the card has no arming steps, its line says the motors start with a stick
            checks.noArmingStepsInCentre = !s0.steps && /no arming needed/.test(s0.cardText);
            await hand({ T: 0.6 });
            note.climb = [];
            for (let i = 0; i < 10; i++) { await page.waitForTimeout(250); const s = await state(); note.climb.push({ alt: s.alt, armed: s.armed, centre: s.centre }); }
            const s1 = await state();
            note.up = s1;
            checks.intoTheAir = s1.armed && !s1.crashed && s0.alt !== null && s1.alt !== null && s1.alt - s0.alt >= 1.0;
            await hand({ T: REST });
            await page.waitForTimeout(1500);
            note.letGo = await state();
        } else if (run.name === 'dji-flip') {
            await page.keyboard.press('KeyJ');
            await page.waitForTimeout(300);
            const s1 = await state();
            note.afterJ = s1;
            checks.chipFromZero = s1.chip === 'From zero';
            await page.waitForTimeout(3500);
            const s2 = await state();
            note.rested = s2;
            checks.offerAfterRest = s2.offer;
            // evidence picture of the arm card while it offers the centred style (before the stick goes up)
            await page.screenshot({ path: outFile.replace(/\.json$/, '-dji-flip-offer.png') }).catch(() => undefined);
            await hand({ T: 0.6 });
            await page.waitForTimeout(2000);
            const s3 = await state();
            note.upNoArm = s3;
            checks.upDoesNotStart = !s3.armed && (s3.alt ?? 0) - (s0.alt ?? 0) < 0.3;
            await hand({ T: -1 });
            await page.waitForTimeout(800);
            await hand({ press: true });
            await page.waitForTimeout(150);
            await hand({ press: false });
            await page.waitForTimeout(500);
            const s4 = await state();
            note.armedFpv = s4;
            checks.armsAtZero = s4.armed;
            // half power as today (the stick at the middle is half power from zero): the highest point within 2 s; a
            // raw climb may hit the scan later, the point is that the motors lift it (0.5 m: an estimate of "lifts")
            await hand({ T: 0 });
            let top = -Infinity;
            note.climbFpv = [];
            for (let i = 0; i < 10; i++) { await page.waitForTimeout(200); const s = await state(); note.climbFpv.push({ alt: s.alt, armed: s.armed, crashed: s.crashed }); top = Math.max(top, (s.alt ?? -Infinity) - (s0.alt ?? 0)); }
            checks.liftsFpv = top >= 0.5;
        } else {
            checks.chipFromZero = s0.chip === 'From zero';
            checks.seenBottom = s0.throttle?.seen === 'bottom' && s0.throttle?.now === 'zero';
            checks.armCardAtBottom = s0.armCard;
        }
    } catch (e) {
        errors.push(`probe: ${String(e.message).slice(0, 200)}`);
    }
    await page.screenshot({ path: outFile.replace(/\.json$/, `-${run.name}.png`) }).catch(() => undefined);
    const pass = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean) && errors.length === 0;
    allPass &&= pass;
    out[run.name] = { pass, seconds: Math.round((Date.now() - t0) / 1000), checks, note, errors };
    await ctx.close();
}
await browser.close();
out.pass = allPass;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass: allPass, ...Object.fromEntries(RUNS.filter((r) => out[r.name]).map((r) => [r.name, { pass: out[r.name].pass, checks: out[r.name].checks, errors: out[r.name].errors.length }])) }));
