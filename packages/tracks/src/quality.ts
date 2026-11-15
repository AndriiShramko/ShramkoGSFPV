// Lane course3, stage G2: where a scan is good, from its walls (the data every page has: published, shipped or built).
// A street scan is dense at the height of a walker's eyes and thin above (it was not filmed from high up); the gates go
// where it is dense, along the whole well-scanned extent. Pure: integer grids and + - * / only, so a worker and Node agree.
//
//   tiles    the walls' whole grid cut into tileM x tileM columns (flown m, x and z); per tile and per block layer the
//            count of solid voxels (popcount of the block's 64-voxel mask).
//   ground   per tile the lowest layer where the voxels counted from the bottom reach groundShare of a full layer: floaters
//            under the street are too few to reach it, a slope inside the tile is climbed.
//   band     the histogram of voxels by height above the ground (all tiles with a ground, the ground's own layers left
//            out) in binM bins; the dense band is the bins from minM up whose density is at least bandShare of the densest
//            such bin, joined to it. It is derived from the scan, not a constant.
//   good     a tile with a ground is well scanned when the voxels inside the band of it and its neighbours within goodR
//            tiles reach goodShare of the median of such sums.
import { blockDims, forEachBlock } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import type { Vec3 } from '@shramko/sonic-fpv';
import type { FreeSpace } from './freespace';

export const QUALITY_DEFAULTS = {
    tileM: 4, // estimate: a street lane's width, about 7 000 tiles on Wroclaw's 295 x 375 m grid
    binM: 0.5, // estimate, rounded to whole block layers (0.6 m at 5 cm walls, 0.8 m at 20 cm)
    groundShare: 0.3, // estimate: share of a full layer of voxels counted from the bottom that is the ground
    groundSkipM: 0.4, // estimate: the ground's own thickness, not counted in the histogram
    minM: 1.4, // the lowest gate centre above the ground: a gate needs RING_MIN_FREE_M (1.4 m) of free radius
    minBandM: 2, // estimate: the band is at least this thick, so a ring and a square gate both find room in it
    bandShare: 0.8, // estimate: a bin is dense at 80 % of the densest bin's voxels (Wroclaw: 1.4-7.0 m at 70 %, 1.4-5.8 m at 80 %)
    maxBandM: 12, // the histogram looks this high above the ground
    goodShare: 0.5, // estimate: a tile is well scanned at half the median of its neighbourhood's voxels in the band
    goodR: 1, // estimate: the neighbourhood is the tiles within 1 tile (12 m square, a street's width)
    maxTiles: 250_000 // memory: tiles x layers x 4 bytes stays under about 100 MB on a 25 m high grid of 10 cm blocks
} as const;

export interface QualityOptions {
    readonly tileM?: number;
    readonly binM?: number;
    readonly groundShare?: number;
    readonly minM?: number;
    readonly bandShare?: number;
    readonly goodShare?: number;
    /** course4 C2: the scan's one measure, flown m (freespace.ts sceneUnitM): tileM, the ground's skip and the band's
     *  thickness and reach are multiplied by it; 1 at true scale */
    readonly unitM?: number;
}

export interface QualityMap {
    readonly tileM: number;
    /** world x and z of tile (0, 0)'s low corner */
    readonly x0: number;
    readonly z0: number;
    readonly nx: number;
    readonly nz: number;
    /** world y of the ground's top per tile, NaN where the tile has no ground */
    readonly ground: Float32Array;
    /** voxels inside the band per tile */
    readonly dense: Float32Array;
    /** voxels inside the band of the tile and its neighbours within goodR tiles (the quality the tile is judged by) */
    readonly near: Float32Array;
    /** fix3b Y2: the quality of the scan's best quarter: the median of near over the top quarter of tiles with some */
    readonly best: number;
    /** 1 where the tile is well scanned */
    readonly good: Uint8Array;
    readonly goodTiles: number;
    /** voxels per tile with a ground in each binM bin above the ground (bin 0: groundSkipM to groundSkipM + binM) */
    readonly hist: readonly number[];
    readonly binM: number;
    /** the dense band, flown m above the ground */
    readonly band: readonly [number, number];
}

