// Lane course4, stage C1-start-finish (owner's messages 55 and 56; lead decisions S1 to S5): the pure parts of a course the
// pilot can read. Which gate says START, FINISH or both; the lap's time shown large when a lap ends (its text, colour and
// gain or loss against the best lap, how long it stays and how it fades); the results card at the end of the last lap; the
// setting 'Lap time on screen'. No DOM, no clock: course/hud.ts and app/builtin/course.ts draw what these answer.
import { soundBallM } from '@gsfpv/tracks';
import type { SonicObject } from '@shramko/sonic-fpv';
import { lapClock } from './hud-clock';

/**
 * Course4 review CU-4 (S7: no dead end): the Scene size the next Shift+G sets when no course fitted at `size`. Measured on
 * Forest Floor ab5efa0e (gate-place-audit --scale, course4 c2 and cu logs): courses at x1, x3, x5, x10 and x30, none at
 * x15, x20, x100; at x1 every catalogue scan gives one (c3p2/after2.json). So over x10: x10; over x1 or under it: x1;
 * at x1 (a scan of the pilot's own): x2, an estimate (a larger scan has more room for the craft).
 * Course5 review CV-4: `tried` holds the sizes that gave no course in this scene; a size already tried is not offered again
 * (x1 and x2 would bounce without end): the next untried size of NO_COURSE_SIZES is, and null when all were tried (the
 * page then says 'no course' without a size).
 */
export function noCourseSize(size: number, tried: ReadonlySet<number> = new Set()): number | null {
    const was = (s: number): boolean => Math.abs(s - size) < 1e-6 || [...tried].some((v) => Math.abs(v - s) < 1e-6);
    const first = size > 10 ? 10 : Math.abs(size - 1) > 1e-6 ? 1 : 2;
    if (!was(first)) return first;
    for (const s of NO_COURSE_SIZES) if (!was(s)) return s;
    return null;
}

/**
 * The sizes offered after the first one (CV-4): the Forest Floor sizes that gave a course (x1, x3, x5, x10, x30, measured
 * above), x2 the estimate for a pilot's own scan.
 */
export const NO_COURSE_SIZES: readonly number[] = Object.freeze([1, 2, 3, 5, 10, 30]);

/** what a gate says over it: START, FINISH, START / FINISH, or nothing */
export type GateRole = 'start' | 'finish' | 'startFinish' | null;

/**
 * The role of every gate (S1). A closed course (laps > 1: gate 0 ends one lap and starts the next, packages/tracks laps.ts)
 * has one gate that is both; an open course starts at gate 0 and ends at its last gate. One gate alone is both.
 */
export function gateRoles(gates: number, closed: boolean): GateRole[] {
    const out: GateRole[] = new Array<GateRole>(Math.max(0, gates)).fill(null);
    for (let i = 0; i < out.length; i++) out[i] = gateRole(i, gates, closed);
    return out;
}

/** the role of gate `i` alone (gateRoles without the array: the guide asks it every frame) */
export function gateRole(i: number, gates: number, closed: boolean): GateRole {
    if (gates <= 0 || i < 0 || i >= gates) return null;
    if (closed || gates === 1) return i === 0 ? 'startFinish' : null;
    return i === 0 ? 'start' : i === gates - 1 ? 'finish' : null;
}

/**
 * Course5 Z1: the guide's screen label names the gate's role (START, FINISH, START / FINISH) instead of its number. The
 * 3D banner over the gate measured 16.4 x 5.2 px from 60 m at 1920x1080 (course-finish-probe.mjs, Wroclaw 70b50d42): too
 * small to read, so the label on the screen says it at any distance.
 */
export function guideLabel(gate: number, metres: number, role: GateRole, tr: (key: string, vars?: Record<string, string | number>) => string): string {
    return role ? tr('course.hud.guideRole', { role: tr(`course.gate.${role}`), m: metres }) : tr('course.hud.guide', { n: gate + 1, m: metres });
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

/**
 * Course4 review CU-1: whether a generate job composes competition elements. Fly by Sound asks its course through the
 * same generate (lane onecourse); the ear pilot was measured on single upright gates only, so the sound mode asks none.
 */
export function courseElements(sonic: unknown): boolean {
    return !sonic;
}

/**
 * Lane mix (the lead's X1, X2; the owner's message 52: the scene holds one course): Fly by Sound takes every course in the
 * scene, a course with elements too. The gates it is handed are the course's own objects, except an element passed by its
 * ball (packages/tracks laps.ts soundBallM: a flat square, a cube frame): that one is handed as a zone of the ball's size at
 * the element's centre, so the hum leads to the centre (the gate aim leads through an opening only) and the pass is the
 * ball's. Same objects in, same objects out: the array is built once per course.
 */
export function soundGates(gates: readonly SonicObject[]): readonly SonicObject[] {
    return gates.map((g) => {
        const r = soundBallM(g);
        return r === null ? g : { ...g, shape: { kind: 'zone', size: [2 * r, 2 * r, 2 * r] } };
    });
}

type Words = (key: string, vars?: Record<string, string | number>) => string;

/** Course4 review CU-2: what one lap's end gives, both shown (splash or card) and said (the spoken lap line) */
export interface LapEnd {
    /** the lap is a new best (written by the caller) */
    readonly best: boolean;
    readonly splash: LapSplash;
    /** the shown line of the lap ('Lap 12.34' or 'Best lap 12.34') */
    readonly said: string;
    /** the results card at the course's end, else null (the splash alone) */
    readonly card: ResultsCard | null;
    /** what Fly by Sound says: the lap line, and at the end the card's title and total after it */
    readonly spoken: string;
}

export function lapEnd(ev: 'lap' | 'done', lastMs: number, bestBeforeMs: number | null, lapTimes: readonly number[], tr: Words): LapEnd {
    const best = bestBeforeMs === null || lastMs < bestBeforeMs;
    const said = best ? tr('course.best', { time: lapClock(lastMs) }) : tr('course.lapDone', { time: lapClock(lastMs) });
    const card = ev === 'done' ? resultsCard(lapTimes) : null;
    const spoken = card ? `${said}. ${tr('course.card.title')}. ${tr('course.card.total', { time: card.total })}` : said;
    return { best, splash: lapSplash(lastMs, bestBeforeMs), said, card, spoken };
}
