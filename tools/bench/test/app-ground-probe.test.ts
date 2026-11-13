// Lane ground-probe (docs/wip/ground-probe.md): the ground-below look is cheap and is never made once per report.
//  - the look sweeps down in short pieces: no sphere tested is larger than the probe's own plus half a piece (the
//    one 20 m sweep of origin/main made the contact world test a 10.05 m cover sphere voxel by voxel), it stops at
//    the first piece that touches and still reaches 20 m;
//  - the answer is the whole sweep's within the sweep's own resolution (0.25 mm);
//  - a radio at 1000 reports a second whose look is slow (50 ms): the pilot looks for at most a fifth of the time and
//    every report is still handled (origin/main looked on every report: the handler took all the time);
//  - GroundCache: the last answer between looks, reset, input time that goes back, a clock that goes back.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S, Sim } from '../../../packages/sim-core/src';
import type { ContactOut, ContactWorld } from '../../../packages/sim-core/src';
import { VoxelContactWorld, syntheticOpen, syntheticRoom } from '../../../packages/collision/src';
import { FloorWorld, params } from './game-loop';
import * as G from '../../../apps/fly/src/play/ground';
import { CentrePilot } from '../../../apps/fly/src/play/centre-pilot';

afterEach(() => { vi.restoreAllMocks(); });

const P = params('pavo20pro-3s', { crashOn: false });
/** The probe's sphere 0.05 m plus half of a 0.1 m piece, and the sweep's leaf on top. */
const LARGEST_SPHERE_M = 0.05 + 0.05 + 0.001;
const PIECE_M = 0.1;

function stateAt(x: number, y: number, z: number): Float64Array {
    const s = new Float64Array(64);
    s[S.px] = x; s[S.py] = y; s[S.pz] = z;
    return s;
}

/** A contact world that counts the sweeps asked of it and their lengths. */
class Counting implements ContactWorld {
    sweeps = 0;
    longest = 0;
    lowest = Infinity;
    private readonly inner: ContactWorld;
    constructor(inner: ContactWorld) { this.inner = inner; }
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        this.sweeps++;
        this.longest = Math.max(this.longest, Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]));
        this.lowest = Math.min(this.lowest, c1[1]);
        return this.inner.sweep(c0, c1, r, pad, n, out);
    }
    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        return this.inner.pushOut(x, y, z, r, out);
    }
}

/** The query as it was on origin/main: one sweep over the whole 20 m. */
function wholeSweep(world: ContactWorld, s: ArrayLike<number>, bottom: number): number | null {
    const c0 = new Float64Array([s[S.px], s[S.py], s[S.pz]]);
    const c1 = new Float64Array([s[S.px], s[S.py] - 20, s[S.pz]]);
    const t = world.sweep(c0, c1, new Float64Array([0.05]), new Float64Array([0]), 1, { sphere: 0, nx: 0, ny: 0, nz: 0 });
    return t < 0 ? null : Math.max(0, t * 20 + 0.05 - bottom);
}

describe('ground below: a cheap look', () => {
    it('tests no sphere larger than the probe plus half a piece on a voxel world', () => {
        // a 30 m room of 5 cm voxels: its floor's top is at -14.95
        const world = new VoxelContactWorld(syntheticRoom(0.05, 15));
        let largest = 0;
        const overlap = world.overlap.bind(world);
        world.overlap = (x, y, z, r) => { largest = Math.max(largest, r); return overlap(x, y, z, r); };
        for (const h of [0.3, 3, 10]) {
            const got = G.groundClearance(world, stateAt(0.013, -14.95 + P.bodyBottom + h, -0.021), P);
            expect(got).not.toBeNull();
            expect(Math.abs((got as number) - h)).toBeLessThan(0.001);
        }
        expect(largest).toBeGreaterThan(0.05);
        expect(largest).toBeLessThanOrEqual(LARGEST_SPHERE_M);
    });

    it('goes down in pieces, stops at the first that touches and still reaches 20 m', () => {
        const near = new Counting(new FloorWorld());
        expect(G.groundClearance(near, stateAt(0, 0.3 + P.bodyBottom, 0), P)).toBeCloseTo(0.3, 9);
        expect(near.longest).toBeLessThanOrEqual(PIECE_M + 1e-9);
        expect(near.sweeps).toBeLessThanOrEqual(4);

        const high = new Counting(new FloorWorld());
        expect(G.groundClearance(high, stateAt(0, 19.9 + P.bodyBottom, 0), P)).toBeCloseTo(19.9, 9);
        expect(high.longest).toBeLessThanOrEqual(PIECE_M + 1e-9);

        const far = new Counting(new FloorWorld());
        expect(G.groundClearance(far, stateAt(0, 25, 0), P)).toBeNull();
        expect(far.longest).toBeLessThanOrEqual(PIECE_M + 1e-9);
        expect(far.sweeps).toBe(Math.round(20 / PIECE_M));
        expect(far.lowest).toBeCloseTo(5, 9);

        const open = new Counting(new VoxelContactWorld(syntheticOpen()));
        expect(G.groundClearance(open, stateAt(0, 0, 0), P)).toBeNull();
        expect(G.groundClearance(null, stateAt(0, 0, 0), P)).toBeNull();
    });

    it('answers as the whole sweep did, within the sweep\'s resolution', () => {
        // 10 cm voxels keep the whole sweep's 10 m cover sphere affordable in a test
        const world = new VoxelContactWorld(syntheticRoom(0.1, 15));
        let worst = 0;
        let n = 0;
        for (const x of [0.013, 1.237, -2.618]) {
            for (const dy of [0.02, 0.41, 2.3, 9.6, 17.7]) {
                const s = stateAt(x, -14.9 + dy, 0.5 - x);
                const a = wholeSweep(world, s, P.bodyBottom);
                const b = G.groundClearance(world, s, P);
                expect(a).not.toBeNull();
                expect(b).not.toBeNull();
                worst = Math.max(worst, Math.abs((a as number) - (b as number)));
                n++;
            }
        }
        expect(n).toBe(15);
        expect(worst).toBeLessThanOrEqual(0.00025);
    });
});

