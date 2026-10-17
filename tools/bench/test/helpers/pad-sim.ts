// A deterministic model of one stick move travelling from a controller's link to the page, for the
// latency harness (v0.9 lane E, the owner's item 12). It runs the REAL GamepadSource (any version of
// the file) on a virtual clock and a virtual main thread, against a pad modelled on Chromium's
// gamepad path, and measures what OUR code adds to a move. No hardware, no browser, no wall time.
//
// The platform (what Chromium does, read 2026-10-17; docs/wip/v09-e.md has the sources):
//   - the browser's gamepad thread takes each report the moment it arrives and stamps it (raw input:
//     Gamepad.timestamp = the report's arrival on the page clock, `ts: 'arrival'`);
//   - its provider publishes the newest state to pages every 4 ms (a tick), and navigator.getGamepads()
//     reads the last published state at the moment of the call.
// The page's main thread runs one task at a time on the virtual clock: the source's MessageChannel
// loop (a task that re-posts itself, polling at most every 2 ms), and one frame per display period
// (the screen's draw and the physics update), each frame optionally holding the thread `busyMs`
// (a heavy scan). A frame is due at its vsync and runs when the thread is free; the loop runs between.
//
// What a stick move is: the stick goes 0 -> 0.6 -> 0 ... at edges E (every ~397 ms, off any frame
// rhythm). The first report at or after an edge carries the new value: its arrival A is the moment the
// browser has the move (the link's own delay is before A and is not measured here). The earliest the
// page can read it is the next provider tick V; the earliest it can DRAW it is the first frame at or
// after V (R*). Per edge, these are measured from where the code under test is:
//   delivery  D - A      the source calls onFrame with the new value
//   stamp     S - A      the time the move is stamped with (the physics applies an input at its stamp)
//   screen    R - A      the first frame that draws it (the on-screen stick) at or after D
// and `added` = R - R*: how much later than the best any page could do the stick is drawn. A frame
// reads the source when it starts; the picture reaches the display after the frame ends, the same
// for every version, so it is left out.

import { reportTimes } from '@gsfpv/input/sim';
import type { LinkKind } from '@gsfpv/input/sim';
import type { LinkStats, RawFrame } from '@gsfpv/input';

/** What Gamepad.timestamp does (the last four are failure modes some browser or device could show). */
export type TsMode =
    /** the report's arrival, a new value on every report (Chromium raw input) */
    | 'arrival'
    /** never changes while the values do */
    | 'frozen'
    /** 150 ms behind (older than the 100 ms a stamp is trusted) */
    | 'stale'
    /** the arrival, but every 5th report is stamped 30 ms before the one before */
    | 'backwards'
    /** the provider's tick, a new value every 4 ms even with no report (a fetcher that stamps its polls) */
    | 'tick';

export type PadLink = LinkKind | 'djiChanges';

export interface Scenario {
    name: string;
    link: PadLink;
    ts: TsMode;
    /** every frame holds the main thread this long after it has read the source (a heavy scan) */
    busyMs: number;
    /** the display period: 33.33 ms is the owner's 4K monitor at 30 Hz */
    periodMs: number;
    /** edges measured */
    edges: number;
}

/** What the harness needs of a gamepad source (every version of gamepad.ts has these). */
export interface PadSource {
    index: number;
    id: string;
    frame: RawFrame;
    onFrame: ((f: RawFrame) => void) | null;
    start(): void;
    stop(): void;
    /** the newest version only: read the pad now (a frame calls it just before it draws) */
    pollNow?(): void;
    /** the newest version only: the meter of how often new samples arrive */
    link?: { stats(now: number): LinkStats };
}

export interface Stats { n: number; mean: number; p50: number; p95: number; min: number; max: number }

export interface Result {
    scenario: Scenario;
    /** edges the source never delivered */
    missed: number;
    /** V - A: the provider's tick that publishes the move (the platform's, not ours) */
    tick: Stats;
    /** D - V: the source's poll finds it (ours) */
    lag: Stats;
    delivery: Stats;
    stamp: Stats;
    screen: Stats;
    added: Stats;
    /** the share of edges drawn a frame later than they could have been */
    lateShare: number;
    /** samples a second the source hands to the physics (the loop gives the stick's path, one read per frame only 30 points of it) */
    inputHz: number;
    /** what the source's own link meter says at the end of the run (the newest version only) */
    link?: LinkStats;
}

export interface RunOptions {
    /** a frame reads the pad just before it draws (PadSource.pollNow) */
    pollInFrame?: boolean;
    /** the control: no polling loop, the pad is read only once per frame */
    rafBound?: boolean;
    /** seed of the link's jitter */
    seed?: number;
    /** CPU time of one pass of the polling loop, ms (the control: a loop that is slow to come round) */
    loopMs?: number;
}

