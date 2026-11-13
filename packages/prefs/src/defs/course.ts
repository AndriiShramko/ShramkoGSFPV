// Train 1, lane tracks (docs/wip/train1-plan.md): the settings of the course (the generated obstacles, the arrows, the lap
// timer). Owner: lane tracks. The file is registered in defs/index.ts on the train base, so the lane adds its defs here and
// never edits index.ts. Ids start with `course.`.
import type { SettingDef } from '../schema';

export const COURSE_DEFS: readonly SettingDef[] = [];
