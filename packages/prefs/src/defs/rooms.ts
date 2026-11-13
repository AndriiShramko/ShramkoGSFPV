// Train 1, lane rooms (docs/wip/train1-plan.md): the settings of flying together (the pilot's nickname, what is said about
// the other pilots). Owner: lane rooms. The file is registered in defs/index.ts on the train base, so the lane adds its defs
// here and never edits index.ts. Ids start with `rooms.`.
import type { SettingDef } from '../schema';

export const ROOMS_DEFS: readonly SettingDef[] = [];
