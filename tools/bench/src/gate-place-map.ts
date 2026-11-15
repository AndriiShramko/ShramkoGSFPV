// Lane course4, stage C0 (fix3b's left items R3, ground measure, POOR_SHARE and EYE_FREE_M from pictures). Node, no GPU.
// For one scan and the seeds a page run printed, the course as the worker makes it, then pictures to look at:
//   <out>/<name>-<seed>-top.png   top map at --px m a pixel (default 0.15) over the course and 15 m around it: the tile's
//                                 quality share of the best quarter (red under 0.10, orange to POOR_SHARE, yellow to 0.30,
//                                 green above; grey: no ground), wall voxels 0.4-4 m above the tile ground darken it,
//                                 legs cyan, gates white squares with their number
//   <out>/<name>-<seed>-g<k>.png  vertical section through gate k across its opening (24 m wide, 0.1 m a pixel, slice
//                                 0.3 m thick): walls white, the tile ground red, the first voxel straight below green, the
//                                 gate's opening blue
// and per gate a row: heights above the tile ground and above the ray ground, the tile share, the leaves measure (wall
// voxels in the tube of the opening and 3 m before and after it, outside the free radius the generator asked for).
// Run: node_modules/.bin/tsx tools/bench/src/gate-place-map.ts --scene 70b50d42 --seed-list 925664764 --out <dir> [--sections all|3,5]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, gunzipSync } from 'node:zlib';
import { blockDims, findSphereSpawn, forEachBlock, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, FIT_BUDGET_MS, POOR_SHARE, fitCourse, flownCollision, freeSpace, qualityBounds, qualityMap, qualityShare, groundBelow } from '@gsfpv/tracks';
import type { QualityMap, SceneTransform, Vec3 } from '@gsfpv/tracks';
import { loadScene, sceneSettings } from './scenes';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

