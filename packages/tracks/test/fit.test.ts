// Lane tracks2 K1.2: a small scan gets a smaller course (fitCourse), the plan's course is unchanged where it fits.
// Controls inside the tests: the plan's size alone (generateCourse at scale 1) does not reach gatesMin in the tiny room
// and on Forest Floor; the negative control of the file is generate.ts of origin/main (no scale), under which the scaled
// gates keep the plan's size and the size assertions fail.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyticCollision, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { trackDigest } from '@shramko/sonic-fpv';
import { COURSE_DEFAULTS, COURSE_SCALES, MARGIN_M, RING_DIAMETER_M, RING_MIN_DRONE_DIAMETERS, SMALLEST_DRONE_RADIUS_M, canSave, checkTrack, fitCourse, FIT_BUDGET_MS, flyPath, freeSpace, generateCourse, marginOf, openEditor, upgradeTrack, wallsCheck } from '../src';
import type { SceneTransform, TrackFile, Vec3 } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const SCENE = { id: '0000aaaa', version: 1 };
const CREATED = '2026-11-14T00:00:00.000Z';

/** the opening of a gate, flown m */
const opening = (t: TrackFile, i: number): number => {
    const sh = t.gates[i]!.shape as { kind: string; side?: number; diameter?: number };
    return (sh.kind === 'square' ? sh.side! : sh.diameter!) * t.transform[0];
};
const registersAll = (t: TrackFile, T: SceneTransform): string[] => {
    const out: string[] = [];
    for (const v of [3, 12]) {
        const f = flyPath(t, v, T);
        if (!f.done) out.push(`${v} m/s: ${f.misses.map((m) => `g${m.gate} ${m.cause}`).join(', ')}`);
    }
    return out;
};

/** A closed room 4 x 3 x 4 m inside, walls 0.3 m: smaller than Forest Floor's free space. */
function tinyRoom(): ReturnType<typeof analyticCollision> {
    const inside = (x: number, y: number, z: number): boolean => x >= 0 && x < 4 && y >= 0 && y < 3 && z >= 0 && z < 4;
    return analyticCollision([-0.3, -0.3, -0.3], [4.3, 3.3, 4.3], 0.1, (x, y, z) => !inside(x, y, z));
}

describe('fitCourse in a tiny room (4 x 3 x 4 m)', () => {
    const walls = tinyRoom();
    const free = freeSpace(walls, { spawn: [2, 1.5, 2] });

    it('control: the plan-size course does not reach gatesMin here', () => {
        let most = 0;
        for (const seed of [1, 2, 3]) most = Math.max(most, generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED }).gates.length);
        expect(most).toBeLessThan(COURSE_DEFAULTS.gatesMin);
    });

    it('gives a smaller course that a pilot following the path passes, gates no smaller than the smallest drone allows', () => {
        for (const seed of [1, 2, 3]) {
            const r = fitCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED });
            expect(r.track, `seed ${seed}`).not.toBeNull();
            const t = r.track!;
            expect(r.scale).toBeLessThan(1);
            expect(t.gates.length).toBeGreaterThanOrEqual(2);
            expect(t.generator?.params.scale).toBe(r.scale);
            for (let i = 0; i < t.gates.length; i++) {
                expect(opening(t, i)).toBeLessThan(RING_DIAMETER_M);
                expect(opening(t, i)).toBeGreaterThanOrEqual(RING_MIN_DRONE_DIAMETERS * 2 * SMALLEST_DRONE_RADIUS_M - 1e-9);
            }
            expect(checkTrack(t, walls, IDENTITY, t.generator!.params.marginM as number, false).ok).toBe(true);
            expect(registersAll(t, IDENTITY)).toEqual([]);
        }
    });

    it('review T2-1: the editor checks a smaller course at the margin it was laid with, so it can be saved', () => {
        const t = fitCourse(free, walls, { seed: 1, scene: SCENE, transform: IDENTITY, created: CREATED }).track!;
        expect(marginOf(t)).toBe(t.generator!.params.marginM);
        expect(marginOf(t)).toBeLessThan(MARGIN_M);
        expect(marginOf({ ...t, generator: null })).toBe(MARGIN_M);
        const ed = openEditor(upgradeTrack(t), wallsCheck(walls, IDENTITY, marginOf(t)), 0);
        expect(ed.problems, JSON.stringify(ed.problems)).toEqual([]);
        expect(canSave(ed)).toBe(true);
        // control: the same course at the plan's margin has problems (the editor showed red gates and refused Enter)
        expect(canSave(openEditor(upgradeTrack(t), wallsCheck(walls, IDENTITY), 0))).toBe(false);
    });

    it('review T2-6: with a course in hand fitCourse does not start a try that would end past its deadline', () => {
        // a fake generator: 2 gates a course (under gatesMin), 30 s a try on a fake clock
        let clock = 0;
        const slow = ((): TrackFile => {
            clock += 30_000;
            return { gates: [{}, {}] } as unknown as TrackFile;
        }) as unknown as typeof generateCourse;
        const opts = { seed: 1, scene: SCENE, transform: IDENTITY, created: CREATED };
        const r = fitCourse(free, walls, opts, COURSE_DEFAULTS.gatesMin, slow, { at: 100_000, now: () => clock });
        expect(r.tried).toBe(3);
        expect(r.short).toBe(true);
        expect(r.track?.gates.length).toBe(2);
        expect(clock).toBeLessThanOrEqual(100_000);
        // control: without a deadline all the scales are tried
        expect(fitCourse(free, walls, opts, COURSE_DEFAULTS.gatesMin, slow).tried).toBe(COURSE_SCALES.length * 3);
        // the budget leaves the page's 150 s watchdog room (course.ts GENERATE_LIMIT_MS)
        expect(FIT_BUDGET_MS).toBeLessThan(150_000);
    });

    it('the smallest scale keeps the ring at RING_MIN_DRONE_DIAMETERS drone diameters', () => {
        const last = COURSE_SCALES[COURSE_SCALES.length - 1]!;
        expect(RING_DIAMETER_M * last).toBeGreaterThanOrEqual(RING_MIN_DRONE_DIAMETERS * 2 * SMALLEST_DRONE_RADIUS_M);
    });
});

