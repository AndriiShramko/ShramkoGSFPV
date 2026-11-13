// Lane tracks, train 2, stage T2-editor-core: track format version 2 (tracks-plan 2.6). Version 1 still reads; a version 2
// file without its format is refused; a fork keeps the origin and names who edited it, and loses neither (controls inside).
import { describe, expect, it } from 'vitest';
import { validateTrack, writeTrack } from '@shramko/sonic-fpv';
import type { TrackFile } from '@shramko/sonic-fpv';
import { TRACK_FORMAT_V1, TRACK_FORMAT_V2, asSaved, courseDigest, generateCourse, freeSpace, readCourse, toTrackV1, upgradeTrack, validateCourse, writeCourse } from '../src';
import type { Course } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const CREATED = '2026-11-13T00:00:00.000Z';
const v1 = (over: Partial<Record<keyof TrackFile, unknown>> = {}): TrackFile =>
    ({
        format: TRACK_FORMAT_V1, id: '0000aaaa-00000001', version: 1, parent: null, title: 'Course x',
        scene: { kind: 'scan', id: '0000aaaa', version: 1 }, transform: [1, 0, 0, 0],
        gates: [{ id: 'g1', shape: { kind: 'ring', diameter: 1.2, tube: 0.08 }, pos: [3, 2, 5], quat: [1, 0, 0, 0], direction: 'forward' }],
        laps: 1, start: { pos: [3, 2, 8], yawDeg: 0 }, author: { kind: 'generator', name: 'gsfpv-course' },
        generator: { name: 'gsfpv-course', version: '1', seed: 1, params: {} }, created: CREATED, ...over
    }) as unknown as TrackFile;
const plain = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));

describe('track format version 2', () => {
    it('reads version 1 and upgrades it without marks; writes it back down unchanged', () => {
        const r = readCourse(JSON.stringify(v1()));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.format).toBe(TRACK_FORMAT_V2);
        expect(r.value.origin).toBeNull();
        expect(r.value.editedBy).toBeNull();
        expect(r.value.objects).toEqual([]);
        expect(validateCourse(plain(r.value)).ok).toBe(true);
        expect(writeTrack(toTrackV1(r.value))).toBe(writeTrack(v1()));
    });

    it('a version 2 file round-trips through its canonical text', () => {
        const c = upgradeTrack(v1());
        const back = readCourse(writeCourse(c));
        expect(back.ok).toBe(true);
        if (back.ok) expect(courseDigest(back.value)).toBe(courseDigest(c));
    });

    it('refuses a version 2 file without its format (control: the same file with it passes)', () => {
        const c = plain(upgradeTrack(v1())) as Record<string, unknown>;
        expect(validateCourse(c).ok).toBe(true);
        delete c.format;
        expect(validateCourse(c).ok).toBe(false);
        expect(readCourse(c).ok).toBe(false);
    });

    it('refuses an unknown key and an object that claims an order', () => {
        const c = plain(upgradeTrack(v1())) as Record<string, unknown>;
        expect(validateCourse({ ...c, extra: 1 }).ok).toBe(false);
        const obj = { id: 'p1', shape: { kind: 'pillar', radius: 0.2, height: 3 }, pos: [5, 0, 5], quat: [1, 0, 0, 0], order: null };
        expect(validateCourse({ ...c, objects: [obj] }).ok).toBe(true);
        expect(validateCourse({ ...c, objects: [{ ...obj, order: 1 }] }).ok).toBe(false);
        expect(validateCourse({ ...c, objects: [{ ...obj, id: 'g1' }] }).ok).toBe(false);
    });

    it('a fork keeps the origin and names who edited it; losing the origin is refused (control)', () => {
        const base = upgradeTrack(v1());
        const pilot = { kind: 'person' as const, name: 'Ola' };
        const fork = asSaved(base, base, pilot, { kind: 'fork', id: '0000aaaa-00000002' }, CREATED);
        expect(fork.version).toBe(1);
        expect(fork.parent).toEqual({ id: base.id, version: 1 });
        expect(fork.origin).toEqual({ id: base.id, version: 1, author: base.author });
        expect(fork.editedBy).toEqual(pilot);
        expect(validateCourse(plain(fork)).ok).toBe(true);
        expect(validateCourse({ ...(plain(fork) as object), origin: null }).ok).toBe(false);
        expect(validateCourse({ ...(plain(fork) as object), editedBy: null }).ok).toBe(false);
        // a fork of the fork keeps the first creator
        const fork2 = asSaved(fork, fork, { kind: 'person', name: 'Jan' }, { kind: 'fork', id: '0000aaaa-00000003' }, CREATED);
        expect(fork2.origin).toEqual(fork.origin);
    });

    it('a new version by the admin: version + 1, parent the base, admin kept in version 2 and written as a person in version 1', () => {
        const base = upgradeTrack(v1());
        const admin = { kind: 'admin' as const, name: 'admin' };
        const next = asSaved(base, base, admin, { kind: 'version' }, CREATED);
        expect(next.version).toBe(2);
        expect(next.parent).toEqual({ id: base.id, version: 1 });
        expect(validateCourse(plain(next)).ok).toBe(true);
        expect(toTrackV1(next).author.kind).toBe('person');
        expect(validateTrack(plain(toTrackV1(next))).ok).toBe(true);
    });

    it('a version 1 fork upgrades with the marks of the server, else the best the file says', () => {
        const fork = v1({ id: '0000aaaa-00000002', parent: { id: '0000aaaa-00000001', version: 3 }, author: { kind: 'person', name: 'Ola' }, generator: null });
        const best = upgradeTrack(fork);
        expect(best.origin).toEqual({ id: '0000aaaa-00000001', version: 3, author: null });
        expect(best.editedBy).toEqual({ kind: 'person', name: 'Ola' });
        expect(validateCourse(plain(best)).ok).toBe(true);
        const marks = { origin: { id: '0000aaaa-00000001', version: 1, author: { kind: 'generator' as const, name: 'gsfpv-course' } }, editedBy: { kind: 'person' as const, name: 'Ola' } };
        expect(upgradeTrack(fork, marks).origin).toEqual(marks.origin);
    });

    it('the generator\'s course is a valid version 2 course', () => {
        const walls = threeRooms();
        const t = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 7, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: CREATED });
        const c: Course = upgradeTrack(t);
        expect(validateCourse(plain(c)).ok).toBe(true);
        expect(writeTrack(toTrackV1(c))).toBe(writeTrack(t));
    });
});
