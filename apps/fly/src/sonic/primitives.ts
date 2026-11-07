// What a sighted helper sees of a Fly by Sound world (v0.12, docs/wip/v12-plan.md 2.5 and 4.2 step 6; spec section 4):
// the world drawn as plain primitives on a dark background, the walls, floor and ceiling as thin slabs and the objects
// (rings, squares, cube frames, pillars, boxes, zones) as boxes, cylinders and tori, so the helper sees what the pilot
// hears. Two parts:
//
//   pure     worldPrims / roomPrims / objectPrims turn a world into a list of Prim (kind, role, pose, size). Nothing
//            here touches the engine, so Node tests hold the picture to the world: every wall the sound's rays can
//            hit has a slab on it, every slab stands on a wall, and every ring, bar and pillar lies where its shape
//            says (tools/bench/test/sonic-primitives.test.ts).
//   stage    PrimitiveStage puts a list of Prim into the page's renderer under a root of its own
//            (renderer.app.root, never debrisRoot, which the session clears with dispose()), and can light the
//            target gate. Boxes and cylinders are the engine's own render shapes; a ring is a torus made with the
//            ring's radii, because the engine's 'torus' shape has fixed ones.
//
// The room is drawn as the boundary of the hollow the generators carve out of solid rock (a union of axis-aligned
// boxes, `cavityBoxes`, mirroring src/world/generators.ts: the package does not hand them out, "Needs from
// sonic-core" in docs/wip/v12-flight.md): each face of each box, less what other boxes cover, becomes a slab
// SLAB_M thick standing OUTSIDE the hollow, so the free space is exactly the world's and the camera inside sees
// the slab's inner face (no culling trick). A scan's walls are the scan itself: for a scan only the track's gates
// are drawn (the objects of ScanSonicWorld, already through the scene transform).
import { Color, Entity, Mesh, MeshInstance, Quat as PcQuat, StandardMaterial, TorusGeometry } from 'playcanvas';
import type { AppBase, GraphicsDevice } from 'playcanvas';
import { quatAxisAngle, quatMultiply, quatRotate } from '@shramko/sonic-fpv';
import type { AnalyticWorldInfo, ObjectShape, Quat, ResolvedParams, SonicObject, Vec3 } from '@shramko/sonic-fpv';

/** Thickness of a wall, floor or ceiling slab, metres. */
export const SLAB_M = 0.05;
/** Thickness of the bars that outline a zone, metres. */
export const ZONE_BAR_M = 0.04;

export type PrimKind = 'box' | 'cylinder' | 'torus';
export type PrimRole = 'floor' | 'wall' | 'ceiling' | 'gate' | 'pillar' | 'box' | 'zone';

/** One primitive of the helper's view, in the flown world. */
export interface Prim {
    readonly kind: PrimKind;
    readonly role: PrimRole;
    /** the SonicObject this belongs to (all the bars of a square share one), or null for the room */
    readonly objectId: string | null;
    readonly pos: Vec3;
    /** [w, x, y, z], the primitive's own frame to the world; the frames are the engine's: box x y z, cylinder and torus axis Y */
    readonly quat: Quat;
    /** box: full extents; cylinder: [diameter, height, diameter]; torus: [ring radius (centre line), tube radius, 0] */
    readonly size: Vec3;
}

/** The colours of the helper's view, sRGB 0..1: surfaces quiet, things to fly at or to avoid louder. */
export const PRIM_COLOURS: Readonly<Record<PrimRole, readonly [number, number, number]>> = {
    floor: [0.27, 0.36, 0.3],
    wall: [0.36, 0.4, 0.52],
    ceiling: [0.3, 0.3, 0.38],
    gate: [0.95, 0.5, 0.1],
    pillar: [0.82, 0.22, 0.2],
    box: [0.62, 0.52, 0.22],
    zone: [0.2, 0.8, 0.5]
};
/** The next gate or zone (the target layer's source) is lit in this colour. */
export const TARGET_COLOUR: readonly [number, number, number] = [1, 0.92, 0.12];

// ------------------------------------------------------------------ objects

/** Rotation that turns the engine's torus (axis Y) into a ring whose opening faces local Z: +90 degrees about X. */
const TORUS_TO_Z: Quat = quatAxisAngle([1, 0, 0], Math.PI / 2);

/** A bar (box) of an object, `at` in the object's frame, `size` full extents. */
function bar(o: SonicObject, role: PrimRole, at: Vec3, size: Vec3): Prim {
    const r = quatRotate(o.quat, at);
    return { kind: 'box', role, objectId: o.id, pos: [o.pos[0] + r[0], o.pos[1] + r[1], o.pos[2] + r[2]], quat: o.quat, size };
}

