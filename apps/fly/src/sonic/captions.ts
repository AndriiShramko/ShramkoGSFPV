// Captions of everything Fly by Sound says (v0.12, docs/wip/v12-plan.md 4.2 step 7; spec section 6): a region on the
// page, outside #ui (which is one aria-live region for the flight's own notes), showing the last few spoken lines for
// the sighted helper. It is also how a screen reader hears the lines when "my screen reader speaks" is on
// (SonicPrefs.selfVoice false: the engine does not voice them, it only reports them): then the region is a polite
// live region and stays in the accessibility tree even when the captions are hidden from the eye. With the engine
// speaking, the region is not live, so a screen reader does not say every line twice.
import { h } from '../ui/dom';
import { t } from '../i18n';
import './sonic.css';

/** How many lines show at once, and how long a line stays, ms. */
export const CAPTION_LINES = 3;
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
    add(text: string): void {
        if (this.root.hidden || text.trim() === '') return;
        const line = h('p', { class: 'sonic-caption' }, text);
        this.root.append(line);
        this.timers.set(line, setTimeout(() => this.drop(line), CAPTION_MS));
        this.fit();
    }

    /**
     * What the region holds: the last CAPTION_LINES shown; with a screen reader reading it up to CAPTION_KEEP_LIVE, the older hidden from
     * the eye. And never over the mode's panels (v13-int review K2: the longer lines of Spanish, Polish and Russian reached the progress
     * panel and the attitude display): while a line shown meets one of PANELS (within CAPTION_GAP_PX of it), the oldest line shown is hidden
     * from the eye too (still in the region for a screen reader) and the others move up, so the newest line is whole and the panels stay
     * clear at every page size and in every language.
     */
    private fit(): void {
        const keep = this.mode.live ? CAPTION_KEEP_LIVE : CAPTION_LINES;
        while (this.root.children.length > keep) this.drop(this.root.firstElementChild as HTMLElement);
        const lines = [...this.root.children];
        lines.forEach((el, i) => el.classList.toggle('sonic-sr-only', i < lines.length - CAPTION_LINES));
        if (this.root.hidden || !this.mode.visible) return;
        const panels = this.panelBoxes();
        if (panels.length === 0) return;
        let shown = lines.filter((el) => !el.classList.contains('sonic-sr-only'));
        while (shown.length > 1 && shown.some((el) => meets(el.getBoundingClientRect(), panels))) {
            (shown[0] as Element).classList.add('sonic-sr-only');
            shown = shown.slice(1);
        }
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
