// A recognised controller flies out of the box (v0.8 lane B, the owner's item 4: "plug the DJI
// controller in and everything works, nothing to reassign"), on a release build, with a fake DJI FPV
// Remote Controller 3 on the Gamepad API (an init script: its id string, 5 axes, 24 buttons, the
// state set by this script). Steps, each checked:
//   open    the stick moved on the device choice makes the browser show the pad; the Controls screen
//           opens its check screen by itself (no click), with the known note, every control (11) live
//           and labelled, the profile known = dji-virtual-joystick, no wizard step run
//   live    a stick moved shows on its row; the flight-mode switch's position lights low / mid / high
//   fly     Fly; the flight takes the pad (controls.source gamepad, the known profile)
//   modes   the flight-mode switch N / S / M (bit 6, none, bit 7) gives Angle / Horizon / Acro
//   arm     throttle down, a press of start/stop arms, the next disarms; with the throttle up it does not
//   resume  a reload flies on with the saved setup, no Controls screen
//   offer   a setup saved by the wizard for the same pad: its check offers the known setup, one press uses it
// Negative control `not-dji`: a pad with the DJI's ids but 4 axes (not its shape) is not recognised:
// the device choice stays (no check screen within 4 s).
// Usage: node known-controller-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <outDir>
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5390/en';
const outDir = process.argv[3] ?? ROOT + '/.cache/known-controller-probe';
mkdirSync(outDir, { recursive: true });

/** In the page: a fake DJI pad on the Gamepad API whose state the probe sets (window.__pad). */
function installPad(cfg) {
    // shown once a stick moved; a reload keeps it shown (the browser remembers a pad it has seen)
    const s = { axes: [0, 0, -1, 0, 0], buttons: 0x50, ts: performance.now(), present: sessionStorage.getItem('__padShown') === '1' };
    window.__pad = {
        set(axes, buttons) { if (axes) s.axes = axes.slice(); if (buttons !== undefined && buttons !== null) s.buttons = buttons; s.ts = performance.now(); s.present = true; sessionStorage.setItem('__padShown', '1'); }
    };
    const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return ((s.buttons >> i) & 1) === 1; }, get value() { return (s.buttons >> i) & 1; }, touched: false }));
    const pad = {
        id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', vibrationActuator: null,
        get axes() { return s.axes.slice(0, cfg.axes); },
        buttons,
        get timestamp() { return s.ts; }
    };
    // a browser shows a pad only after an input: before the first set() / show() there is none
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? pad : null, null, null, null], configurable: true });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = { what: 'a recognised DJI FPV Remote Controller 3 flies out of the box on the Gamepad API (known-controller-probe.mjs)', base, steps: {} };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
const ok = (name, pass, detail) => { out.steps[name] = { pass, ...detail }; console.log(name, pass ? 'PASS' : 'FAIL', JSON.stringify(detail)); };
const url = `${base}/fly/?scene=39e63ce9&nowarn=1`;

