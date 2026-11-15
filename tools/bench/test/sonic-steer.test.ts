// sonic3 S1: the probe pilot's stall rule reads a turn of the hum only on the ground plane (sonic-steer.ts humTurned).
import { describe, expect, it } from 'vitest';
import { humTurned } from '../src/sonic-steer';

describe('the probe pilot: a turn of the hum', () => {
    it('the same direction with the hum below the nose is no turn (S1 Housefly g2: 0 dodges in 300 s)', () => {
        const v = [-0.04, -0.11, -0.99];
        expect(humTurned(v, v)).toBe(false);
        expect(humTurned([0, -0.5, -0.86], [0, -0.5, -0.86])).toBe(false);
    });

    it('a turn of 10 degrees on the ground is a turn; no sample is no turn', () => {
        const r = (deg: number): number[] => [Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180)];
        expect(humTurned(r(0), r(10))).toBe(true);
        expect(humTurned(r(0), r(3))).toBe(false);
        expect(humTurned(undefined, r(0))).toBe(false);
    });
});
