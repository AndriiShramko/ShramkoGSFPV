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
    // G1: after every pointerup, the gate bar's hide flag and drawn visibility, the shown handle set and each set's
    // [enabled, nodes, selectedAxis, hoverAxis]: right at the up, after the task, and two frames later
    const ups: unknown[] = [];
    (window as unknown as { __ups: unknown[] }).__ups = ups;
    const snap = (when: string, n: number, target: string): void => {
        const f = (window as unknown as W).__gsfpvEditView;
        const d = (f ? f() : null) as { bar?: unknown; tool?: string; dragging?: boolean; sets?: unknown; mode?: string } | null;
        if (d) ups.push({ n, when, target, t: Math.round(performance.now()), bar: d.bar, tool: d.tool, dragging: d.dragging, mode: d.mode, sets: d.sets });
    };
    let count = 0;
    window.addEventListener('pointerup', (e) => {
        const n = ++count;
        const el = e.target as HTMLElement | null;
        const target = el ? (el.closest('[data-bar]') ? `bar:${(el.closest('[data-bar]') as HTMLElement).dataset.bar}` : el.tagName) : 'none';
        snap('up', n, target);
        setTimeout(() => snap('task', n, target), 0);
        requestAnimationFrame(() => requestAnimationFrame(() => snap('frame2', n, target)));
    });
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
    // I3 pass 2: the middle of the view is the framed gate 1 itself (D1), so a click there took the gate (I3 pass 1: 'Moved',
    // 24 -> 24); the pilot clicks the floor: low on the view, then a second point left of it if the first gave no gate
    await page.click('[data-top="add"]', { timeout: 5000 }).catch(() => undefined);
    await sleep(300);
    const addPts: number[][] = [[0.5, 0.85], [0.3, 0.8], [0.7, 0.8]];
    let add = { ok: false, v: await hook(page), ms: 0 };
    const addTries: unknown[] = [];
    for (const [fx, fy] of addPts) {
        await page.mouse.click(vp.width * fx!, vp.height * fy!);
        add = await until(() => hook(page), (h) => (h?.gates ?? 0) === nBefore + 1, 3000);
        addTries.push({ at: [fx, fy], ok: add.ok, said: (add.v?.editor?.said ?? '').slice(0, 80) });
        if (add.ok) break;
        if (!/click the place/i.test(add.v?.editor?.said ?? '')) { await page.click('[data-top="add"]', { timeout: 3000 }).catch(() => undefined); await sleep(300); }
    }
    out.add = { ok: add.ok, gates: [nBefore, add.v?.gates], selectedBefore: selBefore, selected: add.v?.editor?.selected, said: (add.v?.editor?.said ?? '').slice(0, 100), tries: addTries };
    const added = add.ok ? (add.v?.editor?.selected ?? 1) : 1;
    await sleep(1200);

    // a click on another gate on screen, then Tab
    let d1 = (await dbg(page))!;
    const sel1 = (await ed(page)).selected ?? -1;
    const pick2 = (d: Dbg): { g: number[]; i: number }[] => d.gates.map((g, i) => ({ g, i })).filter(({ g, i }) => i !== sel1 && onScreen(g, vp.width, vp.height) && Math.hypot(g[0]! - d.stand.screen[0]!, g[1]! - d.stand.screen[1]!) > 160).sort((a, b) => a.g[2]! - b.g[2]!);
    let cand = pick2(d1);
    // H3 pass 2 (left e): no second gate on screen: the view backs off (S held) and climbs (E) until one shows, at most 4 times
    let backs = 0;
    for (; backs < 4 && !cand.length; backs++) {
        await page.keyboard.down('KeyS'); await page.keyboard.down('KeyE'); await sleep(700);
        await page.keyboard.up('KeyS'); await page.keyboard.up('KeyE'); await sleep(400);
        d1 = (await dbg(page))!;
        cand = pick2(d1);
    }
    const clicks: unknown[] = [{ backs, cand: cand.length }];
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
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-select-1920.png' : 'editor3-select-1920.png') });

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
    // H3 pass 2 (left d): every ring is tried (no stop at the first that turns), each with a 60 px and then a 140 px drag
    // along its tangent, and the angle each drag gave is recorded (degrees from the quaternion change)
    const seenAxis = new Set<string>();
    for (const dir of [[1, 0], [0, -1], [0.71, -0.71], [-1, 0], [0, 1], [-0.71, 0.71]]) {
        const a0 = (await dbg(page))!;
        const w = await walk(page, a0.stand.screen, dir, 40, '');
        if (!w) { turns.push({ dir, hit: null }); continue; }
        const axis = String(w.hit[1]);
        if (seenAxis.has(axis)) continue;
        seenAxis.add(axis);
        const per: unknown[] = [];
        for (const len of [60, 140]) {
            const a = (await dbg(page))!;
            const w2 = (await walk(page, a.stand.screen, dir, 40, axis)) ?? w;
            await drag(page, w2.x, w2.y, -dir[1]! * len, dir[0]! * len);
            const b = (await dbg(page))!;
            const dot = Math.min(1, Math.abs(a.stand.quat.reduce((s, v, i) => s + v * (b.stand.quat[i] ?? 0), 0)));
            per.push({ len, deg: Math.round((2 * Math.acos(dot) * 180) / Math.PI), movedM: r2(dist(a.stand.pos, b.stand.pos)), dragging: b.dragging });
        }
        turns.push({ dir, axis, r: w.r, per, turned: per.some((p) => (p as { deg: number }).deg > 0) });
    }
    out.turn = turns;
    if (id !== '70b50d42') await page.screenshot({ path: join(SHOTS, 'editor3-turn-1920.png') });
    out.turnUndo = await undoRedo(page);
    // Size: the gate bar's Size button (the mouse road; T is its key), then the centre box
    await page.click('.ce-gatebar [data-bar="size"]', { timeout: 3000 }).catch(async () => { await page.keyboard.press('KeyT'); });
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
    if (id !== '70b50d42') await page.screenshot({ path: join(SHOTS, 'editor3-size-1920.png') });
    out.scaleUndo = await undoRedo(page);
    // H2: every kind once from the gate bar, clicked with the mouse on the button's middle (as a person), then undo/redo
    const kinds: unknown[] = [];
    for (const k of ['square', 'dive', 'cube', 'ring']) {
        const box = await page.locator(`.ce-gatebar [data-bar="${k}"]`).boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(600);
        kinds.push({ kind: k, box: !!box, line: (await sample(page)).line, said: ((await ed(page)).said ?? '').slice(0, 70) });
    }
    out.kinds = kinds;
    out.kindUndo = await undoRedo(page);
    // the bar's Next and Previous
    const s0 = (await ed(page)).selected;
    await clickBar(page, 'next');
    const s1 = (await ed(page)).selected;
    await clickBar(page, 'prev');
    const s2 = (await ed(page)).selected;
    out.barNextPrev = { from: s0, next: s1, prev: s2, handles: (await dbg(page))?.handles, tool: (await dbg(page))?.tool };
    // Duplicate: one more gate, selected, with its handles; undo and redo
    const nDup = (await hook(page))?.gates ?? 0;
    await clickBar(page, 'duplicate');
    const dupD = await dbg(page);
    out.duplicate = { gates: [nDup, (await hook(page))?.gates], selected: (await ed(page)).selected, handles: dupD?.handles, bar: await barShown(page), ur: await undoRedo(page) };
    // Delete the copy with the bar: the next gate selected with its handles and its bar (ED-1); undo and redo
    const nDel2 = (await hook(page))?.gates ?? 0;
    await clickBar(page, 'delete');
    const delD = await dbg(page);
    out.delete2 = { gates: [nDel2, (await hook(page))?.gates], selected: (await ed(page)).selected, handles: delD?.handles, tool: delD?.tool, bar: await barShown(page), ur: await undoRedo(page) };
    // Ctrl+Z took the copy back, Ctrl+Y deleted it again: the course is as before the duplicate
    // back to gate 1 (Shift+Tab) and its X arrow
    for (let n = 0; n < 60 && (await ed(page)).selected !== del; n++) { await page.keyboard.press(((await ed(page)).selected ?? 0) < del ? 'Tab' : 'Shift+Tab'); await sleep(150); }
    out.shiftTabBack = (await ed(page)).selected === del;
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
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-1920.png' : 'editor3-move-1920.png') });
    out.moveUndo = await undoRedo(page);
    const movedPos = (await dbg(page))?.stand.pos;

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
    // I3 pass 2: F frames the selected gate again after the keys and the right button moved the view (D1): the eye moves,
    // looks at the gate's centre, stands at a distance of a few gate sizes; viewShare = the gate's size over the view's height
    {
        const fa = (await dbg(page))!;
        await page.keyboard.press('KeyF');
        await sleep(900);
        const fb = (await dbg(page))!;
        const v2 = (await ed(page)).view;
        const eyeGate = dist(v2?.eye, fb.stand.pos);
        const fovDeg = await page.evaluate(() => (window as unknown as { __gsfpvEditView?: () => { fov?: number } }).__gsfpvEditView?.()?.fov ?? null);
        const fov = (fovDeg ?? 60) * Math.PI / 180;
        out.frameF = {
            eyeMovedM: r2(dist(v1?.eye, v2?.eye)), atToGateM: r2(dist(v2?.at, fb.stand.pos)), eyeGateM: r2(eyeGate), opening: r2(fb.stand.opening),
            fovDeg, viewShare: r2(fb.stand.opening / (2 * eyeGate * Math.tan(fov / 2))), screenBefore: fa.stand.screen.map(Math.round), screenAfter: fb.stand.screen.map(Math.round)
        };
        await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-f-1920.png' : 'editor3-f-1920.png') });
    }

    // G3 pass 2, the test flight. First the keyboard: Space arms in the mode, Space again is the edit view back where it was
    const eyeBefore = (await ed(page)).view?.eye;
    const tFly = await now(page);
    const nextBefore = (await hook(page))?.next;
    const armedNow = (): Promise<boolean | null> => page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.gate?.armed ?? null);
    await page.keyboard.press('Space');
    const k1 = await until(() => dbg(page), (d) => d?.mode === 'fly', 3000);
    const k1Armed = await armedNow();
    await sleep(700);
    await page.keyboard.press('Space');
    const k2 = await until(() => dbg(page), (d) => d?.mode === 'edit', 4000);
    await sleep(400);
    out.kbdFly = { space1: { mode: k1.v?.mode, ms: k1.ms, armed: k1Armed }, space2: { mode: k2.v?.mode, ms: k2.ms, armed: await armedNow() }, eyeBackM: r2(dist(eyeBefore, (await ed(page)).view?.eye)) };
    if ((await dbg(page))?.mode !== 'edit') {
        await pad(page, [0, 0, -1, 0, 0], 0x50);
        await until(() => dbg(page), (d) => d?.mode === 'edit', 4000);
    }
    // then the pad: gate 1 (the moved gate `del`) made bigger with + so the probe's rough steering passes it (undone after)
    // I3 pass 2: gate 1 (index 0) is the one flown through: Shift+Tab back to it first (pass 1 put gate 20 ahead)
    const fi = 0;
    for (let n = 0; n < 40 && (await ed(page)).selected !== fi; n++) { await page.keyboard.press('Shift+Tab'); await sleep(120); }
    const selFly = (await ed(page)).selected;
    const open0 = (await dbg(page))?.stand.opening ?? 0;
    // I3 (the stage's words): gate 1 placed 6 m ahead of the drone, 1 m up, opening 2.5 m, as ONE drag (one Ctrl+Z after);
    // a build without the hook falls back to growing the opening with +
    let grow = 0;
    const putAhead = await page.evaluate(() => (window as unknown as { __gsfpvEditPutAhead?: (m: number, up: number, open: number) => unknown }).__gsfpvEditPutAhead?.(6, 1, 2.5) ?? null);
    if (putAhead !== null) { grow = 1; out.putAhead = putAhead; }
    while (putAhead === null && grow < 30 && ((await dbg(page))?.stand.opening ?? 0) < 3.5) { await page.keyboard.press('Equal'); grow++; await sleep(60); }
    await sleep(400);
    const openFly = (await dbg(page))?.stand.opening ?? 0;
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    const arm = await until(armedNow, (v) => v === true, 2000);
    // the sticks out of the centre start a camera drone's flight (it needs no arming); the yaw's sign is read on the
    // DRONE's camera (pass 2's run C read the first point on the edit camera, startZ 2.3, and turned the wrong way)
    await pad(page, [0, 0, 0.1, 0, 0], null);
    const fm = await until(() => dbg(page), (d) => d?.mode === 'fly', 3000);
    await pad(page, [0, 0, 0, 0, 0], null);
    await sleep(300);
    const ga = (await dbg(page))?.gates[fi];
    await pad(page, [0, 0, 0, 0.25, 0], null);
    await sleep(300);
    const gb = (await dbg(page))?.gates[fi];
    await pad(page, [0, 0, 0, -0.25, 0], null);
    await sleep(300);
    await pad(page, [0, 0, 0, 0, 0], null);
    const dArm = fm.v;
    const startZ = ga ? r2(ga[2]!) : null;
    const yawSign = ga && gb && ga[2]! > 0 && gb[2]! > 0 && gb[0] !== ga[0] ? (gb[0]! > ga[0]! ? 1 : -1) : 1;
    const flight: unknown[] = [];
    const W = vp.width;
    const H = vp.height;
    const clamp = (x: number, m = 0.8): number => Math.max(-m, Math.min(m, x));
    // the camera looks up a little, so a gate level with the drone stands below the middle: aim it at EY_AIM (an estimate)
    const EY_AIM = 0.15;
    let pitch = -0.2;
    let zPitch = -1;
    let pitched = 0;
    let shot = false;
    for (let i = 0; i < 150; i++) {
        const d = await dbg(page);
        const h = await hook(page);
        const g = d?.gates[fi];
        flight.push([i, h?.next, d?.mode, g ? g.map((v) => Math.round(v * 10) / 10) : null]);
        if (h?.next !== nextBefore || (i > 0 && d?.mode !== 'fly')) break;
        let yaw = 0.25;
        let thr = 0;
        let pit = 0;
        if (g && g[2]! > 0) {
            const ex = (g[0]! - W / 2) / (W / 2);
            const ey = (g[1]! - H / 2) / (H / 2);
            const near = g[2]! < 3;
            yaw = clamp(-yawSign * 0.7 * ex, 0.35);
            thr = near ? 0 : clamp(-0.6 * (ey - EY_AIM), 0.5);
            const aligned = Math.abs(ex) < 0.15 && Math.abs(ey - EY_AIM) < 0.3;
            pit = near ? pitch * 0.8 : aligned ? pitch : 0;
            if (pit !== 0) {
                if (pitched === 0) zPitch = g[2]!;
                pitched++;
                // the pitch's sign is found by trying: 8 pitched steps that took the gate further away flip it
                if (pitched === 8 && g[2]! > zPitch + 0.3) pitch = -pitch;
            }
            if (!shot && g[2]! < 6 && id !== '70b50d42') { shot = true; await page.screenshot({ path: join(SHOTS, 'editor3-flying-1920.png') }); }
        }
        await pad(page, [0, pit, thr, yaw, 0], null);
        await sleep(200);
    }
    out.flyYawSign = yawSign;
    out.flyPitch = pitch;
    if (!shot && id !== '70b50d42') await page.screenshot({ path: join(SHOTS, 'editor3-flying-1920.png') });
    const nextAfter = (await hook(page))?.next;
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    let dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    if (dis.v?.mode !== 'edit') { await page.keyboard.press('Space'); dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 4000); }
    await sleep(500);
    // the bigger opening is taken back step by step (Ctrl+Z), so the rest of the path works on the moved gate as it was
    for (let n = 0; n < grow; n++) { await page.keyboard.press('Control+KeyZ'); await sleep(60); }
    await sleep(500);
    out.fly = {
        selected: selFly, opening: [open0, openFly], grow, startZ, armed: arm.v, modeArmed: dArm?.mode, handlesArmed: dArm?.handles, nextBefore, flight,
        nextAfter, laps: (await hook(page))?.laps,
        modeAfter: dis.v?.mode, editEyeBackM: r2(dist(eyeBefore, (await ed(page)).view?.eye)), openingBack: (await dbg(page))?.stand.opening,
        topBarButtonsHidden: await page.evaluate(() => getComputedStyle(document.querySelector('[data-top="add"]') ?? document.body).display)
    };
    out.flySpan = await span(page, tFly, await now(page));
    out.path = await span(page, tPath, await now(page));
    // ED-4: Add gate, then a click low on the view (the floor); the new gate stands over the floor and is not red
    const fp0 = (await ed(page)).problems ?? 0;
    const nf = (await hook(page))?.gates ?? 0;
    const viewBefore = (await ed(page)).view ?? null;
    const dbgBefore = await dbg(page);
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-floor-before-1920.png' : 'editor3-floor-before-1920.png') });
    out.floorBefore = { viewBefore, mode: (dbgBefore as unknown as { mode?: string } | null)?.mode, eye: (dbgBefore as unknown as { eye?: unknown } | null)?.eye ?? null };
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
        line: await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? ''),
        place: (fd as unknown as { place?: unknown } | null)?.place ?? null,
        // G3: who held the camera (another writer's frames, the crash cleared on the way back, the session's override)
        camTaken: (fd as unknown as { camTaken?: unknown } | null)?.camTaken ?? null,
        camBefore: (dbgBefore as unknown as { camTaken?: unknown } | null)?.camTaken ?? null,
        crashCleared: (fd as unknown as { crashCleared?: unknown } | null)?.crashCleared ?? null,
        crashActive: (fd as unknown as { crashActive?: unknown } | null)?.crashActive ?? null,
        statsWindow: await page.evaluate(() => /AIR TIME/i.test(document.body.innerText)),
        viewAfter: (await ed(page)).view ?? null,
        problemLine: await page.evaluate(() => document.querySelector('.ce-problems, .ce-problem, [data-problems]')?.textContent?.slice(0, 160) ?? '')
    };
    await page.screenshot({ path: join(SHOTS, id === '70b50d42' ? 'editor3-wroclaw-floor-add-1920.png' : 'editor3-floor-add-1920.png') });
    out.floorAddUndo = await undoRedo(page);
    // the Add gate is taken back (undo) so the saved course is the one flown
    await page.click('[data-top="undo"]', { timeout: 3000 }).catch(() => undefined);
    await sleep(500);
    out.path = await span(page, tPath, await now(page));
    // G3 pass 2: the red gates go first (the highest number first, the moved gate last) until the check finds none, then
    // Save on the LOCAL stand-in of /api/tracks (main() routes it; nothing leaves this PC), then the saved course again
    // H3 pass 2 (left c, f): with problems left, Save first as the pilot would; the refusal selects the wrong gate and says
    // what to do; the probe does what it says (pulls the selected gate's X and Z arrows, keeps a pull that leaves fewer
    // problems, takes back one that does not) before any delete. Records the line at 1 s and 7 s, the start and the problems.
    let earlySaved = false;
    if (((await ed(page)).problems ?? 0) > 0) {
        await page.click('[data-top="save"]', { timeout: 3000 }).catch(() => undefined);
        await sleep(800);
        if (await page.evaluate(() => document.activeElement instanceof HTMLInputElement)) { await page.keyboard.type('Probe H3'); await page.keyboard.press('Enter'); }
        const s1 = await until(() => hook(page), (h) => !!(h as { saved?: string | null } | null)?.saved, 3000);
        earlySaved = s1.ok;
        const topLine = (): Promise<string> => page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? '');
        const cv = (await dbg(page)) as unknown as { wrong?: unknown; course?: { start?: unknown; problems?: unknown; gates?: { pos?: number[] }[] } } | null;
        const line1 = await topLine();
        const pulls: unknown[] = [];
        if (!earlySaved) {
            const fixSel = (await ed(page)).selected;
            await page.click('.ce-gatebar [data-bar="move"]', { timeout: 2000, force: true }).catch(() => undefined);
            await sleep(400);
            for (const [ax, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1], ['x', 1], ['z', 1], ['x', -1], ['z', -1]] as const) {
                const p0 = (await ed(page)).problems ?? 0;
                if (p0 === 0) break;
                const a = (await dbg(page))!;
                const dir = a.axes[ax];
                const w = await walk(page, a.stand.screen, dir, 12, ax);
                if (!w) { pulls.push({ ax, sgn, hit: null }); continue; }
                await drag(page, w.x, w.y, sgn * dir[0]! * 100, sgn * dir[1]! * 100);
                await sleep(1200);
                const p1 = (await ed(page)).problems ?? 0;
                const b = (await dbg(page))!;
                const kept = p1 < p0;
                if (!kept && dist(a.stand.pos, b.stand.pos) > 0.01) { await page.keyboard.press('Control+KeyZ'); await sleep(900); }
                pulls.push({ ax, sgn, movedM: r2(dist(a.stand.pos, b.stand.pos)), problems: [p0, p1], kept });
            }
            out.lineFollow = { selected: fixSel, pulls, problems: (await ed(page)).problems };
        }
        await sleep(Math.max(0, 7000 - 800));
        out.refusal = { saved: earlySaved, said: ((await ed(page)).said ?? '').slice(0, 160), line1s: line1.slice(0, 160), line7s: (await topLine()).slice(0, 160), wrong: cv?.wrong ?? null, start: cv?.course?.start ?? null, gate1: cv?.course?.gates?.[0]?.pos ?? null, problems: JSON.stringify(cv?.course?.problems ?? null).slice(0, 600) };
    }
    const removed: unknown[] = [];
    let movedGone = false;
    // I3 pass 2: the pilot's way to a course the check takes: Save; a refusal selects the gate it names and says 'delete it
    // with the cross on its bar'; the probe does that and saves again (pass 1 deleted the highest red gate and the check's
    // first refusal, gate 2, stayed). The course's gate poses are read before each Save, so the reload compares the gate at
    // index `cmp` as it was saved.
    let loopSaved = false;
    let lastPoses: (number[] | undefined)[] = [];
    for (let i = 0; i < 22 && !earlySaved; i++) {
        await sleep(1200);
        const cvi = (await dbg(page)) as unknown as { course?: { gates?: { pos?: number[] }[] } } | null;
        lastPoses = (cvi?.course?.gates ?? []).map((g) => g.pos);
        const e = (await ed(page)) as Ed & { paints?: string[] };
        await page.click('[data-top="save"]', { timeout: 3000 }).catch(() => undefined);
        await sleep(800);
        if (await page.evaluate(() => document.activeElement instanceof HTMLInputElement)) { await page.keyboard.type('Probe I3'); await page.keyboard.press('Enter'); }
        const si = await until(() => hook(page), (h) => !!(h as { saved?: string | null } | null)?.saved, 4000);
        if (si.ok) { loopSaved = true; removed.push({ saved: true, gates: (await hook(page))?.gates, problems: e.problems }); break; }
        const pick = (await ed(page)).selected ?? -1;
        const line = await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? '');
        if (pick === del) movedGone = true;
        const how = await page.click('.ce-gatebar [data-bar="delete"]', { timeout: 3000, force: true }).then(() => 'bar').catch(async () => { await page.keyboard.press('Delete'); return 'key'; });
        removed.push({ pick, problems: e.problems, gates: (await hook(page))?.gates, how, line: line.slice(0, 90) });
    }
    out.redRemoved = { steps: removed, problems: (await ed(page)).problems, gates: (await hook(page))?.gates, movedGone };
    // G3 pass 3: the gate the reload compares is the one at index `cmp` right before Save (the moved gate when it stayed and
    // no lower gate went; otherwise its successor), its pose recorded here; isMoved says whether it is the moved gate
    const left = (await hook(page))?.gates ?? 0;
    const lowerGone = removed.some((r) => typeof (r as { pick?: number }).pick === 'number' && (r as { pick: number }).pick < del);
    const cmp = Math.max(0, Math.min(del, left - 1));
    for (let n = 0; n < 60 && (await ed(page)).selected !== cmp; n++) { await page.keyboard.press(((await ed(page)).selected ?? 0) < cmp ? 'Tab' : 'Shift+Tab'); await sleep(80); }
    await sleep(400);
    const cmpPos = loopSaved ? lastPoses[cmp] : (await dbg(page))?.stand.pos;
    out.compare = { index: cmp, pos: cmpPos?.map(r2), isMoved: dist(cmpPos, movedPos) < 0.02, movedGone, lowerGone };
    let nameField: string | null = loopSaved ? 'loop' : 'early';
    if (!earlySaved && !loopSaved) {
        await page.click('[data-top="save"]', { timeout: 3000 }).catch((e) => { out.saveClickError = String(e).slice(0, 120); });
        await sleep(800);
        nameField = await page.evaluate(() => { const a = document.activeElement; return a instanceof HTMLInputElement ? a.className || 'input' : null; });
        if (nameField) { await page.keyboard.type('Probe G3'); await page.keyboard.press('Enter'); }
    }
    const sv = await until(() => hook(page), (h) => !!(h as { saved?: string | null } | null)?.saved, 20000);
    out.save = { nameField, ok: sv.ok, ms: sv.ms, saved: (sv.v as { saved?: string | null } | null)?.saved ?? null, said: ((await ed(page)).said ?? '').slice(0, 100), problem: sv.v?.problem ?? null, topLine: await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? ''), posts: await page.evaluate(() => (window as unknown as { __posts?: number }).__posts ?? null) };
    out.savedGatePos = movedPos?.map(r2);
    await sleep(500);
    // Exit: Esc; with unsaved changes the first Esc says so and a second one leaves ("The design", Enter and leave)
    let escs = 0;
    const escSaid: string[] = [];
    for (; escs < 3 && (await ed(page)).open; escs++) { await page.keyboard.press('Escape'); await sleep(1500); escSaid.push(((await ed(page)).said ?? '').slice(0, 80)); }
    out.exit = { closed: !(await ed(page)).open, escs, said: ((await ed(page)).said ?? '').slice(0, 100), escSaid, mode: (await dbg(page) as unknown as { mode?: string } | null)?.mode ?? null };
    const saved = (out.save as { saved?: string | null }).saved;
    if (saved) out.reload = await reloadSaved(page, id, saved, cmp, cmpPos);
    return out;
}

