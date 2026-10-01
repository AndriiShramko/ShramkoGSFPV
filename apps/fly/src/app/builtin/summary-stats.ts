// The numbers behind the end-of-flight stats (docs/architecture-v03.md D.1, D.2; item 7), without
// the page: which disarm shows the goggles card and what dismisses it, the page session's stats
// folded across flight models, and the per-drone lifetime totals in the prefs collection 'stats'.
// No DOM, no dictionary: the card (ui/osd-stats.ts) and the panel (ui/summary.ts) show these, the
// feature (summary.ts) feeds them, tools/bench/test/app-summary.test.ts checks them in Node.
//
// Why a page-session block of our own: the session's FlightStats is rebuilt with the flight model
// (a new drone, the menu's Restart, the walls switch, a 'life' setting), so its session() starts
// from zero each time. The pilot's session is the visit, so the blocks of every flight model flown
// are folded here (sums, maxima, minima, airtime-weighted averages).
import type { FlightStats, SimEvent, StatsBlock } from '@gsfpv/sim-core';
import type { DroneTotals } from '@gsfpv/prefs';

/** D.2: the card needs at least this much airtime in the life that ended with the switch. */
export const CARD_MIN_AIRTIME_S = 3;
/** D.2: the card goes by itself after this long. */
export const CARD_TIMEOUT_MS = 30000;
/** D.2: throttle above this closes the card ... */
export const CARD_THROTTLE = 0.25;
/**
 * ... once it is also this far above where the stick was when the card came up. A keyboard throttle
 * stays where W left it (devices/keyboard.ts), so a pilot who disarms in the air at 40 % would never
 * see the card if the level alone closed it; on a radio the stick is low after a landing and the
 * rule is just "above 25 %".
 */
export const CARD_THROTTLE_PUSH = 0.1;
/** The lifetime totals are written at least this often while the craft is armed (and at every disarm, crash, pause, hide). */
export const COMMIT_EVERY_MS = 5000;

/** The disarm that ended a flight shows the card: the switch (not a crash), after 3 s, with the setting on. */
export function cardOnDisarm(e: SimEvent, life: StatsBlock, enabled: boolean): boolean {
    return enabled && e.type === 'disarm' && e.reason === 'switch' && life.airtimeS >= CARD_MIN_AIRTIME_S;
}

/** Throttle 0..1 now, and when the card came up: does the stick close it? */
export function throttleDismisses(baseline: number, thr: number): boolean {
    return thr > CARD_THROTTLE && thr >= baseline + CARD_THROTTLE_PUSH;
}

export function emptyStats(): StatsBlock {
    return {
        airtimeS: 0, maxSpeed: 0, maxAlt: 0, maxDist: 0, distance: 0, minVolt: 0, endVolt: 0, maxAmps: 0, usedMah: 0, maxG: 0,
        avgThrottle: 0, fullThrottleS: 0, fullThrottleCount: 0, crashes: 0, maxImpact: 0, bounces: 0, respawns: {}, rewinds: 0,
        longestCleanS: 0, flights: 0, scenes: 0
    };
}

/**
 * Two blocks of one page session as one: counts and times add up, maxima take the larger, the
 * lowest battery the lower of the blocks that flew, the average throttle weighted by airtime, the
 * end battery the later block's. Scenes: the larger (a new flight model on the same scene is not a
 * new scene).
 */
