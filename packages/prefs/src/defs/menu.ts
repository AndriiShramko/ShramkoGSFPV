// The menu level (docs/wip/menu-plan.md 2.1; the owner's three kinds of new pilot). A new pilot answers it
// once in the "Before you fly" notice (apps/fly/src/ui/panels.ts warningModal): 'first' or 'sim' gives the
// shorter menus. The default is 'expert', today's full menus, so a pilot who visited before the question
// existed, a shared link and every bench page (?nowarn) keep the menus they knew. First row of Display
// (index.ts registers this file before display.ts); its level in defs/levels.ts is 'first', so every
// pilot can change it back.
import type { SettingDef } from '../schema';

export const MENU_DEFS: readonly SettingDef[] = [
    { id: 'ui.menuLevel', group: 'display', scope: 'global', type: 'enum', options: ['first', 'sim', 'expert'], default: 'expert', apply: 'live', shown: ['settings'], status: 'shipped', since: 2 }
];
