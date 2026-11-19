// The course drawn in the scan (train 1, lane tracks, T2; docs/wip/tracks-plan.md 2.3; model PrimitiveStage in
// sonic/primitives.ts): its own root under renderer.app.root; the gates as the sound mode's prims (shapePrims), coloured by
// state (next bright, later dim, passed darker still); chevrons along the course's path (coursePath) from the gate before the
// next one to two gates ahead, one every 2 m, flat at flying height, two thin boxes each. Public PlayCanvas API only: Entity,
// the render component, Mesh.fromGeometry, BoxGeometry, TorusGeometry, StandardMaterial, Texture (the same members
// PrimitiveStage uses, plus Mesh.fromGeometry and a canvas texture as drones3d/studio.ts tex()). Unlit flat colours; nothing
// here is solid.
// Lane course4, stage C1 (owner's message 55; lead decisions S1 and S2): the START / FINISH gate is a black and white checkered
// frame with a banner over it that says START, FINISH or START / FINISH (course/finish.ts gateRoles), and a checkered line on
// the ground under it where the ground is near; the gate to fly next carries a plate with its number.
import {
    ADDRESS_CLAMP_TO_EDGE, BoxGeometry, Color, Entity, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, Mesh, MeshInstance,
    PIXELFORMAT_SRGBA8, Quat as PcQuat, StandardMaterial, Texture, TorusGeometry, Vec3 as PcVec3
} from 'playcanvas';
import { quatAxisAngle, quatMultiply, quatRotate } from '@shramko/sonic-fpv';
import type { SonicObject, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';
import { shapePrims } from '../sonic/primitives';
import type { Prim, StageRenderer } from '../sonic/primitives';
import type { EditPaint } from './editor/rules';
import type { GateRole } from './finish';

type Paint = 'next' | 'later' | 'passed' | 'arrow' | 'checkNext' | 'checkLater' | 'checkPassed' | 'checkDark' | EditPaint;
/** sRGB colours (design choice, not measured): next lime, later dim teal, passed dark grey (S2: darker than later; the old
 *  0.45 grey was about as bright as the teal), arrows amber; the START / FINISH gate's light cells white when it is next, light
 *  grey later, dark grey passed, its dark cells near black; in the editor the selected gate bright yellow (train 3 I1, D3: the
 *  gate the handles belong to; was magenta), a failing gate red, a failing selected gate orange (stage F1-finish). */
const PAINT: Record<Paint, [number, number, number]> = {
    next: [0.65, 1, 0.1],
    later: [0.15, 0.55, 0.55],
    passed: [0.2, 0.2, 0.2],
    arrow: [1, 0.72, 0.1],
    checkNext: [1, 1, 1],
    checkLater: [0.7, 0.7, 0.7],
    checkPassed: [0.25, 0.25, 0.25],
    checkDark: [0.02, 0.02, 0.02],
    selected: [1, 0.92, 0.25],
    bad: [1, 0.08, 0.05],
    'selected-bad': [1, 0.5, 0],
    // lane edit4c C1w: a gate with a live warning (course/editor/warn.ts), orange
    warn: [1, 0.45, 0]
};
/** a chevron every this many metres along the path (tracks-plan 2.3) */
export const CHEVRON_STEP_M = 2;
/** arm length, thickness, opening half angle of a chevron (design estimates) */
const ARM_M = 0.45;
const ARM_T = 0.05;
const ARM_DEG = 35;
/** never more chevrons than this at once (two legs of at most legMaxM are far under it) */
const MAX_CHEVRONS = 60;
/** S1 (design values): the checkered frame has this many cells along its outer width; a ring this many cells round */
const CHECK_CELLS = 8;
const RING_CELLS = 16;
/** S1: the banner is as wide as the gate's outer width and this share of it high; the number plate this share of it square */
export const BANNER_HEIGHT_SHARE = 0.3;
export const PLATE_SHARE = 0.4;
/** S1: the ground line is drawn when the ground is at most this many outer widths under the gate's lowest point */
const GROUND_NEAR_WIDTHS = 6;

/** text of the banner over a START / FINISH gate, in the pilot's language (course.ts passes t()) */
export type RoleText = (role: Exclude<GateRole, null>) => string;
/** the ground's height under (x, y, z), or null (course.ts reads the scan's collision) */
export type GroundAt = (x: number, y: number, z: number) => number | null;

interface GateParts {
    readonly id: string;
    readonly instances: MeshInstance[];
    /** per instance: a dark cell of the checkered frame (never repainted by state), else false */
    readonly dark: boolean[];
    readonly role: GateRole;
    /** world height of the gate's top, the outer width, the yaw its banner and plate face, the centre */
    readonly top: number;
    readonly width: number;
    readonly yaw: number;
    readonly pos: Vec3;
}

/** the outer half size of a gate (ring: radius to the tube's outside; square and cube: half the side plus the bar) */
function outerHalf(o: SonicObject): number {
    const s = o.shape;
    if (s.kind === 'ring') return s.diameter / 2 + 2 * s.tube;
    if (s.kind === 'square' || s.kind === 'cube-frame') return s.side / 2 + s.bar;
    return 1;
}

/** The yaw a gate's banner faces (around world Y): the gate's axis when it stands up; its side when it lies flat (a dive). */
function gateYaw(o: SonicObject): number {
    const f = quatRotate(o.quat, [0, 0, 1]);
    if (Math.hypot(f[0], f[2]) >= 0.3) return Math.atan2(f[0], f[2]);
    const r = quatRotate(o.quat, [1, 0, 0]);
    return Math.atan2(r[0], r[2]) - Math.PI / 2;
}

/** half the vertical extent of a gate's frame (its local x and y span the opening; a cube's z too) */
function halfHeight(o: SonicObject, r: number): number {
    const ax = Math.abs(quatRotate(o.quat, [1, 0, 0])[1]);
    const ay = Math.abs(quatRotate(o.quat, [0, 1, 0])[1]);
    const az = o.shape.kind === 'cube-frame' ? Math.abs(quatRotate(o.quat, [0, 0, 1])[1]) : 0;
    return r * Math.max(0.15, Math.min(1.8, ax + ay + az));
}

/** The prims of a checkered frame: each bar cut into cells along its length, a ring into RING_CELLS boxes round. */
export function checkerPrims(o: SonicObject): { prim: Prim; dark: boolean }[] {
    const out: { prim: Prim; dark: boolean }[] = [];
    const s = o.shape;
    if (s.kind === 'ring') {
        const R = s.diameter / 2 + s.tube;
        // the ring's plane is the gate's local x-y (its axis local z): a frame whose own y is that axis, as the torus's
        const q0 = quatMultiply(o.quat, quatAxisAngle([1, 0, 0], Math.PI / 2));
        const len = ((2 * Math.PI * R) / RING_CELLS) * 1.02;
        for (let k = 0; k < RING_CELLS; k++) {
            const a = ((k + 0.5) * 2 * Math.PI) / RING_CELLS;
            const off = quatRotate(q0, [R * Math.cos(a), 0, R * Math.sin(a)]);
            out.push({
                prim: { kind: 'box', role: 'gate', objectId: o.id, pos: [o.pos[0] + off[0], o.pos[1] + off[1], o.pos[2] + off[2]], quat: quatMultiply(q0, quatAxisAngle([0, 1, 0], -(a + Math.PI / 2))), size: [len, 2 * s.tube, 2 * s.tube] },
                dark: k % 2 === 1
            });
        }
        return out;
    }
    const cell = (2 * outerHalf(o)) / CHECK_CELLS;
    let parity = 0;
    for (const p of shapePrims(o)) {
        if (p.kind !== 'box') {
            out.push({ prim: p.kind === 'cylinder' ? { ...p, kind: 'box' } : p, dark: false });
            continue;
        }
        const k = p.size[0] >= p.size[1] && p.size[0] >= p.size[2] ? 0 : p.size[1] >= p.size[2] ? 1 : 2;
        const len = p.size[k];
        const n = Math.max(1, Math.round(len / cell));
        for (let i = 0; i < n; i++) {
            const local: [number, number, number] = [0, 0, 0];
            local[k] = -len / 2 + ((i + 0.5) * len) / n;
            const off = quatRotate(p.quat, local);
            const size: [number, number, number] = [p.size[0], p.size[1], p.size[2]];
            size[k] = len / n;
            out.push({ prim: { ...p, pos: [p.pos[0] + off[0], p.pos[1] + off[1], p.pos[2] + off[2]], size }, dark: (i + parity) % 2 === 1 });
        }
        parity++;
    }
    return out;
}

/** a canvas: a banner word between two checkered rows */
function bannerCanvas(text: string): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 308;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    const cell = 32;
    g.fillStyle = '#000';
    for (const y0 of [0, c.height - 2 * cell]) for (let row = 0; row < 2; row++) for (let x = 0; x < c.width / cell; x++) if ((x + row) % 2 === 0) g.fillRect(x * cell, y0 + row * cell, cell, cell);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = 150;
    g.font = `900 ${px}px system-ui, sans-serif`;
    while (px > 40 && g.measureText(text).width > c.width - 60) g.font = `900 ${(px -= 6)}px system-ui, sans-serif`;
    g.fillText(text, c.width / 2, c.height / 2 + 4);
    return c;
}

