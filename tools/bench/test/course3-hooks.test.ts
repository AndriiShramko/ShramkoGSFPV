// Lane course3 F2: the hooks lane editor3 asked for. (1) EditAction { kind: 'add', pos, quat } lays a gate after the
// selected one at that pose; (2) metadataOf comes from a module without side effects (course/grid.ts: importing it in
// Node runs no worker code).
import { describe, expect, it } from 'vitest';
import { MAX_GATES_EDIT, edit, freeSpace, generateCourse, openEditor, upgradeTrack } from '@gsfpv/tracks';
import type { CourseCheck, EditAction } from '@gsfpv/tracks';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import { metadataOf } from '../../../apps/fly/src/course/grid';

const walls = threeRooms();
const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
const course = upgradeTrack(track);
const off: CourseCheck = () => [];

describe('course3 hooks for lane editor3', () => {
    it("'add' puts a gate after the selected one at the given pose and selects it", () => {
        const s = openEditor(course, off, 1);
        const pos: [number, number, number] = [1.23449, 1.5, -2.0004];
        const quat: [number, number, number, number] = [0.70710678, 0, -0.70710678, 0];
        const action: EditAction = { kind: 'add', pos, quat };
        const o = edit(s, action, off);
        expect(o.ok).toBe(true);
        if (!o.ok) return;
        const gs = o.state.course.gates;
        expect(gs.length).toBe(course.gates.length + 1);
        expect(o.state.selected).toBe(2);
        expect(gs[2]!.pos).toEqual([1.234, 1.5, -2]);
        expect(gs[2]!.quat).toEqual([0.707107, 0, -0.707107, 0]);
        expect(gs[2]!.shape).toEqual(course.gates[1]!.shape);
        expect(new Set(gs.map((g) => g.id)).size).toBe(gs.length);
        expect(gs[3]).toEqual(course.gates[2]);
        expect(o.state.undo.length).toBe(1);
    });

    it("'add' is refused on a full course and when the check finds a new problem", () => {
        let full = openEditor(course, off, 0);
        while (full.course.gates.length < MAX_GATES_EDIT) {
            const o = edit(full, { kind: 'insert' }, off);
            if (!o.ok) throw new Error('insert refused');
            full = o.state;
        }
        const a: EditAction = { kind: 'add', pos: [0, 1, 0], quat: [1, 0, 0, 0] };
        const o = edit(full, a, off);
        expect(o.ok).toBe(false);
        if (!o.ok) expect(o.reason.code).toBe('max-gates');
        const bad: CourseCheck = (c) => (c.gates.length > course.gates.length ? [{ code: 'gate-wall', gate: 'x' } as never] : []);
        const o2 = edit(openEditor(course, bad), a, bad);
        expect(o2.ok).toBe(false);
    });

    it('metadataOf gives the octree header from the grid without running a worker', () => {
        const m = metadataOf({ flip: false, min: [-1, 0, 2], res: 0.05, n: [64, 32, 16], leafSize: 4, treeDepth: 5 }, 100, 40);
        expect(m.version).toBe('1.1');
        expect(m.gridBounds.min).toEqual([-1, 0, 2]);
        expect(m.gridBounds.max.map((v) => Math.round(v * 1000) / 1000)).toEqual([2.2, 1.6, 2.8]);
        expect(m.numMixedLeaves).toBe(20);
        expect(m.nodeCount).toBe(100);
        expect(m.leafDataCount).toBe(40);
        expect(metadataOf({ flip: true, min: [0, 0, 0], res: 1, n: [1, 1, 1], leafSize: 4, treeDepth: 1 }, 0, 0).version).toBe('1.0');
    });
});
