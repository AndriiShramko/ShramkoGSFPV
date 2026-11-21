// Lane quiet2 (the lead's N4): with the narrator off in a flight nothing the page says by itself reaches a screen reader. The page's
// live region #ui (index.html: aria-live polite) carries the HUD's text, the course box and the walls box, and the walls box holds a
// live region of its own (walls.ts bake-status): while the flight is quiet (the narrator off, or a lesson running: LessonHold) each
// of them is set to aria-live "off", and given back its own value when it is not. The captions are outside #ui (captions.ts keeps their own setting), so K's and I's lines still reach them.

import { LIVE_SAVED } from './entry-state';
import type { LoggedMessage } from '../messages-logic';

// lane quiet3 (M4): the same name as the shim's quietAtPress, so a region quieted at the Backslash press is taken over here
const SAVED = LIVE_SAVED;

/** What the sync needs of an element (a test passes a small fake). */
export interface LiveElement {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    querySelectorAll(selector: string): ArrayLike<LiveElement>;
}

/**
 * Lane tutor-say (the outside pilot's point 1, decision 1 "say only what is new"): while a lesson runs, #ui announces nothing. The
 * page's flight text (the HUD's DISARMED, angle, volts, timer, THR/ALT; the REC bar) changed 37 to 40 times in every 3 s of a step
 * (evidence/2026-11-20/tutor-say/ax-base.json), so a screen reader read the HUD between the lesson's lines. The lesson's own words go
 * through the captions (outside #ui); the HUD's news (ui/messages.ts tell(): a crash, a problem) is relayed there while held
 * (captions.ts relayHeldNews). Held by the progress panel's follower (progress-panel.ts followProgress): a lesson shown and the
 * flight not paused; a pause, a menu, a replay give #ui its words back, as the narrator-off rule does.
 */
export class LessonHold {
    private on = false;

    /** A lesson runs and the flight goes on: #ui stays quiet. */
    get held(): boolean {
        return this.on;
    }

    set(on: boolean): void {
        this.on = on;
    }
}

/** The page's one hold (like ui/messages.ts `messages`): set by followProgress, read by every quietLiveRegion and the captions. */
export const lessonHold = new LessonHold();

/**
 * The sync of #ui with the narrator: call it when the setting may have changed (feature.ts calls it on a timer). Quiet: the root and
 * every live region inside it go "off", their own value kept in data-sonic-live; not quiet: the kept value comes back. `restore`
 * gives every value back (the mode leaving the page). Quiet is the caller's rule or the lesson hold (LessonHold).
 */
export function quietLiveRegion(root: LiveElement | null, rule: () => boolean, hold: { readonly held: boolean } = lessonHold): { sync(): void; tick(): void; restore(): void } {
    const quiet = (): boolean => rule() || hold.held;
    const quietOne = (el: LiveElement): void => {
        if (el.getAttribute(SAVED) !== null) return;
        el.setAttribute(SAVED, el.getAttribute('aria-live') ?? '');
        el.setAttribute('aria-live', 'off');
    };
    const restoreOne = (el: LiveElement): void => {
        const had = el.getAttribute(SAVED);
        if (had === null) return;
        if (had === '') el.removeAttribute('aria-live');
        else el.setAttribute('aria-live', had);
        el.removeAttribute(SAVED);
    };
    const all = (r: LiveElement): LiveElement[] => [r, ...Array.from(r.querySelectorAll(`[aria-live], [${SAVED}]`))];
    const restore = (): void => {
        if (root) for (const el of all(root)) restoreOne(el);
    };
    let last: boolean | null = null;
    const sync = (): void => {
        if (!root) return;
        last = quiet();
        if (last) for (const el of all(root)) quietOne(el);
        else restore();
    };
    return {
        sync,
        // W2 finding (b): called every frame (feature.ts), after the HUD wrote its text and before the frame ends, so the first
        // frame of a quiet flight is not announced; cheap: it acts only when the answer changed
        tick(): void {
            if (quiet() !== last) sync();
        },
        restore
    };
}

/**
 * W2 finding (b): the pause that gives #ui its words back. K's key help holds the flight (pause reason 'help') and says its lines
 * through the captions, outside #ui, so that hold alone keeps #ui quiet; a menu, a panel or a replay give the words back.
 */
export function liveRegionPaused(paused: boolean, reasons: readonly string[]): boolean {
    return paused && !(reasons.length > 0 && reasons.every((r) => r === 'help'));
}

/** The page's news (ui/messages.ts): told to the pilot in #ui's message stack. */
export interface PageNews {
    watch(fn: () => void): () => void;
    /** the lines on the screen now */
    shown(): readonly LoggedMessage[];
}

/**
 * Lane tutor-say (plan Part D risk 4): while a lesson holds #ui quiet (LessonHold) the HUD's news (a crash, a problem
 * and what to do) still reaches a screen reader: each new line told while held is added to the captions (captions.ts wires it) when a screen reader reads
 * them (live). Not held, #ui says it itself and nothing is added (no line twice). A line is new when its id or its time is.
 */
export function relayHeldNews(captions: { add(text: string): void; readonly current: { readonly live: boolean } }, news: PageNews, hold: { readonly held: boolean } = lessonHold): () => void {
    const seen = new Map<number, number>();
    return news.watch(() => {
        const relay = hold.held && captions.current.live;
        for (const e of news.shown()) {
            if (seen.get(e.id) === e.at) continue;
            seen.set(e.id, e.at);
            if (relay) captions.add(e.kind === 'problem' && e.fix ? `${e.text} ${e.fix}` : e.text);
        }
    });
}
