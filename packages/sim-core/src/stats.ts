// FlightStats (docs/architecture-v03.md D.1, item 7): the goggles' end-of-flight numbers,
// computed per tick from the sim state and events only, so a replay of the log reproduces them
// exactly. Kept per life and per session; the per-drone lifetime totals live in prefs (W2-4).
// "Flying" below means armed: a crash disarms, so wreck ticks never count.

import { S, DT } from './sim';
import type { SimEvent } from './sim';
import { EARTH_G } from './params';
import type { RespawnReason } from './contracts';

export interface StatsBlock {
    /** armed time (ON TIME) */
    airtimeS: number;
    maxSpeed: number;
    /** above the spawn */
    maxAlt: number;
    /** horizontal, from the spawn (like a GPS home distance) */
    maxDist: number;
    /** flown path length */
    distance: number;
    /** lowest pack voltage under load while armed (the end voltage when never armed) */
    minVolt: number;
    endVolt: number;
    maxAmps: number;
    usedMah: number;
    /** specific force over a 10-tick window, in Earth g: 1 at a hover */
    maxG: number;
    /** throttle stick 0..1, averaged over armed ticks */
    avgThrottle: number;
    fullThrottleS: number;
    fullThrottleCount: number;
    crashes: number;
    /** fastest crash or contact approach speed */
    maxImpact: number;
    bounces: number;
    respawns: Partial<Record<RespawnReason, number>>;
    /** armed time from a life's start to its first crash, the longest one */
    longestCleanS: number;
    /** arming cycles started with the switch (a respawn that keeps the craft armed continues its flight) */
    flights: number;
    /** scenes flown: 1 plus the scene switches */
    scenes: number;
}

/** Minimal sim view the stats read, so a scripted state can drive them. */
export interface StatsSource {
    readonly s: Float64Array;
    readonly tick: number;
    readonly ch: ArrayLike<number>;
    readonly p: { readonly gravity: number };
}

/** Stick at or above this counts as full throttle (100% THRT TIME); radios rarely send exactly +1. */
export const FULL_THROTTLE_STICK = 0.98;
/** G-force window, ticks (D.1) */
export const G_WINDOW_TICKS = 10;

class Acc {
    armedTicks = 0;
    maxSpeed = 0;
    maxAlt = -Infinity;
    maxDist = 0;
    distance = 0;
    minVolt = Infinity;
    endVolt = 0;
    maxAmps = 0;
    usedMah = 0;
    maxG = 0;
    thrSum = 0;
    fullTicks = 0;
    fullCount = 0;
    crashes = 0;
    maxImpact = 0;
    bounces = 0;
    respawns: Partial<Record<RespawnReason, number>> = {};
    flights = 0;
    scenes = 1;

    block(longestCleanTicks: number): StatsBlock {
        const n = this.armedTicks;
        return {
            airtimeS: n * DT,
            maxSpeed: this.maxSpeed,
            maxAlt: n > 0 ? this.maxAlt : 0,
            maxDist: this.maxDist,
            distance: this.distance,
            minVolt: n > 0 ? this.minVolt : this.endVolt,
            endVolt: this.endVolt,
            maxAmps: this.maxAmps,
            usedMah: this.usedMah,
            maxG: this.maxG,
            avgThrottle: n > 0 ? this.thrSum / n : 0,
            fullThrottleS: this.fullTicks * DT,
            fullThrottleCount: this.fullCount,
            crashes: this.crashes,
            maxImpact: this.maxImpact,
            bounces: this.bounces,
            respawns: { ...this.respawns },
            longestCleanS: longestCleanTicks * DT,
            flights: this.flights,
            scenes: this.scenes
        };
    }
}

export class FlightStats {
    /** pack capacity of the drone, for "used of" displays */
    readonly capacityMah: number;
    private spawn: [number, number, number];
    private lifeAcc = new Acc();
    private sessAcc = new Acc();
    private cleanTicks = 0;
    private lifeCrashed = false;
    private bestClean = 0;
    private lifeStartTick = -1;
    private lastTick = -1;
    // path and G-window state; reset at every life, since a respawn is a jump, not a flight
    private havePrev = false;
    private px = 0;
    private py = 0;
    private pz = 0;
    private readonly vRing = new Float64Array(G_WINDOW_TICKS * 3);
    private vN = 0;
    private fullOn = false;

    constructor(spawn: [number, number, number], capacityMah: number) {
        this.spawn = [spawn[0], spawn[1], spawn[2]];
        this.capacityMah = capacityMah;
    }

