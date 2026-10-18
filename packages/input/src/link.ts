// How a device's reports reach the page: a meter of the gaps between its new samples. No DOM and no
// clock of its own (the caller passes page times in, so tests drive it with any timeline).
//
// Why it exists (v0.9 lane E, the owner's item 12): a radio flown over Bluetooth feels late, and the
// pilot cannot tell the link from the simulator. A USB radio reports every 1-10 ms; a Bluetooth LE
// joystick every 7-30 ms or in bunches (several reports in one radio event, then a pause). The meter
// does not know which transport it is looking at: it says how the reports arrive, and what it says
// about a slow one must hold for a cable as well. The page
// cannot see the link's own queue, but it can see how often a NEW value arrives, and that is the
// part of the delay the cadence itself adds: the newest value is on average `ageMs` old when a frame
// or the physics looks at it. docs/wip/v09-e.md has the numbers and the sources.
//
// What counts as a sample: a report the device sent (WebHID: every input report; Gamepad API: a new
// Gamepad.timestamp or a value that moved). The times are the ones the source stamps them with.
// Two kinds of time are left out so the verdict is about the LINK, not about the rest:
//   - a silence longer than IDLE_MS: a device that reports only changes (the DJI controller) is idle
//     with the sticks still, and one that is gone is not a slow link;
//   - the page's own stalls (`stall`): while the main thread draws a heavy scan, WebHID events pile
//     up and are delivered together, which looks exactly like a bursty link but is not one.

/** The numbers the verdict and the notes use. */
export const LINK = {
    /** the last this many ms of samples are measured */
    WINDOW_MS: 3000,
    /** a gap longer than this is the device idle or gone, not a slow link */
    IDLE_MS: 250,
    /** fewer gaps than this and nothing is said */
    MIN_GAPS: 20,
    /**
     * a mean gap above this (below 67 reports / s) is a slow link. Not 10 ms (review 2026-10-18): that is
     * exactly the report period of a 100 Hz wired joystick (HID bInterval 10), where timer noise alone
     * decided "slow" (14 of 40 runs of the timeline), and the page cannot tell a cable from Bluetooth. 15 ms
     * is clear of every wired rate (1000, 500, 250, 125, 100 Hz) and of a healthy BLE link (7.5-15 ms
     * connection intervals; 11.25 ms is Apple's documented best case for BLE HID), and it is where the
     * cadence itself is a delay worth a note: the newest report is 7.5 ms old on average.
     */
    SLOW_MS: 15,
    /** a gap shorter than this share of the mean came together with the report before it */
    BUNCH_FRAC: 0.25,
    /** this share of such gaps, with real pauses between the bunches, is a bursty link */
    BUNCH_SHARE: 0.25,
    /** a pause at least this long ends a bunch */
    PAUSE_MS: 20,
    /** this many pauses in the window make the bunching a habit, not one hiccup */
    PAUSES: 3,
    /** a sample that comes within this long after a page stall was delivered late by the page, not by the link (WebHID events queue up behind a stall and run right after it) */
    STALL_SLACK_MS: 8,
    /** samples kept (a 1000 Hz device fills the window with 3000) */
    CAP: 4096,
    /** page stalls kept (a heavy scan stalls the page on most frames: 3 s of 30 fps is 90) */
    STALLS: 256
} as const;

export type LinkVerdict = 'unknown' | 'ok' | 'slow' | 'bursty';

/** What the check screen and F3 say about a device's reports. */
export interface LinkStats {
    /** gaps measured (samples minus the idle gaps and the page's own stalls) */
    n: number;
    /** reports per second while the device was reporting (1000 / meanMs) */
    hz: number;
    /** the average gap between reports, ms */
    meanMs: number;
    /** the spread of the gaps (standard deviation), ms */
    jitterMs: number;
    /** the longest gap measured, ms */
    maxGapMs: number;
    /** at a random moment the newest report is this old on average, ms (sum of squares / 2 sum: half the gap for a steady device, more when it bunches) */
    ageMs: number;
    /** the share of gaps that came together with the report before (0..1) */
    bunched: number;
    verdict: LinkVerdict;
}

