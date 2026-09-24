// Fixed-step runner, input log and trace hash.
//
// The physics runs at exactly 1000 steps per simulated second. Frames call advanceTo(t) with
// the page clock; inputs are queued with their own timestamps and applied at the first tick
// at or after that time. Each applied sample is logged together with the tick that actually
// used it, so a replay reproduces the flight bit-for-bit no matter how frames were split.

import { Sim, S, DT_US } from './sim';
import type { SimEvent } from './sim';
import { Sha256 } from './sha256';

export const MAX_CATCHUP_STEPS = 250;

export interface InputSample {
    tUs: number; // sim-clock microseconds
    ch: ArrayLike<number>;
}

export interface LogHeader {
    format: 'gsfpv-input-log/1';
    simCore: string;
    preset: string;
    configHash: string;
    collisionSha256: string | null;
    spawn: [number, number, number, number];
    seed: number;
}

/** Binary log: Int32 t_us + Float32 ch[8] per record. t_us odd = respawn (ch[0..3] = x, y, z, yaw). */
export class InputLog {
    header: LogHeader;
    private buf: ArrayBuffer;
    private view: DataView;
    count = 0;
    static readonly REC = 4 + 8 * 4;

    constructor(header: LogHeader, capacity = 1 << 16) {
        this.header = header;
        this.buf = new ArrayBuffer(capacity * InputLog.REC);
        this.view = new DataView(this.buf);
    }

    private grow(): void {
        const nb = new ArrayBuffer(this.buf.byteLength * 2);
        new Uint8Array(nb).set(new Uint8Array(this.buf));
        this.buf = nb;
        this.view = new DataView(nb);
    }

    push(tUs: number, ch: ArrayLike<number>): void {
        if ((this.count + 1) * InputLog.REC > this.buf.byteLength) this.grow();
        const o = this.count * InputLog.REC;
        this.view.setInt32(o, tUs, true);
        for (let i = 0; i < 8; i++) this.view.setFloat32(o + 4 + i * 4, ch[i] ?? 0, true);
        this.count++;
    }

    record(i: number, ch: Float32Array): number {
        const o = i * InputLog.REC;
        for (let k = 0; k < 8; k++) ch[k] = this.view.getFloat32(o + 4 + k * 4, true);
        return this.view.getInt32(o, true);
    }

    bytes(): Uint8Array {
        return new Uint8Array(this.buf, 0, this.count * InputLog.REC);
    }

    static fromBytes(header: LogHeader, bytes: Uint8Array): InputLog {
        const n = Math.floor(bytes.length / InputLog.REC);
        const log = new InputLog(header, Math.max(16, n));
        new Uint8Array(log.buf).set(bytes.subarray(0, n * InputLog.REC));
        log.count = n;
        return log;
    }

    /** Log of the last `seconds` before tick `endTick`, re-based to start at tick 0 state? No: keeps absolute ticks. */
    slice(fromTick: number, toTick: number): InputLog {
        const out = new InputLog(this.header, 1024);
        const ch = new Float32Array(8);
        for (let i = 0; i < this.count; i++) {
            const t = this.record(i, ch);
            const tick = Math.floor(t / DT_US);
            if (tick >= fromTick && tick <= toTick) out.push(t, ch);
        }
        return out;
    }
}

export interface TrajectoryPoint {
    t: number; // s
    p: [number, number, number];
    q: [number, number, number, number];
    v: [number, number, number];
    motors: [number, number, number, number];
    throttle: number;
    armed: boolean;
    crashed: boolean;
}

export class Runner {
    readonly sim: Sim;
    log: InputLog | null;
    private queue: InputSample[] = [];
    private qHead = 0;
    private hash: Sha256 | null = null;
    private hashBytes: Uint8Array;
    hitches = 0;
    hitchSteps = 0;
    /** called after every step (for trajectory / HUD); keep cheap */
    onStep: ((sim: Sim) => void) | null = null;
    trajectory: TrajectoryPoint[] | null = null;
    private lastApplied = new Float32Array(8);
    events: SimEvent[] = [];

    constructor(sim: Sim, log: InputLog | null, traceHash = false) {
        this.sim = sim;
        this.log = log;
        this.hashBytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
        if (traceHash) this.hash = new Sha256();
        this.lastApplied.fill(0);
        this.lastApplied[2] = -1;
        this.lastApplied[4] = -1;
    }

