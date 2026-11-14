// Free space of a scan from its voxel walls (docs/wip/tracks-plan.md 2.1, requirement R3). Pure: no DOM, no clock, no
// Math.random; integer grids and + - * /, Math.sqrt only, so a worker and Node give the same cells.
//
//   cells      one cell per g x g x g voxel blocks (a block is 4x4x4 voxels), g the smallest that keeps the box under
//              maxCells and a cell at least 10 cm; a cell is solid when any voxel of its blocks is (forEachBlock).
//   clearance  a 3-4-5 chamfer distance transform over the cells: per free cell the distance to the nearest solid cell.
//   reachable  a 6-connected flood fill from the spawn over cells with clearance >= the margin: nothing behind a wall,
//              inside a wall or inside an object, because no passage the craft fits through leads there.
//   scanned    the enclosure score: 26 rays per reachable cell up to rayM; holes of a badly scanned wall, open sky and the
//              scan's edge let rays out. Indoors a cell needs enclosureMin of its rays to hit. Outdoors (or detected: the
//              fill reaches more than outdoorShare of the box's border cells) the down ray must hit within 6 m and the
//              nearest wall be within 8 m. A second flood fill keeps the well scanned cells joined to the spawn.
//   rooms      components of the well scanned cells after one erosion step, grown back; rooms under minRoomM3 are dropped.
// The walls are the flown walls (transformCollision), so every length here is a flown metre. A legacy (format 1.0) grid
// stores x and y negated: the cells are built in the file's index space and turned to world points by cellCentre.
import { blockDims, forEachBlock } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import type { Vec3 } from '@shramko/sonic-fpv';

export interface FreeSpaceOptions {
    /** where the course starts, flown world (the scene's spawn) */
    readonly spawn: Vec3;
    /** the craft's clearance, flown m (MARGIN_M of the proof) */
    readonly marginM?: number;
    /** the box around the spawn that is looked at, flown m per side */
    readonly boxM?: number;
    /** the most cells the box may have (memory: about 10 bytes a cell) */
    readonly maxCells?: number;
    /** share of the 26 rays that must hit a wall indoors */
    readonly enclosureMin?: number;
    /** how far an enclosure ray looks, flown m */
    readonly rayM?: number;
    /** a room smaller than this gets no gate, flown m3 */
    readonly minRoomM3?: number;
    /** indoor or outdoor rules; auto: outdoor when the fill reaches more than outdoorShare of the box border */
    readonly kind?: 'auto' | 'indoor' | 'outdoor';
    /** false only for the negative control of the tests: every cell with clearance counts, joined to the spawn or not */
    readonly floodFill?: boolean;
}

/** The defaults. Every one is an estimate from tracks-plan.md 2.1 except where tools/bench/src/tracks-generate.ts says it measured it. */
export const FREE_DEFAULTS = {
    marginM: 0.5, // the proof's MARGIN_M (check.ts)
    boxM: 80, // estimate (plan 2.1 step 3)
    maxCells: 4_000_000, // estimate: about 40 MB of arrays; time and memory of the pass measured in tracks-generate.ts
    enclosureMin: 0.7, // estimate (plan 2.1 step 4); the hole test holds it to a 2 m hole
    rayM: 12, // estimate (plan 2.1 step 4)
    minRoomM3: 8, // estimate (plan 2.1 step 4)
    outdoorShare: 0.3, // estimate (plan 2.1 step 4)
    outdoorDownM: 6, // estimate (plan 2.1 step 4)
    outdoorNearM: 8, // estimate (plan 2.1 step 4)
    minCellM: 0.1 // estimate (plan 2.1 step 1: a cell is 10-25 cm on fine walls)
} as const;

export interface FreeRoom {
    readonly id: number;
    readonly cells: number;
    readonly volumeM3: number;
    /** flown world */
    readonly centroid: Vec3;
}

