// v0.5 UX acceptance (the owner's message 16, items 1-6), in the real page. Every check has a
// negative control that must fire; screenshots of each new UI at 1280 and 375 px with an overlap
// check (evidence/<date>/v05-ux/*.png).
//   W1 walls: one choice for every scan. In-page switches (A -> B -> C) with the walls switched off
//      on A: the new session flies without a contact world and the OSD tag says off at every step,
//      tag and flight agree both ways. Physical: the bot pilot dashes into a wall on another scan
//      in the same browser profile and flies through it (no crash). Controls: C on B turns the
//      walls on (tag gone, contact world back); a fresh profile's bot crashes on the same dash.
//   W2 Settings "?" toggletip: no title placeholder; hover shows the description after the delay
//      (not before), leaving hides it; keyboard focus shows it; a click pins it, Esc closes only
//      the tip (control: the next Esc closes Settings); a tap on a phone shows it inside the screen.
//   W3 "Clean floating voxels": the panel from the Settings row; the grid previews the slider's N
//      (the worker's red pieces = the panel's count), the line follows the slider, Clean applies the
//      suggested N; closing gives the pilot's grid back. Control: two N give two different counts.
//   W4 recording dot: shown with the time while recording, blinking (steady with reduced motion
//      and while held), the menu item says "Recording m:ss - stop" / "Start recording", cinema mode
//      hides the dot and its bar says Stop, a click on the dot stops. Control: no dot before.
//   W5 scene size x100: the craft keeps its place, a ray to a wall is 100x as long (within one
//      scaled voxel), the far clip reaches the scaled scan, the row says "m blocks" with the
//      warning, Shift+] doubles. Controls: x1's far clip would cut the scan; ] alone is x1.1.
//   W6 stats forever: a later browser on the same profile has the totals; "Save my stats" downloads
//      CSV and JSON with every drone and the total; an exported file restores them in a fresh
//      profile. Control: the fresh profile is empty before the import.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5352 npx tsx src/accept-v05-ux.ts [W1 W2 ...]
// Evidence: evidence/<date>/v05-ux.json.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { pickBrowser } from './chrome.mjs';
import { REPO, today, waitForExpr, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5352').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const A = '39e63ce9', B = '7a475d38', C = '887f27aa';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v05-ux');
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which };
const errors: string[] = [];

