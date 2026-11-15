// How long the top bar's line keeps what it was told (lane editor3, train 3 I2, the lead's decision D6): a refusal (a refused
// Save, a new gate that is red) stays until the pilot's next action, never on a timer; what an edit did goes back to the
// standing hint after DONE_MS. The next action is a key or a press that came AFTER the refusal was told (the press that
// caused a refusal does not clear it). Pure: the bar gives the show function and the event times.

/** what an edit did stays this long, ms (as before I2: 3 s) */
export const DONE_MS = 3000;

export class LineHold {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private holding = false;
    private toldAt = -Infinity;

    /** show(text, refused): the line's text; null: the standing hint */
    constructor(private readonly show: (text: string | null, refused: boolean) => void) {}

    /** `now`: the page time of the telling (performance.now(), the clock of Event.timeStamp) */
    tell(text: string, refused: boolean, now: number): void {
        this.stop();
        this.show(text, refused);
        this.holding = refused;
        this.toldAt = now;
        if (!refused) this.timer = setTimeout(() => { this.timer = null; this.show(null, false); }, DONE_MS);
    }

    /** the pilot acted (a key down, a press) at `eventTime`; a refusal told after that event started stays */
    acted(eventTime: number): void {
        if (!this.holding || eventTime <= this.toldAt) return;
        this.holding = false;
        this.show(null, false);
    }

    /** a refusal is on the line */
    get held(): boolean {
        return this.holding;
    }

    /** the line was set by something else (adding, flying): no refusal held, no timer */
    reset(): void {
        this.stop();
        this.holding = false;
    }

    stop(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }
}