/** a canvas: the next gate's number, black on lime */
function plateCanvas(n: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#a6ff1a';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${n >= 10 ? 150 : 200}px system-ui, sans-serif`;
    g.fillText(String(n), 128, 140);
    return c;
}

/** a canvas: two checkered rows (the line on the ground) */
function stripCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#000';
    for (let row = 0; row < 2; row++) for (let x = 0; x < 16; x++) if ((x + row) % 2 === 0) g.fillRect(x * 32, row * 32, 32, 32);
    return c;
}

export class CourseStage {
    private readonly r: StageRenderer;
    private root: Entity | null = null;
    private arrows: Entity | null = null;
    private plate: Entity | null = null;
    private gates: GateParts[] = [];
    private readonly materials = new Map<Paint, StandardMaterial>();
    /** canvas-textured materials by key (banner words, plate numbers, the ground strip); kept across shows */
    private readonly pictures = new Map<string, { m: StandardMaterial; t: Texture }>();
    private boxMesh: Mesh | null = null;
    private drawnCount = 0;
    private arrowCount = 0;
    /** S1 and S2 as the page drew them (the page hook course.look; probes read it) */
    readonly look = { banners: 0, groundLines: 0, plate: -1, roles: [] as GateRole[] };

    constructor(renderer: StageRenderer) {
        this.r = renderer;
    }

