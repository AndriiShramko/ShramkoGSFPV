// Parametric shapes for the drone models (v0.9 lane D): lathe (anything round), rounded box, extruded outline,
// tube (wires, antennas, rods), duct, propeller. Pure functions returning MeshData (mesh.ts), millimetres,
// +Y up, centred on the origin unless a doc says otherwise. Counter-clockwise triangles face outwards
// (tools/bench/test/drones3d-shapes.test.ts proves that with the signed volume of each closed shape).
import { emptyMesh, smoothNormals } from './mesh';
import type { MeshData, Vec3 } from './mesh';

const rad = (d: number): number => (d * Math.PI) / 180;
const TAU = Math.PI * 2;

/** (radius, y) points from the bottom of a round shape to its top, as lathe() takes them. */
export type Profile = readonly (readonly [number, number])[];

/** A circular arc as profile points, from angle a0 to a1 (degrees, 0 = +r direction, 90 = +y), `n` segments. */
export function arc(cr: number, cy: number, radius: number, a0: number, a1: number, n = 6): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
        const a = rad(a0 + ((a1 - a0) * i) / n);
        out.push([cr + radius * Math.cos(a), cy + radius * Math.sin(a)]);
    }
    return out;
}

export interface LatheOptions {
    /** steps around the axis (default 32) */
    segments?: number;
    /** neighbouring profile segments closer than this angle (degrees) share one smooth normal (default 40) */
    smooth?: number;
}

/**
 * A surface of revolution about the Y axis. The profile runs bottom to top; the outward normal of a profile
 * segment is (dy, -dr), so a closed loop goes up the outside, in along the top, down the inside and out along
 * the bottom. Sharp corners (more than `smooth` degrees) keep their own normals.
 */
export function lathe(profile: Profile, o: LatheOptions = {}): MeshData {
    const seg = Math.max(3, o.segments ?? 32);
    const thr = Math.cos(rad(o.smooth ?? 40));
    const m = emptyMesh();
    const k = profile.length - 1;
    // outward normal of each profile segment, (r, y) plane
    const sn: ([number, number] | null)[] = [];
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i < k; i++) {
        const dr = profile[i + 1][0] - profile[i][0], dy = profile[i + 1][1] - profile[i][1];
        const l = Math.hypot(dr, dy);
        lens.push(l);
        total += l;
        sn.push(l < 1e-9 ? null : [dy / l, -dr / l]);
    }
    let run = 0;
    for (let i = 0; i < k; i++) {
        const n = sn[i];
        if (!n) continue;
        const prev = i > 0 ? sn[i - 1] : null, next = i < k - 1 ? sn[i + 1] : null;
        const blend = (other: [number, number] | null): [number, number] => {
            if (!other || n[0] * other[0] + n[1] * other[1] < thr) return n;
            const a = n[0] + other[0], b = n[1] + other[1], l = Math.hypot(a, b) || 1;
            return [a / l, b / l];
        };
        const n0 = blend(prev), n1 = blend(next);
        const base = m.positions.length / 3;
        const ring = (p: readonly [number, number], nn: [number, number], v: number): void => {
            for (let j = 0; j <= seg; j++) {
                const th = (TAU * j) / seg, c = Math.cos(th), s = Math.sin(th);
                m.positions.push(p[0] * c, p[1], p[0] * s);
                m.normals.push(nn[0] * c, nn[1], nn[0] * s);
                m.uvs.push(j / seg, v);
            }
        };
        ring(profile[i], n0, run / (total || 1));
        run += lens[i];
        ring(profile[i + 1], n1, run / (total || 1));
        for (let j = 0; j < seg; j++) {
            const a = base + j, b = base + j + 1, c = base + seg + 1 + j, d = base + seg + 1 + j + 1;
            m.indices.push(a, c, b, b, c, d);
        }
    }
    return m;
}

