// The sound lost in a lesson (lane sonic-hints; the owner's complaint of 2026-11-10): the tab was hidden or the audio context stopped
// (another tab, the system took the device, the browser suspended it), so the pilot missed part of a step without knowing it. On the
// return, when the page is visible and the context runs again, one line says so and names the key that says the step's task again:
// "The sound was interrupted. Press Z to hear this step's task again." Said once per gap, only when a lesson was open during it.
// sonic/feature.ts checks on every visibility change and once a second, and asks a suspended context to resume on the next key
// (a user activation) and on the return.
import type { SpeechLine } from '@shramko/sonic-fpv';

export interface SoundGapDeps {
    /** a lesson is open (the mode runs one) */
    lessonActive(): boolean;
    /** the page is visible (document.visibilityState) */
    visible(): boolean;
    /** the audio context runs (state 'running'); true while there is none yet: nothing was lost */
    audioRunning(): boolean;
    /** the pilot's name of the key that repeats the task (Z) */
    repeatKey(): string;
    say(line: SpeechLine): void;
}

export class SoundGap {
    private lost = false;
    private readonly d: SoundGapDeps;

    constructor(d: SoundGapDeps) {
        this.d = d;
    }

    /** A gap is open: the sound stopped during a lesson and has not come back yet. */
    get pending(): boolean {
        return this.lost;
    }

    /** Looks at the page and the context now: opens a gap, or closes one with its line. */
    check(): void {
        const heard = this.d.visible() && this.d.audioRunning();
        if (!heard) {
            if (this.d.lessonActive()) this.lost = true;
            return;
        }
        if (!this.lost) return;
        this.lost = false;
        if (this.d.lessonActive()) this.d.say({ key: 'sonic.say.soundBack', params: { key: this.d.repeatKey() } });
    }
}
