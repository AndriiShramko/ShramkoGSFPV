// Simulated people through the calibration wizard: the fixed 384-person grid must all come out
// right, and the same people through the frozen first wizard must mostly fail (negative control:
// if the old wizard passes them, the person model is too kind). The ideal person through the old
// wizard must pass (positive control: the harness reproduces the path known to work).

import { describe, expect, it } from 'vitest';
import { idealHuman } from '../src/sim/human';
import type { Outcome } from '../src/sim/human';
import { gridHuman, invSet, runHead, runNew } from './helpers';

function tally(outs: Outcome[]): { correct: number; wrong: number; hang: number } {
    const t = { correct: 0, wrong: 0, hang: 0 };
    for (const o of outs) t[o.kind]++;
    return t;
}

describe('simulated people', () => {
    it('15. 384 random people (24 orders x 16 inversion sets): all correct, no hang, <= 120 s, no phase > 30 s', () => {
        const outs: Outcome[] = [];
        const bad: string[] = [];
        let worstRun = 0, worstPhase = 0, worstPhaseName = '';
        for (let i = 0; i < 384; i++) {
            const cfg = gridHuman(i, 500);
            const o = runNew(cfg);
            outs.push(o);
            worstRun = Math.max(worstRun, o.ms);
            for (const [k, v] of Object.entries(o.phaseMs)) if (k !== 'check' && v > worstPhase) { worstPhase = v; worstPhaseName = k; }
            if (o.kind !== 'correct') bad.push(`#${i} seed ${cfg.seed} ${cfg.order}: ${o.kind} at ${o.where}: ${o.problems.join('; ')}`);
        }
        expect(bad).toEqual([]);
        expect(tally(outs)).toEqual({ correct: 384, wrong: 0, hang: 0 });
        expect(worstRun).toBeLessThanOrEqual(120000);
        expect(worstPhase, worstPhaseName).toBeLessThanOrEqual(30000);
    });

    it('16. negative control: the first 200 of those people through the first wizard mostly fail', () => {
        const outs: Outcome[] = [];
        for (let i = 0; i < 200; i++) outs.push(runHead(gridHuman(i, 500), 60000));
        const t = tally(outs);
        // expected about 85 % (the diag) or more; if the old wizard passes most people, the model is too kind
        expect((t.hang + t.wrong) / 200).toBeGreaterThanOrEqual(0.5);
    });

    it('17. positive control: the ideal person through the first wizard is correct (AETR, TAER)', () => {
        for (const order of ['AETR', 'TAER']) {
            const o = runHead(idealHuman(order, invSet(0)), 60000);
            expect(`${order}: ${o.kind} ${o.problems.join('; ')}`).toBe(`${order}: correct `);
        }
    });
});
