// v0.12 Fly by Sound, lane v12-flight step 6 (docs/wip/v12-plan.md 2.5 and 4.2): the helper's view of a lesson world,
// apps/fly/src/sonic/primitives.ts, held to the world the sound reads.
//  - the hollow the primitives draw (cavityBoxes, a mirror of the generators) is the world's own: random points in the
//    world's bounds are free exactly where solidAt says (control: a corridor mirrored left for right is caught);
//  - every exposed face is a real wall: a point just inside the hollow is free, one just beyond is solid;
//  - every wall the sound's rays can hit has a slab on it: rays from free points, their first hit that is not an
//    object lies on a drawn face (control: one face left out is caught);
//  - every object's primitives lie on the object's surface: rays that hit a ring, a bar or a pillar land on its
//    primitives (control: a ring left lying as the engine's torus does, its axis along Y, is caught);
//  - gates of a track come through the scene transform: sizes times s, centres s * p + t.
import { describe, expect, it } from 'vitest';
import { SHIPPED_LESSON_IDS, createAnalyticWorld, getLesson, makeSpec, quatAxisAngle, quatConjugate, quatRotate, sdBox, sdCylinderY, trackToObjects } from '../../../packages/sonic-fpv/src';
import type { AnalyticWorldInfo, AnalyticWorldSpec, Quat, SonicObject, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { SLAB_M, ZONE_BAR_M, cavityBoxes, exposedFaces, objectPrims, roomFaces, roomPrims, shapePrims, slabOf, worldPrims } from '../../../apps/fly/src/sonic/primitives';
import type { Cavity, Face, Prim } from '../../../apps/fly/src/sonic/primitives';

/** A seeded generator, so a failure repeats. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Every analytic lesson world that ships, and the corridor and open layouts no lesson uses. */
function worlds(): { name: string; world: AnalyticWorldInfo }[] {
    const specs = new Map<string, { name: string; spec: AnalyticWorldSpec }>();
    for (const id of SHIPPED_LESSON_IDS) {
        const l = getLesson(id);
        if (l.world.kind === 'analytic') specs.set(JSON.stringify(l.world.spec), { name: id, spec: l.world.spec });
    }
    const extra: [string, AnalyticWorldSpec][] = [
        ['corridor-straight', makeSpec('corridor', { layout: 'straight', straightM: 40 }, 3)],
        ['corridor-obstacle', makeSpec('corridor', { layout: 'obstacle' }, 3)],
        ['corridor-bends', makeSpec('corridor', { layout: 'bends', bendCount: 5 }, 3)],
        ['corridor-jogs', makeSpec('corridor', { layout: 'jogs', jogCount: 5, riseM: 4 }, 3)],
        ['corridor-full-default', makeSpec('corridor', {}, 3)],
        ['open-ceiling', makeSpec('open', { ceilingM: 6, halfSizeM: 30 }, 1)],
        ['cube-frames-turn', makeSpec('cube-frames', { layout: 'turn', count: 4, turnDeg: 50 }, 2)],
        ['rings-course-seeded', makeSpec('rings', { layout: 'course', count: 8, sizeM: 2.5, spacingM: 12 }, 9)],
        ['pillars-scatter', makeSpec('pillars', { layout: 'scatter', count: 6 }, 4)]
    ];
    for (const [name, spec] of extra) specs.set(JSON.stringify(spec), { name, spec });
    return [...specs.values()].map((s) => ({ name: s.name, world: createAnalyticWorld(s.spec) }));
}
const WORLDS = worlds();

// ------------------------------------------------------------------ geometry of the primitives

/** The world point in the primitive's own frame. */
function local(p: Prim, w: Vec3): Vec3 {
    return quatRotate(quatConjugate(p.quat), [w[0] - p.pos[0], w[1] - p.pos[1], w[2] - p.pos[2]]);
}

/** Signed distance from `w` to the primitive's analytic shape (the engine's frames: box x y z, cylinder and torus axis Y). */
function primSdf(p: Prim, w: Vec3): number {
    const [x, y, z] = local(p, w);
    switch (p.kind) {
        case 'box':
            return sdBox(x, y, z, p.size[0] / 2, p.size[1] / 2, p.size[2] / 2);
        case 'cylinder':
            return sdCylinderY(x, y, z, p.size[0] / 2, p.size[1] / 2);
        case 'torus':
            return Math.hypot(Math.hypot(x, z) - p.size[0], y) - p.size[1];
    }
}

const nearObjects = (world: AnalyticWorldInfo, p: Vec3, extra: number): boolean =>
    world.objects().some((o) => Math.hypot(p[0] - o.pos[0], p[1] - o.pos[1], p[2] - o.pos[2]) < Math.hypot(...(o.shape.kind === 'ring' ? [o.shape.diameter / 2 + 2 * o.shape.tube] : o.shape.kind === 'pillar' ? [o.shape.radius, o.shape.height / 2] : o.shape.kind === 'zone' || o.shape.kind === 'box' ? [o.shape.size[0], o.shape.size[1], o.shape.size[2]] : [o.shape.side / 2 + o.shape.bar, o.shape.side / 2 + o.shape.bar, o.shape.side / 2 + o.shape.bar])) + extra);

const insideAny = (boxes: readonly Cavity[], p: Vec3, grow = 0): boolean => boxes.some((b) => Math.abs(p[0] - b.cx) <= b.hx + grow && Math.abs(p[1] - b.cy) <= b.hy + grow && Math.abs(p[2] - b.cz) <= b.hz + grow);

/** How far `p` is from the boundary of the union's boxes' faces (the nearest box face plane within its extent), a cheap bound. */
function nearBoundary(boxes: readonly Cavity[], p: Vec3, tol: number): boolean {
    return insideAny(boxes, p, tol) && !boxes.some((b) => Math.abs(p[0] - b.cx) <= b.hx - tol && Math.abs(p[1] - b.cy) <= b.hy - tol && Math.abs(p[2] - b.cz) <= b.hz - tol);
}

describe('the hollow drawn is the world\'s own hollow', () => {
    for (const { name, world } of WORLDS) {
        const boxes = cavityBoxes(world);
        if (boxes === null) continue;
        it(`${name}: free exactly where solidAt says, on random points of the bounds (${boxes.length} boxes)`, () => {
            const r = rng(7);
            const { min, max } = world.bounds;
            let checked = 0;
            for (let i = 0; i < 20000; i++) {
                const p: Vec3 = [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])];
                if (nearObjects(world, p, 0.1) || nearBoundary(boxes, p, 0.003)) continue;
                checked++;
                expect(insideAny(boxes, p), `${JSON.stringify(p)}`).toBe(!world.solidAt(p[0], p[1], p[2]));
            }
            expect(checked).toBeGreaterThan(5000);
        });
    }

    it('control: the corridor mirrored left for right is not the world (the mirror check can fail)', () => {
        const w = WORLDS.find((x) => x.name === 'corridor')!.world;
        const boxes = cavityBoxes(w)!;
        const mirrored = boxes.map((b) => ({ ...b, cx: -b.cx }));
        const r = rng(11);
        const { min, max } = w.bounds;
        let wrong = 0;
        for (let i = 0; i < 20000; i++) {
            const p: Vec3 = [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])];
            if (nearObjects(w, p, 0.1) || nearBoundary(mirrored, p, 0.003)) continue;
            if (insideAny(mirrored, p) !== !w.solidAt(p[0], p[1], p[2])) wrong++;
        }
        expect(wrong).toBeGreaterThan(100);
    });
});

