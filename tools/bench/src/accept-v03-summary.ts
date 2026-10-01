// W2-4 acceptance (docs/architecture-v03.md D.4, item 7): the stats card after a switch disarm, the
// summary panel that replaced the pause menu, the keymap's keys in it and in flight, the lifetime
// totals per drone across a reload, and the old pause menu's items. Fresh Playwright contexts on
// system Chrome only, never a pilot's profile. Every check has a negative control that must fire.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5324 npx tsx src/accept-v03-summary.ts [S1 ... S6]
// S1-S5 are flight logic and UI flow: they open the logic-only mode ?render=off (tools/bench/README.md).
// S6 is visual (layout on a desktop and a phone, screenshots): it draws the scan, under the GPU
// lock C:/dev/.gpu-lock (the owner's PC also renders video), only with >= 2500 MiB of VRAM free.
// Evidence: evidence/<date>/v03-summary.json, screenshots in evidence/<date>/v03-summary/.
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { S } from '../../../packages/sim-core/src/index';
import type { KeyBinding } from '../../../packages/prefs/src/keymap';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5324').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const LOGIC = `scene=${SCENE}&nowarn=1&render=off`;
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v03-summary');
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ev = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The menu of v0.2 / wave 1, in order: the summary panel must keep every item, its data-action and its place. */
const MENU = ['pause.continue', 'pause.restart', 'pause.scene', 'pause.drone', 'pause.radio', 'pause.settings', 'pause.replays', 'pause.measure', 'pause.import', 'pause.cinema'];
/** Menu items that run a keymap action (MenuItem.action): the item shows that action's keys. */
const MENU_ACTION: Record<string, string> = { 'pause.continue': 'pause.toggle', 'pause.restart': 'respawn.start' };
const SHIPPED = KEYMAP.filter((b) => b.status === 'shipped');
const PLANNED = KEYMAP.filter((b) => b.status !== 'shipped');

/** m:ss.t (or h:mm:ss) back to seconds. */
function parseClock(s: string): number {
    const parts = s.trim().split(':').map(Number);
    return parts.reduce((a, x) => a * 60 + x, 0);
}

// ------------------------------------------------------------------ the page

async function newContext(browser: Browser, w = 1280, hgt = 800): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
    return ctx;
}

/** A flight with the keyboard as the input: the Controls screen of a first visit closed with its x (the keyboard stands in). */
async function openFlight(ctx: BrowserContext, qs = LOGIC): Promise<Page> {
    const p = await ctx.newPage();
    await p.goto(fly(qs));
    const r = await waitReady(p, 240000);
    if (r.status !== 'ready') throw new Error(`flight did not start: ${String(r.status)} ${String(r.error ?? '')}`);
    await keyboardInput(p);
    return p;
}

async function keyboardInput(p: Page): Promise<void> {
    await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
    for (let i = 0; i < 40 && (await ev(p, 'return h.controls.source;')) !== 'keyboard'; i++) await sleep(100);
}

/** Throttle to zero (S), arm (Space), climb (W 250 ms: about half throttle), stay up until this life has `seconds` of air, disarm (Space). Walls must be off. */
async function flyAndDisarm(p: Page, seconds: number): Promise<{ armed: boolean; lifeAtDisarm: number }> {
    await p.keyboard.down('KeyS'); await sleep(450); await p.keyboard.up('KeyS');
    await p.keyboard.press('Space');
    let armed = false;
    for (let i = 0; i < 20 && !armed; i++) { await sleep(50); armed = await ev(p, 'return s.sim.armed;'); }
    await p.keyboard.down('KeyW'); await sleep(250); await p.keyboard.up('KeyW');
    for (let i = 0; i < 400; i++) {
        if ((await ev<number>(p, 'return h.stats().life.airtimeS;')) >= seconds) break;
        await sleep(50);
    }
    await p.keyboard.press('Space');
    await sleep(150);
    return { armed, lifeAtDisarm: await ev<number>(p, 'return h.stats().life.airtimeS;') };
}

const CARD = '[data-testid="osd-stats"]';
async function cardInfo(p: Page): Promise<{ shown: boolean; title: string; lines: number; airtime: string; rows: Record<string, string> }> {
    return ev(p, `const c = document.querySelector('${CARD}');
        if (!c) return { shown: false, title: '', lines: 0, airtime: '', rows: {} };
        const rows = {};
        for (const r of c.querySelectorAll('[data-stat]')) rows[r.dataset.stat] = r.querySelector('dd').textContent;
        return { shown: true, title: c.querySelector('.os-title').textContent, lines: c.querySelectorAll('[data-stat]').length, airtime: rows.airtime ?? '', rows };`);
}

