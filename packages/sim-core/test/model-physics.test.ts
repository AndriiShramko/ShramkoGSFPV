// H.5 and H.2 items 1, 3, 4: momentum drag, rotor-inertia yaw reaction, I-term windup, the Pavo20
// preset data. Real Sim, no world; every check has a negative control that must fail it.
// Targets: research-physics (c) (prototypes outside the Sim) and docs/architecture-v03.md H.5.
import { describe, expect, it } from 'vitest';
import { Sim, attitude, hoverSolve, invertRate, maxRate, setpointRate, throttleCurve, itermGain } from '../src/index';
import type { ParamOverrides, SimParams } from '../src/index';
import { S, params, hovering, rate } from './model-helpers';

const pro = (o: ParamOverrides = {}) => params('pavo20pro-3s', o);

/** Level in angle mode at hover throttle, then 10 m/s forward: seconds until 2 m/s. */
function coast(p: SimParams): number {
    const { sim } = hovering(p, 'angle', 1500);
    sim.s[S.vz] = -10;
    for (let i = 1; i <= 40000; i++) {
        sim.step();
        if (Math.hypot(sim.s[S.vx], sim.s[S.vz]) <= 2) return i / 1000;
    }
    return Infinity;
}

/** Angle mode cruise at 20 deg tilt, then a 90 deg yaw at half stick still holding pitch: seconds the sideslip stays above 30 deg. */
function skid(p: SimParams): number {
    const { sim, ch } = hovering(p, 'angle', 1500);
    // the pitch stick that asks for 20 deg through the rate curve
    ch[1] = invertRate(p.rates.type, (20 / p.level.limitDeg) * maxRate(p.rates, 'pitch'), p.rates.pitch, p.rates.rateLimit);
    sim.setChannels(ch);
    for (let i = 0; i < 8000; i++) sim.step();
    const yaw0 = attitude(sim.s).yaw;
    const wrap = (a: number) => ((a + 540) % 360) - 180;
    let turned = false, tEnd = -1, t30 = 0;
    for (let i = 1; i <= 15000; i++) {
        if (!turned && wrap(attitude(sim.s).yaw - yaw0) >= 90) { turned = true; tEnd = i; }
        ch[3] = turned ? 0 : 0.5;
        sim.setChannels(ch);
        sim.step();
        const vh = Math.hypot(sim.s[S.vx], sim.s[S.vz]);
        const slip = Math.abs(wrap((Math.atan2(sim.s[S.vx], -sim.s[S.vz]) * 180) / Math.PI - attitude(sim.s).yaw));
        if (turned && vh > 0.3 && slip > 30) t30 = (i - tEnd) / 1000;
    }
    return t30;
}

/** Full yaw stick step from hover in acro: overshoot of the peak rate over the setpoint, %. */
function yawOvershoot(p: SimParams): { overshootPct: number; t90ms: number } {
    const { sim, ch } = hovering(p, 'acro', 1500);
    ch[3] = 1;
    sim.setChannels(ch);
    const sp = setpointRate(p.rates.type, 1, p.rates.yaw, p.rates.rateLimit);
    let peak = 0, t90 = -1;
    for (let i = 1; i <= 400; i++) {
        sim.step();
        const r = rate(sim, 'yaw');
        if (r > peak) peak = r;
        if (t90 < 0 && r >= 0.9 * sp) t90 = i;
    }
    return { overshootPct: (peak / sp - 1) * 100, t90ms: t90 };
}

/** Full throttle, attitude held in acro at the pitch that keeps vy ~ 0 (bisection): km/h. */
function topSpeed(p: SimParams): number {
    const run = (deg: number) => {
        const { sim } = hovering(p, 'acro', 300);
        const th = (-deg * Math.PI) / 180;
        sim.s[S.qw] = Math.cos(th / 2); sim.s[S.qx] = Math.sin(th / 2); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
        sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
        sim.setChannels([0, 0, 1, 0, 1, -1, 0, 0]);
        for (let i = 0; i < 12000; i++) sim.step();
        let vy = 0, vh = 0;
        for (let i = 0; i < 1000; i++) { sim.step(); vy += sim.s[S.vy]; vh += Math.hypot(sim.s[S.vx], sim.s[S.vz]); }
        return { vy: vy / 1000, vh: vh / 1000 };
    };
    let lo = 30, hi = 89, r = run(60);
    for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        r = run(mid);
        if (r.vy > 0) lo = mid; else hi = mid;
    }
    return r.vh * 3.6;
}

/** Disarmed level free fall from rest for 30 s: m/s. */
function terminal(p: SimParams): number {
    const sim = new Sim(p, null);
    sim.reset(0, 1000, 0, 0);
    sim.s[S.hold] = 0;
    for (let i = 0; i < 30000; i++) sim.step();
    return -sim.s[S.vy];
}

