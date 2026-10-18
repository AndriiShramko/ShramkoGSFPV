// The first view of the 3D drone stage (apps/fly/src/drones3d/views.ts, orbit.ts; v0.9 lane D review): the whole model sits
// inside the stage, whatever the stage's shape. The first cut stood the camera 2.25 model radii away for every drone, which
// cut the top off the cinelifter's battery and the edge off its right-hand propeller in the 16:10 picker.
// Claims, each with a negative control:
//  - at the distance fitDistance gives, every vertex of every model projects inside the frame (|ndc| <= 1) and the farthest
//    one is close to the edge (not a tiny model in a big stage), for four stage shapes and all four camera loads of the
//    cinelifter (the control: the old fixed 2.25 puts the cinelifter outside the 16:10 frame, and the same check would have
//    said so);
//  - a wider stage (a stage clamped in height) needs less distance than a narrower one for a model that is wider than tall;
//  - Orbit: the first view's distance follows the model; "reset" goes to it; a view the player has zoomed away from stays.
import { describe, expect, it } from 'vitest';
import type { PresetJson } from '@gsfpv/sim-core';
import { DRONE_IDS } from '../../../packages/prefs/src/defs/drone';
import { PRESETS } from '../../../packages/prefs/test/helpers';
import { buildFor } from '../../../apps/fly/src/drones3d/build';
import { modelOf } from '../../../apps/fly/src/drones3d/model';
import type { Model } from '../../../apps/fly/src/drones3d/model';
import { PAYLOAD_IDS } from '../../../apps/fly/src/drones3d/payloads';
import { DIST_MAX, DIST_MIN, HOME, Orbit, viewPosition } from '../../../apps/fly/src/drones3d/orbit';
import { FIT_MARGIN, FOV_DEG, fitDistance, targetOf } from '../../../apps/fly/src/drones3d/views';

const preset = (id: string): PresetJson => PRESETS.find((p) => p.id === id) as unknown as PresetJson;
const CINE = 'taurusx8-komodo-6s';
const ASPECTS = [16 / 10, 3 / 2, 2.2, 1];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The largest |ndc| of the model's vertices seen from a camera `dist` radii away at the home yaw and pitch, by a pinhole camera
 * built from the eye position (not from the helper under test): 1 is the edge of the frame.
 */
function farthestVertex(m: Model, aspect: number, dist: number): number {
    const t = targetOf(m);
    const eye = viewPosition({ yaw: HOME.yaw, pitch: HOME.pitch, dist }, 1, t);
    const f = norm(sub(t, eye));
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const tanV = Math.tan((FOV_DEG * Math.PI) / 360);
    const unit = 1 / m.radius;
    let worst = 0;
    for (const part of m.parts) {
        const pos = part.mesh.positions;
        for (let i = 0; i < pos.length; i += 3) {
            const v = sub([pos[i] * unit, pos[i + 1] * unit, pos[i + 2] * unit], eye);
            const z0 = dot(v, f);
            worst = Math.max(worst, Math.abs(dot(v, r) / z0 / (tanV * aspect)), Math.abs(dot(v, u) / z0 / tanV));
        }
    }
    return worst;
}

const models = (): { label: string; m: Model }[] => [
    ...DRONE_IDS.filter((id) => id !== CINE).map((id) => ({ label: id, m: modelOf(buildFor(preset(id))) })),
    ...PAYLOAD_IDS.map((p) => ({ label: `${CINE}/${p}`, m: modelOf(buildFor(preset(CINE), p)) }))
];

