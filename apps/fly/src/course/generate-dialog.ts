// Lane gen4b, B1 (design C:/dev/.gsfpv-lanes/designs/gen4.md section 3, complaints G7-G9 and the end of G3): the 'Generate a
// course' dialog. Shift+G, the pause menu's item and the editor's G open it (app/builtin/course.ts openGenerateDialog): the
// pilot picks the level (Beginner, Medium, Pro) and the spread (Compact, Whole scene), reads what is replaced, and presses
// the main button (or Enter). Nothing is built and nothing is deleted before that press; the cross, Cancel and Esc build
// nothing. The model (dialogModel) is pure so the test reads every text and button without a page; GenerateDialog is its DOM.
import { LEVELS, VOXEL_VIEW_GATES } from '@gsfpv/tracks';
import type { CourseLevel, CourseRequest, CourseSpread, LevelRules } from '@gsfpv/tracks';
import { h } from '../ui/dom';

export type GenerateFrom = 'flight' | 'menu' | 'editor';
export const COURSE_LEVELS: readonly CourseLevel[] = ['beginner', 'medium', 'pro'];
export const COURSE_SPREADS: readonly CourseSpread[] = ['compact', 'wide'];

/** What the dialog is opened over. */
export interface DialogState {
    readonly level: CourseLevel;
    readonly spread: CourseSpread;
    /** the voxels-only view is on (store 'voxels.show' is 'only'): the whole scene, any scan quality */
    readonly voxelsOnly: boolean;
    /** gates of the course shown now; 0 without one */
    readonly shownGates: number;
    /** the editor holds changes that were not saved */
    readonly unsaved: boolean;
}

export interface ChoiceButton<T> {
    readonly id: T;
    readonly label: string;
    readonly pressed: boolean;
}

export interface DialogModel {
    readonly title: string;
    readonly levels: readonly ChoiceButton<CourseLevel>[];
    /** the chosen level in numbers: gates, opening, turns */
    readonly levelLine: string;
    /** empty in the voxels-only view: the spread is set there and `spreadLine` says so */
    readonly spreads: readonly ChoiceButton<CourseSpread>[];
    readonly spreadLine: string;
    /** 'Replaces the current course (N gates)' when a course is shown, else null */
    readonly replaces: string | null;
    /** 'Your unsaved changes are lost' when the editor holds unsaved changes, else null */
    readonly lost: string | null;
    readonly main: string;
    readonly cancel: string;
    /** what the main button asks the generator for (the seed is added by the page) */
    readonly request: Omit<CourseRequest, 'seed'>;
}

type Words = (key: string, vars?: Record<string, string | number>) => string;

/** degrees of the largest turn a level allows, from its cosine (rounded to 5 deg for the line) */
export function turnDeg(cosMin: number): number {
    return Math.round((Math.acos(Math.max(-1, Math.min(1, cosMin))) * 180) / Math.PI / 5) * 5;
}

export function levelLine(level: CourseLevel, t: Words, rules: Readonly<Record<CourseLevel, LevelRules>> = LEVELS): string {
    const r = rules[level];
    return t('course.gen.levelLine', { min: r.gatesMin, max: r.gatesMax, d: r.openingD, deg: turnDeg(r.turnCosMin) });
}

/** The dialog's texts, buttons and the request of its main button. */
export function dialogModel(s: DialogState, t: Words, rules: Readonly<Record<CourseLevel, LevelRules>> = LEVELS): DialogModel {
    const wide = s.voxelsOnly || s.spread === 'wide';
    return {
        title: t('course.gen.title'),
        levels: COURSE_LEVELS.map((id) => ({ id, label: t(`course.gen.level.${id}`), pressed: id === s.level })),
        levelLine: levelLine(s.level, t, rules),
        spreads: s.voxelsOnly ? [] : COURSE_SPREADS.map((id) => ({ id, label: t(`course.gen.spread.${id}`), pressed: id === s.spread })),
        spreadLine: s.voxelsOnly ? t('course.gen.spreadVoxels', { n: VOXEL_VIEW_GATES }) : t(`course.gen.spreadLine.${s.spread}`),
        replaces: s.shownGates > 0 ? t('course.gen.replaces', { n: s.shownGates }) : null,
        lost: s.unsaved ? t('course.gen.lost') : null,
        main: t(s.shownGates > 0 ? 'course.gen.replace' : 'course.gen.build'),
        cancel: t('course.gen.cancel'),
        request: { level: s.level, spread: wide ? 'wide' : 'compact', anyQuality: s.voxelsOnly }
    };
}

export type PressAction = 'dialog' | 'direct' | 'wait';
/**
 * What Shift+G, the pause menu's item and the editor's G do: open the dialog (G9: no course is replaced before a yes). A press
 * while a course is being built is answered by its progress ('wait'); Fly by Sound builds at once ('direct': the ear pilot has
 * no visual dialog; its course ask is its own, sound-mode lines say what was built).
 */
