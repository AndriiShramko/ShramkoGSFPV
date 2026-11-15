// Lane editor3, stage fixes (train 3): review EJ-1 to EJ-5 of the J stages. EJ-1 the probes' hit test and measure project
// with the edit view's camera (as the press does); EJ-2 the reframe after a drag only for a gate that left the middle;
// EJ-3 the dragged handle back to its axis colour at the drag's end; EJ-4 an arrow near the edit eye thinner still;
// EJ-5 the arrows' walk starts at the course stage's root, not at the whole scene.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overMiddle, reframeOnDragEnd } from '../../../apps/fly/src/course/editor/frame';
import { ARROW_NEAR_M, nearShare, shareArrows, STAGE_NAME, type ScaleNode } from '../../../apps/fly/src/course/editor/arrow-share';

const ROOT = join(__dirname, '..', '..', '..');
const src = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const body = (s: string, head: string): string => {
    const at = s.indexOf(head);
    expect(at).toBeGreaterThan(-1);
    return s.slice(at, s.indexOf('\n    }\n', at));
};

describe('EJ-1: hitAt and measure project with the edit view camera before they pick', () => {
    it('both call apply() first, as onOwnPress does', () => {
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        const hit = body(vm, '    hitAt(x: number, y: number');
        expect(hit.indexOf('this.apply()')).toBeGreaterThan(-1);
        expect(hit.indexOf('this.apply()')).toBeLessThan(hit.indexOf('pickRing('));
        expect(hit.indexOf('this.apply()')).toBeLessThan(hit.indexOf('_getSelection'));
        const me = body(vm, '    measure(): Record<string, unknown> | null {');
        expect(me.indexOf('this.apply()')).toBeGreaterThan(-1);
        expect(me.indexOf('this.apply()')).toBeLessThan(me.indexOf('worldToScreen'));
    });
});

describe('EJ-2: the view frames the gate again only when the drag took it out of the middle', () => {
    const inside = [700, 300, 1220, 780] as const;
    const outside = [440, 60, 1480, 1020] as const;
    it('inside before and outside after: framed; outside both (flown close): kept; inside both: kept', () => {
        expect(reframeOnDragEnd(inside, outside, 1920, 1080)).toBe(true);
        expect(reframeOnDragEnd(outside, outside, 1920, 1080)).toBe(false);
        expect(reframeOnDragEnd(outside, [400, 50, 1500, 1030], 1920, 1080)).toBe(false);
        expect(reframeOnDragEnd(inside, inside, 1920, 1080)).toBe(false);
        expect(reframeOnDragEnd(inside, null, 1920, 1080)).toBe(true);
    });
    it('pass 3: a drag that pushed a gate already a little past the middle far out frames it (Tunis size 1.2 -> 2.4 m)', () => {
        // the boxes measured by editor3-prove.ts on Tunis 887f27aa (fx3b/tunis e4.json scale.0.reframe)
        expect(reframeOnDragEnd([735, 18.7, 1193, 511], [182, -742, 1461, 676], 1920, 1080)).toBe(true);
        // a gate flown close (past the middle on all sides) and nudged: kept
        expect(reframeOnDragEnd([100, 50, 1800, 1030], [150, 40, 1850, 1020], 1920, 1080)).toBe(false);
        expect(overMiddle([700, 300, 1220, 780], 1920, 1080)).toBe(0);
        expect(overMiddle(null, 1920, 1080)).toBe(Infinity);
    });
    it('course.ts takes the box when the drag begins and frames only a drag that changed the gate', () => {
        const c = src('apps/fly/src/app/builtin/course.ts');
        expect(c).toMatch(/if \(!dragBase\) dragBox = view\?\.gateBox\(\)\?\.box \?\? null;\s*const base = dragBase \?\? ed;/);
        expect(c).toMatch(/const re = !!\(st && gb && reframeOnDragEnd\(before, gb\.box, gb\.w, gb\.h\)\);/);
        expect(c).toMatch(/if \(re\) frameSel\(\);/);
    });
    it('pass 2: gateBox and debug project with the edit view camera (a drag starts between frames)', () => {
        const v = src('apps/fly/src/course/editor/view-mouse.ts');
        const gb = body(v, 'gateBox(): {');
        expect(gb.indexOf('this.apply()')).toBeGreaterThan(-1);
        expect(gb.indexOf('this.apply()')).toBeLessThan(gb.indexOf('worldToScreen'));
        const db = body(v, 'debug(): Record');
        expect(db.indexOf('this.apply()')).toBeGreaterThan(-1);
        expect(db.indexOf('this.apply()')).toBeLessThan(db.indexOf('worldToScreen'));
    });
});

describe('EJ-3: a handle back to its axis colour when its drag ends', () => {
    it('transform:end clears the gizmo hover', () => {
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        const at = vm.indexOf("h.on('transform:end'");
        expect(at).toBeGreaterThan(-1);
        expect(vm.slice(at, at + 600)).toMatch(/_hover\?\.\(\);/);
    });
});

class N implements ScaleNode {
    children: N[] = [];
    sc = { x: 0.06, y: 0.06, z: 0.5 };
    constructor(readonly name: string, readonly pos = { x: 0, y: 0, z: 0 }) {}
    getLocalScale(): { x: number; y: number; z: number } { return this.sc; }
    setLocalScale(x: number, y: number, z: number): void { this.sc = { x, y, z }; }
    getPosition(): { x: number; y: number; z: number } { return this.pos; }
}

describe('EJ-4: an arrow near the edit eye thinner than a third', () => {
    it('nearShare: 1 from ARROW_NEAR_M on, a third at 2 m of 6, never under its least share', () => {
        expect(nearShare(ARROW_NEAR_M)).toBe(1);
        expect(nearShare(20)).toBe(1);
        expect(nearShare(2)).toBeCloseTo(2 / ARROW_NEAR_M, 6);
        expect(nearShare(2)).toBeLessThan(0.5);
        expect(nearShare(0)).toBeGreaterThan(0);
    });
    it('with the eye given, the arrow 2 m away is thinner than the one 10 m away; without, both a third', () => {
        const stage = new N(STAGE_NAME);
        const near = new N('course-chevron', { x: 2, y: 0, z: 0 });
        const far = new N('course-chevron', { x: 10, y: 0, z: 0 });
        stage.children.push(near, far);
        expect(shareArrows(stage, 1 / 3, [0, 0, 0])).toBe(2);
        expect(far.sc.x).toBeCloseTo(0.02, 6);
        expect(near.sc.x).toBeLessThan(far.sc.x * 0.5);
        expect(near.sc.z).toBe(0.5);
        shareArrows(stage, 1 / 3);
        expect(near.sc.x).toBeCloseTo(0.02, 6);
        shareArrows(stage, 1);
        expect(near.sc.x).toBeCloseTo(0.06, 6);
    });
});

describe('EJ-5: the arrows walk starts at the course stage, not at the whole scene', () => {
    it('course.ts walks only the children of the app root named as the stage', () => {
        const c = src('apps/fly/src/app/builtin/course.ts');
        expect(STAGE_NAME).toBe('course-stage');
        expect(src('apps/fly/src/course/view.ts')).toContain("new Entity('course-stage'");
        expect(c).toMatch(/\.children\.filter\(\(c\) => c\.name === STAGE_NAME\)/);
        expect(c).not.toMatch(/shareArrows\(root,/);
    });
});