/** A capped cylinder along Y, centred, with an optional bevel on both rims. */
export function cylinder(radius: number, height: number, o: LatheOptions & { bevel?: number } = {}): MeshData {
    const h = height / 2, b = Math.min(o.bevel ?? 0, radius * 0.9, h * 0.9);
    const p: [number, number][] = b > 0
        ? [[0, -h], [radius - b, -h], [radius, -h + b], [radius, h - b], [radius - b, h], [0, h]]
        : [[0, -h], [radius, -h], [radius, h], [0, h]];
    return lathe(p, o);
}

/** A sphere of the given radius (an ellipsoid with `squash` < 1 flattening it along Y). */
export function sphere(radius: number, o: LatheOptions & { rings?: number; squash?: number } = {}): MeshData {
    const n = o.rings ?? 12, sq = o.squash ?? 1;
    const p: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
        const a = Math.PI * (i / n);
        p.push([radius * Math.sin(a), -radius * Math.cos(a) * sq]);
    }
    return lathe(p, { smooth: 90, ...o });
}

/** A flat ring (washer, retaining ring) about Y: inner radius, outer radius, height; centred. */
export function ring(rin: number, rout: number, height: number, o: LatheOptions = {}): MeshData {
    const h = height / 2;
    return lathe([[rout, -h], [rout, h], [rin, h], [rin, -h], [rout, -h]], o);
}

export interface BoxOptions {
    /** corner radius, mm (clamped to the smallest half extent) */
    radius?: number;
    /** samples around each rounded edge (default 3) */
    seg?: number;
    /** texture repeat length in mm for the box-projected uvs (default 20) */
    uvMm?: number;
}

/** stops along one axis of half extent `half` with corner radius `r`: dense on the arcs, one flat run between */
function boxStops(half: number, r: number, k: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= k; i++) out.push(-(half - r) - r * Math.tan(rad(45 * (1 - i / k))));
    for (let i = 0; i <= k; i++) out.push(half - r + r * Math.tan(rad(45 * (i / k))));
    return out;
}

/**
 * A box w (X) x h (Y) x d (Z) with rounded edges and corners, centred. Each face is a grid projected onto the
 * rounded surface (the nearest point of the inner box plus the radius along the offset), so normals are exact
 * and neighbouring faces meet with the same position and normal.
 */
export function roundedBox(w: number, h: number, d: number, o: BoxOptions = {}): MeshData {
    const half: Vec3 = [w / 2, h / 2, d / 2];
    const r = Math.max(1e-4, Math.min(o.radius ?? 0.5, half[0], half[1], half[2]));
    const k = Math.max(1, o.seg ?? 3);
    const uvMm = o.uvMm ?? 20;
    const m = emptyMesh();
    const stops: number[][] = [0, 1, 2].map((a) => boxStops(half[a], r, k));
    for (let a = 0; a < 3; a++) {
        for (const s of [1, -1]) {
            const b = (a + 1) % 3, c = (a + 2) % 3;
            const sb = stops[b], sc = stops[c];
            const base = m.positions.length / 3;
            for (let ic = 0; ic < sc.length; ic++) {
                for (let ib = 0; ib < sb.length; ib++) {
                    const q: Vec3 = [0, 0, 0];
                    q[a] = s * half[a]; q[b] = sb[ib]; q[c] = sc[ic];
                    const inner: Vec3 = [0, 0, 0];
                    for (let i = 0; i < 3; i++) inner[i] = Math.max(-(half[i] - r), Math.min(half[i] - r, q[i]));
                    const nx = q[0] - inner[0], ny = q[1] - inner[1], nz = q[2] - inner[2];
                    const l = Math.hypot(nx, ny, nz) || 1;
                    m.positions.push(inner[0] + (nx / l) * r, inner[1] + (ny / l) * r, inner[2] + (nz / l) * r);
                    m.normals.push(nx / l, ny / l, nz / l);
                    m.uvs.push((q[b] + half[b]) / uvMm, (q[c] + half[c]) / uvMm);
                }
            }
            const nb = sb.length;
            for (let ic = 0; ic < sc.length - 1; ic++) {
                for (let ib = 0; ib < nb - 1; ib++) {
                    const i00 = base + ic * nb + ib, i10 = i00 + 1, i01 = i00 + nb, i11 = i01 + 1;
                    if (s > 0) m.indices.push(i00, i10, i01, i10, i11, i01);
                    else m.indices.push(i00, i01, i10, i10, i01, i11);
                }
            }
        }
    }
    return m;
}

