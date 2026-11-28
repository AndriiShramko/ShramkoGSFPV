// Lane w1-dialog (train 5, R2 of designs/w1-diag.md; the owner's brief line 667, idea c: "I flew a part, pressed Shift+G,
// and it asks: lay more here, where the drone is, or everything from scratch"): Add here. The kept course's gates stay where
// they are, gate for gate (position, turn, shape); the course laid round the drone (planCourse with PlanInput.keep, its walk
// told the kept gates are taken: CoursePlace.occupied) is spliced into the kept ring at one leg of each, and the whole ring
// is proven again. Pure: no DOM, no clock, no Math.random.
//
// The splice: kept ring G (legs G[i] -> G[i+1], the last one back to G[0]) and new ring H. Cut leg i of G and leg j of H and
// join them crosswise: G[0..i], H[j+1..], H[..j], G[i+1..]. Two new legs, G[i] -> H[j+1] and H[j] -> G[i+1]; every other leg
// is one of the two courses' own. The pairs are tried by the length they add, shortest first.
import { checkTrack, flownStart, marginOf, sweeperOf } from './check';
import { COURSE_DEFAULTS, nearestYaw, yawQuatStep } from './generate';
import { MAX_LEG_M, SERVER_MAX_GATES } from './server';
import type { SceneTransform, TrackFile, TrackGate, Vec3, VoxelCollision } from './types';

/** splices proven at most (each is one whole-course check, about as long as one gate's proof times the gates; estimate) */
export const JOIN_TRIES = 16;

/** the places a kept course takes, flown world: its gates and its start (CoursePlace.occupied) */
export function occupiedOf(kept: TrackFile, transform: SceneTransform): Vec3[] {
    const s = transform[0];
    const out: Vec3[] = kept.gates.map((g) => [s * g.pos[0] + transform[1], s * g.pos[1] + transform[2], s * g.pos[2] + transform[3]]);
    const st = flownStart(kept, transform);
    if (st) out.push(st.pos);
    return out;
}

/** the gates a course added to `kept` may have at most (the server keeps at most SERVER_MAX_GATES) */
export function addRoom(kept: TrackFile): number {
    return Math.max(0, SERVER_MAX_GATES - kept.gates.length);
}

/** a gate turned to face the leg that now flies into it (from `from`, scan frame; a yaw turns the same in both frames) */
function facing(g: TrackGate, from: Vec3): TrackGate {
    const d: Vec3 = [g.pos[0] - from[0], g.pos[1] - from[1], g.pos[2] - from[2]];
    return { ...g, quat: yawQuatStep(nearestYaw(d)) };
}

/**
 * `kept` with the gates of `added` spliced in (both laid on `walls` at `transform`), closed, proven whole at the kept course's
 * margin; null when no splice of JOIN_TRIES holds. The kept gates keep their order, position, turn and shape; the kept start
 * stays; a new gate whose leg in changed is turned to face it when it does not hold as it was laid.
 */
export function joinCourses(kept: TrackFile, added: TrackFile, walls: VoxelCollision, transform: SceneTransform): TrackFile | null {
    const G = kept.gates, H = added.gates;
    if (G.length === 0) return null;
    if (H.length === 0 || G.length + H.length > SERVER_MAX_GATES) return null;
    const s = transform[0];
    const fl = (g: TrackGate): Vec3 => [s * g.pos[0] + transform[1], s * g.pos[1] + transform[2], s * g.pos[2] + transform[3]];
    const d = (a: Vec3, b: Vec3): number => {
        const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
        return Math.sqrt(x * x + y * y + z * z);
    };
    const gf = G.map(fl), hf = H.map(fl);
    const margin = marginOf(kept);
    const sweeper = sweeperOf(walls);
    const pairs: { i: number; j: number; cost: number }[] = [];
    for (let i = 0; i < G.length; i++)
        for (let j = 0; j < H.length; j++) {
            const gi = gf[i]!, gn = gf[(i + 1) % G.length]!, hj = hf[j]!, hn = hf[(j + 1) % H.length]!;
            const a = d(gi, hn), b = d(hj, gn);
            if (a > MAX_LEG_M || b > MAX_LEG_M) continue;
            pairs.push({ i, j, cost: a + b - (G.length > 1 ? d(gi, gn) : 0) - (H.length > 1 ? d(hj, hn) : 0) });
        }
    pairs.sort((x, y) => x.cost - y.cost || x.i - y.i || x.j - y.j);
    const laps = kept.laps > 1 ? kept.laps : added.laps > 1 ? added.laps : COURSE_DEFAULTS.laps;
    let tried = 0;
    for (const { i, j } of pairs) {
        if (tried >= JOIN_TRIES) break;
        const gi = gf[i]!, gn = gf[(i + 1) % G.length]!, hj = hf[j]!, hn = hf[(j + 1) % H.length]!;
        if (!sweeper.free(gi, hn, margin) || !sweeper.free(hj, gn, margin)) continue;
        tried++;
        const ring = [...H.slice(j + 1), ...H.slice(0, j + 1)];
        // as laid, then with the first new gate turned to its new leg in (the kept gates are never turned)
        for (const turn of [false, true]) {
            const part = turn ? [facing(ring[0]!, G[i]!.pos), ...ring.slice(1)] : ring;
            const gates = [...G.slice(0, i + 1), ...part, ...G.slice(i + 1)].map((g, n) => ({ ...g, id: `g${n + 1}` }));
            const track: TrackFile = { ...kept, gates, laps };
            if (checkTrack(track, walls, transform, margin, false, true).ok) return track;
        }
    }
    return null;
}
