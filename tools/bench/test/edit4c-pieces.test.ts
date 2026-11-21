// Lane edit4c stage C2 (docs/wip/edit4c.md; design edit4.md 5 C2, complaint E12, brief 545): ready pieces of the course
// editor. Each piece puts N ordinary square gates in one undo step, every second one turned round; the walls check and the
// live warnings take a piece's turn round as a way in (no 'gate-direction' problem, no sharp-turn warning); the lap judge
// counts its gates in course order when the pilot flies the loop, and does not when he flies straight past.
import { describe, expect, it } from 'vitest';
import type { SonicObject, Vec3 } from '@shramko/sonic-fpv';
import {
    LapTimer, MAX_GATES_EDIT, PIECES, PIECE_OPENING_M, checkTrack, edit, entryDeg, freeSpace, generateCourse, openEditor, pieceLayout,
    pieceStepM, toTrackV1, upgradeTrack, validateServerTrack
} from '@gsfpv/tracks';
import type { Course, CourseCheck, PieceKind } from '@gsfpv/tracks';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';
import { pieceAction } from '../../../apps/fly/src/course/editor/add-place';
import { placeWarnings } from '../../../apps/fly/src/course/editor/warn';
import { gateFlownPose } from '../../../apps/fly/src/course/editor/drag';
import { ADD_CHOICES } from '../../../apps/fly/src/course/editor/pieces-texts';

