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
//   panels L2-4 (M41-24, M41-25, W14), dark page: the attitude display level, nose down, rolled right, nose up and rolled left
//          (the flight model held, the craft turned; the horizon's core found on the picture where the display draws it, the
//          contrast of every line and mark measured), a climb and a sink (the climb arrow), the tape's band and height to fly
//          at; the sound panel in walls-pillar (a wall on the left; the pillar ahead and its open way's chime at the side the
//          plan gives), in rings-heights (the target note at the first ring's height on the height bar), on the task's three
//          plays of a sound (its icon, its glossary name, "1 of 3" to "3 of 3", in English and Polish); the two switches off,
//          read back after a reload, on again.
//   layout L2-4, v13-int step 8: the places of the mode's three panels (v13-host's progress panel, drawn by the mode, the attitude
//          display, the sound panel) at 8 page sizes (1280 x 720, 1366 x 768, 1920 x 1080, both of those at 200 % zoom, a phone upright
//          with and without touch sticks and on its side), dark and light: each inside the page, clear of the view's centre, the
//          captions (the last three lines the lesson said, as they stand when its attempt begins), the page's controls, the touch sticks and the other two panels; their
//          sizes (LOOK_CSS=<file> lays trial CSS over the build's, SIZES=<name,...> and SCHEMES=<dark|light> pick some: never for the
//          record).
//   panelcost L2-4: the page's frame in the corridor and rings-heights flying on W, with both panels and with neither.
// Every check is the page's own state (window.__gsfpv: the session, its flight model, the mode's hook); the sim events are
// read through the session's onEvent. Holds the GPU lock C:/dev/.gpu-lock (one blocking loop: mkdir, else 20 s, up to
// 9 min; rmdir after, on error too). Evidence: evidence/<date>/v13-look-<scenario>.json, small JPEGs beside it.
//   node scripts/build-release.mjs && node tools/bench/scripts/serve-csp.mjs dist 5420     (another shell)
//   cd tools/bench && SITE=http://localhost:5420 npx tsx src/v13-look-page.ts bump
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { RESPAWN_BEFORE_M, createAnalyticWorld, defaultPrefs, getLesson } from '../../../packages/sonic-fpv/src';
import type { WorldCheckpoint } from '../../../packages/sonic-fpv/src';
import { BOX, DIAL, tapeOf } from '../../../apps/fly/src/sonic/attitude';
import type { AttitudeReport } from '../../../apps/fly/src/sonic/attitude';
import { KIND_COLOURS, PANEL, RADAR_RINGS_M, radiusOf } from '../../../apps/fly/src/sonic/sound-panel';
import type { SoundReport } from '../../../apps/fly/src/sonic/sound-panel';
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

/**
 * /<lang>/fly/?sonic=<lesson>, Enter on the start screen's button (the user activation), until the lesson flies, its intro skipped
 * with N; `intro: 'keep'` returns as soon as the lesson is open, its task still to be said (and its sounds played three times).
 */
