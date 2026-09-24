// Scripted bot flights shared by the Node harness and the browser: arm -> hover -> box ->
// dash into a wall at a chosen speed -> crash. Runs through the Runner's input queue, so the
// flight is logged and replayable exactly like a human flight.

import { Runner, S } from '@gsfpv/sim-core';
import type { Sim } from '@gsfpv/sim-core';
import { BotPilot } from './bot';

export interface ScenarioPlan {
    spawn: [number, number, number];
    spawnYawDeg: number;
    box: [number, number, number][]; // waypoints of the box pattern
    wallDir: [number, number, number] | null; // horizontal unit vector towards the wall
    wallYawDeg: number;
    dashSpeed: number; // m/s
    /** optional cinematic tour through free corridors (replaces the box) */
    tour?: [number, number, number][];
    tourSpeed?: number;
    /** optional roll flip: climb to this point, flip once, recover, then fly the route */
    flipAt?: [number, number, number];
}

export type Phase = 'arm' | 'hover' | 'climb' | 'flip' | 'recover' | 'box' | 'return' | 'aim' | 'dash' | 'crashed' | 'rest' | 'done';

export interface ScenarioLog {
    phase: Phase;
    phases: { phase: Phase; tick: number }[];
    hoverVz: number | null;
    maxSpeed: number;
    crash: { tick: number; speed: number; px: number; py: number; pz: number } | null;
    tumbleMaxW: number; // rad/s after the crash
    flip: { startTick: number; endTick: number; minUpY: number } | null;
}

export class Scenario {
    readonly runner: Runner;
    readonly bot: BotPilot;
    readonly plan: ScenarioPlan;
    phase: Phase = 'arm';
    private phaseTick = 0;
    log: ScenarioLog = { phase: 'arm', phases: [{ phase: 'arm', tick: 0 }], hoverVz: null, maxSpeed: 0, crash: null, tumbleMaxW: 0, flip: null };
    /** bot update period in ticks (4 = 250 Hz, a typical radio link) */
    period = 4;

    constructor(runner: Runner, plan: ScenarioPlan) {
        this.runner = runner;
        this.plan = plan;
        this.bot = new BotPilot(runner.sim.p);
        this.bot.setTask({ kind: 'hover', target: plan.spawn, yawDeg: plan.spawnYawDeg }, runner.sim);
        const prev = runner.onStep;
        runner.onStep = (sim) => {
            prev?.(sim);
            this.onStep(sim);
        };
    }

    private go(p: Phase, sim: Sim): void {
        this.phase = p;
        this.phaseTick = sim.tick;
        this.log.phase = p;
        this.log.phases.push({ phase: p, tick: sim.tick });
    }

