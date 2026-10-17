// v0.9 (the owner's item 3b): "Wideo nie zostalo zapisane: Codec reclaimed due to inactivity". Chrome takes
// back a VideoEncoder nobody fed for a while; a file's encoder is made again when nothing was in it
// (cinema.ts EncoderRevival), its next frame a key frame, and the stream must keep the first encoder's
// description. The control is the same bookkeeping allowed no revival (v0.8: the error ended the file).
import { describe, expect, it } from 'vitest';
import { EncoderRevival, isReclaimed } from '../../../apps/fly/src/cinema';

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
