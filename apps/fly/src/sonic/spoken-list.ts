// The start screen and the mode's settings as a spoken list (v0.13, lane v13-host C3; the owner's M41-4: a keyboard menu for blind
// pilots across the settings, each value spoken when it changes). The screen stays the page it was (landmarks, headings, native
// controls a screen reader knows); over it the keys work as in the lesson menu, and the mode's voice says where the focus is:
//
//   Down, Up      the next or the previous stop (round from the last to the first), in the page's own order (the Tab order:
//                 the sections, the Start buttons, the headphone check, the lessons, the settings, the footer); a stop the page
//                 does not show (the sliders of a closed "Volume and pitch" part) is passed over
//   Home, End     the first and the last stop
//   Left, Right   a setting one step down or up (a slider by its step, a choice to the one before or after, a box off and on, the
//                 path to the other one); at the end of a slider "That is the limit."
//   Enter         a button or a link does what it does (the page's own); a setting takes its next value (a box on or off, a choice
//                 round)
//   Escape        back: the start screen's own (out of the reset question, off the screen over a flight, else to the first of the
//                 Start buttons), with the voice or a screen reader alike
//
// Every stop the focus reaches is said ("Motor volume: -3 dB. Item 7 of 12."; the section's name first when the focus comes into a
// section; a lesson by its title, its place and its state), however it got there (these keys, Tab, a click, the page itself), and
// every value a setting takes is said by the screen as it is applied (start-screen.ts). Through the mode's voice only (engine.say,
// the theme's voice level, W15). With "my screen reader speaks" none of this: the page keeps the keys a screen reader user knows
// (the arrows change a slider or a choice) and the reader reads the focus itself, as it does in the lesson menu (B6).
//
// The first key on a page whose sound has not started starts it (the press is the user activation the speech waits for): the
// voice then says how the list works (the package's menu.welcome), then the stop.

/** One stop of the list: a control of the screen and what the voice says of it. */
export interface SpokenItem {
    /** the control that takes the focus */
    readonly el: HTMLElement;
    /** its section ('nav', 'start', 'headphones', 'lessons', 'settings', 'footer') */
    readonly section: string;
    /** its words when the focus reaches it: its name, then its value or state */
    words(): string;
    /** "Item n of N" after the words (a lesson says its own place instead) */
    readonly placed: boolean;
    /** whether the page shows it now (a closed part's sliders do not count); absent: always */
    shown?(): boolean;
    /** Left (-1) or Right (+1) on a setting: its value one step down or up, applied (the screen says the new value); absent: not a setting */
    change?(dir: -1 | 1): void;
    /** Enter on a setting: its next value (a box on or off, a choice round), applied; absent: Enter is the control's own */
    choose?(): void;
}

/** A heading the focus can be put on (a section's, the page's h1): the voice says it, Down goes to the first stop after it. */
export interface SpokenAnchor {
    readonly el: HTMLElement;
    readonly section: string;
    /** the index of the first stop after it (the list's length when none) */
    readonly next: number;
    words(): string;
}

export interface SpokenListDeps {
    /** a line through the mode's voice */
    say(text: string, interrupt: boolean): void;
    /** the list's keys are on: the mode's voice speaks (false: "my screen reader speaks") */
    keys(): boolean;
    /** the voice can be heard now (the sound has started; before the first press of a fresh page it has not) */
    awake(): boolean;
    /** the first press: the sound starts in it; true when it did (the voice then says how the list works first) */
    wake(): boolean;
    /** a section's name, said when the focus comes into it ('' for none) */
    sectionName(id: string): string;
    /** "{label}. Item {n} of {total}." in the pilot's language */
    place(label: string, n: number, total: number): string;
}

/** What a key did: nothing (the page's own), or the list took it (the page must not see it). */
export type KeyResult = 'taken' | 'page';

/** Keys of the latency harness (devices/keyboard.ts), never the list's. */
const HARNESS = /^F(1[3-9]|2[0-4])$/;

export class SpokenList {
    private readonly d: SpokenListDeps;
    private items: SpokenItem[] = [];
    private anchors: SpokenAnchor[] = [];
    /** the stop the focus is on (its index), or half a place before the first stop after the heading it is on (-0.5: before the first) */
    private at = -0.5;
    /** the section the voice named last */
    private section: string | null = null;
    /** the line the next focus says without cutting what is being said (the welcome before it) */
    private queueNext = false;

    constructor(d: SpokenListDeps) {
        this.d = d;
    }

    /** The next line the focus brings is said after what is being said (the screen said what it did), not over it. */
    queueNextLine(): void {
        this.queueNext = true;
    }

