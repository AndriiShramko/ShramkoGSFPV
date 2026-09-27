// Input (A.8). Owner: W2-3. The stick mode only picks which stick the drawings call throttle; it
// never changes the mapping. v0.2 kept it in its own storage key (migrated, see migrate.ts).
import type { SettingDef } from '../schema';

export const INPUT_DEFS: readonly SettingDef[] = [
    { id: 'input.stickMode', group: 'input', scope: 'global', type: 'enum', options: ['1', '2'], default: '2', apply: 'live', shown: ['controls'], status: 'shipped', since: 1, items: [1] }
];
