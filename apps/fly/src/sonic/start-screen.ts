// The Fly by Sound start screen (v0.12, docs/wip/v12-plan.md 2.10 and 4.2 step 8; spec sections 3 and 6): plain HTML that
// works with the keyboard alone and with a screen reader. It is built OUTSIDE #ui, which is one aria-live region for the
// flight's own notes (apps/fly/index.html): inside it every change would be read out. Landmarks (header, navigation,
// main, footer), one h1 and h2 per section (h3 per module), native buttons, a radio group, selects, checkboxes and
// sliders with labels: nothing is a div with a click handler, so Tab, Enter, Space and the arrow keys do what a screen
// reader user expects. Every lesson is a button, whatever the path (the ladder is a recommendation, not a gate).
//
//   Start      Continue: <the lesson the pilot is on>, Start the course from the beginning (lesson 1 of the path; the saved
//              progress is kept), and, when ?sonic=<lesson> asked for one, Start: <that lesson>; the path (full or fast); each
//              opens a lesson through `onStart` inside the press, which is the user activation the AudioContext and the speech
//              need.
//   Headphones a sound on the left, on the right, behind: made by the engine (its first press makes the AudioContext),
//              with the package's notes (wired, no surround effects) and the loudness note beside it.
//   Lessons    every shipped lesson (28 since v0.13) by module with its place ("Lesson N of 28", as the lesson's own view counts
//              it) and where the pilot stands (passed, skipped, in progress, not started); then "Reset my progress", which asks
//              first (No first, then Yes; Escape is No) and keeps the sound settings.
//   Settings   the pilot's own sound: theme, calm, height polarity, speaking speed, captions, "my screen reader speaks",
//              motor sound, the motor's volume and the target height note (v0.13, W13), sound from above and below (v0.13, the
//              package's heightDirection), the target hum showing the way (lane sonic-beacon, the package's beacon), what the sound turns with, the sound panel and the attitude display (v0.13, the look's
//              switches, look-prefs.ts), each sound's volume and pitch. Each change applies at once and is saved
//              (SonicSetup.update; the panels' switches setPanel).
//
// A spoken list (v0.13, lane v13-host C3, the owner's M41-4; spoken-list.ts): with the mode's voice on (not "my screen reader
// speaks"), Down and Up move through the screen's stops, Left and Right change a setting, Enter chooses, Escape goes back, and the
// voice says every stop the focus reaches and every value a setting takes. Escape always goes back: out of the reset question, off
// the screen over a flight, else to the first of the Start buttons. The voice is the engine's (engine.say; over a flight the page's
// own way to it, the lesson's speech queue while one runs: bind's `say`).
// Texts: the sound package's own strings for lessons, modules, menu, settings and hearing (its dictionaries), the
// simulator's `sonic.*` keys for the rest, in en, es, pl and ru.
import { BUILTIN_THEME_IDS, DICTS, LAYER_IDS, PREFS_LIMITS, createTranslator } from '@shramko/sonic-fpv';
import type { FlightSample, LayerId, Locale, SonicPrefs, SpeechLine, Vec3 } from '@shramko/sonic-fpv';
import { h } from '../ui/dom';
import { t } from '../i18n';
import type { SonicSetup, VisitPrefs } from './entry';
import { SpokenList } from './spoken-list';
import type { SpokenAnchor, SpokenItem } from './spoken-list';
import { buildModel, lessonPlace } from './start-model';
import type { LessonPlace, LessonRow, LessonState, SonicRequest, StartModel } from './start-model';
import { KEY_HINTS_CHOICES, keyHintsChoice, setKeyHints } from './key-hints';
import type { KeyHintsChoice } from './key-hints';
import { LOOK_PANELS, LOOK_PANEL_LABELS, panelOn, setPanel } from './look-prefs';
import type { LookPanel } from './look-prefs';
import './sonic.css';

/** Directions of the headphone check, in the listener's frame (x right, y up, z back). */
export const HEADPHONE_DIRS: Readonly<Record<'left' | 'right' | 'behind', Vec3>> = { left: [-1, 0, 0], right: [1, 0, 0], behind: [0, 0, 1] };

const NEUTRAL: FlightSample = { t: 0, tick: 0, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };

/** The page's spoken line that carries a text the page has put together (start-screen's stops and values; the replay's recorded lines). */
export const TEXT_LINE = 'sonic.say.text';

/** How the screen's lines reach the voice: engine.say, or over a flight the page's own way (the lesson's speech queue). */
export type ScreenVoice = (line: SpeechLine, interrupt: boolean) => Promise<void>;

export interface StartScreenDeps {
    readonly setup: SonicSetup;
    readonly locale: Locale;
    readonly request: SonicRequest;
    /** progress and the current lesson, read each time the screen is drawn */
    readonly progress: () => Parameters<typeof buildModel>[0];
    readonly current: () => string | null;
    /** a lesson was chosen (called inside the press) */
    readonly onStart: (lessonId: string) => void;
    /** the screen is over a running flight: Escape and a Back button close it */
    readonly onClose?: () => void;
    /** "Reset my progress", once the pilot said yes: every lesson's progress and the current lesson cleared (store.ts resetProgress) */
    readonly resetProgress?: () => void;
    /** after the reset (v13-int step 5): the flight page's own (bind), the lesson running under the screen forgets its counts */
    readonly onReset?: () => void;
    /** the voice over a flight (bind); absent: the engine's own say */
    readonly say?: ScreenVoice;
}

/** Sections of the page the navigation jumps to. */
const SECTIONS = ['start', 'headphones', 'lessons', 'settings'] as const;

