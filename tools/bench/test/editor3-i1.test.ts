// Lane editor3, stage I1 (train 3, decisions D1 to D4 in docs/wip/editor3.md): the edit view frames the selected gate as an
// ordinary 3D editor does (a third of the view high, 35 degrees aside, 20 above; free of walls by the order of fallbacks; F
// frames again), the handles are small and saturated (no part over 16 px but lines and rings), the selected gate is drawn
// bright yellow, and a turn ring seen edge-on is taken within 10 px of its line and turns by the travel across it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blendCam, frameDistance, frameDistances, frameGate, FRAME_MIN_SIZES, type RayFn, type V3 } from '../../../apps/fly/src/course/editor/frame';
import { AXIS_RGB, gizmoSize, HANDLE_PX, PART_MAX_PX, UNIT_PX } from '../../../apps/fly/src/course/editor/handle-look';
import { minorAxis, pickRing, ringTurnDeg, RING_DEG_PER_PX, type P2 } from '../../../apps/fly/src/course/editor/ring-pick';
import * as rp from '../../../apps/fly/src/course/editor/ring-pick';
import { CAM_ROWS } from '../../../apps/fly/src/course/editor/keys';

const ROOT = join(__dirname, '..', '..', '..');
const src = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const DEG = 180 / Math.PI;
// a 16:9 view with the page's 115 degree horizontal field: tan of half the vertical field
const TAN_V = Math.tan((115 * Math.PI) / 360) * (1080 / 1920);
const gate = { centre: [2, 1.5, -4] as V3, axis: [0, 0, 1] as V3, size: 1.6, tanHalfV: TAN_V, from: [2, 2, 20] as V3 };

const angles = (eye: V3, c: V3): { side: number; up: number; d: number } => {
    const v = [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]];
    const h = Math.hypot(v[0]!, v[2]!);
    return { side: Math.atan2(v[0]!, v[2]!) * DEG, up: Math.atan2(v[1]!, h) * DEG, d: Math.hypot(h, v[1]!) };
};

describe('I1 D1: the framing pose from the gate pose and size', () => {
    it('stands 35 degrees aside and 20 above, at the distance where the gate takes a third of the view', () => {
        const f = frameGate(gate, null)!;
        expect(f).not.toBeNull();
        const a = angles(f.eye, gate.centre);
        expect(Math.abs(a.side)).toBeCloseTo(35, 3);
        expect(a.up).toBeCloseTo(20, 3);
        expect(a.d).toBeCloseTo(frameDistance(1.6, TAN_V), 6);
        // the gate's height on the screen as a share of the view: size / (2 d tan) at the centre
        expect(1.6 / (2 * a.d * TAN_V)).toBeCloseTo(1 / 3, 6);
        expect(f.at).toEqual(gate.centre);
        expect(f.skipped).toBe(0);
    });
    it('takes the side of the gate the view stands on', () => {
        const f = frameGate({ ...gate, from: [2, 2, -30] }, null)!;
        expect(f.eye[2]).toBeLessThan(gate.centre[2]);
        const g = frameGate(gate, null)!;
        expect(g.eye[2]).toBeGreaterThan(gate.centre[2]);
    });
    it('looks down on a gate lying flat (a dive gate) from 55 degrees', () => {
        const f = frameGate({ ...gate, axis: [0, 1, 0] }, null)!;
        expect(angles(f.eye, gate.centre).up).toBeCloseTo(55, 3);
    });
});