/** A centred pilot over a floor whose look costs `lookMs` of the page clock; reports come `perS` a second for `ms`. */
function flyReports(perS: number, ms: number, lookMs: number): { looks: number; handled: number; due: number; share: number } {
    const clock = { t: 0 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.t);
    const sim = new Sim(P, new FloorWorld());
    sim.reset(0, 1, 0, 0, { soc: 1 });
    let looks = 0;
    const pilot = new CentrePilot({
        sim: () => sim, paused: () => false,
        ground: () => { looks++; clock.t += lookMs; return 1; },
        mode: () => 'angle', speed: () => 'normal', toggleArm: () => true
    });
    const ch = new Float32Array([0, 0, 0, 0, -1, 0, 0, 0]);
    const out = new Float32Array(8);
    let handled = 0;
    while (clock.t < ms) {
        const due = Math.floor((clock.t * perS) / 1000) + 1;
        if (handled < due) {
            // one thread, as on the page: a report that is due is handled at the clock's time; the rest wait
            pilot.apply(ch, out, clock.t);
            handled++;
            clock.t += 0.01;
        } else clock.t = (due * 1000) / perS;
    }
    return { looks, handled, due: Math.floor((ms * perS) / 1000), share: (looks * lookMs) / ms };
}

describe('ground below: never one look per report', () => {
    it('a slow look (50 ms) at 1000 reports a second takes at most a fifth of the time', () => {
        const r = flyReports(1000, 2000, 50);
        // a look of 50 ms earns a rest of 200 ms: one look per 250 ms, 8 in 2 s
        expect(r.looks).toBeGreaterThanOrEqual(6);
        expect(r.looks).toBeLessThanOrEqual(9);
        expect(r.share).toBeLessThanOrEqual(0.23);
        expect(r.handled).toBeGreaterThanOrEqual(r.due - 60);
    });

    it('a slow look at 500 reports a second: the same bound', () => {
        const r = flyReports(500, 2000, 50);
        expect(r.looks).toBeLessThanOrEqual(9);
        expect(r.handled).toBeGreaterThanOrEqual(r.due - 30);
    });

    it('an instant look is made every 33 ms of input time, as before', () => {
        const r = flyReports(1000, 1000, 0);
        expect(r.looks).toBeGreaterThanOrEqual(28);
        expect(r.looks).toBeLessThanOrEqual(31);
        expect(r.handled).toBeGreaterThanOrEqual(r.due - 1);
    });
});

describe('GroundCache', () => {
    it('gives the last answer between looks and looks again after its time slice', () => {
        expect(typeof G.GroundCache).toBe('function');
        const c = new G.GroundCache(33, () => 0);
        let n = 0;
        const look = (): number => ++n;
        expect(c.ask(100, look)).toBe(1);
        for (let t = 101; t < 133; t++) expect(c.ask(t, look)).toBe(1);
        expect(c.ask(133, look)).toBe(2);
        expect(c.looks).toBe(2);
        expect(c.value).toBe(2);
    });

    it('reset and an input time that goes back both look at once', () => {
        expect(typeof G.GroundCache).toBe('function');
        const c = new G.GroundCache(33, () => 0);
        let n = 0;
        const look = (): number => ++n;
        c.ask(1000, look);
        expect(c.ask(5, look)).toBe(2); // a new source counts its time from the start again
        c.reset();
        expect(c.value).toBeNull();
        expect(c.ask(6, look)).toBe(3);
    });

    it('rests four times a look\'s own duration, and a clock that goes back owes nothing', () => {
        expect(typeof G.GroundCache).toBe('function');
        expect(G.GROUND_REST).toBe(4);
        let wall = 1000;
        const c = new G.GroundCache(33, () => wall);
        let n = 0;
        const look = (): number => { wall += 10; return ++n; };
        expect(c.ask(0, look)).toBe(1); // the look ended at 1010: rest until 1050
        wall = 1049;
        expect(c.ask(40, look)).toBe(1);
        wall = 1050;
        expect(c.ask(41, look)).toBe(2); // ended at 1060: rest until 1100
        wall = 20; // the page clock started again
        expect(c.ask(80, look)).toBe(3);
        expect(c.looks).toBe(3);
    });

    it('a quick look (under 8 ms) owes no rest: only the time slice counts', () => {
        expect(typeof G.GroundCache).toBe('function');
        expect(G.GROUND_SLOW_MS).toBe(8);
        let wall = 0;
        const c = new G.GroundCache(33, () => wall);
        let n = 0;
        const look = (): number => { wall += 7.9; return ++n; };
        // a harness faster than the clock: 100 slices of input time while the clock only moves by the looks themselves
        for (let i = 0; i < 100; i++) expect(c.ask(i * 33, look)).toBe(i + 1);
        expect(c.looks).toBe(100);
    });

    it('a look that took 60 s (a pause inside it) rests no longer than the cap', () => {
        expect(typeof G.GroundCache).toBe('function');
        const cap = 500;
        let wall = 0;
        const c = new G.GroundCache(33, () => wall);
        let n = 0;
        const look = (): number => { wall += n === 0 ? 60000 : 1; return ++n; };
        expect(c.ask(0, look)).toBe(1); // ended at 60000
        wall = 60000 + cap;
        expect(c.ask(40, look)).toBe(2);
        expect(c.looks).toBe(2);
    });
});