/** What the open panel shows: menu items with their caps, the shortcut rows, the stats table, the mode chip, the focus. */
async function panelInfo(p: Page): Promise<Any> {
    return ev(p, `const panel = document.querySelector('.pause-menu');
        if (!panel) return null;
        const caps = (el) => [...el.querySelectorAll('kbd')].map((k) => k.textContent);
        return {
            items: [...panel.querySelectorAll('.sum-menu [data-action]')].map((b) => ({ id: b.dataset.action, caps: caps(b), aria: b.getAttribute('aria-keyshortcuts'), testid: b.dataset.testid ?? null })),
            contact: (() => { const a = panel.querySelector('.sum-menu a'); return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null; })(),
            keys: [...panel.querySelectorAll('[data-key-action]')].map((li) => ({ action: li.dataset.keyAction, caps: caps(li), aria: li.getAttribute('aria-keyshortcuts') })),
            stats: [...panel.querySelectorAll('[data-testid="summary-stats"] tbody tr')].map((tr) => ({ id: tr.dataset.stat, life: tr.querySelector('[data-col=life]').textContent, session: tr.querySelector('[data-col=session]').textContent, lifetime: tr.querySelector('[data-col=lifetime]').textContent, visible: tr.getClientRects().length > 0 })),
            mode: panel.querySelector('[data-testid="summary-mode"]')?.dataset.mode ?? null,
            focused: document.activeElement?.dataset?.action ?? document.activeElement?.tagName ?? null
        };`);
}

/** The keymap's caps and aria of a binding, as the page must show them. */
const capsOf = (b: KeyBinding) => b.keys.map((k) => k.cap);
const ariaOf = (b: KeyBinding) => b.keys.map((k) => k.aria).join(' ');

/** Every shipped binding in the panel with its caps; no planned one; the menu items that run an action show its caps. */
function panelKeyProblems(info: Any, map: readonly KeyBinding[] = KEYMAP): string[] {
    const out: string[] = [];
    for (const b of map.filter((x) => x.status === 'shipped')) {
        const row = info.keys.find((k: Any) => k.action === b.action);
        if (!row) { out.push(`${b.action}: not in the panel`); continue; }
        if (JSON.stringify(row.caps) !== JSON.stringify(capsOf(b))) out.push(`${b.action}: caps ${row.caps.join(',')} != ${capsOf(b).join(',')}`);
        if (row.aria !== ariaOf(b)) out.push(`${b.action}: aria "${row.aria}" != "${ariaOf(b)}"`);
    }
    for (const b of map.filter((x) => x.status !== 'shipped')) if (info.keys.some((k: Any) => k.action === b.action)) out.push(`${b.action}: planned but shown`);
    for (const [id, action] of Object.entries(MENU_ACTION)) {
        const it = info.items.find((x: Any) => x.id === id);
        const b = map.find((x) => x.action === action)!;
        if (!it) out.push(`${id}: no menu item`);
        else if (JSON.stringify(it.caps) !== JSON.stringify(capsOf(b)) || it.aria !== ariaOf(b)) out.push(`${id}: caps ${it.caps.join(',')} / aria "${it.aria}" != ${action}'s`);
    }
    return out;
}

// ------------------------------------------------------------------ the key loop (S3)

/** What each shipped action changes on the page, and what it may change besides (a new flight model disarms, a respawn is logged). */
const PROBES: Record<string, { field: string; also?: string[]; restore: number }> = {
    'pause.toggle': { field: 'menu', restore: 1 },
    'respawn.start': { field: 'atSpawn', also: ['armed'], restore: 0 },
    'mode.cycle': { field: 'mode', restore: 1 },
    'arm.toggle': { field: 'armed', also: ['atSpawn'], restore: 1 },
    'voxels.cycle': { field: 'voxel', restore: 2 },
    'walls.toggle': { field: 'walls', also: ['armed', 'mode', 'atSpawn'], restore: 1 },
    'hud.toggle': { field: 'hudOff', restore: 1 },
    'frameStats.toggle': { field: 'frame', restore: 1 }
};
const SNAP = `return {
    menu: !!document.querySelector('.pause-menu'),
    // a respawn between ticks is not a runner event (sim-core runner.ts emits what a step produced): the craft parked at the spawn instead
    atSpawn: Math.hypot(s.sim.s[${S.px}] - h.info.spawn[0], s.sim.s[${S.py}] - h.info.spawn[1], s.sim.s[${S.pz}] - h.info.spawn[2]) < 1e-3,
    mode: s.sim.ch[5],
    armed: s.sim.armed,
    voxel: h.voxels.stats().mode,
    walls: h.wallsSwitch.on(),
    hudOff: document.querySelector('#ui').classList.contains('hud-off'),
    frame: !document.querySelector('.osd.frame').classList.contains('hidden')
};`;
const pw = (k: { code: string; shift?: boolean }) => (k.shift ? `Shift+${k.code}` : k.code);

