// Lane n-save S2 (the owner's wish 1 of 2026-11-20, t7-plan Part C 5): "fix all automatically" in one click. Pure: the
// course, the flown walls and the level come in; the repaired course, what moved and what could not be repaired go out.
// Every offending gate goes the shortest way to a valid place, in the course's order (a gate is judged with the ones
// before it already repaired; the order of the gates never changes):
//   - out of the scan with the clearance its size needs (the proof's own gate test: opening, frame and the run through it
//     clear by the margin), within NEAR_GRID_M of the walls' grid;
//   - above the ground (a gate buried in the ground is found and lifted first: its shortest way out is up);
//   - apart from the other gates (frames at least APART_GAP_M apart beyond their half openings);
//   - turned along the leg (the generator's way: between the leg in and the leg out when that is within the level's
//     tolerance of the leg in, else along the leg in); a gate whose only fault is its turn keeps its place.
// The search tries the 26 ways of the cube (faces, edges, corners) at growing distances: 0.1 m steps to 2 m, then 0.25 m
// steps, so the move found is the shortest along those ways to within a step. Each place is judged by the proof on a short
// course around the gate (the gate before it, the gate, the gate after it): milliseconds, where the whole course is seconds.
// Not repaired, and named in `leftovers`: a blocked start (the start is the scan's spawn), a leg a short move of its far
// gate does not clear, and any gate no place within FIX_ALL_MAX_M suits. The editor's Fix of one gate is the same search
// (`fixAll(..., { only })`); apps/fly fixes.ts makes its small corrections with it.
import { quatMultiply, quatNormalize, quatRotate } from '@shramko/sonic-fpv';
import type { Quat, TrackFile, Vec3 } from '@shramko/sonic-fpv';
import { sphereOverlaps } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { AXIS_TOLERANCE_DEG, NEAR_GRID_M, checkTrack, entryDeg, gridDistance } from './check';
import type { Course } from './format';
import { toTrackV1 } from './format';
import { SAME_PLACE_M, SAVE_WARNING_KINDS } from './editor';
import type { SaveWarning, SaveWarningKind } from './editor';
import { LEVELS } from './request';
import type { CourseLevel } from './request';

/** What the fixer sees of the scan: the flown walls (flownCollision), the scene transform, the check's margin (flown m). */
export interface FixWalls {
    readonly col: VoxelCollision;
    readonly transform: readonly [number, number, number, number];
    readonly margin: number;
}
/** a gate's place and turn in the course's own frame (as TrackGate.pos and .quat) */
export interface GatePose {
    readonly pos: Vec3;
    readonly quat: Quat;
}
/** One gate the fix moved or turned: where it was (the ghost), where it is, what it cleared. */
export interface GateMove {
    readonly index: number;
    readonly id: string;
    readonly before: GatePose;
    readonly after: GatePose;
    /** the warnings it had, in SAVE_WARNING_KINDS order */
    readonly kinds: readonly SaveWarningKind[];
    /** flown metres moved, to 1 cm */
    readonly movedM: number;
    /** degrees its way through turned, whole */
    readonly turnedDeg: number;
}
export interface FixAllResult {
    readonly course: Course;
    readonly moves: readonly GateMove[];
    /** what is still wrong after the fix (the course is saved as it is with these) */
    readonly leftovers: readonly SaveWarning[];
}
export interface FixAllOptions {
    /** the farthest a gate is moved, flown m (default FIX_ALL_MAX_M) */
    readonly maxM?: number;
    /** repair this gate only (the editor's Fix of one gate) */
    readonly only?: number;
}

/** two gates' frames nearer than this beyond their half openings stand too close, flown m (an estimate; warn.ts uses it) */
export const APART_GAP_M = 0.2;
/** the farthest a gate is moved, flown m (the editor's reach past the grid: a place farther is no repair) */
export const FIX_ALL_MAX_M = NEAR_GRID_M;
/** a gate already in a valid place is moved at most this much farther to clear its blocked leg in, flown m (an estimate) */
export const FIX_LEG_MAX_M = 2;
/** the fine steps go to FIX_FINE_M by FIX_FINE_STEP_M, then FIX_COARSE_STEP_M (flown m) */
export const FIX_FINE_STEP_M = 0.1;
export const FIX_FINE_M = 2;
export const FIX_COARSE_STEP_M = 0.25;

