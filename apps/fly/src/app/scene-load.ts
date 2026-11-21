/**
 * Cancel a scene that is loading (train 4, lane ux4b; the owner: "I picked the wrong scene and cannot
 * cancel it"). One load of a scene is one LoadRun: its AbortController's signal goes to every fetch,
 * every await of the load (abortable) and every walls bake, so a cancel stops them all at once.
 * Pure: no DOM, no engine (tools/bench/test/scene-load.test.ts).
 */

/** Who stopped a load: the pilot pressed Cancel, or a new pick (or key N) replaced it. */
export type CancelWhy = 'pilot' | 'replaced';

/** The error every awaited step of a cancelled load rejects with: not a failure, never reported as one. */
export class LoadCancelled extends Error {
    readonly why: CancelWhy | null;
    constructor(why: CancelWhy | null = null) {
        super('the scene load was cancelled');
        this.name = 'LoadCancelled';
        this.why = why;
    }
}

function whyOf(s: AbortSignal): CancelWhy | null {
    const r: unknown = s.reason;
    return r instanceof LoadCancelled ? r.why : null;
}

/** The error of an aborted signal: its own LoadCancelled, else a new one. */
export function cancelledBy(s: AbortSignal): LoadCancelled {
    return s.reason instanceof LoadCancelled ? s.reason : new LoadCancelled(whyOf(s));
}

/** True when e is the end of a cancelled load (LoadCancelled, or anything at all once the signal aborted). */
export function isCancelled(e: unknown, s?: AbortSignal | null): boolean {
    return e instanceof LoadCancelled || !!s?.aborted;
}

/**
 * p, but rejected with LoadCancelled at once when s aborts (the work behind p may still finish: its
 * result is then dropped; the owner of that work frees it, e.g. the renderer's splat-load guard).
 */
export function abortable<P extends Promise<unknown>>(p: P, s?: AbortSignal | null): Promise<Awaited<P>> {
    type T = Awaited<P>;
    if (!s) return p as Promise<T>;
    if (s.aborted) {
        p.catch(() => { /* dropped */ });
        return Promise.reject(cancelledBy(s));
    }
    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(cancelledBy(s));
        s.addEventListener('abort', onAbort, { once: true });
        p.then(
            (v) => { s.removeEventListener('abort', onAbort); resolve(v as T); },
            (e) => { s.removeEventListener('abort', onAbort); reject(e); }
        );
    });
}

let lastRunId = 0;

/** One load of a scene: its signal, why it was cancelled (null: it was not), and when it settled. */
export class LoadRun {
    readonly id: number;
    readonly ctl = new AbortController();
    why: CancelWhy | null = null;
    /** resolves once the load's work ended, whichever way (watch) */
    readonly settled: Promise<void>;
    private ended = false;
    private endIt!: () => void;

    constructor() {
        this.id = ++lastRunId;
        this.settled = new Promise<void>((r) => { this.endIt = r; });
    }

    get signal(): AbortSignal {
        return this.ctl.signal;
    }

    /** the load has ended (done, failed or cancelled and unwound) */
    get done(): boolean {
        return this.ended;
    }

    /** Stop the load; a load that already ended or was cancelled stays as it is. */
    cancel(why: CancelWhy): void {
        if (this.ended || this.why !== null) return;
        this.why = why;
        this.ctl.abort(new LoadCancelled(why));
    }

    /** The load's work: settled resolves when p does, whichever way. */
    watch<T>(p: Promise<T>): Promise<T> {
        const end = (): void => { this.ended = true; this.endIt(); };
        p.then(end, end);
        return p;
    }
}

/**
 * The page's one scene load at a time (app/scene-host.ts). next() starts a new run and cancels the run before it
 * ('replaced') at once; the new run waits for `prev.settled` before it touches the renderer, so two loads never
 * share it. A third pick while the second still waits cancels the second the same way: the last pick wins.
 */
export class LoadSlot {
    private cur: LoadRun | null = null;

    /** the run started last (it may have ended) */
    get current(): LoadRun | null {
        return this.cur;
    }

    /** a load is under way: started and not ended */
    get loading(): boolean {
        return !!this.cur && !this.cur.done;
    }

    /** A new run; `prev`: the run it replaced, still unwinding (await its settled first), or null. */
    next(): { run: LoadRun; prev: LoadRun | null } {
        const old = this.cur;
        const run = new LoadRun();
        this.cur = run;
        if (!old || old.done) return { run, prev: null };
        old.cancel('replaced');
        return { run, prev: old };
    }

    /** The pilot's Cancel: the run under way stops; false when none was. */
    cancel(): boolean {
        if (!this.loading || this.cur!.why !== null) return false;
        this.cur!.cancel('pilot');
        return true;
    }
}

/**
 * What follows a cancelled load. 'picker': the pilot pressed Cancel, so the scene list opens (closing it brings
 * back the scene flown before); 'replace': a new pick or key N stopped it, and that new load goes on at once.
 * Before train 4 neither happened: a pick during a load was ignored.
 */
export function afterCancel(why: CancelWhy): 'picker' | 'replace' {
    return why === 'pilot' ? 'picker' : 'replace';
}
