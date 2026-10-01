// "Reset this group" on Drone & physics (review finding C2, W2-1): the group starts with
// drone.current, so the store must decide which drone the group's per-drone rows belong to before
// it resets drone.current. The pilot flies the Meteor and presses the button: the Meteor's tune
// goes back to its preset, the Pavo20's tune from last week stays.
// Control: the same reset done row by row without a context (what resetGroup did before the fix)
// resets the wrong drone, so the test can tell the two apart.
import { describe, expect, it } from 'vitest';
import { mkStore } from './helpers';

const PAVO = 'pavo20pro-3s';
const METEOR = 'meteor65pro-1s';

/** Tau 25 ms on the Pavo20, then the Meteor picked and tuned without naming it (ctx = the drone flown). */
function tuned() {
    const s = mkStore();
    s.set('physics.tauMs', 25, { drone: PAVO });
    s.set('drone.current', METEOR);
    s.set('physics.tauMs', 12);
    s.set('physics.dragScale', 1.5);
    return s;
}

describe('resetGroup(drone) without a context', () => {
    it('resets the drone flown now, keeps the other drone, and only then the drone choice', () => {
        const s = tuned();
        expect(s.get('physics.tauMs')).toBe(12);
        s.resetGroup('drone');
        expect(s.get('drone.current')).toBe(PAVO);
        expect(s.isExplicit('physics.tauMs', { drone: METEOR })).toBe(false);
        expect(s.isExplicit('physics.dragScale', { drone: METEOR })).toBe(false);
        expect(s.get('physics.tauMs', { drone: METEOR })).toBe(s.defaultOf('physics.tauMs', { drone: METEOR }));
        expect(s.get('physics.tauMs', { drone: PAVO })).toBe(25);
        expect(s.isExplicit('physics.tauMs', { drone: PAVO })).toBe(true);
    });

    it('with a context: the drone named, whichever drone is flown', () => {
        const s = tuned();
        s.resetGroup('drone', { drone: PAVO });
        expect(s.get('physics.tauMs', { drone: PAVO })).toBe(15);
        expect(s.get('physics.tauMs', { drone: METEOR })).toBe(12);
    });

    it('control: row by row without a context (the old loop) wipes the other drone and keeps this one', () => {
        const s = tuned();
        for (const d of s.schema.defs) if (d.group === 'drone') s.reset(d.id);
        expect(s.get('physics.tauMs', { drone: PAVO })).toBe(15);
        expect(s.isExplicit('physics.tauMs', { drone: PAVO })).toBe(false);
        expect(s.get('physics.tauMs', { drone: METEOR })).toBe(12);
    });
});
