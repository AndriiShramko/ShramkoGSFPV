// Lead step before wave 2 (docs/architecture-v03.md J), in the real page: the preferences store is
// reachable as window.__gsfpv.prefs, the first boot migrates the v0.2 keys, and for the stick mode
// and the walls switch the store gives what the app uses (at boot, after C, after a reload); the
// logic-only test mode ?render=off draws no scan and runs the frame loop at the display rate.
// Fresh browser contexts only (never a pilot's profile). Every check has a negative control.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5331 npx tsx src/accept-v03-lead2.ts      (xvfb-run -a without a display)
// Evidence: evidence/<date>/v03-lead2-prefs-render.json.
import type { Browser, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5331').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const LEGACY = { 'gsfpv.stickMode': '1', [`gsfpv.walls.${SCENE}`]: 'off', 'gsfpv.warned': '1' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

async function newPage(browser: Browser): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    return ctx.newPage();
}

/** The legacy keys go in on the same origin before the app has ever run there (a static file, not the app). */
async function seed(p: Page, keys: Record<string, string>): Promise<void> {
    await p.goto(`${SITE}/fly/showcase.json`);
    await p.evaluate((k) => { for (const [a, b] of Object.entries(k)) localStorage.setItem(a, b); }, keys);
}

/** What the page's store says next to what the app itself uses, for the stick mode and the walls of SCENE. */
const PAIR = `
    const P = h.prefs;
    const appStick = localStorage.getItem('gsfpv.stickMode') === '1' ? '1' : '2';
    const r = { storeStick: P.get('input.stickMode'), appStick, storeWalls: P.get('scene.walls', { scene: '${SCENE}' }),
        appWalls: s ? (s.wallsOn ? 'on' : 'off') : null, migrated: P.migrated(), explicit: P.explicitList(), writable: P.writable() };
    return r;`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which };

