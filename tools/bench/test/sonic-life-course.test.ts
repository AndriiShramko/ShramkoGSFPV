// sonic3 S3 pass 3 (Tunis, a course by sound never counted): a crash or a stuck craft that the respawn director sends back to
// the start puts the craft at the course's start, so the course by sound starts its attempt again from the first gate
// (apps/fly/src/sonic/mode.ts lifeRestartsCourse, called by feature.ts on 'life'). Before, the runner kept its gate and the
// hum led 86 m through Tunis' walls to it. A life put back where it was keeps the gate; R and the mode's own place
// ('manual-start') never restart it here (the mode handles R itself, and its place would loop).
// The namespace import keeps the control an assertion: on the old mode.ts the function is missing and every case fails.
import { describe, expect, it } from 'vitest';
import * as Mode from '../../../apps/fly/src/sonic/mode';

type Last = { tick: number; kind: 'rewind' | 'start'; sampleTick: number | null } | null;
const decide = (reason: string, last: Last, now: number): boolean | null => {
    const f = (Mode as unknown as { lifeRestartsCourse?: (r: string, l: Last, n: number) => boolean }).lifeRestartsCourse;
    return f ? f(reason, last, now) : null;
};

describe('a course by sound follows a life the director sent to the start', () => {
    it('a crash or a stuck craft sent to the start restarts the course', () => {
        expect(decide('crash', { tick: 500, kind: 'start', sampleTick: null }, 500)).toBe(true);
        expect(decide('stuck-flipped', { tick: 500, kind: 'start', sampleTick: 420 }, 500)).toBe(true);
        expect(decide('stuck-wedged', { tick: 7, kind: 'start', sampleTick: null }, 7)).toBe(true);
    });

    it('a rewind with no path left is the start too', () => {
        expect(decide('stuck-wedged', { tick: 900, kind: 'rewind', sampleTick: null }, 900)).toBe(true);
    });

    it('a craft put back where it was keeps its gate', () => {
        expect(decide('crash', { tick: 500, kind: 'rewind', sampleTick: 380 }, 500)).toBe(false);
        expect(decide('stuck-flipped', { tick: 500, kind: 'rewind', sampleTick: 1 }, 500)).toBe(false);
    });

    it('R, the mode\'s own place and new flights never restart it here', () => {
        expect(decide('manual-start', { tick: 500, kind: 'start', sampleTick: null }, 500)).toBe(false);
        expect(decide('manual-rewind', { tick: 500, kind: 'rewind', sampleTick: 300 }, 500)).toBe(false);
        expect(decide('model', { tick: 500, kind: 'start', sampleTick: null }, 500)).toBe(false);
    });

    it('a decision of another tick is not this life\'s', () => {
        expect(decide('crash', { tick: 499, kind: 'start', sampleTick: null }, 500)).toBe(false);
        expect(decide('crash', null, 500)).toBe(false);
    });
});
