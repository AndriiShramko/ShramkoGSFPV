// Lane gen4a (train 4, design gen4.md section 3): one analysis of the scan's walls that gives the course generator a quality
// map in the scan's own proportion, the scanned territory, the ground and roof heights and the scan's kind.
// Pure: integer grids and + - * / only (no DOM, no clock, no Math.random), so a worker and Node agree.
//
//   columns   pass 1: voxels per column cell over the whole grid; the scan's extent is the box holding all but EXTENT_TRIM of
//             the voxels at each side (floaters far away do not stretch it).
//   tiles     pass 2: the extent cut into tiles of max(one block, extentM / TILES_ACROSS), whole blocks; per tile and block
//             layer the voxels and the occupied blocks. A layer's cover = occupied blocks / block columns of the tile.
//   ground    the lowest run of layers from the first with cover >= GROUND_COV while cover stays >= max(RUN_MIN_COV,
//             RUN_REL x the run's peak): a drone scan's thick fuzzy shell is one run, and groundTop is its TOP.
//   roofTop   the highest layer with cover >= ROOF_COV, the largest over the tile and its 8 neighbours.
//   ceiling   the first layer above the ground with cover >= CEIL_COV and at least CEIL_FREE_M x unit of thin layers under it.
//   quality   crisp (voxels per occupied block / CRISP_FULL: a sharp surface fills 16 of a block's 64, fuzz and floaters
//             1-3) x cover (occupied blocks / (block columns x COVER_LAYERS)), the mean over 3 x 3 tiles, over the scan's
//             best quarter, at most 1.
//   footprint tiles whose column cells hold voxels in at least FOOT_COV of them, holes closed by FOOT_CLOSE tiles.
//   core      the quality-weighted centroid of the footprint's top CORE_SHARE of tiles; coreRadiusM holds half that weight.
//   kind      the first rule that holds: room, object, cityAbove, plants, street, else unknown (KIND_RULES).
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
    /** 0..1 per tile, 1 = the scan's best quarter (crisp x coverage) */
    readonly quality: Float32Array;
    /** 1 = scanned territory: tiles with voxels, holes closed by 2 tiles */
    readonly footprint: Uint8Array;
    /** world y of the TOP of the lowest dense run of layers; NaN none */
    readonly groundTop: Float32Array;
    /** world y of the highest dense layer in the tile and its 8 neighbours; NaN none */
    readonly roofTop: Float32Array;
    /** world y of the first dense layer above groundTop with >= 1 m free under it; NaN none */
    readonly ceiling: Float32Array;
    /** the quality-weighted centroid of the best tiles, flown world */
    readonly core: Vec3;
    /** the radius around the core holding half the best tiles' weight, flown m */
    readonly coreRadiusM: number;
    /** the scan's horizontal extent, flown m */
    readonly extentM: number;
    /** the measures the kind was decided by (the audit's table; thresholds in KIND_RULES) */
    readonly measures: ScanMeasures;
}

/** What the kind rules read, one number each (all shares 0..1; heights flown m). */
export interface ScanMeasures {
    readonly footprintTiles: number;
    /** footprint tiles within KIND_RULES.zoneR x coreRadiusM of the core: the zone the measures below are taken in */
    readonly zoneTiles: number;
    /** zone tiles with a ceiling / zone tiles */
    readonly ceilingShare: number;
    /** voxels within OBJECT_R x extentM of the core / all voxels */
    readonly coreVoxelShare: number;
    /** median over the zone of roofTop - groundTop, flown m */
    readonly reliefM: number;
    /** median over the zone of voxels per occupied block in the ground run's layers (of 64) */
    readonly groundCrisp: number;
    /** median over the zone of voxels per occupied block above the ground run (of 64) */
    readonly upperCrisp: number;
    /** occupied blocks / all blocks from the ground run's bottom to roofTop, over the core's tiles */
    readonly coreFill: number;
}

/** Every number an estimate (design gen4.md section 3), set in stage A1 from tools/bench/src/scan-kind-audit.ts. */
export const SCAN_DEFAULTS = {
    tilesAcross: 48,
    extentTrim: 0.005, // share of the voxels left out at each side of the extent (floaters)
    maxCells: 4_000_000, // pass 1's column cells (memory: 16 MB)
    groundCov: 0.2,
    runMinCov: 0.12,
    runRel: 0.5,
    roofCov: 0.1,
    ceilCov: 0.5,
    ceilFreeM: 1, // x unit
    crispFull: 16,
    coverLayers: 2,
    footCov: 0.1,
    footClose: 2,
    coreShare: 0.1
} as const;

