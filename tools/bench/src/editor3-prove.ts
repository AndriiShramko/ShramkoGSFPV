// Lane editor3, stage E4-prove: the owner's path through the edit mode on a LOCAL release, on his scans (Tunis 887f27aa,
// Wroclaw 70b50d42 with the local stand-in of its walls), 1920x1080, with a fake DJI controller on the Gamepad API (the
// init script of known-controller-probe.mjs). Steps: the controller chosen, a course made in this tab (Shift+G, never
// saved), 5 s measured before the mode; Shift+B; the top bar's Add gate then a click on the scene; a click on another gate;
// Tab; gate 1 selected and the bar's Delete (the added gate becomes the next gate); the X arrow dragged (the gate follows the
// cursor); a ring dragged; the centre box dragged (the opening changes, the gate stays); the bar's Square; W A S D E Q and
// the right button; then the controller arms: the drone's camera, the drone flown forward, the course's next gate read;
// disarm: the edit camera back. Long tasks and frames are counted all the way. It never presses a save, send or create
// control. Env: SITE (default http://localhost:5800), SCENES, OUT (U:/Temp/gsfpv-train3/editor3/e4), PHONE=1 adds an
// 844x390 run on the first scene (open, select, one shot). Run under the GPU lock.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5800').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '887f27aa,70b50d42').split(',').filter(Boolean);
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3/e4';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Dbg = {
    handles: boolean;
    stand: { pos: number[]; quat: number[]; scale: number; opening: number; screen: number[] };
    axes: { x: number[]; y: number[]; z: number[] };
    gates: number[][];
    cam: { pos: number[]; speed: number };
    dragging: boolean;
    mode?: string;
    tool?: string;
};
type Ed = { open?: boolean; selected?: number; changed?: boolean; problems?: number; said?: string; view?: { eye: number[]; at: number[] } | null };
type Hook = { gates?: number; on?: boolean; next?: number; laps?: number; problem?: string | null; editor?: Ed };
type W = {
    __gsfpv?: { status?: string; course?: Hook; controls?: { source?: string; gate?: { armed?: boolean } }; radio?: { wizard?: { state?: { id?: string } } } };
    __gsfpvEditView?: () => unknown;
    __pad?: { set: (a: number[] | null, b?: number | null) => void };
    __perf?: { lt: number[][]; frames: number[] };
};
const hook = (p: Page): Promise<Hook | null> => p.evaluate(() => (window as unknown as W).__gsfpv?.course ?? null);
const ed = async (p: Page): Promise<Ed> => (await hook(p))?.editor ?? {};
const dbg = (p: Page): Promise<Dbg | null> => p.evaluate(() => {
    const f = (window as unknown as W).__gsfpvEditView;
    return (f ? f() : null) as Dbg | null;
});
const dist = (a: number[] | undefined, b: number[] | undefined): number => (a && b ? Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) : -1);
const r2 = (x: number): number => Math.round(x * 100) / 100;
const pad = (p: Page, axes: number[] | null, buttons?: number | null): Promise<void> => p.evaluate(([a, b]) => (window as unknown as W).__pad?.set(a as number[] | null, b as number | null), [axes, buttons ?? null] as const);

