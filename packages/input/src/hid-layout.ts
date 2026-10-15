// Any HID joystick or gamepad read through its own report descriptor (no DOM). WebHID hands over the
// descriptor as `device.collections`: for every input report the items in descriptor order, each with
// its usages, its size in bits and its logical range. From that the byte and bit position of every
// axis and button is known, so a controller does not have to send the EdgeTX layout (3 button bytes +
// 8 x uint16 at 0..2048) to be read. Axes come out in report order (channel 1 first, as on a radio),
// normalised to [-1, 1] from the logical range; buttons are the Button page (0x09), usage n = bit n-1.
//
// The DJI controller in its simulator mode ("DJI Virtual Joystick", USB 2ca3:1021, Windows measured 2026-10-15)
// is read this way: 5 axes of int16 -660..660 and 24 buttons in 13 bytes, nothing like the EdgeTX layout
// (docs/research/radios/dji-rc3.md).
//
// A device that splits its axes over several report ids (a 3D mouse: translation in report 1, rotation
// in report 2; a twin-pad adapter: one report per pad) gets one fixed channel per axis over all its
// reports, in report-id order, and a report updates only its own channels and buttons; the others
// keep what their report last said. Chromium lists every item of a report in the top-level collection
// as well as in the nested one it sits in, so the first (outermost) listing of a report id is the
// whole report and the nested repeats are skipped.
//
// Not read: hat switches (usage 0x39), the Simulation Controls page, vendor pages, and array items
// (their bits are skipped, so the fields behind them still line up).

import type { RawFrame } from './calib';
import { isEdgeTx, parseEdgeTxReport } from './edgetx';

/** The slice of the WebHID report item this reader needs (HIDReportItem, https://wicg.github.io/webhid/). */
export interface HidItemInfo {
    isConstant?: boolean;
    isRange?: boolean;
    /** full usages (usage page << 16 | usage); a plain usage id when the browser sends no page bits */
    usages?: readonly number[];
    usageMinimum?: number;
    usageMaximum?: number;
    reportSize?: number;
    reportCount?: number;
    logicalMinimum?: number;
    logicalMaximum?: number;
}

export interface HidReportInfo { reportId: number; items?: readonly HidItemInfo[] }

export interface HidCollectionInfo {
    usagePage?: number;
    usage?: number;
    children?: readonly HidCollectionInfo[];
    inputReports?: readonly HidReportInfo[];
}

export interface HidAxisField {
    ch: number; // the frame channel (0-based) this axis drives; -1 = past the 8 channels of a frame, not read
    bit: number; // first bit of the field in the report data (without the report id)
    size: number; // bits, 1..32
    signed: boolean;
    lo: number; // logical minimum
    hi: number; // logical maximum
    usage: number; // usage id on the generic desktop page: 0x30 X, 0x31 Y, 0x32 Z, 0x33 Rx, 0x34 Ry, 0x35 Rz, 0x36 slider, 0x37 dial, 0x38 wheel
}

export interface HidLayout {
    reportId: number;
    /** data bytes of this report (the report id is not counted) */
    bytes: number;
    axes: HidAxisField[];
    /** bit position of each button and its bit in the frame (Button n of the first report = bit n-1) */
    buttons: { bit: number; index: number }[];
    /** the frame's button bits this report owns */
    buttonMask: number;
}

const GENERIC_DESKTOP = 0x01;
const BUTTON_PAGE = 0x09;
const AXIS_FIRST = 0x30;
const AXIS_LAST = 0x38;
const MAX_AXES = 8;
const MAX_BUTTONS = 24;

/** [page, id] of a WebHID usage: full (page << 16 | id), or a bare id (page unknown: `fallback`). */
function split(u: number, fallback: number): [number, number] {
    return u > 0xffff ? [(u >>> 16) & 0xffff, u & 0xffff] : [fallback, u];
}

function walkReports(cols: readonly HidCollectionInfo[], out: HidReportInfo[]): void {
    for (const c of cols) {
        for (const r of c.inputReports ?? []) out.push(r);
        if (c.children) walkReports(c.children, out);
    }
}

/**
 * The input reports of a device with at least one axis, one layout per report id (with axes or buttons),
 * channels numbered over all of them in report-id order; [] when the descriptor has no axis at all (a
 * keyboard, a mouse, a device with only vendor pages) or when `cols` is missing.
 */
