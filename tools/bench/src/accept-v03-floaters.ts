// W4-2 acceptance (docs/architecture-v03.md G.3, the owner's item 24: phantom walls): the floater
// filter in the real page with the scan drawn (the voxel grid needs the GPU, so not ?render=off).
// Fresh browser context; every check has a negative control that must fire.
//   F1 Settings -> Walls and voxel grid, "Drop floating pieces under N blocks" = 64 on 39e63ce9:
//      a ray down onto a known floating piece hits the walls the craft flies before and passes
//      after; the life header names N and the filtered walls' hash; the voxel grid rebuilds without
//      the dropped pieces and its status line says so; the value survives a reload.
//      Controls: a ray onto the largest piece (a real wall) still hits after; N back to 0 brings
//      the floater back (hit again, the grid's piece count back) and that survives a reload too.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5342 npx tsx src/accept-v03-floaters.ts
// Evidence: evidence/<date>/v03-floaters.json.
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5342').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const N = 64;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

async function load(p: Page, qs = ''): Promise<void> {
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch${qs}`));
    await waitReady(p, 240000);
    await hook(p, 'return s.visible.then(() => 0);');
}

/**
 * Probe voxel v of the walls the craft flies (index space; a filter and the scene size never move
 * an index): is it solid, and does a ray from the centre of the empty voxel above it, two voxels
 * long, hit (distance in voxels). Also whether the flight model flies these very walls.
 */
const PROBE = (v: number[]) => `
    const c = s.collision; const r = c.voxelResolution; const v = ${JSON.stringify(v)};
    const at = (i, j, k) => { let x = c.gridMinX + (i + 0.5) * r, y = c.gridMinY + (j + 0.5) * r, z = c.gridMinZ + (k + 0.5) * r; if (c.flipXY) { x = -x; y = -y; } return [x, y, z]; };
    const a = at(v[0], v[1] + 1, v[2]), b = at(v[0], v[1], v[2]);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const n = Math.hypot(d[0], d[1], d[2]);
    const hit = c.queryRay(a[0], a[1], a[2], d[0] / n, d[1] / n, d[2] / n, 2 * r);
    return { solid: c.isVoxelSolid(v[0], v[1], v[2]), hit: !!hit, distVoxels: hit ? Math.hypot(hit.x - a[0], hit.y - a[1], hit.z - a[2]) / r : null,
        flies: !!s.sim.world && s.sim.world.col === c };`;

const STATE = `
    const f = h.floaters.state(); const sc = s.runner.current().header.scene; const v = h.voxels.stats();
    const st = document.querySelector('[data-testid="voxels-status"]');
    return { ...f, header: { floaterMinBlocks: sc.floaterMinBlocks, floaterSha256: sc.floaterSha256 ?? null },
        grid: { state: v.state, components: v.components, floaters: v.floaters, dropped: v.dropped }, status: st ? st.textContent : null };`;

/** The voxel grid over the scan, everything wanted drawn (it rebuilds when the walls change). */
async function gridSettled(p: Page, components?: number): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
        const ok = await hook<boolean>(p, `const v = h.voxels.stats(); return v.state === 'ready' && h.voxels.settled()${components === undefined ? '' : ` && v.components === ${components}`};`);
        if (ok) return;
        await p.waitForTimeout(250);
    }
    throw new Error('the voxel grid did not settle');
}

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, browser: which, scene: SCENE, minBlocks: N };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const log: string[] = [];
p.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));

// ---- before: the scan's own walls, the grid over the scan, Settings open on the row
await load(p, '&open=settings&focus=scene.dropFloaters');
await hook(p, "h.voxels.setMode('overlay'); return 0;");
await gridSettled(p);
const pieces = await hook<{ size: number; voxel: number[] }[]>(p, 'return h.floaters.pieces();');
const small = pieces.filter((x) => x.size < N);
if (small.length === 0) throw new Error(`no piece under ${N} blocks in ${SCENE}`);
const floater = small[0]; // the largest of the pieces the filter drops
const wall = pieces[0]; // the largest piece: a real wall
const before = { state: await hook(p, STATE), floater: await hook(p, PROBE(floater.voxel)), wall: await hook(p, PROBE(wall.voxel)) };

// ---- the Settings row, as a pilot types it
const row = p.locator(`[data-testid="setting-scene.dropFloaters"]`);
const rowVisible = await row.isVisible();
const field = row.locator('input.num');
await field.fill(String(N));
await field.press('Enter');
await p.waitForTimeout(300);
const want = before.state.grid.components - small.length;
await gridSettled(p, want);
const after = { state: await hook(p, STATE), floater: await hook(p, PROBE(floater.voxel)), wall: await hook(p, PROBE(wall.voxel)) };

// ---- a reload keeps it
await load(p);
await hook(p, "h.voxels.setMode('overlay'); return 0;");
await gridSettled(p, want);
const reloaded = { state: await hook(p, STATE), floater: await hook(p, PROBE(floater.voxel)), wall: await hook(p, PROBE(wall.voxel)) };

// ---- control: back to 0 brings the floater back, and that survives a reload too
await hook(p, 'h.floaters.set(0); return 0;');
await gridSettled(p, before.state.grid.components);
const back = { state: await hook(p, STATE), floater: await hook(p, PROBE(floater.voxel)) };
await load(p);
const backReloaded = { state: await hook(p, STATE), floater: await hook(p, PROBE(floater.voxel)) };
await ctx.close();
await browser.close();

const hex = (x: unknown) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const checks = {
    settingsRowShown: rowVisible,
    hitBefore: before.floater.solid && before.floater.hit && before.floater.flies,
    passesAfter: !after.floater.solid && !after.floater.hit && after.floater.flies,
    filterState: after.state.minBlocks === N && after.state.pieces === small.length && after.state.stored === N,
    headerNamesFilter: after.state.header.floaterMinBlocks === N && hex(after.state.header.floaterSha256) && after.state.header.floaterSha256 === after.state.sha256,
    gridWithoutThem: after.state.grid.components === want && after.state.grid.dropped?.minBlocks === N && after.state.grid.dropped?.pieces === small.length,
    statusSaysDropped: typeof after.state.status === 'string' && after.state.status.includes(String(small.length)) && after.state.status.includes(String(N)),
    reloadKeeps: reloaded.state.minBlocks === N && !reloaded.floater.hit && reloaded.state.header.floaterSha256 === after.state.sha256 && reloaded.state.grid.components === want,
    noPageErrors: log.length === 0
};
const control = {
    wallStillHit: after.wall.hit && after.wall.solid && reloaded.wall.hit,
    backToZero: back.state.minBlocks === 0 && back.floater.hit && back.floater.solid && back.state.grid.components === before.state.grid.components && back.state.header.floaterSha256 === null,
    backSurvivesReload: backReloaded.state.minBlocks === 0 && backReloaded.floater.hit
};
const fired = Object.values(control).every(Boolean);
const pass = Object.values(checks).every(Boolean) && fired;
out.F1 = {
    pass,
    what: `Settings row "Drop floating pieces under N blocks" = ${N} on ${SCENE}: a ray onto a known floating piece hits the flown walls before and passes after, the life header names N and the filtered walls' hash, the voxel grid rebuilds without the dropped pieces, the value survives a reload`,
    floater, wall: { size: wall.size, voxel: wall.voxel }, piecesTotal: pieces.length, piecesUnderN: small.length,
    checks, control: { ...control, fired }, before, after, reloaded, back, backReloaded, pageErrors: log
};
console.log('F1', pass ? 'PASS' : 'FAIL', JSON.stringify({ checks, control }));
const file = writeEvidence('v03-floaters', { pass, ...out });
console.log(file);
process.exit(pass ? 0 : 1);
