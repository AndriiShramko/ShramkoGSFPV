// v0.7 lane E acceptance (the owner's item 10; docs/wip/v07-e.md): the wind of the place and the
// collision ceiling in the real page, the scan drawn (the voxel grid and the ceiling's plane need the
// GPU). Fresh browser context; every check has a negative control that must fire.
//   W1 wind custom (from the west, 3 m/s) on 39e63ce9: the flight model's header carries it; a level
//      craft in angle mode at hover throttle drifts with the air (+x, the scene has no compass, so its
//      forward axis is north; walls off for the drift, see hoverFor); the HUD dial shows; a saved
//      flight replays to its hash.
//      Controls: wind off -> no drift, no dial (the scan has no compass), no wind in the header; a
//      tampered record replays to another hash.
//   W2 wind "live at the place" where no /api/wind answers (the dev server): still air, said.
//   C1 the ceiling halfway between the start and the room's ceiling over it: the walls the craft
//      flies lose the voxels above it (the
//      room's ceiling over the start answers free), the log gets a world record with it; control:
//      'off' brings them back.
//   C2 the "Ignore collisions above" panel: the grid previews the height (plane on, the grid's
//      ceiling = the panel's), a screenshot for the owner; control: closing it takes the plane away.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5377 npx tsx src/accept-v07-wind-ceiling.ts
// Evidence: evidence/<date>/v07-wind-ceiling.json and v07-ceiling-panel.png.
import type { Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hoverSolve } from '@gsfpv/sim-core';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { params } from './presets';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5377').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

// the page's default drone; the stick that hovers it with a fresh pack, angle mode
const HOVER = hoverSolve(params('pavo20pro-3s'), 1).stick;

/**
 * Fly `ms` from the start with the touch sticks (as accept-v03-respawn.ts): disarm, back to the start
 * (R, onto the start platform), arm with the throttle low and go to hover throttle at once (an idle
 * craft would settle on the platform first), angle mode (the default), sticks centred; returns the
 * horizontal velocity averaged over the last half, the wind the model flew in and the dial's view.
 * Run it with the walls off: in this room a drifting craft meets a wall within a second, and W1
 * measures the air, not the room (sim-core's drift test shows the same take-off off the platform).
 */
async function hoverFor(p: Page, ms: number): Promise<{ vx: number; vz: number; armed: boolean; crashed: boolean; windNow: number[]; mode: number; dial: Any }> {
    return hook(p, `
        const t = h.touch; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        t.setArmed(false); t.channels[0] = 0; t.channels[1] = 0; t.channels[2] = -1; t.channels[3] = 0;
        await wait(300);
        s.respawn(false);
        await wait(400);
        t.setArmed(true);
        await wait(50);
        t.channels[2] = ${HOVER} * 2 - 1;
        const t0 = performance.now(); const vs = [];
        await new Promise((resolve) => {
            const id = setInterval(() => {
                const st = s.sim.s;
                if (performance.now() - t0 > ${ms / 2}) vs.push([st[3], st[5]]);
                if (performance.now() - t0 >= ${ms}) { clearInterval(id); resolve(0); }
            }, 20);
        });
        const n = Math.max(1, vs.length);
        const out = { vx: vs.reduce((a, v) => a + v[0], 0) / n, vz: vs.reduce((a, v) => a + v[1], 0) / n, armed: s.sim.armed, crashed: s.sim.crashed, windNow: Array.from(s.sim.windNow), mode: s.sim.ch[5], dial: h.wind.state().dial };
        t.channels[2] = -1; t.setArmed(false);
        return out;`);
}

