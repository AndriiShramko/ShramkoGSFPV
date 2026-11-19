// Lane edit4s (E7): the small corrections a refused Save offers to make for the pilot. Pure: the walls come in, the fixes go
// out; the page asks, shows the overview, applies them as one undo step and saves (course.ts, saveFlow).
import { AXIS_TOLERANCE_DEG, checkTrack, gateAxis, nearestWall, reportProblems, toTrackV1 } from '@gsfpv/tracks';
import type { Course, CourseCheck, CourseProblem } from '@gsfpv/tracks';
import type { VoxelCollision } from '@gsfpv/collision';
import { quatMultiply, quatNormalize, yawQuat } from '@shramko/sonic-fpv';
import type { Quat, Vec3 } from '@shramko/sonic-fpv';

export type FixKind = 'face-line' | 'nudge' | 'lift';
/** a gate's place and turn in the course's own frame (as TrackGate.pos and .quat) */
export interface GatePose {
    readonly pos: Vec3;
    readonly quat: Quat;
}
/** one gate changed by one correction */
export interface FixedGate {
    readonly index: number;
    readonly before: GatePose;
    readonly after: GatePose;
}
export interface Fix {
    readonly kind: FixKind;
    /** the problem it clears */
    readonly problem: CourseProblem;
    readonly gates: readonly FixedGate[];
    /** the change in words (key and arguments; gates from 1), for the line that lists what changed */
    readonly words: { readonly key: string; readonly args: Record<string, number> };
}
/** what the fixer sees of the scan: the flown walls, the flown transform, the check's margin */
export interface FixWalls {
    readonly col: VoxelCollision;
    readonly transform: readonly [number, number, number, number];
    readonly margin: number;
}

/** flown metres a nudge or a lift steps by, and the most it goes (estimates: a correction stays small) */
export const FIX_STEP_M = 0.1;
export const FIX_MAX_M = 1;
/** problems looked at, at most (each costs a few window checks) */
export const FIX_MAX_PROBLEMS = 12;

export const FIX_WORDS: Record<FixKind, string> = {
    'face-line': 'course.fix.done.turned',
    nudge: 'course.fix.done.moved',
    lift: 'course.fix.done.lifted'
};
/** a lift of a leg from the start moves only its far gate */
export const LIFT_ONE_KEY = 'course.fix.done.liftedOne';
/** the offer, its buttons and the change list line */
export const OFFER_KEYS = {
    looking: 'course.fix.looking',
    all: 'course.fix.offer',
    some: 'course.fix.offerSome',
    yes: 'course.fix.yes',
    yesOnly: 'course.fix.yesOnly',
    show: 'course.fix.show',
    close: 'course.fix.close',
    done: 'course.fix.done'
} as const;
/** the offer's words for each problem it found, by problem */
export const OFFER_WORDS = {
    'gate-direction': 'course.fix.found.direction',
    'gate-wall': 'course.fix.found.wall',
    'leg-wall': 'course.fix.found.leg',
    legStart: 'course.fix.found.legStart'
} as const;

const DEG = Math.PI / 180;
const keyOf = (p: CourseProblem): string => (p.code === 'leg-wall' ? `leg:${p.from}>${p.to}` : 'gate' in p ? `${p.code}:${p.gate}` : p.code);
const horizontalYaw = (v: Vec3): number | null => (Math.hypot(v[0], v[2]) < 1e-9 ? null : Math.atan2(v[0], -v[2]) / DEG);
const angleDeg = (a: Vec3, b: Vec3): number => {
    const la = Math.hypot(a[0], a[1], a[2]);
    const lb = Math.hypot(b[0], b[1], b[2]);
    if (la < 1e-12 || lb < 1e-12) return 0;
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
    return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
};
const unit = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
};
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
const withGates = (c: Course, poses: readonly FixedGate[]): Course => {
    const at = new Map(poses.map((p) => [p.index, p.after]));
    return { ...c, gates: c.gates.map((g, i) => (at.has(i) ? { ...g, pos: at.get(i)!.pos, quat: at.get(i)!.quat } : g)) };
};

