// The courses' page probe (train 1, lane tracks, T3; docs/wip/train1-plan.md section 3 bullet T3, docs/wip/tracks.md). A RELEASE build of
// this tree (dist/) under nginx's enforced CSP with a local API on a fresh DATA_DIR (tracks-serve.ts), headless Chrome (chrome.mjs through
// browser.ts), the keyboard, and one click on the pause menu's "Save for everyone".
//   A  scene 7a475d38 (Winter Garden; the fixture scene 39e63ce9 gives 0 gates, tracks.md Findings): Shift+G generates (hook source
//      'generated', gates > 0, drawn > 0), pixels of the course's colours in a screenshot over the one before; Shift+T hides it (drawn 0,
//      the pixels gone); the pause menu's "Save for everyone" stores it (hook.saved).
//   B  a fresh profile on the same scene: the list has it (serverTracks > 0), Shift+T loads it (source 'server', the same track id).
// Controls that must fire:
//   C1 a fresh profile on another scene (887f27aa): serverTracks 0, source 'none', the menu's "Load" disabled.
//   C2 A's course with one gate moved into a wall of the scene (check.ts nearestWall + withGateAt on the walls Node loads), POSTed straight to
//      the API (the server cannot see walls, it stores it); a fresh profile loads the newest with Shift+T: refused (problem 'refused...').
//   C3 the same page with the course's root never attached to the scene (the release script patched in flight by a route): the hook still
//      says drawn > 0, the pixel check fails.
//   node scripts/build-release.mjs
//   cd tools/bench && npx tsx src/tracks-page.ts
// Holds C:/dev/.gpu-lock while the browser runs (one blocking loop, mkdir or 20 s more, at most 9 minutes; let go also on an error); the
// build and the servers run without it. Evidence: evidence/<date>/tracks-page.json (exit 1 when a check fails). Screenshots stay out of the
// repository (SHOTS, default the system's temp folder), their SHA-256 in the evidence.
import { createHash } from 'node:crypto';
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { checkTrack, flownCollision, nearestWall, withGateAt } from '@gsfpv/tracks';
import type { TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { today, writeEvidence } from './evidence';
import { loadScene } from './scenes';
import { serveTracks } from './tracks-serve';

const SCENE = '7a475d38';
const OTHER = '887f27aa';
const LOCK = 'C:/dev/.gpu-lock';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-tracks-page', today());
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** pixels of the course's colours a drawn course must add over the screenshot before it (an estimate: a gate a few metres away covers thousands) */
const MIN_PX = 200;
/** colour distance per channel that still counts as the course's paint (an estimate: flat unlit colours, antialiased edges) */
const TOL = 24;
/** view.ts PAINT in 8-bit sRGB: next lime, later teal, arrows amber (passed grey is left out: the scan has grey everywhere) */
const PAINT: Record<string, [number, number, number]> = { next: [166, 255, 26], later: [38, 140, 140], arrow: [255, 184, 26] };

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): boolean => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    return pass;
};
const shots: { file: string; sha256: string; what: string }[] = [];

let locked = false;
async function takeLock(): Promise<void> {
    const end = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(LOCK);
            locked = true;
            return;
        } catch {
            if (Date.now() > end) throw new Error('the GPU lock was not free for 9 minutes');
            console.log('waiting for the GPU lock');
            await sleep(20000);
        }
    }
}
const letGo = (): void => {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* gone */
    }
};
process.on('SIGINT', () => {
    letGo();
    process.exit(130);
});

interface CourseHook { on: boolean; source: string; track: { id: string; version: number } | null; gates: number; drawn: number; beaconPoints: number; problem: string | null; serverTracks: number; saved: string | null }
const course = (page: Page): Promise<CourseHook | null> =>
    page.evaluate(() => ((window as unknown as { __gsfpv?: { course?: CourseHook } }).__gsfpv?.course ?? null));
const status = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);

/** Polls `get` until `ok`; the last value and whether it came in time (a miss is a failed check, never a throw). */
async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T; ms: number }> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
        await sleep(250);
        v = await get();
    }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

/** The page counting colours: about:blank of its own context (no CSP), a PNG decoded into a 2D canvas. */
let counter: Page;
async function colours(png: Buffer): Promise<Record<string, number>> {
    return counter.evaluate(
        async ({ b64, paint, tol }) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d') as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            const out: Record<string, number> = {};
            for (const k of Object.keys(paint)) out[k] = 0;
            for (let i = 0; i < d.length; i += 4) {
                for (const [k, p] of Object.entries(paint)) {
                    if (Math.abs((d[i] as number) - p[0]) <= tol && Math.abs((d[i + 1] as number) - p[1]) <= tol && Math.abs((d[i + 2] as number) - p[2]) <= tol) {
                        out[k] = (out[k] as number) + 1;
                        break;
                    }
                }
            }
            return out;
        },
        { b64: png.toString('base64'), paint: PAINT, tol: TOL }
    );
}
const total = (c: Record<string, number>): number => Object.values(c).reduce((a, b) => a + b, 0);
async function shot(page: Page, name: string, what: string): Promise<Record<string, number>> {
    const png = await page.screenshot();
    const file = join(SHOTS, `${name}.png`);
    writeFileSync(file, png);
    shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what });
    return colours(png);
}