    private onStep(sim: Sim): void {
        const s = sim.s;
        const v = Math.sqrt(s[S.vx] ** 2 + s[S.vy] ** 2 + s[S.vz] ** 2);
        if (!sim.crashed && v > this.log.maxSpeed) this.log.maxSpeed = v;
        const el = (sim.tick - this.phaseTick) / 1000;
        const pl = this.plan;
        switch (this.phase) {
            case 'arm':
                if (sim.armed) this.go('hover', sim);
                break;
            case 'hover':
                if (el >= 2.5) {
                    this.log.hoverVz = s[S.vy];
                    if (pl.flipAt) {
                        this.bot.setTask({ kind: 'hover', target: pl.flipAt, yawDeg: pl.spawnYawDeg }, sim);
                        this.go('climb', sim);
                    } else this.startRoute(sim);
                }
                break;
            case 'climb':
                if (el >= 2.5) {
                    this.log.flip = { startTick: sim.tick, endTick: -1, minUpY: 1 };
                    this.go('flip', sim);
                }
                break;
            case 'flip': {
                // body up vector, world y component: 1 upright, -1 inverted
                const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
                const f = this.log.flip!;
                if (upY < f.minUpY) f.minUpY = upY;
                if ((f.minUpY < -0.5 && upY > 0.3) || el > 2) {
                    f.endTick = sim.tick;
                    this.bot.setTask({ kind: 'hover', target: pl.flipAt!, yawDeg: pl.spawnYawDeg }, sim);
                    this.go('recover', sim);
                }
                break;
            }
            case 'recover':
                if (el >= 2.5) this.startRoute(sim);
                break;
            case 'box':
                if (this.bot.status.done || el > 30) {
                    if (pl.tour && pl.tour.length) {
                        // tour ends where the dash starts: aim straight away
                        this.bot.setTask({ kind: 'hover', target: [s[S.px], s[S.py], s[S.pz]], yawDeg: pl.wallYawDeg }, sim);
                        this.go('aim', sim);
                    } else {
                        this.bot.setTask({ kind: 'path', points: [pl.spawn], speed: 1.2, yawDeg: pl.spawnYawDeg }, sim);
                        this.go('return', sim);
                    }
                }
                break;
            case 'return':
                if (this.bot.status.done || el > 8) {
                    this.bot.setTask({ kind: 'hover', target: pl.spawn, yawDeg: pl.wallYawDeg }, sim);
                    this.go('aim', sim);
                }
                break;
            case 'aim':
                if (el >= 1.5) {
                    if (!pl.wallDir) { this.go('done', sim); break; }
                    this.bot.setTask({ kind: 'dash', from: [s[S.px], s[S.py], s[S.pz]], dir: pl.wallDir, speed: pl.dashSpeed, yawDeg: pl.wallYawDeg }, sim);
                    this.go('dash', sim);
                }
                break;
            case 'dash':
                if (sim.crashed) {
                    const ev = [...this.runner.events].reverse().find((e) => e.type === 'crash');
                    if (ev && ev.type === 'crash') this.log.crash = { tick: ev.tick, speed: ev.speed, px: ev.px, py: ev.py, pz: ev.pz };
                    this.go('crashed', sim);
                } else if (el > Math.max(6, 12 / pl.dashSpeed)) {
                    // no crash: the open-volume control ends here; a slow dash gets time to reach the wall
                    this.go('done', sim);
                }
                break;
            case 'crashed': {
                const w = Math.sqrt(s[S.wx] ** 2 + s[S.wy] ** 2 + s[S.wz] ** 2);
                if (w > this.log.tumbleMaxW) this.log.tumbleMaxW = w;
                if (s[S.crashed] === 2) this.go('rest', sim);
                break;
            }
            default:
                break;
        }
        if (sim.tick % this.period === 0 && this.phase !== 'done' && this.phase !== 'rest') {
            const ch = this.bot.update(sim);
            if (this.phase === 'flip') {
                // full right roll at low throttle: one quick roll, then the bot takes over again
                ch[0] = 1; ch[1] = 0; ch[3] = 0; ch[2] = -0.4;
            }
            this.runner.enqueue({ tUs: (sim.tick + 1) * 1000, ch });
        }
    }

    private startRoute(sim: Sim): void {
        const pl = this.plan;
        if (pl.tour && pl.tour.length) {
            this.bot.acceptRadius = 0.35;
            this.bot.setTask({ kind: 'path', points: pl.tour, speed: pl.tourSpeed ?? 4, yawDeg: 'along' }, sim);
        } else {
            this.bot.setTask({ kind: 'path', points: [...pl.box, pl.box[0]], speed: 1.5, yawDeg: pl.spawnYawDeg }, sim);
        }
        this.go('box', sim);
    }

    get finished(): boolean {
        return this.phase === 'done' || this.phase === 'rest';
    }
}

/** Box of side `size` centred on the spawn, at spawn height. */
export function boxAround(p: [number, number, number], size: number): [number, number, number][] {
    const h = size / 2;
    return [
        [p[0] + h, p[1], p[2] + h],
        [p[0] + h, p[1], p[2] - h],
        [p[0] - h, p[1], p[2] - h],
        [p[0] - h, p[1], p[2] + h]
    ];
}