/** The primitives of one object: a torus, bars, a cylinder or a box. A zone is the twelve edges of its box. */
export function shapePrims(o: SonicObject): Prim[] {
    const s: ObjectShape = o.shape;
    switch (s.kind) {
        case 'ring': {
            // the centre line of the tube has radius diameter / 2 + tube (src/world/parts.ts)
            return [{ kind: 'torus', role: 'gate', objectId: o.id, pos: o.pos, quat: quatMultiply(o.quat, TORUS_TO_Z), size: [s.diameter / 2 + s.tube, s.tube, 0] }];
        }
        case 'square': {
            // four bars, `bar` x `bar`; the clear opening is `side`, the outer side side + 2 * bar (sdSquareFrame)
            const c = s.side / 2 + s.bar / 2;
            return [
                bar(o, 'gate', [0, c, 0], [s.side + 2 * s.bar, s.bar, s.bar]),
                bar(o, 'gate', [0, -c, 0], [s.side + 2 * s.bar, s.bar, s.bar]),
                bar(o, 'gate', [c, 0, 0], [s.bar, s.side, s.bar]),
                bar(o, 'gate', [-c, 0, 0], [s.bar, s.side, s.bar])
            ];
        }
        case 'cube-frame': {
            // twelve edges; each face's clear opening is `side` (sdCubeFrame)
            const c = s.side / 2 + s.bar / 2;
            const l = s.side + 2 * s.bar;
            const out: Prim[] = [];
            for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(bar(o, 'gate', [0, sy * c, sz * c], [l, s.bar, s.bar]));
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(bar(o, 'gate', [sx * c, 0, sz * c], [s.bar, l, s.bar]));
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push(bar(o, 'gate', [sx * c, sy * c, 0], [s.bar, s.bar, l]));
            return out;
        }
        case 'pillar':
            return [{ kind: 'cylinder', role: 'pillar', objectId: o.id, pos: o.pos, quat: o.quat, size: [2 * s.radius, s.height, 2 * s.radius] }];
        case 'box':
            return [{ kind: 'box', role: 'box', objectId: o.id, pos: o.pos, quat: o.quat, size: s.size }];
        case 'zone': {
            const [sx, sy, sz] = s.size;
            const b = ZONE_BAR_M;
            const out: Prim[] = [];
            for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(bar(o, 'zone', [0, (y * sy) / 2, (z * sz) / 2], [sx + b, b, b]));
            for (const x of [-1, 1]) for (const z of [-1, 1]) out.push(bar(o, 'zone', [(x * sx) / 2, 0, (z * sz) / 2], [b, sy + b, b]));
            for (const x of [-1, 1]) for (const y of [-1, 1]) out.push(bar(o, 'zone', [(x * sx) / 2, (y * sy) / 2, 0], [b, b, sz + b]));
            return out;
        }
    }
}

/** The primitives of a list of objects (a lesson world's, or a scan's track gates through the scene transform). */
export function objectPrims(objects: readonly SonicObject[]): Prim[] {
    return objects.flatMap(shapePrims);
}

// ------------------------------------------------------------------ the room

/** One box of the hollow: centre and half extents, metres (src/world/parts.ts Box). */
export interface Cavity {
    readonly cx: number;
    readonly cy: number;
    readonly cz: number;
    readonly hx: number;
    readonly hy: number;
    readonly hz: number;
}

const num = (p: ResolvedParams, name: string): number => p[name] as number;

