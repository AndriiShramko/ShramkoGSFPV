// Lane n-save S2 (the owner's wish 1 of 2026-11-20: "in one click fix it all automatically, move them to the right
// places"; t7-plan Part C 5): fixAll moves every offending gate the shortest way to a valid place, keeps the order, and
// names what it could not repair. On threeRooms (room A, 10 x 5 x 10 m, solid all round): a gate in a wall, two gates on
// one spot, a gate under the ground. Controls: a clean course is left as it is; a blocked start is named, never moved.
import { describe, expect, it } from 'vitest';
import type { TrackFile } from '@shramko/sonic-fpv';
import { APART_GAP_M, SAME_PLACE_M, fixAll, upgradeTrack, wallsCheck, yawQuatStep } from '../src';
import type { Course, FixWalls } from '../src';
import { IDENTITY, threeRooms } from './worlds';

type V3 = [number, number, number];
const walls = threeRooms();
const margin = 0.5;
const w: FixWalls = { col: walls, transform: IDENTITY, margin };
const check = wallsCheck(walls, IDENTITY, margin);
/** a ring 1.2 m passed toward +x (yawQuatStep(4): 90 degrees right of -z) */
const gate = (id: string, pos: V3) => ({ id, shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos, quat: yawQuatStep(4), direction: 'forward' });
const course = (gates: ReturnType<typeof gate>[], start: V3 = [1.5, 2.5, 5]): Course =>
    upgradeTrack({
        format: 'shramko-sonic-track/1', id: '0000aaaa-00000001', version: 1, parent: null, title: 'Fix me',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0], gates, laps: 1,
        start: { pos: start, yawDeg: 90 }, author: { kind: 'generator', name: 'gsfpv-course' },
        generator: { name: 'gsfpv-course', version: '1', seed: 1, params: {} }, created: '2026-11-20T00:00:00Z'
    } as unknown as TrackFile);
