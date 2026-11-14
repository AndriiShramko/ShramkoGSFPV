// A pilot who follows a course's own beacon path (path.ts) at a steady speed, fed to the course's own lap detector
// (laps.ts) the way a page feeds it: one straight step per drawn frame (CourseRun.feed). Used by the generator's audit
// (tools/bench/src/tracks-audit.ts) and the unit tests: a gate that this pilot cannot register is a defect of the
// generator, of the path or of the detector. Pure: no clock, no DOM.
import { gateCrossing, trackToObjects } from '@shramko/sonic-fpv';
import type { SonicObject } from '@shramko/sonic-fpv';
import type { SceneTransform, TrackFile, Vec3 } from './types';
import { coursePath } from './path';
import { LapTimer } from './laps';

/** Why a gate does not register for the path pilot. */
export type MissCause =
    /** the gate's pass direction points against the leg that comes into it */
    | 'faces-against-leg'
    /** the path reaches the gate's centre and leaves on the side it came from: it touches the plane, never crosses it */
    | 'turns-back-at-gate'
    /** the path crosses the gate's plane forward, but outside its opening */
    | 'misses-opening'
    /** the path crosses inside the opening, but the straight step of one frame does not */
    | 'detector-tolerance';

export interface GateMiss {
    readonly gate: number;
    readonly cause: MissCause;
}

export interface PathFlight {
    readonly gates: number;
    /** laps the detector counted */
    readonly laps: number;
    readonly lapsPerRun: number;
    readonly done: boolean;
    /** the gate the detector waited for at the end (0-based), null when the run was done */
    readonly stuckAt: number | null;
    /** every gate of the course that the path pilot does not register at this speed, with its cause */
    readonly misses: readonly GateMiss[];
    readonly frames: number;
}

/** A page's drawn frame, ms (60 Hz). */
export const FRAME_MS = 1000 / 60;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

/** The points a run flies: the path once per lap, and for a closed course on to gate 0 once more (it ends the last lap). */
export function runPolyline(track: TrackFile, transform: SceneTransform = track.transform): Vec3[] {
    const cp = coursePath(track, transform);
    const path = cp.map((c) => c.pos);
    if (path.length === 0 || track.laps <= 1) return path;
    const out: Vec3[] = [...path];
    for (let lap = 1; lap < track.laps; lap++) out.push(...path.slice(1));
    out.push(...path.slice(1, cp.findIndex((c) => c.stage === 1) + 1));
    return out;
}

/** Points along a polyline every `stepM` of arc length, the last point included. */
export function sampleEvery(line: readonly Vec3[], stepM: number): Vec3[] {
    if (line.length === 0) return [];
    const out: Vec3[] = [line[0]!];
    let carry = 0;
    for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!;
        const d = sub(line[i + 1]!, a);
        const L = len(d);
        let s = stepM - carry;
        while (s <= L + 1e-12) {
            out.push(add(a, mul(d, s / L)));
            s += stepM;
        }
        carry = L - (s - stepM);
    }
    const last = line[line.length - 1]!;
    if (len(sub(out[out.length - 1]!, last)) > 1e-9) out.push(last);
    return out;
}

/** Whether frames of `stepM` along `line` cross `gate` forward inside its opening. */
function registers(gate: SonicObject, line: readonly Vec3[], stepM: number): 'inside' | 'outside' | 'none' {
    const pts = sampleEvery(line, stepM);
    let outside = false;
    for (let i = 0; i + 1 < pts.length; i++) {
        const x = gateCrossing(gate, pts[i]!, pts[i + 1]!);
        if (x === null) continue;
        if (x.inside) return 'inside';
        outside = true;
    }
    return outside ? 'outside' : 'none';
}

/** Every gate the path pilot does not register at `speedMps`: each gate alone, on the path from the gate before to the next. */
export function gateMisses(track: TrackFile, speedMps: number, transform: SceneTransform = track.transform, frameMs: number = FRAME_MS): GateMiss[] {
    const gates = trackToObjects(track, { transform });
    const cp = coursePath(track, transform);
    const line = runPolyline(track, transform);
    const stepM = (speedMps * frameMs) / 1000;
    const misses: GateMiss[] = [];
    gates.forEach((g, j) => {
        const at = cp.findIndex((c) => c.stage === j + 1);
        // the local stretch: from the point that ended the stage before (or the start) to the point after the gate
        let from = at - 1;
        while (from > 0 && cp[from]!.stage === undefined) from--;
        const to = Math.min(line.length - 1, at + 1 + (at + 1 < cp.length ? 0 : 1));
        const stretch = line.slice(Math.max(0, from), to + 1);
        if (registers(g, stretch, stepM) === 'inside') return;
        const axis = mul(rotZ(g), -1);
        const inLeg = sub(line[at]!, line[at - 1] ?? line[at]!);
        const outLeg = sub(line[at + 1] ?? line[at]!, line[at]!);
        let cause: MissCause;
        if (dot(axis, inLeg) <= 0) cause = 'faces-against-leg';
        else if (len(outLeg) > 1e-9 && dot(axis, outLeg) <= 0) cause = 'turns-back-at-gate';
        else if (registers(g, stretch, 0.002) === 'inside') cause = 'detector-tolerance';
        else cause = 'misses-opening';
        misses.push({ gate: j, cause });
    });
    return misses;
}

/** The gate's local +Z in the world (a forward pass goes along -Z). */
function rotZ(g: SonicObject): Vec3 {
    const [w, x, y, z] = g.quat;
    return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

/** Fly `track` along its own path at `speedMps`, one detector step per frame of `frameMs`. */
export function flyPath(track: TrackFile, speedMps: number, transform: SceneTransform = track.transform, frameMs: number = FRAME_MS): PathFlight {
    const gates = trackToObjects(track, { transform });
    const lapsPerRun = Math.max(1, Math.floor(track.laps));
    if (gates.length === 0) return { gates: 0, laps: 0, lapsPerRun, done: false, stuckAt: null, misses: [], frames: 0 };
    const pts = sampleEvery(runPolyline(track, transform), (speedMps * frameMs) / 1000);
    const timer = new LapTimer(gates, { laps: lapsPerRun });
    let done = false;
    for (let i = 0; i + 1 < pts.length && !done; i++) done = timer.step(Math.round((i + 1) * frameMs), pts[i]!, pts[i + 1]!) === 'done';
    const v = timer.view();
    const misses = done ? [] : gateMisses(track, speedMps, transform, frameMs);
    return { gates: gates.length, laps: v.laps, lapsPerRun, done, stuckAt: done ? null : v.next, misses, frames: pts.length - 1 };
}
