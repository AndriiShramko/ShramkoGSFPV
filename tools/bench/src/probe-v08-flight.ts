// v0.8 lane C, review finding 1: what the quality governor does while the camera FLIES through the owner's
// streamed city scan (ba7aa29d, 60.3 M splats in 10 levels). The acceptance (accept-v08-lod.ts L1) keeps
// the camera still; a flight keeps the streamer busy all the time, which is where a rule about streaming
// would matter. One run opens the scan on one release, waits for the reveal and CALM_S seconds, then moves
// the camera along a spiral (a fixed path, the same on every release: SPEED units/s, radius growing from
// R0 to R1 around a point ahead of the scan's own start view, at the start height, looking along the path)
// for FLY_S seconds, and records every frame the way the governor sees it:
//   t (the frame's rAF timestamp, renderer.frameTime), the latency guard's skip flag, framesHeld,
//   streamTicks (-1 on a release without it), files in flight, the governor's step, budget, render scale,
//   splats drawn; plus files requested per second (the CDN's scene folder).
// It then replays the same frames through THIS worktree's FrameGovernor (packages/render-pc/src/governor.ts)
// to show what that rule would have decided on exactly these frames (an estimate: the replay has no
// feedback; the page's own governor changes the load it then sees). The camera is moved through the
// session's cameraOverride (the crash view's switch), the sim keeps running underneath.
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock), in a visible window.
//   SITE=http://127.0.0.1:5383 LABEL=after npx tsx src/probe-v08-flight.ts
// Options: FLY_S (default 30), CALM_S (5), SPEED (12), R0 (20), R1 (120). Evidence:
// evidence/<date>/v08-flight-<label>.json and .png.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';
import { FrameGovernor, MISSED_PERIODS } from '../../../packages/render-pc/src/governor';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5383').replace(/\/$/, '');
const LABEL = process.env.LABEL ?? 'run';
const SCENE = process.argv[2] ?? 'ba7aa29d';
const FLY_S = Number(process.env.FLY_S ?? 30);
const CALM_S = Number(process.env.CALM_S ?? 5);
const SPEED = Number(process.env.SPEED ?? 12);
const R0 = Number(process.env.R0 ?? 20);
const R1 = Number(process.env.R1 ?? 120);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Per-frame recorder, installed once the session exists (a string: tsx would wrap a function in __name). */
const RECORD = `(() => {
    const h = window.__gsfpv; const r = h.session.renderer; const a = r.app;
    window.__flightTrace = [];
    a.on('frameend', () => {
        const g = h.governor;
        if (window.__flightTrace.length < 40000) window.__flightTrace.push([
            r.frameTime, r.frameAfterSkip ? 1 : 0, r.framesHeld, typeof r.streamTicks === 'number' ? r.streamTicks : -1,
            r.splatFrame.loading, g ? g.step : -1, a.scene.gsplat.splatBudget / 1e6, r.renderScale, a.stats.frame.gsplats, window.__flying ? 1 : 0
        ]);
    });
    return true;
})()`;
const COLS = ['t', 'afterSkip', 'framesHeld', 'streamTicks', 'loading', 'step', 'budgetM', 'scale', 'drawn', 'flying'];

/** The camera's spiral: starts at the scan's start view, moves SPEED units/s, radius R0 -> R1 over FLY_S. */
const FLY = `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const p0 = r.camera.getPosition().clone(); const f = r.camera.forward.clone();
    const fl = Math.hypot(f.x, f.z) || 1; const fx = f.x / fl, fz = f.z / fl;
    const c = { x: p0.x + fx * ${R0}, z: p0.z + fz * ${R0} };
    // the start angle puts the camera at p0 on the circle around c
    let ang = Math.atan2(p0.z - c.z, p0.x - c.x);
    s.cameraOverride = true; window.__flying = true;
    const t0 = performance.now(); let last = t0;
    const onUpdate = () => {
        const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const el = (now - t0) / 1000;
        if (el > ${FLY_S}) { a.off('update', onUpdate); window.__flying = false; return; }
        const R = ${R0} + (${R1} - ${R0}) * el / ${FLY_S};
        ang += ${SPEED} * dt / R;
        const px = c.x + R * Math.cos(ang), pz = c.z + R * Math.sin(ang);
        // along the path: the tangent, a little down
        const tx = px - Math.sin(ang) * 10, tz = pz + Math.cos(ang) * 10;
        r.setCameraLookAt(px, p0.y, pz, tx, p0.y - 1.5, tz);
    };
    a.on('update', onUpdate);
    return { p0: [p0.x, p0.y, p0.z], c: [c.x, c.z] };
})()`;

const FINEST = `(() => {
    const r = window.__gsfpv.session.renderer; const per = {};
    const dir = r.app.renderer.gsplatDirector;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        const w = ld.gsplatManager && ld.gsplatManager.world;
        if (w && w._octreeInstances) w._octreeInstances.forEach((inst) => inst.nodeInfos.forEach((ni, i) => {
            if (ni.currentLod < 0) return; const c = inst.octree.nodes[i].lods[ni.currentLod];
            per[ni.currentLod] = (per[ni.currentLod] || 0) + (c ? c.count : 0);
        }));
    }));
    const g = window.__gsfpv.governor;
    return { perLevel: per, changes: g ? g.changes : null, periodMs: g ? g.displayPeriodMs : null };
})()`;

