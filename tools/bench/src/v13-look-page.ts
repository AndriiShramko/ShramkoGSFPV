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
console.log(`v13-look-page target: ${SITE}, scenario ${SCENARIO}`);
const LOCK = 'C:/dev/.gpu-lock';
const OUT = join(REPO, 'evidence', today(), `v13-look-${SCENARIO}`);
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

const SCENARIOS: Record<string, (ctx: BrowserContext) => Promise<Record<string, unknown>>> = { bump: scenarioBump };

async function main(): Promise<void> {
    const run = SCENARIOS[SCENARIO];
    if (!run) throw new Error(`unknown scenario ${SCENARIO}: ${Object.keys(SCENARIOS).join(', ')}`);
    await lock();
    const { browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        await ctx.addInitScript({ content: INIT });
        const release = await (await fetch(`${SITE}/release.json`)).json().catch(() => null);
        const result = await run(ctx);
        const passed = checks.filter((c) => c.pass).length;
        const file = writeEvidence(`v13-look-${SCENARIO}`, { site: SITE, release, scenario: SCENARIO, checks, passed, total: checks.length, result });
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
