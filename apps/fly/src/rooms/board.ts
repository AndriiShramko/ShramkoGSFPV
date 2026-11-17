// Lane race, L1 and L2 (docs/rooms-protocol.md "The room's course and the board of best laps"): the room's course and its
// board on the page. Pure logic: the rooms feature feeds it the service's messages and, once a frame, what the course
// feature says about itself (ctx.hook.course, read through CourseLook only: the course chunk is not imported here), and
// sends what it answers. A course made on this page (Shift+G) becomes the room's; the room's course is built here when the
// page flies another one; each lap the course feature counts on the room's course goes to the service.
import { courseFor, parseCourse } from './race';
import type { CourseRef } from './race';

/** What the board reads from the course feature's hook (apps/fly/src/course/hook.ts). */
export interface CourseLook {
    on: boolean;
    source: 'none' | 'generated' | 'server';
    track: { id: string; version: number } | null;
    seed: number | null;
    laps: number;
    lastLapMs: number | null;
}

export interface BoardRow { slot: number; nick: string; best: number; laps: number }
export interface BoardMsg { type: 'board'; course: string | null; by?: number; rows: BoardRow[]; refused?: boolean }
export interface LapMsg { type: 'blap'; course: string; slot: number; nick: string; n: number; ms: number; best: number; lead: boolean }

/** What the page sends or does after a look at the course feature. */
export type BoardStep = { kind: 'course'; course: string } | { kind: 'lap'; course: string; n: number; ms: number } | null;

/** The id the course feature's course has in a room ('g1.<seed>' or '<id>.v<n>'), null without a course. */
export function courseId(c: CourseLook | null | undefined): string | null {
    if (!c?.on || !c.track) return null;
    if (c.source === 'generated' && c.seed === null) return null;
    return courseFor(c, [], 0);
}

/** Rows ordered by the best lap; an equal best keeps the order it had (the first who flew it stays above). */
export function orderRows(rows: readonly BoardRow[]): BoardRow[] {
    return rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.best - b.r.best || a.i - b.i).map((x) => x.r);
}

export class RoomBoard {
    /** the room's course, null while the room has none */
    course: string | null = null;
    rows: BoardRow[] = [];
    /** laps this page reported on the room's course */
    sent = 0;
    /** the course this page asked the course feature to build for the room, until it shows */
    adopting: string | null = null;
    private local: string | null = null;
    private seen = 0;

    constructor(private readonly mySlot: () => number | null) {}

    /** A board message or the welcome's board. Returns the course to build here when the page flies another one. */
    onBoard(m: BoardMsg | null | undefined): CourseRef | null {
        if (!m) return null;
        if (m.course !== this.course) this.adopting = null;
        this.course = m.course;
        this.rows = orderRows(m.rows ?? []);
        const me = this.mySlot();
        this.sent = this.rows.find((r) => r.slot === me)?.laps ?? 0;
        if (!m.course || m.course === this.local || m.course === this.adopting) return null;
        const ref = parseCourse(m.course);
        if (ref) this.adopting = m.course;
        return ref;
    }

    /** A lap of a member (this page's own too). Returns the message when it is on the room's course. */
    onLap(m: LapMsg): LapMsg | null {
        if (m.course !== this.course) return null;
        const row = this.rows.find((r) => r.slot === m.slot);
        if (row) Object.assign(row, { nick: m.nick, best: m.best, laps: m.n });
        else this.rows.push({ slot: m.slot, nick: m.nick, best: m.best, laps: m.n });
        this.rows = orderRows(this.rows);
        if (m.slot === this.mySlot()) this.sent = Math.max(this.sent, m.n);
        return m;
    }

    /** A member left: the service sends the board again; nothing to do here. One look at the course feature: */
    look(c: CourseLook | null | undefined): BoardStep {
        const id = courseId(c);
        const laps = c?.laps ?? 0;
        if (id !== this.local) {
            this.local = id;
            this.seen = laps;
            if (id === this.adopting) this.adopting = null;
            // a course made on this page (not the room's, not the one asked for) becomes the room's
            if (id !== null && id !== this.course && this.adopting === null) return { kind: 'course', course: id };
            return null;
        }
        if (laps < this.seen) this.seen = laps;
        if (id === null || id !== this.course || laps <= this.seen) return null;
        this.seen = laps;
        const ms = c?.lastLapMs;
        if (typeof ms !== 'number' || !(ms > 0)) return null;
        this.sent += 1;
        return { kind: 'lap', course: id, n: this.sent, ms: Math.round(ms) };
    }
}
