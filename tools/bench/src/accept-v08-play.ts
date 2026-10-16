// v0.8 lane A acceptance (docs/wip/v08-a.md): easy play with the keyboard and the touch sticks, the quiet
// motor sound and its quick mute, the pilot school, in the built release served locally:
//   SITE=http://localhost:<port> npx tsx src/accept-v08-play.ts
// SITE is required (no default: this bench never runs against the live site by accident). Visible
// system Chrome, the scan drawn (screenshots in evidence/<date>/v08-a/). Each check has a negative
// control: the pilot profile (?set.input.play=pilot) on the same page and size, where the same input
// must NOT start the motors, and the geometry of v0.7's absolute pads for the touch-down check.
// Touch is CDP Input.dispatchTouchEvent (synthetic: the page's own handling is measured, not a real
// tablet's digitiser). The numbers are what the owner asked to see (item 2): the touch stick's travel,
// the pointer handling delay in the page, the climb speed and the height hold.
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE_RAW = process.env.SITE;
if (!SITE_RAW) throw new Error('accept-v08-play needs SITE=http://localhost:<port> (a local release); it has no default');
const SITE = SITE_RAW.replace(/\/$/, '');
console.log(`accept-v08-play target: ${SITE}`);
const SHOTS = join(REPO, 'evidence', today(), 'v08-a');
mkdirSync(SHOTS, { recursive: true });
const SCENE = '887f27aa';
const fly = (qs: string): string => `${SITE}/en/fly/?scene=${SCENE}&nowarn=1&${qs}&cb=${Math.random().toString(36).slice(2)}`;

/** The English fly dictionary as the page merges it. */
function en(): Record<string, string> {
    const dir = join(REPO, 'packages', 'i18n', 'locales', 'fly');
    const d = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>;
    for (const ns of readdirSync(dir)) if (!ns.endsWith('.json')) Object.assign(d, JSON.parse(readFileSync(join(dir, ns, 'en.json'), 'utf8')));
    return d;
}
const EN = en();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Evaluate code with h = window.__gsfpv and s = its session (a string: tsx wraps functions with __name). */
function ev<T = Any>(p: Page, code: string): Promise<T> {
    return p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${code} })()`) as Promise<T>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Nose-down pitch of the craft, degrees (sim-core attitude(), in the page). */
const PITCH = 'const q = s.sim.s; const qw = q[6], qx = q[7], qy = q[8], qz = q[9]; const r12 = 2 * (qy * qz - qw * qx), r02 = 2 * (qx * qz + qw * qy), r22 = 1 - 2 * (qx * qx + qy * qy); return Math.atan2(r12, Math.hypot(r02, r22)) * 180 / Math.PI;';

const checks: { id: string; ok: boolean; detail: Record<string, unknown> }[] = [];
function check(id: string, ok: boolean, detail: Record<string, unknown> = {}): void {
    checks.push({ id, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`);
}

