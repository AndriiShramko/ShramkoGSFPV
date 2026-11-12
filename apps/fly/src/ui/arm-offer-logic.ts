// When the arm card offers "Fly with the stick in the centre" (lane center-throttle, docs/wip/center-throttle.md 2 (a);
// the owner's words of 2026-11-12: a DJI controller's left stick rests in the centre and the pilot does not know to lower
// it). Pure, so app-centre-throttle-ui.test.ts drives it with a clock.
//
// The offer shows while the controller flies from zero (FPV), the arm gate waits for the throttle ('throttle' block), and
// the mapped throttle (-1 bottom .. 1 top) has stayed within TUNING.STILL_TOL of where it came to rest, within
// TUNING.CENTRE_TOL of the middle, for OFFER_MS. Both tolerances are the calibration wizard's (packages/input calib.ts),
// the same rule RestWatch uses to say "rests in the centre". While it shows, a change of the controller's arm input (an
// arm switch flipped, the DJI start/stop button pressed: ch[4] crosses 0) accepts it, so a pilot with no mouse can take
// it; J does the same from the keyboard (app/builtin/throttle-style.ts).
import { TUNING } from '@gsfpv/input';
import type { ArmBlock } from '@gsfpv/input';

/**
 * How long the throttle rests in the centre before the offer: an estimate ("about 3 seconds", the lane's design), long
 * enough that a pilot lowering the stick right away never sees it; not measured on a person.
 */
export const OFFER_MS = 3000;

export interface OfferInput {
    /** the style flying now: the offer is only for 'zero' */
    style: 'centred' | 'zero' | null;
    block: ArmBlock;
    /** mapped throttle, -1 bottom .. 1 top */
    throttle: number;
    /** mapped arm input, > 0 on */
    arm: number;
    /** page time, ms */
    now: number;
}

export class ArmOffer {
    private from = Number.NaN;
    private since = 0;
    private shown = false;
    private armOn: boolean | null = null;

    /** `show`: the offer is on the card; `accept`: the controller's arm input changed while it was shown. */
    update(i: OfferInput): { show: boolean; accept: boolean } {
        const on = i.arm > 0;
        const armChanged = this.armOn !== null && on !== this.armOn;
        this.armOn = on;
        const accept = this.shown && armChanged;
        const v = i.throttle;
        if (!Number.isFinite(v) || Number.isNaN(this.from) || Math.abs(v - this.from) > TUNING.STILL_TOL || i.now < this.since) {
            this.from = v;
            this.since = i.now;
        }
        const waits = i.style === 'zero' && i.block === 'throttle';
        const centred = Number.isFinite(v) && Math.abs(v) <= TUNING.CENTRE_TOL;
        this.shown = waits && centred && i.now - this.since >= OFFER_MS && !accept;
        return { show: this.shown, accept };
    }

    reset(): void {
        this.from = Number.NaN;
        this.shown = false;
        this.armOn = null;
    }
}