/** H2: the page again (same tab, same local /api/tracks stand-in): does the saved course come, and gate `del` where it was moved */
async function reloadSaved(page: Page, id: string, saved: string, del: number, movedPos: number[] | undefined): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    await page.goto(`${SITE}/en/fly/?scene=${id}&nowarn=1`);
    await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 240000);
    await page.focus('.screen.radio [data-action="radio-keyboard"]').catch(() => undefined);
    if (await page.evaluate(() => !!document.querySelector('.screen.radio'))) await page.keyboard.press('Enter');
    const c = await until(() => hook(page), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 30000);
    const h = c.v as (Hook & { track?: { id?: string; version?: number } | null; source?: string | null }) | null;
    out.auto = { ok: c.ok, ms: c.ms, gates: h?.gates, source: h?.source ?? null, track: h?.track ?? null };
    // H3 (the lead's decision): a saved course is not loaded by itself; the pilot opens it from Courses on the top bar
    await page.keyboard.press('Shift+KeyB');
    await until(() => ed(page), (e) => !!e.open, 30000);
    await sleep(800);
    await page.click('[data-top="courses"]', { timeout: 5000 }).catch((e) => { out.coursesClickError = String(e).slice(0, 120); });
    const rows = await until(() => page.locator('.ce-list .ce-open').count(), (n) => n > 0, 15000);
    out.list = { rows: rows.v, ms: rows.ms, text: await page.evaluate(() => (document.querySelector('.ce-list')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160)) };
    if (rows.v > 0) await page.locator('.ce-list .ce-open').last().click({ timeout: 5000 }).catch((e) => { out.openClickError = String(e).slice(0, 120); });
    const ld = await until(() => hook(page), (x) => ((x as { track?: { id?: string } | null } | null)?.track?.id ?? '') === saved, 20000);
    out.opened = { ok: ld.ok, ms: ld.ms, track: (ld.v as { track?: unknown } | null)?.track ?? null, gates: ld.v?.gates, editorOpen: (await ed(page)).open };
    if (!ld.ok) return out;
    if (!(await ed(page)).open) { await page.keyboard.press('Shift+KeyB'); await until(() => ed(page), (e) => !!e.open, 30000); }
    for (let n = 0; n < 60 && (await ed(page)).selected !== del; n++) { await page.keyboard.press(((await ed(page)).selected ?? 0) < del ? 'Tab' : 'Shift+Tab'); await sleep(150); }
    await sleep(600);
    const p = (await dbg(page))?.stand.pos;
    out.gate = { index: del, pos: p?.map(r2), savedPos: movedPos?.map(r2), offM: r2(dist(p, movedPos)) };
    return out;
}

