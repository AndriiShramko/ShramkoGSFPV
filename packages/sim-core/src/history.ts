// StateHistory (docs/architecture-v03.md C.5): where the craft was, sampled per tick, so a
// respawn can go back N seconds. It replaces v0.2's trackSafePoint, which sampled only when a
// frame happened to end on tick % 500 and so got 0-22 points a minute (D-d). Samples are taken
// by the tick counter, so every frame split records the same ones.

import { S, attitude } from './sim';
import type { Sim, SimEvent } from './sim';

export interface HistorySample {
    tick: number;
    x: number;
    y: number;
    z: number;
    yawDeg: number;
    /** armed and flying, no contact in the last quietTicks, body clear of the scene by margin */
    safe: boolean;
}

export interface HistoryOptions {
    /** sample period in ticks (50 = 20 Hz) */
    everyTicks?: number;
    /** samples kept (1200 x 50 ticks = 60 s) */
    capacity?: number;
    /** clearance beyond the body's bounding radius for a safe sample, m (0.05) */
    margin?: number;
    /** a contact this recent makes a sample unsafe, ticks (300) */
    quietTicks?: number;
}

export class StateHistory {
    readonly everyTicks: number;
    readonly capacity: number;
    readonly margin: number;
    readonly quietTicks: number;
    private readonly ticks: Float64Array;
    private readonly pos: Float64Array;
    private readonly yaw: Float64Array;
    private readonly safeF: Uint8Array;
    private head = 0;
    private count = 0;
    private lastContact = -Infinity;
    private readonly push = { x: 0, y: 0, z: 0 };

    constructor(o: HistoryOptions = {}) {
        this.everyTicks = Math.max(1, Math.floor(o.everyTicks ?? 50));
        this.capacity = Math.max(1, Math.floor(o.capacity ?? 1200));
        this.margin = o.margin ?? 0.05;
        this.quietTicks = o.quietTicks ?? 300;
        this.ticks = new Float64Array(this.capacity);
        this.pos = new Float64Array(this.capacity * 3);
        this.yaw = new Float64Array(this.capacity);
        this.safeF = new Uint8Array(this.capacity);
    }

    /** how far back the kept samples can reach, ticks (60 000 by default) */
    get depthTicks(): number {
        return this.everyTicks * this.capacity;
    }

    get size(): number {
        return this.count;
    }

    /** Call after every step; it samples on its own period. The body test is the scene's (sim.world), not the platform's. */
    onStep(sim: Sim): void {
        if (sim.tick % this.everyTicks !== 0) return;
        const s = sim.s;
        const x = s[S.px], y = s[S.py], z = s[S.pz];
        let safe = s[S.armed] > 0 && s[S.crashed] === 0 && sim.tick - this.lastContact >= this.quietTicks;
        if (safe && sim.world && sim.world.pushOut(x, y, z, sim.p.boundRadius + this.margin, this.push)) safe = false;
        const i = this.head;
        this.ticks[i] = sim.tick;
        this.pos[i * 3] = x;
        this.pos[i * 3 + 1] = y;
        this.pos[i * 3 + 2] = z;
        this.yaw[i] = attitude(s).yaw;
        this.safeF[i] = safe ? 1 : 0;
        this.head = (i + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
    }

    onEvent(e: SimEvent): void {
        if (e.type === 'contact' || e.type === 'crash') this.lastContact = e.tick;
    }

    /** The newest safe sample at or before tick - minAgeTicks, else older safe ones; null = none (use the spawn). */
    pickBefore(tick: number, minAgeTicks: number): HistorySample | null {
        const limit = tick - minAgeTicks;
        for (let k = 0; k < this.count; k++) {
            const i = (this.head - 1 - k + this.capacity) % this.capacity;
            if (this.ticks[i] > limit || this.safeF[i] === 0) continue;
            return this.sample(i);
        }
        return null;
    }

    /** The newest sample, safe or not. */
    latest(): HistorySample | null {
        return this.count === 0 ? null : this.sample((this.head - 1 + this.capacity) % this.capacity);
    }

    /** The scene transform changed (E.7): move every kept position with it. */
    mapPositions(f: (x: number, y: number, z: number) => [number, number, number]): void {
        for (let k = 0; k < this.count; k++) {
            const i = (this.head - 1 - k + this.capacity) % this.capacity;
            const p = f(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
            this.pos[i * 3] = p[0];
            this.pos[i * 3 + 1] = p[1];
            this.pos[i * 3 + 2] = p[2];
        }
    }

    clear(): void {
        this.head = 0;
        this.count = 0;
        this.lastContact = -Infinity;
    }

    private sample(i: number): HistorySample {
        return { tick: this.ticks[i], x: this.pos[i * 3], y: this.pos[i * 3 + 1], z: this.pos[i * 3 + 2], yawDeg: this.yaw[i], safe: this.safeF[i] === 1 };
    }
}
