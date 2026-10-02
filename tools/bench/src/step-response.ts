// Stick step response of the flight model in Node (no browser): roll, pitch and yaw steps of 25, 50
// and 100 % from a settled hover, in acro, angle and horizon. Per case: the delay to the first motor
// change, and the time to 50 % and 90 % of the target (body rate in acro and on yaw, the angle in
// angle and horizon). Usage: npx tsx tools/bench/src/step-response.ts [presetId] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim, S, compileParams, hoverSolve, attitude, setpointRate, MODE_CHANNEL } from '@gsfpv/sim-core';
import type { FlightMode, ParamOverrides, PresetJson, SimParams } from '@gsfpv/sim-core';

const here = dirname(fileURLToPath(import.meta.url));
const R2D = 180 / Math.PI;

export interface StepCase { mode: FlightMode; axis: 'roll' | 'pitch' | 'yaw'; stick: number }
export interface StepResult extends StepCase {
    /** what is tracked: 'rate' deg/s or 'angle' deg */
    kind: 'rate' | 'angle';
    target: number;
    motorMs: number;
    /** first visible movement: 10 % of the target */
    t10: number;
    t50: number;
    t90: number;
    /** peak / target, 1 = no overshoot */
    peak: number;
}

export function loadPreset(id: string): PresetJson {
    return JSON.parse(readFileSync(join(here, '..', '..', '..', 'packages', 'sim-core', 'presets', `${id}.json`), 'utf8')) as PresetJson;
}

const rateOf = (sim: Sim, axis: StepCase['axis']) =>
    (axis === 'roll' ? -sim.s[S.wz] : axis === 'pitch' ? -sim.s[S.wx] : -sim.s[S.wy]) * R2D;

/** One step from a 1.5 s hover; samples every 1 ms tick for 1.5 s after the step. */
export function stepResponse(p: SimParams, c: StepCase): StepResult {
    const sim = new Sim(p, null);
    sim.reset(0, 100, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL[c.mode], 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    ch[2] = hoverSolve(p, 1).stick * 2 - 1;
    sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    const m0 = Array.from(sim.motorCmd);
    const ax = c.axis === 'roll' ? 0 : c.axis === 'pitch' ? 1 : 3;
    ch[ax] = c.stick;
    sim.setChannels(ch);
    const rc = p.rates;
    const axRates = c.axis === 'roll' ? rc.roll : c.axis === 'pitch' ? rc.pitch : rc.yaw;
    const sp = setpointRate(rc.type, c.stick, axRates, rc.rateLimit);
    const levelled = c.mode !== 'acro' && c.axis !== 'yaw';
    const target = levelled ? (p.level.limitDeg * sp) / setpointRate(rc.type, 1, axRates, rc.rateLimit) : sp;
    const a0 = levelled ? attitude(sim.s)[c.axis as 'roll' | 'pitch'] : 0;
    let motorMs = -1, t10 = -1, t50 = -1, t90 = -1, peak = 0;
    for (let t = 1; t <= 1500; t++) {
        sim.step();
        if (motorMs < 0) {
            for (let i = 0; i < 4; i++) if (Math.abs(sim.motorCmd[i] - m0[i]) > 0.002) { motorMs = t; break; }
        }
        const v = levelled ? attitude(sim.s)[c.axis as 'roll' | 'pitch'] - a0 : rateOf(sim, c.axis);
        const f = v / target;
        if (t10 < 0 && f >= 0.1) t10 = t;
        if (t50 < 0 && f >= 0.5) t50 = t;
        if (t90 < 0 && f >= 0.9) t90 = t;
        if (f > peak) peak = f;
    }
    return { ...c, kind: levelled ? 'angle' : 'rate', target, motorMs, t10, t50, t90, peak };
}

export const CASES: StepCase[] = [];
for (const mode of ['acro', 'angle', 'horizon'] as FlightMode[])
    for (const axis of ['roll', 'pitch', 'yaw'] as const)
        for (const stick of [0.25, 0.5, 1]) CASES.push({ mode, axis, stick });

export function runAll(id: string, o: ParamOverrides = {}): StepResult[] {
    const p = compileParams(loadPreset(id), o);
    return CASES.map((c) => stepResponse(p, c));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const id = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'pavo20pro-3s';
    const res = runAll(id);
    console.log(`preset ${id}  (ms after the step; -1 = not reached in 1.5 s)`);
    console.log('mode     axis   stick  kind   target  motor  t10   t50   t90   peak');
    for (const r of res) {
        console.log(`${r.mode.padEnd(8)} ${r.axis.padEnd(6)} ${String(r.stick).padEnd(6)} ${r.kind.padEnd(6)} ${r.target.toFixed(1).padStart(6)} ${String(r.motorMs).padStart(5)} ${String(r.t10).padStart(5)} ${String(r.t50).padStart(5)} ${String(r.t90).padStart(5)}  ${r.peak.toFixed(2)}`);
    }
    const j = process.argv.indexOf('--json');
    if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ preset: id, results: res }, null, 1));
}