/**
 * Steps (6-neighbour cell moves through usable cells) from cell `from` to every cell, -1 where no way leads: the length of
 * the way along a street, not across the blocks between streets. The spread walk's measure of "how far along" (G2).
 */
export function stepsFrom(f: FreeSpace, from: number): Int32Array {
    const [nx, ny, nz] = f.dims;
    const n = nx * ny * nz;
    const d = new Int32Array(n).fill(-1);
    if (from < 0 || from >= n || f.room[from]! < 0) return d;
    const q = new Int32Array(n);
    const sxy = nx * ny;
    let h = 0, t = 0;
    d[from] = 0;
    q[t++] = from;
    while (h < t) {
        const i = q[h++]!;
        const x = i % nx;
        const y = ((i - x) / nx) % ny;
        const z = (i - x - y * nx) / sxy;
        const v = d[i]! + 1;
        const go = (j: number): void => {
            if (d[j] === -1 && f.room[j]! >= 0) {
                d[j] = v;
                q[t++] = j;
            }
        };
        if (x > 0) go(i - 1);
        if (x < nx - 1) go(i + 1);
        if (y > 0) go(i - nx);
        if (y < ny - 1) go(i + nx);
        if (z > 0) go(i - sxy);
        if (z < nz - 1) go(i + sxy);
    }
    return d;
}

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** The dense band from a histogram: [lo, hi] m above the ground. Exported for the tests. */
export function denseBand(hist: readonly number[], binM: number, skipM: number, minM: number, share: number): [number, number] {
    // the first bin lies wholly above minM: the bin just over the ground holds the ground's own spill (a synthetic street:
    // 680 voxels a tile against 396 in every bin above, so a band of that one bin)
    const first = Math.max(0, Math.ceil((minM - skipM) / binM - 1e-9));
    let peak = -1;
    for (let b = first; b < hist.length; b++) if (peak < 0 || hist[b]! > hist[peak]!) peak = b;
    if (peak < 0 || !(hist[peak]! > 0)) return [minM, minM + 2 * binM];
    const lim = share * hist[peak]!;
    let lo = peak, hi = peak;
    while (lo - 1 >= first && hist[lo - 1]! >= lim) lo--;
    while (hi + 1 < hist.length && hist[hi + 1]! >= lim) hi++;
    return [skipM + lo * binM, skipM + (hi + 1) * binM];
}

