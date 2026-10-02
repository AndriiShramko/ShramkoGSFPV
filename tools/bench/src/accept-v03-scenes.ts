// W3-1 "scene host and rotation" in the real page (docs/architecture-v03.md E.4, E.5, E.10; the
// owner's items 10 and 5). Fresh Playwright contexts only. Every check has a negative control that must fire.
//   S1  N loads the next scene in the page: no reload, the simulated radio (?simradio=raw) stays
//       connected (no Controls screen), the craft starts the new scene armed on its platform (C.4
//       'scene', switch kept on) and the throttle follows the stick right after.
//       Control: the old path (a page load of the new scene) shows the Controls screen again.
//   S2  10 switches between two scenes: JS heap (after GC) and the renderer's VRAM (app.stats) within
//       +15 % of the first load. Control: two more switches (B, A) with unloadSplat() disabled: A's
//       VRAM grows past +15 % of A's just before. Draws the scan: GPU lock, render on.
//   S3  scenes.autoSwitch on: a crash loads the next scene after the delay (the toast says so).
//       Control: off, the same crash respawns in the same scene. Also: Enter on the toast opens the
//       crash panel, its scene row (N, Shift+N, F) is there and Next scene loads the next scene.
//   S4  F loads the next favourite (starred in the picker), Shift+N a random curated scene. Control: no favourites, F loads nothing.
//   S5  the picker's "Continue" card is the last scene flown. Control: a fresh browser has none.
// S1, S3, S4, S5 are flight logic: the logic-only mode ?render=off (tools/bench/README.md).
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5331 npx tsx src/accept-v03-scenes.ts [S1 S2 ...]
// Evidence: evidence/<date>/v03-scenes.json.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5331').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const A = '39e63ce9';
const B = '7a475d38';
const C = '887f27aa';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v03-scenes');
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

async function context(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const errors = (log: string[]) => log.filter((l) => l.startsWith('pageerror'));

/** The simulated EdgeTX radio through the wizard (no button pressed but Fly), then flying. */
async function radioFlying(p: Page, scene = A): Promise<Any> {
    await p.goto(fly(`scene=${scene}&simradio=raw&nobuttons=1&react=300&nowarn=1&render=off`));
    await waitReady(p, 180000);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
        if ((await hook<string | null>(p, 'const w = h.radio && h.radio.wizard; return w ? w.state.id : null;')) === 'check') break;
        await wait(p, 250);
    }
    await p.click('[data-action="wizard-done"]');
    await wait(p, 400);
    return hook(p, 'return { controlsScreen: !!document.querySelector(".screen.radio"), source: h.controls.source };');
}

/** Wait for the scene switch under way to end; its record. */
async function switched(p: Page, timeoutMs = 120000): Promise<Any> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const st = await hook<Any>(p, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
        if (st && (st.state === 'done' || st.state === 'failed')) return st;
        await wait(p, 200);
    }
    return { state: 'timeout' };
}

/** The throttle stick of the simulated radio at v: what the flight model applies a moment later. */
async function throttleFollows(p: Page): Promise<Any> {
    const out: Any[] = [];
    for (const v of [0.5, -0.6, 0.2]) {
        await hook(p, `h.fake.set('T', ${v}); return 0;`);
        await wait(p, 350);
        out.push({ stick: v, ch2: await hook<number>(p, 'return s.sim.ch[2];') });
    }
    return { samples: out, ok: out.every((x) => Math.abs(x.ch2 - x.stick) < 0.12) };
}

