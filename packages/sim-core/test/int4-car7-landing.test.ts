// Seam of train 5 car 7: w2-pilot's softer ground (physics.vCrashGround 7 m/s on the page) against w3-model's prop wash
// on every craft (thrust lost while a craft sinks into its own downwash, wake.ts: the band starts at WAKE_LO x the hover
// induced velocity, 2.3 to 3.1 m/s of sink on the presets). A landing must still leave every craft whole, at the page's
// default wash (x1) and at the setting's maximum (x2). Three pilots: a slow flown landing (it never reaches the band), a
// brisk descent at 4 m/s with a flare near the ground (the flare is made inside the wash, so it is weaker: the touch is
// measured with the wash acting, not assumed), and a pilot who only lowers the throttle under the hover and waits (no
// flare: not a gentle landing, the margin; at the maximum wash x2 a 5-inch breaks that way, at the default none does).
import { describe, expect, it } from 'vitest';
import { S, compileParams, hoverSolve, lifeSim } from '../src/index';
import type { ParamOverrides, Sim } from '../src/index';
import { PlaneWorld } from './log-kit';
import { PRESET_IDS, frame, preset } from './model-helpers';

/** the page's defaults (packages/prefs: physics.vCrashGround 7, physics.propWash x1 -> override `wake`) */
const PAGE: ParamOverrides = { vCrashGround: 7, wake: 1 };
const PAGE_MAX_WASH: ParamOverrides = { vCrashGround: 7, wake: 2 };
const NO_WASH: ParamOverrides = { vCrashGround: 7, wake: 0 };

interface Landing { crashed: boolean; touch: number; washMax: number }
type Pilot = (sim: Sim, hover: number) => number;

/**
 * Armed in angle mode, level, `fromM` above a floor, motors at the hover; then the pilot lands. `pilot` gives the
 * throttle stick (0..1) for the tick. Ends at the first contact (or crash): the speed of that touch, whether it broke
 * the craft, and the strongest wash met on the way down.
 */
function land(id: string, o: ParamOverrides, fromM: number, pilot: Pilot): Landing {
    const p = compileParams(preset(id), o);
    const sim = lifeSim(p, PlaneWorld.room());
    sim.reset(0, fromM, 0, 0);
    const hover = hoverSolve(p, 1).stick;
    const ch = frame(0, false, 'angle');
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    if (!sim.armed) throw new Error(`${id} did not arm`);
    let washMax = 0;
    for (let i = 0; i < 60000; i++) {
        ch[2] = pilot(sim, hover) * 2 - 1;
        sim.setChannels(ch);
        const n = sim.events.length;
        sim.step();
        if (sim.washNow > washMax) washMax = sim.washNow;
        for (let k = n; k < sim.events.length; k++) {
            const e = sim.events[k];
            if (e.type === 'crash') return { crashed: true, touch: e.speed, washMax };
            if (e.type === 'contact') return { crashed: false, touch: e.speed, washMax };
        }
    }
    throw new Error(`${id} never touched the floor`);
}

/** a P loop on the sink rate around the hover stick */
const loop = (sim: Sim, hover: number, want: number, gain: number): number =>
    Math.min(1, Math.max(0, hover + gain * (want - sim.s[S.vy])));
/** A slow landing: sink at 1.5 m/s, 0.6 m/s for the last metre. */
const slow: Pilot = (sim, hover) => loop(sim, hover, sim.s[S.py] > 1 ? -1.5 : -0.6, 0.08);
/** A brisk landing: sink at 5 m/s (inside every preset's wash band) down to 3 m, then flare for 0.6 m/s. */
const brisk: Pilot = (sim, hover) => loop(sim, hover, sim.s[S.py] > 3 ? -5 : -0.6, 0.12);
/** A pilot who only lowers the throttle to `k` of the hover stick and holds it: no flare (not gentle; the margin). */
const held = (k: number): Pilot => (_sim, hover) => hover * k;

describe('car 7 seam: a landing leaves every craft whole with the prop wash acting', () => {
    for (const [name, o] of [['wash x1 (the default)', PAGE], ['wash x2 (the maximum)', PAGE_MAX_WASH]] as const) {
        it(`a slow flown landing from 6 m, ${name}: every preset touches under 1 m/s and stays whole`, () => {
            for (const id of PRESET_IDS) {
                const r = land(id, o, 6, slow);
                expect(r.crashed, id).toBe(false);
                expect(r.touch, id).toBeLessThan(1);
            }
        });
        it(`a brisk descent from 20 m at 5 m/s with a flare at 3 m, ${name}: the wash acts on every preset, each lands whole`, () => {
            for (const id of PRESET_IDS) {
                const r = land(id, o, 20, brisk);
                expect(r.washMax, `${id}: the descent must enter the wash band`).toBeGreaterThan(0.5);
                expect(r.crashed, `${id} touched at ${r.touch.toFixed(2)} m/s`).toBe(false);
                expect(r.touch, id).toBeLessThan(1);
            }
        });
        it(`no flare, the throttle held at 90 % of the hover from 10 m, ${name}: every preset stays whole`, () => {
            for (const id of PRESET_IDS) {
                const r = land(id, o, 10, held(0.9));
                expect(r.crashed, `${id} touched at ${r.touch.toFixed(2)} m/s`).toBe(false);
            }
        });
    }

    it('no flare, the throttle held at 85 % of the hover from 10 m at the default wash: every preset stays whole', () => {
        for (const id of PRESET_IDS) {
            const r = land(id, PAGE, 10, held(0.85));
            expect(r.crashed, `${id} touched at ${r.touch.toFixed(2)} m/s`).toBe(false);
        }
    });

    it('the controls: the wash makes the held descent faster on every preset, and the check can fire', () => {
        for (const id of PRESET_IDS) {
            const off = land(id, NO_WASH, 10, held(0.85));
            const on = land(id, PAGE, 10, held(0.85));
            expect(off.washMax, id).toBe(0);
            expect(on.washMax, id).toBeGreaterThan(0);
            expect(on.touch, id).toBeGreaterThan(off.touch);
        }
        // at the setting's maximum the same careless descent breaks a 5-inch (7.5 m/s against 7): the margin is real
        expect(land('machr5sport-6s', PAGE_MAX_WASH, 10, held(0.85)).crashed).toBe(true);
    });
});
