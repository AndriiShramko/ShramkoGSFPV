// The course's making said in Fly by Sound (sonic3 S1 pass 3; the owner's rule: anything longer than 2 s says its stage and the
// time left). N in a free scan flight asks the course worker (course-ask.ts askCourse); the worker posts 'progress' with each step
// and its estimate (free space, then the obstacles' tries). The sighted course feature shows and says the same clock
// (app/builtin/course.ts, stage G1-progress), but its keys do nothing while the mode is on, so the sound page keeps its own clock
// here: ProgressClock and SpeechPacer of course/progress.ts, spokenLine as the line (no percent, no clock digits).
// Measured before it: N to gate 1 took 25.2 s on Wroclaw, 25.8 s on Tunis, 49.6 s on Housefly (sonic3 S1 pass 2) with one line.
import { PROGRESS_TICK_MS, ProgressClock, SpeechPacer, courseSteps, spokenLine } from '../course/progress';

type T = (key: string, params?: Record<string, string | number>) => string;

/** What drives the speech of one course ask: the worker's progress in, a tick every PROGRESS_TICK_MS, stop at the answer. */
export interface CourseSpeech {
    progress(step: string, estMs: number): void;
    tick(): void;
    stop(): void;
}

/**
 * The speech of one course ask. `say` gets the line's text (the page says it through 'sonic.say.text'). The line said at N
 * ("making a course") counts as the first: the pacer starts as if it had just spoken, so the first progress line comes with the
 * next step (after the pacer's gap) or after SPEAK_EVERY_MS, never over the line of N. `every` runs the tick (window.setInterval
 * in the page) and returns its stop.
 */
export function courseSpeech(say: (text: string) => void, t: T, now: () => number, every: (fn: () => void, ms: number) => () => void): CourseSpeech {
    const clock = new ProgressClock('course', courseSteps(null), now);
    const pacer = new SpeechPacer(now);
    pacer.due(clock.view());
    let on = true;
    const tick = (): void => {
        if (!on) return;
        const v = clock.view();
        if (pacer.due(v)) say(spokenLine(v, t));
    };
    const stopTick = every(tick, PROGRESS_TICK_MS);
    return {
        progress(step, estMs) {
            if (on) clock.enter(step, estMs);
        },
        tick,
        stop() {
            on = false;
            stopTick();
        }
    };
}
