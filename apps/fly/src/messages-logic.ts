// The one message service of the flight page, its rules without a page (lane ux4a, complaint U1: "the
// messages are tiny and gone before I read them; if it is a problem I must know what it is and whom to tell").
// Every line for the pilot goes through ui/messages.ts tell(); this file decides how long a line stays, which
// lines are on the screen and keeps the last ones for the Messages list. Pure, so Node tests run it
// (tools/bench/test/messages-logic.test.ts).

/** info: what a key or a feature just did; done: a job finished; problem: something failed (stays until closed); progress: a job at work (replaced in place by its key). */
export type MessageKind = 'info' | 'done' | 'problem' | 'progress';

/** One line for the pilot. */
export interface PilotMessage {
    text: string;
    /** default 'info' */
    kind?: MessageKind;
    /** a later message with the same key replaces this one in place while it is on the screen (progress lines, then their result) */
    key?: string;
    /** the feature that wrote it (course, walls, ...): it goes into the report to the author */
    from?: string;
    /** what to do: shown under a problem */
    fix?: string;
}

/** A message as the log keeps it. */
export interface LoggedMessage {
    /** unique, kept when a message with the same key replaces the text */
    id: number;
    /** ms (performance or Date clock: the caller's, the same one for every call) of the last write */
    at: number;
    kind: MessageKind;
    text: string;
    fix?: string;
    from?: string;
    key?: string;
    /** the scene id at the last write */
    scene?: string;
    /** the clock time the line leaves the screen; Infinity: until closed */
    until: number;
    /** ms left when the timer was paused (pointer over the line), else null */
    pausedLeft: number | null;
    /** closed by its cross or gone by time: it stays in the list only */
    gone: boolean;
    /** a problem the pilot has not seen in the list or closed yet */
    unread: boolean;
}

/** What the screen shows now: at most MAX_VISIBLE lines, problems first, and how many more are waiting in the list. */
export interface VisibleMessages {
    lines: LoggedMessage[];
    more: number;
}

export const BASE_MS = 3000;
export const MS_PER_CHAR = 70;
export const MIN_SHOWN_MS = 4000;
export const MAX_SHOWN_MS = 15000;
/** a progress line leaves this long after its last update (a job that stopped writing) */
export const PROGRESS_IDLE_MS = 8000;
export const LOG_SIZE = 50;
export const MAX_VISIBLE = 3;

/** How long a message stays on the screen: long enough to read it (about 14 characters a second, plus a start), a problem until closed. */
export function shownMs(m: PilotMessage): number {
    const kind = m.kind ?? 'info';
    if (kind === 'problem') return Infinity;
    if (kind === 'progress') return PROGRESS_IDLE_MS;
    const chars = m.text.length + (m.fix?.length ?? 0);
    return Math.min(MAX_SHOWN_MS, Math.max(MIN_SHOWN_MS, BASE_MS + MS_PER_CHAR * chars));
}

/**
 * Where the lines stand (fly.css .hud-note.msg-side): a wide view keeps them top centre under the top row and their
 * bottom above the first third of the height; a narrow or low view (a phone on its side) puts them in the left third,
 * out of the middle third, and down to 60 % of the height at most (the sticks are below).
 */
export function messagePlace(viewW: number, viewH: number): { side: boolean; maxBottom: number } {
    const side = viewW < 900 || viewH < 500;
    return { side, maxBottom: Math.round(viewH * (side ? 0.6 : 1 / 3)) };
}

/** The text a "Send to the author" report starts with. */
export function reportText(m: Pick<LoggedMessage, 'text' | 'fix' | 'from' | 'scene'>): string {
    return [m.text, m.fix, m.from ? `from: ${m.from}` : '', m.scene ? `scene: ${m.scene}` : ''].filter(Boolean).join('\n');
}

/** The last LOG_SIZE messages, newest last; decides what is on the screen. */
export class MessageLog {
    private items: LoggedMessage[] = [];
    private nextId = 1;

    constructor(readonly size = LOG_SIZE) {}

    /**
     * Writes a message. A line on the screen with the same key, or the same kind and text, is updated in place
     * (same id, new text and time) instead of a second line.
     */
    add(m: PilotMessage, now: number, scene?: string): LoggedMessage {
        const kind = m.kind ?? 'info';
        const same = this.items.find((e) => this.live(e, now) && (m.key ? e.key === m.key : !e.key && e.kind === kind && e.text === m.text));
        const until = now + shownMs({ ...m, kind });
        if (same) {
            Object.assign(same, { at: now, kind, text: m.text, fix: m.fix, from: m.from ?? same.from, scene, until, pausedLeft: null });
            if (kind === 'problem') same.unread = true;
            return same;
        }
        const e: LoggedMessage = { id: this.nextId++, at: now, kind, text: m.text, fix: m.fix, from: m.from, key: m.key, scene, until, pausedLeft: null, gone: false, unread: kind === 'problem' };
        this.items.push(e);
        if (this.items.length > this.size) this.items.splice(0, this.items.length - this.size);
        return e;
    }

    /** On the screen now. */
    live(e: LoggedMessage, now: number): boolean {
        return !e.gone && (e.pausedLeft !== null || e.until > now);
    }

    /** The cross: the line leaves the screen, stays in the list. */
    close(id: number): void {
        const e = this.find(id);
        if (e) { e.gone = true; e.unread = false; }
    }

    /** The pointer is over the line: its time stops. */
    pause(id: number, now: number): void {
        const e = this.find(id);
        if (e && e.pausedLeft === null && Number.isFinite(e.until)) e.pausedLeft = Math.max(0, e.until - now);
    }

    /** The pointer left: the time left runs on, never less than a second. */
    resume(id: number, now: number): void {
        const e = this.find(id);
        if (e && e.pausedLeft !== null) { e.until = now + Math.max(1000, e.pausedLeft); e.pausedLeft = null; }
    }

    /** At most `max` lines: problems first, then the newest. */
    visible(now: number, max = MAX_VISIBLE): VisibleMessages {
        const live = this.items.filter((e) => this.live(e, now));
        live.sort((a, b) => (a.kind === 'problem' ? 0 : 1) - (b.kind === 'problem' ? 0 : 1) || b.at - a.at || b.id - a.id);
        return { lines: live.slice(0, max), more: Math.max(0, live.length - max) };
    }

    /** The clock time of the next change on the screen (a line leaving), Infinity when none. */
    nextChange(now: number): number {
        let next = Infinity;
        for (const e of this.items) if (this.live(e, now) && e.pausedLeft === null && e.until < next) next = e.until;
        return next;
    }

    /** Every kept message, newest first (the Messages list). */
    all(): LoggedMessage[] {
        return [...this.items].sort((a, b) => b.at - a.at || b.id - a.id);
    }

    /** Problems not seen yet (the count on the Messages button). */
    unreadProblems(): number {
        return this.items.filter((e) => e.unread).length;
    }

    /** The list was opened: every problem counts as seen. */
    markRead(): void {
        for (const e of this.items) e.unread = false;
    }

    find(id: number): LoggedMessage | undefined {
        return this.items.find((e) => e.id === id);
    }
}
