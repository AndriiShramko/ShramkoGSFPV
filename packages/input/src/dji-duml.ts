// DJI's DUML v1 frames as the DJI RC 2 (the controller with a screen that ships with the Avata 360) speaks them on its
// vendor bulk interface FF.43.01 (lane rc2, docs/wip/rc2.md). Pure: no DOM, no USB. The WebUSB source is
// apps/fly/src/devices/dji-rc2-source.ts.
//
// Facts and where they come from ([measured] = read from the owner's RC 2 on 2026-11-13, evidence/2026-11-13/rc2/;
// [reference] = github.com/rusty407/dji-rc2-linux-joystick, MIT, duml.py and rc2link.py):
//  - a frame: 0x55; length (low 10 bits, the whole frame with its CRC16) | version 1 << 10, little-endian; CRC8 of
//    bytes 0..2 (CRC-8/Maxim reflected, poly 0x8C, seed 0x77); sender; receiver; sequence (u16 LE); command type
//    (0x40 request, bit 7 = response); command set; command id; payload; CRC16 of everything before it, LE
//    (reflected poly 0x8408, seed 0x3692) [reference; both checksums matched on every frame received, measured];
//  - the stick request: PC 0x0a -> RC 0x06, type 0x40, set 06 id 01, no payload [reference, the bytes measured];
//  - the stick reply: set 06 id 01 with bit 7 of the type set, the request's sequence echoed; payload byte 0 a
//    result code, then six u16 LE at payload offsets 1, 4, 7, 10, 13, 16 [reference; 1024 on all six at rest,
//    measured] in the order roll, pitch, throttle, yaw, left dial, right dial [reference];
//  - the range 364..1684 with the centre 1024 [reference; the centre measured on all six];
//  - other frames arrive unasked (set 00 id 81 and 82, 168 bytes, about once a second each) [measured]: the reader
//    hands them over like any frame and isStickReply() leaves them out.

import { axisScale } from './hid-layout';
import type { HidCollectionInfo } from './hid-layout';

export const DUML_MAGIC = 0x55;
/** the shortest frame: 11 bytes of header and the 2 bytes of CRC16, no payload */
export const DUML_MIN_LEN = 13;
/** the longest frame the 10-bit length can say */
export const DUML_MAX_LEN = 0x3ff;

function reflectedTable(poly: number): Uint16Array {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1;
        t[i] = c;
    }
    return t;
}
const CRC8 = reflectedTable(0x8c);
const CRC16 = reflectedTable(0x8408);

/** CRC-8/Maxim, reflected, seed 0x77, over the first `n` bytes. */
export function dumlCrc8(b: Uint8Array, n = b.length): number {
    let c = 0x77;
    for (let i = 0; i < n; i++) c = CRC8[(b[i] ^ c) & 0xff];
    return c;
}

/** CRC-16 reflected poly 0x8408, seed 0x3692, over the first `n` bytes. */
export function dumlCrc16(b: Uint8Array, n = b.length): number {
    let c = 0x3692;
    for (let i = 0; i < n; i++) c = (c >>> 8) ^ CRC16[(b[i] ^ c) & 0xff];
    return c & 0xffff;
}

export interface DumlFrame {
    sender: number;
    receiver: number;
    seq: number;
    /** 0x40 a request; bit 7 set: a response */
    type: number;
    set: number;
    id: number;
    payload: Uint8Array;
}

/** One frame's bytes, both checksums filled in. */
export function buildFrame(f: Omit<DumlFrame, 'payload'> & { payload?: Uint8Array }): Uint8Array {
    const payload = f.payload ?? new Uint8Array(0);
    const len = DUML_MIN_LEN + payload.length;
    if (len > DUML_MAX_LEN) throw new RangeError(`DUML frame of ${len} bytes`);
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    b[0] = DUML_MAGIC;
    v.setUint16(1, len | (1 << 10), true);
    b[3] = dumlCrc8(b, 3);
    b[4] = f.sender;
    b[5] = f.receiver;
    v.setUint16(6, f.seq & 0xffff, true);
    b[8] = f.type;
    b[9] = f.set;
    b[10] = f.id;
    b.set(payload, 11);
    v.setUint16(len - 2, dumlCrc16(b, len - 2), true);
    return b;
}

export type DumlError = 'short' | 'magic' | 'crc8' | 'length' | 'crc16';

/** Exactly one frame starting at byte 0 of `b` (bytes after it are ignored), or what is wrong with it. */
export function parseFrame(b: Uint8Array): DumlFrame | DumlError {
    if (b.length < 4) return 'short';
    if (b[0] !== DUML_MAGIC) return 'magic';
    if (dumlCrc8(b, 3) !== b[3]) return 'crc8';
    const len = (b[1] | (b[2] << 8)) & 0x3ff;
    if (len < DUML_MIN_LEN) return 'length';
    if (b.length < len) return 'short';
    if (dumlCrc16(b, len - 2) !== (b[len - 2] | (b[len - 1] << 8))) return 'crc16';
    return { sender: b[4], receiver: b[5], seq: b[6] | (b[7] << 8), type: b[8], set: b[9], id: b[10], payload: b.slice(11, len - 2) };
}

