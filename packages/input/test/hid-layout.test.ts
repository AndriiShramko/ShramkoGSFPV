// A HID game controller read through its own report descriptor (hid-layout.ts), every device the
// same way: the DJI RC 3 in its simulator mode (13-byte reports of 5 x int16 + 24 button bits, which
// the old fixed EdgeTX reader refused, so the wizard never left "connect"), the EdgeTX radio itself
// (Classic: bit for bit as the fixed layout; Advanced: read correctly for the first time), and the
// descriptor shapes of common controllers as Chromium hands them over (a DualShock 4 with a hat and
// vendor fields, an Xbox pad over Bluetooth with its triggers on the Simulation Controls page, a
// mouse + gamepad combo receiver, flight sticks and RC dongles, broken descriptors). Negative controls:
// the same bytes through the fixed EdgeTX reader, and each rule shown to decide the result.

import { describe, expect, it } from 'vitest';
import { CalibrationWizard } from '../src/calib';
import type { RawFrame } from '../src/calib';
import { EDGETX_USB, parseEdgeTxReport } from '../src/edgetx';
import { FRAME_BUTTONS } from '../src/frame';
import { axisScale, decodeHidReport, hidDisplayName, hidProfileKey, layoutsFromCollections, makeHidReader, readsAsEdgeTx } from '../src/hid-layout';
import type { HidCollectionInfo, HidItemInfo, HidLayout } from '../src/hid-layout';
import { fnOn, rangesMode, setModePositions, switchesFromBetaflight } from '../src/switches';
import type { Switches } from '../src/switches';
import { DJI_RC3, DJI_RC3_WINDOWS, EDGETX_CLASSIC, SIM, djiRc3Report, edgeTxAdvanced, edgeTxAdvancedReport, edgeTxClassicReport } from '../src/sim/devices';
import type { EdgeTxAdvancedConfig } from '../src/sim/devices';
import { newWizardAdapter, randomHuman, runHuman } from '../src/sim/human';
import { allOrders, invSet } from './helpers';
import { DJI_RC3_STIR } from './fixtures/dji-rc3-stir';

const P1 = 0x10000;
const P2 = 0x20000;
const P9 = 0x90000;
const PC = 0xc0000; // consumer page
const PV = 0xff000000 >>> 0; // vendor page 0xff00
const hex = (s: string): DataView => new DataView(Uint8Array.from(s.split(' ').map((x) => parseInt(x, 16))).buffer);
const bytes = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);
const newFrame = (n = 8): RawFrame => ({ t: 0, axes: new Float32Array(n), buttons: 0 });
const btn = (n: number, from = 1): HidItemInfo => ({ isConstant: false, isRange: true, usageMinimum: P9 | from, usageMaximum: P9 | (from + n - 1), reportSize: 1, reportCount: n, logicalMinimum: 0, logicalMaximum: 1 });
const val = (us: number[], size: number, lo: number, hi: number, page = P1): HidItemInfo => ({ isConstant: false, isRange: false, usages: us.map((u) => (page | u) >>> 0), reportSize: size, reportCount: us.length, logicalMinimum: lo, logicalMaximum: hi });
const pad = (bits: number): HidItemInfo => ({ isConstant: true, reportSize: bits, reportCount: 1 });
const pad1 = (items: HidItemInfo[], usage = 5, id = 0): HidCollectionInfo[] => [{ usagePage: 1, usage, inputReports: [{ reportId: id, items }] }];
const chans = (ls: HidLayout[]): string[] => ls.flatMap((l) => l.axes.map((a) => `${a.ch}:${a.page === 2 ? 'sim' : ''}${a.usage.toString(16)}`));
const djiLayouts = layoutsFromCollections(DJI_RC3.collections);
// what HidSource does with the device, and what it did before (every report through the EdgeTX reader)
const djiReader = makeHidReader(DJI_RC3);

