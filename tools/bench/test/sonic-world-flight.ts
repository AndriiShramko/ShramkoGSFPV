// The 10 s hall flights whose contact queries the sweep-cost proof times (v0.12 lane v12-flight step 1; v12-int step 11). Not a test file (the name has
// no .test): sonic-world.test.ts holds the claim relative to the uncached collider, timed beside it in the same process; tools/bench/test/sonic-world-cost.ts
// holds the absolute 20 ms of the plan, alone, with its evidence. Both use what is here, so they time the same queries.
import { S, Sim } from '../../../packages/sim-core/src';
import type { ContactOut, ContactWorld } from '../../../packages/sim-core/src';
import { MODE_CHANNEL } from '../../../packages/sim-core/src';
import { AnalyticContactWorld, VoxelContactWorld, analyticCollision } from '../../../packages/collision/src';
import type { AnalyticVoxelCollision } from '../../../packages/collision/src';
import { makeSpec } from '../../../packages/sonic-fpv/src';
import type { AnalyticWorldInfo } from '../../../packages/sonic-fpv/src';
import { buildLessonWorld, lessonSceneId } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';
import { ArmGate } from '../../../packages/input/src';
import type { Profile } from '../../../packages/input/src';
import { AutoArm } from '../../../apps/fly/src/play/assist';
import { GameAssist } from '../../../apps/fly/src/play/game';
import type { GameKeys } from '../../../apps/fly/src/play/game';
import { params } from './game-loop';

/**
 * The hall these flights are flown in: v0.12's walls-hall, the hall generator's version 1 with its defaults (40 x 60 x 12 m),
 * pinned so the flights below (4 m before the front wall at z = -30, the open middle) stay where they were measured. v0.13's
 * walls-hall is a 10 x 12 m room (version 2), where they would start in the rock (lane v13-host A2, docs/wip/v13-host.md).
 */
export const COST_HALL_SPEC = makeSpec('hall', {}, 0, 1);
let costHallWorld: LessonWorld | null = null;
export function costHall(): LessonWorld {
    costHallWorld ??= buildLessonWorld(COST_HALL_SPEC, lessonSceneId('walls-hall'));
    return costHallWorld;
}

/** The world's walls as the session builds them, and the same walls with a different lookup (`cull` false: solidAt for every voxel, no cells). */
export function walls(world: AnalyticWorldInfo, cull = true): AnalyticVoxelCollision {
    return analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, cull ? world.sdf : null);
}

/** One query of the flight model to its contact world, kept to be asked again. */
export type Query = { kind: 'sweep'; c0: Float64Array; c1: Float64Array; r: Float64Array; pad: Float64Array; n: number } | { kind: 'push'; x: number; y: number; z: number; r: number };

/** A contact world that passes everything on and keeps every query (the timing replays them without a timer per call). */
export class Recorder implements ContactWorld {
    readonly queries: Query[] = [];
    constructor(private readonly inner: ContactWorld) {}
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        this.queries.push({ kind: 'sweep', c0: c0.slice(), c1: c1.slice(), r: r.slice(), pad: pad.slice(), n });
        return this.inner.sweep(c0, c1, r, pad, n, out);
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        this.queries.push({ kind: 'push', x, y, z, r });
        return this.inner.pushOut(x, y, z, r, out);
    }
}

/** Every query asked again of `world`, under one timer, ms; and a digest of the answers (the worlds must agree). */
export function askAll(world: ContactWorld, queries: readonly Query[]): { ms: number; answers: string } {
    const out: ContactOut = { sphere: 0, nx: 0, ny: 0, nz: 0 };
    const push = { x: 0, y: 0, z: 0 };
    let acc = 0;
    const t = performance.now();
    for (const q of queries) {
        if (q.kind === 'sweep') {
            const v = world.sweep(q.c0, q.c1, q.r, q.pad, q.n, out);
            acc = (acc * 31 + (v < 0 ? -1 : v * 1e9 + out.sphere + out.nx * 7 + out.ny * 11 + out.nz * 13)) % 1e15;
        } else if (world.pushOut(q.x, q.y, q.z, q.r, push)) acc = (acc * 31 + push.x * 3 + push.y * 5 + push.z * 7) % 1e15;
    }
    return { ms: performance.now() - t, answers: acc.toFixed(3) };
}

/**
 * 10 s in the hall of costHall() (v0.12's walls-hall), flown the game scheme's way (GameAssist and AutoArm at 100 Hz, as
 * game-loop.ts does), along and into the front wall. Only the flight model's own contact queries are timed:
 * the assist's ground below is read by a ray of the world (the voxel probe of play/ground.ts is measured on
 * its own in the test).
 */
