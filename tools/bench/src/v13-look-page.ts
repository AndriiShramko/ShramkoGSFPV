// v0.13 lane v13-look (docs/wip/v13-look.md): the lesson worlds in the real page of a local release build, headless Chrome,
// the keyboard only (the game scheme's W, Space). Scenarios:
//   bump   L1-2 (W17 of the sound package's merge review):
//          - walls-hall: from the start at rest, W held (full stick): the time to the first touch, in the flight model's own
//            ticks (the worlds' model says 2 to 3 s);
//          - tunnel-gaps and tunnel-long: a respawn under a block, made by the lesson runner itself: the craft put where the
//            runner puts one (RESPAWN_BEFORE_M before the track point past the block, under the block's edge; in tunnel-long
//            0.35 m over the floor and 0.35 m under the block), W past that point, Space into the ceiling further on (a
//            touch: the runner re-centres it under the block); there it must stay, with no second touch and no second
//            re-centre (the take-off hop of v0.12 met the block there: a loop), and W must fly it on.
//   look   L1-3 (M41-23): walls-hall, the corridor, tunnel-gaps and rings-heights from a view each: a picture as the pilot
//          sees it, the view alone (the overlays hidden) in the look and in the stage's role paint (window.__gsfpv.sonicLook):
//          the mean luminance of floor, walls and ceiling and every obstacle against its surround, 3:1 or more (WCAG);
//          the full-size PNGs are kept on U: (LOOK_KEEP), small JPEGs in the evidence.
//   cost   L1-4: tunnel-long, the corridor and rings-heights, six views each along the world's track: the engine's CPU
//          time per frame, the GPU time of the render passes (WebGPU timestamps), the frame intervals, the sound planner's
//          cost; TAG=<name> keeps a second run beside the first (the look before and after).
// Every check is the page's own state (window.__gsfpv: the session, its flight model, the mode's hook); the sim events are
// read through the session's onEvent. Holds the GPU lock C:/dev/.gpu-lock (one blocking loop: mkdir, else 20 s, up to
// 9 min; rmdir after, on error too). Evidence: evidence/<date>/v13-look-<scenario>.json, small JPEGs beside it.
//   node scripts/build-release.mjs && node tools/bench/scripts/serve-csp.mjs dist 5420     (another shell)
//   cd tools/bench && SITE=http://localhost:5420 npx tsx src/v13-look-page.ts bump
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { RESPAWN_BEFORE_M, createAnalyticWorld, defaultPrefs, getLesson } from '../../../packages/sonic-fpv/src';
import type { WorldCheckpoint } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
const SCENARIO = process.argv[2] ?? 'bump';
/** TAG=<name>: a second run of a scenario kept beside the first (the cost of the look before and after: TAG=v012-look) */
const TAG = (process.env.TAG ?? '').replace(/[^a-z0-9-]/g, '');
console.log(`v13-look-page target: ${SITE}, scenario ${SCENARIO}`);
const LOCK = 'C:/dev/.gpu-lock';
const OUT = join(REPO, 'evidence', today(), `v13-look-${SCENARIO}${TAG ? `-${TAG}` : ''}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the GPU lock

let locked = false;
async function lock(): Promise<void> {
    const t0 = Date.now();
    for (;;) {
        try {
            mkdirSync(LOCK);
            locked = true;
            return;
        } catch {
            if (Date.now() - t0 > 9 * 60 * 1000) throw new Error('the GPU lock stayed taken for 9 minutes');
            console.log('waiting for the GPU lock');
            await sleep(20000);
        }
    }
}
function unlock(): void {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* gone */
    }
}
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

// ------------------------------------------------------------------ the page

/** The prefs the page starts from: the engine silent (a screen reader would speak), double speed, the warning seen. */
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-08T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};
const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
})();`;

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 320)}`);
};

/** Polls `read` until `pred` (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
async function until<T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v).slice(0, 300)}`);
        await sleep(50);
    }
}

interface Craft {
    tick: number;
    pos: [number, number, number];
    vel: [number, number, number];
    platOn: boolean;
    armed: boolean;
    bump: string;
    phase: string | null;
    lesson: string | null;
}
interface SimEv { type: string; tick: number; speed?: number; nx?: number; ny?: number; nz?: number; onPlatform: boolean }