/** In the page before load: the fake DJI pad (as known-controller-probe.mjs) and the long-task and frame recorders. */
function install(): void {
    const s = { axes: [0, 0, -1, 0, 0], buttons: 0x50, ts: performance.now(), present: false };
    const w = window as unknown as W;
    w.__pad = { set(a, b) { if (a) s.axes = a.slice(); if (b !== undefined && b !== null) s.buttons = b; s.ts = performance.now(); s.present = true; } };
    const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return ((s.buttons >> i) & 1) === 1; }, get value() { return (s.buttons >> i) & 1; }, touched: false }));
    const padObj = { id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', vibrationActuator: null, get axes() { return s.axes.slice(0, 5); }, buttons, get timestamp() { return s.ts; } };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? padObj : null, null, null, null], configurable: true });
    const perf = { lt: [] as number[][], frames: [] as number[] };
    w.__perf = perf;
    try {
        new PerformanceObserver((l) => { for (const e of l.getEntries()) perf.lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    } catch { /* no long-task timing */ }
    const tick = (t: number): void => { perf.frames.push(t); if (perf.frames.length > 20000) perf.frames.splice(0, 10000); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
}

/** H1: walk out from a screen point along a screen direction in 6 px steps (from `min` px, up to 450) with the page's
 * __gsfpvEditHit until a shape of the shown handles is under it (its axis containing `want`); null when none */
const walk = (p: Page, from: number[], dir: number[], min: number, want: string): Promise<{ r: number; x: number; y: number; hit: string[] } | null> => p.evaluate(([f, d, m, wa]) => {
    const h = (window as unknown as { __gsfpvEditHit?: (x: number, y: number) => string[] | null }).__gsfpvEditHit;
    if (!h) return null;
    const n = Math.hypot(d[0]!, d[1]!) || 1;
    for (let r = m; r <= 450; r += 6) {
        const x = f[0]! + (d[0]! / n) * r;
        const y = f[1]! + (d[1]! / n) * r;
        const hit = h(x, y);
        if (hit && String(hit[1]).includes(wa)) return { r, x, y, hit };
    }
    return null;
}, [from, dir, min, want] as const);

const now = (p: Page): Promise<number> => p.evaluate(() => performance.now());
/** frames per second, the longest frame gap and the longest long task between t0 and t1 (page ms) */
const span = (p: Page, t0: number, t1: number): Promise<{ fps: number; gapMax: number; longMax: number; longs: number }> => p.evaluate(([a, b]) => {
    const pf = (window as unknown as W).__perf!;
    const f = pf.frames.filter((t) => t >= a! && t <= b!);
    let gap = 0;
    for (let i = 1; i < f.length; i++) gap = Math.max(gap, f[i]! - f[i - 1]!);
    const lt = pf.lt.filter((e) => e[0]! >= a! && e[0]! <= b!);
    return { fps: Math.round((f.length / ((b! - a!) / 1000)) * 10) / 10, gapMax: Math.round(gap), longMax: Math.round(Math.max(0, ...lt.map((e) => e[1]!))), longs: lt.length };
}, [t0, t1]);

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T; ms: number }> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
        await sleep(300);
        v = await get();
    }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

async function drag(p: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
    await p.mouse.move(x, y);
    await sleep(150);
    await p.mouse.down();
    await p.mouse.move(x + dx, y + dy, { steps: 12 });
    await sleep(100);
    await p.mouse.up();
    await sleep(700);
}

/** load, choose the controller, make a course */
async function prepare(page: Page, id: string, out: Record<string, unknown>, keyboard = false): Promise<boolean> {
    await page.goto(`${SITE}/en/fly/?scene=${id}&nowarn=1`);
    const r = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 240000);
    out.ready = { ms: r.ms, status: r.v };
    if (r.v !== 'ready') return false;
    await page.waitForSelector('.screen.radio .choice', { timeout: 20000 }).catch(() => undefined);
    if (!keyboard) {
        await pad(page, [0, 0, 0.3, 0, 0], 0x50);
        await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.radio?.wizard?.state?.id ?? null), (v) => v === 'check', 8000);
        await pad(page, [0, 0, -1, 0, 0], 0x50);
        await page.locator('[data-action=wizard-done]').click({ timeout: 8000 }).catch(() => undefined);
    }
    const src = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.source ?? null), (v) => v === 'gamepad', keyboard ? 0 : 15000);
    out.controller = { source: src.v, screenGone: await page.evaluate(() => !document.querySelector('.screen.radio')) };
    if (src.v !== 'gamepad') {
        // the controller was not taken: the keyboard, so the course and the editor can still be walked
        await page.focus('.screen.radio [data-action="radio-keyboard"]').catch(() => undefined);
        await page.keyboard.press('Enter');
    }
    await sleep(1500);
    await page.keyboard.press('Shift+KeyG');
    let gen = await until(() => hook(page), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 120000);
    let retried = false;
    if (!gen.ok) {
        // one more Shift+G (a press lost to a screen that still had the focus), then the same wait
        retried = true;
        await page.mouse.click(5, 300);
        await page.keyboard.press('Shift+KeyG');
        gen = await until(() => hook(page), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 120000);
    }
    out.course = { ok: gen.ok, ms: gen.ms, gates: gen.v?.gates, retried };
    if (!gen.ok) {
        out.courseFail = await page.evaluate(() => ({
            focus: document.activeElement?.tagName + '.' + String(document.activeElement?.className ?? ''),
            text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 700),
        }));
    }
    return gen.ok;
}