/** The kind rules' thresholds (estimates; the audit table in evidence/2026-11-19/gen4/scan-kinds.json). */
export const KIND_RULES = {
    zoneR: 2, // x coreRadiusM
    roomCeilingShare: 0.6,
    objectR: 0.25, // x extentM
    objectVoxelShare: 0.5,
    cityReliefM: 6, // x unit
    cityGroundRel: 0.5, // ground crisp < this x upper crisp
    plantsFill: 0.25
} as const;

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

function median(v: number[]): number {
    if (!v.length) return NaN;
    v.sort((a, b) => a - b);
    return v[v.length >> 1]!;
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
    const layerY = (L: number): number => (flip ? -(gy + (nby - L) * blockM) : gy + L * blockM); // bottom of layer L

    // pass 1: voxels per column cell of g x g blocks
    let g = 1;
    while (Math.ceil(nbx / g) * Math.ceil(nbz / g) > S.maxCells) g *= 2;
    const ncx = Math.ceil(nbx / g), ncz = Math.ceil(nbz / g);
    const cellVox = new Float64Array(ncx * ncz), cellBlocks = new Float64Array(ncx * ncz);
    let allVox = 0;
    forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, _by, bz, lo, hi) => {
        const n = popcount(lo >>> 0) + popcount(hi >>> 0);
        const c = Math.floor(bz / g) * ncx + Math.floor(colX(bx) / g);
        cellVox[c] += n;
        cellBlocks[c]++;
        allVox += n;
    });
    const cellM = g * blockM;
    const margX = new Float64Array(ncx), margZ = new Float64Array(ncz);
    for (let cz = 0; cz < ncz; cz++) for (let cx = 0; cx < ncx; cx++) {
        // the extent is weighed by occupied blocks, not voxels: a solid object does not outweigh the thin surfaces around it
        const v = cellBlocks[cz * ncx + cx]!;
        margX[cx] += v;
        margZ[cz] += v;
    }
    const [ex0, ex1] = allVox ? trimmedSpan(margX, wx0, cellM, S.extentTrim) : [wx0, wx0 + cellM];
    const [ez0, ez1] = allVox ? trimmedSpan(margZ, wz0, cellM, S.extentTrim) : [wz0, wz0 + cellM];
    const extentM = Math.max(ex1 - ex0, ez1 - ez0);

    // tiles: k cells a side (whole blocks), the extent plus FOOT_CLOSE tiles around it so the closing has room
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
    const tileOfCell = (cx: number, cz: number): number => {
        const tx = Math.floor((cx - c0x) / k), tz = Math.floor((cz - c0z) / k);
        return tx < 0 || tz < 0 || tx >= nx || tz >= nz ? -1 : tz * nx + tx;
    };
    // block columns and voxel-holding cells per tile
    const cols = new Float64Array(nt), cellsIn = new Float64Array(nt), cellsHit = new Float64Array(nt), tileVox = new Float64Array(nt);
    for (let cz = c0z; cz < Math.min(ncz, c0z + nz * k); cz++) for (let cx = c0x; cx < Math.min(ncx, c0x + nx * k); cx++) {
        const t = tileOfCell(cx, cz);
        if (t < 0) continue;
        cols[t] += Math.min(g, nbx - cx * g) * Math.min(g, nbz - cz * g);
        cellsIn[t]++;
        const v = cellVox[cz * ncx + cx]!;
        if (v > 0) cellsHit[t]++;
        tileVox[t] += v;
    }

    // pass 2: voxels and occupied blocks per tile and layer
    const ny = nby;
    const vox = new Float64Array(nt * ny), occ = new Float64Array(nt * ny);
    const sumY = new Float64Array(nt);
    forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
        const t = tileOfCell(Math.floor(colX(bx) / g), Math.floor(bz / g));
        if (t < 0) return;
        const L = flip ? nby - 1 - by : by;
        const n = popcount(lo >>> 0) + popcount(hi >>> 0);
        vox[t * ny + L] += n;
        occ[t * ny + L] += 1;
        sumY[t] += n * (layerY(L) + blockM / 2);
    });

    // per tile: ground run, roof, ceiling, crisp, raw quality
    const groundTop = new Float32Array(nt).fill(NaN);
    const groundBot = new Int32Array(nt).fill(-1);
    const groundEnd = new Int32Array(nt).fill(-1);
    const roofL = new Int32Array(nt).fill(-1);
    const ceiling = new Float32Array(nt).fill(NaN);
    const raw = new Float64Array(nt); // crisp x cover
    const crispG = new Float64Array(nt).fill(NaN), crispU = new Float64Array(nt).fill(NaN);
    const freeL = Math.max(1, Math.ceil((S.ceilFreeM * unitM) / blockM - 1e-9));
    for (let t = 0; t < nt; t++) {
        const c = cols[t]!;
        if (!(c > 0)) continue;
        const cov = (L: number): number => occ[t * ny + L]! / c;
        let L = 0;
        while (L < ny && cov(L) < S.groundCov) L++;
        if (L < ny) {
            groundBot[t] = L;
            let peak = cov(L), e = L;
            while (e + 1 < ny && cov(e + 1) >= Math.max(S.runMinCov, S.runRel * peak)) {
                e++;
                peak = Math.max(peak, cov(e));
            }
            groundEnd[t] = e;
            groundTop[t] = layerY(e + 1);
            let free = 0;
            for (let j = e + 1; j < ny; j++) {
                if (cov(j) >= S.ceilCov) {
                    if (free >= freeL) {
                        ceiling[t] = layerY(j);
                        break;
                    }
                    free = 0;
                } else free++;
            }
        }
        for (let j = ny - 1; j >= 0; j--) if (cov(j) >= S.roofCov) {
            roofL[t] = j;
            break;
        }
        let vG = 0, oG = 0, vU = 0, oU = 0;
        for (let j = 0; j < ny; j++) {
            const inGround = groundEnd[t]! >= 0 && j <= groundEnd[t]!;
            if (inGround) {
                vG += vox[t * ny + j]!;
                oG += occ[t * ny + j]!;
            } else {
                vU += vox[t * ny + j]!;
                oU += occ[t * ny + j]!;
            }
        }
        if (oG > 0) crispG[t] = vG / oG;
        if (oU > 0) crispU[t] = vU / oU;
        const o = oG + oU;
        if (o > 0) raw[t] = Math.min(1, (vG + vU) / o / S.crispFull) * Math.min(1, o / (c * S.coverLayers));
    }

    // footprint: tiles with voxels in FOOT_COV of their cells, closed by FOOT_CLOSE tiles (dilate, then erode)
    let foot: Uint8Array = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) if (cellsIn[t]! > 0 && cellsHit[t]! >= S.footCov * cellsIn[t]!) foot[t] = 1;
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

    // roofTop over the 3 x 3 tiles; quality over 3 x 3 tiles, over the best quarter of the footprint
    const roofTop = new Float32Array(nt).fill(NaN);
    const q3 = new Float64Array(nt);
    for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
        let r = -1, s = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const X = tx + dx, Z = tz + dz;
            if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
            r = Math.max(r, roofL[Z * nx + X]!);
            s += raw[Z * nx + X]!;
        }
        if (r >= 0) roofTop[tz * nx + tx] = layerY(r + 1);
        q3[tz * nx + tx] = s / 9;
    }
    const inFoot: number[] = [];
    for (let t = 0; t < nt; t++) if (foot[t]) inFoot.push(q3[t]!);
    inFoot.sort((a, b) => a - b);
    const best = inFoot.length ? inFoot[Math.min(inFoot.length - 1, Math.floor(inFoot.length * 0.75))]! : 0;
    const quality = new Float32Array(nt);
    for (let t = 0; t < nt; t++) if (foot[t] && best > 0) quality[t] = Math.min(1, q3[t]! / best);

    // core: the top CORE_SHARE of the footprint by q3, weighted by q3
    const cut = inFoot.length ? inFoot[Math.min(inFoot.length - 1, Math.floor(inFoot.length * (1 - S.coreShare)))]! : 0;
    const centre = (t: number): [number, number] => [x0 + ((t % nx) + 0.5) * tileM, z0 + ((t - (t % nx)) / nx + 0.5) * tileM];
    let W = 0, cxw = 0, czw = 0, cyw = 0, cyW = 0;
    const top: number[] = [];
    for (let t = 0; t < nt; t++) if (foot[t] && q3[t]! >= cut && q3[t]! > 0) {
        const w = q3[t]!;
        const [x, z] = centre(t);
        W += w;
        cxw += w * x;
        czw += w * z;
        if (tileVox[t]! > 0) {
            cyw += w * (sumY[t]! / tileVox[t]!);
            cyW += w;
        }
        top.push(t);
    }
    const midY = layerY(0) + (ny * blockM) / 2;
    const core: Vec3 = W > 0 ? [cxw / W, cyW > 0 ? cyw / cyW : midY, czw / W] : [(ex0 + ex1) / 2, midY, (ez0 + ez1) / 2];
    const dist = (t: number): number => {
        const [x, z] = centre(t);
        return Math.sqrt((x - core[0]) * (x - core[0]) + (z - core[2]) * (z - core[2]));
    };
    top.sort((a, b) => dist(a) - dist(b));
    let half = 0, coreRadiusM = tileM / 2;
    for (const t of top) {
        half += q3[t]!;
        if (half >= W / 2) {
            coreRadiusM = Math.max(tileM / 2, dist(t) + tileM / 2);
            break;
        }
    }

    // the measures and the kind
    let footTiles = 0, ceil = 0, nearVox = 0, fillOcc = 0, fillAll = 0;
    const relief: number[] = [], cg: number[] = [], cu: number[] = [];
    const objR = K.objectR * extentM;
    // the kind is judged in the core's zone (a scan's sparse surroundings are most of its footprint: 5dfeb49b's skull lies
    // in 132 m of fuzz, Winter Garden's glass house in 153 m of garden)
    const zoneR = K.zoneR * coreRadiusM;
    let zoneTiles = 0;
    for (let t = 0; t < nt; t++) {
        if (dist(t) <= objR) nearVox += tileVox[t]!;
        if (!foot[t]) continue;
        footTiles++;
        if (dist(t) > zoneR) continue;
        zoneTiles++;
        if (Number.isFinite(ceiling[t]!)) ceil++;
        if (Number.isFinite(groundTop[t]!) && Number.isFinite(roofTop[t]!)) relief.push(roofTop[t]! - groundTop[t]!);
        if (Number.isFinite(crispG[t]!)) cg.push(crispG[t]!);
        if (Number.isFinite(crispU[t]!)) cu.push(crispU[t]!);
        if (dist(t) <= coreRadiusM && groundBot[t]! >= 0 && roofL[t]! >= groundBot[t]!) {
            for (let j = groundBot[t]!; j <= roofL[t]!; j++) fillOcc += occ[t * ny + j]!;
            fillAll += cols[t]! * (roofL[t]! - groundBot[t]! + 1);
        }
    }
    const measures: ScanMeasures = {
        footprintTiles: footTiles,
        zoneTiles,
        ceilingShare: zoneTiles ? ceil / zoneTiles : 0,
        coreVoxelShare: allVox ? nearVox / allVox : 0,
        reliefM: relief.length ? median(relief) : 0,
        groundCrisp: cg.length ? median(cg) : 0,
        upperCrisp: cu.length ? median(cu) : 0,
        coreFill: fillAll ? fillOcc / fillAll : 0
    };
    const kind = scanKind(measures, unitM);
    return { kind, unitM, tileM, x0, z0, nx, nz, quality, footprint: foot, groundTop, roofTop, ceiling, core, coreRadiusM, extentM, measures };
}

/** The scan's kind from its measures: the first rule of KIND_RULES that holds. */
export function scanKind(m: ScanMeasures, unitM: number): ScanKind {
    const K = KIND_RULES;
    if (m.footprintTiles === 0) return 'unknown';
    if (m.ceilingShare >= K.roomCeilingShare) return 'room';
    if (m.coreVoxelShare >= K.objectVoxelShare) return 'object';
    if (m.reliefM >= K.cityReliefM * unitM && m.groundCrisp < K.cityGroundRel * m.upperCrisp) return 'cityAbove';
    if (m.coreFill >= K.plantsFill) return 'plants';
    if (m.groundCrisp >= m.upperCrisp) return 'street';
    return 'unknown';
}

/** The tile of a world point, -1 outside the analysis. */
export function scanTile(a: ScanAnalysis, p: Vec3): number {
    const tx = Math.floor((p[0] - a.x0) / a.tileM), tz = Math.floor((p[2] - a.z0) / a.tileM);
    if (tx < 0 || tz < 0 || tx >= a.nx || tz >= a.nz) return -1;
    return tz * a.nx + tx;
}
