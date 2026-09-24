// Check the exact voxel counter against a brute-force isVoxelSolid scan of the whole grid.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { openVoxelCollision, countSolidVoxelsFromBytes } from '@gsfpv/collision';
import { REPO } from './evidence';

const dir = join(REPO, 'fixtures', '39e63ce9');
const json = readFileSync(join(dir, 'scene.voxel.json'));
let bin = readFileSync(join(dir, 'scene.voxel.bin'));
if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
const meta = JSON.parse(json.toString());
const col = openVoxelCollision(meta, bin) as unknown as { isVoxelSolid(x: number, y: number, z: number): boolean; numVoxelsX: number; numVoxelsY: number; numVoxelsZ: number };
const counted = countSolidVoxelsFromBytes(json, bin);
const nx = Math.round((meta.gridBounds.max[0] - meta.gridBounds.min[0]) / meta.voxelResolution);
const ny = Math.round((meta.gridBounds.max[1] - meta.gridBounds.min[1]) / meta.voxelResolution);
const nz = Math.round((meta.gridBounds.max[2] - meta.gridBounds.min[2]) / meta.voxelResolution);
let brute = 0;
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (col.isVoxelSolid(x, y, z)) brute++;
console.log(JSON.stringify({ grid: [nx, ny, nz], counted, brute, equal: counted === brute }));
const cli = join(REPO, '.cache', 'scenes', '723068d7');
try {
    const cj = readFileSync(join(cli, 'cli.voxel.json'));
    const cb = readFileSync(join(cli, 'cli.voxel.bin'));
    console.log(JSON.stringify({ cli723068d7: countSolidVoxelsFromBytes(cj, cb) }));
} catch (e) { console.log('no cli bake yet', String(e).slice(0, 80)); }