async function fresh(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
}

/** A flight on `scene`: ready, then the Controls screen of a first flight (if it comes) answered with the keyboard. */
async function open(ctx: BrowserContext, site: string, scene: string, log: string[]): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    await page.goto(`${site}/en/fly/?scene=${scene}&nowarn=1`);
    const r = await until(() => status(page), (v) => v === 'ready' || v === 'error', 180000);
    if (r.v !== 'ready') throw new Error(`the flight on ${scene} is not ready: ${r.v}`);
    const radio = '.screen.radio [data-action="radio-keyboard"]';
    try {
        await page.waitForSelector(radio, { timeout: 15000 });
        await page.focus(radio);
        await page.keyboard.press('Enter');
        await until(() => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    } catch {
        /* no Controls screen */
    }
    await sleep(1500);
    return page;
}

const RE_ATTACH = /(new \w+\(`course-stage`,this\.r\.app\);)this\.r\.app\.root\.addChild\(\w+\),/;

async function main(): Promise<void> {
    const served = await serveTracks();
    const out: Record<string, unknown> = { site: served.site, scene: SCENE, other: OTHER, minPx: MIN_PX, tol: TOL };
    const log: string[] = [];
    let browser: Browser | null = null;
    try {
        // C2's walls first (Node, no GPU): the cached scan's walls
        const walls0 = (await loadScene(SCENE)).collision;
        await takeLock();
        const launched = await launchChrome({ args: ['--window-size=1296,920'] });
        browser = launched.browser;
        out.browser = launched.which;
        counter = await (await browser.newContext()).newPage();

        // ---------------- A
        const ctxA = await fresh(browser);
        const a = await open(ctxA, served.site, SCENE, log);
        const base = await shot(a, 'a-before', 'page A before the course');
        await a.keyboard.press('Shift+KeyG');
        const gen = await until(() => course(a), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        const hA = gen.v;
        check('A Shift+G: source generated', hA?.source === 'generated', { source: hA?.source, problem: hA?.problem, ms: gen.ms });
        check('A gates > 0', (hA?.gates ?? 0) > 0, hA?.gates);
        check('A drawn > 0', (hA?.drawn ?? 0) > 0, hA?.drawn);
        check('A beacon points > 0', (hA?.beaconPoints ?? 0) > 0, hA?.beaconPoints);
        await sleep(1000);
        const on = await shot(a, 'a-on', 'page A with the course');
        check(`A course pixels over the screenshot before >= ${MIN_PX}`, total(on) - total(base) >= MIN_PX, { base, on });
        await a.keyboard.press('Shift+KeyT');
        const hid = await until(() => course(a), (h) => h?.drawn === 0, 10000);
        check('A Shift+T: drawn 0', hid.ok, { drawn: hid.v?.drawn, on: hid.v?.on });
        await sleep(1000);
        const off = await shot(a, 'a-off', 'page A with the course off');
        check(`A course off: pixels back within ${MIN_PX} of before`, total(off) - total(base) < MIN_PX, { off });
        await a.keyboard.press('Escape');
        await a.waitForSelector('.pause-menu', { timeout: 10000 });
        const saveBtn = '[data-action="pause.course.save"]';
        check('A menu: Save for everyone enabled', await a.isEnabled(saveBtn), null);
        await a.click(saveBtn);
        const sv = await until(() => course(a), (h) => !!h?.saved || !!h?.problem, 20000);
        const saved = sv.v?.saved ?? null;
        check('A saved: hook.saved is the server id', typeof saved === 'string' && saved.startsWith(`${SCENE}-`), { saved, problem: sv.v?.problem });
        out.a = { generated: hA, colours: { base, on, off }, saved };
        await ctxA.close();

        // ---------------- B
        const ctxB = await fresh(browser);
        const b = await open(ctxB, served.site, SCENE, log);
        const lb = await until(() => course(b), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
        check('B fresh profile: serverTracks > 0', (lb.v?.serverTracks ?? 0) > 0, lb.v?.serverTracks);
        await b.keyboard.press('Shift+KeyT');
        const ld = await until(() => course(b), (h) => h?.source === 'server' || !!h?.problem, 60000);
        check('B Shift+T: source server', ld.v?.source === 'server', { source: ld.v?.source, problem: ld.v?.problem, ms: ld.ms });
        check("B track id == A's saved id", !!saved && ld.v?.track?.id === saved, { b: ld.v?.track?.id, a: saved });
        check('B drawn > 0', (ld.v?.drawn ?? 0) > 0, ld.v?.drawn);
        out.b = ld.v;
        await ctxB.close();

        // ---------------- C1 another scene
        const ctxC = await fresh(browser);
        const c = await open(ctxC, served.site, OTHER, log);
        const lc = await until(() => course(c), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
        check('C1 another scene: serverTracks 0', lc.v?.serverTracks === 0, lc.v?.serverTracks);
        check('C1 another scene: source none', lc.v?.source === 'none', lc.v?.source);
        await c.keyboard.press('Escape');
        await c.waitForSelector('.pause-menu', { timeout: 10000 });
        check('C1 menu: Load disabled', !(await c.isEnabled('[data-action="pause.course.load"]')), null);
        out.c1 = lc.v;
        await ctxC.close();

        // ---------------- C2 a gate in a wall
        let c2: Record<string, unknown> = {};
        if (saved) {
            const track = (await (await fetch(`${served.api}/api/tracks/${saved}/v1`)).json()) as TrackFile;
            const T = track.transform as [number, number, number, number];
            const walls = flownCollision(walls0, T);
            const k = Math.floor(track.gates.length / 2);
            const g = track.gates[k] as { pos: Vec3 };
            const centre: Vec3 = [g.pos[0] * T[0] + T[1], g.pos[1] * T[0] + T[2], g.pos[2] * T[0] + T[3]];
            const nw = nearestWall(walls, centre);
            if (nw) {
                // 0.2 m behind the wall's surface along the ray (an estimate: deeper than the 0.5 m margin needs, inside the wall)
                const into: Vec3 = [nw.point[0] + nw.dir[0] * 0.2, nw.point[1] + nw.dir[1] * 0.2, nw.point[2] + nw.dir[2] * 0.2];
                const bad = withGateAt(track, k, into, T);
                const nodeOk = checkTrack(track, walls, T, 0.5, false).ok;
                const nodeBad = checkTrack(bad, walls, T, 0.5, false);
                const r = await fetch(`${served.api}/api/tracks`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' }, body: JSON.stringify(bad) });
                const posted = (await r.json()) as { id?: string };
                c2 = { gate: k, wallM: Math.round(nw.distance * 100) / 100, nodeOriginalOk: nodeOk, nodeMovedOk: nodeBad.ok, nodeIssues: nodeBad.issues.slice(0, 2), post: r.status, id: posted.id };
                check('C2 setup: Node proves the original, refuses the moved one; the server stores it (201)', nodeOk && !nodeBad.ok && r.status === 201, c2);
                const ctxD = await fresh(browser);
                const d = await open(ctxD, served.site, SCENE, log);
                const ldd = await until(() => course(d), (h) => (h?.serverTracks ?? -1) >= 0, 20000);
                await d.keyboard.press('Shift+KeyT');
                const rd = await until(() => course(d), (h) => h?.source === 'server' || !!h?.problem, 60000);
                check('C2 the moved course is refused in the page', (rd.v?.problem ?? '').startsWith('refused') && rd.v?.source !== 'server', { serverTracks: ldd.v?.serverTracks, source: rd.v?.source, problem: rd.v?.problem });
                c2.page = rd.v;
                await ctxD.close();
            } else check('C2 setup: a wall near the gate', false, null);
        }
        out.c2 = c2;

        // ---------------- C3 the root never attached
        const ctxE = await fresh(browser);
        let patched = false;
        await ctxE.route(/\/fly\/assets\/main-[^/]+\.js$/, async (route) => {
            const resp = await route.fetch();
            const body = await resp.text();
            const next = body.replace(RE_ATTACH, '$1void 0,');
            patched = next !== body;
            await route.fulfill({ response: resp, body: next });
        });
        const e = await open(ctxE, served.site, SCENE, log);
        const baseE = await shot(e, 'c3-before', 'C3 before the course');
        await e.keyboard.press('Shift+KeyG');
        const ge = await until(() => course(e), (h) => h?.source === 'generated' || !!h?.problem, 90000);
        await sleep(1000);
        const onE = await shot(e, 'c3-on', 'C3 with the course, root not attached');
        const pixelPass = total(onE) - total(baseE) >= MIN_PX;
        check('C3 control: script patched, hook drawn > 0, the pixel check fails', patched && (ge.v?.drawn ?? 0) > 0 && !pixelPass, { patched, drawn: ge.v?.drawn, base: baseE, on: onE });
        out.c3 = { patched, hook: ge.v, colours: { base: baseE, on: onE } };
        await ctxE.close();
    } catch (err) {
        check('the run finished', false, String(err).slice(0, 300));
    } finally {
        await browser?.close().catch(() => undefined);
        letGo();
        await served.stop();
    }
    out.log = log.slice(0, 20);
    const failed = checks.filter((c) => !c.pass).length;
    const file = writeEvidence('tracks-page', { step: 'tracks T3: the courses page probe', pass: failed === 0, checks, shots, ...out });
    console.log(`${checks.length - failed}/${checks.length} checks passed; evidence ${file}`);
    process.exit(failed === 0 ? 0 : 1);
}

void main();
