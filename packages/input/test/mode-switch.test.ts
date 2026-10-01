// The radio's flight-mode switch (docs/architecture-v03.md B.2, the owner's item 15): found on the
// wizard's check screen by a flip with no click, read into ch[5] by mapFrame, kept in a version-1
// profile. Every claim has a negative control that must fire: the arm switch, a knob, noise on a
// border, a glitch and a tap are never taken; without a mode switch ch[5] is not the radio's.
import { describe, expect, it } from 'vitest';
import { CalibrationWizard, ModeSwitchDetector, MODE_SWITCH_TUNING, mapFrame, switchPos, validModeSwitch } from '../src/calib';
import type { ModeSwitch, Profile, RawFrame, SwitchFlip } from '../src/calib';
import { idealHuman } from '../src/sim/human';
import { invSet, Rig } from './helpers';

const LEVEL = MODE_SWITCH_TUNING.LEVEL_MS;

/** A radio at 250 Hz: CH1-4 sticks centred (throttle low), CH5 arm, CH6-8 whatever `aux` says at time t. */
function radio(aux: (t: number, ax: Float32Array) => void, o: { buttons?: (t: number) => number; arm?: (t: number) => number } = {}) {
    const f: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    return (t: number): RawFrame => {
        f.t = t;
        f.axes.set([0, 0, -1, 0, o.arm ? o.arm(t) : -1, -1, -1, -1]);
        aux(t, f.axes);
        f.buttons = o.buttons ? o.buttons(t) : 0;
        return f;
    };
}

/** Feed a detector from 0 to `ms`; every flip it reports. */
function run(det: ModeSwitchDetector, frame: (t: number) => RawFrame, ms: number): SwitchFlip[] {
    const out: SwitchFlip[] = [];
    for (let t = 0; t <= ms; t += 4) { const fl = det.feed(frame(t)); if (fl) out.push(fl); }
    return out;
}

const step = (at: number, a: number, b: number) => (t: number) => (t < at ? a : b);

describe('ModeSwitchDetector: a flip is a held jump between positions, never time, noise or a knob', () => {
    it('a 2-position switch on CH6: low held, flipped high, held: found once (from low to high)', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        const flips = run(det, radio((t, ax) => { ax[5] = step(1000, -1, 1)(t); }), 2000);
        expect(flips).toEqual([{ input: { kind: 'axis', index: 5 }, from: 0, to: 2 }]);
    });

    it('it is found only once the new position is held LEVEL_MS: not at the flip itself', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        const fr = radio((t, ax) => { ax[5] = step(1000, -1, 1)(t); });
        expect(run(det, fr, 1000 + LEVEL - 20)).toEqual([]);
        expect(det.feed(fr(1000 + LEVEL + 8))).toMatchObject({ input: { kind: 'axis', index: 5 } });
    });

    it('a 3-position switch: low to middle is a flip (positions are thirds of the travel)', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        expect(run(det, radio((t, ax) => { ax[6] = step(800, -1, 0)(t); }), 1600)).toEqual([{ input: { kind: 'axis', index: 6 }, from: 0, to: 1 }]);
    });

    it('control: the same flip on the arm channel (excluded) is never the mode switch', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        expect(run(det, radio(() => undefined, { arm: step(1000, -1, 1) }), 2000)).toEqual([]);
        // and the detector is not blind: the same switch on CH6 is found
        const det2 = new ModeSwitchDetector();
        det2.exclude([0, 1, 2, 3, 4], []);
        expect(run(det2, radio((t, ax) => { ax[5] = step(1000, -1, 1)(t); }), 2000)).toHaveLength(1);
    });

    it('control: a knob turned end to end in 400 ms reaches the same levels but sweeps: never taken; a jump to the same levels is', () => {
        const knob = (t: number) => (t < 1000 ? -1 : t > 1400 ? 1 : -1 + (2 * (t - 1000)) / 400);
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        expect(run(det, radio((t, ax) => { ax[6] = knob(t); }), 3000)).toEqual([]);
        // the knob stays a knob for this watch even when it later jumps
        const det2 = new ModeSwitchDetector();
        det2.exclude([0, 1, 2, 3, 4], []);
        expect(run(det2, radio((t, ax) => { ax[6] = step(1000, -1, 1)(t); }), 3000)).toHaveLength(1);
    });

    it('control: a noisy pot sitting on the border of two thirds for 20 s, and one 60 ms glitch, are never a flip', () => {
        let s = 7;
        const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        const fr = radio((t, ax) => {
            ax[5] = -1 / 3 + 0.05 * Math.sin((2 * Math.PI * t) / 4000) + rnd() * 0.02; // drifts across the low / middle border
            ax[6] = t >= 5000 && t < 5060 ? 1 : -1; // one glitch
        });
        expect(run(det, fr, 20000)).toEqual([]);
    });

    it('a latching button held ON is found; control: a 100 ms tap is not a level', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3, 4], []);
        expect(run(det, radio(() => undefined, { buttons: (t) => (t >= 600 ? 1 << 3 : 0) }), 1500)).toEqual([{ input: { kind: 'button', bit: 3 }, from: 0, to: 2 }]);
        const tap = new ModeSwitchDetector();
        tap.exclude([0, 1, 2, 3, 4], []);
        expect(run(tap, radio(() => undefined, { buttons: (t) => (t >= 600 && t < 700 ? 1 << 3 : 0) }), 1500)).toEqual([]);
    });

    it('the arm button (excluded) is never the mode switch', () => {
        const det = new ModeSwitchDetector();
        det.exclude([0, 1, 2, 3], [0]);
        expect(run(det, radio(() => undefined, { buttons: (t) => (t >= 600 ? 1 : 0) }), 1500)).toEqual([]);
    });
});