export function layoutsFromCollections(cols: readonly HidCollectionInfo[] | undefined | null): HidLayout[] {
    if (!cols || cols.length === 0) return [];
    const all: HidReportInfo[] = [];
    walkReports(cols, all);
    const seen = new Set<number>();
    const reports = all.filter((r) => (seen.has(r.reportId) ? false : (seen.add(r.reportId), true)));
    reports.sort((a, b) => a.reportId - b.reportId);
    const out: HidLayout[] = [];
    let nextCh = 0;
    let btnBase = 0;
    let anyAxis = false;
    for (const rep of reports) {
        let bit = 0;
        const axes: HidAxisField[] = [];
        const buttons: { bit: number; index: number }[] = [];
        for (const it of rep.items ?? []) {
            const size = it.reportSize ?? 0;
            const count = it.reportCount ?? 0;
            if (size <= 0 || count <= 0) continue;
            if (!it.isConstant) {
                const lo = it.logicalMinimum ?? 0;
                const hi = it.logicalMaximum ?? 0;
                for (let k = 0; k < count; k++) {
                    let page: number;
                    let id: number;
                    if (it.isRange) {
                        // a range maps field k to usageMinimum + k; a range of buttons has no page bits in some browsers
                        const min = it.usageMinimum ?? 0;
                        [page, id] = split(min, size === 1 ? BUTTON_PAGE : GENERIC_DESKTOP);
                        id += k;
                    } else {
                        const us = it.usages ?? [];
                        if (us.length === 0) continue;
                        [page, id] = split(us[k < us.length ? k : us.length - 1], size === 1 ? BUTTON_PAGE : GENERIC_DESKTOP);
                    }
                    const at = bit + k * size;
                    if (page === BUTTON_PAGE && size === 1 && id >= 1) {
                        if (btnBase + id <= MAX_BUTTONS) buttons.push({ bit: at, index: btnBase + id - 1 });
                    } else if (page === GENERIC_DESKTOP && id >= AXIS_FIRST && id <= AXIS_LAST && size >= 2 && size <= 32 && hi > lo) {
                        axes.push({ ch: nextCh < MAX_AXES ? nextCh : -1, bit: at, size, signed: lo < 0, lo, hi, usage: id });
                        nextCh++;
                    }
                }
            }
            bit += size * count;
        }
        if (axes.length === 0 && buttons.length === 0) continue;
        anyAxis ||= axes.length > 0;
        let mask = 0;
        let top = 0;
        for (const b of buttons) { mask |= 1 << b.index; if (b.index + 1 > top) top = b.index + 1; }
        out.push({ reportId: rep.reportId, bytes: Math.ceil(bit / 8), axes, buttons, buttonMask: mask });
        if (top > btnBase) btnBase = top; // the next report's Button 1 comes after this report's last button
    }
    return anyAxis ? out : [];
}

/** `size` bits at bit position `at` (little-endian bit order, as HID packs fields). */
function field(data: DataView, at: number, size: number, signed: boolean): number {
    let v = 0;
    for (let i = 0; i < size; ) {
        const byte = (at + i) >> 3;
        const off = (at + i) & 7;
        const take = Math.min(8 - off, size - i);
        v += (((data.getUint8(byte) >> off) & ((1 << take) - 1)) * 2 ** i);
        i += take;
    }
    if (signed && v >= 2 ** (size - 1)) v -= 2 ** size;
    return v;
}

/**
 * Decode one report into `out`: this report's channels and button bits only; the channels and buttons
 * of the device's other reports keep their values (a frame that never had them reads 0). False, with
 * `out` untouched, when this report id has no layout or the data is shorter than the layout needs.
 */
export function decodeHidReport(layouts: readonly HidLayout[], reportId: number, data: DataView, out: RawFrame): boolean {
    let lay: HidLayout | undefined;
    for (const l of layouts) if (l.reportId === reportId) { lay = l; break; }
    if (!lay || data.byteLength < lay.bytes) return false;
    for (const a of lay.axes) {
        if (a.ch < 0 || a.ch >= out.axes.length) continue;
        const v = (field(data, a.bit, a.size, a.signed) - (a.lo + a.hi) / 2) / ((a.hi - a.lo) / 2);
        out.axes[a.ch] = v < -1 ? -1 : v > 1 ? 1 : v;
    }
    let b = 0;
    for (const bt of lay.buttons) if ((data.getUint8(bt.bit >> 3) >> (bt.bit & 7)) & 1) b |= 1 << bt.index;
    out.buttons = (out.buttons & ~lay.buttonMask) | b;
    return true;
}

/** The name a profile gets: the product name, or the USB ids when the device calls itself only "HID Interface". */
export function hidDisplayName(d: { vendorId: number; productId: number; productName: string }): string {
    const n = (d.productName || '').trim();
    if (n && !/^(usb input device|hid interface|hid-compliant .*)$/i.test(n)) return n;
    return `USB ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
}

/** Reads one input report (its id and data, as WebHID's inputreport event gives them) into a frame; false = unreadable. */
export type HidReader = (reportId: number, data: DataView, out: RawFrame) => boolean;

/**
 * The reader for a device: an EdgeTX radio, or a device whose descriptor shows no axis, keeps the fixed
 * EdgeTX layout (as before); every other joystick or gamepad is read by its own descriptor.
 */
export function makeHidReader(d: { vendorId: number; productId: number; collections?: readonly HidCollectionInfo[] }): HidReader {
    const layouts = isEdgeTx(d) ? [] : layoutsFromCollections(d.collections);
    if (layouts.length === 0) return (_id, data, out) => parseEdgeTxReport(data, out);
    return (id, data, out) => decodeHidReport(layouts, id, data, out);
}
