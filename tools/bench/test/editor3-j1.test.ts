// Lane editor3, stage J1-fix (train 3, E1 to E5): the view frames the gate again after a drag that left it outside the
// middle of the view, the Size handle's axes per gate kind, every turn ring turned by a drag along it, one mark (yellow) for
// the selected gate, the course's arrows thinner in the edit view.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDIT_ARROW_SHARE, sizeAxes } from '../../../apps/fly/src/course/editor/handle-look';
import { minorAxis, pickRing, ringDeg, type P2 } from '../../../apps/fly/src/course/editor/ring-pick';
import { editPaints } from '../../../apps/fly/src/course/editor/rules';
import { shareArrows, type ScaleNode } from '../../../apps/fly/src/course/editor/arrow-share';

const ROOT = join(__dirname, '..', '..', '..');
const src = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// Train 4 lane edit4a A1 replaced this J1 E1 (the view framed the gate again after a drag): the owner, brief 547, "when I move
// an obstacle, why move my view? No 3D editor does that". tools/bench/test/edit4a-camera.test.ts holds the new rule.
describe('E1 (train 4 edit4a): a drag never moves the view', () => {
    it('course.ts and frame.ts have no reframe after a drag', () => {
        const c = src('apps/fly/src/app/builtin/course.ts');
        const f = src('apps/fly/src/course/editor/frame.ts');
        expect(c).not.toMatch(/reframeOnDragEnd\(|if \(re\) frameSel\(\);/);
        expect(f).not.toMatch(/export function reframe/);
    });
});

describe('E2: the Size handle along the gate own sizes', () => {
    it('a ring has one pair of handles (its width), a square two, a cube frame three', () => {
        expect(sizeAxes('ring')).toEqual(['x']);
        expect(sizeAxes('square')).toEqual(['x', 'y']);
        expect(sizeAxes('cube-frame')).toEqual(['x', 'y', 'z']);
    });
    it('the view switches the other lines off per gate and the centre cube lights only itself', () => {
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        expect(vm).toMatch(/const on = sizeAxes\(this\.kind\)/);
        expect(vm).toMatch(/if \(sg\._hoverAxis !== 'xyz'\) return;/);
        expect(src('apps/fly/src/app/builtin/course.ts')).toMatch(/eg \? eg\.id : null, eg \? eg\.shape\.kind : null\)/);
    });
});

describe('E3: every turn ring is turned by a drag along it', () => {
    // a ring seen facing: a circle of 85 px round the page centre, its points in the order a positive turn moves them
    const face: P2[] = Array.from({ length: 64 }, (_, k) => [960 + 85 * Math.cos((k / 64) * 2 * Math.PI), 540 + 85 * Math.sin((k / 64) * 2 * Math.PI)] as P2);
    const ring = { pts: face, minor: minorAxis(face, [960, 540]) };
    it('a facing ring is picked with the default parameters and 100 px along its tangent turns it at least 20 deg', () => {
        expect(ring.minor).toBeGreaterThan(100);
        // pressed at its right side (the y ring at its side: the drag along it is nearly vertical on the page)
        const pick = pickRing([1045, 540], [ring]);
        expect(pick).not.toBeNull();
        expect(pick!.edge).toBe(false);
        // the tangent there points down the page (the order of the points)
        const deg = ringDeg(pick!.dir, 0, 100);
        expect(deg).toBeGreaterThanOrEqual(20);
        expect(ringDeg(pick!.dir, 0, -100)).toBeCloseTo(-deg, 9);
        // a drag across the ring (along the radius) turns it little
        expect(Math.abs(ringDeg(pick!.dir, 100, 0))).toBeLessThan(5);
    });
    it('an edge-on ring keeps its turn across the line (EI-4)', () => {
        const line: P2[] = Array.from({ length: 64 }, (_, k) => [960 + 85 * Math.cos((k / 64) * 2 * Math.PI), 540] as P2);
        const p = pickRing([1000, 544], [{ pts: line, minor: minorAxis(line, [960, 540]) }])!;
        expect(p.edge).toBe(true);
        expect(Math.abs(ringDeg(p.dir, 0, 60))).toBeCloseTo(30, 6);
        expect(ringDeg(p.dir, 80, 0)).toBeCloseTo(0, 6);
    });
});

describe('E4: one mark for the selected gate in every tool', () => {
    it('the selected gate is yellow also when the check refuses it; red only the others', () => {
        const ids = ['g1', 'g2', 'g3'];
        const probs = [{ code: 'gate-wall' as const, gate: 'g2', freeM: 0.1 }, { code: 'gate-wall' as const, gate: 'g3', freeM: 0.1 }];
        expect(editPaints(ids, 1, probs)).toEqual(['later', 'selected', 'bad']);
    });
});

describe('E5: the course arrows at a third of their width in the edit view', () => {
    const node = (name: string, children: ScaleNode[] = [], s: [number, number, number] = [0.05, 0.05, 0.6]): ScaleNode & { s: number[] } => {
        const n = { name, children, s: [...s], getLocalScale: () => ({ x: n.s[0]!, y: n.s[1]!, z: n.s[2]! }), setLocalScale: (x: number, y: number, z: number) => { n.s = [x, y, z]; } };
        return n;
    };
    it('scales x and y of every arrow to the share and back to full', () => {
        expect(EDIT_ARROW_SHARE).toBeCloseTo(1 / 3, 9);
        const a = node('course-chevron');
        const b = node('course-chevron');
        const gate = node('course-gate', [], [1, 1, 1]);
        const root = node('root', [node('course-stage', [gate, node('course-arrows', [a, b])])]);
        expect(shareArrows(root, EDIT_ARROW_SHARE)).toBe(2);
        expect(a.s[0]).toBeCloseTo(0.05 / 3, 9);
        expect(a.s[1]).toBeCloseTo(0.05 / 3, 9);
        expect(a.s[2]).toBeCloseTo(0.6, 9);
        expect(gate.s).toEqual([1, 1, 1]);
        // twice in a row does not shrink it again
        shareArrows(root, EDIT_ARROW_SHARE);
        expect(b.s[0]).toBeCloseTo(0.05 / 3, 9);
        shareArrows(root, 1);
        expect(a.s).toEqual([0.05, 0.05, 0.6]);
    });
    it('course.ts thins them in the edit view, not in its test flight, and puts them back after', () => {
        const c = src('apps/fly/src/app/builtin/course.ts');
        expect(c).toMatch(/const thin = mode !== 'fly';/);
        // review EJ-4, EJ-5: per course stage root, with the edit eye (test editor3-fixes3)
        expect(c).toMatch(/shareArrows\(r, thin \? EDIT_ARROW_SHARE : 1, thin \?/);
    });
});
