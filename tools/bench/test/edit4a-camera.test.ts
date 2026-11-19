// Lane edit4a, stage A1 (docs/wip/edit4a.md, design C:/dev/.gsfpv-lanes/designs/edit4.md section 2): the edit view moves only
// when the pilot moves it (E1, brief 543 and 547: "why move my view when I move an obstacle? No 3D editor does that"), and it
// moves as in Blender and the SuperSplat editor (E3, brief 545): a left drag on empty space or a middle drag circles round,
// Shift slides, the wheel and a touch pad's scroll or pinch go to the point under the cursor, Home shows the whole course.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    DOLLY_MIN_M,
    DOLLY_SHARE,
    DOLLY_STOP_M,
    camBasis,
    camForward,
    camFrom,
    dollyCam,
    orbitCam,
    panCam,
    wheelNotches,
    type FlyCam,
    type V3
} from '../../../apps/fly/src/course/editor/fly-cam';
import { boundsOf, frameBox, OVERVIEW_DOWN_DEG } from '../../../apps/fly/src/course/editor/frame';
import { CLICK_SLOP_PX, pressNav } from '../../../apps/fly/src/course/editor/view-mouse';

const SRC = join(__dirname, '../../../apps/fly/src');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** the pivot in the view's own frame (right, up, forward), unit: where it is on the screen */
const onScreen = (c: FlyCam, p: V3): number[] => {
    const b = camBasis(c);
    const v = sub(p, c.pos);
    const n = Math.hypot(v[0], v[1], v[2]);
    return [dot(v, b.r) / n, dot(v, b.u) / n, dot(v, b.f) / n];
};

describe('edit4a A1: orbit, pan and dolly (fly-cam.ts, pure)', () => {
    const c0 = camFrom([0, 5, 10], [0, 1, 0]);
    const pivot: V3 = [0, 1, 0];

    it('an orbit keeps the distance to the pivot and its place on the screen', () => {
        let c = c0;
        const d0 = dist(c.pos, pivot);
        const s0 = onScreen(c, pivot);
        for (const [dx, dy] of [[200, 0], [0, 60], [-120, -40], [35, 15]] as const) c = orbitCam(c, pivot, dx, dy);
        expect(Math.abs(dist(c.pos, pivot) - d0) / d0).toBeLessThan(0.02);
        const s1 = onScreen(c, pivot);
        for (let i = 0; i < 3; i++) expect(s1[i]!).toBeCloseTo(s0[i]!, 5);
        expect(dist(c.pos, c0.pos)).toBeGreaterThan(1);
    });

    it('an orbit around a pivot off the centre of the view keeps it where it was on the screen', () => {
        const off: V3 = [3, 0, -2];
        const s0 = onScreen(c0, off);
        const c = orbitCam(c0, off, 150, -30);
        const s1 = onScreen(c, off);
        for (let i = 0; i < 3; i++) expect(s1[i]!).toBeCloseTo(s0[i]!, 5);
    });

    it('a drag to the right turns the view right as it circles (Blender: the scene follows the hand)', () => {
        const c = orbitCam(c0, pivot, 100, 0);
        expect(c.yaw).toBeGreaterThan(c0.yaw);
        // the eye went to the left of where it stood, seen from the pivot (the view's old right is -x here)
        expect(c.pos[0]).toBeLessThan(c0.pos[0]);
    });

    it('a pan keeps the heading and moves a point at the pivot distance with the pointer', () => {
        const d = dist(c0.pos, pivot);
        const tanV = Math.tan((30 * Math.PI) / 180);
        const c = panCam(c0, 100, 0, d, tanV, 730);
        expect(c.yaw).toBe(c0.yaw);
        expect(c.pitch).toBe(c0.pitch);
        const moved = dist(c.pos, c0.pos);
        expect(moved).toBeCloseTo((100 * 2 * d * tanV) / 730, 6);
        // the eye goes left when the hand goes right (the scene follows the pointer)
        expect(dot(sub(c.pos, c0.pos), camBasis(c0).r)).toBeLessThan(0);
    });

    it('a dolly notch goes DOLLY_SHARE of the way to the point under the cursor, the heading stays', () => {
        const at: V3 = [0, 5, 0];
        const c = dollyCam(c0, at, -1);
        expect(dist(c.pos, at)).toBeCloseTo(10 * (1 - DOLLY_SHARE), 6);
        expect(c.yaw).toBe(c0.yaw);
        expect(c.pitch).toBe(c0.pitch);
        const back = dollyCam(c0, at, 1);
        expect(dist(back.pos, at)).toBeGreaterThan(10);
    });

    it('a dolly never goes through the point: it stops DOLLY_STOP_M before it', () => {
        const at: V3 = [0, 5, 0];
        let c = c0;
        for (let i = 0; i < 100; i++) c = dollyCam(c, at, -3);
        expect(dist(c.pos, at)).toBeCloseTo(DOLLY_STOP_M, 6);
        // the eye stays on the near side
        expect(c.pos[2]).toBeGreaterThan(0);
        // close by, a notch is still at least DOLLY_MIN_M
        const near = camFrom([0, 5, 1], [0, 5, 0]);
        expect(dist(dollyCam(near, [0, 5, -5], -1).pos, near.pos)).toBeCloseTo(Math.max(DOLLY_MIN_M, 6 * DOLLY_SHARE), 6);
    });

    it('a mouse notch is one, a touch pad scroll a share of one, a pinch (ctrlKey) is stronger, a flick is capped', () => {
        expect(wheelNotches(-100, 0, false)).toBe(-1);
        expect(wheelNotches(3, 1, false)).toBe(1);
        expect(wheelNotches(-12, 0, false)).toBeCloseTo(-0.12, 6);
        expect(Math.abs(wheelNotches(-12, 0, true))).toBeGreaterThan(Math.abs(wheelNotches(-12, 0, false)));
        expect(wheelNotches(-5000, 0, false)).toBe(-3);
        expect(wheelNotches(0, 0, false)).toBe(0);
    });
});