describe('layout from the report descriptor', () => {
    it('DJI RC 3: one report of 13 bytes, 5 signed 16-bit axes -660..660 (X Y Z Rx Ry) and 24 buttons', () => {
        expect(djiLayouts).toHaveLength(1);
        const l = djiLayouts[0];
        expect(l.reportId).toBe(0);
        expect(l.bytes).toBe(13);
        expect(l.axes.map((a) => [a.usage, a.bit, a.size, a.signed, a.lo, a.hi, a.centre, a.unit])).toEqual([
            [0x30, 0, 16, true, -660, 660, 0, 660], [0x31, 16, 16, true, -660, 660, 0, 660], [0x32, 32, 16, true, -660, 660, 0, 660], [0x33, 48, 16, true, -660, 660, 0, 660], [0x34, 64, 16, true, -660, 660, 0, 660]
        ]);
        expect(l.buttons).toHaveLength(24);
        expect(l.buttons[0]).toEqual({ bit: 80, index: 0 });
        expect(l.buttons[23]).toEqual({ bit: 103, index: 23 });
    });

    it('DJI RC 3 in the Windows shape (one item per axis, from the preparsed data) gives the same layout', () => {
        expect(layoutsFromCollections(DJI_RC3_WINDOWS.collections)).toEqual(djiLayouts);
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

describe('only game-control collections are read (M1)', () => {
    // a combo receiver as Chromium hands it over on Linux / macOS: the mouse collection's own input
    // reports are withheld (a protected usage), its nested Pointer collection still lists report 1;
    // the gamepad collection has report 2
    const mouseTlc = (usage: number): HidCollectionInfo => ({ usagePage: 1, usage, inputReports: [], children: [{ usagePage: 1, usage: 1, inputReports: [{ reportId: 1, items: [btn(3), pad(5), val([0x30, 0x31, 0x38], 8, -127, 127)] }] }] });
    const gamepadTlc: HidCollectionInfo = { usagePage: 1, usage: 5, inputReports: [{ reportId: 2, items: [val([0x30, 0x31, 0x32, 0x35], 8, 0, 255), btn(12), pad(4)] }] };

    it('mouse + gamepad combo: the gamepad has channels 1..4 and buttons 1..12; the mouse takes nothing', () => {
        const lay = layoutsFromCollections([mouseTlc(2), gamepadTlc]);
        expect(lay.map((l) => l.reportId)).toEqual([2]);
        expect(chans(lay)).toEqual(['0:30', '1:31', '2:32', '3:35']);
        expect(lay[0].buttons.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        const f = newFrame();
        expect(decodeHidReport(lay, 2, hex('FF 00 80 80 05 00'), f)).toBe(true); // X right, Y up, buttons 1 and 3
        // the mouse moving and clicking: not this reader's report, nothing changes
        expect(decodeHidReport(lay, 1, hex('07 7F 81 7F'), f)).toBe(false);
        expect(Array.from(f.axes.slice(0, 4)).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.992, -1, 0, 0]);
        expect(f.buttons).toBe(0b101);
    });

    it('negative control: read as a game control too (the rule before), the mouse takes channels 1..3 and the pad slides to 4..7', () => {
        const old = layoutsFromCollections([mouseTlc(5), gamepadTlc]);
        expect(chans(old)).toEqual(['0:30', '1:31', '2:38', '3:30', '4:31', '5:32', '6:35']);
        expect(old[1].buttons[0].index).toBe(3); // and the pad's Button 1 is not bit 0 any more
    });

    it('joystick, gamepad and multi-axis controller collections are read; a Generic Desktop collection of another kind is not', () => {
        const items = [val([0x30, 0x31], 8, -127, 127)];
        for (const u of [4, 5, 8]) expect(layoutsFromCollections(pad1(items, u))).toHaveLength(1);
        for (const u of [1, 2, 6, 7, 0x80]) expect(layoutsFromCollections(pad1(items, u))).toEqual([]);
        expect(layoutsFromCollections([{ usagePage: 0x0c, usage: 5, inputReports: [{ reportId: 0, items }] }])).toEqual([]);
    });
});

describe('what is an axis, what is a button (M3)', () => {
    // DualShock 4 over USB, report 1, as Chromium builds it from the descriptor
    const ds4: HidCollectionInfo[] = pad1([
        val([0x30, 0x31, 0x32, 0x35], 8, 0, 255),
        { isConstant: false, isRange: false, usages: [P1 | 0x39], reportSize: 4, reportCount: 1, logicalMinimum: 0, logicalMaximum: 7 }, // hat
        btn(14),
        { isConstant: false, isRange: false, usages: [(PV | 0x20) >>> 0], reportSize: 6, reportCount: 1, logicalMinimum: 0, logicalMaximum: 127 }, // vendor counter
        val([0x33, 0x34], 8, 0, 255), // the triggers
        { isConstant: false, isRange: false, usages: [(PV | 0x21) >>> 0], reportSize: 8, reportCount: 54, logicalMinimum: 0, logicalMaximum: 255 }
    ], 5, 1);

    it('DualShock 4: the hat is not an axis, the vendor fields are not read; the triggers keep their places', () => {
        const lay = layoutsFromCollections(ds4);
        expect(chans(lay)).toEqual(['0:30', '1:31', '2:32', '3:35', '4:33', '5:34']);
        expect(lay[0].axes[4].bit).toBe(56); // after the sticks, the hat, 14 buttons and the 6-bit counter
        expect(lay[0].buttons.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
        expect(lay[0].bytes).toBe(63);
        const rep = new Uint8Array(63);
        rep.set([0x80, 0x80, 0x80, 0x80, 0x08 | 0x20, 0x00, 0x00 | (5 << 2), 0x00, 0xff]); // sticks centred, hat centred (8), Button 2, counter 5, L2 0, R2 full
        const f = newFrame();
        expect(decodeHidReport(lay, 1, bytes(rep), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 6)).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0, 0, -1, 0.992]);
        expect(f.buttons).toBe(0b10);
        // the hat pushed in every direction: no channel and no button changes
        for (let h = 0; h < 8; h++) {
            rep[4] = h | 0x20;
            const g = newFrame();
            expect(decodeHidReport(lay, 1, bytes(rep), g)).toBe(true);
            expect(Array.from(g.axes)).toEqual(Array.from(f.axes));
            expect(g.buttons).toBe(0b10);
        }
    });

    it('Xbox Wireless over Bluetooth: the triggers on the Simulation Controls page are axes; the hat and a 1-bit consumer field are not', () => {
        const sticksA = val([0x30, 0x31], 16, 0, 65535);
        const sticksB = val([0x32, 0x35], 16, 0, 65535);
        const rest: HidItemInfo[] = [val([0xc5], 10, 0, 1023, P2), pad(6), val([0xc4], 10, 0, 1023, P2), pad(6),
            { isConstant: false, isRange: false, usages: [P1 | 0x39], reportSize: 4, reportCount: 1, logicalMinimum: 1, logicalMaximum: 8 }, pad(4),
            btn(15), pad(1), val([0x224], 1, 0, 1, PC), pad(7)];
        const xbox: HidCollectionInfo[] = [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 1, items: [sticksA, sticksB, ...rest] }, { reportId: 2, items: [val([0x223], 1, 0, 1, PC), pad(7)] }],
            children: [{ usagePage: 1, usage: 1, inputReports: [{ reportId: 1, items: [sticksA] }] }, { usagePage: 1, usage: 1, inputReports: [{ reportId: 1, items: [sticksB] }] }] }];
        const lay = layoutsFromCollections(xbox);
        expect(lay.map((l) => l.reportId)).toEqual([1]); // report 2 (the consumer key alone) has nothing to read
        expect(chans(lay)).toEqual(['0:30', '1:31', '2:32', '3:35', '4:simc5', '5:simc4']);
        expect(lay[0].buttons).toHaveLength(15);
        expect(lay[0].bytes).toBe(16);
        const rep = new Uint8Array(16);
        const dv = new DataView(rep.buffer);
        dv.setUint16(0, 65535, true); dv.setUint16(2, 32768, true); dv.setUint16(4, 0, true); dv.setUint16(6, 32768, true);
        dv.setUint16(8, 1023, true); dv.setUint16(10, 0, true);
        rep[12] = 3; // hat east
        dv.setUint16(13, 1 << 14, true); // Button 15
        rep[15] = 1; // the consumer key (View): not a button
        const f = newFrame();
        expect(decodeHidReport(lay, 1, bytes(rep), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 6)).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, -1, 0, 0.998, -1]);
        expect(f.buttons).toBe(1 << 14);
    });

    it('only the Button page makes buttons: 1-bit fields of a vendor page, the consumer page and Generic Desktop are skipped', () => {
        const lay = layoutsFromCollections(pad1([val([0x30], 8, 0, 255), val([0x01, 0x02], 1, 0, 1, PV), val([0xe9, 0xea], 1, 0, 1, PC), val([0x90, 0x91], 1, 0, 1, P1), pad(2), btn(2)]));
        expect(lay[0].buttons).toEqual([{ bit: 16, index: 0 }, { bit: 17, index: 1 }]);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('80 FF 03'), f)).toBe(true); // every 1-bit field on, then Buttons 1 and 2
        expect(f.buttons).toBe(0b11);
    });

    it('array fields are skipped (their value is an index), and the fields behind them line up', () => {
        const arr: HidItemInfo = { isConstant: false, isArray: true, isRange: true, usageMinimum: P1 | 0x30, usageMaximum: P1 | 0x37, reportSize: 8, reportCount: 2, logicalMinimum: 0, logicalMaximum: 7 };
        const lay = layoutsFromCollections(pad1([val([0x30, 0x31], 8, 0, 255), arr, val([0x32], 8, 0, 255)]));
        expect(chans(lay)).toEqual(['0:30', '1:31', '2:32']);
        expect(lay[0].axes[2].bit).toBe(32);
        // and an array of buttons (a keyboard-style list of pressed button numbers) is not read as button bits
        const keys = layoutsFromCollections(pad1([val([0x30], 8, 0, 255), { ...btn(8), isArray: true, reportSize: 8, reportCount: 2, logicalMinimum: 1, logicalMaximum: 8 }]));
        expect(keys[0].buttons).toEqual([]);
    });

    it('fields past a usage range take its maximum: Buttons 1..10 over 12 bits are 10 buttons, the last 3 bits all Button 10', () => {
        const lay = layoutsFromCollections(pad1([val([0x30, 0x31], 8, 0, 255), { ...btn(12), usageMaximum: P9 | 10 }, pad(4)]));
        expect(lay[0].buttons.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9]);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('80 80 00 08'), f)).toBe(true); // bit 11 of the buttons (field 12)
        expect(f.buttons).toBe(1 << 9);
        expect(decodeHidReport(lay, 0, hex('80 80 00 00'), f)).toBe(true);
        expect(f.buttons).toBe(0);
        // a usage list repeats its last usage: Slider declared once for two fields gives two channels
        const sl = layoutsFromCollections(pad1([{ ...val([0x30, 0x36], 8, 0, 255), reportCount: 3 }]));
        expect(chans(sl)).toEqual(['0:30', '1:36', '2:36']);
        // an axis range X..Y over 4 fields: X, Y, then Y twice, nothing made up past Y
        const xy = layoutsFromCollections(pad1([{ isConstant: false, isRange: true, usageMinimum: P1 | 0x30, usageMaximum: P1 | 0x31, reportSize: 8, reportCount: 4, logicalMinimum: 0, logicalMaximum: 255 }], 4));
        expect(chans(xy)).toEqual(['0:30', '1:31', '2:31', '3:31']);
    });

    it('a logical maximum the browser sign-extended below its minimum is read unsigned in the field size', () => {
        // LOGICAL_MAXIMUM (255) written as one byte (0x25 0xFF) and 65535 as two bytes arrive as -1
        const b8 = layoutsFromCollections(pad1([val([0x30, 0x31], 8, 0, -1)], 4));
        expect(b8[0].axes.map((a) => [a.lo, a.hi, a.centre, a.unit, a.signed])).toEqual([[0, 255, 128, 128, false], [0, 255, 128, 128, false]]);
        const b16 = layoutsFromCollections(pad1([val([0x30], 16, 0, -1)]));
        expect(b16[0].axes.map((a) => [a.hi, a.centre])).toEqual([[65535, 32768]]);
        const b12 = layoutsFromCollections(pad1([val([0x30], 12, 0, -1), pad(4)]));
        expect(b12[0].axes[0].hi).toBe(4095);
        const f = newFrame();
        expect(decodeHidReport(b8, 0, hex('80 FF'), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([0, 127 / 128].map((x) => Math.fround(x)));
        // a signed range is left as it is
        expect(layoutsFromCollections(pad1([val([0x30], 8, -127, 127)]))[0].axes[0].hi).toBe(127);
    });

    it('flight sticks and RC USB dongles: throttle, rudder, aileron and elevator on the Simulation Controls page are axes', () => {
        const stick = layoutsFromCollections(pad1([val([0x30, 0x31], 10, 0, 1023), pad(4), val([0xbb, 0xba], 8, 0, 255, P2), btn(8)], 4));
        expect(chans(stick)).toEqual(['0:30', '1:31', '2:simbb', '3:simba']);
        const dongle = layoutsFromCollections(pad1([val([0xb0, 0xb8, 0xbb, 0xba], 8, 0, 255, P2), btn(8)], 4));
        expect(chans(dongle)).toEqual(['0:simb0', '1:simb8', '2:simbb', '3:simba']);
        // an on / off control of that page (landing gear, autopilot) and a collection usage are not axes
        expect(layoutsFromCollections(pad1([val([0xbe, 0xb3, 0x21], 8, 0, 255, P2)], 4))).toEqual([]);
    });

    it('at most 8 axes take channels; the 9th and 10th are not read', () => {
        const lay = layoutsFromCollections(pad1([val([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x36], 8, -127, 127)], 8));
        expect(lay[0].axes.map((a) => a.ch)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, -1, -1]);
        const f = newFrame(10);
        expect(decodeHidReport(lay, 0, hex('7F 7F 7F 7F 7F 7F 7F 7F 7F 7F'), f)).toBe(true);
        expect(Array.from(f.axes)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
    });

    it(`at most ${FRAME_BUTTONS} buttons: a 32-button device fills the frame's bits and no more`, () => {
        const lay = layoutsFromCollections(pad1([val([0x30], 8, -127, 127), btn(32)]));
        expect(lay[0].buttons).toHaveLength(FRAME_BUTTONS);
        expect(lay[0].buttonMask).toBe(0xffffff);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('00 FF FF FF FF'), f)).toBe(true);
        expect(f.buttons).toBe(0xffffff);
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

    it('a value outside the logical range is clamped to -1..1 (DJI X at +700, Y at -32768)', () => {
        const f = newFrame();
        expect(decodeHidReport(djiLayouts, 0, hex('BC 02 00 80 00 00 00 00 00 00 00 00 00'), f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([1, -1]);
    });

    it('the scaling rule: the middle value reads 0 (the upper one of an even range), the minimum -1', () => {
        expect(axisScale(-660, 660)).toEqual({ centre: 0, unit: 660 });
        expect(axisScale(0, 2047)).toEqual({ centre: 1024, unit: 1024 }); // EdgeTX Classic: as its fixed layout
        expect(axisScale(0, 2048)).toEqual({ centre: 1024, unit: 1024 }); // EdgeTX Advanced
        expect(axisScale(0, 255)).toEqual({ centre: 128, unit: 128 });
        expect(axisScale(0, 65535)).toEqual({ centre: 32768, unit: 32768 });
        expect(axisScale(-127, 127)).toEqual({ centre: 0, unit: 127 });
        expect(axisScale(1, 8)).toEqual({ centre: 5, unit: 4 });
    });

    it('refuses a report that is shorter than the layout or has another report id', () => {
        const f = newFrame();
        expect(decodeHidReport(djiLayouts, 0, hex('F5 FF 00 00'), f)).toBe(false);
        expect(decodeHidReport(djiLayouts, 7, hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00'), f)).toBe(false);
    });

    it('follows the descriptor, not a fixed order: buttons first, a padding byte, Y before X', () => {
        const cols = pad1([btn(8), pad(8), val([0x31], 16, -660, 660), val([0x30], 16, -660, 660)], 4);
        const lay = layoutsFromCollections(cols);
        expect(lay[0].bytes).toBe(6);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('05 FF 94 02 6C FD'), f)).toBe(true);
        expect(f.buttons).toBe(5);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([1, -1]); // Y first, then X: report order
    });

    it('reads fields that do not start on a byte: two unsigned 12-bit axes 0..4095', () => {
        const lay = layoutsFromCollections(pad1([val([0x30, 0x31], 12, 0, 4095), pad(4)], 4, 3));
        const f = newFrame();
        expect(decodeHidReport(lay, 3, hex('00 F0 FF 00'), f)).toBe(true); // X = 0x000, Y = 0xFFF
        expect(f.axes[0]).toBe(-1);
        expect(f.axes[1]).toBe(2047 / 2048);
        expect(decodeHidReport(lay, 3, hex('00 08 80 00'), f)).toBe(true); // X = 0x800 (the middle), Y = 0x800
        expect(f.axes[0]).toBe(0);
        expect(f.axes[1]).toBe(0);
        expect(decodeHidReport(lay, 3, hex('FF 07 00 00'), f)).toBe(true); // X = 0x7FF, one step under the middle
        expect(f.axes[0]).toBe(Math.fround(-1 / 2048));
    });

    it('axes in two report ids get their own channels; a report updates only its own channels and buttons', () => {
        // a 3D mouse / twin-pad adapter shape: report 1 = X Y + buttons 1..4, report 2 = Rx Ry + buttons 1..4
        const pad2 = (id: number, u1: number, u2: number) => ({ reportId: id, items: [val([u1, u2], 8, -127, 127), btn(4), pad(4)] });
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 8, inputReports: [pad2(2, 0x33, 0x34), pad2(1, 0x30, 0x31)] }]);
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

    it('buttons numbered through the reports keep their numbers; a report moves up only on a real collision (L5)', () => {
        const rep = (id: number, u1: number, u2: number, ...btns: HidItemInfo[]) => ({ reportId: id, items: [val([u1, u2], 8, -127, 127), ...btns] });
        const layOf = (r1: HidItemInfo[], r2: HidItemInfo[]) => layoutsFromCollections([{ usagePage: 1, usage: 5, inputReports: [rep(1, 0x30, 0x31, ...r1), rep(2, 0x32, 0x35, ...r2)] }]);
        // 1..12 then 13..24: Button 13 of report 2 is bit 12
        const lay = layOf([btn(12), pad(4)], [btn(12, 13), pad(4)]);
        expect(lay.map((l) => [l.reportId, l.axes.map((a) => a.ch), l.buttons[0].index, l.buttons[l.buttons.length - 1].index])).toEqual([[1, [0, 1], 0, 11], [2, [2, 3], 12, 23]]);
        const f = newFrame();
        expect(decodeHidReport(lay, 2, hex('00 00 01 00'), f)).toBe(true); // Button 13 pressed
        expect(f.buttons).toBe(1 << 12);
        // report 1 has Buttons 1..4 and 9..12, report 2 Buttons 5..8: they fit in the gap, no move
        // (moving past the highest bit taken, the rule before, put them on bits 12..15)
        const gap = layOf([btn(4), btn(4, 9)], [btn(4, 5), pad(4)]);
        expect(gap[1].buttons.map((b) => b.index)).toEqual([4, 5, 6, 7]);
        // report 2 Buttons 3..6 land on report 1's 3 and 4: moved up by the smallest step that frees them all
        const part = layOf([btn(4), pad(4)], [btn(4, 3), pad(4)]);
        expect(part[1].buttons.map((b) => b.index)).toEqual([4, 5, 6, 7]);
        expect(part[0].buttonMask & part[1].buttonMask).toBe(0);
    });

    it('the profile key length of a descriptor-read device is its axis report, whichever report comes first', () => {
        // a 3D-mouse shape: report 1 X Y Z (6 bytes), report 2 Rx Ry Rz (6 bytes), report 3 two buttons (2 bytes)
        const axes3 = (id: number, u: number[]) => ({ reportId: id, items: [val(u, 16, -350, 350)] });
        const cols: HidCollectionInfo[] = [{ usagePage: 1, usage: 8, inputReports: [axes3(1, [0x30, 0x31, 0x32]), axes3(2, [0x33, 0x34, 0x35]), { reportId: 3, items: [btn(2), pad(14)] }] }];
        const r = makeHidReader({ collections: cols });
        expect(r.keyBytes).toBe(6);
        expect(r.keySuffix).toBe(':d');
        expect(djiReader.keyBytes).toBe(13);
        // the same device behind the EdgeTX USB ids reads (and keys) by its descriptor too: no VID:PID rule
        expect(makeHidReader({ ...EDGETX_USB, collections: cols }).keyBytes).toBe(6);
    });

    it('a report repeated in a nested collection (as Chromium lists it) is read once, from the outermost listing', () => {
        const whole = { reportId: 0, items: [btn(8), val([0x30, 0x31], 16, 0, 2047)] };
        const axesOnly = { reportId: 0, items: [whole.items[1]] }; // the Physical child: its own items from bit 0
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 4, inputReports: [whole], children: [{ usagePage: 1, usage: 1, inputReports: [axesOnly] }] }]);
        expect(lay).toHaveLength(1);
        expect(lay[0].axes.map((a) => [a.ch, a.bit])).toEqual([[0, 8], [1, 24]]);
        const f = newFrame();
        expect(decodeHidReport(lay, 0, hex('81 FF 07 00 00'), f)).toBe(true); // buttons 1 and 8, X 2047, Y 0
        expect(f.buttons).toBe(0x81);
        expect(Array.from(f.axes.slice(0, 2))).toEqual([1023 / 1024, -1]);
    });

    it('a report with buttons only is read too when the device has axes elsewhere', () => {
        const lay = layoutsFromCollections([{ usagePage: 1, usage: 5, inputReports: [
            { reportId: 1, items: [val([0x30], 8, -127, 127)] },
            { reportId: 2, items: [btn(8)] }
        ] }]);
        const f = newFrame();
        expect(decodeHidReport(lay, 2, hex('03'), f)).toBe(true);
        expect(f.buttons).toBe(3);
        // without any axis the device is not a joystick for this reader
        expect(layoutsFromCollections([{ usagePage: 1, usage: 5, inputReports: [{ reportId: 2, items: [btn(8)] }] }])).toEqual([]);
    });

    it('names a device by its product name, or by its USB ids when it only says "HID Interface"', () => {
        expect(hidDisplayName({ vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface' })).toBe('USB 2ca3:1021');
        expect(hidDisplayName({ vendorId: 0x2ca3, productId: 0x1021, productName: '' })).toBe('USB 2ca3:1021');
        expect(hidDisplayName({ ...EDGETX_USB, productName: 'RadioMaster TX16S Joystick' })).toBe('RadioMaster TX16S Joystick');
    });
});

describe('EdgeTX through its own descriptor (M2)', () => {
    // a seeded LCG, so a failure names its report
    function lcg(seed: number): () => number {
        let s = seed >>> 0;
        return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0);
    }
    const classicItems = (sliders: number[], hi: number): HidItemInfo[] => [btn(24), val([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, ...sliders], 16, 0, hi)];
    // EdgeTX main (Slider, Dial, 0..2047), the older EdgeTX driver (usbd_hid_joystick.c: 0..2048) and OpenTX (Slider, Slider)
    const variants: [string, HidCollectionInfo[], number][] = [
        ['EdgeTX main (Chromium descriptor shape)', EDGETX_CLASSIC.collections, 2047],
        ['EdgeTX usbd_hid_joystick.c, 0..2048', [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 0, items: classicItems([0x36, 0x37], 2048) }] }], 2048],
        ['OpenTX / reviewer shape, Slider Slider 0..2047', [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 0, items: classicItems([0x36, 0x36], 2047) }] }], 2047],
        ['EdgeTX on Windows (one item per axis)', [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 0, items: [btn(24), ...[0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37].map((u) => val([u], 16, 0, 2047))] }] }], 2047]
    ];

    for (const [name, cols, top] of variants) {
        it(`Classic, ${name}: 20,000 random reports read bit for bit as the fixed EdgeTX layout`, () => {
            const read = makeHidReader({ ...EDGETX_USB, collections: cols });
            expect(readsAsEdgeTx(layoutsFromCollections(cols))).toBe(true);
            const rnd = lcg(7);
            let axisDiff = 0;
            let buttonDiff = 0;
            for (let k = 0; k < 20000; k++) {
                const raw = Array.from({ length: 8 }, (_, i) => (k < 3 ? [0, 1024, top][k] : i === k % 8 ? [0, 1023, 1024, 1025, top][k % 5] : rnd() % (top + 1)));
                const rep = bytes(edgeTxClassicReport(raw, rnd() & 0xffffff));
                const a = newFrame();
                const b = newFrame();
                expect(parseEdgeTxReport(rep, a)).toBe(true);
                expect(read(0, rep, b)).toBe(true);
                for (let i = 0; i < 8; i++) if (!Object.is(a.axes[i], b.axes[i])) axisDiff++;
                if (a.buttons !== b.buttons) buttonDiff++;
            }
            expect(axisDiff).toBe(0);
            expect(buttonDiff).toBe(0);
        });
    }

    it('Classic keeps the profile key and the name it had: hid:1209:4f54:<name>:19, no suffix, with or without a descriptor', () => {
        // the key the fixed layout made before this change (HidSource: hid:<vid hex>:<pid hex>:<productName>:<arrived length>)
        const before = 'hid:1209:4f54:RadioMaster TX16S Joystick:19';
        for (const cols of [EDGETX_CLASSIC.collections, variants[3][1], undefined]) {
            const read = makeHidReader({ collections: cols });
            expect(read.keyBytes).toBeUndefined();
            expect(read.keySuffix).toBe('');
            expect(hidProfileKey(EDGETX_CLASSIC, read, 19)).toBe(before);
        }
        expect(hidDisplayName(EDGETX_CLASSIC)).toBe('RadioMaster TX16S Joystick');
    });

    // Advanced mode as EdgeTX builds it: CH1..4 aileron, elevator, throttle, rudder (Simulation
    // Controls), CH5..8 X, Y, slider, dial; buttons 1..8: axes first, then 4 button bytes and a battery byte
    const adv: EdgeTxAdvancedConfig = { ifMode: 0x04, axes: [SIM.aileron, SIM.elevator, SIM.throttle, SIM.rudder, P1 | 0x30, P1 | 0x31, P1 | 0x36, P1 | 0x37], buttonMaxId: 8 };
    const advSpec = edgeTxAdvanced(adv);

    it('Advanced: read by its descriptor (the Simulation Controls axes too), the battery byte skipped', () => {
        const lay = layoutsFromCollections(advSpec.collections);
        expect(chans(lay)).toEqual(['0:simb0', '1:simb8', '2:simbb', '3:simba', '4:30', '5:31', '6:36', '7:37']);
        expect(lay[0].bytes).toBe(21);
        expect(lay[0].buttons.map((b) => [b.bit, b.index])).toEqual([[128, 0], [129, 1], [130, 2], [131, 3], [132, 4], [133, 5], [134, 6], [135, 7]]);
        const read = makeHidReader(advSpec);
        const f = newFrame();
        // aileron full right (2048), elevator full down (0), throttle middle, rudder half; X Y slider dial at rest; Buttons 1 and 3
        const rep = bytes(edgeTxAdvancedReport(adv, [2048, 0, 1024, 1536, 1024, 1024, 1024, 1024], 0b101));
        expect(read(0, rep, f)).toBe(true);
        expect(Array.from(f.axes)).toEqual([1, -1, 0, 0.5, 0, 0, 0, 0]);
        expect(f.buttons).toBe(0b101);
        // negative control: the fixed layout (the only reader before) takes the aileron's bytes for buttons
        const g = newFrame();
        expect(parseEdgeTxReport(rep, g)).toBe(true);
        expect(g.buttons).not.toBe(0b101);
        expect(Array.from(g.axes)).not.toEqual(Array.from(f.axes));
    });

    it('Advanced: a key of its own (:d), never the misread profile the fixed layout saved for the same length', () => {
        const read = makeHidReader(advSpec);
        expect(readsAsEdgeTx(layoutsFromCollections(advSpec.collections))).toBe(false);
        expect(hidProfileKey(advSpec, read, 21)).toBe('hid:1209:4f54:RadioMaster TX16S Joystick:21:d');
        expect(hidProfileKey(advSpec, makeHidReader({}), 21)).toBe('hid:1209:4f54:RadioMaster TX16S Joystick:21');
    });

    it('Advanced with fewer axes (a 4-channel sim setup) and a gamepad collection: read, and the fixed layout refuses or misreads it', () => {
        const four: EdgeTxAdvancedConfig = { ifMode: 0x05, axes: [SIM.aileron, SIM.elevator, SIM.throttle, SIM.rudder], buttonMaxId: 2 };
        const spec = edgeTxAdvanced(four);
        const read = makeHidReader(spec);
        const rep = bytes(edgeTxAdvancedReport(four, [0, 2048, 512, 1024], 0b10));
        const f = newFrame();
        expect(read(0, rep, f)).toBe(true);
        expect(Array.from(f.axes.slice(0, 4))).toEqual([-1, 1, -0.5, 0]);
        expect(f.buttons).toBe(0b10);
        expect(parseEdgeTxReport(rep, newFrame())).toBe(false); // 13 bytes: refused, as the DJI's were
    });
});