describe('I1 D1: the order of the fallbacks with a blocked ray', () => {
    const blockSide = (bad: (d: V3) => boolean): RayFn => (_o, d) => (bad(d) ? 0.5 : null);
    it('tries the mirrored side when the first side is in a wall', () => {
        const first = frameGate(gate, null)!;
        const s0 = Math.sign(first.eye[0] - gate.centre[0]);
        const f = frameGate(gate, blockSide((d) => Math.sign(d[0]) === s0))!;
        expect(f.sideDeg).toBe(-35);
        expect(f.skipped).toBe(1);
        expect(Math.sign(f.eye[0] - gate.centre[0])).toBe(-s0);
    });
    it('then 60 degrees, then nearer steps down to 1.5 gate sizes, then none', () => {
        const d0 = frameDistance(1.6, TAN_V);
        // walls at 35 degrees either side: 60 degrees comes next
        const at35 = (d: V3): boolean => Math.abs(Math.abs(Math.atan2(d[0], d[2]) * DEG) - 35) < 1;
        expect(frameGate(gate, blockSide(at35))!.sideDeg).toBe(60);
        // a wall all round nearer than the framing distance: the nearest step that fits
        const wall = d0 + 0.1;
        // the wall at `wall` from the gate's centre whatever the ray's start (review EI-2: the rays start at the gate's edge)
        const near: RayFn = (o, _d, max) => {
            const from = Math.hypot(o[0] - gate.centre[0], o[1] - gate.centre[1], o[2] - gate.centre[2]);
            return from + max > wall ? wall - from : null;
        };
        const f = frameGate(gate, near)!;
        expect(f.dist).toBeLessThan(wall);
        expect(f.dist).toBeGreaterThanOrEqual(FRAME_MIN_SIZES * 1.6 - 1e-9);
        expect(f.sideDeg).toBe(35);
        expect(frameGate(gate, () => 0.1)).toBeNull();
        const ds = frameDistances(d0, 1.6);
        expect(ds[0]).toBeCloseTo(Math.max(d0, FRAME_MIN_SIZES * 1.6), 9);
        expect(ds[ds.length - 1]).toBeCloseTo(FRAME_MIN_SIZES * 1.6, 9);
        for (let i = 1; i < ds.length; i++) expect(ds[i]!).toBeLessThan(ds[i - 1]!);
    });
    it('glides the short way round', () => {
        const m = blendCam({ pos: [0, 0, 0], yaw: 3, pitch: 0, speed: 4 }, { pos: [2, 0, 0], yaw: -3, pitch: 0.2, speed: 4 }, 0.5);
        expect(Math.abs(Math.cos(m.yaw) - Math.cos(Math.PI))).toBeLessThan(0.01);
        expect(m.pos[0]).toBeCloseTo(1, 9);
    });
});

