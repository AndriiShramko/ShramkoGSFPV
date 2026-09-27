// B.5 unit: flight modes in the model (acro / angle / horizon on ch[5]), real Sim, no world.
// Every check runs a negative control that must fail it.
import { describe, expect, it } from 'vitest';
import { Sim, MODE_CHANNEL, setpointRate, Sha256 } from '../src/index';
import type { FlightMode, SimParams } from '../src/index';
import { S, params, hovering, roll, pitch, rate, tracer } from './model-helpers';

// ---------------------------------------------------------------- steady tilt table

/** Betaflight 4.5 angle mode, default ACTUAL 7/67/0 rates: 60 * setpoint(x) / setpoint(1) (research-physics (c)). */
const TILT_TABLE: [number, number][] = [[0.1, 1.2], [0.25, 4.9], [0.5, 16.6], [0.75, 34.9], [1.0, 60]];

function steadyTilt(p: SimParams, axis: 'roll' | 'pitch', x: number): number {
    const { sim, ch } = hovering(p, 'angle', 500);
    ch[axis === 'roll' ? 0 : 1] = x;
    sim.setChannels(ch);
    for (let i = 0; i < 2000; i++) sim.step();
    return axis === 'roll' ? roll(sim) : pitch(sim);
}

function tiltMisses(p: SimParams): string[] {
    const bad: string[] = [];
    for (const axis of ['roll', 'pitch'] as const) {
        for (const [x, want] of TILT_TABLE) {
            const got = steadyTilt(p, axis, x);
            if (!(Math.abs(got - want) <= 0.3)) bad.push(`${axis} ${x}: ${got.toFixed(2)} deg (want ${want})`);
        }
    }
    return bad;
}

describe('angle mode: the stick maps through the acro rate curve (Betaflight pidLevel)', () => {
    it('steady tilt at stick 0.1/0.25/0.5/0.75/1.0 held 2 s is 1.2/4.9/16.6/34.9/60 deg within 0.3 deg', () => {
        expect(tiltMisses(params())).toEqual([]);
    });

    it("control: v0.2's linear map (stick x 55 deg) fails the table", () => {
        // the same code path with limit 55 and a linear curve (670 deg/s * x) is exactly v0.2's x * 55
        const lin = { rcRate: 67, rate: 67, expo: 0 };
        const p = params('pavo20pro-3s', { level: { limitDeg: 55 }, rates: { type: 'ACTUAL', roll: lin, pitch: lin, yaw: lin, rateLimit: 1998 } });
        const quarter = steadyTilt(p, 'roll', 0.25);
        expect(quarter).toBeCloseTo(13.75, 1);
        expect(tiltMisses(p).length).toBeGreaterThanOrEqual(8);
    });
});

// ---------------------------------------------------------------- horizon

/** Bank the hovering craft to `deg` of right roll at rest (roll right = rotation about body z by -deg). */
function bank(sim: Sim, deg: number): void {
    const h = (-deg * Math.PI) / 360;
    sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = 0; sim.s[S.qy] = 0; sim.s[S.qz] = Math.sin(h);
    sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
}

function levelAfter(from: FlightMode, into: FlightMode, ms: number): number {
    const { sim, ch } = hovering(params(), from, 1500);
    bank(sim, 45);
    expect(roll(sim)).toBeCloseTo(45, 6);
    ch[5] = MODE_CHANNEL[into];
    sim.setChannels(ch);
    for (let i = 0; i < ms; i++) sim.step();
    return roll(sim);
}

/** Roll angle swept by 1 s of full right stick from a level hover. */
function fullStickSweep(mode: FlightMode): number {
    const { sim, ch } = hovering(params(), mode, 1000);
    ch[0] = 1;
    sim.setChannels(ch);
    let deg = 0;
    for (let i = 0; i < 1000; i++) { sim.step(); deg += rate(sim, 'roll') * 0.001; }
    return deg;
}

describe('horizon mode', () => {
    it('from a 45 deg bank with centred sticks it is within 3 deg of level after 1.5 s', () => {
        // flying horizon (level share already up) and entering horizon from acro (share rises over 500 ms)
        const inHorizon = levelAfter('horizon', 'horizon', 1500);
        const fromAcro = levelAfter('acro', 'horizon', 1500);
        expect(Math.abs(inHorizon)).toBeLessThan(3);
        expect(Math.abs(fromAcro)).toBeLessThan(3);
    });

    it('control: acro with centred sticks keeps the bank (the levelling comes from horizon)', () => {
        expect(levelAfter('acro', 'acro', 1500)).toBeGreaterThan(40);
    });

    it('full roll stick for 1 s rotates at least 90 % as far as acro', () => {
        const acro = fullStickSweep('acro');
        const horizon = fullStickSweep('horizon');
        expect(acro).toBeGreaterThan(600);
        expect(horizon / acro).toBeGreaterThanOrEqual(0.9);
    });

    it('control: angle mode fails the rotation check, because it stops at 60 deg', () => {
        const acro = fullStickSweep('acro');
        const angle = fullStickSweep('angle');
        expect(angle).toBeLessThan(61);
        expect(angle / acro).toBeLessThan(0.9);
    });
});

// ---------------------------------------------------------------- rate-loop feed-forward

/** Largest |feed-forward| on roll and pitch during a stick sweep (Pro II: F 41/51). */
function ffDuringSweep(mode: FlightMode): number {
    const { sim, ch } = hovering(params('pavo20pro2-3s'), mode, 500);
    let mx = 0;
    for (let i = 0; i < 1000; i++) {
        ch[0] = 0.6 * Math.sin((2 * Math.PI * i) / 400);
        ch[1] = 0.4 * Math.sin((2 * Math.PI * i) / 250);
        sim.setChannels(ch);
        sim.step();
        mx = Math.max(mx, Math.abs(sim.s[S.ffR]), Math.abs(sim.s[S.ffP]));
    }
    return mx;
}

