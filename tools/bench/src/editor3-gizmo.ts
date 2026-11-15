// Lane editor3, stage I1-gizmo (docs/wip/editor3.md): the selected gate's framing and its handles on a LOCAL release, with
// real mouse and key events, rendering on. MODE=before (the release before I1: no measure hook) records, for a gate
// selected by a click, the eye's distance (__gsfpvEditView cam.pos against stand.pos), the gate's height on screen (from the
// eye distance and the field of view: an estimate) and each handle's pick rectangle (a grid of __gsfpvEditHit points).
// MODE=after adds __gsfpvEditMeasure (eye distance, the opening's height in px, the rings' minor axes, each shown handle
// part's rectangle) and walks the proof: click select, Tab x3, F after the view was flown away, Move by the X arrow 2 m,
// each turn ring 30 deg, an edge-on ring, Size by an end cube and by the centre cube, undo of each, three pictures.
// Never presses save, send or create. Env: SITE, SCENE (887f27aa), OUT, MODE. Run under the GPU lock (one hold per run).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5805').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '887f27aa';
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3/i1/gizmo';
const MODE = process.env.MODE === 'before' ? 'before' : 'after';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const PIC = (what: string): string => `editor3${SCENE === '70b50d42' ? '-wroclaw' : SCENE === '887f27aa' ? '' : `-${SCENE}`}-${what}-1920.png`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const r2 = (x: number): number => Math.round(x * 100) / 100;

type Dbg = { stand: { pos: number[]; quat: number[]; opening: number; screen: number[] }; axes: { x: number[]; y: number[]; z: number[] }; gates: number[][]; cam: { pos: number[] }; tool?: string; tag?: string | null; dragging?: boolean; mode?: string };
type Measure = { eyeDist: number; gatePx: number; viewH: number; rings: number[]; glide: boolean; parts: { name: string; rect: number[] }[]; frame: unknown };
type W = { __gsfpv?: { status?: string; course?: { gates?: number; on?: boolean; editor?: { open?: boolean; selected?: number; said?: string } } }; __gsfpvEditView?: () => unknown; __gsfpvEditHit?: (x: number, y: number) => string[] | null; __gsfpvEditMeasure?: () => unknown };
const dbg = (p: Page): Promise<Dbg | null> => p.evaluate(() => ((window as unknown as W).__gsfpvEditView?.() ?? null) as Dbg | null);
const meas = (p: Page): Promise<Measure | null> => p.evaluate(() => ((window as unknown as W).__gsfpvEditMeasure?.() ?? null) as Measure | null);
const sel = (p: Page): Promise<number | null> => p.evaluate(() => (window as unknown as W).__gsfpv?.course?.editor?.selected ?? null);
const dist = (a?: number[], b?: number[]): number => (a && b ? r2(Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)))) : -1);
/** the angle between two rotations, degrees */
const turnDeg = (a: number[], b: number[]): number => r2((2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!))) * 180) / Math.PI);

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(300); v = await get(); }
    return v;
}

/** the vertical field of view at this viewport: the page's camera keeps 115 deg horizontal (editor3.md I1.2 note) */
const tanHalfV = (w: number, h: number): number => Math.tan((115 / 2) * (Math.PI / 180)) * (h / w);

/** the numbers of one selected gate: eye distance, the gate's height on screen (measured after I1, estimated before),
 *  the rings' minor axes and the parts' rectangles (after), the pick rectangle of each handle shape (both) */
