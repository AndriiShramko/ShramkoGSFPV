// The survey's keys (docs/wip/v12-plan.md section 4.3 step 4): which key presses are inputs, and the capture that takes every key of the
// page while the survey runs. No DOM and no texts here, so Node tests run it against a fake target.
//
// While the survey runs, every key press of the page is taken here (a W, A, S, D or R must not fly or reset the paused flight), except
// the browser's own shortcuts (Ctrl, Alt, Meta and the F keys). Key releases are NOT taken: a stick the pilot let go of during the
// survey must be let go of by the flight's keyboard source, or it would still hold it afterwards.
import type { SurveyInput } from './survey';

/** A key as the survey reads it: a number, Escape (skip), Enter (an open answer is done), Z (hear it again); nothing else is an input. */
export function mapSurveyKey(code: string): SurveyInput | null {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (m !== null) return { kind: 'digit', digit: Number(m[1]) };
    if (code === 'Escape') return { kind: 'skip' };
    if (code === 'Enter' || code === 'NumpadEnter') return { kind: 'done' };
    if (code === 'KeyZ') return { kind: 'again' };
    return null;
}

/**
 * Takes the page's keys for the survey until the returned function is called: the inputs go to `handler`, every other key press is
 * swallowed so nothing else in the page hears it. Capture phase and stopImmediatePropagation: before the key router and keyboard flying.
 */
export function captureSurveyKeys(handler: (input: SurveyInput) => void, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
    const onKey = (e: KeyboardEvent): void => {
        if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.code)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        const input = mapSurveyKey(e.code);
        if (input !== null) handler(input);
    };
    target.addEventListener('keydown', onKey as EventListener, { capture: true });
    return () => target.removeEventListener('keydown', onKey as EventListener, { capture: true });
}
