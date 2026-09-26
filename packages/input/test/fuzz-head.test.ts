// Negative control for fuzz.test.ts: the first 256 of the SAME people through the frozen first
// wizard (the one that hung on a real radio on 2026-09-25) must mostly hang or come out wrong. If
// they did not, the person model would be too kind to prove anything.

import { describe, expect, it } from 'vitest';
import { fuzzHuman, runHead } from './helpers';

describe('fuzz negative control: the same people through the first wizard', () => {
    it('mostly hang or come out wrong', () => {
        const N = 256;
        let hang = 0, wrong = 0;
        for (let i = 0; i < N; i++) {
            const o = runHead(fuzzHuman(i), 60000);
            if (o.kind === 'hang') hang++;
            if (o.kind === 'wrong') wrong++;
        }
        expect((hang + wrong) / N).toBeGreaterThanOrEqual(0.5);
        expect(hang / N).toBeGreaterThanOrEqual(0.3);
    });
});