/** The flight model now (sim-core S slots: px 0, py 1, pz 2, vx 3, vy 4, vz 5, platOn 65) and the lesson's phase. */
const craft = (page: Page): Promise<Craft> =>
    page.evaluate(() => {
        const h = (window as unknown as { __gsfpv: { session: { sim: { tick: number; s: Float64Array; armed: boolean; p: { bump?: string } } }; sonic?: (e?: boolean) => { phase: string | null; lesson: string | null } } }).__gsfpv;
        const sim = h.session.sim;
        const s = sim.s;
        const son = h.sonic ? h.sonic(false) : null;
        return { tick: sim.tick, pos: [s[0], s[1], s[2]] as [number, number, number], vel: [s[3], s[4], s[5]] as [number, number, number], platOn: s[65] > 0, armed: sim.armed, bump: sim.p.bump ?? 'none', phase: son ? son.phase : null, lesson: son ? son.lesson : null };
    });

/** Every sim event from now on, kept in the page (the session's onEvent, chained), with whether the craft was on its platform. */
const watchEvents = (page: Page): Promise<void> =>
    page.evaluate(() => {
        const w = window as unknown as { __look?: { events: unknown[] }; __gsfpv: { session: { onEvent: ((e: { type: string; tick: number; speed?: number; nx?: number; ny?: number; nz?: number }) => void) | null; sim: { s: Float64Array } } } };
        const look = { events: [] as unknown[] };
        w.__look = look;
        const s = w.__gsfpv.session;
        const prev = s.onEvent;
        s.onEvent = (e) => {
            prev?.(e);
            if (e.type === 'contact' || e.type === 'crash' || e.type === 'respawn') look.events.push({ type: e.type, tick: e.tick, speed: e.speed, nx: e.nx, ny: e.ny, nz: e.nz, onPlatform: s.sim.s[65] > 0 });
        };
    });
const events = (page: Page): Promise<SimEv[]> => page.evaluate(() => ((window as unknown as { __look: { events: SimEv[] } }).__look.events.slice()));