// ------------------------------------------------------------------ the exposed faces

/** The area of the boundary of a union of boxes whose corners are multiples of `cell`, counted on a grid. */
function gridBoundaryArea(boxes: readonly Cavity[], cell: number): number {
    const key = (i: number, j: number, k: number): string => `${i},${j},${k}`;
    const filled = new Set<string>();
    for (const b of boxes) {
        for (let i = Math.round((b.cx - b.hx) / cell); i < Math.round((b.cx + b.hx) / cell); i++)
            for (let j = Math.round((b.cy - b.hy) / cell); j < Math.round((b.cy + b.hy) / cell); j++)
                for (let k = Math.round((b.cz - b.hz) / cell); k < Math.round((b.cz + b.hz) / cell); k++) filled.add(key(i, j, k));
    }
    let faces = 0;
    for (const c of filled) {
        const [i, j, k] = c.split(',').map(Number) as [number, number, number];
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) if (!filled.has(key(i + di, j + dj, k + dk))) faces++;
    }
    return faces * cell * cell;
}

const faceArea = (f: Face): number => (f.u1 - f.u0) * (f.v1 - f.v0);

describe('exposedFaces is the boundary of the union of the boxes', () => {
    const L: Cavity[] = [
        { cx: 0, cy: 1, cz: 0, hx: 1, hy: 1, hz: 3 }, // x -1..1, y 0..2, z -3..3
        { cx: 2.5, cy: 1, cz: -2, hx: 2.5, hy: 1, hz: 1 } // x 0..5, y 0..2, z -3..-1: meets the first at a corner
    ];
    const T: Cavity[] = [
        ...L,
        { cx: 0, cy: 3, cz: 0, hx: 0.5, hy: 1, hz: 0.5 } // a shaft up from the first box's roof
    ];

    for (const [name, boxes] of [['an L of two boxes', L], ['an L with a shaft', T], ['two boxes sharing a whole face', [{ cx: 0, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 }, { cx: 2, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 }]], ['the same box twice', [L[0]!, L[0]!]]] as const) {
        it(`${name}: the faces add up to the area of the union's boundary, counted on a grid`, () => {
            const sum = exposedFaces(boxes).reduce((a, f) => a + faceArea(f), 0);
            expect(sum).toBeCloseTo(gridBoundaryArea(boxes, 0.25), 6);
        });
    }

    it('a face where two boxes meet is not drawn, and coplanar floors are drawn once', () => {
        const faces = exposedFaces([{ cx: 0, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 }, { cx: 2, cy: 1, cz: 0, hx: 1, hy: 1, hz: 1 }]);
        expect(faces.filter((f) => f.axis === 0 && Math.abs(f.plane - 1) < 1e-9)).toEqual([]);
        const floorArea = faces.filter((f) => f.axis === 1 && f.side === -1).reduce((a, f) => a + faceArea(f), 0);
        expect(floorArea).toBeCloseTo(8, 9); // 2 x 4 m, once
    });
});