/** Samples of y and vy every `everyMs` for `ms`. */
async function track(p: Page, ms: number, everyMs = 100): Promise<{ y: number[]; vy: number[] }> {
    const y: number[] = [], vy: number[] = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const r = await ev<{ y: number; vy: number }>(p, 'return { y: s.sim.s[1], vy: s.sim.s[4] };');
        y.push(r.y); vy.push(r.vy);
        await sleep(everyMs);
    }
    return { y, vy };
}
const mean = (a: number[]): number => a.reduce((x, v) => x + v, 0) / Math.max(1, a.length);
const spread = (a: number[]): number => Math.max(...a) - Math.min(...a);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The flight with the keyboard as the input (the first visit's Controls screen closed: the keyboard stands in). */
async function keyboardFlight(p: Page, qs: string): Promise<void> {
    await p.goto(fly(qs));
    const r = await waitReady(p, 240000);
    if (r.status !== 'ready') throw new Error(`flight did not start: ${String(r.status)}`);
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    for (let i = 0; i < 50 && (await ev(p, 'return h.controls.source;')) !== 'keyboard'; i++) await sleep(100);
    await ev(p, 'h.wallsSwitch.set(false); return 0;'); // the palms over the spawn stop a climb (accept-v03-summary S6)
    await sleep(2500); // detail streams in around the spawn
}

// ------------------------------------------------------------------ K: keyboard, easy play, desktop
{
    const L = await launch({ width: 1280, height: 800 });
    const p = L.page;
    await keyboardFlight(p, 'x=1');
    const card = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="key-card"]'); return c ? { shown: !c.classList.contains('hidden'), title: c.querySelector('h3')?.textContent, now: c.querySelector('p.now')?.textContent, rows: c.querySelectorAll('.kc-list li').length } : null; })()`) as Any;
    check('K1 the key card shows on the ground with the game keys and "press a flying key to take off"', !!card && card.shown && card.title === EN['play.keys.title'] && card.now === EN['play.gate.keys'] && card.rows >= 8, card);
    await p.screenshot({ path: join(SHOTS, 'k-desktop-ground.jpg'), quality: 80 });
    const before = await ev<boolean>(p, 'return s.sim.armed;');
    const y0 = await ev<number>(p, 'return s.sim.s[1];');
    await p.keyboard.down('ArrowUp');
    await sleep(1500);
    const climb = await track(p, 1000);
    await p.keyboard.up('ArrowUp');
    const armed = await ev<boolean>(p, 'return s.sim.armed;');
    check('K2 the up arrow starts the motors (no Space) and climbs at about 2.5 m/s', !before && armed && Math.abs(mean(climb.vy) - 2.5) < 0.6 && climb.y.at(-1)! - y0 > 2, { armedBefore: before, armed, climbMps: r3(mean(climb.vy)), gainedM: r3(climb.y.at(-1)! - y0) });
    await sleep(3000);
    const hold = await track(p, 4000, 200);
    check('K3 keys released: the height holds (altitude help)', spread(hold.y) < 0.4, { spreadM: r3(spread(hold.y)), meanVy: r3(mean(hold.vy)) });
    const yW = await ev<number>(p, 'return s.sim.s[1];');
    await p.keyboard.down('KeyW');
    await sleep(1200);
    const pitch = await ev<number>(p, PITCH);
    const fwd = await track(p, 600, 100);
    await p.keyboard.up('KeyW');
    check('K4 W tilts the drone forward about 25 deg and the height holds through it', Math.abs(pitch - 25) < 6 && Math.max(...fwd.y.map((y) => Math.abs(y - yW))) < 1, { pitchDeg: r3(pitch), maxHeightChangeM: r3(Math.max(...fwd.y.map((y) => Math.abs(y - yW)))) });
    await p.screenshot({ path: join(SHOTS, 'k-desktop-flying.jpg'), quality: 80 });
    const hidden = await p.evaluate(`document.querySelector('[data-testid="key-card"]').classList.contains('hidden')`);
    await p.keyboard.press('KeyK');
    await sleep(300);
    const shownK = await p.evaluate(`!document.querySelector('[data-testid="key-card"]').classList.contains('hidden')`);
    await p.screenshot({ path: join(SHOTS, 'k-desktop-keycard-k.jpg'), quality: 80 });
    await p.keyboard.press('KeyK');
    await sleep(300);
    const hiddenAgain = await p.evaluate(`document.querySelector('[data-testid="key-card"]').classList.contains('hidden')`);
    check('K5 in the air the card goes; K shows it, K again hides it', hidden === true && shownK === true && hiddenAgain === true, { hiddenFlying: hidden, shownAfterK: shownK, hiddenAfterK: hiddenAgain });
    // the pilot school: the chip counts, the goal (30 s without a crash) offers step 2
    const chip0 = await p.evaluate(`document.querySelector('[data-testid="school-chip"]')?.textContent ?? null`) as string | null;
    let offer = false;
    for (let i = 0; i < 80 && !offer; i++) { await sleep(500); offer = await p.evaluate(`!document.querySelector('[data-testid="school-offer"]').hidden`) as boolean; }
    const chip1 = await p.evaluate(`document.querySelector('[data-testid="school-chip"]')?.textContent ?? null`) as string | null;
    await p.screenshot({ path: join(SHOTS, 'k-desktop-school-offer.jpg'), quality: 80 });
    if (offer) await p.click('[data-action="school-next"]');
    await sleep(400);
    const step2 = await ev<Any>(p, 'return { help: h.prefs.get("input.altitudeHelp"), mode: h.prefs.get("flight.mode"), play: h.play() };');
    check('K6 the school chip counts toward 30 s; the goal offers step 2, which switches the altitude help off', !!chip0 && /^School 1\/4/.test(chip0) && offer && step2.help === false && step2.mode === 'angle' && step2.play.step === 2, { chipStart: chip0, chipAtGoal: chip1, offer, after: step2 });
    // step 2: the up arrow is a throttle that stays (no help): released, it keeps its value
    await p.keyboard.down('ArrowUp'); await sleep(150); await p.keyboard.up('ArrowUp');
    const t1 = await ev<number>(p, 'return h.play().throttle;');
    await sleep(500);
    const t2 = await ev<number>(p, 'return h.play().throttle;');
    check('K7 without the help the arrows move a throttle that stays where it is left (it took over from the help without a jump)', Math.abs(t1 - t2) < 1e-6 && t1 > step2.play.throttle + 0.05 && !(await ev<boolean>(p, 'return h.play().helpActive;')), { throttleWhenHelpWentOff: r3(step2.play.throttle), throttleAfterRelease: r3(t1), throttle500msLater: r3(t2) });
    await ev(p, 'h.prefs.set("input.altitudeHelp", true); return 0;');
    // the quiet sound and the quick mute
    const vol = await ev<number>(p, 'return h.prefs.get("sound.volume");');
    const m0 = await ev<boolean>(p, 'return h.prefs.get("sound.motors");');
    await p.click('[data-action="sound-toggle"]');
    const m1 = await ev<boolean>(p, 'return h.prefs.get("sound.motors");');
    const pressed = await p.getAttribute('[data-action="sound-toggle"]', 'aria-pressed');
    await p.screenshot({ path: join(SHOTS, 'k-desktop-muted.jpg'), quality: 80 });
    await p.click('[data-action="sound-toggle"]');
    const m2 = await ev<boolean>(p, 'return h.prefs.get("sound.motors");');
    check('S1 the motor sound is 15 % by default; the speaker on the top bar mutes and unmutes it', vol === 15 && m0 === true && m1 === false && pressed === 'true' && m2 === true, { volume: vol, before: m0, afterClick: m1, ariaPressed: pressed, afterSecondClick: m2 });
    const errs = L.console.filter((l) => l.startsWith('pageerror'));
    check('K8 no page errors', errs.length === 0, { errors: errs.slice(0, 5) });
    await L.browser.close();

    // control: the pilot profile on the same page: the up arrow is pitch there and arms nothing; Space is the arm
    const C = await launch({ width: 1280, height: 800 });
    await keyboardFlight(C.page, 'set.input.play=pilot');
    await C.page.keyboard.down('ArrowUp'); await sleep(1500); await C.page.keyboard.up('ArrowUp');
    const pilotArmed = await ev<boolean>(C.page, 'return s.sim.armed;');
    const pilotCard = await C.page.evaluate(`document.querySelector('[data-testid="key-card"] h3')?.textContent ?? null`);
    await C.page.screenshot({ path: join(SHOTS, 'k-desktop-pilot-control.jpg'), quality: 80 });
    check('K-control the pilot profile: the same key does not start the motors, its card is the Mode 2 one', pilotArmed === false && pilotCard === EN['arm.keys.title'], { armed: pilotArmed, cardTitle: pilotCard });
    await C.browser.close();
}

