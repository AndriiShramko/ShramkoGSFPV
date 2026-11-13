// Train 1, lane rooms: "who is around" for every pilot, blind pilots first (rooms-plan.md 2.7, R28): where another drone is
// from this pilot's own drone: metres, left / right / ahead / behind (from his own heading), above / below. Shift+O says the
// nearest pilots, and a near call is said once when another drone comes closer than NEAR_M. Pure: positions in, text keys out.

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type Side = 'ahead' | 'behind' | 'left' | 'right';
export type Height = 'above' | 'below' | 'level';

/** Height difference that counts as above or below, metres (estimate: a drone's size plus the playout error). */
export const LEVEL_M = 1;
/** Pilots said by Shift+O at most (estimate: three names fit one short spoken line). */
export const WHO_MAX = 3;
/** A near call when another drone comes closer than this, metres (estimate: two 5-inch quads a few spans apart). */
export const NEAR_M = 3;
/** The near call is armed again only once that drone is this far again, metres (estimate: no repeats while hovering at the edge). */
export const NEAR_REARM_M = 5;

/**
 * A remote drone farther than this is not said, metres (estimate: larger than any scan flown; review RV-6: a remote pose is
 * whatever its sender wrote, so Shift+O must not say 5e38 metres).
 */
export const SAY_MAX_M = 1000;
/** The near call of one drone again only after this long, ms (estimate; review RV-6: a pose swinging 2 m / 6 m is said once). */
export const NEAR_AGAIN_MS = 10_000;
/** Room lines said a minute at most, Shift+O's answer not counted (estimate; review RV-6: joins, leaves and near calls). */
export const LINES_PER_MIN = 12;

export interface Relation { metres: number; side: Side; height: Height }

/** v rotated by the unit quaternion q (x, y, z, w). */
function rotate(q: Quat, v: Vec3): [number, number, number] {
    const [x, y, z, w] = q;
    const [vx, vy, vz] = v;
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/**
 * Where `other` is from a drone at `self` with attitude `quat`. The sim's frame: y up; a drone (and its camera) looks along
 * its local -z, so its right is local +x. Side is taken in the level plane: whichever of ahead and right is larger.
 */
export function relation(self: Vec3, quat: Quat, other: Vec3): Relation {
    const d: Vec3 = [other[0] - self[0], other[1] - self[1], other[2] - self[2]];
    const metres = Math.hypot(d[0], d[1], d[2]);
    const fwd = rotate(quat, [0, 0, -1]);
    const right = rotate(quat, [1, 0, 0]);
    // level the two directions; a drone looking straight up still has a right
    const fl = Math.hypot(fwd[0], fwd[2]) || 1;
    const rl = Math.hypot(right[0], right[2]) || 1;
    const a = (d[0] * fwd[0] + d[2] * fwd[2]) / fl;
    const r = (d[0] * right[0] + d[2] * right[2]) / rl;
    const side: Side = Math.abs(a) >= Math.abs(r) ? (a >= 0 ? 'ahead' : 'behind') : (r >= 0 ? 'right' : 'left');
    const height: Height = d[1] > LEVEL_M ? 'above' : d[1] < -LEVEL_M ? 'below' : 'level';
    return { metres, side, height };
}

export interface Other { slot: number; nick: string; pos: Vec3 }
export interface Near extends Relation { slot: number; nick: string }

/** The other pilots nearest first, at most `max`; a position not finite or beyond SAY_MAX_M is left out. */
export function nearest(self: Vec3, quat: Quat, others: readonly Other[], max = WHO_MAX): Near[] {
    return others.map((o) => ({ slot: o.slot, nick: o.nick, ...relation(self, quat, o.pos) }))
        .filter((n) => Number.isFinite(n.metres) && n.metres <= SAY_MAX_M)
        .sort((x, y) => x.metres - y.metres || x.slot - y.slot)
        .slice(0, max);
}

/** Rounded for speech: whole metres, at least 1. */
export const sayMetres = (m: number): number => Math.max(1, Math.round(m));

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The text of one pilot: "Anna, 6 metres, left, above." */
export function nearText(n: Near, t: T): string {
    return t('rooms.say.who', { nick: n.nick, m: sayMetres(n.metres), side: t(`rooms.side.${n.side}`), height: t(`rooms.height.${n.height}`) });
}

/** Shift+O: the key said (for RoomsHook.said) and its text; nobody around says so. */
export function whoLine(near: readonly Near[], t: T): { key: string; text: string } {
    if (near.length === 0) return { key: 'rooms.say.nobody', text: t('rooms.say.nobody') };
    return { key: 'rooms.say.who', text: near.map((n) => nearText(n, t)).join(' ') };
}

/**
 * Says each other drone once when it comes closer than NEAR_M; again only after it went beyond NEAR_REARM_M and at least
 * `againMs` after its last call (`now` in ms).
 */
export class NearWatch {
    private readonly close = new Set<number>();
    private readonly saidAt = new Map<number, number>();

    constructor(private readonly nearM = NEAR_M, private readonly rearmM = NEAR_REARM_M, private readonly againMs = NEAR_AGAIN_MS) {}

    /** the drones that just came near */
    update(near: readonly Near[], now = 0): Near[] {
        const out: Near[] = [];
        const seen = new Set<number>();
        for (const n of near) {
            seen.add(n.slot);
            if (n.metres < this.nearM && !this.close.has(n.slot)) {
                this.close.add(n.slot);
                const last = this.saidAt.get(n.slot);
                if (last === undefined || now - last >= this.againMs) {
                    this.saidAt.set(n.slot, now);
                    out.push(n);
                }
            } else if (n.metres > this.rearmM) this.close.delete(n.slot);
        }
        for (const s of [...this.close]) if (!seen.has(s)) this.close.delete(s);
        return out;
    }
}

/** At most `max` lines in any `windowMs` (sliding): `take(now)` says whether one more may be said now. */
export class LineBudget {
    private readonly at: number[] = [];

    constructor(private readonly max = LINES_PER_MIN, private readonly windowMs = 60_000) {}

    take(now: number): boolean {
        while (this.at.length > 0 && now - this.at[0]! >= this.windowMs) this.at.shift();
        if (this.at.length >= this.max) return false;
        this.at.push(now);
        return true;
    }
}