describe('every face is a real wall and every wall has its slab', () => {
    for (const { name, world } of WORLDS) {
        if (cavityBoxes(world) === null) continue;
        const faces = roomFaces(world);
        it(`${name}: ${faces.length} faces stand where free air meets solid (a point 1 cm inside is free, 1 cm beyond is solid)`, () => {
            const r = rng(3);
            let tested = 0;
            for (const f of faces) {
                for (let k = 0; k < 6; k++) {
                    const u = f.u0 + (f.u1 - f.u0) * (k === 0 ? 0.5 : 0.1 + 0.8 * r());
                    const v = f.v0 + (f.v1 - f.v0) * (k === 0 ? 0.5 : 0.1 + 0.8 * r());
                    const at = (d: number): Vec3 => {
                        const p: [number, number, number] = [0, 0, 0];
                        const [ua, va] = f.axis === 0 ? [1, 2] : f.axis === 1 ? [0, 2] : [0, 1];
                        p[ua!] = u;
                        p[va!] = v;
                        p[f.axis] = f.plane + f.side * d;
                        return p;
                    };
                    const inside = at(-0.01), beyond = at(0.01);
                    if (nearObjects(world, inside, 0.05)) continue;
                    tested++;
                    expect(world.solidAt(inside[0], inside[1], inside[2]), `inside ${JSON.stringify(inside)} of ${JSON.stringify(f)}`).toBe(false);
                    expect(world.solidAt(beyond[0], beyond[1], beyond[2]), `beyond ${JSON.stringify(beyond)} of ${JSON.stringify(f)}`).toBe(true);
                }
            }
            expect(tested).toBeGreaterThan(faces.length);
        });
    }

    /** Rays from free points in random directions: the first hit that is not an object must lie on a face's slab. */
    function uncovered(world: AnalyticWorldInfo, faces: readonly Face[], seed: number): { hits: number; missed: number } {
        const r = rng(seed);
        const { min, max } = world.bounds;
        let hits = 0, missed = 0;
        for (let i = 0, tried = 0; tried < 1500 && i < 20000; i++) {
            const o: Vec3 = [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])];
            if (world.sdf(o[0], o[1], o[2]) < 0.3) continue;
            tried++;
            const a = r() * 2 * Math.PI, e = Math.asin(2 * r() - 1);
            const d: Vec3 = [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
            const hit = world.castRay(o, d, 400);
            if (!hit || hit.objectId !== null) continue;
            hits++;
            const p = hit.point;
            const onFace = faces.some((f) => {
                const [ua, va] = f.axis === 0 ? [1, 2] : f.axis === 1 ? [0, 2] : [0, 1];
                return Math.abs(p[f.axis] - f.plane) <= 0.002 && p[ua!] >= f.u0 - 0.002 && p[ua!] <= f.u1 + 0.002 && p[va!] >= f.v0 - 0.002 && p[va!] <= f.v1 + 0.002;
            });
            if (!onFace) missed++;
        }
        return { hits, missed };
    }

    for (const { name, world } of WORLDS) {
        if (cavityBoxes(world) === null) continue;
        it(`${name}: every wall a ray hits has a drawn face`, () => {
            const { hits, missed } = uncovered(world, roomFaces(world), 21);
            expect(hits).toBeGreaterThan(300);
            expect(missed).toBe(0);
        });
    }

    it('control: with one face left out, rays that hit it are found uncovered', () => {
        const world = WORLDS.find((w) => w.name === 'walls-hall')!.world;
        const faces = roomFaces(world);
        const front = faces.findIndex((f) => f.axis === 2 && f.side === -1);
        expect(front).toBeGreaterThanOrEqual(0);
        const { hits, missed } = uncovered(world, faces.filter((_, i) => i !== front), 21);
        expect(missed).toBeGreaterThan(hits / 20);
    });
});