const onScreen = (g: number[], w: number, h: number): boolean => (g[2] ?? 0) > 0 && g[0]! > 30 && g[0]! < w - 30 && g[1]! > 80 && g[1]! < h - 30;

async function scene(page: Page, id: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id };
    const vp = page.viewportSize()!;
    if (!(await prepare(page, id, out))) return out;
    await sleep(2000);
    // before the mode: 5 s as the pilot sees it
    let t0 = await now(page);
    await sleep(5000);
    out.before = await span(page, t0, await now(page));
    const tPath = await now(page);
    await page.keyboard.press('Shift+KeyB');
    const op = await until(() => ed(page), (e) => !!e.open, 30000);
    await sleep(1500);
    t0 = await now(page);
    await sleep(5000);
    out.idleInMode = await span(page, t0, await now(page));
    const d0 = (await dbg(page))!;
    out.open = { ok: op.ok, selected: op.v.selected, mode: d0?.mode, handles: d0?.handles, gates: (await hook(page))?.gates };

    // Add gate: the top bar's button, then a click on the scene in the middle of the view
    const nBefore = (await hook(page))?.gates ?? 0;
    const selBefore = (await ed(page)).selected ?? 0;
    await page.click('[data-top="add"]', { timeout: 5000 }).catch(() => undefined);
    await sleep(300);
    await page.mouse.click(vp.width / 2, vp.height * 0.45);
    const add = await until(() => hook(page), (h) => (h?.gates ?? 0) === nBefore + 1, 3000);
    out.add = { ok: add.ok, gates: [nBefore, add.v?.gates], selectedBefore: selBefore, selected: add.v?.editor?.selected, said: (add.v?.editor?.said ?? '').slice(0, 100) };
    const added = add.v?.editor?.selected ?? -1;
    await sleep(1200);

    // a click on another gate on screen, then Tab
    const d1 = (await dbg(page))!;
    const sel1 = (await ed(page)).selected ?? -1;
    const cand = d1.gates.map((g, i) => ({ g, i })).filter(({ g, i }) => i !== sel1 && onScreen(g, vp.width, vp.height) && Math.hypot(g[0]! - d1.stand.screen[0]!, g[1]! - d1.stand.screen[1]!) > 160).sort((a, b) => a.g[2]! - b.g[2]!);
    const clicks: unknown[] = [];
    for (const { g, i } of cand.slice(0, 3)) {
        await page.mouse.click(g[0]!, g[1]!);
        const c = await until(() => ed(page), (e) => e.selected === i, 2500);
        clicks.push({ target: i, ok: c.ok, selected: c.v.selected });
        if (c.ok) break;
    }
    out.click = { from: sel1, clicks };
    const sel2 = (await ed(page)).selected ?? -1;
    await page.keyboard.press('Tab');
    const tab = await until(() => ed(page), (e) => e.selected !== sel2, 2000);
    out.tab = { from: sel2, to: tab.v.selected, ok: tab.ok, focus: await page.evaluate(() => document.activeElement?.tagName ?? 'none') };

    // the gate just before the added one, deleted with the bar: the added gate moves up one place
    const del = added - 1;
    for (let n = 0; n < 60 && (await ed(page)).selected !== del; n++) await page.keyboard.press('Shift+Tab');
    await sleep(1500);
    const nDel = (await hook(page))?.gates ?? 0;
    await page.click('.ce-gatebar [data-bar="delete"]', { timeout: 5000, force: true }).catch((e) => { out.deleteClickError = String(e).slice(0, 120); });
    const dl = await until(() => hook(page), (h) => (h?.gates ?? 0) === nDel - 1, 3000);
    await sleep(600);
    const dd = await dbg(page);
    out.delete = {
        index: del, ok: dl.ok, gates: [nDel, dl.v?.gates], selected: dl.v?.editor?.selected,
        handles: dd?.handles, dragging: dd?.dragging, stand: dd?.stand.screen, gate: dd?.gates[dl.v?.editor?.selected ?? 0],
        bar: await page.evaluate(() => { const b = document.querySelector('.ce-gatebar') as HTMLElement | null; return b ? `${getComputedStyle(b).display} ${b.style.left} ${b.style.top}` : 'none'; })
    };
    // select the added gate (now at `del`)
    for (let n = 0; n < 60 && (await ed(page)).selected !== del; n++) await page.keyboard.press('Shift+Tab');
    await sleep(1600);
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-1920.png' : 'editor3-select-1920.png') });

    const tDrag0 = await now(page);
    // the ring, the centre box and the kind on the next gate (Tab), so the gate flown through later is only moved
    await page.keyboard.press('Tab');
    await until(() => ed(page), (e) => e.selected === del + 1, 2000);
    await sleep(800);
    // H1: one set of handles at a time. Turn: the gate bar's Turn button, then a ring found by walking out from the centre
    // with __gsfpvEditHit (the radius is the one the gizmo draws), dragged along its tangent
    await page.click('.ce-gatebar [data-bar="turn"]', { timeout: 5000 }).catch((e) => { out.turnClickError = String(e).slice(0, 120); });
    await sleep(500);
    out.turnTool = (await dbg(page))?.tool;
    const turns: unknown[] = [];
    for (const dir of [[1, 0], [0, -1], [0.71, -0.71], [-1, 0], [0, 1]]) {
        const a = (await dbg(page))!;
        const w = await walk(page, a.stand.screen, dir, 40, '');
        if (!w) { turns.push({ dir, hit: null }); continue; }
        await drag(page, w.x, w.y, -dir[1]! * 60, dir[0]! * 60);
        const b = (await dbg(page))!;
        const q = dist(a.stand.quat, b.stand.quat);
        turns.push({ dir, r: w.r, hit: w.hit, quatChange: Math.round(q * 1000) / 1000, movedM: r2(dist(a.stand.pos, b.stand.pos)), opening: [r2(a.stand.opening), r2(b.stand.opening)] });
        if (q > 0.01) break;
    }
    out.turn = turns;
    // Size: the key T, then the centre box (walked out from the centre in case the box is not under it)
    await page.keyboard.press('KeyT');
    await sleep(400);
    out.sizeTool = (await dbg(page))?.tool;
    const sc: unknown[] = [];
    for (const [dx, dy] of [[60, -60], [-60, 60], [90, 0]]) {
        const a = (await dbg(page))!;
        const w = await walk(page, a.stand.screen, [0.71, -0.71], 0, '');
        if (!w) { sc.push({ drag: [dx, dy], hit: null }); continue; }
        await drag(page, w.x, w.y, dx!, dy!);
        const b = (await dbg(page))!;
        sc.push({ drag: [dx, dy], r: w.r, hit: w.hit, opening: [r2(a.stand.opening), r2(b.stand.opening)], movedM: r2(dist(a.stand.pos, b.stand.pos)), quatChange: r2(dist(a.stand.quat, b.stand.quat)) });
        if (Math.abs(a.stand.opening - b.stand.opening) > 0.01) break;
    }
    out.scale = sc;
    // its kind: the bar's square
    const k0 = (await ed(page)).said;
    // a kind it does not have yet (the window's gate line names its kind)
    const line0 = await page.evaluate(() => document.querySelector('.course-editor .ce-gate')?.textContent ?? '');
    const kindTo = /square/.test(line0) ? 'ring' : 'square';
    out.kindTo = kindTo;
    await page.click(`.ce-gatebar [data-bar="${kindTo}"]`, { timeout: 5000 }).catch((e) => { out.kindClickError = String(e).slice(0, 120); });
    await sleep(500);
    out.kind = { saidBefore: (k0 ?? '').slice(0, 80), said: ((await ed(page)).said ?? '').slice(0, 80), changed: (await ed(page)).changed };
    // back to gate 1 (Shift+Tab) and its X arrow
    await page.keyboard.press('Shift+Tab');
    await until(() => ed(page), (e) => e.selected === del, 2000);
    await sleep(800);
    // the X arrow: another gate selected sets Move (toolAfter); the arrow found along the gate's X axis
    out.moveTool = (await dbg(page))?.tool;
    const moves: unknown[] = [];
    for (let k = 0; k < 2; k++) {
        const a = (await dbg(page))!;
        const dir = a.axes.x;
        const w = await walk(page, a.stand.screen, dir, 12, 'x');
        if (!w) { moves.push({ hit: null }); continue; }
        await drag(page, w.x, w.y, dir[0]! * 80, dir[1]! * 80);
        const b = (await dbg(page))!;
        const m = dist(a.stand.pos, b.stand.pos);
        const px = dist(a.stand.screen.slice(0, 2), b.stand.screen.slice(0, 2));
        moves.push({ r: w.r, hit: w.hit, movedM: r2(m), screenPx: Math.round(px), dragPx: 80, opening: [a.stand.opening, b.stand.opening] });
        if (m > 0.05) break;
    }
    out.moveX = moves;
    out.drags = await span(page, tDrag0, await now(page));
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-drag-1920.png' : 'editor3-drag-1920.png') });

    // the camera: keys and the right button
    const keys: unknown[] = [];
    for (const k of ['KeyW', 'KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyQ']) {
        const a = (await dbg(page))?.cam.pos;
        await page.keyboard.down(k);
        await sleep(600);
        await page.keyboard.up(k);
        await sleep(150);
        keys.push({ key: k, movedM: r2(dist(a, (await dbg(page))?.cam.pos)) });
    }
    out.keys = keys;
    const v0 = (await ed(page)).view;
    await page.mouse.move(vp.width * 0.3, vp.height * 0.6);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(vp.width * 0.3 + 140, vp.height * 0.6 + 30, { steps: 10 });
    await page.mouse.up({ button: 'right' });
    await sleep(400);
    const v1 = (await ed(page)).view;
    out.look = { eyeMovedM: r2(dist(v0?.eye, v1?.eye)), atMovedM: r2(dist(v0?.at, v1?.at)) };

    // fly with the controller: arm (throttle down, start/stop), forward, read the course; then disarm
    const eyeBefore = (await ed(page)).view?.eye;
    const tFly = await now(page);
    const nextBefore = (await hook(page))?.next;
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    const arm = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.gate?.armed ?? null), (v) => v === true, 3000);
    await sleep(400);
    const dArm = await dbg(page);
    const flight: unknown[] = [];
    // steer at the moved gate (gate `del`) by where it is on the drone's camera: yaw keeps it in the middle, throttle at
    // its height, pitch forward; the yaw's and the pitch's signs are found by trying (the probe does not know the pad's)
    const W = vp.width;
    const H = vp.height;
    const clamp = (x: number): number => Math.max(-0.8, Math.min(0.8, x));
    const ga = (await dbg(page))?.gates[del];
    await pad(page, [0, 0, 0.15, 0.4, 0], null);
    await sleep(400);
    const gb = (await dbg(page))?.gates[del];
    const yawSign = ga && gb && ga[2]! > 0 && gb[2]! > 0 && gb[0] !== ga[0] ? (gb[0]! > ga[0]! ? 1 : -1) : 1;
    let pitch = -0.35;
    let z4 = -1;
    for (let i = 0; i < 60; i++) {
        const d = await dbg(page);
        const h = await hook(page);
        const g = d?.gates[del];
        flight.push([i, h?.next, d?.mode, g ? g.map((v) => Math.round(v * 10) / 10) : null]);
        if (h?.next !== nextBefore || d?.mode !== 'fly') break;
        let yaw = 0.5;
        let thr = 0.1;
        let pit = 0;
        if (g && g[2]! > 0) {
            const ex = (g[0]! - W / 2) / (W / 2);
            const ey = (g[1]! - H / 2) / (H / 2);
            yaw = clamp(-yawSign * 0.9 * ex);
            thr = clamp(-0.7 * ey);
            pit = Math.abs(ex) > 0.35 ? 0 : pitch;
            if (i === 4) z4 = g[2]!;
            if (i === 12 && z4 > 0 && g[2]! > z4 + 0.3) pitch = -pitch;
        }
        await pad(page, [0, pit, thr, yaw, 0], null);
        await sleep(250);
    }
    out.flyYawSign = yawSign;
    out.flyPitch = pitch;
    await page.screenshot({ path: join(SHOTS, `editor3-${id}-flying.png`) });
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    const dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    await sleep(500);
    out.fly = {
        armed: arm.v, modeArmed: dArm?.mode, handlesArmed: dArm?.handles, nextBefore, flight,
        nextAfter: (await hook(page))?.next, laps: (await hook(page))?.laps,
        modeAfter: dis.v?.mode, editEyeBackM: r2(dist(eyeBefore, (await ed(page)).view?.eye)),
        topBarButtonsHidden: await page.evaluate(() => getComputedStyle(document.querySelector('[data-top="add"]') ?? document.body).display)
    };
    out.flySpan = await span(page, tFly, await now(page));
    out.path = await span(page, tPath, await now(page));
    // ED-4: Add gate, then a click low on the view (the floor); the new gate stands over the floor and is not red
    const fp0 = (await ed(page)).problems ?? 0;
    const nf = (await hook(page))?.gates ?? 0;
    await page.click('[data-top="add"]', { timeout: 5000 }).catch((e) => { out.floorAddClickError = String(e).slice(0, 120); });
    await sleep(300);
    await page.mouse.click(vp.width / 2, vp.height * 0.85);
    const fa = await until(() => hook(page), (h) => (h?.gates ?? 0) === nf + 1, 3000);
    await sleep(4000);
    const fd = await dbg(page);
    out.floorAdd = {
        ok: fa.ok, gates: [nf, (await hook(page))?.gates], problems: [fp0, (await ed(page)).problems],
        stand: fd?.stand.screen.map((v) => Math.round(v)), standPosY: fd ? r2(fd.stand.pos[1]!) : null, opening: fd ? r2(fd.stand.opening) : null,
        said: ((await ed(page)).said ?? '').slice(0, 120),
        line: await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? '')
    };
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-floor-add-1920.png' : 'editor3-floor-add-1920.png') });
    // leave without saving
    await page.keyboard.press('Escape');
    await sleep(500);
    if ((await ed(page)).open) await page.keyboard.press('Escape');
    out.exit = { closed: (await until(() => ed(page), (e) => !e.open, 3000)).ok };
    return out;
}

