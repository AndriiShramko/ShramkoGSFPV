// v12-int review, finding I1: a digit pressed for the recorder's survey also answered the question the lesson had asked.
//
// The mode installs a keydown handler on the window (capture phase) when it starts; the recorder's survey puts its own capture on the same
// window much later, when a recording is stopped. A browser runs the listeners of one target and phase in the order they were added, and
// stopImmediatePropagation only keeps the ones AFTER it from running, so the survey could not stop the mode's handler: with a question
// pending (module 0 asks all the time) the "1" for "yes" answered the lesson's question, and every digit after it the next one, with the
// lesson's feedback spoken over the survey. The page proof is tools/bench/src/sonic-int-review.ts r1.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { digitAnswerHandler } from '../../../apps/fly/src/sonic/digit-key';
import type { DigitKeyEvent, QuestionHost } from '../../../apps/fly/src/sonic/digit-key';
import { captureSurveyKeys } from '../../../apps/fly/src/sonic-session/survey-keys';
import type { SurveyInput } from '../../../apps/fly/src/sonic-session/survey';

interface Listener {
    readonly type: string;
    readonly fn: (e: never) => void;
    readonly capture: boolean;
}

/** A window that runs the listeners of a phase in the order they were added, as a browser does for one target; stopImmediatePropagation ends the run. */
function fakeWindow() {
    const listeners: Listener[] = [];
    const win = {
        addEventListener(type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }): void {
            listeners.push({ type, fn, capture: options === true || (typeof options === 'object' && options.capture === true) });
        },
        removeEventListener(type: string, fn: (e: never) => void, options?: boolean | { capture?: boolean }): void {
            const capture = options === true || (typeof options === 'object' && options.capture === true);
            const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
            if (i >= 0) listeners.splice(i, 1);
        }
    };
    /** A key press dispatched to the window's capture listeners; what the page saw of it. */
    const press = (code: string, init: Partial<{ repeat: boolean; ctrlKey: boolean; target: EventTarget | null }> = {}): { prevented: boolean; stopped: boolean; ran: number } => {
        let stopped = false;
        let prevented = false;
        let ran = 0;
        const e = {
            code,
            repeat: init.repeat ?? false,
            ctrlKey: init.ctrlKey ?? false,
            altKey: false,
            metaKey: false,
            target: init.target ?? null,
            preventDefault: () => {
                prevented = true;
            },
            stopPropagation: () => undefined,
            stopImmediatePropagation: () => {
                stopped = true;
            }
        };
        for (const l of [...listeners]) {
            if (l.type !== 'keydown' || !l.capture) continue;
            if (stopped) break;
            ran++;
            (l.fn as (ev: unknown) => void)(e);
        }
        return { prevented, stopped, ran };
    };
    return { win: win as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>, raw: win, press };
}

/** A lesson host that has asked a question (module 0): it counts the answers it is given. */
function askingHost(): QuestionHost & { answers: number[] } {
    const answers: number[] = [];
    return {
        answers,
        active: true,
        get asking() {
            return answers.length === 0;
        },
        answer(n: number) {
            answers.push(n);
            return true;
        }
    };
}

/** The page as it goes: the mode's handler first (at install), the survey's capture later (when a recording is stopped). */
function page(opts: { paused: () => boolean; ignoresPause?: boolean }) {
    const w = fakeWindow();
    const host = askingHost();
    const handler = digitAnswerHandler({ host: () => host, paused: opts.ignoresPause === true ? () => false : opts.paused, typing: () => false });
    w.raw.addEventListener('keydown', handler as unknown as (e: never) => void, true);
    const survey: SurveyInput[] = [];
    const startSurvey = (): (() => void) => captureSurveyKeys((i) => survey.push(i), w.win);
    return { w, host, survey, startSurvey };
}

