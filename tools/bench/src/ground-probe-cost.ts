// Lane ground-probe (docs/wip/ground-probe.md): what the "ground below" look costs on a scan's own collision, and how
// often the centred pilot makes it at a radio's report rate. Node, no browser.
//   cost    ms per call (p50, p95, max) at heights above the ground, over several ground points:
//           "whole" = one 20 m sweep of the 0.05 m sphere (the query as it was up to origin/main bbc9e75e, kept here as
//           the reference), "now" = apps/fly/src/play/ground.ts groundClearance as it is in this tree.
//   pieces  the same sweep cut into pieces of 0.1 .. 2 m with an early exit: ms per call by piece length.
//   diff    "now" against "whole" on a grid of positions: both none, or the difference in metres (p95, max).
//   rate    the real CentrePilot (angle mode, sticks at rest) fed frames on the real clock at 60 .. 1000 reports a
//           second, one thread like the page: looks per second, the share of the time spent in looks, frames handled
//           per second (under the rate = the page falls behind).
// Usage: node node_modules/tsx/dist/cli.mjs tools/bench/src/ground-probe-cost.ts [out.json] [parts: cost,pieces,diff,rate]
//        GROUND_SCENE (887f27aa), GROUND_DIFF_N (grid side, 7), GROUND_RATE_S (seconds per rate, 2)
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { S, Sim } from '@gsfpv/sim-core';
import type { ContactOut, ContactWorld } from '@gsfpv/sim-core';
import { loadScene } from './scenes';
import { params } from './presets';
import { groundClearance } from '../../../apps/fly/src/play/ground';
import { CentrePilot } from '../../../apps/fly/src/play/centre-pilot';

const outFile = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : '';
const parts = (process.argv[3] ?? 'cost,pieces,diff,rate').split(',');
const sceneId = process.env.GROUND_SCENE || '887f27aa';
const DIFF_N = Number(process.env.GROUND_DIFF_N || 7);
const RATE_S = Number(process.env.GROUND_RATE_S || 2);

const REACH_M = 20;
const BALL_R = 0.05;
const HEIGHTS = [0.3, 1, 3, 6.67, 10, 20];
const PIECES = [0.1, 0.25, 0.5, 1, 2];
const RATES = [60, 125, 250, 500, 1000];

const c0 = new Float64Array(3);
const c1 = new Float64Array(3);
const rad = new Float64Array([BALL_R]);
const pad = new Float64Array([0]);
const hit: ContactOut = { sphere: 0, nx: 0, ny: 0, nz: 0 };

/** The query as it was: one sweep over the whole reach. Clearance of the body's lowest point, or null. */
function whole(world: ContactWorld, x: number, y: number, z: number, bottom: number): number | null {
    c0[0] = c1[0] = x; c0[1] = y; c1[1] = y - REACH_M; c0[2] = c1[2] = z;
    const t = world.sweep(c0, c1, rad, pad, 1, hit);
    return t < 0 ? null : Math.max(0, t * REACH_M + BALL_R - bottom);
}

/** The same sweep in pieces of `len` metres, stopping at the first piece that touches. */
function pieces(world: ContactWorld, x: number, y: number, z: number, bottom: number, len: number): number | null {
    c0[0] = c1[0] = x; c0[2] = c1[2] = z;
    const n = Math.round(REACH_M / len);
    for (let i = 0; i < n; i++) {
        c0[1] = y - i * len;
        c1[1] = y - (i + 1) * len;
        const t = world.sweep(c0, c1, rad, pad, 1, hit);
        if (t >= 0) return Math.max(0, (i + t) * len + BALL_R - bottom);
    }
    return null;
}

function quant(v: number[], q: number): number {
    if (!v.length) return NaN;
    const a = [...v].sort((p, r) => p - r);
    return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const stats = (v: number[]): { n: number; p50: number; p95: number; max: number } => ({ n: v.length, p50: r3(quant(v, 0.5)), p95: r3(quant(v, 0.95)), max: r3(Math.max(...v)) });

/** Times fn: at least 3 calls, then until 150 ms or 200 calls. One sample per call, ms. */
function time(fn: () => unknown): number[] {
    const v: number[] = [];
    let total = 0;
    while (v.length < 3 || (total < 150 && v.length < 200)) {
        const t = performance.now();
        fn();
        const d = performance.now() - t;
        v.push(d);
        total += d;
    }
    return v;
}

const sc = await loadScene(sceneId);
const world: ContactWorld = sc.world;
const p = params('pavo20pro-3s', { crashOn: false });
const [sx, sy, sz] = sc.settings.position;
const out: Record<string, unknown> = {
    what: 'ground-probe-cost.ts: cost of the ground-below look', scene: sceneId, voxelM: sc.metadata.voxelResolution, at: new Date().toISOString(),
    node: process.version, spawn: [r3(sx), r3(sy), r3(sz)], bodyBottom: p.bodyBottom
};

// ground points: the spawn and points around it whose column from the spawn's height meets ground within reach
const OFFS: [number, number][] = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 3], [-3, 3], [3, -3], [-3, -3], [6, 0], [0, 6], [-6, 0], [0, -6]];
const grounds: { x: number; z: number; y: number }[] = [];
for (const [dx, dz] of OFFS) {
    const g = whole(world, sx + dx, sy, sz + dz, 0);
    // g = how far the ball's lowest point is above the ground; 0 = the start is inside something
    if (g !== null && g > 0.001) grounds.push({ x: sx + dx, z: sz + dz, y: sy - g });
}
out.groundPoints = grounds.length;
const state = new Float64Array(64);
const at = (x: number, y: number, z: number): Float64Array => { state[S.px] = x; state[S.py] = y; state[S.pz] = z; return state; };

