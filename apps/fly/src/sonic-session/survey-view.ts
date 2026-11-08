// The survey's dialog and its keys (docs/wip/v12-plan.md section 4.3 step 4). The dialog is for the sighted helper beside the pilot: the
// question in writing, the numbers as buttons, Skip, Done for an open answer, and "hear it again". Everything it shows can also be
// done by key, and the keys are what a pilot who flies by ear uses; the app reads every question aloud in either case.
//
// The keys are survey-keys.ts.
//
// It is a modal dialog (role dialog, aria-modal), so it behaves like one for a screen reader and a keyboard: when it opens the focus moves into
// it (aria-modal hides the page behind the dialog from a screen reader, and a focus left behind it would be on something that is not there),
// the dialog is shown BEFORE its question is written (a live region that changes while it is hidden is not announced), and when it closes the
// focus goes back to where it was.
import './texts';
import { clear, h } from '../ui/dom';
import { t } from '../i18n';
import type { SpeechLine } from '@shramko/sonic-fpv';
import type { QuestionView, SurveyInput, SurveyView } from './survey';
import { digitsOf } from './survey';

export interface SurveyDialog extends SurveyView {
    /** the buttons of the dialog press the same inputs as the keys */
    onInput(handler: (input: SurveyInput) => void): () => void;
    readonly root: HTMLElement;
    dispose(): void;
}

export interface SurveyDialogDeps {
    /** the text of a line in the pilot's language (the package's translator) */
    text(line: SpeechLine): string;
    /** the label of a key for the dialog's own words */
    keyLabel(code: string): string;
}

export function createSurveyDialog(deps: SurveyDialogDeps, parent: HTMLElement = document.body): SurveyDialog {
    let handler: ((input: SurveyInput) => void) | null = null;
    const emit = (input: SurveyInput): void => handler?.(input);
    const progress = h('p', { class: 'sonicrec-progress' });
    const question = h('p', { class: 'sonicrec-q', 'aria-live': 'polite' });
    const anchors = h('div', { class: 'sonicrec-anchors' });
    const options = h('div', { class: 'sonicrec-options' });
    const listening = h('p', { class: 'sonicrec-listening', role: 'status' });
    const buttons = h('div', { class: 'sonicrec-options' });
    const root = h('section', { class: 'sonicrec-survey', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sonicrec-survey-title', tabindex: '-1', hidden: true },
        h('h2', { id: 'sonicrec-survey-title' }, t('sonicrec.survey.title')), progress, question, anchors, options, listening, buttons);
    parent.append(root);

    const digitButton = (digit: number, label: string, name: string): HTMLButtonElement =>
        h('button', { type: 'button', class: 'btn', 'data-digit': digit, 'aria-label': name, onclick: () => emit({ kind: 'digit', digit }) }, label);
    const control = (kind: 'skip' | 'done' | 'again', label: string, primary = false): HTMLButtonElement =>
        h('button', { type: 'button', class: primary ? 'btn primary' : 'btn', 'data-action': kind, onclick: () => emit({ kind }) }, label);

    /** Where the focus was when the dialog opened, to give it back. */
    let before: HTMLElement | null = null;

    /** Shows the dialog (remembering the focus), and puts the focus into it when it is not already there: a button that was pressed is gone after the next question is drawn. */
    function show(): void {
        if (root.hidden) {
            const a = document.activeElement;
            before = a instanceof HTMLElement && !root.contains(a) ? a : null;
            root.hidden = false;
        }
    }

    function focusIn(): void {
        if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    }

    function reset(): void {
        progress.textContent = '';
        question.textContent = '';
        listening.textContent = '';
        clear(anchors);
        clear(options);
        clear(buttons);
    }

    return {
        root,
        onInput(h2) {
            handler = h2;
            return () => {
                if (handler === h2) handler = null;
            };
        },
        offer() {
            reset();
            show();
            question.textContent = deps.text({ key: 'survey.offer' });
            options.append(digitButton(1, `1  ${deps.text({ key: 'survey.opt.yes' })}`, `1: ${deps.text({ key: 'survey.opt.yes' })}`), digitButton(2, `2  ${deps.text({ key: 'survey.opt.no' })}`, `2: ${deps.text({ key: 'survey.opt.no' })}`));
            focusIn();
        },
        question(q: QuestionView) {
            reset();
            show();
            progress.textContent = deps.text({ key: 'survey.question-of', params: { n: q.number, total: q.total } });
            question.textContent = deps.text(q.item.prompt);
            if (q.item.kind === 'scale') {
                const low = deps.text(q.item.anchors[0]);
                const high = deps.text(q.item.anchors[1]);
                anchors.append(h('span', {}, `${q.item.min}  ${low}`), h('span', {}, `${q.item.max}  ${high}`));
                for (const d of digitsOf(q.item)) options.append(digitButton(d, String(d), d === q.item.min ? `${d}: ${low}` : d === q.item.max ? `${d}: ${high}` : String(d)));
            } else if (q.item.kind === 'choice') {
                q.item.options.forEach((o, i) => options.append(digitButton(i + 1, `${i + 1}  ${deps.text(o)}`, `${i + 1}: ${deps.text(o)}`)));
            } else buttons.append(control('done', t('sonicrec.survey.done'), true));
            buttons.append(control('skip', t('sonicrec.survey.skip')), control('again', t('sonicrec.survey.again')));
            focusIn();
        },
        listening(_q: QuestionView) {
            listening.textContent = t('sonicrec.survey.listening', { key: deps.keyLabel('Enter') });
        },
        close() {
            root.hidden = true;
            reset();
            const back = before;
            before = null;
            if (back !== null && back.isConnected) back.focus({ preventScroll: true });
        },
        dispose() {
            root.remove();
        }
    };
}