/** /en/fly/?sonic=<lesson>, Enter on the start screen's button (the user activation), until the lesson flies, its intro skipped with N. */
async function openLesson(ctx: BrowserContext, lesson: string): Promise<{ page: Page; errors: string[] }> {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console: ${m.text()}`.slice(0, 300));
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) errors.push(`${r.status()} ${r.url()}`.slice(0, 300));
    });
    await page.goto(`${SITE}/en/fly/?sonic=${lesson}&nowarn=1`);
    await until('the start screen', () => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]')), (v) => v, 60000);
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until('the lesson', () => page.evaluate(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic ? h.sonic(false).lesson : null; }), (v) => v === lesson, 90000);
    // the intro, line by line: N says the next line at once; the attempt begins at the lesson's start
    const t0 = Date.now();
    for (;;) {
        const c = await craft(page);
        if (c.phase === 'flying') break;
        if (Date.now() - t0 > 60000) throw new Error(`${lesson}: no attempt after 60 s (phase ${c.phase})`);
        if (c.phase === 'intro') await page.keyboard.press('KeyN');
        await sleep(400);
    }
    await watchEvents(page);
    return { page, errors };
}

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
const shot = async (page: Page, name: string): Promise<string> => {
    const file = join(OUT, `${name}.jpg`);
    writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 70 }));
    return file.slice(REPO.length + 1).replace(/\\/g, '/');
};

// ------------------------------------------------------------------ bump (L1-2, W17)

/** walls-hall: W held from the start at rest; the first contact off the platform, in ticks of the flight model. */
async function wallsHallTouch(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const { page, errors } = await openLesson(ctx, 'walls-hall');
    const lesson = getLesson('walls-hall');
    const start = await craft(page);
    check('walls-hall: the lesson flies with the lesson bump (sim-core bump slide), the craft at its start, at rest', start.bump === 'slide' && dist(start.pos, lesson.start.pos) < 0.15 && Math.hypot(...start.vel) < 0.05, { bump: start.bump, pos: start.pos.map((v) => round(v)), speed: round(Math.hypot(...start.vel)) });
    await page.keyboard.down('KeyW');
    const pressed = await craft(page);
    const t0 = Date.now();
    let touch: SimEv | null = null;
    let path: Craft[] = [];
    while (Date.now() - t0 < 10000 && !touch) {
        const c = await craft(page);
        path.push(c);
        touch = (await events(page)).find((e) => e.type === 'contact' && !e.onPlatform && e.tick >= pressed.tick) ?? null;
        await sleep(20);
    }
    const at = await craft(page);
    const view = await shot(page, 'walls-hall-touch');
    await page.keyboard.up('KeyW');
    const seconds = touch ? (touch.tick - pressed.tick) / 1000 : null;
    const top = Math.max(...path.map((c) => Math.hypot(c.vel[0], c.vel[2])));
    check('walls-hall: full stick from the start meets a wall (a contact off the platform)', touch !== null, touch);
    check(`walls-hall: the first touch ${seconds === null ? 'never' : `${seconds.toFixed(2)} s`} after the stick went full (the worlds' model: 2 to 3 s)`, seconds !== null && seconds >= 2 && seconds <= 3, { seconds, ticks: touch ? touch.tick - pressed.tick : null, topSpeedMps: round(top, 2), capMps: lesson.assists.maxSpeedMps, travelledM: round(dist(start.pos, at.pos), 2), normal: touch ? [touch.nx, touch.ny, touch.nz].map((v) => round(v ?? NaN, 2)) : null });
    check('walls-hall: no page error', errors.length === 0, errors);
    await page.close();
    return { seconds, ticks: touch ? touch.tick - pressed.tick : null, touch, topSpeedMps: round(top, 2), start: start.pos, atTouch: at.pos, view };
}

/**
 * A respawn under a block, as the lesson runner makes it: the craft put RESPAWN_BEFORE_M before the track point past the
 * block (the runner's own place, under the block's edge), W flies it past that point (the runner marks it passed), Space
 * climbs it into the ceiling further on (a touch: the runner re-centres it to its place under the block, motors on). Then:
 * it must stay there, not touch again (a second touch would re-centre it to the same place: a loop), and W must fly it on.
 */
async function respawnUnderBlock(ctx: BrowserContext, lessonId: string): Promise<Record<string, unknown>> {
    const lesson = getLesson(lessonId);
    if (lesson.world.kind !== 'analytic') throw new Error(`${lessonId} is not an analytic world`);
    const world = createAnalyticWorld(lesson.world.spec);
    // the runner's respawn points (runner.ts respawn()) under a block: the way above them under 0.8 m and a block over it
    const points = (world as unknown as { checkpoints: readonly WorldCheckpoint[] }).checkpoints;
    let pick: { pose: [number, number, number, number]; point: WorldCheckpoint; upM: number; downM: number } | null = null;
    for (const p of points) {
        const at: [number, number, number] = [p.pos[0] - p.dir[0] * RESPAWN_BEFORE_M, p.pos[1], p.pos[2] - p.dir[2] * RESPAWN_BEFORE_M];
        const up = world.castRay(at, [0, 1, 0], 5), down = world.castRay(at, [0, -1, 0], 5);
        if (!up || !down || up.objectId === null || up.distance + down.distance > 1.3) continue;
        if (pick && pick.upM + pick.downM <= up.distance + down.distance) continue;
        pick = { pose: [at[0], at[1], at[2], (Math.atan2(p.dir[0], -p.dir[2]) * 180) / Math.PI], point: p, upM: up.distance, downM: down.distance };
    }
    if (!pick) throw new Error(`${lessonId}: no respawn point under a block`);
    const { pose, point } = pick;
    check(`${lessonId}: the runner's respawn point under a block (the lowest way under one: ${(pick.upM + pick.downM).toFixed(2)} m)`, true, { pose: pose.map((v) => round(v)), aboveM: round(pick.upM), belowM: round(pick.downM) });

    const { page, errors } = await openLesson(ctx, lessonId);
    const along = (c: Craft): number => (c.pos[0] - point.pos[0]) * point.dir[0] + (c.pos[2] - point.pos[2]) * point.dir[2];
    const sinceTick = async (tick: number, type: string): Promise<SimEv[]> => (await events(page)).filter((e) => e.type === type && e.tick > tick && !(type === 'contact' && e.onPlatform));
    // 1. put there the way the runner puts a craft (the mode's place(): the session's spawn, a logged respawn)
    await page.evaluate((p) => {
        const s = (window as unknown as { __gsfpv: { session: { spawn: number[]; respawnStart(): void } } }).__gsfpv.session;
        s.spawn = [p[0], p[1], p[2], p[3]];
        s.respawnStart();
    }, pose);
    const placed = await until('the place', () => craft(page), (c) => dist(c.pos, pose) < 0.1, 5000);
    await sleep(300);
    // 2. W in short pulses just past the track point (the runner marks it passed): the craft stops before the next point
    //    (1.25 m on; full stick coasts 1.3 m after the key is let go)
    const t2 = Date.now();
    while (along(await craft(page)) <= 0.05) {
        if (Date.now() - t2 > 20000) throw new Error(`${lessonId}: the craft never passed the track point`);
        await page.keyboard.down('KeyW');
        await sleep(120);
        await page.keyboard.up('KeyW');
        await sleep(350);
    }
    await sleep(1000);
    const past = await craft(page);
    // 3. Space into the ceiling further on: a touch, and the runner re-centres the craft under the block
    await page.keyboard.down('Space');
    let lastBefore = past;
    const back = await until('the re-centre', async () => {
        const n = (await sinceTick(past.tick, 'respawn')).length;
        if (n === 0) lastBefore = await craft(page);
        return n;
    }, (n) => n > 0, 15000).catch(() => 0);
    await page.keyboard.up('Space');
    console.log(`${lessonId}: stopped past the point at ${past.pos.map((v) => round(v)).join(', ')} (${round(along(past))} m past it); last seen before the re-centre at ${lastBefore.pos.map((v) => round(v)).join(', ')}`);
    const recentred = await until('the craft under the block again', () => craft(page), (c) => dist(c.pos, pose) < 0.15, 3000).catch(async () => craft(page));
    const view = await shot(page, `${lessonId}-recentred`);
    check(`${lessonId}: Space into the ceiling past the block is a touch, and the runner puts the craft back under the block (RESPAWN_BEFORE_M before the point passed)`, back > 0 && dist(recentred.pos, pose) < 0.15, { recentres: back, at: recentred.pos.map((v) => round(v)), pose: pose.map((v) => round(v)) });
    // 4. there: the motors on, 2.5 s with the sticks centred: no touch, no second re-centre, within 0.1 m of the place
    let far = 0;
    for (let i = 0; i < 25; i++) {
        await sleep(100);
        far = Math.max(far, dist((await craft(page)).pos, pose));
    }
    const touches = await sinceTick(recentred.tick, 'contact');
    const again = await sinceTick(recentred.tick, 'respawn');
    const settled = await craft(page);
    check(`${lessonId}: back under the block it stays (2.5 s, the sticks centred): within 0.1 m of the place, no touch, no second re-centre`, far < 0.1 && touches.length === 0 && again.length === 0, { farthestM: round(far, 3), touches: touches.length, recentres: again.length, armed: settled.armed, platOn: settled.platOn });
    // 5. W flies it on
    await page.keyboard.down('KeyW');
    await sleep(2000);
    const on = await craft(page);
    await page.keyboard.up('KeyW');
    const onTouches = await sinceTick(settled.tick, 'contact');
    check(`${lessonId}: then W for 2 s flies it on along the track (1.5 m or more), no touch`, along(on) - along(settled) >= 1.5 && onTouches.length === 0, { movedM: round(along(on) - along(settled), 2), touches: onTouches.length });
    check(`${lessonId}: no page error`, errors.length === 0, errors);
    await page.close();
    return { pose, placedTick: placed.tick, recentres: back, settledFarM: far, touchesThere: touches.length, secondRecentres: again.length, movedOnM: along(on) - along(settled), view };
}

async function scenarioBump(ctx: BrowserContext): Promise<Record<string, unknown>> {
    return { wallsHall: await wallsHallTouch(ctx), tunnelGaps: await respawnUnderBlock(ctx, 'tunnel-gaps'), tunnelLong: await respawnUnderBlock(ctx, 'tunnel-long') };
}

// ------------------------------------------------------------------ cost (L1-4)

interface Stats { n: number; p50: number; p95: number; max: number; mean: number }
function stats(v: readonly number[]): Stats | null {
    if (v.length === 0) return null;
    const s = [...v].sort((a, b) => a - b);
    const q = (f: number): number => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]!;
    return { n: s.length, p50: round(q(0.5)), p95: round(q(0.95)), max: round(s[s.length - 1]!), mean: round(s.reduce((a, b) => a + b, 0) / s.length) };
}

