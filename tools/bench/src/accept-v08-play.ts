// v0.8 lane A acceptance (docs/wip/v08-a.md): easy play with the keyboard and the touch sticks, the quiet
// motor sound and its quick mute, the pilot school, in the built release served locally:
//   SITE=http://localhost:<port> npx tsx src/accept-v08-play.ts
// SITE is required (no default: this bench never runs against the live site by accident). Visible
// system Chrome, the scan drawn (screenshots in evidence/<date>/v08-a/). Each check has a negative
// control: the pilot profile (?set.input.play=pilot) on the same page and size, where the same input
// must NOT start the motors, and the geometry of v0.7's absolute pads for the touch-down check.
// Touch is CDP Input.dispatchTouchEvent (synthetic: the page's own handling is measured, not a real
// tablet's digitiser). The numbers are what the owner asked to see (item 2): the touch stick's travel,
// the frame at which a touch sample reaches the flight (pointermove against pointerrawupdate, which is
// as early as a radio's report is handled), the climb speed and the height hold. The review fixes of
// 2026-10-16 added: K over the ground card, Esc while Shift boosts, a Space tap in the air, full stick
// from a pad's rim, and the flight log's exact replay after the keyboard and the touch flights.
// v0.9 lane B replaced the keyboard scheme, so the K part was cut to what the game scheme left alone (see the K part for
// what was retired and what replaced it); the scheme itself is accept-v09-keys.ts. The touch part is unchanged.
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
/** PLAY_ONLY=K or T: only the keyboard or only the touch part (a re-run of one part; the evidence says which). */
const ONLY = (process.env.PLAY_ONLY ?? '').toUpperCase();
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
/**
 * Easy play's assists are inputs (play/assist.ts): the flight log must replay exactly without them.
 * Save the flight, replay it in the page (verifyLastLog), and plant two changes in one input record
 * halfway through: one LSB of the throttle and a 0.05 roll twitch; each must change the hash.
 */
async function replayCheck(p: Page, label: string): Promise<{ ok: boolean; [k: string]: unknown }> {
    const r = await ev<Any>(p, `const e = h.saveLog(${JSON.stringify(label)}); const v = h.verifyLastLog(); const at = Math.floor(s.sim.tick / 2);
        const lsb = h.verifyLastLog({ atTick: at, channel: 2 }); const tw = h.verifyLastLog({ atTick: at, channel: 0, delta: 0.05 });
        return { saved: e.hash, replayed: v.hash, endTick: v.endTick, lives: v.lives, refused: v.refused ?? null, tamperedAtTick: at, lsb: { was: lsb.tampered, differs: lsb.hash !== v.hash }, twitch: { was: tw.tampered, differs: tw.hash !== v.hash } };`);
    return { ok: r.saved === r.replayed && !!r.saved && !r.refused && r.lsb.differs && r.twitch.differs, ...r };
}

/**
 * When does a touch reach the flight (the owner's item 2: touch vs a radio)? The physics steps only in
 * the page's animation frame (session frame() -> SimClock.advance), and a sample is applied by its own
 * timestamp, so what matters is the frame whose advance takes it: the first advance after its handler
 * ran. Recorded in the page: every advance's time, and for each touch sample (by its timestamp) when a
 * pointerrawupdate listener and a pointermove listener (coalesced samples) saw it. A radio's HID report
 * or a polled gamepad is handled as soon as the main thread is free, as pointerrawupdate is.
 * Control: the same raw sample held to the next animation frame (requestAnimationFrame from its handler,
 * after the engine's own callback) must be measured one frame later.
 */
const TOUCH_FRAMES = `(() => {
    const L = window.__lat = { adv: [], raw: [], move: [], late: [] };
    const c = window.__gsfpv.session.clock;
    const advance = c.advance.bind(c);
    c.advance = (r, now) => { L.adv.push(now); return advance(r, now); };
    for (const el of document.querySelectorAll('.touch-pad')) {
        el.addEventListener('pointerrawupdate', (e) => { const ts = e.timeStamp; L.raw.push([ts, performance.now()]); requestAnimationFrame(() => L.late.push([ts, performance.now()])); }, { capture: true });
        el.addEventListener('pointermove', (e) => { const at = performance.now(); const cs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []; for (const x of (cs.length ? cs : [e])) L.move.push([x.timeStamp, at]); }, { capture: true });
    }
    return 0;
})()`;
interface FrameLog { adv: number[]; raw: [number, number][]; move: [number, number][]; late: [number, number][] }
/** T5's verdict: pointermove and pointerrawupdate reach the flight at the same frame for at least this share of samples. */
const SAME_FRAME_PCT = 95;

