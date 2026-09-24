// A5 driver: bundles the worker, fans (scene, speed) jobs out over worker threads, writes evidence.
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { hoverSolve } from '@gsfpv/sim-core';
import { params } from './presets';
import { REPO, writeEvidence, updateLatest } from './evidence';

const PASSES = Number(process.env.A5_PASSES || 10000);
const SCENES = (process.env.A5_SCENES || '39e63ce9,887f27aa,7a475d38,wall-2cm').split(',');

/** Top level-flight speed at full throttle (fresh pack): T cos(th) = m g, T sin(th) = drag(v, th). */
function vMax(): { vMax: number; tiltDeg: number } {
    const p = params('pavo20pro-3s');
    void hoverSolve;
    const T = 4 * p.tmaxMotorNom; // at V_nom, which is the full-throttle loaded voltage of a fresh pack
    const th = Math.acos((p.mass * p.gravity) / T);
    const cdaEff = p.cda[0] * Math.cos(th) ** 2 + p.cda[1] * Math.sin(th) ** 2;
    return { vMax: Math.sqrt((T * Math.sin(th)) / (0.5 * p.rho * cdaEff)), tiltDeg: (th * 180) / Math.PI };
}

const vm = vMax();
const speeds = [5, 10, 15, 25, Math.round(1.2 * vm.vMax * 100) / 100];
const p = params('pavo20pro-3s');
const n = p.spheres.length / 4;
const body = { local: [] as number[], r: [] as number[] };
for (let i = 0; i < n; i++) {
    body.local.push(p.spheres[i * 4], p.spheres[i * 4 + 1], p.spheres[i * 4 + 2]);
    body.r.push(p.spheres[i * 4 + 3]);
}

const outfile = join(REPO, '.cache', 'a5-worker.mjs');
await build({ entryPoints: [join(REPO, 'tools', 'bench', 'src', 'a5-worker.ts')], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error' });

const jobs: { scene: string; speed: number; passes: number; seed: number; body: typeof body }[] = [];
let seed = 20260924;
for (const scene of SCENES) for (const speed of speeds) jobs.push({ scene, speed, passes: PASSES, seed: seed++, body });

const poolSize = Math.min(jobs.length, Math.max(1, Math.min(24, cpus().length - 4)));
const t0 = Date.now();
const results: Record<string, unknown>[] = [];
let next = 0;
await new Promise<void>((resolve, reject) => {
    let running = 0;
    const launch = () => {
        while (running < poolSize && next < jobs.length) {
            const job = jobs[next++];
            running++;
            const w = new Worker(outfile, { workerData: job });
            w.on('message', (m) => {
                if (m.error) { reject(new Error(`${job.scene}@${job.speed}: ${m.error}`)); return; }
                results.push({ scene: job.scene, speed: job.speed, seed: job.seed, ...m });
                console.log(`${job.scene} @ ${job.speed} m/s: passes ${m.passes}, contacts ${m.contacts}, penetrations ${m.penetrations}, tunnels@30 ${m.ctl30.tunnel}, tunnels@144 ${m.ctl144.tunnel}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
                running--;
                w.terminate();
                if (results.length === jobs.length) resolve(); else launch();
            });
            w.on('error', reject);
        }
    };
    launch();
});

results.sort((a, b) => String(a.scene).localeCompare(String(b.scene)) || (a.speed as number) - (b.speed as number));
const totalPen = results.reduce((s, r) => s + (r.penetrations as number), 0);
const totalPasses = results.reduce((s, r) => s + (r.passes as number), 0);
const tun30 = results.reduce((s, r) => s + (r.ctl30 as { tunnel: number }).tunnel, 0);
const tun144 = results.reduce((s, r) => s + (r.ctl144 as { tunnel: number }).tunnel, 0);
const minPasses = Math.min(...results.map((r) => r.passes as number));
const pass = totalPen === 0 && tun30 >= 1 && tun144 >= 1 && minPasses >= 10000;
const file = writeEvidence('a5-tunnelling', {
    pass,
    body: { preset: 'pavo20pro-3s', spheres: body },
    vMax: vm,
    speeds,
    passesPerSceneSpeed: PASSES,
    totalPasses,
    totalPenetrations: totalPen,
    oracle: 'upstream VoxelCollision.querySphere on every body sphere, path resampled every voxelResolution/4 from the start to the point where our sweep stopped the body (no sweep code involved)',
    sweep: 'sim tick 1 ms; per tick: cover test r + L/2, then segments of r/2 bisected to 0.25 mm leaves with r + half-length inflation',
    control: { name: 'endpoint-only test at frame steps 1/30 s and 1/144 s must miss at least one collision (tunnel)', tunnels30: tun30, tunnels144: tun144, fired: tun30 >= 1 && tun144 >= 1 },
    results,
    wallClockS: (Date.now() - t0) / 1000,
    workers: poolSize
});
console.log(`A5 ${pass ? 'PASS' : 'FAIL'}: ${totalPasses} passes, ${totalPen} penetrations, control tunnels ${tun30}/${tun144} -> ${file}`);
if (pass) updateLatest('tunnelling', { value: `0 wall pass-throughs in ${totalPasses.toLocaleString('en-US')} straight passes`, method: `swept test at 1 ms ticks vs independent resampling oracle; speeds ${speeds.join(', ')} m/s; 3 real scans + 2 cm synthetic wall`, date: new Date().toISOString().slice(0, 10) });
if (!pass) process.exitCode = 1;
