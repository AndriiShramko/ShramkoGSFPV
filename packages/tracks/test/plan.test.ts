// Lane gen4a, stage A2: planCourse lays the asked course in the scanned part of a scan (design gen4.md section 3, G1-G7).
// The negative control is inside the city test: the old path (qualityMap's band, fitCourse; the worker's path before this
// lane) on the same world, measured by the same placementStats, puts gates under the fuzzy ground's top or leaves the
// course open.
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { CELL_PER_OPENING, cellCentre, COURSE_DEFAULTS, FREE_DEFAULTS, LEVELS, analyzeScan, clipBox, courseLinkId, fitCourse, freeSpace, generateCourse, fitSizeFor, flownCollision, goodForGate, placementStats, planCourse, planRules, walkReach, legsWithinServer, qualityBounds, qualityMap, validateServerTrack } from '../src';
import type { CourseLevel, CourseRequest, PlanInput, SceneTransform, TrackFile, VoxelCollision } from '../src';
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

    // gen4a A3 (Wroclaw beginner seed 1 closed at 1 gate): a walk under gatesMin is walked again with seeds derived from
    // the asked one before the opening shrinks; the same link still lays the same course
    for (const [name, make, seed] of [['a room', scannedRoom, 4], ['a room', scannedRoom, 12]] as const)
        it(`${name}, beginner seed ${seed}: a short walk is walked again at the level's opening, not shrunk`, () => {
            const walls = make();
            const r = planCourse(input(walls, ask('beginner', seed)));
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.track.gates.length).toBeGreaterThanOrEqual(LEVELS.beginner.gatesMin);
            expect(r.shrunk).toBe(false);
            expect(r.stats.closed).toBe(true);
            expect(r.track.generator?.version).toMatch(/\.w[12]/);
            const again = planCourse(input(walls, ask('beginner', seed)));
            expect(again.ok && JSON.stringify(again.track.gates)).toBe(JSON.stringify(r.track.gates));
        });

    // gen4a A3 (G3; Forest Floor beginner had 0.4-0.6 of its gates on good tiles): the quality rule is kept down the whole
    // opening ladder before a pass drops it
    it('a city filmed from above, pro wide seed 2: every gate on a well-scanned tile', () => {
        const r = planCourse(input(cityFromAbove(), { seed: 2, level: 'pro', spread: 'wide', anyQuality: false }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.stats.gates).toBeGreaterThanOrEqual(LEVELS.pro.gatesMin);
        expect(r.stats.goodShare).toBe(1);
        expect(r.stats.closed).toBe(true);
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

    it('a lay that would end past the deadline is not started (the page\'s watchdog would end the worker)', () => {
        // review gen4a: fit.ts fitCourse's rule (review T2-6 / CV-5) kept by planCourse. A fake clock: each lay takes LAY_MS
        const req = ask('beginner', 4);
        let lays = 0;
        planCourse(input(room, req), { onStep: (s) => { if (s === 'lay') lays++; } });
        expect(lays).toBeGreaterThanOrEqual(3);
        const LAY_MS = 10_000, at = 2.5 * LAY_MS;
        let clock = 0, pending = 0;
        const ends: number[] = [];
        const now = (): number => {
            const v = clock;
            clock += pending;
            pending = 0;
            return v;
        };
        planCourse(input(room, req), {
            deadline: { at, now },
            onStep: (s) => {
                if (s !== 'lay') return;
                pending = LAY_MS;
                ends.push(clock + LAY_MS);
            }
        });
        expect(ends.length).toBeGreaterThanOrEqual(1);
        expect(Math.max(...ends)).toBeLessThanOrEqual(at);
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
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const r = planCourse({ ...input(walls, { seed, level: 'pro', spread: 'compact', anyQuality: false }), transform: T });
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            const v = validateServerTrack(r.track);
            const legs = v.ok ? [] : v.issues.filter((s) => s.includes('leg to the next gate'));
            expect(legs).toEqual([]);
            expect(r.stats.gates).toBeGreaterThanOrEqual(LEVELS.pro.gatesMin);
        }
    });

    // gen4a A3, audit run 4: Winter Garden's tiles are 3.328 m and one edge lies at z -7.168; the walk's zone passed a cell
    // centre a hair inside it (under the glass), the gate was stored rounded to the mm on the edge, in the tile beyond
    // it (no ceiling): 7 of 9 pro gates read outside the room
    it('an asked course: every gate stands in its zone at the position it is stored at (mm rounding at a zone edge)', () => {
        // scannedRoom's walls on a grid whose cell centres lie 0.4 mm under a mm (a scan's grid starts anywhere)
        const inRoom = (x: number, y: number, z: number): boolean => x >= 0 && x < 10 && y >= 0 && y < 4 && z >= 0 && z < 8;
        const walls = analyticCollision([-1.5, -0.5, -1.5004], [11.5, 5, 9.4996], 0.1, (x, y, z) =>
            x >= -0.2 && x < 10.2 && y >= -0.2 && y < 4.2 && z >= -0.2 && z < 8.2 && !inRoom(x, y, z));
        const free = freeSpace(walls, { spawn: [5, 2, 4] });
        const r3 = (v: number): number => Math.round(v * 1000) / 1000;
        // a row of cell centres whose stored z rounds up past the centre: the zone's edge is the centre itself
        let C = NaN;
        for (let iz = 0; iz < free.dims[2]; iz++) {
            const z = cellCentre(free, iz * free.dims[0] * free.dims[1])[2];
            if (z > 2 && z < 6 && r3(z) > z) {
                C = z;
                break;
            }
        }
        expect(Number.isFinite(C)).toBe(true);
        const at = (p: readonly number[]): boolean => p[2]! <= C && p[2]! > C - 2 * free.cellM && p[1]! > 0.5 && p[1]! < 3.5 && p[0]! > 0.5 && p[0]! < 9.5;
        let laid = 0;
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const t = generateCourse(free, walls, { seed, scene: { id: 'abcdef12', version: 1 }, transform: IDENTITY, created: '2026-11-19T00:00:00.000Z', spawn: [5, 2, C - free.cellM], place: { at, start: [5, 2, C - free.cellM], reachM: 20, gates: 6, climbMax: 0.5, version: '5.t' } });
            laid += t.gates.length;
            for (const g of t.gates) expect(at(g.pos), `seed ${seed} gate ${g.id} at z ${g.pos[2]} (edge ${C})`).toBe(true);
        }
        expect(laid).toBeGreaterThan(0);
    });

    it('legsWithinServer: the server\'s 60 m leg rule, flown m, the closing leg only with laps (Lublin pro wide seed 2: 61 m)', () => {
        const r = planCourse(input(scannedRoom(), ask('beginner')));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const t = r.track;
        expect(legsWithinServer(t)).toBe(true);
        const g0 = t.gates[0]!;
        const moved = (dz: number, laps: number, scale: number): TrackFile => ({ ...t, laps, transform: [scale, 0, 0, 0], gates: [{ ...g0, pos: [0, 0, 0] }, { ...t.gates[1]!, pos: [0, 0, dz] }, { ...t.gates[2]!, pos: [0, 0, 0] }] });
        expect(legsWithinServer(moved(59.9, 1, 1))).toBe(true);
        expect(legsWithinServer(moved(60.1, 1, 1))).toBe(false);
        // flown m: 31 scene units at x2 are 62 m
        expect(legsWithinServer(moved(31, 1, 2))).toBe(false);
        // the closing leg counts only for a lapped course; the server's own check agrees
        const open3 = { ...t, laps: 1, transform: [1, 0, 0, 0] as [number, number, number, number], gates: [{ ...g0, pos: [0, 0, 0] as [number, number, number] }, { ...t.gates[1]!, pos: [0, 0, 40] as [number, number, number] }, { ...t.gates[2]!, pos: [0, 0, 80] as [number, number, number] }] };
        expect(legsWithinServer(open3)).toBe(true);
        expect(legsWithinServer({ ...open3, laps: 2 })).toBe(false);
        for (const x of [open3, { ...open3, laps: 2 }, moved(60.1, 1, 1)]) {
            const v = validateServerTrack(x);
            expect(legsWithinServer(x)).toBe(v.ok || !v.issues.some((s) => s.includes('leg')));
        }
    });

    it('walkReach: a pro wide course on a 1 km scan gets a box of its walk and one leg, not its loop laid out straight', () => {
        // 1994c65c pro wide (audit run 4): a 260 m box of 3.2 m cells against a 0.43 m gate, no course
        const scan = { extentM: 1000, coreRadiusM: 60 } as unknown as Parameters<typeof planRules>[2];
        const R = planRules({ seed: 1, level: 'pro', spread: 'wide', anyQuality: false }, WHOOP_R, scan);
        const w = walkReach(R, 1);
        const straight = (R.gates * R.legMaxM) / 2 + R.legMaxM;
        expect(straight).toBeGreaterThan(200);
        expect(w.walkR).toBeLessThanOrEqual(R.zoneR);
        expect(w.boxR).toBeCloseTo(Math.min(straight, w.walkR + R.legMaxM), 6);
        expect(w.boxR).toBeLessThan(0.5 * straight);
        // a small room keeps its whole loop: the box is never more than the loop laid out straight
        const room = planRules({ seed: 1, level: 'beginner', spread: 'compact', anyQuality: false }, WHOOP_R, { extentM: 10, coreRadiusM: 3 } as unknown as Parameters<typeof planRules>[2]);
        const wr = walkReach(room, 1);
        expect(wr.boxR).toBeLessThanOrEqual((room.gates * room.legMaxM) / 2 + room.legMaxM + 1e-9);
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
