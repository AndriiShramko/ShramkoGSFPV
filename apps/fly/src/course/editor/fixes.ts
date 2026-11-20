// Lane edit4s (E7): the small corrections a refused Save offers to make for the pilot. Pure: the walls come in, the fixes go
// out; the page asks, shows the overview, applies them as one undo step and saves (course.ts, saveFlow). Lane n-save S2:
// a gate's turn and its move out of a wall are fixAll's (packages/tracks autofix.ts) for that one gate, the one repair the
// Save dialog's 'Fix all automatically' makes for every gate.
import { REQUEST_DEFAULTS, checkTrack, fixAll, reportProblems, toTrackV1 } from '@gsfpv/tracks';
import type { Course, CourseCheck, CourseLevel, CourseProblem, FixWalls, GatePose } from '@gsfpv/tracks';
import type { Vec3 } from '@shramko/sonic-fpv';

export type { FixWalls, GatePose } from '@gsfpv/tracks';

export type FixKind = 'face-line' | 'nudge' | 'lift';
/** the pilot's answer to the offer: make them (and save when all are made), point at the first, or not now */
export type FixAnswer = 'yes' | 'show' | 'close';
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
/** flown metres a nudge or a lift steps by, and the most it goes (estimates: a correction stays small) */
export const FIX_STEP_M = 0.1;
export const FIX_MAX_M = 1;
/** problems looked at, at most (each costs a few window checks) */
export const FIX_MAX_PROBLEMS = 12;
/** ms the course is shown whole before the corrections, and corrected before the save (estimate: long enough to see it) */
export const FIX_SHOW_MS = 900;

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

const keyOf = (p: CourseProblem): string => (p.code === 'leg-wall' ? `leg:${p.from}>${p.to}` : 'gate' in p ? `${p.code}:${p.gate}` : p.code);
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

/** flown metres of the step `k` as course units along `dir` */
const stepped = (pos: Vec3, dir: Vec3, m: number, s: number): Vec3 => [r3(pos[0] + (dir[0] * m) / s), r3(pos[1] + (dir[1] * m) / s), r3(pos[2] + (dir[2] * m) / s)];

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
        const words: Fix['words'] = a >= 0 ? { key: FIX_WORDS.lift, args: { a: a + 1, b: b + 1, cm } } : { key: LIFT_ONE_KEY, args: { b: b + 1, cm } };
        return { kind: 'lift', problem: p, gates: moved, words };
    }
    return null;
}

/** a turn where the gate stands (gate-direction) or a move of at most FIX_MAX_M (gate-wall): fixAll for gate `i` alone */
function oneGate(c: Course, i: number, p: Extract<CourseProblem, { code: 'gate-direction' | 'gate-wall' }>, w: FixWalls, level: CourseLevel): Fix | null {
    const m = fixAll(c, w, level, { only: i, maxM: p.code === 'gate-direction' ? 0 : FIX_MAX_M }).moves[0];
    if (!m) return null;
    const gates: FixedGate[] = [{ index: i, before: m.before, after: m.after }];
    if (p.code === 'gate-direction') return { kind: 'face-line', problem: p, gates, words: { key: FIX_WORDS['face-line'], args: { g: i + 1, deg: m.turnedDeg } } };
    return { kind: 'nudge', problem: p, gates, words: { key: FIX_WORDS.nudge, args: { g: i + 1, cm: Math.round(m.movedM * 100) } } };
}

/**
 * The small corrections for `problems` of `c`: a gate facing the wrong way is turned along the line where it stands
 * (gate-direction), a gate touching a wall is moved the shortest way out, at most FIX_MAX_M (gate-wall): both are fixAll's
 * repair of that one gate; a leg touching a wall has both its gates lifted the same way (leg-wall). Each is found on the
 * course with the ones before it applied. Problems with no small correction are left (the caller says what to do about them).
 */
export function proposeFixes(c: Course, problems: readonly CourseProblem[], w: FixWalls, level: CourseLevel = REQUEST_DEFAULTS.level): Fix[] {
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
            f = oneGate(now, i, p, w, level);
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
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
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
