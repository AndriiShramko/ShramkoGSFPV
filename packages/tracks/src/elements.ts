// Lane course4, stage C4-elements (owner's message 57: gates as they are put at competitions, not only a circle and a
// square). The walk (generate.ts) lays single upright gates; with CourseOptions.elements the finished course is composed
// into elements, each where its own free-space test passes, else the gate stays single:
//   single  the walk's gate as laid (ring or upright square)
//   square  an upright square of the gate's opening in place of a ring: its frame free across and up
//   tunnel  3 to 5 gates of the gate's own shape in a row along its axis, TUNNEL_GAP_M x scale apart: a straight free way
//           as long as the row and as wide as the frame plus the margin
//   flat    the walk's gate, then a square lying flat (the course format's dive turn, passed upward: a climb) FLAT_FWD_M
//           ahead and FLAT_RISE_M above it: the column from the gate up past the flat square free, and its frame free
//   cube    a cube frame (the format's kind cube-frame) in place of the gate, where a square would stand: the cube's
//           length along the axis free at the frame's width
// The walk lays rings almost only (gate-place-audit seeds 1-10: Wroclaw 70b50d42 225 rings of 225, Modlinek 39e63ce9 49 of
// 49): the flat square, the cube and the square take the ring's opening. Shares of the draw (ELEMENT_SHARES, a design
// choice after the lead's S9, not a measurement): single 0.25, square 0.2, tunnel 0.2, flat 0.15, cube 0.2. Every gate draws its element and a tunnel its length from its own seeded source, whether or not the
// element fits, so the same seed gives the same course. Gate 1 (START) and the last gate of an open course (FINISH) stay
// single. Two gates one over the other are not built: the proof (check.ts) flies straight legs, and a gate straight over
// another is passed by a loop it cannot express (docs/wip/fix3a.md, course4 C4, For the lead).
// Pure: + - * /, Math.sqrt; no trigonometry, no clock (the generator's rule).
import type { Quat, TrackGate, Vec3 } from './types';
import type { Sweeper } from './check';
import type { Rng } from './rng';

export type ElementKind = 'single' | 'square' | 'tunnel' | 'flat' | 'cube';
/** the lead's S9 shares (design, not measured); they sum to 1 */
export const ELEMENT_SHARES: readonly (readonly [ElementKind, number])[] = [
    ['single', 0.25],
    ['square', 0.2],
    ['tunnel', 0.2],
    ['flat', 0.15],
    ['cube', 0.2]
];
/** gates of a tunnel, the least and the most */
export const TUNNEL_MIN = 3;
export const TUNNEL_MAX = 5;
/** the gap between the gates of a tunnel at the plan's size, flown m (estimate: race tunnels stand about a gate apart) */
export const TUNNEL_GAP_M = 1.0;
/** the flat square: this far ahead of the gate before it and this far above it, flown m at the plan's size (estimate:
 *  the leg up is 31 degrees off the vertical, inside check.ts's 35 degree axis rule) */
export const FLAT_FWD_M = 1.5;
export const FLAT_RISE_M = 2.5;

const H = Math.SQRT1_2;
/** a quarter turn about x: the gate's local z points down, so its pass axis (-z) points up */
const PITCH_UP: Quat = [H, H, 0, 0];

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** q * r (w, x, y, z) */
function qmul(q: Quat, r: Quat): Quat {
    const [aw, ax, ay, az] = q;
    const [bw, bx, by, bz] = r;
    return [r6(aw * bw - ax * bx - ay * by - az * bz), r6(aw * bx + ax * bw + ay * bz - az * by), r6(aw * by - ax * bz + ay * bw + az * bx), r6(aw * bz + ax * by - ay * bx + az * bw)];
}

/** the element a draw of `u` in [0, 1) picks by ELEMENT_SHARES; with `kinds` (gap-gen S1: the level's LEVELS.elements)
 *  only among those, by their shares scaled to sum to 1 (no kinds: every kind, the draws of the old courses) */
export function elementOf(u: number, kinds?: readonly ElementKind[]): ElementKind {
    const shares = kinds ? ELEMENT_SHARES.filter(([k]) => kinds.includes(k)) : ELEMENT_SHARES;
    let sum = 0;
    for (const [, share] of shares) sum += share;
    let acc = 0;
    for (const [k, share] of shares) {
        acc += share;
        if ((kinds ? u * sum : u) < acc) return k;
    }
    return 'single';
}

/** half the outer width of a gate's frame, scan units */
export function halfOuter(shape: TrackGate['shape']): number {
    const s = shape as { kind: string; side?: number; bar?: number; diameter?: number; tube?: number };
    return s.kind === 'ring' ? (s.diameter ?? 0) / 2 + (s.tube ?? 0) / 2 : (s.side ?? 0) / 2 + (s.bar ?? 0);
}

/** the tunnel's space test: the straight way along the row (and a margin past each end) free at the frame's half width */
export function tunnelFits(sw: Sweeper, centre: Vec3, axis: Vec3, n: number, gapM: number, halfM: number, marginM: number): boolean {
    const reach = ((n - 1) * gapM) / 2 + marginM;
    return sw.free(add(centre, mul(axis, -reach)), add(centre, mul(axis, reach)), halfM + marginM);
}

