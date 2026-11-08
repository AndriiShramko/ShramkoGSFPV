// v0.12 Fly by Sound, lane v12-flight step 1 (docs/wip/v12-plan.md 2.5 and 4.2): the built-in lesson worlds.
// A lesson world is the sound package's signed distance function; the flight model collides with it seen as
// voxels (@gsfpv/collision analyticCollision), the session flies it with no scan (SessionOptions.world).
//  - the collider's lookup, culled by cells with the distance, answers every voxel as solidAt at its centre
//    does (control: a cull with a distance that lies is caught);
//  - the Sim touches where the distance function says: on a wall on a voxel face exactly, on round things
//    within half a voxel diagonal (control: walls built a few voxels off are caught);
//  - a lesson life replays to its hash on walls rebuilt from the same spec, and lifeProblem refuses other
//    walls (controls: another world's digest, and the same log on other walls replays apart);
//  - the sweeps of a 10 s hall flight cost clearly less than the uncached lookup in the open and no more than it along a wall, timed beside it in the same
//    process at the same moment (a ratio holds under the load of the gate's other test files, where "under 20 ms" did not: 15 ms alone were 30 ms in the
//    gate once); the 20 ms of the plan itself is measured alone, with its evidence, by tools/bench/test/sonic-world-cost.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S, Sim, replayLives } from '../../../packages/sim-core/src';
import type { ContactWorld, Runner, SimEvent } from '../../../packages/sim-core/src';
import { AnalyticContactWorld, VoxelContactWorld, analyticCollision } from '../../../packages/collision/src';
import type { AnalyticVoxelCollision } from '../../../packages/collision/src';
import { createAnalyticWorld, getLesson, makeSpec } from '../../../packages/sonic-fpv/src';
import type { AnalyticWorldInfo, AnalyticWorldSpec } from '../../../packages/sonic-fpv/src';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { depsFor, lifeProblem } from '../../../apps/fly/src/session/replay';
import { buildLessonWorld, isLessonScene, lessonSceneId, lessonWorldOf } from '../../../apps/fly/src/sonic/lesson-world';
import { PROBE_M, groundClearance } from '../../../apps/fly/src/play/ground';
import { params } from './game-loop';
import { OPEN_FLIGHT, WALL_FLIGHT, costKinds, hallFlight, measureKinds, walls } from './sonic-world-flight';

/** A renderer that draws nothing (as wind-session.test.ts): every method a no-op, `app` an event source nobody fires. */
function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, { get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined) }) as NonNullable<SessionOptions['renderer']>;
}

/** The world centres of the craft's body spheres now, with their radii. */
function spheres(sim: Sim): { c: [number, number, number]; r: number }[] {
    const s = sim.s, sp = sim.p.spheres;
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    const out: { c: [number, number, number]; r: number }[] = [];
    for (let i = 0; i < sp.length / 4; i++) {
        const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
        out.push({ c: [s[S.px] + r00 * lx + r01 * ly + r02 * lz, s[S.py] + r10 * lx + r11 * ly + r12 * lz, s[S.pz] + r20 * lx + r21 * ly + r22 * lz], r: sp[i * 4 + 3] });
    }
    return out;
}

/**
 * A disarmed craft let go at `at` with velocity `v` (no thrust, crashes off): stepped until its first touch.
 * Returns the gap between the body and the surface the distance function describes at that tick: the least
 * of sdf(sphere centre) - radius over the body's spheres (0 = touching the true surface).
 */
function firstTouchGap(world: AnalyticWorldInfo, contact: ContactWorld, at: readonly number[], v: readonly number[], maxTicks = 5000): number | null {
    const sim = new Sim(params('pavo20pro-3s', { crashOn: false }), contact);
    sim.reset(at[0], at[1], at[2], 0);
    sim.s[S.hold] = 0; // let go: no arm step, gravity and the push only
    sim.s[S.vx] = v[0]; sim.s[S.vy] = v[1]; sim.s[S.vz] = v[2];
    for (let i = 0; i < maxTicks; i++) {
        const n = sim.events.length;
        sim.step();
        if (sim.events.slice(n).some((e: SimEvent) => e.type === 'contact' || e.type === 'crash')) {
            return Math.min(...spheres(sim).map((b) => world.sdf(b.c[0], b.c[1], b.c[2]) - b.r));
        }
    }
    return null;
}

