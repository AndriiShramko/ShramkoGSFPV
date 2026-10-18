// The latency harness for the Gamepad API path (v0.9 lane E, the owner's item 12: a Radiomaster GX12
// over Bluetooth feels about 300 ms late). The REAL GamepadSource, three versions of it, runs on
// synthetic link timelines (USB 1000 Hz, Bluetooth LE ~90 Hz with jitter, Bluetooth in bunches, a
// controller that reports only changes, and a Gamepad.timestamp that is frozen, stale, backwards or
// stamped per poll) on a virtual clock and a virtual main thread (helpers/pad-sim.ts has the model and
// the measures), and what OUR code adds to a stick move is measured from the moment the browser has
// the report to (a) the frame that draws the on-screen stick and (b) the time the physics is told.
//
// The versions: v0.7 (097300d, before the Gamepad.timestamp stamping) and v0.8 (631fd5f, the base of
// this lane) are fixtures copied from git; the third is the file in apps/fly. The numbers are
// recorded in docs/wip/v09-e.md and evidence/2026-10-17/v09-e-pad-timeline.json
// (tools/bench/src/pad-timeline.ts runs the same scenarios and writes them).
//
// Controls (a check that cannot fail proves nothing): polling only in the animation frame must come out
// ~half a display period late; a loop that is slow to come round must show up; v0.7 must show the
// poll delay in its stamp; v0.7 and v0.8 must show the 10 ms the frozen timestamp cost.
import { describe, expect, it } from 'vitest';
import { GamepadSource as V07 } from './fixtures/gamepad-v07';
import { GamepadSource as V08 } from './fixtures/gamepad-v08';
import { GamepadSource as Now } from '../../../apps/fly/src/devices/gamepad';
import { P30, SCENARIOS, runScenario } from './helpers/pad-sim';
import type { PadSource, Result, RunOptions, Scenario } from './helpers/pad-sim';

const as = (c: unknown): new () => PadSource => c as new () => PadSource;
const scenario = (name: string): Scenario => {
    const s = SCENARIOS.find((x) => x.name === name);
    if (!s) throw new Error(`no scenario ${name}`);
    return s;
};
const run = (c: unknown, name: string, o: RunOptions = {}): Result => runScenario(as(c), scenario(name), o);

describe('the links with a browser that stamps each report (Chromium raw input), 30 Hz screen', () => {
    for (const name of ['usb1000', 'ble90', 'bleBursty', 'djiChanges']) {
        it(`${name}: our poll finds the move within one polling period of the provider publishing it, and nothing is held back a frame`, () => {
            const r = run(Now, name);
            expect(r.missed).toBe(0);
            expect(r.lag.mean).toBeLessThan(1.3); // the loop looks every 2 ms: 1 ms on average
            expect(r.lag.max).toBeLessThan(2.3);
            expect(r.added.mean).toBeLessThan(1.2); // against the best any page could do
            expect(r.stamp.mean).toBeLessThan(2); // the physics is told when the report arrived (up to the tick)
        });

        it(`${name}: reading the pad just before the frame (pollNow) leaves nothing a frame late`, () => {
            const r = run(Now, name, { pollInFrame: true });
            expect(r.lateShare).toBe(0);
            expect(r.added.mean).toBeLessThan(0.1);
        });
    }

    it('control: polling only in the animation frame (rAF-bound) is half a display period late: 16 ms at 30 Hz', () => {
        const loop = run(Now, 'ble90');
        const raf = run(Now, 'ble90', { rafBound: true });
        expect(raf.lag.mean).toBeGreaterThan(14);
        expect(raf.lag.mean).toBeGreaterThan(loop.lag.mean + 13);
        expect(raf.lag.max).toBeGreaterThan(P30 - 2);
    });

    it('control: reading the pad once per frame hands the physics 30 points a second of the path of the stick instead of the 50-500 of the loop', () => {
        const loop = run(Now, 'ble90');
        const raf = run(Now, 'ble90', { rafBound: true });
        expect(loop.inputHz).toBeGreaterThan(90);
        expect(raf.inputHz).toBeLessThan(31);
    });

    it('control: the harness sees a slow loop (a pass that takes 8 ms): the lag grows by about half of that', () => {
        const fast = run(Now, 'ble90');
        const slow = run(Now, 'ble90', { loopMs: 8 });
        expect(slow.lag.mean).toBeGreaterThan(fast.lag.mean + 3);
    });

    it('v0.8 stamped the move at its arrival, v0.7 at the poll: v0.7 is 1.5-3 ms later in what the physics is told, v0.8 and the new file equal', () => {
        for (const name of ['usb1000', 'ble90', 'bleBursty']) {
            const v07 = run(V07, name);
            const v08 = run(V08, name);
            const now = run(Now, name);
            expect(v07.stamp.mean, name).toBeGreaterThan(v08.stamp.mean + 1.5);
            expect(v07.stamp.mean, name).toBeCloseTo(v07.delivery.mean, 6); // v0.7: the stamp IS the delivery
            expect(now.stamp.mean, name).toBeCloseTo(v08.stamp.mean, 6);
            expect(now.delivery.mean, name).toBeCloseTo(v08.delivery.mean, 6); // nothing slower than v0.8 on a healthy link
        }
    });

    it('bursty link: a bunch of reports is one move for the page, and the bunch\'s own pause is the link\'s, not a hold-up of ours', () => {
        const r = run(Now, 'bleBursty');
        expect(r.missed).toBe(0);
        expect(r.screen.mean).toBeLessThan(P30 + 5);
        expect(r.added.p95).toBeLessThan(1);
    });
});

