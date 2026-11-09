// What a sighted helper sees of a Fly by Sound world (v0.12, docs/wip/v12-plan.md 2.5 and 4.2 step 6; spec section 4):
// the world drawn as primitives (v0.13: in a game's look, look.ts), the walls, floor and ceiling as thin slabs and the objects
// (rings, squares, cube frames, pillars, boxes, zones) as boxes, cylinders and tori, so the helper sees what the pilot
// hears. Two parts:
//
//   pure     worldPrims / roomPrims / objectPrims turn a world into a list of Prim (kind, role, pose, size). Nothing
//            here touches the engine, so Node tests hold the picture to the world: every wall the sound's rays can
//            hit has a slab on it, every slab stands on a wall, and every ring, bar and pillar lies where its shape
//            says (tools/bench/test/sonic-primitives.test.ts).
//   stage    PrimitiveStage puts a list of Prim into the page's renderer under a root of its own
//            (renderer.app.root, never debrisRoot, which the session clears with dispose()), and can light the
//            target gate. v0.13 (M41-23, lane v13-look): in the look of look.ts, a game's blocks and checker floor, a
//            hemisphere and a sun baked per vertex, soft fog, bright obstacles; the room as one mesh per role, a ring
//            a torus of its own radii, a pillar or a bar the engine's unit cylinder or box scaled.
//
// The room is drawn as the boundary of the hollow the generators carve out of solid rock (a union of axis-aligned
// boxes, `cavityBoxes`: the package's own `world.cavities` since v0.13, so every generator and version is drawn as
// it is built, the tunnels of corridor version 2 included): each face of each box, less what other boxes cover,
// becomes a slab SLAB_M thick standing OUTSIDE the hollow, so the free space is exactly the world's and the camera
// inside sees the slab's inner face (no culling trick). A scan's walls are the scan itself: for a scan only the track's gates
// are drawn (the objects of ScanSonicWorld, already through the scene transform).
import {
    ADDRESS_REPEAT, BoxGeometry, Color, CylinderGeometry, Entity, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, FOG_LINEAR, FOG_NONE, Mesh, MeshInstance,
    PIXELFORMAT_RGBA8, PRIMITIVE_TRIANGLES, Quat as PcQuat, StandardMaterial, Texture, TorusGeometry, Vec3 as PcVec3
} from 'playcanvas';
import type { AppBase, GraphicsDevice } from 'playcanvas';
import { quatAxisAngle, quatMultiply, quatRotate } from '@shramko/sonic-fpv';
import type { AnalyticWorldInfo, CavityBox, ObjectShape, Quat, ResolvedParams, SonicObject, Vec3 } from '@shramko/sonic-fpv';
import { ALBEDO, FOG_END_M, FOG_START_M, ROLE_PAINT, SKY, TARGET_ALBEDO, blockPattern, checkerPattern, objectColors, roomMesh, toSrgb } from './look';
import type { MeshData, Pattern, Rgb } from './look';

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
    /** a slab of the room: the unit axis from it into the hollow (the face the look draws, v0.13 look.ts); objects have none */
    readonly facing?: Vec3;
}

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

/** One box of the hollow: centre and half extents, metres (the package's CavityBox). */
export type Cavity = CavityBox;

const num = (p: ResolvedParams, name: string): number => p[name] as number;

/**
 * The hollow of a world as boxes, or null for the open world (a floor, no walls): the package's own boxes
 * (`AnalyticWorldInfo.cavities`, the shell exactly, objects not included), copied. The test in
 * tools/bench/test/sonic-primitives.test.ts holds them to the world's own signed distance function.
 */
