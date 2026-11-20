// Lane n-share (the owner's wish 2 of 2026-11-20): every place that offers a link, the address it gives, and that address read as
// a browser that has never opened the site reads it: the scene, the course, the way of flying, and where the page lands. Negative
// control: on the code before the repair the row "flight by sound with gates" fails (the sound link dropped the course and named a
// lesson start screen that offers the lessons first).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCAN_FREE_ID, SHIPPED_LESSON_IDS, defaultPrefs, getLesson, scanFreeLesson } from '../../../packages/sonic-fpv/src';
import { parseSonicLink } from '../../../packages/scenes/src/sonic-link';
import { shareLink } from '../../../apps/fly/src/share/links';
import { courseOfFlight, flightLink, readFlightLink } from '../../../apps/fly/src/share/flight-link';
import type { FlownCourse, LinkCourse } from '../../../apps/fly/src/share/flight-link';
import { soundPlace } from '../../../apps/fly/src/sonic/mode-keys';
import { parseSonicParam } from '../../../apps/fly/src/sonic/start-model';
import { courseOfLink, servedOfLink } from '../../../apps/fly/src/course/link';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AT = { origin: 'https://gsfpv.example', locale: 'en' };
const SCENE = '39e63ce9';
const SERVED = '39e63ce9-0a1b2c3d';
const GEN = 'g2.k3j1.mc';
const PICTURE = `${AT.origin}/s/abc123`;
const prefs = defaultPrefs();

/** The course hook of a flight (course/hook.ts) and the address the course feature keeps (course= of a generated course). */
const generated: [FlownCourse, string] = [{ source: 'generated', track: { id: 'gen-1', version: 1 } }, `?scene=${SCENE}&course=${GEN}`];
const served: [FlownCourse, string] = [{ source: 'server', track: { id: SERVED, version: 3 } }, `?scene=${SCENE}`];
const freeFlight = scanFreeLesson(SCENE, [2, 0, 0, 0]);
const scanLesson = SHIPPED_LESSON_IDS.map((id) => getLesson(id)).find((l) => l.world.kind === 'scan');

/** What a fresh browser makes of an address: the scene, the course, the way of flying, and the page it lands on. */
interface Fresh {
    scene: string | null;
    course: LinkCourse;
    mode: 'normal' | 'sound' | null;
    /** sound: the start screen's request (scan: the one-button flight in that scene; lesson: that lesson); normal: the flight */
    lands: string;
}

function fresh(url: string): Fresh {
    const u = new URL(url);
    const page = /^\/[a-z]{2}\/scenes\/([^/]+)\/$/.exec(u.pathname);
    if (page) return { scene: page[1]!, course: null, mode: 'normal', lands: 'flight' };
    if (/^\/s\//.test(u.pathname)) return { scene: null, course: null, mode: null, lands: 'picture page' };
    const p = readFlightLink(u.search);
    const q = new URLSearchParams(u.search);
    const sonic = q.get('sonic');
    const lands = sonic === null ? 'flight' : parseSonicParam(sonic, q).kind;
    return { scene: p?.sceneId ?? null, course: p?.course ?? null, mode: p ? (p.mode === 'sound' ? 'sound' : 'normal') : null, lands };
}

interface Row {
    place: string;
    address: () => string;
    want: Fresh;
}

const ROWS: Row[] = [
    {
        place: 'pause menu, normal flight with a generated course',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: true, at: AT, pictureUrl: PICTURE, course: courseOfFlight(...generated) }),
        want: { scene: SCENE, course: { kind: 'generated', link: GEN }, mode: 'normal', lands: 'flight' }
    },
    {
        place: 'pause menu, normal flight with a saved course',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: true, at: AT, pictureUrl: PICTURE, course: courseOfFlight(...served) }),
        want: { scene: SCENE, course: { kind: 'served', id: SERVED, version: 3 }, mode: 'normal', lands: 'flight' }
    },
    {
        place: 'pause menu, normal flight without a course (the picture page opens the scene)',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: true, at: AT, pictureUrl: PICTURE, course: courseOfFlight(null, '') }),
        want: { scene: null, course: null, mode: null, lands: 'picture page' }
    },
    {
        place: 'flight by sound with gates',
        address: () => flightLink(soundPlace(freeFlight, prefs, courseOfFlight(...generated)), AT),
        want: { scene: SCENE, course: { kind: 'generated', link: GEN }, mode: 'sound', lands: 'scan' }
    },
    {
        place: 'flight by sound with a saved course',
        address: () => flightLink(soundPlace(freeFlight, prefs, courseOfFlight(...served)), AT),
        want: { scene: SCENE, course: { kind: 'served', id: SERVED, version: 3 }, mode: 'sound', lands: 'scan' }
    },
    {
        place: 'test flight from the editor, a course never saved (the scene alone)',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: false, at: AT, pictureUrl: null, course: courseOfFlight({ source: 'new', track: { id: 'mine', version: 1 } }, '') }),
        want: { scene: SCENE, course: null, mode: 'normal', lands: 'flight' }
    },
    {
        place: 'test flight from the editor, a saved course changed since',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: false, at: AT, pictureUrl: null, course: courseOfFlight({ ...served[0], editor: { changed: true } }, served[1]) }),
        want: { scene: SCENE, course: null, mode: 'normal', lands: 'flight' }
    },
    {
        place: 'test flight from the editor, a saved course unchanged',
        address: () => shareLink({ entry: 'pause', sceneId: SCENE, inCatalogue: false, at: AT, pictureUrl: PICTURE, course: courseOfFlight({ ...served[0], editor: { changed: false } }, served[1]) }),
        want: { scene: SCENE, course: { kind: 'served', id: SERVED, version: 3 }, mode: 'normal', lands: 'flight' }
    },
    {
        place: 'course chip (lane n-level calls flightLink with the course shown)',
        address: () => flightLink({ sceneId: SCENE, course: { kind: 'generated', link: 'g3.1a2b.mw' }, mode: 'normal' }, AT),
        want: { scene: SCENE, course: { kind: 'generated', link: 'g3.1a2b.mw' }, mode: 'normal', lands: 'flight' }
    }
];