/**
 * A polygon in the XZ plane extruded from y0 to y1 (a carbon plate, an arm). The outline may be convex or
 * star-shaped about its centroid (an X frame is). Flat shaded edges; `uvMm` sets the planar uv scale.
 */
export function extrudeOutline(points: readonly (readonly [number, number])[], y0: number, y1: number, uvMm = 20): MeshData {
    let pts = points.map((p) => [p[0], p[1]] as [number, number]);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area > 0) pts = pts.reverse();
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const m = emptyMesh();
    const top = (y: number, ny: number): void => {
        const base = m.positions.length / 3;
        m.positions.push(cx, y, cz); m.normals.push(0, ny, 0); m.uvs.push(cx / uvMm, cz / uvMm);
        for (const p of pts) { m.positions.push(p[0], y, p[1]); m.normals.push(0, ny, 0); m.uvs.push(p[0] / uvMm, p[1] / uvMm); }
        for (let i = 0; i < pts.length; i++) {
            const a = base + 1 + i, b = base + 1 + ((i + 1) % pts.length);
            if (ny > 0) m.indices.push(base, a, b); else m.indices.push(base, b, a);
        }
    };
    top(y1, 1);
    top(y0, -1);
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
        if (l < 1e-9) continue;
        const nx = -dz / l, nz = dx / l;
        const base = m.positions.length / 3;
        const u0 = run / uvMm, u1 = (run + l) / uvMm;
        m.positions.push(a[0], y0, a[1], b[0], y0, b[1], a[0], y1, a[1], b[0], y1, b[1]);
        for (let j = 0; j < 4; j++) m.normals.push(nx, 0, nz);
        m.uvs.push(u0, y0 / uvMm, u1, y0 / uvMm, u0, y1 / uvMm, u1, y1 / uvMm);
        m.indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        run += l;
    }
    return m;
}

/** An axis-aligned rectangle outline (centred) for extrudeOutline. */
export const rectOutline = (w: number, d: number): [number, number][] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

/**
 * A tapered bar from (x0, z0) to (x1, z1) in the XZ plane, `w0` wide at the start and `w1` at the end, from
 * y0 to y1 (an arm of an X frame). Four-point outline for extrudeOutline.
 */
export function barOutline(x0: number, z0: number, x1: number, z1: number, w0: number, w1: number): [number, number][] {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    return [[x0 + (nx * w0) / 2, z0 + (nz * w0) / 2], [x1 + (nx * w1) / 2, z1 + (nz * w1) / 2], [x1 - (nx * w1) / 2, z1 - (nz * w1) / 2], [x0 - (nx * w0) / 2, z0 - (nz * w0) / 2]];
}

/** A regular polygon outline of n sides (a disc plate with `n` large, a hex nut with 6). */
export function ngonOutline(radius: number, n: number, startDeg = 0): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = rad(startDeg) + (TAU * i) / n; out.push([radius * Math.cos(a), radius * Math.sin(a)]); }
    return out;
}

export interface TubeOptions {
    /** sides around the tube (default 8) */
    radial?: number;
    /** points per input span after smoothing (default 6; 1 keeps the path as given) */
    sub?: number;
    /** close both ends with a flat cap (default true) */
    caps?: boolean;
    /** radius at the end of the path, for a taper (default: constant) */
    endRadius?: number;
}

