// How high the drone is above the ground below it (docs/wip/v09-b.md): the game scheme's soft landing slows a
// descent by this, so holding Shift lands instead of crashing. A tiny sphere swept straight down through the scan's
// own collision (the model's ContactWorld), a rule for every scan: nothing per scene.
// Pure: no DOM.
//
// Cost (docs/wip/ground-probe.md, measured by tools/bench/src/ground-probe-cost.ts on scene 887f27aa, 5 cm voxels):
// one sweep over the whole reach made the contact world test a cover sphere of 10.05 m voxel by voxel, 64 ms (p50)
// to 415 ms (max) a look, and a radio's every report asked for one: the page did nothing else. Two rules bound it:
//  - the sweep goes down in pieces of PROBE_PIECE_M and stops at the first piece that touches, so no sphere tested
//    is larger than PROBE_R + PROBE_PIECE_M / 2 and a look tests at most PROBE_M / PROBE_PIECE_M of them;
//  - GroundCache: the pilots look through it, at most once per time slice of the input, and a slow look earns a rest
//    of GROUND_REST times its own duration: looks never take more than about a quarter of the page's time, whatever
//    a look costs; the reports in between get the last answer.

import type { ContactOut, ContactWorld, SimParams } from '@gsfpv/sim-core';
import { S } from '@gsfpv/sim-core';

/** How far below the craft the probe looks, m. Beyond it the ground is "far": no limit but the speed setting. */
export const PROBE_M = 20;
/** The probe's sphere, m: small, so a thin ledge counts. */
const PROBE_R = 0.05;
/**
 * The length of one piece of the sweep, m. Measured (ground-probe-cost.ts, part "pieces", 12 ground points, heights
 * 0.3 to 20 m): 0.1 m costs p50 0.20 / p95 1.05 / max 3.59 ms a look, 0.25 m 0.31 / 1.48 / 5.06, 1 m 0.28 / 3.94 / 9.10.
 */
export const PROBE_PIECE_M = 0.1;
const PIECES = Math.round(PROBE_M / PROBE_PIECE_M);

const c0 = new Float64Array(3);
const c1 = new Float64Array(3);
const rad = new Float64Array([PROBE_R]);
const pad = new Float64Array([0]);
const out: ContactOut = { sphere: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Clearance of the craft's lowest body point above the solid straight below it, m (0 when touching or
 * inside); null when nothing solid lies within PROBE_M or there is no world.
 */
export function groundClearance(world: ContactWorld | null, s: ArrayLike<number>, p: Pick<SimParams, 'bodyBottom'>): number | null {
    if (!world) return null;
    const y = s[S.py];
    c0[0] = c1[0] = s[S.px];
    c0[2] = c1[2] = s[S.pz];
    for (let i = 0; i < PIECES; i++) {
        c0[1] = y - i * PROBE_PIECE_M;
        c1[1] = y - (i + 1) * PROBE_PIECE_M;
        const t = world.sweep(c0, c1, rad, pad, 1, out);
        // the sphere touches when its centre is PROBE_R above the surface: the surface is PROBE_R below where it stopped
        if (t >= 0) return Math.max(0, (i + t) * PROBE_PIECE_M + PROBE_R - p.bodyBottom);
    }
    return null;
}

/** The ground below is looked at no more often than this, ms of the input's own time (a frame's, a report's). */
export const GROUND_EVERY_MS = 33;
/**
 * After a slow look the next one waits this many times the look's own duration on the page's clock: slow looks take
 * at most 1 / (1 + GROUND_REST) of the page's time (a fifth), however slow a world answers. A chosen bound, not a
 * measurement.
 */
export const GROUND_REST = 4;
/**
 * A look that took at least this long on the page's clock is slow and earns the rest, ms. Under it only the time
 * slice counts (at most GROUND_SLOW_MS in every GROUND_EVERY_MS, a quarter), so a harness that flies faster than the
 * clock (tests, replays) gets the same looks on every machine. Chosen: about twice the slowest look measured on scene
 * 887f27aa (3.65 ms, ground-probe-cost.ts) and half a frame at 60 frames a second; not a measurement itself.
 */
export const GROUND_SLOW_MS = 8;
/**
 * The longest rest a slow look earns, ms of the page's clock. A pause that falls inside a look (garbage collection, a
 * suspended tab, a system sleep) counts as the look's duration; without a cap an hour's sleep would hold the old
 * clearance for four hours. Above GROUND_REST_MAX_MS / GROUND_REST (125 ms a look) the fifth no longer holds, but no
 * look measured comes near that (3.65 ms on scene 887f27aa). A chosen bound, not a measurement.
 */
export const GROUND_REST_MAX_MS = 500;

/**
 * The ground below as last looked at, for a pilot that is asked on every input report. A new look is made only when
 * GROUND_EVERY_MS of input time have passed since the last one (or the input's time went back: a new source) and the
 * page's clock is past the rest a slow last look earned; otherwise the last answer is given again.
 */
export class GroundCache {
    /** the last answer, m (null: nothing within reach, or no look yet) */
    value: number | null = null;
    /** how many looks were made (tests, the bench) */
    looks = 0;
    private askedAt = -1e9;
    private doneAt = 0;
    private restUntil = -Infinity;
    private readonly everyMs: number;
    private readonly clock: () => number;

    constructor(everyMs = GROUND_EVERY_MS, clock: () => number = () => performance.now()) {
        this.everyMs = everyMs;
        this.clock = clock;
    }

    /** No answer and no wait: the next ask looks. */
    reset(): void {
        this.value = null;
        this.askedAt = -1e9;
        this.restUntil = -Infinity;
    }

    /** The clearance at input time `tMs`: `look()` when a look is due, else the last answer. */
    ask(tMs: number, look: () => number | null): number | null {
        if (tMs - this.askedAt < this.everyMs && tMs >= this.askedAt) return this.value;
        const before = this.clock();
        // a clock that went back (a test's, a new page clock) owes no rest
        if (before < this.restUntil && before >= this.doneAt) return this.value;
        this.askedAt = tMs;
        this.value = look();
        this.looks++;
        const after = this.clock();
        this.doneAt = after;
        const took = after - before;
        this.restUntil = took >= GROUND_SLOW_MS ? after + Math.min(took * GROUND_REST, GROUND_REST_MAX_MS) : -Infinity;
        return this.value;
    }
}
