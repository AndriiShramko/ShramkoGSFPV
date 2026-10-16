// Any HID game controller read through its own report descriptor (no DOM). WebHID hands over the
// descriptor as `device.collections`: for every input report the items in descriptor order, each with
// its usages, its size in bits and its logical range. From that the byte and bit position of every
// axis and button is known, so a controller does not have to send one fixed layout to be read. Every
// device goes this way, the EdgeTX radio too: its descriptor gives exactly the layout of edgetx.ts,
// which is now only the fallback for a device whose browser hands over no usable descriptor.
//
// One rule for every device:
// - Read: the top-level collections that are game controls, usage page 1 (Generic Desktop) usage 4
//   joystick, 5 gamepad or 8 multi-axis controller (GAME_CONTROL_USAGES: the chooser's filters in
//   apps/fly hid.ts, and what Chrome's Gamepad API takes), with the collections nested in them. A
//   mouse or keyboard collection of a combo receiver takes no channel and no button.
// - Axes: variable fields of 2..32 bits with a Generic Desktop usage X..Wheel (0x30..0x38) or a
//   position of the Simulation Controls page (0x02: aileron, elevator, rudder, throttle, accelerator,
//   brake..., the "dynamic values" of the HID Usage Tables), which Chrome's Gamepad API reads as axes
//   too (flight sticks and RC USB dongles put throttle and rudder there). One channel each in report
//   order (channel 1 first, as on a radio), at most 8 (a frame's channels).
// - Scaling (axisScale): the middle value of the logical range reads 0, the upper one of the two
//   middle values when the range has an even number of values (where unsigned HID axes rest: 1024 of
//   0..2047, 128 of 0..255, 32768 of 0..65535); one unit is the distance from there to the minimum.
//   The minimum reads -1, a symmetric range's maximum +1 (DJI: -660..660 is raw / 660), an even
//   range's maximum one step under +1 (0..2047: 2047 reads 1023 / 1024, as the fixed EdgeTX layout
//   always read it, so an EdgeTX radio reads bit for bit as before). Values outside the logical
//   range are clamped to -1..1.
// - Logical maximum: Chromium sign-extends it from the item's bytes, so 255 written as one byte (0x25
//   0xFF) arrives as -1. A maximum below a minimum of 0 or more is read unsigned in the field's size,
//   Linux's rule (hid-core.c reads it unsigned when the minimum is not negative; it knows the item's
//   byte size, WebHID does not hand it over and the field's size is the nearest, the same when the
//   maximum is the field's full range).
// - Buttons: 1-bit variable fields of the Button page (0x09) only; usage n = frame bit n-1, at most
//   24 (FRAME_BUTTONS). A 1-bit field of a vendor or consumer page is not a button.
// - Fields past the usages an item declares take its last usage (HID 1.11 sec. 6.2.2.8: a range stops
//   at its maximum, a list repeats its last usage); nothing is made up. Such a field is read with
//   that usage: a repeated axis usage is one more channel (two Sliders are two channels), a repeated
//   button is the same button (pressed while any of its bits is).
// - Not read, their bits skipped so the fields behind them still line up: constant (padding) fields,
//   array fields (their value is the index of a usage that is on, as keyboard keys, not a position
//   or a bit), hat switches (usage 0x39), vendor pages and every other usage. A hat is not an axis: it
//   sends a direction index (0..7) and rests on an out-of-range "centred" value, so as an axis it
//   would jump between its ends and sit outside its range at rest; no RC radio sends one (sticks and
//   switches come as axes or Button-page bits), and a gamepad's d-pad reaches the simulator through
//   the Gamepad API path, where the browser maps it. So a hat takes no channel and no button.
//
// A device that splits its axes over several report ids (a 3D mouse: translation in report 1, rotation
// in report 2; a twin-pad adapter: one report per pad) gets one fixed channel per axis over all its
// reports, in report-id order, and a report updates only its own channels and buttons; the others
// keep what their report last said. A report's buttons keep their own numbers unless one of them
// lands on a frame bit an earlier report already owns (each pad of a twin adapter numbers its buttons
// from 1): then that report's buttons move up by the smallest step that frees all of them. Chromium
// lists every item of a report in the top-level collection as well as in each nested one it sits in,
// so the first (outermost) listing of a report id is the whole report and the nested repeats are
// skipped.
//
// The DJI controller in its simulator mode ("DJI Virtual Joystick", USB 2ca3:1021, Windows measured
// 2026-10-15) is read this way: 5 axes of int16 -660..660 and 24 buttons in 13 bytes
// (docs/research/radios/dji-rc3.md).

