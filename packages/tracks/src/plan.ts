// Lane gen4a (train 4, design gen4.md section 3): the course the pilot asked for (request.ts) on the walls of the flight.
// Stage S0: planCourse is the worker's path of today moved into the package (qualityMap, qualityBounds, freeSpace,
// fitCourse; of the request only the seed is used) and placementStats answers zeros, so gen4b builds the page against the
// contract while the analysis (A1) and the placement (A2) are made here.
import { COURSE_DEFAULTS, generateCourse, goodForGate } from './generate';
import { fitCourse, freeAtMargin } from './fit';
import { freeSpace, sceneUnitM } from './freespace';
import { qualityBounds, qualityMap } from './quality';
import { flownStart } from './check';
import type { SceneTransform, TrackFile } from './types';
import type { PlanAnswer, PlanHooks, PlanInput, PlanStats } from './request';
import type { ScanAnalysis } from './scan';

/** the course of `input.request` on `input.walls`; never throws for a scan without room: answers ok false */
export function planCourse(input: PlanInput, hooks: PlanHooks = {}): PlanAnswer {
    const { walls, transform, spawn } = input;
    const unitM = sceneUnitM(transform);
    hooks.onStep?.('analyse', 0);
    const quality = qualityMap(walls, { unitM });
    const box = qualityBounds(quality, spawn);
    const freeOpts = { spawn, bounds: box ?? undefined, goodAt: box ? goodForGate(quality) : undefined, unitM };
    hooks.onStep?.('free', 0);
    const free = freeSpace(walls, freeOpts);
    const now = hooks.deadline?.now;
    let lastMs = 0;
    const make: typeof generateCourse = (f, w, o) => {
        hooks.onStep?.('lay', lastMs);
        const t0 = now ? now() : 0;
        const t = generateCourse(f, w, o);
        if (now) lastMs = now() - t0;
        return t;
    };
    const got = fitCourse(
        free,
        walls,
        { seed: input.request.seed, scene: input.scene, transform, created: input.created, quality: box ? quality : undefined, spawn, elements: input.elements, craftRadiusM: input.craftRadiusM },
        COURSE_DEFAULTS.gatesMin,
        make,
        hooks.deadline ?? null,
        (marginM) => freeAtMargin(walls, freeOpts, marginM)
    );
    if (!got.track || got.track.gates.length === 0) return { ok: false, reason: 'no-room', kind: 'unknown', fitSize: null };
    const track = got.track;
    const start = flownStart(track, transform) ?? { pos: spawn, yawDeg: 0 };
    return { ok: true, track, stats: { ...ZERO_STATS, gates: track.gates.length, closed: track.laps > 1 }, start, shrunk: false };
}

const ZERO_STATS: PlanStats = { kind: 'unknown', gates: 0, closed: false, startFinishM: 0, startToCoreM: 0, goodShare: 0, outside: 0, underGround: 0, nearGroundShare: 0, openingM: 0 };

/** the measured placement of `track` against the analysis of its scan (stage S0: zeros) */
export function placementStats(_track: TrackFile, _scan: ScanAnalysis, _transform: SceneTransform): PlanStats {
    return ZERO_STATS;
}
