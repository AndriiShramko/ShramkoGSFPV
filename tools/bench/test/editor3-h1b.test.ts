// Lane editor3, train 3 stage H1-tunis pass 2. (1) The lead's decision for a refused Save: the first wrong gate is selected
// and named from 1 with what to do; a leg from the start leads to moving that gate toward the start. (2) Ring or Cube
// pressed on a dive gate stands the gate up (G3 on Tunis: the kind's undo looked lost because the tilt stayed).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edit, openEditor } from '@gsfpv/tracks';
import type { Course, CourseProblem } from '@gsfpv/tracks';
import { FIX_KEYS, editorLocaleKeys, firstWrong } from '../../../apps/fly/src/course/editor/texts';

const ids = { gates: [{ id: 'g7' }, { id: 'g9' }, { id: 'g12' }, { id: 'g13' }] } as unknown as Course;
const LOCALES = join(__dirname, '../../../packages/i18n/locales/fly/course');

describe('editor3 H1b: a refused Save selects the first wrong gate', () => {
    it('picks the lowest gate any problem points at; a leg points at its far gate; numbers from 1', () => {
        const ps: CourseProblem[] = [
            { code: 'leg-wall', from: 'g9', to: 'g12', freeM: 0.1 },
            { code: 'gate-wall', gate: 'g13', freeM: 0 },
            { code: 'gate-direction', gate: 'g9', deg: 120 }
        ];
        expect(firstWrong(ids, ps)).toEqual({ index: 1, key: FIX_KEYS['gate-direction'], args: { g: 2 } });
        expect(firstWrong(ids, ps.slice(0, 2))).toEqual({ index: 2, key: FIX_KEYS['leg-wall'], args: { a: 2, b: 3, m: 3 } });
        expect(firstWrong(ids, [])).toBeNull();
    });

    it('a leg from the start selects gate 1 and says to move it toward the start, not "gate 0"', () => {
        const w = firstWrong(ids, [{ code: 'leg-wall', from: 'start', to: 'g7', freeM: 0 }]);
        expect(w).toEqual({ index: 0, key: FIX_KEYS.legStart, args: { b: 1 } });
    });

    it('a just-added gate keeps the focus: only its problems, and it is the one selected', () => {
        const ps: CourseProblem[] = [
            { code: 'gate-wall', gate: 'g7', freeM: 0 },
            { code: 'leg-wall', from: 'g12', to: 'g13', freeM: 0.2 }
        ];
        expect(firstWrong(ids, ps, 'g12')).toEqual({ index: 2, key: FIX_KEYS['leg-wall'], args: { a: 3, b: 4, m: 3 } });
        expect(firstWrong(ids, ps, 'g9')).toBeNull();
    });

    it('every fix sentence is in all four languages with its numbers', () => {
        const keys = editorLocaleKeys();
        for (const k of [...Object.values(FIX_KEYS), 'course.edit.saveFix', 'course.edit.addFix']) expect(keys).toContain(k);
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8')) as Record<string, string>;
            expect(j[FIX_KEYS.legStart], lang).toContain('{b}');
            expect(j[FIX_KEYS['leg-wall']], lang).toContain('{m}');
            expect(j[FIX_KEYS['gate-wall']], lang).toContain('{g}');
            expect(j['course.edit.saveFix'], lang).toContain('{fix}');
            expect(j['course.edit.addFix'], lang).toContain('{fix}');
        }
    });
});

describe('editor3 H1b: Ring or Cube on a dive gate stands it up', () => {
    const DIVE: [number, number, number, number] = [Math.SQRT1_2, -Math.SQRT1_2, 0, 0];
    const course = {
        transform: [1, 0, 0, 0],
        gates: [
            { id: 'g1', pos: [0, 2, 0], quat: DIVE, shape: { kind: 'ring', diameter: 1.5, tube: 0.1 } },
            { id: 'g2', pos: [0, 2, -6], quat: [1, 0, 0, 0], shape: { kind: 'square', side: 1.5, bar: 0.1 } }
        ]
    } as unknown as Course;
    const none = (): CourseProblem[] => [];
    // the gate's local -Z (the way it is passed) in world y; a dive gate has it near -1 (words.ts gateLine)
    const downY = (q: readonly number[]): number => -2 * (q[2]! * q[3]! - q[0]! * q[1]!);

    it('Cube on a dive ring: a level cube; undo gives the dive ring back', () => {
        const s = openEditor(course, none, 0);
        expect(Math.abs(downY(s.course.gates[0]!.quat))).toBeGreaterThan(0.7);
        const out = edit(s, { kind: 'shape', to: 'cube-frame' }, none);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const g = out.state.course.gates[0]!;
        expect(g.shape.kind).toBe('cube-frame');
        expect(Math.abs(downY(g.quat))).toBeLessThan(0.1);
        const back = edit(out.state, { kind: 'undo' }, none);
        expect(back.ok && back.state.course.gates[0]!.shape.kind).toBe('ring');
        expect(back.ok && Math.abs(downY(back.state.course.gates[0]!.quat))).toBeGreaterThan(0.7);
    });

    it('Ring on a dive ring stands it up (not "already like that"); Ring on a level ring is still refused', () => {
        const out = edit(openEditor(course, none, 0), { kind: 'shape', to: 'ring' }, none);
        expect(out.ok).toBe(true);
        if (out.ok) expect(Math.abs(downY(out.state.course.gates[0]!.quat))).toBeLessThan(0.1);
        const lvl = edit(openEditor(course, none, 1), { kind: 'shape', to: 'square' }, none);
        expect(lvl.ok).toBe(false);
    });
});
