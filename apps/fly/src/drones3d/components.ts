// Parts that recur across the drone models (v0.9 lane D): motor, propeller, lens, FPV cameras, DJI units, LiPo pack,
// connector, strap, antenna, standoff. Each adds its meshes to a Kit at a parent transform. Local frame of every part:
// origin on the plane it sits on, +Y up, the lens or the pack's front towards -Z. Millimetres. No engine.
import { cylinder, lathe, propHub, propeller, ring, roundedBox, sphere, tube } from './shapes';
import type { Kit } from './kit';
import type { Connector } from './equipment';
import { at } from './kit';
import type { PackDims } from './build';
import type { Affine } from './xform';
import type { Vec3 } from './mesh';

export interface MotorOptions {
    canD: number;
    canH: number;
    shaftR: number;
}

/** A brushless motor standing on y = 0: mount, bell in the accent colour, a ring, the shaft. Returns the y of its top. */
export function motor(kit: Kit, T: Affine, o: MotorOptions): number {
    const R = o.canD / 2, H = o.canH, y0 = H * 0.2;
    kit.add('motor-base', 'alu-black', cylinder(R * 0.86, H * 0.2, { segments: 36 }), at(T, { at: [0, H * 0.1, 0] }));
    kit.add('motor-bell', 'accent', lathe([[0, y0], [R * 0.98, y0], [R, y0 + 0.5], [R, H - 1], [R - 1, H], [R * 0.5, H], [R * 0.42, H + 0.5], [0, H + 0.5]], { segments: 44, smooth: 35 }), T);
    kit.add('motor-ring', 'alu-silver', ring(R * 0.985, R * 1.012, Math.max(0.5, H * 0.04), { segments: 44 }), at(T, { at: [0, y0 + H * 0.1, 0] }));
    kit.add('motor-shaft', 'alu-silver', cylinder(o.shaftR, 5, { segments: 14 }), at(T, { at: [0, H + 2, 0] }));
    return H + 0.5;
}

export interface PropOptions {
    diameter: number;
    blades: number;
    pitchRatio: number;
    ccw: boolean;
    /** hub radius, mm (default: 0.07 x diameter, 3 mm at least) */
    hubR?: number;
}

/** A propeller with its nut, blades centred on the plane y = 0 of the transform. */
export function prop(kit: Kit, T: Affine, o: PropOptions): void {
    const hubR = o.hubR ?? Math.max(2.6, o.diameter * 0.04);
    kit.add('prop', 'prop', propeller({ diameter: o.diameter, blades: o.blades, hubRadius: hubR, pitchRatio: o.pitchRatio, ccw: o.ccw, stations: 12 }), T);
    kit.add('prop-hub', 'alu-silver', propHub(hubR * 1.05, hubR * 1.1), at(T, { at: [0, hubR * 0.05, 0] }));
}

export interface LensOptions {
    /** barrel radius, mm */
    r: number;
    /** barrel length, mm */
    len: number;
    /** front glass radius, mm */
    glassR: number;
}

/** A lens barrel with a glass dome, its back at the origin and the glass facing -Z. */
export function lens(kit: Kit, T: Affine, o: LensOptions): void {
    const { r, len, glassR } = o;
    const A = at(T, { rot: [-90, 0, 0] });
    kit.add('lens-barrel', 'alu-black', lathe([[0, 0], [r, 0], [r, len * 0.62], [r * 0.9, len * 0.66], [r * 0.9, len - 0.5], [r * 0.82, len], [glassR * 1.1, len], [glassR * 1.1, len - 0.7], [0, len - 0.7]], { segments: 36, smooth: 30 }), A);
    kit.add('lens-ring', 'alu-silver', ring(glassR * 1.0, glassR * 1.16, 0.7, { segments: 36 }), at(A, { at: [0, len - 0.25, 0] }));
    kit.add('lens-glass', 'glass', sphere(glassR, { squash: 0.42, rings: 8, segments: 32 }), at(A, { at: [0, len - 0.7, 0] }));
}

/** A small analog FPV camera: a square housing and a lens in its front face (-Z). Centred on the origin. */
export function microCam(kit: Kit, T: Affine, o: { w: number; h: number; d: number; lensR: number }): void {
    kit.add('cam-housing', 'plastic', roundedBox(o.w, o.h, o.d, { radius: 1.1, seg: 2 }), T);
    lens(kit, at(T, { at: [0, 0, -o.d / 2 + 0.6] }), { r: o.lensR, len: o.lensR * 0.9, glassR: o.lensR * 0.62 });
}

export type DjiKind = 'dji-o4-pro' | 'dji-o3';

/** Published sizes, mm: module w x h x d; camera w x h x d with the depth along the viewing axis. DJI store, iFlight, retail listings. */
export const DJI_SIZES: Readonly<Record<DjiKind, { module: Vec3; camera: Vec3; lensR: number }>> = {
    'dji-o4-pro': { module: [33.5, 13, 33.5], camera: [20, 23.3, 25.55], lensR: 8.4 },
    'dji-o3': { module: [32.5, 14.5, 30.5], camera: [20, 19.5, 21.2], lensR: 7.4 }
};

/** The transmission unit: a dark heat-sink shell with fins on top, a board edge and two antenna sockets. Centred on the origin. */
export function djiModule(kit: Kit, T: Affine, kind: DjiKind): void {
    const [w, h, d] = DJI_SIZES[kind].module;
    kit.add('dji-shell', 'alu-black', roundedBox(w, h, d, { radius: 1.6, seg: 2 }), T);
    kit.add('dji-board', 'pcb', roundedBox(w * 0.92, 1.4, d * 0.92, { radius: 0.3, seg: 1 }), at(T, { at: [0, -h / 2 - 0.1, 0] }));
    for (let i = 0; i < 7; i++) kit.add('dji-fin', 'alu-silver', roundedBox(w * 0.78, 0.7, 1.1, { radius: 0.3, seg: 1 }), at(T, { at: [0, h / 2 + 0.2, (i - 3) * (d * 0.1)] }));
    for (const sx of [-1, 1]) kit.add('dji-socket', 'alu-silver', cylinder(1.1, 2.2, { segments: 12 }), at(T, { at: [sx * w * 0.3, 0, d / 2 + 0.6], rot: [90, 0, 0] }));
}

