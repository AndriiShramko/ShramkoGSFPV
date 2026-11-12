// The throttle style of a radio, gamepad or HID controller (lane center-throttle, docs/wip/center-throttle.md; the
// owner's words of 2026-11-12). Two ways to fly the left stick:
//  - 'centred': the stick springs to the centre (a DJI controller, a gamepad): the centre holds the height, up climbs,
//    down descends, the motors start with the first stick move (apps/fly/src/play/centre-pilot.ts);
//  - 'zero': FPV, the motors start (arming) only with the throttle at the bottom, the stick is the motors' power.
// Automatic by what is measured: where the throttle rests on this connection (RestWatch), else where the wizard saw it
// rest (Profile.throttleRest), else the known table; a rest seen in the centre never overrides a wizard that measured the
// bottom or a parked stick (review M4: an FPV radio's throttle with no spring can sit in the middle for half a second;
// the arm card's offer proposes the centred style then) (a spring-centred throttle, known-devices.ts throttleSprings), else
// 'zero'. The pilot's own choice (Profile.throttleStyle) always wins. Pure: no DOM, no clock of its own.
import { TUNING, classifyThrottleRest } from './calib';
import type { Profile, ThrottleRest, ThrottleStyle } from './calib';
import { knownDevice } from './known-devices';

/** What the throttle's rest says about the style: a stick resting in the middle is a spring stick; anything else flies from zero. */
export function restStyle(r: ThrottleRest): ThrottleStyle {
    return r === 'centre' ? 'centred' : 'zero';
}

/** Why the style is what it is: the pilot chose it, it was seen now, the wizard saw it, the known table says so, or nothing did. */
export type StyleWhy = 'choice' | 'seen' | 'wizard' | 'table' | 'default';

export interface StyleInputs {
    /** the pilot's choice for this controller (Profile.throttleStyle); absent: automatic */
    choice?: ThrottleStyle;
    /** where the throttle was seen resting on this connection (RestWatch), null: not decided yet */
    seen?: ThrottleRest | null;
    /** where the wizard saw it rest (Profile.throttleRest) */
    wizard?: ThrottleRest;
    /** the known controller's throttle springs to the centre (known-devices.ts mapping.throttleSprings) */
    springs?: boolean;
}

export interface ResolvedStyle { style: ThrottleStyle; why: StyleWhy }

/**
 * The style to fly: the pilot's choice, else the rest seen now, else the wizard's rest, else the known table, else 'zero'.
 * A centre seen now does not beat a wizard that measured the bottom or a parked stick: only the safe way (from zero) is
 * taken from half a second of watching against a measurement.
 */
export function resolveStyle(i: StyleInputs): ResolvedStyle {
    if (i.choice === 'centred' || i.choice === 'zero') return { style: i.choice, why: 'choice' };
    if (i.seen === 'centre' && i.wizard && i.wizard !== 'centre') return { style: restStyle(i.wizard), why: 'wizard' };
    if (i.seen) return { style: restStyle(i.seen), why: 'seen' };
    if (i.wizard) return { style: restStyle(i.wizard), why: 'wizard' };
    if (i.springs) return { style: 'centred', why: 'table' };
    return { style: 'zero', why: 'default' };
}

/** A profile's known controller has a spring-centred throttle (the DJI FPV Remote Controller). */
export function springsOf(p: Pick<Profile, 'known'> | null | undefined): boolean {
    return !!knownDevice(p?.known)?.mapping?.throttleSprings;
}

/** The style a profile flies with, given where its throttle was seen resting on this connection. */
export function profileStyle(p: Profile, seen: ThrottleRest | null): ResolvedStyle {
    return resolveStyle({ choice: p.throttleStyle, seen, wizard: p.throttleRest, springs: springsOf(p) });
}

/** A saved choice this version reads ('centred' or 'zero'), else undefined (automatic). */
export function readThrottleStyle(v: unknown): ThrottleStyle | undefined {
    return v === 'centred' || v === 'zero' ? v : undefined;
}

/** A saved rest this version reads, else undefined. */
export function readThrottleRest(v: unknown): ThrottleRest | undefined {
    return v === 'centre' || v === 'bottom' || v === 'parked' ? v : undefined;
}

/**
 * Where the throttle rests on this connection: the first window of TUNING.STILL_MS (500 ms) in which the mapped throttle
 * (-1 bottom .. 1 top) stays within TUNING.STILL_TOL (0.04) of where the window began, classified by classifyThrottleRest
 * on the window's mean. The wizard's own stillness rule (its "a stick is still" at a pilot's press); a stick being moved
 * never decides. Once decided it stays until reset() (a new connection), so the style never changes on its own in flight.
 */
export class RestWatch {
    private from = NaN;
    private since = 0;
    private sum = 0;
    private n = 0;
    private decided: ThrottleRest | null = null;
    /** the gamepad trap: the first value, and whether a different one has been read since */
    private first = NaN;
    private changed = false;

    /** The rest seen, or null while nothing still has been seen (a controller that reports nothing yet, a moving stick). */
    get rest(): ThrottleRest | null {
        return this.decided;
    }

    /**
     * One sample of the mapped throttle at page time `tMs`; the rest once decided. Non-numbers are ignored. `gamepad`: the
     * value comes through the Gamepad API, where an axis may read one fixed value (0.0) until it is first moved
     * (devices/gamepad.ts, the trap the arm gate's centre rule is for): nothing counts until the value has changed once.
     */
    update(v: number, tMs: number, gamepad = false): ThrottleRest | null {
        if (this.decided || !Number.isFinite(v) || !Number.isFinite(tMs)) return this.decided;
        if (gamepad && !this.changed) {
            if (Number.isNaN(this.first)) this.first = v;
            if (v === this.first) return null;
            this.changed = true;
        }
        if (Number.isNaN(this.from) || Math.abs(v - this.from) > TUNING.STILL_TOL || tMs < this.since) {
            this.from = v;
            this.since = tMs;
            this.sum = 0;
            this.n = 0;
        }
        this.sum += v;
        this.n++;
        if (tMs - this.since >= TUNING.STILL_MS) this.decided = classifyThrottleRest(this.sum / this.n);
        return this.decided;
    }

    /** A new connection: nothing seen. */
    reset(): void {
        this.from = NaN;
        this.since = 0;
        this.sum = 0;
        this.n = 0;
        this.decided = null;
        this.first = NaN;
        this.changed = false;
    }
}
