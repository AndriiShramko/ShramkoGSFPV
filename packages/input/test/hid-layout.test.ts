// A HID joystick read through its own report descriptor (hid-layout.ts), and the DJI RC 3 in its
// simulator mode as the case that was not seen: 13-byte reports of 5 x int16 + 24 button bits, which the
// EdgeTX reader (19 or 16 bytes and more) refused, so the radio screen counted every report as unreadable
// and the wizard never left "connect". Negative controls: the same bytes through the EdgeTX reader.

import { describe, expect, it } from 'vitest';
import { CalibrationWizard } from '../src/calib';
import type { RawFrame } from '../src/calib';
import { isEdgeTx, parseEdgeTxReport } from '../src/edgetx';
import { decodeHidReport, hidDisplayName, layoutsFromCollections, makeHidReader } from '../src/hid-layout';
import type { HidCollectionInfo } from '../src/hid-layout';
import { DJI_RC3, djiRc3Report } from '../src/sim/devices';
import { newWizardAdapter, randomHuman, runHuman } from '../src/sim/human';
import { allOrders, invSet } from './helpers';
import { DJI_RC3_STIR } from './fixtures/dji-rc3-stir';

const P1 = 0x10000;
const P9 = 0x90000;
const hex = (s: string): DataView => new DataView(Uint8Array.from(s.split(' ').map((x) => parseInt(x, 16))).buffer);
const newFrame = (): RawFrame => ({ t: 0, axes: new Float32Array(8), buttons: 0 });
const djiLayouts = layoutsFromCollections(DJI_RC3.collections);

describe('layout from the report descriptor', () => {
    it('DJI RC 3: one report of 13 bytes, 5 signed 16-bit axes -660..660 (X Y Z Rx Ry) and 24 buttons', () => {
        expect(djiLayouts).toHaveLength(1);
        const l = djiLayouts[0];
        expect(l.reportId).toBe(0);
        expect(l.bytes).toBe(13);
        expect(l.axes.map((a) => [a.usage, a.bit, a.size, a.signed, a.lo, a.hi])).toEqual([
            [0x30, 0, 16, true, -660, 660], [0x31, 16, 16, true, -660, 660], [0x32, 32, 16, true, -660, 660], [0x33, 48, 16, true, -660, 660], [0x34, 64, 16, true, -660, 660]
        ]);
        expect(l.buttons).toHaveLength(24);
        expect(l.buttons[0]).toEqual({ bit: 80, index: 0 });
        expect(l.buttons[23]).toEqual({ bit: 103, index: 23 });
    });

    it('a device with no axis (a keyboard, a vendor page) has no layout; so has a missing descriptor', () => {
        const kbd: HidCollectionInfo[] = [{ usagePage: 1, usage: 6, inputReports: [{ reportId: 0, items: [
            { isConstant: false, isRange: true, usageMinimum: 0x70000 | 0xe0, usageMaximum: 0x70000 | 0xe7, reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 }
        ] }] }];
        expect(layoutsFromCollections(kbd)).toEqual([]);
        expect(layoutsFromCollections(undefined)).toEqual([]);
        expect(layoutsFromCollections([])).toEqual([]);
    });
});