export interface FreeSpace {
    readonly cellM: number;
    /** file-space corner of cell 0 (the grid's own frame; cellCentre turns it into the world) */
    readonly origin: Vec3;
    readonly dims: readonly [number, number, number];
    readonly flip: boolean;
    readonly marginM: number;
    /** 1 where a cell holds a wall voxel */
    readonly solid: Uint8Array;
    /** chamfer distance to the nearest solid cell, 3 = one cell (65535: none in the box) */
    readonly clearance: Uint16Array;
    /** the room of a usable cell (reachable, well scanned, in a room big enough), -1 otherwise */
    readonly room: Int16Array;
    readonly rooms: readonly FreeRoom[];
    /** volume of the usable cells, flown m3 */
    readonly volumeM3: number;
    readonly outdoor: boolean;
    /** the usable cell nearest the spawn, -1 when there is none */
    readonly startCell: number;
    readonly stats: { readonly cells: number; readonly solid: number; readonly reachable: number; readonly scanned: number; readonly usable: number; readonly group: number };
    /** FNV-1a 32 of the parameters, the grid and the rooms */
    readonly digest: string;
}

const NONE = 65535;

/** The world point at the centre of cell i. */
export function cellCentre(f: FreeSpace, i: number): Vec3 {
    const [nx, ny] = f.dims;
    const x = i % nx;
    const y = ((i - x) / nx) % ny;
    const z = (i - x - y * nx) / (nx * ny);
    const fx = f.origin[0] + (x + 0.5) * f.cellM;
    const fy = f.origin[1] + (y + 0.5) * f.cellM;
    const fz = f.origin[2] + (z + 0.5) * f.cellM;
    return f.flip ? [-fx, -fy, fz] : [fx, fy, fz];
}

/** The cell of a world point, -1 outside the box. */
export function cellOf(f: FreeSpace, p: Vec3): number {
    const fx = f.flip ? -p[0] : p[0];
    const fy = f.flip ? -p[1] : p[1];
    const x = Math.floor((fx - f.origin[0]) / f.cellM);
    const y = Math.floor((fy - f.origin[1]) / f.cellM);
    const z = Math.floor((p[2] - f.origin[2]) / f.cellM);
    const [nx, ny, nz] = f.dims;
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return -1;
    return x + nx * (y + ny * z);
}

/**
 * The free radius of the cell's centre, flown m: the chamfer distance to the nearest solid cell's centre less half a cell
 * (its near face). An estimate: the 3-4-5 chamfer is within a few percent of the true distance; checkTrack proves the gates.
 */
export function clearanceM(f: FreeSpace, i: number): number {
    const d = f.clearance[i]!;
    if (d === NONE) return 1e9;
    return Math.max(0, (d * f.cellM) / 3 - f.cellM / 2);
}

function fnv(h: number, v: number): number {
    h ^= v & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 0xff;
    return Math.imul(h, 16777619) >>> 0;
}

