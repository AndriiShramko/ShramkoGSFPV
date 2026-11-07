// v0.12 Fly by Sound, review of lane v12-flight, D4 (docs/wip/v12-flight-review.md): the start screen OVER A RUNNING FLIGHT, driven by
// the keyboard alone in a real page, headless Chrome. The lane's keyboard run (sonic-start-keyboard.ts) drives the screen at the
// entry, before the flight exists; over a flight the keyboard source (devices/keyboard.ts) is live and reads Space, the arrows and
// W A S D Q E as flying keys, preventing their default action, unless a dialog is up (dialogOpen()). The start screen was no
// dialog, so a pilot who opens it from the pause menu (or meets it at the end of the ladder) could not toggle a checkbox with
// Space, move the path radio or a slider with the arrow keys, or press a headphone button with Space, and those keys also reached
// the flight as flying input. Checks, with the mouse never touched:
//   - Space on "calm mode" toggles it (and back), the arrow keys move the path radio group and a slider, Space on a headphone button
//     presses it, Space opens the layers details control; none of those keydowns is default-prevented;
//   - control: with the screen closed again the flight's own keys are as before (Space is the flight's lift and is prevented).
// Evidence: evidence/<date>/sonic-review-keys.json. Holds the GPU lock (the page draws the lesson world).
//   cd apps/fly && npx vite --port 5343 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5343 npx tsx src/sonic-review-keys.ts
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import type { Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) {
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

// the pilot's own voice off ("my screen reader speaks"): nothing is spoken, the run is quiet and short
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    // (the radio of last time: a pilot whose radio is not found this time, e.g. not plugged in yet; review D1)
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false }, progress: {}, current: null }, ui: { v: 1, warned: true }, radioProfiles: { v: 1, items: {}, last: { kind: 'hid', key: 'hid:1209:4f54:Radiomaster TX16S Joystick:19' } } }
};
// (window.__name: tsx wraps named functions of a page.evaluate callback in __name(), which the page does not have)
const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  // every keydown of a key the screen needs, as the page sees it AFTER the page's own capture handlers ran: prevented or not
  window.__keys = [];
  addEventListener('keydown', (e) => { window.__keys.push({ code: e.code, prevented: e.defaultPrevented, target: (e.target && (e.target.id || e.target.tagName)) || '' }); }, false);
  window.__pointer = 0;
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) addEventListener(t, (e) => { if (e.detail !== 0 || e.pointerType) window.__pointer++; }, true);
})();`;

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};

type Keys = { code: string; prevented: boolean; target: string }[];
const keysSince = async (page: Page, from: number): Promise<Keys> => page.evaluate((n) => ((window as unknown as { __keys: Keys }).__keys).slice(n), from);
const keyCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __keys: Keys }).__keys.length);
const checked = (page: Page, id: string): Promise<boolean> => page.evaluate((i) => (document.getElementById(i) as HTMLInputElement).checked, id);
const value = (page: Page, id: string): Promise<string> => page.evaluate((i) => (document.getElementById(i) as HTMLInputElement).value, id);
const focusId = (page: Page, id: string): Promise<void> => page.focus(`#${id}`);