describe('a Gamepad.timestamp that misbehaves', () => {
    it('frozen while the values move: v0.7 and v0.8 find the move only at the 20 ms keep-alive (10 ms late on average); the new file at once', () => {
        const v07 = run(V07, 'ble90 timestamp frozen');
        const v08 = run(V08, 'ble90 timestamp frozen');
        const now = run(Now, 'ble90 timestamp frozen');
        for (const old of [v07, v08]) {
            expect(old.lag.mean).toBeGreaterThan(8);
            expect(old.lag.max).toBeGreaterThan(18);
            expect(old.lateShare).toBeGreaterThan(0.2);
        }
        expect(now.lag.mean).toBeLessThan(1.3);
        expect(now.lag.max).toBeLessThan(2.3);
        expect(now.lateShare).toBeLessThan(0.05);
    });

    it('control: with a healthy timestamp the old files are as quick as the new one (the 10 ms above is the frozen timestamp, not the harness)', () => {
        expect(run(V08, 'ble90').lag.mean).toBeCloseTo(run(Now, 'ble90').lag.mean, 6);
    });

    it('older than 100 ms: not trusted, the move is stamped at the poll (never in the past)', () => {
        const r = run(Now, 'ble90 timestamp stale');
        expect(r.stamp.mean).toBeCloseTo(r.delivery.mean, 6);
        expect(r.stamp.min).toBeGreaterThanOrEqual(0);
    });

    it('goes backwards: v0.8 trusts it and tells the physics the move came up to 30 ms before the report; the new file never does', () => {
        const v08 = run(V08, 'ble90 timestamp backwards');
        const now = run(Now, 'ble90 timestamp backwards');
        expect(v08.stamp.min).toBeLessThan(-10); // the control: the harness sees an early stamp
        expect(now.stamp.min).toBeGreaterThanOrEqual(-0.001);
        expect(now.lag.mean).toBeLessThan(1.3); // and nothing is delayed for it
    });

    it('stamped per poll (a fetcher that stamps every read): every poll is a new sample, the move still arrives within a poll', () => {
        const r = run(Now, 'ble90 timestamp per poll');
        expect(r.lag.mean).toBeLessThan(1.3);
        expect(r.missed).toBe(0);
    });
});

