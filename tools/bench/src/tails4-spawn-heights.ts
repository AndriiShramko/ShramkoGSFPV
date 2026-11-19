/**
 * tails4 T2: how high over the ground the page's start (the scan's CDN camera, pushed out of a wall by
 * findSphereSpawn) is on every scan with walls. Read-only: the walls of the release folder or the CDN,
 * the camera from the CDN settings (what the page reads).
 *   npx tsx src/tails4-spawn-heights.ts [--walls U:/Temp/gsfpv-train3/walls/release] [--scenes a,b] [--out f.json]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { START_MAX_OVER_GROUND_M, findSphereSpawn, openVoxelCollision, placeStart } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { loadScene, sceneSettings } from './scenes';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const OLD = process.argv.includes('--old');
let bad = 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;

async function wallsOf(id: string, dir: string | null): Promise<VoxelCollision> {
    if (!dir) return (await loadScene(id)).collision;
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

async function main(): Promise<void> {
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const ids = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    const newest = (id: string): number => Math.max(...readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])));
    const all = [...ids.map((id) => ({ id, v: newest(id), dir: join(root, id, `v${newest(id)}`) as string | null })), ...['887f27aa', '39e63ce9', '7a475d38', 'b11e45d1'].map((id) => ({ id, v: 1, dir: null as string | null }))];
    const only = arg('--scenes')?.split(',') ?? null;
    const rows: Record<string, unknown>[] = [];
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        try {
            const w = await wallsOf(s.id, s.dir);
            const set = await sceneSettings(s.id, s.v);
            let p = [set.position[0], set.position[1], set.position[2]];
            const o = { x: 0, y: 0, z: 0 };
            const R = 0.2;
            const inWall = w.querySphere(p[0]!, p[1]!, p[2]!, R, o);
            if (inWall && findSphereSpawn(w, p[0]!, p[1]!, p[2]!, R, o)) p = [o.x, o.y, o.z];
            const down = w.queryRay(p[0]!, p[1]!, p[2]!, 0, -1, 0, 1000);
            const up = w.queryRay(p[0]!, p[1]!, p[2]!, 0, 1, 0, 1000);
            // --old: the start before tails4 (the camera pushed out of a wall); default: placeStart, what the page does now
            const st = OLD ? null : placeStart(w, set.position, set.target ?? null, R);
            if (st) p = st.pos;
            const dn = st ? w.queryRay(p[0]!, p[1]!, p[2]!, 0, -1, 0, 1000) : down;
            const over = dn ? r2(p[1]! - dn.y) : null;
            const row = { scene: s.id, from: st?.from ?? 'old', cam: set.position.map(r2), target: set.target?.map(r2), inWall, spawn: p.map(r2), groundY: dn ? r2(dn.y) : null, overGroundM: over, ceilingY: up ? r2(up.y) : null, res: w.voxelResolution, ok: over !== null && over <= START_MAX_OVER_GROUND_M };
            if (!row.ok) bad++;
            if (process.argv.includes('--diag')) {
                // where the walls are under the camera's line, and the nearest column with any wall (2 m grid, 200 m around)
                const c = set.position, t = set.target;
                const line = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8].map((f) => { const q = [0, 1, 2].map((k) => c[k]! + (t[k]! - c[k]!) * f); const h = w.queryRay(q[0]!, q[1]!, q[2]!, 0, -1, 0, 1000); return [f, q.map(r2), h ? r2(h.y) : null]; });
                let best: number[] | null = null, bd = Infinity;
                for (let x = c[0]! - 200; x <= c[0]! + 200; x += 2) for (let z = c[2]! - 200; z <= c[2]! + 200; z += 2) {
                    const h = w.queryRay(x, 200, z, 0, -1, 0, 1000);
                    const d = (x - c[0]!) ** 2 + (z - c[2]!) ** 2;
                    if (h && d < bd) { bd = d; best = [r2(x), r2(h.y), r2(z), r2(Math.sqrt(d))]; }
                }
                console.log(JSON.stringify({ scene: s.id, line, nearestColumn: best }));
            }
            rows.push(row);
            console.log(JSON.stringify(row));
        } catch (e) {
            console.log(JSON.stringify({ scene: s.id, error: String((e as Error).message ?? e) }));
        }
    }
    const out = arg('--out');
    if (out) writeFileSync(out, JSON.stringify({ old: OLD, bad, rows }, null, 1));
    console.log(JSON.stringify({ verdict: bad === 0 ? 'PASS' : 'FAIL', bad, of: rows.length }));
    process.exit(bad === 0 ? 0 : 1);
}
void main();
