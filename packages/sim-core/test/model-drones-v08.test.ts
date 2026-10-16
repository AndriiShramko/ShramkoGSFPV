// v0.8 drones (docs/research/drones-v08.md, docs/wip/v08-d.md): the 5-inch freestyle quad, the 5-inch race
// quad and the X8 cinelifter with a cinema camera fly as their numbers say, and prop wash (wake.ts) acts on
// them and on nothing else. Every check has a negative control that must fail the same predicate.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, WAKE_HI, WAKE_LO, compileParams, hoverSolve, inducedVelocity, setpointRate, wakeIntensity, wakeNoise } from '../src/index';
import type { ParamOverrides, SimParams } from '../src/index';
import { PRESET_IDS, pitch, preset, roll, tracer } from './model-helpers';

const FREE = 'nazgulf5v3-6s', RACE = 'machr5sport-6s', CINE = 'taurusx8-komodo-6s';
const NEW = [FREE, RACE, CINE];
const OLD = PRESET_IDS.filter((id) => !NEW.includes(id));
const R2D = 180 / Math.PI;
const p = (id: string, o: ParamOverrides = {}): SimParams => compileParams(preset(id), o);
const field = (id: string, k: string): number => preset(id).fields[k].value as number;

/** Armed and hovering at (0, y, 0) in `mode` with the hover stick for `ms`. */
function hover(sp: SimParams, mode: 'acro' | 'angle', ms = 1500, y = 200): { sim: Sim; ch: number[]; stick: number } {
    const sim = new Sim(sp, null);
    sim.reset(0, y, 0, 0);
    const stick = hoverSolve(sp, 1).stick;
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL[mode], 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error('did not arm');
    ch[2] = stick * 2 - 1; sim.setChannels(ch);
    for (let i = 0; i < ms; i++) sim.step();
    return { sim, ch, stick };
}

/** Vertical speed after 8 s of full throttle from a hover, self-levelling, m/s. */
function climb(sp: SimParams): number {
    const { sim, ch } = hover(sp, 'angle');
    ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 8000; i++) sim.step();
    return sim.s[S.vy];
}

/** Level top speed, km/h: full throttle at the tilt where thrust just carries the weight (acos 1/TWR), 20 s. */
function topSpeedKmh(id: string, o: ParamOverrides = {}): number {
    const tilt = Math.acos(1 / p(id, o).twr) * R2D;
    const { sim, ch } = hover(p(id, { ...o, level: { limitDeg: tilt } }), 'angle');
    ch[1] = 1; ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 20000; i++) sim.step();
    return Math.sqrt(sim.s[S.vx] ** 2 + sim.s[S.vz] ** 2) * 3.6;
}

/** Acro roll response to a full stick, instant or with a thumb ramp: t63 (ms), overshoot (%), crossings of +-2 %. */
function rollStep(sp: SimParams, rampMs = 0): { t63: number; over: number; cross: number } {
    const { sim, ch } = hover(sp, 'acro');
    const target = setpointRate(sp.rates.type, 1, sp.rates.roll, sp.rates.rateLimit);
    const tr: number[] = [];
    let t63 = -1, t90 = -1, peak = 0;
    for (let i = 0; i < 900; i++) {
        ch[0] = rampMs > 0 ? Math.min(1, (i + 1) / rampMs) : 1;
        sim.setChannels(ch);
        sim.step();
        const r = -sim.s[S.wz] * R2D;
        tr.push(r);
        if (t63 < 0 && r >= 0.63 * target) t63 = i + 1;
        if (t90 < 0 && r >= 0.9 * target) t90 = i + 1;
        if (r > peak) peak = r;
    }
    let cross = 0, side = 0;
    for (let i = Math.max(0, t90); i < tr.length; i++) {
        const e = tr[i] - target;
        const sgn = e > 0.02 * target ? 1 : e < -0.02 * target ? -1 : 0;
        if (sgn !== 0 && side !== 0 && sgn !== side) cross++;
        if (sgn !== 0) side = sgn;
    }
    return { t63, over: (peak / target - 1) * 100, cross };
}

/**
 * Angle mode (everyone's default) on one axis (0 roll, 1 pitch): from a hover, the full stick with a thumb ramp
 * (`rampMs`), held 1.5 s, then released for 2.5 s. Peak tilt and its overshoot of the angle limit (%), crossings
 * of the limit +-2 % once near it, and how far (deg) the craft swings past level after the release.
 */