describe('edit4a A1: what a press does (view-mouse.ts pressNav)', () => {
    it('a left press is a click until it moves, then an orbit; Shift makes it a pan', () => {
        expect(pressNav(0, CLICK_SLOP_PX, false, 'click')).toBe('click');
        expect(pressNav(0, CLICK_SLOP_PX + 1, false, 'click')).toBe('orbit');
        expect(pressNav(0, CLICK_SLOP_PX + 1, true, 'click')).toBe('pan');
        // once moving, Shift switches between the two without a new press
        expect(pressNav(0, 1, true, 'orbit')).toBe('pan');
    });

    it('the middle button circles at once (Shift slides), the right button looks round as before', () => {
        expect(pressNav(1, 0, false, 'orbit')).toBe('orbit');
        expect(pressNav(1, 0, true, 'orbit')).toBe('pan');
        expect(pressNav(2, 50, true, 'look')).toBe('look');
    });
});

describe('edit4a A1: Home shows the whole course (frame.ts frameBox)', () => {
    it('every gate lies inside the view, looking down OVERVIEW_DOWN_DEG along the pilot heading', () => {
        const gates: V3[] = [[0, 1, 0], [20, 2, -5], [35, 1, 12], [-8, 3, 30], [10, 1.5, 18]];
        const b = boundsOf(gates, 1)!;
        const tanHalf = Math.tan((35 * Math.PI) / 180);
        const c = frameBox(camFrom([50, 2, 50], [51, 2, 49]), b.centre, b.radius, tanHalf);
        expect((c.pitch * 180) / Math.PI).toBeCloseTo(-OVERVIEW_DOWN_DEG, 6);
        expect(c.yaw).toBeCloseTo(camFrom([50, 2, 50], [51, 2, 49]).yaw, 9);
        const f = camForward(c);
        for (const g of gates) {
            const v = sub(g, c.pos);
            const cos = dot(v, f) / Math.hypot(v[0], v[1], v[2]);
            expect(Math.acos(cos)).toBeLessThan(Math.atan(tanHalf));
        }
        expect(c.pos[1]).toBeGreaterThan(b.centre[1]);
        expect(boundsOf([])).toBeNull();
    });
});

describe('edit4a A1: the view moves only when the pilot moves it (source)', () => {
    // the code only: the comments may name what was removed
    const course = read('app/builtin/course.ts').replace(/^\s*\/\/.*$/gm, '');
    const view = read('course/editor/view-mouse.ts');

    it('course.ts frames a gate only on the pilot own F, Numpad . or double click (the onFrame binding)', () => {
        // the old code framed on every new selection (showEd), after Tab, Delete, duplicate (applyKey aim), a refused Save
        // (showWrong aim) and after a drag that left the middle of the view (reframeOnDragEnd)
        // int4 (the seam of edit4a and edit4b): the second call is the seam's frameSelection, which only the click on
        // edit4b's arrow to a gate out of view asks for (course/editor/parts/point.ts): the pilot's own press as well
        expect(course.match(/frameSel\(\)/g) ?? []).toHaveLength(2);
        expect(course).toMatch(/onFrame: \(\) => frameSel\(\)/);
        expect(course).toMatch(/bus\.provide\('frameSelection', \(\) => \{ frameSel\(\); \}\)/);
        const point = read('course/editor/parts/point.ts').replace(/^\s*\/\/.*$/gm, '');
        expect(point.match(/call\('frameSelection'\)/g) ?? []).toHaveLength(1);
        expect(course).not.toMatch(/\baim\(\)/);
        expect(course).not.toMatch(/reframeOnDragEnd|framedId/);
    });

    it('the wheel with the right button held sets the speed; a plain wheel goes to the point under the cursor', () => {
        const w = view.slice(view.indexOf('private onWheel'), view.indexOf('private setSnap'));
        expect(w).toMatch(/\(e\.buttons & 2\) !== 0 \|\| this\.press\?\.button === 2\) \{\s*const s = wheelSpeed/);
        expect(w).toMatch(/dollyCam\(this\.cam, at, n\)/);
        expect(w.indexOf('wheelSpeed')).toBeLessThan(w.indexOf('dollyCam'));
    });

    it('Home frames the whole course, Numpad . and a double click frame the selected gate', () => {
        expect(view).toMatch(/e\.code === 'Home'\) this\.frameAll\(\)/);
        expect(view).toMatch(/e\.code === 'NumpadDecimal'/);
        expect(view).toMatch(/addEventListener\('dblclick', this\.onDouble\)/);
        expect(view).toMatch(/this\.host\.onPick\(i\);\s*this\.host\.onFrame\?\.\(\);/);
    });
});