export function mergeStats(a: StatsBlock, b: StatsBlock): StatsBlock {
    const air = a.airtimeS + b.airtimeS;
    const respawns: StatsBlock['respawns'] = { ...a.respawns };
    for (const [k, n] of Object.entries(b.respawns) as [keyof StatsBlock['respawns'], number][]) respawns[k] = (respawns[k] ?? 0) + n;
    const flew = (x: StatsBlock) => x.airtimeS > 0;
    return {
        airtimeS: air,
        maxSpeed: Math.max(a.maxSpeed, b.maxSpeed),
        maxAlt: flew(a) && flew(b) ? Math.max(a.maxAlt, b.maxAlt) : flew(b) ? b.maxAlt : a.maxAlt,
        maxDist: Math.max(a.maxDist, b.maxDist),
        distance: a.distance + b.distance,
        minVolt: flew(a) && flew(b) ? Math.min(a.minVolt, b.minVolt) : flew(b) ? b.minVolt : flew(a) ? a.minVolt : b.minVolt || a.minVolt,
        endVolt: b.endVolt || a.endVolt,
        maxAmps: Math.max(a.maxAmps, b.maxAmps),
        usedMah: a.usedMah + b.usedMah,
        maxG: Math.max(a.maxG, b.maxG),
        avgThrottle: air > 0 ? (a.avgThrottle * a.airtimeS + b.avgThrottle * b.airtimeS) / air : 0,
        fullThrottleS: a.fullThrottleS + b.fullThrottleS,
        fullThrottleCount: a.fullThrottleCount + b.fullThrottleCount,
        crashes: a.crashes + b.crashes,
        maxImpact: Math.max(a.maxImpact, b.maxImpact),
        bounces: a.bounces + b.bounces,
        respawns,
        rewinds: a.rewinds + b.rewinds,
        longestCleanS: Math.max(a.longestCleanS, b.longestCleanS),
        flights: a.flights + b.flights,
        scenes: Math.max(a.scenes, b.scenes)
    };
}

/** What the ledger needs of the prefs store: the 'stats' collection (PrefsStore fits). */
export interface TotalsStore {
    collection(k: 'stats'): Readonly<{ byDrone: Readonly<Record<string, DroneTotals>> }>;
    updateCollection(k: 'stats', fn: (draft: { v: 1; byDrone: Record<string, DroneTotals> }) => void): void;
}

/** The part of a stats block that goes into the lifetime totals. */
type Counted = Pick<StatsBlock, 'flights' | 'airtimeS' | 'distance' | 'crashes'>;
const counted = (b: StatsBlock): Counted => ({ flights: b.flights, airtimeS: b.airtimeS, distance: b.distance, crashes: b.crashes });
const ZERO: Counted = { flights: 0, airtimeS: 0, distance: 0, crashes: 0 };

export function zeroTotals(): DroneTotals {
    return { flights: 0, airtimeS: 0, distanceM: 0, crashes: 0 };
}

/**
 * The stats of one page: life (the current flight model's), session (every flight model of this
 * visit) and lifetime per drone (stored). track() follows the session's current FlightStats; when it
 * changes (a rebuilt flight model) the old one's last numbers are committed to the drone it flew
 * and folded into the session. commit() adds what was flown since the last commit to the stored
 * totals of that drone, so a total never counts the same second twice and never loses one that
 * was committed.
 */
export class StatsLedger {
    private cur: FlightStats | null = null;
    private drone = '';
    private done: Counted = ZERO;
    private past: StatsBlock | null = null;
    private readonly store: TotalsStore;

    constructor(store: TotalsStore) {
        this.store = store;
    }

    /** The session's stats object now, and the drone it flies; cheap when nothing changed (call it every frame). */
    track(stats: FlightStats, drone: string): void {
        if (stats === this.cur) return;
        if (this.cur) {
            this.commit();
            const last = this.cur.session();
            this.past = this.past ? mergeStats(this.past, last) : last;
        }
        this.cur = stats;
        this.drone = drone;
        this.done = ZERO;
    }

    /** Flown since the last commit, per counted field (never negative). */
    private pending(): Counted {
        if (!this.cur) return ZERO;
        const n = counted(this.cur.session());
        return { flights: Math.max(0, n.flights - this.done.flights), airtimeS: Math.max(0, n.airtimeS - this.done.airtimeS), distance: Math.max(0, n.distance - this.done.distance), crashes: Math.max(0, n.crashes - this.done.crashes) };
    }

