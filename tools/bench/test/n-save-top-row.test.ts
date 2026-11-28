// fix-n-save (the independent check of lane n-save, finding 1; evidence/2026-11-20/n-save/review-top-row-head.json): at
// 1536x730 the editor's top bar, with its 16 px line wrapped to three rows, ended at y 78 and covered the centres of the
// page's top-row buttons (Motor sound, Full screen, Messages, Share), so a mouse could not press them. The lead's rule 1:
// at 1536x730, 1366x768 and 844x390, with the default line, the longest save line and no line, a press at the centre of
// each top-row button reaches it. The browser measure is `MEASURE_TOP=1 node tools/bench/scripts/n-save-accept.mjs`;
// this test holds the same rule by the bar's own numbers (editor.css) against the row's place the check measured.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeDocument, FakeElement } from './helpers/fake-dom';

const root = join(__dirname, '..', '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const css = read('apps/fly/src/course/editor/editor.css').replace(/\/\*[\s\S]*?\*\//g, '');
/** the declarations of the first rule with exactly this selector (outside or inside a media block) */
const ruleOf = (sel: string, text = css): string => {
    const at = text.indexOf(`${sel} {`);
    return at < 0 ? '' : text.slice(at + sel.length + 2, text.indexOf('}', at));
};
const prop = (rule: string, name: string): string | null => new RegExp(`(^|[\\s;])${name}:\\s*([^;]+);`).exec(rule)?.[2]?.trim() ?? null;
const px = (v: string | null): number => parseFloat(v ?? 'NaN');

/** the page's top-row buttons under the bar, as the check measured them (1536x730, scale 1.25; the row's top and height
 * do not change with the view's width above 900 px) */
const measured = JSON.parse(read('evidence/2026-11-20/n-save/review-top-row-head.json')) as { measureTop: { under: { name: string; top: number; h: number }[] } };
const row = measured.measureTop.under;

describe('fix-n-save: the top bar never reaches the centres of the top-row buttons', () => {
    const bar = ruleOf('.ce-topbar');
    const btn = ruleOf('.ce-topbar .ce-tb');
    const line = ruleOf('.ce-topbar .ce-tb-line');
    const lineH = px(prop(line, 'font-size')) * px(prop(line, 'line-height'));
    const rowsMax = Number(prop(line, '-webkit-line-clamp') ?? Infinity);
    /** the bar's bottom edge on a wide view (centred at its top, the line beside the buttons): top, border, padding and
     * the taller of a button and the line's rows (box-sizing of a button: border-box, as Chrome draws it) */
    const bottomWith = (rows: number): number => {
        const border = px(prop(bar, 'border'));
        const pad = px(prop(bar, 'padding'));
        return px(prop(bar, 'top')) + 2 * border + 2 * pad + Math.max(px(prop(btn, 'min-height')), Math.min(rows, rowsMax) * lineH);
    };

    it('holds the 16 px of the owner and at most two rows', () => {
        expect(px(prop(line, 'font-size'))).toBeGreaterThanOrEqual(16);
        expect(rowsMax).toBeLessThanOrEqual(2);
        expect(px(prop(line, 'max-height')) * px(prop(line, 'font-size'))).toBeLessThanOrEqual(2 * lineH + 0.5);
    });

    // 1536x730 and 1366x768: the bar is centred at the top (no media block of editor.css matches) over the row's left part
    for (const [what, rows] of [['the default line', 1], ['the longest save line', 99], ['no line', 0]] as const) {
        it(`wide views, ${what}: the bar ends above the centre of every top-row button`, () => {
            expect(row.length).toBeGreaterThanOrEqual(4);
            for (const b of row) expect(bottomWith(rows), b.name).toBeLessThan(b.top + b.h / 2);
        });
    }

    it('844x390: the line is not shown and the bar starts under the top row', () => {
        const media = css.slice(css.indexOf('@media (max-width: 900px), (max-height: 500px)'));
        expect(prop(ruleOf('.ce-topbar .ce-tb-line', media), 'display')).toBe('none');
        expect(prop(ruleOf('.ce-topbar', media), 'top')).toBe('calc(var(--top-row-bottom, 78px) + 4px)');
    });

    it('the default line is one short sentence in en, es, pl, ru (one row of 420 px)', () => {
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const s = (JSON.parse(read(`packages/i18n/locales/fly/course/${lang}.json`)) as Record<string, string>)['course.edit.opened']!;
            expect(s.length, lang).toBeLessThanOrEqual(46);
        }
    });
});

describe('fix-n-save: a line cut to two rows is said whole in the Messages list', () => {
    type Bar = typeof import('../../../apps/fly/src/course/editor/top-bar');
    let B: Bar;
    beforeAll(async () => {
        vi.stubGlobal('location', { search: '', pathname: '/en/fly/', href: 'http://127.0.0.1/en/fly/', origin: 'http://127.0.0.1' });
        vi.stubGlobal('document', fakeDocument());
        vi.stubGlobal('navigator', { languages: ['en'], language: 'en' });
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
        vi.stubGlobal('requestAnimationFrame', () => 0);
        vi.stubGlobal('window', { innerWidth: 1536, innerHeight: 730, addEventListener: () => undefined, removeEventListener: () => undefined });
        B = await import('../../../apps/fly/src/course/editor/top-bar');
    });

    it('a cut line that is no refusal goes to the host once; a refusal or a line that fits does not', () => {
        vi.useFakeTimers();
        const said: string[] = [];
        const ui = (document as unknown as { createElement(t: string): FakeElement }).createElement('div');
        // the fake style has no removeProperty (place() clears the window's room with it)
        Object.assign(ui.style, { removeProperty: () => '' });
        const bar = new B.TopBar(ui as unknown as HTMLElement, { key: () => undefined, add: () => undefined, fly: () => undefined, menu: () => [], cut: (t) => said.push(t) });
        const line = ui.querySelector('.ce-tb-line') as unknown as { scrollHeight: number; clientHeight: number; textContent: string };
        Object.assign(line, { scrollHeight: 40, clientHeight: 40 });
        bar.tell('fits on two rows', false);
        expect(said).toEqual([]);
        Object.assign(line, { scrollHeight: 80, clientHeight: 40 });
        bar.tell('a long line', false);
        bar.tell('a long line', false);
        bar.tell('a long refusal', true);
        expect(line.textContent).toBe('a long refusal');
        expect(said).toEqual(['a long line']);
        bar.destroy();
        vi.useRealTimers();
    });

    it('the page passes the cut line to the Messages list (course.ts)', () => {
        expect(read('apps/fly/src/app/builtin/course.ts')).toMatch(/cut: \(text\) => tell\(\{ text, kind: 'info', from: 'course-editor' \}\)/);
    });
});
