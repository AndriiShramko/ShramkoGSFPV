// CI subset of the phase A harnesses: fixture 39e63ce9 and synthetic walls only (no network).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision, syntheticWall, VoxelContactWorld, UnsupportedVoxelFormatError } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { runDeterminism } from '@gsfpv/input/sim';
import { runPass, mulberry32, randomRotation } from '../src/a5-tunnel';
import { runA4 } from '../src/a4-physics';
import { params } from '../src/presets';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
const settings = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8'));
const spawnPos: number[] = settings.cameras[0].initial.position;

function surround(col: ReturnType<typeof openVoxelCollision>, p: number[]): number {
    let hits = 0;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 2 * Math.PI;
        if (col.queryRay(p[0], p[1], p[2], Math.cos(a), 0, Math.sin(a), 60)) hits++;
    }
    return hits;
}

describe('A2 collision formats (fixture 39e63ce9, format 1.0)', () => {
    const right = openVoxelCollision(meta, bin);
    it('opens legacy 1.0 data flipped and sees a floor with the scan around the spawn', () => {
        expect(right.flipXY).toBe(true);
        const hit = right.queryRay(spawnPos[0], spawnPos[1], spawnPos[2], 0, -1, 0, 20);
        expect(hit).not.toBeNull();
        expect(spawnPos[1] - hit!.y).toBeGreaterThan(0.05);
        expect(surround(right, spawnPos)).toBeGreaterThanOrEqual(12);
    });
    it('negative control: the wrong flip loses the surrounding scan', () => {
        const wrong = openVoxelCollision(meta, bin, { forceFlip: false });
        expect(surround(wrong, spawnPos)).toBeLessThan(12);
    });
    it('rejects an unknown format version explicitly', () => {
        expect(() => openVoxelCollision({ ...meta, version: '2.0' }, bin)).toThrow(UnsupportedVoxelFormatError);
    });
});

describe('A4 physics consistency', () => {
    it('all checks pass and every negative control fires', () => {
        const r = runA4() as { pass: boolean };
        expect(r.pass).toBe(true);
    });
});

describe('A5 tunnelling (CI subset)', () => {
    const p = params('pavo20pro-3s');
    const n = p.spheres.length / 4;
    const body = { local: new Float64Array(n * 3), r: new Float64Array(n), n };
    for (let i = 0; i < n; i++) { body.local.set(p.spheres.subarray(i * 4, i * 4 + 3), i * 3); body.r[i] = p.spheres[i * 4 + 3]; }
    const c0 = new Float64Array(n * 3), c1 = new Float64Array(n * 3), tmp = new Float64Array(n * 3), pad = new Float64Array(n);
    it('0 penetrations through a 2 cm wall at 25 m/s; endpoint-only control misses', () => {
        const col = syntheticWall(0.02, 2);
        const world = new VoxelContactWorld(col);
        const rng = mulberry32(7);
        const R = new Float64Array(9);
        let pen = 0, tunnels = 0;
        for (let k = 0; k < 1500; k++) {
            randomRotation(rng, R, true);
            const sx = -0.15 - rng() * 1.6, sy = (rng() - 0.5) * 2, sz = (rng() - 0.5) * 2;
            const r = runPass(col, world, body, sx, sy, sz, 1, 0, 0, 25, 0.3 - sx, R, col.voxelResolution / 4, c0, c1, pad, tmp);
            pen += r.penetrations;
            if (r.ctl30 === 'tunnel') tunnels++;
        }
        expect(pen).toBe(0);
        expect(tunnels).toBeGreaterThan(0);
    });
});

describe('A6 determinism (Node)', () => {
    it('same trace hash for frame splits 30/60/144/240 Hz; Math.random changes it', () => {
        const p = params('pavo20pro-3s');
        const col = openVoxelCollision(meta, bin);
        const world = new VoxelContactWorld(col);
        const sp: [number, number, number, number] = [spawnPos[0], spawnPos[1], spawnPos[2], 0];
        const hashes = [30, 60, 144, 240].map((hz) => runDeterminism(p, world, sp, hz).hash);
        expect(new Set(hashes).size).toBe(1);
        expect(runDeterminism(p, world, sp, 60, Math.random).hash).not.toBe(hashes[0]);
    }, 120000);
});
