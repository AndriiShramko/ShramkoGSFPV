// Crash aftermath with Rapier (deterministic build, WASM inlined, loaded lazily on first need).
// World: solid voxels in a +-1 m cube around the impact, greedily merged into cuboids.
// Craft: one rigid body = body cuboid + four duct cylinders. Debris: 2-4 small pieces.
// If Rapier cannot load, the simulator's own tumble (sim-core) stays in charge — the crash never
// depends on this module.

import type { VoxelCollision } from '@gsfpv/collision';
import { forEachSolidVoxel } from '@gsfpv/collision';

type Rapier = typeof import('@dimforge/rapier3d-deterministic-compat');

let rapierPromise: Promise<Rapier> | null = null;

/** Start loading Rapier (idempotent). Resolves to null if it cannot load (CSP, old browser). */
export function loadRapier(): Promise<Rapier | null> {
    if (!rapierPromise) {
        rapierPromise = import('@dimforge/rapier3d-deterministic-compat').then(async (R) => {
            await R.init();
            return R;
        });
    }
    return rapierPromise.catch(() => null);
}

export interface CrashStart {
    p: [number, number, number];
    q: [number, number, number, number]; // w, x, y, z
    v: [number, number, number];
    w: [number, number, number]; // world angular velocity rad/s
    mass: number;
    ductOffset: number; // m
    ductRadius: number; // m
    bodyRadius: number; // m
    impact: [number, number, number];
    normal: [number, number, number];
    seed: number;
}

export interface Piece {
    kind: 'craft' | 'debris';
    size: [number, number, number]; // full extents for rendering
    p: [number, number, number];
    q: [number, number, number, number]; // w, x, y, z
}

/** Greedy merge of solid voxels into cuboids: runs along x, then extend over y and z. */
export function mergeVoxels(cells: { x: number; y: number; z: number }[], size: number): { min: [number, number, number]; max: [number, number, number] }[] {
    const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
    const set = new Set<string>();
    let ox = Infinity, oy = Infinity, oz = Infinity;
    for (const c of cells) { ox = Math.min(ox, c.x); oy = Math.min(oy, c.y); oz = Math.min(oz, c.z); }
    const idx = cells.map((c) => [Math.round((c.x - ox) / size), Math.round((c.y - oy) / size), Math.round((c.z - oz) / size)] as const);
    for (const [i, j, k] of idx) set.add(key(i, j, k));
    const used = new Set<string>();
    const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
    const sorted = [...idx].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
    for (const [i, j, k] of sorted) {
        if (used.has(key(i, j, k))) continue;
        let ni = 1;
        while (set.has(key(i + ni, j, k)) && !used.has(key(i + ni, j, k))) ni++;
        let nj = 1;
        outerJ: for (;;) {
            for (let a = 0; a < ni; a++) if (!set.has(key(i + a, j + nj, k)) || used.has(key(i + a, j + nj, k))) break outerJ;
            nj++;
        }
        let nk = 1;
        outerK: for (;;) {
            for (let b = 0; b < nj; b++) for (let a = 0; a < ni; a++) if (!set.has(key(i + a, j + b, k + nk)) || used.has(key(i + a, j + b, k + nk))) break outerK;
            nk++;
        }
        for (let c = 0; c < nk; c++) for (let b = 0; b < nj; b++) for (let a = 0; a < ni; a++) used.add(key(i + a, j + b, k + c));
        boxes.push({ min: [ox + i * size, oy + j * size, oz + k * size], max: [ox + (i + ni) * size, oy + (j + nj) * size, oz + (k + nk) * size] });
    }
    return boxes;
}