export function freeSpace(walls: VoxelCollision, opts: FreeSpaceOptions): FreeSpace {
    const marginM = opts.marginM ?? FREE_DEFAULTS.marginM;
    const boxM = opts.boxM ?? FREE_DEFAULTS.boxM;
    const maxCells = opts.maxCells ?? FREE_DEFAULTS.maxCells;
    const enclosureMin = opts.enclosureMin ?? FREE_DEFAULTS.enclosureMin;
    const rayM = opts.rayM ?? FREE_DEFAULTS.rayM;
    const minRoomM3 = opts.minRoomM3 ?? FREE_DEFAULTS.minRoomM3;
    const flood = opts.floodFill ?? true;
    const flip = walls.flipXY;

    // the box, in blocks of the file's index space
    const blockM = 4 * walls.voxelResolution;
    const [nbx, nby, nbz] = blockDims(walls);
    const gmin = [walls.gridMinX, walls.gridMinY, walls.gridMinZ];
    const nb = [nbx, nby, nbz];
    // a spawn outside the walls' grid (a small scan whose camera looks at it from outside, Forest Floor ab5efa0e) starts
    // from the nearest point inside the grid: otherwise no start cell and no course; a spawn inside is unchanged
    const o = opts.spawn;
    const of: Vec3 = flip ? [-o[0], -o[1], o[2]] : [o[0], o[1], o[2]];
    const sf = [0, 1, 2].map((a) => Math.min(Math.max(of[a]!, gmin[a]! + blockM / 2), gmin[a]! + (nb[a]! - 0.5) * blockM)) as unknown as Vec3;
    const sp: Vec3 = flip ? [-sf[0], -sf[1], sf[2]] : [sf[0], sf[1], sf[2]];
    const halfB = Math.ceil(boxM / 2 / blockM);
    const b0 = [0, 1, 2].map((a) => Math.max(0, Math.floor((sf[a]! - gmin[a]!) / blockM) - halfB));
    const b1 = [0, 1, 2].map((a) => Math.min(nb[a]!, Math.floor((sf[a]! - gmin[a]!) / blockM) + halfB + 1));
    const span = [0, 1, 2].map((a) => Math.max(1, b1[a]! - b0[a]!));
    let g = Math.max(1, Math.ceil(FREE_DEFAULTS.minCellM / blockM - 1e-9));
    while (Math.ceil(span[0]! / g) * Math.ceil(span[1]! / g) * Math.ceil(span[2]! / g) > maxCells) g++;
    const nx = Math.ceil(span[0]! / g), ny = Math.ceil(span[1]! / g), nz = Math.ceil(span[2]! / g);
    const n = nx * ny * nz;
    const nxy = nx * ny;
    const cellM = g * blockM;
    const origin: Vec3 = [gmin[0]! + b0[0]! * blockM, gmin[1]! + b0[1]! * blockM, gmin[2]! + b0[2]! * blockM];

    // 1. solid cells
    const solid = new Uint8Array(n);
    let solidCount = 0;
    forEachBlock(walls, b0, b1, (bx, by, bz) => {
        const i = Math.floor((bx - b0[0]!) / g) + nx * (Math.floor((by - b0[1]!) / g) + ny * Math.floor((bz - b0[2]!) / g));
        if (solid[i] === 0) solidCount++;
        solid[i] = 1;
    });

    // 2. clearance: 3-4-5 chamfer, a forward and a backward pass
    const dist = new Uint16Array(n).fill(NONE);
    for (let i = 0; i < n; i++) if (solid[i]) dist[i] = 0;
    const offs: number[][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
        if (k === 0) continue;
        offs.push([dx, dy, dz, k === 1 ? 3 : k === 2 ? 4 : 5]);
    }
    const before = offs.filter(([dx, dy, dz]) => dz! < 0 || (dz === 0 && (dy! < 0 || (dy === 0 && dx! < 0))));
    const after = offs.filter((o) => !before.includes(o));
    const pass = (list: number[][], forward: boolean): void => {
        for (let s = 0; s < n; s++) {
            const i = forward ? s : n - 1 - s;
            let d = dist[i]!;
            if (d === 0) continue;
            const x = i % nx, y = ((i - x) / nx) % ny, z = (i - x - y * nx) / nxy;
            for (const [dx, dy, dz, w] of list) {
                const X = x + dx!, Y = y + dy!, Z = z + dz!;
                if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
                const v = dist[X + nx * (Y + ny * Z)]!;
                if (v !== NONE && v + w! < d) d = v + w!;
            }
            dist[i] = d;
        }
    };
    pass(before, true);
    pass(after, false);

    const free: FreeSpace = { cellM, origin, dims: [nx, ny, nz], flip, marginM, solid, clearance: dist, room: new Int16Array(0), rooms: [], volumeM3: 0, outdoor: false, startCell: -1, stats: { cells: n, solid: solidCount, reachable: 0, scanned: 0, usable: 0, group: g }, digest: '' };
    const clearEnough = (i: number): boolean => solid[i] === 0 && clearanceM(free, i) >= marginM;

    // 3. reachable: flood fill from the spawn (first the nearest clear cell by a walk through free cells)
    const queue = new Int32Array(n);
    const neighbours = (i: number, cb: (j: number) => void): void => {
        const x = i % nx, y = ((i - x) / nx) % ny, z = (i - x - y * nx) / nxy;
        if (x > 0) cb(i - 1);
        if (x < nx - 1) cb(i + 1);
        if (y > 0) cb(i - nx);
        if (y < ny - 1) cb(i + nx);
        if (z > 0) cb(i - nxy);
        if (z < nz - 1) cb(i + nxy);
    };
    /** breadth-first from `from` through cells `through` allows, to the first cell `goal` accepts; -1 when none */
    const nearest = (from: number, through: (i: number) => boolean, goal: (i: number) => boolean): number => {
        if (from < 0) return -1;
        if (goal(from)) return from;
        const seen = new Uint8Array(n);
        let h = 0, t = 0;
        queue[t++] = from;
        seen[from] = 1;
        while (h < t) {
            const i = queue[h++]!;
            let found = -1;
            neighbours(i, (j) => {
                if (found >= 0 || seen[j]) return;
                seen[j] = 1;
                if (goal(j)) found = j;
                else if (through(j)) queue[t++] = j;
            });
            if (found >= 0) return found;
        }
        return -1;
    };
    const fill = (seed: number, ok: (i: number) => boolean, out: Uint8Array): number => {
        if (seed < 0) return 0;
        let h = 0, t = 0, count = 1;
        queue[t++] = seed;
        out[seed] = 1;
        while (h < t) {
            neighbours(queue[h++]!, (j) => {
                if (out[j] || !ok(j)) return;
                out[j] = 1;
                count++;
                queue[t++] = j;
            });
        }
        return count;
    };
    const spawnCell = cellOf(free, sp);
    const reach = new Uint8Array(n);
    let reachable = 0;
    const seed0 = nearest(spawnCell, (i) => solid[i] === 0, clearEnough);
    if (flood) reachable = fill(seed0, clearEnough, reach);
    else for (let i = 0; i < n; i++) if (clearEnough(i)) { reach[i] = 1; reachable++; }

    // outdoor: the fill reaches more than outdoorShare of the box's border cells
    let border = 0, borderHit = 0;
    for (let i = 0; i < n; i++) {
        const x = i % nx, y = ((i - x) / nx) % ny, z = (i - x - y * nx) / nxy;
        if (x !== 0 && y !== 0 && z !== 0 && x !== nx - 1 && y !== ny - 1 && z !== nz - 1) continue;
        border++;
        if (reach[i]) borderHit++;
    }
    const kind = opts.kind ?? 'auto';
    const outdoor = kind === 'outdoor' || (kind === 'auto' && border > 0 && borderHit / border > FREE_DEFAULTS.outdoorShare);

    // 4. well scanned
    const rays: { step: number; n: number }[] = [];
    for (const [dx, dy, dz] of offs) {
        const stepM = cellM * Math.sqrt(dx! * dx! + dy! * dy! + dz! * dz!);
        rays.push({ step: dx! + nx * (dy! + ny * dz!), n: Math.max(1, Math.floor(rayM / stepM)) });
    }
    const rayDirs = offs;
    const hitWithin = (i: number, r: number, steps: number): boolean => {
        const [dx, dy, dz] = rayDirs[r]!;
        let x = i % nx, y = ((i - x) / nx) % ny, z = (i - x - y * nx) / nxy;
        for (let k = 0; k < steps; k++) {
            x += dx!;
            y += dy!;
            z += dz!;
            if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return false;
            if (solid[x + nx * (y + ny * z)]) return true;
        }
        return false;
    };
    const need = Math.ceil(enclosureMin * 26 - 1e-9);
    const downRay = rayDirs.findIndex(([dx, dy, dz]) => dx === 0 && dz === 0 && dy === (flip ? 1 : -1));
    const downSteps = Math.max(1, Math.floor(FREE_DEFAULTS.outdoorDownM / cellM));
    const scannedAt = (i: number): boolean => {
        if (outdoor) return hitWithin(i, downRay, downSteps) && (dist[i]! * cellM) / 3 <= FREE_DEFAULTS.outdoorNearM;
        if (need <= 0) return true;
        let hits = 0, misses = 0;
        for (let r = 0; r < 26; r++) {
            if (hitWithin(i, r, rays[r]!.n)) {
                if (++hits >= need) return true;
            } else if (++misses > 26 - need) return false;
        }
        return hits >= need;
    };
    const scanned = new Uint8Array(n);
    let scannedCount = 0;
    for (let i = 0; i < n; i++) if (reach[i] && scannedAt(i)) { scanned[i] = 1; scannedCount++; }
    const keep = new Uint8Array(n);
    if (flood) fill(nearest(seed0, (i) => reach[i] === 1, (i) => scanned[i] === 1), (i) => scanned[i] === 1, keep);
    else keep.set(scanned);

    // 5. rooms: components after one erosion step, grown back by a breadth-first pass
    const room = new Int16Array(n).fill(-1);
    const label = new Int32Array(n).fill(-1);
    let labels = 0;
    const core = (i: number): boolean => {
        if (!keep[i]) return false;
        let all = true;
        neighbours(i, (j) => { if (!keep[j]) all = false; });
        return all;
    };
    const isCore = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (core(i)) isCore[i] = 1;
    for (let i = 0; i < n; i++) {
        if (!isCore[i] || label[i] >= 0) continue;
        let h = 0, t = 0;
        queue[t++] = i;
        label[i] = labels;
        while (h < t) neighbours(queue[h++]!, (j) => { if (isCore[j] && label[j] < 0) { label[j] = labels; queue[t++] = j; } });
        labels++;
    }
    {
        let h = 0, t = 0;
        for (let i = 0; i < n; i++) if (label[i] >= 0) queue[t++] = i;
        while (h < t) {
            const i = queue[h++]!;
            neighbours(i, (j) => { if (keep[j] && label[j] < 0) { label[j] = label[i]!; queue[t++] = j; } });
        }
    }
    const sums = Array.from({ length: labels }, () => ({ cells: 0, x: 0, y: 0, z: 0 }));
    for (let i = 0; i < n; i++) {
        const l = label[i]!;
        if (l < 0) continue;
        const c = cellCentre(free, i);
        const s = sums[l]!;
        s.cells++;
        s.x += c[0];
        s.y += c[1];
        s.z += c[2];
    }
    const cellM3 = cellM * cellM * cellM;
    const rooms: FreeRoom[] = [];
    const remap = new Int32Array(labels).fill(-1);
    sums.forEach((s, l) => {
        if (s.cells * cellM3 < minRoomM3 || rooms.length >= 32767) return;
        remap[l] = rooms.length;
        rooms.push({ id: rooms.length, cells: s.cells, volumeM3: s.cells * cellM3, centroid: [s.x / s.cells, s.y / s.cells, s.z / s.cells] });
    });
    let usable = 0;
    let h = 2166136261;
    for (const v of [nx, ny, nz, g, Math.round(marginM * 1000), Math.round(enclosureMin * 1000), Math.round(rayM * 1000), flood ? 1 : 0, outdoor ? 1 : 0]) h = fnv(h, v);
    for (let i = 0; i < n; i++) {
        const l = label[i]!;
        if (l >= 0 && remap[l]! >= 0) {
            room[i] = remap[l]!;
            usable++;
        }
        h = fnv(h, room[i]! + 1);
    }
    const startCell = nearest(seed0, (i) => reach[i] === 1, (i) => room[i]! >= 0);
    return {
        ...free,
        room,
        rooms,
        volumeM3: usable * cellM3,
        outdoor,
        startCell,
        stats: { cells: n, solid: solidCount, reachable, scanned: scannedCount, usable, group: g },
        digest: `fnv1a32:${h.toString(16).padStart(8, '0')}`
    };
}
