// Lane w1-dialog S2 (point 4 of the lane: a link made after Add here lays the whole course in another browser). The link is
// longer, not stored: 'g2.<first>_<seed>.<ls>.<x>.<y>.<z>' (packages/tracks request.ts addedLinkId); the address must carry it
// whole. NEG: the token rule of w1-anchor took at most 60 characters and no '_', so Share dropped such a course.
import { describe, expect, it } from 'vitest';
import { MAX_ADDS, addedLinkId, courseLinkId } from '@gsfpv/tracks';
import type { CourseRequest } from '@gsfpv/tracks';
import { isCourseToken } from '../../../apps/fly/src/share/flight-link';
import { courseOfLink } from '../../../apps/fly/src/course/link';

describe('w1-dialog: the link of a course with Add here parts travels in an address', () => {
    const first: CourseRequest = { seed: 0xffffffff, level: 'pro', spread: 'wide', anyQuality: false, anchor: [-123456, -999, 654321] };
    const part: CourseRequest = { seed: 0xfffffffe, level: 'beginner', spread: 'compact', anyQuality: false, anchor: [-123456, -999, -654321] };
    let id = courseLinkId(first);
    for (let i = 0; i < MAX_ADDS; i++) id = addedLinkId(id, part)!;

    it('the longest link (MAX_ADDS parts, the largest seeds and places) is a course token', () => {
        expect(id.length).toBeGreaterThan(60);
        expect(isCourseToken(id)).toBe(true);
        expect(isCourseToken(courseLinkId(first))).toBe(true);
    });

    it('the address gives back every part, in order', () => {
        const link = courseOfLink(`?scene=eb5f51dc&course=${new URLSearchParams({ c: id }).get('c')}`);
        expect(link).toEqual({ kind: 'request', request: first, adds: Array.from({ length: MAX_ADDS }, () => part) });
        expect(new URL(`https://x.test/fly/?course=${id}`).searchParams.get('course')).toBe(id);
    });
});