/**
 * The problems of gates `from`..`to` and the legs into and between them, checked on a short course (the point before `from`
 * as its start, the gates from..to and the one after): milliseconds, where the whole course takes seconds on a big scan.
 * Leg and gate names are the course's own. The start's own problems count only when `from` is 0.
 */
export function windowProblems(c: Course, from: number, to: number, w: FixWalls): CourseProblem[] {
    const v1 = toTrackV1(c);
    const last = Math.min(c.gates.length - 1, to + 1);
    const prev = from > 0 ? c.gates[from - 1]! : null;
    const start = prev ? { pos: prev.pos, yawDeg: 0 } : v1.start;
    const part = { ...v1, start, laps: 1, gates: v1.gates.slice(from, last + 1) };
    const out = reportProblems(checkTrack(part, w.col, w.transform, w.margin, false));
    return out
        .filter((p) => prev === null || (p.code !== 'start-wall' && p.code !== 'no-start'))
        .map((p) => (p.code === 'leg-wall' && p.from === 'start' && prev ? { ...p, from: prev.id } : p))
        // the gate after the window has no leg out here: only its direction is judged
        .filter((p) => !(p.code === 'gate-wall' && last > to && p.gate === c.gates[last]!.id));
}

/** true when the window around the changed gates no longer has `target` and has nothing that was not wrong before */
function clears(c: Course, from: number, to: number, target: CourseProblem, before: ReadonlySet<string>, w: FixWalls): boolean {
    const got = windowProblems(c, from, to, w).map(keyOf);
    const t = keyOf(target);
    return !got.includes(t) && got.every((k) => before.has(k));
}

/** the turn about the vertical that points the gate's axis along `yawDeg`, kept only if it does */
function facedAlong(q: Quat, yawDeg: number): Quat {
    const now = horizontalYaw(gateAxis(q)) ?? yawDeg;
    let best: Quat = q;
    let bestOff = Infinity;
    for (const sign of [1, -1]) {
        const t = quatNormalize(quatMultiply(yawQuat(sign * (yawDeg - now)), q));
        const off = Math.abs(((((horizontalYaw(gateAxis(t)) ?? yawDeg) - yawDeg) % 360) + 540) % 360 - 180);
        if (off < bestOff) {
            bestOff = off;
            best = t;
        }
    }
    return best;
}

function faceLine(c: Course, i: number, p: CourseProblem, before: ReadonlySet<string>, w: FixWalls): Fix | null {
    const g = c.gates[i]!;
    const prev: Vec3 | null = i > 0 ? c.gates[i - 1]!.pos : c.start ? c.start.pos : null;
    if (!prev) return null;
    const legIn: Vec3 = unit([g.pos[0] - prev[0], g.pos[1] - prev[1], g.pos[2] - prev[2]]);
    const next = c.gates[i + 1];
    const legOut: Vec3 | null = next ? unit([next.pos[0] - g.pos[0], next.pos[1] - g.pos[1], next.pos[2] - g.pos[2]]) : null;
    // between the leg in and the leg out first (the generator's own way), then straight along the leg in
    const aims: Vec3[] = legOut ? [unit([legIn[0] + legOut[0], legIn[1] + legOut[1], legIn[2] + legOut[2]]), legIn] : [legIn];
    for (const aim of aims) {
        const yaw = horizontalYaw(aim);
        if (yaw === null) continue;
        const quat = facedAlong(g.quat, yaw);
        if (angleDeg(gateAxis(quat), legIn) > AXIS_TOLERANCE_DEG) continue;
        const moved: FixedGate = { index: i, before: { pos: g.pos, quat: g.quat }, after: { pos: g.pos, quat } };
        if (!clears(withGates(c, [moved]), i, i, p, before, w)) continue;
        const deg = Math.round(angleDeg(gateAxis(g.quat), gateAxis(quat)));
        return { kind: 'face-line', problem: p, gates: [moved], words: { key: FIX_WORDS['face-line'], args: { g: i + 1, deg } } };
    }
    return null;
}