export function qualityMap(walls: VoxelCollision, opts: QualityOptions = {}): QualityMap {
    const D = QUALITY_DEFAULTS;
    // a bin is a whole number of block layers: 0.5 m bins over 0.2 m layers alternated 2 and 3 layers (Wroclaw's first
    // histogram zig-zagged by 40 %), over 0.8 m layers half the bins were empty (eb5f51dc)
    const blockM0 = 4 * walls.voxelResolution;
    const binM = blockM0 * Math.max(1, Math.round((opts.binM ?? D.binM) / blockM0));
    const groundShare = opts.groundShare ?? D.groundShare;
    const minM = opts.minM ?? D.minM;
    const bandShare = opts.bandShare ?? D.bandShare;
    const goodShare = opts.goodShare ?? D.goodShare;
    const U = Math.max(1, opts.unitM ?? 1);
    const flip = walls.flipXY;
    const blockM = 4 * walls.voxelResolution;
    const [nbx, nby, nbz] = blockDims(walls);
    const gx = walls.gridMinX, gy = walls.gridMinY, gz = walls.gridMinZ;
    // world bounds of the grid (a legacy grid stores x and y negated)
    const wx0 = flip ? -(gx + nbx * blockM) : gx;
    const wz0 = gz;
    let tileM = opts.tileM ?? D.tileM * U;
    const spanX = nbx * blockM, spanZ = nbz * blockM;
    while (Math.ceil(spanX / tileM) * Math.ceil(spanZ / tileM) > D.maxTiles) tileM *= 2;
    const nx = Math.max(1, Math.ceil(spanX / tileM)), nz = Math.max(1, Math.ceil(spanZ / tileM));
    const nt = nx * nz;
    const ny = nby; // world layer L = by (or nby - 1 - by on a legacy grid): ascending world y
    const counts = new Uint32Array(nt * ny);
    forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
        const cx = gx + (bx + 0.5) * blockM;
        const wx = flip ? -cx : cx;
        const wz = gz + (bz + 0.5) * blockM;
        const tx = Math.min(nx - 1, Math.floor((wx - wx0) / tileM));
        const tz = Math.min(nz - 1, Math.floor((wz - wz0) / tileM));
        const L = flip ? nby - 1 - by : by;
        counts[(tz * nx + tx) * ny + L] += popcount(lo >>> 0) + popcount(hi >>> 0);
    });
    const layerY = (L: number): number => (flip ? -(gy + (nby - L) * blockM) : gy + L * blockM); // bottom of layer L
    const fullLayer = (tileM / walls.voxelResolution) * (tileM / walls.voxelResolution) * (blockM / walls.voxelResolution);
    const ground = new Float32Array(nt).fill(NaN);
    const groundL = new Int32Array(nt).fill(-1);
    const skipL = Math.max(1, Math.round((D.groundSkipM * U) / blockM));
    const nb = Math.ceil((D.maxBandM * U) / binM);
    const sum = new Float64Array(nb);
    let withGround = 0;
    for (let t = 0; t < nt; t++) {
        let acc = 0;
        for (let L = 0; L < ny; L++) {
            acc += counts[t * ny + L]!;
            if (acc >= groundShare * fullLayer) {
                groundL[t] = L;
                ground[t] = layerY(L + 1);
                break;
            }
        }
        if (groundL[t]! < 0) continue;
        withGround++;
        for (let L = groundL[t]! + skipL; L < ny; L++) {
            const h = (L - groundL[t]! - skipL) * blockM;
            const b = Math.floor(h / binM + 1e-9);
            if (b >= nb) break;
            sum[b] += counts[t * ny + L]!;
        }
    }
    const skipM = skipL * blockM;
    const hist = Array.from(sum, (v) => (withGround ? Math.round((v / withGround) * 100) / 100 : 0));
    const b0 = denseBand(hist, binM, skipM, minM, bandShare);
    const band: [number, number] = [Math.max(minM, b0[0]), Math.max(b0[1], Math.max(minM, b0[0]) + D.minBandM * U)];
    const dense = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
        if (groundL[t]! < 0) continue;
        let v = 0;
        for (let L = 0; L < ny; L++) {
            const h = (L - groundL[t]!) * blockM;
            if (h >= band[0] && h < band[1]) v += counts[t * ny + L]!;
        }
        dense[t] = v;
    }
    // a tile is judged with its neighbours within goodR tiles: the middle of a street holds no voxels of its own but is
    // seen as well as the facades on both sides (per tile alone, a 0230d903 street kept only the cells by the facades and
    // the walk found 0-12 candidates within a leg)
    const near = new Float32Array(nt);
    const some: number[] = [];
    const R = D.goodR;
    for (let t = 0; t < nt; t++) {
        // fix3b Y2: also over a tile with no ground of its own (a street's middle at 10 cm walls), so a leg across it is
        // judged by the facades beside it; such a tile is still never good
        const tx = t % nx, tz = (t - tx) / nx;
        let v = 0;
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
            const X = tx + dx, Z = tz + dz;
            if (X >= 0 && Z >= 0 && X < nx && Z < nz) v += dense[Z * nx + X]!;
        }
        near[t] = v;
        if (v > 0 && groundL[t]! >= 0) some.push(v);
    }
    some.sort((a, b) => a - b);
    const median = some.length ? some[some.length >> 1]! : 0;
    const best = some.length ? some[Math.min(some.length - 1, Math.floor(some.length * 0.875))]! : 0;
    const good = new Uint8Array(nt);
    let goodTiles = 0;
    for (let t = 0; t < nt; t++) if (median > 0 && groundL[t]! >= 0 && near[t]! >= goodShare * median) {
        good[t] = 1;
        goodTiles++;
    }
    return { tileM, x0: wx0, z0: wz0, nx, nz, ground, dense, near, best, good, goodTiles, hist, binM, band };
}