/** the selected gate as the probe compares it: pose, opening, gate count and the window's gate line */
async function sample(p: Page): Promise<{ sel?: number; gates?: number; pos?: number[]; q?: number[]; open: number | null; line: string }> {
    const d = await dbg(p);
    const h = await hook(p);
    const line = await p.evaluate(() => document.querySelector('.course-editor .ce-gate')?.textContent ?? '');
    return { sel: h?.editor?.selected, gates: h?.gates, pos: d?.stand.pos.map(r2), q: d?.stand.quat.map(r2), open: d ? r2(d.stand.opening) : null, line: line.slice(0, 60) };
}

/** the top bar's Undo, then Redo, each by a mouse click; the state before, after undo and after redo */
async function undoRedo(p: Page): Promise<Record<string, unknown>> {
    const before = await sample(p);
    await p.click('[data-top="undo"]', { timeout: 3000 }).catch(() => undefined);
    await sleep(600);
    const undo = await sample(p);
    await p.click('[data-top="redo"]', { timeout: 3000 }).catch(() => undefined);
    await sleep(600);
    const redo = await sample(p);
    const same = (a: typeof before, b: typeof before): boolean => JSON.stringify([a.gates, a.pos, a.q, a.open, a.line]) === JSON.stringify([b.gates, b.pos, b.q, b.open, b.line]);
    return { undoChanged: !same(before, undo), redoBack: same(before, redo), before, undo, redo };
}

