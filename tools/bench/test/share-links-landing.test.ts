// Lane n-share S2 (the owner's wish 2 of 2026-11-20; brief Decision 2): what a friend lands on when he opens a shared flight's
// address in a browser that has never opened the site. A link with a scene leads with that scene: the start screen's order
// is the scene first for every pilot (start-model scanStartOrder, no progress and no "I fly by sound" flag needed), and the
// request carries the link's course, so the one main button flies that course. A course built by hand and never saved cannot
// travel: the link is the scene alone and the Share says so in one line (flight-link.ts shareNoteKey, share.unsaved).
// The DOM of the screen is held by sonic-start-screen.test.ts ("the start screen of a link with a scene").
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flightLink, readFlightLink, shareNoteKey } from '../../../apps/fly/src/share/flight-link';
import { parseSonicParam, scanStartOrder } from '../../../apps/fly/src/sonic/start-model';

const at = { origin: 'https://example.test', locale: 'en' };

/** What the sound page asks for when a fresh profile opens `url` (boot.ts passes ?sonic= and the query to startSonic). */
function landing(url: string): ReturnType<typeof parseSonicParam> {
    const q = new URL(url).searchParams;
    return parseSonicParam(q.get('sonic'), q);
}

describe('lane n-share S2: a link with a scene lands on that scene', () => {
    it('a fresh profile (no progress, no flag) gets the scene as the first and main action, the lessons second', () => {
        expect(scanStartOrder()[0]).toBe('scan');
        expect(scanStartOrder()).toEqual(['scan', 'lessons']);
    });

    it('the Share of a flight by sound with a generated course lands on that scene and that course', () => {
        const url = flightLink({ sceneId: '39e63ce9', size: 2, course: { kind: 'generated', link: 'g2.k3j9.m' }, mode: 'sound' }, at);
        expect(landing(url)).toEqual({ kind: 'scan', sceneId: '39e63ce9', size: 2, course: 'g2.k3j9.m' });
    });

    it('the Share of a flight by sound with a saved course lands on that scene and that course, id and version', () => {
        const url = flightLink({ sceneId: '39e63ce9', course: { kind: 'served', id: '39e63ce9-0a1b2c3d', version: 4 }, mode: 'sound' }, at);
        expect(landing(url)).toMatchObject({ kind: 'scan', sceneId: '39e63ce9', course: '39e63ce9-0a1b2c3d.v4' });
        expect(readFlightLink(new URL(url).search)?.course).toEqual({ kind: 'served', id: '39e63ce9-0a1b2c3d', version: 4 });
    });

    it('a course in the address that no Share writes is not taken for one (the scene alone)', () => {
        expect(landing('https://example.test/fly/?sonic=fly&scene=39e63ce9&course=%3Cx%3E')).toEqual({ kind: 'scan', sceneId: '39e63ce9', size: 1 });
    });
});

describe('lane n-share S2: a hand-built course never saved', () => {
    it('does not travel, and the Share says so in one line (never a silent other course)', () => {
        const url = flightLink({ sceneId: '39e63ce9', course: { kind: 'unsaved' }, mode: 'normal' }, at);
        expect(readFlightLink(new URL(url).search)?.course).toBeNull();
        expect(shareNoteKey({ kind: 'unsaved' })).toBe('share.unsaved');
        expect(shareNoteKey({ kind: 'generated', link: 'g2.k3j9.m' })).toBeNull();
        expect(shareNoteKey(null)).toBeNull();
    });

    it('the line is in all four languages', () => {
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const dict = JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/share/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>;
            expect(dict['share.unsaved'], l).toMatch(/\S{3,}/);
        }
    });
});
