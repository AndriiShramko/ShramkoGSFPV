// The course drawn in the scan (train 1, lane tracks, T2; docs/wip/tracks-plan.md 2.3; model PrimitiveStage in
// sonic/primitives.ts): its own root under renderer.app.root; the gates as the sound mode's prims (shapePrims), coloured by
// state (next bright, later dim, passed grey); chevrons along the course's path (coursePath) from the gate before the next
// one to two gates ahead, one every 2 m, flat at flying height, two thin boxes each. Public PlayCanvas API only: Entity,
// the render component, Mesh.fromGeometry, BoxGeometry, TorusGeometry, StandardMaterial (the same members PrimitiveStage
// uses, plus Mesh.fromGeometry). Unlit flat colours; nothing here is solid.
import { BoxGeometry, Color, Entity, Mesh, MeshInstance, Quat as PcQuat, StandardMaterial, TorusGeometry, Vec3 as PcVec3 } from 'playcanvas';
import type { SonicObject, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';
import { shapePrims } from '../sonic/primitives';
import type { Prim, StageRenderer } from '../sonic/primitives';
import type { EditPaint } from './editor/rules';

type Paint = 'next' | 'later' | 'passed' | 'arrow' | EditPaint;
/** sRGB colours (design choice, not measured): next lime, later dim teal, passed grey, arrows amber; in the editor the selected
 *  gate magenta, a failing gate red, a failing selected gate orange (stage F1-finish). */
const PAINT: Record<Paint, [number, number, number]> = {
    next: [0.65, 1, 0.1],
    later: [0.15, 0.55, 0.55],
    passed: [0.45, 0.45, 0.45],
    arrow: [1, 0.72, 0.1],
    selected: [1, 0.2, 1],
    bad: [1, 0.08, 0.05],
    'selected-bad': [1, 0.5, 0]
};
/** a chevron every this many metres along the path (tracks-plan 2.3) */
export const CHEVRON_STEP_M = 2;
/** arm length, thickness, opening half angle of a chevron (design estimates) */
const ARM_M = 0.45;
const ARM_T = 0.05;
const ARM_DEG = 35;
/** never more chevrons than this at once (two legs of at most legMaxM are far under it) */
const MAX_CHEVRONS = 60;

interface GateParts { readonly id: string; readonly instances: MeshInstance[] }

export class CourseStage {
    private readonly r: StageRenderer;
    private root: Entity | null = null;
    private arrows: Entity | null = null;
    private gates: GateParts[] = [];
    private readonly materials = new Map<Paint, StandardMaterial>();
    private boxMesh: Mesh | null = null;
    private drawnCount = 0;
    private arrowCount = 0;

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

    /** Draws the gates (replacing whatever was shown). */
    show(gates: readonly SonicObject[]): void {
        this.hide();
        const root = new Entity('course-stage', this.r.app);
        this.r.app.root.addChild(root);
        this.root = root;
        let n = 0;
        for (const g of gates) {
            const prims = shapePrims(g).map((p) => (p.kind === 'cylinder' ? { ...p, kind: 'box' as const } : p));
            this.gates.push({ id: g.id, instances: prims.map((p) => this.part(root, p, 'later')) });
            n += prims.length;
        }
        this.drawnCount = n;
    }

    /** Colours the gates for `next` (0-based; -1: all later) and puts the chevrons from the gate before it to two ahead. */
    setNext(next: number, path: readonly WorldCheckpoint[], closed: boolean): void {
        if (!this.root) return;
        this.gates.forEach((g, i) => {
            const paint: Paint = i === next ? 'next' : next >= 0 && i < next ? 'passed' : 'later';
            for (const mi of g.instances) mi.material = this.material(paint);
        });
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

    /** The editor's paint (course/editor/rules.ts editPaints), one per gate, over whatever setNext painted. */
    paintEdit(paints: readonly EditPaint[]): void {
        if (!this.root) return;
        this.gates.forEach((g, i) => {
            const m = this.material(paints[i] ?? 'later');
            for (const mi of g.instances) mi.material = m;
        });
    }

    /** Takes the course off the screen (the materials stay for the next show). */
    hide(): void {
        this.root?.destroy();
        this.root = null;
        this.arrows = null;
        this.gates = [];
        this.drawnCount = 0;
        this.arrowCount = 0;
    }

    dispose(): void {
        this.hide();
        for (const m of this.materials.values()) m.destroy();
        this.materials.clear();
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
