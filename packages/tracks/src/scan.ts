// Lane gen4a (train 4, design gen4.md section 3): one analysis of the scan's walls that gives the course generator a quality
// map in the scan's own proportion, the scanned territory, the ground and roof heights and the scan's kind.
// Pure: integer grids and + - * / only (no DOM, no clock, no Math.random), so a worker and Node agree.
//
// What the walls are (measured over 12 scans by tools/bench/src/scan-kind-audit.ts --profile, evidence/2026-11-19/gen4/):
// SuperSplat's voxels are SOLID under every surface (a column is one run from the grid's bottom up to the ground or the
// roof; voxels per occupied block are 64 inside), and a scan that is closed all round (5dfeb49b) is solid up to the grid's
// top outside its bowl. So voxel density says nothing about detail; what a column says is where its air is.
//
//   columns   per column cell (g x g blocks) the occupied layers: the SURFACE (top of the lowest run), the air above it,
//             a CEILING (an occupied layer over at least CEIL_FREE_M x unit of air), LEAVES (an occupied layer over a
//             smaller gap), the ROOF (top of the highest run that has air over it), the runs. A column is TERRITORY when
//             it has voxels and at least CEIL_FREE_M x unit of air over its surface.
//   extent    the box holding all but EXTENT_TRIM of the territory columns at each side (floaters do not stretch it).
//   tiles     max(one cell, extentM / TILES_ACROSS), whole cells.
//   ground    groundTop = the GROUND_PCT percentile of the tile's surfaces (the street between the roofs, the floor).
//   roofTop   the ROOF_PCT percentile of the tile's roofs, the largest over the tile and its 8 neighbours.
//   ceiling   the median ceiling when at least CEIL_SHARE of the tile's territory has one.
//   quality   detail = the air's boundary per column (runs + half the surface steps to the next columns: a flat floor
//             is 1, a skull or a street of facades many) x territory cover, the mean over 3 x 3 tiles, over the
//             scan's best tenth, at most 1.
//   footprint tiles with territory in at least FOOT_COV of their cells, holes closed by FOOT_CLOSE tiles.
//   core      the centre of the CORE_R x extentM window richest in excess detail (over a flat floor's 1 a column);
//             coreRadiusM holds half that excess within
//             twice that window's size.
//   kind      the first rule that holds: room, plants, object, cityAbove, else street; no territory: unknown (KIND_RULES).
import { blockDims, forEachBlock } from '@gsfpv/collision';
import type { SceneTransform, Vec3, VoxelCollision } from './types';
import type { ScanKind } from './request';
import { sceneUnitM } from './freespace';

export interface ScanAnalysis {
    readonly kind: ScanKind;
    /** the scene's unit (sceneUnitM of the flight's transform) */
    readonly unitM: number;
    /** tile side, flown m: max(one block, extentM / 48) */
    readonly tileM: number;
    /** world x and z of tile (0, 0)'s low corner */
    readonly x0: number;
    readonly z0: number;
    readonly nx: number;
    readonly nz: number;
    /** 0..1 per tile, 1 = the scan's best tenth (the air's boundary per column x cover) */
    readonly quality: Float32Array;
    /** 1 = scanned territory: tiles with territory columns, holes closed by 2 tiles */
    readonly footprint: Uint8Array;
    /** world y of the TOP of the lowest run of the tile's columns (the ground between the roofs); NaN none */
    readonly groundTop: Float32Array;
    /** world y of the highest roofs in the tile and its 8 neighbours; NaN none */
    readonly roofTop: Float32Array;
    /** world y of the ceiling: an occupied layer over >= 1 m x unit of air in half the tile; NaN none */
    readonly ceiling: Float32Array;
    /** the centre of the scan's richest part, flown world */
    readonly core: Vec3;
    /** the radius around the core holding half the detail near it, flown m */
    readonly coreRadiusM: number;
    /** the scan's horizontal extent, flown m */
    readonly extentM: number;
    /** the measures the kind was decided by (the audit's table; thresholds in KIND_RULES) */
    readonly measures: ScanMeasures;
}

