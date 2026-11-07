// The spoken survey after a recording (docs/wip/v12-plan.md section 4.3 step 4; spec section 9 of the sound package). The package holds
// the three surveys as data (SURVEY_FIRST, SURVEY_RETURNING, SURVEY_CHILD) and every text; what is here is what asks them: reads each
// question aloud, takes the answer from a number key (a scale with one press, 1 to 5 or 0 to 9; a choice 1, 2, 3 in the order read),
// takes an open question as the pilot's voice into the recording that is still running (the answer's start time is in survey.json,
// so the voice can be found), and lets any question, or the whole survey, be skipped.
//
//   offer       "Do you want to answer a few questions? Press 1 for yes, 2 for no."   (2, Escape or a minute of silence: no)
//   questions   "Question n of m." the prompt, then "Press 1 for ..." for the ends of a scale or for each option
//   keys        digits answer; Z hears the question again; Escape skips the question; Enter ends an open answer
//
// Which survey: a minor gets the child variant (the Again-Again table); an adult who has not answered one before gets the first
// flight's, then the returning pilot's. The answers go to survey.json. They are NOT written as `answer` events: those belong to the
// lesson's own quiz, and the replay would take a survey answer for one of the quiz's and call it missing.
//
// This file is the logic, with the browser behind interfaces (SurveyView, the keys, speech, time), so Node tests run it with scripted
// keys; survey-view.ts is the dialog and the key capture.
import type { SpeechLine, SurveyAnswers, SurveyDef, SurveyItem } from '@shramko/sonic-fpv';
import { FORMATS, SURVEY_CHILD, SURVEY_FIRST, SURVEY_RETURNING } from '@shramko/sonic-fpv';
import type { PilotProfile } from './consent';

/** What the pilot or the helper can do with a question. */
export type SurveyInput =
    | { readonly kind: 'digit'; readonly digit: number }
    | { readonly kind: 'skip' }
    | { readonly kind: 'done' }
    | { readonly kind: 'again' };

export interface QuestionView {
    readonly number: number;
    readonly total: number;
    readonly item: SurveyItem;
}

/** The dialog the controller drives (survey-view.ts); a test passes a recorder of calls. */
export interface SurveyView {
    offer(): void;
    question(q: QuestionView): void;
    /** an open question: the voice is being recorded until Done, Skip, or the item's time is up */
    listening(q: QuestionView): void;
    close(): void;
}

export interface SurveyDeps {
    /** speaks one line and resolves when it has been said; `interrupt` cuts what is still being said */
    say(line: SpeechLine, options?: { readonly interrupt?: boolean }): Promise<void>;
    /** the text of a line in the pilot's language (the package's translator), for a label inside another line */
    text(line: SpeechLine): string;
    /** the spoken name of a key for a line's {key} or {skip} */
    keyLabel(code: string): string;
    /** the recording clock, ms */
    now(): number;
    profile: PilotProfile;
    view: SurveyView;
    /** hears the pilot's and the helper's inputs until the returned function is called */
    listen(handler: (input: SurveyInput) => void): () => void;
    /** the flight stays still while the questions run; the returned function lets it go on */
    holdFlight?(): () => void;
    /** the longest a line of speech is waited for, ms (a hidden tab never finishes one; default 8000) */
    sayLimitMs?: number;
    /** how long the offer waits for an answer, ms (default 60 000) */
    offerMs?: number;
    /** how long a scale or a choice waits for a key before the survey is left as it is, ms (default 120 000) */
    idleMs?: number;
}

/** The survey that suits this pilot. */
export function surveyFor(profile: Pick<PilotProfile, 'minor' | 'surveysSeen'>): SurveyDef {
    if (profile.minor) return SURVEY_CHILD;
    return profile.surveysSeen.includes(SURVEY_FIRST.id) ? SURVEY_RETURNING : SURVEY_FIRST;
}

/** The numbers one question takes by key: a scale its own, a choice 1 up to the number of options, an open question none. */
export function digitsOf(item: SurveyItem): readonly number[] {
    if (item.kind === 'scale') return Array.from({ length: item.max - item.min + 1 }, (_, i) => item.min + i);
    if (item.kind === 'choice') return Array.from({ length: item.options.length }, (_, i) => i + 1);
    return [];
}

/**
 * What is spoken for one question, in order: its number, the prompt, then how to answer it: "Press 1 for Not at all" and "Press 5
 * for A lot" for a scale, one "Press n for ..." per option for a choice, how to finish for an open question. The first question
 * of a survey also says which key hears it again.
 */
export function spokenQuestion(item: SurveyItem, number: number, total: number, deps: Pick<SurveyDeps, 'text' | 'keyLabel'>, firstTime: boolean): SpeechLine[] {
    const lines: SpeechLine[] = [{ key: 'survey.question-of', params: { n: number, total } }, item.prompt];
    if (item.kind === 'scale') {
        lines.push({ key: 'quiz.option', params: { n: item.min, label: deps.text(item.anchors[0]) } }, { key: 'quiz.option', params: { n: item.max, label: deps.text(item.anchors[1]) } });
    } else if (item.kind === 'choice') {
        item.options.forEach((o, i) => lines.push({ key: 'quiz.option', params: { n: i + 1, label: deps.text(o) } }));
    } else lines.push({ key: 'survey.open-howto', params: { key: deps.keyLabel('Enter') } });
    if (firstTime) lines.push({ key: 'survey.repeat-hint', params: { key: deps.keyLabel('KeyZ') } });
    return lines;
}

type Answer = SurveyAnswers['answers'][number];

/** A key press this soon after an answer is the same press twice, not the next answer, ms. */
export const MIN_GAP_MS = 300;
/** Nobody pressed a key for this long on a question that takes one: the survey is abandoned, ms. */
export const IDLE_MS = 120_000;