async function ctxOf(b: Browser, o: { w?: number; h?: number; mobile?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await b.newContext({ viewport: { width: o.w ?? 1280, height: o.h ?? 800 }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    return { ctx, page };
}

async function go(p: Page, qs: string): Promise<void> {
    await p.goto(fly(qs));
    const r = await waitReady(p, 240000);
    if (r.status !== 'ready') throw new Error(`page not ready: ${JSON.stringify(r).slice(0, 300)}`);
    await hook(p, 'return s.visible.then(() => 0);');
}

/** Visible elements among `sel` whose boxes overlap another one's (a pair each), and any box outside the window. */
async function layout(p: Page, sel: string[]): Promise<{ overlaps: string[]; outside: string[] }> {
    return p.evaluate(`(() => {
        const sel = ${JSON.stringify(sel)}; const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
        const boxes = [];
        for (const s of sel) for (const el of document.querySelectorAll(s)) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') boxes.push({ s, r }); }
        const overlaps = [], outside = [];
        for (let i = 0; i < boxes.length; i++) {
            const a = boxes[i].r;
            if (a.left < -1 || a.top < -1 || a.right > vw + 1 || a.bottom > vh + 1) outside.push(boxes[i].s);
            for (let j = i + 1; j < boxes.length; j++) {
                const b = boxes[j].r;
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (w > 2 && h > 2) overlaps.push(boxes[i].s + ' x ' + boxes[j].s);
            }
        }
        return { overlaps, outside };
    })()`) as Promise<{ overlaps: string[]; outside: string[] }>;
}

async function shot(p: Page, name: string): Promise<string> {
    const w = p.viewportSize()?.width ?? 0;
    const file = join(SHOTS, `${name}-${w}.png`);
    await p.screenshot({ path: file });
    return file.slice(REPO.length + 1).replace(/\\/g, '/');
}

const record = (id: string, data: Record<string, unknown> & { pass: boolean }) => {
    out[id] = data;
    console.log(id, data.pass ? 'PASS' : 'FAIL', JSON.stringify(data).slice(0, 700));
};

// ------------------------------------------------------------------ W1 walls: one choice for every scan
if (want('W1')) {
    const LOOK = `return { scene: new URL(location.href).searchParams.get('scene'), walls: s.walls, world: !!s.sim.world, tag: !!document.querySelector('[data-testid=hud-walls-off]'), stored: h.prefs.get('scene.walls', { scene: new URL(location.href).searchParams.get('scene') }), explicit: h.prefs.isExplicit('scene.walls') };`;
    const { ctx, page: p } = await ctxOf(browser);
    await go(p, `scene=${A}&nowarn=1&input=touch&render=off`);
    await p.waitForTimeout(400);
    const steps: Any[] = [];
    const look = async (step: string) => { await p.waitForTimeout(400); steps.push({ step, ...(await hook(p, LOOK)) }); };
    await look('A start');
    await p.mouse.click(640, 300);
    await p.keyboard.press('KeyC');
    await look('A after C');
    const switched1 = await hook<boolean>(p, `return h.scenes.load('${B}', 'next');`);
    await look('B after the switch');
    await p.keyboard.press('KeyC');
    await look('B after C (control: on)');
    await p.keyboard.press('KeyC');
    await look('B after C again');
    const switched2 = await hook<boolean>(p, `return h.scenes.load('${C}', 'next');`);
    await look('C after the switch');
    await hook(p, 'h.prefs.flush(); return 0;');
    // physical: the same profile, another scan, the bot pilot dashes into a wall
    const dash = async (q: Page) => {
        await go(q, `scene=${B}&simradio=scenario&quick=1&render=off&nowarn=1&set.respawn.auto=0`);
        const t0 = Date.now();
        let r: Any = null;
        while (Date.now() - t0 < 25000) {
            r = await hook(q, `return { crashed: s.sim.crashed, crashes: h.stats().session.crashes, walls: s.walls, world: !!s.sim.world, tag: !!document.querySelector('[data-testid=hud-walls-off]'), phase: h.scenario?.phase ?? null, speed: Math.hypot(s.sim.s[3], s.sim.s[4], s.sim.s[5]) };`);
            if (r.crashed || r.crashes > 0 || r.phase === 'done') break;
            await q.waitForTimeout(250);
        }
        return { ...r, ms: Date.now() - t0 };
    };
    const q = await ctx.newPage();
    q.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    const off = await dash(q);
    await ctx.close();
    const fresh = await ctxOf(browser);
    const on = await dash(fresh.page);
    await fresh.ctx.close();
    const agree = steps.every((x) => x.tag === (x.walls === 'off') && x.world === (x.walls === 'on'));
    const byStep = Object.fromEntries(steps.map((x) => [x.step, x.walls]));
    const pass = switched1 && switched2 && agree && byStep['A start'] === 'on' && byStep['A after C'] === 'off' && byStep['B after the switch'] === 'off'
        && byStep['B after C again'] === 'off' && byStep['C after the switch'] === 'off' && steps.every((x) => x.stored === x.walls)
        && off.walls === 'off' && off.tag === true && off.world === false && off.crashes === 0 && !off.crashed;
    const control = { stepOn: byStep['B after C (control: on)'], freshBot: on, fired: byStep['B after C (control: on)'] === 'on' && on.walls === 'on' && (on.crashed || on.crashes > 0) };
    record('W1', { pass: pass && control.fired, what: 'walls off on one scan stay off on the next (in-page switches and a later page), the tag and the flight agree at every step; the bot flies through a wall with them off', steps, botWallsOff: off, control });
}

// ------------------------------------------------------------------ W2 Settings help toggletip
if (want('W2')) {
    const TIP = '[data-testid="setting-scene.walls"] .tip-btn';
    const state = (p: Page) => p.evaluate(`(() => { const b = document.querySelector('${TIP}'); const t = document.getElementById(b.getAttribute('aria-describedby'));
        const r = t.getBoundingClientRect();
        return { shown: !t.hidden && r.width > 0, pinned: b.getAttribute('aria-expanded') === 'true', text: t.textContent, role: t.getAttribute('role'), title: b.getAttribute('title'), name: b.getAttribute('aria-label'),
            box: [r.left, r.top, r.right, r.bottom].map(Math.round), vw: document.documentElement.clientWidth, settings: !!document.querySelector('.panel.settings'), focused: document.activeElement === b }; })()`) as Promise<Any>;
    const { ctx, page: p } = await ctxOf(browser);
    await go(p, `scene=${A}&nowarn=1&input=touch&render=off&open=settings&focus=scene.walls`);
    await p.waitForSelector(TIP);
    const help = (JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'set', 'en.json'), 'utf8')) as Record<string, string>)['set.scene.walls.help'];
    await p.hover(TIP);
    await p.waitForTimeout(100);
    const early = await state(p);
    await p.waitForTimeout(450);
    const hovered = await state(p);
    await p.mouse.move(5, 795);
    await p.waitForTimeout(450);
    const left = await state(p);
    // the keyboard: Shift+Tab from the row's control lands on "?"
    await p.focus('[data-testid="setting-scene.walls"] .sr-control button, [data-testid="setting-scene.walls"] .sr-control select, [data-testid="setting-scene.walls"] .sr-control input');
    await p.keyboard.press('Shift+Tab');
    await p.waitForTimeout(150);
    const focused = await state(p);
    await p.keyboard.press('Tab');
    await p.click(TIP);
    await p.mouse.move(5, 795);
    await p.waitForTimeout(600);
    const pinned = await state(p);
    const shot1280 = await shot(p, 'w2-toggletip');
    const lay1280 = await layout(p, ['.tip']);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    const esc = await state(p);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    const escAgain = await p.evaluate("!!document.querySelector('.panel.settings')");
    await ctx.close();
    // a phone: a tap shows it, inside the screen
    const m = await ctxOf(browser, { w: 375, h: 812, mobile: true });
    await go(m.page, `scene=${A}&nowarn=1&input=touch&render=off&open=settings&focus=scene.walls`);
    await m.page.waitForSelector(TIP);
    await m.page.tap(TIP);
    await m.page.waitForTimeout(300);
    const tapped = await state(m.page);
    const shot375 = await shot(m.page, 'w2-toggletip');
    const lay375 = await layout(m.page, ['.tip']);
    await m.ctx.close();
    const pass = !!help && hovered.shown && hovered.text === help && hovered.role === 'tooltip' && hovered.title === null && !hovered.pinned
        && !left.shown && focused.focused && focused.shown && pinned.shown && pinned.pinned && !esc.shown && esc.settings
        && tapped.shown && tapped.pinned && tapped.box[0] >= 0 && tapped.box[2] <= tapped.vw && lay375.outside.length === 0 && lay1280.outside.length === 0;
    const control = { beforeDelay: early.shown, settingsAfterSecondEsc: escAgain, fired: early.shown === false && escAgain === false };
    record('W2', { pass: pass && control.fired, what: 'the "?" shows the description on hover (after the delay), keyboard focus and tap; a click pins it; Esc closes the tip first; no title placeholder; inside the screen at 375 px', help, hovered, left, focused, pinned, esc, tapped, layout: { 1280: lay1280, 375: lay375 }, shots: [shot1280, shot375], control });
}