describe('a heavy scan holds the main thread 25 ms of every 33 ms frame', () => {
    it('the loop cannot run while a frame works: delivery waits for the frame, but the stamp still says when the report arrived', () => {
        for (const name of ['ble90 heavy scan 25 ms/frame', 'usb1000 heavy scan 25 ms/frame']) {
            const v07 = run(V07, name);
            const now = run(Now, name);
            expect(now.delivery.mean, name).toBeGreaterThan(8); // the platform of this page, the same for every version
            expect(now.delivery.mean, name).toBeCloseTo(v07.delivery.mean, 6);
            expect(now.stamp.mean, name).toBeLessThan(v07.stamp.mean - 1.5); // v0.8's gain stays
            expect(now.stamp.mean, name).toBeLessThan(now.delivery.mean - 1.5);
        }
    });

    it('reading the pad at the start of the frame gets the move into that frame', () => {
        const name = 'ble90 heavy scan 25 ms/frame';
        const loop = run(Now, name);
        const late = run(Now, name, { pollInFrame: true });
        expect(late.lateShare).toBe(0);
        expect(late.added.mean).toBeLessThanOrEqual(loop.added.mean);
        expect(late.screen.mean).toBeLessThanOrEqual(loop.screen.mean);
    });

    it('the link meter does not call a cable bursty because the page was busy', () => {
        const r = run(Now, 'usb1000 heavy scan 25 ms/frame');
        expect(r.link?.verdict).toBe('ok');
    });
});

describe('the source\'s own link meter on each timeline', () => {
    it('reads each link as what it is', () => {
        expect(run(Now, 'usb1000').link?.verdict).toBe('ok');
        expect(run(Now, 'ble90').link?.verdict).toBe('ok'); // a report every 11 ms is a link that delivers on time (SLOW_MS 15)
        // the browser's provider publishes the newest state every 4 ms, so a bunch of reports that
        // arrive within 1.5 ms is ONE new sample here: this path sees the bunches' own cadence (every
        // 50-100 ms), which is the delay that matters. WebHID sees each report (link.test.ts: bursty)
        const burst = run(Now, 'bleBursty').link!;
        expect(burst.verdict).toBe('slow');
        expect(burst.meanMs).toBeGreaterThan(50);
        expect(burst.maxGapMs).toBeGreaterThan(70);
        expect(run(Now, 'djiChanges').link?.verdict).toBe('ok'); // 6 ms while the stick moves, silent between moves
    });

    it('the numbers are the timeline\'s: 90 Hz with +-3 ms of jitter, bursts 50-100 ms apart', () => {
        const ble = run(Now, 'ble90').link!;
        expect(ble.hz).toBeGreaterThan(80);
        expect(ble.hz).toBeLessThan(95);
        expect(ble.jitterMs).toBeGreaterThan(1);
        expect(ble.jitterMs).toBeLessThan(5);
        const burst = run(Now, 'bleBursty').link!;
        expect(burst.hz).toBeLessThan(20);
        expect(burst.ageMs).toBeGreaterThan(30); // the newest value is 40 ms old on average
    });

    it('a frozen timestamp: the moves are found, but a pad that does not stamp its reports has no cadence to measure', () => {
        const r = run(Now, 'ble90 timestamp frozen');
        expect(r.missed).toBe(0);
        expect(r.link?.verdict).toBe('unknown');
    });

    it('known limit: a fetcher that stamps every poll reads as a fast link (the page cannot see the device behind it)', () => {
        const r = run(Now, 'ble90 timestamp per poll').link!;
        expect(r.hz).toBeGreaterThan(200);
        expect(r.verdict).toBe('ok');
    });

    it('control: the v0.8 file has no meter (the harness reads nothing from it)', () => {
        expect(run(V08, 'ble90').link).toBeUndefined();
    });
});

describe('the display, for scale', () => {
    it('at 60 Hz the stick is drawn about 8 ms sooner than at 30 Hz, from the same report: the screen is the larger part of what the pilot sees', () => {
        const at30 = run(Now, 'ble90');
        const at60 = run(Now, 'ble90 at 60 Hz');
        expect(at30.screen.mean - at60.screen.mean).toBeGreaterThan(7);
        expect(at30.screen.mean - at60.screen.mean).toBeLessThan(11);
    });
});
