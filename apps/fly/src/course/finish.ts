// Lane course4, stage C1-start-finish (owner's messages 55 and 56; lead decisions S1 to S5): the pure parts of a course the
// pilot can read. Which gate says START, FINISH or both; the lap's time shown large when a lap ends (its text, colour and
// gain or loss against the best lap, how long it stays and how it fades); the results card at the end of the last lap; the
// setting 'Lap time on screen'. No DOM, no clock: course/hud.ts and app/builtin/course.ts draw what these answer.
import { lapClock } from './hud-clock';

/** what a gate says over it: START, FINISH, START / FINISH, or nothing */
export type GateRole = 'start' | 'finish' | 'startFinish' | null;

/**
 * The role of every gate (S1). A closed course (laps > 1: gate 0 ends one lap and starts the next, packages/tracks laps.ts)
 * has one gate that is both; an open course starts at gate 0 and ends at its last gate. One gate alone is both.
 */
export function gateRoles(gates: number, closed: boolean): GateRole[] {
    const out: GateRole[] = new Array<GateRole>(Math.max(0, gates)).fill(null);
    if (gates <= 0) return out;
    if (closed || gates === 1) {
        out[0] = 'startFinish';
        return out;
    }
    out[0] = 'start';
    out[gates - 1] = 'finish';
    return out;
}

/** 'Lap time on screen' (S4): large by default */
export const LAP_SPLASH_MODES = ['large', 'small', 'off'] as const;
export type LapSplashMode = (typeof LAP_SPLASH_MODES)[number];
export const LAP_SPLASH_DEFAULT: LapSplashMode = 'large';

/** A stored value read back: one of the three, else the default. */
export function lapSplashMode(v: unknown): LapSplashMode {
    return (LAP_SPLASH_MODES as readonly unknown[]).includes(v) ? (v as LapSplashMode) : LAP_SPLASH_DEFAULT;
}

/** the splash of a finished lap: its time, the gain or loss against the best before it, and its tone */
export interface LapSplash {
    readonly time: string;
    /** '-0.42' for a new best, '+0.38' for a slower lap, '' when there was no best before */
    readonly delta: string;
    /** 'best': green with the gain; 'slower': white with the loss; 'first': white, the time alone */
    readonly tone: 'best' | 'slower' | 'first';
}

/** seconds with two decimals and a sign, from ms (truncated to the hundredth, as lapClock does) */
function signedSeconds(ms: number): string {
    const cs = Math.floor(Math.abs(ms) / 10);
    return `${ms < 0 ? '-' : '+'}${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}

/**
 * S4: the splash for a lap of `lapMs` when the best lap known before it was `bestBeforeMs` (null: none, the time alone).
 * A lap faster than the best is a new best (green, '-0.42'); an equal or slower one is white with its loss ('+0.38').
 */
export function lapSplash(lapMs: number, bestBeforeMs: number | null): LapSplash {
    const time = lapClock(lapMs);
    if (bestBeforeMs === null) return { time, delta: '', tone: 'first' };
    const d = lapMs - bestBeforeMs;
    if (d < 0) return { time, delta: signedSeconds(d), tone: 'best' };
    return { time, delta: signedSeconds(d), tone: 'slower' };
}

/** S4: the splash stays SPLASH_HOLD_MS at full strength and fades out in SPLASH_FADE_MS (lead's decision, design values) */
export const SPLASH_HOLD_MS = 1500;
export const SPLASH_FADE_MS = 400;
/** S5: the results card stays CARD_HOLD_MS, then fades in SPLASH_FADE_MS */
export const CARD_HOLD_MS = 3000;

/** How strong a splash or card shown `sinceMs` ago is: 1 while held, then linear to 0 over the fade; 0 after. */
export function splashAlpha(sinceMs: number, holdMs: number = SPLASH_HOLD_MS, fadeMs: number = SPLASH_FADE_MS): number {
    if (sinceMs < 0) return 0;
    if (sinceMs <= holdMs) return 1;
    if (sinceMs >= holdMs + fadeMs) return 0;
    return 1 - (sinceMs - holdMs) / fadeMs;
}

/** S5: the results card's numbers: the total of all laps, the best lap of the run, each lap's time */
export interface ResultsCard {
    readonly total: string;
    readonly best: string;
    readonly laps: readonly string[];
}

export function resultsCard(lapTimes: readonly number[]): ResultsCard {
    const total = lapTimes.reduce((a, b) => a + b, 0);
    const best = lapTimes.length ? Math.min(...lapTimes) : null;
    return { total: lapClock(lapTimes.length ? total : null), best: lapClock(best), laps: lapTimes.map((t) => lapClock(t)) };
}
