// Flight stats (A.8, D.2; item 7). Owner: W2-4. Group display: that is where the card is switched off.
import type { SettingDef } from '../schema';

export const STATS_DEFS: readonly SettingDef[] = [
    { id: 'stats.onDisarm', group: 'display', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [7] }
];
