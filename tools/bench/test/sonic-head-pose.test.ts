// Lane head4, stage H1: the head pose math of Fly by Sound's head tracking (apps/fly/src/sonic/head). A voice keeps its
// place in the world while the head turns; the filter centres, clamps, holds and glides back a lost face.
import { describe, expect, it } from 'vitest';
import { pannerDirection } from '../../../packages/sonic-fpv/src/cues/rules';
import { HeadPoseFilter, LOST_GLIDE_MS, LOST_HOLD_MS } from '../../../apps/fly/src/sonic/head/filter';
import { ListenerTurn, type ListenerLike, type ParamLike } from '../../../apps/fly/src/sonic/head/listener-turn';
import { bearingDeg, headAxes, headDirection, poseFromFaceMatrix, POSE_LIMIT_DEG, type HeadPose, type Vec3 } from '../../../apps/fly/src/sonic/head/pose';

const DEG = Math.PI / 180;
const yawOnly = (yawDeg: number): HeadPose => ({ yawDeg, pitchDeg: 0, rollDeg: 0 });
const atBearing = (deg: number): Vec3 => [Math.sin(deg * DEG), 0, -Math.cos(deg * DEG)];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The ear's view of a panner, as the Web Audio spec computes it: the source position in the listener's own axes. */
function heardBy(listener: { forward: Vec3; up: Vec3 }, pos: Vec3): Vec3 {
    const f = listener.forward, u = listener.up;
    const r: Vec3 = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    return [dot(pos, r), dot(pos, u), -dot(pos, f)];
}

class FakeParam implements ParamLike {
    value = 0;
    setTargetAtTime(target: number): void {
        this.value = target;
    }
    cancelScheduledValues(): void {}
}

function fakeListener(): ListenerLike & { read(): { forward: Vec3; up: Vec3 } } {
    const p = { forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(), upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam() };
    p.forwardZ.value = -1;
    p.upY.value = 1;
    return { ...p, read: () => ({ forward: [p.forwardX.value, p.forwardY.value, p.forwardZ.value], up: [p.upX.value, p.upY.value, p.upZ.value] }) };
}

describe('head pose: a voice stays in the world while the head turns', () => {
    it('a cue at bearing 30 is heard straight ahead with the head turned 30 to the right, at 30 with the head straight', () => {
        const panner = pannerDirection(atBearing(30));
        const l = fakeListener();
        const turn = new ListenerTurn(l);
        expect(bearingDeg(heardBy(l.read(), panner))).toBeCloseTo(30, 6);
        turn.apply(yawOnly(30), 0);
        expect(bearingDeg(heardBy(l.read(), panner))).toBeCloseTo(0, 6);
        expect(bearingDeg(headDirection(yawOnly(30), panner))).toBeCloseTo(0, 6);
        turn.apply(yawOnly(-30), 0);
        expect(bearingDeg(heardBy(l.read(), panner))).toBeCloseTo(60, 6);
        turn.release(0);
        expect(bearingDeg(heardBy(l.read(), panner))).toBeCloseTo(30, 6);
    });

    it('a sound ahead rises in the ears when the head tips down; a sound on the right rises when the right ear goes down', () => {
        expect(headDirection({ yawDeg: 0, pitchDeg: -20, rollDeg: 0 }, [0, 0, -1])[1]).toBeCloseTo(Math.sin(20 * DEG), 6);
        // right ear down: the ear line points down to the right, so a level sound on the right is above it
        expect(headDirection({ yawDeg: 0, pitchDeg: 0, rollDeg: 20 }, [1, 0, 0])[1]).toBeCloseTo(Math.sin(20 * DEG), 6);
    });

    it("the head's axes stay orthonormal and right-handed at any pose", () => {
        for (const p of [{ yawDeg: 33, pitchDeg: -12, rollDeg: 7 }, { yawDeg: -80, pitchDeg: 40, rollDeg: -25 }]) {
            const a = headAxes(p);
            expect(dot(a.forward, a.forward)).toBeCloseTo(1, 9);
            expect(dot(a.up, a.up)).toBeCloseTo(1, 9);
            expect(dot(a.forward, a.up)).toBeCloseTo(0, 9);
            expect(dot(a.right, a.up)).toBeCloseTo(0, 9);
            // right x up = back = -forward
            const r = a.right, u = a.up;
            const back: Vec3 = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
            expect(dot(back, a.forward)).toBeCloseTo(-1, 9);
        }
    });

    it('reads the yaw of a face turned to the pilot right from the facial transformation matrix', () => {
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -40, 1];
        const zero = poseFromFaceMatrix(identity);
        expect(Math.abs(zero.yawDeg) + Math.abs(zero.pitchDeg) + Math.abs(zero.rollDeg)).toBeLessThan(1e-9);
        // nose toward camera -x (the pilot's right in an unmirrored picture), 20 degrees
        const s = Math.sin(20 * DEG), c = Math.cos(20 * DEG);
        const right = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, -40, 1];
        expect(poseFromFaceMatrix(right).yawDeg).toBeCloseTo(20, 6);
    });
});

