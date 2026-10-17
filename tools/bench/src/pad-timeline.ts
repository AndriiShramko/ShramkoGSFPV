// Runs the Gamepad API latency harness (tools/bench/test/pad-timeline.test.ts: the model is in
// test/helpers/pad-sim.ts) over every scenario and every version of the source, prints one table and
// writes evidence/<date>/v09-e-pad-timeline.json. Deterministic: the same numbers on every run.
//
// Columns, per scenario and version (means over 100 stick moves, ms, from the moment the browser has the report):
//   tick   the browser's provider publishes it (the platform's, 0-4 ms)
//   lag    our poll finds it after that
//   stamp  the time the physics is told the move happened
//   screen the frame that draws the on-screen stick (a 30 Hz screen: the wait for the frame is most of it)
//   added  that frame minus the best any page could do (the share of moves drawn a frame late: late)
// Usage: npx tsx src/pad-timeline.ts
import { GamepadSource as V07 } from '../test/fixtures/gamepad-v07';
import { GamepadSource as V08 } from '../test/fixtures/gamepad-v08';
import { GamepadSource as Now } from '../../../apps/fly/src/devices/gamepad';
import { SCENARIOS, runScenario } from '../test/helpers/pad-sim';
import type { PadSource, Result, RunOptions } from '../test/helpers/pad-sim';
import { writeEvidence } from './evidence';

const as = (c: unknown): new () => PadSource => c as new () => PadSource;
const VERSIONS: Array<{ name: string; what: string; src: unknown; opts: RunOptions }> = [
    { name: 'v07', what: 'v0.7 (097300d): every sample stamped at the poll', src: V07, opts: {} },
    { name: 'v08', what: 'v0.8 (631fd5f): stamped with Gamepad.timestamp', src: V08, opts: {} },
    { name: 'now', what: 'v0.9 lane E: + a moved value is a sample, no backwards stamps', src: Now, opts: {} },
    { name: 'now+latch', what: 'v0.9 lane E + pollNow() just before the frame', src: Now, opts: { pollInFrame: true } },
    { name: 'raf-bound', what: 'control: the pad read only once per frame', src: V08, opts: { rafBound: true } }
];

const f = (x: number): string => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : '   nan');
const rows: Array<Record<string, unknown>> = [];
const lines: string[] = [];
for (const sc of SCENARIOS) {
    lines.push(`\n${sc.name}  (${sc.link}, timestamp ${sc.ts}, ${Math.round(1000 / sc.periodMs)} Hz screen, ${sc.busyMs} ms of work per frame)`);
    for (const v of VERSIONS) {
        const r: Result = runScenario(as(v.src), sc, v.opts);
        lines.push(`  ${v.name.padEnd(10)} tick ${f(r.tick.mean)}  lag ${f(r.lag.mean)} (max ${f(r.lag.max)})  stamp ${f(r.stamp.mean)}  screen ${f(r.screen.mean)} (p95 ${f(r.screen.p95)})  added ${f(r.added.mean)}  late ${String(Math.round(r.lateShare * 100)).padStart(2)} %  missed ${r.missed}  to physics ${String(Math.round(r.inputHz)).padStart(3)}/s`);
        rows.push({ scenario: sc.name, version: v.name, tick: r.tick, lag: r.lag, delivery: r.delivery, stamp: r.stamp, screen: r.screen, added: r.added, lateShare: r.lateShare, inputHz: r.inputHz, missed: r.missed, ...(r.link ? { link: r.link } : {}) });
    }
}
console.log(lines.join('\n'));
const file = writeEvidence('v09-e-pad-timeline', {
    what: 'input delay added by our Gamepad API path on synthetic link timelines (the harness of tools/bench/test/pad-timeline.test.ts), v0.7 / v0.8 / v0.9 lane E',
    method: 'the real GamepadSource on a virtual clock and a virtual main thread; a pad modelled on Chromium (timestamp = the report arrival, published every 4 ms); 100 stick moves per scenario; ms from the moment the browser has the report',
    versions: VERSIONS.map((v) => ({ name: v.name, what: v.what })),
    rows
});
console.log(`\nwrote ${file}`);
