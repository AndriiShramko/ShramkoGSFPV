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

describe('int4: edit4b top bar x the editor window on a small view (edit4a step 13, 844x390)', () => {
    const css = readFileSync(join(SRC, 'course/editor/editor.css'), 'utf8');
    const bar = readFileSync(join(SRC, 'course/editor/top-bar.ts'), 'utf8');
    it('top-bar.ts writes its bottom edge on the shared parent and takes it away when it goes', () => {
        expect(bar).toMatch(/this\.ui\.style\.setProperty\('--ce-topbar-bottom', `\$\{Math\.round\(bar\.bottom\)\}px`\)/);
        expect(bar.match(/this\.ui\.style\.removeProperty\('--ce-topbar-bottom'\)/g) ?? []).toHaveLength(2);
    });
    it('in the small-view block the window starts under the bar', () => {
        const start = css.indexOf('@media (max-width: 900px), (max-height: 500px) {');
        expect(start).toBeGreaterThan(0);
        const block = css.slice(start, css.indexOf('\n}', start));
        expect(block).toMatch(/\.course-editor \{ top: calc\(var\(--ce-topbar-bottom, 130px\) \+ 6px\); \}/);
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