export function cavityBoxes(world: AnalyticWorldInfo): Cavity[] | null {
    return world.cavities === null ? null : world.cavities.map((b) => ({ ...b }));
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
    const facing: [number, number, number] = [0, 0, 0];
    facing[f.axis] = -f.side;
    return { kind: 'box', role, objectId: null, pos: centre, quat: [1, 0, 0, 0], size, facing };
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
    const out: Prim[] = [{ kind: 'box', role: 'floor', objectId: null, pos: [0, -SLAB_M / 2, 0], quat: [1, 0, 0, 0], size: [2 * half, SLAB_M, 2 * half], facing: [0, 1, 0] }];
    if (ceiling > 0) out.push({ kind: 'box', role: 'ceiling', objectId: null, pos: [0, ceiling + SLAB_M / 2, 0], quat: [1, 0, 0, 0], size: [2 * half, SLAB_M, 2 * half], facing: [0, -1, 0] });
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

/** How the stage paints: the look (look.ts), or one flat colour per kind of surface for measuring (ROLE_PAINT, no fog). */
export type StagePaint = 'look' | 'roles';

const ROOM_ROLES: readonly PrimRole[] = ['floor', 'wall', 'ceiling'];
const isRoom = (role: PrimRole): boolean => role === 'floor' || role === 'wall' || role === 'ceiling';
const srgbColor = (c: Rgb): Color => {
    const s = toSrgb(c);
    return new Color(s[0], s[1], s[2]);
};

/** A mesh from look.ts's arrays (16-bit indices when they fit). */
function meshOf(device: GraphicsDevice, d: MeshData): Mesh {
    const mesh = new Mesh(device);
    mesh.setPositions(d.positions);
    mesh.setNormals(d.normals);
    mesh.setUvs(0, d.uvs);
    mesh.setColors(d.colors);
    mesh.setIndices(d.positions.length / 3 <= 65535 ? Uint16Array.from(d.indices) : d.indices);
    mesh.update(PRIMITIVE_TRIANGLES);
    return mesh;
}

/**
 * An object's part as a mesh: the engine's unit box or cylinder (scaled by its entity) or a torus of its own radii, its light
 * baked as float vertex colours (Mesh.fromGeometry would take a geometry's colours as 8-bit, where a light of 0.8 is black).
 */
function partMesh(device: GraphicsDevice, p: Prim): Mesh {
    const g = p.kind === 'torus'
        ? new TorusGeometry({ ringRadius: p.size[0], tubeRadius: p.size[1], segments: 28, sides: 56 })
        : p.kind === 'cylinder'
            ? new CylinderGeometry({ radius: 0.5, height: 1, heightSegments: 1, capSegments: 32 })
            : new BoxGeometry({ halfExtents: new PcVec3(0.5, 0.5, 0.5) });
    const normals = Float32Array.from(g.normals!);
    const count = g.positions.length / 3;
    return meshOf(device, {
        positions: Float32Array.from(g.positions),
        normals,
        uvs: g.uvs ? Float32Array.from(g.uvs) : new Float32Array(count * 2),
        colors: objectColors(normals, p.quat),
        indices: Uint32Array.from(g.indices!)
    });
}

/** A look's pattern as a texture: RGBA8 read as linear multipliers, repeated, mipmapped. */
function patternTexture(device: GraphicsDevice, name: string, p: Pattern): Texture {
    return new Texture(device, {
        name, width: p.px, height: p.px, format: PIXELFORMAT_RGBA8, mipmaps: true, anisotropy: 8,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR, addressU: ADDRESS_REPEAT, addressV: ADDRESS_REPEAT,
        levels: [p.data]
    });
}

/**
 * The helper's view in the page, drawn in the look of look.ts (v0.13, M41-23): the room's slabs of each role (floor,
 * walls, ceiling) as ONE mesh of the faces toward the hollow, block or checker textured in world metres, the
 * hemisphere-and-sun light baked per vertex, unlit materials; each object's part a mesh of its own with its light baked
 * (the target lit by its material); soft fog toward the sky while a lesson world's room is shown (a scan lesson's gates
 * alone leave the scene's fog as it is). show() replaces everything, setTarget() lights the next gate, paint('roles')
 * paints every kind of surface one flat colour for measuring, dispose() takes it all off. Nothing here runs while no
 * world is shown.
 */
export class PrimitiveStage {
    private readonly r: StageRenderer;
    private root: Entity | null = null;
    private shown: Shown[] = [];
    private primCount = 0;
    private readonly materials = new Map<string, StandardMaterial>();
    private textures: { block: Texture; checker: Texture } | null = null;
    private target: string | null = null;
    private painted: StagePaint = 'look';
    /** the scene's fog before this stage set its own (a lesson world's room is shown), restored by clear() */
    private fogBefore: { type: string; color: Color; start: number; end: number } | null = null;

    constructor(renderer: StageRenderer) {
        this.r = renderer;
        // the page's test hook (window.__gsfpv, when there is one): the benches switch the paint to measure the look's contrast
        // on the page's own pictures (tools/bench/src/v13-look-page.ts); in Node there is none
        const hook = (globalThis as { __gsfpv?: Record<string, unknown> }).__gsfpv;
        if (hook) hook.sonicLook = { paint: (mode: StagePaint) => this.paint(mode), mode: () => this.painted, count: () => this.primCount };
    }

    /** Primitives on the stage now (a room's slabs count one each, though each role is one mesh). */
    get count(): number {
        return this.primCount;
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

    /** How the stage paints now. */
    get paintMode(): StagePaint {
        return this.painted;
    }

    private patterns(): { block: Texture; checker: Texture } {
        this.textures ??= { block: patternTexture(this.r.device, 'sonic-blocks', blockPattern()), checker: patternTexture(this.r.device, 'sonic-checker', checkerPattern()) };
        return this.textures;
    }

    /** The material of a role (lit: the target), in the paint now. */
    private material(role: PrimRole, lit: boolean): StandardMaterial {
        const key = `${this.painted}:${lit ? 'target' : role}`;
        let m = this.materials.get(key);
        if (m) return m;
        m = new StandardMaterial();
        m.useLighting = false;
        m.useSkybox = false;
        m.diffuse = new Color(0, 0, 0);
        if (this.painted === 'roles') {
            m.emissive = srgbColor(ROLE_PAINT[isRoom(role) ? (role as 'floor' | 'wall' | 'ceiling') : 'object']);
            m.useFog = false;
        } else {
            m.emissive = srgbColor(lit ? TARGET_ALBEDO : ALBEDO[role]);
            m.emissiveVertexColor = true;
            if (isRoom(role)) m.emissiveMap = role === 'floor' ? this.patterns().checker : this.patterns().block;
        }
        m.update();
        this.materials.set(key, m);
        return m;
    }

    /**
     * Replaces everything on the stage with these primitives. The meshes are made for this show; the engine frees a mesh
     * with its last mesh instance (MeshInstance.destroy), so none is kept between shows.
     */
    show(prims: readonly Prim[]): void {
        this.clear();
        const app = this.r.app;
        const device = this.r.device;
        const root = new Entity('sonic-stage', app);
        app.root.addChild(root);
        this.root = root;
        // the room: one mesh per role, of the faces toward the hollow
        let room = false;
        for (const role of ROOM_ROLES) {
            const quads = prims.filter((p) => p.role === role && p.facing !== undefined).map((p) => ({ pos: p.pos, size: p.size, facing: p.facing! }));
            if (quads.length === 0) continue;
            room = true;
            const mi = new MeshInstance(meshOf(device, roomMesh(quads)), this.material(role, false));
            const e = new Entity(`sonic-${role}`, app);
            e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
            root.addChild(e);
            this.shown.push({ entity: e, role, objectId: null, instances: [mi] });
        }
        // the objects: a mesh per part
        for (const p of prims) {
            if (isRoom(p.role) && p.facing !== undefined) continue;
            const e = new Entity(`sonic-${p.role}`, app);
            const mi = new MeshInstance(partMesh(device, p), this.material(p.role, false));
            e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
            if (p.kind !== 'torus') e.setLocalScale(p.size[0], p.size[1], p.size[2]);
            e.setPosition(p.pos[0], p.pos[1], p.pos[2]);
            e.setRotation(new PcQuat(p.quat[1], p.quat[2], p.quat[3], p.quat[0]));
            root.addChild(e);
            this.shown.push({ entity: e, role: p.role, objectId: p.objectId, instances: [mi] });
        }
        this.primCount = prims.length;
        if (room) this.fogOn();
        this.lightTarget();
    }

    /** Lights the object `id` (the next gate or zone), or none: its parts take the target's material, the others their own. */
    setTarget(id: string | null): void {
        if (id === this.target) return;
        this.target = id;
        this.lightTarget();
    }

    /** Paints the stage in the look, or one flat colour per kind of surface with no fog (a measurement of what is where). */
    paint(mode: StagePaint): void {
        if (mode === this.painted) return;
        this.painted = mode;
        for (const s of this.shown) for (const mi of s.instances) mi.material = this.material(s.role, s.objectId !== null && s.objectId === this.target);
        if (this.fogBefore) this.applyFog();
    }

    private lightTarget(): void {
        for (const s of this.shown) {
            if (s.objectId === null) continue;
            const m = this.material(s.role, s.objectId === this.target);
            for (const mi of s.instances) mi.material = m;
        }
    }

    /** The lesson world's fog on the scene, the scene's own kept for clear(). */
    private fogOn(): void {
        const fog = this.r.app.scene.fog;
        if (!this.fogBefore) this.fogBefore = { type: fog.type, color: fog.color.clone(), start: fog.start, end: fog.end };
        this.applyFog();
    }

    private applyFog(): void {
        const fog = this.r.app.scene.fog;
        if (this.painted === 'roles') {
            fog.type = FOG_NONE;
            return;
        }
        fog.type = FOG_LINEAR;
        fog.color = srgbColor(SKY);
        fog.start = FOG_START_M;
        fog.end = FOG_END_M;
    }

    private fogOff(): void {
        const before = this.fogBefore;
        if (!before) return;
        this.fogBefore = null;
        const fog = this.r.app.scene.fog;
        fog.type = before.type;
        fog.color = before.color;
        fog.start = before.start;
        fog.end = before.end;
    }

    /** Takes every primitive off the stage (the root stays for the next show), and the lesson world's fog with them. */
    clear(): void {
        for (const s of this.shown) s.entity.destroy();
        this.shown = [];
        this.primCount = 0;
        if (this.root) {
            this.root.destroy();
            this.root = null;
        }
        this.target = null;
        this.fogOff();
    }

    /** Takes the stage off the renderer for good: primitives, materials and textures (the meshes go with their instances). */
    dispose(): void {
        this.clear();
        const hook = (globalThis as { __gsfpv?: Record<string, unknown> }).__gsfpv;
        if (hook) delete hook.sonicLook;
        for (const m of this.materials.values()) m.destroy();
        this.materials.clear();
        if (this.textures) {
            this.textures.block.destroy();
            this.textures.checker.destroy();
            this.textures = null;
        }
    }
}
