// Train 2, S3 (docs/wip/sound-any.md; sound2-plan.md 2.1): a course of gates flown by sound in any scan. The free flight over a scan
// (scan-free) becomes a timed course over a generated course (scanCourseLesson), whose world carries the course's path as checkpoints
// (buildScanLesson with course: ScanSonicWorld.setCourse), and the runner's target is gate 1, then gate 2 once gate 1 is passed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticCollision } from '../../../packages/collision/src';
import { Rig, SharedCourse } from './sonic-lesson-rig';
import { KEY_HELP } from '../../../apps/fly/src/sonic/mode-keys';
import { spokenKey } from '../../../apps/fly/src/sonic/key-names';
import type { Control, RigScan } from './sonic-lesson-rig';
import { parseTrack, scanFreeLesson, validateLesson, SCAN_FREE_ID } from '../../../packages/sonic-fpv/src';
import type { SonicObject, TrackFile } from '../../../packages/sonic-fpv/src';
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
        // sonic3 S1: the hum of a gate leads through it from the entry side (package layers.gateAim)
        expect(course.layers.gateAim).toBe(true);
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

    it('waits through the worker\'s progress messages for the course (sonic3 S1: they ended the ask as failed)', () => {
        expect(courseAnswer({ t: 'progress', job: 4, step: 'free', estMs: 900 }, 4)).toBeNull();
        expect(courseAnswer({ t: 'progress', job: 4, step: 'lay', estMs: 1500 }, 4)).toBeNull();
    });

    it('a course by sound is one lap of the generated course (sonic3 S1 pass 3: 24 gates x 3 laps did not fit in 300 s)', () => {
        const track = { ...garden(), laps: 3 };
        const a = courseAnswer({ t: 'track', job: 5, track } as unknown as Parameters<typeof courseAnswer>[0], 5);
        expect(a?.ok).toBe(true);
        expect(a?.ok ? a.track.laps : -1).toBe(1);
        expect(a?.ok ? a.track.gates.length : -1).toBe(track.gates.length);
        // the generator's own track is not changed
        expect(track.laps).toBe(3);
    });
});

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** The next gate of the course in the scene (the course feature's count), what the hum leads to in the free flight. */
function sharedNext(r: Rig): SonicObject | null {
    const c = r.shared?.inUse() ?? null;
    return c && c.next >= 0 ? (c.gates[c.next] ?? null) : null;
}

/** A pilot who flies to the target the stage shows (the runner's, else the course's next gate; as sonic-garden.test.ts follow). */
const follow: Control = (r) => {
    const run = r.host.runner;
    if (!run || run.phase !== 'flying') return null;
    const gate = run.target() ?? sharedNext(r);
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

describe('one course in the scene, the course feature\'s, in Fly by Sound too (lane onecourse, the owner\'s message 52)', () => {
    let rig: Rig | null = null;
    afterEach(() => {
        rig?.dispose();
        rig = null;
        vi.restoreAllMocks();
    });

    async function start(o: { before?: boolean; key?: string } = {}): Promise<{ r: Rig; shared: SharedCourse; count: (k: string) => number }> {
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
        const shared = new SharedCourse(() => track, { s: T[0], t: [T[1], T[2], T[3]] }, o.key);
        // Shift+G in the ordinary flight before Fly by Sound is switched on
        if (o.before) shared.generate();
        const free = scanFreeLesson('7a475d38', [5, 0, 0, 0]);
        const r = await Rig.make(free, { scan, course: shared });
        rig = r;
        expect(await r.host.openFree(free)).toBe(true);
        const count = (k: string): number => r.engine.said.filter((s) => s.line.key === k).length;
        return { r, shared, count };
    }

    const nextId = (r: Rig): string | null => sharedNext(r)?.id ?? null;

    it('a course in the scene before the switch-on is the one flown: no offer, no course of its own, the hum leads to its next gate', async () => {
        const { r, shared, count } = await start({ before: true });
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(200);
        expect(count('sonic.say.courseOffer')).toBe(0);
        expect(count('sonic.say.courseMaking')).toBe(0);
        expect(shared.made).toBe(1);
        expect(r.host.lesson && isScanCourse(r.host.lesson)).toBe(false);
        // the old design: the runner held a course of its own; now the target is the scene's course's gate 1
        expect(r.host.runner?.target() ?? null).toBeNull();
        expect(r.stage.target).toBe(shared.inUse()!.gates[0]!.id);
        // the course feature counts gate 1; the hum goes on to gate 2
        await r.run(120000, follow, () => (shared.inUse()?.next ?? 0) >= 1);
        expect(shared.inUse()!.next).toBe(1);
        await r.run(100);
        expect(r.stage.target).toBe(nextId(r));
        expect(r.stage.target).toBe(shared.inUse()!.gates[1]!.id);
    }, 120000);

    it('the progress is kept over the switch off and on: gate 2 stays gate 2, no new course', async () => {
        const { r, shared } = await start({ before: true });
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(120000, follow, () => (shared.inUse()?.next ?? 0) >= 1);
        const run = shared.run;
        r.mode.leave();
        await r.run(200);
        expect(shared.run).toBe(run);
        expect(shared.inUse()!.next).toBe(1);
        expect(await r.host.openFree(scanFreeLesson('7a475d38', [5, 0, 0, 0]), { here: true })).toBe(true);
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(200);
        expect(shared.made).toBe(1);
        expect(shared.inUse()!.next).toBe(1);
        expect(r.stage.target).toBe(shared.inUse()!.gates[1]!.id);
    }, 120000);

    it('N in the sound mode is Shift+G\'s action: the course in the scene is replaced, the hum leads to gate 1 of the new one', async () => {
        const { r, shared, count } = await start({ before: true });
        await r.run(60000, null, () => r.host.runner?.phase === 'flying');
        await r.run(120000, follow, () => (shared.inUse()?.next ?? 0) >= 1);
        const old = shared.run;
        expect(r.press('scene.next')).toBe(true);
        await r.run(300);
        expect(shared.made).toBe(2);
        expect(shared.run).not.toBe(old);
        expect(shared.inUse()!.next).toBe(0);
        expect(r.stage.target).toBe(shared.inUse()!.gates[0]!.id);
        // one course: the sound mode opened no course lesson of its own and said no making of one
        expect(r.host.lesson && isScanCourse(r.host.lesson)).toBe(false);
        expect(count('sonic.say.courseMaking')).toBe(0);
        expect(count('sonic.say.courseReady')).toBe(0);
    }, 120000);

    it('no course in the scene: one line names Shift+G, the flight is free, nothing is made by itself', async () => {
        const { r, shared, count } = await start();
        await r.run(60000, null, () => count('sonic.say.courseOffer') > 0 && r.host.runner?.phase === 'flying');
        await r.run(5000);
        expect(count('sonic.say.courseOffer')).toBe(1);
        expect(r.engine.said.find((s) => s.line.key === 'sonic.say.courseOffer')?.line.params).toMatchObject({ key: 'Shift+G' });
        expect(shared.made).toBe(0);
        expect(r.stage.target).toBeNull();
    }, 120000);

    it('the key help names Shift+G for a course, said with the letter last ("Shift and key G"); no course line names N', () => {
        const help = KEY_HELP.find(([line]) => line === 'sonic.say.helpCourse');
        expect(help?.[1]).toBe('course.generate');
        const named = (code: string): string | null => (code === 'ChordJoin' ? 'and key' : null);
        expect(spokenKey({ cap: 'Shift+G', aria: 'Shift+G' } as never, null, named)).toBe('Shift and key G');
        for (const loc of ['en', 'es', 'pl', 'ru']) {
            const dict = JSON.parse(readFileSync(join(REPO, `packages/i18n/locales/fly/sonic/${loc}.json`), 'utf8')) as Record<string, string>;
            for (const k of ['sonic.say.courseOffer', 'sonic.say.helpCourse', 'sonic.say.inPlaceIntro']) expect(dict[k], `${loc} ${k}`).not.toMatch(/(^|[^\p{L}])N([^\p{L}]|$)/u);
            expect(dict['sonic.key.ChordJoin'], loc).toBeTruthy();
        }
    });
});

