// Lane gen4a, stage A2: planCourse lays the asked course in the scanned part of a scan (design gen4.md section 3, G1-G7).
// The negative control is inside the city test: the old path (qualityMap's band, fitCourse; the worker's path before this
// lane) on the same world, measured by the same placementStats, puts gates under the fuzzy ground's top or leaves the
// course open.
import { describe, expect, it } from 'vitest';
import { CELL_PER_OPENING, COURSE_DEFAULTS, FREE_DEFAULTS, LEVELS, analyzeScan, clipBox, courseLinkId, fitCourse, freeSpace, generateCourse, fitSizeFor, flownCollision, goodForGate, placementStats, planCourse, qualityBounds, qualityMap, validateServerTrack } from '../src';
import type { CourseLevel, CourseRequest, PlanInput, SceneTransform, VoxelCollision } from '../src';
import { IDENTITY } from './worlds';
import { cityFromAbove, crowdedPocket, plantTray, scannedRoom, tableAndSkull } from './scan-worlds';

const WHOOP_R = 0.0425; // a 65 mm whoop (fit.ts SMALLEST_DRONE_RADIUS_M)
const D = 2 * WHOOP_R;
const input = (walls: VoxelCollision, request: CourseRequest): PlanInput => ({
    walls, transform: IDENTITY, spawn: [0, 1, 0], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: WHOOP_R, request, elements: true
});
const ask = (level: CourseLevel, seed = 7): CourseRequest => ({ seed, level, spread: 'compact', anyQuality: false });