/** The owner's 4K monitor over HDMI: 30 Hz. */
export const P30 = 1000 / 30;

const row = (name: string, link: PadLink, ts: TsMode, busyMs = 0, periodMs = P30): Scenario => ({ name, link, ts, busyMs, periodMs, edges: 100 });

/**
 * The timelines the harness runs: each link with the browser behaving as Chromium's raw-input path does,
 * then the failure modes of Gamepad.timestamp on one link, then a heavy scan holding the main thread,
 * then a display at 60 Hz for comparison.
 */
export const SCENARIOS: Scenario[] = [
    row('usb1000', 'usb1000', 'arrival'),
    row('ble90', 'ble90', 'arrival'),
    row('bleBursty', 'bleBursty', 'arrival'),
    row('djiChanges', 'djiChanges', 'arrival'),
    row('ble90 timestamp frozen', 'ble90', 'frozen'),
    row('ble90 timestamp stale', 'ble90', 'stale'),
    row('ble90 timestamp backwards', 'ble90', 'backwards'),
    row('ble90 timestamp per poll', 'ble90', 'tick'),
    row('ble90 heavy scan 25 ms/frame', 'ble90', 'arrival', 25),
    row('usb1000 heavy scan 25 ms/frame', 'usb1000', 'arrival', 25),
    row('ble90 at 60 Hz', 'ble90', 'arrival', 0, 1000 / 60)
];

const TICK_MS = 4;
const TICK_PHASE = 1.3; // the provider's tick clock has its own phase
const LOOP_MS = 0.1; // CPU time of one pass of the polling loop (it re-posts itself), unless a run says otherwise
const EDGE_GAP = 397;
const T0 = 300; // the first edge is after this

const stats = (a: number[]): Stats => {
    if (!a.length) return { n: 0, mean: NaN, p50: NaN, p95: NaN, min: NaN, max: NaN };
    const s = [...a].sort((x, y) => x - y);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: q(0.5), p95: q(0.95), min: s[0], max: s[s.length - 1] };
};

interface Task { t: number; seq: number; fn: () => void }

/** One main thread on a virtual clock: tasks run one at a time, in order of their due time. */
class Main {
    now = 0;
    private tasks: Task[] = [];
    private seq = 0;

    post(t: number, fn: () => void): void {
        const k: Task = { t, seq: this.seq++, fn };
        let i = this.tasks.length;
        while (i > 0 && this.tasks[i - 1].t > t) i--;
        this.tasks.splice(i, 0, k);
    }

    burn(ms: number): void {
        this.now += ms;
    }

    run(end: number): void {
        while (this.tasks.length && this.tasks[0].t <= end) {
            const k = this.tasks.shift()!;
            if (k.t > this.now) this.now = k.t;
            k.fn();
        }
    }
}

/** Edge k (1-based) happens at this page time (off any frame rhythm). */
const edgeAt = (k: number): number => T0 + k * EDGE_GAP + ((k * 37) % 50);

/** The stick's value at page time t: 0.6 after an odd number of edges, 0 after an even one. */
const stickAt = (t: number): number => {
    let k = Math.floor((t - T0) / EDGE_GAP) + 1;
    while (k > 0 && edgeAt(k) > t) k--;
    while (edgeAt(k + 1) <= t) k++;
    return t < T0 || k < 1 ? 0 : k % 2 === 1 ? 0.6 : 0;
};

/** Globals the source reads, replaced for one run and put back exactly as they were. */
function withGlobals<T>(env: Record<string, unknown>, run: () => T): T {
    const g = globalThis as object;
    const saved = Object.keys(env).map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
    for (const [k, v] of Object.entries(env)) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
    try {
        return run();
    } finally {
        for (const [k, d] of saved) {
            if (d) Object.defineProperty(g, k, d);
            else delete (g as Record<string, unknown>)[k];
        }
    }
}

