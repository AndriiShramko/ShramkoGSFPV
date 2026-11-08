// The Fly by Sound start screen (v0.12, docs/wip/v12-plan.md 2.10 and 4.2 step 8; spec sections 3 and 6): plain HTML that
// works with the keyboard alone and with a screen reader. It is built OUTSIDE #ui, which is one aria-live region for the
// flight's own notes (apps/fly/index.html): inside it every change would be read out. Landmarks (header, navigation,
// main, footer), one h1 and h2 per section (h3 per module), native buttons, a radio group, selects, checkboxes and
// sliders with labels: nothing is a div with a click handler, so Tab, Enter, Space and the arrow keys do what a screen
// reader user expects. Every lesson is a button, whatever the path (the ladder is a recommendation, not a gate).
//
//   Start      Continue where I stopped, Start from the beginning (of the path), and, when ?sonic=<lesson> asked for one,
//              Start: <that lesson>; the path (full or fast); each opens a lesson through `onStart` inside the press,
//              which is the user activation the AudioContext and the speech need.
//   Headphones a sound on the left, on the right, behind: made by the engine (its first press makes the AudioContext),
//              with the package's notes (wired, no surround effects) and the loudness note beside it.
//   Lessons    every shipped lesson (28 since v0.13) by module with where the pilot stands (passed, in progress, not started).
//   Settings   the pilot's own sound: theme, calm, height polarity, speaking speed, captions, "my screen reader speaks",
//              motor sound, what the sound turns with, each sound's volume and pitch. Each change applies at once and is
//              saved (SonicSetup.update).
// Texts: the sound package's own strings for lessons, modules, menu, settings and hearing (its dictionaries), the
// simulator's `sonic.*` keys for the rest, in en, es, pl and ru.
import { BUILTIN_THEME_IDS, DICTS, LAYER_IDS, PREFS_LIMITS, createTranslator } from '@shramko/sonic-fpv';
import type { FlightSample, LayerId, Locale, SonicPrefs, SpeechLine, Vec3 } from '@shramko/sonic-fpv';
import { h } from '../ui/dom';
import { t } from '../i18n';
import type { SonicSetup, VisitPrefs } from './entry';
import { buildModel } from './start-model';
import type { LessonRow, SonicRequest, StartModel } from './start-model';
import './sonic.css';

/** Directions of the headphone check, in the listener's frame (x right, y up, z back). */
export const HEADPHONE_DIRS: Readonly<Record<'left' | 'right' | 'behind', Vec3>> = { left: [-1, 0, 0], right: [1, 0, 0], behind: [0, 0, 1] };

const NEUTRAL: FlightSample = { t: 0, tick: 0, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };

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
}

/** Sections of the page the navigation jumps to. */
const SECTIONS = ['start', 'headphones', 'lessons', 'settings'] as const;

/** The id of the shared link's note: the primary Start button and the note's own buttons point to it. */
const VISIT_TEXT_ID = 'sonic-visit-text';

