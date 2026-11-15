// The streamed scan's files that fail or never answer (lane loadq, the owner's message 58: "sometimes it loads,
// sometimes it does not"). Measured in docs/wip/loadq.md L1 (b): the engine's loader (playcanvas 2.23.2
// GSplatAssetLoader) asks a failed file again twice at once and then gives it up for the life of the scan, and a file
// that never answers holds one of its download slots for good (six such files stopped a whole load at 0.01 M splats).
// This keeper watches the loader's own sets once in a while and:
//   - asks a failed file again after a pause that grows (STREAM_RETRY_PAUSES_MS), the engine's own immediate retry off;
//   - takes a file with no answer after STREAM_STALL_MS out of its download slot and counts it as failed (a late answer
//     is still used);
//   - after the last pause keeps the file given up and counts it, until retryAll() (the line's Try again press).
// It reaches the loader's fields by name (renderer.ts header: checked by name, left alone where the engine lacks them).

/** The parts of the engine's GSplatAssetLoader this reads and writes (internal, playcanvas 2.23.2). */
export interface StreamLoaderView {
    maxRetries?: number;
    _failed?: Set<string>;
    _currentlyLoading?: Set<string>;
    _loadQueue?: Map<string, number>;
    _processQueue?: () => void;
    unload?: (url: string) => void;
    getResource?: (url: string) => unknown;
}

/**
 * The pauses before a failed file is asked again, ms: the n-th failure waits the n-th pause; after the last the file
 * is given up. An estimate (docs/wip/loadq.md design G3), not measured.
 */
export const STREAM_RETRY_PAUSES_MS: readonly number[] = [500, 1000, 2000, 4000, 8000];

/**
 * A file asked this long ago without an answer is taken out of its download slot and counted as failed, ms. An
 * estimate: the slowest file of a fault-free Wroclaw load on this PC is measured in docs/wip/loadq.md (slowestMs).
 */
export const STREAM_STALL_MS = 20000;

/** Files that arrived within this window give the rate the line's time to go is computed from, ms. */
export const STREAM_RATE_WINDOW_MS = 5000;

/** What the keeper knows now (the detail line and the test hook read it). */
export interface StreamStats {
    /** files waiting for a download slot */
    queued: number;
    /** files downloading now */
    loading: number;
    /** files waiting for their pause before they are asked again */
    retrying: number;
    /** files given up after the last pause (retryAll asks them again) */
    givenUp: number;
    /** queued + loading + retrying: what is still to come */
    pending: number;
    /** failures counted (a stalled file counts too) */
    failures: number;
    /** files taken out of their slot for no answer */
    stalls: number;
    /** files asked again after a pause */
    retries: number;
    /** files that arrived */
    done: number;
    /** the longest a file that arrived took, ms */
    slowestMs: number;
    /** files that arrived per second over the last STREAM_RATE_WINDOW_MS */
    filesPerSec: number;
}

/** The loader's fields this needs and does not find (an engine without them is left alone). */
export function streamKeeperMissing(l: StreamLoaderView | null | undefined): string[] {
    if (!l) return ['loader'];
    const miss: string[] = [];
    if (!(l._failed instanceof Set)) miss.push('_failed');
    if (!(l._currentlyLoading instanceof Set)) miss.push('_currentlyLoading');
    if (!(l._loadQueue instanceof Map)) miss.push('_loadQueue');
    if (typeof l.unload !== 'function') miss.push('unload');
    return miss;
}

export class StreamKeeper {
    private readonly started = new Map<string, number>();
    private readonly tries = new Map<string, number>();
    private readonly waitUntil = new Map<string, number>();
    private readonly given = new Set<string>();
    private arrivals: number[] = [];
    private queued = 0;
    private loading = 0;
    private failures = 0;
    private stalls = 0;
    private retries = 0;
    private done = 0;
    private slowestMs = 0;
    private lastNow = 0;
    private loader: StreamLoaderView | null = null;

