// Lane editor3, stage E3-panel-and-flying (docs/wip/editor3.md "The design"): a gate added by a click on the place, the
// panel's Duplicate and the top bar's Undo and Redo as editor keys, and flying with the controller inside the edit mode
// (armed: the drone flies the course, no pause, no lap clock; disarmed or crashed: the edit view again).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit } from '@gsfpv/tracks';
import type { Course, CourseCheck, EditorState } from '@gsfpv/tracks';
import { ADD_AHEAD_M, ADD_BACK_M, ADD_MIN_M, addInState, addPoint, facingFrom, freeGateId } from '../../../apps/fly/src/course/editor/add-place';
import { editModeOf, flyShows, modeStep } from '../../../apps/fly/src/course/editor/fly-mode';
import { BAR_BUTTONS, TOP_BUTTONS } from '../../../apps/fly/src/course/editor/bar-place';
import { editorKey, forwardOf } from '../../../apps/fly/src/course/editor/keys';

const COURSE_TS = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');

type Gate = Course['gates'][number];
const ring = (d: number): Gate['shape'] => ({ kind: 'ring', diameter: d, tube: 0.05 });
const square = (d: number): Gate['shape'] => ({ kind: 'square', side: d, bar: 0.05 });
const gate = (id: string, pos: [number, number, number], shape = ring(1.2)): Gate => ({ id, shape, pos, quat: [1, 0, 0, 0], direction: 'forward' });
const keep: CourseCheck = () => [];
// a scan flown at twice its size, moved by (10, 0, -5)
const TR = [2, 10, 0, -5] as const;

function stateOf(gates: Gate[], selected = 0): EditorState {
    const course = { gates, transform: [2, 10, 0, -5] } as unknown as Course;
    return { course, selected, undo: [], redo: [], problems: [] };
}

describe('editor3 E3: a gate added by a click on the place', () => {
    it('stands in front of the wall the click hit, ahead on open sky, never at the eye', () => {
        expect(addPoint([0, 1, 0], [0, 0, -1], 10)).toEqual([0, 1, -(10 - ADD_BACK_M)]);
        expect(addPoint([0, 1, 0], [1, 0, 0], null)).toEqual([ADD_AHEAD_M, 1, 0]);
        expect(addPoint([0, 1, 0], [0, 0, -1], 1.2)).toEqual([0, 1, -ADD_MIN_M]);
    });

    it('faces the camera: the way through the gate is the way from the eye to it', () => {
        for (const at of [[0, 0, -5], [5, 2, 0], [-3, 0, 4], [2, -1, -2]] as const) {
            const q = facingFrom([0, 0, 0], at);
            const f = forwardOf(q[0], q[1], q[2], q[3]);
            const h = Math.hypot(at[0], at[2]);
            expect(f[0]).toBeCloseTo(at[0] / h, 6);
            expect(f[1]).toBeCloseTo(at[2] / h, 6);
            expect(Math.hypot(...q)).toBeCloseTo(1, 9);
        }
    });

    it('goes after the selected gate as a copy of its kind and opening, selected, one undo step', () => {
        const st = stateOf([gate('g1', [0, 0, 0], square(1.5)), gate('g2', [5, 0, 0]), gate('g3', [9, 0, 0])], 0);
        const q = facingFrom([10, 2, -5], [14, 2, -5]);
        const out = addInState(st, [14, 2, -5], q, TR, keep)!;
        expect(out.course.gates.map((g) => g.id)).toEqual(['g1', 'g4', 'g2', 'g3']);
        expect(out.selected).toBe(1);
        const g = out.course.gates[1]!;
        // flown (14, 2, -5) is scan ((14 - 10) / 2, 2 / 2, 0)
        expect(g.pos).toEqual([2, 1, 0]);
        expect(g.shape).toEqual(square(1.5));
        expect(out.undo.length).toBe(1);
        expect(out.redo.length).toBe(0);
        const back = edit(out, { kind: 'undo' }, keep);
        expect(back.state.course.gates.map((x) => x.id)).toEqual(['g1', 'g2', 'g3']);
        const again = edit(back.state, { kind: 'redo' }, keep);
        expect(again.state.course.gates.length).toBe(4);
    });

    it('a new id never repeats one in the course', () => {
        expect(freeGateId([gate('g1', [0, 0, 0]), gate('g7', [0, 0, 0]), gate('x', [0, 0, 0])])).toBe('g8');
    });
});

describe('editor3 E3: the panel and the top bar run editor keys', () => {
    it('Duplicate copies the selected gate after it (same kind and opening)', () => {
        const dup = BAR_BUTTONS.find((b) => b.id === 'duplicate');
        expect(dup).toBeDefined();
        const k = editorKey(dup!.press, [0, -1]);
        expect(k && 'edit' in k ? k.edit.kind : null).toBe('insert');
        const st = stateOf([gate('g1', [0, 0, 0], square(1.5)), gate('g2', [5, 0, 0])], 0);
        const out = edit(st, (k as { edit: Parameters<typeof edit>[1] }).edit, keep);
        expect(out.ok).toBe(true);
        expect(out.state.course.gates.length).toBe(3);
        expect(out.state.course.gates[1]!.shape).toEqual(square(1.5));
    });

    it('the top bar has Add gate, Undo, Redo and Exit; its keys undo, redo and leave', () => {
        expect(TOP_BUTTONS.map((b) => b.id)).toEqual(['add', 'undo', 'redo', 'exit']);
        const keyOf = (id: string): unknown => {
            const p = TOP_BUTTONS.find((b) => b.id === id)!.press;
            return p === 'add' ? 'add' : editorKey(p, [0, -1]);
        };
        expect(keyOf('undo')).toEqual({ edit: { kind: 'undo' } });
        expect(keyOf('redo')).toEqual({ edit: { kind: 'redo' } });
        expect(keyOf('exit')).toEqual({ cmd: 'exit' });
    });
});

describe('editor3 E3: flying inside the edit mode', () => {
    it('armed flies, disarmed or crashed edits', () => {
        expect(editModeOf(true, false)).toBe('fly');
        expect(editModeOf(false, false)).toBe('edit');
        expect(editModeOf(true, true)).toBe('edit');
        expect(modeStep('edit', true, false)).toEqual({ mode: 'fly', change: 'to-fly' });
        expect(modeStep('fly', true, false)).toEqual({ mode: 'fly', change: null });
        expect(modeStep('fly', false, false)).toEqual({ mode: 'edit', change: 'to-edit' });
        expect(modeStep('fly', true, true)).toEqual({ mode: 'edit', change: 'to-edit' });
    });

    it('the lap clock and the best lap stay off while editing, the next gate lights up', () => {
        expect(flyShows(true)).toEqual({ nextGate: true, lapClock: false, writeBest: false });
        expect(flyShows(false)).toEqual({ nextGate: true, lapClock: true, writeBest: true });
    });

    it('the page does not pause the flight for the editor and gives the keys to the flight while armed', () => {
        expect(COURSE_TS).not.toMatch(/ctx\.pause\('panel'\)/);
        expect(COURSE_TS).toMatch(/ctx\.keys\.block\(\(\) => ed !== null && mode === 'edit'\)/);
        expect(COURSE_TS).toMatch(/if \(ed\) return editFrame\(\);/);
        expect(COURSE_TS).toMatch(/modeStep\(mode, !!sim\?\.armed, !!sim\?\.crashed\)/);
        expect(COURSE_TS).toMatch(/if \(shows\.lapClock\) hud\.update/);
        expect(COURSE_TS).toMatch(/onPlace: \(ray\) => placeAt\(ray\)/);
    });
});
