// CI negative control (B19): this test must fail, and CI must go red. Never merge.
import { describe, it, expect } from 'vitest';
import { rawRate } from '../src/rates';

describe('canary', () => {
    it('a deliberately wrong expectation', () => {
        expect(rawRate('BETAFLIGHT', 1, 1, 0.7, 0)).toBe(-12345);
    });
});