/** The camera unit: housing and lens facing -Z, centred on the origin. */
export function djiCamera(kit: Kit, T: Affine, kind: DjiKind): void {
    const { camera: [w, h, d], lensR } = DJI_SIZES[kind];
    kit.add('dji-cam', 'plastic', roundedBox(w, h, d, { radius: 2.2, seg: 3 }), T);
    lens(kit, at(T, { at: [0, 0, -d / 2 + 0.8] }), { r: lensR, len: lensR * 0.75, glassR: lensR * 0.7 });
    // the thin coax leaving the back
    kit.add('dji-coax', 'rubber', tube([[0, -h * 0.2, d / 2 - 1], [0, -h * 0.35, d / 2 + 5], [0, -h * 0.55, d / 2 + 12]].map((p) => p as Vec3), 0.9, { radial: 8, sub: 4 }), T);
}

const CONNECTORS: Readonly<Record<Connector, { w: number; h: number; d: number; wire: number }>> = {
    XT30: { w: 10, h: 5, d: 11, wire: 0.9 },
    XT60: { w: 16, h: 8, d: 15, wire: 1.5 },
    XT90: { w: 20.5, h: 11, d: 18, wire: 2.1 },
    'BT2.0': { w: 6.5, h: 4, d: 8, wire: 0.5 }
};

/**
 * A LiPo pack lying along Z with its centre on the origin, a label panel on top, and its connector and two wires
 * leaving the rear (+Z). Returns the connector's end z.
 */
export function pack(kit: Kit, T: Affine, dims: PackDims, connector: Connector): number {
    const { w, h, l } = dims;
    kit.add('pack', 'lipo', roundedBox(w, h, l, { radius: Math.min(2.2, w * 0.12), seg: 3 }), T);
    kit.add('pack-label', 'label', roundedBox(w * 0.84, 0.5, l * 0.74, { radius: 0.25, seg: 1 }), at(T, { at: [0, h / 2 + 0.05, -l * 0.02] }));
    const c = CONNECTORS[connector];
    const zc = l / 2 + c.d / 2 - 1;
    kit.add('connector', connector === 'BT2.0' ? 'label' : 'connector', roundedBox(c.w, c.h, c.d, { radius: 0.7, seg: 2 }), at(T, { at: [0, -h * 0.1, zc] }));
    const zEnd = l / 2 + c.d - 1;
    for (const [sx, mat] of [[-1, 'wire-black'], [1, 'wire-red']] as const) {
        kit.add('pack-wire', mat, tube([[sx * c.w * 0.22, -h * 0.1, zEnd - 1], [sx * c.w * 0.3, -h * 0.1, zEnd + 6], [sx * c.w * 0.55, -h * 0.25, zEnd + 16]], c.wire, { radial: 8, sub: 4 }), T);
    }
    return zEnd;
}

/** A rubber strap round a pack (w x h) on a plate: a loop `len` wide along Z, centred on the origin, `yBelow` mm under it. */
export function strap(kit: Kit, T: Affine, o: { w: number; h: number; len: number; yBelow: number }): void {
    const t = 1.2, y0 = -o.yBelow, y1 = o.h / 2 + t / 2 - 0.3, mid = (y0 + y1) / 2, hh = y1 - y0;
    kit.add('strap-top', 'rubber', roundedBox(o.w + 2 * t, t, o.len, { radius: 0.4, seg: 1 }), at(T, { at: [0, y1, 0] }));
    kit.add('strap-bottom', 'rubber', roundedBox(o.w + 2 * t, t, o.len, { radius: 0.4, seg: 1 }), at(T, { at: [0, y0, 0] }));
    for (const sx of [-1, 1]) kit.add('strap-side', 'rubber', roundedBox(t, hh, o.len, { radius: 0.4, seg: 1 }), at(T, { at: [sx * (o.w / 2 + t / 2), mid, 0] }));
}

/** A whip antenna: a rubber base and a bent tube, standing on the origin and leaning towards +Z. */
export function antenna(kit: Kit, T: Affine, len: number): void {
    kit.add('antenna-base', 'tpu', roundedBox(6, 5, 9, { radius: 1, seg: 2 }), at(T, { at: [0, 2.5, 0] }));
    kit.add('antenna-whip', 'rubber', tube([[0, 4, 1], [0, 4 + len * 0.55, 4 + len * 0.18], [0, 4 + len * 0.9, 4 + len * 0.55]], 1.15, { radial: 8, sub: 6, endRadius: 0.9 }), T);
}

/** A round standoff in the accent colour with a screw head on top, standing on y = 0. */
export function standoff(kit: Kit, T: Affine, h: number, r: number): void {
    kit.add('standoff', 'accent', cylinder(r, h, { segments: 14, bevel: 0.25 }), at(T, { at: [0, h / 2, 0] }));
    kit.add('screw-head', 'alu-silver', cylinder(r * 0.9, 1.2, { segments: 12, bevel: 0.25 }), at(T, { at: [0, h + 0.6, 0] }));
}

/** The four corners of an X as [sx, sz]; sz < 0 is the front. */
export const CORNERS: readonly (readonly [number, number])[] = [[1, -1], [-1, -1], [1, 1], [-1, 1]];