/**
 * The page's frame in a lesson world, at views along the world's track (the craft put there by the respawn path, facing
 * along the track, parked): the engine's CPU time per frame (frameupdate to frameend: the flight model, the mode and its
 * sound planner, the scene update, the encoding of the draw), the GPU time per frame (the sum of the render passes, from
 * the engine's WebGPU timestamp queries, when the device has them) and the frame intervals.
 */
async function frameCost(ctx: BrowserContext, lessonId: string, views: number): Promise<Record<string, unknown>> {
    const lesson = getLesson(lessonId);
    if (lesson.world.kind !== 'analytic') throw new Error(`${lessonId} is not an analytic world`);
    const world = createAnalyticWorld(lesson.world.spec);
    const track = (world as unknown as { checkpoints?: readonly WorldCheckpoint[] }).checkpoints ?? [];
    if (track.length < 2) throw new Error(`${lessonId}: no track`);
    const { page, errors } = await openLesson(ctx, lessonId);
    const gpu = await page.evaluate(() => {
        type Prof = { enabled: boolean; report: (v: number, t: number[] | null, f?: number) => void };
        const w = window as unknown as { __cost?: unknown; __gsfpv: { session: { renderer: { app: { on(e: string, f: () => void): void }; device: { isWebGPU: boolean; supportsTimestampQuery?: boolean; gpuProfiler?: Prof } } } } };
        const r = w.__gsfpv.session.renderer;
        const P = { cpu: [] as number[], gpu: [] as number[], intervals: [] as number[], recording: false, lastEnd: 0, gpuSupported: false };
        w.__cost = P;
        let tStart = 0;
        r.app.on('frameupdate', () => { tStart = performance.now(); });
        r.app.on('frameend', () => {
            const t = performance.now();
            if (P.recording && tStart) {
                P.cpu.push(t - tStart);
                if (P.lastEnd) P.intervals.push(t - P.lastEnd);
            }
            P.lastEnd = t;
        });
        const dev = r.device;
        const prof = dev.gpuProfiler;
        if (dev.isWebGPU && dev.supportsTimestampQuery && prof) {
            P.gpuSupported = true;
            const orig = prof.report.bind(prof);
            prof.report = (v, timings, f) => {
                if (P.recording && timings && timings.length) P.gpu.push(timings.reduce((a, b) => a + b, 0));
                orig(v, timings, f);
            };
            prof.enabled = true;
        }
        return P.gpuSupported;
    });
    const per: Record<string, unknown>[] = [];
    const all = { cpu: [] as number[], gpu: [] as number[], intervals: [] as number[] };
    for (let i = 0; i < views; i++) {
        const p = track[Math.min(track.length - 1, Math.round((i * (track.length - 1)) / Math.max(1, views - 1)))]!;
        const pose: [number, number, number, number] = [p.pos[0], p.pos[1], p.pos[2], (Math.atan2(p.dir[0], -p.dir[2]) * 180) / Math.PI];
        await page.evaluate((q) => {
            const s = (window as unknown as { __gsfpv: { session: { spawn: number[]; respawnStart(): void } } }).__gsfpv.session;
            s.spawn = [q[0], q[1], q[2], q[3]];
            s.respawnStart();
        }, pose);
        await sleep(800);
        await page.evaluate(() => { const P = (window as unknown as { __cost: { recording: boolean; cpu: number[]; gpu: number[]; intervals: number[]; lastEnd: number } }).__cost; P.cpu = []; P.gpu = []; P.intervals = []; P.lastEnd = 0; P.recording = true; });
        await sleep(2500);
        const got = await page.evaluate(() => { const P = (window as unknown as { __cost: { recording: boolean; cpu: number[]; gpu: number[]; intervals: number[] } }).__cost; P.recording = false; return { cpu: P.cpu.slice(), gpu: P.gpu.slice(), intervals: P.intervals.slice() }; });
        all.cpu.push(...got.cpu);
        all.gpu.push(...got.gpu);
        all.intervals.push(...got.intervals);
        per.push({ pose: pose.map((v) => round(v, 2)), cpuMs: stats(got.cpu), gpuMs: stats(got.gpu), intervalMs: stats(got.intervals) });
        if (i === 0) await shot(page, `${lessonId}-cost-view`);
    }
    const hear = await page.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { cost: unknown } } }).__gsfpv.sonic(false).cost);
    const governor = await page.evaluate(() => { const g = (window as unknown as { __gsfpv: { governor?: { step: number; current: { renderScale: number } } } }).__gsfpv.governor; return g ? { step: g.step, renderScale: g.current.renderScale } : null; });
    const out = { lesson: lessonId, views, gpuTimestamps: gpu, cpuMs: stats(all.cpu), gpuMs: stats(all.gpu), intervalMs: stats(all.intervals), soundPlannerMs: hear, governor, perView: per };
    check(`${lessonId}: ${views} views measured (frames at every view, no page error)`, per.every((v) => (v.cpuMs as Stats | null) !== null) && errors.length === 0, { cpuMs: out.cpuMs, gpuMs: out.gpuMs, intervalMs: out.intervalMs, governor, errors });
    await page.close();
    return out;
}

