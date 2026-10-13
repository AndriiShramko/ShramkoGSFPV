// v0.7 lane D2 on the page, in Node: a radio's channel functions (Profile.switches) drive the arm gate
// and the flight mode through Controls, their action ranges reach the key router's handlers through
// KeyRouter.trigger (the same blocks and crash rules as a key), and stored switches are checked when
// a profile loads. Each claim has a negative control. The app modules read location, document and
// matchMedia when they load, so those are stubbed first (as app-modes.test.ts).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import { KeyRouter } from '../../../apps/fly/src/app/keys';
import type { Profile, RawFrame, SwitchAction, SwitchRange } from '../../../packages/input/src/calib';

type AppControls = typeof import('../../../apps/fly/src/controls');

let C: AppControls;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    C = await import('../../../apps/fly/src/controls');
});

afterEach(() => { vi.restoreAllMocks(); });

class FakeSession {
    sim = { crashed: false };
    sent: Float32Array[] = [];
    input(ch: ArrayLike<number>): void { this.sent.push(Float32Array.from(ch)); }
    get last(): Float32Array { return this.sent[this.sent.length - 1]; }
}

const TX16S: Profile = {
    version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2, angleMode: null,
    axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
    arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -1, on: 1 }
};
const r = (fn: SwitchRange['fn'], index: number, lo: number, hi: number): SwitchRange => ({ fn, input: { kind: 'axis', index }, lo, hi });
/** Mode on CH5 (axis 4), arm on CH6 (axis 5), rewind on CH7 (axis 6): the pilot's radio. */
const PILOT: Profile = { ...TX16S, switches: { v: 1, ranges: [r('arm', 5, 1700, 2100), r('angle', 4, 900, 1300), r('horizon', 4, 1300, 1700), r('respawn.rewind', 6, 1700, 2100)] } };
const us = (u: number) => (u - 1500) / 512;
const frame = (o: { ch5?: number; ch6?: number; ch7?: number; thr?: number } = {}): RawFrame =>
    ({ t: 0, axes: Float32Array.from([0, 0, o.thr ?? -1, 0, us(o.ch5 ?? 1000), us(o.ch6 ?? 1000), us(o.ch7 ?? 1000), 0]), buttons: 0 });

function controls(p: Profile) {
    const s = new FakeSession();
    const c = new C.Controls(s as never);
    c.setProfile(p);
    c.source = 'hid';
    const fired: SwitchAction[] = [];
    c.onSwitchAction = (a) => fired.push(a);
    return { c, s, fired };
}

