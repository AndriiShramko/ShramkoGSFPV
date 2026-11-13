// A window that needs the mouse gets the mouse (lane mouse-free, docs/wip/mouse-free.md; the owner's
// report of 2026-11-13: the report form opened from "My controller is not in the list" on the Controls
// screen left the pointer captured by the flight, no cursor, nothing could be clicked).
// On a release build, headless through chrome.mjs (visual-browser.mjs pickHarnessBrowser; pointer lock
// works inside the page), the logic-only test mode (?render=off: no scan is drawn). The keyboard game
// scheme flies, so a click on the view captures the mouse (play/mouse-look.ts). A fake navigator.usb (an
// init script) returns a device shaped like the owner's DJI RC 2 (2CA3:1021, FF.43.01, 06.01.01, FF.42.01).
// Entries, each from a flight with the mouse captured:
//   helper      P (pause menu), Controls, "My controller is not in the list", Look, Send this list
//   keyB        B over the flight (the report form)
//   menu        P, the menu's Feedback item
//   pause       P (the pause menu itself), closed with its Continue
//   settings    P, the menu's Settings item
//   radio       P, the menu's Controls item (the Controls screen)
//   courseKey   Shift+G over the flight (a new course: no window opens, the capture must stay)
//   courseMenu  P, the menu's New course item (the menu closes; no window stays)
//   rooms       on a ?rooms=1 page: Shift+L (else P, Fly with others), the rooms panel
// Per window: the capture is held before, released a moment after the window opened, the cursor over
// the window is not 'none', a click on a harmless control inside (a text field, a search box, a
// disclosure, a heading) does not take the capture, and after closing a click on the view takes it again.
// It never presses a send, save or create button (Send this list only opens the form; nothing is sent).
// Usage: node mouse-free-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <out.json>
//        [--only a,b] [--shot <dir>]   (--shot: a screenshot of the helper's form with the mouse over Send)
// Prints PASS/FAIL lines and, as the LAST line, JSON {pass, checks:[{name, pass, detail}]}; exit 0 only on pass.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const only = flag('--only')?.split(',') ?? null;
const shotDir = flag('--shot');
const base = (args[0] ?? 'http://localhost:5390/en').replace(/\/$/, '');
const outFile = args[1] ?? ROOT + '/.cache/mouse-free-probe.json';
mkdirSync(dirname(outFile), { recursive: true });
if (shotDir) mkdirSync(shotDir, { recursive: true });
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
const checks = [];
const check = (name, pass, detail) => {
    const c = { name, pass: !!pass, detail: detail ?? null };
    checks.push(c);
    console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '').slice(0, 300)}`);
    return c;
};
const settle = (page, ms = 700) => page.waitForTimeout(ms);

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.addInitScript(installUsb);

/** Open a flight page and pick the keyboard on the first Controls screen. */
async function start(extra = '') {
    await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1&render=off&set.input.howToFly=false&set.input.play=easy${extra}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio [data-action=radio-keyboard]'), null, { timeout: 120000 });
    await page.locator('[data-action=radio-keyboard]').click();
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
    await settle(page, 1000);
}

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
/** The windows that need the cursor (play/mouse-look.ts CURSOR_WINDOWS plus the pause menu). */
const WINDOWS = '.panel, .pause-menu, .screen.radio, .screen.scenes, .screen.drones, .screen.settings, [aria-modal="true"]:not([hidden])';
/** What the open window looks like now: the top one, the cursor at its middle and on itself. */
const look = () => page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 0);
    const win = document.querySelector('.panel.feedback') ?? all[all.length - 1] ?? null;
    const field = document.querySelector('[data-testid=fb-message]');
    const checked = document.querySelector('.fb-kind[aria-checked="true"]');
    const a = document.activeElement;
    let cursorAtMiddle = null, atMiddle = null;
    if (win) {
        const r = win.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 120));
        if (el) { cursorAtMiddle = getComputedStyle(el).cursor; atMiddle = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`; }
    }
    return {
        locked: document.pointerLockElement !== null,
        window: win ? String(win.className) : null,
        cursor: win ? getComputedStyle(win).cursor : null,
        cursorAtMiddle, atMiddle,
        checkedTab: checked ? checked.getAttribute('data-kind') : null,
        title: win?.querySelector('h2')?.textContent ?? null,
        fieldText: field ? field.value.slice(0, 200) : null,
        fieldVisible: field ? field.getBoundingClientRect().height > 0 : null,
        focus: a ? `${a.tagName.toLowerCase()}${a.getAttribute('data-kind') ? `[${a.getAttribute('data-kind')}]` : ''}${a.getAttribute('data-testid') ? `#${a.getAttribute('data-testid')}` : ''}` : null
    };
}, WINDOWS);
const windowUp = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().height > 0), WINDOWS);
/** Tab from the focused control until the send button of the form has the focus (at most 25 presses; never pressed). */
async function tabToSend() {
    for (let i = 0; i < 25; i++) {
        const on = await page.evaluate(() => { const a = document.activeElement; return !!a && a.matches('.panel.feedback button[type=submit], .panel.feedback [data-testid=fb-send]'); });
        if (on) return i;
        await page.keyboard.press('Tab');
    }
    return -1;
}
const continueBtn = () => page.locator('[data-action="pause.continue"]');
/** Close the open window with its own x (a mouse click: the cursor must be there to do it), then Continue. */
async function closeWindow() {
    const x = page.locator('.panel .panel-x, .screen .panel-x').last();
    if (await x.count()) await x.click({ timeout: 3000 }).catch(() => page.keyboard.press('Escape'));
    else await page.keyboard.press('Escape');
    await settle(page);
    if (await continueBtn().count()) await continueBtn().click({ timeout: 3000 }).catch(() => {});
    await settle(page);
}
/** Leave the flight's capture before the next entry, so each entry starts the same way. */
async function letGo() {
    if (await locked()) await page.evaluate(() => document.exitPointerLock());
    await settle(page, 1300);
}