async function scenarioCost(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const id of ['tunnel-long', 'corridor', 'rings-heights']) out[id] = await frameCost(ctx, id, 6);
    return out;
}

// ------------------------------------------------------------------ look (L1-3)

/** Where each lesson is looked at from: a pose that shows its room and its obstacles (world metres, yaw degrees). */
const LOOK_VIEWS: Record<string, { pose: [number, number, number, number]; why: string }> = {
    'walls-hall': { pose: [0, 1.5, 3, 0], why: 'the room from near its back: floor, front and side walls, ceiling' },
    corridor: { pose: [0, 1.25, -16.5, 0], why: 'the first pillar 4.5 m ahead, the corridor around and behind it' },
    'tunnel-gaps': { pose: [0, 1.5, -4.5, 0], why: 'block 1 4.25 m ahead, its free way above it' },
    'rings-heights': { pose: [0, 2.7, 16.75, 0], why: 'the start: the first rings ahead at the middle and the floor height' }
};

interface Analysis {
    pixels: number;
    roles: Record<string, { pixels: number; meanL: number }>;
    floorWall: number | null;
    objects: { pixels: number; meanL: number; surroundL: number; surroundPixels: number; contrast: number }[];
}

/**
 * The look's contrast on the page's own pictures: the same view painted in the look and in the role paint (one flat colour
 * per kind of surface, no fog), decoded in a helper page (no image dependency). Per kind of surface the mean relative
 * luminance of its pixels in the look (sRGB decoded); each object (a connected patch of the object paint) against its
 * surround: the pixels within BAND px of it that are no object. Pixels at the paint's edges (anti-aliased) count for none.
 */
