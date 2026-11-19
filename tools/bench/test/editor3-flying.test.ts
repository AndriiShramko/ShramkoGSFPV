// Lane editor3, stage E3-panel-and-flying (docs/wip/editor3.md "The design"): a gate added by a click on the place, the
// panel's Duplicate and the top bar's Undo and Redo as editor keys, and flying with the controller inside the edit mode
// (armed: the drone flies the course, no pause, no lap clock; disarmed or crashed: the edit view again).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit } from '@gsfpv/tracks';
import type { Course, CourseCheck, EditorState } from '@gsfpv/tracks';
import { ADD_AHEAD_M, ADD_BACK_M, ADD_FLOOR_M, ADD_MIN_M, addAction, addLift, addPoint, facingFrom } from '../../../apps/fly/src/course/editor/add-place';
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

    it('review ED-4: a click down on the floor puts the gate above the spot, its lower edge ADD_FLOOR_M over the floor', () => {
        // eye 2 m up, a click 20 degrees down hits the floor (y 0)
        const a = (20 * Math.PI) / 180;
        const dir: [number, number, number] = [0, -Math.sin(a), -Math.cos(a)];
        const hit = 2 / Math.sin(a);
        const opening = 1.2 * TR[0];
        const p = addPoint([0, 2, 0], dir, hit, addLift(stateOf([gate('g1', [0, 0, 0])]), TR));
        // the centre is half the opening plus the clearance above the floor: the gate's lower edge is in the air
        // G2: plus the frame (tube 0.05 scan m, flown at TR[0]); no check margin is passed here
        expect(p[1]).toBeCloseTo(opening / 2 + 0.05 * TR[0] + ADD_FLOOR_M, 6);
        expect(p[1] - opening / 2).toBeGreaterThan(0);
        // pulled back along the floor by ADD_BACK_M towards the eye, not into it
        expect(p[2]).toBeCloseTo(-(hit * Math.cos(a)) + ADD_BACK_M, 6);
        expect(p[0]).toBeCloseTo(0, 9);
        // a level click on a wall keeps the old rule
        expect(addPoint([0, 1, 0], [0, 0, -1], 10, 2)).toEqual([0, 1, -(10 - ADD_BACK_M)]);
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

    it('goes through the EditAction add of lane course3: after the selected gate, its kind and opening, selected, one undo step', () => {
        const st = stateOf([gate('g1', [0, 0, 0], square(1.5)), gate('g2', [5, 0, 0]), gate('g7', [9, 0, 0])], 0);
        const q = facingFrom([10, 2, -5], [14, 2, -5]);
        const act = addAction([14, 2, -5], q, TR);
        // flown (14, 2, -5) is scan ((14 - 10) / 2, 2 / 2, (-5 + 5) / 2)
        expect(act).toEqual({ kind: 'add', pos: [2, 1, 0], quat: q });
        const out = edit(st, act, keep);
        expect(out.ok).toBe(true);
        const ids = out.state.course.gates.map((g) => g.id);
        expect(ids.length).toBe(4);
        expect(new Set(ids).size).toBe(4);
        expect(out.state.selected).toBe(1);
        const g = out.state.course.gates[1]!;
        expect(g.pos).toEqual([2, 1, 0]);
        expect(g.shape).toEqual(square(1.5));
        expect(out.state.undo.length).toBe(1);
        const back = edit(out.state, { kind: 'undo' }, keep);
        expect(back.state.course.gates.map((x) => x.id)).toEqual(['g1', 'g2', 'g7']);
        const again = edit(back.state, { kind: 'redo' }, keep);
        expect(again.state.course.gates.length).toBe(4);
    });

    it('the page adds through the EditAction and says a refusal; the check worker takes the header from grid.ts; flying is set', () => {
        expect(COURSE_TS).toMatch(/edit\(ed, addAction\(/);
        expect(COURSE_TS).not.toMatch(/addInState/);
        expect(COURSE_TS).toMatch(/flying = true/);
        expect(COURSE_TS).toMatch(/flying = false/);
        const CW = readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/check-worker.ts'), 'utf8');
        expect(CW).toMatch(/from '\.\.\/grid'/);
        expect(CW).not.toMatch(/function metadataOf/);
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
        // review ED-7 added Save, Courses and Keys (tools/bench/test/editor3-fixes.test.ts)
        // lane edit4b: Fly the course and the Course menu (design edit4 1.3)
        expect(TOP_BUTTONS.map((b) => b.id)).toEqual(['add', 'undo', 'redo', 'fly', 'save', 'course', 'exit']);
        const keyOf = (id: string): unknown => {
            const p = TOP_BUTTONS.find((b) => b.id === id)!.press;
            return typeof p === 'string' ? p : editorKey(p, [0, -1]);
        };
        expect(keyOf('undo')).toEqual({ edit: { kind: 'undo' } });
        expect(keyOf('redo')).toEqual({ edit: { kind: 'redo' } });
        expect(keyOf('exit')).toEqual({ cmd: 'exit' });
    });
});

describe('editor3 E3: flying inside the edit mode', () => {
    it('armed flies, disarmed edits', () => {
        expect(editModeOf(true, false)).toBe('fly');
        expect(editModeOf(false, false)).toBe('edit');
        expect(modeStep('edit', true, false)).toMatchObject({ mode: 'fly', change: 'to-fly' });
        expect(modeStep('fly', true, false)).toMatchObject({ mode: 'fly', change: null });
        expect(modeStep('fly', false, false)).toMatchObject({ mode: 'edit', change: 'to-edit' });
    });

    it('review ED-3 (wave 2): after a crash the edit view comes back and stays until a fresh arm', () => {
        // sim.ts: the crash sets armed 0 and crashed 1; the respawn with respawn.keepArmed sets armed 1 and crashed 0
        let mode: 'edit' | 'fly' = 'fly';
        let hold = false;
        const seen: string[] = [];
        const frames: Array<readonly [boolean, boolean]> = [[true, false], [false, true], [false, true], [true, false], [true, false]];
        for (const [armed, crashed] of frames) {
            const st = modeStep(mode, armed, crashed, hold);
            mode = st.mode;
            hold = st.hold;
            seen.push(mode + (st.change ? ':' + st.change : ''));
        }
        // the crash brings the edit view at once; the re-armed respawn does not take it away
        expect(seen).toEqual(['fly', 'edit:to-edit', 'edit', 'edit', 'edit']);
        expect(hold).toBe(true);
        // a fresh arm: the switch seen off, then on, flies again
        let st = modeStep(mode, false, false, hold);
        expect(st).toEqual({ mode: 'edit', change: null, hold: false, respawn: false });
        st = modeStep(st.mode, true, false, st.hold);
        expect(st).toEqual({ mode: 'fly', change: 'to-fly', hold: false, respawn: false });
        // respawn.keepArmed off: the respawn leaves the drone disarmed and the edit view stays (review EI-5: the page respawns
        // a drone lying crashed under the edit view)
        expect(modeStep('edit', false, true)).toEqual({ mode: 'edit', change: null, hold: false, respawn: true });
        expect(editModeOf(false, true, 'fly')).toBe('edit');
    });

    it('review ED-2: the edit mode keeps the flying keys from the keyboard source, Space arms, ce-flying gives them back', () => {
        const KB = readFileSync(join(__dirname, '../../../apps/fly/src/devices/keyboard.ts'), 'utf8');
        expect(KB).toMatch(/EDIT_MODE = '\.course-editor:not\(\.ce-flying\)'/);
        expect(KB).toMatch(/querySelector\(`\$\{DIALOGS\}, \$\{EDIT_MODE\}`\)/);
        expect(KB).toMatch(/dialogOpen\(\) && !editModeArm\(e\.code, e\.target\)/);
        expect(COURSE_TS).toMatch(/panel\?\.root\.classList\.add\('ce-flying'\)/);
        expect(COURSE_TS).toMatch(/panel\?\.root\.classList\.remove\('ce-flying'\)/);
    });

    it('review ED-1: a delete or a duplicate takes the view to the gate it selects', () => {
        expect(COURSE_TS).toMatch(/ed\.course\.gates\.length !== count\) aim\(\)/);
        const VM = readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/view-mouse.ts'), 'utf8');
        // a drag left set when the button goes up is ended there (one undo step), so put() places the handles again
        expect(VM).toMatch(/if \(this\.dragging\) \{\s*this\.dragging = false;\s*this\.host\.onDrag\(this\.pose\(this\.openingAtStart\), true\);/);
    });

    it('the test flight shows the lap clock and the next gate, the best lap is not written', () => {
        expect(flyShows(true)).toEqual({ nextGate: true, lapClock: true, writeBest: false });
        // integration E: the edit view hides the clock, its splash and the guide (hud.update(null) in showEd)
        expect(COURSE_TS).toMatch(/if \(end\.best && shows\.writeBest\) writeBest/);
        expect(COURSE_TS).toMatch(/const cam = done \|\| !g \|\| !shows\.lapClock \? null : guideCamera\(\);\s+hud\.guide\([^;]*gateRole\(/);
        expect(flyShows(false)).toEqual({ nextGate: true, lapClock: true, writeBest: true });
    });

    it('the page does not pause the flight for the editor and gives the keys to the flight while armed', () => {
        expect(COURSE_TS).not.toMatch(/ctx\.pause\('panel'\)/);
        expect(COURSE_TS).toMatch(/ctx\.keys\.block\(\(\) => ed !== null && mode === 'edit'[,)]/);
        // J1 (E5): the edit branch also thins the course arrows before it returns editFrame()
        expect(COURSE_TS).toMatch(/if \(ed\) \{[^}]*\s+return editFrame\(\);/);
        expect(COURSE_TS).toMatch(/modeStep\(mode, !!sim\?\.armed, !!sim\?\.crashed, crashHold\);\s*crashHold = st\.hold;/);
        expect(COURSE_TS).toMatch(/if \(shows\.lapClock\) hud\.update/);
        expect(COURSE_TS).toMatch(/onPlace: \(ray\) => placeAt\(ray\)/);
    });
});
