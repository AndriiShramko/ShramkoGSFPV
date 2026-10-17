// The parametric shapes of the 3D drone models (apps/fly/src/drones3d/shapes.ts, mesh.ts, xform.ts; v0.9 lane D).
// What each claim needs to be true for the picture to be right, and the control that fails it:
//  - every shape is a valid mesh (indices in range, unit normals, uvs for every vertex);
//  - closed shapes are closed and face outwards: their signed volume equals the analytic volume (a flipped
//    winding gives a negative volume, an open surface a wrong one); control: the same mesh with two indices of
//    each triangle swapped has the negative volume and fails the predicate;
//  - sizes are the ones asked for (a propeller is its diameter tip to tip, a duct keeps its inner and outer radius);
//  - the mirror transform keeps shapes facing outwards, and a counter-clockwise propeller is the mirror image.
import { describe, expect, it } from 'vitest';
import { boundsOf, merge, problemsOf, signedVolume, surfaceArea, triangleCount } from '../../../apps/fly/src/drones3d/mesh';
import type { MeshData } from '../../../apps/fly/src/drones3d/mesh';
import { cylinder, duct, extrudeOutline, lathe, propHub, propeller, rectOutline, ring, roundedBox, sphere, tube, barOutline } from '../../../apps/fly/src/drones3d/shapes';
import { placed, scaleBy, transformed } from '../../../apps/fly/src/drones3d/xform';

const near = (a: number, b: number, rel: number): boolean => Math.abs(a - b) <= rel * Math.abs(b);
/** the same triangles wound the other way: the control for "faces outwards" */
const insideOut = (m: MeshData): MeshData => ({ ...m, indices: m.indices.map((v, i) => (i % 3 === 1 ? m.indices[i + 1] : i % 3 === 2 ? m.indices[i - 1] : v)) });

describe('shapes: valid meshes', () => {
    const all: [string, MeshData][] = [
        ['cylinder', cylinder(5, 10, { bevel: 1 })],
        ['sphere', sphere(4)],
        ['ring', ring(3, 5, 2)],
        ['roundedBox', roundedBox(10, 6, 8, { radius: 1.5 })],
        ['extrude', extrudeOutline(rectOutline(10, 6), 0, 2)],
        ['tube', tube([[0, 0, 0], [10, 0, 0], [10, 10, 3]], 0.8)],
        ['duct', duct({ inner: 29, outer: 32, height: 20 })],
        ['propeller', propeller({ diameter: 56, blades: 3, hubRadius: 3, pitchRatio: 0.8 })],
        ['hub', propHub(4, 5)]
    ];
    for (const [name, m] of all) {
        it(`${name} is a valid mesh with triangles`, () => {
            expect(problemsOf(m, name)).toEqual([]);
            expect(triangleCount(m)).toBeGreaterThan(10);
        });
    }
    it('control: a broken mesh is reported', () => {
        const bad = cylinder(5, 10);
        bad.indices.push(99999, 0, 1);
        bad.normals[0] = 3;
        expect(problemsOf(bad).length).toBeGreaterThanOrEqual(2);
    });
});

describe('shapes: closed, facing outwards, the right volume', () => {
    it('cylinder', () => {
        const m = cylinder(5, 10, { segments: 128 });
        expect(near(signedVolume(m), Math.PI * 25 * 10, 0.005)).toBe(true);
        expect(signedVolume(insideOut(m))).toBeLessThan(0); // control
    });
    it('sphere', () => {
        const m = sphere(4, { rings: 48, segments: 96 });
        expect(near(signedVolume(m), (4 / 3) * Math.PI * 64, 0.01)).toBe(true);
    });
    it('ring (a washer)', () => {
        const m = ring(3, 5, 2, { segments: 128 });
        expect(near(signedVolume(m), Math.PI * (25 - 9) * 2, 0.005)).toBe(true);
    });
    it('rounded box: Minkowski sum of the inner box and a ball', () => {
        const w = 10, h = 6, d = 8, r = 1.5;
        const a = w - 2 * r, b = h - 2 * r, c = d - 2 * r;
        const analytic = a * b * c + 2 * r * (a * b + b * c + a * c) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3;
        const m = roundedBox(w, h, d, { radius: r, seg: 8 });
        expect(near(signedVolume(m), analytic, 0.01)).toBe(true);
        const bb = boundsOf(m);
        expect(bb.max[0] - bb.min[0]).toBeCloseTo(w, 6);
        expect(bb.max[1] - bb.min[1]).toBeCloseTo(h, 6);
        expect(bb.max[2] - bb.min[2]).toBeCloseTo(d, 6);
        expect(signedVolume(insideOut(m))).toBeLessThan(0); // control
    });
    it('extruded outline: area x height, whichever way the outline runs', () => {
        const rect = extrudeOutline(rectOutline(10, 6), 1, 4);
        expect(signedVolume(rect)).toBeCloseTo(10 * 6 * 3, 6);
        const reversed = extrudeOutline(rectOutline(10, 6).reverse(), 1, 4);
        expect(signedVolume(reversed)).toBeCloseTo(10 * 6 * 3, 6);
        // an X of four tapered arms: star shaped about its centre
        const arms = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => barOutline(sx * 2, sz * 2, sx * 40, sz * 40, 10, 6));
        const x = merge(arms.map((o) => extrudeOutline(o, 0, 3)));
        expect(signedVolume(x)).toBeCloseTo(4 * ((10 + 6) / 2) * Math.hypot(38, 38) * 3, 4);
    });
    it('tube: pi r^2 L for a straight rod', () => {
        const m = tube([[0, 0, 0], [30, 0, 0]], 1, { radial: 64 });
        expect(near(signedVolume(m), Math.PI * 30, 0.01)).toBe(true);
        const up = tube([[0, 0, 0], [0, 30, 0]], 1, { radial: 64 });
        expect(near(signedVolume(up), Math.PI * 30, 0.01)).toBe(true);
        const diag = tube([[0, 0, 0], [20, 20, 20]], 1, { radial: 64 });
        expect(near(signedVolume(diag), Math.PI * Math.hypot(20, 20, 20), 0.01)).toBe(true);
        expect(signedVolume(insideOut(m))).toBeLessThan(0); // control
    });
    it('duct: stays between its inner and outer radius and has a wall', () => {
        const m = duct({ inner: 29, outer: 32, height: 20, segments: 96 });
        const rs: number[] = [];
        for (let i = 0; i < m.positions.length; i += 3) rs.push(Math.hypot(m.positions[i], m.positions[i + 2]));
        expect(Math.min(...rs)).toBeCloseTo(29, 6);
        expect(Math.max(...rs)).toBeCloseTo(32, 6);
        const v = signedVolume(m);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(Math.PI * (32 ** 2 - 29 ** 2) * 20);
        expect(v).toBeGreaterThan(0.7 * Math.PI * (32 ** 2 - 29 ** 2) * 20);
        const bb = boundsOf(m);
        expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 6);
    });
});

