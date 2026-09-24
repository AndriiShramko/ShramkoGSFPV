// Quality governor (phase D): keeps the frame rate at the display's own rate by lowering the
// render scale and the splat budget when frames are missed, and raising them again slowly.
// Pure logic on frame timestamps (no engine, no DOM), so it is tested without a GPU.
//
// A missed frame is an interval longer than 1.5 display periods: at 60 Hz a frame the GPU could
// not finish in time shows up as a 33 ms interval instead of 16.7 ms. The display period itself
// is learned from the shortest intervals seen (a 30 Hz screen stays 30 Hz: that is not "slow").

export interface QualityStep {
    renderScale: number; // backbuffer / CSS pixels * devicePixelRatio
    splatBudgetMillions: number;
}

export const DEFAULT_STEPS: QualityStep[] = [
    { renderScale: 1, splatBudgetMillions: 4 },
    { renderScale: 0.85, splatBudgetMillions: 3 },
    { renderScale: 0.7, splatBudgetMillions: 2.5 },
    { renderScale: 0.6, splatBudgetMillions: 2 },
    { renderScale: 0.5, splatBudgetMillions: 1.5 }
];

export interface GovernorOptions {
    downWindowMs: number; // look this far back before stepping down
    downMissRatio: number; // step down above this share of missed frames
    upWindowMs: number; // a calm period this long before stepping up
    upMissRatio: number; // ... with at most this share of missed frames
}

export const DEFAULT_GOVERNOR: GovernorOptions = { downWindowMs: 1000, downMissRatio: 0.1, upWindowMs: 5000, upMissRatio: 0.01 };

export class FrameGovernor {
    enabled = true;
    step = 0;
    readonly steps: QualityStep[];
    readonly opts: GovernorOptions;
    private last = -1;
    private period = Infinity; // learned display period, ms
    private log: { t: number; missed: boolean }[] = [];
    private dts: { t: number; dt: number }[] = [];
    private sinceSort = 0;
    private lastChange = -Infinity;
    changes = 0;

    constructor(steps: QualityStep[] = DEFAULT_STEPS, opts: GovernorOptions = DEFAULT_GOVERNOR) {
        this.steps = steps;
        this.opts = opts;
    }

    get current(): QualityStep {
        return this.steps[this.step];
    }

    get displayPeriodMs(): number {
        return this.period;
    }

    /** Feed one frame timestamp (ms). Returns the new step when the quality changes, else null. */
    onFrame(t: number): QualityStep | null {
        if (this.last < 0) { this.last = t; return null; }
        const dt = t - this.last;
        this.last = t;
        if (dt <= 0 || dt > 1000) return null; // paused tab, debugger: not a frame-rate signal
        // display period: 5th percentile of the intervals of the last 30 s (re-sorted every 30
        // frames). A 60 -> 30 Hz switch is learned within 30 s; half the frames missed is not.
        this.dts.push({ t, dt });
        while (this.dts.length && t - this.dts[0].t > 30000) this.dts.shift();
        if (this.period === Infinity || ++this.sinceSort >= 30) {
            this.sinceSort = 0;
            const s = this.dts.map((x) => x.dt).sort((a, b) => a - b);
            this.period = s[Math.floor(0.05 * (s.length - 1))];
        }
        this.log.push({ t, missed: dt > 1.5 * this.period });
        while (this.log.length && t - this.log[0].t > this.opts.upWindowMs) this.log.shift();
        if (!this.enabled) return null;
        const since = t - this.lastChange;
        const ratio = (win: number) => {
            let n = 0, m = 0;
            for (let i = this.log.length - 1; i >= 0 && t - this.log[i].t <= win; i--) { n++; if (this.log[i].missed) m++; }
            return n ? m / n : 0;
        };
        if (since >= this.opts.downWindowMs && this.step < this.steps.length - 1 && ratio(this.opts.downWindowMs) > this.opts.downMissRatio) {
            this.step++;
            this.lastChange = t;
            this.changes++;
            return this.current;
        }
        if (since >= this.opts.upWindowMs && this.step > 0 && ratio(this.opts.upWindowMs) <= this.opts.upMissRatio) {
            this.step--;
            this.lastChange = t;
            this.changes++;
            return this.current;
        }
        return null;
    }
}