    /** gates' parts and chevron arms on the stage now; 0 when hidden */
    get drawn(): number {
        return this.root ? this.drawnCount + this.arrowCount : 0;
    }

    private material(p: Paint): StandardMaterial {
        let m = this.materials.get(p);
        if (m) return m;
        m = new StandardMaterial();
        m.useLighting = false;
        m.useSkybox = false;
        m.diffuse = new Color(0, 0, 0);
        const c = PAINT[p];
        m.emissive = new Color(c[0], c[1], c[2]);
        m.update();
        this.materials.set(p, m);
        return m;
    }

    private picture(key: string, draw: () => HTMLCanvasElement): StandardMaterial {
        const had = this.pictures.get(key);
        if (had) return had.m;
        const c = draw();
        const t = new Texture(this.r.device, {
            name: `course-${key}`, width: c.width, height: c.height, format: PIXELFORMAT_SRGBA8, mipmaps: true,
            addressU: ADDRESS_CLAMP_TO_EDGE, addressV: ADDRESS_CLAMP_TO_EDGE, minFilter: FILTER_LINEAR_MIPMAP_LINEAR, magFilter: FILTER_LINEAR, anisotropy: 8
        });
        t.setSource(c);
        const m = new StandardMaterial();
        m.useLighting = false;
        m.useSkybox = false;
        m.diffuse = new Color(0, 0, 0);
        m.emissive = new Color(1, 1, 1);
        m.emissiveMap = t;
        m.update();
        this.pictures.set(key, { m, t });
        return m;
    }

    private box(): Mesh {
        if (!this.boxMesh) {
            this.boxMesh = Mesh.fromGeometry(this.r.device, new BoxGeometry({ halfExtents: new PcVec3(0.5, 0.5, 0.5) }));
            // lane review TR-4: the engine frees a mesh with its last mesh instance (hide() destroys them all), so the stage
            // holds its own reference to the box it reuses across shows and lets it go in dispose()
            this.boxMesh.incRefCount();
        }
        return this.boxMesh;
    }

