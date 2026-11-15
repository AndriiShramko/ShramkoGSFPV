// Lane course3, stage F3-audit: a top-down picture of one course over the walls, drawn in Node (no browser, no GPU lock).
// One pixel is one super block column of the walls (occupancy.ts: 8 voxels, 0.4 m on 5 cm walls). Background: black where
// the 4 m tile has no ground; else grey from the solid super blocks inside the dense band above the tile's ground (bright =
// walls at eye level, dark = open street); well-scanned tiles are tinted blue. The course: cyan lines gate to gate in order,
// gates as dots coloured by height above the ground (green inside the band, yellow up to 2 m over it, red higher, white
// when no ground lies under it), gate 1 with a white ring, the spawn as a magenta cross.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { VoxelCollision } from '@gsfpv/collision';
import { heightAbove, occupancyOf, SUPER, tileOf } from '@gsfpv/tracks';
import type { QualityMap, Vec3 } from '@gsfpv/tracks';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(b: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/** RGB pixels (w x h x 3) as PNG bytes */
export function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

export interface TopPicture {
    readonly w: number;
    readonly h: number;
    readonly metresPerPixel: number;
}

/** Draws the picture described above into `file` (PNG). Rows go along +z, columns along +x of the flown frame. */
export function writeCourseTop(file: string, col: VoxelCollision, q: QualityMap, gates: readonly Vec3[], spawn: Vec3): TopPicture {
    const occ = occupancyOf(col);
    const res = col.voxelResolution, span = SUPER * res;
    const flip = col.flipXY;
    const gx = col.gridMinX, gy = col.gridMinY, gz = col.gridMinZ;
    // world x of super column i, world y of super layer j (flipXY mirrors x and y)
    const wx = (i: number): number => (flip ? -(gx + (i + 0.5) * span) : gx + (i + 0.5) * span);
    const wy = (j: number): number => (flip ? -(gy + (j + 0.5) * span) : gy + (j + 0.5) * span);
    let xMin = Infinity, xMax = -Infinity;
    for (const i of [0, occ.sx - 1]) {
        xMin = Math.min(xMin, wx(i));
        xMax = Math.max(xMax, wx(i));
    }
    const w = occ.sx, h = occ.sz;
    const px = (x: number): number => Math.round((x - xMin) / span);
    const pz = (z: number): number => Math.round((z - (gz + 0.5 * span)) / span);
    const rgb = new Uint8Array(w * h * 3);
    const [b0, b1] = q.band;
    const solid = (i: number, j: number, k: number): boolean => {
        const n = (k * occ.sy + j) * occ.sx + i;
        return ((occ.bits[n >>> 5]! >>> (n & 31)) & 1) === 1;
    };
    for (let k = 0; k < occ.sz; k++) {
        for (let i = 0; i < occ.sx; i++) {
            const x = wx(i), z = gz + (k + 0.5) * span;
            const t = tileOf(q, [x, 0, z]);
            const g = t >= 0 ? q.ground[t]! : NaN;
            const p = (k * w + px(x)) * 3;
            if (g !== g) continue;
            let c = 0, all = 0;
            for (let j = 0; j < occ.sy; j++) {
                const y = wy(j) - g;
                if (y < b0 || y > b1) continue;
                all++;
                if (solid(i, j, k)) c++;
            }
            const v = all > 0 ? Math.round(40 + 200 * (c / all)) : 40;
            const good = q.good[t] === 1;
            rgb[p] = good ? Math.round(v * 0.75) : v;
            rgb[p + 1] = good ? Math.round(v * 0.8) : v;
            rgb[p + 2] = good ? Math.min(255, v + 45) : v;
        }
    }
    const put = (x: number, y: number, c: readonly number[]): void => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = (y * w + x) * 3;
        rgb[p] = c[0]!;
        rgb[p + 1] = c[1]!;
        rgb[p + 2] = c[2]!;
    };
    const line = (a: Vec3, b: Vec3, c: readonly number[]): void => {
        const x0 = px(a[0]), y0 = pz(a[2]), x1 = px(b[0]), y1 = pz(b[2]);
        const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (let s = 0; s <= n; s++) put(Math.round(x0 + ((x1 - x0) * s) / n), Math.round(y0 + ((y1 - y0) * s) / n), c);
    };
    const disc = (p: Vec3, r: number, c: readonly number[], ring = false): void => {
        const cx = px(p[0]), cy = pz(p[2]);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 > r * r || (ring && d2 < (r - 2) * (r - 2))) continue;
            put(cx + dx, cy + dy, c);
        }
    };
    for (let g = 0; g + 1 < gates.length; g++) line(gates[g]!, gates[g + 1]!, [0, 220, 230]);
    if (gates.length > 2) line(gates[gates.length - 1]!, gates[0]!, [0, 120, 130]);
    const dot = Math.max(3, Math.round(1.2 / span));
    gates.forEach((p, n) => {
        const above = heightAbove(q, p);
        const c = above !== above ? [255, 255, 255] : above >= b0 - 0.5 && above <= b1 ? [40, 230, 60] : above <= b1 + 2 ? [250, 220, 30] : [240, 40, 40];
        disc(p, dot, c);
        if (n === 0) disc(p, dot + 4, [255, 255, 255], true);
    });
    for (let d = -6; d <= 6; d++) {
        put(px(spawn[0]) + d, pz(spawn[2]), [255, 0, 255]);
        put(px(spawn[0]), pz(spawn[2]) + d, [255, 0, 255]);
    }
    writeFileSync(file, encodePng(w, h, rgb));
    return { w, h, metresPerPixel: span };
}
