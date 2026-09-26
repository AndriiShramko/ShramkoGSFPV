// Acceptance sweep for the calibration wizard (not part of vitest; several CPU-minutes).
// Every simulated person (seeds 1..n) sets up all 24 channel orders, stick inversions drawn per run
// (p = 0.5 per stick), at the person's own report rate, pressing the buttons like a person. Every
// run is watched for screen changes without a button (the command invariant of wizard v3). Then
// the first --head runs go through the frozen first wizard and the first --v2 runs through the
// frozen v2 as negative controls. --slow: the slow people instead (every reaction and press 3..15 s).
//
//   pnpm exec tsx packages/input/test/sweep.ts --n 500 --head 1000 --v2 1000 [--jobs 8] [--slow]
//
// Writes .cache/radio-ux/sweep-new.json (sweep-new-slow.json), sweep-head.json and sweep-v2.json
// (summary + every run that is not correct). Person-model caveat: the people are a model
// (sim/human.ts), not measured humans.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Outcome } from '../src/sim/human';
import { TUNING } from '../src/calib';
import { invText, runHead, runNew, runV2, sweepHuman, v2FrameChange, v3FrameChange, Watch } from './helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', '.cache', 'radio-ux');

function arg(name: string, def: number): number {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
}

type Which = 'new' | 'head' | 'v2';
interface Run { i: number; seed: number; order: string; inv: string; rateHz: number; gamepad: boolean; arm: string; o: Outcome; unpaced: string[] }

