// The lesson menu (v0.13, lane v13-host B6; the owner's M41-3): in a lesson the pilot can always get back to a menu. Escape pauses
// the flight and opens a spoken menu: Resume, Repeat the task, Next step, Previous step, Next lesson, Lesson list, Sound settings,
// Leave the mode. The arrow keys move (round from the last to the first), Home and End go to the ends, Enter or Space chooses,
// Escape goes back to the lesson (Resume). Tab moves as the arrows do: the focus stays in the menu while it is up.
//
//   voice    the menu's name and how it works, then each item as the focus reaches it ("Repeat the task. Item 2 of 8."), said
//            by the mode's voice (engine.say through the mode's speech queue: the theme's voice level, W15), each cutting the
//            one before. With "my screen reader speaks" the reader reads the focused item itself (its role, name and place), so
//            the voice does not say it again; the menu's name and how it works are still said (as captions, which the reader reads).
//   reader   a modal dialog with a menu of menu items (role, name, place in the set), the focus on the item (one in the tab
//            order, the rest -1), outside #ui (the flight's live region); while it is up it is a dialog to the page (the keyboard
//            does not fly the arrows, devices/keyboard.ts dialogOpen) and it takes every key (the page's keys and the lesson's
//            wait: a key pressed in the menu is the menu's).
//   pause    the flight is held while the menu is up, and the lesson with it (the page's pause reaches the runner at once, W8):
//            its clocks stand, a question waits, a sound does not start under the menu. The menu's first line cuts the lesson's
//            lines; the bridge says them again when the menu has closed (review F1: Escape early in a lesson lost the first lines of
//            its task), after "Resume.", which Resume and Escape say to end the menu's own lines. Resume and Escape let it go; an item that
//            moves the lesson lets it go first, then calls the runner, recorded as the key it stands for (W5: Repeat the task is
//            Z, Next step N, Previous step B, Next lesson the runner's nextLesson), so a replay re-derives it. Lesson list and Sound
//            settings open the mode's start screen (which holds the flight itself) before letting go, so the flight never runs
//            between them; Leave the mode saves the lesson and goes to the ordinary simulator.
import type { SpeechLine } from '@shramko/sonic-fpv';

export const LESSON_MENU_ITEMS = ['resume', 'repeat', 'next-step', 'previous-step', 'next-lesson', 'lessons', 'settings', 'leave'] as const;
export type LessonMenuItem = (typeof LESSON_MENU_ITEMS)[number];

/** Each item's words (the page's spoken lines: said by the mode's voice and shown on the item). */
export const ITEM_LINES: Readonly<Record<LessonMenuItem, string>> = {
    resume: 'sonic.say.menuResume',
    repeat: 'sonic.say.menuRepeat',
    'next-step': 'sonic.say.menuNextStep',
    'previous-step': 'sonic.say.menuPreviousStep',
    'next-lesson': 'sonic.say.menuNextLesson',
    lessons: 'sonic.say.menuLessons',
    settings: 'sonic.say.menuSettings',
    leave: 'sonic.say.menuLeave'
};

/** Items that open another screen of the mode, which holds the flight itself: it is opened before the menu lets the flight go. */
const KEEPS_FLIGHT_HELD: ReadonlySet<LessonMenuItem> = new Set(['lessons', 'settings', 'leave']);

/** What the menu's view tells the menu (the DOM view, or a test's). */
export interface LessonMenuInput {
    /** the focus moves to item `to` (already wrapped to the list) */
    move(to: number): void;
    /** item `index` is chosen by the key `code` ('Enter', 'Space'; 'Click' for a pointer) */
    choose(index: number, code: string): void;
    /** Escape: back to the lesson */
    close(): void;
}

/** What draws the menu (DomLessonMenuView in the page). */
export interface LessonMenuView {
    show(title: string, labels: readonly string[], focus: number, input: LessonMenuInput): void;
    focus(index: number): void;
    hide(): void;
}

export interface LessonMenuDeps {
    /** a line through the mode's voice (the mode's speech queue, engine.say) */
    say(line: SpeechLine, interrupt: boolean): Promise<void>;
    /** a line's text in the pilot's language (the items' labels) */
    text(line: SpeechLine): string;
    /** the flight held (true) or let go (false): the page's pause, which the lesson runner waits with (W8) */
    hold(on: boolean): void;
    /** "my screen reader speaks": the reader reads the focused item, the mode's voice does not say it again */
    readerSpeaks(): boolean;
    /** what an item does once the menu is down; `code`: the key that chose it */
    run(item: LessonMenuItem, code: string): void;
    readonly view: LessonMenuView | null;
}

export class LessonMenu {
    private readonly d: LessonMenuDeps;
    private index = 0;
    private up = false;