/** flown metres of the step `k` as course units along `dir` */
const stepped = (pos: Vec3, dir: Vec3, m: number, s: number): Vec3 => [r3(pos[0] + (dir[0] * m) / s), r3(pos[1] + (dir[1] * m) / s), r3(pos[2] + (dir[2] * m) / s)];

function nudge(c: Course, i: number, p: CourseProblem, before: ReadonlySet<string>, w: FixWalls): Fix | null {
    const g = c.gates[i]!;
    const [s, tx, ty, tz] = w.transform;
    const hit = nearestWall(w.col, [g.pos[0] * s + tx, g.pos[1] * s + ty, g.pos[2] * s + tz]);
    if (!hit) return null;
    const away: Vec3 = [-hit.dir[0], -hit.dir[1], -hit.dir[2]];
    for (let k = 1; k * FIX_STEP_M <= FIX_MAX_M + 1e-9; k++) {
        const m = k * FIX_STEP_M;
        const moved: FixedGate = { index: i, before: { pos: g.pos, quat: g.quat }, after: { pos: stepped(g.pos, away, m, s), quat: g.quat } };
        if (!clears(withGates(c, [moved]), i, i, p, before, w)) continue;
        return { kind: 'nudge', problem: p, gates: [moved], words: { key: FIX_WORDS.nudge, args: { g: i + 1, cm: Math.round(m * 100) } } };
    }
    return null;
}

function lift(c: Course, p: Extract<CourseProblem, { code: 'leg-wall' }>, before: ReadonlySet<string>, w: FixWalls): Fix | null {
    const a = c.gates.findIndex((g) => g.id === p.from);
    const b = c.gates.findIndex((g) => g.id === p.to);
    if (b < 0) return null;
    const ends = a >= 0 ? [a, b] : [b];
    const s = w.transform[0];
    for (let k = 1; k * FIX_STEP_M <= FIX_MAX_M + 1e-9; k++) {
        const m = k * FIX_STEP_M;
        const moved = ends.map((i): FixedGate => {
            const g = c.gates[i]!;
            return { index: i, before: { pos: g.pos, quat: g.quat }, after: { pos: stepped(g.pos, [0, 1, 0], m, s), quat: g.quat } };
        });
        if (!clears(withGates(c, moved), Math.min(...ends), Math.max(...ends), p, before, w)) continue;
        const cm = Math.round(m * 100);
        const words = a >= 0 ? { key: FIX_WORDS.lift, args: { a: a + 1, b: b + 1, cm } } : { key: LIFT_ONE_KEY, args: { b: b + 1, cm } };
        return { kind: 'lift', problem: p, gates: moved, words };
    }
    return null;
}

/**
 * The small corrections for `problems` of `c`: a gate facing the wrong way is turned along the line (gate-direction), a gate
 * touching a wall is moved away from the nearest wall in 0.1 m steps up to 1 m (gate-wall), a leg touching a wall has both
 * its gates lifted the same way (leg-wall). Each is found on the course with the ones before it applied and is kept only if
 * the check around it shows the problem gone and nothing new. Problems with no small correction are left (the caller says
 * what to do about them).
 */
export function proposeFixes(c: Course, problems: readonly CourseProblem[], w: FixWalls): Fix[] {
    const before = new Set(problems.map(keyOf));
    const order: Record<string, number> = { 'gate-direction': 0, 'gate-wall': 1, 'leg-wall': 2 };
    const todo = problems.filter((p) => p.code in order).sort((x, y) => order[x.code]! - order[y.code]!).slice(0, FIX_MAX_PROBLEMS);
    const fixes: Fix[] = [];
    let now = c;
    for (const p of todo) {
        let f: Fix | null = null;
        if (p.code === 'leg-wall') f = lift(now, p, before, w);
        else if (p.code === 'gate-direction' || p.code === 'gate-wall') {
            const i = now.gates.findIndex((g) => g.id === p.gate);
            if (i < 0) continue;
            f = p.code === 'gate-direction' ? faceLine(now, i, p, before, w) : nudge(now, i, p, before, w);
        }
        if (!f) continue;
        fixes.push(f);
        now = withGates(now, f.gates);
    }
    return fixes;
}

