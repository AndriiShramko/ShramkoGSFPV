// Lane gen4a S0: the course link of a request (request.ts) round-trips for every level and spread, and the old 'g1.' links
// stay the old generator's seed.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { VoxelCollision } from '@gsfpv/collision';
import { planCourse } from '../src';
import { LEVELS, REQUEST_DEFAULTS, courseAnchor, courseLinkId, parseCourseLink } from '../src/request';
import type { CourseLevel, CourseRequest } from '../src/request';
import { IDENTITY } from './worlds';
import { cityFromAbove, fringeField, scannedRoom } from './scan-worlds';

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
                    expect(parseCourseLink(id)).toEqual({ kind: 'request', request: r, adds: [] });
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

    it('lane w1-anchor: a course with an anchor round-trips, every level and spread, negative and far places, whole metres', () => {
        const places: readonly (readonly [number, number, number])[] = [[0, 0, 0], [22, 3, 22], [-540, -12, 87], [999999, -999999, 5]];
        for (const level of LEVEL_NAMES)
            for (const s of SPREADS)
                for (const anchor of places) {
                    const r: CourseRequest = { seed: 0xffffffff, level, ...s, anchor };
                    const id = courseLinkId(r);
                    expect(id).toMatch(/^g2\.[0-9a-z]{1,7}\.[bmp][cwv]\.-?\d+\.-?\d+\.-?\d+$/);
                    // a track's id (TRACK_ID: at most 80) and a room's course (rooms protocol COURSE_RE: at most 64)
                    expect(id.length).toBeLessThanOrEqual(64);
                    expect(parseCourseLink(id)).toEqual({ kind: 'request', request: r, adds: [] });
                }
        // the page rounds before it asks; a request that was not rounded is written rounded, -0 as 0
        expect(courseLinkId({ seed: 7, level: 'medium', spread: 'compact', anyQuality: false, anchor: [-0.4, 2.5, -540.6] })).toBe('g2.7.mc.0.3.-541');
        expect(courseAnchor([-0.4, 2.5, -540.6])).toEqual([0, 3, -541]);
        // half an anchor is no anchor: refused, not read as an old link
        for (const bad of ['g2.7.mc.1.2', 'g2.7.mc.1.2.3.4', 'g2.7.mc.1.2.x', 'g2.7.mc.1.5.2.3', 'g2.7.mc.1234567.0.0']) expect(parseCourseLink(bad)).toBeNull();
    });

    // Lane w1-anchor: a link of the old form names no anchor and keeps laying the course it laid before the anchor, gate for
    // gate (people have shared such links). The hashes were taken from origin/main's planCourse (2026-11-26, before the anchor)
    // on the same worlds: sha256 of [pos, quat, shape] of every gate, 16 hex.
    it('an old g2 link (no anchor) lays the same course as before the anchor, gate for gate', () => {
        const golden: readonly [string, () => VoxelCollision, CourseRequest, number, string][] = [
            ['g2.7.mc', scannedRoom, { seed: 7, level: 'medium', spread: 'compact', anyQuality: false, anchor: null }, 8, '934103477433852e'],
            ['g2.2.pw', cityFromAbove, { seed: 2, level: 'pro', spread: 'wide', anyQuality: false, anchor: null }, 15, 'fd1160d02c8a306c'],
            ['g2.1.bc', fringeField, { seed: 1, level: 'beginner', spread: 'compact', anyQuality: false, anchor: null }, 8, '2ba7510f684b83cd']
        ];
        for (const [link, world, request, gates, hash] of golden) {
            const parsed = parseCourseLink(link);
            expect(parsed).toEqual({ kind: 'request', request, adds: [] });
            const r = planCourse({ walls: world(), transform: IDENTITY, spawn: [0, 1, 0], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-19T00:00:00.000Z', craftRadiusM: 0.0425, request, elements: true });
            expect(r.ok).toBe(true);
            if (!r.ok) continue;
            expect(r.track.id).toBe(link);
            expect(r.track.gates.length).toBe(gates);
            expect(createHash('sha256').update(JSON.stringify(r.track.gates.map((g) => [g.pos, g.quat, g.shape]))).digest('hex').slice(0, 16)).toBe(hash);
        }
    }, 120_000);

    it('defaults and levels hold the design numbers', () => {
        expect(REQUEST_DEFAULTS).toEqual({ level: 'medium', spread: 'compact', anyQuality: false });
        expect(LEVEL_NAMES.map((l) => LEVELS[l].openingD)).toEqual([10, 6, 4]);
        for (const l of LEVEL_NAMES) expect(LEVELS[l].gatesMin).toBeLessThanOrEqual(LEVELS[l].gatesMax);
    });
});
