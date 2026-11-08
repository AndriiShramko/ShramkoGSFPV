// v0.12 v12-int step 11 (docs/wip/v12-int.md): the cost of the contact queries of a 10 s hall flight in the built-in lesson worlds, ALONE and with its evidence.
// The plan's bound is "under 20 ms for 10 s of flight" (docs/wip/v12-plan.md 2.5 and 4.2). tools/bench/test/sonic-world.test.ts used to hold that number
// itself and failed once in the gate's parallel run (30.5 ms where it measures 15 to 16 alone): an absolute time inside a gate that runs test files
// side by side is a flake. The test now holds the claim as a ratio to the uncached lookup timed beside it; the absolute bound lives here, where a run
// is the only thing running, and says so when something else was.
//   cd tools/bench && npx tsx test/sonic-world-cost.ts           evidence/2026-11-07/sonic-world-cost.json; exit 1 when a bound fails
// (It lives in test/ beside the flights it times, like the page entries: the bench's typecheck reads src/ only and must not read the simulator through it.)
// The same two flights as the test (sonic-world-flight.ts): along and into the front wall, and in the open middle of the hall.
// Best of 9 rounds, the three ways alternating, a fresh world for each run; how busy the machine was over the whole run (all its CPUs, from the system's
// own counters: Windows has no load average) is in the evidence, so a number can be read with it.
import { cpus } from 'node:os';
import { OPEN_FLIGHT, WALL_FLIGHT, costHall, costKinds, hallFlight, measureKinds } from './sonic-world-flight';
import { writeEvidence } from '../src/evidence';

const PLAN_BOUND_MS = 20;
const ROUNDS = 9;
const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value)}`);
};

// v0.12's walls-hall, pinned: the flights are measured in it (sonic-world-flight.ts costHall)
const lw = costHall();
const result: Record<string, unknown> = {};
const cpuTimes = (): { idle: number; total: number } => cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
const t0 = cpuTimes();
for (const [name, plan, wall] of [['along and into a wall', WALL_FLIGHT, true], ['in the open', OPEN_FLIGHT, false]] as const) {
    const flight = hallFlight(plan);
    // a first, untimed round warms the code and the JIT as a flight would have
    measureKinds(flight.queries, costKinds(lw.world), 1);
    const { best, answers, runs } = measureKinds(flight.queries, costKinds(lw.world), ROUNDS);
    const ms = (n: number): number => Math.round(n * 100) / 100;
    result[name] = { queries: flight.queries.length, contacts: flight.contacts, bestMs: { session: ms(best.session), cells: ms(best.cells), raw: ms(best.raw) }, runsMs: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, (v as number[]).map(ms)])), ratio: ms(best.session / best.raw) };
    check(`a 10 s hall flight ${name} (${flight.queries.length} queries${wall ? `, ${flight.contacts} contact events` : ''}): the contact queries as the session flies them cost under ${PLAN_BOUND_MS} ms (best of ${ROUNDS})`, best.session < PLAN_BOUND_MS, { sessionMs: ms(best.session), cellsMs: ms(best.cells), noCullMs: ms(best.raw) });
    check(`... and give the same answers as the uncached lookup`, answers.session === answers.raw && answers.cells === answers.raw);
}
const t1 = cpuTimes();
result.machine = { cpus: cpus().length, cpu: cpus()[0]?.model, busyPercentOverTheRun: Math.round((1 - (t1.idle - t0.idle) / Math.max(1, t1.total - t0.total)) * 1000) / 10 };
const passed = checks.filter((c) => c.pass).length;
const file = writeEvidence('sonic-world-cost', { planBoundMs: PLAN_BOUND_MS, rounds: ROUNDS, passed, total: checks.length, pass: passed === checks.length, checks, result }, '2026-11-07');
console.log(`${passed} of ${checks.length} checks passed; ${file}`);
process.exit(passed === checks.length ? 0 : 1);
