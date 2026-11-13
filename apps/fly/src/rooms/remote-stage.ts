// Train 1, lane rooms: the other pilots' drones in the scene, under one root entity of their own ('rooms-remotes', under
// app.root; never in a ContactWorld: no collisions between drones, rooms-plan.md 2.2). A drone is a simple primitive
// (a body, four arms, a nose that shows where it looks) in the slot's colour, not the drones3d model: the picker's
// procedural meshes cost a kit build per pilot, and in flight a drone is a few pixels; the drones3d model is for later.
// A drone whose poses stopped coming (frozen) turns grey. Public PlayCanvas API only (tools/bench/src/a1-api-check.ts).
import { Color, Entity, StandardMaterial } from 'playcanvas';
import type { AppBase } from 'playcanvas';
import type { Quat4, Vec3 } from './codec';

/** motor to motor, metres: a 5-inch quad's size, so a pilot is seen at a distance (estimate) */
const SPAN_M = 0.25;
/** one colour per slot (0-7), sRGB */
const SLOT_COLOURS: readonly [number, number, number][] = [
    [1, 0.35, 0.2], [0.2, 0.7, 1], [0.35, 0.9, 0.3], [1, 0.8, 0.15], [0.85, 0.4, 1], [0.15, 0.95, 0.85], [1, 0.45, 0.7], [0.95, 0.95, 0.95]
];
const LOST: [number, number, number] = [0.45, 0.45, 0.45];

export interface RemoteDraw { slot: number; pos: Vec3; quat: Quat4; frozen: boolean }

interface Drone { e: Entity; frozen: boolean }

export class RemoteStage {
    private root: Entity | null = null;
    private readonly drones = new Map<number, Drone>();
    private readonly materials = new Map<string, StandardMaterial>();

    constructor(private readonly r: { readonly app: AppBase }) {}

    get rootEntity(): Entity | null {
        return this.root;
    }

    /** slots drawn now */
    get slots(): number[] {
        return [...this.drones.keys()];
    }

    private material(slot: number, frozen: boolean): StandardMaterial {
        const key = frozen ? 'lost' : String(slot % SLOT_COLOURS.length);
        let m = this.materials.get(key);
        if (m) return m;
        const c = frozen ? LOST : SLOT_COLOURS[slot % SLOT_COLOURS.length];
        m = new StandardMaterial();
        m.useLighting = false;
        m.diffuse = new Color(0, 0, 0);
        m.emissive = new Color(c[0], c[1], c[2]);
        m.update();
        this.materials.set(key, m);
        return m;
    }

    private build(slot: number): Drone {
        if (!this.root) {
            this.root = new Entity('rooms-remotes', this.r.app);
            this.r.app.root.addChild(this.root);
        }
        const e = new Entity(`rooms-drone-${slot}`, this.r.app);
        const mat = this.material(slot, false);
        const part = (name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yawDeg = 0): void => {
            const p = new Entity(name, this.r.app);
            p.addComponent('render', { type: 'box', material: mat, castShadows: false, receiveShadows: false });
            p.setLocalPosition(x, y, z);
            p.setLocalEulerAngles(0, yawDeg, 0);
            p.setLocalScale(sx, sy, sz);
            e.addChild(p);
        };
        const s = SPAN_M;
        part('body', 0, 0, 0, s * 0.3, s * 0.12, s * 0.45);
        part('arm-a', 0, 0, 0, s, s * 0.04, s * 0.06, 45);
        part('arm-b', 0, 0, 0, s, s * 0.04, s * 0.06, -45);
        // the camera looks along -z: the nose sits there
        part('nose', 0, s * 0.04, -s * 0.3, s * 0.12, s * 0.1, s * 0.12);
        this.root!.addChild(e);
        const d = { e, frozen: false };
        this.drones.set(slot, d);
        return d;
    }

    private paint(d: Drone, slot: number, frozen: boolean): void {
        if (d.frozen === frozen) return;
        d.frozen = frozen;
        const m = this.material(slot, frozen);
        for (const c of d.e.children) {
            const r = (c as Entity).render;
            if (r) r.material = m;
        }
    }

    /** Draws these drones; a slot not in the list is taken off. */
    show(list: readonly RemoteDraw[]): void {
        const keep = new Set<number>();
        for (const x of list) {
            keep.add(x.slot);
            const d = this.drones.get(x.slot) ?? this.build(x.slot);
            d.e.setPosition(x.pos[0], x.pos[1], x.pos[2]);
            d.e.setRotation(x.quat[0], x.quat[1], x.quat[2], x.quat[3]);
            this.paint(d, x.slot, x.frozen);
        }
        for (const [slot, d] of this.drones) if (!keep.has(slot)) { d.e.destroy(); this.drones.delete(slot); }
    }

    /** Takes everything off (the root too). */
    dispose(): void {
        this.root?.destroy();
        this.root = null;
        this.drones.clear();
        for (const m of this.materials.values()) m.destroy();
        this.materials.clear();
    }
}