async function keyLoop(p: Page, bindings: readonly KeyBinding[]): Promise<{ ok: boolean; results: Any[] }> {
    const results: Any[] = [];
    for (const b of bindings) {
        const probe = PROBES[b.action];
        for (const k of b.keys) {
            if (!probe) { results.push({ action: b.action, key: pw(k), ok: false, why: 'no probe for this action: add one' }); continue; }
            const before = await ev(p, SNAP);
            await p.keyboard.press(pw(k));
            await sleep(300);
            const after = await ev(p, SNAP);
            const changed = Object.keys(before).filter((f) => before[f] !== after[f]);
            const ok = changed.includes(probe.field) && changed.every((f) => f === probe.field || (probe.also ?? []).includes(f));
            let restored: boolean | null = null;
            for (let i = 0; i < probe.restore; i++) { await p.keyboard.press(pw(k)); await sleep(300); }
            if (probe.restore > 0) restored = (await ev(p, SNAP))[probe.field] === before[probe.field];
            results.push({ action: b.action, key: pw(k), flying: !!b.flying, expect: probe.field, changed, ok: ok && restored !== false, restored });
        }
    }
    return { ok: results.length > 0 && results.every((r) => r.ok), results };
}

// ------------------------------------------------------------------ the menu items (S5)

/** Anything an item can do: the panel closed, another panel or screen up, the page's classes, the flight model restarted, another page. */
const EFFECT = `return {
    panel: !!document.querySelector('.pause-menu'),
    other: [...document.querySelectorAll('#ui .panel:not(.pause-menu), #ui .screen')].map((e) => e.className).join('|'),
    body: document.body.className,
    tick: s && s.sim ? s.sim.tick : -1,
    paused: s ? s.paused : null,
    href: location.href
};`;
async function openPanel(p: Page): Promise<void> {
    if (!(await p.locator('.pause-menu').count())) await p.keyboard.press('Escape');
    await p.locator('.pause-menu').waitFor({ timeout: 3000 });
}

// ------------------------------------------------------------------ the GPU lock (S6)

const LOCK = 'C:/dev/.gpu-lock';
let haveLock = false;
function vramFree(): number | null {
    try {
        const [used, total] = execSync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits').toString().trim().split('\n')[0].split(',').map((x) => Number(x.trim()));
        return total - used;
    } catch { return null; }
}
async function withGpu<T>(fn: () => Promise<T>): Promise<{ result: T; vramFreeMiB: number | null }> {
    for (;;) {
        try { mkdirSync(LOCK); haveLock = true; break; } catch {
            try { if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) { rmdirSync(LOCK); continue; } } catch { /* gone meanwhile */ }
            console.log('waiting for the GPU lock');
            await sleep(10000);
        }
    }
    try {
        let free = vramFree();
        while (free !== null && free < 2500) { console.log(`VRAM free ${free} MiB < 2500: waiting`); await sleep(10000); free = vramFree(); }
        return { result: await fn(), vramFreeMiB: free };
    } finally {
        try { rmdirSync(LOCK); } catch { /* */ }
        haveLock = false;
    }
}
process.on('SIGINT', () => { if (haveLock) try { rmdirSync(LOCK); } catch { /* */ } process.exit(130); });

// ------------------------------------------------------------------ run

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, keymapShipped: SHIPPED.map((b) => ({ action: b.action, keys: b.keys.map((k) => pw(k)), flying: !!b.flying })) };