async function openLesson(ctx: BrowserContext, lesson: string, o: { lang?: string; intro?: 'skip' | 'keep'; query?: string } = {}): Promise<{ page: Page; errors: string[] }> {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console: ${m.text()}`.slice(0, 300));
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) errors.push(`${r.status()} ${r.url()}`.slice(0, 300));
    });
    await page.goto(`${SITE}/${o.lang ?? 'en'}/fly/?sonic=${lesson}&nowarn=1${o.query ?? ''}`);
    await until('the start screen', () => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]')), (v) => v, 60000);
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until('the lesson', () => page.evaluate(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic ? h.sonic(false).lesson : null; }), (v) => v === lesson, 90000);
    if (o.intro === 'keep') return { page, errors };
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

// ------------------------------------------------------------------ panels (L2-4: the attitude display and the sound panel)

type Rgb8 = [number, number, number];
interface Rect { x: number; y: number; w: number; h: number }
interface PanelsReport {
    attitude: AttitudeReport | null;
    sound: SoundReport | null;
    prefs: { soundPanel: boolean; attitude: boolean };
    frameMs: { attitude: { n: number; p50: number; p95: number; max: number }; sound: { n: number; p50: number; p95: number; max: number } };
}

const panels = (page: Page): Promise<PanelsReport> =>
    page.evaluate(() => (window as unknown as { __gsfpv: { sonicPanels: { report(): unknown } } }).__gsfpv.sonicPanels.report()) as Promise<PanelsReport>;
const setSwitch = (page: Page, which: 'soundPanel' | 'attitude', on: boolean): Promise<void> =>
    page.evaluate(([w, v]) => { const h = (window as unknown as { __gsfpv: { sonicPanels: { setSwitch(a: string, b: boolean): void }; prefs: { flush(): void } } }).__gsfpv; h.sonicPanels.setSwitch(w as string, v as boolean); h.prefs.flush(); }, [which, on] as const);
/** Both panels' pictures held as they are (the flight and the sound go on) or let go: a picture and a report of the same frame. */
const freeze = (page: Page, on: boolean): Promise<void> => page.evaluate((v) => (window as unknown as { __gsfpv: { sonicPanels: { freeze(on: boolean): void } } }).__gsfpv.sonicPanels.freeze(v), on);
/** The flight model held (a holder of its own: the page's pause stack never releases it) or let go. */
const holdFlight = (page: Page, on: boolean): Promise<void> =>
    page.evaluate((v) => (window as unknown as { __gsfpv: { session: { pause(on: boolean, who: string): void } } }).__gsfpv.session.pause(v, 'looktest'), on);
/** The craft turned to `q` (w, x, y, z), at rest. */
const setQuat = (page: Page, q: readonly number[]): Promise<void> =>
    page.evaluate((qq) => {
        const s = (window as unknown as { __gsfpv: { session: { sim: { s: Float64Array } } } }).__gsfpv.session.sim.s;
        s[6] = qq[0]!; s[7] = qq[1]!; s[8] = qq[2]!; s[9] = qq[3]!;
        s[3] = 0; s[4] = 0; s[5] = 0;
    }, [...q]);
const placeAt = (page: Page, pose: readonly number[]): Promise<void> =>
    page.evaluate((q) => {
        const s = (window as unknown as { __gsfpv: { session: { spawn: number[]; respawnStart(): void } } }).__gsfpv.session;
        s.spawn = [q[0]!, q[1]!, q[2]!, q[3]!];
        s.respawnStart();
    }, [...pose]);

// quaternions (w, x, y, z) in sim-core's frame (x right, y up, z back), as tools/bench/test/sonic-panels.test.ts builds them
const qAxis = (ax: readonly number[], deg: number): number[] => { const h = (deg * Math.PI) / 360; return [Math.cos(h), ax[0]! * Math.sin(h), ax[1]! * Math.sin(h), ax[2]! * Math.sin(h)]; };
const qMul = (a: readonly number[], b: readonly number[]): number[] => [
    a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! - a[3]! * b[3]!,
    a[0]! * b[1]! + a[1]! * b[0]! + a[2]! * b[3]! - a[3]! * b[2]!,
    a[0]! * b[2]! - a[1]! * b[3]! + a[2]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]! + a[3]! * b[0]!
];
/** yaw, then the nose up by `up` degrees, then the right side down by `right` degrees */
const bodyQ = (yaw: number, up: number, right: number): number[] => qMul(qMul(qAxis([0, 1, 0], -yaw), qAxis([1, 0, 0], up)), qAxis([0, 0, 1], -right));

/** A panel's canvas cut out of the page as PNG; its origin and scale for mapping canvas points to the picture's pixels. */
async function cut(page: Page, r: Rect): Promise<{ png: Buffer; at: (x: number, y: number) => [number, number] }> {
    const x0 = Math.floor(r.x), y0 = Math.floor(r.y);
    const w = Math.ceil(r.x + r.w) - x0, h = Math.ceil(r.y + r.h) - y0;
    const png = await page.screenshot({ type: 'png', clip: { x: x0, y: y0, width: w, height: h } });
    const dpr = png.readUInt32BE(16) / w;
    return { png, at: (x, y) => [(r.x - x0 + x) * dpr, (r.y - y0 + y) * dpr] };
}

/** The pixels of a PNG at the given points (decoded in a helper page: no image dependency). */
async function pixels(ctx: BrowserContext, png: Buffer, pts: readonly (readonly [number, number])[]): Promise<Rgb8[]> {
    const p = await ctx.newPage();
    try {
        return await p.evaluate(async ({ b64, pts: list }) => {
            const bin = atob(b64);
            const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            const g = c.getContext('2d')!;
            g.drawImage(bmp, 0, 0);
            const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
            return list.map(([x, y]) => {
                const xi = Math.max(0, Math.min(bmp.width - 1, Math.round(x)));
                const yi = Math.max(0, Math.min(bmp.height - 1, Math.round(y)));
                const i = (yi * bmp.width + xi) * 4;
                return [d[i]!, d[i + 1]!, d[i + 2]!] as [number, number, number];
            });
        }, { b64: png.toString('base64'), pts: pts.map((q) => [q[0], q[1]]) });
    } finally {
        await p.close();
    }
}

const lin8 = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum8 = (c: Rgb8): number => 0.2126 * lin8(c[0]) + 0.7152 * lin8(c[1]) + 0.0722 * lin8(c[2]);
const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hex8 = (css: string): Rgb8 => { const v = parseInt(css.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const near = (a: Rgb8, b: Rgb8, tol = 40): boolean => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) <= tol;
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

/**
 * The attitude display measured on the page's picture: the horizon's core found where the display says it lies at both ends (its
 * tilt and its lift from the picture), the sky and the ground (their means away from every mark), and the contrast of every line
 * and mark against what it lies on: the horizon's white core against the ground and its black edge against the sky, the pitch marks
 * of 10 degrees, the wings, the tape's ticks, band, height to fly at, the craft's box and its number, the climb arrow.
 */
async function measureAttitude(ctx: BrowserContext, page: Page, rep: AttitudeReport, name: string): Promise<Record<string, unknown>> {
    const cv = rep.canvas!, l = rep.layout!, hz = rep.horizon!, st = rep.state!;
    const { png, at } = await cut(page, cv);
    writeFileSync(join(OUT, `${name}.png`), png);
    const { cx, cy, r } = l.dial;
    const P = (x: number, y: number): [number, number] => at(x, y);
    const C = hz.centre, u = hz.u, n = hz.n;
    const pt = (ku: number, kn: number, from: readonly number[] = C): [number, number] => [from[0]! + u[0] * ku + n[0] * kn, from[1]! + u[1] * ku + n[1] * kn];
    // sky and ground: a grid inside the dial, away from the horizon, the marks, the wings and the sky pointer
    const grid: { p: [number, number]; side: 'sky' | 'ground' }[] = [];
    for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
        const x = cx + (i / 20) * r, y = cy + (j / 20) * r;
        if (Math.hypot(x - cx, y - cy) > 0.88 * r) continue;
        const d = (x - C[0]) * n[0] + (y - C[1]) * n[1];
        const a = (x - C[0]) * u[0] + (y - C[1]) * u[1];
        if (Math.abs(d) < 0.12 * r) continue;
        if ([-30, -20, -10, 10, 20, 30].some((m) => Math.abs(d - m * hz.pxPerDeg) < 0.08 * r && Math.abs(a) < (Math.abs(m) === 20 ? 0.42 : 0.3) * r + 0.3 * r)) continue;
        if (Math.abs(x - cx) < 0.78 * r && Math.abs(y - cy) < 0.22 * r) continue;
        if (Math.hypot(x - hz.pointer[0], y - hz.pointer[1]) < 0.3 * r) continue;
        grid.push({ p: [x, y], side: d > 0 ? 'sky' : 'ground' });
    }
    // the horizon's profile across it at both ends (0.8 r from its centre along it)
    const K = 49, span = 0.16 * r;
    const profile = (end: number): [number, number][] => Array.from({ length: K }, (_, k) => pt(end * 0.8 * r, -span + (2 * span * k) / (K - 1)));
    const ends = [profile(-1), profile(1)];
    // the pitch marks of +10 (on the sky) and -10 (on the ground), across each at 0.12 r along it, when inside the dial
    const markProfile = (m: number): [number, number][] | null => {
        const c = pt(0.12 * r, m * hz.pxPerDeg);
        if (Math.hypot(c[0] - cx, c[1] - cy) > 0.8 * r) return null;
        return Array.from({ length: 25 }, (_, k) => pt(0.12 * r, m * hz.pxPerDeg - 0.06 * r + (0.12 * r * k) / 24));
    };
    const marks = { up: markProfile(10), down: markProfile(-10) };
    // the left wing: its yellow core in its middle, and across it (its black edge); drawn over everything else of the dial
    const wing = Array.from({ length: 25 }, (_, k) => [cx - 0.43 * r, cy - 0.12 * r + (0.24 * r * k) / 24] as [number, number]);
    const wingAround: [number, number][] = [[cx - 0.43 * r, cy]];
    // the tape
    const tb = l.tape, tw = tb.x1 - tb.x0;
    const tape = rep.tape!;
    const yOf = (m: number): number => tapeOf(st, tb).y(m);
    const bh = Math.max(l.font + 8, 0.17 * l.h);
    const bx0 = tb.x0 + 0.1 * tw;
    // a whole-metre tick away from the craft's box, and the tape's background half a metre off it
    let tickM = 1;
    for (const m of [1, 2, 3, 0]) if (Math.abs(yOf(m) - tape.craftY) > bh && (!st.bandM || Math.abs(m - st.bandM[0]) > 0.3 && Math.abs(m - st.bandM[1]) > 0.3) && (st.targetM === null || Math.abs(m - st.targetM) > 0.3)) { tickM = m; break; }
    const tick = Array.from({ length: 13 }, (_, k) => [tb.x0 + 0.32 * tw, yOf(tickM) - 6 + k] as [number, number]);
    const tapeBg: [number, number] = [tb.x0 + 0.32 * tw, (yOf(tickM) + yOf(tickM + (tickM >= tape.topM ? -0.5 : 0.5))) / 2];
    const band: [number, number] | null = st.bandM ? [tb.x0 + 0.12 * tw, (tape.bandY![0] + tape.bandY![1]) / 2] : null;
    const target: [number, number] | null = tape.targetY !== null && Math.abs(tape.targetY - tape.craftY) > bh / 2 + 3 ? [tb.x0 + 0.55 * tw, tape.targetY] : null;
    const craftBox: [number, number] = [bx0 + 4, tape.craftY - bh / 4];
    const craftText = Array.from({ length: 41 }, (_, k) => [bx0 + ((tb.x1 - bx0) * (k + 0.5)) / 41, tape.craftY + 1] as [number, number]);
    const arrow: [number, number] | null = rep.arrow ? [(l.arrow.x0 + l.arrow.x1) / 2, (rep.arrow.from + rep.arrow.to) / 2] : null;
    const arrowBg: [number, number] = [(l.arrow.x0 + l.arrow.x1) / 2, rep.arrow ? (rep.arrow.up ? Math.min(l.arrow.y1 - 4, rep.arrow.from + bh) : Math.max(l.arrow.y0 + 4, rep.arrow.from - bh)) : cy];
    const list: [number, number][] = [
        ...grid.map((g) => g.p), ...ends[0]!, ...ends[1]!, ...(marks.up ?? []), ...(marks.down ?? []), ...wing, ...wingAround,
        ...tick, tapeBg, ...(band ? [band] : []), ...(target ? [target] : []), craftBox, ...craftText, ...(arrow ? [arrow] : []), arrowBg
    ];
    const px = await pixels(ctx, png, list.map((q) => P(q[0], q[1])));
    let i = 0;
    const take = (k: number): Rgb8[] => { const s = px.slice(i, i + k); i += k; return s; };
    const g = take(grid.length);
    const skyL = mean(grid.flatMap((q, k) => (q.side === 'sky' ? [lum8(g[k]!)] : [])));
    const groundL = mean(grid.flatMap((q, k) => (q.side === 'ground' ? [lum8(g[k]!)] : [])));
    const endL = [take(K).map(lum8), take(K).map(lum8)];
    const upL = marks.up ? take(25).map(lum8) : null;
    const downL = marks.down ? take(25).map(lum8) : null;
    const wingL = take(25).map(lum8);
    const wingCore = take(1)[0]!;
    const tickL = take(13).map(lum8);
    const bgL = lum8(take(1)[0]!);
    const bandPx = band ? take(1)[0]! : null;
    const targetPx = target ? take(1)[0]! : null;
    const boxPx = take(1)[0]!;
    const textL = take(41).map(lum8);
    const arrowPx = arrow ? take(1)[0]! : null;
    const arrowBgL = lum8(take(1)[0]!);
    // the core: the brightest sample near the line's middle; its place along the normal gives the measured line
    const core = endL.map((v) => {
        const max = Math.max(...v);
        const top = v.map((x, k) => (x >= 0.9 * max ? k : -1)).filter((k) => k >= 0);
        const mid = top.reduce((a, b) => a + b, 0) / top.length;
        const off = -span + (2 * span * mid) / (K - 1);
        const last = Math.max(...top);
        return { off, max, edgeMin: Math.min(...v.slice(last + 1, last + 1 + Math.ceil(K / 4))) };
    });
    const pA = pt(-0.8 * r, core[0]!.off), pB = pt(0.8 * r, core[1]!.off);
    const tiltPic = (Math.atan2(pB[1] - pA[1], pB[0] - pA[0]) * 180) / Math.PI;
    const tiltModel = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    const liftPic = ((((pA[0] + pB[0]) / 2 - cx) * n[0] + ((pA[1] + pB[1]) / 2 - cy) * n[1]) / hz.pxPerDeg);
    const box = hex8(BOX[rep.scheme].craft.css);
    const out = {
        picture: `${name}.png`,
        state: { rollDeg: round(st.rollDeg, 2), pitchDeg: round(st.pitchDeg, 2), heightM: round(st.heightM, 3), vyMps: round(st.vyMps, 3) },
        horizon: { tiltModelDeg: round(tiltModel, 2), tiltPictureDeg: round(tiltPic, 2), liftModelDeg: round(st.pitchDeg, 2), liftPictureDeg: round(liftPic, 2), coreOffPx: core.map((c) => round(c.off, 2)) },
        luminance: { sky: round(skyL, 4), ground: round(groundL, 4), skyPoints: grid.filter((q) => q.side === 'sky').length, groundPoints: grid.filter((q) => q.side === 'ground').length },
        contrast: {
            skyGround: round(ratio(skyL, groundL), 2),
            horizonCoreGround: round(Math.min(...core.map((c) => ratio(c.max, groundL))), 2),
            horizonEdgeSky: round(Math.min(...core.map((c) => ratio(skyL, c.edgeMin))), 2),
            pitchMarkSky: upL ? round(ratio(skyL, Math.min(...upL)), 2) : null,
            pitchMarkGround: downL ? round(ratio(Math.max(...downL), groundL), 2) : null,
            wingsCoreGround: round(ratio(lum8(wingCore), groundL), 2),
            wingsEdgeSky: round(ratio(skyL, Math.min(...wingL)), 2),
            tapeTick: round(ratio(bgL, rep.scheme === 'dark' ? Math.max(...tickL) : Math.min(...tickL)), 2),
            band: bandPx ? round(ratio(lum8(bandPx), bgL), 2) : null,
            target: targetPx ? round(ratio(lum8(targetPx), bgL), 2) : null,
            craftBox: round(ratio(lum8(boxPx), bgL), 2),
            craftText: round(ratio(lum8(boxPx), rep.scheme === 'dark' ? Math.min(...textL) : Math.max(...textL)), 2),
            climbArrow: arrowPx ? round(ratio(lum8(arrowPx), arrowBgL), 2) : null
        },
        colours: { band: bandPx, target: targetPx, craftBox: boxPx, craftBoxExpected: box, arrow: arrowPx, wings: wingCore, wingsAreYellow: near(wingCore, hex8(DIAL.wings.css)) }
    };
    return out;
}

/** The sound panel measured on its picture: at every item the display reports, the disc's colour (the kind's) and its contrast. */
async function measureSounds(ctx: BrowserContext, page: Page, rep: SoundReport, name: string): Promise<Record<string, unknown>> {
    const cv = rep.canvas!, l = rep.layout!;
    const { png, at } = await cut(page, cv);
    writeFileSync(join(OUT, `${name}.png`), png);
    const { cx, cy, r } = l.radar;
    const ir = l.icon;
    const lim = Math.max(0, r - ir - 1);
    const byId = new Map(rep.items.map((it) => [it.id, it]));
    const places = rep.places.map((q) => ({ it: byId.get(q.id)!, x: q.x, y: q.y, rr: q.r, mark: q.mark && !byId.get(q.id)!.bar }));
    // the bar's marks
    const b = l.bar, bw = b.x1 - b.x0;
    const padB = Math.max(ir * 1.1, 0.08 * (b.y1 - b.y0));
    const by0 = b.y1 - padB, by1 = b.y0 + padB;
    const yOf = (mm: number): number => by0 - (Math.max(0, Math.min(mm, rep.bar!.topM)) / rep.bar!.topM) * (by0 - by1);
    const barPts: [number, number][] = [];
    if (rep.bar?.targetM !== null && rep.bar?.targetM !== undefined) barPts.push([b.x0 + 0.15 * bw, yOf(rep.bar.targetM)]);
    if (rep.bar?.toneM !== null && rep.bar?.toneM !== undefined) barPts.push([b.x0 + 0.15 * bw, yOf(rep.bar.toneM)]);
    // the radar's background: eight points between the rings of 2 and 4 m, off the cross; the one nearest the box's colour (a
    // point that falls on a disc or a ring is not the background)
    const between = ((radiusOf(RADAR_RINGS_M[1]!) + radiusOf(RADAR_RINGS_M[2]!)) / 2) * r;
    const bgPts = [-2.75, -1.96, -1.18, -0.39, 0.39, 1.18, 1.96, 2.75].map((a) => [cx + between * Math.cos(a), cy + between * Math.sin(a)] as [number, number]);
    const pts: [number, number][] = [...places.flatMap((p) => [[p.x, p.y - 0.8 * p.rr] as [number, number], [p.x + p.rr + 0.55 * 0.95 * p.rr, p.y] as [number, number]]), ...barPts, ...bgPts];
    const px = await pixels(ctx, png, pts.map((q) => at(q[0], q[1])));
    const boxBg = hex8(PANEL[rep.scheme].bg.css);
    const bgs = px.slice(px.length - bgPts.length);
    const bg = bgs.reduce((a, b) => (Math.max(...a.map((v, i) => Math.abs(v - boxBg[i]!))) <= Math.max(...b.map((v, i) => Math.abs(v - boxBg[i]!))) ? a : b));
    const bgL = lum8(bg);
    const colours = KIND_COLOURS[rep.scheme];
    const fg = hex8(PANEL[rep.scheme].fg.css);
    const items = places.map((p, k) => {
        const disc = px[2 * k]!, mark = px[2 * k + 1]!;
        const want = hex8(colours[p.it.kind].css);
        return { id: p.it.id, kind: p.it.kind, elev: p.it.elev, bar: p.it.bar, event: p.it.event, at: [round(p.x, 1), round(p.y, 1)], disc, discIsKindColour: near(disc, want), discContrast: round(ratio(lum8(disc), bgL), 2), markDrawn: p.mark ? near(mark, fg, 60) : null };
    });
    const nb = barPts.length;
    const barPx = px.slice(2 * places.length, 2 * places.length + nb);
    const bar = {
        targetM: rep.bar?.targetM ?? null,
        toneM: rep.bar?.toneM ?? null,
        target: rep.bar?.targetM !== null && rep.bar?.targetM !== undefined ? { px: barPx[0], isTargetColour: near(barPx[0]!, hex8(colours.target.css)), contrast: round(ratio(lum8(barPx[0]!), bgL), 2) } : null,
        tone: rep.bar?.toneM !== null && rep.bar?.toneM !== undefined ? { px: barPx[nb - 1], isToneColour: near(barPx[nb - 1]!, hex8(colours.tone.css)), contrast: round(ratio(lum8(barPx[nb - 1]!), bgL), 2) } : null
    };
    return { picture: `${name}.png`, background: bg, items, bar, freeWay: rep.freeWay, now: rep.now };
}

/**
 * hover-height (the band of 2 to 3 m, the open world): the attitude display level, nose down 15, right roll 30, nose up 10 with a
 * left roll 20 (the flight model held, the craft turned: the camera turns with it), each on its picture; then a climb on Space and a
 * sink on Shift (the climb arrow); then the tape with the band and the height to fly at.
 */
async function attitudeProof(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const { page, errors } = await openLesson(ctx, 'hover-height');
    await sleep(800);
    const first = await panels(page);
    check('hover-height: both panels shown in a lesson that flies (on by default)', !!first.attitude?.shown && !!first.sound?.shown && first.prefs.attitude && first.prefs.soundPanel, first.prefs);
    const yaw = (await page.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { yaw: number } } }).__gsfpv.sonic(false).yaw));
    const out: Record<string, unknown> = {};
    await holdFlight(page, true);
    const poses: [string, number, number][] = [['level', 0, 0], ['nose-down-15', -15, 0], ['right-roll-30', 0, 30], ['nose-up-10-left-roll-20', 10, -20]];
    for (const [name, up, right] of poses) {
        await setQuat(page, bodyQ(yaw, up, right));
        await sleep(400);
        const rep = await panels(page);
        const a = rep.attitude!;
        const m = await measureAttitude(ctx, page, a, `attitude-${name}`);
        await shot(page, `attitude-${name}-page`);
        const h = m.horizon as { tiltModelDeg: number; tiltPictureDeg: number; liftModelDeg: number; liftPictureDeg: number };
        const c = m.contrast as Record<string, number | null>;
        check(`attitude ${name}: the flight model reads pitch ${-up}, roll ${right} (nose down, right side down positive)`, Math.abs(a.state!.pitchDeg + up) < 0.05 && Math.abs(a.state!.rollDeg - right) < 0.05, m.state);
        check(`attitude ${name}: the horizon's core found on the picture where the display draws it: tilt ${h.tiltPictureDeg} (model ${h.tiltModelDeg}), lift ${h.liftPictureDeg} (model ${h.liftModelDeg}) degrees`, Math.abs(h.tiltPictureDeg - h.tiltModelDeg) < 1.5 && Math.abs(h.liftPictureDeg - h.liftModelDeg) < 1, h);
        const low = Object.entries(c).filter(([, v]) => v !== null && (v as number) < 4.5);
        check(`attitude ${name}: every line and mark measured 4.5:1 or more on the picture (the wings yellow)`, low.length === 0 && (m.colours as { wingsAreYellow: boolean }).wingsAreYellow, { contrast: c, luminance: m.luminance });
        out[name] = m;
    }
    await setQuat(page, bodyQ(yaw, 0, 0));
    await holdFlight(page, false);
    // the climb arrow: Space climbs, Shift sinks (the lesson's game keys)
    for (const [key, sign, name] of [['Space', 1, 'climb'], ['Shift', -1, 'sink']] as const) {
        await page.keyboard.down(key);
        const t0 = Date.now();
        let rep = await panels(page);
        while (Date.now() - t0 < 6000 && !(rep.attitude?.state && sign * rep.attitude.state.vyMps > 0.4)) {
            await sleep(40);
            rep = await panels(page);
        }
        await holdFlight(page, true);
        await page.keyboard.up(key);
        await sleep(300);
        rep = await panels(page);
        const a = rep.attitude!;
        const m = await measureAttitude(ctx, page, a, `attitude-${name}`);
        await shot(page, `attitude-${name}-page`);
        const c = m.contrast as Record<string, number | null>;
        check(`attitude ${name}: vertical speed ${round(a.state!.vyMps, 2)} m/s, the climb arrow ${sign > 0 ? 'up' : 'down'} from the craft's height`, !!a.arrow && a.arrow.up === sign > 0 && Math.abs(a.arrow.from - a.tape!.craftY) < 0.5, { arrow: a.arrow, craftY: a.tape?.craftY, vy: a.state!.vyMps });
        check(`attitude ${name}: the arrow drawn in the craft's colour, ${c.climbArrow}:1 against the box`, (c.climbArrow ?? 0) >= 4.5 && near((m.colours as { arrow: Rgb8 }).arrow, hex8(BOX[a.scheme].craft.css)), m.colours);
        check(`attitude ${name}: the tape: the band (${a.state!.bandM?.join(' to ')} m) and the height to fly at (${a.state!.targetM} m) drawn, the craft's box at its height ${round(a.state!.heightM, 2)} m`, (c.band ?? 0) >= 4.5 && (c.target ?? 0) >= 4.5 && (c.craftBox ?? 0) >= 4.5 && (c.craftText ?? 0) >= 4.5 && near((m.colours as { craftBox: Rgb8 }).craftBox, hex8(BOX[a.scheme].craft.css)), { contrast: c, tape: a.tape });
        out[name] = m;
        await holdFlight(page, false);
        await sleep(1200);
    }
    // a still craft: no arrow
    await sleep(1500);
    const still = await panels(page);
    check('attitude: a craft at rest (under 0.1 m/s up or down) has no climb arrow', still.attitude!.arrow === null || Math.abs(still.attitude!.state!.vyMps) >= 0.1, { vy: still.attitude!.state!.vyMps, arrow: still.attitude!.arrow });
    check('hover-height: no page error', errors.length === 0, errors);
    await page.close();
    return out;
}