async function numbers(page: Page, tools: boolean): Promise<Record<string, unknown>> {
    const vp = page.viewportSize()!;
    const d = (await dbg(page))!;
    const m = await meas(page);
    const eye = dist(d.cam.pos, d.stand.pos);
    const est = Math.round((d.stand.opening / (2 * eye * tanHalfV(vp.width, vp.height))) * vp.height);
    const out: Record<string, unknown> = { selected: await sel(page), opening: r2(d.stand.opening), eyeDist: m?.eyeDist ?? eye, gatePx: m?.gatePx ?? null, gatePxEst: est, viewH: m?.viewH ?? vp.height };
    if (m) {
        out.gateShare = r2(m.gatePx / m.viewH);
        out.rings = m.rings;
        out.frame = m.frame;
        out.parts = m.parts.map((x) => `${x.name} ${x.rect.join(',')}`);
        const small = m.parts.filter((x) => !/line|ring|circle|torus|arc/i.test(x.name));
        out.maxSmallPart = small.length ? Math.max(...small.map((x) => Math.max(x.rect[2]!, x.rect[3]!))) : null;
    }
    if (tools) {
        const picks: Record<string, unknown> = {};
        for (const k of ['KeyM', 'KeyR', 'KeyT']) {
            await page.keyboard.press(k);
            await sleep(400);
            const s = (await dbg(page))!.stand.screen;
            picks[k] = await page.evaluate(([cx, cy]) => {
                const h = (window as unknown as W).__gsfpvEditHit;
                const box: Record<string, number[]> = {};
                for (let y = cy! - 260; y <= cy! + 260; y += 5) for (let x = cx! - 260; x <= cx! + 260; x += 5) {
                    const hit = h?.(x, y);
                    if (!hit) continue;
                    const b = (box[hit.join(':')] ??= [x, y, x, y]);
                    b[0] = Math.min(b[0]!, x); b[1] = Math.min(b[1]!, y); b[2] = Math.max(b[2]!, x); b[3] = Math.max(b[3]!, y);
                }
                return Object.fromEntries(Object.entries(box).map(([k2, b]) => [k2, [b[0], b[1], b[2]! - b[0]!, b[3]! - b[1]!]]));
            }, [s[0]!, s[1]!] as const);
            if (m) picks[`${k}-parts`] = (await meas(page))?.parts.map((x) => `${x.name} ${x.rect.join(',')}`);
        }
        out.picks = picks;
        await page.keyboard.press('KeyM');
        await sleep(300);
    }
    return out;
}

