/**
 * Lane onecourse, measure: does a scan wall stand between the craft and the gate the hum leads to?
 * Reads an r11 evidence file (its flight trail: pos, hum dir, hum d) and the scene's voxel walls, and casts a ray from every
 * trail sample toward the hummed point. Prints, per sample, the distance to the first wall on that line (null: clear line).
 *
 * npx tsx src/oc-hum-los.ts --walls <dir with scene.voxel.json/bin> --evidence <r11 json>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Sample { s: number; pos: [number, number, number]; hum: { dir: [number, number, number]; d: number } | null }

function main(): void {
    const dir = arg('--walls');
    const ev = arg('--evidence');
    if (!dir || !ev) throw new Error('--walls and --evidence are needed');
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    const col = openVoxelCollision(meta, bin);
    const doc = JSON.parse(readFileSync(ev, 'utf8')) as { result: { r11: { runs: { flight: { trail: Sample[] } }[] } } };
    const trail = doc.result.r11.runs[0]!.flight.trail;
    const rows: object[] = [];
    for (const p of trail) {
        if (!p.hum) continue;
        const [dx, dy, dz] = p.hum.dir;
        const n = Math.hypot(dx, dy, dz) || 1;
        const goal = [p.pos[0] + dx * p.hum.d / n, p.pos[1] + dy * p.hum.d / n, p.pos[2] + dz * p.hum.d / n].map((v) => Math.round(v * 10) / 10);
        const hit = col.queryRay(p.pos[0], p.pos[1], p.pos[2], dx / n, dy / n, dz / n, p.hum.d);
        const push = { x: 0, y: 0, z: 0 };
        const inside = col.querySphere(p.pos[0], p.pos[1], p.pos[2], 0.15, push as never);
        const wallAt = hit ? Math.round(Math.hypot(hit.x - p.pos[0], hit.y - p.pos[1], hit.z - p.pos[2]) * 10) / 10 : null;
        rows.push({ s: p.s, pos: p.pos, goal, d: p.hum.d, wallAt, hit: hit ? [hit.x, hit.y, hit.z].map((v) => Math.round(v * 10) / 10) : null, touching: inside });
    }
    const blocked = rows.filter((r) => (r as { wallAt: number | null }).wallAt !== null).length;
    console.log(JSON.stringify({ samples: rows.length, blocked, rows }, null, 0));
}

main();
