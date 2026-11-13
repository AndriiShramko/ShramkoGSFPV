// Lane tracks, train 2, stage T2-editor-core: the editing model (tracks-plan 2.11). An edit that moves a gate into a wall is
// refused with a reason the page can say; control: the check switched off lets the same edit through. Select, move, turn,
// dive, kind, size, insert, delete, order, undo and redo on a generated course in analytic rooms.
import { describe, expect, it } from 'vitest';
import { quatRotate } from '@shramko/sonic-fpv';
import { INSERT_AHEAD_M, MAX_OPENING_M, MIN_GATES, MIN_OPENING_M, canSave, edit, freeSpace, generateCourse, openEditor, upgradeTrack, wallsCheck } from '../src';
import type { CourseCheck, EditAction, EditOutcome, EditorState } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const walls = threeRooms();
const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
const course = upgradeTrack(track);
const check = wallsCheck(walls, IDENTITY);
const off: CourseCheck = () => [];
const must = (o: EditOutcome): EditorState => {
    if (!o.ok) throw new Error(`refused: ${JSON.stringify(o.reason)}`);
    return o.state;
};
const run = (s: EditorState, actions: EditAction[], c: CourseCheck = off): EditorState => actions.reduce((st, a) => must(edit(st, a, c)), s);
const close = (a: readonly number[], b: readonly number[], eps = 1e-5): boolean => a.every((x, i) => Math.abs(x - b[i]!) <= eps);
/** the same turn: q and -q (the editor writes w >= 0, the generator's table may not) */
const sameTurn = (a: readonly number[], b: readonly number[]): boolean => close(a, b) || close(a, b.map((x) => -x));

