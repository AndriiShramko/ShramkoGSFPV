// Train 1, lane rooms: the other pilots' drones in the scene, under one root entity of their own ('rooms-remotes', under
// app.root; never in a ContactWorld: no collisions between drones, rooms-plan.md 2.2). A drone is a simple primitive
// (a body, four arms, four rotor discs, a light nose that shows where it looks) in the slot's colour, not the drones3d model:
// the picker's procedural meshes cost a kit build per pilot, and in flight a drone is a few pixels; the drones3d model is
// for later. A drone whose poses stopped coming (frozen) turns grey. Public PlayCanvas API only (tools/bench/src/a1-api-check.ts).
// Lane look: the near rule lives here (nearAlpha): a drone nearer to the camera than NEAR_HIDE_M is not drawn, and the name
// tags (tags.ts) follow the same rule, so two pilots at one start point see nothing across their view.
import { BLEND_NONE, BLEND_NORMAL, Color, Entity, StandardMaterial, Vec3 as PcVec3 } from 'playcanvas';
import type { AppBase } from 'playcanvas';
import type { Quat4, Vec3 } from './codec';
import { roomsPageHook } from './hook';
import type { DrawnRemote } from './hook';

/** motor to motor (the diagonal), metres: a 5-inch quad's size, so a pilot is seen at a distance (estimate) */
const SPAN_M = 0.25;
/** a 5-inch propeller's disc, metres (5 in = 0.127 m) */
const PROP_M = 0.127;
/**
 * The near rule (lane look, docs/wip/look.md, tables "Distance"): nearer to the camera than this a drone is not drawn, body
 * and name tag. Measured by tools/bench/src/rooms-shot-live.ts (LOOK=after, this model with its rotor discs): the drone's
 * box on B's 1280x800 view covers 0.69 % of the view at 1 m, 0.16 % at 2 m, 0.04 % at 4 m (about 0.69 % / d^2); a box over
 * 2 % of the view (wider than a seventh of the view, across its middle) blocks the view, and 2 % is reached at 0.59 m.
 */
export const NEAR_HIDE_M = 0.6;
/** the fade band above NEAR_HIDE_M, metres: the drone and its tag come in over it instead of popping (an estimate) */
export const NEAR_FADE_M = 0.2;

/** How much of a remote drone is drawn at `distM` metres from the camera: 0 hidden, 1 whole, a linear fade between. */
export function nearAlpha(distM: number): number {
    if (!(distM > NEAR_HIDE_M)) return 0;
    return Math.min(1, (distM - NEAR_HIDE_M) / NEAR_FADE_M);
}

/** one colour per slot (0-7), sRGB */
const SLOT_COLOURS: readonly [number, number, number][] = [
    [1, 0.35, 0.2], [0.2, 0.7, 1], [0.35, 0.9, 0.3], [1, 0.8, 0.15], [0.85, 0.4, 1], [0.15, 0.95, 0.85], [1, 0.45, 0.7], [0.95, 0.95, 0.95]
];
const LOST: [number, number, number] = [0.45, 0.45, 0.45];
/** the rotor discs and the nose: the slot colour mixed this far towards white, so the parts read apart */
const LIGHT = 0.55;
/** the body and the arms: the slot colour this dark, against the light discs */
const DARK = 0.6;
/** motor offset from the centre on each axis (the arms run on the diagonals), metres */
const MOTOR_M = (SPAN_M / 2) * Math.SQRT1_2;
/** the drone's local half sizes, metres (x: over the rotor discs, y: the height, z: over the rotor discs): its screen box */
const HALF: Vec3 = [MOTOR_M + PROP_M / 2, SPAN_M * 0.08, MOTOR_M + PROP_M / 2];

export interface RemoteDraw { slot: number; pos: Vec3; quat: Quat4; frozen: boolean }

interface Drone { e: Entity; frozen: boolean | null; alpha: number; body: StandardMaterial; light: StandardMaterial }

const lighter = (c: readonly number[]): [number, number, number] => [c[0] + (1 - c[0]) * LIGHT, c[1] + (1 - c[1]) * LIGHT, c[2] + (1 - c[2]) * LIGHT];

function unlit(): StandardMaterial {
    const m = new StandardMaterial();
    m.useLighting = false;
    m.diffuse = new Color(0, 0, 0);
    return m;
}

export class RemoteStage {
    private root: Entity | null = null;
    private readonly drones = new Map<number, Drone>();
    private readonly w = new PcVec3();
    private readonly s = new PcVec3();

    /** `camera`: the flight camera (the renderer's), for the near rule; without it every drone is drawn whole */
    constructor(private readonly r: { readonly app: AppBase; readonly camera?: Entity | null }) {}

    get rootEntity(): Entity | null {
        return this.root;
    }

    /** slots drawn now (hidden by the near rule included) */
    get slots(): number[] {
        return [...this.drones.keys()];
    }

