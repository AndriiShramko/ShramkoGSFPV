// Train 4, integration car 2 (int4, S2): where two lanes meet in app/builtin/course.ts. Source checks in the style of
// edit4a-camera.test.ts: the course feature's closure needs the whole page, so the test reads the calls it must make.
//   - edit4a's drag cancel (Esc, a right click) and edit4c's live warnings: the tag of a cancelled drag goes with it
//   - edit4s's save and edit4b's seam: a save is heard by the parts (life.ts clears 'unsaved' on the seam's 'saved')
// Car 3 (t7-base's open seams): edit4b's Course menu Generate x gen4b's dialog; gen4b's start line x ux4a's message rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shownMs } from '../../../apps/fly/src/messages-logic';
import { fakeDocument } from './helpers/fake-dom';

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
        expect(bar.match(/this\.ui\.style\.removeProperty\('--ce-beside'\)/g) ?? []).toHaveLength(3);
    });
    it('the window goes under the bar only when the room beside it is under BESIDE_MIN (under it always, the window lay over the gates in the view\'s middle and over edit4c\'s Add list: edit4a 13, edit4c s8 with walls at 844x390)', () => {
        const place = bar.slice(bar.indexOf('private readonly place = '), bar.indexOf('/** D6:'));
        // measured from the window's own right edge: on a low view editor.css keeps it 64 px in (the sound button)
        expect(place).toMatch(/const win = this\.ui\.querySelector\('\.course-editor'\)\?\.getBoundingClientRect\(\);/);
        expect(place).toMatch(/const room = Math\.floor\(\(win && win\.width > 0 \? win\.right : window\.innerWidth - 8\) - bar\.right - 8\);/);
        expect(place).toMatch(/if \(bar\.height > 0 && room < BESIDE_MIN\) \{\s*this\.ui\.style\.setProperty\('--ce-topbar-bottom'/);
        expect(place).toMatch(/else \{\s*this\.ui\.style\.removeProperty\('--ce-topbar-bottom'\);\s*if \(bar\.height > 0\) this\.ui\.style\.setProperty\('--ce-beside', `\$\{room\}px`\);/);
        expect(bar).toMatch(/export const BESIDE_MIN = 260;/);
    });
    it('the bar is watched, but its own bottom never counts for --ce-below (it pushed itself down to mid-view)', () => {
        const place = bar.slice(bar.indexOf('private readonly place = '), bar.indexOf("'--ce-below'"));
        expect(place).toMatch(/this\.root\]/);
        const loop = place.slice(place.indexOf('for (const p of parts) {'));
        expect(loop).toMatch(/^for \(const p of parts\) \{\s*(\/\/[^\n]*\n\s*)*if \(p === this\.root\) continue;/);
    });
    it('in the small-view block the window narrows to the room beside the bar, and starts under it only when told', () => {
        const start = css.indexOf('@media (max-width: 900px), (max-height: 500px) {');
        expect(start).toBeGreaterThan(0);
        const block = css.slice(start, css.indexOf('\n}', start));
        expect(block).toMatch(/width: min\(380px, 48vw, var\(--ce-beside, 380px\)\);/);
        expect(block).toMatch(/top: calc\(var\(--ce-topbar-bottom, calc\(max\(8px, var\(--top-row-bottom, 78px\)\) \+ 2px\)\) \+ 6px\);/);
    });
});

describe('int4: edit4a hover tag x the gate bar (edit4a step 13, 844x390)', () => {
    const vm = readFileSync(join(SRC, 'course/editor/view-mouse.ts'), 'utf8');
    const show = vm.slice(vm.indexOf('private showHoverTag('), vm.indexOf('if (ms > 0)', vm.indexOf('private showHoverTag(')));
    it('a tag that would lie on the gate bar goes above the pointer and the bar', () => {
        expect(show).toMatch(/document\.querySelector<HTMLElement>\('\.ce-gatebar'\)\?\.getBoundingClientRect\(\)/);
        expect(show).toMatch(/left < bar\.right && bar\.left < left \+ w && top < bar\.bottom && bar\.top < top \+ h/);
        expect(show).toMatch(/top = Math\.round\(Math\.max\(4, Math\.min\(y - 18 - h, bar\.top - h - 4\)\)\);/);
        expect(show).toMatch(/t\.style\.top = `\$\{top\}px`;/);
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

describe('int4 car 3: edit4b Course menu Generate x gen4b Generate dialog (t7-base open seam)', () => {
    it('the seam opens the dialog from the editor, after edit4s keeps a draft', () => {
        const from = course.indexOf('generate: (seed) => {');
        const gen = course.slice(from, course.indexOf('say: (text, level)', from));
        expect(gen).toMatch(/keeper\?\.beforeLoss\('generate'\);\s*openGenerateDialog\('editor', seed\);/);
    });
    it('from the editor the dialog does not name the unsaved changes again (life.ts asked and the pilot said yes)', () => {
        const open = body('openGenerateDialog');
        expect(open).toMatch(/const unsaved = from !== 'editor' && !!ed && edChanged;/);
        expect(open).toMatch(/genDialog\.open\(\{[^}]*\bunsaved \}\)/);
    });
    it('a build asked from the editor opens the editor again on the new course', () => {
        const at = course.indexOf('build: (r) => {');
        const build = course.slice(at, course.indexOf('cancel: () => {', at));
        expect(build).toMatch(/if \(f\?\.from === 'editor'\) \{[^}]*reopenAfter = true;/);
    });
});

describe('int4 car 3: gen4b start line x ux4a message rules (t7-base open seam: the 8 s were dropped)', () => {
    const LOC = join(__dirname, '../../../packages/i18n/locales/fly/course');
    for (const lang of ['en', 'es', 'pl', 'ru']) {
        it(`${lang}: the start line stays at least START_LINE_MS, here or far, few gates or many`, async () => {
            // progress-box.ts reaches i18n.ts (the page's path on load) and ui/dom.ts (as course-progress.test withPage)
            const g = globalThis as { location?: unknown; document?: unknown };
            g.document ??= fakeDocument();
            g.location ??= { pathname: '/en/', search: '', href: 'http://localhost/en/' };
            const { START_LINE_MS, startLine } = await import('../../../apps/fly/src/course/progress-box');
            const words = JSON.parse(readFileSync(join(LOC, `${lang}.json`), 'utf8')) as Record<string, string>;
            const t = (k: string, p?: Record<string, string | number>): string => words[k]!.replace(/\{(\w+)\}/g, (_, n: string) => String(p?.[n] ?? ''));
            for (const far of [0, 5, 805]) for (const n of [3, 24]) {
                expect(shownMs({ text: startLine(far, n, t), kind: 'done', minMs: START_LINE_MS }), `${far} m, ${n} gates`).toBeGreaterThanOrEqual(START_LINE_MS);
            }
        });
    }
    it('course.ts hands START_LINE_MS to the service with the start line', () => {
        expect(course).toMatch(/tell\(\{ text: hook\.startLine, kind: 'done', key: COURSE_LINE, minMs: START_LINE_MS \}\)/);
    });
});
