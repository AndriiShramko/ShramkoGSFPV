// The digit keys of a lesson's question (v0.12): a digit answers the question the lesson asked, 0 skips it (sonic/feature.ts registers this on
// the window, in the capture phase, when the mode is installed). Since sonic-keys every digit in a running lesson is ours and goes to the
// lesson's runner, asked or not: a digit pressed while the headphone check's sound plays answers it, and one with nothing to answer is
// acknowledged with the "no" sound and "Not taken" (the owner's complaint of 2026-11-10: a digit pressed during the sound was dropped
// without a word, so no row of digits seemed to work). Without a running lesson the key is not ours.
//
// Written out of the feature so a Node test can put it beside the survey's key capture on one fake window. Those two meet in the real page: a
// recording that is stopped while the lesson is still asking (module 0 asks all the time) runs the survey, and the survey's capture is
// registered LATER than this handler, so it cannot stop it (stopImmediatePropagation only stops the listeners after it): the pilot's "1" for
// "yes" answered the lesson's question as well, and every digit after it the next one, with the lesson's feedback spoken over the survey.
export interface QuestionHost {
    /** a lesson is running: its digits are ours */
    readonly active: boolean;
    /** a question waits for digits */
    readonly asking: boolean;
    /** hands the digit to the lesson (0 skips), which takes it or says it did not; false when no lesson runs */
    answer(n: number): boolean;
}

/** What the handler reads of a key press (a KeyboardEvent has all of it). */
export interface DigitKeyEvent {
    readonly code: string;
    readonly repeat: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    readonly target: EventTarget | null;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface DigitDeps {
    /** the lesson host, or null before there is one */
    host(): QuestionHost | null;
    /** the flight is held (the pause menu, the start screen, the recorder's survey, a replay): the lesson waits with the flight, and a digit belongs to what is on top of it */
    paused(): boolean;
    /** the key goes to a text field */
    typing(target: EventTarget | null): boolean;
}

export function digitAnswerHandler(deps: DigitDeps): (e: DigitKeyEvent) => void {
    return (e) => {
        const host = deps.host();
        // a held flight (the survey among the screens that hold it): the question waits with the flight, the digit is the screen's
        if (!host || !host.active || deps.paused() || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
        if (!m || deps.typing(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        host.answer(Number(m[1]));
    };
}
