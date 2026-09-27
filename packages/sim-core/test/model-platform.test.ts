// C.12 items 1-3 and C.8 (sim side): the invisible one-way platform, respawning armed, the battery
// option. Real Sim, synthetic worlds; every check has a negative control that must fail it.
import { describe, expect, it } from 'vitest';
import { Sim, hoverSolve } from '../src/index';
import type { ContactWorld, RespawnOpts } from '../src/index';
import { PlatformContact } from '../src/platform';
import { S, params, frame, halfSpace } from './model-helpers';

const SPAWN: [number, number, number] = [2, 10, -3];

/** Respawned at SPAWN (above empty space, or `world`), then armed by a fresh switch edge at idle. */
function onPlatform(opts: RespawnOpts, world: ContactWorld | null = null): Sim {
    const sim = new Sim(params(), world);
    sim.respawn(SPAWN[0], SPAWN[1], SPAWN[2], 30, opts);
    const ch = frame(0, false, 'angle');
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    expect(sim.armed).toBe(true);
    return sim;
}

describe('C.12 item 1: the platform holds a craft at the spawn', () => {
    it('armed at idle it stays within 5 mm for 5 s, and once settled it produces no contact events', () => {
        const sim = onPlatform({ platform: true });
        const y0 = sim.s[S.py];
        let worst = 0;
        for (let i = 0; i < 5000; i++) { sim.step(); worst = Math.max(worst, Math.abs(sim.s[S.py] - y0)); }
        expect(worst).toBeLessThan(0.005);
        expect(sim.s[S.platOn]).toBe(1);
        // the top sits 2 mm under the lowest body point: one settling touch, then quiet (C.2)
        const late = sim.events.filter((e) => e.type === 'contact' && e.tick > sim.tick - 4500);
        expect(late).toEqual([]);
        expect(sim.events.filter((e) => e.type === 'crash')).toEqual([]);
    });

    it('control: the same rest on a scene floor with the 1 mm skin chatters (a contact every few ms)', () => {
        // the floor where the platform top would be: the body falls back 1 mm onto it again and again
        const probe = new Sim(params(), null);
        probe.reset(SPAWN[0], SPAWN[1], SPAWN[2], 30, { platform: true });
        const floor = halfSpace(0, 1, 0, probe.s[S.platY]);
        const sim = onPlatform({}, floor);
        for (let i = 0; i < 5000; i++) sim.step();
        const late = sim.events.filter((e) => e.type === 'contact' && e.tick > sim.tick - 4500);
        expect(late.length).toBeGreaterThan(50);
    });

    it('hover + 10 % lifts off; the platform stays on below +1 m and is off above it', () => {
        const sim = onPlatform({ platform: true });
        for (let i = 0; i < 500; i++) sim.step();
        const ch = frame(hoverSolve(sim.p, 1).stick + 0.1, true, 'angle');
        sim.setChannels(ch);
        let offAt = NaN;
        let onAtHalf = false;
        for (let i = 0; i < 5000 && Number.isNaN(offAt); i++) {
            sim.step();
            const up = sim.s[S.py] - sim.s[S.platY];
            if (up > 0.5 && up < 0.9 && sim.s[S.platOn] === 1) onAtHalf = true;
            if (sim.s[S.platOn] === 0) offAt = up;
        }
        expect(onAtHalf).toBe(true);
        expect(offAt).toBeGreaterThan(1.0);
        expect(offAt).toBeLessThan(1.02);
    });

    it('control: without the platform the craft falls at least 1 m in 0.5 s', () => {
        const sim = onPlatform({});
        const y0 = sim.s[S.py];
        for (let i = 0; i < 500; i++) sim.step();
        expect(y0 - sim.s[S.py]).toBeGreaterThanOrEqual(1);
        expect(sim.s[S.platOn]).toBe(0);
    });

    it('the top is the spawn minus the lowest body point (30 mm on the Pavo20) minus 2 mm; radius 0.4 m', () => {
        const sim = new Sim(params(), null);
        sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], 0, { platform: true });
        expect(sim.p.bodyBottom).toBeCloseTo(0.03, 12);
        expect(sim.s[S.platY]).toBeCloseTo(SPAWN[1] - 0.032, 12);
        expect(sim.s[S.platR]).toBe(0.4);
        sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], 0, { platform: true, platformR: 0.7 });
        expect(sim.s[S.platR]).toBe(0.7);
        sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], 0);
        expect(sim.s[S.platOn]).toBe(0);
    });
});

/** A disarmed craft thrown upwards from 0.3 m under the platform top; returns its highest point relative to the top. */
function throwUp(world: ContactWorld | null, platform: boolean): { peak: number; end: number; top: number } {
    const sim = new Sim(params(), world);
    sim.reset(SPAWN[0], SPAWN[1], SPAWN[2], 0, platform ? { platform: true } : {});
    const top = platform ? sim.s[S.platY] : SPAWN[1] - 0.032;
    sim.s[S.hold] = 0;
    sim.s[S.py] = top - 0.3;
    sim.s[S.vy] = 3.5;
    let peak = -Infinity;
    for (let i = 0; i < 1500; i++) { sim.step(); peak = Math.max(peak, sim.s[S.py] - top); }
    return { peak, end: sim.s[S.py] - top, top };
}

