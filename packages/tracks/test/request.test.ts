// Lane gen4a S0: the course link of a request (request.ts) round-trips for every level and spread, and the old 'g1.' links
// stay the old generator's seed.
import { describe, expect, it } from 'vitest';
import { LEVELS, REQUEST_DEFAULTS, courseLinkId, parseCourseLink } from '../src/request';
import type { CourseLevel, CourseRequest } from '../src/request';

const LEVEL_NAMES: readonly CourseLevel[] = ['beginner', 'medium', 'pro'];
const SPREADS: readonly Pick<CourseRequest, 'spread' | 'anyQuality'>[] = [
    { spread: 'compact', anyQuality: false },
    { spread: 'wide', anyQuality: false },
    { spread: 'wide', anyQuality: true }
];

describe('course link of a request', () => {
    it('round-trips all six level and spread combinations, the largest seed too', () => {
        const ids = new Set<string>();
        for (const level of LEVEL_NAMES) {
            for (const s of SPREADS) {
                for (const seed of [0, 12345, 0xffffffff]) {
                    const r: CourseRequest = { seed, level, ...s, anchor: null };
                    const id = courseLinkId(r);
                    expect(id).toMatch(/^g2\.[0-9a-z]{1,7}\.[bmp][cwv]$/);
                    expect(parseCourseLink(id)).toEqual({ kind: 'request', request: r });
                    ids.add(id);
                }
            }
        }
        expect(ids.size).toBe(27);
    });

    it('keeps an old g1 link the old generator (negative control: a parser that reads it as a request fails)', () => {
        expect(parseCourseLink('g1.bnhwha')).toEqual({ kind: 'legacy', seed: parseInt('bnhwha', 36) });
    });

    it('the voxels-only view always spreads over the whole scan', () => {
        expect(courseLinkId({ seed: 7, level: 'pro', spread: 'compact', anyQuality: true, anchor: null })).toBe('g2.7.pv');
    });

    it('refuses what names no generated course', () => {
        for (const bad of ['', 'g1.', 'g2.7', 'g2.7.mx', 'g2.7.zc', 'g3.7.mc', 'g2.zzzzzzz.mc', 'g2.12345678.mc', 'abcdef-0123abcd']) {
            expect(parseCourseLink(bad)).toBeNull();
        }
    });

    it('defaults and levels hold the design numbers', () => {
        expect(REQUEST_DEFAULTS).toEqual({ level: 'medium', spread: 'compact', anyQuality: false });
        expect(LEVEL_NAMES.map((l) => LEVELS[l].openingD)).toEqual([10, 6, 4]);
        for (const l of LEVEL_NAMES) expect(LEVELS[l].gatesMin).toBeLessThanOrEqual(LEVELS[l].gatesMax);
    });
});