const AXES = { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } };
const profile = (ms?: ModeSwitch): Profile => ({
    version: 1, deviceKey: 'hid:test', deviceName: 'test', axes: structuredClone(AXES),
    arm: { kind: 'axis', index: 4, threshold: 0.5, onAbove: true, off: -1, on: 1 }, angleMode: null, deadband: 0, created: '', wizard: 2,
    ...(ms ? { modeSwitch: ms } : {})
});
const at = (ch6: number, buttons = 0): RawFrame => ({ t: 0, axes: new Float32Array([0, 0, -1, 0, 1, ch6, 0, 0]), buttons });

describe('mapFrame ch[5] from the mode switch', () => {
    it('low / middle / high give MODE_CHANNEL of the default modes: acro -1, horizon 0, angle +1', () => {
        const p = profile({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] });
        const out = new Float32Array(8);
        expect([-1, 0, 1].map((v) => mapFrame(p, at(v), out)[5])).toEqual([-1, 0, 1]);
    });

    it('a position set to another mode reads that mode; a button switch reads low released, high pressed', () => {
        const out = new Float32Array(8);
        const p = profile({ input: { kind: 'axis', index: 5 }, modes: ['angle', 'angle', 'horizon'] });
        expect([-1, 0, 1].map((v) => mapFrame(p, at(v), out)[5])).toEqual([1, 1, 0]);
        const b = profile({ input: { kind: 'button', bit: 2 }, modes: ['acro', 'horizon', 'angle'] });
        expect([mapFrame(b, at(0, 0), out)[5], mapFrame(b, at(0, 1 << 2), out)[5]]).toEqual([-1, 1]);
    });

    it('control: the same frames through a profile without a mode switch never follow CH6', () => {
        const out = new Float32Array(8);
        expect([-1, 0, 1].map((v) => mapFrame(profile(), at(v), out)[5])).toEqual([-1, -1, -1]);
    });

    it('switchPos: thirds of the travel', () => {
        const sw = { kind: 'axis' as const, index: 5 };
        expect([-1, -0.34, -0.33, 0, 0.33, 0.34, 1].map((v) => switchPos(sw, at(v)))).toEqual([0, 0, 1, 1, 1, 2, 2]);
    });
});

describe('validModeSwitch: a stored mode switch is checked, the profile never lost over it', () => {
    it('reads a good one and drops unknown fields', () => {
        expect(validModeSwitch({ input: { kind: 'axis', index: 5, extra: 1 }, modes: ['acro', 'horizon', 'angle'], x: 2 })).toEqual({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] });
        expect(validModeSwitch({ input: { kind: 'button', bit: 0 }, modes: ['angle', 'angle', 'angle'] })).toEqual({ input: { kind: 'button', bit: 0 }, modes: ['angle', 'angle', 'angle'] });
    });

    it('refuses what it cannot read (null: the profile then flies without one)', () => {
        for (const bad of [null, 'CH6', [], { input: { kind: 'axis', index: -1 }, modes: ['acro', 'horizon', 'angle'] }, { input: { kind: 'axis', index: 1.5 }, modes: ['acro', 'horizon', 'angle'] },
            { input: { kind: 'pot', index: 5 }, modes: ['acro', 'horizon', 'angle'] }, { input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon'] },
            { input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'turtle'] }, { input: { kind: 'button', bit: 40 }, modes: ['acro', 'horizon', 'angle'] }]) {
            expect(validModeSwitch(bad), JSON.stringify(bad)).toBeNull();
        }
    });
});

/** A resumed wizard at its check, fed at 250 Hz by `frame`. */
function checkRig(p: Profile) {
    const w = CalibrationWizard.resume(p);
    w.auto = true;
    w.start(0);
    let t = 0;
    const feed = (ms: number, frame: (t: number) => RawFrame) => { const end = t + ms; while (t < end) { t += 4; w.feed(frame(t)); if (t % 252 === 0) w.tick(t); } };
    return { w, feed, now: () => t };
}

