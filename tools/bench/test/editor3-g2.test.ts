// Lane editor3 stage G2 (docs/wip/editor3.md): the gate bar after a drag, Space disarms a keyboard pilot inside the edit
// mode, the floor-added gate faces along the course, and the opening line names one set of handles at a time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { barAnchor } from '../../../apps/fly/src/course/editor/bar-place';
import { addFacing, facingFrom } from '../../../apps/fly/src/course/editor/add-place';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('editor3 G2', () => {
    it('the gate bar hides only while a handle really drags, and the pointerup is seen whoever stops it', () => {
        const at = [10, 20, 1] as const;
        expect(barAnchor(false, false, at)).toBe(at);
        expect(barAnchor(false, true, at)).toBeNull();
        expect(barAnchor(true, false, at)).toBeNull();
        const bar = read('apps/fly/src/course/editor/gate-bar.ts');
        expect(bar).toMatch(/barAnchor\(this\.hidden, this\.host\.dragging\(\), this\.host\.where\(\)\)/);
        const course = read('apps/fly/src/app/builtin/course.ts');
        // the hide flag is no longer set by a drag (a stale transform:move left it set after the pointerup)
        expect(course).not.toMatch(/bar\?\.hide\(!end\)/);
        expect(course).toMatch(/dragging: \(\) => view\?\.isDragging\(\)/);
        const view = read('apps/fly/src/course/editor/view-mouse.ts');
        // a gizmo's own pointerup stops propagation over its shapes: the view listens in the capture phase
        expect(view).toMatch(/addEventListener\('pointerup', this\.onUpCapture, true\)/);
        expect(view).toMatch(/addEventListener\('pointercancel', this\.onUpCapture, true\)/);
        expect(view).not.toMatch(/addEventListener\('pointerup', this\.onUp\)/);
        // a move from a gizmo that kept its axis is not a drag; a kept axis is ended on the up
        expect(view).toMatch(/if \(this\.dragging\) host\.onDrag\(this\.pose\(this\.openingAtStart\), false\)/);
        expect(view).toMatch(/this\.endStale\(\);/);
    });

    it('Space while the course is flown in the edit mode stops the motors of a keyboard pilot (the edit view comes back)', () => {
        const kb = read('apps/fly/src/devices/keyboard.ts');
        expect(kb).toMatch(/EDIT_FLYING = '\.course-editor\.ce-flying'/);
        const i = kb.indexOf("e.code === 'Space' && editModeFlying()");
        const j = kb.indexOf('if (this.isGame) { this.onDownGame(e); return; }');
        expect(i).toBeGreaterThan(0);
        expect(j).toBeGreaterThan(i);
        expect(kb.slice(i, j)).toMatch(/this\.game!\.pilot\.arm\.stop\(\)/);
    });

    it('a floor-added gate faces along the course (from the selected gate), not at the camera', () => {
        const prev: [number, number, number] = [0, 0, 0];
        const at: [number, number, number] = [0, 0, -10];
        const eye: [number, number, number] = [5, 1.6, -10];
        const q = addFacing(eye, at, prev);
        // the way from gate to gate is -Z: unturned
        expect(q[0]).toBeCloseTo(1, 6);
        expect(q[2]).toBeCloseTo(0, 6);
        // upright: turned about the vertical only
        expect(q[1]).toBe(0);
        expect(q[3]).toBe(0);
        // no selected gate (or one right above): the way from the eye, as before
        expect(addFacing(eye, at, null)).toEqual(facingFrom(eye, at));
        expect(addFacing(eye, at, [0, 5, -10.2])).toEqual(facingFrom(eye, at));
    });

    it('the opening line names one set of handles at a time and Move, Turn, Size on the bar, in en, es, pl, ru', () => {
        const words: Record<string, string[]> = {
            en: ['one set of handles', 'Move', 'Turn', 'Size', 'Space'],
            es: ['un solo juego de controles', 'Mover', 'Girar', 'Tama\u00f1o', 'Espacio'],
            pl: ['jeden zestaw uchwyt\u00f3w', 'Przesu\u0144', 'Obr\u00f3\u0107', 'Rozmiar', 'Spacja'],
            ru: ['\u043e\u0434\u0438\u043d \u043d\u0430\u0431\u043e\u0440 \u0440\u0443\u0447\u0435\u043a', '\u0421\u0434\u0432\u0438\u043d\u0443\u0442\u044c', '\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c', '\u0420\u0430\u0437\u043c\u0435\u0440', '\u041f\u0440\u043e\u0431\u0435\u043b']
        };
        for (const [lang, want] of Object.entries(words)) {
            const s = (JSON.parse(read(`packages/i18n/locales/fly/course/${lang}.json`)) as Record<string, string>)['course.edit.opened'] ?? '';
            for (const w of want) expect(s, lang + ': ' + w).toContain(w);
            expect(s).toContain('M, R, T');
            expect(s).not.toMatch(/\d/);
        }
    });
});
