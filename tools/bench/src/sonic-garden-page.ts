// v0.12 Fly by Sound, lane v12-flight step 10 (docs/wip/v12-plan.md 4.2): module 7, free flight in the Winter Garden at x5, in the
// real page: headless Chrome on the real GPU, the real scan (7a475d38 from the scene CDN, drawn and walled), the lesson host, the
// flight model, the sound engine on one AudioContext, the track's eight rings over the scan. A scripted pilot reads the page's test
// hook (window.__gsfpv.sonic: the lesson, the phase, the craft, the next ring, the walls flown, what the engine's frame costs) and
// presses keys like a person (W, E and Q, Space and Shift), through three entries:
//   entry   /fly/?sonic=free-garden: Enter on the start screen's "Start: ..." button; the scan loads at x5 with the walls on (the prefs'
//           session layer), the keyboard is the input with no Controls screen, the lesson opens, the craft goes to the track's start;
//   swap    /fly/?sonic=rings-first, then the pause menu's "Fly by Sound" item over the flight and the Winter Garden lesson chosen from the
//           screen: the page's own scene switch loads the scan in place of the lesson's world (the size and walls forced, the engine silent
//           and a line said meanwhile), and the lesson opens; then hover-height is chosen: the scan session is replaced by a lesson world
//           and the scan's size and walls are given back (scale 1, a built-in session);
//   (each entry flies the course to its pass, the eight gates in order, timed, progress saved with the best time.)
// Checked in each: the walls flown are 16 cm cells (the scan's 3.2 cm x5) and not built in, the scale is 5, the helper's view has the 8 rings,
// the engine runs on one AudioContext, the output is heard (RMS) and under the limiter's ceiling, the walls were said to be coarse, no console
// error. Evidence: evidence/<date>/sonic-garden-page.json and screenshots next to it. Holds the GPU lock.
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-garden-page.ts [entry swap]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { INIT, lap, lock, probe, sleep, unlock, waitFlying } from './sonic-garden-pilot';
import type { Lap } from './sonic-garden-pilot';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const NAME = 'sonic-garden-page';
const OUT = join(REPO, 'evidence', today(), NAME);
mkdirSync(OUT, { recursive: true });
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};

async function pageChecks(page: Page, tag: string, l: Lap): Promise<void> {
    const gates = l.end.events.filter((e) => e.kind === 'gate');
    const touches = l.end.events.filter((e) => e.kind === 'touch');
    check(`${tag}: the lesson is passed end to end by the keyboard (the lesson's own 'passed' event)`, l.passed, { seconds: l.seconds });
    check(`${tag}: the eight rings in order, each inside the opening (miss at most 1.75 m)`, gates.length >= 8 && gates.slice(-8).map((g) => g.gateId).join() === 'ring-1,ring-2,ring-3,ring-4,ring-5,ring-6,ring-7,ring-8' && gates.every((g) => (g.missM ?? 9) <= 1.75), { gates: gates.map((g) => `${g.gateId}:${g.missM}`) });
    check(`${tag}: no touch (the walls were not met)`, touches.length === 0, { touches: touches.map((t) => t.material) });
    const prog = l.end.progress['free-garden'];
    check(`${tag}: progress saved with the best time`, !!prog && prog.passed && typeof prog.bestTimeMs === 'number' && prog.bestTimeMs > 0, prog);
    const w = l.end.walls;
    check(`${tag}: the page flies the real scan at x5 on 16 cm walls (not a built-in world)`, !w.builtin && w.scene === '7a475d38' && Math.abs(w.scale - 5) < 1e-9 && w.voxelM !== null && Math.abs(w.voxelM - 0.16) < 1e-6, w);
    check(`${tag}: the helper's view has the eight rings over the scan`, l.end.stagePrims >= 8, { prims: l.end.stagePrims });
    const speech = l.end.events.filter((e) => e.kind === 'speech' && e.key !== 'speech.end');
    check(`${tag}: the lesson said its time and its pass line, and the walls were said to be coarse (16 cm)`, speech.some((e) => e.key === 'fly.best-time' || e.key === 'fly.time') && speech.some((e) => e.key === 'lesson.free-garden.pass') && speech.some((e) => e.key === 'sonic.say.wallsCoarse' && /16/.test(e.text ?? '')), speech.map((e) => e.key).slice(-14));
    const tap = await page.evaluate(() => (window as unknown as { __tap: { maxRms: number; maxPeak: number } }).__tap);
    const acs = await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount);
    check(`${tag}: the engine made sound (RMS over 1e-3), held the limiter's ceiling (peak at most 0.5013), on one AudioContext`, tap.maxRms > 1e-3 && tap.maxPeak <= 0.5013 && acs === 1 && l.end.engine === 'running', { ...tap, audioContexts: acs });
    // measured, not a pass mark: the whole engine frame (rays, hazards, planner and the audio graph's updates) as the page ran it, the clock 0.1 ms coarse
    check(`${tag}: measured: the engine's whole frame in this page (rays, planner, audio updates), ms: ${l.end.cost.p50} p50, ${l.end.cost.p95} p95, ${l.end.cost.p99} p99, ${l.end.cost.max} max over ${l.end.cost.n} frames`, l.end.cost.n > 500, l.end.cost);
    const rays = await page.evaluate(() => (window as unknown as { __gsfpv: { sonicRays?: (n?: number) => { frames: number; msPerFrame: number; raysPerFrame: number } | null } }).__gsfpv.sonicRays?.(600));
    check(`${tag}: the scene sampler alone (30 rays at 16 cm cells) in this page: ${rays?.msPerFrame} ms a frame, under the plan's 1 ms`, !!rays && rays.msPerFrame < 1, rays);
}

