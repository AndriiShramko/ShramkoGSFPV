// Scene rotation (A.8, E.3-E.5; item 10). Owner: W3-1. Defaults are Andrii's: no automatic scene
// switch, and the rotation draws from the scenes the admin curated.
import type { SettingDef } from '../schema';

export const SCENES_DEFS: readonly SettingDef[] = [
    { id: 'scenes.autoSwitch', group: 'scenes', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings', 'crash'], status: 'planned', since: 1, items: [10] },
    { id: 'scenes.rotation', group: 'scenes', scope: 'global', type: 'enum', options: ['curated', 'favourites', 'history'], default: 'curated', apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [10] },
    { id: 'scenes.order', group: 'scenes', scope: 'global', type: 'enum', options: ['random', 'sequential'], default: 'random', apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [10] },
    { id: 'scenes.allowNoWalls', group: 'scenes', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [10] }
];