// ------------------------------------------------------------------ T: touch sticks, easy play, tablet and phone
const SIZES = [{ name: 'tablet', w: 1024, h: 768 }, { name: 'phone', w: 375, h: 812 }, { name: 'phone-landscape', w: 812, h: 375 }] as const;
for (const size of SIZES) {
    const T = await launch({ width: size.w, height: size.h, mobile: true });
    const p = T.page;
    await p.goto(fly('input=touch'));
    await waitReady(p, 240000);
    await ev(p, 'h.wallsSwitch.set(false); return 0;');
    await sleep(2000);
    const cdp = await T.context.newCDPSession(p);
    const touch = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: q.id })) });
    const box = async (sel: string) => (await p.locator(sel).boundingBox())!;
    const Lb = await box('.touch-pad.left'), Rb = await box('.touch-pad.right');
    const lc = { x: Lb.x + Lb.width / 2, y: Lb.y + Lb.height / 2 }, rc = { x: Rb.x + Rb.width / 2, y: Rb.y + Rb.height / 2 };
    const travel = Lb.width / 2 - 24;
    const ui = await p.evaluate(`(() => { const a = document.querySelector('.touch-arm'); return { armShown: !!a && getComputedStyle(a).display !== 'none' && !a.hidden, hint: document.querySelector('.touch-hint')?.textContent, gate: document.querySelector('.gate-msg')?.textContent }; })()`) as Any;
    check(`T1-${size.name} easy play: no ARM button, the hint says what the sticks do, "touch a stick to take off"`, !ui.armShown && ui.hint === EN['play.touch.hint.climb'] && ui.gate === EN['play.gate.touch'], { ...ui, padPx: Lb.width, travelPx: travel });
    await p.screenshot({ path: join(SHOTS, `t-${size.name}-ground.jpg`), quality: 80 });
    // the page's handling delay of pointer events (event timestamp -> handler), synthetic touches: the
    // sticks read pointerrawupdate where the browser has it; pointermove (rAF-aligned) is the control
    await p.evaluate(`(() => { window.__lat = { raw: [], move: [] }; for (const el of document.querySelectorAll('.touch-pad')) { el.addEventListener('pointerrawupdate', (e) => window.__lat.raw.push(performance.now() - e.timeStamp), { capture: true }); el.addEventListener('pointermove', (e) => window.__lat.move.push(performance.now() - e.timeStamp), { capture: true }); } })()`);
    // a touch-down off-centre moves no stick (v0.7's absolute pad: the control, by geometry)
    const off = { x: rc.x + 0.5 * travel, y: rc.y - 0.4 * travel };
    await touch('touchStart', [{ ...off, id: 1 }]);
    await sleep(120);
    const chDown = await ev<number[]>(p, 'return Array.from(h.touch.channels);');
    const absolute = [(off.x - rc.x) / travel, -(off.y - rc.y) / travel];
    check(`T2-${size.name} a touch-down off-centre moves no stick; control: v0.7's absolute pad read it as a deflection`, Math.abs(chDown[0]) < 0.01 && Math.abs(chDown[1]) < 0.01 && Math.abs(absolute[0]) > 0.3 && Math.abs(absolute[1]) > 0.3, { chAtTouchDown: chDown.slice(0, 2).map(r3), v07AbsolutePad: absolute.map(r3) });
    await touch('touchEnd', []);
    await sleep(300);
    const armedByTouch = await ev<boolean>(p, 'return s.sim.armed;');
    // the left stick up: climb; released: it springs back and the height holds
    const y0 = await ev<number>(p, 'return s.sim.s[1];');
    await touch('touchStart', [{ x: lc.x, y: lc.y, id: 2 }]);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: lc.x, y: lc.y - (0.6 * travel * k) / 6, id: 2 }]); await sleep(16); }
    await sleep(1500);
    const climb = await track(p, 1000);
    await touch('touchEnd', []);
    const ch = await ev<number[]>(p, 'return Array.from(h.touch.channels);');
    check(`T3-${size.name} a touch starts the motors; the left stick at 60 % climbs about 1.5 m/s; released, it springs to centre`, armedByTouch && Math.abs(mean(climb.vy) - 1.5) < 0.5 && climb.y.at(-1)! - y0 > 1 && Math.abs(ch[2]) < 1e-6, { armedByTouch, climbMps: r3(mean(climb.vy)), gainedM: r3(climb.y.at(-1)! - y0), leftStickAfterRelease: ch[2] });
    await sleep(2500);
    const hold = await track(p, 3000, 200);
    check(`T4-${size.name} the height holds with no finger on the sticks`, spread(hold.y) < 0.4, { spreadM: r3(spread(hold.y)) });
    // the right stick forward: the drone tilts and moves
    await touch('touchStart', [{ x: rc.x, y: rc.y, id: 3 }]);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: rc.x, y: rc.y - (0.5 * travel * k) / 6, id: 3 }]); await sleep(16); }
    await sleep(900);
    const pitch = await ev<number>(p, PITCH);
    await p.screenshot({ path: join(SHOTS, `t-${size.name}-flying.jpg`), quality: 80 });
    await touch('touchEnd', []);
    const lat = await p.evaluate(`({ raw: window.__lat.raw.slice(), move: window.__lat.move.slice(), frameMs: (() => { const f = window.__gsfpv.session.frameStats(); return f.p50; })() })`) as { raw: number[]; move: number[]; frameMs: number };
    const pct = (a: number[], q: number): number => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(x.length * q))] : NaN; };
    const raw50 = pct(lat.raw, 0.5), move50 = pct(lat.move, 0.5);
    check(`T5-${size.name} the right stick at half forward tilts the drone (angle mode); moves are read from pointerrawupdate, earlier than the rAF-aligned pointermove (control)`, pitch > 8 && lat.raw.length > 5 && raw50 < move50, { pitchDeg: r3(pitch), pageFrameP50Ms: r3(lat.frameMs), rawupdate: { n: lat.raw.length, p50: r3(raw50), p95: r3(pct(lat.raw, 0.95)) }, pointermoveControl: { n: lat.move.length, p50: r3(move50), p95: r3(pct(lat.move, 0.95)) } });
    const chipText = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="school-chip"]'); return c && !c.hidden ? c.textContent : null; })()`);
    check(`T6-${size.name} the pilot school chip is on screen`, typeof chipText === 'string' && /^School 1\/4/.test(chipText), { chip: chipText });
    // layout: the speaker fully on screen, nothing of the school chip, the mode chip, the top buttons, the
    // credit and the OSD lines over another (text never prints over text); control: the school chip
    // moved onto the top row must be reported by the same check
    const LAYOUT = `((moveChip) => {
        const ui = document.getElementById('ui');
        const chip = document.querySelector('[data-testid="school-chip"]');
        const keep = chip.style.top;
        if (moveChip) { const row = document.querySelector('.top-actions').getBoundingClientRect(); chip.style.top = (row.top + 2) + 'px'; chip.style.left = (row.left + 2) + 'px'; }
        // getClientRects, not offsetParent: the speaker is position: fixed on a phone (offsetParent null)
        const items = [...document.querySelectorAll('.top-actions > .btn, [data-testid="school-chip"], .mode-chip, .attribution, .osd.tl, .osd.tr, .touch-hint')]
            .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none')
            // the credit is a wide block with a short text: its text lines count, not its box
            .flatMap((el) => {
                const n = (el.getAttribute('data-action') || el.getAttribute('data-testid') || el.className).toString().slice(0, 24);
                if (n !== 'attribution' && n !== 'touch-hint') return [{ n, r: el.getBoundingClientRect() }];
                const rg = document.createRange(); rg.selectNodeContents(el);
                return [...rg.getClientRects()].map((r) => ({ n, r }));
            })
            .filter((x) => x.r.width > 0 && x.r.height > 0);
        const hits = [];
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].r, b = items[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // not judged here: the two OSD lines with each other (v0.7's long "WALLS OFF" line meets the
            // voltage on a 375 px phone: reported in docs/wip/v08-a.md, not this lane's part)
            const pair = [items[i].n, items[j].n].sort().join('|');
            if (ox > 1 && oy > 1 && pair !== 'osd tl|osd tr' && items[i].n !== items[j].n) hits.push(items[i].n + ' x ' + items[j].n);
        }
        const sp = document.querySelector('[data-action="sound-toggle"]').getBoundingClientRect();
        const speakerOnScreen = sp.left >= 0 && sp.top >= 0 && sp.right <= innerWidth && sp.bottom <= innerHeight && sp.width > 0;
        if (moveChip) chip.style.top = keep;
        return { hits, speakerOnScreen };
    })`;
    const lay = await p.evaluate(`${LAYOUT}(false)`) as { hits: string[]; speakerOnScreen: boolean };
    const layCtl = await p.evaluate(`${LAYOUT}(true)`) as { hits: string[]; speakerOnScreen: boolean };
    await sleep(400); // the chip goes back to its place at the next placement
    check(`T9-${size.name} the speaker is on screen and nothing at the top prints over anything else; control: the school chip moved onto the buttons is caught`, lay.speakerOnScreen && lay.hits.length === 0 && layCtl.hits.some((x) => x.includes('school-chip')), { speakerOnScreen: lay.speakerOnScreen, overlaps: lay.hits, control: layCtl.hits });
    const view = await p.evaluate(`({ sx: scrollX, sy: scrollY, scale: visualViewport ? visualViewport.scale : 1 })`) as Any;
    check(`T7-${size.name} no scroll or zoom from the touches`, view.sx === 0 && view.sy === 0 && view.scale === 1, view);
    const errs = T.console.filter((l) => l.startsWith('pageerror'));
    check(`T8-${size.name} no page errors`, errs.length === 0, { errors: errs.slice(0, 5) });
    await T.browser.close();
}