describe('planCourse: the asked course in the scanned part, closed, at the craft\'s size', () => {
    const room = scannedRoom();
    for (const level of ['beginner', 'medium', 'pro'] as CourseLevel[])
        it(`a room, ${level}: closed, start = finish, inside, over the floor, the level's opening`, () => {
            const r = planCourse(input(room, ask(level)));
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            const s = r.stats;
            expect(s.kind).toBe('room');
            expect(s.closed).toBe(true);
            expect(s.startFinishM).toBe(0);
            expect(s.outside).toBe(0);
            expect(s.underGround).toBe(0);
            expect(s.gates).toBeGreaterThanOrEqual(LEVELS[level].gatesMin);
            expect(s.gates).toBeLessThanOrEqual(LEVELS[level].gatesMax);
            expect(r.shrunk).toBe(false);
            // the smallest gate is the level's ring (10 / 6 / 4 D); a square of the same step is 1.25 x it
            expect(s.openingM).toBeGreaterThanOrEqual(LEVELS[level].openingD * D - 1e-3);
            expect(s.openingM).toBeLessThanOrEqual(1.25 * LEVELS[level].openingD * D + 1e-3);
            expect(r.track.id).toBe(courseLinkId(ask(level)));
            expect(r.track.generator?.version.startsWith('5.')).toBe(true);
            expect(validateServerTrack(r.track).ok).toBe(true);
            // the same request lays the same course
            const again = planCourse(input(room, ask(level)));
            expect(again.ok && JSON.stringify(again.track.gates)).toBe(JSON.stringify(r.track.gates));
        });

    it('a city filmed from above: gates between and over the roofs, none in the fuzzy ground; the old path fails', () => {
        const city = cityFromAbove();
        const r = planCourse(input(city, ask('medium')));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const s = r.stats;
        expect(s.kind).toBe('cityAbove');
        expect(s.closed).toBe(true);
        expect(s.startFinishM).toBe(0);
        expect(s.outside).toBe(0);
        expect(s.underGround).toBe(0);
        expect(s.nearGroundShare).toBeLessThanOrEqual(0.2);
        expect(s.gates).toBeGreaterThanOrEqual(1);
        // negative control: the worker's path before gen4a (S0's stub) on the same walls
        const spawn: [number, number, number] = [27, 3, 27];
        const q = qualityMap(city, { unitM: 1 });
        const box = qualityBounds(q, spawn);
        const free = freeSpace(city, { spawn, bounds: box ?? undefined, goodAt: box ? goodForGate(q) : undefined, unitM: 1 });
        const old = fitCourse(free, city, { seed: 7, scene: { id: 'abcdef12', version: 1 }, transform: IDENTITY, quality: box ? q : undefined, spawn, elements: true }, COURSE_DEFAULTS.gatesMin, generateCourse);
        expect(old.track).not.toBeNull();
        const os = placementStats(old.track!, analyzeScan(city, IDENTITY), IDENTITY);
        expect(os.underGround > 0 || !os.closed || os.nearGroundShare > 0.2).toBe(true);
    });

    it('a skull on a table at x1: a whoop still gets a course (pro opening), never a gate in the air beside the table', () => {
        const r = planCourse(input(tableAndSkull(), ask('pro')));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.stats.gates).toBeGreaterThanOrEqual(1);
        expect(r.stats.outside).toBe(0);
        expect(r.stats.underGround).toBe(0);
        expect(r.stats.closed).toBe(true);
    });

    it('a plant tray at x1: a shrunk course over the tray, inside, closed', () => {
        const r = planCourse(input(plantTray(), ask('medium')));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.shrunk).toBe(true);
        expect(r.stats.outside).toBe(0);
        expect(r.stats.underGround).toBe(0);
        expect(r.stats.closed).toBe(true);
    });

    it('a pocket too small at x1: no-room with the Scene size where the 4 D gate fits, and at that size a course', () => {
        const pocket = crowdedPocket();
        const r = planCourse(input(pocket, ask('beginner')));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toBe('no-room');
        expect(r.fitSize).not.toBeNull();
        expect(r.fitSize!).toBeGreaterThan(1);
        const T: SceneTransform = [r.fitSize!, 0, 0, 0];
        const big = planCourse({ ...input(flownCollision(pocket, T), ask('beginner')), transform: T });
        expect(big.ok).toBe(true);
        if (!big.ok) return;
        expect(big.shrunk).toBe(true);
        expect(big.stats.gates).toBeGreaterThanOrEqual(1);
        expect(big.stats.outside).toBe(0);
        expect(big.stats.underGround).toBe(0);
    });

    it('fitSizeFor: the first step over the size that reaches size / ratio; null when none does', () => {
        expect(fitSizeFor(1, 0.45)).toBe(3);
        expect(fitSizeFor(1, 1.2)).toBe(2);
        expect(fitSizeFor(3, 0.5)).toBe(10);
        expect(fitSizeFor(10, 0.2)).toBeNull();
        expect(fitSizeFor(30, 1)).toBeNull();
        expect(fitSizeFor(1, 0)).toBeNull();
    });

    it('a 2 km city flown by a whoop: every leg of the pro courses, the closing one too, keeps the server\'s 60 m', () => {
        // 1994c65c pro compact seed 1: a walk out to the 127 m zone closed over 60 m (validateServerTrack refused it). Only
        // the leg rule is asserted: at x20 a whoop's gate is under the format's 0.05 scene units (For the lead, gen4a.md)
        const T: SceneTransform = [20, 0, 0, 0];
        const walls = flownCollision(cityFromAbove(), T);
        for (const seed of [1, 2, 3]) {
            const r = planCourse({ ...input(walls, { seed, level: 'pro', spread: 'compact', anyQuality: false }), transform: T });
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            const v = validateServerTrack(r.track);
            const legs = v.ok ? [] : v.issues.filter((s) => s.includes('leg to the next gate'));
            expect(legs).toEqual([]);
            expect(r.stats.gates).toBeGreaterThanOrEqual(LEVELS.pro.gatesMin);
        }
    });

    it('clipBox: a 1 km scan flown at x1 by a whoop gets a box of the course\'s reach, with cells near the gate\'s size', () => {
        // Laval eb5f51dc: the whole-scan box gave 3.2 m cells against a 0.85 m gate (no usable cell, no course)
        const box = { min: [-900, -350, -500] as [number, number, number], max: [400, 100, 500] as [number, number, number] };
        const start: [number, number, number] = [-430, -224, 218];
        const c = clipBox(box, start, 30, 0.85, 0.4);
        for (let ax = 0; ax < 3; ax++) {
            expect(c.min[ax]).toBeCloseTo(Math.max(box.min[ax]!, start[ax]! - 30), 6);
            expect(c.max[ax]).toBeCloseTo(Math.min(box.max[ax]!, start[ax]! + 30), 6);
        }
        // a reach whose box holds more than maxCells cells of half an opening is shrunk until it holds them
        const fine = clipBox(box, start, 300, 0.85, 0.01);
        const vol = (fine.max[0] - fine.min[0]) * (fine.max[1] - fine.min[1]) * (fine.max[2] - fine.min[2]);
        const cell = CELL_PER_OPENING * 0.85;
        expect(vol).toBeLessThanOrEqual(FREE_DEFAULTS.maxCells * cell * cell * cell);
        expect(vol).toBeGreaterThan(0.5 * FREE_DEFAULTS.maxCells * cell * cell * cell);
        // the start stays inside, a box smaller than the reach is kept whole
        for (let ax = 0; ax < 3; ax++) expect(start[ax]! >= fine.min[ax]! && start[ax]! <= fine.max[ax]!).toBe(true);
        const small = { min: [0, 0, 0] as [number, number, number], max: [5, 3, 4] as [number, number, number] };
        expect(clipBox(small, [1, 1, 1], 30, 0.85, 0.1)).toEqual(small);
    });
});
