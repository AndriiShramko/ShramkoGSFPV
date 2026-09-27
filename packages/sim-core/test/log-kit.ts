// Test kit for the log, respawn and stats tests (not a test file): a synthetic ContactWorld of
// planes, the repo's bot pilot driven per tick through the runner's input queue (so every
// frame split gets the same inputs), a frame loop, and header / replay helpers.

import {
    Runner, RespawnDirector, StateHistory, DEFAULT_RESPAWN_POLICY, MODE_CHANNEL, SIM_CORE_VERSION, S,
    compileParams, hoverSolve, lifeSim, makeLifeHeader, presetSha256
} from '../src/index';
import type {
    ContactOut, ContactWorld, LifeHeader, LifeHeaderInput, ParamOverrides, PresetJson, ReplayDeps, RespawnOpts,
    RespawnPolicy, RunnerOptions, Sim
} from '../src/index';
// The repo's test pilot (closed loop in acro, stick channels only). A test-only import across packages.
import { BotPilot } from '../../input/src/sim/bot';
import pavo20pro from '../presets/pavo20pro-3s.json';
import pavo20pro2 from '../presets/pavo20pro2-3s.json';
import air65 from '../presets/air65-1s.json';

export const PRESET = pavo20pro as unknown as PresetJson;
const PRESETS = [pavo20pro, pavo20pro2, air65] as unknown as PresetJson[];
const BY_SHA = new Map(PRESETS.map((p) => [presetSha256(p), p]));

/** Solid half-spaces n . p < d (n points into free space). Stateless, so a replay may share it. */
export class PlaneWorld implements ContactWorld {
    readonly planes: [number, number, number, number][];
    constructor(planes: [number, number, number, number][]) {
        this.planes = planes;
    }
    /** a floor at y = 0, optionally a wall at x = wallX (solid beyond) and a ceiling at y = ceilY */
    static room(o: { wallX?: number; ceilY?: number } = {}): PlaneWorld {
        const pl: [number, number, number, number][] = [[0, 1, 0, 0]];
        if (o.wallX !== undefined) pl.push([-1, 0, 0, -o.wallX]);
        if (o.ceilY !== undefined) pl.push([0, -1, 0, -o.ceilY]);
        return new PlaneWorld(pl);
    }
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = -1;
        for (let i = 0; i < n; i++) {
            const R = r[i] + pad[i];
            for (const [nx, ny, nz, d] of this.planes) {
                const d0 = nx * c0[i * 3] + ny * c0[i * 3 + 1] + nz * c0[i * 3 + 2] - d - R;
                const d1 = nx * c1[i * 3] + ny * c1[i * 3 + 1] + nz * c1[i * 3 + 2] - d - R;
                let t = -1;
                if (d0 < 0) t = 0;
                else if (d1 < 0) t = d0 / (d0 - d1);
                if (t >= 0 && (best < 0 || t < best)) {
                    best = t;
                    out.sphere = i;
                    out.nx = nx; out.ny = ny; out.nz = nz;
                }
            }
        }
        return best;
    }
    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        let hit = false;
        out.x = 0; out.y = 0; out.z = 0;
        for (const [nx, ny, nz, d] of this.planes) {
            const pen = d + r - (nx * x + ny * y + nz * z);
            if (pen > 0) {
                hit = true;
                out.x += nx * pen; out.y += ny * pen; out.z += nz * pen;
            }
        }
        return hit;
    }
}

export function deps(world: ContactWorld | null): ReplayDeps {
    return { preset: (sha) => BY_SHA.get(sha) ?? null, world: () => world };
}

export function header(o: Omit<LifeHeaderInput, 'simCore' | 'preset'> & { preset?: PresetJson }): LifeHeader {
    return makeLifeHeader({ simCore: SIM_CORE_VERSION, preset: PRESET, ...o });
}

export interface RunnerSetup {
    world: ContactWorld | null;
    at: [number, number, number, number];
    overrides?: ParamOverrides;
    opts?: RespawnOpts;
    runner?: RunnerOptions;
}

/** A format /2 runner on a fresh model, as the session builds one. */
export function newRunner(o: RunnerSetup): Runner {
    const sim = lifeSim(compileParams(PRESET, o.overrides ?? {}), o.world);
    return new Runner(sim, header({ at: o.at, overrides: o.overrides, opts: o.opts }), o.runner ?? { traceHash: true, runHash: true });
}