describe('decoding by the descriptor', () => {
    it('known answers: the DJI RC 3 at rest and at the stops (hand-written bytes)', () => {
        const f = newFrame();
        // X -11, Rx -8, the rest 0; buttons 0x50 held (what the controller read at rest)
        expect(decodeHidReport(djiLayouts, 0, hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00'), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 5))).toEqual([-11 / 660, 0, 0, -8 / 660, 0].map((x) => Math.fround(x)));
        expect(Array.from(f.axes.slice(5))).toEqual([0, 0, 0]);
        expect(f.buttons).toBe(0x50);
        // X +660, Y -660, Z 0, Rx +660, Ry -660; buttons 1 and 24
        expect(decodeHidReport(djiLayouts, 0, hex('94 02 6C FD 00 00 94 02 6C FD 01 00 80'), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 5))).toEqual([1, -1, 0, 1, -1]);
        expect(f.buttons).toBe(0x800001);
    });

    it('refuses a report that is shorter than the layout or has another report id', () => {
        const f = newFrame();
        expect(decodeHidReport(djiLayouts, 0, hex('F5 FF 00 00'), f)).toBe(false);
        expect(decodeHidReport(djiLayouts, 7, hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00'), f)).toBe(false);
    });

    it('follows the descriptor, not a fixed order: buttons first, a padding byte, Y before X', () => {
        const cols: HidCollectionInfo[] = [{ usagePage: 1, usage: 4, inputReports: [{ reportId: 0, items: [
            { isConstant: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 8, reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 },
            { isConstant: true, reportSize: 8, reportCount: 1 },
            { isConstant: false, isRange: false, usages: [P1 | 0x31], reportSize: 16, reportCount: 1, logicalMinimum: -660, logicalMaximum: 660 },
            { isConstant: false, isRange: false, usages: [P1 | 0x30], reportSize: 16, reportCount: 1, logicalMinimum: -660, logicalMaximum: 660 }
        ] }] }];
        const lay = layoutsFromCollections(cols);
        expect(lay[0].bytes).toBe(6);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('05 FF 94 02 6C FD'), f)).toBe(true);
        expect(f.buttons).toBe(5);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([1, -1]); // Y first, then X: report order
    });

    it('reads fields that do not start on a byte: two unsigned 12-bit axes 0..4095', () => {
        const cols: HidCollectionInfo[] = [{ usagePage: 1, usage: 4, inputReports: [{ reportId: 3, items: [
            { isConstant: false, isRange: false, usages: [P1 | 0x30, P1 | 0x31], reportSize: 12, reportCount: 2, logicalMinimum: 0, logicalMaximum: 4095 },
            { isConstant: true, reportSize: 4, reportCount: 1 }
        ] }] }];
        const lay = layoutsFromCollections(cols);
        const f = newFrame();
        expect(decodeHidReport(lay, 3, hex('00 F0 FF 00'), f)).toBe(true); // X = 0x000, Y = 0xFFF
        expect(f.axes[0]).toBe(-1);
        expect(f.axes[1]).toBe(1);
        expect(decodeHidReport(lay, 3, hex('00 08 80 00'), f)).toBe(true); // X = 0x800 (the middle), Y = 0x800
        expect(Math.abs(f.axes[0])).toBeLessThan(0.001);
        expect(Math.abs(f.axes[1])).toBeLessThan(0.001);
    });

    it('axes in two report ids get their own channels; a report updates only its own channels and buttons', () => {
        // a 3D mouse / twin-pad adapter shape: report 1 = X Y + buttons 1..4, report 2 = Rx Ry + buttons 1..4
        const pad = (id: number, u1: number, u2: number) => ({ reportId: id, items: [
            { isConstant: false, isRange: false, usages: [P1 | u1, P1 | u2], reportSize: 8, reportCount: 2, logicalMinimum: -127, logicalMaximum: 127 },
            { isConstant: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 4, reportSize: 1, reportCount: 4, logicalMinimum: 0, logicalMaximum: 1 },
            { isConstant: true, reportSize: 4, reportCount: 1 }
        ] });
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 8, inputReports: [pad(2, 0x33, 0x34), pad(1, 0x30, 0x31)] }]);
        expect(lay.map((l) => [l.reportId, l.axes.map((a) => a.ch), l.buttons.map((b) => b.index)])).toEqual([
            [1, [0, 1], [0, 1, 2, 3]], [2, [2, 3], [4, 5, 6, 7]]
        ]);
        const f = newFrame();
        expect(decodeHidReport(lay, 1, hex('7F 81 05'), f)).toBe(true); // X +127, Y -127, buttons 1 and 3
        expect(decodeHidReport(lay, 2, hex('00 7F 02'), f)).toBe(true); // Rx 0, Ry +127, button 2
        // report 1's values survive report 2 (the pre-fix decoder zeroed the frame and wrote both to CH1..2)
        expect(Array.from(f.axes.slice(0, 4))).toEqual([1, -1, 0, 1]);
        expect(f.buttons).toBe(0b0010_0101);
        expect(decodeHidReport(lay, 1, hex('00 00 00'), f)).toBe(true); // report 1 back at rest, nothing pressed
        expect(Array.from(f.axes.slice(0, 4))).toEqual([0, 0, 0, 1]);
        expect(f.buttons).toBe(0b0010_0000);
    });

    it('a report repeated in a nested collection (as Chromium lists it) is read once, from the outermost listing', () => {
        const whole = { reportId: 0, items: [
            { isConstant: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 8, reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 },
            { isConstant: false, isRange: false, usages: [P1 | 0x30, P1 | 0x31], reportSize: 16, reportCount: 2, logicalMinimum: 0, logicalMaximum: 2047 }
        ] };
        const axesOnly = { reportId: 0, items: [whole.items[1]] }; // the Physical child: its own items from bit 0
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 4, inputReports: [whole], children: [{ usagePage: 1, usage: 1, inputReports: [axesOnly] }] }]);
        expect(lay).toHaveLength(1);
        expect(lay[0].axes.map((a) => [a.ch, a.bit])).toEqual([[0, 8], [1, 24]]);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('81 FF 07 00 00'), f)).toBe(true); // buttons 1 and 8, X 2047, Y 0
        expect(f.buttons).toBe(0x81);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([1, -1]);
    });

    it('a report with buttons only is read too when the device has axes elsewhere', () => {
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 5, inputReports: [
            { reportId: 1, items: [{ isConstant: false, isRange: false, usages: [P1 | 0x30], reportSize: 8, reportCount: 1, logicalMinimum: -127, logicalMaximum: 127 }] },
            { reportId: 2, items: [{ isConstant: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 8, reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 }] }
        ] }]);
        const f = newFrame();
        expect(decodeHidReport(lay, 2, hex('03'), f)).toBe(true);
        expect(f.buttons).toBe(3);
        // without any axis the device is not a joystick for this reader
        expect(layoutsFromCollections([{ usagePage: 1, usage: 5, inputReports: [
            { reportId: 2, items: [{ isConstant: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 8, reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 }] }
        ] }])).toEqual([]);
    });

    it('names a device by its product name, or by its USB ids when it only says "HID Interface"', () => {
        expect(hidDisplayName({ vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface' })).toBe('USB 2ca3:1021');
        expect(hidDisplayName({ vendorId: 0x2ca3, productId: 0x1021, productName: '' })).toBe('USB 2ca3:1021');
        expect(hidDisplayName({ vendorId: 0x1209, productId: 0x4f54, productName: 'RadioMaster TX16S Joystick' })).toBe('RadioMaster TX16S Joystick');
        expect(isEdgeTx({ vendorId: 0x1209, productId: 0x4f54 })).toBe(true);
        expect(isEdgeTx(DJI_RC3)).toBe(false);
    });
});

describe('the reader HidSource picks for a device', () => {
    it('an EdgeTX radio keeps the fixed layout even with a descriptor; a DJI RC 3 goes by its descriptor', () => {
        // an EdgeTX Classic report: buttons 0x000001, CH1 2048 (top), CH2 0 (bottom), CH3..CH8 1024
        const edgetx = hex('01 00 00 00 08 00 00 00 04 00 04 00 04 00 04 00 04 00 04');
        const r = makeHidReader({ vendorId: 0x1209, productId: 0x4f54, collections: DJI_RC3.collections });
        const f = newFrame();
        expect(r(0, edgetx, f)).toBe(true);
        expect(Array.from(f.axes)).toEqual([1, -1, 0, 0, 0, 0, 0, 0]);
        expect(f.buttons).toBe(1);
        const dji = hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00');
        expect(djiReader(0, dji, f)).toBe(true);
        expect(f.buttons).toBe(0x50);
        // negative control: the 13 bytes through the EdgeTX reader, the only reader before the fix
        expect(parseEdgeTxReport(dji, newFrame())).toBe(false);
    });

    it('a device without a usable descriptor falls back to the EdgeTX layout, as before', () => {
        const r = makeHidReader({ vendorId: 0x1234, productId: 0x5678 });
        const f = newFrame();
        expect(r(0, hex('01 00 00 00 08 00 00 00 04 00 04 00 04 00 04 00 04 00 04'), f)).toBe(true);
        expect(Array.from(f.axes)).toEqual([1, -1, 0, 0, 0, 0, 0, 0]);
        expect(f.buttons).toBe(1);
        expect(r(0, hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00'), newFrame())).toBe(false);
    });
});

describe('DJI RC 3 real stick traffic (2026-10-15)', () => {
    it('is read by the descriptor and refused by the EdgeTX reader (negative control)', () => {
        const f = newFrame();
        let edgetxReads = 0;
        for (const [, a0, a1, a2, a3, a4, b] of DJI_RC3_STIR) {
            const bytes = djiRc3Report([a0, a1, a2, a3, a4], b);
            const dv = new DataView(bytes.buffer);
            expect(djiReader(0, dv, f)).toBe(true);
            [a0, a1, a2, a3, a4].forEach((raw, i) => expect(f.axes[i]).toBeCloseTo(raw / 660, 6));
            expect(f.buttons).toBe(b);
            if (parseEdgeTxReport(dv, newFrame())) edgetxReads++;
        }
        expect(DJI_RC3_STIR.length).toBeGreaterThan(600);
        expect(edgetxReads).toBe(0); // before the fix every one of these reports was "a report we cannot read"
    });
});

// the same bytes, two readers: the wizard sees what the reader hands it
function djiWizard(read: (dv: DataView, out: RawFrame) => boolean): CalibrationWizard {
    const w = new CalibrationWizard('hid:2ca3:1021:HID Interface:13', 'USB 2ca3:1021');
    const feed0 = w.feed.bind(w);
    const out = newFrame();
    w.feed = (f: RawFrame) => {
        const raw = [0, 1, 2, 3, 4].map((i) => f.axes[i] * 660);
        if (!read(new DataView(djiRc3Report(raw, f.buttons).buffer), out)) return w.state;
        out.t = f.t;
        return feed0(out);
    };
    return w;
}
// what HidSource now does with the device, and what it did before (every report through the EdgeTX reader)
const djiReader = makeHidReader(DJI_RC3);
const byDescriptor = (dv: DataView, out: RawFrame): boolean => djiReader(0, dv, out);
const byEdgeTx = (dv: DataView, out: RawFrame): boolean => parseEdgeTxReport(dv, out);

describe('the wizard with a DJI RC 3', () => {
    function stirTrace(read: (dv: DataView, out: RawFrame) => boolean): CalibrationWizard {
        const w = djiWizard(read);
        w.auto = true;
        w.start(0);
        const f = newFrame();
        for (const [t, a0, a1, a2, a3, a4, b] of DJI_RC3_STIR) {
            f.t = t;
            [a0, a1, a2, a3, a4].forEach((raw, i) => { f.axes[i] = raw / 660; });
            f.buttons = b;
            w.feed(f);
        }
        return w;
    }

    it('the real stir of both sticks is recognised: four sticks move, the untouched wheel stays idle', () => {
        const w = stirTrace(byDescriptor);
        expect(w.state.id).toBe('stir');
        expect(w.state.sticksDone).toBe(4);
        // a frame carries 8 channels: the 5 axes, then 3 that stay 0
        expect(w.state.channels.map((c) => c.kind)).toEqual(['stick', 'stick', 'stick', 'stick', 'idle', 'idle', 'idle', 'idle']);
    });

    it('negative control: through the EdgeTX reader the wizard gets no frame and stays at connect', () => {
        const w = stirTrace(byEdgeTx);
        expect(w.state.id).toBe('connect');
        expect(w.state.channels).toHaveLength(0);
        expect(w.state.sticksDone).toBe(0);
    });

    // simulated people with a gamepad-like pad at 160 reports a second through the 5 x int16 report
    function djiPerson(i: number) {
        const cfg = randomHuman(i + 1, allOrders()[i % 24], invSet(Math.floor(i / 24) % 16));
        cfg.gamepadLike = true;
        cfg.arm = 'momentary';
        cfg.rateHz = DJI_RC3.rateHz;
        cfg.aux = ['zero', 'zero', 'zero'];
        cfg.auxValue = [0, 0, 0, 0];
        cfg.auxNoise = [0, 0, 0, 0.003];
        cfg.noise = 0.003;
        return cfg;
    }
    const PEOPLE = 48;

    it(`${PEOPLE} simulated people complete the wizard through the descriptor`, () => {
        const wrong: string[] = [];
        for (let i = 0; i < PEOPLE; i++) {
            const o = runHuman(() => djiWizard(byDescriptor), newWizardAdapter(), djiPerson(i), 180000);
            if (o.kind !== 'correct') wrong.push(`person ${i}: ${o.kind} at ${o.where} ${o.problems.join('; ')}`);
        }
        expect(wrong).toEqual([]);
    });

    it('negative control: the same people through the EdgeTX reader never get past connect', () => {
        let hung = 0;
        for (let i = 0; i < PEOPLE; i++) {
            const o = runHuman(() => djiWizard(byEdgeTx), newWizardAdapter(), djiPerson(i), 60000);
            if (o.kind === 'hang') hung++;
        }
        expect(hung).toBe(PEOPLE);
    });
});
