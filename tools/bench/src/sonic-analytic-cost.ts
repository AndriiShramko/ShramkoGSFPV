// v0.12 Fly by Sound, lane v12-flight step 9 (docs/wip/v12-plan.md 4.2 and its risk "analytic worlds inside the frame"): what the
// sound package's planner costs per frame on the lesson worlds, on the main thread, in Node. The planner is what the engine runs
// in update(): the scene sampler (ten sectors of three rays, 40 m, sphere traced against the analytic world's signed distance
// function) and the cue rules. Budget (the same as the scan's, plan 4.2 step 3): p95 under 1 ms a frame. Each world is walked
// the way a pilot flies it (free points along its course, nose along the way, speed 3 m/s) with every layer on, 4000 frames.
// Evidence: evidence/<date>/sonic-analytic-cost.json.
//   cd tools/bench && npx tsx src/sonic-analytic-cost.ts
import { CuePlanner, SHIPPED_LESSON_IDS, createAnalyticWorld, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { FlightSample, LessonLayers, SonicWorld, Vec3 } from '../../../packages/sonic-fpv/src';
import { writeEvidence } from './evidence';

const BUDGET_P95_MS = 1;
const FRAMES = 4000;
const ALL_LAYERS: LessonLayers = { on: ['safety', 'height', 'speed', 'target', 'shape', 'room', 'voice'], heightBandM: [1, 3], hazardVoices: 3 };

function stats(ms: number[]): { n: number; mean: number; p50: number; p95: number; p99: number; max: number } {
    const s = [...ms].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number;
    const r = (x: number): number => Math.round(x * 10000) / 10000;
    return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1] as number) };
}

/** A seeded generator, so the walk is the same every run. */
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

/** Free points of the world (the craft's hull clear), each with a heading: where a pilot would be. */
function walk(world: SonicWorld & { sdf(x: number, y: number, z: number): number }, n: number): { pos: Vec3; yaw: number }[] {
    const r = rng(7);
    const { min, max } = world.bounds;
    const out: { pos: Vec3; yaw: number }[] = [];
    for (let i = 0; out.length < n && i < n * 400; i++) {
        const p: Vec3 = [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])];
        if (world.sdf(p[0], p[1], p[2]) > 0.4) out.push({ pos: p, yaw: r() * 360 - 180 });
    }
    return out;
}

const results: Record<string, unknown>[] = [];
let allPass = true;
const seen = new Set<string>();
for (const id of SHIPPED_LESSON_IDS) {
    const lesson = getLesson(id);
    if (lesson.world.kind !== 'analytic') continue;
    const key = JSON.stringify(lesson.world.spec);
    if (seen.has(key)) continue;
    seen.add(key);
    const world = createAnalyticWorld(lesson.world.spec);
    const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: ALL_LAYERS });
    const points = walk(world, FRAMES);
    const target = world.objects().find((o) => o.order === 0) ?? null;
    // warm the code paths before timing
    for (let i = 0; i < 200; i++) {
        const p = points[i % points.length] as { pos: Vec3; yaw: number };
        planner.plan({ sample: sampleAt(p.pos, p.yaw, i * 16), world, target, floorY: 0 });
    }
    const ms: number[] = [];
    let t = 0;
    for (const p of points) {
        t += 16;
        const t0 = performance.now();
        planner.plan({ sample: sampleAt(p.pos, p.yaw, t), world, target, floorY: 0 });
        ms.push(performance.now() - t0);
    }
    const st = stats(ms);
    const pass = st.p95 < BUDGET_P95_MS;
    allPass = allPass && pass;
    results.push({ lesson: id, generator: lesson.world.spec.generator, ...st, pass });
    console.log(`${id.padEnd(16)} ${String(lesson.world.spec.generator).padEnd(11)} p50 ${st.p50.toFixed(3)}  p95 ${st.p95.toFixed(3)}  p99 ${st.p99.toFixed(3)}  max ${st.max.toFixed(3)} ms  ${pass ? 'PASS' : 'OVER'}`);
}

function sampleAt(pos: Vec3, yawDeg: number, t: number): FlightSample {
    const a = (yawDeg * Math.PI) / 180;
    return { t, tick: t, pos, vel: [Math.sin(a) * 3, 0, -Math.cos(a) * 3], quat: [Math.cos(-a / 2), 0, Math.sin(-a / 2), 0], rate: [0, 0, 0], yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false };
}

const file = writeEvidence('sonic-analytic-cost', {
    step: 'v12-flight 9: the planner (scene sampler and cue rules) per frame on the lesson worlds, Node, main thread',
    budgetP95Ms: BUDGET_P95_MS,
    frames: FRAMES,
    layers: ALL_LAYERS.on,
    note: 'every layer on, free points of each world with random headings at 3 m/s; the browser and a slower CPU are not measured',
    results,
    pass: allPass
});
console.log(`evidence ${file}; ${allPass ? 'all under the budget' : 'some over the budget'}`);
process.exitCode = allPass ? 0 : 1;
