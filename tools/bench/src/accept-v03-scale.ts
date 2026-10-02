// W3-3 acceptance (docs/architecture-v03.md E.7, the owner's item 11): the scene size around the
// drone, in the real page with the scan drawn (the splat entity's scale is checked, so not
// ?render=off). Fresh browser contexts only. Every check has a negative control that must fire.
//   SC1 x2 around the drone keeps the drone's world position (and the scan point under it) within
//       1 mm, doubles a ray from the drone to a wall within 1 voxel, flies the scaled walls, sets
//       the splat entity's scale to 2, and survives a reload. Control: reset gives x1 (entity 1,
//       the ray back to its first length), and that survives a reload too.
//   SC2 ] three times then [ three times returns to x1 within float error; each step applies
//       300 ms after the key (not at once). Control: after ] x3 the size is 1.331, not 1.
//   SC3 the summary panel's row: "Scene size x1.00", [+] gives x1.10, the walls' block size beside
//       it, a warning above 10 cm. Control: below 10 cm no warning.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5333 npx tsx src/accept-v03-scale.ts [SC1 SC2 SC3]
// Evidence: evidence/<date>/v03-scale.json.
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5333').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

async function open(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}

async function load(p: Page): Promise<void> {
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch`));
    await waitReady(p, 240000);
    await hook(p, 'return s.visible.then(() => 0);');
}

/**
 * The state the checks read: the drone, the transform, the scan point under the drone, the splat
 * entity, and a ray from the drone along DIR to the walls the craft flies in (null: no hit).
 */
const STATE = (dir: string) => `
    const p = s.sim.s; const tr = s.transform; const e = s.renderer.splat;
    const pos = [p[0], p[1], p[2]];
    const d = ${dir}; const n = Math.hypot(d[0], d[1], d[2]);
    const hit = s.collision.queryRay(pos[0], pos[1], pos[2], d[0] / n, d[1] / n, d[2] / n, 60);
    const ls = e ? e.getLocalScale() : null; const lp = e ? e.getLocalPosition() : null;
    return { pos, s: tr.s, t: [...tr.t], scanPoint: pos.map((v, i) => (v - tr.t[i]) / tr.s),
        ray: hit ? Math.hypot(hit.x - pos[0], hit.y - pos[1], hit.z - pos[2]) : null,
        entityScale: ls ? [ls.x, ls.y, ls.z] : null, entityPos: lp ? [lp.x, lp.y, lp.z] : null,
        flies: !!s.sim.world && s.sim.world.col === s.collision, voxel: s.collision.voxelResolution, baseVoxel: s.baseCollision.voxelResolution,
        stored: h.prefs.get('scene.transform', { scene: '${SCENE}' }), size: h.scale.size() };`;

/** The nearest wall from the drone among 14 directions (axes and diagonals), 0.3 m to 20 m away. */
const PICK_DIR = `
    const p = s.sim.s; let best = null;
    for (const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]]) {
        const n = Math.hypot(...d); const hit = s.collision.queryRay(p[0], p[1], p[2], d[0] / n, d[1] / n, d[2] / n, 20);
        if (!hit) continue; const r = Math.hypot(hit.x - p[0], hit.y - p[1], hit.z - p[2]);
        if (r > 0.3 && (!best || r < best.r)) best = { d, r };
    }
    return best;`;

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which, scene: SCENE };

// ------------------------------------------------------------------ SC1 x2 around the drone
if (want('SC1')) {
    const { ctx, page: p, log } = await open(browser);
    await load(p);
    const dir = await hook<{ d: number[]; r: number } | null>(p, PICK_DIR);
    if (!dir) throw new Error('no wall within 20 m of the spawn');
    const D = JSON.stringify(dir.d);
    const before = await hook(p, STATE(D));
    await hook(p, 'h.scale.set(2); return 0;');
    const x2 = await hook(p, STATE(D));
    await hook(p, 'h.prefs.flush(); return 0;');
    await p.reload();
    await waitReady(p, 240000);
    await hook(p, 'return s.visible.then(() => 0);');
    const reloaded = await hook(p, STATE(D));
    // control: reset around the drone gives x1 again, also after a reload
    await hook(p, 'h.scale.reset(); return 0;');
    const reset = await hook(p, STATE(D));
    await hook(p, 'h.prefs.flush(); return 0;');
    await p.reload();
    await waitReady(p, 240000);
    await hook(p, 'return s.visible.then(() => 0);');
    const resetReloaded = await hook(p, STATE(D));
    await ctx.close();

    const tolRay = before.baseVoxel; // 1 voxel of the scan's own walls
    const checks = {
        positionKeptMm: dist(x2.pos, before.pos) * 1000,
        scanPointKeptMm: dist(x2.scanPoint, before.scanPoint) * 1000,
        rayBefore: before.ray, rayX2: x2.ray, rayRatio: x2.ray / before.ray, rayErrM: Math.abs(x2.ray - 2 * before.ray),
        entityScale: x2.entityScale, entityPosIsT: x2.entityPos && dist(x2.entityPos, x2.t) < 1e-6,
        fliesScaledWalls: x2.flies, voxelX2: x2.voxel,
        reloadedSize: reloaded.size, reloadedEntity: reloaded.entityScale, reloadedStored: reloaded.stored
    };
    const pass = checks.positionKeptMm <= 1 && checks.scanPointKeptMm <= 1 && checks.rayErrM <= tolRay
        && x2.s === 2 && x2.entityScale?.every((v: number) => Math.abs(v - 2) < 1e-6) && checks.entityPosIsT && x2.flies && Math.abs(x2.voxel - 2 * before.baseVoxel) < 1e-9
        && x2.stored?.s === 2 && reloaded.size === 2 && reloaded.entityScale?.every((v: number) => Math.abs(v - 2) < 1e-6) && reloaded.flies;
    const control = {
        resetSize: reset.size, resetEntity: reset.entityScale, resetRay: reset.ray, resetReloadedSize: resetReloaded.size, resetReloadedEntity: resetReloaded.entityScale,
        fired: before.size === 1 && reset.size === 1 && reset.entityScale?.every((v: number) => Math.abs(v - 1) < 1e-6) && resetReloaded.size === 1
            && resetReloaded.entityScale?.every((v: number) => Math.abs(v - 1) < 1e-6) && Math.abs(reset.ray - before.ray) <= tolRay && Math.abs(reset.ray - x2.ray) > tolRay
    };
    out.SC1 = { pass: !!pass && control.fired && log.length === 0, what: 'x2 around the drone: position and scan point kept within 1 mm, a ray to a wall doubles within 1 voxel, the craft flies the scaled walls, splat entity scale 2 at t, kept after a reload', dir, before, x2, reloaded, checks, control, pageErrors: log };
    console.log('SC1', (out.SC1 as Any).pass ? 'PASS' : 'FAIL', JSON.stringify(checks));
}

// ------------------------------------------------------------------ SC2 ] x3 then [ x3
if (want('SC2')) {
    const { ctx, page: p, log } = await open(browser);
    await load(p);
    await p.mouse.click(640, 400); // the page has the focus (the keys go to window)
    const steps: { key: string; at50ms: number; at450ms: number }[] = [];
    for (const key of ['BracketRight', 'BracketRight', 'BracketRight', 'BracketLeft', 'BracketLeft', 'BracketLeft']) {
        await p.keyboard.press(key);
        await p.waitForTimeout(50);
        const at50ms = await hook<number>(p, 'return h.scale.size();');
        await p.waitForTimeout(400);
        steps.push({ key, at50ms, at450ms: await hook<number>(p, 'return h.scale.size();') });
    }
    const final = await hook(p, 'return { size: h.scale.size(), t: [...s.transform.t], stored: h.prefs.get(\'scene.transform\', { scene: \'' + SCENE + '\' }) };');
    await ctx.close();
    const up3 = steps[2].at450ms;
    const delayed = steps.every((st, i) => st.at50ms === (i === 0 ? 1 : steps[i - 1].at450ms));
    const pass = Math.abs(final.size - 1) <= 1e-6 && Math.abs(up3 - 1.331) <= 1e-5 && delayed && log.length === 0;
    const control = { afterUp3: up3, fired: Math.abs(up3 - 1) > 0.3 };
    out.SC2 = { pass: pass && control.fired, what: '] x3 then [ x3 returns to x1 within float error; each step applies after the 300 ms debounce', steps, final, delayedApply: delayed, control, pageErrors: log };
    console.log('SC2', (out.SC2 as Any).pass ? 'PASS' : 'FAIL', JSON.stringify({ steps, final: final.size }));
}

// ------------------------------------------------------------------ SC3 the summary panel's row
if (want('SC3')) {
    const { ctx, page: p, log } = await open(browser);
    await load(p);
    await p.mouse.click(640, 400);
    await p.keyboard.press('KeyP');
    await p.waitForSelector('[data-testid=scene-size]', { timeout: 10000 });
    const read = () => p.evaluate(`(() => { const r = document.querySelector('[data-testid=scene-size]'); const v = r.querySelector('[data-testid=scene-size-voxel]');
        return { value: r.querySelector('[data-testid=scene-size-value]').textContent, voxel: v.textContent, warn: v.classList.contains('warn'), size: window.__gsfpv.scale.size(), label: r.textContent.slice(0, 20) }; })()`) as Promise<Any>;
    const first = await read();
    await p.click('[data-testid=scene-size] [data-action=scale-up]');
    const plus = await read();
    await hook(p, 'h.scale.set(2.2); return 0;');
    await p.waitForTimeout(100);
    const coarse = await read();
    await ctx.close();
    const pass = first.value === 'x1.00' && first.size === 1 && plus.value === 'x1.10' && Math.abs(plus.size - 1.1) < 1e-6 && coarse.warn === true && /11\.0/.test(coarse.voxel) && log.length === 0;
    const control = { atX1: first, fired: first.warn === false && /5\.0/.test(first.voxel) };
    out.SC3 = { pass: pass && control.fired, what: 'summary panel row: x1.00, [+] gives x1.10, walls block size shown, warning above 10 cm', first, plus, coarse, control, pageErrors: log };
    console.log('SC3', (out.SC3 as Any).pass ? 'PASS' : 'FAIL', JSON.stringify({ first, plus, coarse }));
}

await browser.close();
const all = Object.entries(out).filter(([k]) => /^SC\d$/.test(k)).every(([, v]) => (v as Any).pass);
const file = writeEvidence('v03-scale', { pass: all, ...out });
console.log(all ? 'ALL PASS' : 'SOME FAIL', '->', file);
process.exit(all ? 0 : 1);
