// Train 1, lane tracks (docs/wip/train1-plan.md): the course in a scan: generated obstacles in the free space, the arrows,
// the lap timer, on and off in flight, saved on the server for the scene. Owner: lane tracks. The feature is registered in
// app/features.ts on the train base, so the lane fills install() here (its code lives in apps/fly/src/course/) and never
// edits features.ts. The page hook it fills is CourseHook (apps/fly/src/course/hook.ts, window.__gsfpv.course).
import type { Feature } from '../context';

export const course: Feature = {
    id: 'course',
    install() {
        // nothing until the lane lands: an ordinary flight is the same flight
    }
};
