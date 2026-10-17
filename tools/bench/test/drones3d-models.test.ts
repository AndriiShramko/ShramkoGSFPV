// The nine drone models (apps/fly/src/drones3d, v0.9 lane D) against the presets they are made from.
// Claims, each with a negative control that fails the same predicate:
//  - every preset has an equipment row, the table has no row without a preset, and the rows hold no number the preset
//    also holds (wheelbase, KV, cells, mAh, masses are read from the preset);
//  - every model is a set of valid meshes with known materials, resting on y = 0, and its propellers are on the preset's
//    wheelbase diagonal with the preset's prop diameter (control: the same model checked against a wheelbase 12 % off
//    fails the predicate);
//  - each model carries the pins its callouts need, inside its bounds;
//  - the cinelifter shows the camera the preset assumes (RED Komodo) by default, another when chosen, and none when
//    none: the parts differ and the Komodo's body is the maker's 4 x 4 x 4 in; its body stays out of the front
//    propeller discs;
//  - the equipment table cites its sources: every row has a basis, and every non-typical fact a link.
import { describe, expect, it } from 'vitest';
import type { PresetJson } from '@gsfpv/sim-core';
import { DRONE_IDS } from '../../../packages/prefs/src/defs/drone';
import { PRESETS } from '../../../packages/prefs/test/helpers';
import { buildFor, packDims } from '../../../apps/fly/src/drones3d/build';
import { EQUIPMENT } from '../../../apps/fly/src/drones3d/equipment';
import { MATERIALS } from '../../../apps/fly/src/drones3d/materials';
import { boundsOf, merge, problemsOf, triangleCount } from '../../../apps/fly/src/drones3d/mesh';
import { modelOf } from '../../../apps/fly/src/drones3d/model';
import type { Model } from '../../../apps/fly/src/drones3d/model';
import { PAYLOAD_IDS, PAYLOADS } from '../../../apps/fly/src/drones3d/payloads';

const preset = (id: string): PresetJson => PRESETS.find((p) => p.id === id) as unknown as PresetJson;
const num = (id: string, key: string): number => preset(id).fields[key].value as number;

/** centre of the vertices of every part called `name` as its own mesh: [cx, cz, maxRadiusFromItsCentre] */
function propDiscs(m: Model): { cx: number; cz: number; r: number; y: number }[] {
    return m.parts.filter((p) => p.name === 'prop').map((p) => {
        const xs = p.mesh.positions.filter((_, i) => i % 3 === 0), zs = p.mesh.positions.filter((_, i) => i % 3 === 2), ys = p.mesh.positions.filter((_, i) => i % 3 === 1);
        // the hub is at the disc centre: the vertices of the blade roots are the symmetric centre of the mesh
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
        // three or more blades are not symmetric about the box centre: take the mean of all vertices instead
        const mx = xs.reduce((s, v) => s + v, 0) / xs.length, mz = zs.reduce((s, v) => s + v, 0) / zs.length;
        void cx; void cz;
        let r = 0;
        for (let i = 0; i < xs.length; i++) r = Math.max(r, Math.hypot(xs[i] - mx, zs[i] - mz));
        return { cx: mx, cz: mz, r, y: ys.reduce((s, v) => s + v, 0) / ys.length };
    });
}

/** the prop centres of the discs at one height, as the four corners of the X: the longest corner-to-corner distance */
function diagonalMm(m: Model): number {
    const d = propDiscs(m);
    // the upper (or only) layer
    const top = Math.max(...d.map((q) => q.y));
    const layer = d.filter((q) => Math.abs(q.y - top) < 1);
    let best = 0;
    for (const a of layer) for (const c of layer) best = Math.max(best, Math.hypot(a.cx - c.cx, a.cz - c.cz));
    return best;
}