    get tUs(): number {
        return this.sim.tick * DT_US;
    }

    enqueue(sample: InputSample): void {
        this.queue.push({ tUs: sample.tUs, ch: Float32Array.from(sample.ch as ArrayLike<number>) });
    }

    /** Respawn is part of the log, so replays reproduce it. */
    respawn(x: number, y: number, z: number, yawDeg: number): void {
        const tick = this.sim.tick;
        this.log?.push(tick * DT_US + 1, [x, y, z, yawDeg, 0, 0, 0, 0]);
        const f = Float32Array.from([x, y, z, yawDeg]);
        this.sim.respawn(f[0], f[1], f[2], f[3]);
    }

    /** Step until the sim clock reaches tUs (at most MAX_CATCHUP_STEPS). Returns steps taken. */
    advanceTo(tUs: number): number {
        let steps = 0;
        while (this.sim.tick * DT_US + DT_US <= tUs) {
            if (steps >= MAX_CATCHUP_STEPS) {
                this.hitches++;
                const skip = Math.floor((tUs - this.sim.tick * DT_US) / DT_US);
                this.hitchSteps += skip;
                return steps;
            }
            this.stepOnce();
            steps++;
        }
        return steps;
    }

    /** One tick: apply every queued sample with t <= the new tick time, then step. */
    stepOnce(): void {
        const nextT = (this.sim.tick + 1) * DT_US;
        let applied = false;
        while (this.qHead < this.queue.length && this.queue[this.qHead].tUs <= nextT) {
            const smp = this.queue[this.qHead++];
            for (let i = 0; i < 8; i++) this.lastApplied[i] = smp.ch[i] ?? 0;
            applied = true;
        }
        if (this.qHead > 4096) {
            this.queue = this.queue.slice(this.qHead);
            this.qHead = 0;
        }
        if (applied) {
            this.sim.setChannels(this.lastApplied);
            this.log?.push(nextT, this.lastApplied);
        }
        const nEv = this.sim.events.length;
        this.sim.step();
        if (this.sim.events.length > nEv) {
            for (let i = nEv; i < this.sim.events.length; i++) this.events.push(this.sim.events[i]);
        }
        if (this.sim.events.length > 256) this.sim.events.length = 0;
        if (this.hash) this.hash.update(this.hashBytes);
        if (this.trajectory && this.sim.tick % 10 === 0) this.trajectory.push(trajPoint(this.sim));
        this.onStep?.(this.sim);
    }

    traceHash(): string {
        if (!this.hash) throw new Error('trace hash not enabled');
        return this.hash.digestHex();
    }
}

export function trajPoint(sim: Sim): TrajectoryPoint {
    const s = sim.s;
    return {
        t: sim.tick / 1000,
        p: [s[S.px], s[S.py], s[S.pz]],
        q: [s[S.qw], s[S.qx], s[S.qy], s[S.qz]],
        v: [s[S.vx], s[S.vy], s[S.vz]],
        motors: [s[S.m0], s[S.m1], s[S.m2], s[S.m3]],
        throttle: (sim.ch[2] + 1) / 2,
        armed: s[S.armed] > 0,
        crashed: s[S.crashed] > 0
    };
}

/**
 * Replay a log from a fresh sim (same params, same spawn) and return the trace hash.
 * The runner applies records exactly at their logged ticks.
 */
export function replay(sim: Sim, log: InputLog, endTick: number, onStep?: (sim: Sim) => void): string {
    const h = new Sha256();
    const bytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
    const ch = new Float32Array(8);
    let i = 0;
    let nextT = log.count > 0 ? log.record(0, ch) : Infinity;
    while (sim.tick < endTick) {
        const tickT = (sim.tick + 1) * DT_US;
        while (i < log.count && nextT <= tickT) {
            const t = log.record(i, ch);
            if ((t & 1) === 1) {
                // respawn happens between ticks, before the tick whose time is t-1
                sim.respawn(ch[0], ch[1], ch[2], ch[3]);
            } else {
                sim.setChannels(ch);
            }
            i++;
            nextT = i < log.count ? log.record(i, ch) : Infinity;
        }
        sim.step();
        h.update(bytes);
        onStep?.(sim);
    }
    return h.digestHex();
}