    onStep(sim: StatsSource): void {
        const s = sim.s;
        const L = this.lifeAcc, T = this.sessAcc;
        this.lastTick = sim.tick;
        const amps = s[S.amps], volt = s[S.volt];
        // 1 mAh = 3.6 A s
        const mah = (amps * DT) / 3.6;
        L.usedMah += mah; T.usedMah += mah;
        L.endVolt = volt; T.endVolt = volt;
        if (amps > L.maxAmps) L.maxAmps = amps;
        if (amps > T.maxAmps) T.maxAmps = amps;
        const x = s[S.px], y = s[S.py], z = s[S.pz];
        const vx = s[S.vx], vy = s[S.vy], vz = s[S.vz];
        // the path moved during this tick; the previous position is tracked armed or not, so the arming tick counts
        let step = 0;
        if (this.havePrev) {
            const dx = x - this.px, dy = y - this.py, dz = z - this.pz;
            step = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        this.px = x; this.py = y; this.pz = z;
        this.havePrev = true;
        // specific force (what an accelerometer reads): dv/dt over the window plus gravity
        let g = 0;
        const k = (this.vN % G_WINDOW_TICKS) * 3;
        if (this.vN >= G_WINDOW_TICKS) {
            const w = G_WINDOW_TICKS * DT;
            const ax = (vx - this.vRing[k]) / w, ay = (vy - this.vRing[k + 1]) / w + sim.p.gravity, az = (vz - this.vRing[k + 2]) / w;
            g = Math.sqrt(ax * ax + ay * ay + az * az) / EARTH_G;
        }
        this.vRing[k] = vx; this.vRing[k + 1] = vy; this.vRing[k + 2] = vz;
        this.vN++;
        if (!(s[S.armed] > 0)) {
            this.fullOn = false;
            return;
        }
        L.armedTicks++; T.armedTicks++;
        if (!this.lifeCrashed) this.cleanTicks++;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const alt = y - this.spawn[1];
        const hx = x - this.spawn[0], hz = z - this.spawn[2];
        const dist = Math.sqrt(hx * hx + hz * hz);
        const thr = (sim.ch[2] + 1) * 0.5;
        const full = thr >= FULL_THROTTLE_STICK;
        const newFull = full && !this.fullOn;
        this.fullOn = full;
        for (const A of [L, T]) {
            if (speed > A.maxSpeed) A.maxSpeed = speed;
            if (alt > A.maxAlt) A.maxAlt = alt;
            if (dist > A.maxDist) A.maxDist = dist;
            A.distance += step;
            if (volt < A.minVolt) A.minVolt = volt;
            if (g > A.maxG) A.maxG = g;
            A.thrSum += thr;
            if (full) A.fullTicks++;
            if (newFull) A.fullCount++;
        }
    }

    onEvent(e: SimEvent): void {
        const L = this.lifeAcc, T = this.sessAcc;
        switch (e.type) {
            case 'crash':
                L.crashes++; T.crashes++;
                if (e.speed > L.maxImpact) L.maxImpact = e.speed;
                if (e.speed > T.maxImpact) T.maxImpact = e.speed;
                this.lifeCrashed = true;
                break;
            case 'contact':
                if (e.regime === 'bounce') { L.bounces++; T.bounces++; }
                if (e.speed > L.maxImpact) L.maxImpact = e.speed;
                if (e.speed > T.maxImpact) T.maxImpact = e.speed;
                break;
            case 'respawn':
                this.lifeStartTick = e.tick;
                break;
            case 'arm':
                // an arm at the respawn tick is a respawn keeping the craft armed, not a new flight
                if (e.tick !== this.lifeStartTick) { L.flights++; T.flights++; }
                break;
            default:
                break;
        }
    }

    /**
     * A new life starts at `at`: the path goes on from there (the jump to it is not flown) and the
     * G window restarts. The runner calls it at every respawn. 'scene': at is the new spawn.
     */
    newLife(at: [number, number, number], reason: RespawnReason | 'start' = 'start'): void {
        if (this.cleanTicks > this.bestClean) this.bestClean = this.cleanTicks;
        this.lifeAcc = new Acc();
        this.cleanTicks = 0;
        this.lifeCrashed = false;
        this.px = at[0]; this.py = at[1]; this.pz = at[2];
        this.havePrev = true;
        this.vN = 0;
        this.fullOn = false;
        this.lifeStartTick = this.lastTick;
        if (reason === 'scene') {
            this.spawn = [at[0], at[1], at[2]];
            this.sessAcc.scenes++;
        }
        if (reason !== 'start') {
            this.lifeAcc.respawns[reason] = 1;
            this.sessAcc.respawns[reason] = (this.sessAcc.respawns[reason] ?? 0) + 1;
        }
    }

    life(): StatsBlock {
        return this.lifeAcc.block(this.cleanTicks);
    }

    session(): StatsBlock {
        return this.sessAcc.block(Math.max(this.bestClean, this.cleanTicks));
    }
}
