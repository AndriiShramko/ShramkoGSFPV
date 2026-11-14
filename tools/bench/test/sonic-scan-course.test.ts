// Train 2, S3 (docs/wip/sound-any.md; sound2-plan.md 2.1): a course of gates flown by sound in any scan. The free flight over a scan
// (scan-free) becomes a timed course over a generated course (scanCourseLesson), whose world carries the course's path as checkpoints
// (buildScanLesson with course: ScanSonicWorld.setCourse), and the runner's target is gate 1, then gate 2 once gate 1 is passed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { Rig } from './sonic-lesson-rig';
import type { Control, RigScan } from './sonic-lesson-rig';
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

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** A pilot who flies to the runner's target (as sonic-garden.test.ts follow). */
const follow: Control = (r) => {
    const run = r.host.runner;
    if (!run || run.phase !== 'flying') return null;
    const gate = run.target();
    if (!gate) return null;
    const p = r.pos;
    const dx = gate.pos[0] - p[0];
    const dz = gate.pos[2] - p[2];
    const err = wrap((Math.atan2(dx, -dz) * 180) / Math.PI - r.yaw);
    return {
        turn: clamp(err / 30, -1, 1),
        forward: Math.abs(err) > 70 ? 0 : 0.6 * Math.cos((err * Math.PI) / 180) * Math.min(1, Math.hypot(dx, dz) / 4 + 0.3),
        lift: clamp((gate.pos[1] - p[1]) * 0.9, -1, 1)
    };
};