import type { RawFrame } from './calib';
import { parseEdgeTxReport } from './edgetx';
import { FRAME_BUTTONS } from './frame';

/** The slice of the WebHID report item this reader needs (HIDReportItem, https://wicg.github.io/webhid/). */
export interface HidItemInfo {
    isConstant?: boolean;
    /** an array field: its value is the index of a usage that is on (keyboard keys), not a position or a bit */
    isArray?: boolean;
    isRange?: boolean;
    /** full usages (usage page << 16 | usage id), as Chromium hands them over */
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
    size: number; // bits, 2..32
    signed: boolean;
    lo: number; // logical minimum
    hi: number; // logical maximum (read unsigned when the browser sign-extended it below the minimum)
    centre: number; // the raw value that reads 0 (axisScale)
    unit: number; // raw units per 1.0 (axisScale)
    page: number; // usage page: 0x01 Generic Desktop or 0x02 Simulation Controls
    usage: number; // usage id: 0x30 X, 0x31 Y, 0x32 Z, 0x33 Rx, 0x34 Ry, 0x35 Rz, 0x36 slider, 0x37 dial, 0x38 wheel; page 2: 0xb0 aileron, 0xb8 elevator, 0xba rudder, 0xbb throttle...
}

export interface HidLayout {
    reportId: number;
    /** data bytes of this report (the report id is not counted) */
    bytes: number;
    axes: HidAxisField[];
    /** bit position of each button and its bit in the frame (Button n = bit n-1, moved up on a collision with an earlier report) */
    buttons: { bit: number; index: number }[];
    /** the frame's button bits this report owns */
    buttonMask: number;
}

const GENERIC_DESKTOP = 0x01;
const SIMULATION_CONTROLS = 0x02;
const BUTTON_PAGE = 0x09;
/**
 * Top-level collection usages on the Generic Desktop page that are game controls: joystick, gamepad,
 * multi-axis controller. The WebHID chooser offers these (apps/fly hid.ts) and only these are read.
 */
export const GAME_CONTROL_USAGES: readonly number[] = [0x04, 0x05, 0x08];
const AXIS_FIRST = 0x30; // X
const AXIS_LAST = 0x38; // Wheel; 0x39, the hat switch, is not an axis
/**
 * The positions ("dynamic values") of the Simulation Controls page, HID Usage Tables 1.4: aileron,
 * aileron trim, anti-torque, collective, dive brake, elevator, elevator trim, rudder, throttle, toe
 * brake, wing flaps, accelerator, brake, clutch, shifter, steering, turret, barrel elevation, dive
 * plane, ballast, bicycle crank, handle bars, front brake, rear brake. Its on/off controls (autopilot,
 * landing gear, trigger...) are not positions and not read.
 */
const SIM_AXES: ReadonlySet<number> = new Set([0xb0, 0xb1, 0xb2, 0xb5, 0xb6, 0xb8, 0xb9, 0xba, 0xbb, 0xbf, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd0]);
const MAX_AXES = 8;

/** A top-level collection that is a game control (GAME_CONTROL_USAGES on the Generic Desktop page). */
export function isGameControl(c: HidCollectionInfo): boolean {
    return c.usagePage === GENERIC_DESKTOP && GAME_CONTROL_USAGES.includes(c.usage ?? -1);
}

function isAxisUsage(page: number, id: number): boolean {
    return page === GENERIC_DESKTOP ? id >= AXIS_FIRST && id <= AXIS_LAST : page === SIMULATION_CONTROLS && SIM_AXES.has(id);
}

/**
 * The raw value that reads 0 and the raw units per 1.0 for a logical range lo..hi (hi > lo): the
 * middle value, the upper of the two when the range has an even number of values; the unit is the
 * distance from it to lo. See the header.
 */
