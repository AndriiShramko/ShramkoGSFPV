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

    /** One spoken line, newest last; the oldest goes when there are more than CAPTION_LINES. */
    add(text: string): void {
        if (this.root.hidden || text.trim() === '') return;
        const line = h('p', { class: 'sonic-caption' }, text);
        this.root.append(line);
        while (this.root.children.length > CAPTION_LINES) this.drop(this.root.firstElementChild as HTMLElement);
        this.timers.set(line, setTimeout(() => this.drop(line), CAPTION_MS));
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
