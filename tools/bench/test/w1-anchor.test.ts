// Lane w1-anchor (train 5, design w1-diag R1): the page's anchor of a generated course is the pilot's place. Parked on the
// spawn (the scene just loaded, or the drone put back): the spawn, the author's camera. In the air or paused in the air: the
// drone. Always whole flown metres, the form the link carries (request.ts courseAnchor), so the page lays what the link names.
// Negative control: origin/main has no course/anchor.ts and no anchor in the request.
import { describe, expect, it } from 'vitest';
import { S } from '@gsfpv/sim-core';
import { courseLinkId, parseCourseLink } from '@gsfpv/tracks';
import { FROM_PILOT, pilotAnchor } from '../../../apps/fly/src/course/anchor';
import { courseOfLink } from '../../../apps/fly/src/course/link';
import { courseToken, isCourseToken, readFlightLink } from '../../../apps/fly/src/share/flight-link';

const SPAWN = [10.4, 2.6, -7.5];

describe('the anchor of a course asked now', () => {
    it('parked on the spawn: the spawn, the author\'s camera, in whole metres', () => {
        const s = new Float64Array(64);
        s[S.hold] = 1;
        s[S.px] = SPAWN[0]!; s[S.py] = SPAWN[1]!; s[S.pz] = SPAWN[2]!;
        expect(pilotAnchor(s, SPAWN)).toEqual([10, 3, -7]);
    });

    it('in the air or paused in the air 30 m away: the drone', () => {
        const s = new Float64Array(64);
        s[S.hold] = 0;
        s[S.px] = 40.6; s[S.py] = 5.2; s[S.pz] = -7.49;
        expect(pilotAnchor(s, SPAWN)).toEqual([41, 5, -7]);
        // held (paused) away from the spawn is still the drone's place, not the spawn
        s[S.hold] = 1;
        expect(pilotAnchor(s, SPAWN)).toEqual([41, 5, -7]);
    });

    it('a key press takes the pilot\'s place; the anchor survives the link, -0 written as 0', () => {
        expect(FROM_PILOT).toEqual({ kind: 'pilot' });
        const s = new Float64Array(64);
        s[S.px] = -0.2; s[S.py] = 1.4; s[S.pz] = -123.5;
        const request = { seed: 99, level: 'medium' as const, spread: 'compact' as const, anyQuality: false, anchor: pilotAnchor(s, SPAWN) };
        const id = courseLinkId(request);
        expect(id).toBe('g2.2r.mc.0.1.-123');
        expect(parseCourseLink(id)).toEqual({ kind: 'request', request });
    });

    it('a shared link (Share) keeps a course whose anchor is negative; the browser that opens it reads the same course', () => {
        const id = 'g2.2r.mc.12.-3.-540';
        expect(isCourseToken(id)).toBe(true);
        const place = readFlightLink(`?scene=eb5f51dc&course=${id}`);
        expect(place?.course).toEqual({ kind: 'generated', link: id });
        expect(courseToken({ kind: 'generated', link: id })).toBe(id);
        expect(courseOfLink(`?scene=eb5f51dc&course=${id}`)).toEqual({ kind: 'request', request: { seed: 99, level: 'medium', spread: 'compact', anyQuality: false, anchor: [12, -3, -540] } });
    });
});