async function analyse(ctx: BrowserContext, look: Buffer, roles: Buffer): Promise<Analysis> {
    const p = await ctx.newPage();
    const r = await p.evaluate(async ({ a, b }) => {
        const BAND = 12;
        const decode = async (b64: string): Promise<{ w: number; h: number; d: Uint8ClampedArray }> => {
            const bin = atob(b64);
            const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const g = c.getContext('2d')!;
            g.drawImage(bmp, 0, 0);
            return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
        };
        const L = await decode(a), M = await decode(b);
        const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const lum = (i: number): number => 0.2126 * lin(L.d[i]!) + 0.7152 * lin(L.d[i + 1]!) + 0.0722 * lin(L.d[i + 2]!);
        // the paint: a pure colour within a tolerance, else an edge (none)
        const kind = (i: number): string => {
            const r = M.d[i]!, g = M.d[i + 1]!, bl = M.d[i + 2]!;
            const hi = (v: number): boolean => v > 235, lo = (v: number): boolean => v < 20;
            if (hi(r) && hi(g) && hi(bl)) return 'object';
            if (hi(r) && lo(g) && lo(bl)) return 'floor';
            if (lo(r) && hi(g) && lo(bl)) return 'wall';
            if (lo(r) && lo(g) && hi(bl)) return 'ceiling';
            return 'other';
        };
        const W = L.w, H = L.h;
        const k = new Array<string>(W * H);
        const roles: Record<string, { pixels: number; sum: number }> = {};
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const j = y * W + x;
            const kk = kind(j * 4);
            k[j] = kk;
            const o = (roles[kk] ??= { pixels: 0, sum: 0 });
            o.pixels++;
            o.sum += lum(j * 4);
        }
        const mean = (n: string): number | null => (roles[n] && roles[n]!.pixels > 0 ? roles[n]!.sum / roles[n]!.pixels : null);
        const ratio = (x: number, y: number): number => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        const f = mean('floor'), wl = mean('wall');
        // objects: connected patches of the object paint (4-neighbours), each with its surround band
        const seen = new Uint8Array(W * H);
        const objects: { pixels: number; meanL: number; surroundL: number; surroundPixels: number; contrast: number }[] = [];
        for (let s = 0; s < W * H; s++) {
            if (seen[s] || k[s] !== 'object') continue;
            const stack = [s];
            seen[s] = 1;
            const patch: number[] = [];
            while (stack.length) {
                const q = stack.pop()!;
                patch.push(q);
                const qx = q % W, qy = (q / W) | 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = qx + dx!, ny = qy + dy!;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const n = ny * W + nx;
                    if (!seen[n] && k[n] === 'object') { seen[n] = 1; stack.push(n); }
                }
            }
            if (patch.length < 200) continue; // a few edge pixels, not an object seen
            let sumO = 0;
            for (const q of patch) sumO += lum(q * 4);
            // the band: every pixel within BAND of the patch (a box around each of its pixels), not an object, not an edge
            const band = new Uint8Array(W * H);
            for (const q of patch) {
                const qx = q % W, qy = (q / W) | 0;
                for (let dy = -BAND; dy <= BAND; dy += 3) for (let dx = -BAND; dx <= BAND; dx += 3) {
                    const nx = qx + dx, ny = qy + dy;
                    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                    const n = ny * W + nx;
                    if (k[n] === 'floor' || k[n] === 'wall' || k[n] === 'ceiling') band[n] = 1;
                }
            }
            let sumS = 0, nS = 0;
            for (let n = 0; n < W * H; n++) if (band[n]) { sumS += lum(n * 4); nS++; }
            const mo = sumO / patch.length, ms = nS ? sumS / nS : NaN;
            objects.push({ pixels: patch.length, meanL: mo, surroundL: ms, surroundPixels: nS, contrast: ratio(mo, ms) });
        }
        const out: Record<string, { pixels: number; meanL: number }> = {};
        for (const [n, o] of Object.entries(roles)) out[n] = { pixels: o.pixels, meanL: o.sum / o.pixels };
        return { pixels: W * H, roles: out, floorWall: f !== null && wl !== null ? ratio(f, wl) : null, objects };
    }, { a: look.toString('base64'), b: roles.toString('base64') });
    await p.close();
    return r;
}

