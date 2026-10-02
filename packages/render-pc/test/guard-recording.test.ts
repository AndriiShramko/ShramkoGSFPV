import { describe, it, expect } from 'vitest';
import { LatencyGuard } from '../src/governor';

// W4-1 (live R1, 2026-10-02): every skip of the latency guard is 2-3 slots of a 60 fps recording that
// repeat the previous picture. While a file is written the guard measures but does not skip; it skips
// again after. Normal flight is unchanged (the control below is the same sample without a recording).
const P = 1000 / 60;

function regular(g: LatencyGuard, frames: number): number {
    let t = 0;
    for (let i = 0; i < frames; i++) {
        t += P;
        g.onFrame(t, t);
    }
    return t;
}

describe('latency guard while recording', () => {
    it('a slow-compositor sample during a recording gets no skip, and the guard keeps measuring', () => {
        const g = new LatencyGuard();
        g.active = true;
        g.holdSkips = true;
        const t = regular(g, 120);
        expect(g.onSample(t, 3 * P)).toBeNull();
        expect(g.skips).toBe(0);
        expect(g.log.some((e) => e.what === 'held')).toBe(true);
        expect(g.rafToPresentMs).toBe(3 * P);
        // the recording stops: the next slow sample skips as before
        g.holdSkips = false;
        expect(g.onSample(t + 2500, 3 * P)?.kind).toBe('skip');
    });

    it('control: the same sample in normal flight is a skip', () => {
        const g = new LatencyGuard();
        g.active = true;
        const t = regular(g, 120);
        expect(g.onSample(t, 3 * P)?.kind).toBe('skip');
        expect(g.skips).toBe(1);
    });
});
