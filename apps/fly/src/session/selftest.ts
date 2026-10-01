// In-page measurements the acceptance drivers call (split from v0.2's session.ts, unchanged): the
// thrust-to-weight on a virtual stand, a disarmed drop from the spawn, and the tunnelling check of
// the live flight model against an independent oracle. Each runs its own Sim, never the pilot's.
import { Sim, S, spherePoses } from '@gsfpv/sim-core';
import type { SimParams, ContactWorld } from '@gsfpv/sim-core';
import type { VoxelCollision } from '@gsfpv/collision';

/** What the self-tests read of the session. */
export interface SelfTestHost {
    readonly params: SimParams;
    readonly spawn: [number, number, number, number];
    readonly collision: VoxelCollision | null;
    readonly world: ContactWorld | null;
    /** the world the flight model flies in (null: walls off) */
    readonly flightWorld: ContactWorld | null;
}

/**
 * Thrust-to-weight measured in the model like on a thrust stand: level, full throttle, the craft
 * held in place while the motors spin up (so drag does not enter), then released for 20 ms;
 * (a + g) / g. Battery sag under load stays in, as on a real stand.
 */
export function measureTwr(h: SelfTestHost): number {
    const sim = new Sim(h.params, null);
    sim.reset(0, 100, 0, 0);
    const ch = new Float32Array([0, 0, -1, 0, -1, 1, 0, 0]);
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    ch[2] = 1; sim.setChannels(ch);
    const hold = () => { sim.s[S.px] = 0; sim.s[S.py] = 100; sim.s[S.pz] = 0; sim.s[S.vx] = 0; sim.s[S.vy] = 0; sim.s[S.vz] = 0; };
    for (let i = 0; i < 300; i++) { sim.step(); hold(); }
    for (let i = 0; i < 20; i++) sim.step();
    const a = sim.s[S.vy] / 0.02;
    return (a + h.params.gravity) / h.params.gravity;
}

/** Disarmed drop from the spawn: mean downward acceleration until contact or 0.5 s. */
export function dropTest(h: SelfTestHost): { g: number; measured: number; fallM: number } {
    const sim = new Sim(h.params, h.flightWorld);
    sim.reset(h.spawn[0], h.spawn[1], h.spawn[2], h.spawn[3]);
    const ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step(); // arm releases the parked craft
    ch[4] = -1; sim.setChannels(ch); sim.step(); // disarm: motors off, free fall
    const y0 = sim.s[S.py], v0 = sim.s[S.vy];
    let n = 0;
    for (; n < 500; n++) {
        const before = sim.events.length;
        sim.step();
        if (sim.events.slice(before).some((e) => e.type === 'contact' || e.type === 'crash')) break;
    }
    const tt = n / 1000;
    const fall = y0 - sim.s[S.py];
    // s = v0 t + a t^2 / 2 (downwards positive)
    const measured = tt > 0.05 ? (2 * (fall + v0 * tt)) / (tt * tt) : NaN;
    return { g: h.params.gravity, measured, fallM: fall };
}

/**
 * In-browser tunnelling check through the live flight model: the craft is launched at `speed`
 * towards walls; an oracle (upstream querySphere) resamples every tick's path every voxel/4.
 */
export function tunnelSelfTest(h: SelfTestHost, passes: number, speed: number, seed = 1): { passes: number; speed: number; contacts: number; penetrations: number } {
    const col = h.collision;
    if (!col) return { passes: 0, speed, contacts: 0, penetrations: 0 };
    let a = seed >>> 0;
    const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const p = h.params;
    const n = p.spheres.length / 4;
    const push = { x: 0, y: 0, z: 0 };
    const c0 = new Float64Array(n * 3), c1 = new Float64Array(n * 3), tmp = new Float64Array(n * 3);
    const step = col.voxelResolution / 4;
    let done = 0, contacts = 0, penetrations = 0, tries = 0;
    // near the spawn first; if walls are not within reach there, anywhere inside the voxel grid
    const g0 = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const gs = [col.numVoxelsX * col.voxelResolution, col.numVoxelsY * col.voxelResolution, col.numVoxelsZ * col.voxelResolution];
    while (done < passes && tries < passes * 400) {
        tries++;
        const wide = tries > passes * 50;
        let ox = wide ? g0[0] + rng() * gs[0] : h.spawn[0] + (rng() - 0.5) * 6;
        let oy = wide ? g0[1] + rng() * gs[1] : h.spawn[1] + (rng() - 0.5) * 2;
        let oz = wide ? g0[2] + rng() * gs[2] : h.spawn[2] + (rng() - 0.5) * 6;
        if (wide && !col.isFreeAt(ox, oy, oz)) continue;
        if (col.querySphere(ox, oy, oz, p.boundRadius + 0.05, push)) continue;
        const ang = rng() * Math.PI * 2;
        const dx = Math.cos(ang), dz = Math.sin(ang), dy = (rng() - 0.5) * 0.4;
        const dl = Math.hypot(dx, dy, dz);
        // wide search: look further for a surface and start 0.5..3 m in front of it (as the A5 harness does)
        const hit = col.queryRay(ox, oy, oz, dx / dl, dy / dl, dz / dl, wide ? 30 : 6);
        if (!hit) continue;
        if (wide) {
            const back = Math.min(Math.hypot(hit.x - ox, hit.y - oy, hit.z - oz), 0.5 + rng() * 2.5);
            ox = hit.x - (dx / dl) * back; oy = hit.y - (dy / dl) * back; oz = hit.z - (dz / dl) * back;
            if (col.querySphere(ox, oy, oz, p.boundRadius + 0.05, push)) continue;
        }
        const sim = new Sim(p, h.world);
        sim.reset(ox, oy, oz, (ang * 180) / Math.PI);
        sim.s[S.hold] = 0;
        sim.s[S.vx] = (dx / dl) * speed; sim.s[S.vy] = (dy / dl) * speed; sim.s[S.vz] = (dz / dl) * speed;
        let hitWall = false;
        for (let k = 0; k < 2000 && !hitWall; k++) {
            const s = sim.s;
            spherePoses(p.spheres, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], c0);
            const before = sim.events.length;
            sim.step();
            spherePoses(p.spheres, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], c1);
            // oracle: resample every sphere's path during this tick
            for (let i = 0; i < n; i++) {
                const L = Math.hypot(c1[i * 3] - c0[i * 3], c1[i * 3 + 1] - c0[i * 3 + 1], c1[i * 3 + 2] - c0[i * 3 + 2]);
                const m = Math.max(1, Math.ceil(L / step));
                for (let j = 0; j <= m; j++) {
                    const f = j / m;
                    tmp[0] = c0[i * 3] + (c1[i * 3] - c0[i * 3]) * f;
                    tmp[1] = c0[i * 3 + 1] + (c1[i * 3 + 1] - c0[i * 3 + 1]) * f;
                    tmp[2] = c0[i * 3 + 2] + (c1[i * 3 + 2] - c0[i * 3 + 2]) * f;
                    if (col.querySphere(tmp[0], tmp[1], tmp[2], p.spheres[i * 4 + 3], push)) { penetrations++; j = m + 1; i = n; }
                }
            }
            if (sim.events.slice(before).some((e) => e.type === 'crash' || e.type === 'contact')) { hitWall = true; contacts++; }
        }
        done++;
    }
    return { passes: done, speed, contacts, penetrations };
}