/** A small seeded generator for the voxel samples (the same picks every run). */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Voxels where the cached lookup and solidAt at the voxel's centre disagree, over `n` picks near the world's surfaces and anywhere. */
function mismatches(col: AnalyticVoxelCollision, world: AnalyticWorldInfo, n: number, seed: number): { checked: number; solid: number; wrong: number } {
    const r = rng(seed);
    let checked = 0, solid = 0, wrong = 0;
    const res = col.voxelResolution;
    // near the surfaces: points along random rays from the start, around where they hit, where cells are crossed
    const o = world.start.pos;
    for (let k = 0; k < n; k++) {
        let ix: number, iy: number, iz: number;
        if (k % 2 === 0) {
            const u = 2 * r() - 1, ph = 2 * Math.PI * r(), sq = Math.sqrt(1 - u * u);
            const d: [number, number, number] = [sq * Math.cos(ph), u, sq * Math.sin(ph)];
            const hit = world.castRay(o, d, 400);
            if (!hit) continue;
            const j = (r() - 0.5) * 1.2; // within 0.6 m of the surface along the ray
            const p = [hit.point[0] + d[0] * j, hit.point[1] + d[1] * j, hit.point[2] + d[2] * j];
            ix = Math.floor((p[0] - col.gridMinX) / res); iy = Math.floor((p[1] - col.gridMinY) / res); iz = Math.floor((p[2] - col.gridMinZ) / res);
        } else {
            ix = Math.floor(r() * col.numVoxelsX); iy = Math.floor(r() * col.numVoxelsY); iz = Math.floor(r() * col.numVoxelsZ);
        }
        if (ix < 0 || iy < 0 || iz < 0 || ix >= col.numVoxelsX || iy >= col.numVoxelsY || iz >= col.numVoxelsZ) continue;
        const a = col.isVoxelSolid(ix, iy, iz);
        const b = col.voxelCentreSolid(ix, iy, iz);
        checked++;
        if (b) solid++;
        if (a !== b) wrong++;
    }
    return { checked, solid, wrong };
}

const LESSONS = ['walls-hall', 'walls-pillar', 'rings-first', 'rings-course', 'corridor', 'shapes-cube', 'hover-height'];

describe('analytic walls: the cached lookup is solidAt at every voxel centre', () => {
    for (const id of LESSONS) {
        it(`${id}: 20 000 voxels near the surfaces and anywhere agree`, () => {
            const lw = lessonWorldOf(getLesson(id))!;
            const m = mismatches(lw.collision, lw.world, 20000, 7);
            expect(m.checked).toBeGreaterThan(12000); // an open world's rays upward hit nothing
            expect(m.solid).toBeGreaterThan(500); // the picks do reach the walls
            expect(m.wrong).toBe(0);
            // the distance decided cells on its own (the picks crowd the surfaces, so crossed cells are many here)
            expect(lw.collision.stats.cellsUniform).toBeGreaterThan(1000);
        });
    }

    it('control: a cull with a distance that lies (the surface said to be 1 m further out) is caught', () => {
        const world = lessonWorldOf(getLesson('walls-hall'))!.world;
        const liar = analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, world.solidAt, (x, y, z) => world.sdf(x, y, z) + 1);
        expect(mismatches(liar, world, 20000, 7).wrong).toBeGreaterThan(100);
    });
});