describe('the reader HidSource picks for a device', () => {
    it('every device by its descriptor, whatever its USB ids: the DJI descriptor behind the EdgeTX ids is read as a DJI', () => {
        const r = makeHidReader({ ...EDGETX_USB, collections: DJI_RC3.collections });
        const dji = hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00');
        const f = newFrame();
        expect(r(0, dji, f)).toBe(true);
        expect(f.buttons).toBe(0x50);
        expect(djiReader(0, dji, newFrame())).toBe(true);
        // negative control: the 13 bytes through the EdgeTX reader, the only reader before the fix
        expect(parseEdgeTxReport(dji, newFrame())).toBe(false);
    });

    it('a device without a usable descriptor falls back to the EdgeTX layout, as before', () => {
        for (const cols of [undefined, [], [{ usagePage: 1, usage: 2, inputReports: [{ reportId: 0, items: [val([0x30, 0x31], 8, -127, 127)] }] }]]) {
            const r = makeHidReader({ collections: cols });
            const f = newFrame();
            expect(r(0, hex('01 00 00 00 08 00 00 00 04 00 04 00 04 00 04 00 04 00 04'), f)).toBe(true);
            expect(Array.from(f.axes)).toEqual([1, -1, 0, 0, 0, 0, 0, 0]);
            expect(f.buttons).toBe(1);
            expect(r(0, hex('F5 FF 00 00 00 00 F8 FF 00 00 50 00 00'), newFrame())).toBe(false);
        }
    });

    it('the DJI RC 3 key: its 13 bytes and :d, never a key the fixed layout could have saved', () => {
        expect(hidProfileKey(DJI_RC3, djiReader, 13)).toBe('hid:2ca3:1021:HID Interface:13:d');
        expect(hidProfileKey(DJI_RC3, djiReader, 7)).toBe('hid:2ca3:1021:HID Interface:13:d'); // whatever arrived
        expect(hidDisplayName(DJI_RC3)).toBe('USB 2ca3:1021');
    });
});