function runRange(from: number, to: number, which: Which): Run[] {
    const out: Run[] = [];
    const slow = process.argv.includes('--slow') && which === 'new';
    for (let i = from; i < to; i++) {
        const cfg = sweepHuman(i);
        if (slow) { cfg.rateHz = Math.min(cfg.rateHz, 250); cfg.slow = { lo: 3000, hi: 15000 }; }
        const watch = new Watch(which === 'v2' ? v2FrameChange : v3FrameChange);
        const o = which === 'head' ? runHead(cfg, 120000) : which === 'v2' ? runV2(cfg, 180000, watch) : runNew(cfg, slow ? 900000 : 180000, watch);
        out.push({ i, seed: cfg.seed, order: cfg.order, inv: invText(cfg.inv), rateHz: cfg.rateHz, gamepad: cfg.gamepadLike, arm: cfg.arm, o, unpaced: watch.violations.slice(0, 5) });
        if (!process.argv.includes('--child') && (i + 1) % 1000 === 0) console.log(`  ${which}: ${i + 1} runs`);
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
    let unpaced = 0;
    for (const r of runs) {
        kinds[r.o.kind]++;
        if (r.unpaced.length) unpaced++;
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
        label, runs: runs.length, ...kinds, runsWithScreenChangesWithoutAButton: unpaced,
        badShare: (kinds.wrong + kinds.hang) / Math.max(1, runs.length),
        runMs: { p50: Math.round(q(ms, 0.5)), p95: Math.round(q(ms, 0.95)), max: Math.round(ms[ms.length - 1] ?? NaN) },
        longestPhase: { name: maxPhaseName, ms: Math.round(maxPhase) },
        phases, hintsShownInRuns: hints, buttonsPressed: escapes, problems
    };
}

async function inChildren(total: number, jobs: number, which: Which): Promise<Run[]> {
    const per = Math.ceil(total / jobs);
    const parts: Promise<Run[]>[] = [];
    for (let j = 0; j < jobs; j++) {
        const from = j * per, to = Math.min(total, from + per);
        if (from >= to) break;
        parts.push(new Promise((resolve, reject) => {
            const args = [...process.execArgv, fileURLToPath(import.meta.url), '--child', '--from', String(from), '--to', String(to), '--which', which];
            if (process.argv.includes('--slow')) args.push('--slow');
            const p = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
            let buf = '';
            p.stdout.on('data', (d) => { buf += d; });
            p.on('close', (code) => (code === 0 ? resolve(JSON.parse(buf) as Run[]) : reject(new Error(`child ${j} exit ${code}`))));
        }));
    }
    let done = 0;
    const out: Run[] = [];
    for (const r of await Promise.all(parts.map((p) => p.then((x) => { done += x.length; console.log(`  ${which}: ${done}/${total} runs`); return x; })))) out.push(...r);
    return out.sort((a, b) => a.i - b.i);
}

async function main(): Promise<void> {
    if (process.argv.includes('--child')) {
        const wi = process.argv.indexOf('--which');
        const which = (wi >= 0 ? process.argv[wi + 1] : 'new') as Which;
        process.stdout.write(JSON.stringify(runRange(arg('from', 0), arg('to', 0), which)));
        return;
    }
    const n = arg('n', 500);
    const headN = arg('head', 1000);
    const v2N = arg('v2', 0);
    const jobs = arg('jobs', 1);
    const slow = process.argv.includes('--slow');
    const total = n * 24;
    console.log(`TUNING ${JSON.stringify(TUNING)}`);
    console.log(`new wizard${slow ? ' (slow people)' : ''}: ${n} people x 24 orders = ${total} runs, ${jobs} job(s)`);
    const run = (count: number, which: Which): Promise<Run[]> =>
        count <= 0 ? Promise.resolve([]) : jobs > 1 ? inChildren(count, jobs, which) : Promise.resolve(runRange(0, count, which));
    const t0 = Date.now();
    const runs = await run(total, 'new');
    const sNew = summarise(runs, slow ? 'new wizard, slow people' : 'new wizard');
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
    const headRuns = await run(headN, 'head');
    const sHead = summarise(headRuns, 'first wizard (frozen ce4b8d2), negative control');
    const v2Runs = await run(v2N, 'v2');
    const sV2 = summarise(v2Runs, 'wizard v2 (frozen 60fa9de), negative control');
    mkdirSync(OUT, { recursive: true });
    const note = 'People are the model in packages/input/src/sim/human.ts, not measured humans; thresholds are not measured on a real radio.';
    writeFileSync(join(OUT, slow ? 'sweep-new-slow.json' : 'sweep-new.json'), JSON.stringify({ note, tuning: TUNING, summary: sNew, bad: runs.filter((r) => r.o.kind !== 'correct' || r.unpaced.length) }, null, 1));
    if (headRuns.length) writeFileSync(join(OUT, 'sweep-head.json'), JSON.stringify({ note, summary: sHead, bad: headRuns.filter((r) => r.o.kind !== 'correct').slice(0, 300) }, null, 1));
    if (v2Runs.length) writeFileSync(join(OUT, 'sweep-v2.json'), JSON.stringify({ note, summary: sV2, bad: v2Runs.filter((r) => r.o.kind !== 'correct' || r.unpaced.length).slice(0, 300) }, null, 1));
    const pr = (s: Record<string, unknown>) => console.log(JSON.stringify(s, null, 1));
    pr(sNew);
    const brief = (s: Record<string, unknown>) => ({ label: s.label, runs: s.runs, correct: s.correct, wrong: s.wrong, hang: s.hang, badShare: s.badShare, runsWithScreenChangesWithoutAButton: s.runsWithScreenChangesWithoutAButton, problems: s.problems });
    if (headRuns.length) pr(brief(sHead));
    if (v2Runs.length) pr(brief(sV2));
    const maxRun = slow ? 900000 : 180000;
    const okNew = sNew.correct === total && sNew.runsWithScreenChangesWithoutAButton === 0
        && (sNew.runMs as { max: number }).max <= maxRun && (slow || (sNew.longestPhase as { ms: number }).ms <= 30000);
    const okHead = headRuns.length === 0 || (sHead.badShare as number) >= 0.5;
    // v2 breaks the pacing rule itself: its screens change without a button in (nearly) every run
    const okV2 = v2Runs.length === 0 || (sV2.runsWithScreenChangesWithoutAButton as number) >= 0.9 * v2Runs.length;
    console.log(`ACCEPT new wizard: ${okNew ? 'PASS' : 'FAIL'} (all correct, no screen change without a button, max <= ${maxRun / 1000} s${slow ? '' : ', no stage > 30 s'})`);
    console.log(`ACCEPT negative control, first wizard (hang + wrong >= 50 %): ${okHead ? 'PASS' : 'FAIL'}`);
    console.log(`ACCEPT negative control, v2 (screens change without a button in >= 90 % of runs): ${okV2 ? 'PASS' : 'FAIL'}`);
    if (!okNew || !okHead || !okV2) process.exitCode = 1;
}

await main();