/** Along and into the front wall: 4 m before it, then pushing into it and sliding along it. */
export const WALL_FLIGHT = {
    at: [0, 1.5, -26],
    moves: [
        { ms: 3000, k: { forward: 1, strafe: 0, turn: 0, lift: 0 } },
        { ms: 3000, k: { forward: 1, strafe: 1, turn: 0, lift: 0 } },
        { ms: 1000, k: { forward: 0, strafe: 0, turn: 0, lift: 1 } },
        { ms: 3000, k: { forward: 0, strafe: -1, turn: 1, lift: 0 } }
    ]
};
/** In the open middle of the hall, never near a wall. */
export const OPEN_FLIGHT = {
    at: [0, 6, 10],
    moves: [
        { ms: 2000, k: { forward: 1, strafe: 0, turn: 0, lift: 0 } },
        { ms: 2000, k: { forward: 0, strafe: 0, turn: 1, lift: 0 } },
        { ms: 1000, k: { forward: 1, strafe: 1, turn: 0, lift: 1 } },
        { ms: 1000, k: { forward: -1, strafe: 0, turn: 0, lift: -1 } },
        { ms: 2000, k: { forward: 0, strafe: -1, turn: 0, lift: 0 } },
        { ms: 2000, k: { forward: 0, strafe: 0, turn: 0, lift: 0 } }
    ]
};

export function hallFlight(plan: { at: number[]; moves: { ms: number; k: GameKeys }[] }): { queries: Query[]; contacts: number } {
    const lw = costHall();
    const timed = new Recorder(lw.builtin.contact!);
    const p = params('pavo20pro-3s', { crashOn: false });
    const sim = new Sim(p, timed);
    sim.reset(plan.at[0], plan.at[1], plan.at[2], 0);
    const arm = new AutoArm();
    const game = new GameAssist();
    const gate = new ArmGate({ keepArmedAfterCrash: true });
    let contacts = 0, wasOn = false, t = 0;
    const moves = plan.moves;
    for (const m of moves) {
        arm.request();
        for (let i = 0; i < m.ms; i++, t++) {
            if (t % 10 === 0) {
                const a = arm.step({ simArmed: sim.armed, crashed: sim.crashed, paused: false, now: t });
                const on = !a.holdLow && !sim.crashed;
                const hit = lw.world.castRay([sim.s[S.px], sim.s[S.py], sim.s[S.pz]], [0, -1, 0], 20);
                const sense = { p, s: sim.s, groundM: hit ? Math.max(0, hit.distance - p.bodyBottom) : null };
                if (on && !wasOn) game.liftoff(sense);
                wasOn = on;
                const o = game.update(m.k, sense, t === 0 ? 0 : 0.01, on);
                const ch = new Float32Array([o.roll, o.pitch, (a.holdLow ? 0 : o.throttle) * 2 - 1, o.yaw, a.arm, MODE_CHANNEL.angle, 0, 0]);
                ch[4] = gate.update({} as Profile, ch, 0, true, sim.crashed);
                sim.setChannels(ch);
            }
            const n = sim.events.length;
            sim.step();
            for (let j = n; j < sim.events.length; j++) if (sim.events[j].type === 'contact') contacts++;
        }
    }
    return { queries: timed.queries, contacts };
}

/** The ways the same walls are asked: as the session flies them, the cells alone, and with no shortcut at all. */
export type CostKind = 'session' | 'cells' | 'raw';

export function costKinds(world: AnalyticWorldInfo): Record<CostKind, () => ContactWorld> {
    return {
        session: () => new AnalyticContactWorld(walls(world)), // the cells and the free radius, as the session flies
        cells: () => new VoxelContactWorld(walls(world)), // the cells only
        raw: () => new VoxelContactWorld(walls(world, false)) // solidAt for every voxel
    };
}

/**
 * Times every way on the same queries, `rounds` times, ALTERNATING them (each round starts with another way), a fresh world for each run (its cells
 * start empty, as in flight), and keeps the least time of each. A load that comes and goes (another test file running beside this one in the gate)
 * touches the ways of a round alike, so the ratio between the best times holds where an absolute number does not: 15 ms alone were 30 ms in the gate.
 */
export function measureKinds<K extends string>(queries: readonly Query[], kinds: Record<K, () => ContactWorld>, rounds = 5): { best: Record<K, number>; answers: Record<K, string>; runs: Record<K, number[]> } {
    const names = Object.keys(kinds) as K[];
    const runs = Object.fromEntries(names.map((k) => [k, [] as number[]])) as Record<K, number[]>;
    const answers = {} as Record<K, string>;
    for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < names.length; i++) {
            const k = names[(i + r) % names.length] as K;
            const run = askAll(kinds[k](), queries);
            runs[k].push(run.ms);
            if (r === 0) answers[k] = run.answers;
        }
    }
    const best = Object.fromEntries(names.map((k) => [k, Math.min(...runs[k])])) as Record<K, number>;
    return { best, answers, runs };
}