    /** Add what was flown since the last commit to the drone's stored totals; false when there was nothing. */
    commit(): boolean {
        if (!this.cur) return false;
        const d = this.pending();
        if (d.flights === 0 && d.airtimeS === 0 && d.distance === 0 && d.crashes === 0) return false;
        const drone = this.drone;
        this.store.updateCollection('stats', (draft) => {
            const t = Object.hasOwn(draft.byDrone, drone) ? draft.byDrone[drone] : zeroTotals();
            draft.byDrone[drone] = { flights: t.flights + d.flights, airtimeS: t.airtimeS + d.airtimeS, distanceM: t.distanceM + d.distance, crashes: t.crashes + d.crashes };
        });
        this.done = counted(this.cur.session());
        return true;
    }

    life(): StatsBlock {
        return this.cur ? this.cur.life() : emptyStats();
    }

    session(): StatsBlock {
        const now = this.cur ? this.cur.session() : null;
        if (!this.past) return now ?? emptyStats();
        return now ? mergeStats(this.past, now) : this.past;
    }

    /** The drone's lifetime totals: stored, plus what is flown but not yet committed when it is the drone flying now. */
    lifetime(drone = this.drone): DroneTotals {
        const byDrone = this.store.collection('stats').byDrone;
        const t = Object.hasOwn(byDrone, drone) ? { ...byDrone[drone] } : zeroTotals();
        if (drone !== this.drone) return t;
        const d = this.pending();
        return { flights: t.flights + d.flights, airtimeS: t.airtimeS + d.airtimeS, distanceM: t.distanceM + d.distance, crashes: t.crashes + d.crashes };
    }

    get currentDrone(): string {
        return this.drone;
    }
}

// ------------------------------------------------------------------ text

export type Units = 'metric' | 'imperial';

