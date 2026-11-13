// Train 1, lane rooms: another pilot's drone drawn between the poses that came in (apps/fly/src/rooms/interp.ts).
// A scripted flight (a 5 m circle at 10 m/s, 20 m/s^2 sideways, climbing and sinking, turning) is sent at 15 Hz the way
// the page sends it (PoseClock on 60 Hz frames), through an uplink and a downlink with jitter (in order, as TCP is) and
// with poses and snapshots left out, and drawn at 60 Hz. The error is the distance of the drawn drone from the true path
// at the time it says it shows. The bounds below are the numbers this test measured (printed as ROOMS-INTERP), with
// room to spare; control: the same flight with no playout buffer (0 ms) exceeds the bound.
import { describe, expect, it } from 'vitest';
import { PLAYOUT_MS, RemoteTrack } from '../../../apps/fly/src/rooms/interp';
import { PoseClock } from '../../../apps/fly/src/rooms/pose';
import type { Pose, Vec3 } from '../../../apps/fly/src/rooms/codec';
import { decodePose, decodeSnapshot, encodePose, encodeSnapshot } from '../../../apps/fly/src/rooms/codec';

const R = 5, W = 2;
const truth = (ms: number): { pos: Vec3; vel: Vec3; yaw: number } => {
    const t = ms / 1000;
    return {
        pos: [R * Math.cos(W * t), 2 + 1.5 * Math.sin(1.3 * t), R * Math.sin(W * t)],
        vel: [-R * W * Math.sin(W * t), 1.5 * 1.3 * Math.cos(1.3 * t), R * W * Math.cos(W * t)],
        yaw: -W * t
    };
};

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Link { baseMs: number; jitterMs: number; drop: number }
interface Run { maxM: number; p99M: number; frames: number; frozen: number }

/** One flight of `durMs` through the two links, drawn with a playout buffer of `playoutMs`. */
function fly(playoutMs: number, up: Link, down: Link, seed = 7, durMs = 20000): Run {
    const rnd = mulberry32(seed);
    const clock = new PoseClock();
    const track = new RemoteTrack({ playoutMs });
    const toServer: { at: number; bytes: Uint8Array }[] = [];
    const toClient: { at: number; bytes: Uint8Array }[] = [];
    let upLast = 0, downLast = 0;
    let newest: Pose | null = null;
    const errs: number[] = [];
    let frozen = 0;
    const frame = 1000 / 60, serverTick = 1000 / 15;
    let nextFrame = 0, nextServer = 23, nextDraw = 5;
    for (let now = 0; now <= durMs; now++) {
        if (now >= nextFrame) {
            nextFrame += frame;
            const seq = clock.due(now);
            if (seq !== null && rnd() >= up.drop) {
                const tr = truth(now);
                const half = tr.yaw / 2;
                const p: Pose = { flags: 1, seq, tick: now, pos: tr.pos, quat: [0, Math.sin(half), 0, Math.cos(half)], vel: tr.vel, throttle: 0.5 };
                upLast = Math.max(upLast, now + up.baseMs + rnd() * up.jitterMs);
                toServer.push({ at: upLast, bytes: encodePose(p) });
            }
        }
        while (toServer.length && toServer[0].at <= now) {
            const b = toServer.shift()!.bytes;
            // the server keeps the newest pose by its bytes and relays them as sent
            newest = decodePose(b);
        }
        if (now >= nextServer) {
            nextServer += serverTick;
            if (newest && rnd() >= down.drop) {
                downLast = Math.max(downLast, now + down.baseMs + rnd() * down.jitterMs);
                toClient.push({ at: downLast, bytes: encodeSnapshot({ serverMs: now, members: [{ slot: 1, pose: newest }] }) });
            }
        }
        while (toClient.length && toClient[0].at <= now) {
            const s = decodeSnapshot(toClient.shift()!.bytes)!;
            for (const m of s.members) track.push(s.serverMs, m.pose, now);
        }
        if (now >= nextDraw) {
            nextDraw += frame;
            const sh = track.sample(now);
            if (sh && now > 1000) {
                const tp = truth(sh.tick).pos;
                errs.push(Math.hypot(sh.pos[0] - tp[0], sh.pos[1] - tp[1], sh.pos[2] - tp[2]));
                if (sh.frozen) frozen++;
            }
        }
    }
    errs.sort((a, b) => a - b);
    return { maxM: errs[errs.length - 1], p99M: errs[Math.floor(errs.length * 0.99)], frames: errs.length, frozen };
}


/** Uplink and downlink of a home connection: 30 ms, 0-40 ms of jitter, one pose and one snapshot in ten left out (estimate). */
const HOME: Link = { baseMs: 30, jitterMs: 40, drop: 0.1 };

/**
 * Bounds. P99: the plan's 5 cm (rooms-plan.md 4B); measured 0.0250 m with the buffer, 0.399 m without (2026-11-13).
 * MAX: measured 0.1002 m with the buffer (a pose late through both links and a dropped snapshot: the drone flies on its
 * velocity for a few frames), 0.622 m without; the bound is the measured value with half again to spare.
 */
const P99_M = 0.05;
const MAX_M = 0.15;

describe('rooms interpolation (150 ms playout, Hermite, slerp, at most 250 ms ahead)', () => {
    it('draws the remote drone on its path within the bound through jitter and loss; control: no playout buffer exceeds it', () => {
        const buf = fly(PLAYOUT_MS, HOME, HOME);
        const none = fly(0, HOME, HOME);
        console.log('ROOMS-INTERP', JSON.stringify({ buffered: buf, noBuffer: none }));
        expect(buf.frames).toBeGreaterThan(1000);
        expect(buf.p99M).toBeLessThan(P99_M);
        expect(buf.maxM).toBeLessThan(MAX_M);
        expect(buf.frozen).toBe(0);
        expect(none.p99M).toBeGreaterThan(P99_M);
        expect(none.maxM).toBeGreaterThan(MAX_M);
    });

    it('flies on along its velocity for at most 250 ms after the last pose, then freezes', () => {
        const t = new RemoteTrack();
        const p = (tick: number): Pose => ({ flags: 1, seq: tick, tick, pos: [tick / 100, 1, 0], quat: [0, 0, 0, 1], vel: [10, 0, 0], throttle: 0.5 });
        for (let k = 0; k <= 10; k++) t.push(1000 + k * 67 + 40, p(k * 67), k * 67);
        const last = 670, base = 1040;
        // 100 ms past the last pose: still moving at 10 m/s
        const a = t.sample(base + last + PLAYOUT_MS + 100)!;
        expect(a.frozen).toBe(false);
        expect(a.pos[0]).toBeCloseTo(6.7 + 1.0, 5);
        const b = t.sample(base + last + PLAYOUT_MS + 1000)!;
        expect(b.frozen).toBe(true);
        expect(b.pos[0]).toBeCloseTo(6.7 + 2.5, 5);
    });
});