const EMPTY: LinkStats = { n: 0, hz: 0, meanMs: 0, jitterMs: 0, maxGapMs: 0, ageMs: 0, bunched: 0, verdict: 'unknown' };

export class LinkMeter {
    private t = new Float64Array(LINK.CAP);
    private head = 0;
    private count = 0;
    private stalls = new Float64Array(LINK.STALLS * 2);
    private stallN = 0;
    private gaps = new Float64Array(LINK.CAP);
    private slack: number;

    /**
     * `stallSlackMs`: how long after a stall a sample still counts as delivered by it. A source whose
     * times are the device's own (the Gamepad API's timestamps: the browser's thread took the report
     * when it arrived, whatever the page was doing) passes 0; one timed by the page (WebHID's
     * event.timeStamp is when the page ran the event) keeps the default.
     */
    constructor(stallSlackMs: number = LINK.STALL_SLACK_MS) {
        this.slack = stallSlackMs;
    }

    /** A new sample at page time `t` ms. A time before the previous sample's is not a sample (non-monotonic stamps). */
    note(t: number): void {
        if (!Number.isFinite(t)) return;
        if (this.count > 0 && t < this.t[(this.head + this.count - 1) % LINK.CAP]) return;
        if (this.count === LINK.CAP) {
            this.head = (this.head + 1) % LINK.CAP;
            this.count--;
        }
        this.t[(this.head + this.count) % LINK.CAP] = t;
        this.count++;
    }

    /** The page's main thread was busy from `t0` to `t1` ms: reports delivered then were late because of the page, not the link. */
    stall(t0: number, t1: number): void {
        if (!(t1 > t0)) return;
        if (this.stallN === LINK.STALLS) {
            this.stalls.copyWithin(0, 2);
            this.stallN--;
        }
        this.stalls[this.stallN * 2] = t0;
        this.stalls[this.stallN * 2 + 1] = t1;
        this.stallN++;
    }

    reset(): void {
        this.head = 0;
        this.count = 0;
        this.stallN = 0;
    }

    /** The window that ends at `now` (page ms). */
    stats(now: number): LinkStats {
        const from = now - LINK.WINDOW_MS;
        let n = 0;
        let sum = 0;
        let sumSq = 0;
        let max = 0;
        let prev = NaN;
        for (let k = 0; k < this.count; k++) {
            const t = this.t[(this.head + k) % LINK.CAP];
            if (t < from) continue;
            if (!Number.isNaN(prev)) {
                const g = t - prev;
                if (g <= LINK.IDLE_MS && !this.stalled(t)) {
                    this.gaps[n++] = g;
                    sum += g;
                    sumSq += g * g;
                    if (g > max) max = g;
                }
            }
            prev = t;
        }
        if (n < LINK.MIN_GAPS || sum <= 0) return { ...EMPTY, n };
        const mean = sum / n;
        const jitter = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
        let bunched = 0;
        let pauses = 0;
        for (let i = 0; i < n; i++) {
            if (this.gaps[i] < mean * LINK.BUNCH_FRAC) bunched++;
            if (this.gaps[i] >= LINK.PAUSE_MS) pauses++;
        }
        const share = bunched / n;
        const verdict: LinkVerdict = share >= LINK.BUNCH_SHARE && pauses >= LINK.PAUSES ? 'bursty' : mean > LINK.SLOW_MS ? 'slow' : 'ok';
        return { n, hz: 1000 / mean, meanMs: mean, jitterMs: jitter, maxGapMs: max, ageMs: sumSq / (2 * sum), bunched: share, verdict };
    }

    /** A sample at `t` that the page's own stall delivered late: it ends a stall, or comes shortly after one. */
    private stalled(t: number): boolean {
        for (let i = this.stallN - 1; i >= 0; i--) {
            const a = this.stalls[i * 2];
            const b = this.stalls[i * 2 + 1];
            if (t >= a && t <= b + this.slack) return true;
            if (b + this.slack < t - LINK.WINDOW_MS) break;
        }
        return false;
    }
}
