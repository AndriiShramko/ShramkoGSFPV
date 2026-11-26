// Lane w3-wash of train 5 (docs/wip/w3-wash.md): where prop wash shows today, headless, no browser.
// The flight model (sim-core Sim, 1 kHz) runs on the default craft (apps/fly/src/presets.ts DEFAULT_PRESET),
// on the lightest preset and, as the reference that has the term, on the 5-inch freestyle preset, through two
// manoeuvres where prop wash must show:
//   M1 descent: a steady 4 m/s descent straight down (the script holds it with a P loop on the vertical speed,
//      as a pilot would), then a hover catch (the same loop, target 0 m/s, firmer).
//   M2 punch: the motors at idle for 1.5 s (a straight dive), then full throttle for 1.5 s.
//   M2b punch after a forward dive: angle mode, full forward stick at idle for 1.2 s, then level and full throttle.
// Every craft flies each manoeuvre twice: the wake term OFF (ParamOverrides.wake = 0, the model with no term bit
// for bit) and ON. A preset that ships wake_loss / wake_shake is ON as shipped; a preset that ships none (every
// whoop) gets, for this comparison only, the 5-inch estimates (wake_loss 0.25, wake_shake 0.3) and a rotor
// diameter read from its own prop field (WHOOP_PROP_MM below): nothing in the presets or the model changes.
// Printed: peak and mean wake intensity, the share of thrust the wake takes, the mean total thrust, the
// roll/pitch wobble (RMS body rate and the largest tilt off level in angle mode, where the setpoint is level),
// the height lost in the catch. Run: cd tools/bench && npx tsx src/w3-wash-run.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODE_CHANNEL, S, Sim, compileParams, hoverSolve } from '@gsfpv/sim-core';
import type { PresetJson, SimParams } from '@gsfpv/sim-core';
import { runDeterminism } from '@gsfpv/input/sim';
import { params, presetJson } from './presets';
import { loadScene } from './scenes';
import { REPO, writeEvidence } from './evidence';

const R2D = 180 / Math.PI;
/** The 5-inch freestyle preset: ships the term (wake_loss 0.25, wake_shake 0.3, both 'estimate'). */
const REF = 'nazgulf5v3-6s';
/** Rotor diameter, mm, of the whoop presets, from each preset's own "prop" field (they have no prop_diameter_mm). */
const WHOOP_PROP_MM: Record<string, number> = {
    'pavo20pro-3s': 55.9, // "Gemfan 2218": 2.2 inch
    'pavo20pro2-3s': 55.9, // "Gemfan D2.2"
    'pavo20pro2-4s': 55.9,
    'pavopico-2s': 45, // "Gemfan 45 mm 3-blade"
    'meteor65pro-1s': 35, // "35 mm"
    'air65-1s': 31 // "31 mm class"
};

function defaultPreset(): string {
    const src = readFileSync(join(REPO, 'apps', 'fly', 'src', 'presets.ts'), 'utf8');
    const m = /DEFAULT_PRESET\s*=\s*'([^']+)'/.exec(src);
    if (!m) throw new Error('DEFAULT_PRESET not found in apps/fly/src/presets.ts');
    return m[1];
}

function hasWake(p: PresetJson): boolean {
    const f = p.fields as Record<string, { value: unknown } | undefined>;
    return Number(f.wake_loss?.value ?? 0) > 0 || Number(f.wake_shake?.value ?? 0) > 0;
}

/** The preset with the term ON: as shipped when it has one, else with the 5-inch estimates and its own rotor size. */
function withWake(p: PresetJson): PresetJson {
    if (hasWake(p)) return p;
    const mm = WHOOP_PROP_MM[p.id];
    if (!mm) throw new Error(`no rotor diameter for ${p.id}`);
    const fields = { ...p.fields, wake_loss: { value: 0.25, source: 'estimate' }, wake_shake: { value: 0.3, source: 'estimate' }, prop_diameter_mm: { value: mm, source: 'estimate' } };
    return { ...p, fields } as PresetJson;
}

interface Window { washPeak: number; washMean: number; washMs: number; lossMean: number; lossPeak: number; thrustMeanN: number; rmsRateDps: number; rmsRateInWashDps: number; maxTiltDeg: number; }

/** Accumulates one window of steps; washMs and rmsRateInWashDps count only the 1 ms steps with wash > 0.05. */
class Meter {
    private n = 0; private wash = 0; private peak = 0; private loss = 0; private thr = 0; private rr = 0; private tilt = 0;
    private nw = 0; private rrw = 0;
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
        const r2 = s[S.wx] * s[S.wx] + s[S.wz] * s[S.wz];
        this.rr += r2;
        if (w > 0.05) { this.nw++; this.rrw += r2; }
        const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
        const tilt = Math.acos(Math.max(-1, Math.min(1, upY))) * R2D;
        if (tilt > this.tilt) this.tilt = tilt;
    }
    get(): Window {
        const n = this.n || 1;
        const r = (x: number, d = 3): number => Number(x.toFixed(d));
        return {
            washPeak: r(this.peak), washMean: r(this.wash / n), washMs: this.nw, lossMean: r(this.loss / n), lossPeak: r(this.sp.wakeLoss * this.peak),
            thrustMeanN: r(this.thr / n), rmsRateDps: r(Math.sqrt(this.rr / n) * R2D, 2), rmsRateInWashDps: r(this.nw ? Math.sqrt(this.rrw / this.nw) * R2D : 0, 2), maxTiltDeg: r(this.tilt, 2)
        };
    }
}