// ------------------------------------------------------------------ W3 Clean floating voxels
if (want('W3')) {
    const PANEL = `const st = h.voxels.stats(); const pn = h.floaters.panel(); const e = document.querySelector('[data-testid=floaters-effect]');
        return { panel: pn, grid: { state: st.state, mode: st.mode, preview: st.preview, floaters: st.floaters, settled: h.voxels.settled(), chunks: st.chunks }, effect: e ? e.textContent : null,
            applied: s.floaterMinBlocks, stored: h.prefs.get('scene.dropFloaters', { scene: '${A}' }), splat: s.renderer.splatVisible, open: !!document.querySelector('[data-testid=floaters-panel]') };`;
    const settle = async (p: Page, n: number) => {
        await waitForExpr(p, `(() => { const st = window.__gsfpv.voxels.stats(); return st.preview === ${n} && st.state === 'ready' && window.__gsfpv.voxels.settled(); })()`, { timeout: 60000, polling: 250 });
        return hook(p, PANEL);
    };
    const piecesIn = (text: string | null) => Number((text ?? '').match(/:\s*([\d\s  ,.]+)\s*·/)?.[1]?.replace(/[^\d]/g, '') ?? NaN);
    const { ctx, page: p } = await ctxOf(browser);
    await go(p, `scene=${A}&nowarn=1&input=touch&open=settings&focus=scene.dropFloaters`);
    const row = await p.textContent('[data-testid=floaters-row-effect]');
    const before = await hook(p, PANEL);
    await p.click('[data-testid="setting-scene.dropFloaters"] [data-action=floaters-open]');
    await p.waitForSelector('[data-testid=floaters-panel]');
    const sug = (await hook(p, 'return h.floaters.panel();')).suggested as number;
    const atSug = await settle(p, sug);
    const shot1280 = await shot(p, 'w3-floaters');
    const lay1280 = await layout(p, ['[data-testid=floaters-panel]', '.top-actions', '.osd.tl', '.osd.tr', '.osd.bl', '.attribution', '.touch-pad', '.cinema-bar', '.bake-box']);
    await p.evaluate("(() => { const r = document.getElementById('fl-n'); r.value = '10'; r.dispatchEvent(new Event('input', { bubbles: true })); })()");
    const at10 = await settle(p, 10);
    await p.click('[data-action=floaters-clean]');
    await p.waitForTimeout(400);
    const cleaned = await hook(p, PANEL);
    await p.click('[data-action=floaters-close]');
    await waitForExpr(p, 'window.__gsfpv.voxels.stats().preview === null', { timeout: 10000 });
    await p.waitForTimeout(300);
    const closed = await hook(p, PANEL);
    await ctx.close();
    const m = await ctxOf(browser, { w: 375, h: 812, mobile: true });
    await go(m.page, `scene=${A}&nowarn=1&input=touch`);
    await hook(m.page, 'h.floaters.open(); return 0;');
    await settle(m.page, (await hook(m.page, 'return h.floaters.panel();')).value);
    const shot375 = await shot(m.page, 'w3-floaters');
    const lay375 = await layout(m.page, ['[data-testid=floaters-panel]', '.top-actions', '.osd.tl', '.osd.tr']);
    await m.ctx.close();
    // the row says what the stored value (0 on a fresh profile) drops: nothing
    const pass = row === 'Off: every piece stays a wall.' && sug > 1 && atSug.panel.value === sug && atSug.grid.mode === 'off' && atSug.grid.state === 'ready' && atSug.grid.chunks > 0
        && piecesIn(atSug.effect) === atSug.grid.floaters && piecesIn(at10.effect) === at10.grid.floaters
        && cleaned.applied === sug && cleaned.stored === sug
        && closed.grid.preview === null && closed.grid.state === 'off' && closed.splat === true && !closed.open && lay1280.outside.length === 0 && lay375.outside.length === 0;
    const control = { piecesAtSuggested: atSug.grid.floaters, piecesAt10: at10.grid.floaters, gridBefore: before.grid.state, fired: atSug.grid.floaters !== at10.grid.floaters && before.grid.state === 'off' };
    record('W3', { pass: pass && control.fired, what: 'the panel previews N on the scan (the worker\'s red pieces = the line\'s count), the line follows the slider, Clean applies the suggested N, closing gives the pilot\'s grid back', row, suggested: sug, atSug, at10, cleaned, closed, layout: { 1280: lay1280, 375: lay375 }, shots: [shot1280, shot375], control });
}