/** Catmull-Rom through the points, `sub` samples per span. */
function smoothPath(p: readonly Vec3[], sub: number): Vec3[] {
    if (sub <= 1 || p.length < 3) return p.map((v) => [v[0], v[1], v[2]] as Vec3);
    const out: Vec3[] = [];
    for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
        for (let s = 0; s < sub; s++) {
            const t = s / sub, t2 = t * t, t3 = t2 * t;
            const v: Vec3 = [0, 0, 0];
            for (let k = 0; k < 3; k++) v[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
            out.push(v);
        }
    }
    out.push([p[p.length - 1][0], p[p.length - 1][1], p[p.length - 1][2]]);
    return out;
}

/** A round tube along a path of points (wire, antenna, rod), with a rotation-minimising frame. */
export function tube(path: readonly Vec3[], radius: number, o: TubeOptions = {}): MeshData {
    const rs = Math.max(3, o.radial ?? 8);
    const pts = smoothPath(path, o.sub ?? 6);
    const n = pts.length;
    const m = emptyMesh();
    if (n < 2) return m;
    const tang: Vec3[] = pts.map((_, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
        const v: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l = Math.hypot(...v) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
    });
    // first normal: any vector not parallel to the first tangent
    const t0 = tang[0];
    const helper: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    let nrm = norm(cross(cross(t0, helper), t0));
    const r1 = o.endRadius ?? radius;
    let lenRun = 0;
    for (let i = 0; i < n; i++) {
        if (i > 0) {
            // parallel transport: remove the part of the previous normal along the new tangent
            const t = tang[i];
            const d = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
            nrm = norm([nrm[0] - d * t[0], nrm[1] - d * t[1], nrm[2] - d * t[2]]);
            lenRun += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
        }
        const bin = cross(tang[i], nrm);
        const rr = radius + (r1 - radius) * (i / (n - 1));
        for (let j = 0; j <= rs; j++) {
            const th = (TAU * j) / rs, c = Math.cos(th), s = Math.sin(th);
            const nx = nrm[0] * c + bin[0] * s, ny = nrm[1] * c + bin[1] * s, nz = nrm[2] * c + bin[2] * s;
            m.positions.push(pts[i][0] + nx * rr, pts[i][1] + ny * rr, pts[i][2] + nz * rr);
            m.normals.push(nx, ny, nz);
            m.uvs.push(j / rs, lenRun / (radius * 4 || 1));
        }
    }
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < rs; j++) {
            const a = i * (rs + 1) + j, b = a + 1, c = a + rs + 1, d = c + 1;
            m.indices.push(a, b, c, b, d, c);
        }
    }
    if (o.caps !== false) {
        for (const end of [0, n - 1]) {
            const base = m.positions.length / 3;
            const sign = end === 0 ? -1 : 1;
            const t = tang[end];
            const ringStart = end * (rs + 1);
            m.positions.push(pts[end][0], pts[end][1], pts[end][2]);
            m.normals.push(t[0] * sign, t[1] * sign, t[2] * sign);
            m.uvs.push(0.5, 0.5);
            for (let j = 0; j <= rs; j++) {
                m.positions.push(m.positions[(ringStart + j) * 3], m.positions[(ringStart + j) * 3 + 1], m.positions[(ringStart + j) * 3 + 2]);
                m.normals.push(t[0] * sign, t[1] * sign, t[2] * sign);
                m.uvs.push(0.5 + 0.5 * Math.cos((TAU * j) / rs), 0.5 + 0.5 * Math.sin((TAU * j) / rs));
            }
            for (let j = 0; j < rs; j++) {
                if (end === 0) m.indices.push(base, base + 2 + j, base + 1 + j);
                else m.indices.push(base, base + 1 + j, base + 2 + j);
            }
        }
    }
    return m;
}

