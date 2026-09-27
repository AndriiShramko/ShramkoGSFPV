// Shared set-ups for the model tests (test/model-*.test.ts): real Sim, presets from disk, and
// synthetic contact worlds (a half-space) instead of a scan.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sim, S, compileParams, hoverSolve, attitude, MODE_CHANNEL, Sha256 } from '../src/index';
import type { ContactOut, ContactWorld, FlightMode, ParamOverrides, PresetJson, SimParams } from '../src/index';

export function preset(id: string): PresetJson {
    return JSON.parse(readFileSync(join(__dirname, '..', 'presets', `${id}.json`), 'utf8')) as PresetJson;
}

export function params(id = 'pavo20pro-3s', o: ParamOverrides = {}): SimParams {
    return compileParams(preset(id), o);
}

/** Channel frame: sticks centred, given throttle stick (0..1), arm switch, mode. */
export function frame(thrStick: number, arm: boolean, mode: FlightMode): number[] {
    return [0, 0, thrStick * 2 - 1, 0, arm ? 1 : -1, MODE_CHANNEL[mode], 0, 0];
}

/** Armed and hovering at (0, 100, 0) in `mode` for `settleMs`; no world unless given. */
export function hovering(p: SimParams, mode: FlightMode, settleMs = 1500, world: ContactWorld | null = null): { sim: Sim; ch: number[]; stick: number } {
    const sim = new Sim(p, world);
    sim.reset(0, 100, 0, 0);
    const stick = hoverSolve(p, 1).stick;
    const ch = frame(0, false, mode);
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error('did not arm');
    ch[2] = stick * 2 - 1;
    sim.setChannels(ch);
    for (let i = 0; i < settleMs; i++) sim.step();
    return { sim, ch, stick };
}

export const roll = (sim: Sim) => attitude(sim.s).roll;
export const pitch = (sim: Sim) => attitude(sim.s).pitch;
export const RAD2DEG = 180 / Math.PI;
/** body rates in pilot terms, deg/s */
export const rate = (sim: Sim, axis: 'roll' | 'pitch' | 'yaw') =>
    (axis === 'roll' ? -sim.s[S.wz] : axis === 'pitch' ? -sim.s[S.wx] : -sim.s[S.wy]) * RAD2DEG;

/** Solid half-space n . x < d (n unit): a floor (n = +y) or a wall. */
export function halfSpace(nx: number, ny: number, nz: number, d: number): ContactWorld {
    return {
        sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
            let best = -1;
            for (let i = 0; i < n; i++) {
                const R = r[i] + pad[i];
                const a = nx * c0[i * 3] + ny * c0[i * 3 + 1] + nz * c0[i * 3 + 2] - d - R;
                const b = nx * c1[i * 3] + ny * c1[i * 3 + 1] + nz * c1[i * 3 + 2] - d - R;
                let t = -1;
                if (a <= 0) t = 0; else if (b < 0) t = a / (a - b);
                if (t >= 0 && (best < 0 || t < best)) { best = t; out.sphere = i; out.nx = nx; out.ny = ny; out.nz = nz; }
            }
            return best;
        },
        pushOut(x: number, y: number, z: number, r: number, o: { x: number; y: number; z: number }): boolean {
            const dist = nx * x + ny * y + nz * z - d - r;
            if (dist >= 0) return false;
            o.x = -nx * dist; o.y = -ny * dist; o.z = -nz * dist;
            return true;
        }
    };
}

/** SHA-256 over the full state after every step, the way the runner hashes a trace. */
export function tracer(sim: Sim): { step(): void; hex(): string } {
    const h = new Sha256();
    const bytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
    return { step: () => { sim.step(); h.update(bytes); }, hex: () => h.digestHex() };
}

export { S };