try {
    // -------------------------------------------------------------- S1 the card, S2 the panel, S3 the keys (one page)
    if (want('S1') || want('S2') || want('S3')) {
        const ctx = await newContext(browser);
        const p = await openFlight(ctx);
        await ev(p, 'h.wallsSwitch.set(false); return 0;'); // nothing to crash into: a disarm is the only way the flight ends
        const render = await ev(p, 'return h.info.render;');

        if (want('S1')) {
            const f1 = await flyAndDisarm(p, 4);
            await p.locator(CARD).waitFor({ timeout: 3000 }).catch(() => undefined);
            const card = await cardInfo(p);
            const st = await ev(p, "return { life: h.stats().life, disarm: [...h.events].reverse().find((e) => e.type === 'disarm') ?? null };");
            const dAir = card.shown ? Math.abs(parseClock(card.airtime) - st.life.airtimeS) : null;
            await p.screenshot({ path: join(SHOTS, 'card-1280-render-off.jpg'), type: 'jpeg', quality: 80 });
            // any key takes it away (Q: bound to nothing)
            await p.keyboard.press('KeyQ');
            await sleep(250);
            const goneOnKey = (await p.locator(CARD).count()) === 0;
            // second flight: Enter opens the summary panel, the first item takes the focus and is not pressed by that Enter
            await flyAndDisarm(p, st.life.airtimeS + 3.2);
            const card2 = (await p.locator(CARD).count()) === 1;
            await p.keyboard.press('Enter');
            await sleep(400);
            const enter = { panel: (await p.locator('.pause-menu').count()) === 1, card: await p.locator(CARD).count(), focused: (await panelInfo(p))?.focused ?? null };
            await p.keyboard.press('Escape'); // Continue
            await sleep(300);
            const closedByEsc = (await p.locator('.pause-menu').count()) === 0;
            // a new life (R) with under 3 s in the air: no card (the 3 s rule in the page)
            await p.keyboard.press('KeyR');
            await sleep(300);
            const short = await flyAndDisarm(p, 1.5);
            await sleep(800);
            const shortCard = await p.locator(CARD).count();
            const pass = f1.armed && card.shown && st.disarm?.reason === 'switch' && dAir !== null && dAir <= 0.1 && card.lines >= 8 && card.lines <= 10 && card.title === '--- STATS ---'
                && goneOnKey && card2 && enter.panel && enter.card === 0 && enter.focused === 'pause.continue' && closedByEsc && short.lifeAtDisarm < 3 && shortCard === 0;
            out.S1 = { pass, render, what: 'fly with the keyboard (walls off), disarm with the switch after 4 s: the card shows, its air time is within 0.1 s of __gsfpv.stats().life.airtimeS; any key closes it; Enter opens the summary panel with the first item focused (not pressed); a life under 3 s shows no card', flight: f1, card, life: { airtimeS: st.life.airtimeS }, disarm: st.disarm, airtimeDiffS: dAir, goneOnKey, secondCard: card2, enter, closedByEsc, shortLife: { airtimeS: short.lifeAtDisarm, card: shortCard } };
            console.log('S1', pass ? 'PASS' : 'FAIL', JSON.stringify({ card: card.airtime, life: st.life.airtimeS, dAir, goneOnKey, enter, shortCard }));
        }

        if (want('S2')) {
            await openPanel(p);
            const info = await panelInfo(p);
            const problems = panelKeyProblems(info);
            const life = await ev(p, 'return h.stats().life;');
            const ch5 = await ev<number>(p, 'return s.sim.ch[5];');
            const simMode = ch5 > 0.5 ? 'angle' : ch5 > -0.5 ? 'horizon' : 'acro';
            const air = info.stats.find((r: Any) => r.id === 'airtime');
            await p.click('[data-action="stats-copy"]');
            await sleep(300);
            const clip = await p.evaluate('navigator.clipboard.readText()') as string;
            const copied = await p.locator('[data-testid="stats-copied"]').innerText();
            await p.screenshot({ path: join(SHOTS, 'panel-1280-render-off.jpg'), type: 'jpeg', quality: 80 });
            await p.keyboard.press('Escape');
            await sleep(300);
            const pass = problems.length === 0 && info.keys.length === SHIPPED.length && info.stats.length === 16 && info.stats.every((r: Any) => r.visible)
                && Math.abs(parseClock(air.life) - life.airtimeS) <= 0.1 && info.mode === simMode
                && clip.startsWith('ShramkoGSFPV flight stats') && clip.includes('Air time') && clip.split('\n').length >= 18 && copied === 'Copied';
            // control: the same comparison against a keymap with one cap changed must find exactly that
            const wrong = KEYMAP.map((b) => (b.action === 'hud.toggle' ? { ...b, keys: [{ code: 'KeyJ', cap: 'J', aria: 'J' }] } : b));
            const ctrl = panelKeyProblems(info, wrong);
            const fired = ctrl.length > 0 && ctrl.every((x) => x.startsWith('hud.toggle'));
            out.S2 = { pass: pass && fired, render, what: 'Esc opens the summary panel: every shipped KEYMAP action with its key-caps (and aria-keyshortcuts), no planned one, Continue and Restart with their keys; 16 stat rows (this flight, session, all time) with the life air time; the mode chip = the mode the flight model flies; Copy stats puts the table on the clipboard', problems, shown: info.keys, items: info.items, mode: { chip: info.mode, simChannel: ch5, sim: simMode }, airtime: { panel: air, hook: life.airtimeS }, copy: { status: copied, lines: clip.split('\n').length, head: clip.split('\n').slice(0, 3) }, control: { what: 'the same check against a keymap whose hud.toggle is J', problems: ctrl, fired } };
            console.log('S2', out.S2.pass ? 'PASS' : 'FAIL', JSON.stringify({ problems, mode: out.S2.mode, ctrl }));
        }

        if (want('S3')) {
            await p.keyboard.down('KeyS'); await sleep(450); await p.keyboard.up('KeyS'); // throttle 0: Space can arm
            const loop = await keyLoop(p, SHIPPED);
            // control: a wrong binding in the page's own keymap (the module the router and the panel read): H and V swapped
            const injected = await ev(p, `const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\\/packages\\/prefs\\/src\\/keymap\\.ts(\\?|$)/.test(n));
                if (!url) return { url: null };
                const m = await import(url);
                const H = m.KEYMAP.find((b) => b.action === 'hud.toggle'), V = m.KEYMAP.find((b) => b.action === 'voxels.cycle');
                const k = H.keys; H.keys = V.keys; V.keys = k;
                return { url, hud: H.keys.map((x) => x.code), voxels: V.keys.map((x) => x.code) };`);
            const bad = await keyLoop(p, SHIPPED.filter((b) => b.action === 'hud.toggle' || b.action === 'voxels.cycle'));
            await openPanel(p);
            const badPanel = panelKeyProblems(await panelInfo(p));
            const fired = injected.url !== null && !bad.ok && bad.results.every((r) => !r.ok) && badPanel.some((x) => x.startsWith('hud.toggle')) && badPanel.some((x) => x.startsWith('voxels.cycle'));
            out.S3 = { pass: loop.ok && fired, render, what: 'with the panel closed, every key of every shipped KEYMAP binding (looping over the table, keyboard flying keys included) does what its row in the panel says: exactly that action\'s effect on the page, and pressed again it goes back', results: loop.results, control: { what: "a deliberately wrong binding in the page's own keymap module (H and V swapped): the loop and the panel check must both fail", injected, loop: bad.results, panelProblems: badPanel, fired } };
            console.log('S3', out.S3.pass ? 'PASS' : 'FAIL', JSON.stringify(loop.results.map((r) => `${r.key}:${r.ok ? 'ok' : 'BAD ' + r.changed.join('+')}`)), 'control', fired);
        }
        await ctx.close();
    }

    // -------------------------------------------------------------- S4 lifetime totals across a reload
    if (want('S4')) {
        const ctx = await newContext(browser);
        const p = await openFlight(ctx);
        await ev(p, 'h.wallsSwitch.set(false); return 0;');
        await flyAndDisarm(p, 4);
        const a = await ev(p, "return { lifetime: h.stats().lifetime, drone: h.stats().drone };");
        await ev(p, 'h.prefs.flush(); return 0;');
        await p.reload();
        await waitReady(p, 240000);
        await keyboardInput(p);
        const b = await ev(p, "return { lifetime: h.stats().lifetime, stored: h.prefs.export().collections.stats.byDrone[h.stats().drone] ?? null };");
        await openPanel(p);
        const panelAir = (await panelInfo(p)).stats.find((r: Any) => r.id === 'airtime').lifetime;
        await ctx.close();
        // control: a fresh context (another browser profile) starts at zero
        const c = await newContext(browser);
        const q = await openFlight(c);
        const fresh = await ev(q, "return { lifetime: h.stats().lifetime, stored: h.prefs.export().collections.stats.byDrone[h.stats().drone] ?? null };");
        await c.close();
        const same = (x: Any, y: Any) => x.flights === y.flights && x.crashes === y.crashes && Math.abs(x.airtimeS - y.airtimeS) < 1e-6 && Math.abs(x.distanceM - y.distanceM) < 1e-6;
        const pass = a.lifetime.airtimeS >= 3.9 && a.lifetime.flights === 1 && same(a.lifetime, b.lifetime) && b.stored && same(a.lifetime, b.stored) && Math.abs(parseClock(panelAir) - a.lifetime.airtimeS) <= 0.1;
        const fired = fresh.lifetime.airtimeS === 0 && fresh.lifetime.flights === 0 && fresh.stored === null;
        out.S4 = { pass: pass && fired, what: "a 4 s flight goes into the drone's lifetime totals (prefs collection 'stats'); after a reload the totals, the stored collection and the panel's All time column are the same", before: a, afterReload: b, panelAllTimeAirtime: panelAir, control: { what: 'a fresh browser context starts at zero', fresh, fired } };
        console.log('S4', out.S4.pass ? 'PASS' : 'FAIL', JSON.stringify({ a: a.lifetime, b: b.lifetime, fresh: fresh.lifetime }));
    }

    // -------------------------------------------------------------- S5 the pause menu's items, data-actions, keyboard navigation
    if (want('S5')) {
        const ctx = await newContext(browser);
        const p = await openFlight(ctx);
        await sleep(1200); // some flight-model time, so Restart can be seen restarting it
        await openPanel(p);
        const info = await panelInfo(p);
        const order = info.items.map((x: Any) => x.id);
        // keyboard: the first item has the focus, Down walks the menu in order and wraps, Up goes back, Tab goes on
        const walk: string[] = [];
        for (let i = 0; i < MENU.length + 1; i++) {
            await p.keyboard.press('ArrowDown');
            walk.push(await p.evaluate('document.activeElement?.dataset?.action ?? document.activeElement?.getAttribute("href")') as string);
        }
        await p.keyboard.press('ArrowUp');
        const up = await p.evaluate('document.activeElement?.getAttribute("href") ?? document.activeElement?.dataset?.action') as string;
        await p.keyboard.press('ArrowDown'); // back on Continue
        await p.keyboard.press('Tab');
        const tab = await p.evaluate('document.activeElement?.dataset?.action') as string;
        // Enter on a focused item runs it: Down to Measurements, Enter
        await p.keyboard.press('Shift+Tab');
        for (let i = 0; i < MENU.indexOf('pause.measure'); i++) await p.keyboard.press('ArrowDown');
        const onMeasure = await p.evaluate('document.activeElement?.dataset?.action') as string;
        await p.keyboard.press('Enter');
        await sleep(400);
        const enterRan = await ev(p, EFFECT);
        await p.keyboard.press('Escape'); // Esc over a panel opened from the menu closes it
        await sleep(300);
        const escClosed = await ev(p, EFFECT);
        const expectWalk = [...MENU.slice(1), `/en/#contact`, MENU[0]];
        const nav = { walk, expectWalk, up, tab, onMeasure, enterOpened: enterRan.other, escClosed: escClosed.other === '' && !escClosed.panel };
        const navOk = JSON.stringify(walk) === JSON.stringify(expectWalk) && up === '/en/#contact' && tab === 'pause.restart' && onMeasure === 'pause.measure' && /panel/.test(enterRan.other) && !enterRan.panel && nav.escClosed;

        // each item does what it did: click it from a fresh panel, look, put things back
        const items: Record<string, Any> = {};
        const look = async (id: string, check: (b: Any, a: Any) => boolean, back?: () => Promise<void>) => {
            await openPanel(p);
            const b = await ev(p, EFFECT);
            await p.click(`.pause-menu [data-action="${id}"]`);
            await sleep(500);
            const a = await ev(p, EFFECT);
            items[id] = { ok: check(b, a), before: { ...b, href: undefined }, after: { ...a, href: undefined } };
            if (back) await back();
            await sleep(300);
        };
        const closeX = async () => { await p.locator('#ui .panel:not(.pause-menu) .panel-x').last().click(); };
        await look('pause.continue', (b, a) => !a.panel && a.paused === false);
        await sleep(800);
        await look('pause.restart', (b, a) => !a.panel && a.tick < b.tick);
        await look('pause.drone', (b, a) => /drones/.test(a.other), async () => { await p.keyboard.press('Escape'); });
        await look('pause.radio', (b, a) => /radio/.test(a.other), async () => { await p.click('[data-action="radio-close"]'); });
        for (const id of ['pause.settings', 'pause.replays', 'pause.measure', 'pause.import']) await look(id, (b, a) => /panel/.test(a.other) && !a.panel, closeX);
        await look('pause.cinema', (b, a) => !/cinema/.test(b.body) && /cinema/.test(a.body), async () => { await openPanel(p); await p.click('.pause-menu [data-action="pause.cinema"]'); });
        // control: a planted button in the menu that does nothing is caught by the same look
        await openPanel(p);
        const b0 = await ev(p, EFFECT);
        await ev(p, "const b = document.createElement('button'); b.type = 'button'; b.className = 'btn block'; b.dataset.action = 'planted-inert'; b.textContent = 'Planted'; document.querySelector('.pause-menu .sum-menu').append(b); return 0;");
        await p.click('[data-action="planted-inert"]');
        await sleep(500);
        const a0 = await ev(p, EFFECT);
        const did = (b: Any, a: Any) => b.panel !== a.panel || b.other !== a.other || b.body !== a.body || a.tick < b.tick || b.href !== a.href;
        const planted = { didSomething: did(b0, a0) };
        // Change scan last: it leaves the flight for the picker
        await p.keyboard.press('Escape');
        await sleep(300);
        await openPanel(p);
        await p.click('.pause-menu [data-action="pause.scene"]');
        await p.waitForURL((u) => !u.search.includes('scene='), { timeout: 15000 }).catch(() => undefined);
        const picker = await waitReady(p, 60000).catch(() => ({ status: 'timeout' }));
        items['pause.scene'] = { ok: picker.status === 'picker', status: picker.status };
        await ctx.close();
        const everyItem = MENU.every((id) => items[id]?.ok === true) && Object.values(items).every((x) => x.ok);
        const everyDid = Object.entries(items).filter(([id]) => id !== 'pause.scene').every(([, x]) => did(x.before, x.after) || x.ok);
        const pass = JSON.stringify(order) === JSON.stringify(MENU) && info.contact?.href === '/en/#contact' && info.contact?.target === '_blank' && info.focused === 'pause.continue' && navOk && everyItem && everyDid;
        out.S5 = { pass: pass && !planted.didSomething, what: 'the summary panel keeps every pause-menu item with its data-action, in order, and the contact link; the first item has the focus, Down / Up walk the menu (wrapping), Tab goes on, Enter runs the focused item, Esc closes what it opened; every item does what it did', order, contact: info.contact, nav, items, control: { what: 'a planted button in the menu that does nothing: the same look must find nothing happened', planted, fired: !planted.didSomething } };
        console.log('S5', out.S5.pass ? 'PASS' : 'FAIL', JSON.stringify({ order, nav, items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.ok])), planted }));
    }

    // -------------------------------------------------------------- S6 the scan drawn: layout on a desktop and a phone, screenshots
    if (want('S6')) {
        const LAYOUT = `const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom }; };
            const vw = innerWidth, vh = innerHeight;
            const inside = (b) => !!b && b.x >= -0.5 && b.y >= -0.5 && b.r <= vw + 0.5 && b.b <= vh + 0.5;
            const hit = (a, b) => !!a && !!b && a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
            const card = r(document.querySelector('${CARD}'));
            const tops = [...document.querySelectorAll('.top-actions, .osd.tl, .osd.tr')].filter((e) => e.getClientRects().length).map(r);
            const panel = document.querySelector('.pause-menu');
            const pr = r(panel);
            const btns = panel ? [...panel.querySelectorAll('.sum-menu .btn')].map(r) : [];
            const overlaps = [];
            for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (hit(btns[i], btns[j])) overlaps.push([i, j]);
            const cols = panel ? ['.sum-stats', '.sum-menu', '.sum-keys'].map((q) => r(panel.querySelector(q))) : [];
            return {
                vw, vh,
                card: card ? { box: card, inside: inside(card), hitsTop: tops.some((t) => hit(card, t)) } : null,
                panel: panel ? { box: pr, inside: inside(pr), hOverflow: panel.scrollWidth - panel.clientWidth, statRows: [...panel.querySelectorAll('[data-testid="summary-stats"] tbody tr')].filter((tr) => tr.getClientRects().length).length,
                    buttonOverlaps: overlaps.length, buttonsInside: btns.every((b) => b.x >= pr.x - 0.5 && b.r <= pr.r + 0.5), hitsTop: tops.some((t) => hit(pr, t)), cols } : null
            };`;
        const run = async (w: number, hgt: number) => {
            const ctx = await newContext(browser, w, hgt);
            const p = await openFlight(ctx, `scene=${SCENE}&nowarn=1`);
            const info = await ev(p, 'return { render: h.info.render, gpuSort: h.info.gpuSort, webgpu: h.info.webgpu };');
            await ev(p, 'h.wallsSwitch.set(false); return 0;');
            await flyAndDisarm(p, 3.5);
            await p.locator(CARD).waitFor({ timeout: 3000 }).catch(() => undefined);
            await sleep(400); // the fade-in
            const cardLayout = await ev(p, LAYOUT);
            await p.screenshot({ path: join(SHOTS, `card-${w}.jpg`), type: 'jpeg', quality: 80 });
            await openPanel(p);
            await sleep(500);
            const panelLayout = await ev(p, LAYOUT);
            await p.screenshot({ path: join(SHOTS, `panel-${w}.jpg`), type: 'jpeg', quality: 80 });
            // control: a planted style (a stats table wider than any screen, menu buttons pulled onto each other) must be seen
            await ev(p, "const st = document.createElement('style'); st.textContent = '.sum-table { min-width: 1400px; } .summary .sum-menu .btn.block { margin: -24px 0; }'; document.head.append(st); return 0;");
            await sleep(200);
            const planted = await ev(p, LAYOUT);
            await ctx.close();
            return { info, card: cardLayout.card, panel: panelLayout.panel, planted: { hOverflow: planted.panel?.hOverflow ?? null, buttonOverlaps: planted.panel?.buttonOverlaps ?? null } };
        };
        const { result, vramFreeMiB } = await withGpu(async () => ({ desktop: await run(1280, 800), phone: await run(375, 812) }));
        const okCard = (c: Any) => !!c && c.inside && !c.hitsTop;
        const okPanel = (x: Any, rows: number) => !!x && x.inside && x.hOverflow <= 1 && x.statRows === rows && x.buttonOverlaps === 0 && x.buttonsInside && !x.hitsTop;
        const d = result.desktop, ph = result.phone;
        const threeCols = d.panel?.cols?.length === 3 && d.panel.cols.every(Boolean) && d.panel.cols[0].r <= d.panel.cols[1].x + 1 && d.panel.cols[1].r <= d.panel.cols[2].x + 1;
        const drawn = d.info.render === 'on' && ph.info.render === 'on';
        const pass = drawn && okCard(d.card) && okCard(ph.card) && okPanel(d.panel, 16) && okPanel(ph.panel, 4) && threeCols;
        const fired = [d, ph].every((x) => (x.planted.hOverflow ?? 0) > 1 && (x.planted.buttonOverlaps ?? 0) > 0);
        out.S6 = { pass: pass && fired, vramFreeMiB, what: 'scan drawn: the card and the panel inside the viewport, clear of the top buttons and the OSD corner lines, no horizontal overflow, menu buttons not overlapping; desktop 1280x800: 16 stat rows in three columns (stats | menu | keys); phone 375x812: the 4 main stat rows in one column', desktop: d, phone: ph, threeCols, shots: ['card-1280.jpg', 'panel-1280.jpg', 'card-375.jpg', 'panel-375.jpg'].map((f) => `evidence/${today()}/v03-summary/${f}`), control: { what: 'a planted style (stats table 1400 px wide, menu buttons with -24 px margins) must be seen as a horizontal overflow and as overlapping buttons', desktop: d.planted, phone: ph.planted, fired } };
        console.log('S6', out.S6.pass ? 'PASS' : 'FAIL', JSON.stringify({ d: { card: d.card, panel: d.panel }, ph: { card: ph.card, panel: ph.panel }, fired }));
    }
} finally {
    await browser.close();
}

const ran = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].filter((k) => out[k]);
out.ran = ran;
out.pass = ran.length > 0 && ran.every((k) => out[k].pass === true);
console.log('evidence', writeEvidence(ONLY.length && ONLY.length < 6 ? `v03-summary-${ONLY.join('-').toLowerCase()}` : 'v03-summary', out));