/** walls-pillar: a wall heard on the left; then the pillar ahead and its open way's chime at its side (W toward it). */
async function soundProofPillar(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const lesson = getLesson('walls-pillar');
    if (lesson.world.kind !== 'analytic') throw new Error('walls-pillar');
    const world = createAnalyticWorld(lesson.world.spec);
    const pillar = world.objects().find((o) => o.shape.kind === 'pillar')!;
    const { page, errors } = await openLesson(ctx, 'walls-pillar');
    const out: Record<string, unknown> = {};
    // 1. 0.6 m from the left wall, facing along the room
    const half = (world as unknown as { resolved: { widthM: number } }).resolved.widthM / 2;
    const wallPose = [-half + 0.6, 1.5, lesson.start.pos[2], 0];
    await placeAt(page, wallPose);
    await until('the craft by the wall', () => craft(page), (c) => dist(c.pos, wallPose) < 0.1, 5000);
    const t1 = Date.now();
    let rep = await panels(page);
    while (Date.now() - t1 < 4000 && !rep.sound?.items.some((it) => it.kind === 'wall' && it.x < -0.2 && Math.abs(it.y) < 0.5)) {
        await sleep(40);
        rep = await panels(page);
    }
    await freeze(page, true);
    rep = await panels(page);
    const wall = await measureSounds(ctx, page, rep.sound!, 'sounds-pillar-wall');
    await shot(page, 'sounds-pillar-wall-page');
    const wallItem = (wall.items as { id: string; kind: string; at: number[]; discIsKindColour: boolean; discContrast: number }[]).find((it) => it.kind === 'wall' && it.id.startsWith('safety.wall'));
    check('walls-pillar: the left wall heard (safety.wall) is drawn left of the craft in the wall\'s colour, 4.5:1 or more', !!wallItem && wallItem.at[0]! < rep.sound!.layout!.radar.cx - 0.2 * rep.sound!.layout!.radar.r && wallItem.discIsKindColour && wallItem.discContrast >= 4.5, { items: wall.items });
    out.wall = wall;
    await freeze(page, false);
    // 2. 3.5 m before the pillar, facing it, W: the pillar ahead and the open way's chime at its side
    const pose = [pillar.pos[0], 1.5, pillar.pos[2] + 3.5, 0];
    await placeAt(page, pose);
    await until('the craft before the pillar', () => craft(page), (c) => dist(c.pos, pose) < 0.1, 5000);
    await sleep(500);
    await page.keyboard.down('KeyW');
    const t2 = Date.now();
    let caught: PanelsReport | null = null;
    while (Date.now() - t2 < 6000) {
        // held in the same turn of the page as the look: the picture is of the frame the report describes
        const r = await page.evaluate(() => {
            const h = (window as unknown as { __gsfpv: { sonicPanels: { report(): { sound: { items: { kind: string; y: number; id: string }[] } | null }; freeze(on: boolean): void } } }).__gsfpv;
            const rr = h.sonicPanels.report();
            const items = rr.sound?.items ?? [];
            if (items.some((it) => it.id.startsWith('safety.obstacle') && it.y < 0) && items.some((it) => it.kind === 'open')) {
                h.sonicPanels.freeze(true);
                return rr;
            }
            return null;
        });
        if (r) { caught = r as unknown as PanelsReport; break; }
        await sleep(20);
    }
    await page.keyboard.up('KeyW');
    if (!caught) {
        check('walls-pillar: flying at the pillar, the pillar ahead and the open way\'s chime are drawn', false, await panels(page));
        await page.close();
        return out;
    }
    rep = await panels(page);
    const fly = await measureSounds(ctx, page, rep.sound!, 'sounds-pillar-ahead');
    await shot(page, 'sounds-pillar-ahead-page');
    const items = fly.items as { id: string; kind: string; at: number[]; elev: string | null; discIsKindColour: boolean; discContrast: number }[];
    const obstacle = items.find((it) => it.id.startsWith('safety.obstacle') && it.at[1]! < rep.sound!.layout!.radar.cy);
    const open = items.find((it) => it.kind === 'open');
    const side = rep.sound!.freeWay?.side ?? null;
    const L = rep.sound!.layout!.radar;
    check('walls-pillar: the pillar ahead (safety.obstacle) drawn ahead of the craft in the wall kind\'s colour', !!obstacle && obstacle.discIsKindColour && obstacle.discContrast >= 4.5 && Math.abs(obstacle.at[0]! - L.cx) < Math.abs(obstacle.at[1]! - L.cy), { obstacle });
    check(`walls-pillar: the open way's chime (plan.freeWay.side ${side}) drawn on that side in the open way's colour`, !!open && open.discIsKindColour && open.discContrast >= 4.5 && side !== null && (side === 'left' ? open.at[0]! < L.cx : side === 'right' ? open.at[0]! > L.cx : open.elev === (side === 'up' ? 'above' : 'below')), { open, freeWay: rep.sound!.freeWay });
    out.ahead = fly;
    await freeze(page, false);
    check('walls-pillar: no page error', errors.length === 0, errors);
    await page.close();
    return out;
}