/** A director as the page would wire it: touching includes the platform (the sim's contactWorld). */
export function attachDirector(runner: Runner, spawn: [number, number, number, number], policy: Partial<RespawnPolicy> = {}, history = new StateHistory()): RespawnDirector {
    const p = runner.sim.p;
    const d = new RespawnDirector({ ...DEFAULT_RESPAWN_POLICY, ...policy }, () => spawn, history, () => runner.sim.contactWorld, p.boundRadius, hoverSolve(p, 1).stick);
    runner.director = d;
    return d;
}

/**
 * The bot flies through the runner's queue every `period` ticks, stamped (tick + 1) ms, so the
 * inputs are the same at any frame split. `plan` sets tasks; lifeTick counts from the life's start.
 */
export class Pilot {
    readonly bot: BotPilot;
    readonly runner: Runner;
    mode: number = MODE_CHANNEL.acro;
    period = 4;
    phase = '';
    life = -1;
    lifeStart = 0;
    plan: ((p: Pilot, sim: Sim, lifeTick: number) => void) | null = null;
    /** channel overrides after the bot, e.g. a scripted flip */
    post: ((ch: Float64Array, sim: Sim) => void) | null = null;

    constructor(runner: Runner) {
        this.runner = runner;
        this.bot = new BotPilot(runner.sim.p);
        const prev = runner.onStep;
        runner.onStep = (sim) => {
            prev?.(sim);
            this.tick(sim);
        };
    }

    private tick(sim: Sim): void {
        if (sim.tick % this.period !== 0) return;
        // a format /1 runner (the wrap control) has no lives: one life from tick 0
        const L = this.runner.lives().length ? this.runner.current().header.life : { index: 0, startTick: 0 };
        if (L.index !== this.life) {
            this.life = L.index;
            this.lifeStart = L.startTick;
            this.phase = '';
        }
        this.plan?.(this, sim, sim.tick - this.lifeStart);
        const ch = this.bot.update(sim);
        // bot.ts writes ch[5] = 0, which v0.3 reads as horizon: the pilot sets the mode itself
        ch[5] = this.mode;
        this.post?.(ch, sim);
        this.runner.enqueue({ tUs: (sim.tick + 1) * 1000, ch });
    }

    here(sim: Sim): [number, number, number] {
        return [sim.s[S.px], sim.s[S.py], sim.s[S.pz]];
    }
}

/** Hover `hoverTicks` where the life starts, then dash along +x into the wall; up to maxCrashes times. */
export function crashCycles(p: Pilot, o: { hoverTicks: number; speed: number; maxCrashes: number; after?: (p: Pilot, sim: Sim, lifeTick: number) => void }): void {
    let dashes = 0;
    p.plan = (pp, sim, lt) => {
        if (pp.phase === '') {
            pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 0 }, sim);
            pp.phase = 'hover';
        } else if (pp.phase === 'hover' && lt >= o.hoverTicks && dashes < o.maxCrashes && sim.armed) {
            pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: o.speed, yawDeg: 0 }, sim);
            pp.phase = 'dash';
            dashes++;
        } else if (pp.phase === 'hover' && dashes >= o.maxCrashes) o.after?.(pp, sim, lt);
    };
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Frames at frameHz up to endUs, like a page: advanceTo(frame time). phaseUs shifts the frame
 * grid against the sim clock (a real page's clock origin is arbitrary); jitterUs adds seeded noise.
 */
export function runFrames(runner: Runner, frameHz: number, endUs: number, o: { phaseUs?: number; jitterUs?: number; seed?: number; perFrame?: (r: Runner) => void } = {}): number {
    const period = 1e6 / frameHz;
    const rng = mulberry32(o.seed ?? 7);
    let last = 0;
    let frames = 0;
    for (let k = 1; ; k++) {
        let t = Math.round((o.phaseUs ?? 0) + k * period + (o.jitterUs ? (rng() * 2 - 1) * o.jitterUs : 0));
        if (t <= last) t = last + 1;
        if (t > endUs) t = endUs;
        runner.advanceTo(t);
        frames++;
        last = t;
        o.perFrame?.(runner);
        if (t >= endUs) return frames;
    }
}

export const SPLITS = [30, 60, 144, 240];