describe('share links table: every place, read as a fresh profile reads it', () => {
    for (const row of ROWS) {
        it(row.place, () => {
            expect(fresh(row.address())).toEqual(row.want);
        });
    }

    it('a scan lesson by sound names its lesson and scan, and lands on that lesson', () => {
        expect(scanLesson).toBeDefined();
        const url = flightLink(soundPlace(scanLesson!, prefs, null), AT);
        expect(fresh(url)).toMatchObject({ scene: scanLesson!.world.kind === 'scan' ? scanLesson!.world.sceneId : null, mode: 'sound', lands: 'lesson' });
        expect(readFlightLink(new URL(url).search)?.lesson).toBe(scanLesson!.id);
    });

    it('race room invite: the scene and the room; the room carries its course (RoomInfo.course, adopted on join)', () => {
        const src = readFileSync(join(REPO, 'apps/fly/src/app/builtin/rooms.ts'), 'utf8');
        const m = /return `\$\{origin\}\/fly\/\?scene=\$\{encodeURIComponent\(room\.scene\.id\)\}\$\{q \? `&\$\{q\}` : ''\}&room=\$\{encodeURIComponent\(room\.id\)\}`;/.exec(src);
        expect(m, 'roomLink writes scene and room').not.toBeNull();
        const url = `${AT.origin}/fly/?scene=${SCENE}&room=abcdef12`;
        expect(fresh(url)).toEqual({ scene: SCENE, course: null, mode: 'normal', lands: 'flight' });
        expect(src).toMatch(/board\.onBoard|adoptOf/);
    });

    it('the course a link names is the one the course feature reads (servedOfLink, courseOfLink), never rebuilt', () => {
        const s = new URL(flightLink({ sceneId: SCENE, course: { kind: 'served', id: SERVED, version: 3 }, mode: 'sound' }, AT)).search;
        expect(servedOfLink(s)).toEqual({ id: SERVED, version: 3 });
        const g = new URL(flightLink({ sceneId: SCENE, course: { kind: 'generated', link: GEN }, mode: 'normal' }, AT)).search;
        expect(new URLSearchParams(g).get('course')).toBe(GEN);
        expect(courseOfLink(g)).not.toBeNull();
        expect(parseSonicLink(new URLSearchParams(new URL(flightLink(soundPlace(freeFlight, prefs, courseOfFlight(...generated)), AT)).search))?.course).toBe(GEN);
    });

    it('a course never saved never travels, and the free flight is the sound package template', () => {
        expect(flightLink({ sceneId: SCENE, course: { kind: 'unsaved' }, mode: 'sound' }, AT)).not.toContain('course=');
        expect(freeFlight.id).toBe(SCAN_FREE_ID);
        expect(readFlightLink(new URL(flightLink(soundPlace(freeFlight, prefs, null), AT)).search)?.lesson).toBeUndefined();
    });

    it('every Share writes through flightLink: the sound mode share and the flight share pass the course', () => {
        const feature = readFileSync(join(REPO, 'apps/fly/src/sonic/feature.ts'), 'utf8');
        expect(feature).toMatch(/flightLink\(soundPlace\(lesson, entry\.setup\.prefs, courseOfFlight\(ctx\.hook\.course, location\.search\)\)/);
        const share = readFileSync(join(REPO, 'apps/fly/src/app/builtin/share.ts'), 'utf8');
        expect(share).toMatch(/course: courseOfFlight\(ctx\.hook\.course, location\.search\)/);
        const panel = readFileSync(join(REPO, 'apps/fly/src/share/panel.ts'), 'utf8');
        expect(panel).toMatch(/course: req\.course/);
    });
});
