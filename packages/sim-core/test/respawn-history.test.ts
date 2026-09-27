// StateHistory (docs/architecture-v03.md C.5; C.12 item 5): per-tick sampling, so "5 s before the
// crash" exists at every frame rate. v0.2 sampled only when a frame ended on tick % 500 (D-d).

import { describe, expect, it } from 'vitest';
import { S, StateHistory, compileParams, lifeSim } from '../src/index';
import type { Runner } from '../src/index';
import { PRESET, PlaneWorld, Pilot, SPLITS, attachDirector, newRunner, runFrames } from './log-kit';

const WORLD = PlaneWorld.room({ wallX: 4 });
const SPAWN: [number, number, number, number] = [0, 1, 0, 0];
const BOX: [number, number, number][] = [[2, 1, 0], [2, 1.4, 2], [0, 1, 2], [0, 1.4, 0]];

interface Run { crash: number; age: number | null; age02: number | null; samples02: number }

/** 60 s: box laps at 2 m/s, then a dash into the wall at 55 s. v0.2's rule runs beside it as the control. */
function fly(frameHz: number, jitterUs = 0): Run {
    const r: Runner = newRunner({ world: WORLD, at: SPAWN });
    const d = attachDirector(r, SPAWN, { auto: false, unstuck: false });
    const v02 = new StateHistory({ everyTicks: 500, quietTicks: 500 });
    let samples02 = 0;
    const p = new Pilot(r);
    p.plan = (pp, sim) => {
        if (pp.phase === '') {
            const laps: [number, number, number][] = [];
            for (let k = 0; k < 14; k++) laps.push(...BOX);
            pp.bot.setTask({ kind: 'path', points: laps, speed: 2, yawDeg: 0 }, sim);
            pp.phase = 'box';
        } else if (pp.phase === 'box' && sim.tick >= 55_000) {
            pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 6, yawDeg: 0 }, sim);
            pp.phase = 'dash';
        }
    };
    let seen = 0;
    runFrames(r, frameHz, 60_000_000, {
        phaseUs: 3700,
        jitterUs,
        // v0.2 trackSafePoint: once per frame, only when the frame ends on tick % 500
        perFrame: (x) => {
            for (; seen < x.events.length; seen++) v02.onEvent(x.events[seen]);
            const before = v02.size;
            v02.onStep(x.sim);
            if (v02.size > before) samples02++;
        }
    });
    const crash = r.events.find((e) => e.type === 'crash')!.tick;
    const smp = d.history.pickBefore(crash, 5000);
    const old = v02.pickBefore(crash, 5000);
    return { crash, age: smp ? crash - smp.tick : null, age02: old ? crash - old.tick : null, samples02 };
}

describe('StateHistory per tick (C.12 item 5)', () => {
    const runs = new Map<string, Run>();
    const ok = (age: number | null) => age !== null && age >= 5000 && age <= 5050;

    it('a 60 s flight at 30/60/144/240 Hz and at 60 Hz with +-2 ms jitter: pickBefore(crash, 5 s) is 5.00-5.05 s old in every run', () => {
        for (const hz of SPLITS) runs.set(`${hz} Hz`, fly(hz));
        runs.set('60 Hz +-2 ms', fly(60, 2000));
        const crashes = new Set([...runs.values()].map((r) => r.crash));
        expect(crashes.size).toBe(1);
        expect([...crashes][0]).toBeGreaterThan(55_000);
        for (const [k, r] of runs) expect(ok(r.age), `${k}: age ${r.age}`).toBe(true);
    });

    it('control: v0.2\'s per-frame tick % 500 rule gets a few samples a minute and misses the 5 s window', () => {
        if (runs.size === 0) for (const hz of SPLITS) runs.set(`${hz} Hz`, fly(hz));
        const perMin = [...runs.values()].map((r) => r.samples02);
        expect(Math.max(...perMin)).toBeLessThanOrEqual(30); // v0.3 takes 1200 a minute
        expect([...runs.values()].every((r) => ok(r.age02))).toBe(false);
        console.log('v0.2 rule, samples in the 60 s flight:', [...runs].map(([k, r]) => `${k} ${r.samples02} (age ${r.age02})`).join('; '));
    });
});

describe('StateHistory rules', () => {
    const sim = lifeSim(compileParams(PRESET), PlaneWorld.room({ wallX: 4 }));
    function at(h: StateHistory, tick: number, x: number, o: { armed?: boolean; crashed?: boolean } = {}): void {
        sim.tick = tick;
        const s = sim.s;
        s[S.px] = x; s[S.py] = 1; s[S.pz] = 0;
        s[S.qw] = 1; s[S.qx] = 0; s[S.qy] = 0; s[S.qz] = 0;
        s[S.armed] = o.armed === false ? 0 : 1;
        s[S.crashed] = o.crashed ? 1 : 0;
        h.onStep(sim);
    }

    it('unsafe: within 300 ms of a contact, disarmed, crashed, or the body near a wall; pickBefore walks back to a safe one', () => {
        const h = new StateHistory();
        for (let t = 50; t <= 2000; t += 50) {
            if (t === 1000) h.onEvent({ type: 'contact', tick: 1000, speed: 0.3, regime: 'slide' });
            at(h, t, t === 400 ? 3.9 : 0, { armed: t !== 450, crashed: t === 500 });
        }
        const safeAt = (t: number) => h.pickBefore(t, 0)?.tick;
        expect(safeAt(1250)).toBe(950); // 1000..1250 are inside the quiet time
        expect(safeAt(1300)).toBe(1300);
        expect(safeAt(500)).toBe(350); // 500 crashed, 450 disarmed, 400 by the wall
        expect(h.pickBefore(40, 0)).toBeNull();
        expect(h.pickBefore(2000, 1000)!.tick).toBe(950);
    });

    it('control: with no quiet time the sample right after the contact counts as safe', () => {
        const h = new StateHistory({ quietTicks: 0 });
        h.onEvent({ type: 'contact', tick: 1000, speed: 0.3, regime: 'slide' });
        at(h, 1050, 0);
        expect(h.pickBefore(1050, 0)?.tick).toBe(1050);
    });

    it('keeps 60 s (1200 samples), dropping the oldest; mapPositions moves them with the scene', () => {
        const h = new StateHistory();
        for (let t = 50; t <= 70_000; t += 50) at(h, t, t / 10_000);
        expect(h.size).toBe(1200);
        expect(h.depthTicks).toBe(60_000);
        expect(h.pickBefore(70_000, 59_950)!.tick).toBe(10_050);
        expect(h.pickBefore(70_000, 60_000)).toBeNull();
        h.mapPositions((x, y, z) => [2 * x + 1, y, z]);
        expect(h.latest()!.x).toBeCloseTo(2 * 7 + 1, 12);
    });
});