describe('the built-in world in the session', () => {
    it('lesson scene ids: lesson-<id>, never a scan; a bad id is refused', () => {
        expect(lessonSceneId('walls-hall')).toBe('lesson-walls-hall');
        expect(isLessonScene('lesson-walls-hall')).toBe(true);
        expect(isLessonScene('7a475d38')).toBe(false);
        expect(() => lessonSceneId('Walls Hall')).toThrow(RangeError);
        expect(() => buildLessonWorld(makeSpec('hall'), '7a475d38')).toThrow(RangeError);
        // lessons without an analytic world have none here (module 0, the scan lesson)
        expect(lessonWorldOf(getLesson('ears-walls'))).toBeNull();
        expect(lessonWorldOf(getLesson('free-garden'))).toBeNull();
    });

    it('the walls are named by the world digest, the spawn is the lesson start, the scene is in memory', () => {
        const lesson = getLesson('walls-pillar');
        const lw = lessonWorldOf(lesson)!;
        expect(lw.builtin.sha256).toBe(lw.world.digest);
        expect(lw.builtin.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(lw.builtin.spawn).toEqual([...lesson.start.pos, lesson.start.yawDeg]);
        expect(lw.builtin.scene.id).toBe('lesson-walls-pillar');
        expect(lw.builtin.scene.collisionUrl).toBeNull();
        expect(lw.builtin.scene.content).toEqual([]);
        // the same spec gives the same digest; another spec another one
        expect(buildLessonWorld(lesson.world.kind === 'analytic' ? lesson.world.spec : makeSpec('hall'), 'lesson-x').builtin.sha256).toBe(lw.builtin.sha256);
        expect(buildLessonWorld(makeSpec('hall', { depthM: 61 }), 'lesson-x').builtin.sha256).not.toBe(buildLessonWorld(makeSpec('hall'), 'lesson-x').builtin.sha256);
    });
});

describe('the Sim touches where the distance function says', () => {
    it('a hall wall: on the voxel face, which is the wall itself (gap within the 1 mm skin and the 0.25 mm sweep leaf)', () => {
        const world = createAnalyticWorld(makeSpec('hall'));
        const contact = new VoxelContactWorld(walls(world));
        // 1 m in front of the front wall (z = -30), pushed toward it at 2 m/s
        const gap = firstTouchGap(world, contact, [0, 2, -29], [0, 0, -2]);
        expect(gap).not.toBeNull();
        expect(Math.abs(gap!)).toBeLessThan(0.0015);
    });

    it('a pillar and a ring: within half a voxel diagonal (the voxels are solid where their centres are)', () => {
        const half = (Math.sqrt(3) / 2) * 0.1 + 0.0015;
        const pillars = lessonWorldOf(getLesson('walls-pillar'))!;
        const p = pillars.world.objects().find((o) => o.shape.kind === 'pillar')!;
        const gapP = firstTouchGap(pillars.world, pillars.builtin.contact!, [p.pos[0] + 2, 1.5, p.pos[2] + 0.3], [-3, 0, 0]);
        expect(gapP).not.toBeNull();
        expect(Math.abs(gapP!)).toBeLessThan(half);
        const rings = lessonWorldOf(getLesson('rings-first'))!;
        const g = rings.world.objects().find((o) => o.shape.kind === 'ring')!;
        const shape = g.shape as { kind: 'ring'; diameter: number; tube: number };
        // aimed at the top of the tube from 2 m in front of the ring's plane (openings face local Z)
        const top = g.pos[1] + shape.diameter / 2 + shape.tube;
        const gapR = firstTouchGap(rings.world, rings.builtin.contact!, [g.pos[0], top, g.pos[2] + 2], [0, 0, -3]);
        expect(gapR).not.toBeNull();
        expect(Math.abs(gapR!)).toBeLessThan(half);
    });

    it('control: walls built 3 voxels off (z + 0.3 m) touch where the distance function says there is still air', () => {
        const world = createAnalyticWorld(makeSpec('hall'));
        const off = analyticCollision(world.bounds.min, world.bounds.max, world.voxelM, (x, y, z) => world.solidAt(x, y, z - 0.3), (x, y, z) => world.sdf(x, y, z - 0.3));
        const gap = firstTouchGap(world, new VoxelContactWorld(off), [0, 2, -29], [0, 0, -2]);
        expect(gap).not.toBeNull();
        expect(gap!).toBeGreaterThan(0.25);
    });
});

/** Fly the runner for `ms` of sim time from its tick now: the arm switch off then on, throttle low, then the given sticks. */
function fly(r: Runner, ms: number, sticks: { roll?: number; pitch?: number; thr: number; yaw?: number }): void {
    const t0 = r.sim.tick;
    for (let i = 0; i < ms; i++) {
        r.enqueue({ tUs: (t0 + i) * 1000, ch: [sticks.roll ?? 0, sticks.pitch ?? 0, i < 300 ? -1 : sticks.thr, sticks.yaw ?? 0, i < 100 ? -1 : 1, -1, 0, 0] });
    }
    for (let t = t0 + 16; t <= t0 + ms; t += 16) r.advanceTo(t * 1000);
}

describe('a lesson life replays to its hash', () => {
    let ses: FlightSession | null = null;
    afterEach(() => { ses?.dispose(); ses = null; });

    it('a flight in a small hall with bumps and an R: every life replays on the rebuilt walls; controls: other walls', async () => {
        // a hall just big enough to bump into within seconds: 8 x 20 x 3 m
        const spec: AnalyticWorldSpec = makeSpec('hall', { widthM: 8, depthM: 20, heightM: 3 });
        const lw = buildLessonWorld(spec, 'lesson-test-hall');
        ses = await FlightSession.start({} as HTMLCanvasElement, { sceneId: 'lesson-test-hall', world: lw.builtin, renderer: nullRenderer(), crashOn: false, windSeed: 3 });
        const s = ses;
        expect(s.scene.id).toBe('lesson-test-hall');
        expect(s.drawScan).toBe(false);
        expect(s.collisionSha256).toBe(lw.world.digest);
        expect(s.spawn).toEqual([...lw.builtin.spawn]);
        expect(s.walls).toBe('on');
        // the built-in world flies as it is: no other size, no walls off
        expect(s.setTransform({ s: 5, t: [0, 0, 0] }).transform.s).toBe(1);
        expect(s.setWallsOn(false)).toBe(false);
        let contacts = 0;
        s.runner.onStep = (sim) => { for (const e of sim.events) if (e.type === 'contact' && e.tick === sim.tick) contacts++; };
        fly(s.runner, 3000, { pitch: 0.5, thr: 0.7 }); // up into the ceiling and on toward the front wall
        const firstLifeContacts = contacts;
        s.respawnStart(); // R: a new life at the start, applied at the next tick
        fly(s.runner, 3000, { roll: 0.6, thr: 0.4 });
        expect(firstLifeContacts).toBeGreaterThan(0);
        expect(contacts).toBeGreaterThan(0); // it bumped into the walls (crashes off: bounces)
        const lives = s.lives();
        expect(lives.length).toBeGreaterThanOrEqual(2);
        for (const [i, life] of lives.entries()) {
            expect(life.header.collisionSha256).toBe(lw.world.digest);
            expect(life.header.scene?.id).toBe('lesson-test-hall');
            // a page that rebuilt the world from the same spec: the same walls
            const again = buildLessonWorld(spec, 'lesson-test-hall');
            const source = { collisionSha256: again.builtin.sha256, world: again.builtin.contact!, collision: again.collision };
            expect(lifeProblem(life.header, source)).toBeNull();
            const current = i === lives.length - 1;
            const endTick = current ? s.runner.sim.tick : life.endTick;
            const recorded = current ? s.runner.liveLifeHash()!.hash : life.traceHash!;
            expect(replayLives([life], depsFor(life.header, source), { endTick }).hash).toBe(recorded);
        }
        // the session's contact world only skips voxel walks that cannot find a wall: the plain one gives the same hash
        const plain = { collisionSha256: lw.world.digest, world: new VoxelContactWorld(lw.collision), collision: lw.collision };
        expect(replayLives([lives[0]], depsFor(lives[0].header, plain), { endTick: lives[0].endTick }).hash).toBe(lives[0].traceHash);
        // control 1: another world's digest is other walls
        const other = buildLessonWorld(makeSpec('hall', { widthM: 8, depthM: 21, heightM: 3.4, voxelM: 0.07 }), 'lesson-test-hall');
        const otherSource = { collisionSha256: other.builtin.sha256, world: other.builtin.contact!, collision: other.collision };
        expect(lifeProblem(lives[0].header, otherSource)).toBe('flown on other walls');
        // control 2: the same log on the other walls (its name forged) replays apart
        const forged = { ...otherSource, collisionSha256: lw.world.digest };
        expect(lifeProblem(lives[0].header, forged)).toBeNull();
        expect(replayLives([lives[0]], depsFor(lives[0].header, forged), { endTick: lives[0].endTick }).hash).not.toBe(lives[0].traceHash);
    });
});

describe('the cost of the sweeps', () => {
    // Timed in ONE process, the three ways alternating round after round on the same queries (measureKinds), so a load that comes and goes touches them
    // alike; the bounds are on RATIOS to the uncached lookup timed beside them. What the shortcuts (cells decided by the distance, the free radius) are for
    // is open air: there the session's queries cost 0.16 to 0.28 of the uncached lookup's in every run made (vitest alone and inside the whole gate, the
    // bench script). Along a wall they save little, and how little depends on how warm the code is (0.62 to 0.79 in vitest, 0.95 after nine rounds in
    // the bench script), so what is held there is only that they cost no more than they save. The absolute 20 ms of the plan, alone and with its evidence,
    // is tools/bench/test/sonic-world-cost.ts: it measured 13.4 ms along the wall and 3.5 ms in the open.
    const BOUND = { wall: 1.25, open: 0.5 } as const;

    for (const [name, plan, wall] of [['along and into a wall', WALL_FLIGHT, true], ['in the open', OPEN_FLIGHT, false]] as const) {
        it(`a 10 s hall flight ${name}: its contact queries cost ${wall ? 'no more than' : 'clearly less than'} the uncached lookup timed beside them (ratio under ${wall ? BOUND.wall : BOUND.open}), and change no answer`, () => {
            const flight = hallFlight(plan);
            const lw = lessonWorldOf(getLesson('walls-hall'))!;
            const { best, answers } = measureKinds(flight.queries, costKinds(lw.world));
            const ratio = best.session / best.raw;
            console.log(`sonic-world sweep cost, 10 s hall flight ${name} (${flight.queries.length} queries, ${flight.contacts} contact events): session ${best.session.toFixed(2)} ms, cells only ${best.cells.toFixed(2)} ms, no cull ${best.raw.toFixed(2)} ms, session / no cull ${ratio.toFixed(2)}`);
            expect(flight.queries.length).toBeGreaterThan(9000); // it really swept every tick (the craft is held until it arms)
            if (wall) expect(flight.contacts).toBeGreaterThan(100); // and it pushed into the wall
            else expect(flight.contacts).toBe(0);
            // the shortcuts change no answer
            expect(answers.session).toBe(answers.raw);
            expect(answers.cells).toBe(answers.raw);
            expect(ratio).toBeLessThan(wall ? BOUND.wall : BOUND.open);
        });
    }

    it('control: with the cache switched off (the world that stands for the session has no cells and no free radius) the open-air comparison is about 1 and fails its bound', () => {
        const flight = hallFlight(OPEN_FLIGHT);
        const lw = lessonWorldOf(getLesson('walls-hall'))!;
        const off = costKinds(lw.world);
        // the "session" is the AnalyticContactWorld over walls with the cull off (it has no distance to read: no free radius, no cells): what the absence of the cache measures
        const { best } = measureKinds(flight.queries, { session: () => new AnalyticContactWorld(walls(lw.world, false)), raw: off.raw });
        const ratio = best.session / best.raw;
        console.log(`sonic-world sweep cost, control (cache off): ratio ${ratio.toFixed(2)}`);
        expect(ratio).toBeGreaterThanOrEqual(BOUND.open); // the check would fail
        expect(ratio).toBeGreaterThan(0.7); // and it is the uncached lookup's own cost, not an accident of one slow run
    });

    // Two measurements apart in time: on a busy CI runner (2026-11-08, c6ddeba) the first one met a slow spell and the slowed one did not
    // (23.4 ms, then 26.2 ms under a clock 2.1 times as fast). A warm-up run first, and two more tries, keep such a spell from failing the build.
    it('a machine twice as slow (the gate runs other test files beside this one) moves every time and no ratio: the absolute 20 ms of before would have failed at 30 ms, the ratios hold', { retry: 2 }, () => {
        const flight = hallFlight(WALL_FLIGHT);
        const lw = lessonWorldOf(getLesson('walls-hall'))!;
        measureKinds(flight.queries, costKinds(lw.world), 1); // warm-up: the code paths are compiled before either measurement
        const here = measureKinds(flight.queries, costKinds(lw.world));
        // the clock runs 2.1 times as fast as it should: every run of every way takes 2.1 times as long, as under a load that never lets go
        const real = performance.now.bind(performance);
        const spy = vi.spyOn(performance, 'now').mockImplementation(() => real() * 2.1);
        let slow: typeof here;
        try {
            slow = measureKinds(flight.queries, costKinds(lw.world));
        } finally {
            spy.mockRestore();
        }
        console.log(`sonic-world sweep cost, a clock 2.1 times as slow: session ${here.best.session.toFixed(2)} -> ${slow.best.session.toFixed(2)} ms, session / no cull ${(here.best.session / here.best.raw).toFixed(2)} -> ${(slow.best.session / slow.best.raw).toFixed(2)}`);
        expect(slow.best.session).toBeGreaterThan(here.best.session * 1.7); // it really is slower: what the old bound was asked to survive
        expect(slow.best.session).toBeGreaterThan(20); // and over the 20 ms the old test held to, as the gate's 30.5 ms was
        expect(Math.abs(slow.best.session / slow.best.raw - here.best.session / here.best.raw)).toBeLessThan(0.25); // while the ratio is where it was
        expect(slow.best.session / slow.best.raw).toBeLessThan(BOUND.wall);
    });

    it('measured beside it: the game scheme\'s voxel ground probe (play/ground.ts) on these walls, and a ray of the world', () => {
        const lw = lessonWorldOf(getLesson('walls-hall'))!;
        const contact = new VoxelContactWorld(walls(lw.world));
        const p = params('pavo20pro-3s');
        const s = new Float64Array(S.size);
        const probe: number[] = [], ray: number[] = [];
        for (let k = 0; k < 40; k++) {
            s[S.px] = -15 + k * 0.75; s[S.py] = 1.5 + (k % 5); s[S.pz] = -20 + k;
            let t = performance.now();
            const g = groundClearance(contact, s, p);
            probe.push(performance.now() - t);
            t = performance.now();
            const hit = lw.world.castRay([s[S.px], s[S.py], s[S.pz]], [0, -1, 0], PROBE_M);
            ray.push(performance.now() - t);
            // both find the floor (y = 0) under the craft
            expect(g).not.toBeNull();
            expect(Math.abs(g! - (s[S.py] - p.bodyBottom))).toBeLessThan(0.11);
            expect(Math.abs(hit!.distance - s[S.py])).toBeLessThan(1e-3);
        }
        probe.sort((a, b) => a - b);
        ray.sort((a, b) => a - b);
        console.log(`sonic-world ground probe on analytic walls: voxel sweep median ${probe[20].toFixed(3)} ms (max ${probe[39].toFixed(3)}), world ray median ${ray[20].toFixed(4)} ms`);
    });
});
