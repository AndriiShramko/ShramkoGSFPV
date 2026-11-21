// The lesson's instruction, large, for the eye (v0.13, lane v13-host B4; M41-7, W6; lane tutor-say, decision 9 of the outside
// pilot's feedback): ONE line, the step's instruction as the narrator said it ("Fly up to the ring" in the pilot's language), and no
// counters: "Lesson 6 of 28", "Step 2 of 2", "Attempt 2" and "Counted 0 of 3" are what I says (`runner.statusLine()`), not what the
// screen shows. Before the step's instruction is said, the lesson's title. Drawn again at every event the mode writes, and only when
// its text changed (the same line is never put in the page twice).
//
// Where: at the left edge, halfway down (on a narrow page low on the left), clear of the view's centre where the target is,
// of the captions under the top bar and of the telemetry in the corners; outside #ui, the flight's aria-live region, so a
// screen reader does not read it again (the captions carry the narrator's line). Large, bold, white on an opaque black box with a
// white edge and a black outline: readable over a dark scene and a light one; dark on light where the page asks for a light
// scheme, and the system's colours in forced-colours mode (sonic.css).
//
// The follower also holds #ui quiet while a lesson runs (live-quiet.ts LessonHold).
import type { LessonSession, LessonView, SpeechLine } from '@shramko/sonic-fpv';
import { lessonHold } from './live-quiet';
import type { LessonHold } from './live-quiet';

/**
 * The runner's calls that start the flight (runner.ts: an attempt's start says "Go.", a pass "Go on."): a flying step says only
 * that, so the task said in the step before stays the instruction on the screen.
 */
export const START_CALLS: ReadonlySet<string> = new Set(['fly.go', 'fly.go-on']);

/**
 * The instruction each runner is on: the first line the host said in a step that is neither the lesson's title nor a start call;
 * it stays until a later step says one of its own. lessons.ts `act` case 'say' gives it every lesson line (heard). Keyed by the
 * runner, so a lesson closed or opened again starts empty.
 */
export class StepInstructions {
    private book = new WeakMap<object, { readonly step: number; readonly line: SpeechLine }>();
    private watchers = new Set<() => void>();

    /** A lesson line said in `step` of the runner (`title`: the lesson's title key). */
    heard(runner: object, step: number, line: SpeechLine, title: string): void {
        if (line.key === title || START_CALLS.has(line.key) || this.book.get(runner)?.step === step) return;
        this.book.set(runner, { step, line });
        for (const fn of [...this.watchers]) fn();
    }

    /** Called after every new instruction (the panel draws it at once, not at the next event). */
    watch(fn: () => void): () => void {
        this.watchers.add(fn);
        return () => this.watchers.delete(fn);
    }

    /** The instruction now (null: none said yet in this lesson). */
    get(runner: object): SpeechLine | null {
        return this.book.get(runner)?.line ?? null;
    }
}

/** The page's one book of instructions (like ui/messages.ts `messages`). */
export const stepInstructions = new StepInstructions();

/** What the page needs of the panel: where it goes and the words (t() of the page's language). */
export interface ProgressPanelDeps {
    readonly parent: HTMLElement;
    text(key: string, params?: Readonly<Record<string, number | string>>): string;
}

/** The panel itself: hidden while no lesson runs. */
export class ProgressPanel {
    readonly root: HTMLElement;
    private readonly line: HTMLElement;
    private shown = '';

    constructor(d: ProgressPanelDeps) {
        const doc = d.parent.ownerDocument;
        this.root = doc.createElement('section');
        this.root.className = 'sonic-progress';
        this.root.dataset.testid = 'sonic-progress';
        this.root.setAttribute('aria-label', d.text('sonic.progress.label'));
        this.line = doc.createElement('p');
        this.line.className = 'sonic-progress-title';
        this.line.dataset.testid = 'sonic-instruction';
        this.root.append(this.line);
        this.root.hidden = true;
        d.parent.append(this.root);
    }

    /** Shows the line (null: no lesson, the panel hides). The node stays; only a changed text is written. */
    update(line: string | null): void {
        if (line === null) {
            this.shown = '';
            this.root.hidden = true;
            return;
        }
        if (line !== this.shown) {
            this.shown = line;
            this.line.textContent = line;
        }
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

/** The lesson running now as the panel shows it: its view, the line on the screen, and whether #ui is held quiet. */
export interface LessonShown {
    readonly view: LessonView;
    readonly line: string;
    /** the flight goes on (not paused): LessonHold */
    readonly held: boolean;
}

/** The lesson running now as the panel draws it, or null while none runs. */
export type ProgressNow = () => LessonShown | null;

/**
 * What the panel draws of the page's lesson: the step's instruction (StepInstructions; the title until it is said) while the mode
 * runs it, nothing while no lesson runs and while a replay plays (review F5: the replay draws its own recorded lesson in the view,
 * and the live lesson's line over it named the wrong flight; the attitude display hides in a replay the same way, look-panels.ts).
 * `text`: a line of the sound package in the pilot's language.
 */
export function progressNow(
    mode: { readonly active: boolean; readonly inPlayback: boolean; readonly bridge?: { readonly paused: boolean } },
    runner: Pick<LessonSession, 'view'> | null,
    text: (line: SpeechLine) => string
): LessonShown | null {
    if (!mode.active || mode.inPlayback || runner === null) return null;
    const view = runner.view();
    return { view, line: text(stepInstructions.get(runner) ?? view.title), held: mode.bridge?.paused !== true };
}

/**
 * Keeps the panel drawn from the lesson running now, and the lesson hold set: at once, then at every event the mode writes (`on`:
 * the page's 'sonicEvent'; an attempt's start, pass and failure, a step, a lesson opened or left, a pause and a resume each write
 * one), and at every instruction said (StepInstructions.watch). Returns what stops it (the hold let go).
 */
export function followProgress(panel: ProgressPanel, on: (cb: () => void) => () => void, now: ProgressNow, hold: LessonHold = lessonHold, book: StepInstructions = stepInstructions): () => void {
    const draw = (): void => {
        const n = now();
        panel.update(n ? n.line : null);
        hold.set(n !== null && n.held);
    };
    draw();
    const off = on(draw);
    const offBook = book.watch(draw);
    return () => {
        off();
        offBook();
        hold.set(false);
    };
}