describe('equipment table', () => {
    it('has a row for every drone preset and no row without one', () => {
        expect(Object.keys(EQUIPMENT).sort()).toEqual([...DRONE_IDS].sort());
        expect(PRESETS.map((p) => p.id).sort()).toEqual([...DRONE_IDS].sort());
    });
    it('every fact has a basis and every maker or listing fact a link', () => {
        for (const [id, e] of Object.entries(EQUIPMENT)) {
            for (const [what, f] of Object.entries({ frame: e.frame, motor: e.motor, prop: e.prop, battery: e.battery, video: e.video })) {
                expect(['maker', 'listing', 'typical'], `${id} ${what}`).toContain(f.basis);
                if (f.basis !== 'typical') expect(f.ref, `${id} ${what} has no link`).toMatch(/^https:\/\//);
            }
        }
    });
    it('a stator size is the name\'s: 2207 is 22 x 7, 1104 is 11 x 4, 3110 is 31 x 10', () => {
        const digits = (name: string): [number, number] => { const m = name.match(/(\d{2})(\d{2})(?!\d)/); return [Number(m?.[1]), Number(m?.[2])]; };
        for (const [id, e] of Object.entries(EQUIPMENT)) expect(e.motor.stator, id).toEqual(digits(e.motor.name));
    });
    it('holds no number the preset holds: a prop diameter only where the preset has none', () => {
        for (const [id, e] of Object.entries(EQUIPMENT)) {
            const has = preset(id).fields.prop_diameter_mm?.value;
            if (has !== undefined) expect(e.prop.diameterMm, `${id} repeats the preset's prop diameter`).toBeUndefined();
            else expect(e.prop.diameterMm, `${id} has no prop diameter anywhere`).toBeGreaterThan(20);
        }
    });
    it('the build reads wheelbase, KV, cells and mAh from the preset', () => {
        for (const id of DRONE_IDS) {
            const b = buildFor(preset(id));
            expect(b.wheelbaseMm).toBe(num(id, 'wheelbase_mm'));
            expect(b.motorKv).toBe(num(id, 'motor_kv'));
            expect(b.cells).toBe(num(id, 'battery_cells'));
            expect(b.mah).toBe(num(id, 'battery_capacity_mah'));
            expect(b.auwG).toBe(num(id, 'auw_g'));
        }
    });
    it('a pack of the Pavo20 Pro\'s capacity is 20 mm wide, the maker\'s battery slot (typical sizing check)', () => {
        const d = packDims(3, 550, 'cinewhoop');
        expect(d.w).toBeGreaterThan(19);
        expect(d.w).toBeLessThan(22);
    });
});

describe.each(DRONE_IDS.map((id) => [id]))('model of %s', (id) => {
    const build = buildFor(preset(id));
    const model = modelOf(build);

    it('is made of valid meshes with known materials', () => {
        expect(model.parts.length).toBeGreaterThan(30);
        for (const p of model.parts) {
            expect(problemsOf(p.mesh, `${id}/${p.name}`)).toEqual([]);
            expect(MATERIALS[p.material], `${id}/${p.name} material ${p.material}`).toBeDefined();
        }
        const tris = model.parts.reduce((s, p) => s + triangleCount(p.mesh), 0);
        expect(tris).toBeGreaterThan(3000);
        expect(tris).toBeLessThan(400000);
    });

    it('rests on y = 0 and is centred', () => {
        const b = boundsOf(merge(model.parts.map((p) => p.mesh)));
        expect(b.min[1]).toBeCloseTo(0, 6);
        expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 5);
        expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 5);
        expect(model.radius).toBeGreaterThan(b.max[0] - b.min[0] > 0 ? 20 : 0);
    });

    it('has its propellers on the preset\'s wheelbase diagonal and the preset\'s prop diameter', () => {
        const wb = num(id, 'wheelbase_mm');
        const within = (measured: number, expected: number, tol: number): boolean => Math.abs(measured - expected) <= tol;
        expect(propDiscs(model).length).toBe(id === 'taurusx8-komodo-6s' ? 8 : 4);
        expect(within(diagonalMm(model), wb, 0.6)).toBe(true);
        // control: against a wheelbase 12 % off the same model fails the predicate
        expect(within(diagonalMm(model), wb * 1.12, 0.6)).toBe(false);
        const want = (build.propDiameterMm) / 2;
        for (const d of propDiscs(model)) expect(Math.abs(d.r - want)).toBeLessThan(want * 0.04 + 0.6);
    });

    it('carries the pins its callouts need, inside the bounds', () => {
        const ids = new Set(model.anchors.map((a) => a.id));
        for (const need of ['motors', 'props', 'battery', 'camera', 'frame']) expect(ids.has(need as never), `${id} lacks the ${need} pin`).toBe(true);
        if (build.equipment.video.kind === 'analog') expect(ids.has('vtx')).toBe(true);
        const bb = model.bounds, m = 25;
        for (const a of model.anchors) {
            for (let i = 0; i < 3; i++) {
                expect(a.at[i], `${id} ${a.id} axis ${i}`).toBeGreaterThan(bb.min[i] - m);
                expect(a.at[i], `${id} ${a.id} axis ${i}`).toBeLessThan(bb.max[i] + m);
            }
        }
    });
});

