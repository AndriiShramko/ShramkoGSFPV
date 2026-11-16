// The course's keys pressed before its chunk is there (builtin/course-lazy.ts): which keys are taken and the last press kept.
// Pure, no DOM and no texts, so it is unit tested (tools/bench/test/course-early.test.ts).
import type { ActionId } from '@gsfpv/prefs';

/** The course's keys a pilot may press before the chunk is there. */
export const EARLY_ACTIONS: readonly ActionId[] = ['course.generate', 'course.toggle', 'course.edit'];
/** A press older than this is not run when the chunk arrives: the pilot has moved on (an estimate, not measured). */
export const EARLY_KEEP_MS = 20000;

/** The last press that came before the feature, given back once if it is still fresh. */
export function earlyPress(keepMs: number): { note(action: ActionId, now: number): void; take(now: number): ActionId | null } {
    let last: { action: ActionId; at: number } | null = null;
    return {
        note(action, now) { last = { action, at: now }; },
        take(now) {
            const l = last;
            last = null;
            return l && now - l.at <= keepMs ? l.action : null;
        }
    };
}
