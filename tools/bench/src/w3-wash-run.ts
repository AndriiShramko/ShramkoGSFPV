// Lanes w3-wash and w3-model of train 5 (docs/wip/w3-wash.md, docs/wip/w3-model.md): prop wash, headless, no browser.
// The flight model (sim-core Sim, 1 kHz) runs on the default craft (apps/fly/src/presets.ts DEFAULT_PRESET),
// the Air65 (air65-1s) and the 5-inch freestyle preset through the manoeuvres where prop wash must show:
//   M1 descent: a steady descent straight down at 3, 4 and 5 m/s (held by a PI loop on the vertical speed, as a
//      pilot would), then a hover catch (a fixed firm stick, 1.5 x the hover stick); plus the same aimed at the
//      craft's own peak descent speed (the ratio WAKE_PEAK, shifted by the duct, times its hover induced velocity):
//      that descent needs near idle thrust, so the ratio leaves the band and the wash shows only in the catch.
//   M2 punch: the motors at idle for 1.5 s (a straight dive), then full throttle; angle mode (the tilt is the wobble
//      the stabiliser lets through) and acro (no attitude hold: the tilt is what the pilot would have to correct).
//   M2b punch after a forward dive: angle mode, forward flight, idle 1 s, then level and full throttle.
// Every craft flies each manoeuvre at the prop wash multiplier 0 (physics.propWash 0: the model with no term bit
// for bit, which is also the flight of origin/main on the default and the Air65, both had no term), 1 (the default)
// and 2 (the most the setting allows). The w3-wash run of origin/main (evidence/2026-11-19/w3-wash/) is the "before".
// Printed: wake intensity, the share of thrust lost (mean), the mean total thrust, the roll/pitch wobble (RMS body
// rate in the wash, the largest tilt off level), the height lost in the catch and in the punch, the time the punch
// needs to stop the fall. Run: cd tools/bench && npx tsx src/w3-wash-run.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODE_CHANNEL, S, Sim, WAKE_PEAK, compileParams, hoverSolve, inducedVelocity } from '@gsfpv/sim-core';
import type { SimParams } from '@gsfpv/sim-core';
import { runDeterminism } from '@gsfpv/input/sim';
import { params, presetJson } from './presets';
import { loadScene } from './scenes';
import { REPO, writeEvidence } from './evidence';

const R2D = 180 / Math.PI;
const G = 9.81;
const CRAFTS = ['air65-1s', 'nazgulf5v3-6s'];
const MULTIPLIERS = [0, 1, 2];

function defaultPreset(): string {
    const src = readFileSync(join(REPO, 'apps', 'fly', 'src', 'presets.ts'), 'utf8');
    const m = /DEFAULT_PRESET\s*=\s*'([^']+)'/.exec(src);
    if (!m) throw new Error('DEFAULT_PRESET not found in apps/fly/src/presets.ts');
    return m[1];
}

interface Window { washPeak: number; washMean: number; washMs: number; lossMeanPct: number; lossInWashPct: number; thrustMeanN: number; rmsRateInWashDps: number; maxTiltDeg: number; }

/** Accumulates one window of steps; washMs, lossInWashPct and rmsRateInWashDps count only the steps with wash > 0.05. */
class Meter {
    private n = 0; private wash = 0; private peak = 0; private loss = 0; private thr = 0; private tilt = 0;
    private nw = 0; private rrw = 0; private lossw = 0;
    constructor(private readonly sim: Sim, private readonly sp: SimParams) {}
    sample(): void {
        const s = this.sim.s;
        const w = this.sim.washNow;
        const th = (this.sim as unknown as { thrust: Float64Array }).thrust;
        this.n++;
        this.wash += w;
        if (w > this.peak) this.peak = w;
        this.loss += this.sp.wakeLoss * w;
        this.thr += th[0] + th[1] + th[2] + th[3];
        if (w > 0.05) { this.nw++; this.rrw += s[S.wx] * s[S.wx] + s[S.wz] * s[S.wz]; this.lossw += this.sp.wakeLoss * w; }
        const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
        const tilt = Math.acos(Math.max(-1, Math.min(1, upY))) * R2D;
        if (tilt > this.tilt) this.tilt = tilt;
    }
    get(): Window {
        const n = this.n || 1;
        const r = (x: number, d = 3): number => Number(x.toFixed(d));
        return {
            washPeak: r(this.peak), washMean: r(this.wash / n), washMs: this.nw, lossMeanPct: r((100 * this.loss) / n, 2),
            lossInWashPct: r(this.nw ? (100 * this.lossw) / this.nw : 0, 2), thrustMeanN: r(this.thr / n),
            rmsRateInWashDps: r(this.nw ? Math.sqrt(this.rrw / this.nw) * R2D : 0, 2), maxTiltDeg: r(this.tilt, 2)
        };
    }
}

