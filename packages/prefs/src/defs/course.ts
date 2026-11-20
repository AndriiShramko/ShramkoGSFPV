// Train 1, lane tracks (docs/wip/train1-plan.md): the settings of the course (the generated obstacles, the arrows, the lap
// timer). Owner: lane tracks. The file is registered in defs/index.ts on the train base, so the lane adds its defs here and
// never edits index.ts. Ids start with `course.`.
import type { SettingDef } from '../schema';

/** lane course4 (lead decision S4): 'Lap time on screen'; the same list as apps/fly/src/course/finish.ts LAP_SPLASH_MODES */
export const LAP_SPLASH_OPTIONS = ['large', 'small', 'off'] as const;

/** lane gen4b: the generator's level and spread (packages/tracks request.ts; prefs does not depend on tracks) */
export const COURSE_LEVEL_OPTIONS = ['beginner', 'medium', 'pro'] as const;
export const COURSE_SPREAD_OPTIONS = ['compact', 'wide'] as const;

export const COURSE_DEFS: readonly SettingDef[] = [
    // there is no course group in schema.ts GROUPS: the setting sits with the other things drawn over the view (Display)
    { id: 'course.lapSplash', group: 'display', scope: 'global', type: 'enum', options: LAP_SPLASH_OPTIONS, default: 'large', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 },
    // lane gen4b (gen4 design G7, G8): the level and the spread picked last in the 'Generate a course' dialog
    // (apps/fly/src/course/generate-dialog.ts), the same lists as packages/tracks request.ts CourseLevel, CourseSpread.
    // 'planned': stored and validated, chosen in that dialog only (no settings row, so no catalogue change in this lane)
    { id: 'course.level', group: 'display', scope: 'global', type: 'enum', options: COURSE_LEVEL_OPTIONS, default: 'medium', apply: 'live', shown: ['settings'], status: 'planned', since: 2 },
    { id: 'course.spread', group: 'display', scope: 'global', type: 'enum', options: COURSE_SPREAD_OPTIONS, default: 'compact', apply: 'live', shown: ['settings'], status: 'planned', since: 2 }
];