/** rings-heights: the craft at 1.2 m at the start; the target note at the first ring's height on the height bar, the tone at the craft's. */
async function soundProofRings(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const lesson = getLesson('rings-heights');
    if (lesson.world.kind !== 'analytic') throw new Error('rings-heights');
    const world = createAnalyticWorld(lesson.world.spec);
    const gates = world.objects().filter((o) => o.shape.kind === 'ring').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const { page, errors } = await openLesson(ctx, 'rings-heights');
    const pose = [lesson.start.pos[0], world.floorY + 1.2, lesson.start.pos[2], lesson.start.yawDeg];
    await placeAt(page, pose);
    await until('the craft low at the start', () => craft(page), (c) => dist(c.pos, pose) < 0.1, 5000);
    await sleep(800);
    await freeze(page, true);
    const rep = await panels(page);
    const m = await measureSounds(ctx, page, rep.sound!, 'sounds-rings-heights');
    const a = await measureAttitude(ctx, page, rep.attitude!, 'attitude-rings-heights');
    await shot(page, 'sounds-rings-heights-page');
    const want = gates[0]!.pos[1] - world.floorY;
    const bar = m.bar as { targetM: number | null; toneM: number | null; target: { isTargetColour: boolean; contrast: number } | null; tone: { isToneColour: boolean; contrast: number } | null };
    check(`rings-heights: the target note on the height bar at the first ring's height (${round(want, 2)} m above the floor), drawn in the target's colour`, bar.targetM !== null && Math.abs(bar.targetM - want) < 0.01 && !!bar.target?.isTargetColour && bar.target.contrast >= 4.5, bar);
    const craftH = rep.attitude!.state!.heightM;
    check(`rings-heights: the height tone at the craft's height (${round(craftH, 2)} m), drawn in the tone's colour`, bar.toneM !== null && Math.abs(bar.toneM - craftH) < 0.05 && !!bar.tone?.isToneColour && bar.tone.contrast >= 4.5, bar);
    check('rings-heights: the attitude tape draws the same height to fly at', rep.attitude!.state!.targetM !== null && Math.abs(rep.attitude!.state!.targetM - want) < 0.01 && ((a.contrast as Record<string, number | null>).target ?? 0) >= 4.5, { targetM: rep.attitude!.state!.targetM, contrast: a.contrast });
    await freeze(page, false);
    // v13-int step 2: the target note comes from its target now (the package's heightDirection on, the default), so it is a disc on the radar too, at its
    // direction and drawn as the target's, beside the gate's hum; it sounds for a part of every second, so the panel is read until a note is on it
    let note: RadarItemLike | undefined;
    let hum: RadarItemLike[] = [];
    for (const t0 = Date.now(); Date.now() - t0 < 8000 && !note;) {
        const r = await panels(page);
        const items = (r.sound?.items ?? []) as unknown as RadarItemLike[];
        note = items.find((i) => i.id === 'height.target');
        hum = items.filter((i) => i.kind === 'target' && i.id !== 'height.target');
        if (!note) await sleep(40);
    }
    check('rings-heights: while the target note sounds it is a disc on the radar at its direction (not an event on the craft, not at the height bar\'s end), drawn as the target\'s, beside the gate\'s hum', !!note && note.kind === 'target' && note.event === false && note.bar === null && hum.length >= 1, { note, hum });
    check('rings-heights: no page error', errors.length === 0, errors);
    await page.close();
    return { sounds: m, attitude: a, note: { note, hum } };
}
/** The radar items the page reports, as far as this proof reads them (sound-panel.ts RadarItem). */
interface RadarItemLike { id: string; kind: string; event: boolean; bar: string | null; elev: string | null }

