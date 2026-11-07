// The helper's view of a replayed lesson (v0.12, docs/wip/v12-int.md step 5). A recording of several lessons is replayed lesson by
// lesson (sonic-session/replay-segments.ts), and each lesson's world must be drawn while it plays, whatever lesson the mode shows
// now. The drawing is the flight side's (sonic/feature.ts: the PrimitiveStage of the lesson host); the replay is the session side's
// (sonic-session/replay-host.ts). Neither imports the other: the flight side puts its view here and the replay asks for it. The
// sound package's SonicRuntime (ctx.sonic) is a shared contract and is not widened for this.
//
// Small on purpose and free of the sound package at run time (type imports only).
import type { LessonDef, Pose, SonicObject, SonicWorld } from '@shramko/sonic-fpv';
import type { FlightContext } from './context';

export interface LessonView {
    /** whether `show` can draw this lesson's world: an analytic one or a lesson with no world (its floor) always, a scan lesson only while the page flies that scan */
    canShow(lesson: LessonDef | null, world: SonicWorld | null): boolean;
    /** draws this lesson's world in place of what the mode shows; false (and nothing drawn) when it cannot */
    show(lesson: LessonDef | null, world: SonicWorld | null): boolean;
    /** what the mode was showing comes back */
    restore(): void;
    /** a scan lesson's world as the page flies it now, with its gates, start and floor; null when the page does not fly that scan */
    scanWorld(lesson: LessonDef): { readonly world: SonicWorld; readonly objects: readonly SonicObject[]; readonly start: Pose; readonly floorY: number } | null;
    /** a recording has just started: the lesson running now opens again from its beginning, so the recording holds all of it (its `lesson open` too) */
    reopen(): void;
}

const views = new WeakMap<FlightContext, LessonView>();

/** The flight side puts its view (null takes it away). */
export function setLessonView(ctx: FlightContext, view: LessonView | null): void {
    if (view === null) views.delete(ctx);
    else views.set(ctx, view);
}

/** The view of this page, or null where no flight side draws lessons (a page without the mode, a test). */
export function lessonView(ctx: FlightContext): LessonView | null {
    return views.get(ctx) ?? null;
}