/** The corridor's boxes, as src/world/generators.ts buildCorridor lays them out (same walk, same numbers). */
function corridorCavities(p: ResolvedParams): Cavity[] {
    const w = num(p, 'widthM'), h = num(p, 'heightM');
    const layout = p['layout'] as string;
    const seg = num(p, 'segmentM');
    const rise = num(p, 'riseM');
    const even = (k: number): number => (k % 2 === 0 ? k : k + 1);
    const bends = even(num(p, 'bendCount'));
    const jogs = even(num(p, 'jogCount'));
    const boxes: Cavity[] = [];
    let x = 0, y = 0, z = 0;
    let hx = 0, hz = -1; // heading on the floor plane: -Z first
    const forward = (len: number): void => {
        const nx = x + hx * len, nz = z + hz * len;
        const alongX = hx !== 0;
        const half = len / 2 + w / 2;
        boxes.push({ cx: (x + nx) / 2, cy: y + h / 2, cz: (z + nz) / 2, hx: alongX ? half : w / 2, hy: h / 2, hz: alongX ? w / 2 : half });
        x = nx;
        z = nz;
    };
    const turn = (dir: 'left' | 'right'): void => {
        const [a, b] = dir === 'right' ? [-hz, hx] : [hz, -hx];
        hx = a + 0;
        hz = b + 0;
    };
    const jog = (dy: number): void => {
        const lo = Math.min(y, y + dy), hi = Math.max(y, y + dy);
        boxes.push({ cx: x, cy: (lo + hi + h) / 2, cz: z, hx: w / 2, hy: (hi - lo + h) / 2, hz: w / 2 });
        y += dy;
    };
    const straight = (): void => forward(num(p, 'straightM'));
    const obstacle = (): void => forward(2 * seg);
    const bendSection = (): void => {
        for (let i = 0; i < bends; i++) {
            turn(i % 2 === 0 ? 'right' : 'left');
            forward(seg);
        }
    };
    const jogSection = (): void => {
        forward(seg);
        for (let i = 0; i < jogs; i++) {
            jog(i % 2 === 0 ? rise : -rise);
            forward(seg);
        }
    };
    const mixedSection = (): void => {
        for (let i = 0; i < bends; i++) {
            turn(i % 2 === 0 ? 'right' : 'left');
            forward(seg);
        }
    };
    switch (layout) {
        case 'straight':
            straight();
            break;
        case 'obstacle':
            forward(seg);
            obstacle();
            break;
        case 'bends':
            forward(seg);
            bendSection();
            break;
        case 'jogs':
            jogSection();
            break;
        default:
            straight();
            obstacle();
            bendSection();
            jogSection();
            mixedSection();
    }
    return boxes;
}

/**
 * The hollow of a world as boxes, or null for the open world (a floor, no walls). The generators do not hand their
 * hollow out; this mirrors them, and the test in tools/bench/test/sonic-primitives.test.ts holds it to the world's
 * own signed distance function.
 */
export function cavityBoxes(world: AnalyticWorldInfo): Cavity[] | null {
    const p = world.resolved;
    switch (world.spec.generator) {
        case 'open':
            return null;
        case 'corridor':
            return corridorCavities(p);
        case 'hall':
        case 'pillars':
        case 'rings':
        case 'squares':
        case 'cube-frames': {
            const w = num(p, 'widthM'), d = num(p, 'depthM'), h = num(p, 'heightM');
            return [{ cx: 0, cy: h / 2, cz: 0, hx: w / 2, hy: h / 2, hz: d / 2 }];
        }
    }
}

/** A rectangle of a face, in the face's two other axes (ascending). */
interface Rect {
    readonly u0: number;
    readonly u1: number;
    readonly v0: number;
    readonly v1: number;
}

/** One exposed piece of the hollow's boundary: it faces `side` along `axis` at `plane`. */
export interface Face extends Rect {
    readonly axis: 0 | 1 | 2;
    /** +1: the hollow ends here going up the axis (the solid is beyond), -1: it begins here */
    readonly side: -1 | 1;
    readonly plane: number;
}

const EPS = 1e-6;

/** `r` less `cut`: up to four rectangles, none overlapping `cut`. */
function minus(r: Rect, cut: Rect): Rect[] {
    if (cut.u1 <= r.u0 + EPS || cut.u0 >= r.u1 - EPS || cut.v1 <= r.v0 + EPS || cut.v0 >= r.v1 - EPS) return [r];
    const out: Rect[] = [];
    if (cut.u0 > r.u0 + EPS) out.push({ u0: r.u0, u1: cut.u0, v0: r.v0, v1: r.v1 });
    if (cut.u1 < r.u1 - EPS) out.push({ u0: cut.u1, u1: r.u1, v0: r.v0, v1: r.v1 });
    const m0 = Math.max(r.u0, cut.u0), m1 = Math.min(r.u1, cut.u1);
    if (cut.v0 > r.v0 + EPS) out.push({ u0: m0, u1: m1, v0: r.v0, v1: cut.v0 });
    if (cut.v1 < r.v1 - EPS) out.push({ u0: m0, u1: m1, v0: cut.v1, v1: r.v1 });
    return out;
}

/**
 * The boundary of the union of the boxes: every face of every box, less where another box covers the far side of it
 * (both sides free: not a wall) and less what an earlier box already has on the same plane facing the same way (the
 * floors of two segments are drawn once). Pieces thinner than a micrometre are dropped.
 */
