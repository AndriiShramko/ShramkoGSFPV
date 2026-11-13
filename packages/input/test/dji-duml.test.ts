// Lane rc2, stage 2 (docs/wip/rc2.md): DUML frames of the DJI RC 2 (packages/input/src/dji-duml.ts).
//  - the recorded frames (evidence/2026-11-13/rc2/frames-rest*.json, read from the owner's controller): every one
//    parses with both checksums; the stick replies decode to the centre; the unasked frames are not stick replies;
//  - the request the recorder sent is the bytes stickRequest builds;
//  - a flipped bit fails the CRC8 or the CRC16; the stream reader finds frames across reads and after garbage;
//  - the reference's range (364..1684, centre 1024) gives -1, 0, +1 in roll, pitch, throttle, yaw order;
//  - the HID description reads the same axes through the simulator's HID reader, and the known table does not take
//    the RC 2 for the DJI FPV Remote Controller 3 (the same USB ids).
// The sticks never moved during the recording: the moving values below are built frames on the reference's layout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DumlReader, RC2, RC2_HID_COLLECTIONS, buildFrame, dumlCrc16, dumlCrc8, isStickReply, parseFrame, rc2Report, stickAxes, stickAxis, stickRequest, stickValues } from '../src/dji-duml';
import type { DumlFrame } from '../src/dji-duml';
import { hidProfileKey, makeHidReader } from '../src/hid-layout';
import { recognise, seenFromHid } from '../src/known-devices';

const EV = resolve(__dirname, '../../../evidence/2026-11-13/rc2');
interface Rec { request: string; frames: { hex: string; seq: number; set: number; id: number; type: number; values?: number[] | null }[] }
const recs: Rec[] = ['frames-rest.json', 'frames-rest-2.json'].map((f) => JSON.parse(readFileSync(resolve(EV, f), 'utf8')) as Rec);
const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((x) => parseInt(x, 16)));
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A stick reply laid out as the recorded one: result 0, then each value followed by its channel number 1..6. */
function reply(seq: number, values: number[]): Uint8Array {
    const p = new Uint8Array(19);
    values.forEach((v, i) => { p[1 + i * 3] = v & 0xff; p[2 + i * 3] = v >> 8; p[3 + i * 3] = i + 1; });
    return buildFrame({ sender: RC2.RC, receiver: RC2.PC, seq, type: 0x80, set: 6, id: 1, payload: p });
}

describe('the recorded frames', () => {
    it('every frame of both recordings parses with both checksums; stick replies read 1024 on all six', () => {
        let replies = 0, other = 0;
        for (const r of recs) {
            for (const f of r.frames) {
                const p = parseFrame(bytes(f.hex));
                expect(typeof p).toBe('object');
                const fr = p as DumlFrame;
                expect([fr.seq, fr.set, fr.id, fr.type]).toEqual([f.seq, f.set, f.id, f.type]);
                if (isStickReply(fr)) {
                    replies++;
                    expect(stickValues(fr)).toEqual([1024, 1024, 1024, 1024, 1024, 1024]);
                    expect(Array.from(stickAxes(stickValues(fr)!, new Float32Array(6)))).toEqual([0, 0, 0, 0, 0, 0]);
                } else {
                    other++;
                    expect(fr.set).toBe(0);
                }
            }
        }
        expect(replies).toBe(293 + 392);
        expect(other).toBeGreaterThan(0);
    });
    it('the request the recorder sent first is stickRequest(0x34eb), byte for byte', () => {
        expect(hex(stickRequest(0x34eb))).toBe(recs[0].request.slice(0, 26));
        expect(hex(stickRequest(0x34eb))).toBe('550d04330a06eb344006017424');
    });
    it('a reply answers its own sequence only', () => {
        const fr = parseFrame(bytes(recs[0].frames[0].hex)) as DumlFrame;
        expect(isStickReply(fr, fr.seq)).toBe(true);
        expect(isStickReply(fr, fr.seq + 1)).toBe(false);
        expect(isStickReply(parseFrame(stickRequest(5)) as DumlFrame)).toBe(false); // a request is not a reply
    });
});