describe('N in a free scan flight, through the page host (S3 pass 2)', () => {
    let rig: Rig | null = null;
    afterEach(() => {
        rig?.dispose();
        rig = null;
        vi.restoreAllMocks();
    });

    it('N asks the page for a course: the course lesson opens, the hum leads to gate 1, then to gate 2 once gate 1 is passed', async () => {
        const track = garden();
        const T = [5, 0, 0, 0] as const;
        // a flat floor at y 0 under the garden's rings at x5 (5 to 7 m up): walls the flight flies, without the scan's own file
        const collision = analyticCollision([-12, -1, -26], [12, 14, 26], 0.25, (_x, y) => y < 0);
        const t = track.start!;
        const scan: RigScan = {
            sceneId: '7a475d38',
            collision,
            sha256: 'flat-floor',
            track,
            transform: T,
            spawn: [T[0] * t.pos[0] + T[1], T[0] * t.pos[1] + T[2], T[0] * t.pos[2] + T[3], t.yawDeg]
        };
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        let asked = 0;
        rig = await Rig.make(free, { scan, course: { key: () => 'N', ask: async () => (asked++, { ok: true, track }) } });
        const r = rig;
        expect(await r.host.openFree(free)).toBe(true);
        const said = (key: string): boolean => r.engine.said.some((s) => s.line.key === key);
        // N during the intro skips the intro (the runner's next); N in the flight asks for the course
        await r.run(60000, null, () => said('sonic.say.courseOffer') && r.host.runner?.phase === 'flying');
        expect(said('sonic.say.courseOffer')).toBe(true);
        expect(r.host.runner?.phase).toBe('flying');
        // the free flight has no target
        await r.run(200);
        expect(r.host.runner?.target() ?? null).toBeNull();
        expect(r.press('scene.next')).toBe(true);
        await r.run(60000, null, () => said('sonic.say.courseReady') && r.host.runner?.phase === 'flying');
        expect(asked).toBe(1);
        expect(said('sonic.say.courseMaking')).toBe(true);
        expect(r.engine.said.find((s) => s.line.key === 'sonic.say.courseReady')?.line.params).toMatchObject({ n: track.gates.length, laps: track.laps, key: 'N' });
        expect(r.host.runner?.phase).toBe('flying');
        const first = track.gates[0]!.id;
        const second = track.gates[1]!.id;
        await r.run(200);
        expect(r.host.runner!.target()?.id).toBe(first);
        expect(r.stage.target).toBe(first);
        await r.run(120000, follow, () => r.of('gate').length > 0);
        expect(r.of('gate').map((g) => g.gateId)).toEqual([first]);
        await r.run(100);
        expect(r.host.runner!.target()?.id).toBe(second);
        expect(r.stage.target).toBe(second);
    }, 120000);

    it('review SN-2/3/6/9: the scan button opens the free flight on its own; a passed course is flown again with no ask and no "last lesson"; nothing is saved; a late answer opens nothing', async () => {
        const track = garden();
        const T = [5, 0, 0, 0] as const;
        const collision = analyticCollision([-12, -1, -26], [12, 14, 26], 0.25, (_x, y) => y < 0);
        const t = track.start!;
        const scan: RigScan = {
            sceneId: '7a475d38',
            collision,
            sha256: 'flat-floor',
            track,
            transform: T,
            spawn: [T[0] * t.pos[0] + T[1], T[0] * t.pos[1] + T[2], T[0] * t.pos[2] + T[3], t.yawDeg]
        };
        const freeOf = (id: string) => (id === SCAN_FREE_ID ? scanFreeLesson('7a475d38', [5, 0, 0, 0]) : null);
        let asked = 0;
        let hold: Promise<void> | null = null;
        rig = await Rig.make(freeOf(SCAN_FREE_ID)!, {
            scan,
            course: {
                key: () => 'N',
                ask: async () => {
                    asked++;
                    if (hold) await hold;
                    return { ok: true, track };
                }
            }
        });
        const r = rig;
        const count = (key: string): number => r.engine.said.filter((s) => s.line.key === key).length;
        // the start screen's press over the flight (feature.ts onStart); before review SN-2 it was host.open(id)
        const fromScreen = (): Promise<boolean> => ('openFromScreen' in r.host ? r.host.openFromScreen(SCAN_FREE_ID, freeOf) : (r.host as { open(id: string): Promise<boolean> }).open(SCAN_FREE_ID));
        // SN-2: the start screen's scan button over a page whose host never opened the free flight
        expect(await fromScreen()).toBe(true);
        expect(r.host.lesson?.id).toBe(SCAN_FREE_ID);
        await r.run(60000, null, () => count('sonic.say.courseOffer') > 0 && r.host.runner?.phase === 'flying');
        expect(r.press('scene.next')).toBe(true);
        await r.run(60000, null, () => count('sonic.say.courseReady') > 0 && r.host.runner?.phase === 'flying');
        expect(asked).toBe(1);
        // SN-3: every gate flown, then no key: the same course again, said ready once more, no second ask, no "last lesson"
        await r.run(900000, follow, () => r.host.runner?.phase === 'passed');
        expect(r.host.runner?.phase).toBe('passed');
        await r.run(60000, null, () => count('sonic.say.courseReady') > 1 || asked > 1);
        await r.run(5000);
        expect(asked).toBe(1);
        expect(count('sonic.say.courseMaking')).toBe(1);
        expect(count('fly.last-lesson')).toBe(0);
        expect(count('sonic.say.courseReady')).toBe(2);
        expect(r.host.lesson && isScanCourse(r.host.lesson)).toBe(true);
        expect(r.host.runner?.phase).not.toBe('passed');
        // SN-6: the free flight and its courses keep no progress (one best time for every course in every scan before)
        const saved = (r.store.collection('sonic') as { progress?: Record<string, unknown> }).progress ?? {};
        expect(saved[SCAN_FREE_ID]).toBeUndefined();
        // SN-2: after a course the scan button flies freely again, not the course kept in memory
        expect(await fromScreen()).toBe(true);
        expect(isScanCourse(r.host.lesson!)).toBe(false);
        // SN-9: N, then the scan button while the worker runs: the late answer opens no course over the new flight
        const offers = count('sonic.say.courseOffer');
        await r.run(60000, null, () => count('sonic.say.courseOffer') > offers && r.host.runner?.phase === 'flying');
        let release = (): void => undefined;
        hold = new Promise<void>((res) => (release = res));
        expect(r.press('scene.next')).toBe(true);
        await r.run(500, null, () => asked > 1);
        expect(asked).toBe(2);
        expect(await fromScreen()).toBe(true);
        release();
        await r.run(2000);
        expect(isScanCourse(r.host.lesson!)).toBe(false);
        expect(count('sonic.say.courseReady')).toBe(2);
    }, 300000);
});