/** a box side of the well-scanned extent the course may use, flown m (estimate: Wroclaw's grid is 295 x 375 m; 240 m keeps
 *  the free space's cells at 0.6-0.8 m under its 4 M cell cap with the box's height cut to the band) */
export const QUALITY_BOX_M = 240;
/** the box below the lowest ground and above the band's top, flown m (estimate: room for the rays of the outdoor rule) */
const BOX_PAD_M = 2;

/**
 * The free space's box (flown world) for a course over the well-scanned extent: the good tiles within QUALITY_BOX_M / 2 of
 * the spawn (x and z), joined with `minM` around the spawn (small and indoor scans keep the box they had), from the lowest
 * ground under them to the band's top. Null when no tile is good: the caller keeps the box around the spawn.
 */
export function qualityBounds(q: QualityMap, spawn: Vec3, minM = 80, maxM = QUALITY_BOX_M): { min: Vec3; max: Vec3 } | null {
    if (q.goodTiles === 0) return null;
    const h = minM / 2, H = maxM / 2;
    let x0 = spawn[0] - h, x1 = spawn[0] + h, z0 = spawn[2] - h, z1 = spawn[2] + h;
    let g0 = Infinity, g1 = -Infinity;
    for (let t = 0; t < q.good.length; t++) {
        if (!q.good[t]) continue;
        const tx = t % q.nx, tz = (t - tx) / q.nx;
        const ax = q.x0 + tx * q.tileM, az = q.z0 + tz * q.tileM;
        if (ax + q.tileM < spawn[0] - H || ax > spawn[0] + H || az + q.tileM < spawn[2] - H || az > spawn[2] + H) continue;
        x0 = Math.min(x0, ax);
        x1 = Math.max(x1, ax + q.tileM);
        z0 = Math.min(z0, az);
        z1 = Math.max(z1, az + q.tileM);
        g0 = Math.min(g0, q.ground[t]!);
        g1 = Math.max(g1, q.ground[t]!);
    }
    if (!(g0 <= g1)) return null;
    x0 = Math.max(x0, spawn[0] - H);
    x1 = Math.min(x1, spawn[0] + H);
    z0 = Math.max(z0, spawn[2] - H);
    z1 = Math.min(z1, spawn[2] + H);
    // freeSpace keeps the spawn's own block inside whatever the box says
    return { min: [x0, g0 - BOX_PAD_M, z0], max: [x1, g1 + q.band[1] + BOX_PAD_M, z1] };
}

/** The tile of a world point, -1 outside. */
export function tileOf(q: QualityMap, p: Vec3): number {
    const tx = Math.floor((p[0] - q.x0) / q.tileM), tz = Math.floor((p[2] - q.z0) / q.tileM);
    if (tx < 0 || tz < 0 || tx >= q.nx || tz >= q.nz) return -1;
    return tz * q.nx + tx;
}

/** Height of a world point above its tile's ground, NaN where the tile has none. */
export function heightAbove(q: QualityMap, p: Vec3): number {
    const t = tileOf(q, p);
    return t < 0 ? NaN : p[1] - q.ground[t]!;
}

/**
 * fix3b Y2: world y of the first wall voxel straight below p within maxM (what a person under the gate stands on: the
 * tile's ground is a 4 m tile's lowest dense layer, off by a step or a slope), NaN when none.
 */