/** Per touch sample: the frame (advance time) that takes it, for each listener; compared sample by sample. */
function framesOf(L: FrameLog) {
    const adv = [...L.adv].sort((a, b) => a - b);
    const after = (t: number): number | null => { let lo = 0, hi = adv.length; while (lo < hi) { const m = (lo + hi) >> 1; if (adv[m] > t) hi = m; else lo = m + 1; } return lo < adv.length ? adv[lo] : null; };
    const firstFrame = (rows: [number, number][]): Map<number, number> => {
        const out = new Map<number, number>();
        for (const [ts, handled] of rows) { if (out.has(ts)) continue; const a = after(handled); if (a !== null) out.set(ts, a); }
        return out;
    };
    const raw = firstFrame(L.raw), move = firstFrame(L.move), late = firstFrame(L.late);
    const pct = (a: number[], q: number): number => { const x = [...a].sort((m, n) => m - n); return x.length ? r3(x[Math.min(x.length - 1, Math.floor(x.length * q))]) : NaN; };
    let matched = 0, same = 0, moveLater = 0, moveEarlier = 0, ctl = 0, ctlLater = 0;
    const dRaw: number[] = [], dMove: number[] = [];
    for (const [ts, a] of raw) {
        const m = move.get(ts);
        if (m !== undefined) {
            matched++;
            if (m === a) same++; else if (m > a) moveLater++; else moveEarlier++;
            dRaw.push(a - ts);
            dMove.push(m - ts);
        }
        const l = late.get(ts);
        if (l !== undefined) { ctl++; if (l > a) ctlLater++; }
    }
    const gaps = adv.slice(1).map((v, i) => v - adv[i]);
    const share = (n: number, of: number): number => (of ? Math.round((n / of) * 1000) / 10 : 0);
    return {
        matched, sameFramePct: share(same, matched), moveLaterPct: share(moveLater, matched), moveEarlierPct: share(moveEarlier, matched),
        rawToFlightMs: { p50: pct(dRaw, 0.5), p95: pct(dRaw, 0.95) }, moveToFlightMs: { p50: pct(dMove, 0.5), p95: pct(dMove, 0.95) },
        controlN: ctl, controlLaterPct: share(ctlLater, ctl), framePeriodP50Ms: pct(gaps, 0.5), samples: { raw: L.raw.length, move: L.move.length, frames: adv.length }
    };
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
// v0.9 lane B replaced the keyboard scheme (docs/wip/v09-b.md): the mouse looks, W A S D move, Space goes up and Shift down,
// the arrows tilt nothing, Shift is no boost, Space is no motor key, and the pilot school is for the touch sticks. What the
// scheme does is measured by accept-v09-keys.ts. The v0.8 checks of the old scheme are retired here, each with what replaced it:
// K4 (W tilts 25 deg) by V3, K12 (replay) by V13, K10 (Esc while Shift boosts) by V12c, K11 (Space taps and holds) by V16 and
// V16b. K6 and K7 (the school offer and a throttle that stays, walked on the keyboard) are NOT replaced: the school belongs to
// touch now, its chip is T6 below and its steps are unit-tested (app-play.test.ts), but its offer is no longer walked in a
// browser. Kept: the quiet motor sound and its mute, the pilot profile as the control. v0.10 lane K (docs/wip/v10-k.md) moved the
// game scheme's key card to the How to fly card (accept-v10-keys.ts): K1, K9 and K5 below now say what K does there (no ground
// card for the game scheme, K opens the How to fly card and K again closes it, the flight is held while it is up).
if (ONLY !== 'T') {
    const L = await launch({ width: 1280, height: 800 });
    const p = L.page;
    await keyboardFlight(p, 'x=1');
    const card = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="key-card"]'); return c ? { shown: !c.classList.contains('hidden'), title: c.querySelector('h3')?.textContent } : null; })()`) as Any;
    await p.screenshot({ path: join(SHOTS, 'k-desktop-ground.jpg'), quality: 80 });
    // v0.10: the game scheme has no ground card, its keys are on the How to fly card, which K opens (the page has ?nowarn=1: it
    // does not open by itself here); the corner line names the vertical pair
    const corner = await p.evaluate(`(document.querySelector('.osd.br') || {}).textContent || ''`) as string;
    await p.keyboard.press('KeyK');
    await sleep(500);
    const howToFly = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="how-to-fly"]'); return c ? { kind: c.getAttribute('data-kind'), text: c.textContent.replace(/\\s+/g, ' ') } : null; })()`) as Any;
    const heldByCard = await ev<boolean>(p, 'return s.paused;');
    await p.keyboard.press('KeyK');
    await sleep(400);
    const closedByK = (await p.evaluate(`document.querySelector('[data-testid="how-to-fly"]') === null`)) as boolean;
    const pausedAfter = await ev<boolean>(p, 'return s.paused;');
    check('K1 the game scheme has no ground card; K opens the How to fly card (the flight is held while it is up), K again closes it; the corner line names Space up / Shift down',
        !!card && card.shown === false && howToFly?.kind === 'game' && /Space/.test(howToFly.text) && /Shift/.test(howToFly.text) && heldByCard === true && closedByK && pausedAfter === false && /Space up/.test(corner) && /Shift down/.test(corner),
        { groundCardShown: card?.shown ?? null, how: howToFly?.kind ?? null, heldByCard, closedByK, pausedAfter, corner });
    const before = await ev<boolean>(p, 'return s.sim.armed;');
    const y0 = await ev<number>(p, 'return s.sim.s[1];');
    await p.keyboard.down('Space');
    await sleep(1500);
    const climb = await track(p, 1000);
    await p.keyboard.up('Space');
    const armed = await ev<boolean>(p, 'return s.sim.armed;');
    const climbMps = mean(climb.vy);
    check('K2 Space starts the motors (no arm switch) and climbs at the speed setting (normal: 5 m/s)', !before && armed && Math.abs(climbMps - 5) < 1.5 && climb.y.at(-1)! - y0 > 3, { armedBefore: before, armed, climbMps: r3(climbMps), gainedM: r3(climb.y.at(-1)! - y0) });
    // K9 (K over the ground card) is retired with the ground card: the pilot profile's ground card is checked as K-control below
    await sleep(3000);
    const hold = await track(p, 4000, 200);
    check('K3 keys released: the height holds (altitude help)', spread(hold.y) < 0.4, { spreadM: r3(spread(hold.y)), meanVy: r3(mean(hold.vy)) });
    await p.screenshot({ path: join(SHOTS, 'k-desktop-flying.jpg'), quality: 80 });
    const hidden = await p.evaluate(`document.querySelector('[data-testid="key-card"]').classList.contains('hidden')`);
    await p.keyboard.press('KeyK');
    await sleep(300);
    const shownK = await p.evaluate(`document.querySelector('[data-testid="how-to-fly"]') !== null`);
    await p.screenshot({ path: join(SHOTS, 'k-desktop-keycard-k.jpg'), quality: 80 });
    // Esc closes it (K closing it is K1's check). The K press above is a user activation for 5 s, and closing the card asks for the
    // mouse as every resume of a game-scheme flight does: wait it out so the mouse is not captured over the buttons clicked next
    await sleep(5500);
    await p.keyboard.press('Escape');
    await sleep(400);
    const hiddenAgain = await p.evaluate(`document.querySelector('[data-testid="how-to-fly"]') === null`);
    check('K5 in the air no ground card is up; K opens the How to fly card, Esc closes it', hidden === true && shownK === true && hiddenAgain === true, { groundCardHiddenFlying: hidden, howToFlyAfterK: shownK, closedAfterEsc: hiddenAgain });
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
for (const size of ONLY === 'K' ? [] : SIZES) {
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
    await p.evaluate(TOUCH_FRAMES);
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
    // more touch samples for T5: the left stick wiggled a little sideways (a slow yaw back and forth)
    await touch('touchStart', [{ x: lc.x, y: lc.y, id: 5 }]);
    for (let k = 0; k < 40; k++) { await touch('touchMove', [{ x: lc.x + 0.1 * travel * Math.sin(k / 3), y: lc.y, id: 5 }]); await sleep(9); }
    await touch('touchEnd', []);
    await sleep(300);
    // the right stick forward: the drone tilts and moves
    await touch('touchStart', [{ x: rc.x, y: rc.y, id: 3 }]);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: rc.x, y: rc.y - (0.5 * travel * k) / 6, id: 3 }]); await sleep(16); }
    await sleep(900);
    const pitch = await ev<number>(p, PITCH);
    await p.screenshot({ path: join(SHOTS, `t-${size.name}-flying.jpg`), quality: 80 });
    await touch('touchEnd', []);
    const fr = framesOf(await p.evaluate('window.__lat') as FrameLog);
    check(`T5-${size.name} the right stick at half forward tilts the drone (angle mode); a touch sample reaches the flight at the frame measured for pointermove and for pointerrawupdate (${fr.sameFramePct} % the same frame); control: a sample held to the next animation frame is measured a frame later`,
        pitch > 8 && fr.matched >= 20 && fr.controlLaterPct >= 80 && fr.sameFramePct >= SAME_FRAME_PCT, { pitchDeg: r3(pitch), ...fr });
    // full deflection from a touch-down on the outer rim of the right pad: the finger to the screen's right
    // edge rolls fully, to the bottom edge pitches fully back (the first grab: about a third, by geometry)
    const rim = { x: Rb.x + Rb.width - 4, y: rc.y };
    await touch('touchStart', [{ ...rim, id: 6 }]);
    await sleep(60);
    await touch('touchMove', [{ x: size.w - 6, y: rim.y, id: 6 }]);
    await sleep(80);
    const rollAtEdge = (await ev<number[]>(p, 'return Array.from(h.touch.channels);'))[0];
    await touch('touchEnd', []);
    await sleep(300);
    const rimLow = { x: rc.x, y: Rb.y + Rb.height - 4 };
    await touch('touchStart', [{ ...rimLow, id: 7 }]);
    await sleep(60);
    await touch('touchMove', [{ x: rimLow.x, y: size.h - 6, id: 7 }]);
    await sleep(80);
    const pitchAtEdge = (await ev<number[]>(p, 'return Array.from(h.touch.channels);'))[1];
    await touch('touchEnd', []);
    const firstGrab = { roll: r3((size.w - 6 - rim.x) / travel), pitch: r3(-(size.h - 6 - rimLow.y) / travel) };
    check(`T10-${size.name} from a touch-down on the pad's outer rim the screen's edge is full stick (roll and pitch back); control: the first grab reached ${firstGrab.roll} / ${firstGrab.pitch}`, rollAtEdge > 0.999 && pitchAtEdge < -0.999 && firstGrab.roll < 0.6 && firstGrab.pitch > -0.6, { rollAtRightEdge: r3(rollAtEdge), pitchAtBottomEdge: r3(pitchAtEdge), firstGrab });
    await sleep(1500);
    const chipText = await p.evaluate(`(() => { const c = document.querySelector('[data-testid="school-chip"]'); return c && !c.hidden ? c.textContent : null; })()`);
    check(`T6-${size.name} the pilot school chip is on screen`, typeof chipText === 'string' && /^School 1\/4/.test(chipText), { chip: chipText });
    // layout: the speaker fully on screen, nothing of the school chip, the mode chip, the top buttons, the
    // credit and the OSD lines over another (text never prints over text); controls: the school chip
    // moved onto the top row, and onto the credit's first visible text line, must be reported by the
    // same check (the second proves the credit's text lines are still counted after the visibility filter)
    const LAYOUT = `((moveChip) => {
        const chip = document.querySelector('[data-testid="school-chip"]');
        const keep = { top: chip.style.top, left: chip.style.left };
        const firstCreditLine = () => {
            const tw = document.createTreeWalker(document.querySelector('.attribution'), NodeFilter.SHOW_TEXT);
            for (let t = tw.nextNode(); t; t = tw.nextNode()) {
                if (!t.textContent.trim() || !t.parentElement.checkVisibility({ visibilityProperty: true })) continue;
                const rg = document.createRange(); rg.selectNodeContents(t);
                const r = rg.getClientRects()[0];
                if (r && r.width > 0) return r;
            }
            return null;
        };
        const target = moveChip === 'row' ? document.querySelector('.top-actions').getBoundingClientRect() : moveChip === 'credit' ? firstCreditLine() : null;
        if (target) { chip.style.top = (target.top + 2) + 'px'; chip.style.left = (target.left + 2) + 'px'; }
        // getClientRects, not offsetParent: the speaker is position: fixed on a phone (offsetParent null)
        const items = [...document.querySelectorAll('.top-actions > .btn, [data-testid="school-chip"], .mode-chip, .attribution, .osd.tl, .osd.tr, .touch-hint')]
            .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none')
            // the credit and the hint are wide blocks with a short text: their visible text lines count,
            // not their boxes (the credit's closed walls <details> keeps laid-out, unseen text)
            .flatMap((el) => {
                const n = (el.getAttribute('data-action') || el.getAttribute('data-testid') || el.className).toString().slice(0, 24);
                if (n !== 'attribution' && n !== 'touch-hint') return [{ n, r: el.getBoundingClientRect() }];
                const out = [];
                const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                for (let t = tw.nextNode(); t; t = tw.nextNode()) {
                    if (!t.textContent.trim() || !t.parentElement.checkVisibility({ visibilityProperty: true })) continue;
                    const rg = document.createRange(); rg.selectNodeContents(t);
                    for (const r of rg.getClientRects()) out.push({ n, r });
                }
                return out;
            })
            .filter((x) => x.r.width > 0 && x.r.height > 0);
        const hits = [];
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i].r, b = items[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            // not judged here: the two OSD lines with each other (v0.7's long "WALLS OFF" line meets the
            // voltage on a 375 px phone: reported in docs/wip/v08-a.md, not this lane's part)
            const pair = [items[i].n, items[j].n].sort().join('|');
            const at = (r) => '[' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + ']';
            if (ox > 1 && oy > 1 && pair !== 'osd tl|osd tr' && items[i].n !== items[j].n) hits.push(items[i].n + at(a) + ' x ' + items[j].n + at(b));
        }
        const sp = document.querySelector('[data-action="sound-toggle"]').getBoundingClientRect();
        const speakerOnScreen = sp.left >= 0 && sp.top >= 0 && sp.right <= innerWidth && sp.bottom <= innerHeight && sp.width > 0;
        if (target) { chip.style.top = keep.top; chip.style.left = keep.left; }
        return { hits, speakerOnScreen, moved: !!target };
    })`;
    type Lay = { hits: string[]; speakerOnScreen: boolean; moved: boolean };
    const lay = await p.evaluate(`${LAYOUT}(null)`) as Lay;
    const layCtl = await p.evaluate(`${LAYOUT}('row')`) as Lay;
    const layCredit = await p.evaluate(`${LAYOUT}('credit')`) as Lay;
    await sleep(400); // the chip goes back to its place at the next placement
    const caught = (l: Lay, other: string): boolean => l.moved && l.hits.some((x) => x.includes('school-chip') && x.includes(other));
    check(`T9-${size.name} the speaker is on screen and nothing at the top prints over anything else; controls: the school chip moved onto the buttons, and onto the credit's text, is caught`, lay.speakerOnScreen && lay.hits.length === 0 && caught(layCtl, '[') && caught(layCredit, 'attribution'), { speakerOnScreen: lay.speakerOnScreen, overlaps: lay.hits, control: layCtl.hits, controlCredit: layCredit.hits });
    const view = await p.evaluate(`({ sx: scrollX, sy: scrollY, scale: visualViewport ? visualViewport.scale : 1 })`) as Any;
    check(`T7-${size.name} no scroll or zoom from the touches`, view.sx === 0 && view.sy === 0 && view.scale === 1, view);
    const trep = await replayCheck(p, `v08-play-t-${size.name}`);
    check(`T11-${size.name} the touch flight (auto-arm, altitude help, grab) replays from its log to the same hash; controls: one LSB and a 0.05 stick twitch in one record change it`, trep.ok, trep);
    const errs = T.console.filter((l) => l.startsWith('pageerror'));
    check(`T8-${size.name} no page errors`, errs.length === 0, { errors: errs.slice(0, 5) });
    await T.browser.close();
}

// control: the pilot profile on a tablet: the ARM button is there and a touch on a stick starts nothing
if (ONLY !== 'K') {
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
const file = writeEvidence(ONLY ? `v08-a-play-${ONLY.toLowerCase()}` : 'v08-a-play', { site: SITE, pass, only: ONLY || 'all', checks, shots: 'evidence/' + today() + '/v08-a/', note: 'touch = CDP synthetic touches (the page path, not a real digitiser); keyboard = Playwright key events; the scan drawn (visible system Chrome)' });
console.log(`accept-v08-play ${pass ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length}) -> ${file}`);
process.exit(pass ? 0 : 1);
