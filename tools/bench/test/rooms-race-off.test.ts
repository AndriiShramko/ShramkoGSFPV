// Train 2 wave 2 integration: the race ships switched off until tools/bench/src/rooms-race.ts passes in two browsers
// (docs/wip/train2b-lead.md). The room panel gets no race entry while RACE_ON is false.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as racePage from '../../../apps/fly/src/rooms/race-page';

const ROOMS = join(__dirname, '..', '..', '..', 'apps', 'fly', 'src', 'app', 'builtin', 'rooms.ts');

describe('the race entry is off in this release', () => {
    it('RACE_ON is false', () => {
        expect((racePage as Record<string, unknown>).RACE_ON).toBe(false);
    });
    it('the room panel offers the race only when RACE_ON is true', () => {
        const src = readFileSync(ROOMS, 'utf8');
        expect(src).toMatch(/const race = RACE_ON && s && r && s\.state === 'joined'/);
    });
});
