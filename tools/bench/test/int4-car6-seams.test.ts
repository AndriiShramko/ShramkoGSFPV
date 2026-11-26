// Train 5, integration car 6 (S2): where w1-anchor meets car 5's lanes.
//   - n-share's shared sound link (share/flight-link.ts flightLink in the sound mode, scenes/sonic-link.ts COURSE_TOKEN, the sound
//     start screen's parseSonicParam) carries a generated course whose token now holds '-' (a negative anchor, w1-anchor): the
//     browser that opens it gets the scan, the sound mode and the same course with its anchor; a link of the old form ('g2.' without
//     a place) still names its old course, anchor null (laid from the analysis core as before)
//   - the generate dialog's ask (gen4b) carries no anchor: the page adds the pilot's place when the job is sent (course/anchor.ts)
// Negative control: car 5's head 3cc6b51b reads no anchor (parseCourseLink has none; the share reader's GENERATED took no '-').
import { describe, expect, it } from 'vitest';
import { courseOfLink } from '../../../apps/fly/src/course/link';
import { flightLink, readFlightLink } from '../../../apps/fly/src/share/flight-link';
import { parseSonicParam } from '../../../apps/fly/src/sonic/start-model';
import { fakeDocument } from './helpers/fake-dom';

const AT = { origin: 'https://example.test', locale: 'en' };
const NEW = 'g2.2r.mc.12.-3.-540';
const OLD = 'g2.2r.mc';

function opened(token: string): { search: string; url: string } {
    const url = flightLink({ sceneId: 'eb5f51dc', size: 1, course: { kind: 'generated', link: token }, mode: 'sound' }, AT);
    return { url, search: new URL(url).search };
}

describe('int4 car 6: w1-anchor\'s course token x n-share\'s shared sound link', () => {
    it('the new form (negative anchor): the link holds the token whole; the other browser flies the same course by sound', () => {
        const { url, search } = opened(NEW);
        expect(url).toContain(`course=${NEW}`);
        const place = readFlightLink(search);
        expect(place?.mode).toBe('sound');
        expect(place?.course).toEqual({ kind: 'generated', link: NEW });
        const q = new URLSearchParams(search);
        const req = parseSonicParam(q.get('sonic'), q);
        expect(req).toMatchObject({ kind: 'scan', sceneId: 'eb5f51dc', course: NEW });
        expect(courseOfLink(search)).toEqual({ kind: 'request', request: { seed: 99, level: 'medium', spread: 'compact', anyQuality: false, anchor: [12, -3, -540] } });
    });

    it('the old form: the same course as before (anchor null: the core)', () => {
        const { search } = opened(OLD);
        const q = new URLSearchParams(search);
        expect(readFlightLink(search)?.course).toEqual({ kind: 'generated', link: OLD });
        expect(parseSonicParam(q.get('sonic'), q)).toMatchObject({ kind: 'scan', course: OLD });
        expect(courseOfLink(search)).toEqual({ kind: 'request', request: { seed: 99, level: 'medium', spread: 'compact', anyQuality: false, anchor: null } });
    });

    it('the generate dialog asks no place: the page adds the pilot\'s at the press', async () => {
        // generate-dialog.ts reaches ui/dom.ts and i18n.ts (the page's path on load), as in int4-car5-seams.test.ts
        const g = globalThis as { location?: unknown; document?: unknown };
        g.document ??= fakeDocument();
        g.location ??= { pathname: '/en/', search: '', href: 'http://localhost/en/' };
        const { dialogModel } = await import('../../../apps/fly/src/course/generate-dialog');
        const m = dialogModel({ level: 'medium', spread: 'compact', voxelsOnly: false, shownGates: 0, unsaved: false } as Parameters<typeof dialogModel>[0], (k) => k);
        expect('anchor' in m.request).toBe(false);
    });
});