/** Armed, angle mode, hovering at 200 m for 1.5 s. */
function hover(sp: SimParams): { sim: Sim; ch: number[]; stick: number } {
    const sim = new Sim(sp, null);
    sim.reset(0, 200, 0, 0);
    const stick = hoverSolve(sp, 1).stick;
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error('did not arm');
    ch[2] = stick * 2 - 1; sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    return { sim, ch, stick };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** M1: hold -4 m/s for 2.5 s (P loop on vy), then catch to 0 m/s for 2 s. */
function descent(sp: SimParams): Record<string, unknown> {
    const { sim, ch, stick } = hover(sp);
    const hold = (target: number, k: number, ms: number, m: Meter | null): number => {
        let yMin = sim.s[S.py];
        for (let i = 0; i < ms; i++) {
            ch[2] = clamp01(stick + k * (target - sim.s[S.vy])) * 2 - 1;
            sim.setChannels(ch);
            sim.step();
            if (m) m.sample();
            if (sim.s[S.py] < yMin) yMin = sim.s[S.py];
        }
        return yMin;
    };
    hold(-4, 0.05, 1000, null); // settle into the descent
    const md = new Meter(sim, sp);
    hold(-4, 0.05, 1500, md);
    const vyAtCatch = sim.s[S.vy], y0 = sim.s[S.py];
    const mc = new Meter(sim, sp);
    const yMin = hold(0, 0.25, 2000, mc);
    return { descent: { vyMps: Number(vyAtCatch.toFixed(2)), ...md.get() }, catch: { heightLostM: Number((y0 - yMin).toFixed(3)), ...mc.get() } };
}

/**
 * M2: idle 1.5 s, then full throttle 1.5 s (measured over the first 1 s). M2b: forward flight (half forward stick,
 * 1.3 x hover throttle, 2 s), then idle with the stick held 1 s (a diving fall with sideways speed), then level + full.
 */
function punch(sp: SimParams, forward: boolean): Record<string, unknown> {
    const { sim, ch, stick } = hover(sp);
    if (forward) {
        ch[1] = 0.5; ch[2] = clamp01(stick * 1.3) * 2 - 1; sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
    }
    ch[2] = -1; sim.setChannels(ch);
    for (let i = 0; i < (forward ? 1000 : 1500); i++) sim.step();
    const s = sim.s;
    const vy = s[S.vy], vh = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vz] * s[S.vz]);
    ch[1] = 0; ch[2] = 1; sim.setChannels(ch);
    const m = new Meter(sim, sp);
    for (let i = 0; i < 1500; i++) { sim.step(); if (i < 1000) m.sample(); }
    return { atPunch: { vyMps: Number(vy.toFixed(2)), horizontalMps: Number(vh.toFixed(2)) }, ...m.get() };
}

function craft(id: string): Record<string, unknown> {
    const p = presetJson(id);
    const on = withWake(p);
    const pOff = compileParams(p, { wake: 0 });
    const pOn = compileParams(on, {});
    const shipped = compileParams(p, {});
    const vi = Math.sqrt((pOn.mass * 9.81) / (2 * pOn.rho * pOn.wakeArea));
    const row = (sp: SimParams) => ({ M1: descent(sp), M2: punch(sp, false), M2b: punch(sp, true) });
    return {
        id, massG: Number((shipped.mass * 1000).toFixed(1)),
        shippedTerm: { wakeLoss: shipped.wakeLoss, wakeShake: shipped.wakeShake, wakeAreaM2: shipped.wakeArea },
        onTerm: { borrowed: !hasWake(p), wakeLoss: pOn.wakeLoss, wakeShake: pOn.wakeShake, propMm: (on.fields as Record<string, { value: number }>).prop_diameter_mm.value, hoverInducedMps: Number(vi.toFixed(2)) },
        off: row(pOff), on: row(pOn)
    };
}

const ids = readdirSync(join(REPO, 'packages', 'sim-core', 'presets')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const lightest = ids.map((id) => ({ id, m: compileParams(presetJson(id), {}).mass })).sort((a, b) => a.m - b.m)[0].id;
const def = defaultPreset();
const crafts = [...new Set([def, lightest, REF])].map(craft);
// The A6 determinism run (tools/bench/test/a6-reference.test.ts) on the default craft as shipped, and with the
// term ON (the borrowed numbers): does giving the default craft prop wash move the pinned hash?
const A6_REFERENCE = '9cb46a358f1a9f82770a63934e8ef87954746b26918538935666f19094562c21';
const sc = await loadScene('39e63ce9');
const pos = sc.settings.position, tgt = sc.settings.target;
const spawn: [number, number, number, number] = [pos[0], pos[1], pos[2], (Math.atan2(tgt[0] - pos[0], -(tgt[2] - pos[2])) * 180) / Math.PI];
const a6Shipped = runDeterminism(params(def), sc.world, spawn, 60).hash;
const a6WithTerm = runDeterminism(compileParams(withWake(presetJson(def)), {}), sc.world, spawn, 60).hash;
const a6 = { reference: A6_REFERENCE, shipped: a6Shipped, shippedHolds: a6Shipped === A6_REFERENCE, withTerm: a6WithTerm, withTermHolds: a6WithTerm === A6_REFERENCE };
const out = { defaultPreset: def, lightestPreset: lightest, reference: REF, a6, crafts };
const file = process.env.W3_NO_EVIDENCE ? '' : writeEvidence('w3-wash-headless', out, '2026-11-19/w3-wash');
console.log(JSON.stringify(out));
if (file) console.error(`evidence: ${file}`);