// ------------------------------------------------------------------ W4 the recording dot
if (want('W4')) {
    const DOT = `const d = document.querySelector('[data-testid=rec-dot]'); const i = d.querySelector('.rec-dot-i');
        return { recording: h.rec.state().recording, shown: !d.hidden && d.getClientRects().length > 0, label: d.getAttribute('aria-label'), text: d.textContent, anim: getComputedStyle(i).animationName, held: d.classList.contains('held'),
            bar: document.querySelector('[data-action=cinema-rec]')?.textContent ?? null };`;
    const { ctx, page: p } = await ctxOf(browser);
    await go(p, `scene=${A}&nowarn=1&input=touch`);
    await p.waitForTimeout(500);
    const before = await hook(p, DOT);
    await p.click('[data-action=cinema-rec]');
    await p.waitForTimeout(2600);
    const rec = await hook(p, DOT);
    const shot1280 = await shot(p, 'w4-rec-dot');
    const lay1280 = await layout(p, ['[data-testid=rec-dot]', '.top-actions .btn:not(.rec-dot)', '.osd.tl', '.osd.tr', '.mode-chip', '.touch-hint', '.attribution']);
    await p.keyboard.press('KeyP');
    await p.waitForSelector('[data-action="pause.record"]');
    const menuOn = await p.textContent('[data-action="pause.record"] .pm-label');
    const heldDot = await hook(p, DOT);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    await hook(p, 'h.cinema.toggle(); return 0;');
    await p.waitForTimeout(300);
    const cinema = await hook(p, DOT);
    await hook(p, 'h.cinema.toggle(); return 0;');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.waitForTimeout(200);
    const reduced = await hook(p, DOT);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.click('[data-testid=rec-dot]');
    await waitForExpr(p, '!window.__gsfpv.rec.state().recording && !window.__gsfpv.rec.state().busy', { timeout: 30000 });
    const stopped = await hook(p, DOT);
    await p.keyboard.press('KeyP');
    await p.waitForSelector('[data-action="pause.record"]');
    const menuOff = await p.textContent('[data-action="pause.record"] .pm-label');
    await ctx.close();
    const m = await ctxOf(browser, { w: 375, h: 812, mobile: true });
    await go(m.page, `scene=${A}&nowarn=1&input=touch`);
    await hook(m.page, 'h.rec.start(); return 0;');
    await m.page.waitForTimeout(2200);
    const phone = await hook(m.page, DOT);
    const shot375 = await shot(m.page, 'w4-rec-dot');
    const lay375 = await layout(m.page, ['[data-testid=rec-dot]', '.top-actions .btn:not(.rec-dot)', '.osd.tl', '.osd.tr', '.mode-chip', '.touch-hint', '.attribution']);
    await hook(m.page, 'return h.rec.stop().then(() => 0);');
    await m.ctx.close();
    const pass = rec.recording && rec.shown && /^Recording, 0:0[0-4]\. Stop recording$/.test(rec.label) && rec.anim === 'rec-blink'
        && /Recording 0:0\d — stop/.test(menuOn ?? '') && heldDot.held && cinema.recording && !cinema.shown && /Stop/.test(cinema.bar ?? '')
        && reduced.anim === 'none' && !stopped.recording && !stopped.shown && /^Start recording$/.test((menuOff ?? '').trim())
        && phone.shown && lay1280.overlaps.length === 0 && lay375.overlaps.length === 0 && lay375.outside.length === 0;
    const control = { before, fired: before.shown === false && before.recording === false };
    record('W4', { pass: pass && control.fired, what: 'a blinking red dot with the time while recording (steady when held or with reduced motion), a click stops; the menu item says the state; cinema mode hides the dot and its bar says Stop', rec, menuOn, heldDot, cinema, reduced, stopped, menuOff, phone, layout: { 1280: lay1280, 375: lay375 }, shots: [shot1280, shot375], control });
}

