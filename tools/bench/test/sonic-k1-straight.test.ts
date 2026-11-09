// v13-int review K1 (docs/wip/v13-int-review.md "Fixes"): a flight dead ahead at a wall replays as it was flown. The page proof
// sonic-v13-page F2 flew rings-first with W alone at its front wall (the craft at x 0 to the millimetre), recorded it and replayed it:
// 0 events different but 83.7 % of the sounds by cue id, verdict FAIL (evidence/2026-11-09/sonic-v13-page-f2-straight.json): for 28
// frames the live engine voiced 'safety.wall:front-right' and the replay's planner 'safety.wall:front-left'. The two front-side
// sectors tie on the wall's axis; a yaw under what a recording keeps (the quaternion to 1e-4) broke the tie one way live, the replay of
// the rounded frame saw it exact and broke it by the order of the sectors. The sound package (s13-int c819995) now makes two mirror
// sectors within its MIRROR_DEAD_BAND one tie, live and in the replay alike.
//
// Here the lesson rig (the real flight model, lesson pilot, mode, bridge, host and the package's runner and planner; the engine a fake
// that plans with the package's CuePlanner at the page's 60 Hz) flies the same: rings-first, the task skipped with N, W held from the
// attempt's start with the nose turned by a yaw the recording rounds away. The frames are kept as the recorder keeps them (its
// FrameSampler, 30 Hz) and as the file holds them (the package's roundFrame), and the package's checkSession replays them. Control: the
// rule before the fix (the sampler's dead band 0, live and in the replay): the replay differs by cue id and reads FAIL.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S } from '../../../packages/sim-core/src';
import { DEFAULT_SAMPLER_CONFIG, MIRROR_DEAD_BAND, buildManifest, checkSession, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { FlightFrame } from '../../../packages/sonic-fpv/src';
import { roundFrame } from '../../../packages/sonic-fpv/src/session/codec';
import { FrameSampler } from '../../../apps/fly/src/sonic-session/frames';
import { Rig } from './sonic-lesson-rig';
import type { Control } from './sonic-lesson-rig';

let rig: Rig | null = null;
afterEach(() => {
    rig?.dispose();
    rig = null;
    vi.restoreAllMocks();
});

const manifestOf = (r: Rig, id: string): ReturnType<typeof buildManifest> =>
    buildManifest({
        id,
        created: '2026-11-09T10:00:00Z',
        app: { name: 'ShramkoGSFPV', release: 'test', sonic: 'test' },
        scene: { kind: 'analytic', id: r.world.id, version: r.world.version, transform: [1, 0, 0, 0] },
        lesson: { id: 'rings-first', version: getLesson('rings-first').version, path: 'full' },
        theme: { id: 'soft', version: getBuiltinTheme('soft').version },
        settings: defaultPrefs(),
        assists: getLesson('rings-first').assists,
        device: { userAgent: 'vitest', locale: 'en', audio: { sampleRate: 48000, baseLatencyMs: null, outputLatencyMs: null }, input: 'keyboard', inputName: null, headphones: 'wired', gpu: null },
        consent: { recording: true, voice: false, send: false, speechRecognition: false, minor: false, guardianConfirmed: null, at: '2026-11-09T10:00:00Z' },
        pilot: { id: 'testPilot01', nickname: null },
        clock: { startIso: '2026-11-09T10:00:00Z', frameHz: 30 }
    });

/** A yaw a recording keeps as none, rad: the quaternion's y 5e-6, rounded to 0 (the file keeps it to 1e-4). To the right (negative). */
const UNDER_ROUNDING_RAD = -1e-5;

/**
 * rings-first flown straight at its front wall: N skips the task, W from the attempt's start with the nose turned by `yawRad` (the sim's
 * quaternion, once), the frames kept as the recorder and the file keep them. Returns the frames, the replay's check and the side voiced.
 */
async function straight(yawRad: number): Promise<{ frames: FlightFrame[]; check: ReturnType<typeof checkSession>['check']; liveSides: string[]; replaySides: string[] }> {
    rig = await Rig.make(getLesson('rings-first'));
    const r = rig;
    expect(await r.host.open('rings-first')).toBe(true);
    const sampler = new FrameSampler();
    const frames: FlightFrame[] = [];
    let flying = 0;
    const control: Control = (rr) => {
        const s = rr.last;
        if (s && rr.engine.lastInput && !s.paused) {
            const f = sampler.take(s, s.t, rr.engine.activeCues().map((c) => c.id));
            if (f) frames.push(roundFrame(f));
        }
        if (rr.host.runner?.phase !== 'flying') return null;
        if (++flying === 1 && yawRad !== 0) {
            // the nose turned about the world's up by yawRad (q_yaw * q)
            const st = rr.session.sim.s;
            const c = Math.cos(yawRad / 2);
            const sn = Math.sin(yawRad / 2);
            const [w, x, y, z] = [st[S.qw], st[S.qx], st[S.qy], st[S.qz]];
            st[S.qw] = c * w - sn * y;
            st[S.qx] = c * x + sn * z;
            st[S.qy] = c * y + sn * w;
            st[S.qz] = c * z - sn * x;
        }
        return { forward: 1 };
    };
    await r.run(1200, control);
    r.press('scene.next');
    await r.run(20000, control, () => r.lessonEvents('attempt-pass').length + r.lessonEvents('attempt-fail').length >= 1);
    await r.run(6000, control);
    const { check, result } = checkSession({ manifest: manifestOf(r, 'k1Straight00000001'), frames, events: r.sonic });
    const sides = (lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flatMap((c) => c.filter((id) => id === 'safety.wall:front-left' || id === 'safety.wall:front-right')))].sort();
    return { frames, check, liveSides: sides(frames.map((f) => f.c)), replaySides: sides(result.cues) };
}

