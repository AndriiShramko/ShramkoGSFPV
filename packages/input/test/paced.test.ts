// Acceptance of the user-paced wizard (v3): Andrii, 2026-09-26, with his real radio: "it passes
// the steps BY ITSELF, even if I did not move the sticks at all, or moved them only a tiny bit".
// (a) idle hands: nothing advances and nothing is taken without a button; (b) tiny movements are
// never taken; (c) slow people still come out right; (e) the same harness FAILS the frozen v2
// (60fa9de), the wizard he tested: if it ever passes, these tests have lost their teeth.
// (d), the existing people, is tests 1 / 15 / fuzz. The people are a model, not measured humans.

import { describe, expect, it } from 'vitest';
import { idealHuman } from '../src/sim/human';
import type { Fn, WizardState } from '../src/calib';
import { mulberry32 } from '../src/sim/signals';
import { invSet, Presser, Rig, runNew, slowHuman, V2Rig, v3FrameChange, Watch } from './helpers';

const IDEAL = () => idealHuman('AETR', invSet(0)); // CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 arm
const key = (s: WizardState) => (s.stage ? `${s.id}/${s.stage}` : s.id);
const CH: Record<Fn, number> = { roll: 0, pitch: 1, throttle: 2, yaw: 3 };

/** Hands frozen at these channel values (sticks centred, throttle down, arm off by default), with stick noise. */
function frozen(rig: Rig | V2Rig, values: Partial<Record<number, number>> = {}, noise = 0.005, seed = 1): void {
    const v = [0, 0, -1, 0, -1, 0, 0, 0];
    for (const [k, x] of Object.entries(values)) v[Number(k)] = x as number;
    const r = mulberry32(seed);
    const g = () => (r() + r() + r() + r() - 2) * 1.7320508075688772;
    rig.manual = (_t, ch) => { for (let i = 0; i < 8; i++) ch[i] = Math.max(-1, Math.min(1, v[i] + (i < 4 ? g() * noise : 0))); };
}

/** A scripted movement of one channel: straight segments from where it is, then it stays. */
function move(rig: Rig | V2Rig, base: number[], ch: number, segs: [number, number][]): void {
    const t0 = rig.t;
    const from = base[ch];
    rig.manual = (t, out) => {
        for (let i = 0; i < 8; i++) out[i] = base[i];
        let e = t - t0, x = from, prev = from;
        for (const [to, ms] of segs) {
            if (e < ms) { x = prev + (to - prev) * (ms > 0 ? e / ms : 1); break; }
            e -= ms; prev = to; x = to;
        }
        out[ch] = x;
    };
}

