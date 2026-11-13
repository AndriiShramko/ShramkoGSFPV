// A window that needs the mouse gets the mouse (lane mouse-free, docs/wip/mouse-free.md; the owner's
// report of 2026-11-13: the report form opened from "My controller is not in the list" on the Controls
// screen left the pointer captured by the flight, no cursor, nothing could be clicked).
// On a release build, headless (pointer lock works inside the page), the logic-only test mode
// (?render=off: no scan is drawn). The keyboard game scheme flies, so a click on the view captures the
// mouse (play/mouse-look.ts). A fake navigator.usb (an init script) returns a device shaped like the
// owner's DJI RC 2 (2CA3:1021, interfaces FF.43.01, 06.01.01, FF.42.01).
// Entries, each from a captured mouse:
//   helper   P (pause menu), Controls, "My controller is not in the list", Look, Send this list
//   keyB     B over the flight
//   menu     P, the menu's Feedback item
//   settings P, the menu's Settings item
// Recorded per entry: document.pointerLockElement a moment after the window opened, the form's cursor,
// the tab marked checked, the list text in the field, whether Tab from the focused control reaches the
// send button, whether a click inside the window takes the capture again, and whether a click on the
// view takes it again after the window closed. A failed expectation prints FAIL and exits 1.
// Usage: node mouse-free-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <out.json> [--only a,b]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v.split(','); };
const only = flag('--only');
const base = args[0] ?? 'http://localhost:5390/en';
const outFile = args[1] ?? ROOT + '/.cache/mouse-free-probe.json';
mkdirSync(dirname(outFile), { recursive: true });
const runs = (name) => !only || only.includes(name);

/** In the page: navigator.usb whose chooser returns a device shaped like the owner's DJI RC 2. */
function installUsb() {
    const iface = (c, s, p) => ({ alternates: [{ interfaceClass: c, interfaceSubclass: s, interfaceProtocol: p }] });
    const dev = { vendorId: 0x2ca3, productId: 0x1021, productName: 'DJI RC 2', configurations: [{ interfaces: [iface(0xff, 0x43, 0x01), iface(0x06, 0x01, 0x01), iface(0xff, 0x42, 0x01)] }] };
    Object.defineProperty(Navigator.prototype, 'usb', { value: { requestDevice: async () => dev, getDevices: async () => [] }, configurable: true });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: pick.launch.headless });
const out = { what: 'a window that needs the mouse gets the mouse (mouse-free-probe.mjs)', base, entries: {} };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
let failed = 0;
const check = (name, pass, detail) => { if (!pass) failed++; console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '')}`); return { name, pass, detail }; };
const settle = (page, ms = 700) => page.waitForTimeout(ms);

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.addInitScript(installUsb);
await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1&render=off&set.input.howToFly=false&set.input.play=easy`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio [data-action=radio-keyboard]'), null, { timeout: 120000 });
await page.locator('[data-action=radio-keyboard]').click();
await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });

const locked = () => page.evaluate(() => document.pointerLockElement !== null);
/** A click on the flight view (the middle of the page, nothing there keeps the click). */
async function capture() {
    for (let i = 0; i < 6; i++) {
        await page.mouse.click(800, 520);
        await settle(page, 400);
        if (await locked()) return true;
        await settle(page, 900); // the browser refuses a lock asked for too soon after a release
    }
    return false;
}
/** What the open window looks like now. */
const look = () => page.evaluate(() => {
    const form = document.querySelector('.panel.feedback');
    const win = form ?? document.querySelector('.panel, .screen.radio, .screen.scenes, .screen.drones');
    const field = document.querySelector('[data-testid=fb-message]');
    const checked = document.querySelector('.fb-kind[aria-checked="true"]');
    const a = document.activeElement;
    return {
        locked: document.pointerLockElement !== null,
        window: win ? win.className : null,
        cursor: win ? getComputedStyle(win).cursor : null,
        checkedTab: checked ? checked.getAttribute('data-kind') : null,
        checkedLabel: checked ? checked.textContent : null,
        title: win?.querySelector('h2')?.textContent ?? null,
        fieldText: field ? field.value.slice(0, 200) : null,
        fieldVisible: field ? field.getBoundingClientRect().height > 0 : null,
        focus: a ? `${a.tagName.toLowerCase()}${a.getAttribute('data-kind') ? `[${a.getAttribute('data-kind')}]` : ''}${a.getAttribute('data-testid') ? `#${a.getAttribute('data-testid')}` : ''}` : null
    };
});
/** Tab from the focused control until the send button of the form has the focus (at most 25 presses). */
async function tabToSend() {
    for (let i = 0; i < 25; i++) {
        const on = await page.evaluate(() => { const a = document.activeElement; return !!a && a.matches('.panel.feedback button[type=submit], .panel.feedback [data-testid=fb-send]'); });
        if (on) return i;
        await page.keyboard.press('Tab');
    }
    return -1;
}
/** Close the open window with its own x (a mouse click: the cursor must be there to do it). */
async function closeWindow() {
    const x = page.locator('.panel .panel-x, .screen .panel-x').last();
    if (await x.count()) await x.click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
    else await page.keyboard.press('Escape');
    await settle(page);
    // the pause menu may be left under it: Continue
    if (await page.locator('[data-action="pause.continue"]').count()) await page.locator('[data-action="pause.continue"]').click({ timeout: 3000 }).catch(() => {});
    await settle(page);
}

