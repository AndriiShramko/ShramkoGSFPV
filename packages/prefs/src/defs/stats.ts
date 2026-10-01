// Flight stats (A.8, D.2; item 7). Owner: W2-4. Group display: that is where the card is switched off.
// The card reads it (apps/fly/src/app/builtin/summary.ts) and its texts are in locales/fly/stats.
// Still 'planned': packages/prefs/test/defs.test.ts pins the shipped list to v0.2's and main's
// settings and reads set.<id> from the set namespace only, so the lead flips it with that test.
import type { SettingDef } from '../schema';

export const STATS_DEFS: readonly SettingDef[] = [
    { id: 'stats.onDisarm', group: 'display', scope: 'global', type: 'bool', default: true, apply: 'live', shown: ['settings'], status: 'planned', since: 1, items: [7] }
];