    constructor(d: LessonMenuDeps) {
        this.d = d;
    }

    get isOpen(): boolean {
        return this.up;
    }

    /** The item with the focus (0-based), for the test hook. */
    get focused(): number {
        return this.index;
    }

    /** The items' labels in the pilot's language, in order. */
    labels(): string[] {
        return LESSON_MENU_ITEMS.map((id) => this.d.text({ key: ITEM_LINES[id] }));
    }

    /** "Repeat the task. Item 2 of 8.": the item and its place, as the voice says it on focus. */
    itemLine(index: number): SpeechLine {
        const id = LESSON_MENU_ITEMS[index] as LessonMenuItem;
        return { key: 'menu.item', params: { label: this.d.text({ key: ITEM_LINES[id] }), n: index + 1, total: LESSON_MENU_ITEMS.length } };
    }

    /** Escape in a lesson: the flight and the lesson wait, the menu is drawn and said, the focus on Resume. */
    open(): void {
        if (this.up) return;
        this.up = true;
        this.index = 0;
        // held first: the lesson is paused before the menu's first line cuts its speech (that cut must not read as its end)
        this.d.hold(true);
        this.d.view?.show(this.d.text({ key: 'sonic.say.menuTitle' }), this.labels(), 0, {
            move: (to) => this.move(to),
            choose: (i, code) => this.choose(i, code),
            close: () => this.close()
        });
        void this.d.say({ key: 'sonic.say.menuOpen' }, true).catch(() => undefined);
        this.sayItem(false);
    }

    /** The focus to item `to` (wrapped round the list), said. */
    move(to: number): void {
        if (!this.up) return;
        const n = LESSON_MENU_ITEMS.length;
        this.index = ((to % n) + n) % n;
        this.d.view?.focus(this.index);
        this.sayItem(true);
    }

    /** The focus one item on (+1) or back (-1). */
    step(delta: 1 | -1): void {
        this.move(this.index + delta);
    }

    /** Item `index` chosen with the key `code`: the menu goes, then the item is done (see the header for the order). */
    choose(index: number, code: string): void {
        if (!this.up) return;
        const item = LESSON_MENU_ITEMS[index];
        if (item === undefined) return;
        this.down();
        if (KEEPS_FLIGHT_HELD.has(item)) {
            this.d.run(item, code);
            this.d.hold(false);
            return;
        }
        this.d.hold(false);
        if (item === 'resume') this.resumed();
        else this.d.run(item, code);
    }

    /** Escape (or Resume): back to the lesson. */
    close(): void {
        if (!this.up) return;
        this.down();
        this.d.hold(false);
        this.resumed();
    }

    /**
     * Back to the lesson (review F1): "Resume." cuts what the menu was still saying (its first line alone is 7 s long), and the lesson's
     * lines the menu cut follow it (bridge.ts says them again). With "my screen reader speaks" the reader says where the focus went.
     */
    private resumed(): void {
        if (this.d.readerSpeaks()) return;
        void this.d.say({ key: ITEM_LINES.resume }, true).catch(() => undefined);
    }

    /** The page goes: the menu comes off without saying anything (the page's own teardown lets the flight go). */
    dispose(): void {
        if (this.up) this.down();
    }

    private down(): void {
        this.up = false;
        this.d.view?.hide();
    }

    private sayItem(interrupt: boolean): void {
        if (this.d.readerSpeaks()) return;
        void this.d.say(this.itemLine(this.index), interrupt).catch(() => undefined);
    }
}

/** Where the view listens for keys while it is up (the window, capture phase, so the page's keys never see them). */
export interface KeySource {
    addEventListener(type: 'keydown', cb: (e: KeyboardEvent) => void, capture: boolean): void;
    removeEventListener(type: 'keydown', cb: (e: KeyboardEvent) => void, capture: boolean): void;
}

/** F13 to F24 belong to the latency harness (devices/keyboard.ts): never the menu's. */
const HARNESS = /^F(1[3-9]|2[0-4])$/;

/**
 * The menu in the page: a modal dialog (outside #ui) with a heading and a menu of menu items, one button each. The focus is on the
 * item, the others are out of the tab order; every key goes to the menu while it is up.
 */
export class DomLessonMenuView implements LessonMenuView {
    private readonly parent: HTMLElement;
    private readonly keys: KeySource;
    private root: HTMLElement | null = null;
    private items: HTMLElement[] = [];
    private at = 0;
    private onKey: ((e: KeyboardEvent) => void) | null = null;

    constructor(parent: HTMLElement, keys: KeySource) {
        this.parent = parent;
        this.keys = keys;
    }

