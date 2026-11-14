// Lane tracks2, review fixes of 2026-11-14: the page's wiring (apps/fly/src/app/builtin/course.ts) that has no unit of its
// own. T2-1: the editor proves a course at the margin it was laid with (marginOf), as the worker does. T2-4: Shift+B while a
// course is being made is remembered (the editor opens on the course when it arrives) instead of doing nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const COURSE_TS = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');
const WORKER_TS = readFileSync(join(__dirname, '../../../apps/fly/src/course/worker.ts'), 'utf8');

/** The body of `const openEdit = ...` up to the next top-level const of the same depth. */
function openEditBody(src: string): string {
    const at = src.indexOf('const openEdit = ');
    expect(at).toBeGreaterThan(0);
    const end = src.indexOf('\n        const ', at + 10);
    return src.slice(at, end > at ? end : undefined);
}

describe('the course page wiring after review', () => {
    it('T2-1: the editor and the worker prove a course at marginOf(track), not at the plan margin', () => {
        const body = openEditBody(COURSE_TS);
        expect(body).toMatch(/wallsCheck\(col, flownTransform\(\), marginOf\(run\.track\)\)/);
        expect(WORKER_TS).toMatch(/checkTrack\(m\.track, walls, m\.transform, marginOf\(m\.track\), false\)/);
    });

    it('T2-4: Shift+B while busy asks for the editor when the course arrives', () => {
        const body = openEditBody(COURSE_TS);
        expect(body).toMatch(/if \(busy\) \{[^}]*reopenAfter = true;[^}]*return;\s*\}/);
        expect(body).not.toMatch(/if \(busy\) return;/);
    });
});
