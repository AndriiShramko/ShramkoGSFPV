// Affine placement of a MeshData (mesh.ts): a part is built at the origin and then put where it belongs.
// Millimetres, +Y up, angles in degrees. No engine.
import type { MeshData, Vec3 } from './mesh';

/** Row-major 3x4: [a b c tx, d e f ty, g h i tz]. */
export type Affine = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

const rad = (d: number): number => (d * Math.PI) / 180;

/** a * b: b first, then a. */
export function mul(a: Affine, b: Affine): Affine {
    const o = new Array<number>(12);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
        o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
    }
    return o as unknown as Affine;
}

export const translate = (x: number, y: number, z: number): Affine => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const scaleBy = (x: number, y = x, z = x): Affine => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];

export function rotX(deg: number): Affine {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}
export function rotY(deg: number): Affine {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}
export function rotZ(deg: number): Affine {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

export interface Place {
    /** position */
    at?: Vec3;
    /** rotation about X, then Y, then Z (degrees) */
    rot?: Vec3;
    /** uniform or per-axis scale, applied before the rotation */
    scale?: number | Vec3;
}

/** The placement as one transform: scale, then rotate (X, Y, Z), then move. */
export function place(p: Place): Affine {
    const s = p.scale === undefined ? [1, 1, 1] : typeof p.scale === 'number' ? [p.scale, p.scale, p.scale] : p.scale;
    let m: Affine = scaleBy(s[0], s[1], s[2]);
    if (p.rot) {
        if (p.rot[0]) m = mul(rotX(p.rot[0]), m);
        if (p.rot[1]) m = mul(rotY(p.rot[1]), m);
        if (p.rot[2]) m = mul(rotZ(p.rot[2]), m);
    }
    if (p.at) m = mul(translate(p.at[0], p.at[1], p.at[2]), m);
    return m;
}

export function applyPoint(m: Affine, p: Vec3): Vec3 {
    return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]
    ];
}

/** Determinant of the 3x3 part: negative means the transform mirrors (triangles must be re-wound). */
export function det3(m: Affine): number {
    return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/**
 * The mesh moved by `m`. Normals follow the inverse transpose (right for a non-uniform scale); a mirroring
 * transform flips the triangle winding so they still face outwards. The input is not changed.
 */
export function transformed(src: MeshData, m: Affine): MeshData {
    const d = det3(m);
    const inv = 1 / (d || 1);
    // cofactor matrix / det = inverse transpose
    const n = [
        (m[5] * m[10] - m[6] * m[9]) * inv, -(m[4] * m[10] - m[6] * m[8]) * inv, (m[4] * m[9] - m[5] * m[8]) * inv,
        -(m[1] * m[10] - m[2] * m[9]) * inv, (m[0] * m[10] - m[2] * m[8]) * inv, -(m[0] * m[9] - m[1] * m[8]) * inv,
        (m[1] * m[6] - m[2] * m[5]) * inv, -(m[0] * m[6] - m[2] * m[4]) * inv, (m[0] * m[5] - m[1] * m[4]) * inv
    ];
    const positions = new Array<number>(src.positions.length);
    const normals = new Array<number>(src.normals.length);
    for (let i = 0; i < src.positions.length; i += 3) {
        const x = src.positions[i], y = src.positions[i + 1], z = src.positions[i + 2];
        positions[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
        positions[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        positions[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
        const nx = src.normals[i], ny = src.normals[i + 1], nz = src.normals[i + 2];
        const ax = n[0] * nx + n[1] * ny + n[2] * nz, ay = n[3] * nx + n[4] * ny + n[5] * nz, az = n[6] * nx + n[7] * ny + n[8] * nz;
        const l = Math.hypot(ax, ay, az) || 1;
        normals[i] = ax / l; normals[i + 1] = ay / l; normals[i + 2] = az / l;
    }
    let indices = src.indices.slice();
    if (d < 0) {
        indices = new Array<number>(src.indices.length);
        for (let t = 0; t < src.indices.length; t += 3) { indices[t] = src.indices[t]; indices[t + 1] = src.indices[t + 2]; indices[t + 2] = src.indices[t + 1]; }
        // the normals need nothing more: cofactor / det is already the inverse transpose, mirror included
    }
    return { positions, normals, uvs: src.uvs.slice(), indices };
}

/** `src` placed by `p` (shorthand for transformed(src, place(p))). */
export const placed = (src: MeshData, p: Place): MeshData => transformed(src, place(p));