async function open(page: Page, out: Record<string, unknown>): Promise<boolean> {
    const t0 = Date.now();
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&nowarn=1`);
    const st = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 240000);
    out.loadS = Math.round((Date.now() - t0) / 1000);
    if (st !== 'ready') { out.status = st; return false; }
    await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).catch(() => undefined);
    await page.click('.screen.radio [data-action="radio-keyboard"]', { timeout: 5000 }).catch(() => undefined);
    await sleep(1500);
    await page.keyboard.press('Shift+KeyG');
    const c = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.course ?? null), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 150000);
    out.gates = c?.gates;
    if (!c?.gates) return false;
    await page.keyboard.press('Shift+KeyB');
    await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.course?.editor?.open ?? false), (v) => v, 30000);
    await sleep(1200);
    await page.keyboard.press('Tab');
    await sleep(1200);
    out.openS = Math.round((Date.now() - t0) / 1000);
    return true;
}

/** click another gate whose centre is on the canvas and away from the selected one's handles; back the view off when
 *  none is on screen (S and E held, up to 6 times) */
async function clickSelect(page: Page): Promise<Record<string, unknown>> {
    const tries: unknown[] = [];
    for (let n = 0; n < 7; n++) {
        const d = (await dbg(page))!;
        const before = await sel(page);
        const pick = await page.evaluate(([gs, s, cur]) => {
            const cv = document.querySelector('canvas');
            let best: { i: number; x: number; y: number } | null = null;
            gs.forEach((g, i) => {
                if (i === cur || !(g[2]! > 0) || g[0]! < 60 || g[0]! > innerWidth - 60 || g[1]! < 120 || g[1]! > innerHeight - 140) return;
                if (Math.hypot(g[0]! - s[0]!, g[1]! - s[1]!) < 180) return;
                if (document.elementFromPoint(g[0]!, g[1]!) !== cv) return;
                if (!best) best = { i, x: g[0]!, y: g[1]! };
            });
            return best as { i: number; x: number; y: number } | null;
        }, [d.gates, d.stand.screen, before ?? -1] as const);
        tries.push(pick);
        if (pick) {
            await page.mouse.move(pick.x, pick.y);
            await sleep(120);
            await page.mouse.down();
            await sleep(60);
            await page.mouse.up();
            await sleep(1000);
            const after = await sel(page);
            return { from: before, target: pick.i, at: [pick.x, pick.y], selected: after, ok: after === pick.i, backOffs: n, tries };
        }
        await page.keyboard.down('KeyS');
        await sleep(500);
        await page.keyboard.up('KeyS');
        await page.keyboard.down('KeyE');
        await sleep(250);
        await page.keyboard.up('KeyE');
        await sleep(500);
    }
    return { ok: false, tries };
}

/** press at `p`, travel along `dir` in 4 px steps until `done` says so or `maxPx`; a picture at the end before release */
async function dragUntil(page: Page, p: number[], dir: number[], maxPx: number, done: (d: Dbg) => boolean, shot: string | null): Promise<{ px: number; mid: Dbg | null }> {
    const n = Math.hypot(dir[0]!, dir[1]!) || 1;
    await page.mouse.move(p[0]!, p[1]!);
    await sleep(150);
    await page.mouse.down();
    let px = 0;
    let mid: Dbg | null = null;
    for (px = 4; px <= maxPx; px += 4) {
        await page.mouse.move(p[0]! + (dir[0]! / n) * px, p[1]! + (dir[1]! / n) * px);
        await sleep(25);
        mid = await dbg(page);
        if (mid && done(mid)) break;
    }
    await sleep(200);
    if (shot) await page.screenshot({ path: join(SHOTS, shot) });
    await page.mouse.up();
    await sleep(700);
    return { px, mid };
}

async function undo(page: Page, a: Dbg): Promise<Record<string, unknown>> {
    await page.keyboard.press('Control+KeyZ');
    await sleep(800);
    const b = (await dbg(page))!;
    return { backM: dist(a.stand.pos, b.stand.pos), backDeg: turnDeg(a.stand.quat, b.stand.quat), opening: [r2(a.stand.opening), r2(b.stand.opening)] };
}

/** the first point along `dir` from the gate's centre (from `min` px) whose shape is `want` */
async function walk(page: Page, dir: number[], min: number, want: string[]): Promise<{ x: number; y: number; hit: string[] } | null> {
    const s = (await dbg(page))!.stand.screen;
    return page.evaluate(([f, dv, m, wa]) => {
        const h = (window as unknown as W).__gsfpvEditHit;
        const n = Math.hypot(dv[0]!, dv[1]!) || 1;
        for (let r = m; r <= 400; r += 2) { const x = f[0]! + (dv[0]! / n) * r; const y = f[1]! + (dv[1]! / n) * r; const hit = h?.(x, y); if (hit && wa.includes(hit[1]!)) return { x, y, hit }; }
        return null;
    }, [s, dir, min, want] as const);
}

/** points of ring `axis` (or its edge pick) round the centre: for each 5 deg the nearest radius that hits it */
async function ringPoints(page: Page, axis: string): Promise<number[][]> {
    const s = (await dbg(page))!.stand.screen;
    return page.evaluate(([c, ax]) => {
        const h = (window as unknown as W).__gsfpvEditHit;
        const pts: number[][] = [];
        for (let a = 0; a < 360; a += 5) {
            const t = (a * Math.PI) / 180;
            for (let r = 20; r <= 200; r += 2) {
                const x = c[0]! + Math.cos(t) * r;
                const y = c[1]! + Math.sin(t) * r;
                const hit = h?.(x, y);
                if (hit && (hit[1] === ax || hit[1] === `edge:${ax}`)) { pts.push([a, x, y, r]); break; }
                if (hit) break;
            }
        }
        return pts;
    }, [s, axis] as const);
}

/** turn by ring `axis`: press on its point farthest from the centre, travel along its tangent until 30 deg (or 400 px) */
async function ringTurn(page: Page, axis: string, shot: string | null): Promise<Record<string, unknown>> {
    await page.keyboard.press('KeyR');
    await sleep(400);
    const a = (await dbg(page))!;
    const pts = await ringPoints(page, axis);
    if (pts.length < 2) return { axis, found: pts.length };
    // the point with neighbours on both sides that lies farthest out: its tangent is the line through the neighbours
    let k = 0;
    for (let i = 0; i < pts.length; i++) if (pts[i]![3]! > pts[k]![3]!) k = i;
    const pa = pts[(k - 1 + pts.length) % pts.length]!;
    const pb = pts[(k + 1) % pts.length]!;
    const tan = [pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const r = await dragUntil(page, [pts[k]![1]!, pts[k]![2]!], tan, 400, (d) => turnDeg(a.stand.quat, d.stand.quat) >= 29.5, shot);
    const b = (await dbg(page))!;
    const out = { axis, points: pts.length, at: pts[k]!.slice(1).map(Math.round), hit: await page.evaluate(([x, y]) => (window as unknown as W).__gsfpvEditHit?.(x!, y!) ?? null, [pts[k]![1]!, pts[k]![2]!] as const), px: r.px, quatBefore: a.stand.quat.map((v) => r2(v)), quatAfter: b.stand.quat.map((v) => r2(v)), deg: turnDeg(a.stand.quat, b.stand.quat), tagMid: r.mid?.tag ?? null, movedM: dist(a.stand.pos, b.stand.pos) };
    return { ...out, undo: await undo(page, a) };
}

async function proof(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    // Tab three times: the framing of each newly selected gate
    const tabs: unknown[] = [];
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        await sleep(900);
        const m = await meas(page);
        tabs.push({ selected: await sel(page), eyeDist: m?.eyeDist, gatePx: m?.gatePx, share: m ? r2(m.gatePx / m.viewH) : null, rings: m?.rings, frame: m?.frame });
    }
    out.tabs = tabs;
    // F after the view was flown away
    const f0 = await meas(page);
    await page.keyboard.down('KeyS'); await sleep(600); await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyD'); await sleep(400); await page.keyboard.up('KeyD');
    await sleep(500);
    const f1 = await meas(page);
    await page.keyboard.press('KeyF');
    await sleep(900);
    const f2 = await meas(page);
    out.frameKey = { before: [f0?.eyeDist, f0?.gatePx], flownAway: [f1?.eyeDist, f1?.gatePx], afterF: [f2?.eyeDist, f2?.gatePx], rings: f2?.rings, frame: f2?.frame };
    // Move by the X arrow 2 m
    await page.keyboard.press('KeyM');
    await sleep(400);
    let a = (await dbg(page))!;
    const ax = await walk(page, a.axes.x, 20, ['x']);
    if (ax) {
        const r = await dragUntil(page, [ax.x, ax.y], a.axes.x, 600, (d) => dist(a.stand.pos, d.stand.pos) >= 2, PIC('move'));
        const b = (await dbg(page))!;
        out.moveX = { at: [Math.round(ax.x), Math.round(ax.y)], hit: ax.hit, px: r.px, movedM: dist(a.stand.pos, b.stand.pos), dx: r2(b.stand.pos[0]! - a.stand.pos[0]!), turned: turnDeg(a.stand.quat, b.stand.quat), tagMid: r.mid?.tag ?? null, undo: await undo(page, a) };
    } else out.moveX = { hit: null };
    // each ring 30 deg
    out.turn = [];
    for (const axis of ['x', 'y', 'z']) (out.turn as unknown[]).push(await ringTurn(page, axis, axis === 'y' ? PIC('turn') : null));
    // an edge-on ring: tap Q (or E back) until the y ring's minor axis is under 10 px, then drag 60 px across its line
    const steps: number[] = [];
    let m = await meas(page);
    for (let i = 0; i < 40 && m && m.rings[1]! >= 10; i++) {
        const prev = m.rings[1]!;
        const key = steps.length > 1 && prev > steps[steps.length - 2]! ? 'KeyE' : 'KeyQ';
        await page.keyboard.down(key); await sleep(40); await page.keyboard.up(key);
        await sleep(250);
        m = await meas(page);
        steps.push(m?.rings[1] ?? -1);
    }
    await page.keyboard.press('KeyR');
    await sleep(400);
    a = (await dbg(page))!;
    const edge: Record<string, unknown> = { ringsMinor: m?.rings, steps };
    const s = a.stand.screen;
    const found = await page.evaluate(([c]) => {
        const h = (window as unknown as W).__gsfpvEditHit;
        for (const dx of [70, -70, 60, -60, 80, -80, 50, -50]) for (let dy = -14; dy <= 14; dy += 2) { const hit = h?.(c[0]! + dx, c[1]! + dy); if (hit && (hit[1] === 'edge:y' || hit[1] === 'y')) return { x: c[0]! + dx, y: c[1]! + dy, hit }; }
        return null;
    }, [s] as const);
    edge.hit = found;
    if (found) {
        // across the line: perpendicular to the y ring's drawn line (the line runs along the gate's x axis on screen)
        const across = [-a.axes.x[1]!, a.axes.x[0]!];
        const r = await dragUntil(page, [found.x, found.y], across, 60, () => false, null);
        const b = (await dbg(page))!;
        Object.assign(edge, { px: r.px, quatBefore: a.stand.quat.map((v) => r2(v)), quatAfter: b.stand.quat.map((v) => r2(v)), deg: turnDeg(a.stand.quat, b.stand.quat), tagMid: r.mid?.tag ?? null, undo: await undo(page, a) });
    }
    out.edge = edge;
    await page.keyboard.press('KeyF');
    await sleep(900);
    // Size by an end cube and by the centre cube
    await page.keyboard.press('KeyT');
    await sleep(400);
    a = (await dbg(page))!;
    const end = await walk(page, a.axes.x, 20, ['x']);
    if (end) {
        const r = await dragUntil(page, [end.x, end.y], a.axes.x, 50, () => false, PIC('size'));
        const b = (await dbg(page))!;
        out.sizeEnd = { at: [Math.round(end.x), Math.round(end.y)], hit: end.hit, px: r.px, opening: [r2(a.stand.opening), r2(b.stand.opening)], movedM: dist(a.stand.pos, b.stand.pos), tagMid: r.mid?.tag ?? null, undo: await undo(page, a) };
    } else out.sizeEnd = { hit: null };
    a = (await dbg(page))!;
    const cen = await walk(page, [0.71, -0.71], 0, ['xyz']);
    if (cen) {
        const r = await dragUntil(page, [cen.x, cen.y], [0.71, -0.71], 40, () => false, null);
        const b = (await dbg(page))!;
        out.sizeCentre = { at: [Math.round(cen.x), Math.round(cen.y)], hit: cen.hit, px: r.px, opening: [r2(a.stand.opening), r2(b.stand.opening)], movedM: dist(a.stand.pos, b.stand.pos), tagMid: r.mid?.tag ?? null, undo: await undo(page, a) };
    } else out.sizeCentre = { hit: null };
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, scene: SCENE, mode: MODE, date: new Date().toISOString() };
    const file = join(OUT, `gizmo-${MODE}-${SCENE}.json`);
    const save = (): void => writeFileSync(file, JSON.stringify({ ...out, log }, null, 1));
    const { browser, which } = await launchChrome({ args: ['--window-size=1936,1200'] });
    out.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.addInitScript({ content: 'globalThis.__name = (f) => f;' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    try {
        if (await open(page, out)) {
            out.tab1 = await numbers(page, false);
            out.click = await clickSelect(page);
            out.clicked = await numbers(page, true);
            save();
            if (MODE === 'after') out.proof = await proof(page);
        }
    } catch (e) {
        out.error = String(e).slice(0, 400);
    } finally {
        save();
        await browser.close();
    }
    console.log(`wrote ${file}`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