/** A step that plays its sound three times: walls-pillar's task plays the pillar's tick (safety.obstacle); in English and Polish. */
async function soundProofRepeat(ctx: BrowserContext, lang: 'en' | 'pl'): Promise<Record<string, unknown>> {
    const names = JSON.parse(readFileSync(join(REPO, `packages/sonic-fpv/locales/${lang}.json`), 'utf8')) as Record<string, string>;
    const words = JSON.parse(readFileSync(join(REPO, `packages/i18n/locales/fly/soniclook/${lang}.json`), 'utf8')) as Record<string, string>;
    const { page, errors } = await openLesson(ctx, 'walls-pillar', { lang, intro: 'keep' });
    const seen: { cue: string; name: string; count: string; t: number }[] = [];
    const t0 = Date.now();
    let shotTaken = '';
    while (Date.now() - t0 < 40000) {
        const r = await panels(page);
        const now = r.sound?.now ?? null;
        if (now && (seen.length === 0 || seen[seen.length - 1]!.count !== now.count || seen[seen.length - 1]!.cue !== now.cue)) {
            seen.push({ cue: now.cue, name: now.name, count: now.count, t: Date.now() - t0 });
            if (!shotTaken) {
                shotTaken = await shot(page, `sounds-repeat-${lang}-page`);
                const rep = r.sound!;
                const box = await page.evaluate(() => { const e = document.querySelector('[data-testid="sonic-sounds-now"]') as HTMLElement | null; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, text: e.textContent, hidden: e.hidden }; });
                if (box) writeFileSync(join(OUT, `sounds-repeat-${lang}.png`), await page.screenshot({ type: 'png', clip: { x: Math.floor(rep.canvas!.x) - 4, y: Math.floor(box.y) - 4, width: Math.ceil(rep.canvas!.w) + 8, height: Math.ceil(box.h) + 8 } }));
            }
        }
        if (seen.some((s) => s.cue === 'safety.obstacle' && s.count === words['soniclook.sounds.play']!.replace('{k}', '3').replace('{n}', '3'))) break;
        await sleep(60);
    }
    const name = names['cue.safety.obstacle.name'];
    const counts = seen.filter((s) => s.cue === 'safety.obstacle').map((s) => s.count);
    const want = [1, 2, 3].map((k) => words['soniclook.sounds.play']!.replace('{k}', String(k)).replace('{n}', '3'));
    check(`repeat (${lang}): the task's three plays of the pillar's tick show its icon and the glossary's name "${name}"`, seen.some((s) => s.cue === 'safety.obstacle' && s.name === name), seen);
    check(`repeat (${lang}): the card counts the plays: ${want.join(', ')}`, JSON.stringify(counts) === JSON.stringify(want), counts);
    check(`repeat (${lang}): no page error`, errors.length === 0, errors);
    await page.close();
    return { seen, shot: shotTaken };
}

