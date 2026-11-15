// Captions of everything Fly by Sound says (v0.12, docs/wip/v12-plan.md 4.2 step 7; spec section 6): a region on the
// page, outside #ui (which is one aria-live region for the flight's own notes), showing the last few spoken lines for
// the sighted helper. It is also how a screen reader hears the lines when "my screen reader speaks" is on
// (SonicPrefs.selfVoice false: the engine does not voice them, it only reports them): then the region is a polite
// live region and stays in the accessibility tree even when the captions are hidden from the eye. With the engine
// speaking, the region is not live, so a screen reader does not say every line twice.
import { h } from '../ui/dom';
import { t } from '../i18n';
import './sonic.css';

/**
 * How many lines show at once, and how long a line stays, ms. Lane quiet3 (the lead's M2): "at most two lines" is two rows of text on
 * the screen: the newest line alone, clamped to CAPTION_ROWS rows by sonic.css (the whole text stays in the page for a screen
 * reader); an older line leaves the eye when a new one comes.
 */
export const CAPTION_LINES = 1;
/** The rows the line shown takes at most (sonic.css .sonic-caption -webkit-line-clamp). */
export const CAPTION_ROWS = 2;
export const CAPTION_MS = 12000;
/**
 * Lines the region holds at most while a screen reader reads it. A lesson says four to six lines in one go when it opens; a line
 * taken out of the region in the task it was put in is never in the accessibility tree, so with a screen reader as the only voice
 * the pilot would miss the title and the first lines. The oldest beyond CAPTION_LINES are hidden from the eye, not from the tree.
 */
export const CAPTION_KEEP_LIVE = 24;
/** The mode's panels the captions stay clear of (progress-panel.ts, look-panels.ts), and by how much, px (v13-int review K2). */
export const PANELS = '.sonic-progress, .sonic-sounds, .sonic-attitude';
export const CAPTION_GAP_PX = 8;
/**
 * The course's clock block (course/hud.ts, top centre). Lane quiet2 (N6): the captions never cover it; while it is shown and meets
 * the region's columns, the region starts CAPTION_GAP_PX under its bottom (the lead saw three lines over the clock).
 */
export const CLOCK = '.course-hud';
/**
 * How far over the view's centre the lines shown end at the lowest, px: the target is there (the lessons' page proof's bound,
 * tools/bench/src/sonic-lessons-page.ts). v13-int review K2, part 2: the captions' column right of the panels is narrower than the
 * centred one was, a line wrapped once more, and four lines of hover-height ended 5 px over the centre at 1280 x 720.
 */
export const CENTRE_GAP_PX = 20;

interface Box {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

/** A line's box meets one of the boxes. */
const meets = (r: Box, boxes: readonly Box[]): boolean => boxes.some((b) => r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom);

/** What the region is for now: shown to the eye (SonicPrefs.captions) and read by a screen reader (not selfVoice). */
export interface CaptionMode {
    readonly visible: boolean;
    readonly live: boolean;
}

export class Captions {
    readonly root: HTMLElement;
    private mode: CaptionMode = { visible: true, live: false };
    private timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    constructor(parent: HTMLElement = document.body) {
        this.root = h('div', { class: 'sonic-captions', 'data-testid': 'sonic-captions', role: 'log', 'aria-label': t('sonic.captions.label'), 'aria-live': 'off', 'aria-atomic': 'false' });
        parent.append(this.root);
        this.apply();
    }

    /** Shown to the eye and/or read by a screen reader. Both off: nothing on the page at all. */
    configure(mode: CaptionMode): void {
        this.mode = mode;
        this.apply();
        this.fit();
    }

    get current(): CaptionMode {
        return this.mode;
    }

    private apply(): void {
        const { visible, live } = this.mode;
        this.root.setAttribute('aria-live', live ? 'polite' : 'off');
        this.root.classList.toggle('sonic-sr-only', !visible && live);
        this.root.hidden = !visible && !live;
        // with nothing to read or see, no line is kept for later
        if (this.root.hidden) this.clear();
    }

    /**
     * One spoken line, newest last. The eye sees the last CAPTION_LINES. While a screen reader reads the region (live) the older
     * lines of a burst stay in it, hidden from the eye (see CAPTION_KEEP_LIVE); else the oldest go at once, as before.
     */
    add(text: string, o: { readonly live?: boolean } = {}): void {
        if (this.root.hidden || text.trim() === '') return;
        // a line for the eye only (the narrator off, train 3): not shown, nothing; shown, hidden from a screen reader
        const eyeOnly = o.live === false;
        if (eyeOnly && !this.mode.visible) return;
        const line = h('p', { class: 'sonic-caption', ...(eyeOnly && this.mode.live ? { 'aria-hidden': 'true' } : {}) }, text);
        this.root.append(line);
        this.timers.set(line, setTimeout(() => this.drop(line), CAPTION_MS));
        this.fit();
    }