await lock();
let failed = false;
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;
    await page.goto(`${LAB}/fly/?sonic=hover-height&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson !== null; }, undefined, { timeout: 90000 });
    await sleep(1500);
    // D1: no radio was found, the keyboard flies as a stand-in and the radio of last time is still what the page remembers
    const last = await page.evaluate(() => (JSON.parse(localStorage.getItem('gsfpv.prefs.v1') ?? '{}') as { collections?: { radioProfiles?: { last?: { kind?: string; key?: string } } } }).collections?.radioProfiles?.last ?? null);
    const source = await page.evaluate(() => (window as unknown as { __gsfpv: { controls: { source: string | null } } }).__gsfpv.controls.source);
    check('no radio found: the keyboard flies (as a stand-in) and the radio of last time is still the input the page remembers', source === 'keyboard' && last?.kind === 'hid' && last?.key === 'hid:1209:4f54:Radiomaster TX16S Joystick:19', { source, last });

    // D7: R goes down, the window loses focus (the browser sends no keyup), the page goes on for longer than the long press (0.7 s):
    // the held R must not become "back to the lesson's start"; the keyup that comes much later adds nothing
    const resets = (): Promise<number> => page.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { events: { kind: string; action?: string | null }[] } } }).__gsfpv.sonic(true).events.filter((e) => e.kind === 'key' && (e.action === 'reset.start' || e.action === 'reset.checkpoint')).length);
    const r0 = await resets();
    await page.keyboard.down('KeyR');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(1500);
    const rDuring = await resets();
    await page.keyboard.up('KeyR');
    await sleep(300);
    const rAfter = await resets();
    check('R held while the window loses focus is dropped: no long-press reset while the page goes on, none when the late keyup comes', rDuring === r0 && rAfter === r0, { before: r0, during: rDuring, afterKeyup: rAfter });
    // control: a plain quick R (down, up) is the reset to the checkpoint, as before
    await page.keyboard.down('KeyR');
    await sleep(60);
    await page.keyboard.up('KeyR');
    await sleep(300);
    const rQuick = await resets();
    check('control: a quick R with no focus lost is still a reset (to the last checkpoint)', rQuick === rAfter + 1, { before: rAfter, afterQuickR: rQuick });

    // the pause menu's Fly by Sound item opens the start screen over the flight
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-action="pause.sonic"]', { timeout: 5000 });
    await (await page.$('[data-action="pause.sonic"]'))!.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 5000 });
    await sleep(300);
    const open = await page.evaluate(() => ({ visible: !document.getElementById('sonic-start')!.hidden, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }));
    check('the start screen is over the flight and the flight is paused behind it', open.visible && open.paused, open);

    // Space on a checkbox: calm mode on, then off
    await focusId(page, 'sonic-calm');
    const calm0 = await checked(page, 'sonic-calm');
    let n = await keyCount(page);
    await page.keyboard.press('Space');
    await sleep(100);
    const calm1 = await checked(page, 'sonic-calm');
    await page.keyboard.press('Space');
    await sleep(100);
    const calm2 = await checked(page, 'sonic-calm');
    const kCalm = await keysSince(page, n);
    check('Space on "calm mode" toggles it on and back off', calm0 === false && calm1 === true && calm2 === false, { calm0, calm1, calm2, keydowns: kCalm });
    check('and its keydowns are not default-prevented (the flight does not take Space from the screen)', kCalm.length >= 2 && kCalm.every((k) => k.code !== 'Space' || !k.prevented), kCalm);

    // the arrow keys on the path radio group: full -> fast
    await focusId(page, 'sonic-path-full');
    n = await keyCount(page);
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    const fast = await checked(page, 'sonic-path-fast');
    const kArrow = await keysSince(page, n);
    check('ArrowRight on the path radio group moves it to the fast path', fast, { fast, keydowns: kArrow });
    check('and the arrow key is not default-prevented', kArrow.length >= 1 && kArrow.every((k) => !k.prevented), kArrow);
    await focusId(page, 'sonic-path-fast');
    await page.keyboard.press('ArrowLeft');
    await sleep(100);

    // the arrow keys on a slider (speaking speed)
    await focusId(page, 'sonic-rate');
    const rate0 = await value(page, 'sonic-rate');
    n = await keyCount(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    const rate1 = await value(page, 'sonic-rate');
    const kRate = await keysSince(page, n);
    check('ArrowRight on the speaking-speed slider raises it', Number(rate1) > Number(rate0), { rate0, rate1, keydowns: kRate });
    check('and those keydowns are not default-prevented', kRate.length >= 2 && kRate.every((k) => !k.prevented), kRate);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    // Space on a button: the headphone check's left button (its status line says what plays)
    await page.focus('[data-testid="sonic-hp-left"]');
    n = await keyCount(page);
    await page.keyboard.press('Space');
    await sleep(300);
    const status = await page.evaluate(() => (document.querySelector('[data-testid="sonic-status"]')?.textContent ?? '').trim());
    check('Space on a headphone button presses it (the status line names the sound)', /left/i.test(status), { status });
    const kBtn = await keysSince(page, n);
    check('and its keydown is not default-prevented', kBtn.length >= 1 && kBtn.every((k) => k.code !== 'Space' || !k.prevented), kBtn);

    // Space on the summary of the layers details control opens it
    const summary = await page.$('details.sonic-details > summary');
    await summary!.focus();
    await page.keyboard.press('Space');
    await sleep(100);
    const detailsOpen = await page.evaluate(() => (document.querySelector('details.sonic-details') as HTMLDetailsElement).open);
    check('Space on "Volume and pitch of each sound" opens it', detailsOpen, { detailsOpen });

    check('the mouse was never touched', (await page.evaluate(() => (window as unknown as { __pointer: number }).__pointer)) === 0);

    // Escape closes the screen and the flight goes on
    await page.keyboard.press('Escape');
    await sleep(400);
    const closed = await page.evaluate(() => ({ hidden: document.getElementById('sonic-start')!.hidden, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }));
    check('Escape closes the screen and the flight goes on', closed.hidden && !closed.paused, closed);

    // control: back in the flight the keyboard is the flight's again (Space is lift, and the game scheme prevents its default)
    n = await keyCount(page);
    await page.keyboard.down('Space');
    await sleep(80);
    await page.keyboard.up('Space');
    const kFlight = await keysSince(page, n);
    check('control: with the screen closed, Space is the flight\'s key as before (its keydown is prevented)', kFlight.length >= 1 && kFlight[0]!.code === 'Space' && kFlight[0]!.prevented, kFlight);

    const errors = L.console.filter((l) => l.startsWith('pageerror') || (l.startsWith('error') && !/favicon|404|\/api\//.test(l)));
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    failed = checks.some((c) => !c.pass);
    const file = writeEvidence('sonic-review-keys', { lab: LAB, passed: checks.filter((c) => c.pass).length, total: checks.length, checks });
    console.log(`${checks.filter((c) => c.pass).length} of ${checks.length} checks pass; evidence ${file}`);
    await L.browser.close();
} finally {
    unlock();
}
process.exit(failed ? 1 : 0);