// ---- the DJI
{
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installPad, { axes: 5 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice'), null, { timeout: 120000 });
    await page.screenshot({ path: `${outDir}/01-device-choice.png` });
    // the pilot moves a stick: the browser shows the pad
    await page.evaluate(() => window.__pad.set([0, 0, 0.3, 0, 0], 0x50));
    await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 8000 }).catch(() => undefined);
    const open = await page.evaluate(() => {
        const w = window.__gsfpv?.radio?.wizard;
        return {
            id: w?.state?.id ?? null, known: w?.state?.profile?.known ?? null, name: w?.state?.profile?.deviceName ?? null,
            note: document.querySelector('[data-testid=known-note]')?.textContent?.slice(0, 120) ?? null,
            controls: [...document.querySelectorAll('[data-testid=known-controls] .kp-row')].map((r) => r.getAttribute('data-control')),
            stepsDone: document.querySelectorAll('.wz-steps li.done').length,
            mode: w?.state?.profile?.modeSwitch ?? null, channels: w?.state?.profile?.channels?.length ?? null
        };
    });
    await page.locator('[data-testid=known-controls]').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.screenshot({ path: `${outDir}/02-check-known.png`, fullPage: true });
    ok('open', open.id === 'check' && open.known === 'dji-virtual-joystick' && open.name === 'DJI FPV Remote Controller 3' && !!open.note && open.controls.length === 11 && open.mode?.input?.kind === 'bits' && open.channels === 9, open);
    // live: the right stick to the right lights its bar; the mode switch at M lights "high"
    await page.evaluate(() => window.__pad.set([0.8, 0, -1, 0, 0], 0x90));
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => {
        const row = (c) => document.querySelector(`[data-testid=known-controls] [data-control=${c}]`);
        return {
            rightX: parseFloat(row('rightStickX')?.querySelector('.kp-bar i')?.style.width ?? '0'),
            leftX: parseFloat(row('leftStickX')?.querySelector('.kp-bar i')?.style.width ?? '0'),
            modeNow: row('flightModeSwitch')?.querySelector('.kp-pos.now')?.getAttribute('data-pos') ?? null,
            c2Now: row('c2Switch')?.querySelector('.kp-pos.now')?.getAttribute('data-pos') ?? null,
            rollBar: document.querySelector('.wz-row[data-fn=roll] .trk i')?.style.width ?? null
        };
    });
    ok('live', live.rightX > 35 && live.leftX < 1 && live.modeNow === 'high' && live.c2Now === 'low', live);
    // Fly
    await page.evaluate(() => window.__pad.set([0, 0, -1, 0, 0], 0x50));
    await page.locator('[data-action=wizard-done]').click();
    await page.waitForFunction(() => window.__gsfpv?.controls?.source === 'gamepad' && !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => undefined);
    const fly = await page.evaluate(() => ({ source: window.__gsfpv?.controls?.source ?? null, known: window.__gsfpv?.controls?.profile?.known ?? null, screen: !!document.querySelector('.screen.radio') }));
    ok('fly', fly.source === 'gamepad' && fly.known === 'dji-virtual-joystick' && !fly.screen, fly);
    // modes: N / S / M
    const modes = [];
    for (const b of [0x50, 0x10, 0x90, 0x50]) {
        await page.evaluate((bb) => window.__pad.set(null, bb), b);
        await page.waitForTimeout(250);
        modes.push(await page.evaluate(() => window.__gsfpv.controls.flyingMode()));
    }
    ok('modes', modes.join(',') === 'angle,horizon,acro,angle', { modes });
    // arm: the sticks through their centre, throttle down, start/stop pressed and released
    const press = async (bit) => {
        await page.evaluate((bb) => window.__pad.set(null, 0x50 | (1 << bb)), bit);
        await page.waitForTimeout(150);
        await page.evaluate(() => window.__pad.set(null, 0x50));
        await page.waitForTimeout(250);
    };
    await page.evaluate(() => window.__pad.set([0, 0, -1, 0, 0], 0x50));
    await page.waitForTimeout(300);
    await press(2);
    const armed1 = await page.evaluate(() => window.__gsfpv.controls.gate.armed);
    await press(2);
    const armed2 = await page.evaluate(() => window.__gsfpv.controls.gate.armed);
    // control: throttle up (the spring's middle, 50 %): a press does not arm
    await page.evaluate(() => window.__pad.set([0, 0, 0, 0, 0], 0x50));
    await page.waitForTimeout(300);
    await press(2);
    const armedMid = await page.evaluate(() => ({ armed: window.__gsfpv.controls.gate.armed, block: window.__gsfpv.controls.block }));
    await page.evaluate(() => window.__pad.set([0, 0, -1, 0, 0], 0x50));
    await page.screenshot({ path: `${outDir}/03-flying.png` });
    ok('arm', armed1 === true && armed2 === false && armedMid.armed === false, { armed1, armed2, throttleMiddle: armedMid });
    // resume: a reload flies on with the saved setup (the pad stays shown, as the browser keeps it)
    await page.evaluate(() => window.__gsfpv.prefs.flush());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    await page.waitForFunction(() => window.__gsfpv?.controls?.source === 'gamepad', null, { timeout: 15000 }).catch(() => undefined);
    const resume = await page.evaluate(() => ({ source: window.__gsfpv?.controls?.source ?? null, known: window.__gsfpv?.controls?.profile?.known ?? null, screen: !!document.querySelector('.screen.radio') }));
    ok('resume', resume.source === 'gamepad' && resume.known === 'dji-virtual-joystick' && !resume.screen, resume);
    out.errorsDji = errors;
    await ctx.close();
}

