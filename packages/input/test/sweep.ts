// Acceptance sweep for the calibration wizard (not part of vitest; several CPU-minutes).
// Every simulated person (seeds 1..n) sets up all 24 channel orders, stick inversions drawn per run
// (p = 0.5 per stick), at the person's own report rate. Then the first --head runs go through the
// frozen first wizard as the negative control.
//
//   pnpm exec tsx packages/input/test/sweep.ts --n 500 --head 1000 [--jobs 8]
//
// Writes .cache/radio-ux/sweep-new.json and sweep-head.json (summary + every non-correct run).
// Person-model caveat: the people are a model (sim/human.ts), not measured humans.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Outcome } from '../src/sim/human';
import { TUNING } from '../src/calib';
import { invText, runHead, runNew, sweepHuman } from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', '.cache', 'radio-ux');

function arg(name: string, def: number): number {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
}

interface Run { i: number; seed: number; order: string; inv: string; rateHz: number; gamepad: boolean; arm: string; o: Outcome }

function runRange(from: number, to: number, head: boolean): Run[] {
    const out: Run[] = [];
    for (let i = from; i < to; i++) {
        const cfg = sweepHuman(i);
        const o = head ? runHead(cfg, 120000) : runNew(cfg, 180000);
        out.push({ i, seed: cfg.seed, order: cfg.order, inv: invText(cfg.inv), rateHz: cfg.rateHz, gamepad: cfg.gamepadLike, arm: cfg.arm, o });
        if (!process.argv.includes('--child') && (i + 1) % 1000 === 0) console.log(`  ${head ? 'head' : 'new'}: ${i + 1} runs`);
    }
    return out;
}

function q(sorted: number[], f: number): number {
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] : NaN;
}

function summarise(runs: Run[], label: string): Record<string, unknown> {
    const kinds = { correct: 0, wrong: 0, hang: 0 };
    const ms: number[] = [];
    const phase: Record<string, number[]> = {};
    const hints: Record<string, number> = {};
    const escapes: Record<string, number> = {};
    const problems: Record<string, number> = {};
    for (const r of runs) {
        kinds[r.o.kind]++;
        ms.push(r.o.ms);
        for (const [k, v] of Object.entries(r.o.phaseMs)) (phase[k] ??= []).push(v);
        for (const h of new Set(r.o.hints)) hints[h] = (hints[h] ?? 0) + 1;
        for (const e of r.o.escapes) if (e !== 'fly') escapes[e] = (escapes[e] ?? 0) + 1;
        for (const p of r.o.problems) { const k = p.replace(/[-\d.]+/g, '#').replace(/\{.*\}/, '{..}'); problems[k] = (problems[k] ?? 0) + 1; }
    }
    ms.sort((a, b) => a - b);
    const phases: Record<string, { n: number; p50: number; p95: number; max: number }> = {};
    let maxPhase = 0, maxPhaseName = '';
    for (const [k, v] of Object.entries(phase)) {
        v.sort((a, b) => a - b);
        phases[k] = { n: v.length, p50: Math.round(q(v, 0.5)), p95: Math.round(q(v, 0.95)), max: Math.round(v[v.length - 1]) };
        if (v[v.length - 1] > maxPhase && k !== 'check') { maxPhase = v[v.length - 1]; maxPhaseName = k; }
    }
    return {
        label, runs: runs.length, ...kinds,
        badShare: (kinds.wrong + kinds.hang) / Math.max(1, runs.length),
        runMs: { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(ms[ms.length - 1] ?? NaN) },
        longestPhase: { name: maxPhaseName, ms: Math.round(maxPhase) },
        phases, hintsShownInRuns: hints, escapesUsed: escapes, problems
    };
}

async function inChildren(total: number, jobs: number, head: boolean): Promise<Run[]> {
    const per = Math.ceil(total / jobs);
    const parts: Promise<Run[]>[] = [];
    for (let j = 0; j < jobs; j++) {
        const from = j * per, to = Math.min(total, from + per);
        if (from >= to) break;
        parts.push(new Promise((resolve, reject) => {
            const p = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--child', '--from', String(from), '--to', String(to), ...(head ? ['--headrun'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
            let buf = '';
            p.stdout.on('data', (d) => { buf += d; });
            p.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf) as Run[]) : reject(new Error(`child ${j} exit ${code}`))));
        }));
    }
    let done = 0;
    const out: Run[] = [];
    for (const r of await Promise.all(parts.map((p) => p.then((x) => { done += x.length; console.log(`  ${head ? 'head' : 'new'}: ${done}/${total} runs`); return x; })))) out.push(...r);
    return out.sort((a, b) => a.i - b.i);
}

async function main(): Promise<void> {
    if (process.argv.includes('--child')) {
        process.stdout.write(JSON.stringify(runRange(arg('from', 0), arg('to', 0), process.argv.includes('--headrun'))));
        return;
    }
    const n = arg('n', 500);
    const headN = arg('head', 1000);
    const jobs = arg('jobs', 1);
    const total = n * 24;
    console.log(`TUNING ${JSON.stringify(TUNING)}`);
    console.log(`new wizard: ${n} people x 24 orders = ${total} runs, ${jobs} job(s)`);
    const t0 = Date.now();
    const runs = jobs > 1 ? await inChildren(total, jobs, false) : runRange(0, total, false);
    const sNew = summarise(runs, 'new wizard');
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
    const t1 = Date.now();
    const headRuns = headN > 0 ? (jobs > 1 ? await inChildren(headN, jobs, true) : runRange(0, headN, true)) : [];
    const sHead = summarise(headRuns, 'first wizard (frozen ce4b8d2), negative control');
    console.log(`  ${((Date.now() - t1) / 1000).toFixed(0)} s wall`);
    mkdirSync(OUT, { recursive: true });
    const note = 'People are the model in packages/input/src/sim/human.ts, not measured humans; thresholds are not measured on a real radio.';
    writeFileSync(join(OUT, 'sweep-new.json'), JSON.stringify({ note, tuning: TUNING, summary: sNew, bad: runs.filter((r) => r.o.kind !== 'correct') }, null, 1));
    writeFileSync(join(OUT, 'sweep-head.json'), JSON.stringify({ note, summary: sHead, bad: headRuns.filter((r) => r.o.kind !== 'correct').slice(0, 300) }, null, 1));
    const pr = (s: Record<string, unknown>) => console.log(JSON.stringify(s, null, 1));
    pr(sNew);
    pr({ label: sHead.label, runs: sHead.runs, correct: sHead.correct, wrong: sHead.wrong, hang: sHead.hang, badShare: sHead.badShare, problems: sHead.problems });
    const okNew = sNew.correct === total && (sNew.runMs as { max: number }).max <= 120000 && (sNew.runMs as { p95: number }).p95 <= 60000 && (sNew.longestPhase as { ms: number }).ms <= 30000;
    const okHead = headRuns.length === 0 || (sHead.badShare as number) >= 0.5;
    console.log(`ACCEPT new wizard: ${okNew ? 'PASS' : 'FAIL'} (all correct, max <= 120 s, p95 <= 60 s, no phase > 30 s)`);
    console.log(`ACCEPT negative control (first wizard hang + wrong >= 50 %): ${okHead ? 'PASS' : 'FAIL'}`);
    if (!okNew || !okHead) process.exitCode = 1;
}

await main();