/**
 * One entry. o.open opens the window; o.inside: a selector of a harmless control inside (never a send,
 * save or create button); o.form: what the report form must show; o.close: own way to close
 * (default the x, then Continue); o.noWindow: no window is expected, the capture must stay or come back.
 */
async function entry(name, o) {
    if (!runs(name)) return;
    console.log(name);
    const r = {};
    out.entries[name] = r;
    check(`${name}: the view captures the mouse before`, await capture(), null);
    await o.open();
    await settle(page, 1200);
    if (o.noWindow) {
        const up = await windowUp();
        const l = await locked();
        r.after = { windowUp: up, locked: l };
        check(`${name}: no window is left open`, !up, r.after);
        check(`${name}: the flight has the mouse (held, or a click on the view takes it)`, l || await capture(), r.after);
        await letGo();
        return;
    }
    const s = await look();
    r.opened = s;
    check(`${name}: the window is open`, s.window !== null, { window: s.window });
    check(`${name}: the mouse is free while it is up`, !s.locked, { locked: s.locked });
    check(`${name}: the cursor shows over the window`, s.window !== null && s.cursor !== 'none' && s.cursorAtMiddle !== null && s.cursorAtMiddle !== 'none', { cursor: s.cursor, cursorAtMiddle: s.cursorAtMiddle, atMiddle: s.atMiddle });
    if (o.form) {
        check(`${name}: the form shows its kind`, s.checkedTab === o.form.kind, { checkedTab: s.checkedTab, title: s.title });
        if (o.form.text) check(`${name}: the list is in the field`, s.fieldVisible === true && /2CA3|2ca3/.test(s.fieldText ?? ''), { fieldText: s.fieldText });
        const presses = await tabToSend();
        check(`${name}: Tab reaches Send`, presses >= 0, { presses, focusAtOpen: s.focus });
        if (o.shot && shotDir) {
            const send = page.locator('.panel.feedback [data-testid=fb-send], .panel.feedback button[type=submit]').first();
            const box = await send.boundingBox().catch(() => null);
            if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); // a hover only, never a click
            await settle(page, 300);
            r.shot = `${shotDir}/mouse-free-${name}-form.png`.replace(/\\/g, '/');
            await page.screenshot({ path: r.shot });
        }
    }
    const inside = page.locator(o.inside).first();
    const hasInside = await inside.count() > 0;
    if (hasInside) await inside.click({ timeout: 3000 }).catch(() => {});
    await settle(page);
    const l = await locked();
    check(`${name}: a click inside keeps the mouse free`, hasInside && !l, { inside: o.inside, found: hasInside, locked: l });
    if (o.close) await o.close(r); else await closeWindow();
    const after = await page.evaluate((sel) => ({ windowUp: [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().height > 0), locked: document.pointerLockElement !== null }), WINDOWS);
    r.closed = after;
    check(`${name}: the window closed`, !after.windowUp, after);
    check(`${name}: a click on the view captures again`, after.locked || await capture(), { afterClose: after });
    await letGo();
}