    private part(parent: Entity, p: Prim, paint: Paint): MeshInstance {
        const app = this.r.app;
        const mesh = p.kind === 'torus'
            ? Mesh.fromGeometry(this.r.device, new TorusGeometry({ ringRadius: p.size[0], tubeRadius: p.size[1], segments: 28, sides: 10 }))
            : this.box();
        const mi = new MeshInstance(mesh, this.material(paint));
        const e = new Entity(`course-${p.role}`, app);
        e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: false });
        if (p.kind !== 'torus') e.setLocalScale(p.size[0], p.size[1], p.size[2]);
        e.setPosition(p.pos[0], p.pos[1], p.pos[2]);
        e.setRotation(new PcQuat(p.quat[1], p.quat[2], p.quat[3], p.quat[0]));
        parent.addChild(e);
        return mi;
    }

    /** a flat picture box of w x h, `depth` thick, centred at pos, turned by yaw about world Y */
    private sign(parent: Entity, name: string, m: StandardMaterial, pos: Vec3, yaw: number, w: number, h: number, depth: number): Entity {
        const e = new Entity(name, this.r.app);
        e.addComponent('render', { meshInstances: [new MeshInstance(this.box(), m)], castShadows: false, receiveShadows: false });
        e.setLocalScale(w, h, depth);
        e.setPosition(pos[0], pos[1], pos[2]);
        e.setRotation(new PcQuat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)));
        parent.addChild(e);
        return e;
    }

    /**
     * Draws the gates (replacing whatever was shown). `roles` (course/finish.ts gateRoles) marks the START / FINISH gates: a
     * checkered frame, a banner with `say(role)`, and a checkered line on the ground under it where `ground` finds it near.
     */
    show(gates: readonly SonicObject[], roles: readonly GateRole[] = [], say?: RoleText, ground?: GroundAt): void {
        this.hide();
        const root = new Entity('course-stage', this.r.app);
        this.r.app.root.addChild(root);
        this.root = root;
        this.look.roles = gates.map((_, i) => roles[i] ?? null);
        let n = 0;
        gates.forEach((g, i) => {
            const role = roles[i] ?? null;
            const r = outerHalf(g);
            const width = 2 * r;
            const hh = halfHeight(g, r);
            const top = g.pos[1] + hh;
            const yaw = gateYaw(g);
            const instances: MeshInstance[] = [];
            const dark: boolean[] = [];
            if (role) {
                for (const c of checkerPrims(g)) {
                    instances.push(this.part(root, c.prim, c.dark ? 'checkDark' : 'checkLater'));
                    dark.push(c.dark);
                }
                if (say) {
                    const text = say(role);
                    const h = width * BANNER_HEIGHT_SHARE;
                    this.sign(root, 'course-banner', this.picture(`banner:${text}`, () => bannerCanvas(text)), [g.pos[0], top + 0.1 * width + h / 2, g.pos[2]], yaw, width, h, Math.max(0.02, width * 0.02));
                    this.look.banners++;
                }
                const low = g.pos[1] - hh;
                const gy = ground?.(g.pos[0], g.pos[1], g.pos[2]) ?? null;
                if (gy !== null && low - gy >= 0 && low - gy <= GROUND_NEAR_WIDTHS * width) {
                    const depth = width * 0.12;
                    this.sign(root, 'course-start-line', this.picture('strip', stripCanvas), [g.pos[0], gy + 0.01 + depth * 0.05, g.pos[2]], yaw, width, depth * 0.1, depth);
                    this.look.groundLines++;
                }
            } else {
                for (const p of shapePrims(g)) {
                    instances.push(this.part(root, p.kind === 'cylinder' ? { ...p, kind: 'box' as const } : p, 'later'));
                    dark.push(false);
                }
            }
            n += instances.length;
            this.gates.push({ id: g.id, instances, dark, role, top, width, yaw, pos: g.pos });
        });
        this.drawnCount = n;
    }

    /** Colours the gates for `next` (0-based; -1: all later), puts its number plate over it, and the chevrons from the gate
     *  before it to two ahead. `plate` false (the editor's selected gate, review CU-10): no number plate, the editor means
     *  no race order by its selection. */
    setNext(next: number, path: readonly WorldCheckpoint[], closed: boolean, plate = true): void {
        if (!this.root) return;
        this.gates.forEach((g, i) => {
            const state = i === next ? 'next' : next >= 0 && i < next ? 'passed' : 'later';
            g.instances.forEach((mi, k) => {
                const paint: Paint = !g.role ? state : g.dark[k] ? 'checkDark' : state === 'next' ? 'checkNext' : state === 'passed' ? 'checkPassed' : 'checkLater';
                mi.material = this.material(paint);
            });
        });
        this.plate?.destroy();
        this.plate = null;
        this.look.plate = -1;
        const g = next >= 0 && plate ? this.gates[next] : undefined;
        // a page without a document (the Node tests of the stage) draws no number plate
        if (g && typeof document === 'undefined') this.look.plate = next;
        else if (g) {
            const side = g.width * PLATE_SHARE;
            const over = g.role ? 0.1 * g.width + g.width * BANNER_HEIGHT_SHARE : 0;
            this.plate = this.sign(this.root, 'course-plate', this.picture(`plate:${next + 1}`, () => plateCanvas(next + 1)), [g.pos[0], g.top + over + 0.1 * g.width + side / 2, g.pos[2]], g.yaw, side, side, Math.max(0.02, side * 0.04));
            this.look.plate = next;
        }
        this.arrows?.destroy();
        this.arrows = null;
        this.arrowCount = 0;
        if (next < 0) return;
        const pts = chevronPoints(path, next, this.gates.length, closed);
        const arrows = new Entity('course-arrows', this.r.app);
        this.root.addChild(arrows);
        this.arrows = arrows;
        for (const c of pts) {
            for (const side of [-1, 1]) {
                // an arm from the tip backwards, opened by ARM_DEG to one side
                const yaw = Math.atan2(-c.dir[0], -c.dir[2]) + (side * ARM_DEG * Math.PI) / 180;
                const ax = Math.sin(yaw), az = Math.cos(yaw);
                const e = new Entity('course-chevron', this.r.app);
                e.addComponent('render', { meshInstances: [new MeshInstance(this.box(), this.material('arrow'))], castShadows: false, receiveShadows: false });
                e.setLocalScale(ARM_T, ARM_T, ARM_M);
                e.setPosition(c.pos[0] + (ax * ARM_M) / 2, c.pos[1], c.pos[2] + (az * ARM_M) / 2);
                e.setRotation(new PcQuat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)));
                arrows.addChild(e);
                this.arrowCount++;
            }
        }
    }

    /** The editor's paint (course/editor/rules.ts editPaints), one per gate, over whatever setNext painted; the dark cells
     *  of a START / FINISH frame stay dark (review CU-10: the editor shows where the course starts and ends). */
    paintEdit(paints: readonly EditPaint[]): void {
        if (!this.root) return;
        this.gates.forEach((g, i) => {
            const m = this.material(paints[i] ?? 'later');
            g.instances.forEach((mi, k) => { mi.material = g.dark[k] ? this.material('checkDark') : m; });
        });
    }

    /** Takes the course off the screen (the materials stay for the next show). */
    hide(): void {
        this.root?.destroy();
        this.root = null;
        this.arrows = null;
        this.plate = null;
        this.gates = [];
        this.drawnCount = 0;
        this.arrowCount = 0;
        this.look.banners = 0;
        this.look.groundLines = 0;
        this.look.plate = -1;
    }

    dispose(): void {
        this.hide();
        for (const m of this.materials.values()) m.destroy();
        this.materials.clear();
        for (const p of this.pictures.values()) {
            p.m.destroy();
            p.t.destroy();
        }
        this.pictures.clear();
        if (this.boxMesh) {
            this.boxMesh.decRefCount();
            if (this.boxMesh.refCount < 1) this.boxMesh.destroy();
        }
        this.boxMesh = null;
    }
}

