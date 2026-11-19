// Lane editor3, stage H1 (docs/wip/editor3.md) chose one set of handles at a time (Move, Turn, Size) on the gate bar and by
// the keys M R T. Train 4 edit4a A2 removes them by the owner's word (brief 543: "I don't like that you put scale, move and
// turn on three buttons ... the arrows, the rings and the boxes right there at once, as in an ordinary 3D editor"): the
// one gizmo has all three parts (tools/bench/test/edit4a-gizmo.test.ts). What stays of H1: the window opens closed, the top
// bar's words start with a capital letter, a full course says in words what to delete (the owner's rule of 2026-11-13).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as BAR from '../../../apps/fly/src/course/editor/bar-place';
import { editorKey } from '../../../apps/fly/src/course/editor/keys';

const ROOT = join(__dirname, '../../..');
const VIEW_TS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/view-mouse.ts'), 'utf8');
const COURSE_TS = readFileSync(join(ROOT, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/editor.css'), 'utf8');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const locale = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/fly/course/${lang}.json`), 'utf8')) as Record<string, string>;

describe('edit4a A2: no tools, the one gizmo (brief 543)', () => {
    it('no tool list, no tool keys: M R T do nothing in the edit view (no key that does nothing either: editorKey leaves them)', () => {
        expect((BAR as Record<string, unknown>)['TOOLS']).toBeUndefined();
        expect((BAR as Record<string, unknown>)['toolOfKey']).toBeUndefined();
        expect((BAR as Record<string, unknown>)['toolAfter']).toBeUndefined();
        expect(VIEW_TS).not.toMatch(/toolOfKey|setTool|showTool/);
        for (const code of ['KeyM', 'KeyR', 'KeyT']) expect(editorKey({ code }, [0, -1])).toBeNull();
    });
    it('the view attaches all three handles to the stand-in; the course keeps the gate and its kind on put()', () => {
        expect(VIEW_TS).toMatch(/private showAll\(\): void \{\s*for \(const h of this\.handles\) \{\s*if \(h\.nodes\[0\] !== this\.stand\) h\.attach\(\[this\.stand\]\);/);
        expect(COURSE_TS).not.toMatch(/setTool/);
        expect(COURSE_TS).toMatch(/view\?\.put\([^\n]*eg \? eg\.id : null, eg \? eg\.shape\.kind : null\)/);
    });
    it('the window opens closed on every screen (not only on a phone)', () => {
        const media = CSS.indexOf('@media (max-width: 900px)');
        const closed = CSS.indexOf('.course-editor:not(.ce-open) > :not(.ce-title) { display: none; }');
        expect(closed).toBeGreaterThan(-1);
        expect(closed).toBeLessThan(media);
    });
});

describe('editor3 H1: words', () => {
    it('every top bar word starts with a capital letter, in all four languages', () => {
        for (const lang of LANGS) {
            const l = locale(lang);
            for (const k of BAR.TOP_BUTTONS.map((b) => b.labelKey)) {
                const v = l[k];
                expect(v, `${lang} ${k}`).toBeTruthy();
                expect(v![0], `${lang} ${k}`).toBe(v![0]!.toUpperCase());
                expect(v![0], `${lang} ${k}`).not.toBe(v![0]!.toLowerCase());
            }
        }
    });
    it('a full course: no number and no placeholder, it names what to do; Add gate says it before arming', () => {
        for (const lang of LANGS) {
            const v = locale(lang)['course.edit.r.maxGates']!;
            expect(v, lang).not.toMatch(/[0-9{}]/);
            expect(v.length, lang).toBeGreaterThan(40);
        }
        expect(COURSE_TS).toMatch(/ed\.course\.gates\.length >= MAX_GATES_EDIT\) return say\(t\('course\.edit\.r\.maxGates'\), true\)/);
    });
});