/** a clean row through room A along +x */
const row = (): ReturnType<typeof gate>[] => [gate('g1', [3, 2.5, 5]), gate('g2', [5.5, 2.5, 5]), gate('g3', [8, 2.5, 5])];
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('n-save S2: fixAll', () => {
    it('control: a clean course is left as it is (no move, nothing left)', () => {
        const c = course(row());
        expect(check(c)).toEqual([]);
        const r = fixAll(c, w, 'medium');
        expect(r.moves).toEqual([]);
        expect(r.leftovers).toEqual([]);
        expect(r.course).toBe(c);
    });

    it('a gate in a wall goes the short way out into the room, turned along its leg; the rest stays', () => {
        // g2 in the room's far wall (z 10 to 10.4)
        const c = course([gate('g1', [3, 2.5, 5]), gate('g2', [5.5, 2.5, 10.2]), gate('g3', [8, 2.5, 5])]);
        expect(check(c).some((p) => p.code === 'gate-wall' && p.gate === 'g2')).toBe(true);
        const r = fixAll(c, w, 'medium');
        expect(r.moves.map((m) => m.id)).toContain('g2');
        const m = r.moves.find((x) => x.id === 'g2')!;
        expect(m.kinds).toContain('in-scan');
        expect(m.before.pos).toEqual([5.5, 2.5, 10.2]);
        // out of the wall by the clearance its size needs: 0.6 m half opening + 0.08 m tube + 0.5 m margin, and not much more
        expect(m.after.pos[2]).toBeLessThan(10 - 0.6 - 0.08 - margin + 1e-6);
        expect(m.movedM).toBeLessThan(3);
        expect(r.course.gates.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
        expect(r.course.gates[0]).toEqual(c.gates[0]);
        expect(check(r.course)).toEqual([]);
        expect(r.leftovers).toEqual([]);
    });

    it(`two gates on one spot: the later one moves apart (at least the openings' half plus ${APART_GAP_M} m), the earlier stays`, () => {
        const c = course([gate('g1', [3, 2.5, 5]), gate('g2', [5.5, 2.5, 5]), gate('g3', [5.6, 2.5, 5])]);
        const r = fixAll(c, w, 'medium');
        expect(r.moves.map((m) => m.id)).toEqual(['g3']);
        expect(r.moves[0]!.kinds).toContain('same-place');
        expect(dist(c.gates[1]!.pos, c.gates[2]!.pos)).toBeLessThan(SAME_PLACE_M);
        expect(dist(r.course.gates[1]!.pos, r.course.gates[2]!.pos)).toBeGreaterThanOrEqual(1.2 + APART_GAP_M - 1e-6);
        expect(r.course.gates[1]).toEqual(c.gates[1]);
        expect(r.leftovers.filter((x) => x.kind === 'same-place' || x.kind === 'too-close')).toEqual([]);
    });

    it('a gate under the ground is lifted straight up, just enough', () => {
        const c = course([gate('g1', [3, 2.5, 5]), gate('g2', [5.5, -0.2, 5]), gate('g3', [8, 2.5, 5])]);
        const r = fixAll(c, w, 'medium');
        const m = r.moves.find((x) => x.id === 'g2')!;
        expect(m.kinds).toContain('under-ground');
        expect([m.after.pos[0], m.after.pos[2]]).toEqual([5.5, 5]);
        expect(m.after.pos[1]).toBeGreaterThan(0.6 + 0.08 + margin);
        expect(m.after.pos[1]).toBeLessThan(2.5);
        expect(r.leftovers.filter((x) => x.gates.includes('g2'))).toEqual([]);
    });

    it('all three at once in one call: order and ids kept, deterministic, nothing left', { timeout: 30000 }, () => {
        const messy = course([gate('g1', [3, -0.2, 5]), gate('g2', [5.5, 2.5, 10.2]), gate('g3', [5.55, 2.5, 10.2]), gate('g4', [8, 2.5, 5])]);
        const a = fixAll(messy, w, 'medium');
        const b = fixAll(messy, w, 'medium');
        expect(a).toEqual(b);
        // g4 had nothing wrong; its leg in changed with g3's place, so it is turned where it stands
        expect(a.moves.map((m) => m.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
        expect(a.moves[3]).toMatchObject({ movedM: 0, kinds: ['wrong-way'], after: { pos: [8, 2.5, 5] } });
        expect(a.course.gates.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
        expect(a.leftovers).toEqual([]);
        expect(check(a.course)).toEqual([]);
    });

    it('a gate passed the wrong way is turned where it stands', () => {
        const turned = { ...gate('g2', [6.5, 2.5, 5]), quat: yawQuatStep(12) };
        const c = course([gate('g1', [3, 2.5, 5]), turned, gate('g3', [8.5, 2.5, 5])]);
        expect(check(c).some((p) => p.code === 'gate-direction')).toBe(true);
        const r = fixAll(c, w, 'medium');
        expect(r.moves).toHaveLength(1);
        expect(r.moves[0]!.after.pos).toEqual([6.5, 2.5, 5]);
        expect(r.moves[0]!.turnedDeg).toBeGreaterThan(90);
        expect(check(r.course)).toEqual([]);
    });

    it('only: the editor\'s Fix of one gate repairs that gate alone', () => {
        const c = course([gate('g1', [3, -0.2, 5]), gate('g2', [5.5, 2.5, 10.2]), gate('g3', [8, 2.5, 5])]);
        const r = fixAll(c, w, 'medium', { only: 1 });
        expect(r.moves.map((m) => m.id)).toEqual(['g2']);
        expect(r.leftovers).toContainEqual({ kind: 'under-ground', gates: ['g1'] });
    });

    it('what cannot be repaired is named: a blocked start stays where it is', () => {
        const c = course(row(), [-0.2, 2.5, 5]);
        const r = fixAll(c, w, 'medium');
        expect(r.course.start).toEqual(c.start);
        expect(r.leftovers).toContainEqual({ kind: 'blocked-start', gates: [] });
    });
});
