// The lesson's progress, large, for the eye (v0.13, lane v13-host B4; M41-7, W6): a low-vision pilot or a helper sees where the
// pilot is without asking. It draws the sound package's `runner.view()`, the same numbers I says (`runner.statusLine()`): the
// lesson's title, "Lesson 6 of 28", "Step 2 of 2", and in a flying lesson "Attempt 2" (once one began) and "Counted 0 of 3".
// It is drawn again whenever the mode writes an event (every attempt's start, pass and failure is one), and only when its text
// changed.
//
// Where: at the left edge, halfway down (on a narrow page low on the left), clear of the view's centre where the target is,
// of the captions under the top bar and of the telemetry in the corners; outside #ui, the flight's aria-live region, so a
// screen reader does not read every change (I says it, and every attempt says its count). Large, bold, white on an opaque
// black box with a white edge and a black outline: readable over a dark scene and a light one; dark on light where the page
// asks for a light scheme, and the system's colours in forced-colours mode (sonic.css).
import type { LessonSession, LessonView } from '@shramko/sonic-fpv';

/** One row of the panel: its text (sonic.progress.*) and the numbers in it. */
export interface ProgressRow {
    readonly key: string;
    readonly params: Readonly<Record<string, number>>;
}

/**
 * The rows for a view: the lesson on the pilot's path and the step, always; in a flying lesson the attempt once one began and the
 * count toward the pass. A lesson without a world (module 0) has no attempts to count: its lesson and step only, as I says it.
 */
export function progressRows(v: LessonView): ProgressRow[] {
    const rows: ProgressRow[] = [
        { key: 'sonic.progress.lesson', params: { n: v.lessonIndex, total: v.lessonCount } },
        { key: 'sonic.progress.step', params: { n: v.step, total: v.steps } }
    ];
    if (v.goals > 0) {
        if (v.attempt > 0) rows.push({ key: 'sonic.progress.attempt', params: { n: v.attempt } });
        rows.push({ key: 'sonic.progress.counted', params: { n: v.counted, total: v.required } });
    }
    return rows;
}

/** What the panel needs of the page: where it goes and the words (t() of the page's language). */
export interface ProgressPanelDeps {
    readonly parent: HTMLElement;
    text(key: string, params?: Readonly<Record<string, number | string>>): string;
}

/** The panel itself: hidden while no lesson runs. */
export class ProgressPanel {
    readonly root: HTMLElement;
    private readonly d: ProgressPanelDeps;
    private shown = '';

    constructor(d: ProgressPanelDeps) {
        this.d = d;
        const doc = d.parent.ownerDocument;
        this.root = doc.createElement('section');
        this.root.className = 'sonic-progress';
        this.root.dataset.testid = 'sonic-progress';
        this.root.setAttribute('aria-label', d.text('sonic.progress.label'));
        this.root.hidden = true;
        d.parent.append(this.root);
    }

    /** Draws the view (null: no lesson, the panel hides); `title`: the lesson's title in the pilot's language. */
    update(view: LessonView | null, title: string): void {
        if (view === null) {
            this.shown = '';
            this.root.hidden = true;
            this.root.replaceChildren();
            return;
        }
        const lines = [title, ...progressRows(view).map((r) => this.d.text(r.key, r.params))];
        const key = lines.join('\n');
        if (key === this.shown && !this.root.hidden) return;
        this.shown = key;
        const doc = this.root.ownerDocument;
        const [head, ...rest] = lines;
        const titleEl = doc.createElement('p');
        titleEl.className = 'sonic-progress-title';
        titleEl.textContent = head ?? '';
        const rows = rest.map((text) => {
            const p = doc.createElement('p');
            p.className = 'sonic-progress-row';
            p.textContent = text;
            return p;
        });
        this.root.replaceChildren(titleEl, ...rows);
        this.root.hidden = false;
    }

    /** The text the panel shows now ('' when hidden), for the test hook. */
    get text(): string {
        return this.root.hidden ? '' : this.shown;
    }

    dispose(): void {
        this.root.remove();
    }
}

/** The lesson running now as the panel draws it, or null while none runs. */
export type ProgressNow = () => { readonly view: LessonView; readonly title: string } | null;

/**
 * What the panel draws of the page's lesson: its runner's view and title while the mode runs it, nothing while no lesson runs and while
 * a replay plays (review F5: the replay draws its own recorded lesson in the view, and the live lesson's "Lesson 6 of 28, Counted 0 of 3"
 * over it named the wrong flight; the attitude display hides in a replay the same way, look-panels.ts).
 */
export function progressNow(mode: { readonly active: boolean; readonly inPlayback: boolean }, runner: Pick<LessonSession, 'view'> | null, title: (line: LessonView['title']) => string): { readonly view: LessonView; readonly title: string } | null {
    if (!mode.active || mode.inPlayback || runner === null) return null;
    const view = runner.view();
    return { view, title: title(view.title) };
}

/**
 * Keeps the panel drawn from the lesson running now: at once, then at every event the mode writes (`on`: the page's 'sonicEvent'; an
 * attempt's start, pass and failure, a step, a lesson opened or left each write one). Returns what stops it.
 */
export function followProgress(panel: ProgressPanel, on: (cb: () => void) => () => void, now: ProgressNow): () => void {
    const draw = (): void => {
        const n = now();
        panel.update(n ? n.view : null, n ? n.title : '');
    };
    draw();
    return on(draw);
}