const CRC = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
});
function crc32(b: Uint8Array): number {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
export function png(w: number, h: number, rgb: Uint8Array): Buffer {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    const chunk = (type: string, data: Buffer): Buffer => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 3 x 5 digits, rows top to bottom, 3 bits a row
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
class Img {
    readonly d: Uint8Array;
    constructor(readonly w: number, readonly h: number) {
        this.d = new Uint8Array(w * h * 3);
    }
    set(x: number, y: number, c: readonly number[]): void {
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
        const i = (y * this.w + x) * 3;
        this.d[i] = c[0]!;
        this.d[i + 1] = c[1]!;
        this.d[i + 2] = c[2]!;
    }
    line(x0: number, y0: number, x1: number, y1: number, c: readonly number[]): void {
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        for (let k = 0; k <= n; k++) this.set(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, c);
    }
    text(x: number, y: number, s: string, c: readonly number[], scale = 3): void {
        for (let k = 0; k < s.length; k++) {
            const g = DIG[Number(s[k])];
            if (!g) continue;
            for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1')
                for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.set(x + (k * 4 + q) * scale + a, y + r * scale + b, c);
        }
    }
    save(file: string): void {
        writeFileSync(file, png(this.w, this.h, this.d));
    }
}

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}
function tileOf(q: QualityMap, x: number, z: number): number {
    const tx = Math.floor((x - q.x0) / q.tileM), tz = Math.floor((z - q.z0) / q.tileM);
    return tx < 0 || tz < 0 || tx >= q.nx || tz >= q.nz ? -1 : tz * q.nx + tx;
}
function shareColour(s: number): number[] {
    if (s < 0.1) return [150, 30, 30];
    if (s < POOR_SHARE) return [190, 100, 20];
    if (s < 0.3) return [170, 160, 30];
    return [40, 130, 50];
}
/** the gate's passing axis (the shape's local z turned by its quaternion [x, y, z, w]) */
function axisOf(q: readonly number[]): Vec3 {
    const [x, y, z, w] = q as [number, number, number, number];
    return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

async function wallsOf(id: string, dir: string | null): Promise<VoxelCollision> {
    if (!dir) return (await loadScene(id)).collision;
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

async function main(): Promise<void> {
    const id = arg('--scene') ?? '70b50d42';
    const v = Number(arg('--version') ?? 1);
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const dir = id === '887f27aa' ? null : join(root, id, `v${v}`);
    const out = arg('--out') ?? 'U:/Temp/gsfpv-train3/shots/course4-c0';
    const name = arg('--name') ?? id;
    const px = Number(arg('--px') ?? 0.15);
    mkdirSync(out, { recursive: true });
    const T = [1, 0, 0, 0] as unknown as SceneTransform;
    const walls = flownCollision(await wallsOf(id, dir), T);
    const set = await sceneSettings(id, v);
    let spawn: Vec3 = [set.position[0], set.position[1], set.position[2]];
    const o = { x: 0, y: 0, z: 0 };
    if (walls.querySphere(spawn[0], spawn[1], spawn[2], 0.2, o) && findSphereSpawn(walls, spawn[0], spawn[1], spawn[2], 0.2, o)) spawn = [o.x, o.y, o.z];
    const q = qualityMap(walls);
    const box = qualityBounds(q, spawn);
    const free = freeSpace(walls, { spawn, bounds: box ?? undefined });
    const res = walls.voxelResolution;
    for (const seed of (arg('--seed-list') ?? '1').split(',').map(Number)) {
        const t0 = performance.now();
        const got = fitCourse(free, walls, { seed, scene: { id, version: v }, transform: T, created: '2026-11-15T00:00:00Z', quality: box ? q : undefined, spawn, elements: process.argv.includes('--elements') }, COURSE_DEFAULTS.gatesMin, undefined, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() });
        const tr = got.track;
        if (!tr) {
            console.log(JSON.stringify({ scene: id, seed, gates: 0 }));
            continue;
        }
        const gates = tr.gates.map((g) => ({ p: g.pos as unknown as Vec3, ax: axisOf(g.quat as unknown as number[]), sh: g.shape as { kind: string; side?: number; diameter?: number } }));
        // per gate: heights, share, leaves measure
        const rows = gates.map((g, k) => {
            const p = g.p;
            const t = tileOf(q, p[0], p[2]);
            const half = (g.sh.kind === 'square' ? g.sh.side ?? 1 : g.sh.diameter ?? 1) / 2;
            const thin = walls.queryRay(p[0], p[1], p[2], 0, -1, 0, 40);
            const gb = groundBelow(walls, p, 12);
            // the tube: radius half + 1 m around the axis, 3 m before and after; voxels counted on a res grid by querySphere
            let tube = 0, cells = 0, over = 0;
            const ax = g.ax, L = Math.hypot(ax[0], ax[1], ax[2]) || 1;
            const a: Vec3 = [ax[0] / L, ax[1] / L, ax[2] / L];
            const R = half + 1;
            for (let x = -R; x <= R; x += res) for (let y = -R; y <= R; y += res) for (let z = -R; z <= R; z += res) {
                // keep points whose distance to the axis is within R and whose along-axis offset is within 3 m
                const along = x * a[0] + y * a[1] + z * a[2];
                const d2 = x * x + y * y + z * z - along * along;
                if (d2 > R * R) continue;
                for (let s = -3; s <= 3; s += 2 * R) {
                    const X = p[0] + x + s * a[0], Y = p[1] + y + s * a[1], Z = p[2] + z + s * a[2];
                    if (Y < (Number.isFinite(gb) ? gb : -1e9) + 0.3) continue;
                    cells++;
                    if (walls.querySphere(X, Y, Z, res * 0.45, o)) {
                        tube++;
                        if (Y > p[1] + half) over++;
                    }
                }
            }
            return { gate: k + 1, kind: g.sh.kind, size: r2(2 * half), pos: p.map(r2), hTile: t >= 0 ? r2(p[1] - q.ground[t]!) : null, hRay: thin ? r2(p[1] - thin.y) : null, hGround5: Number.isFinite(gb) ? r2(p[1] - gb) : null, share: r2(qualityShare(q, p)), tubeShare: r2(tube / Math.max(1, cells)), tubeOver: over };
        });
        console.log(JSON.stringify({ scene: id, seed, gates: gates.length, band: q.band, res, tileM: q.tileM }));
        for (const r of rows) console.log(JSON.stringify(r));
        // top map
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        const pts = [(tr.start?.pos as unknown as Vec3) ?? gates[0]!.p, ...gates.map((g) => g.p)];
        for (const p of pts) {
            x0 = Math.min(x0, p[0] - 15);
            x1 = Math.max(x1, p[0] + 15);
            z0 = Math.min(z0, p[2] - 15);
            z1 = Math.max(z1, p[2] + 15);
        }
        const W = Math.ceil((x1 - x0) / px), H = Math.ceil((z1 - z0) / px);
        const img = new Img(W, H);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const t = tileOf(q, x0 + (i + 0.5) * px, z0 + (j + 0.5) * px);
            img.set(i, j, t < 0 || !Number.isFinite(q.ground[t]!) ? [60, 60, 60] : shareColour(q.best > 0 ? q.near[t]! / q.best : 0));
        }
        const dark = new Float32Array(W * H);
        const blockM = 4 * res;
        const [nbx, nby, nbz] = blockDims(walls);
        const flip = walls.flipXY;
        forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
            const cx = walls.gridMinX + (bx + 0.5) * blockM;
            const wx = flip ? -cx : cx;
            const wz = walls.gridMinZ + (bz + 0.5) * blockM;
            if (wx < x0 || wx > x1 || wz < z0 || wz > z1) return;
            const L = flip ? nby - 1 - by : by;
            const yb = flip ? -(walls.gridMinY + (nby - L) * blockM) : walls.gridMinY + L * blockM;
            const t = tileOf(q, wx, wz);
            if (t < 0 || !Number.isFinite(q.ground[t]!)) return;
            const h = yb - q.ground[t]!;
            if (h < 0.4 || h > 4) return;
            const n = popcount(lo >>> 0) + popcount(hi >>> 0);
            for (let a = -blockM / 2; a < blockM / 2; a += px) for (let b = -blockM / 2; b < blockM / 2; b += px) {
                const i = Math.floor((wx + a - x0) / px), j = Math.floor((wz + b - z0) / px);
                if (i >= 0 && j >= 0 && i < W && j < H) dark[j * W + i] += n;
            }
        });
        for (let k = 0; k < W * H; k++) if (dark[k]! > 0) {
            const f = Math.max(0.15, 1 - dark[k]! / 200);
            for (let c = 0; c < 3; c++) img.d[k * 3 + c] = Math.round(img.d[k * 3 + c]! * f);
        }
        const P = (p: Vec3): [number, number] => [(p[0] - x0) / px, (p[2] - z0) / px];
        for (let k = 0; k + 1 < pts.length; k++) img.line(...P(pts[k]!), ...P(pts[k + 1]!), [0, 220, 230]);
        if (tr.laps > 1) img.line(...P(pts[pts.length - 1]!), ...P(pts[1]!), [0, 220, 230]);
        gates.forEach((g, k) => {
            const [i, j] = P(g.p);
            // course4 C4: the gate's kind by colour: ring white, square yellow, cube frame magenta, lying flat green
            const tg = tr.gates[k]!;
            const qq = tg.quat as unknown as number[];
            const flat = Math.max(Math.abs(2 * (qq[2]! * qq[3]! - qq[0]! * qq[1]!)), Math.abs(2 * (qq[1]! * qq[2]! - qq[3]! * qq[0]!))) > 0.9;
            const kind = (tg.shape as { kind: string }).kind;
            const col = flat ? [80, 255, 80] : kind === 'cube-frame' ? [255, 0, 255] : kind === 'square' ? [255, 230, 0] : [255, 255, 255];
            for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) img.set(i + a, j + b, col);
            img.text(i + 7, j - 7, String(k + 1), col);
        });
        const [si, sj] = P(pts[0]!);
        for (let a = -5; a <= 5; a++) img.set(si + a, sj + a, [255, 0, 255]), img.set(si + a, sj - a, [255, 0, 255]);
        img.save(join(out, `${name}-${seed}-top.png`));
        // sections
        const want = arg('--sections');
        const list = want === 'all' ? rows.map((r) => r.gate) : (want ?? '').split(',').filter(Boolean).map(Number);
        for (const k of list) {
            const g = gates[k - 1]!;
            const ah = Math.hypot(g.ax[0], g.ax[2]) || 1;
            const u: Vec3 = [-g.ax[2] / ah, 0, g.ax[0] / ah]; // across the opening, level
            const n: Vec3 = [g.ax[0] / ah, 0, g.ax[2] / ah];
            const sp = 0.1, Wd = 240, yTop = g.p[1] + 8, yBot = g.p[1] - 5, Hd = Math.round((yTop - yBot) / sp);
            const s = new Img(Wd, Hd);
            for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd; i++) {
                const off = (i - Wd / 2) * sp, y = yTop - j * sp;
                let hit = false;
                for (const d of [-0.15, 0, 0.15]) if (walls.querySphere(g.p[0] + off * u[0] + d * n[0], y, g.p[2] + off * u[2] + d * n[2], res * 0.5, o)) hit = true;
                const t = tileOf(q, g.p[0] + off * u[0], g.p[2] + off * u[2]);
                if (hit) s.set(i, j, [230, 230, 230]);
                else if (t >= 0 && Number.isFinite(q.ground[t]!) && Math.abs(y - q.ground[t]!) < sp / 2) s.set(i, j, [230, 40, 40]);
            }
            const half = (g.sh.kind === 'square' ? g.sh.side ?? 1 : g.sh.diameter ?? 1) / 2;
            const ci = Wd / 2, cj = (yTop - g.p[1]) / sp;
            for (let a = -half / sp; a <= half / sp; a++) {
                s.set(ci + a, cj - half / sp, [60, 120, 255]);
                s.set(ci + a, cj + half / sp, [60, 120, 255]);
                s.set(ci - half / sp, cj + a, [60, 120, 255]);
                s.set(ci + half / sp, cj + a, [60, 120, 255]);
            }
            const thin = walls.queryRay(g.p[0], g.p[1], g.p[2], 0, -1, 0, 40);
            if (thin) s.line(ci, cj, ci, (yTop - thin.y) / sp, [40, 230, 40]);
            s.text(4, 4, String(k), [255, 255, 0], 2);
            s.save(join(out, `${name}-${seed}-g${k}.png`));
        }
    }
    console.log('DONE');
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/gate-place-map\.(ts|js|mjs)$/.test(argv1)) void main();