describe('the wizard finds the mode switch on its check screen with no click', () => {
    it('flip CH6 on the check: the row and the profile get it; no command was needed', () => {
        const { w, feed } = checkRig(profile());
        expect(w.state.id).toBe('check');
        expect(w.state.modeSwitch).toMatchObject({ sw: null, listening: true });
        const cmds = w.state.cmds;
        feed(800, radio((t, ax) => { ax[5] = -1; }));
        feed(800, radio((t, ax) => { ax[5] = 1; }));
        expect(w.state.cmds).toBe(cmds);
        expect(w.state.modeSwitch?.sw).toEqual({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] });
        expect(w.state.modeSwitch?.pos).toBe(2);
        expect(w.state.modeSwitch?.seen).toEqual([true, false, true]);
        expect(w.state.profile?.modeSwitch).toEqual({ input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] });
        expect(w.state.profile?.version).toBe(1);
        // the row follows the switch live
        feed(100, radio((t, ax) => { ax[5] = 0; }));
        expect(w.state.modeSwitch?.pos).toBe(1);
        expect(w.state.modeSwitch?.seen).toEqual([true, true, true]);
    });

    it('control: the arm switch flipped on the check (as the pilot tries it) and a knob turned are never taken', () => {
        const { w, feed } = checkRig(profile());
        const knob = (t: number) => (t < 1000 ? -1 : t > 1400 ? 1 : -1 + (2 * (t - 1000)) / 400);
        feed(4000, radio((t, ax) => { ax[6] = knob(t); }, { arm: (t) => (Math.floor(t / 700) % 2 ? 1 : -1) }));
        expect(w.state.modeSwitch?.sw).toBeNull();
        expect(w.state.profile?.modeSwitch).toBeUndefined();
    });

    it('a second switch flipped later does not replace the one found', () => {
        const { w, feed } = checkRig(profile());
        feed(800, radio((t, ax) => { ax[5] = -1; }));
        feed(800, radio((t, ax) => { ax[5] = 1; }));
        feed(800, radio((t, ax) => { ax[5] = 1; ax[6] = 1; }));
        expect(w.state.modeSwitch?.sw?.input).toEqual({ kind: 'axis', index: 5 });
    });

    it('None (the optional override) clears it and stops watching; Find watches again; a position can get another mode', () => {
        const { w, feed } = checkRig(profile());
        feed(800, radio((t, ax) => { ax[5] = -1; }));
        feed(800, radio((t, ax) => { ax[5] = 1; }));
        w.modeSwitchNone();
        expect(w.state.modeSwitch).toMatchObject({ sw: null, listening: false });
        expect(w.state.profile?.modeSwitch).toBeUndefined();
        feed(800, radio((t, ax) => { ax[5] = -1; }));
        feed(800, radio((t, ax) => { ax[5] = 1; }));
        expect(w.state.modeSwitch?.sw).toBeNull();
        w.modeSwitchFind();
        expect(w.state.modeSwitch?.listening).toBe(true);
        feed(800, radio((t, ax) => { ax[5] = 1; }));
        feed(800, radio((t, ax) => { ax[5] = -1; }));
        expect(w.state.modeSwitch?.sw?.input).toEqual({ kind: 'axis', index: 5 });
        w.modeSwitchSet(2, 'horizon');
        expect(w.state.profile?.modeSwitch?.modes).toEqual(['acro', 'horizon', 'horizon']);
    });

    it('a saved profile with a mode switch resumes with it; Set again keeps it; a profile without one stays without', () => {
        const ms: ModeSwitch = { input: { kind: 'axis', index: 6 }, modes: ['angle', 'horizon', 'acro'] };
        const saved = JSON.parse(JSON.stringify(profile(ms))) as Profile;
        const { w, feed } = checkRig(saved);
        expect(w.state.modeSwitch?.sw).toEqual(ms);
        feed(600, radio(() => undefined));
        expect(w.redo('yaw').ok).toBe(true);
        expect(w.state.modeSwitch).toBeNull();
        expect(w.back()).toBe(true); // back to the check without measuring
        expect(w.state.id).toBe('check');
        expect(w.state.profile?.modeSwitch).toEqual(ms);
        const old = checkRig(profile());
        expect(old.w.state.profile?.modeSwitch).toBeUndefined();
    });

    it('the full no-click wizard (auto pacing): the ideal person reaches the check, flips CH6 there, and the profile has it without one more press', () => {
        // the person paces like the auto wizard (sim/human.ts `auto`): moves the sticks, never presses
        const rig = new Rig({ ...idealHuman('AETR', invSet(0)), auto: true });
        rig.wz.auto = true;
        rig.clicks = false; // the sticks move it on; no button is ever pressed (item 30)
        rig.until((s) => s.id === 'check', 180000);
        expect(rig.st.id).toBe('check');
        const cmds = rig.st.cmds;
        let flipAt = NaN;
        rig.manual = (t, ch) => {
            if (Number.isNaN(flipAt)) flipAt = t + 800;
            ch[0] = 0; ch[1] = 0; ch[2] = -1; ch[3] = 0; ch[4] = -1;
            ch[5] = t < flipAt ? -1 : 1;
        };
        for (let i = 0; i < 2000 / rig.dt; i++) rig.step();
        expect(rig.st.cmds).toBe(cmds);
        expect(rig.st.profile?.modeSwitch?.input).toEqual({ kind: 'axis', index: 5 });
        // the ideal person's arm switch is CH5: never the mode switch
        expect(rig.st.profile?.arm).toMatchObject({ kind: 'axis', index: 4 });
    });
});