describe('DJI RC 3 real stick traffic (2026-10-15)', () => {
    it('is read by the descriptor and refused by the EdgeTX reader (negative control)', () => {
        const f = newFrame();
        let edgetxReads = 0;
        for (const [, a0, a1, a2, a3, a4, b] of DJI_RC3_STIR) {
            const dv = bytes(djiRc3Report([a0, a1, a2, a3, a4], b));
            expect(djiReader(0, dv, f)).toBe(true);
            [a0, a1, a2, a3, a4].forEach((raw, i) => expect(f.axes[i]).toBeCloseTo(raw / 660, 6));
            expect(f.buttons).toBe(b);
            if (parseEdgeTxReport(dv, newFrame())) edgetxReads++;
        }
        expect(DJI_RC3_STIR.length).toBeGreaterThan(600);
        expect(edgetxReads).toBe(0); // before the fix every one of these reports was "a report we cannot read"
    });
});

describe('a 3-position switch sent as two button bits (L7)', () => {
    // The DJI's bits 4/5 and 6/7 behave like switch positions (one of the two, or neither = middle).
    // A switch input is one axis or one bit; two exclusive bits are two inputs, and the channel model
    // (Betaflight's modes) already gives one function per range: Angle on one bit, Horizon on the other,
    // neither = Acro. Which bits pair is not known from the descriptor nor measured (dji-rc3.md).
    const sw: Switches = {
        v: 1, ranges: [
            { fn: 'angle', input: { kind: 'button', bit: 4 }, lo: 1500, hi: 2100 },
            { fn: 'horizon', input: { kind: 'button', bit: 5 }, lo: 1500, hi: 2100 },
            { fn: 'arm', input: { kind: 'button', bit: 6 }, lo: 1500, hi: 2100 }
        ]
    };
    it('positions of bits 4/5 through the DJI reader give Angle / Acro / Horizon; bits 6/7 arm', () => {
        const at = (buttons: number): RawFrame => {
            const f = newFrame();
            expect(djiReader(0, bytes(djiRc3Report([-11, 0, 0, -8, 0], buttons)), f)).toBe(true);
            return f;
        };
        expect(rangesMode(sw, at(0x10))).toBe('angle');
        expect(rangesMode(sw, at(0x00))).toBe('acro');
        expect(rangesMode(sw, at(0x20))).toBe('horizon');
        expect(fnOn(sw, 'arm', at(0x50))).toBe(true); // the controller's rest state 0x50: bit 6 on
        expect(fnOn(sw, 'arm', at(0x90))).toBe(false);
        // one input per position switch (the wizard's mode switch, setModePositions) sees only its own bit
        const one = setModePositions({ v: 1, ranges: [] }, { kind: 'button', bit: 4 }, ['acro', 'acro', 'angle']);
        expect([0x10, 0x00, 0x20].map((b) => rangesMode(one, at(b)))).toEqual(['angle', 'acro', 'acro']);
        // a Betaflight diff can name such bits too: EdgeTX's channels 9+ arrive as buttons (CH13 = bit 4)
        const bf = switchesFromBetaflight([{ slot: 0, mode: 'ANGLE', modeId: 1, channel: 13, lo: 1700, hi: 2100, linkedTo: null, and: false }]);
        expect(bf.switches.ranges[0].input).toEqual({ kind: 'button', bit: 4 });
    });
});

// the same bytes, two readers: the wizard sees what the reader hands it
function djiWizard(read: (dv: DataView, out: RawFrame) => boolean): CalibrationWizard {
    const w = new CalibrationWizard('hid:2ca3:1021:HID Interface:13:d', 'USB 2ca3:1021');
    const feed0 = w.feed.bind(w);
    const out = newFrame();
    w.feed = (f: RawFrame) => {
        const raw = [0, 1, 2, 3, 4].map((i) => f.axes[i] * 660);
        if (!read(bytes(djiRc3Report(raw, f.buttons)), out)) return w.state;
        out.t = f.t;
        return feed0(out);
    };
    return w;
}
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