describe('Controls with channel functions: arm on CH6, mode on CH5', () => {
    it('CH6 off -> on arms through the gate; CH5 picks angle / horizon / acro; the HUD names CH6', () => {
        const { c, s } = controls(PILOT);
        c.raw(frame({ ch6: 1000 }));
        expect(s.last[4]).toBe(-1);
        c.raw(frame({ ch6: 2000 }));
        expect(c.gate.armed).toBe(true);
        expect(s.last[4]).toBe(1);
        expect(s.last[5]).toBe(1); // CH5 low: angle
        c.raw(frame({ ch5: 1500, ch6: 2000 }));
        expect(s.last[5]).toBe(0); // horizon
        c.raw(frame({ ch5: 2000, ch6: 2000 }));
        expect(s.last[5]).toBe(-1); // acro
        expect(c.radioDecides()).toBe(true);
        expect(c.flyingMode()).toBe('acro');
        expect(c.view().armLabel).toMatch(/6/);
        // the wizard's arm switch (CH5, axis 4) no longer arms: CH5 is the mode switch now
        c.raw(frame({ ch5: 2000, ch6: 1000 }));
        expect(c.gate.armed).toBe(false);
    });

    it('control: the same radio without switches arms on CH5 (the wizard\'s) and flies the pilot\'s mode', () => {
        const { c, s } = controls(TX16S);
        c.mode = 'horizon';
        c.raw(frame({ ch5: 1000, ch6: 1000 }));
        c.raw(frame({ ch5: 2000, ch6: 1000 }));
        expect(c.gate.armed).toBe(true);
        expect(s.last[5]).toBe(0);
        expect(c.radioDecides()).toBe(false);
    });

    it('arm needs throttle low and the switch seen off first, as before', () => {
        const { c } = controls(PILOT);
        c.raw(frame({ ch6: 2000 })); // on at connect: no edge
        expect(c.gate.armed).toBe(false);
        c.raw(frame({ ch6: 1000, thr: 0.5 }));
        c.raw(frame({ ch6: 2000, thr: 0.5 }));
        expect(c.gate.block).toBe('throttle');
    });

    it('Space does not arm a radio whose arm is a range, though its wizard arm was the key', () => {
        const { c, s } = controls({ ...PILOT, arm: { kind: 'key' } });
        c.raw(frame({ ch6: 1000 }));
        c.toggleArm();
        expect(s.last[4]).toBe(-1);
        // control: without the arm range Space arms it
        const k = controls({ ...TX16S, arm: { kind: 'key' } });
        k.c.raw(frame());
        k.c.toggleArm();
        expect(k.s.last[4]).toBe(1);
    });

    it('an action range runs once per flip into it, not at connect, not while held, not after a new profile', () => {
        const { c, fired } = controls(PILOT);
        c.raw(frame({ ch7: 2000 }));
        c.raw(frame({ ch7: 2000 }));
        expect(fired).toEqual([]);
        c.raw(frame({ ch7: 1000 }));
        c.raw(frame({ ch7: 2000 }));
        c.raw(frame({ ch7: 2000 }));
        expect(fired).toEqual(['respawn.rewind']);
        c.setProfile(PILOT);
        c.raw(frame({ ch7: 2000 }));
        expect(fired).toEqual(['respawn.rewind']);
    });
});

describe('KeyRouter.trigger: a switch presses the action\'s key', () => {
    it('runs the last handler with a keydown of the action\'s first key; respects blocks and the crash state', () => {
        let state: 'flight' | 'crash' = 'flight';
        const keys = new KeyRouter({ map: KEYMAP, state: () => state, isText: () => false });
        const seen: string[] = [];
        keys.on('respawn.rewind', (e) => seen.push(`rewind:${e.code}`));
        keys.on('scene.random', (e) => seen.push(`random:${e.code}:${e.shiftKey}`));
        keys.on('crash.keep', () => seen.push('keep'));
        expect(keys.trigger('respawn.rewind')).toBe('respawn.rewind');
        expect(keys.trigger('scene.random')).toBe('scene.random');
        expect(seen).toEqual(['rewind:KeyY', 'random:KeyN:true']);
        // crash.keep listens only while crashed
        expect(keys.trigger('crash.keep')).toBeNull();
        state = 'crash';
        expect(keys.trigger('crash.keep')).toBe('crash.keep');
        // a screen with keys of its own holds switch actions back too
        const unblock = keys.block(() => true);
        expect(keys.trigger('respawn.rewind')).toBeNull();
        unblock();
        // nothing registered, or a keyboard-flying binding: nothing runs
        expect(keys.trigger('record.toggle')).toBeNull();
        expect(keys.trigger('arm.toggle')).toBeNull();
        expect(seen).toEqual(['rewind:KeyY', 'random:KeyN:true', 'keep']);
    });
});

describe('stored switches are checked when a profile loads', () => {
    it('readable ranges stay; a broken entry is dropped with a warning; unreadable switches go, the wizard\'s arm stays', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(C.checkProfile(PILOT)).toEqual(PILOT);
        const odd = C.checkProfile({ ...PILOT, switches: { v: 1, ranges: [...PILOT.switches!.ranges, { fn: 'arm', input: { kind: 'axis', index: 5 }, lo: 1710, hi: 2100 }] } });
        expect(odd?.switches).toEqual(PILOT.switches);
        const gone = C.checkProfile({ ...PILOT, switches: 'arm on CH6' });
        expect(gone?.switches).toBeUndefined();
        expect(gone?.arm).toEqual(TX16S.arm);
        expect(warn).toHaveBeenCalledTimes(2);
        // control: a profile without switches is returned as it is, no copy, no warning
        expect(C.checkProfile(TX16S)).toBe(TX16S);
        expect(warn).toHaveBeenCalledTimes(2);
    });
});
