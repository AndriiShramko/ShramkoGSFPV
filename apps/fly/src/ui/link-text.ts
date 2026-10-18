// What the Controls screen and F3 say about how a device's reports arrive (v0.9 lane E, the owner's
// item 12: a Bluetooth radio feels late and the pilot cannot tell the link from the simulator). The
// numbers are the LinkMeter's (@gsfpv/input link.ts) written out; a short note is added when the
// link itself is slow (a report every 15 ms or more) or sends in bunches. The page cannot tell a cable
// from Bluetooth, so the note states the measured cadence and says what helps if the link is wireless;
// it never says the link IS Bluetooth. No DOM, `t` passed in so a Node test can pass the real strings.
import type { LinkStats } from '@gsfpv/input';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The line of numbers and, when the link is slow or bursty, the note (measured cadence, and a cable if the link is wireless); null while the meter has too little to say. */
export interface LinkLines { line: string; note: string | null }

/** Milliseconds as a pilot reads them: a decimal under 10, whole numbers above. */
export function ms(x: number): string {
    return x < 10 ? x.toFixed(1) : String(Math.round(x));
}

/**
 * `where`: 'screen' is the Controls screen's line (the rate is its own line above), 'f3' the F3 line with
 * the rate in it. The note names the measured numbers: how long a report takes to come on average and the
 * longest silence in the last seconds.
 */
export function linkLines(s: LinkStats, t: T, where: 'screen' | 'f3'): LinkLines | null {
    if (s.verdict === 'unknown') return null;
    const v = { hz: Math.round(s.hz), ms: ms(s.meanMs), jitter: ms(s.jitterMs), gap: ms(s.maxGapMs) };
    return {
        line: t(where === 'f3' ? 'link.f3' : 'link.line', v),
        note: s.verdict === 'slow' ? t('link.note.slow', v) : s.verdict === 'bursty' ? t('link.note.bursty', v) : null
    };
}