async function phone(page: Page, id: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id, viewport: page.viewportSize() };
    if (!(await prepare(page, id, out))) return out;
    await sleep(1500);
    await page.keyboard.press('Shift+KeyB');
    out.open = (await until(() => ed(page), (e) => !!e.open, 30000)).ok;
    await page.keyboard.press('Tab');
    await sleep(1600);
    const bars = await page.evaluate(() => [...document.querySelectorAll('.ce-gatebar, .ce-topbar, [data-top="add"]')].map((e) => { const r = e.getBoundingClientRect(); return [e.className || e.getAttribute('data-top'), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }));
    out.bars = bars;
    await page.screenshot({ path: join(SHOTS, 'editor3-844.png') });
    return out;
}

/** H1 with the keyboard as the chosen input: ED-2 (W in the mode does not arm, Space arms and disarms) and a full course
 * (Add gate says in words what to delete, no number) */
async function keyboardRun(page: Page, id: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id };
    if (!(await prepare(page, id, out, true))) return out;
    await sleep(1500);
    await page.keyboard.press('Shift+KeyB');
    out.open = (await until(() => ed(page), (e) => !!e.open, 30000)).ok;
    await sleep(1200);
    const armed = (): Promise<boolean | null> => page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.gate?.armed ?? null);
    const c0 = (await dbg(page))?.cam.pos;
    await page.keyboard.down('KeyW');
    await sleep(600);
    await page.keyboard.up('KeyW');
    await sleep(300);
    out.afterW = { armed: await armed(), mode: (await dbg(page))?.mode, camMovedM: r2(dist(c0, (await dbg(page))?.cam.pos)) };
    await page.keyboard.press('Space');
    const f1 = await until(() => dbg(page), (d) => d?.mode === 'fly', 3000);
    out.space1 = { mode: f1.v?.mode, ms: f1.ms, armed: await armed() };
    await sleep(800);
    await page.keyboard.press('Space');
    const f2 = await until(() => dbg(page), (d) => d?.mode === 'edit', 4000);
    out.space2 = { mode: f2.v?.mode, ms: f2.ms, armed: await armed() };
    await sleep(800);
    // fill the course with Insert (a copy after the selected gate) until it stops growing
    let last = (await hook(page))?.gates ?? 0;
    let still = 0;
    for (let i = 0; i < 90 && still < 3; i++) {
        await page.keyboard.press('Insert');
        await sleep(120);
        const n = (await hook(page))?.gates ?? 0;
        still = n === last ? still + 1 : 0;
        last = n;
    }
    out.fullGates = last;
    await page.click('[data-top="add"]', { timeout: 5000 }).catch((e) => { out.fullAddClickError = String(e).slice(0, 120); });
    await sleep(500);
    const line = await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? '');
    const said = (await ed(page)).said ?? '';
    await page.mouse.click(page.viewportSize()!.width / 2, page.viewportSize()!.height * 0.45);
    await sleep(600);
    out.full = { line, said, digitInLine: /\d/.test(line), gatesAfterClick: (await hook(page))?.gates };
    await page.screenshot({ path: join(SHOTS, 'editor3-full-1920.png') });
    await page.keyboard.press('Escape');
    await sleep(400);
    if ((await ed(page)).open) await page.keyboard.press('Escape');
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, date: new Date().toISOString(), scenes: {} };
    const { browser, which } = await launchChrome({ args: ['--window-size=1936,1200'] });
    out.browser = which;
    const run = async (name: string, vp: { width: number; height: number }, f: (p: Page) => Promise<Record<string, unknown>>): Promise<void> => {
        const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        // as text: tsx wraps named functions in __name(), which the page does not have
        await ctx.addInitScript({ content: `var __name = (f) => f; (${install.toString()})();` });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`.slice(0, 300)));
        page.on('console', (m) => { if (m.type() === 'error') log.push(`${name} console: ${m.text()}`.slice(0, 200)); });
        page.on('response', (r) => { if (r.status() >= 400) log.push(`${name} http ${r.status()} ${r.url()}`.slice(0, 200)); });
        try {
            (out.scenes as Record<string, unknown>)[name] = await f(page);
        } catch (e) {
            (out.scenes as Record<string, unknown>)[name] = { error: String(e).slice(0, 400) };
        }
        await ctx.close();
        writeFileSync(join(OUT, 'e4.json'), JSON.stringify({ ...out, log }, null, 1));
    };
    try {
        for (const id of SCENES) await run(id, { width: 1920, height: 1080 }, (p) => scene(p, id));
        if (process.env.KBD !== '0') await run(`kbd-${SCENES[0]}`, { width: 1920, height: 1080 }, (p) => keyboardRun(p, SCENES[0]!));
        if (process.env.PHONE === '1') await run(`phone-${SCENES[0]}`, { width: 844, height: 390 }, (p) => phone(p, SCENES[0]!));
    } finally {
        await browser.close();
    }
    console.log(`wrote ${join(OUT, 'e4.json')}`);
    for (const l of log.slice(0, 20)) console.log(l);
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