const STATE = `return { scene: s.scene.id, url: new URL(location.href).searchParams.get('scene'), mark: window.__mark ?? null, sameFake: window.__fake === h.fake,
    controlsScreen: !!document.querySelector('.screen.radio'), loading: !!document.querySelector('[data-testid="loading"]'), source: h.controls.source,
    paused: s.paused, armed: !!s.sim.armed, gateArmed: h.controls.gate.armed, life: s.log.header.life.reason, keepArmed: s.log.header.life.opts.keepArmed === true,
    platform: s.log.header.life.opts.platform === true, switches: h.scenes.log.length,
    first: { reason: s.lives()[0].header.life.reason, keepArmed: s.lives()[0].header.life.opts.keepArmed === true, platform: s.lives()[0].header.life.opts.platform === true } };`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, render: { S1: 'off', S2: 'on', S3: 'off', S4: 'off', S5: 'off' } };

// ------------------------------------------------------------------ S1 N: in-page, the radio stays
if (want('S1')) {
    const { ctx, page: p, log } = await context(browser);
    const radio = await radioFlying(p);
    await hook(p, "window.__mark = 1; window.__fake = h.fake; h.fake.set('T', -1); h.fake.arm = false; return 0;");
    await wait(p, 400);
    await hook(p, 'h.fake.arm = true; return 0;');
    await wait(p, 500);
    const before = await hook(p, STATE);
    await p.keyboard.press('KeyN');
    const sw = await switched(p);
    await wait(p, 300);
    const after = await hook(p, STATE);
    const throttle = await throttleFollows(p);
    await p.screenshot({ path: join(SHOTS, 's1-after-n-render-off.png') });
    // control: the old way to another scene, a page load (v0.2's "Change scan", a link)
    await p.goto(fly(`scene=${after.scene}&simradio=raw&nobuttons=1&react=300&nowarn=1&render=off`));
    await waitReady(p, 180000);
    await wait(p, 1500);
    const reload = await hook(p, 'return { mark: window.__mark ?? null, controlsScreen: !!document.querySelector(".screen.radio"), source: h.controls.source };');
    await ctx.close();
    const pass = !radio.controlsScreen && before.armed && sw.state === 'done' && sw.reason === 'next' && after.scene !== before.scene && after.url === after.scene
        && after.mark === 1 && after.sameFake && !after.controlsScreen && !after.loading && !after.paused && after.source === 'hid'
        && after.life === 'scene' && after.keepArmed && after.platform && after.armed && after.gateArmed && throttle.ok;
    const control = { ...reload, fired: reload.mark === null && reload.controlsScreen === true };
    out.S1 = { pass: pass && control.fired, what: 'N loads the next scene in the page: no reload, the simulated radio stays connected and armed, the throttle follows at once; a page load shows the Controls screen again', radio: 'SimRadio EdgeTX Classic (simulated raw HID reports, NOT a real radio)', before, switch: sw, after, throttle, control, errors: errors(log) };
    console.log('S1', out.S1.pass ? 'PASS' : 'FAIL', JSON.stringify({ sw, after, throttle: throttle.ok, control }));
}