describe('v13-int review K1: a flight dead ahead at a wall replays as it was flown', () => {
    it('rings-first, W alone at the front wall with a yaw the recording rounds away: the replay agrees, every event and 100 % of the sounds by id, the verdict pass; the front-left sector voiced live and in the replay', async () => {
        expect(DEFAULT_SAMPLER_CONFIG.mirrorDeadBand).toBe(MIRROR_DEAD_BAND);
        const s = await straight(UNDER_ROUNDING_RAD);
        // while the wall's front side sounds the craft is on the room's axis to the millimetre, its nose within the recording's rounding (the
        // quaternion's y 0 or one step, 1e-4: the craft's own controllers set the nose wobbling by up to 1e-3 rad after the turn, then settle)
        const atWall = s.frames.filter((f) => f.c.some((id) => id.startsWith('safety.wall:front-')));
        expect(atWall.length).toBeGreaterThan(20);
        expect(atWall.filter((f) => Math.abs(f.p[0]) > 0.001 || Math.abs(f.q[2]) > 0.0001).map((f) => [f.t, f.p[0], f.q[2]])).toEqual([]);
        expect(s.check.events.diffs).toEqual([]);
        expect(s.check.cues.share).toBe(1);
        expect(s.check.verdict).toBe('pass');
        expect(s.liveSides).toEqual(['safety.wall:front-left']);
        expect(s.replaySides).toEqual(['safety.wall:front-left']);
    }, 120000);

    it('control, the sampler\'s rule before the fix (no dead band, live and in the replay): front-right live, front-left in the replay, under 95 % by id and 100 % by kind, the verdict fail', async () => {
        const band = DEFAULT_SAMPLER_CONFIG.mirrorDeadBand;
        (DEFAULT_SAMPLER_CONFIG as { mirrorDeadBand: number }).mirrorDeadBand = 0;
        try {
            const s = await straight(UNDER_ROUNDING_RAD);
            expect(s.check.events.diffs).toEqual([]);
            expect(s.liveSides).toEqual(['safety.wall:front-right']);
            expect(s.replaySides).toEqual(['safety.wall:front-left']);
            // measured: 89.2 % of the frames by id (the page: 83.7 % of 172), 100 % by kind
            expect(s.check.cues.share).toBeLessThan(0.95);
            expect(s.check.cues.classShare).toBe(1);
            expect(s.check.verdict).toBe('fail');
        } finally {
            (DEFAULT_SAMPLER_CONFIG as { mirrorDeadBand: number }).mirrorDeadBand = band;
        }
    }, 120000);

    it('the same flight with the yaw to the left, or none, agreed before the fix too (the order of the sectors breaks the replay\'s tie to the left): it still does', async () => {
        for (const yaw of [-UNDER_ROUNDING_RAD, 0]) {
            const s = await straight(yaw);
            expect(s.check.cues.share, `yaw ${yaw}`).toBe(1);
            expect(s.liveSides, `yaw ${yaw}`).toEqual(['safety.wall:front-left']);
            rig?.dispose();
            rig = null;
        }
    }, 240000);
});