export interface DuctOptions {
    /** inner (flow) radius, mm */
    inner: number;
    /** outer radius, mm */
    outer: number;
    /** height along Y, mm */
    height: number;
    /** bell-mouth radius on the inlet (top) lip, mm (default: a third of the wall, up to 2.5 mm) */
    lip?: number;
    segments?: number;
}

/**
 * A whoop duct: a short ring about Y with a rounded bell mouth on top where the air comes in, a plain exit at the
 * bottom and a small round on the outer edges. Centred on y = 0 (from -height/2 to +height/2).
 */
export function duct(o: DuctOptions): MeshData {
    const wall = o.outer - o.inner;
    const lip = Math.min(o.lip ?? Math.min(wall * 0.45, 2.5), wall * 0.6, o.height * 0.45);
    const e = Math.min(0.5, wall * 0.2, o.height * 0.2), h = o.height / 2;
    const p: [number, number][] = [
        [o.outer - e, -h], ...arc(o.outer - e, -h + e, e, -90, 0, 2),
        ...arc(o.outer - e, h - e, e, 0, 90, 2),
        // along the top to the bell mouth, then down the inside
        ...arc(o.inner + lip, h - lip, lip, 90, 180, 6),
        [o.inner, -h + e * 0.5], [o.inner + e * 0.5, -h]
    ];
    // drop the duplicate points the arcs share and close the loop at the start
    const clean: [number, number][] = [];
    for (const q of p) { const l = clean[clean.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) clean.push(q); }
    clean.push(clean[0]);
    return lathe(clean, { segments: o.segments ?? 48, smooth: 50 });
}

export interface PropellerOptions {
    /** tip to tip, mm */
    diameter: number;
    blades: number;
    /** hub radius, mm */
    hubRadius: number;
    /** pitch / diameter (typical 0.6-0.9 for 5-inch props, 0.8 for whoops) */
    pitchRatio: number;
    /** widest chord, mm (default: 0.13 x diameter for 2-blade, scaled down with more blades) */
    chordMax?: number;
    /** blade thickness at its thickest, mm */
    thickness?: number;
    /** counter-clockwise rotor (mirrors the blade) */
    ccw?: boolean;
    /** spanwise stations (default 14) */
    stations?: number;
}

/**
 * A propeller lying in the XZ plane at y = 0 (blades +- thickness): `blades` curved, twisted blades from a
 * hub. Chord grows from the root to a maximum at 55 % of the span and rounds off at the tip; the pitch angle
 * follows atan(P / 2 pi r) as a fixed-pitch propeller's does. The hub itself is propHub().
 */