function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class CrashScene {
    readonly world: InstanceType<Rapier['World']>;
    private R: Rapier;
    private craft: InstanceType<Rapier['RigidBody']>;
    private debris: { body: InstanceType<Rapier['RigidBody']>; size: [number, number, number] }[] = [];
    readonly craftSize: [number, number, number];
    readonly staticBoxes: number;
    t = 0;
    done = false;
    floorY: number | null = null;
    static readonly DT = 1 / 240;

    constructor(R: Rapier, col: VoxelCollision, s: CrashStart, gravity: number) {
        this.R = R;
        const world = new R.World({ x: 0, y: -gravity, z: 0 });
        world.timestep = CrashScene.DT;
        this.world = world;
        // static geometry around the impact
        const cells: { x: number; y: number; z: number }[] = [];
        const c = s.impact;
        forEachSolidVoxel(col, c[0] - 1, c[1] - 1, c[2] - 1, c[0] + 1, c[1] + 1, c[2] + 1, (x, y, z) => cells.push({ x, y, z }), 60000);
        const boxes = cells.length ? mergeVoxels(cells, col.voxelResolution) : [];
        const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
        for (const b of boxes) {
            const hx = (b.max[0] - b.min[0]) / 2, hy = (b.max[1] - b.min[1]) / 2, hz = (b.max[2] - b.min[2]) / 2;
            world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(b.min[0] + hx, b.min[1] + hy, b.min[2] + hz).setFriction(0.6).setRestitution(0.2), fixed);
        }
        this.staticBoxes = boxes.length;
        // the wreck usually falls further than the +-1 m cube: add the floor found straight below
        // the impact as one large slab, so pieces come to rest instead of falling forever
        const down = col.queryRay(c[0], c[1] - 0.05, c[2], 0, -1, 0, 20);
        if (down) {
            world.createCollider(R.ColliderDesc.cuboid(4, 0.05, 4).setTranslation(c[0], down.y - 0.05, c[2]).setFriction(0.7).setRestitution(0.15), fixed);
            this.floorY = down.y;
        }
        // the craft
        const rb = R.RigidBodyDesc.dynamic()
            .setTranslation(s.p[0], s.p[1], s.p[2])
            .setRotation({ w: s.q[0], x: s.q[1], y: s.q[2], z: s.q[3] })
            .setLinvel(s.v[0], s.v[1], s.v[2])
            .setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] })
            .setCcdEnabled(true)
            .setLinearDamping(0.1)
            .setAngularDamping(0.8);
        const craft = world.createRigidBody(rb);
        const bodyHalf = s.bodyRadius * 0.8;
        const frameMass = s.mass * 0.6;
        world.createCollider(R.ColliderDesc.cuboid(bodyHalf, bodyHalf * 0.5, bodyHalf).setMass(frameMass).setFriction(0.5).setRestitution(0.25), craft);
        const off = s.ductOffset;
        for (const [dx, dz] of [[off, off], [off, -off], [-off, off], [-off, -off]]) {
            world.createCollider(
                R.ColliderDesc.cylinder(s.ductRadius * 0.35, s.ductRadius).setTranslation(dx, 0, dz).setMass((s.mass - frameMass) / 4).setFriction(0.5).setRestitution(0.3),
                craft
            );
        }
        this.craft = craft;
        this.craftSize = [off * 2 + s.ductRadius * 2, s.ductRadius * 0.7, off * 2 + s.ductRadius * 2];
        // debris: 2-4 pieces thrown off the impact point
        const rng = mulberry(s.seed);
        const nDebris = 2 + Math.floor(rng() * 3);
        const n = s.normal;
        for (let i = 0; i < nDebris; i++) {
            const size: [number, number, number] = [0.01 + rng() * 0.02, 0.004 + rng() * 0.006, 0.01 + rng() * 0.025];
            const sp = 0.6 + rng() * 1.8;
            const vx = s.v[0] * 0.3 + n[0] * sp + (rng() - 0.5) * 2;
            const vy = s.v[1] * 0.3 + n[1] * sp + rng() * 1.5;
            const vz = s.v[2] * 0.3 + n[2] * sp + (rng() - 0.5) * 2;
            const body = world.createRigidBody(
                R.RigidBodyDesc.dynamic()
                    .setTranslation(s.p[0] + n[0] * 0.03, s.p[1] + n[1] * 0.03 + 0.01, s.p[2] + n[2] * 0.03)
                    .setLinvel(vx, vy, vz)
                    .setAngvel({ x: (rng() - 0.5) * 60, y: (rng() - 0.5) * 60, z: (rng() - 0.5) * 60 })
                    .setCcdEnabled(true)
                    .setAngularDamping(0.5)
            );
            world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setDensity(1200).setRestitution(0.35).setFriction(0.5), body);
            this.debris.push({ body, size });
        }
    }

    /** Advance by dt seconds in fixed Rapier steps. */
    advance(dt: number): void {
        if (this.done) return;
        const steps = Math.min(40, Math.round(dt / CrashScene.DT));
        for (let i = 0; i < steps; i++) {
            this.world.step();
            this.t += CrashScene.DT;
        }
        const allAsleep = this.craft.isSleeping() && this.debris.every((d) => d.body.isSleeping());
        if (allAsleep || this.t >= 4) this.done = true;
    }

    pieces(): Piece[] {
        const out: Piece[] = [];
        const push = (kind: Piece['kind'], b: InstanceType<Rapier['RigidBody']>, size: [number, number, number]) => {
            const t = b.translation();
            const r = b.rotation();
            out.push({ kind, size, p: [t.x, t.y, t.z], q: [r.w, r.x, r.y, r.z] });
        };
        push('craft', this.craft, this.craftSize);
        for (const d of this.debris) push('debris', d.body, d.size);
        return out;
    }

    get debrisCount(): number {
        return this.debris.length;
    }

    craftAngularSpeed(): number {
        const w = this.craft.angvel();
        return Math.hypot(w.x, w.y, w.z);
    }

    free(): void {
        this.world.free();
    }
}
