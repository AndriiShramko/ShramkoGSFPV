// Train 2, S3 (docs/wip/sound-any.md; sound2-plan.md 2.1): a course of gates flown by sound in any scan. The free flight over a scan
// (scan-free) becomes a timed course over a generated course (scanCourseLesson), whose world carries the course's path as checkpoints
// (buildScanLesson with course: ScanSonicWorld.setCourse), and the runner's target is gate 1, then gate 2 once gate 1 is passed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTrack, scanFreeLesson, validateLesson, SCAN_FREE_ID } from '../../../packages/sonic-fpv/src';
import type { TrackFile } from '../../../packages/sonic-fpv/src';
import { buildScanLesson, isScanCourse, scanCourseLesson } from '../../../apps/fly/src/sonic/scan-lesson';
import { courseAnswer, courseJob } from '../../../apps/fly/src/sonic/course-ask';
import { REPO } from '../src/evidence';

function garden(): TrackFile {
    const r = parseTrack(readFileSync(join(REPO, 'apps/fly/public/sonic/tracks/7a475d38-rings-v1.json'), 'utf8'));
    if (!r.ok) throw new Error('fixture track');
    return r.value;
}

const view = (s: number) => ({
    sceneId: '7a475d38',
    sceneVersion: 1,
    spawn: { pos: [0, 1.5, 0] as [number, number, number], yawDeg: 0 },
    src: { collision: () => null, transform: () => ({ s, t: [0, 0, 0] }) }
});

describe('a course of gates in a free scan flight (S3)', () => {
    it('turns the free flight into a timed course over the track: target layer, the track named, a valid lesson', () => {
        const track = garden();
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        const course = scanCourseLesson(free, track);
        expect(course.id).toBe(SCAN_FREE_ID);
        expect(course.goals).toEqual([{ kind: 'timed-course', laps: track.laps }]);
        expect(course.layers.on).toContain('target');
        expect(course.world).toMatchObject({ kind: 'scan', sceneId: '7a475d38', track: { id: track.id, version: track.version } });
        expect(isScanCourse(course)).toBe(true);
        expect(isScanCourse(free)).toBe(false);
        // the free flight's "no rings and no clock" line is not said over a course
        expect(course.intro.map((l) => l.key)).not.toContain('lesson.scan-free.intro.1');
        // the validator finds nothing in the course that it does not find in the free flight it was made from (a validated lesson
        // carries normalised keys such as pass.blocks, which a second validation reads as unknown)
        const issues = (l: unknown): string[] => {
            const v = validateLesson(JSON.parse(JSON.stringify(l)));
            return v.ok ? [] : v.issues.map((i) => `${i.path}: ${i.message}`);
        };
        expect(issues(course)).toEqual(issues(free));
        expect(() => scanCourseLesson(scanFreeLesson('other', [5, 0, 0, 0]), track)).toThrow();
    });

    it('the course world carries the course path as checkpoints; a lesson track without course does not', () => {
        const track = garden();
        const withCourse = buildScanLesson(track, view(5), { course: true });
        const points = withCourse.world.checkpoints;
        expect(points?.length ?? 0).toBeGreaterThanOrEqual(track.gates.length);
        expect(buildScanLesson(track, view(5)).world.checkpoints).toBeUndefined();
        expect(buildScanLesson(null, view(5), { course: true }).world.checkpoints).toBeUndefined();
    });

    it('builds the worker job from the flown walls, and reads only its own answer', () => {
        expect(courseJob({ collision: null, spawn: [0, 0, 0], scene: { id: 'a', version: 1 }, transform: { s: 1, t: [0, 0, 0] } }, 7, 1, 'x')).toBeNull();
        const col = { flipXY: false, gridMinX: 0, gridMinY: 0, gridMinZ: 0, voxelResolution: 0.1, numVoxelsX: 2, numVoxelsY: 2, numVoxelsZ: 2, leafSize: 4, treeDepth: 1, nodes: new Uint32Array(3), leafData: new Uint32Array(2) };
        const job = courseJob({ collision: col, spawn: [1, 2, 3, 0], scene: { id: '887f27aa', version: 2 }, transform: { s: 3, t: [0, 1, 0] } }, 7, 4, 'x');
        expect(job).toMatchObject({ t: 'generate', job: 4, seed: 7, spawn: [1, 2, 3], scene: { id: '887f27aa', version: 2 }, transform: [3, 0, 1, 0] });
        expect(job!.nodes).not.toBe(col.nodes);
        const track = garden();
        expect(courseAnswer({ t: 'track', job: 3, track, ms: 1 }, 4)).toBeNull();
        expect(courseAnswer({ t: 'track', job: 4, track, ms: 1 }, 4)).toEqual({ ok: true, track });
        expect(courseAnswer({ t: 'track', job: 4, track: null, ms: 1 }, 4)).toEqual({ ok: false, why: 'none fits' });
        expect(courseAnswer({ t: 'error', job: 4, message: 'x' }, 4)).toEqual({ ok: false, why: 'failed' });
    });
});