describe('fitCourse where the plan-size course fits', () => {
    it('answers exactly the course of generateCourse at the same seed (same trackDigest, no scale in params)', () => {
        const walls = threeRooms();
        const free = freeSpace(walls, { spawn: SPAWN_A });
        const plain = generateCourse(free, walls, { seed: 7, scene: SCENE, transform: IDENTITY, created: CREATED });
        expect(plain.gates.length).toBeGreaterThanOrEqual(COURSE_DEFAULTS.gatesMin);
        const r = fitCourse(free, walls, { seed: 7, scene: SCENE, transform: IDENTITY, created: CREATED });
        expect(r.scale).toBe(1);
        expect(r.tried).toBe(1);
        expect(trackDigest(r.track!)).toBe(trackDigest(plain));
        expect('scale' in (r.track!.generator?.params ?? {})).toBe(false);
    });
});

// Forest Floor ab5efa0e, the walls lane's published walls (not in git: a scan of another author). Runs where the file is.
const FOREST = process.env.GSFPV_FOREST_FLOOR_WALLS ?? 'U:/Temp/gsfpv-train2/walls/release/ab5efa0e/v2';
describe.runIf(existsSync(join(FOREST, 'scene.voxel.json')))('Forest Floor ab5efa0e (6.0 x 5.0 x 5.8 m of free space)', () => {
    const meta = JSON.parse(readFileSync(join(FOREST, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(FOREST, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    const walls = openVoxelCollision(meta, bin);
    const spawn: Vec3 = [0, 0.7, -0.1]; // the centre of the walls' grid, where the audit spawned (tracks-audit.ts)
    const free = freeSpace(walls, { spawn });

    it('control: the plan-size course has fewer than gatesMin gates', () => {
        expect(generateCourse(free, walls, { seed: 1, scene: { id: 'ab5efa0e', version: 2 }, transform: IDENTITY, created: CREATED }).gates.length).toBeLessThan(COURSE_DEFAULTS.gatesMin);
    });

    it('gets a course of at least gatesMin smaller gates that a pilot following the path passes', () => {
        for (const seed of [1, 2, 3]) {
            const r = fitCourse(free, walls, { seed, scene: { id: 'ab5efa0e', version: 2 }, transform: IDENTITY, created: CREATED });
            const t = r.track!;
            expect(r.short).toBe(false);
            expect(r.scale).toBeLessThan(1);
            expect(t.gates.length).toBeGreaterThanOrEqual(COURSE_DEFAULTS.gatesMin);
            for (let i = 0; i < t.gates.length; i++) expect(opening(t, i)).toBeLessThan(RING_DIAMETER_M);
            expect(registersAll(t, IDENTITY)).toEqual([]);
        }
    }, 60000);
});