const openMenuItem = async (action) => {
    await page.keyboard.press('KeyP');
    await page.waitForSelector(`[data-action="${action}"]`, { timeout: 5000 });
    await page.locator(`[data-action="${action}"]`).click();
};

if (['helper', 'keyB', 'menu', 'pause', 'settings', 'radio', 'courseKey', 'courseMenu'].some(runs)) {
    await start();
    await entry('helper', {
        open: async () => {
            await openMenuItem('pause.radio');
            await page.waitForSelector('.screen.radio [data-testid=usb-look] summary', { timeout: 10000 });
            await page.locator('.screen.radio [data-testid=usb-look] summary').click();
            await page.locator('[data-action=usb-look]').click();
            await page.waitForSelector('[data-action=usb-look-send]', { timeout: 5000 });
            await page.locator('[data-action=usb-look-send]').click(); // opens the report form; nothing is sent
        },
        form: { kind: 'bug', text: true }, shot: true, inside: '[data-testid=fb-message]'
    });
    await entry('keyB', { open: () => page.keyboard.press('KeyB'), form: { kind: 'bug' }, inside: '[data-testid=fb-message]' });
    await entry('menu', { open: () => openMenuItem('pause.feedback'), form: { kind: 'bug' }, inside: '[data-testid=fb-message]' });
    await entry('pause', {
        open: async () => { await page.keyboard.press('KeyP'); await page.waitForSelector('[data-action="pause.continue"]', { timeout: 5000 }); },
        inside: '.pause-menu h2',
        close: async (r) => {
            await continueBtn().click({ timeout: 3000 });
            await settle(page);
            r.continueLocked = await locked();
            check('pause: Continue takes the capture again', r.continueLocked, { locked: r.continueLocked });
        }
    });
    await entry('settings', {
        open: async () => {
            await page.keyboard.press('KeyP');
            await page.waitForSelector('[data-action="pause.settings"], [data-action="settings.open"]', { timeout: 5000 });
            await page.locator('[data-action="pause.settings"], [data-action="settings.open"]').first().click();
        },
        inside: '[data-testid=settings-search]'
    });
    await entry('radio', { open: () => openMenuItem('pause.radio'), inside: '.screen.radio [data-testid=usb-look] summary' });
    await entry('courseKey', { open: () => page.keyboard.press('Shift+KeyG'), noWindow: true });
    await entry('courseMenu', { open: () => openMenuItem('pause.course'), noWindow: true });
}
if (runs('rooms')) {
    await start('&rooms=1');
    await entry('rooms', {
        open: async () => {
            await page.keyboard.press('Shift+KeyL');
            const up = await page.waitForSelector('[data-testid=rooms-panel]', { timeout: 2500 }).then(() => true, () => false);
            out.entries.rooms.openedBy = up ? 'Shift+L' : 'menu';
            if (!up) await openMenuItem('pause.rooms');
            await page.waitForSelector('[data-testid=rooms-panel]', { timeout: 8000 });
        },
        inside: '[data-testid=rooms-nick]'
    });
}

const pass = checks.length > 0 && checks.every((c) => c.pass);
out.errors = errors;
out.failed = checks.filter((c) => !c.pass).length;
out.checks = checks;
writeFileSync(outFile, JSON.stringify(out, null, 2));
await browser.close();
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