// control: the pilot profile on a tablet: the ARM button is there and a touch on a stick starts nothing
{
    const T = await launch({ width: 1024, height: 768, mobile: true });
    const p = T.page;
    await p.goto(fly('input=touch&set.input.play=pilot'));
    await waitReady(p, 240000);
    await sleep(1500);
    const cdp = await T.context.newCDPSession(p);
    const Lb = (await p.locator('.touch-pad.left').boundingBox())!;
    const lc = { x: Lb.x + Lb.width / 2, y: Lb.y + Lb.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lc.x, y: lc.y + (Lb.width / 2 - 24), id: 1 }] });
    await sleep(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const armed = await ev<boolean>(p, 'return s.sim.armed;');
    const armShown = await p.evaluate(`(() => { const a = document.querySelector('.touch-arm'); return !!a && getComputedStyle(a).display !== 'none'; })()`);
    await p.screenshot({ path: join(SHOTS, 't-tablet-pilot-control.jpg'), quality: 80 });
    check('T-control the pilot profile: the ARM button is shown and a touch on a stick starts no motor', armed === false && armShown === true, { armed, armShown });
    await T.browser.close();
}

const pass = checks.every((c) => c.ok);
const file = writeEvidence('v08-a-play', { site: SITE, pass, checks, shots: 'evidence/' + today() + '/v08-a/', note: 'touch = CDP synthetic touches (the page path, not a real digitiser); keyboard = Playwright key events; the scan drawn (visible system Chrome)' });
console.log(`accept-v08-play ${pass ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length}) -> ${file}`);
process.exit(pass ? 0 : 1);
