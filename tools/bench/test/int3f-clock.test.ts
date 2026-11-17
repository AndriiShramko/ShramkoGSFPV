// Lane clockfix (review of 7af2aad5, F1 and F2), replacing integration F seam d's checks. On a short view (max-height 500px)
// the course clock's text and its cross stand in ONE chip with a backdrop, the cross inside it; the place is the left column
// on a keyboard and the bottom middle between the stick pads on touch, and no value kept by a script (--cinema-top) decides
// it. tools/bench/scripts/clock-place-probe.mjs measures the rectangles on a page; these check the rules are in the CSS.
// Each check runs on the release CSS of 7af2aad5 as well (OLD below, copied from it), where it must fail: the negative control.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(readFileSync(join(__dirname, '../../../apps/fly/src/course/hud.css'), 'utf8'));
const editorCss = strip(readFileSync(join(__dirname, '../../../apps/fly/src/course/editor/editor.css'), 'utf8'));
const OLD = `@media (max-height: 500px) {
    .course-hud { top: auto; left: auto; right: max(16px, env(safe-area-inset-right)); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 26px); transform: none; text-align: right; font-size: 12px; line-height: 1.25; }
}
.course-hud .course-hud-x { position: absolute; top: 0; left: 100%; margin-left: 8px; pointer-events: auto; text-shadow: none; }
@media (max-height: 500px) {
    .course-hud .course-hud-x { left: auto; right: 100%; margin: 0 8px 0 0; top: auto; bottom: 0; }
}
@media (max-height: 500px) {
    #ui:has(.rec-bar:not([hidden])) .course-hud { bottom: calc(var(--cinema-top, 96px) + 8px); }
}`;
const OLD_EDITOR = `@media (max-height: 500px) {
    body:has(.course-editor:not(.ce-flying)) [data-testid='walls-summary'] { pointer-events: none; border-color: transparent; background: none; list-style: none; }
}`;

const shortBlocks = (s: string): string => [...s.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join('\n');
const rule = (s: string, sel: RegExp): string => [...shortBlocks(s).matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => sel.test(m[1]!.trim())).map((m) => m[2]!).join(';');

const chip = (s: string): boolean => {
    const b = rule(s, /^\.course-hud$/);
    const x = rule(s, /^\.course-hud \.course-hud-x$/);
    return /display:\s*grid/.test(b) && /background:\s*rgba\(0, 0, 0, \.6\)/.test(b) && /position:\s*static/.test(x) && /grid-column:\s*2/.test(x);
};
const keyPlace = (s: string): boolean => {
    const k = rule(s, /^body:not\(\.touch-on\) \.course-hud$/);
    return /left:\s*max\(16px/.test(k) && /bottom:\s*auto/.test(k) && /max-width:\s*calc\(100vw \/ 3 - 32px\)/.test(k) && /--bake-bottom/.test(k) && /--course-push/.test(k);
};
const touchPlace = (s: string): boolean => {
    const t = rule(s, /^body\.touch-on \.course-hud$/);
    return /left:\s*50%/.test(t) && /top:\s*auto/.test(t) && /min\(40vw, 220px\)/.test(t);
};
const noStaleLift = (s: string): boolean => !/--cinema-top/.test(shortBlocks(s)) && !/\.rec-bar/.test(shortBlocks(s));
const summaryInert = (s: string): boolean => /\[data-testid='walls-summary'\]\s*\{[^}]*interactivity:\s*inert/.test(shortBlocks(s));

describe('course clock on a short view (clockfix F1)', () => {
    it('the text and the cross stand in one chip with one backdrop, the cross inside it', () => {
        expect(chip(css)).toBe(true);
        expect(chip(OLD)).toBe(false);
    });
    it('keyboard: the left column under the credit, the walls caption and the note, at most a third of the view wide', () => {
        expect(keyPlace(css)).toBe(true);
        expect(keyPlace(OLD)).toBe(false);
    });
    it('touch: the bottom middle between the stick pads', () => {
        expect(touchPlace(css)).toBe(true);
        expect(touchPlace(OLD)).toBe(false);
    });
    it('no value kept by a script (--cinema-top, the REC row) decides the place: no stale height after a rotation', () => {
        expect(noStaleLift(css)).toBe(true);
        expect(noStaleLift(OLD)).toBe(false);
    });
});

describe('the walls caption in the edit view on a short view (clockfix F2)', () => {
    it('takes no keyboard focus', () => {
        expect(summaryInert(editorCss)).toBe(true);
        expect(summaryInert(OLD_EDITOR)).toBe(false);
    });
});