/** What the kind rules read, one number each (shares 0..1; heights flown m). Taken over the zone around the core. */
export interface ScanMeasures {
    readonly footprintTiles: number;
    /** footprint tiles within KIND_RULES.zoneR x coreRadiusM of the core: the zone the measures below are taken in */
    readonly zoneTiles: number;
    /** zone territory columns with a ceiling / zone territory columns */
    readonly ceilingShare: number;
    /** zone territory columns with leaves (an occupied layer over a gap under 1 m x unit) / zone territory columns */
    readonly leafShare: number;
    /** detail within OBJECT_R x extentM of the core / all detail */
    readonly coreDetailShare: number;
    /** the zone's roofs (ROOF_PCT) over its ground (GROUND_PCT), flown m */
    readonly reliefM: number;
    /** reliefM / extentM: a thing taller than its scan is wide is an object, a place is wide */
    readonly reliefShare: number;
}

/** Every number an estimate (design gen4.md section 3), set in stage A1 from tools/bench/src/scan-kind-audit.ts. */
export const SCAN_DEFAULTS = {
    tilesAcross: 48,
    extentTrim: 0.005, // share of the territory left out at each side of the extent (floaters)
    maxWords: 8_000_000, // the column cells' layer bits, 32-bit words (memory: 32 MB)
    ceilFreeM: 1, // x unit
    ceilShare: 0.5,
    groundPct: 0.25,
    roofPct: 0.9,
    footCov: 0.1,
    footClose: 2,
    bestPct: 0.9,
    coreR: 0.125 // x extentM
} as const;

/** The kind rules' thresholds (estimates set from the audit table in evidence/2026-11-19/gen4/scan-kinds.json, 12 scans:
 *  rooms 7a475d38 / 39e63ce9 ceiling 0.41 / 0.43 with leaves 0.35 / 0.33 (plants, furniture); streets ceiling 0.13-0.43,
 *  leaves 0-0.12; Lublin ceiling 0.13, relief 17 m; plants ab5efa0e leaves 0.35, ceiling 0.09; the housefly d10c5638
 *  relief 0.67 of its extent, every place under 0.3). */
export const KIND_RULES = {
    zoneR: 2, // x coreRadiusM
    objectR: 0.25, // x extentM (coreDetailShare; shown, no rule reads it: streets have 0.38-0.76)
    roomCeilingShare: 0.38,
    roomLeafMin: 0.2, // a roof over furnished space; a bare box is a room when closed (roomClosedShare)
    roomClosedShare: 0.6,
    roomLeafMax: 0.5, // over this the small gaps are a thing's legs and wings (d10c5638 0.55)
    plantsLeafShare: 0.3,
    plantsCeilingMax: 0.2,
    objectReliefShare: 0.4,
    cityReliefM: 6, // x unit
    cityCeilingMax: 0.15
} as const;

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** the p-th share of `v` (sorted in place); NaN for none */
function pct(v: number[], p: number): number {
    if (!v.length) return NaN;
    v.sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(v.length * p))]!;
}

/** low and high edge of the weighted distribution `w` (cells of side `cell` from `origin`) leaving out `trim` at each side */
function trimmedSpan(w: Float64Array, origin: number, cell: number, trim: number): [number, number] {
    let total = 0;
    for (const v of w) total += v;
    let acc = 0, lo = 0, hi = w.length - 1;
    for (let i = 0; i < w.length; i++) {
        acc += w[i]!;
        if (acc > trim * total) {
            lo = i;
            break;
        }
    }
    acc = 0;
    for (let i = w.length - 1; i >= 0; i--) {
        acc += w[i]!;
        if (acc > trim * total) {
            hi = i;
            break;
        }
    }
    return [origin + lo * cell, origin + (hi + 1) * cell];
}