describe('head pose filter', () => {
    it('takes the first face as straight ahead and the recentred face as the new centre', () => {
        const f = new HeadPoseFilter();
        const first = f.step(yawOnly(12), 0);
        expect(first.event).toBe('centred');
        expect(first.pose.yawDeg).toBeCloseTo(0, 9);
        let t = 0;
        for (let i = 0; i < 60; i++) f.step(yawOnly(42), (t += 33));
        expect(f.pose.yawDeg).toBeCloseTo(30, 1);
        f.recentre();
        expect(f.step(yawOnly(42), (t += 33)).event).toBe('centred');
        for (let i = 0; i < 60; i++) f.step(yawOnly(42), (t += 33));
        expect(Math.abs(f.pose.yawDeg)).toBeLessThan(0.5);
    });

    it('clamps a turn past the limit', () => {
        const f = new HeadPoseFilter();
        f.step(yawOnly(0), 0);
        for (let t = 33; t < 4000; t += 33) f.step(yawOnly(80), t);
        expect(f.pose.yawDeg).toBeCloseTo(POSE_LIMIT_DEG.yawDeg, 1);
    });

    it('holds a lost face, glides back to straight ahead, says it once, and returns without a jump', () => {
        const f = new HeadPoseFilter();
        let t = 0;
        f.step(yawOnly(0), t);
        for (let i = 0; i < 90; i++) f.step(yawOnly(20), (t += 33));
        const held = f.pose.yawDeg;
        expect(held).toBeGreaterThan(19);
        const lostAt = t;
        const events: string[] = [];
        for (let dt = 33; dt <= LOST_HOLD_MS; dt += 33) {
            const s = f.step(null, lostAt + dt);
            events.push(s.event);
            expect(s.pose.yawDeg).toBe(held);
        }
        const steps = [];
        for (let dt = LOST_HOLD_MS + 33; dt <= LOST_HOLD_MS + LOST_GLIDE_MS + 100; dt += 33) steps.push(f.tick(lostAt + dt));
        expect(steps.map((s) => s.event).filter((e) => e === 'lost')).toHaveLength(1);
        expect(events.every((e) => e === 'none')).toBe(true);
        expect(steps[0]?.pose.yawDeg).toBeLessThan(held);
        expect(steps[0]?.pose.yawDeg).toBeGreaterThan(0);
        expect(f.pose.yawDeg).toBe(0);
        t = lostAt + LOST_HOLD_MS + LOST_GLIDE_MS + 200;
        const back = f.step(yawOnly(20), t);
        expect(back.event).toBe('found');
        expect(back.pose.yawDeg).toBeLessThan(10);
        for (let i = 0; i < 90; i++) f.step(yawOnly(20), (t += 33));
        expect(f.pose.yawDeg).toBeCloseTo(20, 1);
    });
});
