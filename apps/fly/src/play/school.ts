// Pilot school (docs/wip/v08-a.md section 1; the owner's message 21, item 6: "make it fun and easy, feel
// like an FPV pilot, and train for real sticks"). Pure: no DOM.
//
// Four steps from the most help to none, each a pair of settings, so the step is never stored on
// its own and cannot disagree with what the craft flies:
//   1 angle + altitude help   2 angle, own throttle   3 horizon   4 acro (as real FPV pilots fly)
// Each step has a goal: seconds of flight in one go without a crash. Reaching it offers the next step.

import type { FlightMode } from '@gsfpv/sim-core';

export type SchoolStep = 1 | 2 | 3 | 4;
export const SCHOOL_STEPS: readonly SchoolStep[] = [1, 2, 3, 4];

/** The step the settings fly now (flight.mode, input.altitudeHelp). Acro ignores the help: it is never on in acro. */
export function stepOf(mode: FlightMode, altitudeHelp: boolean): SchoolStep {
    if (mode === 'acro') return 4;
    if (mode === 'horizon') return 3;
    return altitudeHelp ? 1 : 2;
}

/** The settings of a step. */
export function settingsOf(step: SchoolStep): { mode: FlightMode; altitudeHelp: boolean } {
    switch (step) {
        case 1: return { mode: 'angle', altitudeHelp: true };
        case 2: return { mode: 'angle', altitudeHelp: false };
        case 3: return { mode: 'horizon', altitudeHelp: false };
        case 4: return { mode: 'acro', altitudeHelp: false };
    }
}

/** Seconds of flight without a crash that finish a step. */
export const GOAL_S: Readonly<Record<SchoolStep, number>> = { 1: 30, 2: 45, 3: 60, 4: 60 };

/** What the stats of the life in progress say (sim-core FlightStats.life()). */
export interface LifeView { index: number; airtimeS: number; crashes: number }

/** Progress toward the goal of the step flown now. */
export interface Progress { step: SchoolStep; seconds: number; goal: number; reached: boolean }

/**
 * Counts the seconds flown in the current step without a crash. A new life, a crash or another step
 * starts the count again; reaching the goal is reported once per step until the step changes.
 */
export class SchoolProgress {
    private step: SchoolStep | null = null;
    private life = -1;
    private base = 0;
    private done = new Set<SchoolStep>();

    update(step: SchoolStep, life: LifeView): Progress {
        if (step !== this.step || life.index !== this.life) {
            this.step = step;
            this.life = life.index;
            this.base = life.airtimeS;
        }
        const goal = GOAL_S[step];
        const seconds = life.crashes > 0 ? 0 : Math.max(0, life.airtimeS - this.base);
        const reached = seconds >= goal && !this.done.has(step);
        if (reached) this.done.add(step);
        return { step, seconds, goal, reached };
    }

    /** Goals reached on this page (a goal is offered once). */
    reachedSteps(): SchoolStep[] {
        return [...this.done];
    }
}