export function axisScale(lo: number, hi: number): { centre: number; unit: number } {
    const centre = lo + Math.ceil((hi - lo) / 2);
    return { centre, unit: centre - lo };
}

/** The logical maximum as the descriptor meant it: unsigned in the field's size when the browser sign-extended it below a minimum of 0 or more. */
export function logicalMax(lo: number, hi: number, size: number): number {
    if (lo >= 0 && hi < lo) {
        const m = 2 ** size;
        return ((hi % m) + m) % m;
    }
    return hi;
}

/** The full usage (page << 16 | id) of field k of an item; past the declared usages, the last one; null when it has none. */
function usageOf(it: HidItemInfo, k: number): number | null {
    if (it.isRange) {
        const min = it.usageMinimum ?? 0;
        const max = it.usageMaximum ?? min;
        const u = min + k;
        return u > max ? max : u;
    }
    const us = it.usages ?? [];
    if (us.length === 0) return null;
    return us[k < us.length ? k : us.length - 1];
}

function walkReports(cols: readonly HidCollectionInfo[], out: HidReportInfo[]): void {
    for (const c of cols) {
        for (const r of c.inputReports ?? []) out.push(r);
        if (c.children) walkReports(c.children, out);
    }
}

/**
 * The input reports of a game control with at least one axis, one layout per report id (with axes or
 * buttons), channels numbered over all of them in report-id order; [] when no game-control collection
 * has an axis (a keyboard, a mouse, a device with only vendor pages) or when `cols` is missing.
 */
export function layoutsFromCollections(cols: readonly HidCollectionInfo[] | undefined | null): HidLayout[] {
    if (!cols || cols.length === 0) return [];
    const all: HidReportInfo[] = [];
    walkReports(cols.filter(isGameControl), all);
    const seen = new Set<number>();
    const reports = all.filter((r) => (seen.has(r.reportId) ? false : (seen.add(r.reportId), true)));
    reports.sort((a, b) => a.reportId - b.reportId);
    const out: HidLayout[] = [];
    let nextCh = 0;
    let taken = 0; // the frame's button bits earlier reports own
    let anyAxis = false;
    for (const rep of reports) {
        let bit = 0;
        const axes: HidAxisField[] = [];
        const ids: { bit: number; id: number }[] = []; // Button page fields of this report
        for (const it of rep.items ?? []) {
            const size = it.reportSize ?? 0;
            const count = it.reportCount ?? 0;
            if (size <= 0 || count <= 0) continue;
            if (!it.isConstant && !it.isArray) {
                const lo = it.logicalMinimum ?? 0;
                const hi = logicalMax(lo, it.logicalMaximum ?? 0, size);
                for (let k = 0; k < count; k++) {
                    const u = usageOf(it, k);
                    if (u === null) continue;
                    const page = u >>> 16;
                    const id = u & 0xffff;
                    const at = bit + k * size;
                    if (page === BUTTON_PAGE && size === 1 && id >= 1) ids.push({ bit: at, id });
                    else if (isAxisUsage(page, id) && size >= 2 && size <= 32 && hi > lo) {
                        axes.push({ ch: nextCh < MAX_AXES ? nextCh : -1, bit: at, size, signed: lo < 0, lo, hi, ...axisScale(lo, hi), page, usage: id });
                        nextCh++;
                    }
                }
            }
            bit += size * count;
        }
        // its own numbers, moved up by the smallest step that frees every bit an earlier report owns
        const lands = (shift: number): boolean => ids.some((b) => b.id - 1 + shift < FRAME_BUTTONS && ((taken >>> (b.id - 1 + shift)) & 1) === 1);
        let shift = 0;
        while (lands(shift)) shift++;
        const buttons: { bit: number; index: number }[] = [];
        let mask = 0;
        for (const b of ids) {
            const index = b.id - 1 + shift;
            if (index >= FRAME_BUTTONS) continue;
            buttons.push({ bit: b.bit, index });
            mask |= 1 << index;
        }
        if (axes.length === 0 && buttons.length === 0) continue;
        anyAxis ||= axes.length > 0;
        out.push({ reportId: rep.reportId, bytes: Math.ceil(bit / 8), axes, buttons, buttonMask: mask });
        taken |= mask;
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
        const v = (field(data, a.bit, a.size, a.signed) - a.centre) / a.unit;
        out.axes[a.ch] = v < -1 ? -1 : v > 1 ? 1 : v;
    }
    let b = 0;
    for (const bt of lay.buttons) if ((data.getUint8(bt.bit >> 3) >> (bt.bit & 7)) & 1) b |= 1 << bt.index;
    out.buttons = (out.buttons & ~lay.buttonMask) | b;
    return true;
}

