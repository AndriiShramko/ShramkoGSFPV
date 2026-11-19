// Lane editor3 stage G2 (docs/wip/editor3.md): the gate bar after a drag, Space disarms a keyboard pilot inside the edit
// mode, the floor-added gate faces along the course, and the opening line names one set of handles at a time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { barAnchor } from '../../../apps/fly/src/course/editor/bar-place';
import { ADD_FLOOR_M, addFacing, addLift, facingFrom } from '../../../apps/fly/src/course/editor/add-place';

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
        expect(view).toMatch(/if \(!this\.dragging\) return;\s+const p = this\.pose\(this\.openingAtStart\);\s+host\.onDrag\(p, false\)/);
        expect(view).toMatch(/this\.endStale\(\);/);
        // measured in the G2 REPRO run: the bar's place read only the Move set's nodes, so Turn or Size hid the bar
        const ss = view.slice(view.indexOf('standScreen(): '), view.indexOf('standScreen(): ') + 400);
        expect(ss).not.toMatch(/handles\[0\]\?\.nodes\.length/);
        expect(ss).toMatch(/this\.handles\.some\(\(h\) => h\.nodes\.length > 0\)/);
    });

    it('Space while the course is flown in the edit mode stops the motors of a keyboard pilot (the edit view comes back)', () => {
        const kb = read('apps/fly/src/devices/keyboard.ts');
        expect(kb).toMatch(/EDIT_FLYING = '\.course-editor\.ce-flying'/);
        const i = kb.indexOf("e.code === 'Space' && editModeFlying()");
        const j = kb.indexOf('if (this.isGame) { this.onDownGame(e); return; }');
        expect(i).toBeGreaterThan(0);
        expect(j).toBeGreaterThan(i);
        // train 3 I2 (D8): the press only marks the time and climbs; the short tap's keyup stops the motors
        expect(kb.slice(i, j)).toMatch(/this\.editSpaceAt = e\.timeStamp/);
        expect(kb).toMatch(/if \(tap\) this\.game!\.pilot\.arm\.stop\(\)/);
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

    it('a floor-added gate clears the floor by the walls check margin with its frame (g2/full3 Wroclaw: gate 1 is in a wall)', () => {
        const margin = 0.5;
        for (const shape of [{ kind: 'ring', diameter: 1.2, tube: 0.1 }, { kind: 'square', side: 1.5, bar: 0.12 }] as const) {
            for (const s of [1, 2]) {
                const state = { course: { gates: [{ id: 'g0', shape, pos: [0, 0, 0], quat: [1, 0, 0, 0], direction: 'forward' }] }, selected: 0, undo: [], redo: [], problems: [] } as unknown as Parameters<typeof addLift>[0];
                const lift = addLift(state, [s, 0, 0, 0], margin);
                const half = shape.kind === 'ring' ? shape.diameter / 2 + shape.tube : shape.side / 2 + shape.bar / 2;
                // the frame's lowest point over a flat floor, minus the check's sphere: still in the air
                expect(lift - half * s - margin).toBeGreaterThanOrEqual(ADD_FLOOR_M - 1e-9);
                expect(ADD_FLOOR_M).toBeGreaterThan(0);
            }
        }
        // the camera stays where the pilot clicked from: placeAt does not move it (H2's aim() put the eye at the drone)
        const course = read('apps/fly/src/app/builtin/course.ts');
        const i = course.indexOf('const placeAt = (ray: Ray): void => {');
        const j = course.indexOf('const editFrame = (): void => {');
        expect(i).toBeGreaterThan(0);
        expect(j).toBeGreaterThan(i);
        expect(course.slice(i, j)).not.toMatch(/\baim\(\);/);
        expect(course.slice(i, j)).toMatch(/addLift\(ed, flownTransform\(\), edMargin\)/);
    });

    it('a click ray comes from the edit camera, not from the renderer entity (g2/floor3: the drone pose after a test flight)', async () => {
        const fc = (await import('../../../apps/fly/src/course/editor/fly-cam')) as unknown as Record<string, unknown>;
        const camRay = fc['camRay'] as ((c: unknown, x: number, y: number, w: number, h: number, fov: number, hor: boolean) => { o: number[]; d: number[] } | null) | undefined;
        expect(typeof camRay).toBe('function');
        const cam = { pos: [9.45, 7.03, 0.13], yaw: 0.8, pitch: -0.3, speed: 4 };
        const fwd = (fc['camForward'] as (c: unknown) => number[])(cam);
        // the centre of the canvas: the edit camera's eye, along its forward
        const mid = camRay!(cam, 960, 540, 1920, 1080, 60, false)!;
        expect(mid.o).toEqual([9.45, 7.03, 0.13]);
        for (let i = 0; i < 3; i++) expect(mid.d[i]).toBeCloseTo(fwd[i]!, 9);
        // the bottom edge: half the vertical field of view below the forward
        const low = camRay!(cam, 960, 1080, 1920, 1080, 60, false)!;
        const cosA = low.d.reduce((s, v, i) => s + v * fwd[i]!, 0);
        expect((Math.acos(cosA) * 180) / Math.PI).toBeCloseTo(30, 6);
        expect(low.d[1]!).toBeLessThan(mid.d[1]!);
        // a horizontal field of view: the right edge is half of it to the side, on the same height
        const right = camRay!({ ...cam, pitch: 0 }, 1920, 540, 1920, 1080, 90, true)!;
        expect(right.d[1]).toBeCloseTo(0, 9);
        const f0 = (fc['camForward'] as (c: unknown) => number[])({ ...cam, pitch: 0 });
        expect((Math.acos(right.d.reduce((s, v, i) => s + v * f0[i]!, 0)) * 180) / Math.PI).toBeCloseTo(45, 6);
        // the view builds the click ray with it, and gives the entity its pose before the gizmos pick
        const view = read('apps/fly/src/course/editor/view-mouse.ts');
        // train 4 edit4a A1: one helper builds every ray of the view (the click, the double click, the orbit pivot, the dolly)
        expect(view).toMatch(/const ray = this\.rayAt\(/);
        expect(view).toMatch(/return camRay\(this\.cam, /);
        expect(view).not.toMatch(/cc\.screenToWorld\(/);
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