/** Armed in the given mode, hovering at 200 m for 1.5 s. */
function hover(sp: SimParams, mode: number): { sim: Sim; ch: number[]; stick: number } {
    const sim = new Sim(sp, null);
    sim.reset(0, 200, 0, 0);
    const stick = hoverSolve(sp, 1).stick;
    const ch = [0, 0, -1, 0, -1, mode, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error('did not arm');
    ch[2] = stick * 2 - 1; sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    return { sim, ch, stick };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** M1: hold -speed m/s for 2.5 s (PI loop on vy), then catch to 0 m/s for 2 s. */
function descent(sp: SimParams, speed: number): Record<string, unknown> {
    const { sim, ch, stick } = hover(sp, MODE_CHANNEL.angle);
    let integ = 0;
    const hold = (target: number, k: number, ms: number, m: Meter | null): void => {
        for (let i = 0; i < ms; i++) {
            const e = target - sim.s[S.vy];
            integ += e * 0.001;
            ch[2] = clamp01(stick + k * e + 0.1 * integ) * 2 - 1;
            sim.setChannels(ch);
            sim.step();
            if (m) m.sample();
        }
    };
    hold(-speed, 0.05, 1000, null); // settle into the descent
    const md = new Meter(sim, sp);
    hold(-speed, 0.05, 1500, md);
    // the catch: a fixed firm stick (1.5 x the hover stick), open loop, so no controller hides the extra sink
    const vyAtCatch = sim.s[S.vy], y0 = sim.s[S.py];
    const mc = new Meter(sim, sp);
    ch[2] = clamp01(stick * 1.5) * 2 - 1; sim.setChannels(ch);
    let yMin = y0, stopMs = -1;
    for (let i = 0; i < 2000; i++) {
        sim.step(); mc.sample();
        if (sim.s[S.py] < yMin) yMin = sim.s[S.py];
        if (stopMs < 0 && sim.s[S.vy] >= 0) stopMs = i + 1;
    }
    return { vyMps: Number(vyAtCatch.toFixed(2)), descent: md.get(), catch: { heightLostM: Number((y0 - yMin).toFixed(3)), fallStopsMs: stopMs, ...mc.get() } };
}

/**
 * M2: idle 1.5 s, then full throttle 1.5 s (measured over the first 1 s): the height lost after the punch starts
 * and the time until the fall stops. M2b: forward flight (half forward stick, 1.3 x hover throttle, 2 s), then idle
 * with the stick held 1 s (a diving fall with sideways speed), then level + full.
 */
function punch(sp: SimParams, mode: number, forward: boolean): Record<string, unknown> {
    const { sim, ch, stick } = hover(sp, mode);
    if (forward) {
        ch[1] = 0.5; ch[2] = clamp01(stick * 1.3) * 2 - 1; sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
    }
    ch[2] = -1; sim.setChannels(ch);
    for (let i = 0; i < (forward ? 1000 : 1500); i++) sim.step();
    const s = sim.s;
    const vy = s[S.vy], vh = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vz] * s[S.vz]), y0 = s[S.py];
    ch[1] = 0; ch[2] = 1; sim.setChannels(ch);
    const m = new Meter(sim, sp);
    let yMin = y0, stopMs = -1;
    for (let i = 0; i < 1500; i++) {
        sim.step();
        if (i < 1000) m.sample();
        if (s[S.py] < yMin) yMin = s[S.py];
        if (stopMs < 0 && s[S.vy] >= 0) stopMs = i + 1;
    }
    return { atPunch: { vyMps: Number(vy.toFixed(2)), horizontalMps: Number(vh.toFixed(2)) }, sinkAfterPunchM: Number((y0 - yMin).toFixed(3)), fallStopsMs: stopMs, ...m.get() };
}

function craft(id: string): Record<string, unknown> {
    const p = presetJson(id);
    const base = compileParams(p, {});
    const vh = inducedVelocity(base.mass * G, base.rho, base.wakeArea);
    const peakSpeed = Number(((WAKE_PEAK + base.wakeShift) * vh).toFixed(2));
    const runs: Record<string, unknown> = {};
    for (const k of MULTIPLIERS) {
        const sp = compileParams(p, { wake: k });
        runs[`x${k}`] = {
            wakeLoss: sp.wakeLoss, wakeShake: sp.wakeShake,
            M1: Object.fromEntries([3, 4, 5, peakSpeed].map((v) => [`${v}mps`, descent(sp, v)])),
            M2angle: punch(sp, MODE_CHANNEL.angle, false), M2acro: punch(sp, MODE_CHANNEL.acro, false), M2b: punch(sp, MODE_CHANNEL.angle, true)
        };
    }
    return { id, massG: Number((base.mass * 1000).toFixed(1)), ducted: base.wakeShift > 0, hoverInducedMps: Number(vh.toFixed(2)), peakDescentMps: peakSpeed, runs };
}

const def = defaultPreset();
const crafts = [...new Set([def, ...CRAFTS])].map(craft);
// The A6 determinism run (tools/bench/test/a6-reference.test.ts) on the default craft at the default multiplier.
const A6_REFERENCE = '9cb46a358f1a9f82770a63934e8ef87954746b26918538935666f19094562c21';
const sc = await loadScene('39e63ce9');
const pos = sc.settings.position, tgt = sc.settings.target;
const spawn: [number, number, number, number] = [pos[0], pos[1], pos[2], (Math.atan2(tgt[0] - pos[0], -(tgt[2] - pos[2])) * 180) / Math.PI];
const a6Shipped = runDeterminism(params(def), sc.world, spawn, 60).hash;
const a6 = { reference: A6_REFERENCE, shipped: a6Shipped, holds: a6Shipped === A6_REFERENCE };
const out = { defaultPreset: def, a6, crafts };
const file = process.env.W3_NO_EVIDENCE ? '' : writeEvidence('w3-model-wash', out, '2026-11-19/w3-model');
console.log(JSON.stringify(out));
if (file) console.error(`evidence: ${file}`);
