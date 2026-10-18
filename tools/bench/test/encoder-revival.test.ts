// v0.9 (the owner's item 3b): "Wideo nie zostalo zapisane: Codec reclaimed due to inactivity". Chrome takes
// back a VideoEncoder nobody fed for a while; a file's encoder is made again when nothing was in it
// (cinema.ts EncoderRevival), its next frame a key frame, and the stream must keep the first encoder's
// description. The control is the same bookkeeping allowed no revival (v0.8: the error ended the file).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Mediabunny from 'mediabunny';
import { EncoderRevival, Part, isReclaimed } from '../../../apps/fly/src/cinema';
import type { RecordTarget } from '../../../apps/fly/src/cinema';

/** The DOMException Chrome passes to the encoder's error callback when it reclaims it. */
const reclaim = { name: 'QuotaExceededError', message: 'Codec reclaimed due to inactivity.' };
const meta = (bytes: number[]): EncodedVideoChunkMetadata => ({ decoderConfig: { codec: 'avc1.640033', description: new Uint8Array(bytes) } });

describe('an encoder Chrome reclaimed while idle comes back', () => {
    it('reclaimed with nothing in it: made again, the next frame a key frame, the same description goes on', () => {
        const r = new EncoderRevival();
        expect(r.onOutput(meta([1, 100, 0, 51]))).toBeNull(); // the first encoder's first packet
        expect(r.onError(reclaim, 0)).toBe(true);
        expect(r.revivals).toBe(1);
        expect(r.takeKey()).toBe(true);
        expect(r.takeKey()).toBe(false);
        expect(r.onOutput(meta([1, 100, 0, 51]))).toBeNull();
        expect(r.onOutput(undefined)).toBeNull();
    });

    it('reclaimed before any frame (the owner\'s export: 10 minutes at frame 0): made again', () => {
        const r = new EncoderRevival();
        expect(r.onError(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'), 0)).toBe(true);
        expect(r.onOutput(meta([1, 2, 3]))).toBeNull();
    });

    it('reclaimed before any packet, then again: the second new encoder is held to the first one\'s description (v0.9 review)', () => {
        const r = new EncoderRevival();
        expect(r.onError(reclaim, 0)).toBe(true);
        expect(r.onOutput(meta([1, 2, 3]))).toBeNull(); // the revived encoder's first packet: the stream's description
        expect(r.onOutput(undefined)).toBeNull(); // later packets carry no description (only a key frame's does)
        expect(r.onError(reclaim, 0)).toBe(true);
        expect(r.onOutput(meta([9, 9, 9]))).toMatch(/other settings/);
        // control: the same with the same description goes on
        const same = new EncoderRevival();
        same.onError(reclaim, 0);
        same.onOutput(meta([1, 2, 3]));
        same.onError(reclaim, 0);
        expect(same.onOutput(meta([1, 2, 3]))).toBeNull();
    });

    it('a new encoder that describes the stream otherwise cannot go on in the same file', () => {
        const r = new EncoderRevival();
        r.onOutput(meta([1, 100, 0, 51]));
        r.onError(reclaim, 0);
        expect(r.onOutput(meta([1, 77, 0, 40]))).toMatch(/other settings/);
    });

    it('not revived: frames in it (they would be lost), another error, or too many times', () => {
        expect(new EncoderRevival().onError(reclaim, 3)).toBe(false);
        expect(new EncoderRevival().onError(new Error('encoding failed'), 0)).toBe(false);
        const r = new EncoderRevival(2);
        expect([r.onError(reclaim, 0), r.onError(reclaim, 0), r.onError(reclaim, 0)]).toEqual([true, true, false]);
        expect(isReclaimed({ name: 'EncodingError', message: 'x' })).toBe(false);
        expect(isReclaimed(reclaim)).toBe(true);
    });

    it('control: with no revival allowed (v0.8) the reclaim ends the file', () => {
        expect(new EncoderRevival(0).onError(reclaim, 0)).toBe(false);
    });
});

/**
 * Part's wiring (v0.9 review: only the bookkeeping was tested): a fake VideoEncoder (the browser's
 * global) and a fake Mediabunny drive one file through a reclaim. Not a real Chrome reclaim: that one
 * is not triggered by any run (said in the lane's notVerified).
 */
describe('a file (cinema.ts Part) goes on with a new encoder after a reclaim', () => {
    class FakeEncoder {
        static made: FakeEncoder[] = [];
        state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
        encodeQueueSize = 0;
        config: VideoEncoderConfig | null = null;
        keys: boolean[] = [];
        constructor(readonly init: VideoEncoderInit) { FakeEncoder.made.push(this); }
        configure(c: VideoEncoderConfig): void { this.config = c; this.state = 'configured'; }
        encode(_f: unknown, o?: VideoEncoderEncodeOptions): void { this.keys.push(!!o?.keyFrame); }
        flush(): Promise<void> { return Promise.resolve(); }
        close(): void { this.state = 'closed'; }
        /** the encoder gives back the packet of its oldest encode, its stream described by `desc` */
        out(desc: number[]): void { this.init.output({ byteLength: 1 } as EncodedVideoChunk, meta(desc)); }
    }
    class FakeFrame { constructor(readonly src: unknown, readonly o: unknown) {} close(): void { /* nothing held */ } }

    function makePart() {
        FakeEncoder.made = [];
        vi.stubGlobal('VideoEncoder', FakeEncoder);
        vi.stubGlobal('VideoFrame', FakeFrame);
        const packets: unknown[] = [];
        const ok = (): Promise<void> => Promise.resolve();
        const mb = {
            Output: class { addVideoTrack(): void { /* one track */ } start = ok; finalize = ok; cancel = ok; },
            Mp4OutputFormat: class {},
            StreamTarget: class {},
            EncodedVideoPacketSource: class { add(p: unknown): Promise<void> { packets.push(p); return ok(); } },
            EncodedPacket: { fromEncodedChunk: (c: unknown) => c }
        } as unknown as typeof Mediabunny;
        const sink = { write: ok, close: ok, abort: ok };
        const target = { kind: 'memory', folder: '', open: async () => sink, exists: async () => false, file: async () => null } as unknown as RecordTarget;
        const errors: unknown[] = [];
        const config = { codec: 'avc1.640033', width: 1920, height: 1080 } as VideoEncoderConfig;
        const part = new Part(mb, 0, Promise.resolve('f.mp4'), target, 'avc', config, 60, (e) => errors.push(e));
        const frame = {} as VideoFrame;
        return { part, frame, packets, errors, config };
    }

    afterEach(() => { vi.unstubAllGlobals(); });

    it('reclaimed idle: a new encoder with the same settings, its first frame a key frame, the packets go on into the same file', async () => {
        const { part, frame, packets, errors, config } = makePart();
        part.encode(frame, 0, 60, false);
        part.encode(frame, 1, 60, false);
        const first = FakeEncoder.made[0];
        first.out([1, 2, 3]);
        first.out([1, 2, 3]);
        first.init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
        expect(FakeEncoder.made.length).toBe(2);
        const next = FakeEncoder.made[1];
        expect(next.config).toBe(config);
        expect(next.state).toBe('configured');
        expect(part.revivals).toBe(1);
        part.encode(frame, 2, 60, false);
        part.encode(frame, 3, 60, false);
        expect(next.keys).toEqual([true, false]);
        next.out([1, 2, 3]);
        next.out([1, 2, 3]);
        expect(errors).toEqual([]);
        expect(part.failed).toBeNull();
        const file = await part.finish(60);
        expect(file.frames).toBe(4);
        expect(packets.length).toBe(4);
    });

    it('control: reclaimed with a frame still in it, the file fails (the frame would be lost) and no encoder is made', () => {
        const { part, frame, errors } = makePart();
        part.encode(frame, 0, 60, false);
        FakeEncoder.made[0].init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
        expect(FakeEncoder.made.length).toBe(1);
        expect(errors.length).toBe(1);
        expect(part.failed).not.toBeNull();
    });

    it('control: the new encoder describes the stream otherwise, the file fails with that reason', () => {
        const { part, frame, errors } = makePart();
        part.encode(frame, 0, 60, false);
        FakeEncoder.made[0].out([1, 2, 3]);
        FakeEncoder.made[0].init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
        part.encode(frame, 1, 60, false);
        FakeEncoder.made[1].out([9, 9, 9]);
        expect(String((errors[0] as Error)?.message)).toMatch(/other settings/);
    });
});