/** The switches: each off hides its panel at once and stays off after a reload (read back from the prefs); on again shows it. */
async function switchProof(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const { page, errors } = await openLesson(ctx, 'walls-hall');
    await sleep(500);
    await setSwitch(page, 'soundPanel', false);
    await sleep(200);
    const off = await panels(page);
    check('the sound panel\'s switch off hides it at once; the attitude display stays', off.sound?.shown === false && off.attitude?.shown === true && off.prefs.soundPanel === false, off.prefs);
    await setSwitch(page, 'attitude', false);
    await sleep(200);
    await page.close();
    const again = await openLesson(ctx, 'walls-hall');
    await sleep(500);
    const read = await panels(again.page);
    const stored = await again.page.evaluate(() => (window as unknown as { __gsfpv: { prefs: { collection(k: string): Record<string, unknown> } } }).__gsfpv.prefs.collection('sonic'));
    check('after a reload both stay off (read back from the stored prefs)', read.sound?.shown === false && read.attitude?.shown === false && stored.soundPanel === false && stored.attitude === false, { prefs: read.prefs, stored: { soundPanel: stored.soundPanel, attitude: stored.attitude } });
    await setSwitch(again.page, 'soundPanel', true);
    await setSwitch(again.page, 'attitude', true);
    await sleep(200);
    const on = await panels(again.page);
    check('on again: both shown', on.sound?.shown === true && on.attitude?.shown === true, on.prefs);
    check('switches: no page error', errors.length === 0 && again.errors.length === 0, [...errors, ...again.errors]);
    await again.page.close();
    return { off: off.prefs, readBack: read.prefs, on: on.prefs };
}

/** A light page (prefers-color-scheme: light): the attitude display level and the sound panel by the wall, measured as in the dark. */
async function lightProof(browser: Browser): Promise<Record<string, unknown>> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'light' });
    await ctx.addInitScript({ content: INIT });
    try {
        const { page, errors } = await openLesson(ctx, 'walls-pillar');
        await sleep(800);
        const lesson = getLesson('walls-pillar');
        if (lesson.world.kind !== 'analytic') throw new Error('walls-pillar');
        const world = createAnalyticWorld(lesson.world.spec);
        const half = (world as unknown as { resolved: { widthM: number } }).resolved.widthM / 2;
        const pose = [-half + 0.6, 1.5, lesson.start.pos[2], 0];
        await placeAt(page, pose);
        await until('the craft by the wall', () => craft(page), (c) => dist(c.pos, pose) < 0.1, 5000);
        const t0 = Date.now();
        let rep = await panels(page);
        while (Date.now() - t0 < 4000 && !rep.sound?.items.some((it) => it.id.startsWith('safety.wall') && it.x < -0.2)) {
            await sleep(40);
            rep = await panels(page);
        }
        await freeze(page, true);
        rep = await panels(page);
        const a = await measureAttitude(ctx, page, rep.attitude!, 'light-attitude');
        const s = await measureSounds(ctx, page, rep.sound!, 'light-sounds');
        await shot(page, 'light-page');
        await freeze(page, false);
        const c = a.contrast as Record<string, number | null>;
        const low = Object.entries(c).filter(([, v]) => v !== null && (v as number) < 4.5);
        check(`light page: the panels drawn black on white (the box's scheme), the attitude display's every line and mark 4.5:1 or more on the picture`, rep.attitude!.scheme === 'light' && rep.sound!.scheme === 'light' && low.length === 0 && near(s.background as Rgb8, [255, 255, 255]), { contrast: c, background: s.background });
        const items = s.items as { id: string; discIsKindColour: boolean; discContrast: number }[];
        check(`light page: every disc of the sound panel in its kind's light-page colour, 4.5:1 or more against the white box`, items.length > 0 && items.every((it) => it.discIsKindColour && it.discContrast >= 4.5), items);
        check('light page: no page error', errors.length === 0, errors);
        await page.close();
        return { attitude: a, sounds: s };
    } finally {
        await ctx.close();
    }
}

async function scenarioPanels(ctx: BrowserContext, browser: Browser): Promise<Record<string, unknown>> {
    return {
        light: await lightProof(browser),
        attitude: await attitudeProof(ctx),
        pillar: await soundProofPillar(ctx),
        rings: await soundProofRings(ctx),
        repeatEn: await soundProofRepeat(ctx, 'en'),
        repeatPl: await soundProofRepeat(ctx, 'pl'),
        switches: await switchProof(ctx)
    };
}

// ------------------------------------------------------------------ layout (L2-4: the panels' places at every size, dark and light)

// (v13-int step 8: the progress panel on the page is v13-host's real one, drawn by the mode from the runner's view; v13-look's
// stand-in of its CSS, tools/bench/src/v13-look-progress-standin.css, is gone.)

/**
 * The page's sizes: three windows, two of them at 200 % zoom, three laptop windows between 601 and 705 px high (v13-int review K4: a
 * 1366 x 768 laptop's browser window, the lowest of them, a 1920 x 1080 laptop at 125 %), a phone upright (with and without its touch
 * sticks) and on its side, a tablet upright and on its side with its touch sticks (K4).
 */
const SIZES: { name: string; w: number; h: number; dpr: number; mobile?: boolean; sticks?: boolean }[] = [
    { name: '1280x720', w: 1280, h: 720, dpr: 1 },
    { name: '1366x768', w: 1366, h: 768, dpr: 1 },
    { name: '1920x1080', w: 1920, h: 1080, dpr: 1 },
    { name: '1920x1080-zoom200', w: 960, h: 540, dpr: 2 },
    { name: '1280x720-zoom200', w: 640, h: 360, dpr: 2 },
    { name: 'laptop-1366x657', w: 1366, h: 657, dpr: 1 },
    { name: 'window-1280x601', w: 1280, h: 601, dpr: 1 },
    { name: 'laptop-1536x705', w: 1536, h: 705, dpr: 1.25 },
    { name: 'phone-upright', w: 390, h: 844, dpr: 3, mobile: true },
    { name: 'phone-upright-sticks', w: 390, h: 844, dpr: 3, mobile: true, sticks: true },
    { name: 'phone-on-its-side', w: 844, h: 390, dpr: 3, mobile: true },
    { name: 'tablet-upright-sticks', w: 768, h: 1024, dpr: 2, mobile: true, sticks: true },
    { name: 'tablet-on-its-side-sticks', w: 1024, h: 768, dpr: 2, mobile: true, sticks: true }
];
/**
 * LAYOUT_LANG=<lang,...>: the page's languages for the layout check, all four by default (v13-int review K2: the longer captions of
 * Spanish, Polish and Russian reached the panels at four sizes).
 */
