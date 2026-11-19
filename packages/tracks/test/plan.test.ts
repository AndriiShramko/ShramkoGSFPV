// Lane gen4a, stage A2: planCourse lays the asked course in the scanned part of a scan (design gen4.md section 3, G1-G7).
// The negative control is inside the city test: the old path (qualityMap's band, fitCourse; the worker's path before this
// lane) on the same world, measured by the same placementStats, puts gates under the fuzzy ground's top or leaves the
// course open.
import { describe, expect, it } from 'vitest';
import { COURSE_DEFAULTS, LEVELS, analyzeScan, courseLinkId, fitCourse, freeSpace, generateCourse, goodForGate, placementStats, planCourse, qualityBounds, qualityMap, validateServerTrack } from '../src';
import type { CourseLevel, CourseRequest, PlanInput, VoxelCollision } from '../src';
import { IDENTITY } from './worlds';
import { cityFromAbove, plantTray, scannedRoom, tableAndSkull } from './scan-worlds';

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
});