/**
 * The chevrons' places: every CHEVRON_STEP_M along the path from the point of gate `next - 1` (the start for gate 0) to the
 * point of gate `next + 1` (the last gate, or round to the start on a closed course). `stage` k marks gate k - 1's centre.
 */
export function chevronPoints(path: readonly WorldCheckpoint[], next: number, gates: number, closed: boolean): { pos: Vec3; dir: Vec3 }[] {
    const at = (stage: number): number => path.findIndex((p) => p.stage === stage);
    const from = next === 0 ? 0 : Math.max(0, at(next));
    const last = next + 2 <= gates ? at(next + 2) : closed ? path.length - 1 : at(gates);
    const to = last < 0 ? path.length - 1 : last;
    const out: { pos: Vec3; dir: Vec3 }[] = [];
    // distance from the segment's start to the next chevron
    let ahead = CHEVRON_STEP_M / 2;
    for (let i = from; i < to && out.length < MAX_CHEVRONS; i++) {
        const a = path[i]!.pos, b = path[i + 1]!.pos;
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const len = Math.hypot(dx, dy, dz);
        const h = Math.hypot(dx, dz);
        let s = ahead;
        for (; s < len && out.length < MAX_CHEVRONS; s += CHEVRON_STEP_M) {
            const u = s / len;
            out.push({ pos: [a[0] + dx * u, a[1] + dy * u, a[2] + dz * u], dir: h > 1e-6 ? [dx / h, 0, dz / h] : [0, 0, -1] });
        }
        ahead = s - len;
    }
    return out;
}