const walls = threeRooms();
const make = (seed: number): Course =>
    upgradeTrack(generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-19T00:00:00.000Z' }));
const off: CourseCheck = () => [];
const TR = [1, 0, 0, 0] as const;
type Q = [number, number, number, number];
function quatRotate(q: Q, v: Vec3): Vec3 {
    const [w, x, y, z] = q;
    const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
    return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
}
const way = (q: readonly number[]): Vec3 => quatRotate(q as Q, [0, 0, -1]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** a quarter turn about the vertical: the piece faces +X */
const YAW90: Q = [Math.SQRT1_2, 0, -Math.SQRT1_2, 0];

/** the piece put halfway between gates 1 and 2 of a generated course (on the floor's height), after gate 1 */
function withPiece(kind: PieceKind, c = make(7)): { before: ReturnType<typeof openEditor>; after: ReturnType<typeof openEditor>; at: Vec3 } {
    const a = c.gates[0]!.pos, b = c.gates[1]!.pos;
    // low enough that a triple stack (3.8 m up) stays inside the test world (5.4 m high)
    const at: Vec3 = [(a[0] + b[0]) / 2, 1.2, (a[2] + b[2]) / 2];
    const s = openEditor(c, off, 0);
    const out = edit(s, pieceAction(kind, at, YAW90, TR, 0), off);
    expect(out.ok).toBe(true);
    return { before: s, after: out.state, at };
}

describe('edit4c C2: ready pieces (double and triple, vertical and horizontal)', () => {
    it('the Add list offers a gate and the four pieces', () => {
        expect(ADD_CHOICES).toEqual(['gate', 'double-vertical', 'triple-vertical', 'double-horizontal', 'triple-horizontal']);
    });

    for (const spec of PIECES) {
        it(`${spec.kind}: ${spec.count} new square gates after gate 1, ids unique, faces alternate, one undo step, the server takes it`, () => {
            const { before, after, at } = withPiece(spec.kind);
            const gs = after.course.gates;
            expect(gs.length).toBe(before.course.gates.length + spec.count);
            const made = gs.slice(1, 1 + spec.count);
            expect(new Set(gs.map((g) => g.id)).size).toBe(gs.length);
            expect(after.selected).toBe(spec.count);
            const step = pieceStepM(spec);
            made.forEach((g, k) => {
                expect(g.shape).toEqual({ kind: 'square', side: PIECE_OPENING_M, bar: 0.1 });
                expect(g.direction).toBe('forward');
                // faces: the first along +X (the click's turn), every second one turned round
                expect(dot(way(g.quat), [1, 0, 0])).toBeCloseTo(k % 2 === 0 ? 1 : -1, 3);
                const off = spec.stack === 'up' ? [0, k * step, 0] : [0, 0, (k - (spec.count - 1) / 2) * step];
                // a row goes to the first gate's right: facing +X, right is +Z
                for (const j of [0, 1, 2] as const) expect(g.pos[j]).toBeCloseTo(at[j] + off[j]!, 2);
            });
            // the pieces' frames are no 'too-close' to each other (their frames 0.3 m and 0.5 m apart)
            for (let k = 0; k < spec.count; k++) {
                const ws = placeWarnings(after.course, 1 + k, gateFlownPose(made[k]!, TR), TR, null);
                expect(ws.filter((w) => w.code === 'too-close' && w.other! >= 1 && w.other! <= spec.count)).toEqual([]);
            }
            const undone = edit(after, { kind: 'undo' }, off);
            expect(undone.ok).toBe(true);
            expect(undone.state.course.gates).toEqual(before.course.gates);
            const file = JSON.parse(JSON.stringify(toTrackV1(after.course)));
            const v = validateServerTrack(file);
            expect(v.ok ? [] : v.issues).toEqual([]);
        });
    }

    it('a piece on a full course is refused with max-gates (the course stays)', () => {
        const c = make(7);
        const many = { ...c, gates: Array.from({ length: MAX_GATES_EDIT - 1 }, (_, i) => ({ ...c.gates[0]!, id: `g${i + 1}`, pos: [i, 2, 0] as [number, number, number] })) };
        const s = openEditor(many, off, 0);
        const out = edit(s, pieceAction('double-vertical', [0, 3, 3], YAW90, TR, 0), off);
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.reason.code).toBe('max-gates');
    });

    it("a piece's turn round is a way in: the walls check finds every piece gate's direction right, no sharp-turn warning", () => {
        for (const spec of PIECES) {
            const { after } = withPiece(spec.kind);
            const r = checkTrack(toTrackV1(after.course), walls, IDENTITY, undefined, false);
            expect(r.outside).toEqual([]);
            for (let k = 1; k < spec.count; k++) {
                const g = r.gates[1 + k]!;
                expect({ kind: spec.kind, gate: g.id, ok: g.directionOk }).toEqual({ kind: spec.kind, gate: g.id, ok: true });
                const ws = placeWarnings(after.course, 1 + k, gateFlownPose(after.course.gates[1 + k]!, TR), TR, null);
                expect(ws.filter((w) => w.code === 'sharp-turn' && w.gate === 1 + k)).toEqual([]);
            }
        }
        // the control: two gates far apart facing each other are no turn round (the straight leg in judges them)
        expect(entryDeg([-1, 0, 0], [10, 0, 0], [1, 0, 0])).toBeCloseTo(180, 3);
        expect(entryDeg([-1, 0, 0], [0, 1.9, 0], [1, 0, 0])).toBeCloseTo(0, 3);
        expect(entryDeg([0, 0, 1], [0, 1.9, 0], [1, 0, 0])).toBeCloseTo(90, 3);
    });

    it('a lap through a double vertical counts its 2 gates in course order when flown as a loop, none when flown past', () => {
        const poses = pieceLayout('double-vertical', [0, 1.5, -10], [1, 0, 0, 0]);
        const gates: SonicObject[] = poses.map((p, i) => ({ id: `g${i + 1}`, shape: { kind: 'square', side: PIECE_OPENING_M, bar: 0.1 }, pos: p.pos, quat: p.quat, order: i, solid: false, material: 'obstacle' }));
        const fly = (pts: readonly Vec3[]): string[] => {
            const timer = new LapTimer(gates, { laps: 1 });
            const ev: string[] = [];
            let t = 0;
            for (let k = 1; k < pts.length; k++) {
                const a = pts[k - 1]!, b = pts[k]!;
                const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 100));
                let prev = a;
                for (let i = 1; i <= n; i++) {
                    const now: Vec3 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n];
                    t += 1;
                    const e = timer.step(t, prev, now);
                    if (e) ev.push(e);
                    prev = now;
                }
            }
            return ev;
        };
        const hi = poses[1]!.pos[1];
        // in through the low gate (-Z), up behind it, back through the high gate (+Z): the loop of a stacked pair
        const loop = fly([[0, 1.5, 0], [0, 1.5, -13], [0, hi, -13], [0, hi, -7]]);
        expect(loop.length).toBe(2);
        expect(loop[loop.length - 1]).toBe('done');
        // through the low gate, round the side and through the high one the same way (-Z): passed backward, no lap
        expect(fly([[0, 1.5, 0], [0, 1.5, -13], [5, hi, -13], [5, hi, 0], [0, hi, 0], [0, hi, -13]])).not.toContain('done');
    });
});