// ------------------------------------------------------------------ S2 memory over 10 switches
async function settle(p: Page): Promise<void> {
    const t0 = Date.now();
    await wait(p, 1500);
    while (Date.now() - t0 < 30000) {
        const quiet = await hook<boolean>(p, 'const b = s.renderer.splatBytes(); return b.lastByteAt > 0 && performance.now() - b.lastByteAt > 2500;');
        if (quiet) break;
        await wait(p, 500);
    }
}
async function memory(p: Page, cdp: Any): Promise<Any> {
    await cdp.send('HeapProfiler.collectGarbage');
    await wait(p, 200);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize as number;
    const r = await hook<Any>(p, 'const v = s.renderer.app.stats.vram; const b = s.renderer.splatBytes(); return { vram: v.totalUsed, tex: v.tex, sb: v.sb ?? 0, vb: v.vb, received: b.received, scene: s.scene.id };');
    return { heapMb: +(heap / 1e6).toFixed(1), vramMb: +(r.vram / 1e6).toFixed(1), texMb: +(r.tex / 1e6).toFixed(1), sbMb: +(r.sb / 1e6).toFixed(1), receivedMb: +(r.received / 1e6).toFixed(1), scene: r.scene };
}
if (want('S2')) {
    const { ctx, page: p, log } = await context(browser);
    const cdp = await ctx.newCDPSession(p);
    await p.goto(fly(`scene=${A}&nowarn=1&input=touch`));
    await waitReady(p, 180000);
    await hook(p, 'return s.visible.then(() => 0);');
    await settle(p);
    const first = await memory(p, cdp);
    const steps: Any[] = [];
    for (let i = 0; i < 10; i++) {
        const to = i % 2 === 0 ? B : A;
        await hook(p, `h.scenes.load('${to}', 'pick'); return 0;`);
        const sw = await switched(p);
        await settle(p);
        steps.push({ to, ms: sw.ms, state: sw.state, ...(await memory(p, cdp)) });
    }
    await p.screenshot({ path: join(SHOTS, 's2-after-10-switches.png') });
    const last = steps[steps.length - 1];
    const heapRatio = last.heapMb / first.heapMb;
    const vramRatio = last.vramMb / first.vramMb;
    // control: the old scan is never unloaded; two more switches (B, then A again)
    await hook(p, 's.renderer.unloadSplat = function () {}; return 0;');
    const leak: Any[] = [];
    for (const to of [B, A]) {
        await hook(p, `h.scenes.load('${to}', 'pick'); return 0;`);
        await switched(p);
        await settle(p);
        leak.push({ to, ...(await memory(p, cdp)) });
    }
    await ctx.close();
    // the control compares like with like: A after the same two switches, with and without unloading
    const leakRatio = leak[1].vramMb / last.vramMb;
    const pass = steps.every((x) => x.state === 'done') && last.scene === A && heapRatio <= 1.15 && vramRatio <= 1.15 && last.receivedMb > 0;
    const control = { leak, vramRatioToLastA: +leakRatio.toFixed(3), fired: leakRatio > 1.15 };
    out.S2 = { pass: pass && control.fired, what: '10 switches A<->B in one page: JS heap after GC and app.stats VRAM within +15 % of the first load of A; with unloadSplat disabled VRAM grows past it', first, steps, heapRatio: +heapRatio.toFixed(3), vramRatio: +vramRatio.toFixed(3), control, errors: errors(log) };
    console.log('S2', out.S2.pass ? 'PASS' : 'FAIL', JSON.stringify({ first, last, heapRatio, vramRatio, control }));
}

// ------------------------------------------------------------------ S3 scenes.autoSwitch
/**
 * A crash: a fresh flight model at the spawn without the platform (respawn.platform off for this one
 * build, on again for the respawns), the threshold at the settings' lowest (2 m/s), the switch
 * flipped on at idle: the drop from the spawn of 39e63ce9 ends in a crash.
 */
