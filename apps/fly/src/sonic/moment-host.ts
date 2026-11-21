// The host side of a moment (train 4, lane tutor-air; the first outside feedback of 2026-11-20, his point 2: "the game stops and
// says: this is the sound of this, it appears then"). The sound package's lesson runner decides when a moment comes and what it
// says and plays (its MomentMachine, RunnerAction 'moment' and 'audible'); the page only carries the two actions out:
//   moment  - a non-null MomentView freezes the flight: ctx.pause('moment') (the physics stand, the craft holds, the motor sound
//             and the course clock pause like any pause), while the bridge keeps the frames, the lesson runner and the engine
//             going (bridge.ts `momentOnly`: a pause held for a moment alone is no silence); null gives the flight back;
//   audible - the cues the engine may sound (CuePlanner.setAudible through the bridge); null: all, as before.
// One instance lives for the sound mode; a lesson left in a moment releases it (the package sends null itself on 'go', release()
// covers the mode stopping or a new lesson being opened by the host).
import type { CueId, MomentView, RunnerAction } from '@shramko/sonic-fpv';

/** The pause reason of a moment (app/context.ts PauseReason). */
export const MOMENT_PAUSE = 'moment' as const;

/** The flight's hold (FlightContext.pause / resume, the reason 'moment'). */
export interface MomentHold {
    pause(reason: typeof MOMENT_PAUSE): void;
    resume(reason: typeof MOMENT_PAUSE): void;
}

/** The engine's gate of cues (SonicBridge.setAudible). */
export interface MomentSound {
    setAudible(cues: readonly CueId[] | null): void;
}

export type MomentListener = (view: MomentView | null) => void;

export class MomentHost {
    private viewNow: MomentView | null = null;
    private held = false;
    private gated = false;
    private readonly listeners = new Set<MomentListener>();

    constructor(
        private readonly hold: MomentHold,
        private readonly sound: MomentSound
    ) {}

    /** The moment running now (its phase and form), or null. */
    get view(): MomentView | null {
        return this.viewNow;
    }

    /** The flight is frozen for a moment. */
    get frozen(): boolean {
        return this.held;
    }

    /** Carries out a runner action of a moment; false for every other kind (the lesson host carries those). */
    act(a: RunnerAction): boolean {
        if (a.kind === 'moment') {
            this.show(a.moment);
            return true;
        }
        if (a.kind === 'audible') {
            this.gated = a.cues !== null;
            this.sound.setAudible(a.cues);
            return true;
        }
        return false;
    }

    /** The lesson ended without its own release (the mode stopped, the host opened another lesson): the flight and every sound go on. */
    release(): void {
        this.show(null);
        if (this.gated) {
            this.gated = false;
            this.sound.setAudible(null);
        }
    }

    /** Called with every change of the moment (the card draws it). */
    onView(fn: MomentListener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    private show(view: MomentView | null): void {
        this.viewNow = view;
        if (view !== null && !this.held) {
            this.held = true;
            this.hold.pause(MOMENT_PAUSE);
        } else if (view === null && this.held) {
            this.held = false;
            this.hold.resume(MOMENT_PAUSE);
        }
        for (const fn of this.listeners) fn(view);
    }
}
