// Lane editor3, stage H2-look (docs/wip/editor3.md): the Size tool reads as a scale tool, the flight's windows are hidden in
// the edit view, and the two bars are 44 px targets on a phone. Read from the sources (the page draws them; the browser
// proof is tools/bench/src/editor3-look.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/fly/src/course/editor/view-mouse.ts');
const CSS = read('apps/fly/src/course/editor/editor.css');
const COURSE = read('apps/fly/src/app/builtin/course.ts');

describe('editor3 H2-look', () => {
    it('the Size tool has a box at the end of x and y (z for a cube) and the centre box, each changing the one opening', () => {
        // only the planes and z are off at the start; x and y stay on
        expect(VIEW).toMatch(/for \(const a of \['yz', 'xz', 'xy', 'z'\] as const\) size\.enableShape\(a, false\)/);
        expect(VIEW).toMatch(/this\.size\.enableShape\('z', deep\)/);
        // the factor is the axis pulled furthest from 1 (an axis box scales one axis only)
        expect(VIEW).toMatch(/\[sc\.x, sc\.y, sc\.z\]\.reduce/);
        // the opening in metres beside the handle while it is dragged, the top bar's line after it
        expect(VIEW).toMatch(/if \(h === this\.size\) this\.showTag\(/);
        expect(COURSE).toMatch(/sizeText: \(m\) => t\('course\.edit\.sizeTag'/);
        expect(COURSE).toMatch(/view\?\.tool === 'size' \? ACTION_KEYS\.size/);
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(read(`packages/i18n/locales/fly/course/${l}.json`)) as Record<string, string>;
            expect(j['course.edit.sizeTag'], l).toMatch(/\{m\}/);
        }
    });

    it('in the edit view the stats card, the controller hint, the lap clock and the course line, the note of the course and the take-off prompt are hidden', () => {
        expect(CSS).toMatch(/body:has\(\.course-editor:not\(\.ce-flying\)\) :is\(\.osd-stats, \.arm-card, \.course-hud, \.hud-note, \.gate-msg, \.crash-toast\) \{ display: none !important; \}/);
    });

    it('on a phone every button of the top bar and the gate bar is a 44 px target', () => {
        const phone = CSS.slice(CSS.indexOf('@media (max-width: 900px), (max-height: 500px)'));
        expect(phone).toMatch(/\.ce-topbar \.ce-tb \{ min-height: 44px; min-width: 44px;/);
        expect(phone).toMatch(/\.ce-gatebar \.ce-gb \{ width: 44px; height: 44px;/);
        // pass 2: the top bar sits below the page's top row, not over it
        expect(phone).toMatch(/\.ce-topbar \{ top: calc\(var\(--top-row-bottom, 78px\) \+ 4px\); left: 8px; transform: none;/);
    });
});