export function propeller(o: PropellerOptions): MeshData {
    const R = o.diameter / 2, rh = o.hubRadius;
    const nSt = o.stations ?? 14, nCh = 8;
    const chordMax = o.chordMax ?? (0.42 * R) / Math.max(1.4, o.blades * 0.62);
    const th = o.thickness ?? Math.max(0.35, o.diameter * 0.011);
    const pitch = o.pitchRatio * o.diameter;
    const m = emptyMesh();
    const chordAt = (t: number): number => (t <= 0.55 ? 0.5 + 0.5 * Math.sin((Math.PI / 2) * (t / 0.55)) : 1 - 0.78 * Math.pow((t - 0.55) / 0.45, 2.2)) * chordMax;
    const mirror = o.ccw ? -1 : 1;
    // one blade, then rotated about Y for each blade
    const blade = emptyMesh();
    const perStation = nCh * 2;
    for (let i = 0; i <= nSt; i++) {
        const t = i / nSt, r = rh * 0.8 + (R - rh * 0.8) * t;
        const c = chordAt(t);
        const beta = Math.max(rad(9), Math.min(rad(58), Math.atan2(pitch, TAU * r)));
        const cb = Math.cos(beta), sb = Math.sin(beta);
        const camber = 0.07 * c;
        // section loop: leading edge, along the upper surface to the trailing edge, back along the lower surface
        for (let q = 0; q < perStation; q++) {
            const upper = q < nCh;
            const u = upper ? q / (nCh - 1) : 1 - (q - nCh) / (nCh - 1);
            const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
            const bump = 4 * s * (1 - s);
            const yt = (upper ? 1 : -1) * 0.5 * th * Math.pow(bump, 0.7) * (1 - 0.45 * t) + camber * bump;
            const xc = (s - 0.3) * c;
            // the clockwise blade, then mirrored across the XY plane for a counter-clockwise one
            blade.positions.push(r, xc * sb + yt * cb, (xc * cb - yt * sb) * mirror);
            blade.normals.push(0, 1, 0);
            blade.uvs.push(t, s);
        }
    }
    for (let i = 0; i < nSt; i++) {
        for (let q = 0; q < perStation; q++) {
            const q1 = (q + 1) % perStation;
            const a = i * perStation + q, b = i * perStation + q1, c = (i + 1) * perStation + q, d = (i + 1) * perStation + q1;
            if (mirror > 0) blade.indices.push(a, b, c, b, d, c); else blade.indices.push(a, c, b, b, c, d);
        }
    }
    // the tip: a fan to the middle of the last section
    {
        const last = nSt * perStation;
        const centre = blade.positions.length / 3;
        let cx = 0, cy = 0, cz = 0;
        for (let q = 0; q < perStation; q++) { cx += blade.positions[(last + q) * 3]; cy += blade.positions[(last + q) * 3 + 1]; cz += blade.positions[(last + q) * 3 + 2]; }
        blade.positions.push(cx / perStation, cy / perStation, cz / perStation);
        blade.normals.push(1, 0, 0);
        blade.uvs.push(1, 0.5);
        for (let q = 0; q < perStation; q++) {
            const q1 = (q + 1) % perStation;
            if (mirror > 0) blade.indices.push(last + q, centre, last + q1); else blade.indices.push(last + q, last + q1, centre);
        }
    }
    // the root: a fan facing the hub (inside the hub disc, never seen; it keeps every blade a closed volume)
    {
        const centre = blade.positions.length / 3;
        let cx = 0, cy = 0, cz = 0;
        for (let q = 0; q < perStation; q++) { cx += blade.positions[q * 3]; cy += blade.positions[q * 3 + 1]; cz += blade.positions[q * 3 + 2]; }
        blade.positions.push(cx / perStation, cy / perStation, cz / perStation);
        blade.normals.push(-1, 0, 0);
        blade.uvs.push(0, 0.5);
        for (let q = 0; q < perStation; q++) {
            const q1 = (q + 1) % perStation;
            if (mirror > 0) blade.indices.push(q, q1, centre); else blade.indices.push(q, centre, q1);
        }
    }
    for (let b = 0; b < o.blades; b++) {
        const a = (TAU * b) / o.blades, c = Math.cos(a), s = Math.sin(a);
        const base = m.positions.length / 3;
        for (let i = 0; i < blade.positions.length; i += 3) {
            const x = blade.positions[i], y = blade.positions[i + 1], z = blade.positions[i + 2];
            m.positions.push(x * c + z * s, y, -x * s + z * c);
            m.normals.push(0, 1, 0);
            m.uvs.push(blade.uvs[(i / 3) * 2], blade.uvs[(i / 3) * 2 + 1]);
        }
        for (const ix of blade.indices) m.indices.push(base + ix);
    }
    return smoothNormals(m);
}

/** The propeller's hub and retaining nut: a short dome on a wide disc, about Y, from y = -h to +h. */
export function propHub(radius: number, height: number): MeshData {
    const h = height / 2, r = radius;
    return lathe([[0, -h], [r, -h], [r, -h * 0.2], [r * 0.9, h * 0.55], [r * 0.55, h], [0, h]], { segments: 28, smooth: 60 });
}
