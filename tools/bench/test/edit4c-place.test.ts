// Lane edit4c stage C1 (docs/wip/edit4c.md; design edit4.md 5, complaint E11, brief 545-546 and 557-558): a new gate takes
// the place and the angle of the course's line, a duplicate follows a curved course instead of making a straight row, and
// a gate dragged into a place that breaks the course gets a warning (pure; the page shows it while the drag lasts).
import { describe, expect, it } from 'vitest';
import { edit, freeSpace, generateCourse, openEditor, upgradeTrack } from '@gsfpv/tracks';
import type { Course, CourseCheck } from '@gsfpv/tracks';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import { addAction, placeFor } from '../../../apps/fly/src/course/editor/add-place';
import { courseFacing, placeInCourse } from '../../../apps/fly/src/course/editor/course-line';
import { gateFlownPose, type V3 } from '../../../apps/fly/src/course/editor/drag';
import { placeWarnings, type WarningCode } from '../../../apps/fly/src/course/editor/warn';

const walls = threeRooms();
const make = (seed: number): Course =>
    upgradeTrack(generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-19T00:00:00.000Z' }));
const off: CourseCheck = () => [];
/** v turned by q (w, x, y, z): v + 2w (u x v) + 2 u x (u x v) */
function quatRotate(q: readonly [number, number, number, number], v: readonly [number, number, number]): [number, number, number] {
    const [w, x, y, z] = q;
    const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
    return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
}
const TR = [1, 0, 0, 0] as const;

/** the floor heading (degrees) of a gate turn's -Z, the way it is passed */
const headingOf = (q: readonly [number, number, number, number]): number => {
    const a = quatRotate(q as [number, number, number, number], [0, 0, -1]);
    return (Math.atan2(a[0], -a[2]) * 180) / Math.PI;
};
const headingOfDir = (dx: number, dz: number): number => (Math.atan2(dx, -dz) * 180) / Math.PI;
const angleBetween = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/** a course of upright gates at `at` (course frame = flown, IDENTITY), each facing along its leg in (as the generator's); the start 1 m behind gate 1 */
function course(at: readonly V3[]): Course {
    const base = make(7);
    const g0 = base.gates[0]!;
    const gates = at.map((p, i) => {
        const pv = at[i - 1] ?? p;
        return { ...g0, id: `g${i + 1}`, pos: [p[0], p[1], p[2]] as [number, number, number], quat: courseFacing(i > 0 ? pv : [p[0], p[1], p[2] + 1], p, null) as [number, number, number, number] };
    });
    return { ...base, gates, start: base.start ? { ...base.start, pos: [at[0]![0], at[0]![1], at[0]![2] + 1] } : null };
}

describe('edit4c C1: a new gate takes the place and the angle of the course', () => {
    it('a click between gates 3 and 4 inserts after gate 3, facing the bisector of its legs within 5 degrees', () => {
        const c = course([[0, 2, 0], [0, 2, -10], [10, 2, -15], [20, 2, -10], [25, 2, 0]]);
        const s = openEditor(c, off, 0); // gate 1 selected, as after opening: the old code put the gate after it
        const g3 = c.gates[2]!.pos;
        const g4 = c.gates[3]!.pos;
        // 1.5 m off the middle of the leg 3 -> 4, a wall 7.5 m away (addPoint pulls 1.5 m back), seen along the leg so the ray
        // passes no leg before the wall (C3: a ray through a leg puts the gate on that leg, tested below)
        const mid: V3 = [(g3[0] + g4[0]) / 2 - 1.5 * 0.447, 2, (g3[2] + g4[2]) / 2 - 1.5 * 0.894];
        const d: V3 = [2 / Math.sqrt(5), 0, 1 / Math.sqrt(5)];
        const o: V3 = [mid[0] - 6 * d[0], mid[1], mid[2] - 6 * d[2]];
        const p = placeFor(s, TR, { o, d, hit: 7.5 }, 0);
        expect(p.after).toBe(2);
        expect(Math.hypot(p.pos[0] - mid[0], p.pos[1] - mid[1], p.pos[2] - mid[2])).toBeLessThan(1e-9);
        const inH = headingOfDir(mid[0] - g3[0], mid[2] - g3[2]);
        const outH = headingOfDir(g4[0] - mid[0], g4[2] - mid[2]);
        const bis = headingOfDir(Math.sin((inH * Math.PI) / 180) + Math.sin((outH * Math.PI) / 180), -Math.cos((inH * Math.PI) / 180) - Math.cos((outH * Math.PI) / 180));
        expect(angleBetween(headingOf(p.quat as [number, number, number, number]), bis)).toBeLessThan(5);
        const out = edit(s, addAction(p.pos, p.quat, TR, p.after), off);
        expect(out.ok).toBe(true);
        expect(out.state.selected).toBe(3);
        expect(out.state.course.gates.map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g6', 'g4', 'g5']);
    });

    it('beyond the last gate the click goes on the end; before the first, first; one gate: after it', () => {
        const pts: V3[] = [[0, 2, 0], [0, 2, -10], [10, 2, -10]];
        expect(placeInCourse(pts, 0, [20, 2, -10])).toBe(2);
        expect(placeInCourse(pts, 0, [0, 2, 8])).toBe(-1);
        expect(placeInCourse(pts, 2, [11, 2, -9])).toBe(2);
        expect(placeInCourse([[0, 2, 0]], 0, [5, 2, 5])).toBe(0);
        expect(placeInCourse([], -1, [5, 2, 5])).toBe(-1);
    });

    it('C3: a click whose ray passes a leg before the wall puts the gate on that leg, facing along it', () => {
        const c = course([[0, 2, 0], [0, 2, -10], [10, 2, -15], [20, 2, -10], [25, 2, 0]]);
        const s = openEditor(c, off, 0);
        const g3 = c.gates[2]!.pos;
        const g4 = c.gates[3]!.pos;
        // seen from 15 m east of the leg 3 -> 4's middle; the ray goes on and meets a wall 29 m off, by gate 2 (measured on
        // a Shift+G course: the old rule put the gate at that wall, after gate 2 here)
        const o: V3 = [30, 2, -12.5];
        const p = placeFor(s, TR, { o, d: [-1, 0, 0], hit: 29 }, 0);
        expect(p.after).toBe(2);
        expect(Math.hypot(p.pos[0] - 15, p.pos[1] - 2, p.pos[2] + 12.5)).toBeLessThan(1e-6);
        expect(angleBetween(headingOf(p.quat as [number, number, number, number]), headingOfDir(g4[0] - g3[0], g4[2] - g3[2]))).toBeLessThan(5);
        // a wall in front of the leg: the wall point stands (pulled 1.5 m back), as before
        const w = placeFor(s, TR, { o, d: [-1, 0, 0], hit: 10 }, 0);
        expect(Math.hypot(w.pos[0] - 21.5, w.pos[1] - 2, w.pos[2] + 12.5)).toBeLessThan(1e-6);
        // a leg passing by the eye is not the one clicked: the next leg along the ray is (gate 2 -> 3, 10 m off)
        const b = placeFor(s, TR, { o: [15, 2, -12.5], d: [-1, 0, 0], hit: 14 }, 0);
        expect(b.after).toBe(1);
    });

    it('three duplicates on a curved course follow the curve to the next gate (not a straight row), each facing along it', () => {
        // gate 1 faces -Z, gate 2 stands to the right and ahead, faced +X: a quarter turn
        const c0 = course([[0, 2, 0], [12, 2, -12]]);
        const gates = [{ ...c0.gates[0]!, quat: [1, 0, 0, 0] as [number, number, number, number] }, { ...c0.gates[1]!, quat: courseFacing([0, 2, -12], [12, 2, -12], null) as [number, number, number, number] }];
        let s = openEditor({ ...c0, gates }, off, 0);
        for (let i = 0; i < 3; i++) {
            const o = edit(s, { kind: 'insert' }, off);
            expect(o.ok).toBe(true);
            s = o.state;
        }
        const p = s.course.gates.map((g) => g.pos);
        expect(p.length).toBe(5);
        // the copies stand between the two gates, nearer to gate 2 each time
        const toEnd = p.slice(0, 4).map((q) => Math.hypot(q[0] - 12, q[2] + 12));
        for (let i = 1; i < 4; i++) expect(toEnd[i]!).toBeLessThan(toEnd[i - 1]!);
        // not collinear: the copies bend away from the straight line of the first two (the old row along gate 1's axis was)
        const [a, b, d] = [p[1]!, p[2]!, p[3]!];
        const cross = (b[0] - a[0]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[0] - a[0]);
        expect(Math.abs(cross)).toBeGreaterThan(0.5);
        expect(Math.abs(p[1]![0])).toBeGreaterThan(0.05);
        // each copy faces the way from it to the next copy within 25 degrees (along the curve)
        for (let i = 1; i < 4; i++) {
            const q = s.course.gates[i]!;
            const n = p[i + 1]!;
            expect(angleBetween(headingOf(q.quat as [number, number, number, number]), headingOfDir(n[0] - q.pos[0], n[2] - q.pos[2]))).toBeLessThan(25);
        }
    });
});

describe('edit4c C1: live warnings while a gate is dragged', () => {
    const codes = (c: Course, i: number, pos: V3, w = walls): WarningCode[] => placeWarnings(c, i, { ...gateFlownPose(c.gates[i]!, TR), pos }, TR, w).map((x) => x.code);

    it('each warning fires on a made case', () => {
        const c = course([[2, 2.5, 8], [2, 2.5, 2], [8, 2.5, 2], [8, 2.5, 8]]);
        // the course as made has none
        for (let i = 0; i < c.gates.length; i++) expect(codes(c, i, gateFlownPose(c.gates[i]!, TR).pos)).toEqual([]);
        // gate 2 pulled past gate 3: gate 3 can no longer be entered forward from it (the check's 35 degrees)
        expect(codes(c, 1, [8.5, 2.5, 0.8])).toContain('sharp-turn');
        const close = placeWarnings(c, 1, { ...gateFlownPose(c.gates[1]!, TR), pos: [7.5, 2.5, 2.2] }, TR, walls);
        expect(close).toContainEqual({ code: 'too-close', gate: 1, other: 2 });
        // gate 2 down to 0.3 m over the floor: the floor is inside its opening and its legs touch it
        const low = codes(c, 1, [2, 0.3, 2]);
        expect(low).toContain('wall-in-opening');
        expect(low).toContain('leg-wall');
        // gate 4 through the wall into room C: its leg in crosses the wall (the door is at the rooms' middle only)
        expect(codes(c, 3, [25, 2.5, 8])).toContain('leg-wall');
        // a leg over the server's 60 m (no walls: an open field)
        expect(codes(c, 3, [8, 2.5, 80], null)).toContain('leg-long');
        expect(codes(c, 3, [8, 2.5, 80], null)).not.toContain('leg-wall');
    });

    it('no warning on generated courses (a false warning is a failure)', () => {
        let n = 0;
        for (const seed of [1, 2, 3, 7, 11, 42]) {
            const c = make(seed);
            for (let i = 0; i < c.gates.length; i++) {
                const w = placeWarnings(c, i, gateFlownPose(c.gates[i]!, TR), TR, walls);
                expect({ seed, i, w }).toEqual({ seed, i, w: [] });
                n++;
            }
        }
        expect(n).toBeGreaterThan(12);
    });
});
