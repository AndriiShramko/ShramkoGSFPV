// Train 1, lane tracks (docs/wip/train1-plan.md): the settings of the course (the generated obstacles, the arrows, the lap
// timer). Owner: lane tracks. The file is registered in defs/index.ts on the train base, so the lane adds its defs here and
// never edits index.ts. Ids start with `course.`.
import type { SettingDef } from '../schema';

/** lane course4 (lead decision S4): 'Lap time on screen'; the same list as apps/fly/src/course/finish.ts LAP_SPLASH_MODES */
export const LAP_SPLASH_OPTIONS = ['large', 'small', 'off'] as const;

export const COURSE_DEFS: readonly SettingDef[] = [
    // there is no course group in schema.ts GROUPS: the setting sits with the other things drawn over the view (Display)
    { id: 'course.lapSplash', group: 'display', scope: 'global', type: 'enum', options: LAP_SPLASH_OPTIONS, default: 'large', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