/** The analysis of the flown walls `walls` (the transform gives the scene's unit). */
export function analyzeScan(walls: VoxelCollision, transform: SceneTransform): ScanAnalysis {
    const S = SCAN_DEFAULTS, K = KIND_RULES;
    const unitM = sceneUnitM(transform as unknown as number[]);
    const flip = walls.flipXY;
    const blockM = 4 * walls.voxelResolution;
    const [nbx, nby, nbz] = blockDims(walls);
    const gx = walls.gridMinX, gy = walls.gridMinY, gz = walls.gridMinZ;
    // world block column (cx, cz) from the stored block indices: a legacy grid stores x and y negated
    const colX = (bx: number): number => (flip ? nbx - 1 - bx : bx);
    const wx0 = flip ? -(gx + nbx * blockM) : gx;
    const wz0 = gz;
    const ny = nby;
    const layerY = (L: number): number => (flip ? -(gy + (ny - L) * blockM) : gy + L * blockM); // bottom of layer L

    // column cells of g x g blocks: the occupied layers as bits (a layer is on when any block of the cell holds a voxel)
    const W = Math.ceil(ny / 32);
    let g = 1;
    while (Math.ceil(nbx / g) * Math.ceil(nbz / g) * W > S.maxWords) g *= 2;
    const ncx = Math.ceil(nbx / g), ncz = Math.ceil(nbz / g), nc = ncx * ncz;
    const bits = new Uint32Array(nc * W);
    const cellVox = new Float64Array(nc);
    forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
        const n = popcount(lo >>> 0) + popcount(hi >>> 0);
        if (!n) return;
        const c = Math.floor(bz / g) * ncx + Math.floor(colX(bx) / g);
        const L = flip ? ny - 1 - by : by;
        bits[c * W + (L >> 5)] |= 1 << (L & 31);
        cellVox[c] += n;
    });
    const on = (c: number, L: number): boolean => ((bits[c * W + (L >> 5)]! >>> (L & 31)) & 1) === 1;

    // per column cell: surface, ceiling, leaves, roof, runs, territory
    const freeL = Math.max(1, Math.ceil((S.ceilFreeM * unitM) / blockM - 1e-9));
    const surf = new Int32Array(nc).fill(-1), ceilL = new Int32Array(nc).fill(-1), roofL = new Int32Array(nc).fill(-1);
    const runs = new Uint16Array(nc), leaf = new Uint8Array(nc), terr = new Uint8Array(nc);
    for (let c = 0; c < nc; c++) {
        if (!cellVox[c]) continue;
        let L = 0;
        while (!on(c, L)) L++;
        while (L < ny && on(c, L)) L++;
        surf[c] = L; // the layer over the lowest run
        let n = 1, gap = 0, maxGap = 0, roof = L, runStart = 0;
        for (let j = L; j < ny; j++) {
            if (on(c, j)) {
                if (gap > 0) {
                    n++;
                    runStart = j;
                    if (gap >= freeL && ceilL[c]! < 0) ceilL[c] = j;
                    if (n === 2 && gap < freeL) leaf[c] = 1;
                    maxGap = Math.max(maxGap, gap);
                }
                gap = 0;
            } else {
                if (gap === 0) roof = j; // the top of the run under this air
                gap++;
            }
        }
        // the air over the grid's top is open sky; a column capped by solid up to the grid's top (a closed scan's
        // outside) is not open, and its roof is the cap's bottom
        const open = L < ny && gap > 0;
        roofL[c] = open ? roof : n > 1 ? runStart : L;
        runs[c] = n;
        if (open || maxGap >= freeL) terr[c] = 1;
    }

    // the extent over the territory columns
    const cellM = g * blockM;
    const margX = new Float64Array(ncx), margZ = new Float64Array(ncz);
    let terrAll = 0;
    for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) if (terr[cz * ncx + cx]) {
        margX[cx]++;
        margZ[cz]++;
        terrAll++;
    }
    const [ex0, ex1] = terrAll ? trimmedSpan(margX, wx0, cellM, S.extentTrim) : [wx0, wx0 + cellM];
    const [ez0, ez1] = terrAll ? trimmedSpan(margZ, wz0, cellM, S.extentTrim) : [wz0, wz0 + cellM];
    const extentM = Math.max(ex1 - ex0, ez1 - ez0);

    // tiles: k cells a side, the extent plus FOOT_CLOSE tiles around it so the closing has room
    const k = Math.max(1, Math.ceil(extentM / S.tilesAcross / cellM));
    const tileM = k * cellM;
    const pad = S.footClose;
    const c0x = Math.max(0, Math.floor((ex0 - wx0) / cellM) - pad * k);
    const c0z = Math.max(0, Math.floor((ez0 - wz0) / cellM) - pad * k);
    const c1x = Math.min(ncx, Math.ceil((ex1 - wx0) / cellM - 1e-9) + pad * k);
    const c1z = Math.min(ncz, Math.ceil((ez1 - wz0) / cellM - 1e-9) + pad * k);
    const nx = Math.max(1, Math.ceil((c1x - c0x) / k)), nz = Math.max(1, Math.ceil((c1z - c0z) / k));
    const x0 = wx0 + c0x * cellM, z0 = wz0 + c0z * cellM;
    const nt = nx * nz;

    // per tile from its cells: cover, ground, roof, ceiling, detail
    const groundTop = new Float32Array(nt).fill(NaN), roofOwn = new Float32Array(nt).fill(NaN), ceiling = new Float32Array(nt).fill(NaN);
    const cover = new Float64Array(nt), detail = new Float64Array(nt), raw = new Float64Array(nt);
    const terrN = new Float64Array(nt), ceilN = new Float64Array(nt), leafN = new Float64Array(nt);
    for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
        const t = tz * nx + tx;
        const s: number[] = [], r: number[] = [], ce: number[] = [];
        let cells = 0, area = 0;
        for (let cz = c0z + tz * k; cz < Math.min(ncz, c0z + (tz + 1) * k); cz++) for (let cx = c0x + tx * k; cx < Math.min(ncx, c0x + (tx + 1) * k); cx++) {
            cells++;
            const c = cz * ncx + cx;
            if (!terr[c]) continue;
            s.push(layerY(surf[c]!));
            r.push(layerY(roofL[c]!));
            if (ceilL[c]! >= 0) ce.push(layerY(ceilL[c]!));
            if (leaf[c]) leafN[t]++;
            area += runs[c]!;
            // half the surface steps to the four neighbours (each step shared by two columns)
            if (cx + 1 < ncx && terr[c + 1]) area += Math.abs(surf[c]! - surf[c + 1]!) / 2;
            if (cx > 0 && terr[c - 1]) area += Math.abs(surf[c]! - surf[c - 1]!) / 2;
            if (cz + 1 < ncz && terr[c + ncx]) area += Math.abs(surf[c]! - surf[c + ncx]!) / 2;
            if (cz > 0 && terr[c - ncx]) area += Math.abs(surf[c]! - surf[c - ncx]!) / 2;
        }
        terrN[t] = s.length;
        ceilN[t] = ce.length;
        if (!s.length || !cells) continue;
        cover[t] = s.length / cells;
        detail[t] = area - s.length; // the excess over a flat floor (1 a column): what the core and the object rule weigh
        raw[t] = cover[t]! * (area / s.length);
        groundTop[t] = pct(s, S.groundPct);
        roofOwn[t] = pct(r, S.roofPct) + blockM;
        if (ce.length >= S.ceilShare * s.length) ceiling[t] = pct(ce, 0.5);
    }

    // footprint: tiles with territory in FOOT_COV of their cells, closed by FOOT_CLOSE tiles (dilate, then erode)
    let foot: Uint8Array = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) if (cover[t]! >= S.footCov) foot[t] = 1;
    const grow = (src: Uint8Array, want: number): Uint8Array => {
        const out = new Uint8Array(nt);
        for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
            let hit = want === 1 ? 0 : 1;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const X = tx + dx, Z = tz + dz;
                const v = X >= 0 && Z >= 0 && X < nx && Z < nz ? src[Z * nx + X]! : 0;
                if (want === 1 && v) hit = 1;
                if (want === 0 && !v) hit = 0;
            }
            out[tz * nx + tx] = hit;
        }
        return out;
    };
    const seen = foot;
    for (let i = 0; i < S.footClose; i++) foot = grow(foot, 1);
    for (let i = 0; i < S.footClose; i++) foot = grow(foot, 0);
    for (let t = 0; t < nt; t++) if (seen[t]) foot[t] = 1;

    // roofTop over the 3 x 3 tiles; quality over 3 x 3 tiles, over the best tenth of the footprint
    const roofTop = new Float32Array(nt).fill(NaN);
    const q3 = new Float64Array(nt);
    for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
        let rr = -Infinity, sum = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const X = tx + dx, Z = tz + dz;
            if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
            const v = roofOwn[Z * nx + X]!;
            if (Number.isFinite(v)) rr = Math.max(rr, v);
            sum += raw[Z * nx + X]!;
        }
        if (Number.isFinite(rr)) roofTop[tz * nx + tx] = rr;
        q3[tz * nx + tx] = sum / 9;
    }
    const inFoot: number[] = [];
    for (let t = 0; t < nt; t++) if (foot[t]) inFoot.push(q3[t]!);
    const best = inFoot.length ? pct(inFoot, S.bestPct) : 0;
    const quality = new Float32Array(nt);
    for (let t = 0; t < nt; t++) if (foot[t] && best > 0) quality[t] = Math.min(1, q3[t]! / best);

    // core: the window of CORE_R x extentM richest in detail (a box sum over the footprint's detail)
    const centre = (t: number): [number, number] => [x0 + ((t % nx) + 0.5) * tileM, z0 + ((t - (t % nx)) / nx + 0.5) * tileM];
    const m = Math.max(1, Math.round((S.coreR * extentM) / tileM));
    let bestT = -1, bestSum = -1;
    for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
        if (!foot[tz * nx + tx]) continue;
        let sum = 0;
        for (let Z = Math.max(0, tz - m); Z <= Math.min(nz - 1, tz + m); Z++) for (let X = Math.max(0, tx - m); X <= Math.min(nx - 1, tx + m); X++) {
            if (foot[Z * nx + X]) sum += detail[Z * nx + X]!;
        }
        if (sum > bestSum) {
            bestSum = sum;
            bestT = tz * nx + tx;
        }
    }
    const midY = layerY(0) + (ny * blockM) / 2;
    let core: Vec3 = [(ex0 + ex1) / 2, midY, (ez0 + ez1) / 2];
    if (bestT >= 0) {
        // the detail-weighted centroid over twice the window's size: an object at the window's edge pulls it back
        let w = 0, sx = 0, sz = 0;
        const btx = bestT % nx, btz = (bestT - btx) / nx, m2 = 2 * m;
        for (let Z = Math.max(0, btz - m2); Z <= Math.min(nz - 1, btz + m2); Z++) for (let X = Math.max(0, btx - m2); X <= Math.min(nx - 1, btx + m2); X++) {
            const t = Z * nx + X;
            if (!foot[t] || !detail[t]) continue;
            const [x, z] = centre(t);
            w += detail[t]!;
            sx += detail[t]! * x;
            sz += detail[t]! * z;
        }
        const g0 = groundTop[bestT]!, r0 = Number.isFinite(ceiling[bestT]!) ? ceiling[bestT]! : roofTop[bestT]!;
        const y = Number.isFinite(g0) && Number.isFinite(r0) ? (g0 + r0) / 2 : Number.isFinite(g0) ? g0 : midY;
        core = w > 0 ? [sx / w, y, sz / w] : [centre(bestT)[0], y, centre(bestT)[1]];
    }
    const dist = (t: number): number => {
        const [x, z] = centre(t);
        return Math.sqrt((x - core[0]) * (x - core[0]) + (z - core[2]) * (z - core[2]));
    };
    const near: number[] = [];
    let nearW = 0;
    for (let t = 0; t < nt; t++) if (foot[t] && detail[t]! > 0 && dist(t) <= 2 * m * tileM) {
        near.push(t);
        nearW += detail[t]!;
    }
    near.sort((a, b) => dist(a) - dist(b));
    let half = 0, coreRadiusM = tileM / 2;
    for (const t of near) {
        half += detail[t]!;
        if (half >= nearW / 2) {
            coreRadiusM = Math.max(tileM / 2, dist(t) + tileM / 2);
            break;
        }
    }

    // the measures in the core's zone and the kind
    let footTiles = 0, zoneTiles = 0, zT = 0, zC = 0, zL = 0, allD = 0, nearD = 0;
    const zg: number[] = [], zr: number[] = [];
    const objR = K.objectR * extentM, zoneR = K.zoneR * coreRadiusM;
    for (let t = 0; t < nt; t++) {
        if (!foot[t]) continue;
        footTiles++;
        allD += detail[t]!;
        if (dist(t) <= objR) nearD += detail[t]!;
        if (dist(t) > zoneR) continue;
        zoneTiles++;
        zT += terrN[t]!;
        zC += ceilN[t]!;
        zL += leafN[t]!;
        if (Number.isFinite(groundTop[t]!)) zg.push(groundTop[t]!);
        if (Number.isFinite(roofOwn[t]!)) zr.push(roofOwn[t]!);
    }
    const reliefM = zg.length && zr.length ? Math.max(0, pct(zr, S.roofPct) - pct(zg, S.groundPct)) : 0;
    const measures: ScanMeasures = {
        footprintTiles: footTiles,
        zoneTiles,
        ceilingShare: zT ? zC / zT : 0,
        leafShare: zT ? zL / zT : 0,
        coreDetailShare: allD ? nearD / allD : 0,
        reliefM,
        reliefShare: extentM > 0 ? reliefM / extentM : 0
    };
    const kind = scanKind(measures, unitM);
    return { kind, unitM, tileM, x0, z0, nx, nz, quality, footprint: foot, groundTop, roofTop, ceiling, core, coreRadiusM, extentM, measures };
}

