// Train 2, stage S2-any-scan (the owner: "if I already fly by sound I just want to try other interiors and exteriors"): the pause
// item links the scan flown now, the start screen of a scan link orders its actions by who the pilot is, and the free flight over a
// scan opens without a track.
import { describe, expect, it, vi, afterEach } from 'vitest';

/** The template's id (sonic-fpv library.ts SCAN_FREE_ID). */
const SCAN_FREE_ID = 'scan-free';
import { modeScanPage, soundCourseSeed } from '../../../apps/fly/src/app/builtin/sonic-flight';
import { experiencedPilot, parseSonicParam, scanStartOrder } from '../../../apps/fly/src/sonic/start-model';
import { freeLessonOf } from '../../../apps/fly/src/sonic/start-model';
import { seedOfLink } from '../../../apps/fly/src/course/link';
import { buildScanLesson } from '../../../apps/fly/src/sonic/scan-lesson';

const queryOf = (href: string): URLSearchParams => new URL(href, 'https://gsfpv.flyreelstudio.eu').searchParams;

describe('fly THIS scan by sound (train 2)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('the pause link carries the scene flown and its size, and the start screen reads it back as a scan request', () => {
        vi.stubGlobal('document', { documentElement: { lang: 'pl' } });
        const href = modeScanPage({ builtin: null, scene: { id: '887f27aa' }, transform: { s: 2.5 } });
        expect(href).toBe('/pl/fly/?sonic=scan&scene=887f27aa&sz=2.5');
        const q = queryOf(href);
        expect(parseSonicParam(q.get('sonic'), q)).toEqual({ kind: 'scan', sceneId: '887f27aa', size: 2.5 });
        // a built-in world has no scan to fly: the plain start screen
        expect(modeScanPage({ builtin: {}, scene: { id: 'rooms' }, transform: { s: 1 } })).toBe('/pl/fly/?sonic=start');
        // a scan link without a scene is the start screen with the note, never a flight over nothing
        expect(parseSonicParam('scan', queryOf('/en/fly/?sonic=scan')).kind).toBe('unknown');
    });

    it('a first-timer gets the lessons first, then the scan; an experienced pilot (any progress, or he said he flies by sound) gets the scan first', () => {
        expect(experiencedPilot({}, false)).toBe(false);
        expect(scanStartOrder(experiencedPilot({}, false))).toEqual(['lessons', 'scan']);
        expect(experiencedPilot({ 'rings-first': { attempts: 1 } }, false)).toBe(true);
        expect(scanStartOrder(experiencedPilot({ 'rings-first': { attempts: 1 } }, false))).toEqual(['scan', 'lessons']);
        expect(scanStartOrder(experiencedPilot({}, true))).toEqual(['scan', 'lessons']);
    });

    it('the free flight is the scan-free template over the link\'s scan at its size, and its world builds without a track', () => {
        const req = parseSonicParam('scan', queryOf('/en/fly/?sonic=scan&scene=887f27aa&sz=3'));
        const lesson = freeLessonOf(req, SCAN_FREE_ID);
        expect(lesson).not.toBeNull();
        expect(lesson!.world).toMatchObject({ kind: 'scan', sceneId: '887f27aa', transform: [3, 0, 0, 0], track: null });
        // a shipped lesson pressed on the same screen is not the free flight
        expect(freeLessonOf(req, 'rings-first')).toBeNull();
        const spawn = { pos: [1, 2, 3] as [number, number, number], yawDeg: 90 };
        const scan = buildScanLesson(null, { sceneId: '887f27aa', sceneVersion: 1, spawn, src: { collision: () => null, transform: () => ({ s: 3, t: [0, 0, 0] }) } } as never);
        expect(scan.objects).toEqual([]);
        expect(scan.start).toEqual(spawn);
        expect(scan.voxelM).toBeNull();
        expect(scan.track).toBeNull();
        expect(scan.floorY).toBeCloseTo(0.5, 9);
    });

    it('S3: the course the sighted page names (Shift+G, course=g1.<seed>) goes into the sound link under sg=, never course= (review SN-4); a bad course value stays behind', () => {
        vi.stubGlobal('document', { documentElement: { lang: 'en' } });
        const ses = { builtin: null, scene: { id: '887f27aa' }, transform: { s: 1 } };
        const href = modeScanPage(ses, '?scene=887f27aa&course=g1.abc12&x=1');
        expect(href).toBe('/en/fly/?sonic=scan&scene=887f27aa&sz=1&sg=abc12');
        const search = new URL(href, 'https://gsfpv.flyreelstudio.eu').search;
        // the sighted course feature (course.ts tryLink) finds no course on the sound page; the sound page finds its seed
        expect(seedOfLink(search)).toBeNull();
        expect(soundCourseSeed(search)).toBe(parseInt('abc12', 36));
        expect(soundCourseSeed('?sg=evil<x>')).toBeNull();
        expect(soundCourseSeed('?course=g1.abc12')).toBeNull();
        expect(modeScanPage(ses, '?course=evil<script>')).toBe('/en/fly/?sonic=scan&scene=887f27aa&sz=1');
        expect(modeScanPage(ses)).toBe('/en/fly/?sonic=scan&scene=887f27aa&sz=1');
    });
});