const DEG = Math.PI / 180;
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const unit = (a: Vec3): Vec3 => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
};
const angleDeg = (a: Vec3, b: Vec3): number => {
    if (len(a) < 1e-12 || len(b) < 1e-12) return 0;
    const u = unit(a), v = unit(b);
    return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / DEG;
};
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 || 0;
/** to 1e-6, the sign with w >= 0 (as the editor writes a turn) */
const roundQuat = (q: Quat): Quat => {
    const n = quatNormalize(q);
    const k = n[0] < 0 || (n[0] === 0 && (n[1] < 0 || (n[1] === 0 && (n[2] < 0 || (n[2] === 0 && n[3] < 0))))) ? -1 : 1;
    return [r6(k * n[0]), r6(k * n[1]), r6(k * n[2]), r6(k * n[3])];
};
/** the way a gate is passed (its -Z) */
const axisOf = (q: Quat): Vec3 => quatRotate(q, [0, 0, -1]);
/** a turn about the world's vertical by `deg` (positive: to the right seen from above; editor.ts yawQuat) */
const yawTurn = (deg: number): Quat => [Math.cos((deg * DEG) / 2), 0, -Math.sin((deg * DEG) / 2), 0];
const yawOf = (v: Vec3): number | null => (Math.hypot(v[0], v[2]) < 1e-9 ? null : Math.atan2(v[0], -v[2]) / DEG);
const isDive = (q: Quat): boolean => Math.abs(axisOf(q)[1]) > 0.7;
const openingOf = (g: Course['gates'][number]): number => (g.shape.kind === 'ring' ? g.shape.diameter : g.shape.kind === 'square' || g.shape.kind === 'cube-frame' ? g.shape.side : 0);

const toFlown = (p: readonly number[], t: FixWalls['transform']): Vec3 => [t[0] * p[0]! + t[1], t[0] * p[1]! + t[2], t[0] * p[2]! + t[3]];
const toCourse = (f: Vec3, t: FixWalls['transform']): Vec3 => [r3((f[0] - t[1]) / t[0]), r3((f[1] - t[2]) / t[0]), r3((f[2] - t[3]) / t[0])];
const withPose = (c: Course, i: number, pos: Vec3, quat: Quat): Course => ({ ...c, gates: c.gates.map((g, k) => (k === i ? { ...g, pos, quat } : g)) });
const near = (w: FixWalls, p: readonly number[]): boolean => gridDistance(w.col, toFlown(p, w.transform)) <= NEAR_GRID_M;

/** the level's tolerance for aiming a gate between its legs, degrees (LEVELS axisCosMin: beginner 15, medium and pro 30) */
export function aimToleranceDeg(level: CourseLevel): number {
    return Math.acos(LEVELS[level].axisCosMin) / DEG;
}

/** What is wrong with one gate where it stands. */
interface Faults {
    /** farther than NEAR_GRID_M from the walls' grid */
    readonly outside: boolean;
    /** the opening, frame or run through it touches a wall */
    readonly wall: boolean;
    readonly wrongWay: boolean;
    /** the leg into the gate touches a wall (only a real leg: from the gate before it or the start) */
    readonly legIn: boolean;
    readonly legOut: boolean;
}
const NO_FAULTS: Faults = { outside: false, wall: false, wrongWay: false, legIn: false, legOut: false };

/**
 * The proof on a short course around gate `i`: the gate before it (for its leg in and the turn-round rule of entryDeg),
 * the gate, the gate after it (for its leg out). A neighbour beyond the grid's reach is left out; a window with no real
 * point before it starts 1 m behind its first gate along that gate's way (no leg in to judge).
 */
