// Train 4, lane edit4a, stage A2 (C:/dev/.gsfpv-lanes/designs/edit4.md section 2): one gizmo with the move arrows, the size
// boxes and the turn rings on the gate at once. The owner (brief 543): "the arrows right there; I hover over the arrow I
// need and move; the little box on x, y, z is the scale; the meridians and parallels, I turn - as in an ordinary 3D editor."
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pressOwner } from '../../../apps/fly/src/course/editor/press-owner';
import { bandGap, HANDLE_PX, handleBands } from '../../../apps/fly/src/course/editor/handle-look';
import { handleTextKey, viewLocaleKeys, VIEW_TEXT_KEYS } from '../../../apps/fly/src/course/editor/view-texts';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const VIEW = read('apps/fly/src/course/editor/view-mouse.ts');
const BAR = read('apps/fly/src/course/editor/gate-bar.ts');
const COURSE = read('apps/fly/src/app/builtin/course.ts');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;

describe('edit4a A2: the press goes to the handle nearest the eye', () => {
    it('a ring in front of a box takes the press (the old order gave it to the box)', () => {
        // PRESS_ORDER: size, move, turn; distances from the eye, m
        expect(pressOwner([5, null, 3])).toBe(2);
        expect(pressOwner([3, null, 5])).toBe(0);
        expect(pressOwner([null, 4.2, 4.1])).toBe(2);
        expect(pressOwner([null, 4, null])).toBe(1);
        expect(pressOwner([null, null, null])).toBe(-1);
        expect(pressOwner([Number.NaN, 2, null])).toBe(1);
    });
    it('the view measures each gizmo\'s hit with its distance and asks pressOwner with the distances', () => {
        expect(VIEW).toMatch(/const own = pressOwner\(hits\.map\(\(s\) => s\?\.dist \?\? null\)\)/);
        expect(VIEW).toMatch(/function shapeHit\(g: HandleGizmo, cc: CameraComponent, x: number, y: number\)/);
        // the press and the hover tag follow the same rule (partAt)
        expect(VIEW.match(/this\.partAt\(e\.offsetX, e\.offsetY\)/g)?.length).toBe(2);
    });
});

describe('edit4a A2: the layout keeps boxes, rings and arrows apart', () => {
    it('size boxes inside, rings in the middle, arrows outside, at least 4 px between the bands', () => {
        const b = handleBands();
        expect(b.size[1]).toBeLessThan(b.turn[0]);
        expect(b.turn[1]).toBeLessThan(b.move[0]);
        expect(bandGap(b)).toBeGreaterThanOrEqual(4);
        // the edit4 design's units: boxes at 0.35, rings 0.6, arrows 0.75 to 1.15 of the gizmo's size
        expect([HANDLE_PX.sizeReach, HANDLE_PX.ringRadius, HANDLE_PX.moveGap, HANDLE_PX.moveReach]).toEqual([35, 60, 75, 115]);
    });
    it('the old one-tool layout (arrows and rings at 85 to 90 px) overlaps: the check fires on it', () => {
        expect(bandGap(handleBands({ ...HANDLE_PX, moveGap: 0, moveReach: 90, ringRadius: 85, sizeReach: 90 }))).toBeLessThan(0);
    });
    it('the arrows begin at moveGap; the size boxes sit at sizeReach with no line to them; no move planes', () => {
        expect(VIEW).toMatch(/move\.axisGap = units\(P\.moveGap\)/);
        expect(VIEW).toMatch(/size\.axisGap = units\(P\.sizeReach - P\.sizeBox - SIZE_STUB_PX\)/);
        expect(VIEW).toMatch(/for \(const a of \['yz', 'xz', 'xy'\] as const\) move\.enableShape\(a, false\)/);
    });
});

describe('edit4a A2: one gizmo, no tool buttons', () => {
    it('the gate bar has no Move, Turn, Size buttons', () => {
        expect(BAR).not.toMatch(/TOOLS|ce-tool|setTool/);
    });
    it('put() shows all three handles at once', () => {
        expect(VIEW).toMatch(/this\.showAll\(\);/);
        expect(VIEW).not.toMatch(/active\(\)/);
    });
});

describe('edit4a A2: hover names the part, a drag can be cancelled', () => {
    it('the tag says Move along X, Turn around Y, Size, in four languages', () => {
        expect(handleTextKey('move', 'x')).toEqual({ key: 'course.view.handle.move', vars: { axis: 'X' } });
        expect(handleTextKey('turn', 'y')).toEqual({ key: 'course.view.handle.turn', vars: { axis: 'Y' } });
        expect(handleTextKey('size', 'xyz').key).toBe('course.view.handle.size');
        for (const l of LANGS) {
            const j = JSON.parse(read(`packages/i18n/locales/fly/course-view/${l}.json`)) as Record<string, string>;
            expect(Object.keys(j).sort(), l).toEqual(viewLocaleKeys().sort());
            expect(j[VIEW_TEXT_KEYS.move], l).toMatch(/\{axis\}/);
            expect(j[VIEW_TEXT_KEYS.turn], l).toMatch(/\{axis\}/);
        }
    });
    it('the hover runs after the gizmos\' own pointermove, the cursor is a hand over a part', () => {
        expect(VIEW).toMatch(/this\.canvas\.addEventListener\('pointermove', this\.onHoverMove\)/);
        expect(VIEW).toMatch(/this\.canvas\.style\.cursor = part \? 'grab' : ''/);
    });
    it('Esc and a right click during a drag cancel it; the course goes back without an undo step', () => {
        expect(VIEW).toMatch(/e\.code === 'Escape' && this\.dragging[^]*?this\.cancelDrag\(\)/);
        expect(VIEW).toMatch(/e\.button === 2 && this\.dragging\) \{[^]*?this\.cancelDrag\(\)/);
        expect(VIEW).toMatch(/this\.emitDrag\('cancel', base\)/);
        expect(COURSE).toMatch(/e\.phase === 'cancel' \? dragCancel\(\)/);
        expect(COURSE).toMatch(/const dragCancel = \(\): void => \{[^]*?if \(dragBase\) ed = dragBase;/);
    });
    it('Esc in a drag only cancels it: the editor\'s own key listener (registered first) leaves it to the view', () => {
        // review of lane edit4a: the probe's step R.escTwice on the build of 26d94483: the second drag cancelled by Esc
        // closed the editor (the first had armed 'Esc again leaves without saving'), the pilot's changes were dropped
        const i = COURSE.indexOf("addEventListener('keydown', (e: KeyboardEvent) => {");
        expect(i).toBeGreaterThan(0);
        const body = COURSE.slice(i, COURSE.indexOf('applyKey(e);', i));
        const guard = body.search(/if \(e\.code === 'Escape' && view\?\.isDragging\(\)\) return;/);
        expect(guard).toBeGreaterThan(0);
        expect(guard).toBeLessThan(body.indexOf('keyRoute('));
        expect(VIEW).toMatch(/e\.code === 'Escape' && this\.dragging && !this\.suspended\) \{\s*e\.preventDefault\(\);\s*e\.stopImmediatePropagation\(\);\s*this\.cancelDrag\(\);/);
    });
});