export function exposedFaces(boxes: readonly Cavity[]): Face[] {
    const lo = boxes.map((b) => [b.cx - b.hx, b.cy - b.hy, b.cz - b.hz] as const);
    const hi = boxes.map((b) => [b.cx + b.hx, b.cy + b.hy, b.cz + b.hz] as const);
    const faces: Face[] = [];
    for (let i = 0; i < boxes.length; i++) {
        for (const axis of [0, 1, 2] as const) {
            const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
            for (const side of [-1, 1] as const) {
                const plane = side > 0 ? hi[i]![axis] : lo[i]![axis];
                let pieces: Rect[] = [{ u0: lo[i]![ua]!, u1: hi[i]![ua]!, v0: lo[i]![va]!, v1: hi[i]![va]! }];
                for (let j = 0; j < boxes.length && pieces.length > 0; j++) {
                    if (j === i) continue;
                    const covers = side > 0 ? lo[j]![axis] <= plane + EPS && hi[j]![axis] > plane + EPS : hi[j]![axis] >= plane - EPS && lo[j]![axis] < plane - EPS;
                    const same = j < i && Math.abs((side > 0 ? hi[j]![axis] : lo[j]![axis]) - plane) <= EPS;
                    if (!covers && !same) continue;
                    const cut: Rect = { u0: lo[j]![ua]!, u1: hi[j]![ua]!, v0: lo[j]![va]!, v1: hi[j]![va]! };
                    pieces = pieces.flatMap((r) => minus(r, cut));
                }
                for (const r of pieces) if (r.u1 - r.u0 > EPS && r.v1 - r.v0 > EPS) faces.push({ axis, side, plane, ...r });
            }
        }
    }
    return faces;
}

/** A face as a slab standing outside the hollow. */
export function slabOf(f: Face): Prim {
    const centre: [number, number, number] = [0, 0, 0];
    const size: [number, number, number] = [0, 0, 0];
    const [ua, va] = f.axis === 0 ? [1, 2] : f.axis === 1 ? [0, 2] : [0, 1];
    centre[f.axis] = f.plane + (f.side * SLAB_M) / 2;
    size[f.axis] = SLAB_M;
    centre[ua!] = (f.u0 + f.u1) / 2;
    size[ua!] = f.u1 - f.u0;
    centre[va!] = (f.v0 + f.v1) / 2;
    size[va!] = f.v1 - f.v0;
    const role: PrimRole = f.axis === 1 ? (f.side < 0 ? 'floor' : 'ceiling') : 'wall';
    return { kind: 'box', role, objectId: null, pos: centre, quat: [1, 0, 0, 0], size };
}

/** The exposed faces of a world's hollow (none for the open world: a floor, no hollow). */
export function roomFaces(world: AnalyticWorldInfo): Face[] {
    const boxes = cavityBoxes(world);
    return boxes === null ? [] : exposedFaces(boxes);
}

/** The slabs of an analytic world's room: its hollow's boundary, or a floor (and ceiling) slab for the open world. */
export function roomPrims(world: AnalyticWorldInfo): Prim[] {
    const boxes = cavityBoxes(world);
    if (boxes !== null) return exposedFaces(boxes).map(slabOf);
    // the open world: ground up to y = 0 over its half size, a ceiling when it has one (src/world/generators.ts buildOpen)
    const half = num(world.resolved, 'halfSizeM');
    const ceiling = num(world.resolved, 'ceilingM');
    const out: Prim[] = [{ kind: 'box', role: 'floor', objectId: null, pos: [0, -SLAB_M / 2, 0], quat: [1, 0, 0, 0], size: [2 * half, SLAB_M, 2 * half] }];
    if (ceiling > 0) out.push({ kind: 'box', role: 'ceiling', objectId: null, pos: [0, ceiling + SLAB_M / 2, 0], quat: [1, 0, 0, 0], size: [2 * half, SLAB_M, 2 * half] });
    return out;
}

/** Everything the helper sees of an analytic lesson world: its room and its objects. */
export function worldPrims(world: AnalyticWorldInfo): Prim[] {
    return [...roomPrims(world), ...objectPrims(world.objects())];
}

// ------------------------------------------------------------------ the stage

/** What the stage needs of the page's renderer (SplatRenderer; a fake in tests). */
export interface StageRenderer {
    readonly app: AppBase;
    readonly device: GraphicsDevice;
}

interface Shown {
    readonly entity: Entity;
    readonly role: PrimRole;
    readonly objectId: string | null;
    readonly instances: readonly MeshInstance[];
}

