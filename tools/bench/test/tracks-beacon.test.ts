// Lane tracks T2: a generated course gives the sound beacon its points. ScanSonicWorld (apps/fly/src/sonic/scan-world.ts)
// with a course has a `checkpoints` getter fed from coursePath, so the sound package's lessonTrack takes the world's list
// (kind 'world'). Control: the same world without a course answers the lesson's own gates (kind 'gates').
import { describe, expect, it } from 'vitest';
import { lessonTrack, trackToObjects, worldCheckpoints } from '../../../packages/sonic-fpv/src';
import type { Goal, Pose } from '../../../packages/sonic-fpv/src';
import { coursePath, freeSpace, generateCourse } from '@gsfpv/tracks';
import { ScanSonicWorld } from '../../../apps/fly/src/sonic/scan-world';
import { IDENTITY, SPAWN_A, threeRooms } from '../../../packages/tracks/test/worlds';

describe('ScanSonicWorld.checkpoints (the beacon on a generated course)', () => {
    const walls = threeRooms();
    const track = generateCourse(freeSpace(walls, { spawn: SPAWN_A }), walls, { seed: 11, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
    // the flown size: twice the scan, moved
    const src = { collision: () => walls, transform: () => ({ s: 2, t: [1, 0, -3] }) };
    const lesson = { goals: [{ kind: 'timed-course', laps: track.laps } as Goal], checkpoints: [] };
    const start: Pose = { pos: [SPAWN_A[0] * 2 + 1, SPAWN_A[1] * 2, SPAWN_A[2] * 2 - 3], yawDeg: 0 };
    const objects = trackToObjects(track, { transform: [2, 1, 0, -3] });

    it('with a course, lessonTrack takes the world\'s points (kind world), at the flown size', () => {
        expect(track.gates.length).toBeGreaterThanOrEqual(3);
        const world = new ScanSonicWorld('0000aaaa', 1, src, track, { course: track });
        const lt = lessonTrack(lesson, world, objects, start);
        expect(lt?.source).toBe('world');
        const pts = worldCheckpoints(world)!;
        const want = coursePath(track, [2, 1, 0, -3]);
        expect(pts.length).toBe(want.length);
        expect(pts[0]!.pos).toEqual(want[0]!.pos);
        expect(pts.filter((p) => p.stage !== undefined).length).toBe(track.gates.length);
    });

    it('control: without a course the same world gives the lesson its gates (kind gates)', () => {
        const world = new ScanSonicWorld('0000aaaa', 1, src, track);
        expect(lessonTrack(lesson, world, objects, start)?.source).toBe('gates');
        world.setCourse(track);
        expect(lessonTrack(lesson, world, objects, start)?.source).toBe('world');
    });
});
