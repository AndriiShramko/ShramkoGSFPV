// A8 (record, not a gate): how close the Pavo20 Pro compound body gets to surfaces on the
// official voxel collision, compared with the ideal (the body's own extent towards the surface),
// and with single spheres of the component radii.
import { VoxelContactWorld } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { spherePoses } from '@gsfpv/sim-core';
import { loadScene } from './scenes';
import { params } from './presets';
import { writeEvidence, updateLatest } from './evidence';

function fib(n: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        out.push([Math.cos(phi * i) * r, y, Math.sin(phi * i) * r]);
    }
    return out;
}

const pct = (a: number[], q: number) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

interface Body { local: Float64Array; r: Float64Array; n: number }

/** Approach along d from `from` until the body touches; returns centre-to-surface clearance and ideal. */
function approach(col: VoxelCollision, world: VoxelContactWorld, body: Body, sp: Float64Array, from: number[], d: [number, number, number]): { clearance: number; ideal: number } | null {
    const hit = col.queryRay(from[0], from[1], from[2], d[0], d[1], d[2], 8);
    if (!hit) return null;
    const dist = Math.hypot(hit.x - from[0], hit.y - from[1], hit.z - from[2]);
    // body level, nose along the horizontal part of d (vertical approaches keep heading 0)
    const hz = Math.hypot(d[0], d[2]);
    const yaw = hz > 0.2 ? Math.atan2(d[0], -d[2]) : 0;
    const h = -yaw / 2;
    const qw = Math.cos(h), qy = Math.sin(h);
    const c0 = new Float64Array(body.n * 3), c1 = new Float64Array(body.n * 3);
    spherePoses(sp, body.n, from[0], from[1], from[2], qw, 0, qy, 0, c0);
    spherePoses(sp, body.n, hit.x, hit.y, hit.z, qw, 0, qy, 0, c1);
    const pad = new Float64Array(body.n);
    const out = { sphere: -1, nx: 0, ny: 0, nz: 0 };
    // start must be free
    for (let i = 0; i < body.n; i++) if (world.overlap(c0[i * 3], c0[i * 3 + 1], c0[i * 3 + 2], body.r[i])) return null;
    const t = world.sweep(c0, c1, body.r, pad, body.n, out);
    if (t < 0) return null;
    const clearance = dist * (1 - t);
    // ideal: the body's support distance towards the surface = max_i (l_i . d_world + r_i)
    let ideal = 0;
    for (let i = 0; i < body.n; i++) {
        const lx = c0[i * 3] - from[0], ly = c0[i * 3 + 1] - from[1], lz = c0[i * 3 + 2] - from[2];
        ideal = Math.max(ideal, lx * d[0] + ly * d[1] + lz * d[2] + body.r[i]);
    }
    return { clearance, ideal };
}

const p = params('pavo20pro-3s');
const nS = p.spheres.length / 4;
const compound: Body = { local: new Float64Array(nS * 3), r: new Float64Array(nS), n: nS };
for (let i = 0; i < nS; i++) { compound.local.set(p.spheres.subarray(i * 4, i * 4 + 3), i * 3); compound.r[i] = p.spheres[i * 4 + 3]; }
const single = (r: number): { body: Body; sp: Float64Array } => ({ body: { local: new Float64Array(3), r: new Float64Array([r]), n: 1 }, sp: new Float64Array([0, 0, 0, r]) });

const bodies: { name: string; body: Body; sp: Float64Array }[] = [
    { name: 'pavo20pro compound (4 ducts r30 + body r25)', body: compound, sp: p.spheres },
    { name: 'single sphere r25 mm (body)', ...single(0.025) },
    { name: 'single sphere r30 mm (duct)', ...single(0.03) },
    { name: `single sphere r${Math.round(p.boundRadius * 1000)} mm (bounding)`, ...single(p.boundRadius) }
];

const results: Record<string, unknown>[] = [];
// A8_SCENES / A8_EVIDENCE: run on other collision (phase C: baked in the browser) without touching the site numbers
const A8_SCENES = (process.env.A8_SCENES || '39e63ce9,887f27aa,7a475d38').split(',');
const A8_EVIDENCE = process.env.A8_EVIDENCE || '';
for (const id of A8_SCENES) {
    const sc = await loadScene(id);
    const world = new VoxelContactWorld(sc.collision);
    const starts = [sc.settings.position, ...sc.settings.extra].slice(0, 12);
    for (const b of bodies) {
        const cl: number[] = [];
        const ex: number[] = [];
        for (const s of starts) {
            for (const d of fib(200)) {
                const r = approach(sc.collision, world, b.body, b.sp, s, d);
                if (!r) continue;
                cl.push(r.clearance);
                ex.push(r.clearance - r.ideal);
            }
        }
        results.push({
            scene: id, voxel: sc.metadata.voxelResolution, body: b.name, samples: cl.length,
            clearanceMedianMm: +(pct(cl, 0.5) * 1000).toFixed(1), clearanceP95Mm: +(pct(cl, 0.95) * 1000).toFixed(1),
            excessMedianMm: +(pct(ex, 0.5) * 1000).toFixed(1), excessP95Mm: +(pct(ex, 0.95) * 1000).toFixed(1)
        });
    }
}
const file = writeEvidence(A8_EVIDENCE || 'a8-clearance', {
    pass: true,
    gate: false,
    method: 'from authored camera positions, 200 Fibonacci directions: ray to the surface, then our swept test approaches with the body level and nose-first; clearance = centre-to-surface distance at first contact; ideal = the body extent towards the surface; excess = clearance - ideal',
    results
});
const pavo = results.find((r) => r.scene === '39e63ce9' && String(r.body).startsWith('pavo20pro')) as Record<string, number>;
if (!A8_EVIDENCE && pavo) updateLatest('clearance', { value: `Pavo20 Pro body stops ${pavo.excessMedianMm} mm (median) beyond its own size from walls on the 5 cm voxel collision of scene 39e63ce9`, method: 'swept approach along 200 directions from 12 points', date: new Date().toISOString().slice(0, 10) });
console.table(results);
console.log('->', file);