// ------------------------------------------------------------------ W5 scene size up to x100
if (want('W5')) {
    const PICK = `const p = s.sim.s; let best = null;
        for (const d of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,0],[0,-1,0]]) {
            const n = Math.hypot(...d); const hit = s.collision.queryRay(p[0], p[1], p[2], d[0] / n, d[1] / n, d[2] / n, 20);
            if (!hit) continue; const r = Math.hypot(hit.x - p[0], hit.y - p[1], hit.z - p[2]);
            if (r > 0.3 && (!best || r < best.r)) best = { d, r };
        } return best;`;
    const STATE = (d: number[]) => `const p = s.sim.s; const d = ${JSON.stringify(d)}; const n = Math.hypot(...d);
        const hit = s.collision.queryRay(p[0], p[1], p[2], d[0] / n, d[1] / n, d[2] / n, 6000);
        const c = s.collision; const r = c.voxelResolution; const cam = s.renderer.camera.getPosition(); let far = 0;
        for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) { let x = c.gridMinX + i * c.numVoxelsX * r, y = c.gridMinY + j * c.numVoxelsY * r, z = c.gridMinZ + k * c.numVoxelsZ * r; if (c.flipXY) { x = -x; y = -y; } far = Math.max(far, Math.hypot(x - cam.x, y - cam.y, z - cam.z)); }
        const ls = s.renderer.splat.getLocalScale();
        return { size: h.scale.size(), pos: [p[0], p[1], p[2]], ray: hit ? Math.hypot(hit.x - p[0], hit.y - p[1], hit.z - p[2]) : null, voxel: r, farClip: s.renderer.camera.camera.farClip, farthestWall: far,
            entity: ls.x, flies: !!s.sim.world && s.sim.world.col === s.collision, splat: s.renderer.splatVisible };`;
    const { ctx, page: p } = await ctxOf(browser);
    await go(p, `scene=${A}&nowarn=1&input=touch`);
    const dir = await hook(p, PICK);
    if (!dir) throw new Error('no wall within 20 m of the spawn');
    const x1 = await hook(p, STATE(dir.d));
    await hook(p, 'h.scale.set(100); return 0;');
    await p.waitForTimeout(1500);
    const x100 = await hook(p, STATE(dir.d));
    const shotView = await shot(p, 'w5-x100-view');
    await p.mouse.click(640, 300);
    await p.keyboard.press('KeyP');
    await p.waitForSelector('[data-testid=scene-size]');
    await p.waitForTimeout(600); // the panel fades in over 0.4 s: the shot shows it settled
    const row = await p.evaluate("(() => { const r = document.querySelector('[data-testid=scene-size]'); const v = r.querySelector('[data-testid=scene-size-voxel]'); return { value: r.querySelector('[data-testid=scene-size-value]').textContent, voxel: v.textContent, warn: v.classList.contains('warn'), slider: r.querySelector('[data-testid=scene-size-slider]').max }; })()") as Any;
    const shotRow = await shot(p, 'w5-x100-summary');
    const layRow = await layout(p, ['[data-testid=scene-size] .sc-label', '[data-testid=scene-size] .sc-value', '[data-testid=scene-size] .sc-ctl', '[data-testid=scene-size] .sc-vox']);
    await p.keyboard.press('Escape');
    await hook(p, 'h.scale.reset(); return 0;');
    await p.waitForTimeout(500);
    await p.mouse.click(640, 300);
    await p.keyboard.press('Shift+BracketRight');
    await p.waitForTimeout(500);
    const shift = await hook<number>(p, 'return h.scale.size();');
    await p.keyboard.press('BracketRight');
    await p.waitForTimeout(500);
    const plain = await hook<number>(p, 'return h.scale.size();') / shift;
    await hook(p, 'h.scale.reset(); h.prefs.flush(); return 0;');
    await ctx.close();
    const m = await ctxOf(browser, { w: 375, h: 812, mobile: true });
    await go(m.page, `scene=${A}&nowarn=1&input=touch`);
    await hook(m.page, 'h.scale.set(100); return 0;');
    await m.page.waitForTimeout(800);
    await m.page.evaluate("document.querySelector('[data-action=pause]')?.click()");
    await m.page.waitForSelector('[data-testid=scene-size]');
    await m.page.waitForTimeout(600); // the panel fades in over 0.4 s: the shot shows it settled
    const shot375 = await shot(m.page, 'w5-x100-summary');
    const lay375 = await layout(m.page, ['[data-testid=scene-size] .sc-label', '[data-testid=scene-size] .sc-value', '[data-testid=scene-size] .sc-ctl', '[data-testid=scene-size] .sc-vox']);
    await m.ctx.close();
    const posMm = Math.hypot(x100.pos[0] - x1.pos[0], x100.pos[1] - x1.pos[1], x100.pos[2] - x1.pos[2]) * 1000;
    const pass = x100.size === 100 && posMm <= 1 && x100.ray !== null && Math.abs(x100.ray - 100 * x1.ray) <= 2 * x100.voxel && Math.abs(x100.entity - 100) < 1e-6 && x100.flies && x100.splat
        && x100.farClip >= x100.farthestWall && row.value === 'x100.00' && /m blocks/.test(row.voxel) && row.warn && Math.abs(Number(row.slider) - Math.log2(100)) < 1e-6
        && Math.abs(shift - 2) < 1e-9 && Math.abs(plain - 1.1) < 1e-6 && layRow.overlaps.length === 0 && lay375.overlaps.length === 0;
    const control = { farClipAtX1: 2000, farthestWallAtX100: x100.farthestWall, x1Ray: x1.ray, fired: x100.farthestWall > 2000 && x1.ray !== null && x1.ray < x100.ray / 50 };
    record('W5', { pass: pass && control.fired, what: 'x100 around the drone: position kept, the ray to a wall 100x within one scaled voxel, the far clip reaches the farthest wall, the row says m blocks with the warning; Shift+] x2, ] x1.1', dir, x1, x100, posMm, row, shift, plainStep: plain, layout: { row: layRow, 375: lay375 }, shots: [shotView, shotRow, shot375], control });
}