describe('checksums and the stream', () => {
    it('a flipped bit in the header fails the CRC8, in the body the CRC16; a cut frame is short', () => {
        const ok = bytes(recs[0].frames[0].hex);
        const head = ok.slice(); head[1] ^= 0x01;
        const body = ok.slice(); body[14] ^= 0x01;
        expect(parseFrame(head)).toBe('crc8');
        expect(parseFrame(body)).toBe('crc16');
        expect(parseFrame(ok.slice(0, 20))).toBe('short');
        expect(parseFrame(ok.slice(1))).toBe('magic');
        expect(dumlCrc8(ok, 3)).toBe(ok[3]);
        expect(dumlCrc16(ok, ok.length - 2)).toBe(ok[ok.length - 2] | (ok[ok.length - 1] << 8));
    });
    it('the reader: two frames split over three reads after garbage; a broken frame is skipped, the next one found', () => {
        const a = reply(1, [364, 1024, 1684, 1024, 1024, 1024]);
        const unasked = bytes(recs[0].frames.find((f) => f.set === 0)!.hex);
        const bad = reply(2, [1, 2, 3, 4, 5, 6]); bad[20] ^= 0xff;
        const all = new Uint8Array([0x00, 0x55, 0x13, ...a, ...unasked, ...bad, ...reply(3, [1024, 1024, 1024, 1024, 1024, 1024])]);
        const r = new DumlReader();
        const got = [...r.feed(all.subarray(0, 10)), ...r.feed(all.subarray(10, 100)), ...r.feed(all.subarray(100))];
        expect(got.map((f) => [f.seq, f.set])).toEqual([[1, 6], [unasked[6] | (unasked[7] << 8), 0], [3, 6]]);
        expect(r.skipped).toBeGreaterThan(3);
    });
});

describe('the sticks in the simulator range', () => {
    it('364, 1024 and 1684 read -1, 0 and +1; past the ends clamps', () => {
        expect([stickAxis(364), stickAxis(1024), stickAxis(1684), stickAxis(1354), stickAxis(100), stickAxis(2000)]).toEqual([-1, 0, 1, 0.5, -1, 1]);
        const f = parseFrame(reply(9, [1684, 364, 1354, 694, 1024, 1024])) as DumlFrame;
        expect(Array.from(stickAxes(stickValues(f)!, new Float32Array(8)))).toEqual([1, -1, 0.5, -0.5, 0, 0, 0, 0]);
        expect(RC2.CHANNELS.slice(0, 4)).toEqual(['roll', 'pitch', 'throttle', 'yaw']);
    });
    it('a reply with another layout gives none: result not 0, a wrong channel number, a value out of range', () => {
        const pay = (seq: number, edit: (p: Uint8Array) => void): DumlFrame => {
            const f = parseFrame(reply(seq, [1024, 1024, 1024, 1024, 1024, 1024])) as DumlFrame;
            const p = f.payload.slice();
            edit(p);
            return parseFrame(buildFrame({ ...f, payload: p })) as DumlFrame;
        };
        expect(stickValues(pay(1, () => undefined))).toEqual([1024, 1024, 1024, 1024, 1024, 1024]); // control
        expect(stickValues(pay(2, (p) => { p[0] = 1; }))).toBeNull();
        expect(stickValues(pay(3, (p) => { p[6] = 5; }))).toBeNull();
        expect(stickValues(pay(4, (p) => { p[1] = 0; p[2] = 0; }))).toBeNull(); // 0
        expect(stickValues(pay(5, (p) => { p[16] = 0xff; p[17] = 0xff; }))).toBeNull(); // 65535
        expect(stickValues(parseFrame(reply(6, [364 - 40, 1684 + 40, 1024, 1024, 1024, 1024])) as DumlFrame)).not.toBeNull();
        expect(stickValues(parseFrame(reply(7, [364 - 41, 1024, 1024, 1024, 1024, 1024])) as DumlFrame)).toBeNull();
    });
    it('a payload too short for six values gives none', () => {
        const f = parseFrame(buildFrame({ sender: 6, receiver: 10, seq: 1, type: 0x80, set: 6, id: 1, payload: new Uint8Array(10) })) as DumlFrame;
        expect(stickValues(f)).toBeNull();
    });
    it('the HID description reads the same axes through the HID reader; key 12 bytes; not the RC 3 of the known table', () => {
        const dev = { vendorId: 0x2ca3, productId: 0x1021, productName: 'DJI RC 2', collections: RC2_HID_COLLECTIONS };
        const read = makeHidReader(dev);
        const vals = [1684, 364, 1354, 694, 1024, 1500];
        const frame = { t: 0, axes: new Float32Array(8), buttons: 0 };
        const rep = rc2Report(vals);
        expect(read(0, new DataView(rep.buffer), frame)).toBe(true);
        expect(Array.from(frame.axes)).toEqual(Array.from(stickAxes(vals, new Float32Array(8))));
        expect(hidProfileKey(dev, read, rep.length)).toBe('hid:2ca3:1021:DJI RC 2:12:d');
        expect(recognise(seenFromHid(dev))).toBeNull();
    });
});
