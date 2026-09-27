// C.12 item 4 (C.7): crashes off. A 10 m/s wall hit is a bounce, the motors keep running.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/index';
import type { SimEvent } from '../src/index';
import { S, params, halfSpace, hovering } from './model-helpers';

/** Hovering 1 m in front of a wall (solid beyond z = -1), then flying into it at 10 m/s. */
function wallHit(crashOn: boolean): { sim: Sim; events: SimEvent[] } {
    const wall = halfSpace(0, 0, 1, -1); // solid where z < -1
    const { sim } = hovering(params('pavo20pro-3s', { crashOn }), 'angle', 500, wall);
    sim.s[S.pz] = 0;
    sim.s[S.vz] = -10; // nose-first into the wall
    const from = sim.events.length;
    for (let i = 0; i < 1000; i++) sim.step();
    return { sim, events: sim.events.slice(from) };
}

describe('C.12 item 4: crashOn false', () => {
    it('a 10 m/s wall hit gives 0 crash events and at least 1 bounce contact; still armed, motors running', () => {
        const { sim, events } = wallHit(false);
        expect(events.filter((e) => e.type === 'crash')).toEqual([]);
        const bounces = events.filter((e) => e.type === 'contact' && e.regime === 'bounce');
        expect(bounces.length).toBeGreaterThanOrEqual(1);
        expect((bounces[0] as { speed: number }).speed).toBeGreaterThan(sim.p.vCrash);
        expect(sim.armed).toBe(true);
        expect(sim.crashed).toBe(false);
        expect(sim.s[S.m0] + sim.s[S.m1] + sim.s[S.m2] + sim.s[S.m3]).toBeGreaterThan(0.4);
        // it bounced off: moving away from the wall, not through it
        expect(sim.s[S.pz]).toBeGreaterThan(-1);
    });

    it('control: crashOn true (the default) crashes on the same hit', () => {
        const { sim, events } = wallHit(true);
        expect(events.filter((e) => e.type === 'crash').length).toBe(1);
        expect(sim.crashed).toBe(true);
        expect(sim.armed).toBe(false);
    });

    it('crashOn is part of the compiled params (the config hash sees it), true by default', () => {
        expect(params().crashOn).toBe(true);
        expect(params('pavo20pro-3s', { crashOn: false }).crashOn).toBe(false);
        expect(JSON.parse(JSON.stringify({ crashOn: false }))).toEqual({ crashOn: false });
    });
});
