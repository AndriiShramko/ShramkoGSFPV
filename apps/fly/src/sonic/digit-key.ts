// The digit keys of a lesson's question (v0.12): a digit answers the question the lesson asked, 0 skips it, and with none asked the key is not
// ours (sonic/feature.ts registers this on the window, in the capture phase, when the mode is installed).
//
// Written out of the feature so a Node test can put it beside the survey's key capture on one fake window. Those two meet in the real page: a
// recording that is stopped while the lesson is still asking (module 0 asks all the time) runs the survey, and the survey's capture is
// registered LATER than this handler, so it cannot stop it (stopImmediatePropagation only stops the listeners after it): the pilot's "1" for
// "yes" answered the lesson's question as well, and every digit after it the next one, with the lesson's feedback spoken over the survey.
export interface QuestionHost {
    /** a question waits for digits */
    readonly asking: boolean;
    /** answers it (0 skips); false when nothing was asked */
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
        if (!host || !host.asking || deps.paused() || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
        if (!m || deps.typing(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        host.answer(Number(m[1]));
    };
}