if (parts.includes('cost')) {
    const rows = [];
    for (const h of HEIGHTS) {
        const tw: number[] = [], tn: number[] = [];
        let seen = 0;
        for (const g of grounds) {
            const y = g.y + p.bodyBottom + h;
            const a = whole(world, g.x, y, g.z, p.bodyBottom);
            if (a !== null && Math.abs(a - h) < 0.01) seen++;
            tw.push(...time(() => whole(world, g.x, y, g.z, p.bodyBottom)));
            const s = at(g.x, y, g.z);
            tn.push(...time(() => groundClearance(world, s, p)));
        }
        rows.push({ heightM: h, points: grounds.length, groundAtHeight: seen, wholeMs: stats(tw), nowMs: stats(tn) });
        console.error(`cost h=${h} whole p50 ${r3(quant(tw, 0.5))} p95 ${r3(quant(tw, 0.95))} max ${r3(Math.max(...tw))} | now p50 ${r3(quant(tn, 0.5))} p95 ${r3(quant(tn, 0.95))} max ${r3(Math.max(...tn))} ms`);
    }
    out.cost = rows;
}

if (parts.includes('pieces')) {
    const rows = [];
    for (const len of PIECES) {
        const byH: Record<string, unknown> = {};
        const all: number[] = [];
        for (const h of HEIGHTS) {
            const v: number[] = [];
            for (const g of grounds) v.push(...time(() => pieces(world, g.x, g.y + p.bodyBottom + h, g.z, p.bodyBottom, len)));
            byH[String(h)] = stats(v);
            all.push(...v);
        }
        rows.push({ pieceM: len, allMs: stats(all), byHeight: byH });
        console.error(`pieces ${len} m: p50 ${r3(quant(all, 0.5))} p95 ${r3(quant(all, 0.95))} max ${r3(Math.max(...all))} ms`);
    }
    out.pieces = rows;
}

if (parts.includes('diff')) {
    const d: number[] = [];
    let n = 0, bothNone = 0, oneNone = 0, wholeMsMax = 0;
    const half = (DIFF_N - 1) / 2;
    for (let i = 0; i < DIFF_N; i++) {
        for (let k = 0; k < DIFF_N; k++) {
            // off the voxel lattice: a step of 0.937 m and a shift, so columns land anywhere in a voxel
            const x = sx + (i - half) * 0.937 + 0.013, z = sz + (k - half) * 0.937 - 0.021;
            for (const dy of [-0.4, 0.02, 0.7, 2.3, 5.1, 9.6]) {
                const y = sy + dy;
                const t = performance.now();
                const a = whole(world, x, y, z, p.bodyBottom);
                wholeMsMax = Math.max(wholeMsMax, performance.now() - t);
                const b = groundClearance(world, at(x, y, z), p);
                n++;
                if (a === null && b === null) bothNone++;
                else if (a === null || b === null) oneNone++;
                else d.push(Math.abs(a - b));
            }
        }
    }
    out.diff = { positions: n, bothNone, oneNone, compared: d.length, p50M: quant(d, 0.5), p95M: quant(d, 0.95), maxM: d.length ? Math.max(...d) : NaN, wholeMsMax: r3(wholeMsMax) };
    console.error(`diff ${JSON.stringify(out.diff)}`);
}

if (parts.includes('rate')) {
    const rows = [];
    const g = grounds[0];
    for (const h of [1, 6.67]) {
        for (const rate of RATES) {
            const sim = new Sim(p, world);
            sim.reset(g.x, g.y + p.bodyBottom + h, g.z, 0, { soc: 1 });
            sim.s[S.platOn] = 0;
            let looks = 0, lookMs = 0, lookMax = 0;
            const pilot = new CentrePilot({
                sim: () => sim, paused: () => false,
                ground: (m) => {
                    const t = performance.now();
                    const v = groundClearance(m.contactWorld, m.s, m.p);
                    const dt = performance.now() - t;
                    looks++; lookMs += dt; lookMax = Math.max(lookMax, dt);
                    return v;
                },
                mode: () => 'angle', speed: () => 'normal', toggleArm: () => true
            });
            const ch = new Float32Array([0, 0, 0, 0, -1, 0, 0, 0]);
            const o = new Float32Array(8);
            const t0 = performance.now();
            let handled = 0, t = t0, gapMax = 0;
            while ((t = performance.now()) - t0 < RATE_S * 1000) {
                // one thread, like the page: a report that is due is handled; while a look runs the next ones wait
                if (handled < Math.floor(((t - t0) * rate) / 1000)) {
                    pilot.apply(ch, o, t);
                    handled++;
                    gapMax = Math.max(gapMax, performance.now() - t);
                }
            }
            const secs = (t - t0) / 1000;
            const row = { heightM: h, reportsPerS: rate, looksPerS: r3(looks / secs), lookShare: r3(lookMs / (secs * 1000)), lookMsMax: r3(lookMax), handledPerS: r3(handled / secs), longestHandlerMs: r3(gapMax) };
            rows.push(row);
            console.error(`rate ${JSON.stringify(row)}`);
        }
    }
    out.rate = rows;
}

if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(out, null, 1));
}
console.log(JSON.stringify({ scene: sceneId, groundPoints: grounds.length, parts, out: outFile || null }));