const LAYOUT_LANGS = (process.env.LAYOUT_LANG ?? 'en,es,pl,ru').split(',').filter((l) => ['en', 'es', 'pl', 'ru'].includes(l));

/**
 * What a panel must never cover: the view's centre, the captions, the page's controls and the touch sticks (and each of the other two
 * panels, below); the lines it may cover where there is no room (reported).
 */
const HARD = ['centre', 'captions', 'topLeft', 'topRight', 'topBar', 'recorder', 'recBar', 'pads', 'arm'];
const SOFT = ['telemetry', 'keys', 'takeOff'];
/** The three panels of the mode on the page: v13-host's progress panel, v13-look's attitude display and sound panel (the `boxes` keys). */
const PANELS = ['progress', 'attitude', 'sounds'] as const;

interface Box { x: number; y: number; w: number; h: number }
const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The boxes of what is on the page now: the panels, the captions' lines, the progress panel, the HUD's corners and controls. */
const boxes = (page: Page): Promise<Record<string, Box[]>> =>
    page.evaluate(() => {
        const sel: Record<string, string> = {
            attitude: '.sonic-attitude', sounds: '.sonic-sounds', captions: '.sonic-captions .sonic-caption', progress: '.sonic-progress',
            topLeft: '.osd.tl', topRight: '.osd.tr', topBar: '.top-actions', telemetry: '.osd.bl', keys: '.osd.br', recorder: '.sonicrec-toggle',
            recBar: '.cinema-bar', takeOff: '.gate-msg', pads: '.touch-pad', arm: '.touch-arm', padHint: '.touch-hint'
        };
        const out: Record<string, { x: number; y: number; w: number; h: number }[]> = {};
        for (const [k, s] of Object.entries(sel)) {
            out[k] = [...document.querySelectorAll(s)].flatMap((e) => {
                const el = e as HTMLElement;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]') || el.classList.contains('sonic-sr-only')) return [];
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? [{ x: r.left, y: r.top, w: r.width, h: r.height }] : [];
            });
        }
        return out;
    });

async function layoutAt(browser: Browser, size: (typeof SIZES)[number], scheme: 'dark' | 'light', css: string | null, lang: string): Promise<Record<string, unknown>> {
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, isMobile: !!size.mobile, hasTouch: !!size.mobile, colorScheme: scheme });
    await ctx.addInitScript({ content: INIT });
    // the checks of a language other than English say it first
    const at = `${lang === 'en' ? '' : `${lang} `}${size.name}`;
    try {
        const { page, errors } = await openLesson(ctx, 'hover-height', { lang, ...(size.sticks ? { query: '&input=touch' } : {}) });
        if (css) await page.addStyleTag({ content: css });
        await sleep(900);
        const b = await boxes(page);
        const rep = await panels(page);
        const name = `layout-${lang === 'en' ? '' : `${lang}-`}${size.name}-${scheme}`;
        // small: CSS pixels (the device's are the dial's own measure, not this picture's)
        writeFileSync(join(OUT, `${name}.jpg`), await page.screenshot({ type: 'jpeg', quality: 55, scale: 'css' }));
        // the full-size picture stays out of the repository (LAYOUT_KEEP, default the system's temporary folder); its path and SHA-256 are in the evidence
        const keepDir = join(process.env.LAYOUT_KEEP ?? join(tmpdir(), 'gsfpv-v13-look-layout'), `${today()}${TAG ? `-${TAG}` : ''}`);
        mkdirSync(keepDir, { recursive: true });
        const full = await page.screenshot({ type: 'png' });
        writeFileSync(join(keepDir, `${name}.png`), full);
        const W = size.w, H = size.h;
        const centre: Box = { x: 0.35 * W, y: 0.35 * H, w: 0.3 * W, h: 0.3 * H };
        const keep: Record<string, Box[]> = { centre: [centre], captions: b.captions ?? [], topLeft: b.topLeft ?? [], topRight: b.topRight ?? [], topBar: b.topBar ?? [], telemetry: b.telemetry ?? [], keys: b.keys ?? [], recorder: b.recorder ?? [], recBar: b.recBar ?? [], takeOff: b.takeOff ?? [], pads: b.pads ?? [], arm: b.arm ?? [] };
        const res: Record<string, unknown> = { picture: `${name}.jpg`, full: { file: join(keepDir, `${name}.png`), sha256: createHash('sha256').update(full).digest('hex') }, boxes: b };
        // the page's real progress panel (v13-host: progress-panel.ts), the longest it gets: the title and four rows, in this scheme's colours
        const prog = await page.evaluate(() => {
            const el = document.querySelector('.sonic-progress') as HTMLElement | null;
            if (!el || el.hidden) return null;
            const cs = getComputedStyle(el);
            return { rows: el.innerText.split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => x !== ''), font: parseFloat(cs.fontSize), color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor };
        });
        res.progressPanel = prog;
        const wantInk = scheme === 'dark' ? ['rgb(255, 255, 255)', 'rgb(0, 0, 0)'] : ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'];
        check(`${at} ${scheme}: the page's real progress panel shows the lesson's title and its four rows (Lesson, Step, Attempt, Counted), ${scheme === 'dark' ? 'white on black' : 'black on white'}, ${prog ? prog.font : '-'} px`, !!prog && prog.rows.length === 5 && (lang !== 'en' || (/^Lesson \d+ of 28$/.test(prog.rows[1] ?? '') && /^Step \d+ of \d+$/.test(prog.rows[2] ?? '') && /^Attempt \d+$/.test(prog.rows[3] ?? '') && /^Counted \d+ of \d+$/.test(prog.rows[4] ?? ''))) && prog.color === wantInk[0] && prog.background === wantInk[1] && prog.font >= 15, prog);
        for (const panel of PANELS) {
            const pb = (b[panel] ?? [])[0];
            if (!pb) {
                check(`${at} ${scheme}: the ${panel} panel is on the page`, false, b);
                continue;
            }
            const inside = pb.x >= -0.5 && pb.y >= -0.5 && pb.x + pb.w <= W + 0.5 && pb.y + pb.h <= H + 0.5;
            const over = (names: readonly string[]): string[] => Object.entries(keep).filter(([k]) => names.includes(k)).flatMap(([k, list]) => list.map((x) => ({ k, a: overlap(pb, x) })).filter((o) => o.a > 1).map((o) => `${o.k} ${Math.round(o.a)} px2`));
            const hits = over(HARD);
            for (const o of PANELS) {
                const ob = o === panel ? undefined : (b[o] ?? [])[0];
                if (ob && overlap(pb, ob) > 1) hits.push(`the ${o} panel ${Math.round(overlap(pb, ob))} px2`);
            }
            const covers = over(SOFT);
            check(`${at} ${scheme}: the ${panel} panel (${Math.round(pb.w)} x ${Math.round(pb.h)} at ${Math.round(pb.x)}, ${Math.round(pb.y)}) inside the page, clear of the view's centre, the captions, the page's controls, the touch sticks and the other two panels${covers.length ? ` (covers ${covers.join(', ')})` : ''}`, inside && hits.length === 0, { box: pb, hits, covers });
            res[panel] = { box: pb, hits, covers };
        }
        // readable: the dial and the radar large enough, the panels' words 15 px or more (CSS px: at 200 % zoom twice the device pixels)
        const sizes = await page.evaluate(() => {
            const t = document.querySelector('.sonic-sounds-title') as HTMLElement | null;
            return { title: t ? parseFloat(getComputedStyle(t).fontSize) : null };
        });
        const dial = rep.attitude?.layout ? 2 * (rep.attitude.layout.dial.r + rep.attitude.layout.dial.bezel) : null;
        const radar = rep.sound?.layout ? 2 * rep.sound.layout.radar.r : null;
        res.sizes = { dialPx: dial, radarPx: radar, tapeFontPx: rep.attitude?.layout?.font ?? null, titleFontPx: sizes.title, devicePixels: { dial: dial === null ? null : dial * size.dpr, radar: radar === null ? null : radar * size.dpr } };
        check(`${at} ${scheme}: readable: the dial ${dial === null ? '-' : Math.round(dial)} px and the radar ${radar === null ? '-' : Math.round(radar)} px across, the tape's numbers ${rep.attitude?.layout?.font} px, the panel's words ${sizes.title} px (CSS pixels; ${size.dpr} device pixels each)`, dial !== null && radar !== null && dial >= 48 && radar >= 40 && (rep.attitude?.layout?.font ?? 0) >= 11 && (sizes.title ?? 0) >= 13, res.sizes);
        check(`${at} ${scheme}: no page error`, errors.length === 0, errors);
        await page.close();
        return res;
    } finally {
        await ctx.close();
    }
}