function angleStep(sp: SimParams, axis: 0 | 1, rampMs = 80): { peak: number; over: number; cross: number; pastLevel: number } {
    const { sim, ch } = hover(sp, 'angle');
    const tilt = (): number => (axis === 0 ? roll(sim) : pitch(sim));
    const lim = sp.level.limitDeg;
    let peak = 0, cross = 0, side = 0, held = 0;
    for (let i = 0; i < 1500; i++) {
        ch[axis] = Math.min(1, (i + 1) / rampMs);
        sim.setChannels(ch);
        sim.step();
        const a = Math.abs(tilt());
        if (a > peak) peak = a;
        const e = a - lim;
        const sgn = e > 0.02 * lim ? 1 : e < -0.02 * lim ? -1 : 0;
        if (a > 0.9 * lim) {
            if (sgn !== 0 && side !== 0 && sgn !== side) cross++;
            if (sgn !== 0) side = sgn;
        }
        held = tilt();
    }
    let pastLevel = 0;
    ch[axis] = 0;
    sim.setChannels(ch);
    for (let i = 0; i < 2500; i++) {
        sim.step();
        const back = -Math.sign(held) * tilt(); // > 0: on the other side of level
        if (back > pastLevel) pastLevel = back;
    }
    return { peak, over: (peak / lim - 1) * 100, cross, pastLevel };
}

/**
 * Prop wash's classic case: hover, motors to idle for `dropMs` (the craft falls), then the stick at `catchX` x
 * the hover stick (1.3: catch it gently, which keeps it sinking through its wake). Height lost after the catch,
 * the peak wash intensity, and a hash of the whole state trace.
 */
function dropAndCatch(sp: SimParams, dropMs = 2000, catchX = 1.3): { lost: number; peakWash: number; hash: string; rmsRate: number } {
    const { sim, ch, stick } = hover(sp, 'angle');
    const t = tracer(sim);
    ch[2] = -1; sim.setChannels(ch);
    for (let i = 0; i < dropMs; i++) t.step();
    const y0 = sim.s[S.py];
    ch[2] = Math.min(1, stick * catchX) * 2 - 1; sim.setChannels(ch);
    let yMin = y0, peakWash = 0, rr = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
        t.step();
        if (sim.s[S.py] < yMin) yMin = sim.s[S.py];
        if (sim.washNow > peakWash) peakWash = sim.washNow;
        if (sim.washNow > 0.05) { rr += sim.s[S.wz] ** 2 + sim.s[S.wx] ** 2; n++; }
    }
    return { lost: y0 - yMin, peakWash, hash: t.hex(), rmsRate: n ? Math.sqrt(rr / n) * R2D : 0 };
}

describe('v0.8 presets: the published numbers add up', () => {
    /** all-up weight = dry weight + pack (+ camera payload), within 1 g */
    const sumsUp = (id: string, payloadKey = 'payload_g'): boolean => {
        const f = preset(id).fields;
        const payload = f[payloadKey] ? (f[payloadKey].value as number) : 0;
        return Math.abs(field(id, 'dry_mass_g') + field(id, 'battery_mass_g') + payload - field(id, 'auw_g')) <= 1;
    };

    it('each all-up weight is the maker\'s dry weight + pack (+ the cinelifter\'s 2 kg camera)', () => {
        expect(NEW.filter((id) => !sumsUp(id))).toEqual([]);
        expect(field(CINE, 'auw_g')).toBe(4872);
        expect([field(FREE, 'auw_g'), field(RACE, 'auw_g')]).toEqual([736, 525]);
    });

    it('control: the cinelifter without its camera does not add up', () => {
        expect(sumsUp(CINE, 'no_such_field')).toBe(false);
    });

    it('thrust-to-weight: race > freestyle > cinelifter, and the model makes exactly the preset\'s TWR at the nominal voltage', () => {
        const twr = (id: string) => (4 * p(id).tmaxMotorNom) / (p(id).mass * 9.81);
        expect(twr(RACE)).toBeCloseTo(12.5, 9);
        expect(twr(FREE)).toBeCloseTo(8, 9);
        expect(twr(CINE)).toBeCloseTo(3.3, 9);
        // control: an override reaches the same number (the check reads the model, not the file)
        expect((4 * p(CINE, { twr: 2.5 }).tmaxMotorNom) / (p(CINE).mass * 9.81)).toBeCloseTo(2.5, 9);
    });

    it('every new preset is its own drone with the fields the picker and the catalogue show', () => {
        for (const id of NEW) {
            const pj = preset(id);
            expect(pj.id).toBe(id);
            for (const k of ['twr', 'auw_g', 'wheelbase_mm', 'motor', 'battery', 'prop', 'prop_diameter_mm', 'wake_loss', 'wake_shake']) expect(pj.fields[k], `${id}.${k}`).toBeDefined();
            expect(/(\d+)\s*-?\s*blade/i.test(String(pj.fields.prop.value)), `${id} prop names its blades (the motor sound reads it)`).toBe(true);
        }
    });
});