// ---- offer: a setup the wizard saved for this pad before it was recognised
{
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(installPad, { axes: 5 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && window.__gsfpv?.prefs, null, { timeout: 120000 });
    // the wizard's profile of v0.7 for this pad: CH1..CH4, a narrow roll, arm on button 3 held
    const key = 'gp:HID Interface (Vendor: 2ca3 Product: 1021):5:24:';
    const saved = await page.evaluate((k) => {
        const old = { version: 1, deviceKey: k, deviceName: 'HID Interface (Vendor: 2ca3 Product: 1021)', created: '2026-10-15T20:00:00.000Z', wizard: 2, deadband: 0, angleMode: null, mode: 2,
            axes: { roll: { index: 0, invert: false, center: -0.017, min: -0.9, max: 0.88 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: -0.012, min: -1, max: 1 } },
            arm: { kind: 'button', bit: 2, toggle: true } };
        // into the page's store as a settings file would bring it (Settings -> import)
        const p = window.__gsfpv.prefs;
        const f = p.export();
        f.collections.radioProfiles = { v: 1, items: { [k]: old }, last: { kind: 'keyboard' } };
        p.importFile(f, 'replace');
        p.flush();
        return !!p.collection('radioProfiles').items[k];
    }, key).catch((e) => String(e));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    // Controls: the gamepad button, then a stick moved
    await page.evaluate(() => { document.querySelector('[data-action=open-controls]')?.click(); });
    await page.waitForFunction(() => document.querySelector('.screen.radio .choice'), null, { timeout: 10000 }).catch(() => undefined);
    await page.evaluate(() => window.__pad.set([0, 0, -1, 0, 0], 0x50));
    await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 8000 }).catch(() => undefined);
    const before = await page.evaluate(() => ({ known: window.__gsfpv?.radio?.wizard?.state?.profile?.known ?? null, offer: !!document.querySelector('[data-action=use-known]') }));
    await page.screenshot({ path: `${outDir}/04-offer.png` });
    if (before.offer) await page.locator('[data-action=use-known]').click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ known: window.__gsfpv?.radio?.wizard?.state?.profile?.known ?? null, rollMax: window.__gsfpv?.radio?.wizard?.state?.profile?.axes?.roll?.max ?? null, note: !!document.querySelector('[data-testid=known-note]') }));
    ok('offer', saved === true && before.known === null && before.offer && after.known === 'dji-virtual-joystick' && after.rollMax === 1 && after.note, { saved, before, after });
    await ctx.close();
}

// ---- negative control: the DJI's ids, another shape
{
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(installPad, { axes: 4 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice'), null, { timeout: 120000 });
    await page.evaluate(() => window.__pad.set([0, 0, 0.3, 0], 0x50));
    await page.waitForTimeout(4000);
    const s = await page.evaluate(() => ({ wizard: window.__gsfpv?.radio?.wizard?.state?.id ?? null, choice: !!document.querySelector('.screen.radio .choice') }));
    ok('not-dji', s.wizard === null && s.choice, s);
    await ctx.close();
}
await browser.close();
out.pass = Object.values(out.steps).every((s) => s.pass) && (out.errorsDji ?? []).length === 0;
writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass: out.pass, browser: out.browser?.version, errors: out.errorsDji }, null, 1));