describe('review I1: the survey\'s digits and the lesson\'s question', () => {
    it('control: with the flight running a digit answers the question the lesson asked (and 0 skips it)', () => {
        const p = page({ paused: () => false });
        expect(p.w.press('Digit1').prevented).toBe(true);
        expect(p.host.answers).toEqual([1]);
        const q = page({ paused: () => false });
        q.w.press('Digit0');
        expect(q.host.answers).toEqual([0]);
    });

    it('while the survey runs (it holds the flight) its digits answer the survey and not the lesson, however late its capture was added', () => {
        let held = false;
        const p = page({ paused: () => held });
        held = true; // runSurvey's first act: the flight is held ('panel')
        const stop = p.startSurvey();
        for (const code of ['Digit1', 'Digit3', 'Digit3', 'Numpad2', 'Digit0']) p.w.press(code);
        expect(p.survey).toEqual([
            { kind: 'digit', digit: 1 },
            { kind: 'digit', digit: 3 },
            { kind: 'digit', digit: 3 },
            { kind: 'digit', digit: 2 },
            { kind: 'digit', digit: 0 }
        ]);
        expect(p.host.answers).toEqual([]);
        expect(p.host.asking).toBe(true);
        // the survey is over, the flight goes on: the question is still waiting, and the next digit answers it
        stop();
        held = false;
        p.w.press('Digit2');
        expect(p.host.answers).toEqual([2]);
    });

    it('control: a handler that does not look at the pause (the feature as it was) runs before the survey\'s capture and answers for it', () => {
        const p = page({ paused: () => true, ignoresPause: true });
        p.startSurvey();
        const seen = p.w.press('Digit1');
        // the survey took the key (its capture stopped the page from hearing it) and the lesson answered it too
        expect(p.survey).toEqual([{ kind: 'digit', digit: 1 }]);
        expect(p.host.answers).toEqual([1]);
    });

    it('sonic-keys: in a running lesson a digit is ours with no question asked yet (the sound still plays): the lesson takes it or says it did not', () => {
        const w = fakeWindow();
        const answers: number[] = [];
        const host: QuestionHost = { active: true, asking: false, answer: (n) => (answers.push(n), true) };
        w.raw.addEventListener('keydown', digitAnswerHandler({ host: () => host, paused: () => false, typing: () => false }) as unknown as (e: never) => void, true);
        const seen = w.press('Digit2');
        expect(seen.prevented).toBe(true);
        expect(w.press('Numpad1').prevented).toBe(true);
        expect(answers).toEqual([2, 1]);
        // no lesson running: not ours
        const off = fakeWindow();
        const idle: QuestionHost = { active: false, asking: false, answer: () => false };
        off.raw.addEventListener('keydown', digitAnswerHandler({ host: () => idle, paused: () => false, typing: () => false }) as unknown as (e: never) => void, true);
        expect(off.press('Digit2').prevented).toBe(false);
    });

    it('the rest of the rules are as they were: a key held down, a shortcut, a text field and a page with no lesson are not answers', () => {
        const p = page({ paused: () => false });
        expect(p.w.press('Digit1', { repeat: true }).prevented).toBe(false);
        expect(p.w.press('Digit1', { ctrlKey: true }).prevented).toBe(false);
        expect(p.w.press('KeyN').prevented).toBe(false);
        expect(p.host.answers).toEqual([]);
        const w = fakeWindow();
        const host = askingHost();
        w.raw.addEventListener('keydown', digitAnswerHandler({ host: () => host, paused: () => false, typing: () => true }) as unknown as (e: never) => void, true);
        w.press('Digit1', { target: {} as EventTarget });
        expect(host.answers).toEqual([]);
        const none = fakeWindow();
        none.raw.addEventListener('keydown', digitAnswerHandler({ host: () => null, paused: () => false, typing: () => false }) as unknown as (e: never) => void, true);
        expect(none.press('Digit1').prevented).toBe(false);
    });

    it('the mode gives its handler the pause of the flight it flies (a guard over the source)', () => {
        const src = readFileSync(new URL('../../../apps/fly/src/sonic/feature.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/digitAnswerHandler\(\{[^}]*paused: \(\) => ctx\.session\.paused/);
        // and keeps no digit handler of its own beside it
        expect(src).not.toMatch(/\^\(\?:Digit\|Numpad\)\(\\d\)\$/);
    });
});

// the type of the event the handler takes is the fields a KeyboardEvent has
const _shape: (e: KeyboardEvent) => DigitKeyEvent = (e) => e;
void _shape;