/** Everything over the canvas hidden (the HUD, the captions, the panels): what the view itself shows. */
const HIDE_OVERLAYS = 'body > *:not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }';

async function lookAt(ctx: BrowserContext, lessonId: string, keep: string): Promise<Record<string, unknown>> {
    const view = LOOK_VIEWS[lessonId];
    if (!view) throw new Error(`no view for ${lessonId}`);
    const { page, errors } = await openLesson(ctx, lessonId);
    await page.evaluate((q) => {
        const s = (window as unknown as { __gsfpv: { session: { spawn: number[]; respawnStart(): void } } }).__gsfpv.session;
        s.spawn = [q[0], q[1], q[2], q[3]];
        s.respawnStart();
    }, view.pose);
    await until('the view', () => craft(page), (c) => dist(c.pos, view.pose) < 0.1, 5000);
    await sleep(1500);
    const asSeen = await shot(page, `${lessonId}-as-seen`);
    const style = await page.addStyleTag({ content: HIDE_OVERLAYS });
    await sleep(300);
    const lookPng = await page.screenshot({ type: 'png' });
    const sceneJpg = join(OUT, `${lessonId}-scene.jpg`);
    writeFileSync(sceneJpg, await page.screenshot({ type: 'jpeg', quality: 80 }));
    const painted = await page.evaluate(() => { const h = (window as unknown as { __gsfpv: { sonicLook?: { paint(m: string): void; mode(): string } } }).__gsfpv.sonicLook; if (!h) return null; h.paint('roles'); return h.mode(); });
    await sleep(400);
    const rolesPng = await page.screenshot({ type: 'png' });
    await page.evaluate(() => (window as unknown as { __gsfpv: { sonicLook?: { paint(m: string): void } } }).__gsfpv.sonicLook?.paint('look'));
    await style.evaluate((el) => (el as unknown as { remove(): void }).remove());
    // the full-size pictures stay out of the repository (the evidence keeps the small JPEGs)
    mkdirSync(keep, { recursive: true });
    writeFileSync(join(keep, `${lessonId}-look.png`), lookPng);
    writeFileSync(join(keep, `${lessonId}-roles.png`), rolesPng);
    const a = await analyse(ctx, lookPng, rolesPng);
    const fw = a.floorWall;
    const objs = a.objects.map((o) => ({ ...o, meanL: round(o.meanL, 4), surroundL: round(o.surroundL, 4), contrast: round(o.contrast, 2) }));
    const levels = Object.fromEntries(Object.entries(a.roles).map(([n, o]) => [n, { share: round(o.pixels / a.pixels, 3), meanL: round(o.meanL, 4) }]));
    check(`${lessonId}: the measuring paint ran (the stage's hook)`, painted === 'roles', { painted });
    if (a.roles.floor && a.roles.wall) check(`${lessonId}: floor against walls ${fw?.toFixed(2)}:1 (3:1 or more), the mean luminance of each in the page's picture`, fw !== null && fw >= 3, levels);
    for (const [i, o] of objs.entries()) check(`${lessonId}: obstacle ${i + 1} (${o.pixels} px) against what is behind it ${o.contrast}:1 (3:1 or more)`, o.contrast >= 3, o);
    check(`${lessonId}: no page error`, errors.length === 0, errors);
    await page.close();
    return { view, levels, floorWall: fw === null ? null : round(fw, 2), objects: objs, pictures: { asSeen, scene: sceneJpg.slice(REPO.length + 1).replace(/\\/g, '/') } };
}