const color = (c: readonly [number, number, number]): Color => new Color(c[0], c[1], c[2]);

/**
 * The helper's view in the page: the primitives under a root entity of this stage, replaced by show(), the target
 * gate lit by setTarget(), gone with dispose(). Nothing here runs while no world is shown.
 */
export class PrimitiveStage {
    private readonly r: StageRenderer;
    private root: Entity | null = null;
    private shown: Shown[] = [];
    private readonly materials = new Map<string, StandardMaterial>();
    private target: string | null = null;

    constructor(renderer: StageRenderer) {
        this.r = renderer;
    }

    /** Primitives on the stage now. */
    get count(): number {
        return this.shown.length;
    }

    /** The ids of the objects drawn (the target can be one of them). */
    get objectIds(): string[] {
        return [...new Set(this.shown.flatMap((s) => (s.objectId === null ? [] : [s.objectId])))];
    }

    /** The primitives of one object, in the order they were shown. */
    entitiesOf(objectId: string): Entity[] {
        return this.shown.filter((s) => s.objectId === objectId).map((s) => s.entity);
    }

    /** The root entity (null before the first show). */
    get rootEntity(): Entity | null {
        return this.root;
    }

    private material(role: PrimRole, lit: boolean): StandardMaterial {
        const key = lit ? 'target' : role;
        let m = this.materials.get(key);
        if (!m) {
            const c = lit ? TARGET_COLOUR : PRIM_COLOURS[role];
            m = new StandardMaterial();
            m.diffuse = color(c);
            // a little light of its own, so a face turned from the light is not black in the dark room
            m.emissive = new Color(c[0] * 0.28, c[1] * 0.28, c[2] * 0.28);
            m.update();
            this.materials.set(key, m);
        }
        return m;
    }

    /**
     * Replaces everything on the stage with these primitives. The tori of one size share a mesh for this show; the
     * engine frees a mesh with its last mesh instance (MeshInstance.destroy), so none is kept between shows.
     */
    show(prims: readonly Prim[]): void {
        this.clear();
        const app = this.r.app;
        const root = new Entity('sonic-stage', app);
        app.root.addChild(root);
        this.root = root;
        const tori = new Map<string, Mesh>();
        for (const p of prims) {
            const e = new Entity(`sonic-${p.role}`, app);
            let instances: MeshInstance[] = [];
            const material = this.material(p.role, false);
            if (p.kind === 'torus') {
                const key = `${p.size[0].toFixed(4)}:${p.size[1].toFixed(4)}`;
                let mesh = tori.get(key);
                if (!mesh) {
                    mesh = Mesh.fromGeometry(this.r.device, new TorusGeometry({ ringRadius: p.size[0], tubeRadius: p.size[1], segments: 28, sides: 56 }));
                    tori.set(key, mesh);
                }
                const mi = new MeshInstance(mesh, material);
                e.addComponent('render', { meshInstances: [mi], castShadows: false });
                instances = [mi];
            } else {
                e.addComponent('render', { type: p.kind, material, castShadows: false });
                e.setLocalScale(p.size[0], p.size[1], p.size[2]);
            }
            e.setPosition(p.pos[0], p.pos[1], p.pos[2]);
            e.setRotation(new PcQuat(p.quat[1], p.quat[2], p.quat[3], p.quat[0]));
            root.addChild(e);
            this.shown.push({ entity: e, role: p.role, objectId: p.objectId, instances });
        }
        this.lightTarget();
    }

    /** Lights the object `id` (the next gate or zone), or none: its bars take the target colour, the others their own. */
    setTarget(id: string | null): void {
        if (id === this.target) return;
        this.target = id;
        this.lightTarget();
    }

    private lightTarget(): void {
        for (const s of this.shown) {
            if (s.objectId === null) continue;
            const m = this.material(s.role, s.objectId === this.target);
            if (s.instances.length > 0) for (const mi of s.instances) mi.material = m;
            else {
                const render = s.entity.render;
                if (render) render.material = m;
            }
        }
    }

    /** Takes every primitive off the stage (the root stays for the next show). */
    clear(): void {
        for (const s of this.shown) s.entity.destroy();
        this.shown = [];
        if (this.root) {
            this.root.destroy();
            this.root = null;
        }
        this.target = null;
    }

    /** Takes the stage off the renderer for good: primitives and materials (the meshes go with their instances). */
    dispose(): void {
        this.clear();
        for (const m of this.materials.values()) m.destroy();
        this.materials.clear();
    }
}