/** Run `sc` through `Source` (a GamepadSource of any version) and measure the moves. */
export function runScenario(Source: new () => PadSource, sc: Scenario, opts: RunOptions = {}): Result {
    const main = new Main();
    const duration = T0 + (sc.edges + 2) * EDGE_GAP;

    // ---- the controller's reports: arrival times at the browser and the value each carries
    let arrivals: number[];
    if (sc.link === 'djiChanges') {
        // a controller that reports only while the stick moves: a report every 6.25 ms for 60 ms after each edge
        arrivals = [];
        for (let k = 1; k <= sc.edges + 1; k++) {
            const first = edgeAt(k) + ((k * 17) % 7) * 0.9;
            for (let j = 0; j < 10; j++) arrivals.push(first + j * 6.25);
        }
    } else {
        arrivals = reportTimes(sc.link, duration, opts.seed ?? 1);
    }
    const values = arrivals.map(stickAt);

    // ---- the pad as the page reads it: the last provider tick at or before the call
    let upto = -1; // newest report the provider has taken
    const tickOf = (now: number): number => TICK_PHASE + Math.floor((now - TICK_PHASE) / TICK_MS) * TICK_MS;
    const taken = (): number => {
        const tick = tickOf(main.now);
        while (upto + 1 < arrivals.length && arrivals[upto + 1] <= tick) upto++;
        return tick;
    };
    const stampOf = (i: number, tick: number): number => {
        if (i < 0) return 0;
        switch (sc.ts) {
            case 'arrival': return arrivals[i];
            case 'frozen': return arrivals[0];
            case 'stale': return arrivals[i] - 150;
            case 'backwards': return arrivals[i] - (i % 5 === 0 ? 30 : 0);
            case 'tick': return tick;
        }
    };
    const pad = {
        id: 'Synthetic BLE gamepad', index: 0, connected: true, mapping: '', buttons: [{ pressed: false }],
        get axes(): number[] {
            taken();
            return [upto >= 0 ? values[upto] : 0, 0, 0, 0];
        },
        get timestamp(): number {
            const tick = taken(); // advances `upto` first
            return stampOf(upto, tick);
        }
    };

    class FakeChannel {
        port1: { onmessage: (() => void) | null } = { onmessage: null };
        port2 = {
            postMessage: (): void => {
                main.post(main.now, () => {
                    main.burn(opts.loopMs ?? LOOP_MS);
                    this.port1.onmessage?.();
                });
            }
        };
    }

    return withGlobals({
        MessageChannel: FakeChannel,
        performance: { now: () => main.now },
        navigator: { getGamepads: () => [pad] },
        document: { visibilityState: 'visible' },
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    }, () => {
        const delivered = new Map<number, { d: number; s: number }>(); // edge -> delivery time and stamp
        const drawn = new Map<number, number>(); // edge -> start of the frame that drew it
        const frames: number[] = []; // frame start times
        const src = new Source();
        let nextEdge = 1;
        let sent = 0;
        src.onFrame = (f) => {
            sent++;
            // odd edges move the stick up, even ones back; a repeat of the old value is not the move
            const k = nextEdge;
            if (edgeAt(k) > main.now || f.axes[0] > 0.3 !== (k % 2 === 1)) return;
            delivered.set(k, { d: main.now, s: f.t });
            nextEdge++;
        };
        if (!opts.rafBound) src.start();

        const frame = (vsync: number): void => {
            const start = main.now;
            frames.push(start);
            if (opts.rafBound) (src as unknown as { poll(n: number): void }).poll(main.now);
            else if (opts.pollInFrame) src.pollNow?.();
            // the screen and the physics take what the source delivered so far
            for (const k of delivered.keys()) if (!drawn.has(k)) drawn.set(k, start);
            main.burn(sc.busyMs);
            // the next vsync after this frame ends (a late frame drops the ones it overran)
            let next = vsync + sc.periodMs;
            while (next < main.now) next += sc.periodMs;
            main.post(next, () => frame(next));
        };
        main.post(7.7, () => frame(7.7));
        main.run(duration);
        src.stop();

        const tick: number[] = [];
        const lag: number[] = [];
        const delivery: number[] = [];
        const stamp: number[] = [];
        const screen: number[] = [];
        const added: number[] = [];
        let missed = 0;
        let late = 0;
        for (let k = 1; k <= sc.edges; k++) {
            const e = edgeAt(k);
            const A = arrivals.find((t) => t >= e);
            const D = delivered.get(k);
            const R = drawn.get(k);
            if (A === undefined || !D || R === undefined) { missed++; continue; }
            const V = TICK_PHASE + Math.ceil((A - TICK_PHASE) / TICK_MS) * TICK_MS; // the first tick that publishes it
            const best = frames.find((s) => s >= V) ?? R;
            tick.push(V - A);
            lag.push(D.d - V);
            delivery.push(D.d - A);
            stamp.push(D.s - A);
            screen.push(R - A);
            added.push(R - best);
            if (R - best > 0.5) late++;
        }
        const n = sc.edges - missed;
        const link = src.link?.stats(main.now);
        return { scenario: sc, missed, ...(link ? { link } : {}), tick: stats(tick), lag: stats(lag), delivery: stats(delivery), stamp: stats(stamp), screen: stats(screen), added: stats(added), lateShare: n ? late / n : 0, inputHz: (sent * 1000) / duration };
    });
}
