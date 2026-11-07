// The small browser facts the recorder leans on, each behind a function so Node tests can replace it
// (docs/wip/v12-plan.md section 4.3 step 2): a lock on a session's folder, the storage the browser will keep, how
// much room is left, and a spoken line that never holds anything up.
import type { SpeechLine, SonicRuntime } from '@shramko/sonic-fpv';

const LOCK_PREFIX = 'gsfpv-sonic-session:';

type Locks = {
    request(name: string, options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean }, callback: (lock: object | null) => Promise<unknown> | unknown): Promise<unknown>;
};

const locks = (): Locks | null => (globalThis.navigator as (Navigator & { locks?: Locks }) | undefined)?.locks ?? null;

/**
 * Holds an exclusive lock on a session while it is being written. Another tab that looks for unfinished sessions to offer
 * (the resume scan) finds this one locked and leaves it alone: a session being recorded is not a crashed one.
 * Resolves with the function that lets the lock go; a no-op where there are no Web Locks.
 */
export function holdSessionLock(id: string): Promise<() => void> {
    const l = locks();
    if (l === null) return Promise.resolve(() => undefined);
    return new Promise((resolveHeld) => {
        void l.request(LOCK_PREFIX + id, { mode: 'exclusive' }, () => new Promise<void>((release) => resolveHeld(() => release())));
    });
}

/** Is another tab holding this session's lock (so it is being recorded right now)? False where there are no Web Locks. */
export async function sessionIsLocked(id: string): Promise<boolean> {
    const l = locks();
    if (l === null) return false;
    return (await l.request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => lock === null)) === true;
}

/** Asks the browser to keep this site's storage (navigator.storage.persist); null where it cannot say. May show a prompt in Firefox. */
export async function persistStorage(): Promise<boolean | null> {
    const sm = (globalThis.navigator as (Navigator & { storage?: StorageManager }) | undefined)?.storage;
    if (sm === undefined || typeof sm.persist !== 'function') return null;
    try {
        if (typeof sm.persisted === 'function' && (await sm.persisted())) return true;
        return await sm.persist();
    } catch {
        return null;
    }
}

/** Bytes this site may still write (quota minus usage), or null where the browser does not say. */
export async function freeBytes(): Promise<number | null> {
    const sm = (globalThis.navigator as (Navigator & { storage?: StorageManager }) | undefined)?.storage;
    if (sm === undefined || typeof sm.estimate !== 'function') return null;
    try {
        const e = await sm.estimate();
        return typeof e.quota === 'number' && typeof e.usage === 'number' ? Math.max(0, e.quota - e.usage) : null;
    } catch {
        return null;
    }
}

/**
 * A spoken line that holds nothing up: the engine speaks it (and captions it) when it can, and a refusal or a missing
 * engine is ignored. The recorder never waits for speech to end (a hidden tab may never finish a line), except where the
 * survey needs the order, and there it uses the returned promise with its own time limit.
 */
export function sayVia(runtime: () => SonicRuntime | null): (line: SpeechLine, options?: { readonly interrupt?: boolean }) => Promise<void> {
    return async (line, options) => {
        const rt = runtime();
        if (rt === null) return;
        try {
            await rt.engine.say(line, options);
        } catch {
            // no voice on this system: the captions are the engine's business
        }
    };
}
