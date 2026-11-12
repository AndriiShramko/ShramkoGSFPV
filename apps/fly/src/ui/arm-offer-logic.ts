// When the arm card offers "Fly with the stick in the centre" (lane center-throttle, docs/wip/center-throttle.md 2 (a);
// the owner's words of 2026-11-12: a DJI controller's left stick rests in the centre and the pilot does not know to lower
// it). Pure, so app-centre-throttle-ui.test.ts drives it with a clock.
//
// The offer shows while the controller flies from zero (FPV), the arm gate waits for the throttle ('throttle' block), and
// the mapped throttle (-1 bottom .. 1 top) has stayed within TUNING.STILL_TOL of where it came to rest, within
// TUNING.CENTRE_TOL of the middle, for OFFER_MS. Both tolerances are the calibration wizard's (packages/input calib.ts),
// the same rule RestWatch uses to say "rests in the centre". While it is on the screen, a press of the controller's own
// toggle button (the DJI start/stop button; Controls.armPresses counts it before the gate drops the refused press, review
// M2) accepts it, so a pilot with no mouse can take it; J does the same from the keyboard (app/builtin/throttle-style.ts).
// A level arm switch never takes it (review M1): an FPV pilot flips it to arm, and a throttle with no spring can sit in
// the middle after a crash; nor a press while the card is hidden (H, the pause menu, a screen over it).
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
    /** presses of the controller's latched arm input so far (Controls.armPresses) */
    presses: number;
    /** the controller arms with a toggle button (ArmView.armKind 'toggle'): only then does its press take the offer */
    toggle: boolean;
    /** the card can be read: the HUD text on, no screen or pause menu over it */
    visible: boolean;
    /** Controls.profileGen: another controller starts the offer from nothing */
    profileGen: number;
    /** page time, ms */
    now: number;
}

export class ArmOffer {
    private from = Number.NaN;
    private since = 0;
    private shown = false;
    private presses: number | null = null;
    private gen: number | null = null;

    /** `show`: the offer is on the card; `accept`: the controller's toggle button was pressed while it was seen. */
    update(i: OfferInput): { show: boolean; accept: boolean } {
        if (i.profileGen !== this.gen) {
            this.reset();
            this.gen = i.profileGen;
        }
        const pressed = this.presses !== null && i.presses !== this.presses;
        this.presses = i.presses;
        const accept = this.shown && i.toggle && pressed;
        const v = i.throttle;
        if (!Number.isFinite(v) || Number.isNaN(this.from) || Math.abs(v - this.from) > TUNING.STILL_TOL || i.now < this.since) {
            this.from = v;
            this.since = i.now;
        }
        const waits = i.style === 'zero' && i.block === 'throttle';
        const centred = Number.isFinite(v) && Math.abs(v) <= TUNING.CENTRE_TOL;
        const show = waits && centred && i.now - this.since >= OFFER_MS && !accept;
        this.shown = show && i.visible;
        return { show, accept };
    }

    reset(): void {
        this.from = Number.NaN;
        this.shown = false;
        this.presses = null;
    }
}