    constructor(private readonly pauses: readonly number[] = STREAM_RETRY_PAUSES_MS, private readonly stallMs = STREAM_STALL_MS) {}

    /** Look at the loader at time `now` (ms) and act on failed and stalled files. Nothing happens where it lacks a field. */
    tick(now: number, l: StreamLoaderView | null | undefined): void {
        if (!l || streamKeeperMissing(l).length > 0) return;
        const loading = l._currentlyLoading as Set<string>;
        const failed = l._failed as Set<string>;
        if (this.loader !== l) {
            this.loader = l;
            // the pauses here replace the engine's immediate retries
            if (typeof l.maxRetries === 'number') l.maxRetries = 0;
        }
        this.lastNow = now;
        // arrived or failed since the last look
        for (const [url, t0] of this.started) {
            if (loading.has(url)) continue;
            this.started.delete(url);
            if (failed.has(url)) continue;
            this.done++;
            this.slowestMs = Math.max(this.slowestMs, now - t0);
            this.arrivals.push(now);
            this.tries.delete(url);
        }
        for (const url of loading) if (!this.started.has(url)) this.started.set(url, now);
        // no answer for too long: out of the slot, counted as failed (a late answer still lands: getResource below)
        let freed = false;
        for (const [url, t0] of this.started) {
            if (now - t0 < this.stallMs) continue;
            this.started.delete(url);
            loading.delete(url);
            failed.add(url);
            this.stalls++;
            freed = true;
        }
        if (freed) l._processQueue?.call(l);
        // a new failure: wait its pause, or give up after the last
        for (const url of failed) {
            if (this.given.has(url) || this.waitUntil.has(url)) continue;
            const n = (this.tries.get(url) ?? 0) + 1;
            this.tries.set(url, n);
            this.failures++;
            if (n > this.pauses.length) this.given.add(url);
            else this.waitUntil.set(url, now + this.pauses[n - 1]);
        }
        // the pause is over: ask again (the engine asks the file anew the next time its view needs it)
        for (const [url, at] of this.waitUntil) {
            if (!failed.has(url)) { this.waitUntil.delete(url); continue; }
            if (now < at) continue;
            this.waitUntil.delete(url);
            failed.delete(url);
            if (l.getResource?.(url)) { this.tries.delete(url); continue; }
            this.retries++;
            l.unload!(url);
        }
        for (const url of this.given) if (!failed.has(url)) { this.given.delete(url); this.tries.delete(url); }
        const from = now - STREAM_RATE_WINDOW_MS;
        if (this.arrivals.length > 0 && this.arrivals[0] < from) this.arrivals = this.arrivals.filter((t) => t >= from);
        this.queued = (l._loadQueue as Map<string, number>).size;
        this.loading = loading.size;
    }

    /** Every file given up is asked again, with its tries from the start (the line's Try again press). */
    retryAll(): number {
        const l = this.loader;
        if (!l || streamKeeperMissing(l).length > 0) return 0;
        let n = 0;
        for (const url of this.given) {
            this.tries.delete(url);
            l._failed!.delete(url);
            l.unload!(url);
            n++;
        }
        this.given.clear();
        return n;
    }

    stats(): StreamStats {
        const retrying = this.waitUntil.size;
        const span = Math.min(STREAM_RATE_WINDOW_MS, Math.max(1, this.lastNow - (this.arrivals[0] ?? this.lastNow)));
        return {
            queued: this.queued,
            loading: this.loading,
            retrying,
            givenUp: this.given.size,
            pending: this.queued + this.loading + retrying,
            failures: this.failures,
            stalls: this.stalls,
            retries: this.retries,
            done: this.done,
            slowestMs: this.slowestMs,
            filesPerSec: this.arrivals.length > 1 ? (this.arrivals.length * 1000) / Math.max(span, 1000) : 0
        };
    }
}
