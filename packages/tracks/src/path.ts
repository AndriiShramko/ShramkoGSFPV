// The path the sound beacon follows along a course (docs/wip/tracks-plan.md 2.4): the rules of the sound package's
// WorldCheckpoint (contract.ts): consecutive points at most 6 m apart along the whole course, one 1.5 m before each gate
// facing it, `dir` horizontal and unit, `stage` k only on the point that ends stage k (the gate's own centre). The leg
// from the last gate back to the start closes the lap. Flown world. Pure: + - * /, Math.sqrt.
import type { SceneTransform, TrackFile, Vec3, WorldCheckpoint } from './types';
import type { Sweeper } from './check';

/** The contract's largest gap between consecutive points, m. */
export const PATH_STEP_M = 6;
/** The point before each gate, m. */
export const BEFORE_GATE_M = 1.5;
/** The point after a gate the path turns hard at, along its axis, m (estimate; capped as check.ts caps its run through the gate). */
export const AFTER_GATE_M = 1;
/** A leg out more than 60 degrees off the gate's axis gets the point after the gate (estimate: cos 60). */
export const EXIT_TURN_COS = 0.5;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

/** The way a gate with quaternion (w, x, y, z) is passed: its local -Z in the world. */
export function gateAxis(q: readonly number[]): Vec3 {
    const [w, x, y, z] = q as [number, number, number, number];
    return [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
}

/**
 * The point after a gate that the path flies through before it turns (lane tracks2, K1): without it a leg out that turns
 * back more than 90 degrees from the axis only touches the gate's plane at the centre and the lap detector (a forward
 * crossing per frame) never counts the gate. Set when the leg out is more than 60 degrees off the axis, and after the last
 * gate of an open course (`legOut` null). Inside the run check.ts proves through the gate: at most 0.4 of the shorter leg.
 */
export function gateExit(centre: Vec3, axis: Vec3, legIn: Vec3, legOut: Vec3 | null): Vec3 | null {
    const lin = len(legIn);
    const lout = legOut ? len(legOut) : lin;
    if (legOut && lout > 1e-9 && (axis[0] * legOut[0] + axis[1] * legOut[1] + axis[2] * legOut[2]) / lout >= EXIT_TURN_COS) return null;
    const e = Math.min(AFTER_GATE_M, 0.4 * Math.min(lin, lout || lin));
    return e > 1e-6 ? add(centre, mul(axis, e)) : null;
}

function flatDir(v: Vec3, fallback: Vec3): Vec3 {
    const h = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
    return h < 1e-9 ? fallback : [v[0] / h, 0, v[2] / h];
}

/** The beacon's points for `track` flown at `transform` (default: the size it was laid for). */
export function coursePath(track: TrackFile, transform: SceneTransform = track.transform): WorldCheckpoint[] {
    const [s, tx, ty, tz] = transform;
    const fl = (p: Vec3): Vec3 => [s * p[0] + tx, s * p[1] + ty, s * p[2] + tz];
    const gates = track.gates.map((g) => fl(g.pos));
    if (gates.length === 0) return [];
    const start = track.start ? fl(track.start.pos) : gates[0]!;
    const out: WorldCheckpoint[] = [];
    let dir: Vec3 = flatDir(sub(gates[0]!, start), [0, 0, -1]);
    out.push({ pos: start, dir });
    /** points from `from` (already out) to `to`, at most PATH_STEP_M apart, `to` included */
    const run = (from: Vec3, to: Vec3, stage?: number): void => {
        const d = sub(to, from);
        const L = len(d);
        if (L < 1e-9) return;
        dir = flatDir(d, dir);
        const n = Math.ceil(L / PATH_STEP_M - 1e-9);
        for (let k = 1; k <= n; k++) {
            const pos = k === n ? to : add(from, mul(d, k / n));
            out.push(k === n && stage !== undefined ? { pos, dir, stage } : { pos, dir });
        }
    };
    let cur = start;
    gates.forEach((g, i) => {
        const d = sub(g, cur);
        const L = len(d);
        if (L > BEFORE_GATE_M + 1e-6) {
            const before = sub(g, mul(d, BEFORE_GATE_M / L));
            run(cur, before);
            run(before, g, i + 1);
        } else run(cur, g, i + 1);
        cur = g;
        const next = i + 1 < gates.length ? gates[i + 1]! : track.laps > 1 ? start : null;
        const exit = gateExit(g, gateAxis(track.gates[i]!.quat), sub(g, i > 0 ? gates[i - 1]! : start), next ? sub(next, g) : null);
        if (exit) {
            run(g, exit);
            cur = exit;
        }
    });
    // the leg back closes the lap; an open course (laps 1, its last gate does not see the start) ends at its last gate
    if (track.laps > 1) run(cur, start);
    return out;
}

/**
 * What is wrong with a beacon path for `track`: a gap above PATH_STEP_M, a gate with no point BEFORE_GATE_M before it on
 * its leg in, a `dir` not horizontal and unit, a stage on the wrong point, and with a sweeper a segment that a sphere of
 * `radius` cannot fly. Empty when the path holds.
 */
export function pathProblems(path: readonly WorldCheckpoint[], track: TrackFile, transform: SceneTransform = track.transform, sweeper: Sweeper | null = null, radius = 0.3): string[] {
    const issues: string[] = [];
    const [s, tx, ty, tz] = transform;
    const fl = (p: Vec3): Vec3 => [s * p[0] + tx, s * p[1] + ty, s * p[2] + tz];
    for (let i = 0; i + 1 < path.length; i++) {
        const gap = len(sub(path[i + 1]!.pos, path[i]!.pos));
        if (gap > PATH_STEP_M + 1e-6) issues.push(`points ${i} and ${i + 1} are ${gap.toFixed(3)} m apart (at most ${PATH_STEP_M})`);
        if (sweeper && !sweeper.free(path[i]!.pos, path[i + 1]!.pos, radius)) issues.push(`the segment from point ${i} to ${i + 1} is not free by ${radius} m`);
    }
    for (const [i, c] of path.entries()) {
        if (Math.abs(c.dir[1]) > 1e-9 || Math.abs(len(c.dir) - 1) > 1e-6) issues.push(`point ${i}: dir is not horizontal and unit`);
    }
    track.gates.forEach((g, k) => {
        const gp = fl(g.pos);
        const at = path.findIndex((c) => c.stage === k + 1);
        if (at < 0 || len(sub(path[at]!.pos, gp)) > 1e-6) {
            issues.push(`gate ${g.id}: no point ends stage ${k + 1} at its centre`);
            return;
        }
        const prev = at > 0 ? path[at - 1]! : null;
        const legIn = k === 0 ? (at > 0 ? path[0]!.pos : gp) : fl(track.gates[k - 1]!.pos);
        if (len(sub(gp, legIn)) <= BEFORE_GATE_M + 1e-6) return;
        if (!prev || Math.abs(len(sub(gp, prev.pos)) - BEFORE_GATE_M) > 0.01) issues.push(`gate ${g.id}: no point ${BEFORE_GATE_M} m before it`);
    });
    const stages = path.filter((c) => c.stage !== undefined).length;
    if (stages !== track.gates.length) issues.push(`${stages} points end a stage, the course has ${track.gates.length} gates`);
    return issues;
}
