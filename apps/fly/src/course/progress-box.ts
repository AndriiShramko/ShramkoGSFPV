// Lane gen4b, B2 (design C:/dev/.gsfpv-lanes/designs/gen4.md section 3, complaint G9 and the end of G3): the course's own
// box in the top-centre column. While the course is built it shows the step in plain words, a bar, the percent, the time
// left and Cancel (44 px), and it stays until the worker answers (the old HUD note of 13 px hid itself 2 s after a late
// tick). When no gate fits it turns into the no-room box with one press on: 'Make the scene xN and build' (or another
// layout when no size helps), and Close. The models are pure (tools/bench/test/course-progress.test.ts); CourseBox is the DOM.
import { h } from '../ui/dom';
import { clock, roundLeft, stepText } from './progress';
import type { ProgressView } from './progress';

type Words = (key: string, params?: Record<string, string | number>) => string;

export interface ProgressBoxModel {
    readonly kind: 'progress';
    readonly title: string;
    readonly step: string;
    /** 0..100, never back (ProgressClock), 100 on the answer */
    readonly pct: number;
    /** 'n of m' of the steps */
    readonly stepOf: string;
    readonly left: string;
    readonly cancel: string;
}

export interface NoRoomModel {
    readonly kind: 'noRoom';
    readonly text: string;
    /** the one press on: the larger Scene size and the build, or another layout */
    readonly action: string;
    /** the Scene size the action sets; null: the action builds another layout at this size */
    readonly to: number | null;
    readonly close: string;
}

export type CourseBoxModel = ProgressBoxModel | NoRoomModel;

export function progressBoxModel(v: ProgressView, t: Words): ProgressBoxModel {
    return {
        kind: 'progress',
        title: t('course.gen.progressTitle'),
        step: stepText(v, t),
        pct: Math.max(0, Math.min(100, Math.round(v.pct))),
        stepOf: t('course.gen.stepOf', { n: v.n, m: v.m }),
        left: v.pct >= 100 ? t('course.gen.done') : v.leftS === null ? t('course.gen.over', { elapsed: clock(v.elapsedS) }) : t('course.gen.left', { left: clock(roundLeft(v.leftS)) }),
        cancel: t('course.gen.cancel')
    };
}

/** a Scene size as the line says it: x4, x1.5 */
export function sizeText(v: number): string {
    return String(Math.round(v * 100) / 100);
}

/** No gate the flown drone passes fits at Scene size `size`; `to` is the size at which one fits, null when none is known. */
export function noRoomModel(size: number, to: number | null, t: Words): NoRoomModel {
    const grow = to !== null && to > size;
    return {
        kind: 'noRoom',
        text: t('course.gen.noRoom', { s: sizeText(size) }),
        action: grow ? t('course.gen.noRoomGrow', { to: sizeText(to) }) : t('course.gen.noRoomAgain'),
        to: grow ? to : null,
        close: t('course.gen.close')
    };
}

/** The line after a course appears: where its start gate is from the craft (flown m). */
export function startLine(distanceM: number, gates: number, t: Words): string {
    const m = Math.round(distanceM);
    return m < 2 ? t('course.gen.startHere', { n: gates }) : t('course.gen.startAhead', { n: gates, m });
}

/** How long the start line stays (the design: 8 s; the owner: long enough to read) */
export const START_LINE_MS = 8_000;

export interface CourseBoxHandlers {
    readonly cancel: () => void;
    readonly grow: (to: number | null) => void;
}

/** the elements of the progress state a tick writes into */
interface ProgressParts {
    readonly step: HTMLElement;
    readonly pct: HTMLElement;
    readonly left: HTMLElement;
    readonly fill: HTMLElement;
    readonly bar: HTMLElement;
}

/** The box on the page: one element, the progress or the no-room state. */
export class CourseBox {
    private root: HTMLDivElement | null = null;
    private shown: CourseBoxModel | null = null;
    private parts: ProgressParts | null = null;

    constructor(private readonly parent: HTMLElement, private readonly on: CourseBoxHandlers) {}

    /** the model shown now (the page hook reads it); null when closed */
    model(): CourseBoxModel | null {
        return this.shown;
    }

    show(m: CourseBoxModel): void {
        if (m.kind === 'progress' && this.root && this.parts) {
            // a tick: the same box, new numbers (no new element every second, the bar's width animates)
            this.shown = m;
            this.write(this.parts, m);
            return;
        }
        this.parts = null;
        this.shown = m;
        const root = m.kind === 'progress' ? this.progress(m) : this.noRoom(m);
        this.root?.remove();
        this.parent.append(root);
        this.root = root;
    }

    close(): void {
        this.root?.remove();
        this.root = null;
        this.shown = null;
        this.parts = null;
    }

    private write(p: ProgressParts, m: ProgressBoxModel): void {
        p.step.textContent = `${m.step}. ${m.stepOf}`;
        p.pct.textContent = `${m.pct} %`;
        p.left.textContent = m.left;
        p.fill.style.width = `${m.pct}%`;
        p.bar.setAttribute('aria-valuenow', String(m.pct));
    }

    private progress(m: ProgressBoxModel): HTMLDivElement {
        const p: ProgressParts = {
            step: h('div', { class: 'gen-step' }),
            pct: h('span', { class: 'gen-pct' }),
            left: h('span', { class: 'gen-left' }),
            fill: h('span', {}),
            bar: h('div', { class: 'gen-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': m.title })
        };
        p.bar.append(p.fill);
        this.write(p, m);
        this.parts = p;
        return h('div', { class: 'gen-box interactive', role: 'status', 'aria-live': 'polite', 'data-testid': 'gen-progress' },
            h('div', { class: 'gen-box-head' }, h('strong', {}, m.title), p.pct),
            p.step,
            p.bar,
            h('div', { class: 'gen-box-foot' },
                p.left,
                h('button', { type: 'button', class: 'btn gen-box-btn', 'data-action': 'gen-progress-cancel', onclick: () => this.on.cancel() }, m.cancel)));
    }

    private noRoom(m: NoRoomModel): HTMLDivElement {
        const close = (): void => this.close();
        return h('div', { class: 'gen-box gen-noroom interactive', role: 'alert', 'data-testid': 'gen-noroom' },
            h('div', { class: 'gen-box-head' }, h('p', { class: 'gen-noroom-text' }, m.text),
                h('button', { class: 'panel-x', type: 'button', 'aria-label': m.close, title: m.close, 'data-action': 'gen-noroom-x', onclick: close }, '×')),
            h('div', { class: 'gen-box-foot' },
                h('button', { type: 'button', class: 'btn gen-box-btn', 'data-action': 'gen-noroom-close', onclick: close }, m.close),
                h('button', { type: 'button', class: 'btn primary gen-box-btn', 'data-action': 'gen-noroom-grow', onclick: () => {
                    this.close();
                    this.on.grow(m.to);
                } }, m.action)));
    }
}
