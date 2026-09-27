// Vertex data of the voxel overlay, pure (no engine import): the style palettes and the one-pass
// packing of a chunk into the interleaved vertex layout the overlay's VertexFormat has. The app's
// mesh worker packs chunks with it, so the main thread only hands finished buffers to the GPU;
// the overlay recolours with it after a style change.

export type VoxelStyle = 'solid' | 'wire' | 'height' | 'floaters';
export const VOXEL_STYLES: readonly VoxelStyle[] = ['solid', 'wire', 'height', 'floaters'];

/** Byte offsets in one interleaved vertex: position f32x3, normal f32x3, uv f32x2, colour u8x4. */
export interface VoxelLayout { stride: number; pos: number; nrm: number; uv: number; col: number }

type RGB = [number, number, number];

const FLOATER: Record<VoxelStyle, RGB> = { solid: [1, 0.28, 0.82], wire: [1, 0.3, 0.85], height: [1, 0.25, 0.8], floaters: [1, 0.16, 0.2] };
const BASE: Record<Exclude<VoxelStyle, 'height'>, RGB> = { solid: [0.66, 0.86, 0.95], wire: [0.3, 0.95, 1], floaters: [0.5, 0.53, 0.57] };
// height ramp, low to high: indigo, blue, cyan, green, yellow, orange
const RAMP: RGB[] = [[0.3, 0.22, 0.8], [0.1, 0.45, 1], [0, 0.85, 0.92], [0.35, 0.95, 0.4], [1, 0.86, 0.2], [1, 0.4, 0.15]];

/** The ramp's colour at t in [0, 1] (clamped). */
export function heightColor(t: number): RGB {
    const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x));
    const f = x - i;
    const a = RAMP[i], b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** A vertex's colour in a style: floaters stand out in every style; height maps y into [lo, hi]. */
export function voxelColor(style: VoxelStyle, y: number, floater: boolean, lo: number, hi: number): RGB {
    if (floater) return FLOATER[style];
    if (style === 'height') return heightColor((y - lo) / Math.max(1e-6, hi - lo));
    return BASE[style];
}

/** Write the colour bytes of every vertex of an interleaved buffer (heights read from its positions). */
export function writeColors(buf: ArrayBuffer, L: VoxelLayout, nv: number, style: VoxelStyle, floater: Uint8Array, lo: number, hi: number): void {
    const f = new Float32Array(buf);
    const u8 = new Uint8Array(buf);
    const fs = L.stride / 4, py = L.pos / 4 + 1;
    const to8 = (c: RGB): number[] => c.map((v) => Math.round(v * 255));
    const fl = to8(FLOATER[style]);
    const flat = style === 'height' ? null : to8(BASE[style]);
    const span = Math.max(1e-6, hi - lo);
    for (let v = 0; v < nv; v++) {
        let r: number, g: number, b: number;
        if (floater[v >> 2]) { r = fl[0]; g = fl[1]; b = fl[2]; } else if (flat) { r = flat[0]; g = flat[1]; b = flat[2]; } else {
            const c = heightColor((f[v * fs + py] - lo) / span);
            r = Math.round(c[0] * 255); g = Math.round(c[1] * 255); b = Math.round(c[2] * 255);
        }
        const o = v * L.stride + L.col;
        u8[o] = r; u8[o + 1] = g; u8[o + 2] = b; u8[o + 3] = 255;
    }
}

/** A chunk ready for the GPU. */
export interface PackedChunk {
    vertices: ArrayBuffer;
    indices: Uint16Array | Uint32Array;
    /** per quad: 1 = part of a floating piece (kept for recolouring) */
    floater: Uint8Array;
    quads: number;
    /** min x, y, z, max x, y, z */
    aabb: [number, number, number, number, number, number];
    /** the style and height range its colours were written for */
    style: VoxelStyle;
    lo: number;
    hi: number;
}

/** Interleave one chunk (4 vertices and 6 indices per quad) into `L`, coloured for `style`. */
export function packChunk(c: { positions: Float32Array; normals: ArrayLike<number>; uvs: Float32Array; indices: Uint32Array; floater: Uint8Array; quads: number }, L: VoxelLayout, style: VoxelStyle, lo: number, hi: number): PackedChunk {
    if (L.stride % 4 || L.pos % 4 || L.nrm % 4 || L.uv % 4) throw new Error('vertex layout is not float aligned');
    const nv = c.quads * 4;
    const buf = new ArrayBuffer(nv * L.stride);
    const f = new Float32Array(buf);
    const fs = L.stride / 4, fp = L.pos / 4, fn = L.nrm / 4, fu = L.uv / 4;
    const p = c.positions, n = c.normals, t = c.uvs;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < nv; v++) {
        const o = v * fs, i = v * 3;
        const x = p[i], y = p[i + 1], z = p[i + 2];
        f[o + fp] = x; f[o + fp + 1] = y; f[o + fp + 2] = z;
        f[o + fn] = n[i]; f[o + fn + 1] = n[i + 1]; f[o + fn + 2] = n[i + 2];
        f[o + fu] = t[v * 2]; f[o + fu + 1] = t[v * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    writeColors(buf, L, nv, style, c.floater, lo, hi);
    return {
        vertices: buf,
        indices: nv <= 65535 ? Uint16Array.from(c.indices) : c.indices,
        floater: c.floater,
        quads: c.quads,
        aabb: nv ? [x0, y0, z0, x1, y1, z1] : [0, 0, 0, 0, 0, 0],
        style, lo, hi
    };
}