describe('rate-loop feed-forward on self-levelled axes', () => {
    it('is exactly 0 on roll and pitch in angle mode', () => {
        expect(ffDuringSweep('angle')).toBe(0);
    });

    it('control: the same sweep in acro gives a non-zero feed-forward (and horizon keeps it, as Betaflight)', () => {
        expect(ffDuringSweep('acro')).toBeGreaterThan(1);
        expect(ffDuringSweep('horizon')).toBeGreaterThan(1);
    });
});

// ---------------------------------------------------------------- determinism across a mode change

/** 4 s script: acro roll, switch to angle mid-manoeuvre, horizon with pitch, back to acro. */
function script(tick: number, ch: number[]): void {
    const t = tick / 1000;
    ch[0] = t > 0.5 && t < 0.8 ? 0.5 : t > 1.2 && t < 1.6 ? -0.3 : 0;
    ch[1] = t > 2.1 && t < 2.6 ? 0.4 : 0;
    ch[3] = t > 3.2 && t < 3.5 ? 0.6 : 0;
    ch[5] = t < 1.0 ? MODE_CHANNEL.acro : t < 2.0 ? MODE_CHANNEL.angle : t < 3.0 ? MODE_CHANNEL.horizon : MODE_CHANNEL.acro;
}

function run(perturb: (() => number) | null, snapshotAt = -1, dropLevelSlots = false): { full: string; tail: string | null; copyTail: string | null } {
    const { sim, ch } = hovering(params(), 'acro', 300);
    sim.perturb = perturb;
    const t0 = sim.tick;
    const tr = tracer(sim);
    // after the snapshot both the original and a model rebuilt from its state alone hash every step
    const origBytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
    let origTail: Sha256 | null = null;
    let copy: Sim | null = null;
    let ctr: ReturnType<typeof tracer> | null = null;
    for (let k = 0; k < 4000; k++) {
        if (k === snapshotAt) {
            copy = new Sim(sim.p, null);
            copy.s.set(sim.s);
            copy.tick = sim.tick;
            copy.setChannels(sim.ch);
            if (dropLevelSlots) for (let i = S.lvR1; i <= S.tgP; i++) copy.s[i] = 0;
            ctr = tracer(copy);
            origTail = new Sha256();
        }
        script(sim.tick - t0, ch);
        sim.setChannels(ch);
        tr.step();
        origTail?.update(origBytes);
        if (copy && ctr) { copy.setChannels(ch); ctr.step(); }
    }
    return { full: tr.hex(), tail: origTail ? origTail.digestHex() : null, copyTail: ctr ? ctr.hex() : null };
}

describe('a mode change mid-air is deterministic and fully in the hashed state', () => {
    it('two runs of a flight with acro -> angle -> horizon -> acro give the same trace hash', () => {
        expect(run(null).full).toBe(run(null).full);
    });

    it('control: Math.random in the step changes the hash', () => {
        expect(run(Math.random).full).not.toBe(run(null).full);
    });

    it('a model rebuilt from the state alone, 10 ms after the switch to angle, continues with the same hash', () => {
        const r = run(null, 1010);
        expect(r.copyTail).not.toBeNull();
        expect(r.copyTail).toBe(r.tail);
    });

    it('control: dropping the self-level slots from that state changes the continuation', () => {
        const r = run(null, 1010, true);
        expect(r.copyTail).not.toBe(r.tail);
    });
});

// ---------------------------------------------------------------- no motor step at a mode switch

/** Largest per-tick change of any motor command in the 150 ms after switching `from` -> `into` at a 45 deg bank. */
function switchStep(from: FlightMode, into: FlightMode, p: SimParams): number {
    const { sim, ch } = hovering(p, from, 1000);
    bank(sim, 45);
    for (let i = 0; i < 200; i++) sim.step(); // acro holds the bank with centred sticks
    const prev = Float64Array.from(sim.motorCmd);
    ch[5] = MODE_CHANNEL[into];
    sim.setChannels(ch);
    let mx = 0;
    for (let i = 0; i < 150; i++) {
        sim.step();
        for (let m = 0; m < 4; m++) { mx = Math.max(mx, Math.abs(sim.motorCmd[m] - prev[m])); prev[m] = sim.motorCmd[m]; }
    }
    return mx;
}

// Only acro -> angle is checked. Into horizon the level share rises through its 500 ms PT1, so a
// variant without the PT3 steps no more (0.0004), and even without PT3 and delay the step stays
// below 0.2 (0.175 at 45 deg; the share is at most 0.75 x (1 - bank / 135)): its control cannot
// fire, so that check is not shipped (design B.5).
describe('switching into angle mode mid-air gives no motor-output step above 0.2 per tick', () => {
    it('acro -> angle at a 45 deg bank, sticks centred', () => {
        expect(switchStep('acro', 'angle', params())).toBeLessThanOrEqual(0.2);
    });

    it('control: without the 50 Hz PT3 on the level output the same switch steps above 0.2', () => {
        const raw = params();
        raw.levelOutputHz = 0;
        expect(switchStep('acro', 'angle', raw)).toBeGreaterThan(0.2);
    });

    it('the level setpoint is continuous with acro at the switch (the PT3 starts from the acro setpoint)', () => {
        const p = params();
        const { sim, ch } = hovering(p, 'acro', 500);
        ch[0] = 0.5;
        sim.setChannels(ch);
        for (let i = 0; i < 20; i++) sim.step();
        const acro = setpointRate(p.rates.type, 0.5, p.rates.roll, p.rates.rateLimit);
        expect(sim.s[S.lvR3]).toBeCloseTo(acro, 9);
    });
});
