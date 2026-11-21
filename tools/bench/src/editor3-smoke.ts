// Lane editor3, stage E2 (pass 2): the smoke probe of the edit mode's mouse and camera on a LOCAL release. It opens the editor
// on a course made in this tab (Shift+G, never saved), then: W D E Q move the edit camera, the right button turns it, a click
// on another gate selects it, a drag on the centre box scales the gate, a drag on an arrow moves it, a drag on a ring turns
// it, Ctrl+Z undoes, Esc leaves. It never presses a save, send or create control.
//   SITE   default http://localhost:5800 (a local release server; serve-csp)
//   SCENES default 887f27aa,70b50d42 (the owner's Tunis and Wroclaw scans)
//   OUT    default U:/Temp/gsfpv-train3/editor3/e2s (evidence JSON), screenshots U:/Temp/gsfpv-train3/shots
// Reads window.__gsfpvEditView() (course.ts, view-mouse.ts debug()). Run under the GPU lock:
//   until mkdir C:/dev/.gpu-lock 2>/dev/null; do sleep 20; done; cd tools/bench && npx tsx src/editor3-smoke.ts; rmdir C:/dev/.gpu-lock
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5800').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '887f27aa,70b50d42').split(',').filter(Boolean);
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3/e2s';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const TAG = process.env.TAG ?? 'e2s';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Dbg = {
    handles: boolean;
    layer: boolean;
    stand: { pos: number[]; quat: number[]; scale: number; opening: number; screen: number[] };
    axes: { x: number[]; y: number[]; z: number[] };
    gates: number[][];
    cam: { pos: number[]; speed: number };
    held: string[];
    dragging: boolean;
};
type Ed = { open?: boolean; selected?: number; changed?: boolean; problems?: number; said?: string; view?: { eye: number[]; at: number[] } | null };
type Hook = { gates?: number; on?: boolean; problem?: string | null; editor?: Ed };
const hook = (p: Page): Promise<Hook | null> => p.evaluate(() => ((window as unknown as { __gsfpv?: { course?: Hook } }).__gsfpv?.course ?? null));
const ed = async (p: Page): Promise<Ed> => (await hook(p))?.editor ?? {};
const dbg = (p: Page): Promise<Dbg | null> => p.evaluate(() => {
    const f = (window as unknown as { __gsfpvEditView?: () => unknown }).__gsfpvEditView;
    return (f ? f() : null) as Dbg | null;
});
const status = (p: Page): Promise<string | null> => p.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);
const locked = (p: Page): Promise<boolean> => p.evaluate(() => !!document.pointerLockElement);
const dist = (a: number[] | undefined, b: number[] | undefined): number => (a && b ? Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) : -1);
const r3 = (v: number[] | undefined): number[] => (v ?? []).map((x) => Math.round(x * 100) / 100);

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T; ms: number }> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
        await sleep(400);
        v = await get();
    }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

/** a left drag from (x, y) by (dx, dy) in 10 steps */
async function drag(p: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
    await p.mouse.move(x, y);
    await sleep(120);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 10 });
    await p.mouse.up();
    await sleep(700);
}

