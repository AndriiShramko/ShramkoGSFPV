// Scene rotation (A.8, E.3-E.5; item 10). Owner: W3-1. Defaults are Andrii's: no automatic scene
// switch, and N walks the scenes the admin curated in his order, then SuperSplat (v0.9 item 9, tour.ts).
// scenes.order was `random` until v0.9: "in his order" is the default now (an unset default is not stored,
// so no schema bump); `random` draws the owner's scenes in a shuffled order, SuperSplat follows.
import type { SettingDef } from '../schema';

export const SCENES_DEFS: readonly SettingDef[] = [
    { id: 'scenes.autoSwitch', group: 'scenes', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings', 'crash'], status: 'shipped', since: 1, items: [10] },
    { id: 'scenes.rotation', group: 'scenes', scope: 'global', type: 'enum', options: ['curated', 'favourites', 'history'], default: 'curated', apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [10] },
    { id: 'scenes.order', group: 'scenes', scope: 'global', type: 'enum', options: ['random', 'sequential'], default: 'sequential', apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [10] },
    { id: 'scenes.allowNoWalls', group: 'scenes', scope: 'global', type: 'bool', default: false, apply: 'live', shown: ['settings'], status: 'shipped', since: 1, items: [10] }
];