/** The scan's kind from its measures: the first rule of KIND_RULES that holds; an open scan none of them names is a
 *  street (gates at eye height over the ground), a scan without territory unknown. */
export function scanKind(m: ScanMeasures, unitM: number): ScanKind {
    const K = KIND_RULES;
    if (m.footprintTiles === 0) return 'unknown';
    const furnished = m.leafShare >= K.roomLeafMin && m.leafShare < K.roomLeafMax;
    if (m.ceilingShare >= K.roomCeilingShare && (furnished || (m.ceilingShare >= K.roomClosedShare && m.leafShare < K.roomLeafMax))) return 'room';
    if (m.leafShare >= K.plantsLeafShare && m.ceilingShare < K.plantsCeilingMax) return 'plants';
    if (m.reliefShare >= K.objectReliefShare) return 'object';
    if (m.reliefM >= K.cityReliefM * unitM && m.ceilingShare <= K.cityCeilingMax) return 'cityAbove';
    return 'street';
}

/** The tile of a world point, -1 outside the analysis. */
export function scanTile(a: ScanAnalysis, p: Vec3): number {
    const tx = Math.floor((p[0] - a.x0) / a.tileM), tz = Math.floor((p[2] - a.z0) / a.tileM);
    if (tx < 0 || tz < 0 || tx >= a.nx || tz >= a.nz) return -1;
    return tz * a.nx + tx;
}