describe('v0.8 presets fly like a race quad, a freestyle quad and a heavy cinelifter', () => {
    const bands: Record<string, [number, number]> = { [RACE]: [0.12, 0.24], [FREE]: [0.18, 0.32], [CINE]: [0.35, 0.55] };
    const inBand = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;

    it('hover throttle: race 12-24 %, freestyle 18-32 %, cinelifter 35-55 % (fresh pack)', () => {
        for (const id of NEW) expect(inBand(hoverSolve(p(id), 1).throttle, bands[id]), `${id} ${hoverSolve(p(id), 1).throttle}`).toBe(true);
    });

    it('control: each band refuses the other two drones', () => {
        for (const id of NEW) for (const other of NEW) if (other !== id) expect(inBand(hoverSolve(p(other), 1).throttle, bands[id]), `${other} in ${id}'s band`).toBe(false);
    });

    it('hover current gives the makers\' hover times on 85 % of the pack: cinelifter 4.5-7 min (iFlight 5.5), freestyle 10-16 min (iFlight 12-13)', () => {
        const minutes = (id: string) => {
            const { sim } = hover(p(id), 'angle', 3000);
            return ((0.85 * field(id, 'battery_capacity_mah')) / 1000 / sim.s[S.amps]) * 60;
        };
        const cine = minutes(CINE), free = minutes(FREE);
        expect(cine).toBeGreaterThan(4.5);
        expect(cine).toBeLessThan(7);
        expect(free).toBeGreaterThan(10);
        expect(free).toBeLessThan(16);
        // control: the default whoop's hover time (8 min) is not a cinelifter's
        expect(minutes('pavo20pro-3s')).toBeGreaterThan(7);
    });

    it('climb after 8 s of full throttle: race 45-60 m/s > freestyle 35-48 > cinelifter 18-30', () => {
        const r = climb(p(RACE)), f = climb(p(FREE)), c = climb(p(CINE));
        expect(r).toBeGreaterThan(45); expect(r).toBeLessThan(60);
        expect(f).toBeGreaterThan(35); expect(f).toBeLessThan(48);
        expect(c).toBeGreaterThan(18); expect(c).toBeLessThan(30);
        expect(r).toBeGreaterThan(f);
        expect(f).toBeGreaterThan(c);
    });

    it('control: the cinelifter with a 5-inch thrust-to-weight (8) climbs out of its band', () => {
        expect(climb(p(CINE, { twr: 8 }))).toBeGreaterThan(30);
    });

    it('level top speed: race 160-195 km/h > freestyle 135-165 > cinelifter 90-115', () => {
        const r = topSpeedKmh(RACE), f = topSpeedKmh(FREE), c = topSpeedKmh(CINE);
        expect(r).toBeGreaterThan(160); expect(r).toBeLessThan(195);
        expect(f).toBeGreaterThan(135); expect(f).toBeLessThan(165);
        expect(c).toBeGreaterThan(90); expect(c).toBeLessThan(115);
    });

    it('control: the race quad with twice the drag falls below its top-speed band', () => {
        expect(topSpeedKmh(RACE, { cdaScale: 2 })).toBeLessThan(160);
    });

    it('roll: the 5-inch quads reach 63 % of a full-stick rate within 20 ms, the cinelifter takes over 35 ms (inertia, 50 ms motors)', () => {
        expect(rollStep(p(RACE)).t63).toBeLessThanOrEqual(20);
        expect(rollStep(p(FREE)).t63).toBeLessThanOrEqual(20);
        expect(rollStep(p(CINE)).t63).toBeGreaterThan(35);
    });

    it('control: the freestyle quad with the cinelifter\'s 50 ms motors is slower than 20 ms', () => {
        expect(rollStep(p(FREE, { tauMs: 50 })).t63).toBeGreaterThan(20);
    });

    it('the cinelifter\'s own tune rolls cleanly on a thumb-paced stick (80 ms): overshoot <= 12 %, at most one crossing', () => {
        const r = rollStep(p(CINE), 80);
        expect(r.over).toBeLessThanOrEqual(12);
        expect(r.cross).toBeLessThanOrEqual(1);
    });

    it('control: with Betaflight\'s default PID the cinelifter overshoots more than 15 % with ringing (why it has its own tune)', () => {
        const r = rollStep(p(CINE, { pid: { roll: [45, 80, 40, 120] } }), 80);
        expect(r.over).toBeGreaterThan(15);
        expect(r.cross).toBeGreaterThan(1);
    });

    it('the cinelifter flies cinema rates (350 deg/s roll, 300 yaw), the 5-inch quads Betaflight\'s 670', () => {
        const max = (id: string, ax: 'roll' | 'yaw') => setpointRate(p(id).rates.type, 1, p(id).rates[ax], p(id).rates.rateLimit);
        expect([max(CINE, 'roll'), max(CINE, 'yaw')]).toEqual([350, 300]);
        expect([max(RACE, 'roll'), max(FREE, 'roll')]).toEqual([670, 670]);
    });
});