function faults(c: Course, i: number, w: FixWalls): Faults {
    const v1 = toTrackV1(c);
    const gates = v1.gates;
    const g = gates[i]!;
    if (!near(w, g.pos)) return { ...NO_FAULTS, outside: true };
    const lo = i > 0 && near(w, gates[i - 1]!.pos) ? i - 1 : i;
    const hi = i + 1 < gates.length && near(w, gates[i + 1]!.pos) ? i + 1 : i;
    const before = lo > 0 ? gates[lo - 1]!.pos : (v1.start?.pos ?? null);
    const realBefore = before !== null && near(w, before);
    const first = gates[lo]!;
    const back = axisOf(first.quat);
    const s = w.transform[0];
    const startPos: Vec3 = realBefore ? [before[0], before[1], before[2]] : [first.pos[0] - back[0] / s, first.pos[1] - back[1] / s, first.pos[2] - back[2] / s];
    const part: TrackFile = { ...v1, start: { pos: startPos, yawDeg: 0 }, laps: 1, gates: gates.slice(lo, hi + 1) };
    // the virtual start may lie 1 m past the reach of its gate
    const r = checkTrack(part, w.col, w.transform, w.margin, false, false, NEAR_GRID_M + 2);
    if (r.outside.length > 0) return { ...NO_FAULTS, outside: r.outside.includes(g.id) };
    const rep = r.gates.find((x) => x.id === g.id)!;
    const legInReal = lo < i || realBefore;
    return {
        outside: false,
        wall: !rep.clear,
        wrongWay: legInReal && !rep.directionOk,
        legIn: legInReal && r.legs.some((l) => l.to === g.id && !l.clear),
        legOut: r.legs.some((l) => l.from === g.id && !l.clear)
    };
}

/** 'same-place' or 'too-close' when gate `i` at `pos` stands too near another gate (`before`: only the gates before it) */
function crowding(c: Course, i: number, pos: readonly number[], before: boolean): 'same-place' | 'too-close' | null {
    const s = c.transform[0];
    const g = c.gates[i]!;
    let found: 'same-place' | 'too-close' | null = null;
    const last = before ? i : c.gates.length;
    for (let j = 0; j < last; j++) {
        if (j === i) continue;
        const o = c.gates[j]!;
        const d = len(sub(pos, o.pos)) * s;
        if (d < SAME_PLACE_M) return 'same-place';
        if (d < ((openingOf(g) + openingOf(o)) * s) / 2 + APART_GAP_M) found = 'too-close';
    }
    return found;
}

/** 26 unit ways (the cube's faces, edges, corners), x then y then z from -1 */
const WAYS: readonly Vec3[] = (() => {
    const out: Vec3[] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) out.push(unit([x, y, z]));
    return out;
})();
const UP: Vec3 = [0, 1, 0];
/** how far the walls are looked for along a way when ordering the ways, flown m */
const WAY_REACH_M = 40;
/** a centre is in a wall when a sphere of this touches one, flown m */
const SOLID_R = 0.002;

/** the ways in the order they are tried at each distance: straight up first for a buried gate, else away from the nearest wall first */
function waysFrom(col: VoxelCollision, centre: Vec3, upFirst: boolean): Vec3[] {
    if (upFirst) return [UP, ...WAYS.filter((d) => !(d[0] === 0 && d[1] === 1 && d[2] === 0))];
    const ranked = WAYS.map((d, k) => {
        const h = col.queryRay(centre[0], centre[1], centre[2], -d[0], -d[1], -d[2], WAY_REACH_M);
        return { d, k, wallM: h ? Math.hypot(h.x - centre[0], h.y - centre[1], h.z - centre[2]) : Infinity };
    });
    return ranked.sort((a, b) => a.wallM - b.wallM || a.k - b.k).map((x) => x.d);
}

/** the flown height of the walls' grid's floor: below it is the ground the scan stands on, never free air */
export function gridBottom(col: VoxelCollision): number {
    return col.flipXY ? -(col.gridMinY + col.numVoxelsY * col.voxelResolution) : col.gridMinY;
}

/**
 * Under the ground: a centre below the grid's floor, or in a wall whose shortest way out (to FIX_ALL_MAX_M, inside the
 * grid) is straight up.
 */
function buried(col: VoxelCollision, centre: Vec3): boolean {
    if (centre[1] < gridBottom(col)) return true;
    if (!sphereOverlaps(col, centre[0], centre[1], centre[2], SOLID_R)) return false;
    const exit = (d: Vec3): number => {
        for (let m = FIX_FINE_STEP_M; m <= FIX_ALL_MAX_M + 1e-9; m += FIX_FINE_STEP_M) {
            const p: Vec3 = [centre[0] + d[0] * m, centre[1] + d[1] * m, centre[2] + d[2] * m];
            if (gridDistance(col, p) === 0 && !sphereOverlaps(col, p[0], p[1], p[2], SOLID_R)) return m;
        }
        return Infinity;
    };
    const up = exit(UP);
    return up < Infinity && WAYS.every((d) => exit(d) >= up - 1e-9);
}