describe('I1 D4: the pick of an edge-on ring and its angle from the mouse travel', () => {
    const line: P2[] = Array.from({ length: 64 }, (_, k) => [960 + 85 * Math.cos((k / 64) * 2 * Math.PI), 540] as P2);
    const face: P2[] = Array.from({ length: 64 }, (_, k) => [960 + 85 * Math.cos((k / 64) * 2 * Math.PI), 540 + 85 * Math.sin((k / 64) * 2 * Math.PI)] as P2);
    it('takes the nearest thin ring within 10 px of its line', () => {
        const rings = [{ pts: face, minor: minorAxis(face, [960, 540]) }, { pts: line, minor: minorAxis(line, [960, 540]) }];
        expect(rings[0]!.minor).toBeCloseTo(170, 0);
        expect(rings[1]!.minor).toBeLessThan(1);
        const p = pickRing([1000, 548], rings)!;
        expect(p.index).toBe(1);
        expect(Math.abs(p.tangent[0])).toBeCloseTo(1, 6);
        expect(pickRing([1000, 556], rings)).toBeNull();
        // J1 (E3): a ring seen open is taken here too (the gizmo's absolute mode turned it by 0 deg), dragged along its line
        const open = pickRing([1045, 540 + 1], [rings[0]!])!;
        expect(open.edge).toBe(false);
        expect(Math.abs(open.dir[1])).toBeGreaterThan(0.99);
    });
    it('turns by about half a degree per px of travel across the line', () => {
        expect(RING_DEG_PER_PX).toBe(0.5);
        expect(Math.abs(ringTurnDeg([1, 0], 0, 60))).toBeCloseTo(30, 9);
        expect(ringTurnDeg([1, 0], 80, 0)).toBeCloseTo(0, 9);
        expect(ringTurnDeg([1, 0], 0, 60)).toBeCloseTo(-ringTurnDeg([1, 0], 0, -60), 9);
    });
    it('takes the press of an edge-on ring even when the gizmo picks that same ring, not another ring', () => {
        const ns = rp as unknown as { edgeTakesPress?: (a: string | null, i: number | null) => boolean };
        expect(typeof ns.edgeTakesPress).toBe('function');
        const take = ns.edgeTakesPress!;
        // the browser run on Tunis: the gizmo picked 'y' on the y ring seen edge-on (minor 4 px) and turned it 0 deg
        expect(take('y', 1)).toBe(true);
        expect(take(null, 1)).toBe(true);
        expect(take('', 2)).toBe(true);
        expect(take('x', 1)).toBe(false);
        expect(take('z', 0)).toBe(false);
        expect(take('y', null)).toBe(false);
        expect(take(null, null)).toBe(false);
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        // J1 (E3): the edit view takes every ring it picks, edge-on or open (ringDeg along the pick's own direction)
        // train 4 edit4a A2: partAt picks the ring (unless an arrow or a box is nearer), the press takes it
        expect(vm).toMatch(/if \(part\.ring\) \{\s*const rp = part\.ring;\s*this\.ring = \{ axis: rp\.index, dir: rp\.dir/);
    });
    it('hides the shapes switched off (grey centre sphere and face ring) also after each drag', () => {
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        expect(vm).toContain('g._drag = (state: boolean)');
        expect(vm).toMatch(/if \(s\._disabled\) s\.visible = false/);
    });
});

describe('I1 D2 D3: the handles look as in an ordinary 3D editor, the selected gate is marked', () => {
    it('no part is larger than 16 px but lines and rings; arrows to 115 px, rings 60 px, lines 2 to 3 px', () => {
        expect(PART_MAX_PX).toBeLessThanOrEqual(16);
        // as drawn: a cube at an angle and the wide field make a part up to 1.67 times its set size (measured)
        const drawn = Math.max(HANDLE_PX.arrowLength * 1.13, HANDLE_PX.arrowWidth * 1.67, HANDLE_PX.sizeBox * 1.67,
            HANDLE_PX.centreBox * 1.67);
        expect(drawn).toBeLessThanOrEqual(16);
        // train 4 edit4a A2 (the owner, brief 543: arrows, boxes and rings at once): the edit4 design's bands, boxes to 35 px,
        // rings at 60 px, arrows from 75 to 115 px (edit4a-gizmo.test.ts keeps them apart)
        expect(HANDLE_PX.moveReach).toBe(115);
        expect(HANDLE_PX.ringRadius).toBe(60);
        expect(HANDLE_PX.line).toBeGreaterThanOrEqual(2);
        expect(HANDLE_PX.line).toBeLessThanOrEqual(3);
        // one gizmo unit is UNIT_PX px: PlayCanvas scale 0.3 * size * half extent
        expect(0.3 * gizmoSize(960) * 960).toBeCloseTo(UNIT_PX, 9);
        expect(AXIS_RGB.x[0]).toBeGreaterThan(0.9);
        expect(AXIS_RGB.hover[2]).toBeLessThan(0.2);
    });
    it('the view uses them, F frames again, and the selected gate is bright yellow', () => {
        const vm = src('apps/fly/src/course/editor/view-mouse.ts');
        expect(vm).toContain("e.code === 'KeyF'");
        expect(vm).toContain('setTheme(theme)');
        expect(vm).toContain('pickRing(');
        expect(vm).not.toContain('size.axisBoxSize = 0.22');
        expect(src('apps/fly/src/app/builtin/course.ts')).toContain('frameGate(');
        expect(src('apps/fly/src/course/view.ts')).toContain('selected: [1, 0.92, 0.25]');
        expect(CAM_ROWS.some((r) => r.caps === 'F' && r.labelKey === 'course.edit.cam.frame')).toBe(true);
        const en = JSON.parse(src('packages/i18n/locales/fly/course/en.json')) as Record<string, string>;
        for (const l of ['es', 'pl', 'ru']) {
            const o = JSON.parse(src(`packages/i18n/locales/fly/course/${l}.json`)) as Record<string, string>;
            for (const k of ['course.edit.cam.frame', 'course.edit.moveTag', 'course.edit.turnTag']) {
                expect(en[k]).toBeTruthy();
                expect(o[k]).toBeTruthy();
                expect(o[k]).not.toBe(en[k]);
            }
        }
    });
});
