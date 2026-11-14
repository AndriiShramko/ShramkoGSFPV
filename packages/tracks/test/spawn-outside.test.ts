// Train 2 wave 2 seam: the page spawns at the scene's camera, which on a small scan can sit outside the walls' grid
// (Forest Floor ab5efa0e v2: camera at x -6.45 m, grid -3..3 m). freeSpace then found no start cell, so Shift+G answered
// "nothing fits" in 0.3 s. A spawn outside the grid now starts from the nearest point inside it.
// Negative control: freespace.ts of the head before the fix (no start cell, 0 m3).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyticCollision, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, fitCourse, freeSpace } from '../src';
import { IDENTITY } from './worlds';

const CREATED = '2026-11-14T00:00:00.000Z';

/** An open scan 6 x 5 x 6 m: a floor and one pillar, nothing above; the camera looks at it from outside. */
function openScan(): ReturnType<typeof analyticCollision> {
    return analyticCollision([-3, -1, -3], [3, 4, 3], 0.1, (x, y, z) => y < 0 || (Math.abs(x) < 0.3 && Math.abs(z) < 0.3));
}

describe('a spawn outside the walls grid', () => {
    it('finds a start and free space from the nearest point inside the grid', () => {
        const walls = openScan();
        const inside = freeSpace(walls, { spawn: [-2, 1.5, 0] });
        const outside = freeSpace(walls, { spawn: [-6.4, 3.1, 0.1] });
        expect(inside.startCell).toBeGreaterThanOrEqual(0);
        expect(outside.startCell).toBeGreaterThanOrEqual(0);
        expect(outside.volumeM3).toBeGreaterThan(0);
    });
});

const FOREST = process.env.GSFPV_FOREST_FLOOR_WALLS ?? 'U:/Temp/gsfpv-train2/walls/release/ab5efa0e/v2';
describe.runIf(existsSync(join(FOREST, 'scene.voxel.json')))('Forest Floor ab5efa0e at its camera spawn', () => {
    it('gets a course of at least gatesMin gates', () => {
        const meta = JSON.parse(readFileSync(join(FOREST, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
        let bin: Uint8Array = readFileSync(join(FOREST, 'scene.voxel.bin'));
        if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
        const walls = openVoxelCollision(meta, bin);
        // cameras[0].initial.position of the CDN's ab5efa0e/v2/settings.json, read 2026-11-14
        const free = freeSpace(walls, { spawn: [-6.446, 3.143, 0.123] });
        expect(free.startCell).toBeGreaterThanOrEqual(0);
        const r = fitCourse(free, walls, { seed: 1, scene: { id: 'ab5efa0e', version: 2 }, transform: IDENTITY, created: CREATED });
        expect(r.track!.gates.length).toBeGreaterThanOrEqual(COURSE_DEFAULTS.gatesMin);
    });
});