/** The spoken list's sections in the page's order (the navigation before them, the footer after). */
const LIST_SECTIONS = ['nav', ...SECTIONS, 'footer'] as const;
type ListSection = (typeof LIST_SECTIONS)[number];

/** The id of the shared link's note: the primary Start button and the note's own buttons point to it. */
const VISIT_TEXT_ID = 'sonic-visit-text';

/** F13 to F24 belong to the latency harness (devices/keyboard.ts): never the screen's. */
const HARNESS_KEY = /^F(1[3-9]|2[0-4])$/;

export class StartScreen {
    readonly root: HTMLElement;
    private d: StartScreenDeps;
    private readonly tr: ReturnType<typeof createTranslator>;
    private readonly status: HTMLElement;
    private model: StartModel;
    private sections = new Map<string, HTMLElement>();
    /** "Reset my progress" was pressed and the screen asks before it does it */
    private confirming = false;
    private resetBox: HTMLElement | null = null;
    /** the spoken list's stops by section as the screen is drawn now, and the reset part's (drawn again on its own) */
    private stops = new Map<ListSection, SpokenItem[]>();
    private resetStops: SpokenItem[] = [];
    /** the section whose stops are being drawn */
    private building: ListSection = 'nav';
    private readonly list: SpokenList;
    /** the sound was started by a press on this screen (the voice can be heard) */
    private woke = false;
    /** the focus is being put back where it was after a part was drawn again: the voice says nothing for it */
    private quiet = false;
    private onKeyDown = (e: KeyboardEvent): void => {
        if (this.root.hidden) return;
        const target = e.target as Node | null;
        if (target !== null && target !== document.body && !this.root.contains(target)) return;
        // Escape goes back (both with the mode's voice and with a screen reader)
        if (e.key === 'Escape') {
            if (!this.confirming && !this.d.onClose && this.inStart()) return;
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) this.back();
            return;
        }
        if (this.list.key(e) === 'taken') {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // every other key is the screen's too while it is shown (review F2): over a flight the page's keys (N, B, Z, G, R, I, T, L, P...)
        // would move the lesson under the screen (two B left rings-first for tunnel-long, whose task was said over the settings). A key's
        // own use on the screen (Tab, Enter on a button, the arrows on a slider, a letter in a list) is the browser's and stays; the
        // latency harness's F13 to F24 go on to the page (devices/keyboard.ts)
        if (!HARNESS_KEY.test(e.code)) e.stopPropagation();
    };
    private onFocusIn = (e: Event): void => this.list.focusIn(e.target);

    constructor(deps: StartScreenDeps, parent: HTMLElement = document.body) {
        this.d = deps;
        this.tr = createTranslator(deps.locale, DICTS);
        this.status = h('div', { class: 'sonic-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-testid': 'sonic-status' });
        this.model = buildModel(deps.progress(), deps.current(), deps.setup.prefs.path);
        this.root = h('div', { class: 'sonic-start', id: 'sonic-start', 'data-testid': 'sonic-start', lang: deps.locale });
        this.list = new SpokenList({
            say: (text, interrupt) => this.voice({ key: TEXT_LINE, params: { text } }, interrupt),
            keys: () => this.d.setup.prefs.selfVoice,
            awake: () => this.awake(),
            wake: () => this.wake(),
            sectionName: (id) => this.sectionName(id as ListSection),
            place: (label, n, total) => this.key('menu.item', { label, n, total })
        });
        this.root.addEventListener('focusin', this.onFocusIn);
        parent.append(this.root);
        this.render();
        addEventListener('keydown', this.onKeyDown, true);
    }

    private S(line: SpeechLine): string {
        return this.tr.text(line);
    }

    private key(k: string, params?: SpeechLine['params']): string {
        return this.tr.say(k, params);
    }

    /** A message for a screen reader (and the helper): the live region is cleared first so a repeat is read again. */
    say(text: string): void {
        this.status.textContent = '';
        setTimeout(() => {
            this.status.textContent = text;
        }, 40);
    }

    // ------------------------------------------------------------------ the voice

    /** The voice can be heard: the sound started on this screen or before it (over a flight). */
    private awake(): boolean {
        return this.woke || this.d.setup.audio.ac !== null;
    }

    /** The first key of a fresh page starts the sound (it is a user activation) and the voice says how the list works. */
    private wake(): boolean {
        if (this.awake()) return false;
        this.woke = true;
        void this.d.setup.audio.start();
        this.voice({ key: 'sonic.say.listHelp' }, true);
        return true;
    }

    /** A line through the mode's voice (never the browser's own: W15). */
    private voice(line: SpeechLine, interrupt: boolean): void {
        if (this.quiet) return;
        const say: ScreenVoice = this.d.say ?? ((l, i) => this.d.setup.audio.engine.say(l, { interrupt: i }));
        void say(line, interrupt).catch(() => undefined);
    }

    /** A changed value said by the voice, when the voice is the pilot's (with "my screen reader speaks" the reader says the control's own). */
    private sayValue(text: string): void {
        if (this.d.setup.prefs.selfVoice && this.awake()) this.voice({ key: TEXT_LINE, params: { text } }, true);
    }

    /** Something the screen did, said before the stop the focus goes to next (which then does not cut it). */
    private announce(text: string): void {
        this.say(text);
        if (!this.d.setup.prefs.selfVoice || !this.awake()) return;
        this.voice({ key: TEXT_LINE, params: { text } }, true);
        this.list.queueNextLine();
    }

    private sectionName(id: ListSection): string {
        switch (id) {
            case 'nav':
                return t('sonic.nav.label');
            case 'start':
                return t('sonic.start.heading');
            case 'headphones':
                return t('sonic.hp.heading');
            case 'lessons':
                return this.key('menu.lessons.title');
            case 'settings':
                return this.key('menu.settings.title');
            case 'footer':
                return '';
        }
    }

