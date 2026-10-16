// A recognised controller's profile on the page, in Node (v0.8 lane B): the DJI FPV Remote Controller
// 3's known setup flies through Controls (the start/stop button toggles the arm with the throttle down,
// the flight-mode switch made of two bits gives Angle / Horizon / Acro, the HUD names its channels as
// Betaflight does), and saved profiles keep loading: one from before v0.8 unchanged, one with a channel
// table and a two-bit mode switch as saved, a broken table dropped with the profile kept. Each claim
// has a negative control. The app modules read location, document and matchMedia when they load, so
// those are stubbed first (as app-switches.test.ts).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { knownProfile, recognise, seenFromGamepad } from '../../../packages/input/src/index';
import type { Profile, RawFrame } from '../../../packages/input/src/index';

type AppControls = typeof import('../../../apps/fly/src/controls');
let C: AppControls;
const doc = { cookie: '', documentElement: { lang: '' }, visibilityState: 'visible' };

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/fly/', href: 'http://127.0.0.1/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    C = await import('../../../apps/fly/src/controls');
});

class FakeSession {
    sim = { crashed: false };
    sent: Float32Array[] = [];
    input(ch: ArrayLike<number>): void { this.sent.push(Float32Array.from(ch)); }
    get last(): Float32Array { return this.sent[this.sent.length - 1]; }
}

const ID = 'HID Interface (Vendor: 2ca3 Product: 1021)';
function dji(): Profile {
    const m = recognise(seenFromGamepad({ id: ID, axes: { length: 5 }, buttons: { length: 24 } }));
    return knownProfile(m!, `gp:${ID}:5:24:`, 'DJI FPV Remote Controller 3')!;
}
/** A DJI frame: sticks (-1..1) X Y Z Rx, the dial, and the button mask (0x50 = both switches at their low end). */
const f = (o: { thr?: number; roll?: number; buttons?: number } = {}): RawFrame =>
    ({ t: 0, axes: Float32Array.from([o.roll ?? 0, 0, o.thr ?? -1, 0, 0, 0, 0, 0]), buttons: o.buttons ?? 0x50 });

function controls(p: Profile) {
    const s = new FakeSession();
    const c = new C.Controls(s as never);
    c.setProfile(p);
    c.source = 'gamepad';
    return { c, s };
}

describe('the DJI flies with its known setup', () => {
    it('throttle down, start/stop pressed and released arms; pressed again disarms', () => {
        const { c } = controls(dji());
        c.raw(f());
        c.raw(f({ buttons: 0x54 }));
        c.raw(f());
        expect(c.gate.armed).toBe(true);
        c.raw(f({ buttons: 0x54 }));
        c.raw(f());
        expect(c.gate.armed).toBe(false);
    });

    it('control: with the springing throttle in its middle (50 %) a press does not arm (the gate says throttle)', () => {
        const { c } = controls(dji());
        c.raw(f({ thr: 0 }));
        c.raw(f({ thr: 0, buttons: 0x54 }));
        c.raw(f({ thr: 0 }));
        expect(c.gate.armed).toBe(false);
        expect(c.block).toBe('throttle');
    });

    it('the flight-mode switch N / S / M decides the mode: Angle / Horizon / Acro; control: another bit (C2) does not', () => {
        const { c } = controls(dji());
        const mode = (buttons: number) => { c.raw(f({ buttons })); return c.flyingMode(); };
        expect(c.radioDecides()).toBe(true);
        expect([0x50, 0x10, 0x90].map(mode)).toEqual(['angle', 'horizon', 'acro']);
        // the C2 switch (bits 4/5) through all three positions: the mode stays Angle
        expect([0x40, 0x60, 0x50].map(mode)).toEqual(['angle', 'angle', 'angle']);
    });

    it('the HUD and the Switches screen name its controls by its Betaflight channels: the mode switch CH5, the arm button CH8; a button with no channel by its number', () => {
        const { c } = controls(dji());
        expect(c.nameOf({ kind: 'bits', lo: 6, hi: 7 })).toBe('CH5');
        expect(c.nameOf({ kind: 'button', bit: 2 })).toBe('CH8');
        expect(c.nameOf({ kind: 'button', bit: 3 })).toBe('button 4');
        expect(c.nameOf({ kind: 'axis', index: 4 })).toBe('axis 5');
        // control: a profile without a table names a gamepad's two-bit switch by its buttons
        const plain = { ...dji() };
        delete plain.channels;
        const k = controls(plain);
        expect(k.c.nameOf({ kind: 'bits', lo: 6, hi: 7 })).toBe('buttons 7/8');
    });

    it('the HUD\'s arm card names the arm by what is printed on the controller; control: the same profile not recognised says "button 3"', () => {
        const { c } = controls(dji());
        expect(c.view().armLabel).toBe('Start/stop button');
        expect(c.view().armKind).toBe('toggle');
        const plain = { ...dji() };
        delete plain.known;
        expect(controls(plain).c.view().armLabel).toBe('button 3');
    });

    it('a full roll reads 1 and the measured rest offset reads 0 (its deadband)', () => {
        const { c, s } = controls(dji());
        c.raw(f({ roll: 1 }));
        expect(s.last[0]).toBe(1);
        c.raw(f({ roll: -11 / 660 }));
        expect(s.last[0]).toBe(0);
    });
});

