// What the Controls screen asks of the device in use (apps/fly/src/ui/device-rate.ts, v0.9 lane E review):
// a read of the pad just before each frame draws, the rate, and the line and note about how the reports
// arrive. The code the screen runs, with the screen's DOM replaced by two plain slots. Negative controls:
// a WebHID radio and the simulated radio have no read-before-draw, a fast link or a quiet device gets
// no note, a device with no meter gets no line, and the line is rewritten twice a second, not every frame.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LinkMeter } from '../../../packages/input/src';
import { reportTimes } from '../../../packages/input/src/sim';
import type { LinkKind } from '../../../packages/input/src/sim';
import { fakeDocument } from './helpers/fake-dom';

type RateModule = typeof import('../../../apps/fly/src/ui/device-rate');
type PadModule = typeof import('../../../apps/fly/src/devices/gamepad');
let R: RateModule;
let G: PadModule;

beforeAll(async () => {
    vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
    vi.stubGlobal('document', fakeDocument());
    vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
    R = await import('../../../apps/fly/src/ui/device-rate');
    G = await import('../../../apps/fly/src/devices/gamepad');
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); }); // the locale is read once at import (i18n.ts): later tests do not need the page globals

const slots = () => ({ line: { textContent: '' as string | null }, note: { textContent: '' as string | null, hidden: true as boolean | string } });

/** A meter fed with `kind` for 3 s, as a device's `link`. */
function meterOf(kind: LinkKind): LinkMeter {
    const m = new LinkMeter();
    for (const t of reportTimes(kind, 3000)) m.note(t);
    return m;
}

describe('rateOf', () => {
    const padOf = () => ({ id: 'Radiomaster GX12 BLE', index: 0, connected: true, mapping: '', axes: [0, 0, 0, 0], buttons: Array.from({ length: 8 }, () => ({ pressed: false })), timestamp: 500 });

    it('a gamepad: its rate, its link meter, and a read of the pad that sends what the browser published since the loop looked', () => {
        const pad = padOf();
        vi.stubGlobal('navigator', { getGamepads: () => [pad] });
        vi.stubGlobal('document', { visibilityState: 'visible' });
        let clock = 1000;
        vi.stubGlobal('performance', { now: () => clock });
        const src = new G.GamepadSource();
        const seen: number[] = [];
        src.onFrame = (f) => seen.push(f.axes[0]);
        (src as unknown as { running: boolean }).running = true; // start() without the message loop
        const rate = R.rateOf(src);
        expect(typeof rate.pollNow).toBe('function');
        expect(typeof rate.link).toBe('function');
        expect(rate.hz()).toBe(src.rateHz);
        expect(rate.link!(clock)).toEqual(src.link.stats(clock)); // this source's own meter
        rate.pollNow!();
        expect(seen.length).toBe(1);
        pad.timestamp = 510;
        pad.axes = [0.4, 0, 0, 0];
        clock = 1002;
        rate.pollNow!();
        expect(seen.length).toBe(2);
        expect(seen[1]).toBeCloseTo(0.4, 6);
    });

    it('control: a WebHID radio has a rate and a link meter but nothing to poll (its reports are events)', () => {
        const hid = { rateHz: 180, link: new LinkMeter() };
        const rate = R.rateOf(hid as never);
        expect(rate.hz()).toBe(180);
        expect(typeof rate.link).toBe('function');
        expect(rate.pollNow).toBeUndefined();
    });
});

describe('drawFrame: one display frame of the Controls screen', () => {
    it('the pad is read before the screen draws, so the frame shows the report that came in just before it', () => {
        const order: string[] = [];
        R.drawFrame({ hz: () => 0, pollNow: () => order.push('read') }, () => order.push('draw'));
        expect(order).toEqual(['read', 'draw']);
    });

    it('control: a device with nothing to poll (WebHID, the simulated radio) still draws, once', () => {
        const order: string[] = [];
        R.drawFrame({ hz: () => 0 }, () => order.push('draw'));
        expect(order).toEqual(['draw']);
    });

    it('control: the pad is read exactly once per frame, not once per call site', () => {
        let reads = 0;
        const rate = { hz: () => 0, pollNow: () => { reads++; } };
        for (let i = 0; i < 5; i++) R.drawFrame(rate, () => undefined);
        expect(reads).toBe(5);
    });
});

describe('LinkReadout: the line and the note on the Controls screen', () => {
    const rateOfMeter = (m: LinkMeter) => ({ hz: () => 0, link: (now: number) => m.stats(now) });

    it('a slow link: the line of numbers and the note, shown', () => {
        const s = slots();
        new R.LinkReadout(s).update(rateOfMeter(meterOf('ble30')), 3000, true);
        expect(s.line.textContent).toMatch(/^reports every 33 ms/);
        expect(s.note.hidden).toBe(false);
        expect(s.note.textContent).toMatch(/USB/);
        expect(s.note.textContent).toMatch(/33/);
    });

    it('a bunched link: its own note', () => {
        const s = slots();
        new R.LinkReadout(s).update(rateOfMeter(meterOf('bleBursty')), 3000, true);
        expect(s.note.hidden).toBe(false);
        expect(s.note.textContent).toMatch(/bunches/);
    });

    it('control: a cable, a wired 100 Hz joystick and a healthy Bluetooth link get the numbers and no note', () => {
        for (const kind of ['usb1000', 'usb125', 'usb100', 'ble90'] as const) {
            const s = slots();
            new R.LinkReadout(s).update(rateOfMeter(meterOf(kind)), 3000, true);
            expect(s.line.textContent, kind).toMatch(/^reports every/);
            expect(s.note.hidden, kind).toBe(true);
            expect(s.note.textContent, kind).toBe('');
        }
    });

    it('control: nothing before the device has reported, and nothing for a device with no meter', () => {
        const s = slots();
        new R.LinkReadout(s).update(rateOfMeter(meterOf('ble30')), 3000, false);
        expect([s.line.textContent, s.note.hidden]).toEqual(['', true]);
        const quiet = slots();
        new R.LinkReadout(quiet).update({ hz: () => 0 }, 3000, true); // the simulated radio
        expect([quiet.line.textContent, quiet.note.hidden]).toEqual(['', true]);
    });

    it('control: a quiet device (the meter has too little to say) is not a slow link', () => {
        const s = slots();
        new R.LinkReadout(s).update(rateOfMeter(meterOf('ble30')), 3000 + 5000, true); // 5 s on: the window is empty
        expect([s.line.textContent, s.note.hidden]).toEqual(['', true]);
    });

    it('written twice a second, not every frame; and the note goes away when the link recovers', () => {
        const m = new LinkMeter();
        const rate = { hz: () => 0, link: (now: number) => m.stats(now) };
        const s = slots();
        const out = new R.LinkReadout(s);
        let asked = 0;
        const counting = { hz: () => 0, link: (now: number) => { asked++; return m.stats(now); } };
        for (let t = 0; t < 3000; t += 33.3) m.note(t); // a slow link
        out.update(counting, 3000, true);
        expect(s.note.hidden).toBe(false);
        for (let k = 1; k <= 10; k++) out.update(counting, 3000 + k * 33.3, true); // ten more frames within 500 ms: not asked
        expect(asked).toBe(1);
        // the device speeds up (a cable): 3 s of 8 ms gaps, and the next write clears the note
        for (let t = 3000; t < 6500; t += 8) m.note(t);
        out.update(counting, 6500, true);
        expect(asked).toBe(2);
        expect(s.note.hidden).toBe(true);
        expect(rate.link(6500).verdict).toBe('ok');
    });
});