/** the distances tried, flown m: 0 (the place itself: only a turn), fine steps, then coarse steps to `maxM` */
function distances(maxM: number): number[] {
    const out = [0];
    for (let k = 1; k * FIX_FINE_STEP_M <= Math.min(maxM, FIX_FINE_M) + 1e-9; k++) out.push(r3(k * FIX_FINE_STEP_M));
    for (let m = FIX_FINE_M + FIX_COARSE_STEP_M; m <= maxM + 1e-9; m += FIX_COARSE_STEP_M) out.push(r3(m));
    return out;
}

/** the gate's turn along its leg at `pos`: kept when it is entered forward there, else turned about the vertical */
function turnAt(c: Course, i: number, pos: Vec3, level: CourseLevel): Quat {
    const g = c.gates[i]!;
    const prev = i > 0 ? c.gates[i - 1]!.pos : (c.start?.pos ?? null);
    if (!prev || isDive(g.quat)) return g.quat;
    const legIn = sub(pos, prev);
    if (entryDeg(axisOf(g.quat), legIn, i > 0 ? axisOf(c.gates[i - 1]!.quat) : null) <= AXIS_TOLERANCE_DEG) return g.quat;
    const next = c.gates[i + 1];
    const aims: Vec3[] = [];
    if (next) {
        const mid = unit([unit(legIn)[0] + unit(sub(next.pos, pos))[0], unit(legIn)[1] + unit(sub(next.pos, pos))[1], unit(legIn)[2] + unit(sub(next.pos, pos))[2]]);
        if (len(mid) > 0.5 && angleDeg(mid, legIn) <= aimToleranceDeg(level)) aims.push(mid);
    }
    aims.push(legIn);
    const now = yawOf(axisOf(g.quat));
    for (const aim of aims) {
        const want = yawOf(aim);
        if (want === null || now === null) continue;
        return roundQuat(quatMultiply(yawTurn(want - now), g.quat));
    }
    return g.quat;
}

/** the nearest point of the walls' grid to a flown point (unflipped as gridDistance), flown */
function nearestInGrid(col: VoxelCollision, p: Vec3): Vec3 {
    const f = col.flipXY ? -1 : 1;
    const q = [f * p[0], f * p[1], p[2]];
    const min = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const n = [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ];
    const c = q.map((v, k) => Math.max(min[k]!, Math.min(min[k]! + n[k]! * col.voxelResolution, v)));
    return [f * c[0]!, f * c[1]!, c[2]!];
}

/** the warnings of gate `i` where it stands (gates before it count for crowding) */
function gateKinds(c: Course, i: number, w: FixWalls, f: Faults = faults(c, i, w)): SaveWarningKind[] {
    const out = new Set<SaveWarningKind>();
    const g = c.gates[i]!;
    if (f.outside) out.add('in-scan');
    const centre = toFlown(g.pos, w.transform);
    if (centre[1] < gridBottom(w.col)) out.add('under-ground');
    else if (f.wall) out.add(buried(w.col, centre) ? 'under-ground' : 'in-scan');
    const crowd = crowding(c, i, g.pos, true);
    if (crowd) out.add(crowd);
    if (f.wrongWay) out.add('wrong-way');
    if (f.legIn) out.add('leg-blocked');
    return SAVE_WARNING_KINDS.filter((k) => out.has(k));
}

/**
 * The shortest repair of gate `i`, or null when it has nothing wrong or no place within `maxM` suits. A place suits when
 * the gate there is clear of the walls, within the grid's reach, apart from every other gate, entered forward (a dive gate
 * keeps its turn) and its leg out is not blocked where it was clear. Its leg in must be clear too; when no such place is
 * found within FIX_LEG_MAX_M past the nearest place that suits otherwise, that place is taken (the leg stays a leftover).
 */