async function scenarioLayout(_ctx: BrowserContext, browser: Browser): Promise<Record<string, unknown>> {
    // LOOK_CSS=<file>: CSS laid over the build's own (to try a place before it goes into look.css; never for the evidence of record)
    const css = process.env.LOOK_CSS ? readFileSync(process.env.LOOK_CSS, 'utf8') : null;
    const out: Record<string, unknown> = { trialCss: css !== null };
    // SIZES=<name,...>: only those (a trial); SCHEMES=dark or light: only that one
    const only = process.env.SIZES ? process.env.SIZES.split(',') : null;
    const schemes = (process.env.SCHEMES ? process.env.SCHEMES.split(',') : ['dark', 'light']) as ('dark' | 'light')[];
    out.trial = only !== null || schemes.length < 2 || css !== null || LAYOUT_LANGS.length < 4;
    out.languages = LAYOUT_LANGS;
    for (const lang of LAYOUT_LANGS) for (const scheme of schemes) for (const size of SIZES) if (!only || only.includes(size.name)) out[`${lang === 'en' ? '' : `${lang}-`}${size.name}-${scheme}`] = await layoutAt(browser, size, scheme, css, lang);
    return out;
}

// ------------------------------------------------------------------ the frame with the panels (L2-4)

/**
 * The page's frame in a flying lesson with both panels and with neither (their switches): the engine's CPU time per frame
 * (frameupdate to frameend: the flight model, the mode, the sound planner, the panels' drawing, the scene, the encoding of the
 * draw) and the panels' own share (their frame handlers, from the page's hook); the craft flying the corridor's track on W.
 */
async function panelFrame(ctx: BrowserContext, lessonId: string, on: boolean): Promise<Record<string, unknown>> {
    const { page, errors } = await openLesson(ctx, lessonId);
    await setSwitch(page, 'soundPanel', on);
    await setSwitch(page, 'attitude', on);
    await page.evaluate(() => {
        const w = window as unknown as { __pc?: unknown; __gsfpv: { session: { renderer: { app: { on(e: string, f: () => void): void } } } } };
        const P = { cpu: [] as number[], rec: false };
        w.__pc = P;
        let t0 = 0;
        const app = w.__gsfpv.session.renderer.app;
        app.on('frameupdate', () => { t0 = performance.now(); });
        app.on('frameend', () => { if (P.rec && t0) P.cpu.push(performance.now() - t0); });
    });
    const runs: Record<string, unknown>[] = [];
    const all: number[] = [];
    for (let i = 0; i < 3; i++) {
        await page.keyboard.down('KeyW');
        await sleep(600);
        await page.evaluate(() => { const P = (window as unknown as { __pc: { cpu: number[]; rec: boolean } }).__pc; P.cpu = []; P.rec = true; });
        await sleep(2500);
        const cpu = await page.evaluate(() => { const P = (window as unknown as { __pc: { cpu: number[]; rec: boolean } }).__pc; P.rec = false; return P.cpu.slice(); });
        await page.keyboard.up('KeyW');
        all.push(...cpu);
        runs.push({ cpuMs: stats(cpu) });
        await sleep(800);
    }
    const rep = await panels(page);
    const out = { lesson: lessonId, panels: on, cpuMs: stats(all), runs, panelMs: rep.frameMs, shown: { attitude: rep.attitude?.shown ?? false, sound: rep.sound?.shown ?? false }, draws: { attitude: rep.attitude?.draws ?? 0, sound: rep.sound?.draws ?? 0 } };
    check(`${lessonId} with the panels ${on ? 'on' : 'off'}: frames measured while flying, the panels ${on ? 'shown and drawing' : 'hidden'}`, all.length > 100 && (on ? out.shown.attitude && out.shown.sound && out.draws.attitude > 10 && out.draws.sound > 10 : !out.shown.attitude && !out.shown.sound) && errors.length === 0, { cpuMs: out.cpuMs, panelMs: out.panelMs, shown: out.shown, draws: out.draws, errors });
    await setSwitch(page, 'soundPanel', true);
    await setSwitch(page, 'attitude', true);
    await page.close();
    return out;
}

async function scenarioPanelCost(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const id of ['corridor', 'rings-heights']) {
        const off = await panelFrame(ctx, id, false);
        const on = await panelFrame(ctx, id, true);
        const again = await panelFrame(ctx, id, false);
        const p95 = (r: Record<string, unknown>): number => (r.cpuMs as Stats).p95;
        const pm = on.panelMs as { attitude: { p95: number }; sound: { p95: number } };
        check(`${id}: the whole frame with both panels ${p95(on)} ms at p95 (without: ${p95(off)}, ${p95(again)} ms), under v0.12's frame of 16.7 ms; the panels' own p95 ${round(pm.attitude.p95 + pm.sound.p95, 3)} ms, under 1 ms`, p95(on) < 16.7 && pm.attitude.p95 + pm.sound.p95 < 1, { off: off.cpuMs, on: on.cpuMs, offAgain: again.cpuMs, panelMs: on.panelMs });
        out[id] = { off, on, offAgain: again };
    }
    return out;
}

const SCENARIOS: Record<string, (ctx: BrowserContext, browser: Browser) => Promise<Record<string, unknown>>> = { bump: scenarioBump, cost: scenarioCost, look: scenarioLook, panels: scenarioPanels, layout: scenarioLayout, panelcost: scenarioPanelCost };
/** The panels' runs draw a dark page (the stage's own runs keep Playwright's default, as they were measured) */
const DARK = new Set(['panels', 'layout', 'panelcost']);

async function main(): Promise<void> {
    const run = SCENARIOS[SCENARIO];
    if (!run) throw new Error(`unknown scenario ${SCENARIO}: ${Object.keys(SCENARIOS).join(', ')}`);
    await lock();
    // cost: WebGPU's developer features give timestamp queries unquantized (stock Chrome rounds them to about 0.066 ms here,
    // more than a lesson world's whole frame takes the GPU); nothing else of the drawing changes
    const { browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required', ...(SCENARIO === 'cost' ? ['--enable-webgpu-developer-features'] : [])] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(DARK.has(SCENARIO) ? { colorScheme: 'dark' as const } : {}) });
        await ctx.addInitScript({ content: INIT });
        const release = await (await fetch(`${SITE}/release.json`)).json().catch(() => null);
        const result = await run(ctx, browser);
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
