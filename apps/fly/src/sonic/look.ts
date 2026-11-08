// The look of a lesson world (v0.13, the owner's message 41: "the room does not look like the ones in games ... think how
// to make it simple, so it does not load the computer, and looks at least like Minecraft"; plan M41-23; lane v13-look
// L1-3). Pure: no engine, so Node tests hold the numbers; primitives.ts PrimitiveStage puts it on the page.
//
//   blocks    walls and ceilings are 0.5 m blocks (a procedural texture: a little light and dark per block, a darker
//             joint, a lit top-left and a shaded bottom-right edge), the floor a 0.5 m checker; world-space UVs, so the
//             blocks line up across slabs and every room shows its size in blocks.
//   light     a hemisphere (sky from above, ground from below) plus one sun, no shadows. The world and the sun do not
//             move, so the light is baked per vertex (a flat face has one normal: exact) and the materials are unlit:
//             the cheapest a GPU can draw. Objects get a softer light of their own (they must stay bright on every side).
//   colours   for low vision, three steps of luminance at least 3:1 apart (WCAG contrast (L1 + 0.05) / (L2 + 0.05)): a
//             dark floor, slate walls, bright obstacles (pillars orange, gates yellow, blocks cyan, zones green, the next
//             gate white-yellow); the ceiling between floor and walls. lookContrast() computes the rendered luminance of
//             every face orientation from the numbers here; the page measures it on its own pictures (v13-look-page.ts).
//   fog       soft, from FOG_START_M to FOG_END_M, toward the sky colour (the clear colour of every lesson world): far
//             parts of a long tunnel fade, the near room keeps its contrast.
// Colours are linear RGB here; PlayCanvas takes material, clear and fog colours in sRGB (toSrgb), vertex colours linear.
import type { Quat, Vec3 } from '@shramko/sonic-fpv';
import type { PrimRole } from './primitives';

export type Rgb = readonly [number, number, number];

// ------------------------------------------------------------------ colour math