/** the flat square's space test: the column from the gate before it up past it free, and its frame free across */
export function flatFits(sw: Sweeper, from: Vec3, at: Vec3, axis: Vec3, halfM: number, runM: number, marginM: number): boolean {
    const side: Vec3 = [-axis[2], 0, axis[0]];
    const top = add(at, [0, runM, 0]);
    return sw.free(from, top, marginM) && sw.free(add(at, mul(side, -halfM)), add(at, mul(side, halfM)), marginM) && sw.free(add(at, mul(axis, -halfM)), add(at, mul(axis, halfM)), marginM);
}

/** the upright square's space test: its frame free across and up and down */
export function squareFits(sw: Sweeper, centre: Vec3, axis: Vec3, halfM: number, marginM: number): boolean {
    const side: Vec3 = [-axis[2], 0, axis[0]];
    return sw.free(add(centre, mul(side, -halfM)), add(centre, mul(side, halfM)), marginM) && sw.free(add(centre, [0, -halfM, 0]), add(centre, [0, halfM, 0]), marginM);
}

/** a square of the gate's opening (a ring's diameter, its tube as the bar), scan units */
export function squareOf(shape: TrackGate['shape']): { kind: 'square'; side: number; bar: number } {
    const s = shape as { kind: string; side?: number; bar?: number; diameter?: number; tube?: number };
    return s.kind === 'ring' ? { kind: 'square', side: s.diameter ?? 0, bar: s.tube ?? 0 } : { kind: 'square', side: s.side ?? 0, bar: s.bar ?? 0 };
}

/** the cube's space test: its length along the axis free at the frame's half width */
export function cubeFits(sw: Sweeper, centre: Vec3, axis: Vec3, halfM: number, marginM: number): boolean {
    return sw.free(add(centre, mul(axis, -halfM)), add(centre, mul(axis, halfM)), halfM + marginM);
}

export interface ComposeInput {
    /** the walk's course (scan frame), proven */
    readonly gates: readonly TrackGate[];
    readonly closed: boolean;
    /** the course's start, flown world */
    readonly start: Vec3;
    /** scan to flown and back */
    readonly toFlown: (q: Vec3) => Vec3;
    readonly toScan: (w: Vec3) => Vec3;
    /** the scene's scale s and the ladder step k */
    readonly s: number;
    readonly k: number;
    readonly marginM: number;
    readonly sweeper: Sweeper;
    /** the gate's pass direction (unit, horizontal) from its quaternion */
    readonly axisOf: (g: TrackGate) => Vec3;
    /** the element's legs in and out stay over the well-scanned scan (generate.ts legWell) */
    readonly legWell: (a: Vec3, b: Vec3) => boolean;
    /** the one-element proof: the gates from `from`, laps 1 (check.ts checkTrack through generate.ts build) */
    readonly proven: (gs: TrackGate[], from: Vec3) => boolean;
    readonly rng: Rng;
    /** most gates in a course (server.ts SERVER_MAX_GATES) */
    readonly maxGates: number;
    /** the element kinds drawn (an asked course: its level's LEVELS.elements; medium has no flat square and no cube); none:
     *  every kind */
    readonly kinds?: readonly ElementKind[];
}

export interface Composed {
    readonly gates: TrackGate[];
    /** elements drawn and placed per kind (the walk's gates 2 to n-1, or n for a closed course) */
    readonly drawn: Record<ElementKind, number>;
    readonly placed: Record<ElementKind, number>;
    /** tries refused by their space test and by their proof (an owed element is tried again at later gates) */
    readonly noSpace: Record<ElementKind, number>;
    readonly noProof: Record<ElementKind, number>;
    /** the proof's refusals by leg: [the leg in, the leg out, the flown check] (course5 Z3: which leg refuses a flat square) */
    readonly noProofLeg: Record<ElementKind, [number, number, number]>;
}