async function crash(p: Page): Promise<boolean> {
    await hook(p, "h.fake.set('T', -1); h.fake.arm = false; h.prefs.set('respawn.platform', false); s.rebuildSim(s.presetId, { ...s.overrides, vCrash: 2 }); h.prefs.set('respawn.platform', true); return 0;");
    await wait(p, 400);
    await hook(p, 'h.fake.arm = true; return 0;');
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
        if (await hook<boolean>(p, 'return !!s.sim.crashed;')) return true;
        await wait(p, 100);
    }
    return false;
}
if (want('S3')) {
    const { ctx, page: p, log } = await context(browser);
    await radioFlying(p);
    await hook(p, "window.__mark = 1; window.__fake = h.fake; return 0;");
    // control first: autoSwitch off (the default), the crash respawns in the same scene
    const offCrashed = await crash(p);
    await wait(p, 3500);
    const off = await hook(p, `${STATE.replace('return {', 'return { onCrash: s.policy.onCrash, crashed: !!s.sim.crashed, respawned: s.lives().some((l) => l.header.life.reason === "crash"),')}`);
    // the crash panel: Enter keeps the wreck, the panel's scene row, its Next scene button
    const panelCrashed = await crash(p);
    await wait(p, 300);
    await p.keyboard.press('Enter');
    await p.waitForSelector('[data-testid="crash-scenes"]', { timeout: 5000 }).catch(() => null);
    const row = await p.locator('[data-testid="crash-scenes"] button').evaluateAll((bs) => bs.map((b) => ({ action: b.getAttribute('data-action'), keys: b.getAttribute('aria-keyshortcuts') }))).catch(() => []);
    await p.click('[data-action="scene-next"]').catch(() => null);
    const panelSwitch = await switched(p);
    const panelAfter = await hook(p, 'return { scene: s.scene.id, sameFake: window.__fake === h.fake, panel: !!document.querySelector(\'[data-testid="crash-panel"]\'), controlsScreen: !!document.querySelector(".screen.radio") };');
    const panel = { crashed: panelCrashed, row, switch: panelSwitch, after: panelAfter,
        ok: panelCrashed && row.map((r: Any) => `${r.action}:${r.keys}`).join() === 'scene-next:N,scene-random:Shift+N,scene-favourite:F' && panelSwitch.state === 'done' && panelSwitch.reason === 'next' && panelAfter.scene !== A && panelAfter.sameFake && !panelAfter.panel && !panelAfter.controlsScreen };
    // back to A (its spawn drop crashes at 2 m/s) for the automatic switch
    await hook(p, `h.sceneSwitch = null; h.scenes.load('${A}', 'pick'); return 0;`);
    await switched(p);
    await hook(p, "h.sceneSwitch = null; h.prefs.set('scenes.autoSwitch', true); return 0;");
    await wait(p, 100);
    const onCrash = await hook<string>(p, 'return s.policy.onCrash;');
    const onCrashed = await crash(p);
    await wait(p, 300);
    const toast = await p.locator('[data-testid="crash-toast"] .ct-text').textContent().catch(() => null);
    const sw = await switched(p);
    await wait(p, 300);
    const after = await hook(p, STATE);
    const throttle = await throttleFollows(p);
    await hook(p, "h.prefs.reset('scenes.autoSwitch'); return 0;");
    await ctx.close();
    const pass = onCrash === 'next-scene' && onCrashed && /next scene/i.test(toast ?? '') && sw.state === 'done' && sw.reason === 'auto' && after.scene !== A
        && after.mark === 1 && after.sameFake && !after.controlsScreen && after.first.reason === 'scene' && after.first.keepArmed && after.armed && throttle.ok && panel.ok;
    const control = { crashedBefore: offCrashed, ...off, fired: offCrashed && off.onCrash === 'respawn' && off.scene === A && off.switches === 0 && off.respawned === true };
    out.S3 = { pass: pass && control.fired, what: 'scenes.autoSwitch on: after the crash delay the next scene loads (toast: next scene in ...), the radio stays; off: the crash respawns in the same scene; the crash panel has N / Shift+N / F and Next scene loads', onCrash, toast, switch: sw, after, throttle, panel, control, errors: errors(log) };
    console.log('S3', out.S3.pass ? 'PASS' : 'FAIL', JSON.stringify({ toast, sw, after, panel, control }));
}