describe('saved profiles keep loading', () => {
    const OLD = {
        version: 1, deviceKey: 'hid:1209:4f54:Radiomaster TX16S Joystick:19', deviceName: 'Radiomaster TX16S Joystick', deadband: 0, created: '2026-09-26T19:44:02.118Z', mode: 2, wizard: 2, angleMode: null,
        axes: { roll: { index: 0, invert: false, center: 0, min: -1, max: 1 }, pitch: { index: 1, invert: false, center: 0, min: -1, max: 1 }, throttle: { index: 2, invert: false, center: -1, min: -1, max: 1 }, yaw: { index: 3, invert: false, center: 0, min: -1, max: 1 } },
        arm: { kind: 'axis', index: 4, threshold: 0.4985, onAbove: true, off: -1, on: 1 },
        modeSwitch: { input: { kind: 'axis', index: 5 }, modes: ['acro', 'horizon', 'angle'] }
    };

    it('a profile saved before v0.8 (an EdgeTX radio\'s, its key unchanged) loads exactly as saved', () => {
        const text = JSON.stringify(OLD);
        expect(C.parseProfile(text)).toEqual(JSON.parse(text));
    });

    it('the DJI\'s known profile round-trips through a file: the channel table and the two-bit mode switch as saved', () => {
        const p = dji();
        expect(C.parseProfile(JSON.stringify(p))).toEqual(JSON.parse(JSON.stringify(p)));
    });

    it('control: a broken channel table is dropped (names fall back), the sticks, arm and mode switch stay', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const p = { ...JSON.parse(JSON.stringify(dji())), channels: [{ kind: 'bits', lo: 3, hi: 3 }] };
        const back = C.parseProfile(JSON.stringify(p))!;
        expect(back.channels).toBeUndefined();
        expect(back.axes).toEqual(p.axes);
        expect(back.modeSwitch).toEqual(p.modeSwitch);
        expect(warn).toHaveBeenCalled();
    });

    it('control: a mode switch of a kind this build cannot read is dropped and the profile kept (how an older build treats a two-bit one)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const p = { ...OLD, modeSwitch: { input: { kind: 'pair-of-something', a: 1 }, modes: ['acro', 'horizon', 'angle'] } };
        const back = C.parseProfile(JSON.stringify(p))!;
        expect(back.modeSwitch).toBeUndefined();
        expect(back.axes).toEqual(OLD.axes);
        expect(warn).toHaveBeenCalled();
    });
});
