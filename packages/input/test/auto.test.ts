// Auto pacing (Andrii, 2026-09-27, after v3 asked for Start and Next on every step: "a hundred
// times Start, a hundred times Next — the pilot must not click, like Liftoff"). The sticks move the
// wizard on; time alone still takes nothing (his message 3). The people are a model, not humans.

import { describe, expect, it } from 'vitest';
import { idealHuman } from '../src/sim/human';
import type { WizardState } from '../src/calib';
import { invSet, Rig } from './helpers';

const IDEAL = () => ({ ...idealHuman('AETR', invSet(0)), auto: true }); // CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 arm
const key = (s: WizardState) => (s.stage ? `${s.id}/${s.stage}` : s.id);

function rig(auto: boolean): Rig {
    const r = new Rig(IDEAL());
    r.wz.auto = auto;
    r.clicks = false; // nobody presses a button of the wizard
    return r;
}

describe('auto pacing: the sticks move the wizard on, no button', () => {
    it('a pilot who only moves the sticks (never a button) reaches the check screen with the right mapping', () => {
        const r = rig(true);
        r.until((s) => s.id === 'check', 180000);
        expect(r.st.id).toBe('check');
        const p = r.st.profile!;
        expect(p).not.toBeNull();
        expect(p.axes.roll.index).toBe(0);
        expect(p.axes.pitch.index).toBe(1);
        expect(p.axes.throttle.index).toBe(2);
        expect(p.axes.yaw.index).toBe(3);
        expect(p.axes.throttle.invert).toBe(false);
        expect(p.arm && p.arm.kind === 'axis' ? p.arm.index : -1).toBe(4);
    });

    it('control: the same pilot with auto pacing off and no button stays on the first screen', () => {
        const r = rig(false);
        const seen = new Set<string>();
        r.for(60000, (s) => { seen.add(key(s)); });
        expect([...seen]).toEqual(['stir/ready']);
        expect(r.st.profile).toBeNull();
    });

    it('idle hands (sticks at rest, noise only) for 120 s: never past the stir, no profile', () => {
        const r = rig(true);
        r.manual = (_t, ch) => { ch.fill(0); ch[2] = -1; ch[4] = -1; };
        const seen = new Set<string>();
        r.for(120000, (s) => { seen.add(key(s)); });
        expect([...seen].every((k) => k.startsWith('stir/'))).toBe(true);
        expect(r.st.profile).toBeNull();
    });

    it('tiny movements (20 % wiggles) on the throttle screen for 60 s are never taken', () => {
        const r = rig(true);
        r.until((s) => s.id === 'throttle' && s.stage === 'active', 180000);
        expect(key(r.st)).toBe('throttle/active');
        const t0 = r.t;
        r.manual = (t, ch) => { ch.fill(0); ch[4] = -1; ch[2] = -1 + 0.4 * (0.5 + 0.5 * Math.sin((t - t0) / 300)); for (const i of [0, 1, 3]) ch[i] = 0.2 * Math.sin((t - t0) / (200 + 50 * i)); };
        r.for(60000);
        expect(key(r.st)).toBe('throttle/active');
        expect(r.st.assigned.throttle).toBeUndefined();
    });
});