// ------------------------------------------------------------------ W6 stats forever
if (want('W6')) {
    const dir = mkdtempSync(join(tmpdir(), 'gsfpv-w6-'));
    const pick = pickBrowser({ expected: chromium.executablePath() });
    const persistent = async () => {
        const c = await chromium.launchPersistentContext(dir, { ...pick.launch, headless: false, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true, args: ['--window-position=60,60'] });
        const pg = c.pages()[0] ?? await c.newPage();
        pg.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
        return { c, pg };
    };
    const STATS = "return JSON.parse(JSON.stringify(h.prefs.collection('stats').byDrone));";
    let r = await persistent();
    await go(r.pg, `scene=${A}&simradio=scenario&tour=1&render=off&nowarn=1`);
    await r.pg.waitForTimeout(14000);
    await hook(r.pg, 'h.prefs.flush(); return 0;');
    const flown = await hook(r.pg, STATS);
    await r.c.close();
    r = await persistent();
    await go(r.pg, `scene=${A}&nowarn=1&input=touch&render=off`);
    const later = await hook(r.pg, STATS);
    await r.pg.mouse.click(640, 300);
    await r.pg.keyboard.press('KeyP');
    await r.pg.waitForSelector('[data-action=stats-save]');
    await r.pg.waitForTimeout(600); // the panel fades in over 0.4 s: the shot shows it settled
    const shot1280 = await shot(r.pg, 'w6-save-stats');
    const lay1280 = await layout(r.pg, ['.sum-actions .btn', '[data-testid=summary-stats]', '.sum-note']);
    const [dl] = await Promise.all([r.pg.waitForEvent('download'), r.pg.click('[data-action=stats-save]')]);
    const csv = readFileSync(await dl.path(), 'utf8');
    const [dj] = await Promise.all([r.pg.waitForEvent('download'), r.pg.click('[data-action=stats-save-json]')]);
    const json = JSON.parse(readFileSync(await dj.path(), 'utf8'));
    const persisted = await r.pg.evaluate('navigator.storage.persisted()');
    const file = await hook(r.pg, 'return h.prefs.export();');
    await r.c.close();
    rmSync(dir, { recursive: true, force: true });
    const f = await ctxOf(browser);
    await go(f.page, `scene=${A}&nowarn=1&input=touch&render=off`);
    const freshBefore = await hook(f.page, STATS);
    const report = await f.page.evaluate(`window.__gsfpv.prefs.importFile(${JSON.stringify(file)})`) as Any;
    const freshAfter = await hook(f.page, STATS);
    await f.ctx.close();
    const m = await ctxOf(browser, { w: 375, h: 812, mobile: true });
    await go(m.page, `scene=${A}&nowarn=1&input=touch&render=off`);
    await m.page.evaluate("document.querySelector('[data-action=pause]')?.click()");
    await m.page.waitForSelector('[data-action=stats-save]');
    await m.page.waitForTimeout(600); // the panel fades in over 0.4 s: the shot shows it settled
    await m.page.locator('[data-action=stats-save]').scrollIntoViewIfNeeded();
    const shot375 = await shot(m.page, 'w6-save-stats');
    const lay375 = await layout(m.page, ['.sum-actions .btn', '.sum-note']);
    await m.ctx.close();
    const drones = Object.keys(flown);
    const sum = drones.reduce((a, k) => a + flown[k].airtimeS, 0);
    const lines = csv.split('\r\n');
    const pass = drones.length > 0 && sum > 3 && JSON.stringify(later) === JSON.stringify(flown)
        && lines[0] === 'drone_id,drone,flights,airtime_s,airtime,distance_m,crashes' && lines.some((l) => l.startsWith('total,')) && drones.every((d) => lines.some((l) => l.startsWith(`${d},`)))
        && json.format === 'gsfpv-stats' && Math.abs(json.total.airtimeS - sum) < 0.5 && report.ok === true && JSON.stringify(freshAfter) === JSON.stringify(flown)
        && /^gsfpv-stats-\d{4}-\d\d-\d\d\.csv$/.test(dl.suggestedFilename()) && lay1280.overlaps.length === 0 && lay375.overlaps.length === 0;
    const control = { freshBefore, fired: Object.keys(freshBefore).length === 0 };
    record('W6', { pass: pass && control.fired, what: 'lifetime totals survive closing the browser (same profile), "Save my stats" downloads CSV and JSON with every drone and the total, an exported settings file restores them in a fresh profile', flown, later, csv: lines.slice(0, 4), json: { drones: json.drones.length, total: json.total }, persisted, files: [dl.suggestedFilename(), dj.suggestedFilename()], freshAfter, layout: { 1280: lay1280, 375: lay375 }, shots: [shot1280, shot375], control });
}

await browser.close();
const ids = Object.keys(out).filter((k) => /^W\d$/.test(k));
const all = ids.length > 0 && ids.every((k) => (out[k] as Any).pass) && errors.length === 0;
const file = writeEvidence(`v05-ux${ONLY.length ? `-${ONLY.join('-').toLowerCase()}` : ''}`, { pass: all, ...out, pageErrors: errors });
console.log(all ? 'ALL PASS' : 'SOME FAIL', '->', file, errors.length ? `page errors: ${errors.length}` : '');
process.exit(all ? 0 : 1);
