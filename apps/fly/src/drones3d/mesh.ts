// Geometry as plain arrays, with no engine in it (v0.9 lane D, docs/wip/v09-d.md). Every shape of the drone
// models (shapes.ts) and every part (components.ts, families/*.ts) is a MeshData in millimetres, +Y up, so a
// Node test can check what the engine will draw: indices in range, unit normals, closed volumes, sizes
// that equal the maker's published ones. studio.ts turns a MeshData into a pc.Mesh and nothing else.

/** Triangles with per-vertex normals and texture coordinates. Counter-clockwise triangles face outwards. */
export interface MeshData {
    /** x y z per vertex, millimetres */
    positions: number[];
    /** x y z per vertex, unit length */
    normals: number[];
    /** u v per vertex */
    uvs: number[];
    /** three indices per triangle */
    indices: number[];
}

export type Vec3 = [number, number, number];

export const emptyMesh = (): MeshData => ({ positions: [], normals: [], uvs: [], indices: [] });

export const vertexCount = (m: MeshData): number => m.positions.length / 3;
export const triangleCount = (m: MeshData): number => m.indices.length / 3;

/** Append `b` to `a` (indices re-based). */
export function append(a: MeshData, b: MeshData): MeshData {
    const base = vertexCount(a);
    for (const v of b.positions) a.positions.push(v);
    for (const v of b.normals) a.normals.push(v);
    for (const v of b.uvs) a.uvs.push(v);
    for (const i of b.indices) a.indices.push(i + base);
    return a;
}

/** One mesh out of many (the originals are not changed). */
export function merge(list: readonly MeshData[]): MeshData {
    const out = emptyMesh();
    for (const m of list) append(out, m);
    return out;
}

export interface Bounds {
    min: Vec3;
    max: Vec3;
}

export function boundsOf(m: MeshData): Bounds {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = m.positions[i + k];
            if (v < min[k]) min[k] = v;
            if (v > max[k]) max[k] = v;
        }
    }
    return { min, max };
}

/**
 * Per-vertex normals from the triangles (area-weighted average of the faces around each vertex). For shapes
 * built from a surface grid where the analytic normal is not at hand (propeller blades). Writes into `m`.
 */
export function smoothNormals(m: MeshData): MeshData {
    const n = new Array<number>(m.positions.length).fill(0);
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
        const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    m.normals = n;
    return m;
}

/** What is wrong with a mesh, as sentences (empty: it is fine). Used by the unit tests and by the viewer's own check. */
export function problemsOf(m: MeshData, label = 'mesh'): string[] {
    const out: string[] = [];
    const nv = vertexCount(m);
    if (nv === 0 || m.indices.length === 0) out.push(`${label}: empty`);
    if (m.normals.length !== m.positions.length) out.push(`${label}: ${m.normals.length / 3} normals for ${nv} vertices`);
    if (m.uvs.length !== nv * 2) out.push(`${label}: ${m.uvs.length / 2} uvs for ${nv} vertices`);
    if (m.indices.length % 3) out.push(`${label}: ${m.indices.length} indices is not whole triangles`);
    let bad = 0;
    for (const i of m.indices) if (!Number.isInteger(i) || i < 0 || i >= nv) bad++;
    if (bad) out.push(`${label}: ${bad} indices out of range`);
    let nan = 0;
    for (const v of m.positions) if (!Number.isFinite(v)) nan++;
    for (const v of m.normals) if (!Number.isFinite(v)) nan++;
    if (nan) out.push(`${label}: ${nan} non-finite numbers`);
    let notUnit = 0;
    for (let i = 0; i < m.normals.length; i += 3) if (Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) > 1e-3) notUnit++;
    if (notUnit) out.push(`${label}: ${notUnit} normals are not unit length`);
    return out;
}

/** Surface area of all triangles, mm^2 (degenerate or missing geometry gives ~0). */
export function surfaceArea(m: MeshData): number {
    let a = 0;
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
        const i = m.indices[t] * 3, j = m.indices[t + 1] * 3, k = m.indices[t + 2] * 3;
        const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2];
        const vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
        a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    return a;
}

/**
 * Signed volume of a closed mesh, mm^3 (positive when the triangles face outwards). Used to prove a shape is
 * closed and right-way-out: an open or inside-out mesh gives a volume far from the analytic one.
 */
export function signedVolume(m: MeshData): number {
    let v = 0;
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
        const i = m.indices[t] * 3, j = m.indices[t + 1] * 3, k = m.indices[t + 2] * 3;
        v += (p[i] * (p[j + 1] * p[k + 2] - p[j + 2] * p[k + 1]) - p[i + 1] * (p[j] * p[k + 2] - p[j + 2] * p[k]) + p[i + 2] * (p[j] * p[k + 1] - p[j + 1] * p[k])) / 6;
    }
    return v;
}