describe('the open world is a floor (and a ceiling)', () => {
    it('hover-height: one floor slab under y = 0, nothing else', () => {
        const w = WORLDS.find((x) => x.name === 'hover-height')!.world;
        const prims = roomPrims(w);
        expect(prims).toHaveLength(1);
        expect(prims[0]).toMatchObject({ kind: 'box', role: 'floor' });
        const p = prims[0]!;
        expect(p.pos[1] + p.size[1] / 2).toBeCloseTo(0, 9);
        expect(w.solidAt(0, -0.01, 0)).toBe(true);
        expect(w.solidAt(0, 0.01, 0)).toBe(false);
    });

    it('with a ceiling: a second slab above it', () => {
        const w = WORLDS.find((x) => x.name === 'open-ceiling')!.world;
        const prims = roomPrims(w);
        expect(prims.map((p) => p.role)).toEqual(['floor', 'ceiling']);
        expect(prims[1]!.pos[1] - prims[1]!.size[1] / 2).toBeCloseTo(6, 9);
        expect(w.solidAt(0, 6.01, 0)).toBe(true);
        expect(w.solidAt(0, 5.99, 0)).toBe(false);
    });
});

// ------------------------------------------------------------------ objects

describe('an object\'s primitives lie on its surface', () => {
    /** Rays toward every object from free points; each object hit must land on that object's primitives. */
    function offSurface(world: AnalyticWorldInfo, prims: readonly Prim[], seed: number, tol = 2e-3): { hits: number; off: number; worst: number } {
        const r = rng(seed);
        let hits = 0, off = 0, worst = 0;
        const objects = world.objects().filter((o) => o.solid);
        for (let i = 0; i < 4000 && objects.length > 0; i++) {
            const o = objects[Math.floor(r() * objects.length)] as SonicObject;
            // an origin near the object, a direction toward a point around it
            const radius = 4 + 6 * r();
            const a = r() * 2 * Math.PI, e = (r() - 0.5) * 1.2;
            const from: Vec3 = [o.pos[0] + radius * Math.cos(e) * Math.sin(a), o.pos[1] + radius * Math.sin(e), o.pos[2] - radius * Math.cos(e) * Math.cos(a)];
            if (world.sdf(from[0], from[1], from[2]) < 0.3) continue;
            const aim: Vec3 = [o.pos[0] + (r() - 0.5) * 2, o.pos[1] + (r() - 0.5) * 2, o.pos[2] + (r() - 0.5) * 2];
            const len = Math.hypot(aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]);
            const d: Vec3 = [(aim[0] - from[0]) / len, (aim[1] - from[1]) / len, (aim[2] - from[2]) / len];
            const hit = world.castRay(from, d, 40);
            if (!hit || hit.objectId === null) continue;
            hits++;
            const mine = prims.filter((p) => p.objectId === hit.objectId);
            const dist = Math.min(...mine.map((p) => Math.abs(primSdf(p, hit.point))));
            worst = Math.max(worst, dist);
            if (dist > tol) off++;
        }
        return { hits, off, worst };
    }

    for (const name of ['rings-first', 'rings-small', 'shapes-square', 'shapes-cube', 'walls-pillar', 'walls-row', 'cube-frames-turn', 'rings-course-seeded']) {
        it(`${name}: rays that hit an object land on its primitives`, () => {
            const world = WORLDS.find((w) => w.name === name)!.world;
            const { hits, off, worst } = offSurface(world, objectPrims(world.objects()), 5);
            expect(hits).toBeGreaterThan(100);
            expect(off, `worst ${worst}`).toBe(0);
        });
    }

    it('control: a ring left as the engine\'s torus is (axis Y, not Z) is far off its surface', () => {
        const world = WORLDS.find((w) => w.name === 'rings-first')!.world;
        const wrong = objectPrims(world.objects()).map((p) => (p.kind === 'torus' ? { ...p, quat: world.objects()[0]!.quat } : p));
        const { hits, off } = offSurface(world, wrong, 5);
        expect(hits).toBeGreaterThan(100);
        expect(off).toBeGreaterThan(hits * 0.9);
    });

    it('control: a pillar drawn 0.3 m aside is off its surface', () => {
        const world = WORLDS.find((w) => w.name === 'walls-pillar')!.world;
        const wrong = objectPrims(world.objects()).map((p) => ({ ...p, pos: [p.pos[0] + 0.3, p.pos[1], p.pos[2]] as Vec3 }));
        const { hits, off } = offSurface(world, wrong, 5);
        expect(hits).toBeGreaterThan(100);
        expect(off).toBeGreaterThan(hits * 0.5);
    });

    it('a ring is one torus: centre line diameter / 2 + tube, tube radius, opening along the ring\'s Z', () => {
        const ring: SonicObject = { id: 'ring-1', shape: { kind: 'ring', diameter: 3, tube: 0.1 }, pos: [1, 2, 3], quat: quatAxisAngle([0, 1, 0], 0.4), order: 0, solid: true, material: 'obstacle' };
        const [p] = shapePrims(ring);
        expect(p).toMatchObject({ kind: 'torus', role: 'gate', objectId: 'ring-1', pos: [1, 2, 3] });
        expect(p!.size[0]).toBeCloseTo(1.6, 12);
        expect(p!.size[1]).toBeCloseTo(0.1, 12);
        // the torus' own axis Y, turned by the primitive's rotation, is the ring's local Z in the world
        const axis = quatRotate(p!.quat as Quat, [0, 1, 0]);
        const z = quatRotate(ring.quat, [0, 0, 1]);
        expect(axis[0]).toBeCloseTo(z[0], 9);
        expect(axis[1]).toBeCloseTo(z[1], 9);
        expect(axis[2]).toBeCloseTo(z[2], 9);
    });

    it('a square is four bars, a cube frame twelve, a zone twelve thin edges, a pillar a cylinder', () => {
        const at = (shape: SonicObject['shape']): SonicObject => ({ id: 'x', shape, pos: [0, 0, 0], quat: [1, 0, 0, 0], order: null, solid: true, material: 'obstacle' });
        expect(shapePrims(at({ kind: 'square', side: 2, bar: 0.1 }))).toHaveLength(4);
        expect(shapePrims(at({ kind: 'cube-frame', side: 2, bar: 0.1 }))).toHaveLength(12);
        const zone = shapePrims(at({ kind: 'zone', size: [4, 2, 6] }));
        expect(zone).toHaveLength(12);
        expect(zone.every((p) => p.role === 'zone' && Math.min(...p.size) === ZONE_BAR_M)).toBe(true);
        expect(shapePrims(at({ kind: 'pillar', radius: 0.5, height: 3 }))).toEqual([{ kind: 'cylinder', role: 'pillar', objectId: 'x', pos: [0, 0, 0], quat: [1, 0, 0, 0], size: [1, 3, 1] }]);
        expect(shapePrims(at({ kind: 'box', size: [1, 2, 3] }))[0]).toMatchObject({ kind: 'box', role: 'box', size: [1, 2, 3] });
    });
});

