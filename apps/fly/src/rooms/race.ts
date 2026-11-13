// Lane rooms2, stage Q2 (rooms-plan.md 2.4 and 4D; docs/rooms-protocol.md "Races"): a race on time in a room. Which course a
// proposal names, the countdown lines, the laps a page reports, and what each race message says. No DOM here:
// app/builtin/rooms.ts wires it to the course (apps/fly/src/course, read through its public classes), Node tests run it
// (tools/bench/test/rooms-race.test.ts).

export interface RaceRow {
    slot: number; nick: string; laps: number; totalMs: number; bestMs: number | null; lastMs: number | null;
    done: boolean; place: number; gapMs: number | null;
}

/** A race message of the service. */
export interface RaceMsg {
    type: 'race';
    state: 'prep' | 'count' | 'run' | 'lap' | 'refused' | 'results' | 'wait';
    course: string;
    laps?: number;
    by?: number;
    racers?: number[];
    ready?: number[];
    startAt?: number | null;
    table?: RaceRow[];
    slot?: number;
    n?: number;
    ms?: number;
}

/** What the page knows of its course now (window.__gsfpv.course, apps/fly/src/course/hook.ts). */
export interface CourseNow { on: boolean; source: 'none' | 'generated' | 'server'; track: { id: string; version: number } | null; seed: number | null }

export type CourseRef = { kind: 'seed'; seed: number } | { kind: 'saved'; id: string; version: number };

const COURSE_RE = /^[0-9A-Za-z._-]{1,64}$/;

/**
 * The course a proposal names (the owner's rule: the press needs no course on screen, it finds one): the course this pilot
 * flies now; else the newest course the scan keeps on the server; else the generator's course of a new seed.
 */
export function courseFor(now: CourseNow | null | undefined, saved: readonly { id: string; version: number }[], newSeed: number): string {
    if (now?.on && now.track) {
        if (now.source === 'server') return `${now.track.id}.v${now.track.version}`;
        if (now.source === 'generated' && now.seed !== null) return `g1.${now.seed >>> 0}`;
    }
    const s = saved[0];
    if (s && COURSE_RE.test(`${s.id}.v${s.version}`)) return `${s.id}.v${s.version}`;
    return `g1.${newSeed >>> 0}`;
}

/** A course id back to what the page builds; null for one it does not know. */
export function parseCourse(id: string): CourseRef | null {
    if (!COURSE_RE.test(id)) return null;
    const g = /^g1\.(\d{1,10})$/.exec(id);
    if (g) {
        const seed = Number(g[1]);
        return seed <= 0xffffffff ? { kind: 'seed', seed } : null;
    }
    const v = /^(.+)\.v(\d{1,9})$/.exec(id);
    return v ? { kind: 'saved', id: v[1]!, version: Number(v[2]) } : null;
}

/** The marks of the countdown, ms before the start: 10, 3, 2, 1, go (rooms-plan.md 2.4). */
export const COUNT_MARKS: readonly number[] = [10000, 3000, 2000, 1000, 0];

/**
 * The countdown on the page's own clock (the server's ms through the room's ServerClock). `due(leftMs)` gives each mark's line
 * once, in order; a page that comes late says only the last mark passed (no burst of numbers).
 */
export class Countdown {
    private next = 0;
    constructor(private readonly marks: readonly number[] = COUNT_MARKS) {}

    due(leftMs: number): { key: string; params: Record<string, number> } | null {
        let hit = -1;
        while (this.next < this.marks.length && leftMs <= this.marks[this.next]!) hit = this.next++;
        if (hit < 0) return null;
        const m = this.marks[hit]!;
        return m === 0 ? { key: 'rooms.race.go', params: {} } : { key: 'rooms.race.count', params: { n: Math.round(m / 1000) } };
    }

    get over(): boolean {
        return this.next >= this.marks.length;
    }
}

/**
 * The laps a page reports: only laps that end after the start (the course's clock is reset at go, so a lap that began before
 * it is never one of them), numbered 1, 2, ... up to the race's laps.
 */
export class RaceLaps {
    private n = 0;
    constructor(private readonly laps: number) {}

    /** a lap event of the course (`lap` or `done`) with the lap's ms; null when it is not reported */
    feed(ev: string | null, lastLapMs: number | null, started: boolean): { n: number; ms: number } | null {
        if (!started || (ev !== 'lap' && ev !== 'done') || lastLapMs === null || this.n >= this.laps) return null;
        const ms = Math.round(lastLapMs);
        if (!(ms > 0)) return null;
        return { n: ++this.n, ms };
    }

    get count(): number {
        return this.n;
    }
}

/** Seconds as the lines say them: one decimal. */
export function secs(ms: number): string {
    return (Math.max(0, ms) / 1000).toFixed(1);
}

/** The line a race message makes on this page (said and shown), or null for none (the countdown has its own lines). */
export function raceLine(m: RaceMsg, slot: number | null, nickOf: (slot: number) => string): { key: string; params: Record<string, string | number> } | null {
    const table = m.table ?? [];
    switch (m.state) {
        case 'prep':
            return { key: 'rooms.race.prep', params: { nick: nickOf(m.by ?? -1), laps: m.laps ?? 1 } };
        case 'lap': {
            const row = table.find((r) => r.slot === m.slot);
            if (!row) return null;
            if (m.slot === slot) {
                return row.gapMs === null || row.place === 1
                    ? { key: 'rooms.race.myLap', params: { n: m.n ?? row.laps, time: secs(m.ms ?? 0), place: row.place } }
                    : { key: 'rooms.race.myLapGap', params: { n: m.n ?? row.laps, time: secs(m.ms ?? 0), place: row.place, gap: secs(row.gapMs) } };
            }
            return row.done ? { key: 'rooms.race.finished', params: { nick: row.nick, place: row.place, time: secs(row.totalMs) } } : null;
        }
        case 'results': {
            const first = table[0];
            if (!first || first.laps === 0) return { key: 'rooms.race.noTimes', params: {} };
            const me = table.find((r) => r.slot === slot);
            return me && me.slot !== first.slot && me.laps > 0
                ? { key: 'rooms.race.resultsMe', params: { nick: first.nick, time: secs(first.totalMs), place: me.place } }
                : { key: 'rooms.race.results', params: { nick: first.nick, time: secs(first.totalMs) } };
        }
        default:
            return null;
    }
}

/** The table as rows of text (the HUD and the panel): place, name, laps, total, best, gap. */
export function tableRows(table: readonly RaceRow[]): string[][] {
    return table.map((r) => [String(r.place), r.nick, String(r.laps), r.laps ? secs(r.totalMs) : '-', r.bestMs === null ? '-' : secs(r.bestMs), r.gapMs === null ? '' : `+${secs(r.gapMs)}`]);
}
