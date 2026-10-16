// Stick sensitivity after the setup wizard (the owner's message 21, item 7: "with the DJI controller
// the sensitivity seems much higher than with my previous radio"). The wizard sets each stick's ends
// to the farthest it saw while the pilot set it up; a stick that was never pushed all the way gets a
// short range, reaches full deflection early and reads every move larger: more sensitive. This runs
// simulated people (packages/input/src/sim/human.ts, a model, not measured humans) through the wizard
// on two kinds of device and reads their profiles back:
//   - the reading at half physical deflection (ideal 0.5; 0.55 = 10 % more sensitive) and the share
//     of the travel at which the stick already reads full deflection (ideal 1.0);
//   - radio = an EdgeTX radio (11-bit channels), pad = 5 float axes and a springing throttle (the
//     DJI controller's shape on the Gamepad API: -1..1, the throttle in the middle at rest).
// And the DJI controller itself: the extremes of the owner's real 25 s stir (the range the wizard
// would have set from it).
//
//   npx tsx tools/radios/sensitivity.ts [--n 480] [--out file.json]
import { writeFileSync } from 'node:fs';
import { CalibrationWizard, mapFrame } from '../../packages/input/src/calib';
import type { Fn, Profile, RawFrame } from '../../packages/input/src/calib';
import { newWizardAdapter, quantize11, runHuman } from '../../packages/input/src/sim/human';
import type { HumanConfig, Stick } from '../../packages/input/src/sim/human';
import { sweepHuman } from '../../packages/input/test/helpers';
import { DJI_RC3_STIR } from '../../packages/input/test/fixtures/dji-rc3-stir';

const arg = (name: string, def: string): string => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const N = Number(arg('n', '480'));
const LETTER: Record<Fn, Stick> = { roll: 'A', pitch: 'E', throttle: 'T', yaw: 'R' };

/** The channel value the person's radio sends for a physical stick position p (-1..1) of stick `l`. */
function channelAt(cfg: HumanConfig, l: Stick, p: number): number {
    let v = p * cfg.rangeLimit;
    if (cfg.inv[l]) v = -v;
    if (l !== 'T') v += cfg.trim[l as 'A' | 'E' | 'R'];
    return cfg.gamepadLike ? Math.max(-1, Math.min(1, v)) : quantize11(v);
}

/** Through the profile: the reading of stick `fn` at physical position p, the others at rest. */
function readingAt(cfg: HumanConfig, prof: Profile, fn: Fn, p: number): number {
    const f: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    for (const g of ['roll', 'pitch', 'yaw', 'throttle'] as Fn[]) f.axes[prof.axes[g].index] = channelAt(cfg, LETTER[g], g === 'throttle' ? -1 : 0);
    f.axes[prof.axes[fn].index] = channelAt(cfg, LETTER[fn], p);
    const out = mapFrame(prof, f, new Float32Array(8));
    const v = out[fn === 'roll' ? 0 : fn === 'pitch' ? 1 : fn === 'yaw' ? 3 : 2];
    return Math.abs(v);
}

/** The smallest physical deflection at which the stick reads full (>= 0.999), by bisection. */
function saturatesAt(cfg: HumanConfig, prof: Profile, fn: Fn): number {
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (readingAt(cfg, prof, fn, m) >= 0.999) hi = m; else lo = m; }
    return hi;
}

const q = (a: number[], p: number): number => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 1000) / 1000 : NaN; };

function sweep(kind: 'radio' | 'pad'): Record<string, unknown> {
    const half: number[] = [];
    const sat: number[] = [];
    let people = 0, correct = 0, short = 0;
    for (let i = 0; i < N; i++) {
        const cfg = sweepHuman(i);
        cfg.gamepadLike = kind === 'pad';
        if (kind === 'pad') { cfg.arm = 'momentary'; cfg.rateHz = 250; }
        let w: CalibrationWizard | null = null;
        const o = runHuman(() => (w = new CalibrationWizard('k', 'n')), newWizardAdapter(), cfg, 180000);
        people++;
        const prof = (w as CalibrationWizard | null)?.state.profile;
        if (o.kind !== 'correct' || !prof) continue;
        correct++;
        let worst = 0;
        for (const fn of ['roll', 'pitch', 'yaw'] as Fn[]) {
            // both directions: the more sensitive one counts
            const r = Math.max(readingAt(cfg, prof, fn, 0.5), readingAt(cfg, prof, fn, -0.5));
            half.push(r);
            sat.push(Math.min(saturatesAt(cfg, prof, fn), 1));
            worst = Math.max(worst, r);
            if (process.argv.includes('--why') && r > 0.56) {
                const a = prof.axes[fn];
                const trim = cfg.trim[LETTER[fn] as 'A' | 'E' | 'R'];
                console.error(`${kind} #${i} ${fn}: reading ${r.toFixed(3)} centre ${a.center.toFixed(3)} (true ${(cfg.inv[LETTER[fn]] ? 1 : 1) * trim >= 0 ? '+' : ''}${trim.toFixed(3)}) min ${a.min.toFixed(3)} max ${a.max.toFixed(3)} thumbRest ${cfg.thumbRest.toFixed(2)} residual ${cfg.residual.toFixed(3)} rangeLimit ${cfg.rangeLimit.toFixed(2)}`);
            }
        }
        if (worst > 0.55) short++;
    }
    return {
        people, correct,
        halfReading: { p50: q(half, 0.5), p90: q(half, 0.9), p99: q(half, 0.99), max: q(half, 1) },
        fullAtTravel: { p50: q(sat, 0.5), p10: q(sat, 0.1), p1: q(sat, 0.01), min: q(sat, 0) },
        peopleAnyStickOver10pct: short
    };
}

function djiStir(): Record<string, unknown> {
    const lo = [Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (const r of DJI_RC3_STIR) for (let i = 0; i < 4; i++) { const v = r[1 + i] / 660; lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }
    return { axes: ['X', 'Y', 'Z', 'Rx'], min: lo, max: hi, note: 'the wizard sets each stick end to the farthest value seen; -1 and +1 = the full range, so this stir gives no extra sensitivity' };
}

const out = { what: 'stick sensitivity after the setup wizard (tools/radios/sensitivity.ts), simulated people (a model)', n: N, radio: sweep('radio'), pad: sweep('pad'), djiStir: djiStir() };
console.log(JSON.stringify(out, null, 1));
const file = arg('out', '');
if (file) writeFileSync(file, JSON.stringify(out, null, 1));
