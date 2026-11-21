// Which scan load still counts (design voxux4, part vox4 for ux4b's cancel of a scene load). Pure, no engine and no DOM.
//
// renderer.ts loadSplat() takes a ticket when it starts; unloadSplat() (a scene switch, or the pilot cancelling a load) invalidates every
// ticket handed out so far, and a newer loadSplat() makes the older ticket stale as well. When the engine's asset of a stale ticket
// reports 'load' or 'error', the renderer frees that asset and rejects with SplatLoadCancelled instead of adding an entity over the next
// scan.

/** The rejection of a loadSplat() whose load was cancelled (unloadSplat or a newer loadSplat came first). */
export class SplatLoadCancelled extends Error {
    constructor(what = 'scan') {
        super(`loading the ${what} was cancelled`);
        this.name = 'SplatLoadCancelled';
    }
}

/** Is this error the cancel of a load (not a failure to report)? */
export function isSplatLoadCancelled(e: unknown): e is SplatLoadCancelled {
    return e instanceof SplatLoadCancelled;
}

/** Tickets of scan loads: only the latest one handed out since the last invalidate() is current. */
export class SplatLoadGuard {
    private generation = 0;

    /** A load starts: its ticket. Every earlier ticket is stale from now on. */
    begin(): number {
        return ++this.generation;
    }

    /** Every ticket handed out so far becomes stale (the scan is unloaded). */
    invalidate(): void {
        this.generation++;
    }

    /** The load of this ticket no longer counts. */
    isStale(ticket: number): boolean {
        return ticket !== this.generation;
    }
}
