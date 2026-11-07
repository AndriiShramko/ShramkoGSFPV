// The clock of a recording (docs/wip/v12-plan.md section 4.3 step 2). Everything in a package is stamped on one clock:
// t = 0 is the moment the recording starts, ms of the page's own clock (performance.now) from there on, running on
// through pauses; voice.webm starts voiceOffsetMs after t = 0 on this clock (manifest.clock).
//
// The recorder stamps its own events from now(). Samples and events that come over the bus carry the host's `t`
// (FlightSample.t, SessionEvent.t: the flight lane's page clock, whose origin this lane does not know), so they are
// carried onto the recording clock: the first sample after the start says which host time is t = 0 here. A host
// clock that jumps (a reset, a new session of the flight) shows as a sample whose mapped time is far from its
// arrival time; the mapping is taken again from that sample and the jump is counted, so time never runs backwards
// in the package (the reader refuses a flight log whose time goes back).

/** A mapped time further than this from the arrival time says the host clock jumped, ms. */
export const CLOCK_JUMP_MS = 500;

export class SessionClock {
    private startedAt: number | null = null;
    /** the host time that is t = 0 of the recording, or null before the first sample after the start */
    private base: number | null = null;
    private jumpCount = 0;

    /** `nowMs`: the page clock (performance.now). */
    constructor(private readonly nowMs: () => number) {}

    /** t = 0 is now. */
    begin(): void {
        this.startedAt = this.nowMs();
        this.base = null;
        this.jumpCount = 0;
    }

    get running(): boolean {
        return this.startedAt !== null;
    }

    /** How many times the host clock was found to jump. */
    get jumps(): number {
        return this.jumpCount;
    }

    /** The recording clock now, ms (0 before begin). */
    now(): number {
        return this.startedAt === null ? 0 : Math.max(0, this.nowMs() - this.startedAt);
    }

    /** The page clock now (performance.now) at recording time `t`: where a recorded moment lies on the page's own clock. */
    pageTime(t: number): number {
        return (this.startedAt ?? 0) + t;
    }

    /**
     * A host-stamped time on the recording clock. Before the first sample has said what the host's t = 0 is, the arrival
     * time stands in (events cannot be placed better). Never negative.
     */
    fromHost(hostT: number): number {
        if (this.base === null || !Number.isFinite(hostT)) return this.now();
        return Math.max(0, hostT - this.base);
    }

    /**
     * Takes a sample's host time as it arrives: fixes the mapping at the first one, and again when the mapped time is
     * further than CLOCK_JUMP_MS from the arrival time. Returns the sample's time on the recording clock.
     */
    sample(hostT: number): number {
        const arrival = this.now();
        if (!Number.isFinite(hostT)) return arrival;
        if (this.base === null) {
            this.base = hostT - arrival;
            return arrival;
        }
        const mapped = hostT - this.base;
        if (Math.abs(mapped - arrival) > CLOCK_JUMP_MS) {
            this.base = hostT - arrival;
            this.jumpCount++;
            return arrival;
        }
        return Math.max(0, mapped);
    }
}
