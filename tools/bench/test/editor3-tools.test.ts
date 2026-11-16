// Lane editor3, stage H1 (docs/wip/editor3.md): one set of handles at a time (Move, Turn, Size), chosen on the gate bar or
// by one key each; Move whenever another gate gets selected. The top bar's words start with a capital letter. A full course
// says in words what to delete, with no number in it (the owner's rule of 2026-11-13).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS, TOP_BUTTONS, toolAfter, toolOfKey } from '../../../apps/fly/src/course/editor/bar-place';
import { editorKey } from '../../../apps/fly/src/course/editor/keys';
import { CAM_KEYS } from '../../../apps/fly/src/course/editor/fly-cam';
import { editorLocaleKeys } from '../../../apps/fly/src/course/editor/texts';

const ROOT = join(__dirname, '../../..');
const VIEW_TS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/view-mouse.ts'), 'utf8');
const COURSE_TS = readFileSync(join(ROOT, 'apps/fly/src/app/builtin/course.ts'), 'utf8');
const CSS = readFileSync(join(ROOT, 'apps/fly/src/course/editor/editor.css'), 'utf8');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const locale = (lang: string): Record<string, string> =>
    JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/fly/course/${lang}.json`), 'utf8')) as Record<string, string>;

describe('editor3 H1: one set of handles at a time', () => {
    it('three tools, each with a key the edit camera and the editor leave free', () => {
        expect(TOOLS.map((x) => x.id)).toEqual(['move', 'turn', 'size']);
        for (const x of TOOLS) {
            expect(CAM_KEYS.has(x.code)).toBe(false);
            expect(editorKey({ code: x.code }, [0, -1])).toBeNull();
            expect(toolOfKey(x.code, false)).toBe(x.id);
            expect(toolOfKey(x.code, true)).toBeNull();
        }
        expect(toolOfKey('KeyW', false)).toBeNull();
    });
    it('Move is on when another gate gets selected; the chosen set stays on the same gate', () => {
        expect(toolAfter('turn', 'g1', 'g2')).toBe('move');
        expect(toolAfter('size', 'g1', 'g1')).toBe('size');
        expect(toolAfter('turn', null, 'g1')).toBe('move');
    });
    it('the view attaches only the shown set and the bar offers the three', () => {
        expect(VIEW_TS).not.toMatch(/for \(const h of this\.handles\) h\.attach/);
        expect(VIEW_TS).toMatch(/on\.attach\(\[this\.stand\]\)/);
        expect(COURSE_TS).toMatch(/setTool: \(tl\) => view\?\.setTool\(tl\)/);
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
    it('every top bar word and every tool name starts with a capital letter, in all four languages', () => {
        for (const lang of LANGS) {
            const l = locale(lang);
            for (const k of [...TOP_BUTTONS.map((b) => b.labelKey), ...TOOLS.map((x) => x.labelKey)]) {
                const v = l[k];
                expect(v, `${lang} ${k}`).toBeTruthy();
                expect(v![0], `${lang} ${k}`).toBe(v![0]!.toUpperCase());
                expect(v![0], `${lang} ${k}`).not.toBe(v![0]!.toLowerCase());
            }
        }
        for (const x of TOOLS) expect(editorLocaleKeys()).toContain(x.labelKey);
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
