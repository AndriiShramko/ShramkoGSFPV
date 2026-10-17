// What a model builder collects: parts (a mesh and its material, already in the model's space) and the anchors the
// callouts point at (v0.9 lane D). No engine.
import { boundsOf, merge } from './mesh';
import type { Bounds, MeshData, Vec3 } from './mesh';
import type { MaterialId } from './materials';
import { applyPoint, IDENTITY, mul, place, transformed, translate } from './xform';
import type { Affine, Place } from './xform';

/** What a legend row and a pin on the model speak of. */
export type CalloutId = 'frame' | 'motors' | 'props' | 'battery' | 'camera' | 'vtx' | 'action' | 'payload';

export interface Part {
    /** for tests and for people reading the model */
    name: string;
    material: MaterialId;
    mesh: MeshData;
}

export interface Anchor {
    id: CalloutId;
    /** where the pin sits, model space, mm */
    at: Vec3;
    /** the way the pinned part faces; the pin fades when it turns away from the viewer */
    normal?: Vec3;
}

export interface Model {
    parts: Part[];
    anchors: Anchor[];
    /** the whole model, resting on y = 0 */
    bounds: Bounds;
    /** from the middle of the footprint to the farthest point, mm */
    radius: number;
    /** the colour of the anodised parts */
    accent: readonly [number, number, number];
}

/** Collects parts and anchors. `add` places a mesh by an affine (`at` composes a parent transform with a Place). */
export class Kit {
    readonly parts: Part[] = [];
    readonly anchors: Anchor[] = [];

    add(name: string, material: MaterialId, mesh: MeshData, m: Affine | Place = IDENTITY): void {
        const t = Array.isArray(m) ? (m as Affine) : place(m as Place);
        this.parts.push({ name, material, mesh: transformed(mesh, t) });
    }

    pin(id: CalloutId, parent: Affine, p: Vec3, normal?: Vec3): void {
        const at = applyPoint(parent, p);
        // a direction rotates with the parent but is not moved by it
        let n: Vec3 | undefined;
        if (normal) {
            const o = applyPoint(parent, [0, 0, 0]);
            const q = applyPoint(parent, normal);
            const v: Vec3 = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
            const l = Math.hypot(...v) || 1;
            n = [v[0] / l, v[1] / l, v[2] / l];
        }
        this.anchors.push({ id, at, normal: n });
    }

    /** The model: everything moved so it rests on y = 0 and is centred on the middle of its footprint. */
    finish(accent: readonly [number, number, number]): Model {
        const all = merge(this.parts.map((p) => p.mesh));
        const b = boundsOf(all);
        const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
        const t = translate(-cx, -b.min[1], -cz);
        const parts = this.parts.map((p) => ({ ...p, mesh: transformed(p.mesh, t) }));
        const anchors = this.anchors.map((a) => ({ ...a, at: applyPoint(t, a.at) }));
        const nb = boundsOf(merge(parts.map((p) => p.mesh)));
        let radius = 0;
        for (let i = 0; i < all.positions.length; i += 3) {
            const x = all.positions[i] - cx, z = all.positions[i + 2] - cz;
            radius = Math.max(radius, Math.hypot(x, all.positions[i + 1] - b.min[1], z));
        }
        return { parts, anchors, bounds: nb, radius, accent };
    }
}

/** A parent transform composed with a placement. */
export const at = (parent: Affine, p: Place): Affine => mul(parent, place(p));