describe('the course editor', () => {
    it('opens a generated course with no problem: it can be saved as it is', () => {
        const s = openEditor(course, check);
        expect(course.gates.length).toBeGreaterThan(3);
        expect(s.problems).toEqual([]);
        expect(canSave(s)).toBe(true);
    });

    it('refuses a move into the floor with the reason; control: the check switched off lets it through', () => {
        const s = openEditor(course, check);
        const g = course.gates[0]!;
        const down: EditAction = { kind: 'move', axis: 1, steps: -Math.round(g.pos[1] / 0.1) };
        const o = edit(s, down, check);
        expect(o.ok).toBe(false);
        if (o.ok) return;
        expect(o.reason.code).toBe('placement');
        expect(o.state).toBe(s);
        const named = o.reason.code === 'placement' ? o.reason.problems.map((p) => JSON.stringify(p)).join(' ') : '';
        expect(named).toContain(g.id);
        const loose = edit(openEditor(course, off), down, off);
        expect(loose.ok).toBe(true);
    });

    it('a step move, undo and redo', () => {
        const s0 = openEditor(course, check);
        const s1 = must(edit(s0, { kind: 'move', axis: 0, steps: 1 }, check));
        expect(s1.course.gates[0]!.pos[0]).toBeCloseTo(course.gates[0]!.pos[0] + 0.1, 6);
        const s2 = must(edit(s1, { kind: 'undo' }, check));
        expect(s2.course).toBe(course);
        const s3 = must(edit(s2, { kind: 'redo' }, check));
        expect(s3.course).toBe(s1.course);
        expect(edit(s3, { kind: 'redo' }, check)).toMatchObject({ ok: false, reason: { code: 'nothing-to-redo' } });
        expect(edit(s0, { kind: 'undo' }, check)).toMatchObject({ ok: false, reason: { code: 'nothing-to-undo' } });
    });

    it('selects gates around the course', () => {
        const n = course.gates.length;
        const s = openEditor(course, off);
        expect(must(edit(s, { kind: 'select-step', step: -1 }, off)).selected).toBe(n - 1);
        expect(must(edit(s, { kind: 'select', index: 2 }, off)).selected).toBe(2);
        expect(must(edit(s, { kind: 'select', index: 99 }, off)).selected).toBe(n - 1);
    });

    it('turns: 24 steps of 15 degrees come back; a dive gate is passed downward and turns back level', () => {
        const q0 = course.gates[0]!.quat;
        const s = openEditor(course, off);
        const turned = run(s, Array.from({ length: 24 }, () => ({ kind: 'turn', steps: 1 }) as EditAction));
        expect(sameTurn(turned.course.gates[0]!.quat, q0)).toBe(true);
        const one = run(s, [{ kind: 'turn', steps: 6 }]);
        expect(close(quatRotate(one.course.gates[0]!.quat, [0, 1, 0]), [0, 1, 0])).toBe(true);
        const dive = run(s, [{ kind: 'dive' }]);
        expect(close(quatRotate(dive.course.gates[0]!.quat, [0, 0, -1]), [0, -1, 0])).toBe(true);
        const level = run(dive, [{ kind: 'dive' }]);
        expect(sameTurn(level.course.gates[0]!.quat, q0)).toBe(true);
    });

    it('changes the kind keeping the opening, and the size within its bounds', () => {
        const s = openEditor(course, off);
        const g = course.gates[0]!;
        const opening = g.shape.kind === 'ring' ? g.shape.diameter : g.shape.kind === 'square' ? g.shape.side : 0;
        const other = g.shape.kind === 'ring' ? 'square' : 'ring';
        const k = run(s, [{ kind: 'shape', to: other }]).course.gates[0]!.shape;
        expect(k.kind).toBe(other);
        expect(k.kind === 'ring' ? k.diameter : k.kind === 'square' ? k.side : 0).toBe(opening);
        expect(edit(s, { kind: 'shape', to: g.shape.kind as 'ring' }, off)).toMatchObject({ ok: false, reason: { code: 'same' } });
        const big = run(s, [{ kind: 'size', steps: 3 }]).course.gates[0]!.shape;
        expect(big.kind === 'ring' ? big.diameter : big.kind === 'square' ? big.side : 0).toBeCloseTo(opening + 0.3, 6);
        const tooSmall = Math.ceil((opening - MIN_OPENING_M) / 0.1) + 1;
        expect(edit(s, { kind: 'size', steps: -tooSmall }, off)).toMatchObject({ ok: false, reason: { code: 'size-min' } });
        expect(edit(s, { kind: 'size', steps: Math.ceil(MAX_OPENING_M / 0.1) }, off)).toMatchObject({ ok: false, reason: { code: 'size-max' } });
    });

    it('inserts a gate after the selected one, ahead along its axis, under a new id; deletes down to the least', () => {
        const s = openEditor(course, off, 1);
        const g = course.gates[1]!;
        const ins = run(s, [{ kind: 'insert' }]);
        expect(ins.course.gates.length).toBe(course.gates.length + 1);
        expect(ins.selected).toBe(2);
        const added = ins.course.gates[2]!;
        expect(new Set(ins.course.gates.map((x) => x.id)).size).toBe(ins.course.gates.length);
        const ahead = quatRotate(g.quat, [0, 0, -1]);
        expect(close(added.pos, [g.pos[0] + ahead[0] * INSERT_AHEAD_M, g.pos[1] + ahead[1] * INSERT_AHEAD_M, g.pos[2] + ahead[2] * INSERT_AHEAD_M], 1e-3)).toBe(true);
        let d = s;
        for (let i = course.gates.length; i > MIN_GATES; i--) d = run(d, [{ kind: 'delete' }]);
        expect(d.course.gates.length).toBe(MIN_GATES);
        expect(edit(d, { kind: 'delete' }, off)).toMatchObject({ ok: false, reason: { code: 'min-gates' } });
    });

    it('reorders the selected gate and refuses past the ends', () => {
        const s = openEditor(course, off);
        const o = run(s, [{ kind: 'order', step: 1 }]);
        expect(o.course.gates.map((x) => x.id).slice(0, 2)).toEqual([course.gates[1]!.id, course.gates[0]!.id]);
        expect(o.selected).toBe(1);
        expect(edit(s, { kind: 'order', step: -1 }, off)).toMatchObject({ ok: false, reason: { code: 'order-edge' } });
    });

    it('a problem the course already has does not block other edits, and blocks saving', () => {
        const g = course.gates[0]!;
        const broken = run(openEditor(course, off), [{ kind: 'move', axis: 1, steps: -Math.round(g.pos[1] / 0.1) }]).course;
        const s = openEditor(broken, check, 2);
        expect(s.problems.length).toBeGreaterThan(0);
        expect(canSave(s)).toBe(false);
        const moved = edit(s, { kind: 'move', axis: 0, steps: 1 }, check);
        expect(moved.ok).toBe(true);
        // control: on the sound course the same gate's fall is refused (the first test), so the pass here is the rule
        expect(edit(openEditor(course, check), { kind: 'move', axis: 1, steps: -Math.round(g.pos[1] / 0.1) }, check).ok).toBe(false);
    });
});
