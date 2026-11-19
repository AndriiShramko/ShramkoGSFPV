// Train 4, integration car 2 (int4, S2): where two lanes meet in app/builtin/course.ts. Source checks in the style of
// edit4a-camera.test.ts: the course feature's closure needs the whole page, so the test reads the calls it must make.
//   - edit4a's drag cancel (Esc, a right click) and edit4c's live warnings: the tag of a cancelled drag goes with it
//   - edit4s's save and edit4b's seam: a save is heard by the parts (life.ts clears 'unsaved' on the seam's 'saved')
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../../apps/fly/src');
const course = readFileSync(join(SRC, 'app/builtin/course.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

/** The body of `const <name> = (...) => { ... };` up to the closing line at the same indent. */
function body(name: string): string {
    const start = course.indexOf(`const ${name} = `);
    expect(start, name).toBeGreaterThan(0);
    const end = course.indexOf('\n        };', start);
    return course.slice(start, end);
}

describe('int4: edit4a drag cancel x edit4c live warnings', () => {
    it('a cancelled drag ends the live check and closes the tag beside the gate', () => {
        const b = body('dragCancel');
        expect(b).toMatch(/warns\?\.endDrag\(\)/);
        expect(b).toMatch(/warnBar\?\.close\(\)/);
    });
    it('the release still ends the live check (dragTo), so both ends of a drag do', () => {
        expect(body('dragTo')).toMatch(/warns\?\.endDrag\(\)/);
    });
});

describe('int4: edit4s save x edit4b seam', () => {
    it('every save that reaches the keeper is also the seam event saved', () => {
        const kept = course.match(/keeper\?\.saved\(/g) ?? [];
        expect(kept.length).toBeGreaterThanOrEqual(2);
        const emits = course.match(/keeper\?\.saved\([^)]*\);\s*bus\?\.emit\('saved', \{ id: [^,]+, version: r\.version \}\);/g) ?? [];
        expect(emits).toHaveLength(kept.length);
    });
    it('life.ts listens for it (a later loss question no longer calls the saved gates unsaved)', () => {
        const life = readFileSync(join(SRC, 'course/editor/parts/life.ts'), 'utf8');
        expect(life).toMatch(/seam\.on\('saved', \(\) => \{ changedSinceSave = false; \}\)/);
    });
});