export function pressAction(p: { readonly busy: boolean; readonly sonic: boolean }): PressAction {
    if (p.busy) return 'wait';
    return p.sonic ? 'direct' : 'dialog';
}

/** The dialog's keys by e.code, so every keyboard layout gives the same: Enter builds, Esc cancels (as the cross). */
export function dialogKey(code: string): 'build' | 'cancel' | null {
    if (code === 'Enter' || code === 'NumpadEnter') return 'build';
    return code === 'Escape' ? 'cancel' : null;
}

export interface DialogHandlers {
    /** the level or the spread was picked (the page remembers it) */
    readonly pick: (p: { level?: CourseLevel; spread?: CourseSpread }) => void;
    readonly build: (request: Omit<CourseRequest, 'seed'>) => void;
    readonly cancel: () => void;
}

/** The dialog on the page: a .panel with its own 44 px cross, over the paused flight. */
export class GenerateDialog {
    private root: HTMLDivElement | null = null;
    private state: DialogState | null = null;
    private onKey: ((e: KeyboardEvent) => void) | null = null;

    constructor(private readonly parent: HTMLElement, private readonly t: Words, private readonly on: DialogHandlers) {}

    get isOpen(): boolean {
        return this.root !== null;
    }

    /** the model shown now (the page hook reads it); null when closed */
    model(): DialogModel | null {
        return this.state ? dialogModel(this.state, this.t) : null;
    }

    open(state: DialogState): void {
        this.state = state;
        this.paint();
        if (!this.onKey) {
            this.onKey = (e: KeyboardEvent) => {
                const k = dialogKey(e.code);
                if (e.repeat || k === null || !this.root) return;
                // the dialog is on top: the key is its own, the pause menu (Esc) and the editor's keys do not see it
                e.preventDefault();
                e.stopImmediatePropagation();
                if (k === 'build') this.build();
                else this.cancel();
            };
            addEventListener('keydown', this.onKey, true);
        }
    }

    /** closes without building (the page's own close: a new scene, the editor gone) */
    close(): void {
        if (this.onKey) removeEventListener('keydown', this.onKey, true);
        this.onKey = null;
        this.root?.remove();
        this.root = null;
        this.state = null;
    }

    private cancel(): void {
        this.close();
        this.on.cancel();
    }

    private build(): void {
        const m = this.model();
        if (!m) return;
        this.close();
        this.on.build(m.request);
    }

    private pick(p: { level?: CourseLevel; spread?: CourseSpread }): void {
        if (!this.state) return;
        this.state = { ...this.state, ...p };
        this.on.pick(p);
        this.paint();
    }

    private paint(): void {
        const m = this.model();
        if (!m) return;
        const choice = <T extends string>(b: ChoiceButton<T>, act: string, go: () => void): HTMLButtonElement =>
            h('button', { type: 'button', class: `btn gen-choice${b.pressed ? ' primary' : ''}`, 'data-action': `${act}-${b.id}`, 'aria-pressed': b.pressed ? 'true' : 'false', onclick: go }, b.label);
        const x = h('button', { class: 'panel-x', type: 'button', 'aria-label': m.cancel, title: `${m.cancel} (Esc)`, 'aria-keyshortcuts': 'Escape', 'data-action': 'gen-x', onclick: () => this.cancel() }, '×');
        const root = h('div', { class: 'panel interactive gen-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.title, 'data-testid': 'gen-dialog' },
            h('div', { class: 'panel-head' }, h('h2', {}, m.title), x),
            h('div', { class: 'gen-row', role: 'group', 'aria-label': this.t('course.gen.levelTitle') }, ...m.levels.map((b) => choice(b, 'gen-level', () => this.pick({ level: b.id })))),
            h('p', { class: 'gen-line', 'data-testid': 'gen-level-line' }, m.levelLine),
            m.spreads.length ? h('div', { class: 'gen-row', role: 'group', 'aria-label': this.t('course.gen.spreadTitle') }, ...m.spreads.map((b) => choice(b, 'gen-spread', () => this.pick({ spread: b.id })))) : null,
            h('p', { class: 'gen-line', 'data-testid': 'gen-spread-line' }, m.spreadLine),
            m.replaces ? h('p', { class: 'gen-warn', 'data-testid': 'gen-replaces' }, m.replaces) : null,
            m.lost ? h('p', { class: 'gen-warn', 'data-testid': 'gen-lost' }, m.lost) : null,
            h('div', { class: 'gen-actions' },
                h('button', { type: 'button', class: 'btn gen-cancel', 'data-action': 'gen-cancel', onclick: () => this.cancel() }, m.cancel),
                h('button', { type: 'button', class: 'btn primary gen-main', 'data-action': 'gen-build', 'aria-keyshortcuts': 'Enter', title: `${m.main} (${this.t('course.gen.enter')})`, onclick: () => this.build() }, m.main)));
        this.root?.remove();
        this.parent.append(root);
        this.root = root;
    }
}
