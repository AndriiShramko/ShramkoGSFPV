// v0.10 lane K acceptance (docs/wip/v10-k.md): the "How to fly" card at the start of the game, on a built release served locally:
//   SITE=http://localhost:<port> npx tsx src/accept-v10-keys.ts
// SITE is required (no default: this bench never runs against the live site by accident). Visible system Chrome, the scan drawn
// (screenshots in evidence/<date>/v10-k/); hold the GPU lock around the run (mkdir C:/dev/.gpu-lock).
// V10_CONTROL=1 is the negative control: the same bench against the base build (198b659), where every check that belongs to the
// new card must FAIL; a check that passes there does not tell the builds apart and is listed in `notDiscriminating`. The
// control passes when none of the discriminating checks passes.
//
// Scenarios (a fresh browser context each; A keeps its storage across three visits):
//   A  desktop 1280 x 800: visit 1 is a first-time visitor (motion notice, loading, Controls, Keyboard) and meets the card;
//      visit 2 (same browser, nothing ticked) meets it again and ticks "Do not show again"; visit 3 does not meet it; K and the
//      pause menu bring it back. Flight after Start, the mouse capture, the first-flight pill and the corner line are checked here.
//   B  phone 390 x 844 (touch, no WebHID like Android Chrome): the touch card.
//   C  desktop 900 x 480 (a short window; the base build's key card showed no key at all there), Controls closed with x.
//   E  a phone on its side (812 x 375), the Russian phone (390 x 844) and the Polish short desktop window (900 x 480): the card fits
//      in every language and on every shape (no cut-off, no sideways scroll, Start flying reachable).
//      Review of 2026-10-20: the take-off line on the ground ("Click to fly, or press W or Space to take off") is DRAWN for the game scheme
//      (K6b after Start flying, K14c with the box ticked and no card), the card's note names the way off the ground (K2c, K24b), and the
//      radio card's arm line invents no channel number (K17b).
//   D  ?nowarn=1 (the page every older bench uses): the card never opens by itself; with the pilot profile (set.input.play=pilot)
//      the pilot keyboard's ground card is still there and K opens the pilot version of the card.
// What this does not prove: a real hand and a real mouse (the click on Start is Playwright's trusted click, pointer lock is
// granted to it; Esc as the browser's own release cannot be pressed from a test); a real phone (touch emulation of Chrome without
// WebHID); a real radio or gamepad (the radio card is drawn by pointing the page at a gamepad source and pressing K, the model
// and its texts are unit-tested: tools/bench/test/app-controls-card.test.ts).
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE_RAW = process.env.SITE;
if (!SITE_RAW) throw new Error('accept-v10-keys needs SITE=http://localhost:<port> (a local release); it has no default');
const SITE = SITE_RAW.replace(/\/$/, '');
const CONTROL = process.env.V10_CONTROL === '1';
console.log(`accept-v10-keys target: ${SITE}${CONTROL ? ' (CONTROL: the base build)' : ''}`);
const SHOTS = join(REPO, 'evidence', today(), CONTROL ? 'v10-k-control' : 'v10-k');
mkdirSync(SHOTS, { recursive: true });
const SCENE = '887f27aa';
const url = (qs = '', lang = 'en'): string => `${SITE}/${lang}/fly/?scene=${SCENE}${qs ? `&${qs}` : ''}&cb=${Math.random().toString(36).slice(2)}`;
/** How long the card is waited for. In the control the card never comes: do not wait a minute for it. */
const CARD_WAIT_MS = CONTROL ? 3500 : 12000;

/** A fly dictionary as the page merges it (the flat file plus every namespace folder). */
function dictOf(lang: string): Record<string, string> {
    const dir = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const d = JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(dir)) if (!ns.endsWith('.json')) Object.assign(d, JSON.parse(readFileSync(join(dir, ns, `${lang}.json`), 'utf8')));
    return d;
}
const EN = dictOf('en');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Evaluate code with h = window.__gsfpv and s = its session (a string: tsx wraps functions with __name). */
function ev<T = Any>(p: Page, code: string): Promise<T> {
    return p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${code} })()`) as Promise<T>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const checks: { id: string; ok: boolean; discriminating: boolean; detail: Record<string, unknown> }[] = [];
/** `discriminating` false: a check the base build is expected to pass too (nothing of the new card in it). */
function check(id: string, ok: boolean, detail: Record<string, unknown> = {}, discriminating = true): void {
    checks.push({ id, ok, discriminating, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`);
}
/** A check whose measurement may throw (an element the base build does not have): a throw is a failed check, not a crash. */
async function checkAsync(id: string, run: () => Promise<{ ok: boolean; detail?: Record<string, unknown> }>, discriminating = true): Promise<void> {
    try {
        const r = await run();
        check(id, r.ok, r.detail ?? {}, discriminating);
    } catch (e) {
        check(id, false, { threw: String((e as Error).message).slice(0, 200) }, discriminating);
    }
}