// ------------------------------------------------------------------ L1 the store in the page
{
    const p = await newPage(browser);
    await seed(p, LEGACY);
    await p.goto(fly('nowarn=1'));
    const picker = await waitReady(p, 60000);
    const atPicker = await hook(p, PAIR);
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch&render=off`));
    await waitReady(p, 180000);
    const flying = await hook(p, PAIR);
    await p.keyboard.press('KeyC'); // the walls switch (remembered for this scan)
    await p.waitForTimeout(300);
    const afterC = await hook(p, PAIR);
    await hook(p, 'h.prefs.flush(); return 0;');
    await p.reload();
    await waitReady(p, 180000);
    const reloaded = await hook(p, PAIR);
    // set / reset / export through the hook, across a reload
    const set = await hook(p, "return h.prefs.set('physics.vCrash', 6.5, { drone: 'pavo20pro-3s' });");
    await hook(p, 'h.prefs.flush(); return 0;');
    await p.reload();
    await waitReady(p, 180000);
    const vAfterReload = await hook(p, "return { v: h.prefs.get('physics.vCrash', { drone: 'pavo20pro-3s' }), exported: h.prefs.export().settings.drone['pavo20pro-3s'] };");
    await hook(p, "h.prefs.reset('physics.vCrash', { drone: 'pavo20pro-3s' }); return 0;");
    const vAfterReset = await hook(p, "return h.prefs.get('physics.vCrash', { drone: 'pavo20pro-3s' });");
    await p.context().close();

    // control: a fresh context without the v0.2 keys: the store gives the defaults, so the equal
    // values above came from the migration and the switch, not from defaults that happen to agree
    const c = await newPage(browser);
    await c.goto(fly('nowarn=1'));
    await waitReady(c, 60000);
    const unseeded = await hook(c, PAIR);
    await c.context().close();

    const eq = (r: Any) => r.storeStick === r.appStick && (r.appWalls === null || r.storeWalls === r.appWalls);
    const ok = picker.status === 'picker' && atPicker.migrated?.from === 0 && ['gsfpv.stickMode', `gsfpv.walls.${SCENE}`, 'gsfpv.warned'].every((k) => atPicker.migrated.moved.includes(k))
        && eq(atPicker) && atPicker.storeStick === '1' && atPicker.storeWalls === 'off'
        && eq(flying) && flying.appWalls === 'off' && eq(afterC) && afterC.appWalls === 'on' && eq(reloaded) && reloaded.appWalls === 'on' && reloaded.migrated === null
        && set.ok === true && vAfterReload.v === 6.5 && vAfterReload.exported?.['physics.vCrash'] === 6.5 && vAfterReset === 4;
    const control = { unseeded: { stick: unseeded.storeStick, walls: unseeded.storeWalls, migratedFrom: unseeded.migrated?.from ?? null }, fired: unseeded.storeStick === '2' && unseeded.storeWalls === 'on' && unseeded.storeStick !== atPicker.storeStick && unseeded.storeWalls !== atPicker.storeWalls };
    out.L1 = { pass: ok && control.fired, what: '__gsfpv.prefs reachable; v0.2 keys migrated at the first boot; store == app for stick mode and walls at the picker, in flight, after C, after a reload; set/export/reset survive a reload', legacyKeys: LEGACY, atPicker, flying, afterC, reloaded, setVCrash: set, vAfterReload, vAfterReset, control };
    console.log('L1', (out.L1 as Any).pass ? 'PASS' : 'FAIL');
}

// ------------------------------------------------------------------ L2 ?render=off
async function sample(qs: string): Promise<Record<string, unknown>> {
    const p = await newPage(browser);
    // the scan's SOG images; the loading screen's poster (<id>/v<N>/m.webp) is not the scan
    const images: string[] = [];
    const posters: string[] = [];
    p.on('request', (r) => {
        const u = r.url();
        if (!/\.webp(\?|$)/.test(u)) return;
        (/\/v\d+\/(m|l|xl)\.webp(\?|$)/.test(u) ? posters : images).push(u);
    });
    const t0 = Date.now();
    await p.goto(fly(qs));
    const h = await waitReady(p, 240000);
    const readyS = (Date.now() - t0) / 1000;
    await p.waitForTimeout(1500);
    const a = await hook(p, 'return { tick: s.sim.tick, now: performance.now(), frames: s.frames };');
    const raf = await p.evaluate('new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })');
    const b = await hook(p, 'return { tick: s.sim.tick, now: performance.now(), frames: s.frames, hitches: s.runner.hitches };');
    const tag = await p.locator('[data-testid="render-off"]').count();
    const info = (h.info ?? {}) as Record<string, unknown>;
    await p.context().close();
    return { qs, status: h.status, readyS, render: info.render, renderer: info.currentRenderer, hasCollision: info.hasCollision, tag, scanImages: images.length, posters: posters.length, rafPerS: raf, engineFramesPerS: ((b.frames - a.frames) / (b.now - a.now)) * 1000, simStepsPerS: ((b.tick - a.tick) / (b.now - a.now)) * 1000, hitches: b.hitches };
}
{
    const off = await sample(`scene=${SCENE}&nowarn=1&input=touch&render=off`);
    const on = await sample(`scene=${SCENE}&nowarn=1&input=touch`);
    const pass = off.status === 'ready' && off.render === 'off' && off.tag === 1 && off.scanImages === 0 && off.hasCollision === true
        && (off.rafPerS as number) >= 45 && (off.simStepsPerS as number) >= 900;
    // control: the same page with the scan drawn loads the scan images, carries no tag, and on this
    // machine (software WebGL) its frame loop is far below the display rate
    const control = { on, fired: on.status === 'ready' && on.render === 'on' && on.tag === 0 && (on.scanImages as number) > 0 && (on.rafPerS as number) < 0.5 * (off.rafPerS as number) };
    out.L2 = { pass: pass && control.fired, what: '?render=off: no scan image requested, the page tags itself, the frame loop runs near the display rate and the flight model near real time (1000 steps/s)', thresholds: { rafPerS: '>= 45', simStepsPerS: '>= 900' }, off, control };
    console.log('L2', (out.L2 as Any).pass ? 'PASS' : 'FAIL', JSON.stringify({ off, on }));
}

await browser.close();
out.pass = (out.L1 as Any).pass && (out.L2 as Any).pass;
console.log('evidence', writeEvidence('v03-lead2-prefs-render', out));