/** Replay the recorded frames through this worktree's governor (no feedback: an estimate). */
function replay(rows: number[][]): { changes: number; maxStep: number; stepsPerSecond: number[] } {
    const g = new FrameGovernor();
    let held = rows[0]?.[2] ?? 0;
    let changes = 0, maxStep = 0;
    const t0 = rows[0]?.[0] ?? 0;
    const steps: number[] = [];
    for (const row of rows) {
        const [t, skip, fh] = row;
        const isHeld = fh !== held;
        held = fh;
        if (g.onFrame(t, skip === 1, isHeld)) changes++;
        maxStep = Math.max(maxStep, g.step);
        steps[Math.floor((t - t0) / 1000)] = g.step;
    }
    return { changes, maxStep, stepsPerSecond: steps.map((x) => x ?? -1) };
}

async function main(): Promise<void> {
    const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    const requests: number[] = [];
    page.on('request', (rq) => { if (rq.url().includes(`/${SCENE}/`)) requests.push(Date.now()); });
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&nowarn=1&input=touch`);
    const ready = await waitReady(page, 240000);
    if (ready.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(ready)}`);
    for (let i = 0; i < 480; i++) {
        if (await page.evaluate('window.__gsfpv.session.timings.visibleMs !== null')) break;
        await page.waitForTimeout(250);
    }
    await page.evaluate(RECORD);
    await page.waitForTimeout(CALM_S * 1000);
    const atStart: Any = await page.evaluate(FINEST);
    const flyStartWall = Date.now();
    const path = await page.evaluate(FLY);
    const mid: Any[] = [];
    for (let i = 0; i < FLY_S; i++) {
        await page.waitForTimeout(1000);
        mid.push({ s: i + 1, ...(await page.evaluate(FINEST)) });
        if (i === Math.floor(FLY_S / 2)) await page.screenshot({ path: join(REPO, 'evidence', today(), `v08-flight-${LABEL}-mid.png`) });
    }
    await page.waitForTimeout(1500);
    const rows: number[][] = await page.evaluate('window.__flightTrace');
    const dir = join(REPO, 'evidence', today());
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `v08-flight-${LABEL}.png`) });
    const end: Any = await page.evaluate(FINEST);
    await browser.close();

    // per second of the flight, as the governor sees frames: late = above 1.25 learned periods, held, streaming
    const period = end.periodMs as number;
    const fly = rows.filter((x) => x[9] === 1);
    const t0 = fly[0]?.[0] ?? 0;
    const perSecond: Any[] = [];
    let prev = rows[rows.indexOf(fly[0]) - 1] ?? fly[0];
    for (const x of fly) {
        const sec = Math.floor((x[0] - t0) / 1000);
        const b = perSecond[sec] ??= { s: sec + 1, frames: 0, late: 0, held: 0, streamed: 0, loadingMax: 0, stepMax: 0, budgetMin: Infinity, scaleMin: Infinity, requests: 0 };
        const dt = x[0] - prev[0];
        b.frames++;
        if (x[1] !== 1 && dt > MISSED_PERIODS * period) b.late++;
        if (x[2] !== prev[2]) b.held++;
        if (x[3] >= 0 && x[3] !== prev[3]) b.streamed++;
        b.loadingMax = Math.max(b.loadingMax, x[4]);
        b.stepMax = Math.max(b.stepMax, x[5]);
        b.budgetMin = Math.min(b.budgetMin, x[6]);
        b.scaleMin = Math.min(b.scaleMin, x[7]);
        prev = x;
    }
    for (const t of requests) {
        const sec = Math.floor((t - flyStartWall) / 1000);
        if (sec >= 0 && perSecond[sec]) perSecond[sec].requests++;
    }
    const n = fly.length;
    const sum = (k: string) => perSecond.reduce((a, b) => a + (b?.[k] ?? 0), 0);
    const summary = {
        site: SITE, label: LABEL, scene: SCENE, flyS: FLY_S, speed: SPEED, radius: [R0, R1], path,
        framesFlown: n, fps: Math.round(n / FLY_S * 10) / 10, displayPeriodMs: Math.round(period * 10) / 10,
        lateShare: Math.round(sum('late') / n * 1000) / 10, heldShare: Math.round(sum('held') / n * 1000) / 10,
        streamedShare: rows[0]?.[3] >= 0 ? Math.round(sum('streamed') / n * 1000) / 10 : null,
        filesRequestedInFlight: sum('requests'),
        pageGovernor: { changesBefore: atStart.changes, changesAfter: end.changes, maxStep: Math.max(...fly.map((x) => x[5])), minBudgetM: Math.min(...fly.map((x) => x[6])), minScale: Math.min(...fly.map((x) => x[7])) },
        replayThisWorktree: replay(rows),
        finestAtEnd: Object.keys(end.perLevel).map(Number).filter((k) => end.perLevel[k] > 0).sort((a, b) => a - b)[0] ?? null,
        pageerrors: log
    };
    console.log(JSON.stringify(summary, null, 1));
    console.log(perSecond.map((b) => `s${b.s} f${b.frames} late${b.late} held${b.held} str${b.streamed} load${b.loadingMax} req${b.requests} step${b.stepMax} ${b.budgetMin}M ${b.scaleMin}`).join('\n'));
    writeEvidence(`v08-flight-${LABEL}`, { browser: which, summary, perSecond, mid, atStart, end, traceColumns: COLS, trace: rows });
}

await main();