describe('angle mode, everyone\'s default (review R4): full stick with a thumb ramp, hold, release', () => {
    const clean = (r: ReturnType<typeof angleStep>) => r.over < 5 && r.cross === 0 && r.pastLevel < 1;

    it('the three new drones and the default whoop stop at the angle limit (overshoot < 5 %, no crossing) and return to level without swinging past it (< 1 deg), on roll and pitch', () => {
        for (const id of [...NEW, 'pavo20pro-3s']) {
            for (const axis of [0, 1] as const) {
                const r = angleStep(p(id), axis);
                expect(clean(r), `${id} axis ${axis}: ${JSON.stringify(r)}`).toBe(true);
                expect(r.peak, `${id} reaches its limit`).toBeGreaterThan(0.95 * p(id).level.limitDeg);
            }
        }
    });

    it('the cinelifter keeps it clean for a fast and a slow thumb (0 and 200 ms ramps)', () => {
        for (const ramp of [0, 200]) expect(clean(angleStep(p(CINE), 0, ramp)), `ramp ${ramp}`).toBe(true);
    });

    it('control: the cinelifter at Betaflight\'s default angle feed-forward (50) overshoots the limit and swings past level (why its preset sets 30)', () => {
        const r = angleStep(p(CINE, { level: { ffGain: 0.5 } }), 0);
        expect(clean(r)).toBe(false);
        expect(r.over).toBeGreaterThan(5);
        expect(r.pastLevel).toBeGreaterThan(3);
        expect(p(CINE).level.ffGain).toBe(0.3);
    });

    it('a preset sets only the angle feed-forward pair; only the cinelifter does, the others fly Betaflight\'s level defaults (A6 unchanged)', () => {
        expect(PRESET_IDS.filter((id) => preset(id).fields.level !== undefined)).toEqual([CINE]);
        for (const id of OLD) expect(p(id).level).toEqual(compileParams(preset(id), { level: {} }).level);
        expect(p('pavo20pro-3s').level.ffGain).toBe(0.5);
        // the pilot's override still wins over the preset
        expect(p(CINE, { level: { ffGain: 0.4 } }).level.ffGain).toBe(0.4);
    });

    it('control: a preset that sets a level number the pilot owns (angle_limit) or an unknown one is refused', () => {
        const withLevel = (value: unknown) => {
            const c = structuredClone(preset(CINE));
            c.fields.level = { ...c.fields.level, value };
            return c;
        };
        expect(() => compileParams(withLevel({ angle_limit: 45 }))).toThrow(/angle_limit is not a level number a preset sets/);
        expect(() => compileParams(withLevel({ angle_feedforwrd: 30 }))).toThrow(/not a level number/);
        expect(() => compileParams(withLevel({ angle_feedforward: -1 }))).toThrow(/>= 0/);
        expect(() => compileParams(withLevel(30))).toThrow(/must be an object/);
        expect(compileParams(withLevel({ angle_feedforward: 30, angle_feedforward_smoothing_ms: 120 })).level.ffSmoothMs).toBe(120);
    });
});