/** the course with every fix applied, in order */
export function withFixes(c: Course, fixes: readonly Fix[]): Course {
    return fixes.reduce((acc, f) => withGates(acc, f.gates), c);
}

export interface FixResult {
    readonly fixes: readonly Fix[];
    readonly course: Course;
    readonly problems: readonly CourseProblem[];
}

/**
 * The whole course's check (the authority; seconds on a big scan, so at most three times) over the fixes: a fix whose problem
 * is still there, or that sits next to a problem that was not there before, is dropped and the rest checked again.
 */
export function confirmFixes(c: Course, problems: readonly CourseProblem[], fixes: readonly Fix[], check: CourseCheck): FixResult {
    const before = new Set(problems.map(keyOf));
    let kept = [...fixes];
    for (let round = 0; round < 3 && kept.length > 0; round++) {
        const course = withFixes(c, kept);
        const got = check(course);
        const keys = new Set(got.map(keyOf));
        const fresh = got.filter((p) => !before.has(keyOf(p)));
        const near = new Set<number>();
        for (const p of fresh) {
            const ids = p.code === 'leg-wall' ? [p.from, p.to] : 'gate' in p ? [p.gate] : [];
            for (const id of ids) {
                const i = course.gates.findIndex((g) => g.id === id);
                for (const d of [-1, 0, 1]) near.add(i + d);
            }
            if (ids.length === 0) for (const f of kept) for (const g of f.gates) near.add(g.index);
        }
        const next = kept.filter((f) => !keys.has(keyOf(f.problem)) && !f.gates.some((g) => near.has(g.index)));
        if (next.length === kept.length) return { fixes: kept, course, problems: got };
        kept = next;
    }
    return { fixes: [], course: c, problems };
}

/** the offer's words for one problem (gates from 1), or null when it has none */
export function foundWords(c: Course, p: CourseProblem): { key: string; args: Record<string, number> } | null {
    const n = (id: string): number => c.gates.findIndex((g) => g.id === id) + 1;
    if (p.code === 'gate-direction') return { key: OFFER_WORDS['gate-direction'], args: { g: n(p.gate) } };
    if (p.code === 'gate-wall') return { key: OFFER_WORDS['gate-wall'], args: { g: n(p.gate) } };
    if (p.code === 'leg-wall') return n(p.from) === 0 ? { key: OFFER_WORDS.legStart, args: { b: n(p.to) } } : { key: OFFER_WORDS['leg-wall'], args: { a: n(p.from), b: n(p.to) } };
    return null;
}

/**
 * The overview the corrections are made in (the owner: 'you pull back to the overall view so all of them are seen'): the eye
 * above and behind the middle of the gates, far enough for the widest spread to fill `share` of the view's height, pulled in
 * before a wall when `ray` says one is in the way (flown frame).
 */
export function courseOverview(points: readonly Vec3[], tanHalfV: number, ray: ((o: Vec3, d: Vec3, max: number) => number | null) | null, share = 0.8): { eye: Vec3; at: Vec3 } | null {
    if (points.length === 0) return null;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p[k]!);
        hi[k] = Math.max(hi[k]!, p[k]!);
    }
    const at: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const size = Math.max(2, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    const want = size / 2 / Math.max(0.05, tanHalfV * share);
    // from the long side of the spread, 45 degrees up
    const along: Vec3 = hi[0] - lo[0] >= hi[2] - lo[2] ? [0, 0.7071, 0.7071] : [0.7071, 0.7071, 0];
    const free = ray ? ray(at, along, want) : null;
    const d = free === null ? want : Math.max(1, free - 0.3);
    return { eye: [at[0] + along[0] * d, at[1] + along[1] * d, at[2] + along[2] * d], at };
}