describe('(a) idle: nothing advances and nothing is taken without a button', () => {
    it('A1: sticks at rest from the first frame (noise 0.005, 500 Hz), no press, 120 s: the stir screen waits', () => {
        const rig = new Rig(IDEAL());
        rig.clicks = false;
        frozen(rig);
        const seen = new Set<string>();
        rig.for(120000, (s) => seen.add(key(s)));
        expect([...seen]).toEqual(['stir/ready']);
        expect(rig.st.profile).toBeNull();
        expect(rig.watch.violations).toEqual([]);
    });

    it('A2: the same hands and someone pressing every enabled button for 120 s: Done never enables, never past the stir', () => {
        const rig = new Rig(IDEAL());
        rig.clicks = false;
        frozen(rig);
        const p = new Presser(2, 0);
        rig.each = (r) => p.step(r);
        const seen = new Set<string>();
        rig.for(120000, (s) => seen.add(key(s)));
        expect([...seen].sort()).toEqual(['stir/active', 'stir/ready']);
        expect(p.pressed.filter((x) => x !== 'begin')).toEqual([]); // nothing else was ever enabled
        expect(rig.st.profile).toBeNull();
        expect(rig.watch.violations).toEqual([]);
    });

    it('A3: hands frozen on "Throttle all the way down" with the throttle anywhere, buttons pressed for 120 s: nothing is taken', () => {
        const report: string[] = [];
        for (const [k, p] of [-1, -0.6, -0.2, 0, 0.3, 0.6, 1].entries()) {
            const rig = new Rig(IDEAL());
            expect(rig.to('throttle', 'ready')).toBe(true); // stir and centre done by the ideal person, with presses
            rig.clicks = false;
            frozen(rig, { 2: p }, 0.005, k + 3);
            const pr = new Presser(10 + k, rig.t);
            rig.each = (r) => pr.step(r);
            const seen = new Set<string>();
            rig.for(120000, (s) => seen.add(key(s)));
            report.push(`p=${p}: ${[...seen].join(' ')} | pressed ${[...new Set(pr.pressed)].join(',')}`);
            expect(rig.st.assigned, `p=${p}`).toEqual({});
            expect([...seen].every((s) => s === 'throttle/ready' || s === 'throttle/active'), `p=${p}: ${[...seen].join(' ')}`).toBe(true);
            expect(rig.st.profile).toBeNull();
            expect(rig.watch.violations, `p=${p}`).toEqual([]);
        }
        expect(report.length).toBe(7);
    });

    it('A4: hands frozen on the yaw, pitch and roll steps, buttons pressed for 120 s: never past that push', () => {
        for (const fn of ['yaw', 'pitch', 'roll'] as Fn[]) {
            const rig = new Rig(IDEAL());
            expect(rig.to(fn, 'ready')).toBe(true);
            rig.clicks = false;
            frozen(rig, {}, 0.005, CH[fn] + 20);
            const pr = new Presser(30 + CH[fn], rig.t);
            rig.each = (r) => pr.step(r);
            const seen = new Set<string>();
            rig.for(120000, (s) => seen.add(key(s)));
            expect([...seen].sort(), fn).toEqual([`${fn}/active`, `${fn}/ready`]);
            expect(rig.st.assigned[fn], fn).toBeUndefined();
            expect(rig.watch.violations, fn).toEqual([]);
        }
    });

    it('A5: the ideal person with every click dropped (the hands follow the screens), 60 s: the stir screen waits, no profile', () => {
        const rig = new Rig(IDEAL());
        rig.clicks = false;
        const seen = new Set<string>();
        rig.for(60000, (s) => seen.add(key(s)));
        expect([...seen]).toEqual(['stir/ready']);
        expect(rig.st.profile).toBeNull();
        expect(rig.watch.violations).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------- (b)

interface PushCase { fn: Fn; base: number; label: string }
const CASES: PushCase[] = [
    { fn: 'throttle', base: -1, label: 'throttle resting at its bottom' },
    { fn: 'throttle', base: 0, label: 'throttle resting at its middle (a spring throttle)' },
    { fn: 'yaw', base: 0, label: 'yaw' },
    { fn: 'pitch', base: 0, label: 'pitch' },
    { fn: 'roll', base: 0, label: 'roll' }
];

/** A rig on fn/active with the channel of fn resting at `base` (Start pressed by the test). */
function activeRig(c: PushCase): { rig: Rig; hands: number[] } {
    const rig = new Rig(IDEAL());
    expect(rig.to(c.fn, 'ready'), c.label).toBe(true);
    rig.clicks = false;
    const hands = [0, 0, -1, 0, -1, 0, 0, 0];
    hands[CH[c.fn]] = c.base;
    rig.hold(Object.fromEntries(hands.map((v, i) => [i, v])));
    rig.for(1200);
    const v = rig.press({ kind: 'begin' });
    expect(v.ok, `${c.label}: Start ${v.ok ? '' : v.hint.key}`).toBe(true);
    expect(key(rig.st)).toBe(`${c.fn}/active`);
    return { rig, hands };
}

/** Where the channel goes for a move of `d` of its reach from the rest, in direction `sign`. */
function target(rig: Rig, ch: number, base: number, d: number, sign: 1 | -1): number {
    const c = rig.st.channels[ch];
    const reach = Math.max(0.5, sign > 0 ? c.hi - base : base - c.lo);
    return Math.max(-1, Math.min(1, base + sign * d * reach));
}

describe('(b) tiny movements are never taken', () => {
    it('moves of 5..25 % of the reach, both ways, held 3 s, three times: nothing taken, the gauge says "tiny"', () => {
        for (const c of CASES) {
            const { rig, hands } = activeRig(c);
            const ch = CH[c.fn];
            for (const d of [0.05, 0.1, 0.15, 0.2, 0.25]) for (const sign of [1, -1] as const) for (let rep = 0; rep < 3; rep++) {
                const to = target(rig, ch, c.base, d, sign);
                move(rig, hands, ch, [[to, 150], [to, 3000], [c.base, 150], [c.base, 300]]);
                const zones = new Set<string>();
                const t0 = rig.t;
                rig.for(3600, (s, t) => { if (t - t0 >= 400 && t - t0 < 3100) zones.add(s.gauge?.zone ?? '-'); });
                const label = `${c.label} d=${d} sign=${sign} rep=${rep}`;
                expect(key(rig.st), label).toBe(`${c.fn}/active`);
                expect(rig.st.assigned[c.fn], label).toBeUndefined();
                expect([...zones].every((z) => z === 'rest' || z === 'tiny'), `${label}: ${[...zones]}`).toBe(true);
                if (d >= 0.15 && Math.abs(to - c.base) > 0.1) expect([...zones], label).toEqual(['tiny']);
            }
            expect(rig.watch.violations).toEqual([]);
        }
    });

    it('the "almost" band (35, 50, 65 %): nothing taken, the gauge says "almost", and on the way back the hint gives the share reached', () => {
        for (const c of CASES) for (const d of [0.35, 0.5, 0.65]) {
            const { rig, hands } = activeRig(c);
            const ch = CH[c.fn];
            const sign = c.fn === 'throttle' && c.base < 0 ? 1 : c.fn === 'roll' ? -1 : 1;
            const to = target(rig, ch, c.base, d, sign);
            move(rig, hands, ch, [[to, 150], [to, 3000], [c.base, 150]]);
            const zones = new Set<string>();
            const t0 = rig.t;
            rig.for(3300, (s, t) => { if (t - t0 >= 400 && t - t0 < 3100) zones.add(s.gauge?.zone ?? '-'); });
            const back = rig.t;
            let hintAt = -1, pct = NaN;
            rig.for(1000, (s, t) => { if (hintAt < 0 && s.hint?.key === 'wizard.hint.push.short') { hintAt = t - back; pct = Number(s.hint.params.pct); } });
            const label = `${c.label} d=${d}`;
            expect(rig.st.assigned[c.fn], label).toBeUndefined();
            expect([...zones], label).toEqual(['almost']);
            expect(hintAt, label).toBeGreaterThanOrEqual(0);
            expect(Math.abs(pct - d * 100), `${label}: pct ${pct}`).toBeLessThanOrEqual(3);
            expect(rig.watch.violations).toEqual([]);
        }
    });

    it('a flick to 90 % held 300 ms is not taken; 75 % held is taken 400 ms after it passed 70 %, the other way round too (reversed)', () => {
        for (const c of CASES) {
            const { rig, hands } = activeRig(c);
            const ch = CH[c.fn];
            const up = target(rig, ch, c.base, 0.9, 1);
            move(rig, hands, ch, [[up, 150], [up, 300], [c.base, 150], [c.base, 1000]]);
            rig.for(1600);
            expect(rig.st.assigned[c.fn], `${c.label}: flick`).toBeUndefined();
            // positive control: 75 % in the asked direction
            const to = target(rig, ch, c.base, 0.75, 1);
            move(rig, hands, ch, [[to, 150]]);
            let passed = -1, doneAt = -1;
            rig.for(1500, (s, t) => {
                if (passed < 0 && s.gauge && s.gauge.frac >= 0.7) passed = t;
                if (doneAt < 0 && s.stage === 'done') doneAt = t;
            });
            expect(rig.st.assigned[c.fn], c.label).toBe(ch);
            expect(rig.st.inverted[c.fn], c.label).toBe(false);
            expect(doneAt - passed, c.label).toBeGreaterThanOrEqual(400 - rig.dt);
            expect(doneAt - passed, c.label).toBeLessThanOrEqual(400 + 150 + 3 * rig.dt);
            expect(rig.watch.violations).toEqual([]);
            if (c.base !== 0) continue;
            // the other way on a centred rest: taken, reversed (the pilot sees it and presses Reverse)
            const { rig: r2, hands: h2 } = activeRig(c);
            move(r2, h2, ch, [[target(r2, ch, c.base, 0.75, -1), 150]]);
            r2.for(1000);
            expect([r2.st.assigned[c.fn], r2.st.inverted[c.fn]], `${c.label}: the other way`).toEqual([ch, true]);
        }
    });
});

// ---------------------------------------------------------------------------------------- (c)

describe('(c) slow people', () => {
    it('100 slow people (every reaction and every press 3..15 s): all correct, none hang, no screen change without a button', () => {
        const bad: string[] = [];
        let worst = 0;
        for (let i = 0; i < 100; i++) {
            const cfg = slowHuman(i);
            const w = new Watch(v3FrameChange);
            const o = runNew(cfg, 900000, w);
            worst = Math.max(worst, o.ms);
            if (o.kind !== 'correct' || w.violations.length) bad.push(`#${i} ${cfg.order}: ${o.kind} at ${o.where} ${o.problems.join('; ')} ${w.violations.slice(0, 2).join('; ')}`);
        }
        expect(bad).toEqual([]);
        expect(worst).toBeLessThanOrEqual(900000);
    });
});

// ---------------------------------------------------------------------------------------- (e)

describe('(e) negative control: the frozen v2 (the wizard Andrii tested) fails the same checks', () => {
    it('A5 on v2: the ideal person without a single click reaches the check WITH a profile', () => {
        const rig = new V2Rig(IDEAL());
        rig.human.onAct = () => undefined; // every click dropped
        rig.for(60000);
        expect(rig.st.id).toBe('check');
        expect(rig.st.profile).not.toBeNull(); // v2 fails "never a profile without a press"
        expect(rig.watch.violations.length).toBeGreaterThan(5);
    });

    it('A3 on v2: hands frozen from its "let go" screen and every escape pressed: the screen moves on to the push by itself', () => {
        const rig = new V2Rig(IDEAL());
        expect(rig.until((s) => s.id === 'centre' && !s.ok, 20000)).toBe(true);
        frozen(rig, {}, 0.005, 5);
        const pr = new Presser(40, rig.t);
        rig.each = (r) => pr.stepV2(r);
        rig.for(30000);
        const selfMade = rig.watch.violations.filter((v) => v.startsWith('centre -> throttle/push'));
        expect(selfMade.length).toBe(1); // v2 breaks I1: no button, yet the screen changed
    });

    it('(b) on v2: a throttle parked at 60 % of its travel takes a 20 % nudge as "up"; parked at 40 %, 25 % down is taken reversed', () => {
        const takes = (p: number, dFull: number): { taken: boolean; invert: boolean } => {
            const rig = new V2Rig(IDEAL());
            expect(rig.until((s) => s.id === 'centre' && !s.ok, 20000)).toBe(true);
            rig.hold({ 2: p });
            expect(rig.until((s) => s.id === 'throttle' && s.phase === 'push' && !s.ok, 20000)).toBe(true);
            rig.for(1000);
            const hands = [0, 0, p, 0, -1, 0, 0, 0];
            move(rig, hands, 2, [[Math.max(-1, Math.min(1, p + 2 * dFull)), 150]]);
            rig.for(3000);
            const a = (rig.wz as unknown as { assigned: Record<string, { invert: boolean }> }).assigned.throttle;
            return { taken: !!a, invert: !!a?.invert };
        };
        expect(takes(0.2, 0.2)).toEqual({ taken: true, invert: false }); // +20 % of travel = "all the way up"
        expect(takes(0.2, 0.25)).toEqual({ taken: true, invert: false });
        expect(takes(-0.2, -0.25)).toEqual({ taken: true, invert: true }); // 25 % DOWN = a reversed throttle
        // and v3 on the same hands: Start is refused for the parked throttle, then nothing is taken
        for (const [p, d] of [[0.2, 0.2], [0.2, 0.25], [-0.2, -0.25]]) {
            const rig = new Rig(IDEAL());
            expect(rig.to('throttle', 'ready')).toBe(true);
            rig.clicks = false;
            rig.hold({ 2: p });
            rig.for(1200);
            const v = rig.press({ kind: 'begin' });
            expect(v.ok ? '' : v.hint.key).toBe('wizard.hint.begin.parked');
            move(rig, [0, 0, p, 0, -1, 0, 0, 0], 2, [[p + 2 * d, 150]]);
            rig.for(3000);
            expect(rig.st.assigned.throttle).toBeUndefined();
        }
    });
});
