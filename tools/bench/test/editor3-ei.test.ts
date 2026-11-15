// Lane editor3, stage fixes (review EI-1 to EI-7, train 3): the click on a gate beside the framed one, the framing of a gate
// whose centre stands in a wall, the edge-on ring's turn sense, the crashed drone under the edit view, and the source rules
// of the shown turn handle, the probe-only hook and the framed selection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frameGate, type RayFn, type V3 } from '../../../apps/fly/src/course/editor/frame';
import { modeStep } from '../../../apps/fly/src/course/editor/fly-mode';
import { pickGate, rayThrough, type Pickable } from '../../../apps/fly/src/course/editor/pick';
import { pickRing, ringTurnDeg, type DrawnRing, type P2 } from '../../../apps/fly/src/course/editor/ring-pick';

const ROOT = join(__dirname, '..', '..', '..');
const src = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const RAD = Math.PI / 180;
// the Wroclaw square: 1.5 m side
const square = { kind: 'square', side: 1.5, bar: 0.08 } as unknown as Pickable['shape'];

describe('EI-1: a click on a gate beside the framed one takes that gate', () => {
    it('gate A 2.5 m ahead on the axis, gate B 8 m away 12 degrees aside: the ray through B picks B', () => {
        const eye: V3 = [0, 1, 0];
        const a: Pickable = { pos: [0, 1, -2.5], shape: square };
        const b: Pickable = { pos: [8 * Math.sin(12 * RAD), 1, -8 * Math.cos(12 * RAD)], shape: square };
        const ray = rayThrough(eye, [b.pos[0] * 10, 1, b.pos[2] * 10])!;
        expect(pickGate(ray, [a, b])).toBe(1);
        // the ray through A's middle still takes A
        expect(pickGate(rayThrough(eye, [0, 1, -100])!, [a, b])).toBe(0);
    });
});

describe('EI-2: a gate whose centre stands in a wall voxel is still framed', () => {
    const TAN_V = Math.tan((115 * Math.PI) / 360) * (1080 / 1920);
    const g = { centre: [2, 1.5, -4] as V3, axis: [0, 0, 1] as V3, size: 1.6, tanHalfV: TAN_V, from: [2, 2, 20] as V3 };
    it('a ray that starts within 0.3 m of the centre hits at 0 (queryRay in a solid voxel); the framing goes on', () => {
        const solidCentre: RayFn = (o) => (Math.hypot(o[0] - g.centre[0], o[1] - g.centre[1], o[2] - g.centre[2]) < 0.3 ? 0 : null);
        const f = frameGate(g, solidCentre);
        expect(f).not.toBeNull();
        expect(f!.skipped).toBe(0);
    });
});

describe('EI-4: an edge-on ring turns the same way for the same drag on every press', () => {
    it('the folded line: the front half going right, the back half going left, a press on either side', () => {
        const pts: P2[] = [];
        for (let k = 0; k <= 20; k++) pts.push([100 + k * 10, 300]);
        for (let k = 19; k >= 1; k--) pts.push([100 + k * 10, 300.2]);
        const ring: DrawnRing = { pts, minor: 0.2, axis: [0, 40] };
        const above = pickRing([205, 297], [ring])!;
        const below = pickRing([205, 303], [ring])!;
        expect(above).not.toBeNull();
        expect(below).not.toBeNull();
        const d1 = ringTurnDeg(above.tangent, 0, 30);
        const d2 = ringTurnDeg(below.tangent, 0, 30);
        expect(Math.abs(d1)).toBeCloseTo(15, 6);
        expect(d2).toBeCloseTo(d1, 6);
        // a drag along the ring's drawn axis turns by a positive angle
        expect(d1).toBeGreaterThan(0);
    });
});

describe('EI-5: a crashed drone under the edit view goes back to the start', () => {
    it('crashed in flight or in the edit mode: respawn; flying or disarmed and whole: none', () => {
        expect(modeStep('fly', false, true)).toMatchObject({ mode: 'edit', respawn: true });
        expect(modeStep('edit', false, true, true)).toMatchObject({ mode: 'edit', respawn: true });
        expect(modeStep('edit', true, false)).toMatchObject({ mode: 'fly', respawn: false });
        expect(modeStep('edit', false, false)).toMatchObject({ mode: 'edit', respawn: false });
    });
    it('the page respawns on it', () => {
        expect(src('apps/fly/src/app/builtin/course.ts')).toMatch(/if \(st\.respawn\) \{[\s\S]{0,200}ctx\.session\.respawnStart\(\)/);
    });
});

describe('EI-3, EI-6, EI-7: the shown turn handle, the probe-only hook, the framed selection', () => {
    const vm = src('apps/fly/src/course/editor/view-mouse.ts');
    const course = src('apps/fly/src/app/builtin/course.ts');
    it('EI-3: an edge-on ring drag keeps the turn handle shown and the taken ring yellow', () => {
        expect(vm).not.toMatch(/this\.turn\.enabled = false/);
        expect(vm).toMatch(/this\.ringLook\(rp\.index, true\)/);
        expect(vm).toMatch(/this\.ringLook\(this\.ring\.axis, false\)/);
    });
    it('EI-6: the course-changing hook only on a page opened with probe=1', () => {
        expect(course).toMatch(/if \(pageQuery\.get\('probe'\) === '1'\) \(window[^\n]*__gsfpvEditPutAhead =/);
    });
    it('EI-7: the selection counts as framed only when the framing was done', () => {
        expect(course).toMatch(/eg\.id !== framedId && frameSel\(\)\) framedId = eg\.id/);
        expect(course).toMatch(/return f \? view\.glideTo\(/);
    });
});