async function scenarioLook(ctx: BrowserContext): Promise<Record<string, unknown>> {
    // full-size PNGs next to the repository's other runs on U:, not in it
    const keep = join(process.env.LOOK_KEEP ?? 'U:/Temp/gsfpv-v13-look/look', `${today()}${TAG ? `-${TAG}` : ''}`);
    const out: Record<string, unknown> = { fullSizePictures: keep };
    for (const id of Object.keys(LOOK_VIEWS)) out[id] = await lookAt(ctx, id, keep);
    return out;
}

const SCENARIOS: Record<string, (ctx: BrowserContext) => Promise<Record<string, unknown>>> = { bump: scenarioBump, cost: scenarioCost, look: scenarioLook };

async function main(): Promise<void> {
    const run = SCENARIOS[SCENARIO];
    if (!run) throw new Error(`unknown scenario ${SCENARIO}: ${Object.keys(SCENARIOS).join(', ')}`);
    await lock();
    // cost: WebGPU's developer features give timestamp queries unquantized (stock Chrome rounds them to about 0.066 ms here,
    // more than a lesson world's whole frame takes the GPU); nothing else of the drawing changes
    const { browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required', ...(SCENARIO === 'cost' ? ['--enable-webgpu-developer-features'] : [])] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        await ctx.addInitScript({ content: INIT });
        const release = await (await fetch(`${SITE}/release.json`)).json().catch(() => null);
        const result = await run(ctx);
        const passed = checks.filter((c) => c.pass).length;
        const file = writeEvidence(`v13-look-${SCENARIO}${TAG ? `-${TAG}` : ''}`, { site: SITE, release, scenario: SCENARIO, tag: TAG, checks, passed, total: checks.length, result });
        console.log(`${passed} of ${checks.length} checks passed; ${file}`);
        process.exitCode = passed === checks.length ? 0 : 1;
    } finally {
        await browser.close().catch(() => undefined);
        unlock();
    }
}

main().catch((e) => {
    unlock();
    console.error(e);
    process.exit(2);
});
