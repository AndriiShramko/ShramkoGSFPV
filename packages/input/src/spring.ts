// Whether a stick springs back to its centre, read from what it did (lane connect, docs/wip/connect.md; the owner's
// words of 2026-11-13: "whatever controller he has: he plugs it in, goes through the setup at once and flies").
// A spring stick, let go away from its middle, snaps back to the middle within a fraction of a second and stays there,
// on the same value every time, from above and from below. A stick with no spring (an FPV radio's throttle) stays where
// the hand left it; a hand that parks it near the middle neither snaps it there nor finds the same value from both
// sides. The wizard watches every channel with this (calib.ts) and keeps the throttle's verdict as its rest, so a
// pilot who held the throttle down at "Let go" (the screen asks for it) does not turn a spring stick into "from zero".
// Pure: no clock of its own, no DOM.

export const SPRING = {
    /** an excursion: the stick beyond this part of its half range from the middle */
    AWAY: 0.5,
    /** back within this of the middle: the wizard's CENTRE_TOL (calib.ts TUNING) */
    NEAR: 0.15,
    /**
     * From the last moment beyond AWAY to the first inside NEAR. The owner's DJI RC 2 took 16 to 95 ms (59 returns of
     * four sticks in its record, measured in docs/wip/connect.md); 200 ms is twice the longest, an estimate of a
     * spring's snap on other controllers.
     */
    RETURN_MS: 200,
    /** then still within this for STILL_MS: the wizard's own stillness (TUNING.STILL_TOL, STILL_MS) */
    STILL_TOL: 0.04,
    STILL_MS: 500,
    /**
     * Every return lands within this of the others (in halves of the range). The owner's RC 2 rests on exactly 1024
     * (0 spread); the DJI FPV Remote Controller 3's rest offsets of 11 and 8 of 660 are constant per stick. An estimate.
     */
    SAME_TOL: 0.03,
    /** the channel must have been seen to travel at least this far (in the wizard's units) before a return counts */
    MIN_HALF: 0.5
} as const;

export class SpringWatch {
    private side = 0;
    private awayT = NaN;
    private candT = NaN;
    private candV = NaN;
    private candSum = 0;
    private candN = 0;
    // landings kept raw: the middle and the range known at a landing may still grow (a stir short on one end, completed
    // by the throttle step later); the spread is judged with the last range seen (review CN-1)
    private lo = Infinity;
    private hi = -Infinity;
    private half = NaN;
    /** returns seen from above and from below the middle */
    above = 0;
    below = 0;

    /**
     * One sample: the raw value `x` at time `t` (ms), the channel's middle and half range as known now. A return is
     * counted when the stick, after an excursion past AWAY, is inside NEAR within RETURN_MS and then still for STILL_MS.
     */
    update(x: number, t: number, mid: number, half: number): void {
        if (!Number.isFinite(x) || !Number.isFinite(t) || !(half >= SPRING.MIN_HALF)) return;
        this.half = half;
        const off = (x - mid) / half;
        const a = Math.abs(off);
        if (a >= SPRING.AWAY) {
            this.side = off > 0 ? 1 : -1;
            this.awayT = t;
            this.candT = NaN;
            return;
        }
        if (this.side === 0) return;
        if (a > SPRING.NEAR) {
            // between the middle and an excursion: a hand moving it, not a snap
            if (!Number.isNaN(this.candT)) this.side = 0;
            this.candT = NaN;
            return;
        }
        if (Number.isNaN(this.candT)) {
            if (t - this.awayT > SPRING.RETURN_MS) { this.side = 0; return; }
            this.candT = t;
            this.candV = x;
            this.candSum = 0;
            this.candN = 0;
        } else if (Math.abs(x - this.candV) > SPRING.STILL_TOL) {
            // settling: the still window starts again, still a snap as long as it began inside RETURN_MS
            this.candT = t;
            this.candV = x;
            this.candSum = 0;
            this.candN = 0;
        }
        this.candSum += x;
        this.candN++;
        if (t - this.candT >= SPRING.STILL_MS) {
            const v = this.candSum / this.candN;
            if (v < this.lo) this.lo = v;
            if (v > this.hi) this.hi = v;
            if (this.side > 0) this.above++;
            else this.below++;
            this.side = 0;
            this.candT = NaN;
        }
    }

    /** Returns from both sides, all on the same value: the stick springs to its centre. */
    get springs(): boolean {
        return this.above > 0 && this.below > 0 && (this.hi - this.lo) / this.half <= SPRING.SAME_TOL;
    }
}