/**
 * Runs the survey: the offer, the questions, the thanks. Resolves with the answers (written as survey.json). Never rejects: a
 * survey that breaks keeps what was answered and lets the recording end.
 */
export async function runSurvey(deps: SurveyDeps): Promise<SurveyAnswers> {
    const def = surveyFor(deps.profile);
    const limit = deps.sayLimitMs ?? 8000;
    const answers: Answer[] = [];
    let declined = false;
    let abandoned = false;
    let speechToken = 0;
    let waiting: ((i: SurveyInput) => void) | null = null;
    const queued: SurveyInput[] = [];
    const release = deps.holdFlight?.() ?? ((): void => undefined);
    const detach = deps.listen((input) => {
        if (waiting !== null) {
            const w = waiting;
            waiting = null;
            w(input);
        } else queued.push(input);
    });
    /** The next input, or 'timeout' after `ms` (never when null). One that came while nothing was waiting is taken first. */
    const nextInput = (ms: number | null): Promise<SurveyInput | 'timeout'> =>
        new Promise((resolve) => {
            const early = queued.shift();
            if (early !== undefined) {
                resolve(early);
                return;
            }
            const timer = ms === null ? null : setTimeout(() => { waiting = null; resolve('timeout'); }, ms);
            waiting = (i) => {
                if (timer !== null) clearTimeout(timer);
                resolve(i);
            };
        });
    /** Speaks the lines one after the other. A newer call, or `silence`, cuts what is left of this one. */
    const speak = async (lines: readonly SpeechLine[], interrupt: boolean): Promise<void> => {
        const mine = ++speechToken;
        for (let i = 0; i < lines.length; i++) {
            if (mine !== speechToken) return;
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([deps.say(lines[i] as SpeechLine, { interrupt: interrupt && i === 0 }).catch(() => undefined), new Promise<void>((r) => { timer = setTimeout(r, limit); })]);
            clearTimeout(timer);
        }
    };
    const silence = (): void => {
        speechToken++;
    };
    // a number pressed twice in a hurry would answer the next question as well: an answer is not taken within MIN_GAP_MS of the last
    let lastAnswerAt = -Infinity;

    try {
        deps.view.offer();
        void speak([{ key: 'survey.offer' }], false);
        const offered = await nextInput(deps.offerMs ?? 60_000);
        lastAnswerAt = deps.now();
        silence();
        if (offered === 'timeout' || offered.kind !== 'digit' || offered.digit !== 1) {
            declined = true;
            void speak([{ key: 'survey.skipped' }], true);
        } else {
            // the intro and how to answer are said before the first question, as part of its speech: the question must not cut them off
            const intro: SpeechLine[] = [{ key: `survey.intro.${def.variant}` }, { key: 'survey.howto', params: { skip: deps.keyLabel('Escape') } }];
            for (let index = 0; index < def.items.length && !abandoned; index++) {
                const item = def.items[index] as SurveyItem;
                const view: QuestionView = { number: index + 1, total: def.items.length, item };
                const valid = new Set(digitsOf(item));
                // the intro is cut when the first question comes up; a key pressed meanwhile is already queued and answers it
                let firstTime = index === 0;
                const ask = (): void => {
                    deps.view.question(view);
                    void speak([...(firstTime && index === 0 ? intro : []), ...spokenQuestion(item, view.number, view.total, deps, firstTime)], true);
                    firstTime = false;
                };
                ask();
                // an open question: the voice window opens now (the recording runs on; nothing is started here)
                const windowStart = item.kind === 'open' ? deps.now() : null;
                if (item.kind === 'open') deps.view.listening(view);
                for (let answered = false; !answered; ) {
                    const input = await nextInput(item.kind === 'open' ? item.maxSeconds * 1000 : (deps.idleMs ?? IDLE_MS));
                    if (input !== 'timeout' && input.kind !== 'again' && deps.now() - lastAnswerAt < MIN_GAP_MS) continue;
                    if (input === 'timeout' && item.kind !== 'open') {
                        // nobody answered for a long time: the survey is left as it is, and the recording is allowed to end
                        abandoned = true;
                        answered = true;
                    } else if (input === 'timeout') {
                        // the window stayed open as long as the item allows: whatever was said is in the recording
                        answers.push({ item: item.id, value: null, via: 'voice', t: windowStart ?? deps.now() });
                        answered = true;
                    } else if (input.kind === 'again') ask();
                    else if (input.kind === 'skip') {
                        answers.push({ item: item.id, value: null, via: 'skip', t: deps.now() });
                        answered = true;
                    } else if (input.kind === 'done' && item.kind === 'open') {
                        answers.push({ item: item.id, value: null, via: 'voice', t: windowStart ?? deps.now() });
                        answered = true;
                    } else if (input.kind === 'digit' && valid.has(input.digit)) {
                        answers.push({ item: item.id, value: input.digit, via: 'key', t: deps.now() });
                        answered = true;
                    }
                    // anything else (a digit outside the scale, Enter on a scale) is not an answer: the question waits for one
                    if (answered) lastAnswerAt = deps.now();
                }
                silence();
            }
            if (!abandoned) void speak([{ key: 'survey.thanks' }], true);
        }
    } catch {
        // the survey is never a reason to lose the recording: what was answered so far is kept
    } finally {
        detach();
        deps.view.close();
        release();
    }
    // skipped: declined at the offer, nothing answered (the survey was abandoned or broke), or every question skipped
    const skipped = declined || answers.every((a) => a.via === 'skip');
    return { format: FORMATS.answers, surveyId: def.id, version: def.version, skipped, answers };
}