/** sRGB transfer, one channel, 0..1. */
export function linearToSrgb(v: number): number {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function srgbToLinear(v: number): number {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export const toSrgb = (c: Rgb): Rgb => [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];

/** Relative luminance of a linear RGB colour (WCAG 2.x). */
export function luminance(c: Rgb): number {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG contrast ratio of two relative luminances, 1 to 21. */
export function contrastRatio(a: number, b: number): number {
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The low-vision rule of M41-23: floor against walls, an obstacle against what is behind it. */
export const MIN_CONTRAST = 3;

// ------------------------------------------------------------------ colours

/** Albedo of each role, linear RGB. */
export const ALBEDO: Readonly<Record<PrimRole, Rgb>> = {
    floor: [0.0089, 0.0098, 0.0115],
    wall: [0.16, 0.193, 0.29],
    ceiling: [0.06, 0.065, 0.085],
    gate: [1, 0.72, 0.08],
    pillar: [1, 0.58, 0.12],
    box: [0.12, 0.78, 0.95],
    zone: [0.2, 0.9, 0.35]
};
/** The next gate or zone (the target layer's source). */
export const TARGET_ALBEDO: Rgb = [1, 1, 0.55];
/** The clear colour of a lesson world and its fog: an evening sky, the walls' slate a little lighter. */
export const SKY: Rgb = [0.13, 0.16, 0.24];

/** The measuring paint (PrimitiveStage.paint('roles')): flat, unlit, no fog, one colour per kind of surface. */
export const ROLE_PAINT: Readonly<Record<'floor' | 'wall' | 'ceiling' | 'object', Rgb>> = {
    floor: [1, 0, 0],
    wall: [0, 1, 0],
    ceiling: [0, 0, 1],
    object: [1, 1, 1]
};

// ------------------------------------------------------------------ light

/** Toward the sun (unit). */
export const SUN_DIR: Vec3 = normalize([0.4, 0.8, 0.45]);

/** Hemisphere (light from straight above, from straight below) and sun strength, linear. */
export interface LightRig { readonly sky: number; readonly ground: number; readonly sun: number }
export const ROOM_LIGHT: LightRig = { sky: 1, ground: 0.55, sun: 0.15 };
export const OBJECT_LIGHT: LightRig = { sky: 1, ground: 0.78, sun: 0.12 };

function normalize(v: Vec3): Vec3 {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
}

/** The light a surface with normal `n` (world, unit) gets: the hemisphere blended by n.y, plus the sun, no shadow. */
export function lightAt(n: Vec3, rig: LightRig): number {
    const t = 0.5 + 0.5 * n[1];
    const sun = Math.max(0, n[0] * SUN_DIR[0] + n[1] * SUN_DIR[1] + n[2] * SUN_DIR[2]);
    return rig.ground + (rig.sky - rig.ground) * t + rig.sun * sun;
}

// ------------------------------------------------------------------ patterns

/** A pattern texture covers this many metres (both ways); the blocks and checker squares are BLOCK_M. */
export const TILE_M = 2;
export const BLOCK_M = 0.5;
/** Texture side, pixels (4 x 4 blocks of 64 px). */
export const PATTERN_PX = 256;

/** A pattern: RGBA8 pixels, a linear multiplier of the albedo in each of R, G and B. */
export interface Pattern {
    readonly px: number;
    readonly data: Uint8Array;
    /** the mean multiplier over the texture (what the eye takes from a distance) */
    readonly mean: number;
    readonly min: number;
    readonly max: number;
}

/** A small deterministic hash 0..1 of an integer pair (the blocks' shades never change between visits). */
function hash2(i: number, j: number): number {
    let h = (i * 374761393 + j * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pattern(px: number, value: (x: number, y: number) => number): Pattern {
    const data = new Uint8Array(px * px * 4);
    let sum = 0, min = Infinity, max = -Infinity;
    for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
            const v = Math.max(0, Math.min(1, value(x, y)));
            const b = Math.round(v * 255);
            const i = (y * px + x) * 4;
            data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
            const q = b / 255;
            sum += q;
            if (q < min) min = q;
            if (q > max) max = q;
        }
    }
    return { px, data, mean: sum / (px * px), min, max };
}

/** Blocks: each 0.5 m block its own shade (0.88 to 1), a joint of 3 px at 0.55, a bevel lit at the top left, shaded at the bottom right. */
export function blockPattern(px = PATTERN_PX): Pattern {
    const cell = px / (TILE_M / BLOCK_M);
    return pattern(px, (x, y) => {
        const i = Math.floor(x / cell), j = Math.floor(y / cell);
        const u = x - i * cell, v = y - j * cell;
        if (u < 3 || v < 3) return 0.55;
        const shade = 0.88 + 0.12 * hash2(i, j);
        if (u < 7 || v < 7) return Math.min(1, shade + 0.06);
        if (u > cell - 5 || v > cell - 5) return shade - 0.1;
        return shade;
    });
}

/** Checker: 0.5 m squares, 1 and 0.5, with a fine 2 px line at 0.7 between them. */
export function checkerPattern(px = PATTERN_PX): Pattern {
    const cell = px / (TILE_M / BLOCK_M);
    return pattern(px, (x, y) => {
        const i = Math.floor(x / cell), j = Math.floor(y / cell);
        const u = x - i * cell, v = y - j * cell;
        if (u < 2 || v < 2) return 0.7;
        return (i + j) % 2 === 0 ? 1 : 0.5;
    });
}

// ------------------------------------------------------------------ fog

export const FOG_START_M = 12;
export const FOG_END_M = 60;

// ------------------------------------------------------------------ what it gives on the screen

/** The rendered luminance (linear) of a surface of `role` facing `n`, its pattern's mean or one of its extremes. */
export function renderedLuminance(role: PrimRole, n: Vec3, which: 'mean' | 'min' | 'max' = 'mean', target = false): number {
    const room = role === 'floor' || role === 'wall' || role === 'ceiling';
    const albedo = target ? TARGET_ALBEDO : ALBEDO[role];
    const light = lightAt(n, room ? ROOM_LIGHT : OBJECT_LIGHT);
    const p = role === 'floor' ? checkerPattern() : room ? blockPattern() : null;
    const k = p === null ? 1 : which === 'mean' ? p.mean : which === 'min' ? p.min : p.max;
    return luminance(albedo) * light * k;
}

/** The axis normals of the room's faces, and a sphere of normals for the objects (their sides, tops and bottoms). */
export const WALL_NORMALS: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
export function sphereNormals(n = 16): Vec3[] {
    const out: Vec3[] = [];
    for (let i = 0; i <= n; i++) {
        const y = -1 + (2 * i) / n;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        for (let k = 0; k < 2 * n; k++) out.push([r * Math.cos((Math.PI * k) / n), y, r * Math.sin((Math.PI * k) / n)]);
    }
    return out;
}

/**
 * The look's contrast on paper: the floor against every wall orientation, the bright floor squares against the darkest
 * wall, and every obstacle's mean (over a sphere of normals) against the lightest wall, the floor and the ceiling.
 */
export function lookContrast(): { floorWall: number; floorSquareWall: number; obstacles: Record<string, number>; levels: Record<string, number> } {
    const floor = renderedLuminance('floor', [0, 1, 0]);
    const floorSquare = luminance(ALBEDO.floor) * lightAt([0, 1, 0], ROOM_LIGHT) * checkerPattern().max;
    const walls = WALL_NORMALS.map((n) => renderedLuminance('wall', n));
    const ceiling = renderedLuminance('ceiling', [0, -1, 0]);
    const wMin = Math.min(...walls), wMax = Math.max(...walls);
    const normals = sphereNormals();
    const objectMean = (role: PrimRole, target = false): number => normals.reduce((s, n) => s + renderedLuminance(role, n, 'mean', target), 0) / normals.length;
    const obstacles: Record<string, number> = {};
    for (const [name, L] of [['pillar', objectMean('pillar')], ['gate', objectMean('gate')], ['box', objectMean('box')], ['target', objectMean('gate', true)]] as const) {
        obstacles[name] = Math.min(contrastRatio(L, wMax), contrastRatio(L, floor), contrastRatio(L, ceiling));
    }
    return {
        floorWall: contrastRatio(floor, wMin),
        floorSquareWall: contrastRatio(floorSquare, wMin),
        obstacles,
        levels: { floor, floorSquare, wallMin: wMin, wallMax: wMax, ceiling, sky: luminance(SKY) }
    };
}

// ------------------------------------------------------------------ meshes

/** Vertex arrays of a mesh: positions, normals, UVs, vertex colours (linear RGBA: the light), 16- or 32-bit indices. */
export interface MeshData {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly uvs: Float32Array;
    readonly colors: Float32Array;
    readonly indices: Uint32Array;
}

/** A room surface for the merged mesh: a rectangle on a plane, facing into the hollow. */
export interface RoomQuad {
    /** centre, world */
    readonly pos: Vec3;
    /** full extents (the thin axis is the facing one) */
    readonly size: Vec3;
    /** unit, into the hollow: an axis */
    readonly facing: Vec3;
}

/**
 * The quads of one role as one mesh: each quad is the face of its slab toward the hollow (the slab is SLAB_M thick and
 * stands outside it: the face lies at pos + facing * thickness / 2), UVs in world metres over TILE_M (the blocks line up
 * from slab to slab), the room's light baked in the vertex colour.
 */
export function roomMesh(quads: readonly RoomQuad[]): MeshData {
    const n = quads.length;
    const positions = new Float32Array(n * 12), normals = new Float32Array(n * 12), uvs = new Float32Array(n * 8), colors = new Float32Array(n * 16);
    const indices = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) {
        const { pos, size, facing } = quads[q]!;
        const a = Math.abs(facing[0]) > 0.5 ? 0 : Math.abs(facing[1]) > 0.5 ? 1 : 2;
        // the face's two axes: for a floor or ceiling x and z, for a wall the horizontal one and y
        const [ua, va] = a === 0 ? [2, 1] : a === 1 ? [0, 2] : [0, 1];
        const c: number[] = [pos[0], pos[1], pos[2]];
        c[a] = pos[a]! + facing[a]! * (size[a]! / 2);
        const hu = size[ua]! / 2, hv = size[va]! / 2;
        const light = lightAt(facing, ROOM_LIGHT);
        const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let k = 0; k < 4; k++) {
            const p = [c[0]!, c[1]!, c[2]!];
            p[ua] = c[ua]! + corners[k]![0] * hu;
            p[va] = c[va]! + corners[k]![1] * hv;
            const vi = q * 4 + k;
            positions.set(p, vi * 3);
            normals.set(facing, vi * 3);
            uvs[vi * 2] = p[ua]! / TILE_M;
            uvs[vi * 2 + 1] = p[va]! / TILE_M;
            colors[vi * 4] = light; colors[vi * 4 + 1] = light; colors[vi * 4 + 2] = light; colors[vi * 4 + 3] = 1;
        }
        // wound counter-clockwise seen from inside the hollow (PlayCanvas' front face): the corners' order turns about
        // e_u x e_v, which is -x for a wall facing along x (u z, v y), -y for a floor or ceiling (u x, v z), +z for z
        const b = q * 4;
        const turns = a === 2 ? 1 : -1;
        const flip = Math.sign(facing[a]!) !== turns;
        indices.set(flip ? [b, b + 2, b + 1, b, b + 3, b + 2] : [b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
    }
    return { positions, normals, uvs, colors, indices };
}

/** A unit vector turned by a quaternion [w, x, y, z]. */
function rotate(q: Quat, v: Vec3): Vec3 {
    const [w, x, y, z] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The baked light of an object's vertices (RGBA, linear): its local normals turned to the world by `quat`. */
export function objectColors(normals: ArrayLike<number>, quat: Quat): Float32Array {
    const n = Math.floor(normals.length / 3);
    const out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const w = rotate(quat, [normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!]);
        const l = Math.hypot(w[0], w[1], w[2]) || 1;
        const light = lightAt([w[0] / l, w[1] / l, w[2] / l], OBJECT_LIGHT);
        out[i * 4] = light; out[i * 4 + 1] = light; out[i * 4 + 2] = light; out[i * 4 + 3] = 1;
    }
    return out;
}
