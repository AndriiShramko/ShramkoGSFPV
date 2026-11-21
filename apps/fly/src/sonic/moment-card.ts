// The card of a moment (train 4, lane tutor-air; decision 9 of the brief, for low-vision pilots such as the one whose feedback of
// 2026-11-20 started this train): while the flight is frozen for a new sound the screen shows ONE large high-contrast line, the
// sentence being spoken, and the sound's name (the package's `cue.<id>.name`, never typed here), nothing else: the panels and the
// captions are faded out under it (body class MOMENT_BODY_CLASS, sonic.css), not removed, so a screen reader keeps the captions.
// The card is aria-hidden: the line is announced once, through the captions (captions.ts), never a second live region.
// moment-host.ts says when (onView); the mode's speech events say what is spoken (said()).
import type { CueId, MomentView } from '@shramko/sonic-fpv';

/** On <body> while a moment holds the flight: sonic.css fades the panels and the captions out under the card. */
export const MOMENT_BODY_CLASS = 'sonic-in-moment';

export class MomentCard {
    readonly el: HTMLElement;
    private readonly line: HTMLElement;
    private readonly sound: HTMLElement;
    private cue: CueId | null = null;

    /** `name`: the sound's name in the pilot's language (the package's `cue.<id>.name`). */
    constructor(
        private readonly doc: Document,
        parent: HTMLElement,
        private readonly name: (cue: CueId) => string
    ) {
        this.el = doc.createElement('div');
        this.el.className = 'sonic-moment';
        this.el.dataset.testid = 'sonic-moment';
        this.el.setAttribute('aria-hidden', 'true');
        this.el.hidden = true;
        this.sound = doc.createElement('p');
        this.sound.className = 'sonic-moment-sound';
        this.sound.dataset.testid = 'sonic-moment-sound';
        this.line = doc.createElement('p');
        this.line.className = 'sonic-moment-line';
        this.line.dataset.testid = 'sonic-moment-line';
        this.el.append(this.sound, this.line);
        parent.append(this.el);
    }

    /** Whether the card is on the screen. */
    get shown(): boolean {
        return !this.el.hidden;
    }

    /** A moment's view (moment-host.ts onView): shown with the sound's name; a new moment starts with an empty line; null hides it. */
    show(view: MomentView | null): void {
        this.showCue(view === null ? null : view.cue);
    }

    /** The sound being named (a moment's, or one of "What is this sound?", sound-tour.ts), or null to hide the card. */
    showCue(cue: CueId | null): void {
        if (cue === null) {
            this.el.hidden = true;
            this.cue = null;
            this.line.textContent = '';
            this.doc.body.classList.remove(MOMENT_BODY_CLASS);
            return;
        }
        if (this.cue !== cue) {
            this.cue = cue;
            this.sound.textContent = this.name(cue);
            this.line.textContent = '';
        }
        this.el.hidden = false;
        this.doc.body.classList.add(MOMENT_BODY_CLASS);
    }

    /** A line was spoken: while the card is shown it is the card's line (the last sentence spoken stays over the sound). */
    said(text: string): void {
        if (this.el.hidden || text.trim() === '') return;
        this.line.textContent = text;
    }

    remove(): void {
        this.show(null);
        this.el.remove();
    }
}