/** The walk's course composed into elements (see the header). Gate ids are renumbered g1.. */
export function composeElements(c: ComposeInput): Composed {
    const drawn: Record<ElementKind, number> = { single: 0, square: 0, tunnel: 0, flat: 0, cube: 0 };
    const placed: Record<ElementKind, number> = { single: 0, square: 0, tunnel: 0, flat: 0, cube: 0 };
    const noSpace: Record<ElementKind, number> = { single: 0, square: 0, tunnel: 0, flat: 0, cube: 0 };
    const noProof: Record<ElementKind, number> = { single: 0, square: 0, tunnel: 0, flat: 0, cube: 0 };
    const noProofLeg: Record<ElementKind, [number, number, number]> = { single: [0, 0, 0], square: [0, 0, 0], tunnel: [0, 0, 0], flat: [0, 0, 0], cube: [0, 0, 0] };
    const out: TrackGate[] = [];
    const n = c.gates.length;
    let total = n;
    let prev = c.start;
    // course5 Z3: a refused element is drawn again at a later gate. `owed` holds the drawn elements not yet placed, oldest
    // first; a gate tries them in that order (each kind once). A gate where none fits stays single: a single over the
    // design, so the next drawn single gives its gate to an owed element instead. Where nothing is refused the course is
    // the one of C4 (same seed, same course). Wroclaw 70b50d42 seeds 1-10 before: tunnel 0.09, flat 0.04 of the drawn
    // elements against 0.2 and 0.15 (gate-place-audit --elements, docs/wip/fix3a.md C4 pass 2).
    const owed: ElementKind[] = [];
    let spare = 0;
    for (let i = 0; i < n; i++) {
        const g = c.gates[i]!;
        const u = c.rng.next();
        const len = TUNNEL_MIN + c.rng.int(0, TUNNEL_MAX - TUNNEL_MIN);
        const fixed = i === 0 || (!c.closed && i === n - 1);
        const P = c.toFlown(g.pos as unknown as Vec3);
        const next = i + 1 < n ? c.toFlown(c.gates[i + 1]!.pos as unknown as Vec3) : c.closed ? c.toFlown(c.gates[0]!.pos as unknown as Vec3) : null;
        const axis = c.axisOf(g);
        const half = halfOuter(g.shape) * c.s;
        /** the element `kind` at this gate, or null where its space test fails */
        const build = (kind: ElementKind): TrackGate[] | null => {
            if (kind === 'tunnel' && total + len - 1 <= c.maxGates) {
                const gap = TUNNEL_GAP_M * c.k;
                if (!tunnelFits(c.sweeper, P, axis, len, gap, half, c.marginM)) return null;
                const row: TrackGate[] = [];
                for (let j = 0; j < len; j++) row.push({ ...g, pos: c.toScan(add(P, mul(axis, (j - (len - 1) / 2) * gap))) as TrackGate['pos'] });
                return row;
            }
            if (kind === 'square') {
                const sq = squareOf(g.shape);
                return squareFits(c.sweeper, P, axis, halfOuter(sq) * c.s, c.marginM) ? [{ ...g, shape: sq as TrackGate['shape'] }] : null;
            }
            if (kind === 'flat' && total + 1 <= c.maxGates) {
                const sq = squareOf(g.shape);
                const hs = halfOuter(sq) * c.s;
                const F = add(add(P, mul(axis, FLAT_FWD_M * c.k)), [0, FLAT_RISE_M * c.k, 0]);
                const legUp = Math.sqrt(FLAT_FWD_M * FLAT_FWD_M + FLAT_RISE_M * FLAT_RISE_M) * c.k;
                if (!flatFits(c.sweeper, P, F, axis, hs, 0.4 * legUp + c.marginM, c.marginM)) return null;
                return [g, { ...g, shape: sq as TrackGate['shape'], pos: c.toScan(F) as TrackGate['pos'], quat: qmul(g.quat as unknown as Quat, PITCH_UP) as TrackGate['quat'] }];
            }
            if (kind === 'cube') {
                const sq = squareOf(g.shape);
                return cubeFits(c.sweeper, P, axis, halfOuter(sq) * c.s, c.marginM) ? [{ ...g, shape: { kind: 'cube-frame', side: sq.side, bar: sq.bar } as TrackGate['shape'] }] : null;
            }
            return null;
        };
        /** the element proven with its neighbours: -1, or the leg that refuses it (0 in, 1 out, 2 the flown check) */
        const refusedBy = (el: TrackGate[]): number => {
            const first = c.toFlown(el[0]!.pos as unknown as Vec3);
            const last = c.toFlown(el[el.length - 1]!.pos as unknown as Vec3);
            const tail = next && i + 1 < n ? [c.gates[i + 1]!] : [];
            if (!c.legWell(prev, first)) return 0;
            if (next && !c.legWell(last, next)) return 1;
            return c.proven([...el, ...tail], prev) ? -1 : 2;
        };
        let put: TrackGate[] | null = null;
        if (!fixed) {
            const d = elementOf(u, c.kinds);
            drawn[d]++;
            if (d === 'single' && spare === 0) placed.single++;
            else {
                if (d === 'single') spare--;
                else owed.push(d);
                const tried = new Set<ElementKind>();
                for (const kind of owed) {
                    if (tried.has(kind)) continue;
                    tried.add(kind);
                    const el = build(kind);
                    if (!el) {
                        noSpace[kind]++;
                        continue;
                    }
                    const leg = refusedBy(el);
                    if (leg >= 0) {
                        noProof[kind]++;
                        noProofLeg[kind][leg]++;
                        continue;
                    }
                    put = el;
                    placed[kind]++;
                    owed.splice(owed.indexOf(kind), 1);
                    break;
                }
                if (!put) spare++;
            }
        }
        if (put) {
            total += put.length - 1;
            out.push(...put);
        } else out.push(g);
        prev = c.toFlown(out[out.length - 1]!.pos as unknown as Vec3);
    }
    return { gates: out.map((g, i) => ({ ...g, id: `g${i + 1}` })), drawn, placed, noSpace, noProof, noProofLeg };
}