function repairGate(c: Course, i: number, w: FixWalls, level: CourseLevel, maxM: number): { pose: GatePose; kinds: SaveWarningKind[] } | null {
    const g = c.gates[i]!;
    const was = faults(c, i, w);
    const kinds = gateKinds(c, i, w, was);
    if (kinds.length === 0) return null;
    const centre = toFlown(g.pos, w.transform);
    // a gate beyond the reach is searched for from the nearest point of the grid
    const origin = was.outside ? nearestInGrid(w.col, centre) : centre;
    const ways = waysFrom(w.col, origin, kinds.includes('under-ground'));
    const canTurn = !isDive(g.quat);
    let fallback: { pose: GatePose; at: number } | null = null;
    for (const m of distances(maxM)) {
        if (fallback && m > fallback.at + FIX_LEG_MAX_M + 1e-9) break;
        for (const d of m === 0 ? [UP] : ways) {
            const flown: Vec3 = [origin[0] + d[0] * m, origin[1] + d[1] * m, origin[2] + d[2] * m];
            if (gridDistance(w.col, flown) > NEAR_GRID_M || flown[1] < gridBottom(w.col)) continue;
            if (sphereOverlaps(w.col, flown[0], flown[1], flown[2], w.margin)) continue;
            const pos = m === 0 && !was.outside ? g.pos : toCourse(flown, w.transform);
            if (crowding(c, i, pos, false)) continue;
            const quat = turnAt(c, i, pos, level);
            const at = faults(withPose(c, i, pos, quat), i, w);
            if (at.outside || at.wall || (canTurn && at.wrongWay) || (at.legOut && !was.legOut)) continue;
            if (!at.legIn) return { pose: { pos, quat }, kinds };
            if (!fallback) fallback = { pose: { pos, quat }, at: m };
        }
    }
    return fallback ? { pose: fallback.pose, kinds } : null;
}

/** what is left wrong with the whole course: every gate's warnings, and a blocked start */
function leftoversOf(c: Course, w: FixWalls): SaveWarning[] {
    const out: SaveWarning[] = [];
    const start = c.start ? toFlown(c.start.pos, w.transform) : null;
    if (start && gridDistance(w.col, start) <= NEAR_GRID_M && sphereOverlaps(w.col, start[0], start[1], start[2], w.margin)) out.push({ kind: 'blocked-start', gates: [] });
    c.gates.forEach((g, i) => {
        for (const kind of gateKinds(c, i, w)) out.push({ kind, gates: kind === 'leg-blocked' ? [i > 0 ? c.gates[i - 1]!.id : 'start', g.id] : [g.id] });
    });
    const rank = (x: SaveWarning): number => SAVE_WARNING_KINDS.indexOf(x.kind);
    const at = (x: SaveWarning): number => (x.gates.length === 0 ? -1 : c.gates.findIndex((g) => g.id === x.gates[x.gates.length - 1]));
    return out.sort((a, b) => rank(a) - rank(b) || at(a) - at(b));
}

/**
 * Fix all automatically (t7-plan Part C 5): every offending gate, in the course's order, the shortest way to a valid place
 * (see the head of this file); the order of the gates, their ids, shapes and every gate that has nothing wrong are kept.
 * `moves` lists each gate moved or turned with its old place (the ghost and the one-step Undo); `leftovers` names what is
 * still wrong. Pure and deterministic.
 */
export function fixAll(course: Course, walls: FixWalls, level: CourseLevel, opts: FixAllOptions = {}): FixAllResult {
    const maxM = opts.maxM ?? FIX_ALL_MAX_M;
    const s = walls.transform[0];
    const moves: GateMove[] = [];
    let now = course;
    for (let i = 0; i < course.gates.length; i++) {
        if (opts.only !== undefined && i !== opts.only) continue;
        const r = repairGate(now, i, walls, level, maxM);
        if (!r) continue;
        const g = now.gates[i]!;
        const samePos = r.pose.pos.every((v, k) => v === g.pos[k]);
        const sameQuat = r.pose.quat.every((v, k) => v === g.quat[k]);
        if (samePos && sameQuat) continue;
        moves.push({
            index: i,
            id: g.id,
            before: { pos: g.pos, quat: g.quat },
            after: r.pose,
            kinds: r.kinds,
            movedM: Math.round(len(sub(r.pose.pos, g.pos)) * s * 100) / 100,
            turnedDeg: Math.round(angleDeg(axisOf(g.quat), axisOf(r.pose.quat)))
        });
        now = withPose(now, i, r.pose.pos, r.pose.quat);
    }
    return { course: now, moves, leftovers: leftoversOf(now, walls) };
}
