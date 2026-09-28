// The pause stack (docs/architecture-v03.md 1.1): each screen holds the flight paused for its own
// reason, and the flight runs again only when every reason is released. v0.2 shared one holder
// between the pause menu and every panel it opened, so one close could resume the flight while
// another screen was still up. No DOM and no clock here: `apply` gets the result, and the shell
// hands it to FlightSession.pause, i.e. to the SimClock (sim time stands still while paused).

export class PauseStack<R extends string> {
    private held = new Set<R>();
    private apply: (on: boolean, reasons: readonly R[]) => void;

    /** `apply(on, reasons)` runs after every change of the held reasons (never for a repeat). */
    constructor(apply: (on: boolean, reasons: readonly R[]) => void) {
        this.apply = apply;
    }

    get paused(): boolean {
        return this.held.size > 0;
    }

    /** The reasons held now, oldest first. */
    get reasons(): readonly R[] {
        return [...this.held];
    }

    /** Hold the flight paused for `reason`; holding a reason already held changes nothing. */
    hold(reason: R): void {
        if (this.held.has(reason)) return;
        this.held.add(reason);
        this.apply(true, this.reasons);
    }

    /** Release `reason`; the flight runs again when no reason is left. */
    release(reason: R): void {
        if (!this.held.delete(reason)) return;
        this.apply(this.held.size > 0, this.reasons);
    }
}
