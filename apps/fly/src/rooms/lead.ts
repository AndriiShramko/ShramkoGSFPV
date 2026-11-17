// Lane race, L3 and L4: the live board of best laps and the lead change, pure logic (the screen is rooms/board-view.ts).
// The board is shown while two or more pilots are in the room and the room has a course; it is ordered by the best lap
// (rooms/board.ts orderRows: an equal best keeps the pilot who flew it first above). A lap that is better than every best
// of the room before it takes the lead: a banner says who leads now and with what time for BANNER_MS.
import type { BoardRow, LapMsg } from './board';

/** How long the lead banner stays, ms (estimate: L4 asks for about 2 s; a line of four words is read in about 1 s). */
export const BANNER_MS = 2000;
/** The rows' move when the order changes, ms (estimate: short enough to end before the next lap, long enough to be seen). */
export const MOVE_MS = 300;

/** A lap time as the board and the banner write it: m:ss.cc (41270 -> 0:41.27). */
export function fmtLap(ms: number): string {
    const cs = Math.max(0, Math.round(ms / 10));
    const m = Math.floor(cs / 6000);
    const s = Math.floor((cs % 6000) / 100);
    const c = cs % 100;
    return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Whether the board is shown: a course in the room, two or more pilots in it, not under the pause menu. */
export function boardShown(course: string | null, pilots: number, paused: boolean): boolean {
    return course !== null && pilots >= 2 && !paused;
}

/** One row of the board on the screen. */
export interface ViewRow { slot: number; place: number | null; nick: string; best: string; laps: number; mine: boolean }

/**
 * The board's rows: the pilots with a lap in the order of their best lap, then the pilots in the room without a lap yet
 * (no place, in the order of their slots). Rows of pilots who left are not shown.
 */
export function viewRows(rows: readonly BoardRow[], members: readonly { slot: number; nick: string }[], mySlot: number | null): ViewRow[] {
    const inRoom = new Set(members.map((m) => m.slot));
    const out: ViewRow[] = [];
    for (const r of rows) {
        if (!inRoom.has(r.slot)) continue;
        out.push({ slot: r.slot, place: out.length + 1, nick: r.nick, best: fmtLap(r.best), laps: r.laps, mine: r.slot === mySlot });
    }
    const flown = new Set(out.map((r) => r.slot));
    for (const m of [...members].sort((a, b) => a.slot - b.slot)) {
        if (!flown.has(m.slot)) out.push({ slot: m.slot, place: null, nick: m.nick, best: '-', laps: 0, mine: m.slot === mySlot });
    }
    return out;
}

/** The lead change a lap makes, or null: its time must be below every best of the room before it (an equal time keeps the first). */
export interface Lead { slot: number; nick: string; ms: number; mine: boolean }

export function leadChange(before: readonly BoardRow[], lap: Pick<LapMsg, 'slot' | 'nick' | 'ms'>, mySlot: number | null): Lead | null {
    if (!(lap.ms > 0)) return null;
    let best = Infinity;
    for (const r of before) if (r.best < best) best = r.best;
    if (!(lap.ms < best)) return null;
    return { slot: lap.slot, nick: lap.nick, ms: lap.ms, mine: lap.slot === mySlot };
}

/** The banner's text key and its values: 'NAME leads, 0:41.27', the pilot's own takeover in its own words. */
export function leadLine(l: Lead): { key: string; vars: { nick: string; time: string } } {
    return { key: l.mine ? 'rooms.lead.mine' : 'rooms.lead.other', vars: { nick: l.nick, time: fmtLap(l.ms) } };
}

/** The banner's state: one lead change at a time, the newest replaces the one shown. */
export class LeadBanner {
    private shown: { lead: Lead; until: number } | null = null;

    show(lead: Lead, now: number): void {
        this.shown = { lead, until: now + BANNER_MS };
    }

    /** The lead shown at `now`, null once BANNER_MS passed. */
    at(now: number): Lead | null {
        if (this.shown && now >= this.shown.until) this.shown = null;
        return this.shown?.lead ?? null;
    }

    clear(): void {
        this.shown = null;
    }
}
