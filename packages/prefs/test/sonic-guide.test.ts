// Train 4, lane tutor-say (decision 7, plan Part C 2): the guide's level is kept in the collection 'sonic' (absent: short).
import { describe, expect, it } from 'vitest';
import { MemoryBackend, SONIC_GUIDE_LEVELS, validateCollection } from '../src';
import { mkStore } from './helpers';

describe('SonicState.guide', () => {
    it('full, short and new are kept through a write and a new store on the same backend', () => {
        for (const level of SONIC_GUIDE_LEVELS) {
            const b = new MemoryBackend();
            mkStore(b).updateCollection('sonic', (d) => {
                d.guide = level;
            });
            expect(mkStore(b).collection('sonic').guide).toBe(level);
        }
    });

    it('absent stays absent (short); a value that is not one of the three is left out, the rest kept (control)', () => {
        expect(mkStore().collection('sonic').guide).toBeUndefined();
        for (const bad of ['loud', 7, null, true, 'Full']) {
            const v = validateCollection('sonic', { v: 1, prefs: null, progress: {}, current: null, keyHints: false, guide: bad });
            expect(v).not.toBeNull();
            expect(v).not.toHaveProperty('guide');
            expect(v?.keyHints).toBe(false);
        }
        expect(validateCollection('sonic', { v: 1, prefs: null, progress: {}, current: null, guide: 'new' })?.guide).toBe('new');
    });
});