/** In every page: a frame-by-frame sampler that counts the frames in which the card is up together with another dialog. */
const OVERLAP = `(() => {
    window.__overlap = { frames: 0, with: {} };
    const other = '.screen.radio, .screen.scenes, .screen.drones, .pause-menu, .crash-overlay, .loading, .panel:not(.how-to-fly)';
    const tick = () => {
        if (document.querySelector('[data-testid="how-to-fly"]')) {
            const o = document.querySelector(other);
            if (o) { window.__overlap.frames++; const k = o.className.toString().slice(0, 40); window.__overlap.with[k] = (window.__overlap.with[k] || 0) + 1; }
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
})();`;

async function newContext(browser: Browser, o: { width: number; height: number; mobile?: boolean }): Promise<BrowserContext> {
    const context = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile });
    if (o.mobile) await context.addInitScript(`try { delete Navigator.prototype.hid; } catch (e) {}`); // a phone's Chrome has no WebHID
    await context.addInitScript(OVERLAP);
    return context;
}
async function untilReady(p: Page, ms = 240000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = (await p.evaluate(`window.__gsfpv && window.__gsfpv.status`)) as string;
        if (s === 'ready') return;
        if (s === 'error') throw new Error('the scene failed to load');
        await sleep(300);
    }
    throw new Error('not ready');
}
/** Is the card up (waits up to `ms`)? */
async function cardUp(p: Page, ms = CARD_WAIT_MS): Promise<boolean> {
    const t0 = Date.now();
    for (;;) {
        if ((await p.evaluate(`!!document.querySelector('[data-testid="how-to-fly"]')`)) as boolean) return true;
        if (Date.now() - t0 >= ms) return false;
        await sleep(100);
    }
}
const cardCount = (p: Page): Promise<number> => p.evaluate(`document.querySelectorAll('[data-testid="how-to-fly"]').length`) as Promise<number>;
const hook = (p: Page): Promise<Any> => p.evaluate(`(() => { const f = window.__gsfpv && window.__gsfpv.howToFly; return f ? f() : null; })()`) as Promise<Any>;
// the card fades in over 0.4 s: a picture taken at once shows it half transparent
const shot = async (p: Page, name: string): Promise<unknown> => { await sleep(600); return p.screenshot({ path: join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 80 }); };

/** What the card shows, read from its own DOM. */
async function cardFacts(p: Page): Promise<Any> {
    return p.evaluate(`(() => {
        const c = document.querySelector('[data-testid="how-to-fly"]');
        if (!c) return null;
        const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
        const up = c.querySelector('[data-testid="htf-up"]');
        const down = c.querySelector('[data-testid="htf-down"]');
        return {
            kind: c.getAttribute('data-kind'),
            role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), labelledby: c.getAttribute('aria-labelledby'),
            title: (document.getElementById(c.getAttribute('aria-labelledby') || '') || {}).textContent || null,
            upCaps: up ? [...up.querySelectorAll('kbd')].map((k) => k.textContent) : null,
            upWord: up ? (up.querySelector('strong') || {}).textContent : null,
            downCaps: down ? [...down.querySelectorAll('kbd')].map((k) => k.textContent) : null,
            downWord: down ? (down.querySelector('strong') || {}).textContent : null,
            downSub: down ? (down.querySelector('small') || {}).textContent : null,
            rows: [...c.querySelectorAll('.htf-rows li')].map((li) => li.getAttribute('data-row')),
            pads: c.querySelectorAll('.htf-pad').length,
            kbdCount: c.querySelectorAll('kbd').length,
            active: document.activeElement ? (document.activeElement.getAttribute('data-action') || document.activeElement.tagName) : null,
            activeInside: !!document.activeElement && c.contains(document.activeElement),
            hideChecked: !!(c.querySelector('[data-testid="htf-hide"]') || {}).checked,
            note: (c.querySelector('.htf-note') || {}).textContent || '',
            armText: (c.querySelector('[data-row="arm"] .htf-text') || {}).textContent || null,
            startRect: rect(c.querySelector('[data-action="htf-start"]')),
            upRect: rect(up), downRect: rect(down), panelRect: rect(c),
            scrollable: c.scrollHeight > c.clientHeight + 1,
            vh: innerHeight, vw: innerWidth,
            paused: !!(window.__gsfpv.session && window.__gsfpv.session.paused),
            text: (c.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400)
        };
    })()`);
}

/** The arm gate's line as the pilot sees it on the ground: drawn on the screen (not only spoken), where, and whether the "Click to fly" pill is stacked on it. */
const groundLine = (p: Page): Promise<Any> => p.evaluate(`(() => {
    const g = document.querySelector('.hud > .gate-msg');
    if (!g) return null;
    const hint = document.querySelector('[data-testid="game-hint"]');
    const r = g.getBoundingClientRect();
    const cs = getComputedStyle(g);
    return {
        text: (g.textContent || '').trim(),
        spokenOnly: g.classList.contains('visually-hidden'),
        shown: g.offsetParent !== null && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 40 && r.height > 12 && r.x >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        fontPx: parseFloat(cs.fontSize),
        hintShown: !!hint && !hint.hidden,
        rect: { x: Math.round(r.x), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
    };
})()`);