    // ------------------------------------------------------------------ the list's stops

    /** `el` is a stop of the spoken list, in the section being drawn. */
    private stop(el: HTMLElement, words: () => string, o: Partial<Pick<SpokenItem, 'placed' | 'shown' | 'change' | 'choose'>> = {}): void {
        const item: SpokenItem = { el, section: this.building, words, placed: o.placed ?? true, ...(o.shown ? { shown: o.shown } : {}), ...(o.change ? { change: o.change } : {}), ...(o.choose ? { choose: o.choose } : {}) };
        if (this.building === 'lessons' && this.inReset) this.resetStops.push(item);
        else this.stops.get(this.building)?.push(item);
    }

    private inReset = false;

    /** Starts the stops of a section afresh (it is being drawn again). */
    private begin(id: ListSection): void {
        this.building = id;
        this.stops.set(id, []);
    }

    /** The list follows the screen as it is drawn now: its stops in the page's order, the h1 and the sections' headings. */
    private syncList(): void {
        const items: SpokenItem[] = [];
        const first = new Map<ListSection, number>();
        for (const id of LIST_SECTIONS) {
            first.set(id, items.length);
            items.push(...(this.stops.get(id) ?? []));
            if (id === 'lessons') items.push(...this.resetStops);
        }
        const anchors: SpokenAnchor[] = [];
        const h1 = this.root.querySelector<HTMLElement>('#sonic-h1');
        if (h1) anchors.push({ el: h1, section: 'top', next: 0, words: () => t('sonic.start.name') });
        for (const id of SECTIONS) {
            const head = this.sections.get(id)?.querySelector<HTMLElement>('h2');
            if (head) anchors.push({ el: head, section: id, next: first.get(id) ?? 0, words: () => this.sectionName(id) });
        }
        this.list.set(items, anchors);
    }

    /** The focus is in the Start section (or nowhere on the screen). */
    private inStart(): boolean {
        const at = document.activeElement as Node | null;
        const start = this.sections.get('start');
        return at === null || at === document.body || !this.root.contains(at) || (start?.contains(at) ?? false) || at === this.root.querySelector('#sonic-h1');
    }

    /** Escape: out of the reset question, off the screen over a flight, else back to the first of the Start buttons. */
    private back(): void {
        if (this.confirming) {
            this.endReset(false);
            return;
        }
        if (this.d.onClose) {
            this.d.onClose();
            return;
        }
        this.stops.get('start')?.[0]?.el.focus();
    }

    /** Draws the screen again from the current progress and settings (after a lesson, after a change). */
    render(): void {
        const prefs = this.d.setup.prefs;
        this.model = buildModel(this.d.progress(), this.d.current(), prefs.path);
        this.sections.clear();
        const next = [
            this.header(),
            this.nav(),
            h('main', { id: 'sonic-main' }, this.startSection(), this.headphonesSection(), this.lessonsSection(), this.settingsSection()),
            this.footer(),
            this.status
        ];
        this.root.replaceChildren(...next);
        this.syncList();
    }

    // ------------------------------------------------------------------ parts

    private header(): HTMLElement {
        return h('header', {}, h('h1', { id: 'sonic-h1', tabindex: -1, 'data-testid': 'sonic-h1' }, t('sonic.start.name')), h('p', { class: 'sonic-intro' }, t('sonic.start.intro')));
    }

    private nav(): HTMLElement {
        this.begin('nav');
        const labels: Record<(typeof SECTIONS)[number], string> = { start: t('sonic.nav.start'), headphones: t('sonic.nav.headphones'), lessons: this.key('menu.lessons.title'), settings: this.key('menu.settings.title') };
        const items = SECTIONS.map((id) => {
            const a = h('a', { href: `#sonic-sec-${id}`, onclick: (e: Event) => {
                e.preventDefault();
                this.sections.get(id)?.querySelector<HTMLElement>('h2')?.focus();
            } }, labels[id]);
            this.stop(a, () => labels[id]);
            return h('li', {}, a);
        });
        return h('nav', { 'aria-label': t('sonic.nav.label') }, h('ul', {}, ...items));
    }

    /** One section: an h2 that can take focus (the navigation moves it there) and the content. */
    private section(id: (typeof SECTIONS)[number], title: string, ...content: (Node | string | null)[]): HTMLElement {
        const heading = h('h2', { id: `sonic-h-${id}`, tabindex: -1 }, title);
        const s = h('section', { id: `sonic-sec-${id}`, 'aria-labelledby': `sonic-h-${id}`, class: 'sonic-section' }, heading, ...content);
        this.sections.set(id, s);
        return s;
    }