describe('propeller', () => {
    it('is its diameter tip to tip, and every blade is a closed outward-facing volume (clockwise and counter-clockwise)', () => {
        for (const ccw of [false, true]) {
            const one = propeller({ diameter: 129.5, blades: 1, hubRadius: 4, pitchRatio: 0.7, chordMax: 14, ccw });
            expect(signedVolume(one)).toBeGreaterThan(5);
            expect(signedVolume(insideOut(one))).toBeLessThan(0); // control
            const three = propeller({ diameter: 129.5, blades: 3, hubRadius: 4, pitchRatio: 0.7, chordMax: 14, ccw });
            expect(problemsOf(three)).toEqual([]);
            expect(near(signedVolume(three), 3 * signedVolume(one), 1e-6)).toBe(true);
            const bb = boundsOf(three);
            const tip = Math.max(...Array.from({ length: three.positions.length / 3 }, (_, i) => Math.hypot(three.positions[i * 3], three.positions[i * 3 + 2])));
            expect(Math.abs(tip - 64.75)).toBeLessThan(0.7);
            // thin: a 5-inch propeller with this pitch stands under 8 per cent of its diameter high
            expect(bb.max[1] - bb.min[1]).toBeLessThan(0.08 * 129.5);
        }
    });
    it('the counter-clockwise blade is the mirror image of the clockwise one', () => {
        const cw = propeller({ diameter: 56, blades: 3, hubRadius: 3, pitchRatio: 0.8 });
        const ccw = propeller({ diameter: 56, blades: 3, hubRadius: 3, pitchRatio: 0.8, ccw: true });
        const mirrored = transformed(cw, scaleBy(1, 1, -1));
        expect(near(signedVolume(mirrored), signedVolume(ccw), 1e-6)).toBe(true);
        expect(near(surfaceArea(mirrored), surfaceArea(ccw), 1e-6)).toBe(true);
        // the two differ (a pitch of the wrong hand would be the same mesh)
        expect(JSON.stringify(cw.positions.slice(0, 30))).not.toEqual(JSON.stringify(ccw.positions.slice(0, 30)));
    });
    it('more pitch twists the blade more (the trailing edge rises)', () => {
        const flat = boundsOf(propeller({ diameter: 56, blades: 2, hubRadius: 3, pitchRatio: 0.3 }));
        const steep = boundsOf(propeller({ diameter: 56, blades: 2, hubRadius: 3, pitchRatio: 1.2 }));
        expect(steep.max[1] - steep.min[1]).toBeGreaterThan(flat.max[1] - flat.min[1]);
    });
});

describe('transforms', () => {
    it('a mirror keeps a closed shape facing outwards (volume stays positive)', () => {
        const box = roundedBox(10, 6, 8, { radius: 1 });
        const mirrored = transformed(box, scaleBy(-1, 1, 1));
        expect(near(signedVolume(mirrored), signedVolume(box), 1e-9)).toBe(true);
        expect(problemsOf(mirrored)).toEqual([]);
    });
    it('placed: rotation and position move the bounds as expected, normals stay unit', () => {
        const rod = cylinder(1, 10, { segments: 24 });
        const m = placed(rod, { at: [5, 0, 0], rot: [0, 0, 90] });
        const bb = boundsOf(m);
        expect(bb.min[0]).toBeCloseTo(0, 6);
        expect(bb.max[0]).toBeCloseTo(10, 6);
        expect(problemsOf(m)).toEqual([]);
        expect(signedVolume(m)).toBeCloseTo(signedVolume(rod), 6);
    });
    it('a non-uniform scale keeps unit normals', () => {
        const m = placed(sphere(3), { scale: [2, 1, 0.5] });
        expect(problemsOf(m)).toEqual([]);
    });
    it('lathe: a sharp corner keeps two normals, a smooth one shares one', () => {
        const sharp = lathe([[0, 0], [2, 0], [2, 2], [0, 2]], { segments: 8 });
        const smooth = lathe([[0, 0], [2, 0], [2.2, 1], [2.1, 2]], { segments: 8, smooth: 80 });
        const top = (m: MeshData): number => m.normals.filter((_, i) => i % 3 === 1).filter((y) => Math.abs(y) > 0.99).length;
        expect(top(sharp)).toBeGreaterThan(0);
        expect(top(smooth)).toBeLessThan(top(sharp));
    });
});