describe('prop wash (wake.ts)', () => {
    it('the intensity is 0 outside the vortex-ring band, 1 in its middle, and fades with sideways speed', () => {
        const vi = 10;
        expect(wakeIntensity(WAKE_LO * vi, 0, vi)).toBe(0);
        expect(wakeIntensity(WAKE_HI * vi, 0, vi)).toBe(0);
        expect(wakeIntensity(-5, 0, vi)).toBe(0); // climbing
        expect(wakeIntensity(5, 0, 0)).toBe(0); // no thrust, no wake
        expect(wakeIntensity(((WAKE_LO + WAKE_HI) / 2) * vi, 0, vi)).toBeCloseTo(1, 12);
        const mid = ((WAKE_LO + WAKE_HI) / 2) * vi;
        expect(wakeIntensity(mid, vi, vi)).toBeCloseTo(0.2, 12); // 1 / (1 + 4)
        expect(wakeIntensity(mid, 2 * vi, vi)).toBeLessThan(wakeIntensity(mid, vi, vi));
        // control: off the middle it is below 1
        expect(wakeIntensity(0.5 * vi, 0, vi)).toBeLessThan(0.9);
    });

    it('the induced velocity is momentum theory\'s sqrt(T / (2 rho A)), e.g. the cinelifter in a hover: about 12 m/s', () => {
        const c = p(CINE);
        expect(inducedVelocity(2 * 1.225 * 3, 1.225, 3)).toBeCloseTo(1, 12);
        expect(inducedVelocity(c.mass * 9.81, c.rho, c.wakeArea)).toBeGreaterThan(11);
        expect(inducedVelocity(c.mass * 9.81, c.rho, c.wakeArea)).toBeLessThan(13.5);
        expect(inducedVelocity(0, 1.225, 1)).toBe(0);
    });

    it('the six whoop presets have no prop wash: their flight is the same whatever the wash multiplier says', () => {
        for (const id of OLD) {
            const c = p(id);
            expect([c.wakeLoss, c.wakeShake, c.wakeArea], id).toEqual([0, 0, 0]);
        }
        const a = dropAndCatch(p('pavo20pro-3s'), 1000);
        const b = dropAndCatch(p('pavo20pro-3s', { wake: 2 }), 1000);
        expect(b.hash).toBe(a.hash);
        expect(a.peakWash).toBe(0);
    });

    it('control: on the freestyle quad the multiplier changes the flight', () => {
        expect(dropAndCatch(p(FREE, { wake: 2 }), 1000).hash).not.toBe(dropAndCatch(p(FREE), 1000).hash);
    });

    it('dropping and catching it gently sinks every new drone at least 20 % deeper through its wake, and shakes it', () => {
        for (const id of NEW) {
            const on = dropAndCatch(p(id)), off = dropAndCatch(p(id, { wake: 0 }));
            expect(on.peakWash, id).toBeGreaterThan(0.9);
            expect(on.lost / off.lost, `${id}: ${on.lost.toFixed(2)} vs ${off.lost.toFixed(2)} m`).toBeGreaterThan(1.2);
            expect(on.rmsRate, id).toBeGreaterThan(1);
            // control: with the wash off nothing reads a wake
            expect(off.peakWash, id).toBe(0);
        }
    });

    it('a full-throttle punch-out leaves the wake at once (the thrust makes v_i large): under 15 % more height lost', () => {
        for (const id of NEW) {
            const on = dropAndCatch(p(id), 2000, 10), off = dropAndCatch(p(id, { wake: 0 }), 2000, 10);
            expect(on.lost / off.lost, id).toBeLessThan(1.15);
        }
    });

    it('is deterministic: the same flight twice gives the same trace, and the turbulence is a function of the tick', () => {
        expect(dropAndCatch(p(CINE), 800).hash).toBe(dropAndCatch(p(CINE), 800).hash);
        expect(wakeNoise(0, 12345)).toBe(wakeNoise(0, 12345));
        // control: another axis or tick is another value
        expect(wakeNoise(1, 12345)).not.toBe(wakeNoise(0, 12345));
        expect(wakeNoise(0, 12346)).not.toBe(wakeNoise(0, 12345));
    });

    it('a preset with prop wash must give its prop diameter; a negative multiplier is refused', () => {
        const pj = preset(FREE);
        const { prop_diameter_mm: _gone, ...fields } = pj.fields;
        void _gone;
        expect(() => compileParams({ ...pj, fields })).toThrow(/prop_diameter_mm/);
        expect(() => p(FREE, { wake: -1 })).toThrow(RangeError);
        // control: without the wash fields the diameter is not needed
        const { wake_loss: _l, wake_shake: _s, prop_diameter_mm: _d, ...plain } = pj.fields;
        void _l; void _s; void _d;
        expect(compileParams({ ...pj, fields: plain }).wakeLoss).toBe(0);
    });
});
