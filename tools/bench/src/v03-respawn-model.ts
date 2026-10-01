// Why B12's negative control failed since wave 1, and why the A6 reference moved (W2-2, Node only).
//   npx tsx src/v03-respawn-model.ts      -> evidence/<date>/v03-w2-2-model-why.json
// Extracts v0.2 (main 28e5ab3) and the wave-2 base (6b5065c) with `git archive` into a temp folder
// and runs, in each tree and in this working tree, the same two flights on the CC BY fixture of
// 39e63ce9: B12's control (the page's path: session spawn, makePlan, Scenario, a 0.75 m/s dash)
// and the A6 script (30 s of scripted sticks at 60 Hz frames). Nothing is downloaded.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { REPO, writeEvidence } from './evidence';

const MAIN = '28e5ab3';
const BASE = '6b5065c';
const tmp = mkdtempSync(join(tmpdir(), 'gsfpv-why-'));

function extract(rev: string): string {
    const dir = join(tmp, rev);
    mkdirSync(dir, { recursive: true });
    execSync(`git archive ${rev} packages/sim-core packages/input packages/collision | tar -x -C "${dir.replace(/\\/g, '/')}"`, { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'], shell: 'bash' });
    for (const p of ['sim-core', 'collision', 'input']) cpSync(join(dir, 'packages', p), join(dir, 'node_modules', '@gsfpv', p), { recursive: true });
    return dir;
}

const FIX = join(REPO, 'fixtures', '39e63ce9');
const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8'));
let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
const cam = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8')).cameras[0].initial as { position: number[]; target: number[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = any;
async function load(tree: string): Promise<{ sc: M; col: M; sim: M; sig: M; preset: unknown }> {
    const imp = (p: string) => import(pathToFileURL(join(tree, p)).href);
    return {
        sc: await imp('packages/sim-core/src/index.ts'),
        col: await imp('packages/collision/src/index.ts'),
        sim: await imp('packages/input/src/sim/index.ts'),
        sig: await imp('packages/input/src/sim/signals.ts'),
        preset: JSON.parse(readFileSync(join(tree, 'packages/sim-core/presets/pavo20pro-3s.json'), 'utf8'))
    };
}

/** B12's control flight; the longest stretch of ticks the flying craft moved < 1 um per tick, and its speed then. */
async function b12Control(tree: string): Promise<Record<string, unknown>> {
    const { sc, col, sim: simMod, preset } = await load(tree);
    const C = col.openVoxelCollision(meta, bin);
    const world = new col.VoxelContactWorld(C);
    const p = sc.compileParams(preset, {});
    let pos = [...cam.position];
    const R = p.boundRadius + 0.03;
    const push = { x: 0, y: 0, z: 0 };
    if (C.querySphere(pos[0], pos[1], pos[2], R, push)) {
        const out = { x: 0, y: 0, z: 0 };
        if (col.findSphereSpawn(C, pos[0], pos[1], pos[2], R, out)) pos = [out.x, out.y, out.z];
    }
    const sim = new sc.Sim(p, world);
    sim.reset(pos[0], pos[1], pos[2], 0);
    sim.hoverThr = sc.hoverSolve(p, 1).motor;
    const runner = new sc.Runner(sim, new sc.InputLog({ format: 'gsfpv-input-log/1', simCore: 'why', preset: 'pavo20pro-3s', configHash: '', collisionSha256: null, spawn: [pos[0], pos[1], pos[2], 0], seed: 0 }));
    const plan = simMod.makePlan(C, p.boundRadius, pos, cam.target, 0.5 * p.vBounce, (x: number, y: number, z: number, r: number, o: unknown) => col.findSphereSpawn(C, x, y, z, r, o));
    runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const scn = new simMod.Scenario(runner, plan);
    const S = sc.S;
    let last = [NaN, NaN, NaN], run = 0, longest = 0, longestEndTick = -1, speedThen = 0, minUpY = 1, dashTick = -1;
    const prev = runner.onStep;
    runner.onStep = (x: M) => {
        prev?.(x);
        if (scn.phase === 'dash' && dashTick < 0) dashTick = x.tick;
        const s = x.s;
        if (s[S.crashed] > 0 || s[S.armed] === 0) { run = 0; return; }
        if (dashTick >= 0) minUpY = Math.min(minUpY, 1 - 2 * (s[S.qx] ** 2 + s[S.qz] ** 2));
        if (Math.hypot(s[S.px] - last[0], s[S.py] - last[1], s[S.pz] - last[2]) < 1e-6) {
            run++;
            if (run > longest) { longest = run; longestEndTick = x.tick; speedThen = Math.hypot(s[S.vx], s[S.vy], s[S.vz]); }
        } else run = 0;
        last = [s[S.px], s[S.py], s[S.pz]];
    };
    const ev: { type: string; tick: number; speed?: number }[] = [];
    let seen = 0;
    for (let t = 16667; !scn.finished && sim.tick < 40000; t += 16667) {
        runner.advanceTo(t);
        for (; seen < runner.events.length; seen++) ev.push(runner.events[seen]);
    }
    const crashes = ev.filter((e) => e.type === 'crash');
    return {
        dashMs: plan.dashSpeed, contactsInDash: ev.filter((e) => e.type === 'contact' && e.tick >= dashTick).length,
        crashes: crashes.map((e) => ({ tick: e.tick, sAfterDashStart: (e.tick - dashTick) / 1000, speed: e.speed })),
        minUpYInDash: minUpY, longestFrozenTicks: longest, frozenUntilTick: longestEndTick, speedAtEndOfFreeze: speedThen,
        controlPasses: crashes.length === 0 && ev.some((e) => e.type === 'contact' && e.tick >= dashTick)
    };
}

/** The A6 script (as packages/input/src/sim/determinism.ts runs it) at 60 Hz frames: per-tick states and the trace hash. */
async function a6(tree: string, countPinned: boolean): Promise<{ hash: string; states: Float64Array; N: number; S: M; crashes: number; pinnedImpulseTicks: number; firstPinnedImpulse: number }> {
    const { sc, col, sig, preset } = await load(tree);
    const world = new col.VoxelContactWorld(col.openVoxelCollision(meta, bin));
    const p = sc.compileParams(preset, {});
    const spawn = [cam.position[0], cam.position[1], cam.position[2], (Math.atan2(cam.target[0] - cam.position[0], -(cam.target[2] - cam.position[2])) * 180) / Math.PI];
    const samples = sig.renderScript(sig.determinismScript(), 30, 250, 400, 42);
    const sim = new sc.Sim(p, world);
    sim.reset(spawn[0], spawn[1], spawn[2], spawn[3]);
    let pinnedImpulseTicks = 0, firstPinnedImpulse = -1;
    if (countPinned) {
        const proto = Object.getPrototypeOf(sim);
        const orig = proto.pinnedContacts;
        proto.pinnedContacts = function (this: M, ...a: unknown[]) {
            const before = Array.from(this.s.subarray(sc.S.vx, sc.S.vx + 3)).join() + Array.from([this.s[sc.S.wx], this.s[sc.S.wy], this.s[sc.S.wz]]).join();
            orig.apply(this, a);
            const after = Array.from(this.s.subarray(sc.S.vx, sc.S.vx + 3)).join() + Array.from([this.s[sc.S.wx], this.s[sc.S.wy], this.s[sc.S.wz]]).join();
            if (before !== after) { pinnedImpulseTicks++; if (firstPinnedImpulse < 0) firstPinnedImpulse = this.tick; }
        };
    }
    const runner = new sc.Runner(sim, new sc.InputLog({ format: 'gsfpv-input-log/1', simCore: 'sim-core/0.1.0', preset: p.presetId, configHash: '', collisionSha256: null, spawn, seed: 42 }), true);
    const N = sc.S.size;
    const states = new Float64Array(30001 * N);
    runner.onStep = (x: M) => { states.set(x.s, x.tick * N); };
    let si = 0, crashes = 0, seen = 0;
    for (let k = 1; ; k++) {
        const t = Math.min(30_000_000, Math.round(k * (1e6 / 60)));
        while (si < samples.length && samples[si].tUs <= t) runner.enqueue(samples[si++]);
        runner.advanceTo(t);
        for (; seen < runner.events.length; seen++) if (runner.events[seen].type === 'crash') crashes++;
        if (t >= 30_000_000) break;
    }
    return { hash: runner.traceHash(), states, N, S: sc.S, crashes, pinnedImpulseTicks, firstPinnedImpulse };
}

try {
    const trees = { main: extract(MAIN), base: extract(BASE), fixed: REPO };
    const b12: Record<string, unknown> = {};
    for (const [k, dir] of Object.entries(trees)) b12[k] = await b12Control(dir);
    const before = await a6(trees.base, false);
    const after = await a6(trees.fixed, true);
    let first = -1;
    for (let t = 1; t <= 30000 && first < 0; t++) for (let j = 0; j < before.N; j++) if (before.states[t * before.N + j] !== after.states[t * before.N + j]) { first = t; break; }
    const S = before.S, N = before.N;
    const at = (st: Float64Array, t: number) => ({ p: [st[t * N + S.px], st[t * N + S.py], st[t * N + S.pz]], upY: 1 - 2 * (st[t * N + S.qx] ** 2 + st[t * N + S.qz] ** 2), armed: st[t * N + S.armed], crashed: st[t * N + S.crashed] });
    const bm = b12 as Record<string, { controlPasses: boolean; longestFrozenTicks: number; speedAtEndOfFreeze: number; crashes: unknown[] }>;
    const pass = bm.main.controlPasses && !bm.base.controlPasses && bm.base.longestFrozenTicks > 300 && bm.fixed.controlPasses && bm.fixed.speedAtEndOfFreeze < 1
        && first > 0 && after.firstPinnedImpulse === first && before.crashes === after.crashes;
    const file = writeEvidence('v03-w2-2-model-why', {
        pass,
        question: "B12's negative control (a 0.75 m/s dash into a wall must touch without a crash) fails since wave 1: flight model or bot?",
        answer: 'Flight model. A craft pinned in a corner (one duct wins the sweep at t = 1e-12 every tick) froze while thrust drove other ducts into the wall unresolved; its speed grew past v_crash in a pose that never moved, then a phantom crash. v0.2 has the same single-impulse rule but its craft never got pinned there. Fixed in sim.ts pinnedContacts; the bot is unchanged.',
        trees: { main: MAIN, base: BASE, fixed: 'this working tree' },
        b12Control: b12,
        a6: {
            note: 'A6 script, 60 Hz frames: base vs fixed tick by tick. The hash moves because the craft lies on its side on the floor and its pinned ticks now resolve every touching duct.',
            hashBase: before.hash, hashFixed: after.hash, firstDivergentTick: first, firstPinnedImpulseTick: after.firstPinnedImpulse, pinnedTicksWithImpulse: after.pinnedImpulseTicks,
            crashesBase: before.crashes, crashesFixed: after.crashes,
            atDivergence: { base: at(before.states, first), fixed: at(after.states, first) }
        }
    });
    console.log('why', pass ? 'PASS' : 'FAIL', JSON.stringify({ b12: Object.fromEntries(Object.entries(bm).map(([k, v]) => [k, { control: v.controlPasses, frozen: v.longestFrozenTicks, v: v.speedAtEndOfFreeze, crashes: v.crashes.length }])), a6: { first, pinned: after.pinnedImpulseTicks } }), '->', file);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