describe('C.12 item 2: the platform is one-way', () => {
    it('a craft moving up from below passes through, then lands on it from above', () => {
        const r = throwUp(null, true);
        expect(r.peak).toBeGreaterThan(0.2);
        // back down it lands on the top: the centre ends about one duct radius (30 mm) above it
        expect(r.end).toBeGreaterThan(0.025);
        expect(r.end).toBeLessThan(0.05);
    });

    it('control: a two-way disc at the same place blocks it from below', () => {
        const disc = new PlatformContact({ oneWay: false }).set(null, SPAWN[0], SPAWN[1] - 0.032, SPAWN[2], 0.4);
        const r = throwUp(disc, false);
        expect(r.peak).toBeLessThan(-0.02);
        // and without any platform it flies just as high as through the one-way one
        expect(throwUp(null, false).peak).toBeGreaterThan(0.2);
    });

    it("sim.contactWorld includes the disc while it is on (the respawn director's touch query sees a craft resting on it)", () => {
        const sim = onPlatform({ platform: true });
        for (let i = 0; i < 1000; i++) sim.step();
        const o = { x: 0, y: 0, z: 0 };
        const w = sim.contactWorld;
        expect(w).not.toBeNull();
        expect(w!.pushOut(sim.s[S.px], sim.s[S.py], sim.s[S.pz], sim.p.boundRadius + 0.02, o)).toBe(true);
    });

    it('control: with no platform (and no scene) there is nothing to touch', () => {
        const sim = onPlatform({});
        expect(sim.contactWorld).toBeNull();
    });

    it('pushOut only lifts a sphere whose centre is above the top', () => {
        const disc = new PlatformContact().set(null, 0, 0, 0, 0.4);
        const o = { x: 0, y: 0, z: 0 };
        expect(disc.pushOut(0, 0.01, 0, 0.03, o)).toBe(true);
        expect(o.y).toBeCloseTo(0.02, 12);
        expect(disc.pushOut(0, -0.01, 0, 0.03, o)).toBe(false);
        expect(disc.pushOut(0.5, 0.01, 0, 0.03, o)).toBe(false);
    });
});

describe('C.12 item 3: keepArmed', () => {
    function crashedThenRespawn(opts: RespawnOpts, switchOn: boolean): Sim {
        const sim = new Sim(params(), null);
        sim.reset(0, 50, 0, 0);
        const ch = frame(0, false, 'angle');
        sim.setChannels(ch); sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        ch[2] = 0.2; sim.setChannels(ch);
        for (let i = 0; i < 300; i++) sim.step();
        sim.s[S.crashed] = 1; sim.s[S.armed] = 0; // as the contact code leaves a crashed craft
        ch[4] = switchOn ? 1 : -1;
        sim.setChannels(ch);
        sim.respawn(0, 50, 0, 0, opts);
        return sim;
    }

    it('switch on: armed at the respawn tick, and the throttle reaches the motors on the next tick', () => {
        const sim = crashedThenRespawn({ platform: true, keepArmed: true }, true);
        const tick = sim.tick;
        expect(sim.armed).toBe(true);
        expect(sim.crashed).toBe(false);
        expect(sim.s[S.hold]).toBe(0);
        expect(sim.events.filter((e) => e.tick === tick).map((e) => e.type)).toEqual(['respawn', 'arm']);
        sim.step();
        expect(sim.armed).toBe(true);
        // throttle stick 0.6: the mixer commands idle + (1 - idle) * curve(0.6), and the motors start to follow
        expect(sim.motorCmd[0]).toBeGreaterThan(0.5);
        expect(sim.s[S.m0]).toBeGreaterThan(0);
    });

    it('switch off: parked until a fresh arm edge', () => {
        const sim = crashedThenRespawn({ platform: true, keepArmed: true }, false);
        expect(sim.armed).toBe(false);
        expect(sim.s[S.hold]).toBe(1);
    });

    it('control: keepArmed false with the switch on stays disarmed (v0.2 behaviour), also after steps', () => {
        const sim = crashedThenRespawn({ platform: true }, true);
        expect(sim.armed).toBe(false);
        for (let i = 0; i < 100; i++) sim.step();
        expect(sim.armed).toBe(false);
        expect(sim.motorCmd[0]).toBe(0);
    });
});

describe('C.8: the battery travels as RespawnOpts.soc', () => {
    function drained(): Sim {
        const sim = new Sim(params(), null);
        sim.reset(0, 50, 0, 0);
        sim.s[S.soc] = 0.4;
        return sim;
    }

    it('soc 1 gives a fresh pack (and its open-circuit voltage)', () => {
        const sim = drained();
        sim.respawn(0, 50, 0, 0, { soc: 1 });
        expect(sim.s[S.soc]).toBe(1);
        expect(sim.s[S.volt]).toBeCloseTo(3 * 4.2, 12);
    });

    it('control: without soc the drained pack is kept, as v0.2 did on every respawn', () => {
        const sim = drained();
        sim.respawn(0, 50, 0, 0);
        expect(sim.s[S.soc]).toBe(0.4);
        sim.reset(0, 50, 0, 0, { platform: true });
        expect(sim.s[S.soc]).toBe(0.4);
    });

    it('a new model starts full; soc is clamped to 0..1', () => {
        const sim = new Sim(params(), null);
        expect(sim.s[S.soc]).toBe(1);
        sim.respawn(0, 0, 0, 0, { soc: 1.7 });
        expect(sim.s[S.soc]).toBe(1);
        sim.respawn(0, 0, 0, 0, { soc: -0.2 });
        expect(sim.s[S.soc]).toBe(0);
    });
});
