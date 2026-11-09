// v0.13 lane v13-look L1-3 (docs/wip/v13-look.md; plan M41-23): the look of the lesson worlds on paper, before the page
// (apps/fly/src/sonic/look.ts; the page measures the same on its own pictures: tools/bench/src/v13-look-page.ts look).
//   - low vision: the luminance the look gives every surface (albedo x the baked hemisphere-and-sun light x the pattern's
//     mean) keeps 3:1 (WCAG) between the floor and every wall orientation, the floor's bright squares and the darkest wall,
//     and every obstacle (its mean over all its normals) and the lightest wall, the floor and the ceiling;
//   - the patterns (blocks, checker) are the same every time and tile (a joint on every edge);
//   - the room's mesh: every quad lies on the hollow's boundary, its normal points into the hollow (free air 5 cm along it),
//     and its triangles are wound counter-clockwise seen from there (PlayCanvas' front face); control in the test: the
//     triangles reversed are caught;
//   - an object's baked light follows its rotation (a box turned a quarter turn about x lights its top face as a side).
import { describe, expect, it } from 'vitest';
import { getLesson } from '../../../packages/sonic-fpv/src';
import { MIN_CONTRAST, OBJECT_LIGHT, ROOM_LIGHT, blockPattern, checkerPattern, lightAt, lookContrast, objectColors, roomMesh } from '../../../apps/fly/src/sonic/look';
import type { RoomQuad } from '../../../apps/fly/src/sonic/look';
import { roomPrims } from '../../../apps/fly/src/sonic/primitives';
import { lessonViewWorld } from '../../../apps/fly/src/sonic/lesson-world';

describe('the look on paper (M41-23)', () => {
    it(`low vision: floor against walls, and every obstacle against walls, floor and ceiling, ${MIN_CONTRAST}:1 or more`, () => {
        const c = lookContrast();
        console.log(`sonic-look: ${JSON.stringify(c)}`);
        expect(c.floorWall).toBeGreaterThanOrEqual(MIN_CONTRAST);
        expect(c.floorSquareWall).toBeGreaterThanOrEqual(MIN_CONTRAST);
        for (const v of Object.values(c.obstacles)) expect(v).toBeGreaterThanOrEqual(MIN_CONTRAST);
    });

    it('the patterns are the same every time and tile: a joint on the texture\'s edges, the means as designed', () => {
        for (const make of [blockPattern, checkerPattern]) {
            const a = make(), b = make();
            expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
            const px = a.px;
            // row 0 and column 0 are joints (the darkest value of the pattern but the bevels)
            for (let x = 0; x < px; x++) expect(a.data[x * 4]).toBe(a.data[0]);
            for (let y = 0; y < px; y++) expect(a.data[y * px * 4]).toBe(a.data[0]);
        }
        expect(blockPattern().mean).toBeGreaterThan(0.85);
        expect(blockPattern().mean).toBeLessThan(0.95);
        expect(checkerPattern().mean).toBeGreaterThan(0.7);
        expect(checkerPattern().mean).toBeLessThan(0.8);
    });

    /** Per quad: on the boundary, free air along its normal, and each triangle's own normal along it. */
    function quadChecks(id: string, reverse = false): { quads: number; onBoundary: number; freeAlong: number; woundRight: number } {
        const world = lessonViewWorld(getLesson(id))!;
        const quads: RoomQuad[] = roomPrims(world).map((p) => ({ pos: p.pos, size: p.size, facing: p.facing! }));
        const m = roomMesh(quads);
        let onBoundary = 0, freeAlong = 0, woundRight = 0;
        for (let q = 0; q < quads.length; q++) {
            const f = quads[q]!.facing;
            // the quad's centre: the mean of its four corners
            const c = [0, 1, 2].map((a) => (m.positions[q * 12 + a]! + m.positions[q * 12 + 3 + a]! + m.positions[q * 12 + 6 + a]! + m.positions[q * 12 + 9 + a]!) / 4);
            if (Math.abs(world.sdf(c[0]!, c[1]!, c[2]!)) < 1e-3) onBoundary++;
            if (world.sdf(c[0]! + f[0] * 0.05, c[1]! + f[1] * 0.05, c[2]! + f[2] * 0.05) > 0.04) freeAlong++;
            let ok = true;
            for (let t = 0; t < 2; t++) {
                const idx = [0, 1, 2].map((k) => m.indices[q * 6 + t * 3 + k]!);
                const [i0, i1, i2] = reverse ? [idx[0]!, idx[2]!, idx[1]!] : [idx[0]!, idx[1]!, idx[2]!];
                const p = (i: number): number[] => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
                const a = p(i0), b = p(i1), d = p(i2);
                const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
                const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
                if (n[0]! * f[0] + n[1]! * f[1] + n[2]! * f[2] <= 0) ok = false;
            }
            if (ok) woundRight++;
        }
        return { quads: quads.length, onBoundary, freeAlong, woundRight };
    }

    for (const id of ['walls-hall', 'corridor', 'tunnel-gaps', 'tunnel-long', 'hover-height']) {
        it(`${id}: every quad of the room on the hollow's boundary, facing into it, wound counter-clockwise from inside`, () => {
            const r = quadChecks(id);
            expect(r.quads).toBeGreaterThan(0);
            expect(r.onBoundary).toBe(r.quads);
            expect(r.freeAlong).toBe(r.quads);
            expect(r.woundRight).toBe(r.quads);
        });
    }

    it('control: the triangles reversed are caught as wound the wrong way', () => {
        const r = quadChecks('walls-hall', true);
        expect(r.woundRight).toBe(0);
    });

    it('the light is baked by the world normal: floors lit most, ceilings least; an object turned a quarter turn lights its top face as a side', () => {
        expect(lightAt([0, 1, 0], ROOM_LIGHT)).toBeGreaterThan(lightAt([1, 0, 0], ROOM_LIGHT));
        expect(lightAt([1, 0, 0], ROOM_LIGHT)).toBeGreaterThan(lightAt([0, -1, 0], ROOM_LIGHT));
        // a box's local +y face turned +90 degrees about x faces world +z
        const q: [number, number, number, number] = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0, 0];
        const c = objectColors([0, 1, 0], q);
        expect(c[0]).toBeCloseTo(lightAt([0, 0, 1], OBJECT_LIGHT), 6);
        expect(c[0]).not.toBeCloseTo(lightAt([0, 1, 0], OBJECT_LIGHT), 3);
    });
});