// ------------------------------------------------------------------ the scan's gates, through the transform

describe('track gates come through the scene transform', () => {
    const track: TrackFile = {
        format: 'shramko-sonic-track/1',
        id: 'test',
        version: 1,
        parent: null,
        title: 'test',
        scene: { kind: 'scan', id: '7a475d38', version: 1 },
        transform: [5, 0, 0, 0],
        gates: [
            { id: 'g1', shape: { kind: 'ring', diameter: 0.6, tube: 0.02 }, pos: [1, 0.5, -2], quat: [1, 0, 0, 0], direction: 'forward' },
            { id: 'g2', shape: { kind: 'square', side: 0.5, bar: 0.03 }, pos: [2, 0.6, -4], quat: quatAxisAngle([0, 1, 0], -0.5), direction: 'any' }
        ],
        laps: 1,
        start: null,
        author: { kind: 'agent', name: 'test' },
        generator: null,
        created: '2026-11-07T00:00:00Z'
    };

    it('at x5 with an offset: positions s * p + t, sizes times s', () => {
        const prims = objectPrims(trackToObjects(track, { transform: [5, 1, 2, 3] }));
        const ring = prims.find((p) => p.objectId === 'g1')!;
        expect(ring.kind).toBe('torus');
        expect(ring.pos).toEqual([6, 4.5, -7]);
        expect(ring.size[0]).toBeCloseTo(5 * (0.3 + 0.02), 12);
        expect(ring.size[1]).toBeCloseTo(5 * 0.02, 12);
        const bars = prims.filter((p) => p.objectId === 'g2');
        expect(bars).toHaveLength(4);
        // the frame's outer side: side + 2 * bar, flown at x5
        const long = bars.filter((b) => b.size[0] > b.size[1]);
        expect(long[0]!.size[0]).toBeCloseTo(5 * (0.5 + 0.06), 12);
        const centre = [0, 1, 2].map((k) => bars.reduce((a, b) => a + b.pos[k]!, 0) / 4);
        expect(centre[0]).toBeCloseTo(5 * 2 + 1, 9);
        expect(centre[1]).toBeCloseTo(5 * 0.6 + 2, 9);
        expect(centre[2]).toBeCloseTo(5 * -4 + 3, 9);
    });

    it('the same track at x1 is a fifth of the size: the transform is the only difference', () => {
        const x5 = objectPrims(trackToObjects(track, { transform: [5, 0, 0, 0] }));
        const x1 = objectPrims(trackToObjects(track, { transform: [1, 0, 0, 0] }));
        expect(x5).toHaveLength(x1.length);
        x5.forEach((p, i) => {
            const q = x1[i]!;
            expect(p.pos[0]).toBeCloseTo(5 * q.pos[0], 9);
            expect(p.size[0]).toBeCloseTo(5 * q.size[0], 9);
            expect(p.size[1]).toBeCloseTo(5 * q.size[1], 9);
        });
    });
});

describe('worldPrims is the room and the objects', () => {
    it('rings-course: slabs for the hall plus a torus a gate', () => {
        const w = WORLDS.find((x) => x.name === 'rings-course')!.world;
        const prims = worldPrims(w);
        expect(prims.filter((p) => p.objectId === null)).toHaveLength(6);
        expect(prims.filter((p) => p.kind === 'torus')).toHaveLength(6);
        expect(slabOf({ axis: 1, side: -1, plane: 0, u0: -1, u1: 1, v0: -2, v1: 2 })).toMatchObject({ role: 'floor', size: [2, SLAB_M, 4], pos: [0, -SLAB_M / 2, 0] });
    });
});