describe('H.2 item 1: rotor and duct momentum drag (Pavo20 Pro, k = 0.6)', () => {
    it('coast from 10 to 2 m/s takes 1.8-3.0 s', () => {
        const t = coast(pro());
        expect(t).toBeGreaterThanOrEqual(1.8);
        expect(t).toBeLessThanOrEqual(3.0);
    });

    it('control: k = 0 (v0.2) takes about 18 s and fails', () => {
        const t = coast(pro({ ductDrag: 0 }));
        expect(t).toBeGreaterThan(15);
    });

    it('sideslip above 30 deg after a 90 deg yaw clears within 2 s', () => {
        expect(skid(pro())).toBeLessThanOrEqual(2);
    });

    it('control: k = 0 keeps the slide above 30 deg for about 3.8 s', () => {
        expect(skid(pro({ ductDrag: 0 }))).toBeGreaterThan(3);
    });

    it('top speed is 85-110 km/h (research: 94 predicted)', () => {
        const v = topSpeed(pro());
        expect(v).toBeGreaterThanOrEqual(85);
        expect(v).toBeLessThanOrEqual(110);
    });

    it('control: the band is tight enough to catch a body drag 3x too low (CdA x 0.3)', () => {
        expect(topSpeed(pro({ cdaScale: 0.3 }))).toBeGreaterThan(110);
    });

    it('disarmed terminal velocity is unchanged within 0.5 % (k on vs off, and vs sqrt(2 m g / (rho CdA)))', () => {
        const p = pro();
        const on = terminal(p), off = terminal(pro({ ductDrag: 0 }));
        const expected = Math.sqrt((2 * p.mass * p.gravity) / (p.rho * p.cda[1]));
        expect(Math.abs(on / off - 1)).toBeLessThanOrEqual(0.005);
        expect(Math.abs(on / expected - 1)).toBeLessThanOrEqual(0.005);
    });

    it('control: a 2 % larger vertical CdA moves it by more than 0.5 %', () => {
        expect(Math.abs(terminal(pro({ cdaScale: 1.02 })) / terminal(pro()) - 1)).toBeGreaterThan(0.005);
    });

    it('with the motors stopped the drag is exactly zero: a disarmed sideways glide is identical at k = 0.6 and k = 0', () => {
        const glide = (k: number) => {
            const sim = new Sim(pro({ ductDrag: k, gravity: 0 }), null);
            sim.reset(0, 0, 0, 0);
            sim.s[S.hold] = 0;
            sim.s[S.vx] = 8;
            for (let i = 0; i < 3000; i++) sim.step();
            return sim.s[S.vx];
        };
        expect(glide(0.6)).toBe(glide(0));
    });

    it('control: with the motors at hover the same glide loses far more speed at k = 0.6', () => {
        const glide = (k: number) => {
            const { sim } = hovering(pro({ ductDrag: k }), 'angle', 500);
            sim.s[S.vx] = 8;
            for (let i = 0; i < 3000; i++) sim.step();
            return Math.abs(sim.s[S.vx]);
        };
        expect(glide(0.6)).toBeLessThan(glide(0) * 0.5);
    });
});

describe('H.2 item 3: rotor-inertia yaw reaction (J_r = 2e-7 kg m^2)', () => {
    it('yaw full-step overshoot is at most 10 % (and the yaw reaches 90 % within 40 ms)', () => {
        const r = yawOvershoot(pro());
        expect(r.overshootPct).toBeLessThanOrEqual(10);
        expect(r.t90ms).toBeLessThanOrEqual(40);
    });

    it('control: J_r = 0 overshoots by about 30 % and fails', () => {
        expect(yawOvershoot(pro({ propInertia: 0 })).overshootPct).toBeGreaterThan(25);
    });

    it('equal speed changes of all four motors give no yaw (two CW, two CCW props)', () => {
        const { sim, ch } = hovering(pro(), 'acro', 1000);
        ch[2] = 1; // full throttle punch: every motor speeds up by the same amount
        sim.setChannels(ch);
        for (let i = 0; i < 60; i++) sim.step();
        expect(Math.abs(rate(sim, 'yaw'))).toBeLessThan(1);
    });
});