// ------------------------------------------------------------------ S4 F and Shift+N, S5 Continue
if (want('S4') || want('S5')) {
    const { ctx, page: p, log } = await context(browser);
    // the pilot stars two scenes in the picker (C, then B: the newest star first) and flies A
    await p.goto(fly('nowarn=1&render=off&input=touch'));
    await p.waitForSelector('.scene-grid [data-scene]', { timeout: 30000 });
    for (const id of [C, B]) await p.click(`.scene-cell:has([data-scene="${id}"]) .star`);
    await p.click(`.scene-grid [data-scene="${A}"]`);
    // the hook still says 'picker' until this flight is ready (waitReady would return at once)
    await p.waitForFunction('window.__gsfpv && window.__gsfpv.status === "ready"', undefined, { timeout: 180000 });
    await wait(p, 500);
    const favourites = await hook<string[]>(p, "return h.prefs.collection('sceneLibrary').favourites;");
    const fav: Any[] = [];
    for (let i = 0; i < 2; i++) {
        await p.keyboard.press('KeyF');
        const sw = await switched(p);
        await wait(p, 300);
        fav.push({ switch: sw, scene: await hook<string>(p, 'return s.scene.id;') });
        await hook(p, 'h.sceneSwitch = null; return 0;');
    }
    await p.keyboard.press('Shift+KeyN');
    const rs = await switched(p);
    await wait(p, 300);
    const random = { switch: rs, scene: await hook<string>(p, 'return s.scene.id;') };
    if (want('S4')) {
        // control: a browser with no favourites; F loads nothing
        const c2 = await context(browser);
        await c2.page.goto(fly(`scene=${A}&nowarn=1&input=touch&render=off`));
        await waitReady(c2.page, 180000);
        await wait(c2.page, 500);
        await c2.page.keyboard.press('KeyF');
        await wait(c2.page, 1500);
        const ctl = await hook(c2.page, 'return { switches: h.scenes.log.length, scene: s.scene.id, sceneSwitch: h.sceneSwitch ?? null, favourites: h.prefs.collection("sceneLibrary").favourites };');
        // the keys do reach the page there: N loads the next scene
        await c2.page.keyboard.press('KeyN');
        const nWorks = (await switched(c2.page, 60000)).state === 'done';
        await c2.ctx.close();
        const pass = favourites.join() === [B, C].join() && fav[0].scene === B && fav[1].scene === C && fav.every((x) => x.switch.state === 'done' && x.switch.reason === 'favourite')
            && random.switch.state === 'done' && random.switch.reason === 'random' && random.scene !== C && [A, B].includes(random.scene);
        const control = { ...ctl, nWorks, fired: ctl.switches === 0 && ctl.scene === A && ctl.sceneSwitch === null && nWorks };
        out.S4 = { pass: pass && control.fired, what: 'F loads the next favourite in the favourites order (starred in the picker), Shift+N a random curated scene (never the current one); with no favourites F loads nothing', favourites, fav, random, control, errors: errors(log) };
        console.log('S4', out.S4.pass ? 'PASS' : 'FAIL', JSON.stringify({ favourites, fav: fav.map((x) => x.scene), random: random.scene, control }));
    }
    if (want('S5')) {
        const lastFlown = await hook<string>(p, 'return s.scene.id;');
        await hook(p, 'h.prefs.flush(); return 0;');
        await p.goto(fly('nowarn=1'));
        await p.waitForSelector('[data-testid="scene-continue"]', { timeout: 15000 }).catch(() => null);
        const card = await p.locator('[data-testid="scene-continue"]').getAttribute('data-scene').catch(() => null);
        const text = await p.locator('[data-testid="scene-continue"]').textContent().catch(() => null);
        await p.screenshot({ path: join(SHOTS, 's5-continue-card.png') });
        const fresh = await context(browser);
        await fresh.page.goto(fly('nowarn=1'));
        await fresh.page.waitForSelector('.scene-grid', { timeout: 15000 });
        const freshCard = await fresh.page.locator('[data-testid="scene-continue"]').count();
        await fresh.ctx.close();
        const control = { freshCards: freshCard, fired: freshCard === 0 };
        out.S5 = { pass: card === lastFlown && /Continue/.test(text ?? '') && control.fired, what: 'the picker shows "Continue: <last scene>" first; a fresh browser has no such card', lastFlown, card, text, control };
        console.log('S5', out.S5.pass ? 'PASS' : 'FAIL', JSON.stringify({ lastFlown, card, text, control }));
    }
    await ctx.close();
}

await browser.close();
const items = Object.keys(out).filter((k) => /^S\d$/.test(k));
out.pass = items.length > 0 && items.every((k) => out[k].pass);
console.log('evidence', writeEvidence('v03-scenes', out), 'all items pass:', out.pass);