    show(title: string, labels: readonly string[], focus: number, input: LessonMenuInput): void {
        this.hide();
        const doc = this.parent.ownerDocument;
        const root = doc.createElement('div');
        root.className = 'sonic-menu';
        root.dataset.testid = 'sonic-lesson-menu';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'sonic-menu-title');
        const heading = doc.createElement('h2');
        heading.setAttribute('id', 'sonic-menu-title');
        heading.textContent = title;
        const menu = doc.createElement('div');
        menu.className = 'sonic-menu-list';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-labelledby', 'sonic-menu-title');
        this.items = labels.map((label, i) => {
            const b = doc.createElement('button');
            b.setAttribute('type', 'button');
            b.setAttribute('role', 'menuitem');
            b.setAttribute('aria-posinset', String(i + 1));
            b.setAttribute('aria-setsize', String(labels.length));
            b.dataset.item = LESSON_MENU_ITEMS[i] ?? '';
            b.className = 'btn sonic-menu-item';
            b.textContent = label;
            b.tabIndex = -1;
            b.addEventListener('click', () => input.choose(i, 'Click'));
            menu.append(b);
            return b;
        });
        root.append(heading, menu);
        this.parent.append(root);
        this.root = root;
        // every key is the menu's while it is up (the capture phase of the window: before the page's router and the flight's keys);
        // a held Escape or Enter does its thing once (the Escape that opened the menu repeats while still held)
        const n = labels.length;
        this.onKey = (e: KeyboardEvent): void => {
            if (HARNESS.test(e.code)) return;
            e.stopImmediatePropagation();
            const go = (to: number): void => input.move(((to % n) + n) % n);
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) go(this.at + 1);
            else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) go(this.at - 1);
            else if (e.key === 'Home') go(0);
            else if (e.key === 'End') go(n - 1);
            else if (e.key === 'Enter' || e.key === ' ') {
                if (!e.repeat) input.choose(this.at, e.code || (e.key === ' ' ? 'Space' : 'Enter'));
            } else if (e.key === 'Escape') {
                if (!e.repeat) input.close();
            } else return;
            e.preventDefault();
        };
        this.keys.addEventListener('keydown', this.onKey, true);
        this.focus(focus);
    }

    focus(index: number): void {
        this.at = index;
        this.items.forEach((b, i) => {
            b.tabIndex = i === index ? 0 : -1;
        });
        this.items[index]?.focus();
    }

    hide(): void {
        if (this.onKey) this.keys.removeEventListener('keydown', this.onKey, true);
        this.onKey = null;
        this.root?.remove();
        this.root = null;
        this.items = [];
    }

    /** The menu is on the page. */
    get shown(): boolean {
        return this.root !== null;
    }
}

/** What the page does for the items (sonic/feature.ts gives the real ones; tests the rig's). */
export interface LessonMenuPage {
    /** the mode's calls into the lesson runner, each recorded as its key (mode.ts, bridge.ts keyCall) */
    readonly mode: { repeat(code: string): void; next(code: string): void; previous(code: string): void; nextLesson(code: string): void };
    /** the mode's start screen over the flight (it holds the flight itself), on its settings for Sound settings */
    showScreen(section?: 'settings'): void;
    /** the lesson saved and closed, the ordinary simulator opened */
    leave(): void;
}

/**
 * Each item's deed: Repeat the task is Z (the runner's repeat), Next step N, Previous step B, Next lesson the runner's nextLesson,
 * each recorded as that key with the code that chose it; Lesson list and Sound settings the start screen; Leave the mode leaves.
 */
export function runItem(page: LessonMenuPage): (item: LessonMenuItem, code: string) => void {
    return (item, code) => {
        switch (item) {
            case 'resume':
                return;
            case 'repeat':
                page.mode.repeat(code);
                return;
            case 'next-step':
                page.mode.next(code);
                return;
            case 'previous-step':
                page.mode.previous(code);
                return;
            case 'next-lesson':
                page.mode.nextLesson(code);
                return;
            case 'lessons':
                page.showScreen();
                return;
            case 'settings':
                page.showScreen('settings');
                return;
            case 'leave':
                page.leave();
                return;
        }
    };
}

/**
 * The pause key's handler in a lesson (Escape and P are one binding, pause.toggle): Escape opens the lesson menu, P the simulator's
 * pause menu (which keeps the feedback form, the settings and the rest of the simulator's items) as everywhere else.
 */
export function pauseKey(menu: Pick<LessonMenu, 'open'>, pauseMenu: () => void): (e: Pick<KeyboardEvent, 'code' | 'repeat'>) => void {
    return (e) => {
        if (e.repeat) return;
        if (e.code === 'Escape') menu.open();
        else pauseMenu();
    };
}