describe('H.2 item 4: I-term windup attenuation above 85 % of the motor-mix range', () => {
    it('the gain is 1 up to 0.85, fades linearly and is 0 from a saturated mix', () => {
        expect(itermGain(0.5, 0.85)).toBe(1);
        expect(itermGain(0.85, 0.85)).toBeCloseTo(1, 12);
        expect(itermGain(0.925, 0.85)).toBeCloseTo(0.5, 12);
        expect(itermGain(1.0, 0.85)).toBe(0);
        expect(itermGain(1.4, 0.85)).toBe(0);
    });

    it("control: v0.2's rule (windup 1) keeps the full gain at 0.925", () => {
        expect(itermGain(0.925, 1)).toBe(1);
        expect(itermGain(1.4, 1)).toBe(0);
    });

    /** Largest |I| on any axis during 300 ms of the given sticks from hover, and ticks with the mix in (0.85, 1). */
    function iPeak(windup: number, rollStick: number, yawStick: number): { peak: number; band: number } {
        const p = pro();
        p.itermWindup = windup;
        const { sim, ch } = hovering(p, 'acro', 500);
        ch[0] = rollStick; ch[3] = yawStick;
        sim.setChannels(ch);
        let peak = 0, band = 0;
        for (let i = 0; i < 300; i++) {
            sim.step();
            peak = Math.max(peak, Math.abs(sim.s[S.iR]), Math.abs(sim.s[S.iP]), Math.abs(sim.s[S.iY]));
            if (sim.s[S.mixRange] > 0.85 && sim.s[S.mixRange] < 1) band++;
        }
        return { peak, band };
    }

    it('a roll + full yaw punch puts the mix in the 85-100 % band, and less I builds up than with the v0.2 rule', () => {
        const now = iPeak(0.85, 0.5, 1), v02 = iPeak(1, 0.5, 1);
        expect(now.band).toBeGreaterThanOrEqual(5);
        expect(now.peak).toBeLessThan(v02.peak * 0.95);
    });

    it('control: a yaw-only punch never enters the band, and both rules build exactly the same I', () => {
        const now = iPeak(0.85, 0, 1), v02 = iPeak(1, 0, 1);
        expect(now.band).toBe(0);
        expect(now.peak).toBe(v02.peak);
    });
});

describe('H.1 preset data (Pavo20 Pro 3S / Pro II 3S)', () => {
    it('takes the manufacturer CLI tune, idle and battery weights', () => {
        const a = pro(), b = params('pavo20pro2-3s');
        expect([a.mass, b.mass]).toEqual([0.151, 0.158]);
        expect([a.idle, b.idle]).toEqual([0.1, 0.1]);
        expect(a.throttle).toEqual({ mid: 65, expo: 20 });
        expect(a.pid).toEqual({ roll: [54, 111, 44, 0], pitch: [68, 139, 60, 0], yaw: [54, 111, 0, 0] });
        expect(b.pid).toEqual({ roll: [51, 105, 46, 41], pitch: [64, 133, 63, 51], yaw: [51, 105, 0, 41] });
        expect([a.ductDrag, a.rotorInertia, b.ductDrag, b.rotorInertia]).toEqual([0.6, 2e-7, 0.6, 2e-7]);
        expect(maxRate(a.rates, 'yaw')).toBe(670);
    });

    it('every preset has the two new fields, labelled estimate, inside their own min/max', () => {
        for (const id of ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s']) {
            const p = params(id);
            expect(p.ductDrag).toBeGreaterThan(0.3);
            expect(p.ductDrag).toBeLessThan(1.5);
            expect(p.rotorInertia).toBeGreaterThan(0);
        }
    });

    it('hoverSolve().stick is the stick that hovers through the 65/20 throttle curve', () => {
        const p = pro();
        const h = hoverSolve(p, 1);
        expect(throttleCurve(h.stick, p.throttle)).toBeCloseTo(h.throttle, 9);
        const { sim, ch } = hovering(p, 'angle', 200);
        for (let i = 0; i < 4; i++) sim.s[S.m0 + i] = h.motor; // already spun up, as A4's hover check
        sim.s[S.vy] = 0;
        ch[2] = h.stick * 2 - 1;
        sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
        expect(Math.abs(sim.s[S.vy])).toBeLessThan(0.05);
    });

    it('control: the curve output used as the stick (v0.2 semantics) does not hover', () => {
        const p = pro();
        const h = hoverSolve(p, 1);
        const { sim, ch } = hovering(p, 'angle', 200);
        for (let i = 0; i < 4; i++) sim.s[S.m0 + i] = h.motor;
        sim.s[S.vy] = 0;
        ch[2] = h.throttle * 2 - 1;
        sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
        expect(sim.s[S.vy]).toBeGreaterThan(0.5);
    });
});

describe('auto-throttle gravity mode: centre stick hovers', () => {
    function centreStick(hoverThr: (p: SimParams) => number): number {
        const p = pro({ gravityMode: 'auto-throttle', gravity: 1.62 });
        const sim = new Sim(p, null);
        sim.reset(0, 100, 0, 0);
        sim.hoverThr = hoverThr(p);
        const ch = [0, 0, -1, 0, -1, 1, 0, 0];
        sim.setChannels(ch); sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        ch[2] = 0; // stick 0.5
        sim.setChannels(ch);
        for (let i = 0; i < 3000; i++) sim.step();
        return sim.s[S.vy];
    }

    it('with hoverThr = hoverSolve().motor (what session.ts sets) the craft holds altitude', () => {
        expect(Math.abs(centreStick((p) => hoverSolve(p, 1).motor))).toBeLessThan(0.05);
    });

    it("control: v0.2's mapping (the motor output fed in as the mixer throttle) climbs", () => {
        expect(centreStick((p) => p.idle + (1 - p.idle) * hoverSolve(p, 1).motor)).toBeGreaterThan(0.3);
    });
});
