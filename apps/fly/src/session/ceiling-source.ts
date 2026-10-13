// Which collision ceiling a flight flies with, and how its height reads to the pilot (v0.7 lane E,
// the owner's item 10; docs/wip/v07-e.md). No DOM: the flight shell, the scene host, the ceiling
// feature (app/builtin/ceiling.ts) and tools/bench/test/ceiling-source.test.ts share it.
//
// Heights are stored in the scan's own coordinates (scale 1, metres up: the catalogue's ceilingM, the
// log's) and shown as metres above the start at the size flown: h = s * c + t_y - spawn y.
import type { PrefsStore } from '@gsfpv/prefs';
import { CEILING_LIMIT_M } from '@gsfpv/prefs';
import { validCeiling } from '@gsfpv/collision';

/** A stored height that ignores something: within the range and below its top (the default where the admin set none). */
function real(v: unknown): number | null {
    return validCeiling(v) && v < CEILING_LIMIT_M ? v : null;
}

/**
 * The ceiling `scene` flies with, in scan metres: the pilot's height ('custom'), none ('off'), or the
 * admin's for this scan ('scene': the catalogue's ceilingM, scene.ceilingM's curated default); null
 * for none.
 */
export function storedCeiling(prefs: Pick<PrefsStore, 'get' | 'defaultOf'>, scene: string): number | null {
    try {
        const mode = prefs.get<string>('scene.ceiling', { scene });
        if (mode === 'off') return null;
        return real(mode === 'custom' ? prefs.get<number>('scene.ceilingM', { scene }) : prefs.defaultOf<number>('scene.ceilingM', { scene }));
    } catch {
        return null;
    }
}

/** The admin's ceiling for this scan (scan metres), null when it has none. */
export function sceneCeiling(prefs: Pick<PrefsStore, 'defaultOf'>, scene: string): number | null {
    try {
        return real(prefs.defaultOf<number>('scene.ceilingM', { scene }));
    } catch {
        return null;
    }
}

/** What a height conversion needs of the flight: the scene transform and the start. */
export interface FlownFrame {
    transform: { s: number; t: readonly number[] };
    spawn: readonly number[];
}

/** A scan height as metres above the start in the flown world (the HUD's ALT 0). */
export function aboveStart(f: FlownFrame, c: number): number {
    return f.transform.s * c + f.transform.t[1] - f.spawn[1];
}

/** Metres above the start back to a scan height, Float32 as the log holds it. */
export function scanHeight(f: FlownFrame, h: number): number {
    return Math.fround((f.spawn[1] + h - f.transform.t[1]) / f.transform.s);
}