export function groundBelow(walls: VoxelCollision, p: Vec3, maxM: number): number {
    const r = walls.voxelResolution;
    const o = { x: 0, y: 0, z: 0 };
    let g = NaN;
    for (let y = p[1]; y > p[1] - maxM; y -= r) {
        if (walls.querySphere(p[0], y, p[2], r * 0.6, o)) {
            g = y;
            break;
        }
    }
    if (!Number.isFinite(g)) return NaN;
    // fix3b Y3 pass 2: the sphere also touches an edge beside the column (a sill, a rail, a sparse layer) while the straight
    // ray falls 1.1 to 2.3 m further (gate-place-audit, page seeds: Tunis 828790525 gate 18, Wroclaw 971614346 gate 17);
    // there the ground under the gate is not known, so the cell gets none. Five rays (the centre and a cross of 0.3 voxel)
    // because a centre on a voxel face may go down either column
    const s = 0.3 * r;
    for (const [dx, dz] of [[0, 0], [-s, -s], [s, -s], [-s, s], [s, s]] as const) {
        const hit = walls.queryRay(p[0] + dx, p[1], p[2] + dz, 0, -1, 0, maxM + r);
        if (!hit || Math.abs(hit.y - g) > 2 * r) return NaN;
    }
    return g;
}

/** course4 C0: the ray ground under a gate is an object, not the street, when it stands this much over the tile's ground (estimate) */
export const OBJECT_M = 1.0;
/** course4 C0: the side rays that look for the street beside an object, flown m from the gate's column (estimate: wider than
 *  a parked car or a hedge, 1.8-2 m; the Wroclaw objects under gates 5 and 7 of seed 925664764 measured about 5 m along
 *  the opening, see docs/wip/fix3a.md course4) */
export const STAND_R_M = 2.5;

/**
 * course4 C0: the ground a person under the gate stands on. groundBelow, unless that is the top of an object on the street
 * (a car, a hedge, a kiosk: Wroclaw seed 925664764 gates 5 and 7 stood 1.7 m over such a top and 3.4 and 4.6 m over the
 * street, gate-place-map sections): when the ray ground is more than OBJECT_M over the tile's ground and at least two of
 * eight straight rays STAND_R_M around the column meet the tile's ground (within OBJECT_M / 2), the lowest of those is the
 * ground. A terrace or a raised floor is wider than STAND_R_M, so its rays stay up and it keeps its own ground.
 */
export function standGround(walls: VoxelCollision, q: QualityMap, p: Vec3, maxM: number): number {
    const g = groundBelow(walls, p, maxM);
    if (!Number.isFinite(g)) return g;
    const t = tileOf(q, p);
    const tg = t < 0 ? NaN : q.ground[t]!;
    if (!Number.isFinite(tg) || g - tg <= OBJECT_M) return g;
    const d = STAND_R_M, e = STAND_R_M * 0.7071;
    let low = Infinity, n = 0;
    for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d], [e, e], [-e, e], [e, -e], [-e, -e]] as const) {
        const hit = walls.queryRay(p[0] + dx, p[1], p[2] + dz, 0, -1, 0, p[1] - tg + OBJECT_M);
        if (hit && Math.abs(hit.y - tg) <= OBJECT_M / 2) {
            n++;
            low = Math.min(low, hit.y);
        }
    }
    return n >= 2 ? low : g;
}

/** fix3b Y2: the tile's quality (near) as a share of the scan's best quarter, 0 outside the map */
export function qualityShare(q: QualityMap, p: Vec3): number {
    const t = tileOf(q, p);
    return t < 0 || !(q.best > 0) ? 0 : q.near[t]! / q.best;
}

/** True when a world point is in a well-scanned tile and inside the dense band. */
export function inDenseBand(q: QualityMap, p: Vec3): boolean {
    const t = tileOf(q, p);
    if (t < 0 || !q.good[t]) return false;
    const h = p[1] - q.ground[t]!;
    return h >= q.band[0] && h <= q.band[1];
}
