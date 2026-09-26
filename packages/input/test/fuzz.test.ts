// CI fuzz: 768 more simulated people (seeds 1001..1768) = every one of the 24 channel orders with
// every one of the 16 stick-inversion sets, twice, each at the person's own report rate (125 to
// 1000 reports/s). All must come out right. fuzz-head.test.ts sends the same people through the
// frozen first wizard (negative control). The full 500 people x 24 orders sweep (12,000 runs) is
// packages/input/test/sweep.ts (several CPU-minutes, not in CI).

import { describe, expect, it } from 'vitest';
import { FUZZ_N, fuzzHuman, runNew } from './helpers';

describe('fuzz: 768 people over every order x inversion set', () => {
    it('new wizard: all correct, none hang, every run <= 120 s, no phase > 30 s', () => {
        const bad: string[] = [];
        const rates = new Set<number>();
        let gamepads = 0, noSwitch = 0, weights = 0;
        for (let i = 0; i < FUZZ_N; i++) {
            const cfg = fuzzHuman(i);
            rates.add(cfg.rateHz);
            if (cfg.gamepadLike) gamepads++;
            if (cfg.arm === 'none') noSwitch++;
            if (cfg.rangeLimit < 1) weights++;
            const o = runNew(cfg);
            const longPhase = Object.entries(o.phaseMs).find(([k, v]) => k !== 'check' && v > 30000);
            if (o.kind !== 'correct' || o.ms > 120000 || longPhase) bad.push(`#${i} seed ${cfg.seed} ${cfg.order}: ${o.kind} ${(o.ms / 1000).toFixed(1)} s at ${o.where} ${longPhase ? `long ${longPhase[0]}` : ''} ${o.problems.join('; ')}`);
        }
        expect(bad).toEqual([]);
        // the mix really contains the hard cases
        expect([...rates].sort((a, b) => a - b)).toEqual([125, 250, 500, 1000]);
        expect(gamepads).toBeGreaterThan(20);
        expect(noSwitch).toBeGreaterThan(100);
        expect(weights).toBeGreaterThan(5);
    });
});