export class StartScreen {
    readonly root: HTMLElement;
    private d: StartScreenDeps;
    private readonly tr: ReturnType<typeof createTranslator>;
    private readonly status: HTMLElement;
    private model: StartModel;
    private sections = new Map<string, HTMLElement>();
    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && this.d.onClose && !this.root.hidden) {
            e.preventDefault();
            e.stopPropagation();
            this.d.onClose();
        }
    };

    constructor(deps: StartScreenDeps, parent: HTMLElement = document.body) {
        this.d = deps;
        this.tr = createTranslator(deps.locale, DICTS);
        this.status = h('div', { class: 'sonic-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-testid': 'sonic-status' });
        this.model = buildModel(deps.progress(), deps.current(), deps.setup.prefs.path);
        this.root = h('div', { class: 'sonic-start', id: 'sonic-start', 'data-testid': 'sonic-start', lang: deps.locale });
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
    }

    // ------------------------------------------------------------------ parts

    private header(): HTMLElement {
        return h('header', {}, h('h1', { id: 'sonic-h1', tabindex: -1, 'data-testid': 'sonic-h1' }, this.key('app.name')), h('p', { class: 'sonic-intro' }, t('sonic.start.intro')));
    }

    private nav(): HTMLElement {
        const labels: Record<(typeof SECTIONS)[number], string> = { start: t('sonic.nav.start'), headphones: t('sonic.nav.headphones'), lessons: this.key('menu.lessons.title'), settings: this.key('menu.settings.title') };
        const items = SECTIONS.map((id) => {
            const a = h('a', { href: `#sonic-sec-${id}`, onclick: (e: Event) => {
                e.preventDefault();
                this.sections.get(id)?.querySelector<HTMLElement>('h2')?.focus();
            } }, labels[id]);
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
        const prefs = this.d.setup.prefs;
        const m = this.model;
        const req = this.d.request;
        const buttons: HTMLElement[] = [];
        const visit = this.visitNote(this.d.setup.visit);
        // the primary Start carries the link's note as its description: a pilot who tabs straight to it hears what sound it starts with
        const lessonButton = (id: string, label: string, sub: string | null, primary: boolean, testid: string): HTMLElement =>
            h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, 'data-testid': testid, 'data-lesson': id, ...(primary && visit ? { 'aria-describedby': VISIT_TEXT_ID } : {}), onclick: () => this.start(id) }, label, sub ? h('span', { class: 'sonic-sub' }, sub) : null);
        const titleOf = (id: string): string => this.S(this.model.modules.flatMap((x) => x.lessons).find((l) => l.id === id)?.title ?? { key: `lesson.${id}.title` });
        let primaryTaken = false;
        if (req.kind === 'lesson') {
            buttons.push(lessonButton(req.id, t('sonic.start.lesson', { title: titleOf(req.id) }), null, true, 'sonic-start-asked'));
            primaryTaken = true;
        }
        if (m.continueId) {
            buttons.push(lessonButton(m.continueId, this.key('menu.main.continue'), this.key('fly.next-step', { title: titleOf(m.continueId) }), !primaryTaken, 'sonic-start-continue'));
            primaryTaken = true;
        }
        buttons.push(lessonButton(m.beginningId, this.key('menu.main.start'), this.key('fly.next-step', { title: titleOf(m.beginningId) }), !primaryTaken, 'sonic-start-beginning'));
        const radios = (['full', 'fast'] as const).map((p) => {
            const input = h('input', { type: 'radio', name: 'sonic-path', value: p, id: `sonic-path-${p}`, 'data-testid': `sonic-path-${p}`, ...(prefs.path === p ? { checked: true } : {}) });
            input.addEventListener('change', () => this.change({ path: p }));
            return h('div', { class: 'sonic-choice' }, input, h('label', { for: `sonic-path-${p}` }, this.key(p === 'fast' ? 'menu.main.path-fast' : 'menu.main.path-full'), h('span', { class: 'sonic-sub' }, this.key(p === 'fast' ? 'menu.path.fast-what' : 'menu.path.full-what'))));
        });
        const unknown = req.kind === 'unknown' ? h('p', { class: 'sonic-note', role: 'note', 'data-testid': 'sonic-unknown' }, t('sonic.start.unknown', { id: req.raw })) : null;
        const back = this.d.onClose ? h('button', { type: 'button', class: 'btn', 'data-testid': 'sonic-back', onclick: () => this.d.onClose?.() }, t('sonic.close')) : null;
        return this.section('start', t('sonic.start.heading'), unknown, visit?.note ?? null, h('div', { class: 'sonic-actions', role: 'group', 'aria-label': t('sonic.start.heading') }, ...buttons, back), visit?.choice ?? null, h('fieldset', { class: 'sonic-fieldset' }, h('legend', {}, t('sonic.path.legend')), ...radios));
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
        const play = (side: 'left' | 'right' | 'behind'): void => this.headphoneCheck(side);
        const buttons = (['left', 'right', 'behind'] as const).map((side) => h('button', { type: 'button', class: 'btn', 'data-testid': `sonic-hp-${side}`, onclick: () => play(side) }, t(`sonic.hp.${side}`)));
        const notes = h('ul', { class: 'sonic-notes' }, h('li', {}, this.key('headphones.intro')), h('li', {}, this.key('headphones.wired')), h('li', {}, this.key('headphones.os-spatial')));
        const loud = h('div', { class: 'sonic-loud', role: 'group', 'aria-labelledby': 'sonic-h-loud' }, h('h3', { id: 'sonic-h-loud', tabindex: -1 }, t('sonic.loud.heading')), h('p', { 'data-testid': 'sonic-loud-note' }, this.key('menu.hearing-note')), h('p', {}, this.key('headphones.volume')));
        return this.section('headphones', t('sonic.hp.heading'), notes, h('div', { class: 'sonic-actions', role: 'group', 'aria-label': t('sonic.hp.heading') }, ...buttons), loud);
    }

    private lessonsSection(): HTMLElement {
        const lists = this.model.modules.map((mod) => {
            const hid = `sonic-mod-${mod.module}`;
            const items = mod.lessons.map((l) => h('li', {}, this.lessonButton(l)));
            return h('section', { class: 'sonic-module', 'aria-labelledby': hid }, h('h3', { id: hid, tabindex: -1 }, this.S(mod.name)), h('ul', { class: 'sonic-lessons' }, ...items));
        });
        return this.section('lessons', this.key('menu.lessons.title'), h('p', { class: 'sonic-hint' }, t('sonic.lessons.hint')), ...lists);
    }

    private lessonButton(l: LessonRow): HTMLElement {
        const state = this.key(l.state === 'passed' ? 'menu.lesson.passed' : l.state === 'current' ? 'menu.lesson.current' : 'menu.lesson.new');
        const notes = [state, l.bestTimeMs !== null ? t('sonic.lessons.bestTime', { time: this.tr.duration(l.bestTimeMs) }) : null, l.fastPath ? this.key('menu.main.path-fast') : null, l.scan ? t('sonic.lessons.scan') : null].filter((x): x is string => x !== null);
        // the name a screen reader says: the title, then where the pilot stands, in the same words as the spoken menu
        return h('button', { type: 'button', class: `btn sonic-lesson sonic-${l.state}`, 'data-testid': 'sonic-lesson', 'data-lesson': l.id, 'data-state': l.state, onclick: () => this.start(l.id) }, this.S(l.title), h('span', { class: 'sonic-sub' }, notes.join(', ')));
    }

    private settingsSection(): HTMLElement {
        const prefs = this.d.setup.prefs;
        const label = (id: string, text: string): HTMLLabelElement => h('label', { for: id }, text);
        const select = (id: string, text: string, value: string, options: [string, string][], on: (v: string) => void): HTMLElement => {
            const el = h('select', { id, 'data-testid': id }, ...options.map(([v, name]) => h('option', { value: v, ...(v === value ? { selected: true } : {}) }, name)));
            el.addEventListener('change', () => on(el.value));
            return h('div', { class: 'sonic-field' }, label(id, text), el);
        };
        const check = (id: string, text: string, checked: boolean, on: (v: boolean) => void, hint?: string): HTMLElement => {
            const el = h('input', { type: 'checkbox', id, 'data-testid': id, ...(checked ? { checked: true } : {}), ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) });
            el.addEventListener('change', () => on(el.checked));
            return h('div', { class: 'sonic-field sonic-check' }, el, label(id, text), hint ? h('span', { class: 'sonic-sub', id: `${id}-hint` }, hint) : null);
        };
        const range = (id: string, text: string, value: number, min: number, max: number, step: number, unit: string, on: (v: number) => void): HTMLElement => {
            const el = h('input', { type: 'range', id, 'data-testid': id, min, max, step, value });
            const out = h('output', { for: id }, `${value}${unit}`);
            const sync = (): void => {
                el.setAttribute('aria-valuetext', `${el.value}${unit}`);
                out.textContent = `${el.value}${unit}`;
            };
            sync();
            el.addEventListener('input', () => {
                sync();
                on(Number(el.value));
            });
            return h('div', { class: 'sonic-field' }, label(id, text), el, out);
        };
        const themes: [string, string][] = BUILTIN_THEME_IDS.map((id) => [id, this.key(`theme.${id}.name`)]);
        const layerRows = LAYER_IDS.filter((id) => id !== 'room' || true).map((id: LayerId) => {
            const name = this.key(`layer.${id}.name`);
            return h('div', { class: 'sonic-layer' }, h('h4', {}, name),
                range(`sonic-gain-${id}`, this.key('menu.setting.volume', { layer: name }), prefs.layerGainDb[id] ?? 0, PREFS_LIMITS.gainDb.min, PREFS_LIMITS.gainDb.max, 1, ' dB', (v) => this.change({ layerGainDb: this.layerMap(prefs.layerGainDb, id, v) })),
                range(`sonic-pitch-${id}`, this.key('menu.setting.pitch', { layer: name }), prefs.layerPitchSteps[id] ?? 0, PREFS_LIMITS.pitchSteps.min, PREFS_LIMITS.pitchSteps.max, 1, '', (v) => this.change({ layerPitchSteps: this.layerMap(prefs.layerPitchSteps, id, v) })));
        });
        return this.section('settings', this.key('menu.settings.title'),
            select('sonic-theme', this.key('menu.setting.theme'), prefs.theme, themes, (v) => this.change({ theme: v })),
            check('sonic-calm', this.key('menu.setting.calm'), prefs.calm, (v) => this.change({ calm: v }), this.key('menu.setting.calm-what')),
            select('sonic-polarity', this.key('menu.setting.polarity'), prefs.heightPolarity, [['up-higher', this.key('menu.value.up-higher')], ['up-lower', this.key('menu.value.up-lower')]], (v) => this.change({ heightPolarity: v as SonicPrefs['heightPolarity'] })),
            range('sonic-rate', this.key('menu.setting.speech-rate'), prefs.speechRate, PREFS_LIMITS.speechRate.min, PREFS_LIMITS.speechRate.max, 0.1, 'x', (v) => this.change({ speechRate: Math.round(v * 10) / 10 })),
            check('sonic-captions', this.key('menu.setting.captions'), prefs.captions, (v) => this.change({ captions: v })),
            // "my screen reader speaks" is the engine NOT speaking: the box is the opposite of selfVoice
            check('sonic-sr', this.key('menu.setting.screen-reader'), !prefs.selfVoice, (v) => this.change({ selfVoice: !v })),
            check('sonic-motor', this.key('menu.setting.motor'), prefs.motorSound, (v) => this.change({ motorSound: v })),
            select('sonic-frame', this.key('menu.setting.frame'), prefs.listenerFrame, [['heading', this.key('menu.value.heading')], ['body', this.key('menu.value.body')]], (v) => this.change({ listenerFrame: v as SonicPrefs['listenerFrame'] })),
            h('details', { class: 'sonic-details' }, h('summary', {}, t('sonic.settings.layers')), ...layerRows));
    }

    private footer(): HTMLElement {
        const about = h('a', { href: `/${this.d.locale}/sound/`, 'data-testid': 'sonic-about' }, t('sonic.footer.about'));
        const leave = h('a', { href: `/${this.d.locale}/fly/`, 'data-testid': 'sonic-leave' }, t('sonic.footer.leave'));
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

    /** A setting changed: applied and saved; a refusal is said and the screen is drawn from what is really set. */
    private change(patch: Partial<SonicPrefs>): void {
        const visit = Object.keys(this.d.setup.visit);
        const r = this.d.setup.update(patch);
        if (!r.ok) {
            this.say(r.reasons.join('. '));
            this.render();
            return;
        }
        // the path decides which lesson the Start buttons open: the buttons follow it, the focus stays where it is; a setting a shared
        // link set is the pilot's own once he changes it, so the note of the link loses it
        if (patch.path !== undefined || Object.keys(patch).some((k) => visit.includes(k))) this.refreshStart();
    }

    private refreshStart(): void {
        const focused = document.activeElement?.id;
        this.model = buildModel(this.d.progress(), this.d.current(), this.d.setup.prefs.path);
        const old = this.sections.get('start');
        if (old) {
            const fresh = this.startSection();
            old.replaceWith(fresh);
            if (focused) document.getElementById(focused)?.focus();
        }
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

    /** The handlers are replaced (the first flight is launched by the entry, later lessons open in the flight). */
    bind(h: { readonly onStart: (lessonId: string) => void; readonly onClose: () => void }): void {
        this.d = { ...this.d, onStart: h.onStart, onClose: h.onClose };
        if (!this.root.hidden) this.render();
    }

    // ------------------------------------------------------------------ showing

    /**
     * The screen is shown and the focus is on its h1 (a screen reader starts reading there), or on a section's heading (the lesson
     * menu's Sound settings opens the settings: v0.13 B6).
     */
    show(section?: (typeof SECTIONS)[number]): void {
        this.root.hidden = false;
        this.root.removeAttribute('inert');
        this.render();
        const at = section ? this.sections.get(section)?.querySelector<HTMLElement>('h2') : null;
        (at ?? this.root.querySelector<HTMLElement>('#sonic-h1'))?.focus();
    }

    /** The screen goes away from the page and the accessibility tree (the flight takes the page). */
    hide(): void {
        this.root.hidden = true;
        this.root.setAttribute('inert', '');
    }

    dispose(): void {
        removeEventListener('keydown', this.onKeyDown, true);
        this.root.remove();
    }
}
