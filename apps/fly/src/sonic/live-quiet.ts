// Lane quiet2 (the lead's N4): with the narrator off in a flight nothing the page says by itself reaches a screen reader. The page's
// live region #ui (index.html: aria-live polite) carries the HUD's text, the course box and the walls box, and the walls box holds a
// live region of its own (walls.ts bake-status): while the flight is quiet each of them is set to aria-live "off", and given back its
// own value when it is not. The captions are outside #ui (captions.ts keeps their own setting), so K's and I's lines still reach them.

const SAVED = 'data-sonic-live';

/** What the sync needs of an element (a test passes a small fake). */
export interface LiveElement {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    querySelectorAll(selector: string): ArrayLike<LiveElement>;
}

/**
 * The sync of #ui with the narrator: call it when the setting may have changed (feature.ts calls it on a timer). Quiet: the root and
 * every live region inside it go "off", their own value kept in data-sonic-live; not quiet: the kept value comes back. `restore`
 * gives every value back (the mode leaving the page).
 */
export function quietLiveRegion(root: LiveElement | null, quiet: () => boolean): { sync(): void; tick(): void; restore(): void } {
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
