// Lane loadq G3: a failed or stalled streamed file is asked again with a growing pause, counted, given up after the
// last pause and asked again by retryAll (src/stream-keeper.ts). A fake of the engine's GSplatAssetLoader fields.
import { describe, expect, it } from 'vitest';
import { StreamKeeper, STREAM_RETRY_PAUSES_MS, STREAM_STALL_MS, streamKeeperMissing } from '../src/stream-keeper';

function fakeLoader() {
    const l = {
        maxRetries: 2,
        _failed: new Set<string>(),
        _currentlyLoading: new Set<string>(),
        _loadQueue: new Map<string, number>(),
        unloaded: [] as string[],
        processed: 0,
        resources: new Map<string, unknown>(),
        _processQueue() { l.processed++; },
        unload(url: string) { l.unloaded.push(url); l._failed.delete(url); l._currentlyLoading.delete(url); l._loadQueue.delete(url); },
        getResource(url: string) { return l.resources.get(url); }
    };
    return l;
}

describe('StreamKeeper', () => {
    it('turns the engine retry off and asks a failed file again after pauses that grow, then gives it up', () => {
        const k = new StreamKeeper();
        const l = fakeLoader();
        let now = 1000;
        k.tick(now, l);
        expect(l.maxRetries).toBe(0);
        const waited: number[] = [];
        for (let fail = 0; fail <= STREAM_RETRY_PAUSES_MS.length; fail++) {
            // the engine starts the file, then it fails
            l._currentlyLoading.add('a');
            k.tick(now, l);
            l._currentlyLoading.delete('a');
            l._failed.add('a');
            now += 50;
            k.tick(now, l);
            if (fail === STREAM_RETRY_PAUSES_MS.length) break;
            const failedAt = now;
            const before = l.unloaded.length;
            while (l.unloaded.length === before && now < failedAt + 60000) {
                now += 50;
                k.tick(now, l);
            }
            waited.push(now - failedAt);
        }
        // each pause within one tick of its value, growing
        expect(waited.length).toBe(STREAM_RETRY_PAUSES_MS.length);
        waited.forEach((ms, n) => {
            expect(ms).toBeGreaterThanOrEqual(STREAM_RETRY_PAUSES_MS[n]);
            expect(ms).toBeLessThan(STREAM_RETRY_PAUSES_MS[n] + 100);
        });
        for (let n = 1; n < waited.length; n++) expect(waited[n]).toBeGreaterThan(waited[n - 1]);
        const s = k.stats();
        expect(s.retries).toBe(STREAM_RETRY_PAUSES_MS.length);
        expect(s.failures).toBe(STREAM_RETRY_PAUSES_MS.length + 1);
        expect(s.givenUp).toBe(1);
        expect(s.retrying).toBe(0);
        // given up: not asked again by itself
        const n0 = l.unloaded.length;
        now += 60000;
        k.tick(now, l);
        expect(l.unloaded.length).toBe(n0);
        // the Try again press
        expect(k.retryAll()).toBe(1);
        expect(l.unloaded.length).toBe(n0 + 1);
        expect(k.stats().givenUp).toBe(0);
    });

    it('frees the slot of a file with no answer and counts it as failed; a late answer is kept', () => {
        const k = new StreamKeeper();
        const l = fakeLoader();
        let now = 0;
        l._currentlyLoading.add('slow');
        k.tick(now, l);
        now += STREAM_STALL_MS - 1;
        k.tick(now, l);
        expect(l._currentlyLoading.has('slow')).toBe(true);
        now += 1;
        k.tick(now, l);
        expect(l._currentlyLoading.has('slow')).toBe(false);
        expect(l._failed.has('slow')).toBe(true);
        expect(l.processed).toBe(1);
        expect(k.stats().stalls).toBe(1);
        expect(k.stats().retrying).toBe(1);
        expect(k.stats().troubled).toBe(1);
        // the answer arrives during the pause: kept, not asked again
        l.resources.set('slow', {});
        now += STREAM_RETRY_PAUSES_MS[0];
        k.tick(now, l);
        expect(l._failed.has('slow')).toBe(false);
        expect(l.unloaded).toEqual([]);
        expect(k.stats().retries).toBe(0);
    });

    it('counts a file that stalled as troubled while it is asked again, and not once it arrives', () => {
        const k = new StreamKeeper();
        const l = fakeLoader();
        let now = 0;
        l._currentlyLoading.add('dead');
        k.tick(now, l);
        now += STREAM_STALL_MS;
        k.tick(now, l);
        now += STREAM_RETRY_PAUSES_MS[0];
        k.tick(now, l);
        expect(l.unloaded).toEqual(['dead']);
        expect(k.stats().retrying).toBe(0);
        // the engine asks it again: loading again after a failure is still trouble the line names
        l._currentlyLoading.add('dead');
        now += 10;
        k.tick(now, l);
        expect(k.stats().troubled).toBe(1);
        l._currentlyLoading.delete('dead');
        now += 10;
        k.tick(now, l);
        expect(k.stats().troubled).toBe(0);
        expect(k.stats().done).toBe(1);
    });

    it('counts arrivals, the slowest file and what is pending', () => {
        const k = new StreamKeeper();
        const l = fakeLoader();
        l._currentlyLoading.add('x');
        l._currentlyLoading.add('y');
        l._loadQueue.set('z', 1);
        k.tick(0, l);
        l._currentlyLoading.delete('x');
        k.tick(1200, l);
        l._currentlyLoading.delete('y');
        k.tick(2400, l);
        const s = k.stats();
        expect(s.done).toBe(2);
        expect(s.slowestMs).toBe(2400);
        expect(s.pending).toBe(1);
        expect(s.filesPerSec).toBeGreaterThan(0);
    });

    it('leaves an engine without the fields alone', () => {
        expect(streamKeeperMissing({})).toEqual(['_failed', '_currentlyLoading', '_loadQueue', 'unload']);
        const k = new StreamKeeper();
        k.tick(0, { maxRetries: 2 });
        expect(k.stats().pending).toBe(0);
    });
});
