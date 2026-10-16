// The Gamepad API path's sample stamp (v0.8 lane B, the owner's item 7): a new sample is stamped with
// Gamepad.timestamp, when the browser's gamepad thread took it, not when the page's poll loop got
// to it (the loop waits while the main thread draws; the physics applies an input at its stamp).
// Negative controls: a timestamp from another clock, one ahead of now, and a repeat of held values
// keep the poll time; the v0.7 rule (always the poll time) is shown late by exactly the poll delay.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadSource, gamepadStamp } from '../../../apps/fly/src/devices/gamepad';

describe('gamepadStamp', () => {
    it('a new sample: its Gamepad.timestamp when that is a time on this page clock', () => {
        expect(gamepadStamp(true, 1000, 1012, 0)).toBe(1000);
        expect(gamepadStamp(true, 1000, 1100, 0)).toBe(1000); // 100 ms late is still that sample's time
    });

    it('control: a timestamp ahead of now, older than 100 ms, or not a number is not this clock: the poll time', () => {
        expect(gamepadStamp(true, 1013, 1012, 0)).toBe(1012);
        expect(gamepadStamp(true, 1000, 1101, 0)).toBe(1101);
        expect(gamepadStamp(true, 5e9, 1012, 0)).toBe(1012); // a monotonic clock since boot (old browsers)
        expect(gamepadStamp(true, Number.NaN, 1012, 0)).toBe(1012);
    });

    it('a repeat of held values (no new sample) is stamped when it is sent; stamps never go backwards', () => {
        expect(gamepadStamp(false, 1000, 1040, 1000)).toBe(1040);
        expect(gamepadStamp(true, 1035, 1045, 1040)).toBe(1040);
    });

    it('control: the v0.7 rule (the poll time) puts the move as late as the poll was: 25 ms behind a 25 ms frame', () => {
        const v07 = (_fresh: boolean, _ts: number, now: number) => now;
        expect(v07(true, 1000, 1025) - 1000).toBe(25);
        expect(gamepadStamp(true, 1000, 1025, 0) - 1000).toBe(0);
    });
});

describe('GamepadSource stamps its frames with the pad\'s own sample time', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('a DJI pad that reports only changes: the change at its timestamp, the keep-alive at its send time, never backwards', () => {
        const pad = { id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0, 0], buttons: Array.from({ length: 24 }, () => ({ pressed: false })), timestamp: 1000 };
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.t);
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1012); // the first sample, polled 12 ms late
        pad.axes = [0.6, 0, 0, 0, 0];
        pad.timestamp = 1020;
        poll(1045); // polled 25 ms after the browser took it (a frame was drawing)
        poll(1070); // nothing new: the keep-alive repeat
        pad.timestamp = 1065; // a change the browser took before that repeat went out
        poll(1072);
        expect(seen).toEqual([1000, 1020, 1070, 1070]);
        expect(src.frame.axes[0]).toBeCloseTo(0.6, 6);
        expect(src.info()).toEqual({ id: pad.id, axes: { length: 5 }, buttons: { length: 24 } });
    });
});