async function scene(page: Page, id: string, log: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id };
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    await page.goto(`${SITE}/en/fly/?scene=${id}&nowarn=1`);
    const r = await until(() => status(page), (v) => v === 'ready' || v === 'error', 240000);
    out.ready = { ms: r.ms, status: r.v };
    if (r.v !== 'ready') return out;
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
    } catch {
        /* no Controls screen */
    }
    await sleep(2000);
    await page.keyboard.press('Shift+KeyG');
    // int4 car 3: gen4b's Shift+G opens the Generate dialog first: its Build by mouse (scripts/gen-build.mjs)
    await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 4000 }).then(() => page.locator('[data-testid=gen-dialog] [data-action="gen-build"]').click(), () => undefined);
    const gen = await until(() => hook(page), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 480000);
    out.course = { ok: gen.ok, ms: gen.ms, gates: gen.v?.gates, problem: gen.v?.problem ?? null };
    log.push(`${id}: course ${gen.ok} ${gen.v?.gates} gates in ${gen.ms} ms`);
    if (!gen.ok) return out;
    await sleep(1500);
    await page.keyboard.press('Shift+KeyB');
    const op = await until(() => ed(page), (e) => !!e.open, 30000);
    await sleep(1500);
    const d0 = await dbg(page);
    out.open = { ok: op.ok, selected: op.v.selected, handles: d0?.handles, layer: d0?.layer, stand: d0?.stand, axes: d0?.axes, gatesOnScreen: d0?.gates.filter((g) => (g[2] ?? 0) > 0 && g[0]! >= 0 && g[0]! < vp.width && g[1]! >= 0 && g[1]! < vp.height).length, pointerLock: await locked(page) };
    await page.screenshot({ path: join(SHOTS, `editor3-${TAG}-${id}-open.png`) });
    if (!d0) return out;

    // the camera keys: each held 700 ms
    const keys: Record<string, unknown>[] = [];
    for (const k of ['KeyW', 'KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyQ']) {
        const a = (await dbg(page))?.cam.pos;
        await page.keyboard.down(k);
        await sleep(700);
        await page.keyboard.up(k);
        await sleep(150);
        const b = (await dbg(page))?.cam.pos;
        keys.push({ key: k, moved: Math.round(dist(a, b) * 100) / 100, delta: r3(b?.map((v, i) => v - (a?.[i] ?? 0))) });
    }
    out.keys = keys;
    // the right button turns the view, the eye stays
    const v0 = (await ed(page)).view;
    await page.mouse.move(vp.width * 0.5, vp.height * 0.5);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(vp.width * 0.5 + 120, vp.height * 0.5 + 30, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await sleep(400);
    const v1 = (await ed(page)).view;
    out.rightLook = { eyeMoved: Math.round(dist(v0?.eye, v1?.eye) * 1000) / 1000, atMoved: Math.round(dist(v0?.at, v1?.at) * 100) / 100, pointerLock: await locked(page) };
    // the wheel: speed
    const s0 = (await dbg(page))?.cam.speed;
    await page.mouse.wheel(0, -300);
    await sleep(300);
    out.wheel = { before: s0, after: (await dbg(page))?.cam.speed };

    // back to a known view: Tab then Shift+Tab glide to gate 1 and back to gate 0
    await page.keyboard.press('Tab');
    await sleep(1200);
    await page.keyboard.press('Shift+Tab');
    await sleep(1500);
    let d1 = (await dbg(page))!;
    const sel0 = (await ed(page)).selected ?? -1;
    // a click on another gate on screen, away from the handles
    const pickable = (d: Dbg): { g: number[]; i: number }[] => d.gates
        .map((g, i) => ({ g, i }))
        .filter(({ g, i }) => i !== sel0 && (g[2] ?? 0) > 0 && g[0]! > 20 && g[0]! < vp.width - 20 && g[1]! > 20 && g[1]! < vp.height - 20 && Math.hypot(g[0]! - d.stand.screen[0]!, g[1]! - d.stand.screen[1]!) > 140)
        .sort((a, b) => (a.g[2] ?? 0) - (b.g[2] ?? 0));
    let cand = pickable(d1);
    // integration E: when the framed gate fills the view and no other gate is on screen, the view backs off (S held, the
    // edit view's own fly key) up to four times so another gate comes into the picture
    let backs = 0;
    for (; backs < 4 && !cand[0]; backs++) {
        await page.keyboard.down('KeyS'); await sleep(700); await page.keyboard.up('KeyS');
        await sleep(600);
        d1 = (await dbg(page))!;
        cand = pickable(d1);
    }
    out.backs = backs;
    const sc = d1.stand.screen;
    if (cand[0]) {
        const clicks: Record<string, unknown>[] = [];
        let got = { ok: false, v: {} as Ed, ms: 0 };
        for (const { g, i } of cand.slice(0, 3)) {
            const under = await page.evaluate(([x, y]) => {
                const e = document.elementFromPoint(x!, y!) as HTMLElement | null;
                return e ? `${e.tagName}.${typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : ''}` : 'none';
            }, [g[0]!, g[1]!]);
            await page.mouse.click(g[0]!, g[1]!);
            got = await until(() => ed(page), (e) => e.selected === i, 3000);
            clicks.push({ target: i, at: g, under, selected: got.v.selected, ok: got.ok });
            if (got.ok) break;
        }
        out.click = { clicks, from: sel0, ok: got.ok, pointerLock: await locked(page), said: (got.v.said ?? '').slice(0, 120) };
        await page.keyboard.press('Tab');
        await sleep(300);
        // back to the first selection by key, so the drags below see a gate the camera glided to
        // the gate bar next to the selection: shown, and its Next button takes the next gate
        const bar = await page.evaluate(() => {
            const b = document.querySelector('.ce-gatebar') as HTMLElement | null;
            const r = b?.getBoundingClientRect();
            return b ? { visible: getComputedStyle(b).visibility, box: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null } : null;
        });
        const sb = (await ed(page)).selected;
        let nextOk: boolean | null = null;
        if (bar?.visible === 'visible') {
            await page.click('.ce-gatebar [data-bar="next"]');
            nextOk = (await until(() => ed(page), (e) => e.selected !== sb, 2000)).ok;
        }
        out.bar = { ...bar, nextFrom: sb, nextOk, after: (await ed(page)).selected, focus: await page.evaluate(() => document.activeElement?.tagName ?? 'none') };
        const back = sel0;
        if (back >= 0) {
            for (let n = 0; n < 40 && (await ed(page)).selected !== back; n++) await page.keyboard.press('Shift+Tab');
            await sleep(1500);
        }
    } else out.click = { target: -1, note: 'no other gate on screen away from the handles', gates: d1.gates.length };
    await page.screenshot({ path: join(SHOTS, `editor3-${TAG}-${id}-selected.png`) });

    // int4 car 3: edit4a frames nothing on open, and an asked course's gate 1 (gen4b's dialog) may stand behind the camera
    // (build of 8eac608d, Wroclaw: gate 1 at screen z -4.07, every drag below missed); the pilot's way to it is F (frame
    // the selection, view-mouse.ts), recorded as framedByF
    const offScreen = (d: Dbg | null): boolean => !d || !((d.stand.screen[2] ?? 0) > 0) || d.stand.screen[0]! < 0 || d.stand.screen[0]! >= vp.width || d.stand.screen[1]! < 0 || d.stand.screen[1]! >= vp.height;
    out.framedByF = false;
    if (offScreen(await dbg(page))) {
        out.framedByF = true;
        await page.keyboard.press('KeyF');
        await until(() => dbg(page), (d) => !offScreen(d), 4000);
        await sleep(800);
    }
    // a drag on the centre box: the opening changes
    const d2 = (await dbg(page))!;
    await drag(page, d2.stand.screen[0]!, d2.stand.screen[1]!, 40, -40);
    const d3 = (await dbg(page))!;
    out.scale = { opening: [d2.stand.opening, d3.stand.opening], moved: Math.round(dist(d2.stand.pos, d3.stand.pos) * 100) / 100, changed: (await ed(page)).changed };
    // a drag on an arrow: try the x, then the y axis at a few distances from the centre
    const moves: Record<string, unknown>[] = [];
    for (const ax of ['x', 'y'] as const) {
        let done = false;
        for (const rr of [70, 50, 90, 35]) {
            const a = (await dbg(page))!;
            const dir = a.axes[ax];
            const x = a.stand.screen[0]! + dir[0]! * rr;
            const y = a.stand.screen[1]! + dir[1]! * rr;
            await drag(page, x, y, dir[0]! * 50, dir[1]! * 50);
            const b = (await dbg(page))!;
            const m = dist(a.stand.pos, b.stand.pos);
            moves.push({ axis: ax, r: rr, moved: Math.round(m * 100) / 100 });
            if (m > 0.05) {
                done = true;
                break;
            }
        }
        if (done) break;
    }
    out.move = moves;
    // a drag on a ring: points along the axes further out, dragged across
    const turns: Record<string, unknown>[] = [];
    for (const [ax, across] of [['x', 'y'], ['y', 'x'], ['z', 'x']] as const) {
        let done = false;
        for (const rr of [110, 130, 95, 150]) {
            const a = (await dbg(page))!;
            const dir = a.axes[ax];
            const c = a.axes[across];
            const x = a.stand.screen[0]! + dir[0]! * rr;
            const y = a.stand.screen[1]! + dir[1]! * rr;
            await drag(page, x, y, c[0]! * 50, c[1]! * 50);
            const b = (await dbg(page))!;
            const q = dist(a.stand.quat, b.stand.quat);
            turns.push({ along: ax, r: rr, quatChange: Math.round(q * 1000) / 1000, moved: Math.round(dist(a.stand.pos, b.stand.pos) * 100) / 100 });
            if (q > 0.01) {
                done = true;
                break;
            }
        }
        if (done) break;
    }
    out.turn = turns;
    await page.screenshot({ path: join(SHOTS, `editor3-${TAG}-${id}-dragged.png`) });
    // Ctrl+Z steps back
    const u0 = (await dbg(page))!;
    await page.keyboard.press('Control+KeyZ');
    await sleep(600);
    const u1 = (await dbg(page))!;
    out.undo = { moved: Math.round(dist(u0.stand.pos, u1.stand.pos) * 100) / 100, quat: Math.round(dist(u0.stand.quat, u1.stand.quat) * 1000) / 1000, opening: [u0.stand.opening, u1.stand.opening] };
    // Esc leaves (twice: unsaved changes ask once)
    await page.keyboard.press('Escape');
    await sleep(500);
    if ((await ed(page)).open) await page.keyboard.press('Escape');
    const cl = await until(() => ed(page), (e) => !e.open, 3000);
    out.exit = { closed: cl.ok, view: await dbg(page) };
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, date: new Date().toISOString(), scenes: {} };
    const { browser, which } = await launchChrome({ args: ['--window-size=1296,920'] });
    out.browser = which;
    try {
        for (const id of SCENES) {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const page = await ctx.newPage();
            page.on('pageerror', (e) => log.push(`${id} pageerror: ${e.message}`.slice(0, 300)));
            page.on('console', (m) => { if (m.type() === 'error') log.push(`${id} console: ${m.text()}`.slice(0, 300)); });
            try {
                (out.scenes as Record<string, unknown>)[id] = await scene(page, id, log);
            } catch (e) {
                (out.scenes as Record<string, unknown>)[id] = { error: String(e).slice(0, 400) };
            }
            await ctx.close();
        }
    } finally {
        await browser.close();
    }
    out.log = log;
    const file = join(OUT, `${TAG}.json`);
    writeFileSync(file, JSON.stringify(out, null, 1));
    console.log(`wrote ${file}`);
    for (const l of log.slice(0, 30)) console.log(l);
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
