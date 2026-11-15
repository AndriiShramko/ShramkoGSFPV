// Lane editor3, train 3 stage H1-tunis: the Save refusal on Tunis said "the way from gate 0 to gate 1 goes through a wall".
// The check's leg from the start carries the id 'start' (packages/tracks check.ts points[0]), which is no gate, so the
// gate number came out as 0. The pilot counts gates from 1 and the leg from the start names the start.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Course, CourseProblem } from '@gsfpv/tracks';
import { LEG_START_KEY, editorLocaleKeys, problemParts } from '../../../apps/fly/src/course/editor/texts';

const course = { gates: [{ id: 'g7' }, { id: 'g9' }, { id: 'g12' }] } as unknown as Course;
const LOCALES = join(__dirname, '../../../packages/i18n/locales/fly/course');

describe('editor3 H1: problem numbers as the pilot sees them', () => {
    it('a leg from the start names the start and the first gate as 1, never gate 0', () => {
        const p: CourseProblem = { code: 'leg-wall', from: 'start', to: 'g7', freeM: 0 };
        const r = problemParts(course, p);
        expect(r.key).toBe(LEG_START_KEY);
        expect(r.args).toEqual({ b: 1 });
        expect(Object.values(r.args)).not.toContain(0);
    });

    it('a leg between gates and a gate problem count from 1', () => {
        expect(problemParts(course, { code: 'leg-wall', from: 'g9', to: 'g12', freeM: 0.1 })).toEqual({ key: 'course.edit.p.legWall', args: { a: 2, b: 3 } });
        expect(problemParts(course, { code: 'gate-wall', gate: 'g7', freeM: 0.1 }).args).toEqual({ g: 1 });
    });

    it('the start leg key is among the editor keys and in all four languages with {b}', () => {
        expect(editorLocaleKeys()).toContain(LEG_START_KEY);
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8')) as Record<string, string>;
            expect(j[LEG_START_KEY], lang).toContain('{b}');
            expect(j[LEG_START_KEY], lang).not.toContain('{a}');
        }
    });
});