    /** The stop the focus is on (its index in the whole list), or a half place between two stops on a heading, for the tests. */
    get position(): number {
        return this.at;
    }

    /** The stops and the headings of the screen as it is drawn now (after every drawing). */
    set(items: readonly SpokenItem[], anchors: readonly SpokenAnchor[]): void {
        this.items = [...items];
        this.anchors = [...anchors];
        this.at = Math.min(this.at, this.items.length - 1);
    }

    /** The stops the page shows now, with their indexes in the whole list. */
    private visible(): { item: SpokenItem; i: number }[] {
        return this.items.map((item, i) => ({ item, i })).filter((x) => x.item.shown?.() !== false);
    }

    /** The focus came to `el` (by a key, Tab, a click or the page): a stop or a heading is said. */
    focusIn(el: unknown): void {
        const i = this.items.findIndex((x) => x.el === el);
        if (i >= 0) {
            this.at = i;
            this.sayStop(i);
            return;
        }
        const a = this.anchors.find((x) => x.el === el);
        if (a === undefined) return;
        this.at = a.next - 0.5;
        if (this.speak(a.words())) this.section = a.section;
    }

    /** Stop `i` said: the section's name when the focus comes into a section the voice has not named last, then the line. */
    private sayStop(i: number): void {
        const item = this.items[i] as SpokenItem;
        const name = item.section !== this.section ? this.d.sectionName(item.section) : '';
        const line = this.lineOf(i);
        if (this.speak(name === '' ? line : `${name}. ${line}`)) this.section = item.section;
    }

    /** The line of stop `i`: its words, and its place among the section's stops the page shows ("Item 7 of 11"). */
    lineOf(i: number): string {
        const item = this.items[i] as SpokenItem;
        const words = item.words();
        if (!item.placed) return words;
        const same = this.visible().filter((x) => x.item.section === item.section);
        return this.d.place(words, same.findIndex((x) => x.i === i) + 1, same.length);
    }

    /** A line through the voice, when the list speaks and can be heard; whether it was said. */
    private speak(text: string): boolean {
        if (!this.d.keys() || !this.d.awake()) return false;
        const queue = this.queueNext;
        this.queueNext = false;
        this.d.say(text, !queue);
        return true;
    }

    /** The next or the previous shown stop from where the focus is (round the ends), or the first or the last, focused (focusIn says it). */
    private move(to: 'next' | 'previous' | 'first' | 'last'): void {
        const vis = this.visible();
        if (vis.length === 0) return;
        let k: number;
        if (to === 'first') k = 0;
        else if (to === 'last') k = vis.length - 1;
        else if (to === 'next') {
            // from a stop (at = its index) or a heading (at = half a place before the first stop after it)
            const after = vis.findIndex((x) => x.i > this.at);
            k = after < 0 ? 0 : after;
        } else {
            let before = -1;
            vis.forEach((x, j) => {
                if (x.i < this.at) before = j;
            });
            k = before < 0 ? vis.length - 1 : before;
        }
        const target = vis[k] as { item: SpokenItem; i: number };
        if (target.item.el === (globalThis.document?.activeElement ?? null)) {
            this.at = target.i;
            this.sayStop(target.i);
            return;
        }
        target.item.el.focus();
        // a page that sends no focus event for it (none here; the guard keeps the list in step anyway)
        if (this.at !== target.i) this.focusIn(target.item.el);
    }

    /** A key on the screen: 'taken' when the list did something with it (the page then must not), else 'page'. */
    key(e: Pick<KeyboardEvent, 'key' | 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>): KeyResult {
        if (!this.d.keys() || HARNESS.test(e.code) || e.altKey || e.ctrlKey || e.metaKey) return 'page';
        const k = e.key;
        const nav = k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End';
        const item = Number.isInteger(this.at) && this.at >= 0 ? this.items[this.at] : undefined;
        const onItem = item !== undefined && item.el === (globalThis.document?.activeElement ?? null);
        const value = (k === 'ArrowLeft' || k === 'ArrowRight') && onItem && item.change !== undefined;
        const choose = k === 'Enter' && onItem && item.choose !== undefined;
        if (!nav && !value && !choose) return 'page';
        if (this.d.wake()) {
            // the sound started with this press: how the list works first, then what the key did, after it
            this.queueNext = true;
        }
        if (nav) this.move(k === 'ArrowDown' ? 'next' : k === 'ArrowUp' ? 'previous' : k === 'Home' ? 'first' : 'last');
        else if (value) item?.change?.(k === 'ArrowLeft' ? -1 : 1);
        else if (!e.repeat) item?.choose?.();
        return 'taken';
    }
}