    /**
     * What the region holds: the last CAPTION_LINES shown; with a screen reader reading it up to CAPTION_KEEP_LIVE, the older hidden from
     * the eye. And never over the mode's panels (v13-int review K2: the longer lines of Spanish, Polish and Russian reached the progress
     * panel and the attitude display): while a line shown meets one of PANELS (within CAPTION_GAP_PX of it), or ends lower than
     * CENTRE_GAP_PX over the view's centre (review K2, part 2: the target), the oldest line shown is hidden from the eye too (still in
     * the region for a screen reader) and the others move up, so the newest line is whole and the panels and the view's centre stay
     * clear at every page size and in every language.
     */
    private fit(): void {
        const keep = this.mode.live ? CAPTION_KEEP_LIVE : CAPTION_LINES;
        while (this.root.children.length > keep) this.drop(this.root.firstElementChild as HTMLElement);
        const lines = [...this.root.children];
        lines.forEach((el, i) => el.classList.toggle('sonic-sr-only', i < lines.length - CAPTION_LINES));
        if (this.root.hidden || !this.mode.visible) return;
        this.underClock();
        const panels = this.panelBoxes();
        const floor = this.centreFloor();
        if (panels.length === 0 && floor === null) return;
        const inTheWay = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            return meets(r, panels) || (floor !== null && r.bottom > floor);
        };
        let shown = lines.filter((el) => !el.classList.contains('sonic-sr-only'));
        while (shown.length > 1 && shown.some(inTheWay)) {
            (shown[0] as Element).classList.add('sonic-sr-only');
            shown = shown.slice(1);
        }
    }

    /** The lowest a line shown may end: CENTRE_GAP_PX over the view's centre (null on a page without layout, a test's). */
    private centreFloor(): number | null {
        if (typeof this.root.getBoundingClientRect !== 'function') return null;
        const height = this.root.ownerDocument.defaultView?.innerHeight ?? 0;
        return height > 0 ? height / 2 - CENTRE_GAP_PX : null;
    }

    /** The panels on the page now, each grown by CAPTION_GAP_PX (none on a page without layout, a test's). */
    private panelBoxes(): Box[] {
        if (typeof this.root.getBoundingClientRect !== 'function') return [];
        const out: Box[] = [];
        for (const el of this.root.ownerDocument.querySelectorAll<HTMLElement>(PANELS)) {
            if (el.hidden) continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            out.push({ left: b.left - CAPTION_GAP_PX, right: b.right + CAPTION_GAP_PX, top: b.top - CAPTION_GAP_PX, bottom: b.bottom + CAPTION_GAP_PX });
        }
        return out;
    }

    /**
     * The region in its own place (the stylesheet's top), or under the course's clock block while that is shown and meets the region's
     * columns (a hidden block, display none, has no box). Nothing on a page without layout or style (a test's stand-in without them).
     */
    private underClock(): void {
        const style = (this.root as { style?: { top: string } }).style;
        if (!style || typeof this.root.getBoundingClientRect !== 'function') return;
        style.top = '';
        const r = this.root.getBoundingClientRect();
        for (const el of this.root.ownerDocument.querySelectorAll<HTMLElement>(CLOCK)) {
            const c = el.getBoundingClientRect();
            if (c.width === 0 || c.height === 0) continue;
            if (r.right > c.left && r.left < c.right && c.bottom + CAPTION_GAP_PX > r.top) style.top = `${Math.ceil(c.bottom + CAPTION_GAP_PX)}px`;
        }
    }

    /** The page changed size: what fits is measured again (a line hidden in a short window comes back in a taller one). */
    refit(): void {
        this.fit();
    }

    /** The lines on the page now, oldest first. */
    lines(): string[] {
        return [...this.root.children].map((c) => c.textContent ?? '');
    }

    private drop(line: HTMLElement | null): void {
        if (!line) return;
        const timer = this.timers.get(line);
        if (timer !== undefined) clearTimeout(timer);
        this.timers.delete(line);
        line.remove();
    }

    clear(): void {
        for (const line of [...this.root.children]) this.drop(line as HTMLElement);
    }

    dispose(): void {
        this.clear();
        this.root.remove();
    }
}