const DIAL = `const d = document.querySelector('[data-testid="wind-dial"]'); return d ? { hidden: d.hidden, label: d.getAttribute('aria-label') } : null;`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, scene: SCENE, hoverStick: HOVER };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const log: string[] = [];
p.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text()}`.slice(0, 300)); });

try {
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch&set.input.play=pilot`));
    await waitReady(p, 240000);
    await hook(p, 'await s.visible; return 0;');

    // ---- W1: custom wind from the west, 3 m/s, no gusts
    await hook(p, `h.prefs.set('wind.mode', 'custom'); const sc = { scene: '${SCENE}' }; h.prefs.set('wind.fromDeg', 270, sc); h.prefs.set('wind.speed', 3, sc); h.prefs.set('wind.gust', 0, sc); return h.wind.apply();`);
    const windOn = await hook(p, `const st = h.wind.state(); return { config: st.config, spec: st.spec, header: s.runner.current().header.overrides.wind ?? null, format: s.runner.current().header.format };`);
    const wallsOff = await hook<boolean>(p, `s.setWallsOn(false); return s.wallsOn;`);
    const flyWind = await hoverFor(p, 2500);
    const dialOn = await hook(p, DIAL);
    const saved = await hook(p, `h.saveLog('v07-wind'); const v = h.verifyLastLog(); const t = h.verifyLastLog({ atTick: 1000, channel: 2, delta: 0.05 }); return { saved: v.saved, replayed: v.hash, tampered: t.hash, refused: v.refused ?? null };`);
    // control: wind off
    await hook(p, `h.prefs.set('wind.mode', 'off'); return h.wind.apply();`);
    const windOff = await hook(p, `const st = h.wind.state(); return { config: st.config, header: s.runner.current().header.overrides.wind ?? null };`);
    const flyCalm = await hoverFor(p, 2500);
    const dialOff = await hook(p, DIAL);
    const wallsBack = await hook<boolean>(p, `s.setWallsOn(true); return s.wallsOn;`);
    out.W1 = {
        windOn, wallsOff, flyWind, dialOn, saved, windOff, flyCalm, dialOff, wallsBack,
        pass: wallsOff === false && wallsBack === true
            && windOn.config?.fromDeg === 270 && windOn.config?.speed === 3 && windOn.header?.speed === 3 && windOn.format === 'gsfpv-input-log/3'
            && flyWind.armed && !flyWind.crashed && flyWind.vx > 0.8 && Math.abs(flyWind.vz) < 0.5 * flyWind.vx && flyWind.windNow[0] > 1.5
            && dialOn && !dialOn.hidden && saved.refused === null && saved.saved === saved.replayed && saved.tampered !== saved.saved
            && windOff.config === null && windOff.header === null && flyCalm.armed && Math.hypot(flyCalm.vx, flyCalm.vz) < 0.3 && dialOff?.hidden === true
    };

    // ---- W2: live at the place, where nothing answers /api/wind (the dev server): still air
    await hook(p, `h.prefs.set('wind.mode', 'now'); return h.wind.apply();`);
    const now = await hook(p, `const st = h.wind.state(); return { mode: st.mode, spec: st.spec, config: st.config };`);
    out.W2 = { now, pass: now.mode === 'now' && now.spec === null && now.config === null };
    await hook(p, `h.prefs.reset('wind.mode'); return h.wind.apply();`);

    // ---- C1: the ceiling 0.6 m above the start
    const COLUMN = `
        const c = s.collision; const sp = s.spawn; const push = { x: 0, y: 0, z: 0 };
        // the first wall straight above the start (the room's ceiling), as the walls flown now see it:
        // a 2 cm sphere, the flight's own query (isFreeAt also says "not free" above the voxel grid,
        // where there is only air)
        let first = null; for (let d = 0.05; d < 6; d += 0.01) { if (c.querySphere(sp[0], sp[1] + d, sp[2], 0.02, push)) { first = d; break; } }
        const recs = []; const b = s.runner.current().bytes(); const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
        for (let i = 0; i < b.length / 36; i++) if ((v.getInt32(i * 36, true) & 3) === 2) recs.push({ ceiling: v.getFloat32(i * 36 + 24, true), flag: v.getFloat32(i * 36 + 28, true) });
        return { firstWallAbove: first, state: h.ceiling.state(), worldRecords: recs };`;
    const cBefore = await hook(p, COLUMN);
    // halfway between the start and the first wall over it
    const H = Math.round(((cBefore.firstWallAbove ?? 1) / 2) * 100) / 100;
    await hook(p, `h.ceiling.set(${H}); await new Promise((r) => setTimeout(r, 50)); return 0;`);
    const cOn = await hook(p, COLUMN);
    await hook(p, `h.ceiling.set('off'); await new Promise((r) => setTimeout(r, 50)); return 0;`);
    const cOff = await hook(p, COLUMN);
    out.C1 = {
        heightAboveStart: H, cBefore, cOn, cOff,
        pass: cBefore.firstWallAbove !== null && cBefore.firstWallAbove > H + 0.1 && cOn.state.ceilingM !== null && Math.abs(cOn.state.aboveStartM - H) < 0.01
            && cOn.firstWallAbove === null && cOn.worldRecords.some((r: Any) => r.flag === 1 && Math.abs(r.ceiling - cOn.state.ceilingM) < 1e-4)
            && cOff.state.ceilingM === null && cOff.firstWallAbove !== null && Math.abs(cOff.firstWallAbove - cBefore.firstWallAbove) < 0.011
    };

    // ---- C2: the panel and its preview, the slider moved to the C1 height (the room's top half goes violet)
    await hook(p, `h.ceiling.open(); const r = document.querySelector('#ce-h'); r.value = String(${H}); r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((res) => setTimeout(res, 400)); return 0;`);
    const t0 = Date.now();
    let settled = false;
    while (Date.now() - t0 < 120000) {
        settled = await hook<boolean>(p, `const v = h.voxels.stats(); return v.state === 'ready' && h.voxels.settled() && v.ceilingPlane;`);
        if (settled) break;
        await p.waitForTimeout(250);
    }
    const panelOn = await hook(p, `const v = h.voxels.stats(); const pn = h.ceiling.panel(); const el = document.querySelector('[data-testid="ceiling-panel"]');
        // the height the panel shows, in scan metres (what the grid must be drawing)
        const want = pn ? Math.fround((s.spawn[1] + pn.value - s.transform.t[1]) / s.transform.s) : null;
        return { panel: pn, want, grid: { state: v.state, ceilingM: v.ceilingM, ceilingPlane: v.ceilingPlane, chunks: v.chunks }, visible: !!el && el.getBoundingClientRect().width > 0, effect: document.querySelector('[data-testid="ceiling-effect"]')?.textContent ?? null };`);
    const dir = join(REPO, 'evidence', today());
    mkdirSync(dir, { recursive: true });
    const shot = join(dir, 'v07-ceiling-panel.png');
    await p.screenshot({ path: shot });
    await hook(p, `document.querySelector('[data-action="ceiling-close"]').click(); await new Promise((r) => setTimeout(r, 100)); return 0;`);
    const panelOff = await hook(p, `const v = h.voxels.stats(); return { panel: h.ceiling.panel(), ceilingPlane: v.ceilingPlane, gridCeiling: v.ceilingM };`);
    out.C2 = {
        settled, panelOn, panelOff, screenshot: shot,
        pass: settled && panelOn.visible && panelOn.panel !== null && panelOn.grid.ceilingPlane === true && panelOn.grid.chunks > 0
            && panelOn.grid.ceilingM === panelOn.want && panelOn.panel.preview === panelOn.want && Math.abs(panelOn.panel.value - H) < 0.11
            && panelOff.panel === null && panelOff.ceilingPlane === false && panelOff.gridCeiling === null
    };
} catch (e) {
    out.error = String((e as Error)?.stack ?? e).slice(0, 2000);
} finally {
    out.log = log;
    out.pass = !out.error && ['W1', 'W2', 'C1', 'C2'].every((k) => out[k]?.pass === true);
    const file = writeEvidence('v07-wind-ceiling', out);
    console.log('v07 wind + ceiling', out.pass ? 'PASS' : 'FAIL', JSON.stringify({ W1: out.W1?.pass, W2: out.W2?.pass, C1: out.C1?.pass, C2: out.C2?.pass, error: out.error?.slice(0, 300) }), '->', file);
    await browser.close();
}