/** a gate bar button pressed with the mouse on its middle */
async function clickBar(p: Page, idBar: string): Promise<Record<string, unknown>> {
    const box = await p.locator(`.ce-gatebar [data-bar="${idBar}"]`).boundingBox().catch(() => null);
    // H2 pass 2: what lies under the press point and whether the bar is shown, so a missed button is named
    const under = box ? await p.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x!, y!);
        const b = e?.closest('[data-bar]') as HTMLElement | null;
        const bar = document.querySelector('.ce-gatebar') as HTMLElement | null;
        return { el: b ? `bar:${b.dataset.bar}` : (e?.tagName ?? 'none'), vis: bar ? getComputedStyle(bar).visibility : 'none' };
    }, [box.x + box.width / 2, box.y + box.height / 2]) : null;
    if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(900);
    return { id: idBar, box: box ? [Math.round(box.x), Math.round(box.y)] : null, ...under };
}

const barShown = (p: Page): Promise<string> => p.evaluate(() => { const b = document.querySelector('.ce-gatebar') as HTMLElement | null; return b ? `${getComputedStyle(b).display} ${b.style.left} ${b.style.top}` : 'none'; });

/** a stand-in of /api/tracks in this browser context only: POST keeps the file, the list and the file read it back */
const tracks = new Map<string, { body: Record<string, unknown>; version: number }>();
async function fakeTracks(ctx: import('playwright').BrowserContext): Promise<void> {
    await ctx.route('**/api/tracks**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (req.method() === 'POST') {
            const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
            // G3 pass 3: the server names a new course '<scene hex>-<8 hex>' (packages/tracks server.ts SERVER_TRACK_ID); the
            // page refuses any other id ('save: http 201' in run D), so the stand-in answers like the server
            const ver = /\/api\/tracks\/([^/]+)\/versions$/.exec(url.pathname);
            const own = String(body.id ?? '');
            const sceneHex = String(body.scene ?? '').replace(/[^0-9a-f]/g, '').slice(0, 32).padEnd(6, '0');
            const tid = ver ? decodeURIComponent(ver[1]!) : /^[0-9a-f]{6,32}-[0-9a-f]{8}$/.test(own) ? own : `${sceneHex}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
            const version = ver ? (tracks.get(tid)?.version ?? 0) + 1 : 1;
            tracks.set(tid, { body: { ...body, id: tid, version }, version });
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: tid, version, editToken: 'a'.repeat(32) }) });
        }
        const m = /\/api\/tracks\/([^/]+)\/v(\d+)$/.exec(url.pathname);
        if (m) {
            const t = tracks.get(decodeURIComponent(m[1]!));
            return t ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(t.body) }) : route.fulfill({ status: 404, body: '{}' });
        }
        // one scene per run reads this list, so every kept file is listed (H3 pass 2: the scene filter of H3 dropped the saved
        // course, its body.scene is not the page's scene id, so the list is not filtered)
        const rows = [...tracks.values()].map((t) => ({
            id: String(t.body.id), version: t.version, title: String(t.body.title ?? ''), gates: Array.isArray(t.body.gates) ? t.body.gates.length : 0,
            lengthM: 0, created: new Date().toISOString(), up: 0, down: 0, rating: 0
        }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, tracks: rows }) });
    });
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
    // H2: nothing covers the selected gate: what lies on top at the gate's screen point, and the top bar on one line
    const g = (await dbg(page))?.stand.screen;
    out.gateScreen = g?.map((v) => Math.round(v));
    out.onGate = g ? await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x!, y!); return e ? e.tagName + '.' + String(e.className) : null; }, [g[0]!, g[1]!]) : null;
    out.topBarH = await page.evaluate(() => { const e = document.querySelector('.ce-topbar'); return e ? Math.round(e.getBoundingClientRect().height) : null; });
    out.barFits = await page.evaluate(() => [...document.querySelectorAll('.ce-gatebar, .ce-topbar')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
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
    out.kbdFly = await keyboardFly(page);
    await page.screenshot({ path: join(SHOTS, 'editor3-after-kbd-flight-1920.png') });
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

/** H3: the keyboard as the pilot's source through gate 1 (made bigger, undone after): Space arms, W/S climb and sink, A/D
 * turn, ArrowUp forward, each pressed for 120 ms per step toward the gate on screen; Space disarms. Records course.next. */
async function keyboardFly(page: Page): Promise<Record<string, unknown>> {
    const vp = page.viewportSize()!;
    const idx = 0;
    for (let n = 0; n < 40 && (await ed(page)).selected !== idx; n++) { await page.keyboard.press('Shift+Tab'); await sleep(80); }
    let grow = 0;
    while (grow < 30 && ((await dbg(page))?.stand.opening ?? 0) < 3.5) { await page.keyboard.press('Equal'); grow++; await sleep(60); }
    await sleep(400);
    const g0 = (await dbg(page))?.gates[idx];
    const nextBefore = (await hook(page))?.next;
    await page.keyboard.press('Space');
    const fm = await until(() => dbg(page), (d) => d?.mode === 'fly', 4000);
    const flight: unknown[] = [];
    const EY_AIM = 0.15;
    let crashed = false;
    // H3 pass 2 (left b): the keyboard's throttle stays where W/S leave it (devices/keyboard.ts: W 0 -> 100 % in 500 ms, S
    // 100 -> 0 in 333 ms). Pass 1 only pressed D while the gate was behind, so the drone stayed on the ground with the
    // throttle at 0 and never turned. Now the probe keeps its own estimate of the throttle: it takes off to TH_BASE, holds
    // it within +-0.12 by the gate's height on screen, and turns with D (yaw) while the gate is not in front.
    const TH_BASE = 0.5; // an estimate of the hover throttle; the record's alt column shows what it did
    let th = 0;
    const tap = async (k: string, ms: number): Promise<void> => { if (ms < 8) return; await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); th = k === 'KeyW' ? Math.min(1, th + ms / 500) : k === 'KeyS' ? Math.max(0, th - ms / 333) : th; };
    const toward = async (target: number): Promise<void> => { const t = Math.max(0, Math.min(1, target)); if (t > th) await tap('KeyW', (t - th) * 500); else await tap('KeyS', (th - t) * 333); };
    const alt = (): Promise<string | null> => page.evaluate(() => /ALT\s*(-?[\d.]+)/i.exec(document.body.innerText)?.[1] ?? null);
    await toward(TH_BASE + 0.15);
    await sleep(400);
    for (let i = 0; i < 150; i++) {
        const d = await dbg(page);
        const h = await hook(page);
        const g = d?.gates[idx];
        flight.push([i, h?.next, d?.mode, g ? g.map((v) => Math.round(v * 10) / 10) : null, Math.round(th * 100), await alt()]);
        if (h?.next !== nextBefore || (i > 0 && d?.mode !== 'fly')) break;
        if ((d as unknown as { crashActive?: boolean } | null)?.crashActive) crashed = true;
        const keys: string[] = [];
        if (g && g[2]! > 0 && Math.abs(g[0]! - vp.width / 2) < vp.width) {
            const ex = (g[0]! - vp.width / 2) / (vp.width / 2);
            const ey = (g[1]! - vp.height / 2) / (vp.height / 2);
            if (ex > 0.1) keys.push('KeyD');
            else if (ex < -0.1) keys.push('KeyA');
            await toward(TH_BASE + Math.max(-0.12, Math.min(0.12, -0.25 * (ey - EY_AIM))));
            if (Math.abs(ex) < 0.3) keys.push('ArrowUp');
        } else {
            await toward(TH_BASE + 0.03);
            keys.push('KeyD');
        }
        for (const k of keys) await page.keyboard.down(k);
        await sleep(120);
        for (const k of keys) await page.keyboard.up(k);
        await sleep(80);
    }
    const nextAfter = (await hook(page))?.next;
    await page.keyboard.press('Space');
    const dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    await sleep(800);
    for (let n = 0; n < grow; n++) { await page.keyboard.press('Control+KeyZ'); await sleep(60); }
    return {
        grow, gateAtArm: g0?.map((v) => Math.round(v * 10) / 10), nextBefore, nextAfter, passed: nextAfter !== nextBefore, modeArmed: fm.v?.mode, crashed,
        steps: flight.length, first: flight.slice(0, 8), last: flight.slice(-6), modeAfter: dis.v?.mode, ms: dis.ms,
        statsShown: await page.evaluate(() => { const e = document.querySelector('.osd-stats'); return e ? getComputedStyle(e).display : 'absent'; }),
        crashToast: await page.evaluate(() => { const e = document.querySelector('.crash-toast'); return e ? getComputedStyle(e).display : 'absent'; })
    };
}

/** H2 pass 2 (REPRO=1): the Size fault of run1. One centre-box drag after each way in (the bar's Size, Undo + Redo, the key
 * T, the run1 order Turn ring + Undo + Redo + Size), each with the sets' own state before, during and after the press. */
async function sizeRepro(page: Page, id: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id };
    if (!(await prepare(page, id, out))) return out;
    await sleep(1500);
    await page.keyboard.press('Shift+KeyB');
    await until(() => ed(page), (e) => !!e.open, 30000);
    await sleep(1500);
    await page.keyboard.press('Tab');
    await sleep(1500);
    const tries: unknown[] = [];
    const sizeDrag = async (label: string): Promise<void> => {
        const a = (await dbg(page))!;
        const w = await walk(page, a.stand.screen, [0.71, -0.71], 0, '');
        if (!w) { tries.push({ label, hit: null, tool: a.tool, sets: (a as unknown as { sets: unknown }).sets, stand: a.stand.screen }); return; }
        await page.mouse.move(w.x, w.y);
        await sleep(150);
        await page.mouse.down();
        await page.mouse.move(w.x + 30, w.y - 30, { steps: 6 });
        const mid = (await dbg(page)) as unknown as { sets: unknown; dragging: boolean; muted: number; lock: boolean };
        await page.mouse.move(w.x + 60, w.y - 60, { steps: 6 });
        await sleep(100);
        await page.mouse.up();
        await sleep(700);
        const b = (await dbg(page))!;
        tries.push({
            label, r: w.r, hit: w.hit, tool: a.tool, setsBefore: (a as unknown as { sets: unknown }).sets, mid: { sets: mid.sets, dragging: mid.dragging, muted: mid.muted, lock: mid.lock },
            setsAfter: (b as unknown as { sets: unknown }).sets, opening: [r2(a.stand.opening), r2(b.stand.opening)], movedM: r2(dist(a.stand.pos, b.stand.pos)),
            lookAtMovedM: r2(dist(v0, (await ed(page)).view?.at)), sel: (await ed(page)).selected
        });
    };
    const bars: unknown[] = [];
    let v0 = (await ed(page)).view?.at;
    const ring = async (label: string): Promise<void> => {
        const a = (await dbg(page))!;
        const w = await walk(page, a.stand.screen, [1, 0], 40, '');
        if (w) await drag(page, w.x, w.y, 0, 60);
        tries.push({ label, tool: a.tool, r: w?.r ?? null, hit: w?.hit ?? null, quat: r2(dist(a.stand.quat, (await dbg(page))!.stand.quat)), sets: (a as unknown as { sets: unknown }).sets });
    };
    bars.push(await clickBar(page, 'size'));
    v0 = (await ed(page)).view?.at;
    await sizeDrag('bar-size');
    out.ur1 = await undoRedo(page);
    v0 = (await ed(page)).view?.at;
    await sizeDrag('after-undo-redo');
    await page.keyboard.press('KeyM');
    await sleep(300);
    await page.keyboard.press('KeyT');
    await sleep(400);
    v0 = (await ed(page)).view?.at;
    await sizeDrag('key-t');
    bars.push(await clickBar(page, 'turn'));
    await ring('ring');
    await undoRedo(page);
    bars.push(await clickBar(page, 'size'));
    v0 = (await ed(page)).view?.at;
    await sizeDrag('run1-order-bar');
    bars.push(await clickBar(page, 'turn'));
    await ring('ring2');
    await undoRedo(page);
    await page.keyboard.press('KeyT');
    await sleep(400);
    v0 = (await ed(page)).view?.at;
    await sizeDrag('run1-order-key');
    // G2: every kind of drag, each followed by a bar press (must find the bar visible): the X arrow, a ring, and a ring drag
    // that ends outside the canvas (on the top bar); turns in degrees
    const deg = (a: number[], b: number[]): number => {
        const d = Math.abs(a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0));
        return Math.round(((2 * Math.acos(Math.min(1, d)) * 180) / Math.PI) * 10) / 10;
    };
    bars.push(await clickBar(page, 'move'));
    {
        const a = (await dbg(page))!;
        const dir = a.axes.x;
        const w = await walk(page, a.stand.screen, dir, 12, 'x');
        if (w) await drag(page, w.x, w.y, dir[0]! * 80, dir[1]! * 80);
        tries.push({ label: 'arrow-x', tool: a.tool, r: w?.r ?? null, hit: w?.hit ?? null, movedM: r2(dist(a.stand.pos, (await dbg(page))!.stand.pos)) });
    }
    bars.push(await clickBar(page, 'turn'));
    for (const label of ['ring3', 'ring-out']) {
        const a = (await dbg(page))!;
        const w = await walk(page, a.stand.screen, [1, 0], 40, '');
        if (w && label === 'ring3') await drag(page, w.x, w.y, 0, 60);
        if (w && label === 'ring-out') {
            await page.mouse.move(w.x, w.y);
            await sleep(150);
            await page.mouse.down();
            await page.mouse.move(w.x, w.y + 60, { steps: 6 });
            await page.mouse.move(960, 28, { steps: 8 });
            await page.mouse.up();
            await sleep(700);
        }
        const b = (await dbg(page))!;
        tries.push({ label, tool: a.tool, r: w?.r ?? null, hit: w?.hit ?? null, deg: deg(a.stand.quat, b.stand.quat), movedM: r2(dist(a.stand.pos, b.stand.pos)) });
        bars.push(await clickBar(page, label === 'ring3' ? 'turn' : 'size'));
    }
    out.bars = bars;
    out.tries = tries;
    out.ups = await page.evaluate(() => (window as unknown as { __ups?: unknown[] }).__ups ?? []);
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
        await fakeTracks(ctx);
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
        if (process.env.REPRO === '1') {
            await run(`repro-${SCENES[0]}`, { width: 1920, height: 1080 }, (p) => sizeRepro(p, SCENES[0]!));
            return;
        }
        // FULL=0: only the keyboard and the phone runs (a second lock hold, each under 10 minutes)
        if (process.env.FULL !== '0') for (const id of SCENES) await run(id, { width: 1920, height: 1080 }, (p) => scene(p, id));
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