/**
 * The bytes of a bulk endpoint as frames: a read may hold several frames or part of one; garbage before a 0x55 and a
 * frame whose checksum is wrong are skipped a byte at a time (as the reference's stream parser does), counted in
 * `skipped`.
 */
export class DumlReader {
    private buf = new Uint8Array(0);
    skipped = 0;

    feed(chunk: Uint8Array): DumlFrame[] {
        const all = new Uint8Array(this.buf.length + chunk.length);
        all.set(this.buf, 0);
        all.set(chunk, this.buf.length);
        const out: DumlFrame[] = [];
        let at = 0;
        while (at < all.length) {
            if (all[at] !== DUML_MAGIC) { at++; this.skipped++; continue; }
            const r = parseFrame(all.subarray(at));
            if (r === 'short') break;
            if (typeof r === 'string') { at++; this.skipped++; continue; }
            out.push(r);
            at += DUML_MIN_LEN + r.payload.length;
        }
        this.buf = all.slice(at);
        return out;
    }
}

/** The DJI RC 2 on DUML: the two ends, the stick command, the channels and their range (see the header for sources). */
export const RC2 = {
    PC: 0x0a,
    RC: 0x06,
    REQUEST: 0x40,
    STICK_SET: 0x06,
    STICK_ID: 0x01,
    /** the six channels in the reply's order */
    CHANNELS: ['roll', 'pitch', 'throttle', 'yaw', 'leftDial', 'rightDial'] as const,
    /** payload offsets of the six u16 LE values */
    OFFSETS: [1, 4, 7, 10, 13, 16] as const,
    MIN: 364,
    CENTRE: 1024,
    MAX: 1684
} as const;

/** The stick request with sequence `seq` (the only frame the simulator sends). */
export function stickRequest(seq: number): Uint8Array {
    return buildFrame({ sender: RC2.PC, receiver: RC2.RC, seq, type: RC2.REQUEST, set: RC2.STICK_SET, id: RC2.STICK_ID });
}

/** A reply to the stick request (to `seq` when given); the unasked frames of the controller are not. */
export function isStickReply(f: DumlFrame, seq?: number): boolean {
    return (f.type & 0x80) !== 0 && f.set === RC2.STICK_SET && f.id === RC2.STICK_ID && (seq === undefined || f.seq === (seq & 0xffff));
}

/** The six raw values (364..1684, the order of RC2.CHANNELS) of a stick reply; null when its payload is too short. */
export function stickValues(f: DumlFrame): number[] | null {
    const p = f.payload;
    if (p.length < RC2.OFFSETS[5] + 2) return null;
    return RC2.OFFSETS.map((o) => p[o] | (p[o + 1] << 8));
}

const SCALE = axisScale(RC2.MIN, RC2.MAX); // centre 1024, 660 per 1.0

/** The simulator's range: -1..1 with the centre 0, clamped (the same scale the HID reader gives the report below). */
export function stickAxis(raw: number): number {
    const v = (raw - SCALE.centre) / SCALE.unit;
    return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** The six values into `out` (axes 0..5, the order of RC2.CHANNELS), each -1..1. */
export function stickAxes(values: readonly number[], out: Float32Array): Float32Array {
    for (let i = 0; i < 6 && i < out.length; i++) out[i] = stickAxis(values[i] ?? RC2.CENTRE);
    return out;
}

const P1 = 0x10000; // usage page 0x01 (generic desktop) in the high half of a WebHID usage

/**
 * The RC 2's sticks as a HID joystick would describe them, so the simulator's HID path (HidSource, the wizard, the
 * check screen, profiles) reads them unchanged: report id 0, six unsigned 16-bit axes X Y Z Rx Ry Rz (roll, pitch,
 * throttle, yaw, left dial, right dial, the reference's axis codes) with the logical range 364..1684, no buttons.
 * Six axes, not the DJI FPV Remote Controller 3's five: the known table must not take the RC 2 for the RC 3 (both
 * are USB 2CA3:1021).
 */
export const RC2_HID_COLLECTIONS: HidCollectionInfo[] = [{
    usagePage: 0x01,
    usage: 0x04,
    children: [],
    inputReports: [{
        reportId: 0,
        items: [{ isConstant: false, isArray: false, isRange: false, usages: [P1 | 0x30, P1 | 0x31, P1 | 0x32, P1 | 0x33, P1 | 0x34, P1 | 0x35], reportSize: 16, reportCount: 6, logicalMinimum: RC2.MIN, logicalMaximum: RC2.MAX }]
    }]
}];

/** The report RC2_HID_COLLECTIONS describes: the six raw values as u16 LE (12 bytes). */
export function rc2Report(values: readonly number[]): Uint8Array {
    const b = new Uint8Array(12);
    const v = new DataView(b.buffer);
    for (let i = 0; i < 6; i++) v.setUint16(i * 2, values[i] ?? RC2.CENTRE, true);
    return b;
}