/**
 * Do these layouts read every report exactly as the fixed EdgeTX layout (edgetx.ts) does: one report,
 * 8 unsigned 16-bit axes on channels 1..8 with centre 1024 and unit 1024 (logical 0..2047 or
 * 0..2048), after 24 buttons on bits 0..23 (19 bytes) or with no button (16 bytes)? The EdgeTX
 * radio's own descriptor does (Classic mode).
 */
export function readsAsEdgeTx(layouts: readonly HidLayout[]): boolean {
    if (layouts.length !== 1) return false;
    const l = layouts[0];
    const nb = l.buttons.length;
    if (!((nb === FRAME_BUTTONS && l.bytes === 19) || (nb === 0 && l.bytes === 16))) return false;
    const base = nb === 0 ? 0 : FRAME_BUTTONS;
    return l.buttons.every((b, i) => b.bit === i && b.index === i)
        && l.axes.length === 8
        && l.axes.every((a, i) => a.ch === i && a.bit === base + 16 * i && a.size === 16 && !a.signed && a.centre === 1024 && a.unit === 1024);
}

/** The name a profile gets: the product name, or the USB ids when the device calls itself only "HID Interface". */
export function hidDisplayName(d: { vendorId: number; productId: number; productName: string }): string {
    const n = (d.productName || '').trim();
    if (n && !/^(usb input device|hid interface|hid-compliant .*)$/i.test(n)) return n;
    return `USB ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
}

/**
 * Reads one input report (its id and data, as WebHID's inputreport event gives them) into a frame;
 * false = unreadable. The profile key (hidProfileKey) takes from it:
 * - `keyBytes`: the report length in the key, fixed for a device read by its descriptor (its first
 *   report with axes), so the key does not depend on which of its reports arrives first; absent: the
 *   length that arrived, as every key had before descriptors were read.
 * - `keySuffix`: ':d' for a device read by its descriptor in any other way than the fixed EdgeTX
 *   layout read it, so it never picks up a profile saved while that layout misread its reports (a
 *   17-byte joystick was read as an EdgeTX 16-byte report); '' for the fixed layout and for a
 *   descriptor that reads exactly like it (the EdgeTX radio keeps the key of its saved profiles).
 */
export type HidReader = ((reportId: number, data: DataView, out: RawFrame) => boolean) & { keyBytes?: number; keySuffix: '' | ':d' };

/**
 * The reader for a device: its own descriptor when a game-control collection of it has an axis; the
 * fixed EdgeTX layout only when the browser hands over no usable descriptor (as before descriptors
 * were read).
 */
export function makeHidReader(d: { collections?: readonly HidCollectionInfo[] }): HidReader {
    const layouts = layoutsFromCollections(d.collections);
    if (layouts.length === 0) return Object.assign((_id: number, data: DataView, out: RawFrame) => parseEdgeTxReport(data, out), { keySuffix: '' as const });
    const read: HidReader = Object.assign((id: number, data: DataView, out: RawFrame) => decodeHidReport(layouts, id, data, out), { keySuffix: '' as const });
    if (readsAsEdgeTx(layouts)) return read;
    read.keyBytes = layouts.find((l) => l.axes.length > 0)?.bytes;
    read.keySuffix = ':d';
    return read;
}

/** A HID device's profile key: `hid:<vid>:<pid>:<product name>:<report length>` and the reader's suffix (HidReader). */
export function hidProfileKey(d: { vendorId: number; productId: number; productName: string }, read: HidReader, arrivedBytes: number): string {
    return `hid:${d.vendorId.toString(16)}:${d.productId.toString(16)}:${d.productName}:${read.keyBytes ?? arrivedBytes}${read.keySuffix}`;
}
