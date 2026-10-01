// ArmGate.keepArmedAfterCrash (docs/architecture-v03.md C.3, owner's item 23: after a respawn the
// craft flies again with no switch flip). Every rule has its control: the same sequence without the
// option must want a new off -> on edge, as v0.2 did.
import { describe, expect, it } from 'vitest';
import { ArmGate } from '../src/calib';
import type { Profile } from '../src/calib';

const P = {} as Profile;
const ch = (thr: number, sw: number) => new Float32Array([0, 0, thr, 0, sw, -1, 0, 0]);
/** arm the usual way: switch seen OFF, sticks centred, throttle low, then ON */
function armed(g: ArmGate): void {
    expect(g.update(P, ch(-1, -1), 0, true, false)).toBe(-1);
    expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(1);
}

describe('ArmGate keepArmedAfterCrash', () => {
    it('switch kept on through a crash: armed again at the respawn, throttle up, no new edge', () => {
        const g = new ArmGate({ keepArmedAfterCrash: true });
        armed(g);
        // crash while flying at hover throttle: the gate passes the switch level on, block says crashed
        for (let i = 0; i < 50; i++) {
            expect(g.update(P, ch(0.1, 1), 0, true, true)).toBe(1);
            expect(g.block).toBe('crashed');
            expect(g.armed).toBe(false);
        }
        // respawn (crashed -> false) with the switch still on and the throttle at hover: armed at once
        expect(g.update(P, ch(0.1, 1), 0, true, false)).toBe(1);
        expect(g.block).toBe(null);
        expect(g.update(P, ch(0.4, 1), 0, true, false)).toBe(1);
    });

    it('control: without the option the same sequence stays disarmed until a new off -> on edge', () => {
        const g = new ArmGate();
        armed(g);
        for (let i = 0; i < 50; i++) expect(g.update(P, ch(0.1, 1), 0, true, true)).toBe(-1);
        expect(g.update(P, ch(0.1, 1), 0, true, false)).toBe(-1);
        expect(g.block).toBe('throttle');
        expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(-1);
        expect(g.block).toBe('switch');
        expect(g.update(P, ch(-1, -1), 0, true, false)).toBe(-1);
        expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(1);
    });

    it('switch off at the respawn: parked; the next arm wants the usual edge with throttle low', () => {
        const g = new ArmGate({ keepArmedAfterCrash: true });
        armed(g);
        g.update(P, ch(0.1, 1), 0, true, true);
        expect(g.update(P, ch(0.1, -1), 0, true, true)).toBe(-1); // pilot disarms during the crash
        expect(g.update(P, ch(0.1, -1), 0, true, false)).toBe(-1);
        expect(g.update(P, ch(0.1, 1), 0, true, false)).toBe(-1);
        expect(g.block).toBe('throttle');
        expect(g.update(P, ch(-1, -1), 0, true, false)).toBe(-1);
        expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(1);
    });

    it('switch flipped off and on again during the crash: still armed at the respawn (raw level)', () => {
        const g = new ArmGate({ keepArmedAfterCrash: true });
        armed(g);
        g.update(P, ch(0, 1), 0, true, true);
        expect(g.update(P, ch(0, -1), 0, true, true)).toBe(-1);
        expect(g.update(P, ch(0, 1), 0, true, true)).toBe(1);
        expect(g.update(P, ch(0, 1), 0, true, false)).toBe(1);
    });

    it('a hidden tab or a stale radio during the crash still disarms and wants a new edge (v0.2 rule)', () => {
        for (const [age, visible, why] of [[0, false, 'hidden'], [500, true, 'stale']] as const) {
            const g = new ArmGate({ keepArmedAfterCrash: true });
            armed(g);
            g.update(P, ch(0, 1), 0, true, true);
            expect(g.update(P, ch(0, 1), age, visible, true)).toBe(-1);
            expect(g.block).toBe(why);
            expect(g.update(P, ch(0, 1), 0, true, true)).toBe(-1); // back, still crashed: the hold is gone
            expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(-1);
            expect(g.block).toBe('switch');
        }
    });

    it('never armed before the crash: nothing is passed on (the option cannot arm a craft by itself)', () => {
        const g = new ArmGate({ keepArmedAfterCrash: true });
        // switch on from the start (never seen off) and a crashed craft: no output, no arm at the end
        for (let i = 0; i < 10; i++) expect(g.update(P, ch(-1, 1), 0, true, true)).toBe(-1);
        expect(g.update(P, ch(-1, 1), 0, true, false)).toBe(-1);
        expect(g.block).toBe('switch');
    });
});