describe('the first view fits the model in the stage', () => {
    it('every model, every stage shape, every camera load: the whole model is inside the frame, and fills it', () => {
        for (const { label, m } of models()) {
            for (const a of ASPECTS) {
                const d = fitDistance(m, a, HOME.yaw, HOME.pitch);
                const w = farthestVertex(m, a, d);
                expect(w, `${label} @${a.toFixed(2)} (dist ${d.toFixed(2)})`).toBeLessThanOrEqual(1);
                // not a small model in a big stage: the farthest vertex is where the margin puts it
                expect(w, `${label} @${a.toFixed(2)} fills`).toBeGreaterThan(0.9 / FIT_MARGIN);
            }
        }
    });

    it('control: the first cut\'s fixed 2.25 radii clips the cinelifter in the 16:10 picker, and the same measure sees it', () => {
        const x8 = modelOf(buildFor(preset(CINE)));
        expect(HOME.dist).toBe(2.25);
        expect(farthestVertex(x8, 16 / 10, HOME.dist)).toBeGreaterThan(1);
        // ... and the fitted distance is a different (larger) one
        expect(fitDistance(x8, 16 / 10, HOME.yaw, HOME.pitch)).toBeGreaterThan(HOME.dist);
        // a measure that cannot fail is no measure: a camera far away has everything well inside
        expect(farthestVertex(x8, 16 / 10, 9)).toBeLessThan(0.5);
    });

    it('a model wider than tall needs less distance in a wider stage, and a taller one in a narrower stage needs more', () => {
        const x8 = modelOf(buildFor(preset(CINE)));
        const wide = fitDistance(x8, 2.2, HOME.yaw, HOME.pitch), narrow = fitDistance(x8, 1, HOME.yaw, HOME.pitch);
        expect(wide).not.toBeCloseTo(narrow, 2);
        // a stage of unknown shape (aspect 0) does not give NaN or a camera inside the model
        const odd = fitDistance(x8, 0, HOME.yaw, HOME.pitch);
        expect(Number.isFinite(odd)).toBe(true);
        expect(odd).toBeGreaterThan(1);
    });

    it('is one number per stage and model, within the turntable\'s zoom range', () => {
        for (const { label, m } of models()) for (const a of ASPECTS) {
            const d = fitDistance(m, a, HOME.yaw, HOME.pitch);
            expect(d, label).toBeGreaterThan(DIST_MIN);
            expect(d, label).toBeLessThan(DIST_MAX);
        }
    });
});

describe('Orbit home distance', () => {
    it('reset goes to the home the model asked for, not the first cut\'s', () => {
        const o = new Orbit();
        o.setHomeDist(3.1);
        expect(o.state.dist).toBe(3.1);
        o.zoom(-400);
        expect(o.state.dist).toBeLessThan(3.1);
        o.reset();
        for (let i = 0; i < 600; i++) o.tick(1 / 60);
        expect(o.state.dist).toBeCloseTo(3.1, 2);
    });

    it('a stage that changes shape moves a view still at home, and leaves a view the player zoomed away from', () => {
        const a = new Orbit();
        a.setHomeDist(2.6);
        a.setHomeDist(3.0);
        expect(a.state.dist).toBe(3.0);
        const b = new Orbit();
        b.setHomeDist(2.6);
        b.zoom(300);
        const zoomed = b.state.dist;
        b.setHomeDist(3.0);
        expect(b.state.dist).toBe(zoomed);
        // control: the zoomed view is not the old home
        expect(zoomed).not.toBeCloseTo(2.6, 2);
        // a home outside the zoom range is held inside it
        const c = new Orbit();
        c.setHomeDist(99);
        expect(c.home.dist).toBe(DIST_MAX);
    });

    it('the exported HOME constant is untouched by a model\'s distance', () => {
        const before = { ...HOME };
        new Orbit().setHomeDist(3.4);
        expect(HOME).toEqual(before);
    });
});

describe('reduced motion in the turntable', () => {
    it('with it on the model never turns by itself and the view a legend row asks for, or reset, is reached at once; with it off they ease', () => {
        const calm = new Orbit(), lively = new Orbit();
        calm.reduceMotion = true;
        for (const o of [calm, lively]) o.setHomeDist(3);
        const yaw0 = calm.state.yaw;
        for (let i = 0; i < 60 * 20; i++) { calm.tick(1 / 60); lively.tick(1 / 60); }
        expect(calm.state.yaw).toBe(yaw0);
        // control: the same wait turns the one that may move
        expect(lively.state.yaw).not.toBe(yaw0);
        // a view a legend row asks for: at once (calm), on its way (lively)
        calm.flyTo({ yaw: 120, pitch: 40, dist: 1.75 });
        lively.flyTo({ yaw: 120, pitch: 40, dist: 1.75 });
        expect(calm.state).toEqual({ yaw: 120, pitch: 40, dist: 1.75 });
        expect(calm.interacting).toBe(false);
        expect(lively.state.yaw).not.toBe(120);
        // reset goes to the home distance of the model
        calm.reset();
        expect(calm.state).toEqual({ yaw: HOME.yaw, pitch: HOME.pitch, dist: 3 });
    });
});