    private startSection(): HTMLElement {
        this.begin('start');
        const prefs = this.d.setup.prefs;
        const m = this.model;
        const req = this.d.request;
        const buttons: HTMLElement[] = [];
        const visit = this.visitNote(this.d.setup.visit);
        // the primary Start carries the link's note as its description: a pilot who tabs straight to it hears what sound it starts with
        const lessonButton = (id: string, label: string, sub: string | null, primary: boolean, testid: string): HTMLElement => {
            const b = h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, 'data-testid': testid, 'data-lesson': id, ...(primary && visit ? { 'aria-describedby': VISIT_TEXT_ID } : {}), onclick: () => this.start(id) }, label, sub ? h('span', { class: 'sonic-sub' }, sub) : null);
            this.stop(b, () => (sub ? `${label}. ${sub.replace(/\.$/, '')}` : label));
            return b;
        };
        const titleOf = (id: string): string => this.S(this.model.modules.flatMap((x) => x.lessons).find((l) => l.id === id)?.title ?? { key: `lesson.${id}.title` });
        const rowOf = (id: string): LessonRow | undefined => this.model.modules.flatMap((x) => x.lessons).find((l) => l.id === id);
        let primaryTaken = false;
        if (req.kind === 'lesson') {
            buttons.push(lessonButton(req.id, t('sonic.start.lesson', { title: titleOf(req.id) }), this.placeText(lessonPlace(req.id, prefs.path)), true, 'sonic-start-asked'));
            primaryTaken = true;
        }
        // Continue: <the lesson>, with its place and where the pilot stands in it (M41-2)
        if (m.continueId) {
            const row = rowOf(m.continueId);
            const sub = [this.placeText(lessonPlace(m.continueId, prefs.path)), row ? this.stateWord(row.state) : null].filter((x): x is string => x !== null).join(', ');
            buttons.push(lessonButton(m.continueId, t('sonic.start.continue', { title: titleOf(m.continueId) }), sub, !primaryTaken, 'sonic-start-continue'));
            primaryTaken = true;
        }
        // the course from its first lesson; the saved progress is kept (Reset is a choice of its own, in the lessons)
        const first = `${t('sonic.start.courseWhat', { lesson: this.placeText(lessonPlace(m.beginningId, prefs.path)), title: titleOf(m.beginningId) })}${m.continueId ? ` ${t('sonic.start.courseKeeps')}` : ''}`;
        buttons.push(lessonButton(m.beginningId, t('sonic.start.course'), first, !primaryTaken, 'sonic-start-beginning'));
        const back = this.d.onClose ? h('button', { type: 'button', class: 'btn', 'data-testid': 'sonic-back', onclick: () => this.d.onClose?.() }, t('sonic.close')) : null;
        if (back) this.stop(back, () => t('sonic.close'));
        const choice = visit?.choice ?? null;
        if (choice) for (const b of choice.querySelectorAll<HTMLElement>('button')) this.stop(b, () => b.textContent ?? '');
        // the path: one stop per choice; Left and Right go to the other one and choose it, Enter chooses this one
        const pathName = (p: 'full' | 'fast'): string => this.key(p === 'fast' ? 'menu.main.path-fast' : 'menu.main.path-full');
        const inputs: HTMLInputElement[] = [];
        const radios = (['full', 'fast'] as const).map((p, i) => {
            const input = h('input', { type: 'radio', name: 'sonic-path', value: p, id: `sonic-path-${p}`, 'data-testid': `sonic-path-${p}`, ...(prefs.path === p ? { checked: true } : {}) });
            inputs.push(input);
            input.addEventListener('change', () => this.change({ path: p }));
            const pick = (j: number): void => {
                const to = inputs[j] as HTMLInputElement;
                for (const r of inputs) r.checked = r === to;
                to.focus();
                this.change({ path: (['full', 'fast'] as const)[j] as 'full' | 'fast' });
            };
            this.stop(input, () => `${t('sonic.path.legend')}: ${pathName(p)}, ${this.key(input.checked ? 'menu.value.on' : 'menu.value.off')}. ${this.key(p === 'fast' ? 'menu.path.fast-what' : 'menu.path.full-what').replace(/\.$/, '')}`, {
                change: (dir) => pick((i + dir + 2) % 2),
                choose: () => {
                    if (input.checked) return;
                    pick(i);
                }
            });
            return h('div', { class: 'sonic-choice' }, input, h('label', { for: `sonic-path-${p}` }, pathName(p), h('span', { class: 'sonic-sub' }, this.key(p === 'fast' ? 'menu.path.fast-what' : 'menu.path.full-what'))));
        });
        const unknown = req.kind === 'unknown' ? h('p', { class: 'sonic-note', role: 'note', 'data-testid': 'sonic-unknown' }, t('sonic.start.unknown', { id: req.raw })) : null;
        return this.section('start', t('sonic.start.heading'), unknown, visit?.note ?? null, h('div', { class: 'sonic-actions', role: 'group', 'aria-label': t('sonic.start.heading') }, ...buttons, back), choice, h('fieldset', { class: 'sonic-fieldset' }, h('legend', {}, t('sonic.path.legend')), ...radios));
    }

    /**
     * The sound settings a shared link set for this visit (v12-optin; SonicSetup.setVisit): the note, read before the Start buttons, names
     * each with the name the settings below give it and says the pilot's own saved settings are not changed; after the Start buttons
     * (review R6: Enter on the first control starts, never saves) "Keep these settings" saves them and "Use my own settings" lets them go.
     * Either takes them out of the address (review R2).
     */
    private visitNote(v: VisitPrefs): { note: HTMLElement; choice: HTMLElement } | null {
        const parts: string[] = [];
        if (v.theme !== undefined) parts.push(`${this.key('menu.setting.theme')}: ${this.key(`theme.${v.theme}.name`)}`);
        if (v.calm !== undefined) parts.push(`${this.key('menu.setting.calm')}: ${this.key(v.calm ? 'menu.value.on' : 'menu.value.off')}`);
        if (v.heightPolarity !== undefined) parts.push(`${this.key('menu.setting.polarity')}: ${this.key(`menu.value.${v.heightPolarity}`)}`);
        if (v.listenerFrame !== undefined) parts.push(`${this.key('menu.setting.frame')}: ${this.key(`menu.value.${v.listenerFrame}`)}`);
        if (!parts.length) return null;
        const done = (said: string): void => {
            this.render();
            this.say(said);
            this.sections.get('start')?.querySelector<HTMLElement>('h2')?.focus();
        };
        const keep = h('button', { type: 'button', class: 'btn', 'data-testid': 'sonic-visit-keep', onclick: () => {
            this.d.setup.keepVisit();
            done(t('sonic.link.kept'));
        } }, t('sonic.link.keep'));
        const own = h('button', { type: 'button', class: 'btn', 'data-testid': 'sonic-visit-own', onclick: () => {
            this.d.setup.dropVisit();
            done(t('sonic.link.owned'));
        } }, t('sonic.link.own'));
        return {
            note: h('div', { class: 'sonic-note', role: 'note', 'data-testid': 'sonic-visit' }, h('p', { id: VISIT_TEXT_ID }, t('sonic.link.settings', { list: parts.join('; ') }))),
            choice: h('div', { class: 'sonic-actions', role: 'group', 'aria-labelledby': VISIT_TEXT_ID, 'data-testid': 'sonic-visit-choice' }, keep, own)
        };
    }

    private headphonesSection(): HTMLElement {
        this.begin('headphones');
        const play = (side: 'left' | 'right' | 'behind'): void => this.headphoneCheck(side);
        const buttons = (['left', 'right', 'behind'] as const).map((side) => {
            const b = h('button', { type: 'button', class: 'btn', 'data-testid': `sonic-hp-${side}`, onclick: () => play(side) }, t(`sonic.hp.${side}`));
            this.stop(b, () => t(`sonic.hp.${side}`));
            return b;
        });
        const notes = h('ul', { class: 'sonic-notes' }, h('li', {}, this.key('headphones.intro')), h('li', {}, this.key('headphones.wired')), h('li', {}, this.key('headphones.os-spatial')));
        const loud = h('div', { class: 'sonic-loud', role: 'group', 'aria-labelledby': 'sonic-h-loud' }, h('h3', { id: 'sonic-h-loud', tabindex: -1 }, t('sonic.loud.heading')), h('p', { 'data-testid': 'sonic-loud-note' }, this.key('menu.hearing-note')), h('p', {}, this.key('headphones.volume')));
        return this.section('headphones', t('sonic.hp.heading'), notes, h('div', { class: 'sonic-actions', role: 'group', 'aria-label': t('sonic.hp.heading') }, ...buttons), loud);
    }

    private lessonsSection(): HTMLElement {
        this.begin('lessons');
        const lists = this.model.modules.map((mod) => {
            const hid = `sonic-mod-${mod.module}`;
            const items = mod.lessons.map((l) => h('li', {}, this.lessonButton(l)));
            return h('section', { class: 'sonic-module', 'aria-labelledby': hid }, h('h3', { id: hid, tabindex: -1 }, this.S(mod.name)), h('ul', { class: 'sonic-lessons' }, ...items));
        });
        this.resetBox = this.resetPart();
        return this.section('lessons', this.key('menu.lessons.title'), h('p', { class: 'sonic-hint' }, t('sonic.lessons.hint')), ...lists, this.resetBox);
    }

    /** "Lesson 20 of 28" */
    private placeText(p: LessonPlace): string {
        return t('sonic.progress.lesson', { n: p.n, total: p.total });
    }

    /** Where the pilot stands, in the words of the spoken menu (the package's), skipped in the page's own (v0.13). */
    private stateWord(s: LessonState): string {
        if (s === 'skipped') return t('sonic.lessons.skipped');
        return this.key(s === 'passed' ? 'menu.lesson.passed' : s === 'current' ? 'menu.lesson.current' : 'menu.lesson.new');
    }

    private lessonButton(l: LessonRow): HTMLElement {
        const notes = [this.placeText(l.place), this.stateWord(l.state), l.bestTimeMs !== null ? t('sonic.lessons.bestTime', { time: this.tr.duration(l.bestTimeMs) }) : null, l.fastPath ? this.key('menu.main.path-fast') : null, l.scan ? t('sonic.lessons.scan') : null].filter((x): x is string => x !== null);
        // the name a screen reader says: the title, its place, then where the pilot stands, in the same words as the spoken menu
        const title = this.S(l.title);
        const b = h('button', { type: 'button', class: `btn sonic-lesson sonic-${l.state}`, 'data-testid': 'sonic-lesson', 'data-lesson': l.id, 'data-state': l.state, onclick: () => this.start(l.id) }, title, h('span', { class: 'sonic-sub' }, notes.join(', ')));
        // the voice says the same: "Your first ring. Lesson 20 of 28, in progress" (its place is its number: no "Item n of N")
        this.stop(b, () => `${title}. ${notes.join(', ')}`, { placed: false });
        return b;
    }

    /** The Reset button, or while the screen asks: the question, then No (the focus goes there) and Yes. */
    private resetPart(): HTMLElement {
        const building = this.building;
        this.building = 'lessons';
        this.inReset = true;
        this.resetStops = [];
        try {
            if (!this.confirming) {
                const reset = h('button', { type: 'button', class: 'btn', id: 'sonic-reset', 'data-testid': 'sonic-reset', onclick: () => this.askReset() }, t('sonic.reset.button'));
                this.stop(reset, () => t('sonic.reset.button'), { placed: false });
                return h('div', { class: 'sonic-actions sonic-reset', 'data-testid': 'sonic-reset-box' }, reset);
            }
            const no = h('button', { type: 'button', class: 'btn primary', id: 'sonic-reset-no', 'data-testid': 'sonic-reset-no', onclick: () => this.endReset(false) }, t('sonic.reset.no'));
            const yes = h('button', { type: 'button', class: 'btn', id: 'sonic-reset-yes', 'data-testid': 'sonic-reset-yes', onclick: () => this.endReset(true) }, t('sonic.reset.yes'));
            this.stop(no, () => t('sonic.reset.no'), { placed: false });
            this.stop(yes, () => t('sonic.reset.yes'), { placed: false });
            return h('div', { class: 'sonic-note sonic-confirm', role: 'group', 'aria-labelledby': 'sonic-reset-ask', 'data-testid': 'sonic-reset-box' },
                h('p', { id: 'sonic-reset-ask', 'data-testid': 'sonic-reset-ask' }, this.resetQuestion()), h('div', { class: 'sonic-actions' }, no, yes));
        } finally {
            this.inReset = false;
            this.building = building;
        }
    }

    /** "Reset your progress in all 28 lessons? ..." */
    private resetQuestion(): string {
        return t('sonic.reset.ask', { total: this.model.modules.reduce((a, m) => a + m.lessons.length, 0) });
    }

    private settingsSection(): HTMLElement {
        this.begin('settings');
        const prefs = this.d.setup.prefs;
        const label = (id: string, text: string): HTMLLabelElement => h('label', { for: id }, text);
        const onOff = (on: boolean): string => this.key(on ? 'menu.value.on' : 'menu.value.off');
        // each control: its stop (its name and value), its Left and Right (a step), its Enter (the next value), and the change it makes
        // said once it is applied ("Motor volume: -3 dB")
        const select = (id: string, text: string, value: string, options: [string, string][], on: (v: string, said: string) => void): HTMLElement => {
            const el = h('select', { id, 'data-testid': id }, ...options.map(([v, name]) => h('option', { value: v, ...(v === value ? { selected: true } : {}) }, name)));
            const now = (): string => options.find(([v]) => v === el.value)?.[1] ?? '';
            const apply = (): void => on(el.value, `${text}: ${now()}`);
            el.addEventListener('change', apply);
            const at = (): number => Math.max(0, options.findIndex(([v]) => v === el.value));
            this.stop(el, () => `${text}: ${now()}`, {
                change: (dir) => {
                    const j = at() + dir;
                    if (j < 0 || j >= options.length) {
                        this.sayValue(`${text}: ${now()}. ${this.key('menu.change.limit')}`);
                        return;
                    }
                    el.value = (options[j] as [string, string])[0];
                    apply();
                },
                choose: () => {
                    el.value = (options[(at() + 1) % options.length] as [string, string])[0];
                    apply();
                }
            });
            return h('div', { class: 'sonic-field' }, label(id, text), el);
        };
        const check = (id: string, text: string, checked: boolean, on: (v: boolean, said: string) => void, hint?: string): HTMLElement => {
            const el = h('input', { type: 'checkbox', id, 'data-testid': id, ...(checked ? { checked: true } : {}), ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) });
            const apply = (): void => on(el.checked, `${text}: ${onOff(el.checked)}`);
            el.addEventListener('change', apply);
            const flip = (): void => {
                el.checked = !el.checked;
                apply();
            };
            this.stop(el, () => `${text}: ${onOff(el.checked)}${hint ? `. ${hint.replace(/\.$/, '')}` : ''}`, { change: flip, choose: flip });
            return h('div', { class: 'sonic-field sonic-check' }, el, label(id, text), hint ? h('span', { class: 'sonic-sub', id: `${id}-hint` }, hint) : null);
        };
        const range = (id: string, text: string, value: number, min: number, max: number, step: number, unit: string, on: (v: number, said: string) => void, shown?: () => boolean): HTMLElement => {
            const el = h('input', { type: 'range', id, 'data-testid': id, min, max, step, value });
            const out = h('output', { for: id }, `${value}${unit}`);
            const sync = (): void => {
                el.setAttribute('aria-valuetext', `${el.value}${unit}`);
                out.textContent = `${el.value}${unit}`;
            };
            sync();
            const apply = (): void => {
                sync();
                on(Number(el.value), `${text}: ${el.value}${unit}`);
            };
            el.addEventListener('input', apply);
            this.stop(el, () => `${text}: ${el.value}${unit}`, {
                ...(shown ? { shown } : {}),
                change: (dir) => {
                    const v = Math.round((Number(el.value) + dir * step) * 1000) / 1000;
                    if (v < min - 1e-9 || v > max + 1e-9) {
                        this.sayValue(`${text}: ${el.value}${unit}. ${this.key('menu.change.limit')}`);
                        return;
                    }
                    el.value = String(v);
                    apply();
                }
            });
            return h('div', { class: 'sonic-field' }, label(id, text), el, out);
        };
        const themes: [string, string][] = BUILTIN_THEME_IDS.map((id) => [id, this.key(`theme.${id}.name`)]);
        // the volume and pitch of each sound sit in a part that opens: its sliders are stops only while it is open
        const details = h('details', { class: 'sonic-details' });
        const open = (): boolean => details.hasAttribute('open');
        const summary = h('summary', {}, t('sonic.settings.layers'));
        const fields: HTMLElement[] = [
            select('sonic-theme', this.key('menu.setting.theme'), prefs.theme, themes, (v, said) => this.change({ theme: v }, said)),
            check('sonic-calm', this.key('menu.setting.calm'), prefs.calm, (v, said) => this.change({ calm: v }, said), this.key('menu.setting.calm-what')),
            select('sonic-polarity', this.key('menu.setting.polarity'), prefs.heightPolarity, [['up-higher', this.key('menu.value.up-higher')], ['up-lower', this.key('menu.value.up-lower')]], (v, said) => this.change({ heightPolarity: v as SonicPrefs['heightPolarity'] }, said)),
            range('sonic-rate', this.key('menu.setting.speech-rate'), prefs.speechRate, PREFS_LIMITS.speechRate.min, PREFS_LIMITS.speechRate.max, 0.1, 'x', (v, said) => this.change({ speechRate: Math.round(v * 10) / 10 }, said)),
            check('sonic-captions', this.key('menu.setting.captions'), prefs.captions, (v, said) => this.change({ captions: v }, said)),
            // "my screen reader speaks" is the engine NOT speaking: the box is the opposite of selfVoice
            check('sonic-sr', this.key('menu.setting.screen-reader'), !prefs.selfVoice, (v, said) => this.change({ selfVoice: !v }, said)),
            check('sonic-motor', this.key('menu.setting.motor'), prefs.motorSound, (v, said) => this.change({ motorSound: v, motorChoice: true }, said)),
            // v0.13 (W13): the motor's own level in the mode (after the engine's leveller), 3 dB a step, and the target height's note
            range('sonic-motor-level', this.key('menu.setting.motor-level'), prefs.motorGainDb ?? 0, PREFS_LIMITS.motorGainDb.min, PREFS_LIMITS.motorGainDb.max, 3, ' dB', (v, said) => this.change({ motorGainDb: v }, said)),
            check('sonic-height-target', this.key('menu.setting.height-target'), prefs.heightTarget !== false, (v, said) => this.change({ heightTarget: v }, said)),
            // v0.13 (v13-int step 3; the package's lane s13-elev, the owner's message 42): the cues of up and down also from above and
            // below, on unless the pilot turns it off; its description says what off does (the next stop cuts it, as any long line)
            check('sonic-height-direction', this.key('menu.setting.height-direction'), prefs.heightDirection !== false, (v, said) => this.change({ heightDirection: v }, said), this.key('menu.setting.height-direction-what')),
            // lane sonic-beacon: the target hum folded to the side of the target and an octave up on course, on unless the pilot turns it
            // off (the package's SonicPrefs.beacon); its description says what off does
            check('sonic-beacon', this.key('menu.setting.beacon'), prefs.beacon !== false, (v, said) => this.change({ beacon: v }, said), this.key('menu.setting.beacon-what')),
            select('sonic-frame', this.key('menu.setting.frame'), prefs.listenerFrame, [['heading', this.key('menu.value.heading')], ['body', this.key('menu.value.body')]], (v, said) => this.change({ listenerFrame: v as SonicPrefs['listenerFrame'] }, said)),
            // v0.13 (v13-int step 3; lane v13-look): the sound panel and the attitude display, each on unless the pilot turns it off; kept in
            // the collection beside the sound settings (look-prefs.ts), and the panels follow a change at once
            ...LOOK_PANELS.map((which) => check(`sonic-look-${which}`, t(LOOK_PANEL_LABELS[which]), panelOn(this.d.setup.host, which), (v, said) => this.panel(which, v, said))),
            // lane sonic-hints: the line of keys at every lesson step, brief or off (key-hints.ts)
            select('sonic-key-hints', t('sonic.settings.keyHints'), keyHintsChoice(this.d.setup.host), KEY_HINTS_CHOICES.map((c) => [c, t(`sonic.settings.keyHints.${c}`)]), (v, said) => {
                setKeyHints(this.d.setup.host, v as KeyHintsChoice);
                this.sayValue(said);
            })
        ];
        this.stop(summary, () => t('sonic.settings.layers'));
        const layerRows = LAYER_IDS.map((id: LayerId) => {
            const name = this.key(`layer.${id}.name`);
            return h('div', { class: 'sonic-layer' }, h('h4', {}, name),
                range(`sonic-gain-${id}`, this.key('menu.setting.volume', { layer: name }), prefs.layerGainDb[id] ?? 0, PREFS_LIMITS.gainDb.min, PREFS_LIMITS.gainDb.max, 1, ' dB', (v, said) => this.change({ layerGainDb: this.layerMap(this.d.setup.prefs.layerGainDb, id, v) }, said), open),
                range(`sonic-pitch-${id}`, this.key('menu.setting.pitch', { layer: name }), prefs.layerPitchSteps[id] ?? 0, PREFS_LIMITS.pitchSteps.min, PREFS_LIMITS.pitchSteps.max, 1, '', (v, said) => this.change({ layerPitchSteps: this.layerMap(this.d.setup.prefs.layerPitchSteps, id, v) }, said), open));
        });
        details.append(summary, ...layerRows);
        return this.section('settings', this.key('menu.settings.title'), ...fields, details);
    }

    private footer(): HTMLElement {
        this.begin('footer');
        const about = h('a', { href: `/${this.d.locale}/sound/`, 'data-testid': 'sonic-about' }, t('sonic.footer.about'));
        const leave = h('a', { href: `/${this.d.locale}/fly/`, 'data-testid': 'sonic-leave' }, t('sonic.footer.leave'));
        this.stop(about, () => t('sonic.footer.about'));
        this.stop(leave, () => t('sonic.footer.leave'));
        return h('footer', {}, h('ul', {}, h('li', {}, about), h('li', {}, leave)));
    }

    // ------------------------------------------------------------------ actions

    /** `layer`'s entry set to `v` (zero is no entry, so the saved document stays small). */
    private layerMap(map: Readonly<Partial<Record<LayerId, number>>>, layer: LayerId, v: number): Partial<Record<LayerId, number>> {
        const out: Partial<Record<LayerId, number>> = { ...map };
        if (v === 0) delete out[layer];
        else out[layer] = v;
        return out;
    }

    /**
     * A setting changed: applied and saved, and its new value said by the voice (`said`); a refusal is said and the screen is drawn from
     * what is really set.
     */
    private change(patch: Partial<SonicPrefs>, said?: string): void {
        const visit = Object.keys(this.d.setup.visit);
        const r = this.d.setup.update(patch);
        if (!r.ok) {
            this.say(r.reasons.join('. '));
            this.render();
            return;
        }
        if (said !== undefined) this.sayValue(said);
        // the path decides which lesson the Start buttons open: the buttons follow it, the focus stays where it is; a setting a shared
        // link set is the pilot's own once he changes it, so the note of the link loses it
        if (patch.path !== undefined || Object.keys(patch).some((k) => visit.includes(k))) this.refreshStart();
    }

    /** A panel of the look turned on or off (saved in the collection 'sonic'; the page's panels follow the change at once), and said. */
    private panel(which: LookPanel, on: boolean, said: string): void {
        setPanel(this.d.setup.host, which, on);
        this.sayValue(said);
    }

    private refreshStart(): void {
        const focused = document.activeElement?.id;
        this.model = buildModel(this.d.progress(), this.d.current(), this.d.setup.prefs.path);
        const old = this.sections.get('start');
        if (old) {
            const fresh = this.startSection();
            old.replaceWith(fresh);
            this.syncList();
            // the focus back on the control it was on (now a new one): said already, not again
            this.quiet = true;
            try {
                if (focused) document.getElementById(focused)?.focus();
            } finally {
                this.quiet = false;
            }
        }
    }

    /** "Reset my progress": the screen asks first, the focus on No. */
    private askReset(): void {
        this.confirming = true;
        this.redrawReset();
        this.announce(this.resetQuestion());
        this.root.querySelector<HTMLElement>('#sonic-reset-no')?.focus();
    }

    /** The answer: Yes clears the progress (the settings stay) and the screen is drawn again, every lesson new; No keeps it. */
    private endReset(yes: boolean): void {
        if (!this.confirming) return;
        this.confirming = false;
        if (yes && this.d.resetProgress) {
            this.d.resetProgress();
            // a lesson running under the screen holds its old counts: it forgets them too (v13-int step 5)
            this.d.onReset?.();
            this.render();
            this.announce(t('sonic.reset.done'));
            this.root.querySelector<HTMLElement>('[data-testid="sonic-start-beginning"]')?.focus();
            return;
        }
        this.redrawReset();
        this.announce(t('sonic.reset.kept'));
        this.root.querySelector<HTMLElement>('#sonic-reset')?.focus();
    }

    private redrawReset(): void {
        const old = this.resetBox;
        const fresh = this.resetPart();
        this.resetBox = fresh;
        old?.replaceWith(fresh);
        this.syncList();
    }

    private start(id: string): void {
        const title = this.S({ key: `lesson.${id}.title` });
        this.say(t('sonic.start.starting', { title }));
        this.d.onStart(id);
    }

    /** A sound on one side. The first press of any sound button makes the AudioContext (it is a user activation). */
    private headphoneCheck(side: 'left' | 'right' | 'behind'): void {
        const audio = this.d.setup.audio;
        const started = audio.start();
        this.woke = true;
        this.say(t(`sonic.hp.playing.${side}`));
        void started.then(() => {
            if (!audio.available) {
                this.say(t('sonic.start.noAudio'));
                return;
            }
            const e = audio.engine;
            e.setLayers({ on: ['target'], heightBandM: null, hazardVoices: 0 });
            // the engine plans from a frame: one still frame at the centre, then the hum from that side
            e.update({ sample: NEUTRAL, world: null, target: null, floorY: 0 });
            e.cue({ kind: 'preview', cue: 'target.hum', dir: HEADPHONE_DIRS[side] });
        });
    }

    /**
     * The handlers are replaced (the first flight is launched by the entry, later lessons open in the flight); `say`: the voice over the
     * flight (the lesson's speech queue while one runs).
     */
    bind(h: { readonly onStart: (lessonId: string) => void; readonly onClose: () => void; readonly say?: ScreenVoice; readonly onReset?: () => void }): void {
        this.d = { ...this.d, onStart: h.onStart, onClose: h.onClose, ...(h.say ? { say: h.say } : {}), ...(h.onReset ? { onReset: h.onReset } : {}) };
        if (!this.root.hidden) this.render();
    }

    // ------------------------------------------------------------------ showing

    /**
     * The screen is shown and the focus is on its h1 (a screen reader starts reading there), or on a section's heading (the lesson
     * menu's Sound settings opens the settings: v0.13 B6). The voice says where the focus is once it can be heard.
     */
    show(section?: (typeof SECTIONS)[number]): void {
        this.root.hidden = false;
        this.root.removeAttribute('inert');
        this.render();
        const at = section ? this.sections.get(section)?.querySelector<HTMLElement>('h2') : null;
        (at ?? this.root.querySelector<HTMLElement>('#sonic-h1'))?.focus();
    }

    /**
     * The screen goes away from the page and the accessibility tree (the flight takes the page). The focus leaves it now (review F4): the
     * browser takes it off a hidden control only at its next rendering, so the flight page, asking at once, saw the screen's control still
     * focused and left the focus on the body, where a screen reader's quick keys take the flight's letters (feature.ts focusFlight).
     */
    hide(): void {
        const at = document.activeElement as HTMLElement | null;
        if (at !== null && at !== document.body && this.root.contains(at)) at.blur();
        this.root.hidden = true;
        this.root.setAttribute('inert', '');
    }

    /** The screen is on the page (shown over the flight, or before it). */
    get shown(): boolean {
        return !this.root.hidden;
    }

    dispose(): void {
        removeEventListener('keydown', this.onKeyDown, true);
        this.root.removeEventListener('focusin', this.onFocusIn);
        this.root.remove();
    }
}