/** m:ss.t under an hour, h:mm:ss above (the goggles' timers are mm:ss; tenths so the card can be checked to 0.1 s). */
export function fmtClock(s: number, tenths = true): string {
    const v = Number.isFinite(s) && s > 0 ? s : 0;
    if (v >= 3600) {
        const t = Math.floor(v);
        return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }
    if (!tenths) {
        const t = Math.floor(v);
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
    const d = Math.round(v * 10); // tenths, rounded once so 59.96 s reads 1:00.0, not 0:60.0
    const m = Math.floor(d / 600);
    const rest = d - m * 600;
    return `${m}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`;
}

/** A speed in m/s as the goggles show it: km/h (metric) or mph. */
export function speedIn(mps: number, u: Units): number {
    return u === 'imperial' ? mps * 2.2369362920544 : mps * 3.6;
}

/** A length in m: m or ft. */
export function lengthIn(m: number, u: Units): number {
    return u === 'imperial' ? m * 3.280839895 : m;
}

/** One row of the stats: its dictionary key, how to read it from a block, and where it shows. */
export interface StatRow {
    id: string;
    /** the goggles card (8-10 lines) */
    card: boolean;
    /** one of the 4 lines kept on a phone (< 480 px) */
    core: boolean;
    /** in the lifetime totals (flights, air time, distance, crashes) */
    lifetime: boolean;
}

/** The rows, in the goggles' order (research-a (c): ON TIME, MAX ALTITUDE, MAX SPEED, MAX DISTANCE, FLIGHT DISTANCE, battery, current, mAh, G, throttle). */
export const STAT_ROWS: readonly StatRow[] = [
    { id: 'airtime', card: true, core: true, lifetime: true },
    { id: 'flights', card: false, core: false, lifetime: true },
    { id: 'maxSpeed', card: true, core: true, lifetime: false },
    { id: 'maxAlt', card: true, core: false, lifetime: false },
    { id: 'maxDist', card: true, core: false, lifetime: false },
    { id: 'distance', card: true, core: true, lifetime: true },
    { id: 'minVolt', card: true, core: false, lifetime: false },
    { id: 'endVolt', card: false, core: false, lifetime: false },
    { id: 'maxAmps', card: true, core: false, lifetime: false },
    { id: 'usedMah', card: true, core: false, lifetime: false },
    { id: 'maxG', card: true, core: false, lifetime: false },
    { id: 'avgThrottle', card: true, core: false, lifetime: false },
    { id: 'fullThrottle', card: false, core: false, lifetime: false },
    { id: 'crashes', card: false, core: true, lifetime: true },
    { id: 'maxImpact', card: false, core: false, lifetime: false },
    { id: 'longestClean', card: false, core: false, lifetime: false }
];

/** The unit words a row needs (dictionary keys stats.u.*), so the text layer stays in the dictionary. */
export interface UnitWords { kmh: string; mph: string; m: string; ft: string; km: string; mi: string }

/** A row's value from a block, as text with its unit; '—' where the block has no such number. */
export function statText(id: string, b: StatsBlock | null, t: DroneTotals | null, u: Units, w: UnitWords): string {
    const n0 = (x: number) => String(Math.round(x));
    const n1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
    const len = (m: number) => `${n1(lengthIn(m, u))} ${u === 'imperial' ? w.ft : w.m}`;
    if (t) {
        switch (id) {
            case 'airtime': return fmtClock(t.airtimeS, t.airtimeS < 3600);
            case 'flights': return n0(t.flights);
            case 'distance': return t.distanceM >= 1000 ? `${n1(lengthIn(t.distanceM, u) / (u === 'imperial' ? 5280 : 1000))} ${u === 'imperial' ? w.mi : w.km}` : len(t.distanceM);
            case 'crashes': return n0(t.crashes);
            default: return '—';
        }
    }
    if (!b) return '—';
    switch (id) {
        case 'airtime': return fmtClock(b.airtimeS);
        case 'flights': return n0(b.flights);
        case 'maxSpeed': return `${n0(speedIn(b.maxSpeed, u))} ${u === 'imperial' ? w.mph : w.kmh}`;
        case 'maxAlt': return len(b.maxAlt);
        case 'maxDist': return len(b.maxDist);
        case 'distance': return len(b.distance);
        case 'minVolt': return b.airtimeS > 0 ? `${b.minVolt.toFixed(2)} V` : '—';
        case 'endVolt': return b.endVolt > 0 ? `${b.endVolt.toFixed(2)} V` : '—';
        case 'maxAmps': return `${n1(b.maxAmps)} A`;
        case 'usedMah': return `${n0(b.usedMah)} mAh`;
        case 'maxG': return `${n1(b.maxG)} G`;
        case 'avgThrottle': return `${n0(b.avgThrottle * 100)} %`;
        case 'fullThrottle': return `${fmtClock(b.fullThrottleS)} · ${b.fullThrottleCount}×`;
        case 'crashes': return n0(b.crashes);
        case 'maxImpact': return b.maxImpact > 0 ? `${n0(speedIn(b.maxImpact, u))} ${u === 'imperial' ? w.mph : w.kmh}` : '—';
        case 'longestClean': return fmtClock(b.longestCleanS);
        default: return '—';
    }
}

/**
 * "Copy stats": plain text, one row per stat, the three columns padded so it reads in a chat or a
 * forum post set in a monospace font. `label(id)` and the headings come from the dictionary.
 */
export function statsText(o: { title: string; heads: [string, string, string]; label: (id: string) => string; life: StatsBlock; session: StatsBlock; lifetime: DroneTotals; units: Units; words: UnitWords }): string {
    const rows = STAT_ROWS.map((r) => [o.label(r.id), statText(r.id, o.life, null, o.units, o.words), statText(r.id, o.session, null, o.units, o.words), r.lifetime ? statText(r.id, null, o.lifetime, o.units, o.words) : '—']);
    const all = [['', ...o.heads], ...rows];
    const w = [0, 1, 2, 3].map((i) => Math.max(...all.map((r) => r[i].length)));
    const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ').trimEnd();
    return [o.title, '', ...all.map(line)].join('\n');
}
