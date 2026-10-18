// The Gamepad API path's sample stamp (v0.8 lane B, the owner's item 7): a new sample is stamped with
// Gamepad.timestamp, when the browser's gamepad thread took it, not when the page's poll loop got
// to it (the loop waits while the main thread draws; the physics applies an input at its stamp).
// Negative controls: a timestamp from another clock, one ahead of now, and a repeat of held values
// keep the poll time; the v0.7 rule (always the poll time) is shown late by exactly the poll delay.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadSource, gamepadSampleTime, gamepadStamp } from '../../../apps/fly/src/devices/gamepad';

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

describe('GamepadSource: the stamps it sends are gamepadStamp\'s (v0.9 lane E review)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('a timestamp that goes backwards is stamped at the poll, one before the last stamp keeps it: the stamps never decrease', () => {
        const pad = { id: 'Radiomaster GX12 BLE', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false })), timestamp: 1000 };
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.t);
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1010); // first sample: its timestamp
        pad.axes = [0.3, 0, 0, 0];
        pad.timestamp = 990; // the clock went back: not the time the move happened
        poll(1020);
        pad.axes = [0.6, 0, 0, 0];
        pad.timestamp = 1015; // forward again, but before the stamp 1020 already sent
        poll(1030);
        expect(seen).toEqual([1000, 1020, 1020]);
        expect(seen.every((t, i) => i === 0 || t >= seen[i - 1])).toBe(true);
    });

    it('control: the same pad with a plain forward clock is stamped at its own times', () => {
        const pad = { id: 'Radiomaster GX12 BLE', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false })), timestamp: 1000 };
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.t);
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1010);
        pad.axes = [0.3, 0, 0, 0];
        pad.timestamp = 1012;
        poll(1020);
        pad.axes = [0.6, 0, 0, 0];
        pad.timestamp = 1024;
        poll(1030);
        expect(seen).toEqual([1000, 1012, 1024]);
    });
});

describe('gamepadSampleTime and a timestamp that goes backwards (v0.9 lane E)', () => {
    it('a timestamp before the previous sample\'s own is not a time the move happened: the poll time', () => {
        expect(gamepadSampleTime(true, 1000, 1012, 990)).toBe(1000);
        expect(gamepadSampleTime(true, 985, 1012, 990)).toBe(1012);
        expect(gamepadStamp(true, 985, 1012, 1000, 990)).toBe(1012);
    });

    it('control: equal to the previous timestamp is not backwards, and the old four-argument call has no such check', () => {
        expect(gamepadSampleTime(true, 990, 1012, 990)).toBe(990);
        expect(gamepadStamp(true, 985, 1012, 0)).toBe(985);
    });
});

describe('GamepadSource reads values that move under a frozen timestamp (v0.9 lane E)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const padOf = () => ({ id: 'Radiomaster GX12 BLE', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false })), timestamp: 500 });

    it('a changed axis is sent at that poll, not at the 20 ms keep-alive; a held value is sent only at the keep-alive', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        const seen: Array<[number, number]> = [];
        src.onFrame = (f) => seen.push([f.t, f.axes[0]]);
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1000); // the first sample
        poll(1004); // nothing new, 4 ms after the last send: nothing
        pad.axes = [0.5, 0, 0, 0];
        poll(1008); // the value moved, the timestamp did not: sent now
        poll(1012); // held: nothing
        poll(1030); // held 22 ms: the keep-alive
        expect(seen.map((x) => x[0])).toEqual([1000, 1008, 1030]);
        expect(seen[1][1]).toBeCloseTo(0.5, 6);
    });

    it('control: the v0.8 rule (a new sample only when the timestamp moves) holds the same move back to the keep-alive', () => {
        const old = (stamped: boolean, now: number, lastEmit: number) => stamped || now - lastEmit >= 20;
        expect(old(false, 1008, 1000)).toBe(false); // v0.8: not sent at 1008
        expect(old(false, 1020, 1000)).toBe(true); // ... only at 1020, 12 ms later
    });

    it('a button that changed under a frozen timestamp is sent at once too', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.buttons);
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1000);
        pad.buttons[2] = { pressed: true };
        poll(1003);
        expect(seen).toEqual([0, 4]);
    });

    it('a NaN axis is not a move every poll', () => {
        const pad = padOf();
        pad.axes = [Number.NaN, 0, 0, 0];
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        let n = 0;
        src.onFrame = () => n++;
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        for (let t = 1000; t < 1015; t += 2) poll(t);
        expect(n).toBe(1); // the first sample; the rest are holds inside the keep-alive
    });

    it('counts a moved value as a sample for the link meter, a keep-alive repeat not', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        const src = new GamepadSource();
        src.onFrame = () => undefined;
        const poll = (now: number) => (src as unknown as { poll(n: number): void }).poll(now);
        poll(1000);
        poll(1021); // keep-alive repeat
        pad.axes = [0.2, 0, 0, 0];
        poll(1025); // moved
        const m = src.link as unknown as { count: number };
        expect(m.count).toBe(2); // the first sample and the move
    });

    it('pollNow reads the pad outside the loop\'s rhythm and sends only what is new', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        vi.stubGlobal('document', { visibilityState: 'visible' });
        let clock = 1000;
        vi.stubGlobal('performance', { now: () => clock });
        const src = new GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.axes[0]);
        (src as unknown as { running: boolean }).running = true; // start() without the message loop
        src.pollNow();
        clock = 1001;
        src.pollNow(); // nothing new
        pad.timestamp = 510;
        pad.axes = [0.4, 0, 0, 0];
        clock = 1002;
        src.pollNow();
        expect(seen.length).toBe(2);
        expect(seen[1]).toBeCloseTo(0.4, 6);
    });

    it('control: pollNow does nothing before start() and while the page is hidden', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        vi.stubGlobal('document', { visibilityState: 'hidden' });
        vi.stubGlobal('performance', { now: () => 1000 });
        const src = new GamepadSource();
        let n = 0;
        src.onFrame = () => n++;
        src.pollNow();
        (src as unknown as { running: boolean }).running = true;
        src.pollNow();
        expect(n).toBe(0);
    });
});
