// Evidence runner: `tsx tools/bench/src/run.ts a2 a3 a4 ...` writes evidence/<date>/<name>.json
import { writeEvidence, updateLatest } from './evidence';

const which = process.argv.slice(2);
const all = which.length === 0;
let failed = false;

async function step(key: string, name: string, fn: () => Promise<Record<string, unknown>> | Record<string, unknown>) {
    if (!all && !which.includes(key)) return;
    const t0 = Date.now();
    const res = await fn();
    const file = writeEvidence(name, { ...res, runtimeMs: Date.now() - t0 });
    console.log(`${key}: ${res.pass ? 'PASS' : 'FAIL'} -> ${file}`);
    if (!res.pass) failed = true;
    return res;
}

const a2 = await step('a2', 'a2-collision-formats', async () => (await import('./a2-a3')).runA2());
const a3 = await step('a3', 'a3-rates-vectors', async () => (await import('./a2-a3')).runA3());
if (a3) updateLatest('ratesVectors', { value: `${a3.points} points, max error ${a3.maxAbsErrorDegPerS} deg/s`, method: 'compiled Betaflight 4.5.1 rate functions vs our re-implementation', date: new Date().toISOString().slice(0, 10) });
const a4 = await step('a4', 'a4-physics', async () => (await import('./a4-physics')).runA4());
void a2; void a4;
if (failed) process.exitCode = 1;