    private build(slot: number): Drone {
        if (!this.root) {
            this.root = new Entity('rooms-remotes', this.r.app);
            this.r.app.root.addChild(this.root);
        }
        const e = new Entity(`rooms-drone-${slot}`, this.r.app);
        const body = unlit();
        const light = unlit();
        const part = (name: string, type: 'box' | 'cylinder', mat: StandardMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, yawDeg = 0): void => {
            const p = new Entity(name, this.r.app);
            p.addComponent('render', { type, material: mat, castShadows: false, receiveShadows: false });
            p.setLocalPosition(x, y, z);
            p.setLocalEulerAngles(0, yawDeg, 0);
            p.setLocalScale(sx, sy, sz);
            e.addChild(p);
        };
        const s = SPAN_M;
        // the camera looks along -z: the nose sits there; the arms on the diagonals, a rotor disc over each motor
        part('body', 'box', body, 0, 0, 0, s * 0.3, s * 0.14, s * 0.5);
        part('arm-a', 'box', body, 0, 0, 0, s, s * 0.04, s * 0.07, 45);
        part('arm-b', 'box', body, 0, 0, 0, s, s * 0.04, s * 0.07, -45);
        part('nose', 'box', light, 0, s * 0.04, -s * 0.27, s * 0.16, s * 0.1, s * 0.08);
        const m = MOTOR_M;
        for (const [i, [x, z]] of [[m, m], [-m, m], [m, -m], [-m, -m]].entries()) part(`rotor-${i}`, 'cylinder', light, x, s * 0.05, z, PROP_M, s * 0.02, PROP_M);
        this.root!.addChild(e);
        const d: Drone = { e, frozen: null, alpha: -1, body, light };
        this.drones.set(slot, d);
        return d;
    }

    private paint(d: Drone, slot: number, frozen: boolean): void {
        if (d.frozen === frozen) return;
        d.frozen = frozen;
        const c = frozen ? LOST : SLOT_COLOURS[slot % SLOT_COLOURS.length];
        const l = frozen ? LOST : lighter(c);
        d.body.emissive = new Color(c[0] * DARK, c[1] * DARK, c[2] * DARK);
        d.light.emissive = new Color(l[0], l[1], l[2]);
        d.body.update();
        d.light.update();
    }

    private fade(d: Drone, a: number): void {
        if (d.alpha === a) return;
        d.alpha = a;
        d.e.enabled = a > 0;
        for (const m of [d.body, d.light]) {
            m.opacity = a;
            m.blendType = a < 1 ? BLEND_NORMAL : BLEND_NONE;
            m.depthWrite = a >= 1;
            m.update();
        }
    }

    /** The drone's box on the view (CSS px, clipped) and its share of the view; the whole view when a corner is behind the camera. */
    private box(e: Entity): { box: [number, number, number, number] | null; share: number } {
        const cam = this.r.camera;
        const cc = cam?.camera;
        const rect = (this.r.app.graphicsDevice as unknown as { clientRect?: { width: number; height: number } }).clientRect;
        if (!cam || !cc || !rect || !rect.width || !rect.height) return { box: null, share: 0 };
        const cp = cam.getPosition();
        const fwd = cam.forward;
        const tr = e.getWorldTransform();
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < 8; i++) {
            this.s.set(i & 1 ? HALF[0] : -HALF[0], i & 2 ? HALF[1] : -HALF[1], i & 4 ? HALF[2] : -HALF[2]);
            tr.transformPoint(this.s, this.w);
            const ahead = (this.w.x - cp.x) * fwd.x + (this.w.y - cp.y) * fwd.y + (this.w.z - cp.z) * fwd.z;
            if (ahead <= cc.nearClip) return { box: [0, 0, rect.width, rect.height], share: 1 };
            cc.worldToScreen(this.w, this.s);
            x0 = Math.min(x0, this.s.x);
            y0 = Math.min(y0, this.s.y);
            x1 = Math.max(x1, this.s.x);
            y1 = Math.max(y1, this.s.y);
        }
        const bx: [number, number, number, number] = [Math.max(0, x0), Math.max(0, y0), Math.min(rect.width, x1), Math.min(rect.height, y1)];
        if (bx[2] <= bx[0] || bx[3] <= bx[1]) return { box: null, share: 0 };
        return { box: bx.map((v) => Math.round(v)) as [number, number, number, number], share: ((bx[2] - bx[0]) * (bx[3] - bx[1])) / (rect.width * rect.height) };
    }

    /** Draws these drones; a slot not in the list is taken off. A drone nearer the camera than the near rule allows is hidden. */
    show(list: readonly RemoteDraw[]): void {
        const keep = new Set<number>();
        const cp = this.r.camera?.getPosition();
        const drawn: DrawnRemote[] = [];
        for (const x of list) {
            keep.add(x.slot);
            const d = this.drones.get(x.slot) ?? this.build(x.slot);
            d.e.setPosition(x.pos[0], x.pos[1], x.pos[2]);
            d.e.setRotation(x.quat[0], x.quat[1], x.quat[2], x.quat[3]);
            this.paint(d, x.slot, x.frozen);
            const distM = cp ? Math.hypot(x.pos[0] - cp.x, x.pos[1] - cp.y, x.pos[2] - cp.z) : Infinity;
            const a = nearAlpha(distM);
            this.fade(d, a);
            const b = this.box(d.e);
            drawn.push({ slot: x.slot, distM: +distM.toFixed(3), alpha: +a.toFixed(3), share: +b.share.toFixed(5), box: b.box });
        }
        for (const [slot, d] of this.drones) if (!keep.has(slot)) this.drop(slot, d);
        const h = roomsPageHook();
        if (h) h.drawn = drawn;
    }

    private drop(slot: number, d: Drone): void {
        d.e.destroy();
        d.body.destroy();
        d.light.destroy();
        this.drones.delete(slot);
    }

    /** Takes everything off (the root too). */
    dispose(): void {
        for (const [slot, d] of [...this.drones]) this.drop(slot, d);
        this.root?.destroy();
        this.root = null;
        const h = roomsPageHook();
        if (h) h.drawn = [];
    }
}