describe('the cinelifter\'s camera', () => {
    const id = 'taurusx8-komodo-6s';
    const names = (m: Model): string[] => [...new Set(m.parts.map((p) => p.name))];
    it('is the RED Komodo the preset assumes, by default', () => {
        const b = buildFor(preset(id));
        expect(b.payload).toBe('komodo');
        const m = modelOf(b);
        expect(names(m)).toContain('komodo-body');
        expect(m.anchors.some((a) => a.id === 'payload')).toBe(true);
        // the preset's own camera load is the Komodo option's load: nothing changes by default
        expect(PAYLOADS.komodo.loadG).toBe(num(id, 'payload_g'));
    });
    it('the Komodo body is 4 x 4 x 4 inches (101.6 mm)', () => {
        const body = modelOf(buildFor(preset(id), 'komodo')).parts.find((p) => p.name === 'komodo-body');
        const bb = boundsOf(body!.mesh);
        for (let i = 0; i < 3; i++) expect(bb.max[i] - bb.min[i]).toBeCloseTo(101.6, 3);
    });
    it('each choice draws its own camera and the others\' are absent', () => {
        const want: Record<string, string> = { komodo: 'komodo-body', bmpcc6kpro: 'bmpcc-body', gopro13: 'gopro-body' };
        for (const choice of PAYLOAD_IDS) {
            const n = names(modelOf(buildFor(preset(id), choice)));
            for (const [c, part] of Object.entries(want)) expect(n.includes(part), `${choice} vs ${c}`).toBe(c === choice);
        }
        // control: the default and "none" are different models
        expect(modelOf(buildFor(preset(id), 'none')).parts.length).toBeLessThan(modelOf(buildFor(preset(id))).parts.length);
    });
    it('the camera body stays out of the front propeller discs (only the round lens passes between them)', () => {
        for (const choice of ['komodo'] as const) {
            const m = modelOf(buildFor(preset(id), choice));
            const body = m.parts.find((p) => p.name === 'komodo-body')!;
            const discs = propDiscs(m);
            const bb = boundsOf(body.mesh);
            for (const d of discs) {
                // nearest point of the body's footprint to the disc centre
                const nx = Math.max(bb.min[0], Math.min(bb.max[0], d.cx)), nz = Math.max(bb.min[2], Math.min(bb.max[2], d.cz));
                expect(Math.hypot(nx - d.cx, nz - d.cz), `disc at ${d.cx.toFixed(0)},${d.cz.toFixed(0)}`).toBeGreaterThan(d.r - 0.5);
            }
        }
    });
    it('only the cinelifter has a camera choice', () => {
        for (const other of DRONE_IDS.filter((x) => x !== id)) expect(buildFor(preset(other)).payload).toBeNull();
    });
});