const POS = 'return { x: s.sim.s[0], y: s.sim.s[1], z: s.sim.s[2], vx: s.sim.s[3], vy: s.sim.s[4], vz: s.sim.s[5], armed: s.hud().armed, crashed: s.hud().crashed };';
const reminderOn = (p: Page): Promise<boolean> => p.evaluate(`(() => { const e = document.querySelector('[data-testid="game-reminder"]'); return !!e && !e.hidden; })()`) as Promise<boolean>;

/** WCAG contrast of the card's texts against the lightest scene that can sit behind the panel (the panel is 96 % opaque). */
async function contrast(p: Page): Promise<Any> {
    return p.evaluate(`(() => {
        const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
        const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const n = m[1].split(',').map((x) => parseFloat(x)); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const c = document.querySelector('[data-testid="how-to-fly"]');
        if (!c) return null;
        const pb = parse(getComputedStyle(c).backgroundColor);
        const behind = [255, 255, 255]; // the worst case: a white scene behind
        const panelBg = pb.rgb.map((v, i) => v * pb.a + behind[i] * (1 - pb.a));
        const out = {};
        const probe = (name, sel) => { const el = c.querySelector(sel); if (!el) return; const col = parse(getComputedStyle(el).color); out[name] = Math.round(ratio(col.rgb, panelBg) * 10) / 10; };
        probe('sub', '.htf-sub'); probe('rowText', '.htf-text'); probe('upSub', '.htf-pair.up small'); probe('downSub', '.htf-pair.down small'); probe('note', '.htf-note'); probe('check', '.htf-check span'); probe('foot', '.htf-foot'); probe('word', '.htf-word strong');
        // a cap's text on its own background
        const cap = c.querySelector('kbd.htf-cap:not(.big)');
        if (cap) out.cap = Math.round(ratio(parse(getComputedStyle(cap).color).rgb, parse(getComputedStyle(cap).backgroundColor).rgb) * 10) / 10;
        const big = c.querySelector('.htf-pair.up kbd.htf-cap');
        if (big) out.bigUp = Math.round(ratio(parse(getComputedStyle(big).color).rgb, parse(getComputedStyle(big).backgroundColor).rgb) * 10) / 10;
        const bigD = c.querySelector('.htf-pair.down kbd.htf-cap');
        if (bigD) out.bigDown = Math.round(ratio(parse(getComputedStyle(bigD).color).rgb, parse(getComputedStyle(bigD).backgroundColor).rgb) * 10) / 10;
        return { panelBg: panelBg.map((v) => Math.round(v)), ratios: out };
    })()`);
}

const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });

// =====================================================================================================================
// A  desktop, three visits in one browser
// =====================================================================================================================
{
    const ctxA = await newContext(browser, { width: 1280, height: 800 });
    const p = await ctxA.newPage();
    // ---------------------------------------------------------------- visit 1: a first-time visitor
    await p.goto(url());
    await sleep(1500);
    const warningUp = (await p.locator('[data-action="warning-ok"]').count()) > 0;
    check('K1a the motion notice is the first thing, and the card is not up with it', warningUp && (await cardCount(p)) === 0, { warningUp }, false);
    await p.locator('[data-action="warning-ok"]').click();
    await untilReady(p);
    await sleep(1200);
    const controlsUp = (await p.locator('.screen.radio').count()) > 0;
    const cardOverControls = await cardCount(p);
    check('K1b the Controls dialog "How will you fly?" is up after the scan is ready, with no card on it', controlsUp && cardOverControls === 0, { controlsUp, cards: cardOverControls }, false);
    await shot(p, 'k1b-controls-dialog');
    // the card must not come while Controls is up, however long we look
    await sleep(1800);
    const controlsStill = (await p.locator('.screen.radio').count()) > 0 && (await cardCount(p)) === 0;
    await p.locator('[data-action="radio-keyboard"]').click({ timeout: 15000 });
    const up1 = await cardUp(p);
    check('K1 a first-time visitor who chose Keyboard meets the card after the scan is ready', up1, { up: up1, hook: await hook(p) });
    // judged together with K1: a build that has no card at all trivially "keeps it off the Controls dialog"
    check('K1c the card waited for the choice: it was not up while the Controls dialog was still up (2 s later), and it came after Keyboard was chosen', controlsStill && up1, { controlsStill, up: up1 });
    const f = up1 ? await cardFacts(p) : null;
    if (up1) {
        await shot(p, 'k1-card-desktop');
        check('K2 the card shows SPACE = UP and SHIFT = DOWN as the two big keys (arrow and word with each), hold to land',
            f.kind === 'game' && JSON.stringify(f.upCaps) === JSON.stringify(['Space']) && f.upWord === 'Up' && JSON.stringify(f.downCaps) === JSON.stringify(['Shift']) && f.downWord === 'Down' && /land/.test(f.downSub ?? ''), { kind: f.kind, up: f.upCaps, upWord: f.upWord, down: f.downCaps, downWord: f.downWord, downSub: f.downSub });
        check('K2b the rest of the game scheme is on it: mouse, W A S D, turn keys, F full screen, Esc pause, R, N next scene, K this card',
            JSON.stringify(f.rows) === JSON.stringify(['mouse', 'move', 'turn', 'fullscreen', 'pause', 'respawn', 'next', 'again']), { rows: f.rows });
        check('K2c the card names the way off the ground: press W or Space to take off (the caps are the layout\'s own)', /take off/.test(f.note) && /\bW\b/.test(f.note) && /\bSpace\b/.test(f.note) && !/\{\w+\}/.test(f.note), { note: f.note });
        check('K3 accessibility: a modal dialog named by its title, the focus is on Start flying, Tab stays inside the card',
            f.role === 'dialog' && f.modal === 'true' && f.title === EN['play.card.title'] && f.active === 'htf-start' && f.activeInside, { role: f.role, modal: f.modal, title: f.title, active: f.active });
        const tabbed: string[] = [];
        for (let i = 0; i < 5; i++) { await p.keyboard.press('Tab'); tabbed.push((await p.evaluate(`(document.activeElement.getAttribute('data-action') || document.activeElement.getAttribute('data-testid') || document.activeElement.tagName)`)) as string); }
        const inside = await p.evaluate(`document.querySelector('[data-testid="how-to-fly"]').contains(document.activeElement)`);
        check('K3b five Tab presses never leave the card (x, Start, the box, round again)', inside === true, { tabbed });
        // back to Start for the next steps
        await p.locator('[data-action="htf-start"]').focus();
        const c = await contrast(p);
        const worst = c ? Math.min(...Object.values(c.ratios as Record<string, number>)) : 0;
        check('K4 every text on the card is at least WCAG AA against the lightest scene behind it (>= 4.5:1)', !!c && worst >= 4.5, { worst, ...(c ?? {}) });
        check('K5 the flight is held while the card is up, and flying keys do nothing under it (W held 0.6 s: not armed, not moved)', await (async () => {
            const before = await ev<Any>(p, POS);
            await p.keyboard.down('KeyW');
            await sleep(600);
            await p.keyboard.up('KeyW');
            const after = await ev<Any>(p, POS);
            const moved = Math.hypot(after.x - before.x, after.z - before.z);
            return f.paused === true && after.armed === false && moved < 0.05;
        })(), { paused: f.paused });
    } else {
        // the base build has no card: these are failed checks there, and nothing is pressed (a W would start the motors)
        for (const id of ['K2', 'K2b', 'K2c', 'K3', 'K3b', 'K4', 'K5']) check(`${id} (needs the card)`, false, { skipped: 'no card came up' });
    }
    // the lock: Start flying captures the mouse and the next key takes off. Without a card (the base build) a click on the view stands in
    await ev(p, 'h.wallsSwitch.set(false); return 0;'); // the palms over the spawn stop a climb
    await p.bringToFront(); // Chrome grants pointer lock only to a window the OS has focused
    await sleep(300);
    const y0 = (await ev<Any>(p, POS)).y;
    if (up1) await p.locator('[data-action="htf-start"]').click();
    else { const box = (await p.locator('canvas').first().boundingBox())!; await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
    await sleep(500);
    const afterStart = await ev<Any>(p, 'return { locked: document.pointerLockElement !== null, game: h.play() && h.play().game, paused: s.paused, cards: document.querySelectorAll(\'[data-testid="how-to-fly"]\').length };');
    check('K6 Start flying closes the card, resumes the flight and captures the mouse (pointer lock)', up1 && afterStart.cards === 0 && afterStart.paused === false && afterStart.locked === true && afterStart.game?.locked === true, { cards: afterStart.cards, paused: afterStart.paused, locked: afterStart.locked });
    await shot(p, 'k6-after-start');
    // review: the ground card is gone and the mouse is captured, so the only thing left to say how to leave the ground is the arm gate's line
    const gl = await groundLine(p);
    check('K6b on the ground after Start flying the take-off line is on the screen, not only spoken, and names W and Space (a pilot who closed the card unread still knows)',
        !!gl && gl.shown === true && gl.spokenOnly === false && gl.text === EN['play.gate.keys'] && /\bW\b/.test(gl.text) && /\bSpace\b/.test(gl.text) && gl.fontPx >= 14, { ...(gl ?? {}) });
    await p.keyboard.down('Space');
    await sleep(1400);
    const rem = await reminderOn(p);
    const fly = await ev<Any>(p, POS);
    check('K7 the first key after the start takes off: Space climbs (the drone is armed and higher than at the start)', fly.armed === true && fly.y > y0 + 0.3, { y0, y: fly.y, armed: fly.armed }, false);
    check('K8 for the first seconds of the first flight a small pill says "Space up . Shift down"', rem === true, { reminder: rem });
    await shot(p, 'k8-first-flight-reminder');
    const pillText = await p.evaluate(`(document.querySelector('[data-testid="game-reminder"]') || {}).textContent || ''`);
    check('K8b the pill names both caps and both words', /Space/.test(pillText as string) && /Shift/.test(pillText as string) && /up/.test(pillText as string) && /down/.test(pillText as string), { pillText });
    const corner = await p.evaluate(`(document.querySelector('.osd.br') || {}).textContent || ''`);
    check('K9 the corner line in flight starts with Space up / Shift down (before: K keys, F, R, Esc, H)', /Space up/.test(corner as string) && /Shift down/.test(corner as string), { corner });
    await p.keyboard.up('Space');
    // a new press of Shift: the pilot has found the keys, the pill goes
    await p.keyboard.press('Shift');
    await sleep(700);
    check('K8c the pill was up and goes at once when Shift is pressed', rem === true && (await reminderOn(p)) === false, { wasUp: rem });
    // judged together with the card having been seen: a build with no card at all is never "over another dialog"
    const overlap1 = await p.evaluate(`window.__overlap`) as Any;
    check('K10 across the whole first visit the card was up and never together with another dialog (Controls, the motion notice, a panel, the menu, the picker, the crash panel)', up1 && overlap1.frames === 0, { up: up1, overlap: overlap1 });
    // the sampler itself must see an overlap (control): a second dialog put up under the card is counted
    if (up1) {
        // the card is gone after Start; K opens it, then a stand-in dialog is put up and the sampler must count it
        await p.keyboard.press('KeyK');
        const reopened = await cardUp(p, 4000);
        if (reopened) {
            await p.evaluate(`(() => { const d = document.createElement('div'); d.className = 'screen radio'; d.id = 'fake-dialog'; document.getElementById('ui').append(d); })()`);
            await sleep(400);
            const o = await p.evaluate(`window.__overlap`) as Any;
            check('K10c (control of the sampler) a dialog put up under the card is counted by the overlap sampler', o.frames > 0, { overlap: o });
            await p.evaluate(`document.getElementById('fake-dialog').remove(); window.__overlap = { frames: 0, with: {} };`);
            await p.keyboard.press('KeyK');
            await sleep(300);
        }
    }

    // ---------------------------------------------------------------- visit 2: the same browser, nothing ticked
    await p.reload();
    await untilReady(p);
    const up2 = await cardUp(p);
    const h2 = await hook(p);
    check('K11 a second visit (nothing ticked) shows the card again, by itself: no Controls dialog this time, the keyboard of last time is back', up2 && (h2?.opened ?? []).includes('auto'), { up: up2, opened: h2?.opened ?? null });
    {
        if (up2) await shot(p, 'k11-second-visit');
        const box2 = up2 ? await cardFacts(p) : null;
        check('K11b the box is not ticked on the second visit (nothing was ticked in the first)', box2?.hideChecked === false, { hideChecked: box2?.hideChecked ?? null });
        // the pill's 8 seconds: take off with W held and let it run out (walls off: nothing to crash into)
        await ev(p, 'h.wallsSwitch.set(false); return 0;');
        await p.bringToFront();
        if (up2) await p.locator('[data-action="htf-start"]').click();
        await sleep(400);
        await p.keyboard.down('KeyW');
        await sleep(1800);
        const early = await reminderOn(p);
        await sleep(8200);
        const late = await reminderOn(p);
        await p.keyboard.up('KeyW');
        check('K13 the pill lasts the first seconds only: up at 2 s, gone by 10 s, with W held from take-off (key repeats do not hide it)', early === true && late === false, { at2s: early, at10s: late });
        // K brings the card back; this time the box is ticked: the setting is written at once and x keeps it
        await p.keyboard.press('KeyK');
        const upAgain = await cardUp(p, 4000);
        if (upAgain) {
            await p.locator('[data-testid="htf-hide"]').check();
            await sleep(300);
            const enabledAfter = (await hook(p))?.enabled;
            check('K12 ticking "Do not show again" writes the setting at once (input.howToFly off), and closing with x keeps it', enabledAfter === false, { enabled: enabledAfter });
            await p.locator('[data-action="htf-close"]').click();
            await sleep(300);
            check('K12b the tick survives closing with x', (await hook(p))?.enabled === false && (await cardCount(p)) === 0, {});
        } else check('K12 ticking "Do not show again" writes the setting at once', false, { upAgain });
    }
    // ---------------------------------------------------------------- visit 3: ticked, so no card
    await p.reload();
    await untilReady(p);
    await sleep(CONTROL ? 3000 : 4500);
    const h3 = await hook(p);
    const card3 = await cardCount(p);
    check('K14 after "Do not show again" a reload does not bring the card back (4.5 s after the scene is ready)', up2 && card3 === 0 && h3?.shown === false && h3?.enabled === false, { cards: card3, hook: h3 });
    // the box is ticked and no card came: the ground still shows how to take off (the mouse is not captured after a reload: the "Click to fly with the
    // mouse" pill would stand on the same place, so the line takes it over)
    const gl3 = await groundLine(p);
    check('K14c with the box ticked and no card, the ground shows the take-off line (drawn) and the "Click to fly with the mouse" pill is not stacked on it',
        up2 && card3 === 0 && !!gl3 && gl3.shown === true && gl3.spokenOnly === false && gl3.text === EN['play.gate.keys'] && gl3.hintShown === false, { ...(gl3 ?? {}) });
    await shot(p, 'k14c-ticked-ground');
    // a pilot who ticked the box has said he knows the keys: no pill in his flight either
    await ev(p, 'h.wallsSwitch.set(false); return 0;');
    await p.keyboard.down('Space');
    await sleep(1500);
    const remOff = await reminderOn(p);
    const armedNow = (await ev<Any>(p, POS)).armed;
    await p.keyboard.up('Space');
    check('K14b after "Do not show again" the first-flight pill does not show either (the drone is flying)', remOff === false && armedNow === true, { reminder: remOff, armed: armedNow }, false);
    // K opens it, with the box ticked; K again closes it
    await p.keyboard.press('KeyK');
    const upK = await cardUp(p, 4000);
    const factsK = upK ? await cardFacts(p) : null;
    check('K15 K opens the card again, whatever the setting says; its box shows the setting (ticked)', upK && factsK?.hideChecked === true && factsK?.kind === 'game', { up: upK, hideChecked: factsK?.hideChecked ?? null });
    if (upK) {
        await shot(p, 'k15-k-reopened');
        await p.keyboard.press('KeyK');
        await sleep(400);
        check('K15b K again closes it and the flight goes on (not paused)', (await cardCount(p)) === 0 && (await ev<Any>(p, 'return s.paused;')) === false, {});
        // Esc closes it, x closes it
        await p.keyboard.press('KeyK');
        await cardUp(p, 3000);
        await p.keyboard.press('Escape');
        await sleep(400);
        check('K15c Esc closes the card (and does not open the pause menu on top)', (await cardCount(p)) === 0 && (await p.locator('.pause-menu, .panel.pause').count()) === 0, {});
    }
    // the pause menu's item
    await p.keyboard.press('Escape');
    await sleep(500);
    const item = p.locator('[data-action="pause.howtofly"]');
    const itemHere = (await item.count()) > 0;
    const itemKeys = itemHere ? await item.first().innerText() : '';
    check('K16 the pause menu has a "How to fly" item with its key K beside it', itemHere && /How to fly/.test(itemKeys) && /K/.test(itemKeys), { itemKeys });
    if (itemHere) {
        await item.first().click();
        const upM = await cardUp(p, 4000);
        const hm = await hook(p);
        check('K16b picking it shows the card (over nothing: the menu is gone), opened from the menu', upM && (hm?.opened ?? []).includes('menu') && (await p.locator('.pause-menu, .panel.pause').count()) === 0, { up: upM, opened: hm?.opened ?? null });
        if (upM) {
            await p.locator('[data-action="htf-close"]').click();
            await sleep(300);
        }
        // with the menu up, K runs the item (app/menu.ts: a key shown beside an item is that item)
        await p.keyboard.press('Escape');
        await sleep(500);
        const menuUp = (await p.locator('.pause-menu').count()) > 0;
        await p.keyboard.press('KeyK');
        const upMK = await cardUp(p, 4000);
        const hmk = await hook(p);
        check('K16c with the menu up, K runs the item: the card opens and the menu is gone', menuUp && upMK && (hmk?.opened ?? []).filter((x: string) => x === 'menu').length >= 2 && (await p.locator('.pause-menu').count()) === 0, { menuUp, up: upMK, opened: hmk?.opened ?? null });
        if (upMK) {
            await p.locator('[data-action="htf-close"]').click();
            await sleep(300);
        } else if (menuUp) {
            await p.keyboard.press('Escape'); // leave the menu so the next step starts from the flight
            await sleep(300);
        }
    }
    // the radio's card: the page pointed at a gamepad source, K pressed
    const radio = await (async () => {
        await ev(p, 'h.controls.source = "gamepad"; return 0;');
        await p.keyboard.press('KeyK');
        const upR = await cardUp(p, 4000);
        if (!upR) return null;
        const f = await cardFacts(p);
        f.armKind = await ev(p, 'return h.controls.view().armKind;');
        await shot(p, 'k17-radio-card');
        await p.keyboard.press('KeyK');
        await sleep(300);
        await ev(p, 'h.controls.source = "keyboard"; return 0;');
        return f;
    })();
    check('K17 for a radio or gamepad the card is the short radio one: sticks, arm, mode switch, N, Esc, K', radio?.kind === 'radio' && JSON.stringify(radio.rows) === JSON.stringify(['sticks', 'arm', 'mode', 'pause', 'next', 'again']), { kind: radio?.kind ?? null, rows: radio?.rows ?? null });
    // review: with no arm set up the card must not invent "CH5"; with one set up it names that one
    check('K17b the radio card\'s arm line invents no channel number: with no arm set up it says "as set up on the Controls screen", else it names the profile\'s own',
        radio?.kind === 'radio' && typeof radio.armText === 'string' && (radio.armKind !== null || radio.armText === EN['play.card.radioArmAny']), { armKind: radio?.armKind ?? null, armText: radio?.armText ?? null });
    const overlapA = await p.evaluate(`window.__overlap`) as Any;
    check('K18 in visits 2 and 3 as well the card came and was never up together with another dialog', up1 && up2 && overlapA.frames === 0, { overlap: overlapA });
    await ctxA.close();
}

// =====================================================================================================================
// B  a phone
// =====================================================================================================================
{
    const ctx = await newContext(browser, { width: 390, height: 844, mobile: true });
    const p = await ctx.newPage();
    await p.goto(url());
    await sleep(1500);
    await p.locator('[data-action="warning-ok"]').click();
    await untilReady(p);
    const up = await cardUp(p);
    const f = up ? await cardFacts(p) : null;
    await sleep(300);
    await shot(p, 'k19-phone-card');
    check('K19 on a phone (touch, no WebHID) the card is the touch one: the two pads, no key caps, "touch a stick to take off"',
        up && f?.kind === 'touch' && f.pads === 2 && f.kbdCount === 0 && /take off/.test(f.text), { kind: f?.kind ?? null, pads: f?.pads ?? null, kbd: f?.kbdCount ?? null });
    check('K19b it fits the phone: inside the screen, Start flying reachable', !!f && f.panelRect.x >= 0 && f.panelRect.right <= f.vw && f.panelRect.bottom <= f.vh && f.startRect.bottom <= f.vh, { panel: f?.panelRect ?? null, start: f?.startRect ?? null, vw: f?.vw ?? null, vh: f?.vh ?? null });
    if (up) {
        const oc = await p.evaluate(`window.__overlap`) as Any;
        await p.locator('[data-action="htf-start"]').tap();
        await sleep(500);
        const after = await ev<Any>(p, 'return { cards: document.querySelectorAll(\'[data-testid="how-to-fly"]\').length, paused: s.paused, source: h.controls.source, pads: document.querySelectorAll(".touch-pad, .touch-root").length };');
        check('K19c tapping Start flying closes it and leaves the touch sticks to fly', after.cards === 0 && after.paused === false && after.source === 'touch' && after.pads > 0, { ...after });
        check('K19d it did not stand over the motion notice or another dialog on the phone either', oc.frames === 0, { overlap: oc });
    } else {
        check('K19c tapping Start flying closes it and leaves the touch sticks to fly', false, { skipped: 'no card came up' });
        check('K19d it did not stand over the motion notice or another dialog on the phone either', false, { skipped: 'no card came up' });
    }
    await ctx.close();
}

// =====================================================================================================================
// C  a short desktop window, Controls closed with x
// =====================================================================================================================
{
    const ctx = await newContext(browser, { width: 900, height: 480 });
    const p = await ctx.newPage();
    await p.goto(url());
    await sleep(1500);
    await p.locator('[data-action="warning-ok"]').click();
    await untilReady(p);
    await sleep(800);
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    const up = await cardUp(p);
    const f = up ? await cardFacts(p) : null;
    await shot(p, 'k20-short-window');
    // the base build's key card hid every key row below 500 px of height; here the pair is on the screen and Start is reachable
    check('K20 closing Controls with x also ends at the card (the keyboard stands in), and in a 900 x 480 window the Space and Shift keys are fully on screen',
        up && f?.kind === 'game' && f.upRect.y >= 0 && f.upRect.bottom <= f.vh && f.downRect.bottom <= f.vh && /Space/.test(f.text) && /Shift/.test(f.text), { kind: f?.kind ?? null, up: f?.upRect ?? null, down: f?.downRect ?? null, vh: f?.vh ?? null });
    check('K20b Start flying is reachable in that window: on the screen, or the card scrolls', !!f && (f.startRect.bottom <= f.vh || f.scrollable), { start: f?.startRect ?? null, scrollable: f?.scrollable ?? null });
    await ctx.close();
}

// =====================================================================================================================
// E  other shapes and languages: the card fits
// =====================================================================================================================
const SHAPES: { id: string; lang: string; width: number; height: number; mobile: boolean; kind: string }[] = [
    { id: 'phone-landscape', lang: 'en', width: 812, height: 375, mobile: true, kind: 'touch' },
    { id: 'phone-ru', lang: 'ru', width: 390, height: 844, mobile: true, kind: 'touch' },
    { id: 'short-pl', lang: 'pl', width: 900, height: 480, mobile: false, kind: 'game' },
    { id: 'desktop-es', lang: 'es', width: 1280, height: 800, mobile: false, kind: 'game' }
];
for (const sh of SHAPES) {
    const ctx = await newContext(browser, { width: sh.width, height: sh.height, mobile: sh.mobile });
    const p = await ctx.newPage();
    await p.goto(url('', sh.lang));
    await sleep(1500);
    await p.locator('[data-action="warning-ok"]').click();
    await untilReady(p);
    if (!sh.mobile) {
        await sleep(800);
        await p.locator('[data-action="radio-keyboard"]').click({ timeout: 15000 });
    }
    const up = await cardUp(p);
    const f = up ? await cardFacts(p) : null;
    const fit = up ? await p.evaluate(`(() => {
        const c = document.querySelector('[data-testid="how-to-fly"]');
        const r = c.getBoundingClientRect();
        const wide = [...c.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > r.right + 1).map((el) => el.className.toString().slice(0, 30)).slice(0, 4);
        return { sideways: c.scrollWidth > c.clientWidth + 1, overflowing: wide, panel: { x: Math.round(r.x), right: Math.round(r.right), bottom: Math.round(r.bottom), top: Math.round(r.y) }, vw: innerWidth, vh: innerHeight, scrollable: c.scrollHeight > c.clientHeight + 1 };
    })()`) as Any : null;
    await shot(p, `k24-${sh.id}`);
    const D = dictOf(sh.lang);
    const startVisible = !!f && f.startRect.bottom <= f.vh && f.startRect.y >= 0;
    const heroOk = sh.kind !== 'game' || (!!f && f.upCaps?.[0] === D['arm.keys.space'] && f.upRect.right <= f.panelRect.right + 1 && f.downRect.right <= f.panelRect.right + 1);
    check(`K24 ${sh.id} (${sh.lang}, ${sh.width} x ${sh.height}): the ${sh.kind} card is up, inside the screen, no sideways scroll, nothing sticks out, Start flying reachable (on the screen or the card scrolls)${sh.kind === 'game' ? ', Space in the page\'s own word' : ''}`,
        up && f?.kind === sh.kind && !!fit && fit.sideways === false && fit.overflowing.length === 0 && fit.panel.x >= 0 && fit.panel.right <= fit.vw && (startVisible || fit.scrollable) && heroOk,
        { kind: f?.kind ?? null, fit, startVisible, upCaps: f?.upCaps ?? null });
    if (sh.kind === 'game') {
        check(`K24b ${sh.id} (${sh.lang}): the card's note names the way off the ground with the page's own word for Space`,
            !!f && f.note.includes(D['arm.keys.space']) && /\bW\b/.test(f.note) && !/\{\w+\}/.test(f.note), { note: f?.note ?? null });
    }
    await ctx.close();
}

// =====================================================================================================================
// D  ?nowarn=1: the page of every older bench
// =====================================================================================================================
{
    const ctx = await newContext(browser, { width: 1280, height: 800 });
    const p = await ctx.newPage();
    await p.goto(url('nowarn=1&set.input.play=pilot'));
    await untilReady(p);
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    await sleep(CONTROL ? 2500 : 4000);
    const h4 = await hook(p);
    check('K21 on a ?nowarn=1 page (the page every older bench uses) the card never opens by itself, the keyboard flies as before', (await cardCount(p)) === 0 && (h4 === null || (h4.shown === false && h4.testPage === true)), { hook: h4 }, false);
    const ground = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="key-card"]'); return c ? { shown: !c.classList.contains('hidden'), title: (c.querySelector('h3') || {}).textContent, rows: c.querySelectorAll('.kc-list li').length } : null; })()`) as Any;
    check('K22 with the pilot profile the ground card of the pilot keyboard is still up (arm steps, the Mode 2 keys)', !!ground && ground.shown === true && ground.title === EN['arm.keys.title'] && ground.rows >= 9, { ground }, false);
    await p.keyboard.press('KeyK');
    const upK = await cardUp(p, CONTROL ? 1500 : 4000);
    check('K21b K still opens it there', upK, {});
    const fp = upK ? await cardFacts(p) : null;
    if (upK) await shot(p, 'k23-pilot-card');
    check('K23 for the pilot keyboard the card is the pilot one: Space arms, W / S throttle, A / D yaw, the arrows tilt, M mode, then R, Esc, N, K; no Space / Shift pair', fp?.kind === 'pilot' && JSON.stringify(fp.rows) === JSON.stringify(['arm', 'throttle', 'yaw', 'sticks', 'mode', 'respawn', 'pause', 'next', 'again']) && fp.upCaps === null, { kind: fp?.kind ?? null, rows: fp?.rows ?? null });
    await ctx.close();
}

await browser.close();

const failed = checks.filter((c) => !c.ok);
const discriminating = checks.filter((c) => c.discriminating);
const control = {
    discriminatingChecks: discriminating.length,
    discriminatingPassed: discriminating.filter((c) => c.ok).map((c) => c.id),
    notDiscriminating: checks.filter((c) => !c.discriminating).map((c) => ({ id: c.id, ok: c.ok }))
};
const summary = CONTROL
    ? { control: true, passed: control.discriminatingPassed.length === 0, ...control }
    : { control: false, passed: failed.length === 0, total: checks.length, failed: failed.map((c) => c.id) };
console.log(JSON.stringify(summary));
const file = writeEvidence(CONTROL ? 'v10-keys-control' : 'v10-keys', {
    site: SITE, scene: SCENE, control: CONTROL, summary, checks,
    notProven: ['a real hand and a real mouse (the click on Start is a Playwright trusted click)', 'a real phone (Chrome touch emulation without WebHID)', 'a real radio or gamepad (the card is pointed at a gamepad source and K pressed)', 'Esc as the browser\'s own release of the mouse']
});
console.log(`evidence: ${file}`);
process.exit(CONTROL ? (summary.passed ? 0 : 1) : (summary.passed ? 0 : 1));