await lock();
const results: Record<string, unknown>[] = [];
try {
    const which = process.argv.slice(2).length ? process.argv.slice(2) : ['entry', 'swap'];
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;
    const notFound: string[] = [];
    page.on('response', (r) => { if (r.status() === 404 || r.status() === 403) notFound.push(`${r.status()} ${r.url()}`); });

    if (which.includes('entry')) {
        const t0 = Date.now();
        await page.goto(`${LAB}/fly/?sonic=free-garden&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await waitFlying(page, 'free-garden', 240000);
        const loadS = Math.round((Date.now() - t0) / 1000);
        const first = await probe(page);
        check('entry: Enter on the start screen loads the scan at x5 with no Controls screen, and the lesson opens', first.lesson === 'free-garden' && !(await page.$('.screen.radio')), { seconds: loadS, lesson: first.lesson, walls: first.walls });
        await sleep(1500);
        writeFileSync(join(OUT, 'entry-start.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
        const l = await lap(page, OUT, 'entry', 6 * 60000);
        await pageChecks(page, 'entry', l);
        writeFileSync(join(OUT, 'entry-after-pass.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
        // the lesson was the last of the path: the start screen opens, and the lesson's button carries the best time in the words of the spoken menu
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 15000 }).catch(() => undefined);
        const label = await page.evaluate(() => document.querySelector('[data-testid="sonic-lesson"][data-lesson="free-garden"]')?.textContent ?? '');
        check('entry: after the pass the start screen shows the lesson as passed, with its best time', /passed/.test(label) && /best time \d/.test(label), { label });
        results.push({ entry: 'entry', loadSeconds: loadS, lapSeconds: l.seconds, passed: l.passed, progress: l.end.progress['free-garden'], cost: l.end.cost, walls: l.end.walls, gates: l.end.events.filter((e) => e.kind === 'gate').length, touches: l.end.events.filter((e) => e.kind === 'touch').length });
    }

    if (which.includes('swap')) {
        await page.goto(`${LAB}/fly/?sonic=rings-first&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await waitFlying(page, 'rings-first', 90000);
        const before = await probe(page);
        check('swap: the page starts on a lesson world (a built-in session, scale 1)', before.walls.builtin && Math.abs(before.walls.scale - 1) < 1e-9, before.walls);
        await sleep(1500);
        // the pause menu's item opens the start screen over the flight; the Winter Garden lesson is chosen with the keyboard (since v0.13 Escape in a
        // lesson is the lesson menu, v13-host B6: the page's pause menu is on P)
        await page.keyboard.press('KeyP');
        await page.waitForSelector('[data-action="pause.sonic"]', { timeout: 5000 });
        await (await page.$('[data-action="pause.sonic"]'))!.focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 5000 });
        const t1 = Date.now();
        await page.focus('[data-lesson="free-garden"]');
        await page.keyboard.press('Enter');
        await waitFlying(page, 'free-garden', 240000);
        const loadS = Math.round((Date.now() - t1) / 1000);
        const now = await probe(page);
        check('swap: the lesson chosen over the flight loads the scan in the page (scale 5, 16 cm walls, not built in) and opens', now.lesson === 'free-garden' && !now.walls.builtin && Math.abs(now.walls.scale - 5) < 1e-9 && now.walls.voxelM !== null && Math.abs(now.walls.voxelM - 0.16) < 1e-6, { seconds: loadS, walls: now.walls });
        const said = (await probe(page, true)).events.filter((e) => e.kind === 'speech').map((e) => e.key);
        check('swap: the page said that the scan is loading before it loaded (that line is a speech event of the mode)', said.includes('sonic.say.scanLoading'), { said: said.slice(-8) });
        await sleep(1200);
        writeFileSync(join(OUT, 'swap-start.jpg'), await page.screenshot({ type: 'jpeg', quality: 78 }));
        const l = await lap(page, OUT, 'swap', 6 * 60000);
        await pageChecks(page, 'swap', l);
        results.push({ entry: 'swap', loadSeconds: loadS, lapSeconds: l.seconds, passed: l.passed, progress: l.end.progress['free-garden'], cost: l.end.cost, walls: l.end.walls, gates: l.end.events.filter((e) => e.kind === 'gate').length, touches: l.end.events.filter((e) => e.kind === 'touch').length });
        // back to a lesson world: the scan session is replaced, the scan's size and walls are given back (the pause menu is on P since v0.13)
        await page.keyboard.press('KeyP');
        await page.waitForSelector('[data-action="pause.sonic"]', { timeout: 5000 });
        await (await page.$('[data-action="pause.sonic"]'))!.focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 5000 });
        await page.focus('[data-lesson="hover-height"]');
        await page.keyboard.press('Enter');
        await waitFlying(page, 'hover-height', 90000);
        const back = await probe(page);
        const prefs = await page.evaluate(() => { const h = (window as unknown as { __gsfpv: { prefs: { get(id: string, ctx?: { scene: string }): unknown } } }).__gsfpv; return { transform: h.prefs.get('scene.transform', { scene: '7a475d38' }), walls: h.prefs.get('scene.walls', { scene: '7a475d38' }) }; });
        check('swap: back on a lesson world the scan session is gone (built-in, scale 1) and the scan\'s size is not held in the prefs any more', back.walls.builtin && Math.abs(back.walls.scale - 1) < 1e-9 && !(prefs.transform && (prefs.transform as { s: number }).s === 5), { walls: back.walls, prefs });
    }

    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u) && !/\/api\//.test(u) && !/cloudfront|amazonaws|playcanvas/.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource/.test(l));
    check('no console error and no missing file of the page (the API the dev server has not, the favicon and the scene CDN\'s optional files aside)', errors.length === 0 && missing.length === 0, { errors: errors.slice(0, 6), missing: missing.slice(0, 6) });
    const file = writeEvidence(NAME, {
        step: 'v12-flight 10: module 7, free flight in the Winter Garden at x5, in the real page by a scripted keyboard pilot',
        page: `${LAB}/fly/?sonic=<lesson> (Vite dev server), the scan from the scene CDN`,
        note: 'headless Chrome runs muted (--mute-audio); how anything sounds is not judged here; "my screen reader speaks" on, speed 2: the engine says nothing, it waits the time a line takes',
        results,
        notFound: [...new Set(notFound)].slice(0, 20),
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
    await L.browser.close();
} finally {
    unlock();
}