async function entry(name, open, wantForm) {
    if (!runs(name)) return;
    console.log(name);
    const r = { steps: [] };
    out.entries[name] = r;
    r.steps.push(check(`${name}: the view captures the mouse`, await capture(), null));
    await open();
    await settle(page, 1200);
    const s = await look();
    r.opened = s;
    r.steps.push(check(`${name}: the window is open`, s.window !== null, { window: s.window }));
    r.steps.push(check(`${name}: the mouse is free while it is up`, !s.locked, { locked: s.locked, cursor: s.cursor }));
    if (wantForm) {
        r.steps.push(check(`${name}: the form shows its kind`, s.checkedTab === wantForm.kind, { checkedTab: s.checkedTab, label: s.checkedLabel, title: s.title }));
        if (wantForm.text) r.steps.push(check(`${name}: the list is in the field`, s.fieldVisible === true && /2CA3|2ca3/.test(s.fieldText ?? ''), { fieldText: s.fieldText }));
        const presses = await tabToSend();
        r.steps.push(check(`${name}: Tab reaches Send`, presses >= 0, { presses, focusAtOpen: s.focus }));
    }
    // a click on a control inside the window must not take the capture back
    const inside = page.locator('.panel.feedback [data-testid=fb-message], .panel [type=checkbox], .panel button:not(.panel-x), .screen.radio button').first();
    if (await inside.count()) {
        await inside.click({ timeout: 3000 }).catch(() => {});
        await settle(page);
        const l = await locked();
        r.steps.push(check(`${name}: a click inside keeps the mouse free`, !l, { locked: l }));
    }
    await closeWindow();
    const after = await page.evaluate(() => ({ panel: !!document.querySelector('.panel, .screen.radio'), locked: document.pointerLockElement !== null }));
    r.closed = after;
    r.steps.push(check(`${name}: a click on the view captures again`, after.locked || await capture(), { afterClose: after }));
    if (await locked()) await page.evaluate(() => document.exitPointerLock());
    await settle(page, 1300);
}

await entry('helper', async () => {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-action="pause.radio"]', { timeout: 5000 });
    await page.locator('[data-action="pause.radio"]').click();
    await page.waitForSelector('.screen.radio [data-testid=usb-look] summary', { timeout: 10000 });
    await page.locator('.screen.radio [data-testid=usb-look] summary').click();
    await page.locator('[data-action=usb-look]').click();
    await page.waitForSelector('[data-action=usb-look-send]', { timeout: 5000 });
    out.helperBeforeSend = await look();
    await page.locator('[data-action=usb-look-send]').click();
}, { kind: 'bug', text: true });
await entry('keyB', () => page.keyboard.press('KeyB'), { kind: 'bug' });
await entry('menu', async () => {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-action="pause.feedback"]', { timeout: 5000 });
    await page.locator('[data-action="pause.feedback"]').click();
}, { kind: 'bug' });
await entry('settings', async () => {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-action="pause.settings"], [data-action="settings.open"]', { timeout: 5000 });
    await page.locator('[data-action="pause.settings"], [data-action="settings.open"]').first().click();
}, null);

out.errors = errors;
out.failed = failed;
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`${failed ? 'FAIL' : 'PASS'} mouse-free-probe: ${failed} failed; errors ${errors.length}; ${outFile}`);
await browser.close();
process.exit(failed ? 1 : 0);
