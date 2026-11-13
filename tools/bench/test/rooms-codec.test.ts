// Train 1, lane rooms: the client codec (apps/fly/src/rooms/codec.ts) against the fixtures the server's tests use
// (apps/rooms/tests/fixtures/*.json, made by apps/rooms/tests/make_fixtures.py from apps/rooms/protocol.py), and the
// server clock's median (apps/fly/src/rooms/clock.ts).
// Control: a codec that swaps x and z (the case "x-and-z-differ" exists for it) must fail the same check.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePose, decodeSnapshot, encodePose, encodeSnapshot, type Pose, type Snapshot } from '../../../apps/fly/src/rooms/codec';
import { ServerClock } from '../../../apps/fly/src/rooms/clock';

interface Raw { quat: number[]; vel: number[]; throttle: number }
type FixPose = Pose & { raw: Raw };
interface Case<V> { name: string; hex: string; value: V }
const read = <V>(name: string): Case<V>[] => JSON.parse(readFileSync(new URL(`../../../apps/rooms/tests/fixtures/${name}`, import.meta.url), 'utf8')).cases;
const POSES = read<FixPose>('pose.json');
const SNAPS = read<{ serverMs: number; members: { slot: number; pose: FixPose }[] }>('snapshot.json');

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const bytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, 'hex'));

interface Codec {
    encodePose(p: Pose): Uint8Array;
    decodePose(b: Uint8Array): Pose | null;
    decodeSnapshot(b: Uint8Array): Snapshot | null;
}

/** The difference of a decoded pose from the fixture's value, '' when none (raw integers exact, floats of pos exact). */
function poseDiff(p: Pose | null, v: FixPose): string {
    if (!p) return 'null';
    if (p.flags !== v.flags || p.seq !== v.seq || p.tick !== v.tick) return 'head';
    if (p.pos.some((x, i) => x !== v.pos[i])) return 'pos';
    if (p.quat.some((x, i) => Math.round(x * 32767) !== v.raw.quat[i])) return 'quat';
    if (p.vel.some((x, i) => Math.round(x * 100) !== v.raw.vel[i])) return 'vel';
    if (Math.round(p.throttle * 65535) !== v.raw.throttle) return 'throttle';
    return '';
}

/** Every fixture case the codec gets wrong, as "name:what". */
function failures(c: Codec): string[] {
    const out: string[] = [];
    for (const k of POSES) {
        if (hex(c.encodePose(k.value)) !== k.hex) out.push(`${k.name}:encode`);
        const d = poseDiff(c.decodePose(bytes(k.hex)), k.value);
        if (d) out.push(`${k.name}:decode-${d}`);
    }
    for (const k of SNAPS) {
        const s = c.decodeSnapshot(bytes(k.hex));
        if (!s || s.serverMs !== k.value.serverMs || s.members.length !== k.value.members.length) { out.push(`${k.name}:snapshot`); continue; }
        s.members.forEach((m, i) => {
            const d = m.slot === k.value.members[i].slot ? poseDiff(m.pose, k.value.members[i].pose) : 'slot';
            if (d) out.push(`${k.name}:${i}-${d}`);
        });
    }
    return out;
}

const REAL: Codec = { encodePose, decodePose, decodeSnapshot };
const swapXZ = (p: Pose): Pose => ({ ...p, pos: [p.pos[2], p.pos[1], p.pos[0]] });
const SWAPPED: Codec = {
    encodePose: (p) => encodePose(swapXZ(p)),
    decodePose: (b) => { const p = decodePose(b); return p && swapXZ(p); },
    decodeSnapshot: (b) => { const s = decodeSnapshot(b); return s && { ...s, members: s.members.map((m) => ({ slot: m.slot, pose: swapXZ(m.pose) })) }; }
};

describe('rooms codec (protocol rooms/1, the server fixtures)', () => {
    it('encodes and decodes every pose and snapshot case of the server exactly; control: x and z swapped fails', () => {
        expect(POSES.length).toBe(4);
        expect(SNAPS.length).toBe(3);
        expect(failures(REAL)).toEqual([]);
        const bad = failures(SWAPPED);
        expect(bad).toContain('x-and-z-differ:encode');
        expect(bad).toContain('x-and-z-differ:decode-pos');
    });

    it('a snapshot it writes reads back the same; a short or wrong frame and a pose with a position not finite are refused', () => {
        const s = decodeSnapshot(bytes(SNAPS[0].hex))!;
        expect(hex(encodeSnapshot(s))).toBe(SNAPS[0].hex);
        expect(decodeSnapshot(bytes(SNAPS[0].hex).slice(0, 20))).toBeNull();
        expect(decodePose(bytes(SNAPS[0].hex).slice(0, 36))).toBeNull();
        const nan = bytes(POSES[0].hex);
        new DataView(nan.buffer).setFloat32(8, NaN, true);
        expect(decodePose(nan)).toBeNull();
    });
});

describe('rooms server clock (median of 8)', () => {
    it('a few slow answers do not move the offset; control: the mean of the same answers is moved', () => {
        const TRUE = 5000;
        const c = new ServerClock();
        const offsets: number[] = [];
        // 8 round trips of 40 ms, three of them with 400 ms more on the way back (a slow answer)
        for (let i = 0; i < 8; i++) {
            const sent = i * 1000, up = 20, down = 20 + (i % 3 === 0 ? 400 : 0);
            c.add(sent, sent + up + TRUE, sent + up + down);
            offsets.push(sent + up + TRUE - (sent + sent + up + down) / 2);
        }
        expect(c.count).toBe(8);
        expect(Math.abs(c.offset! - TRUE)).toBeLessThan(1);
        const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
        expect(Math.abs(mean - TRUE)).toBeGreaterThan(50);
        c.add(9000, 9020 + TRUE, 9040);
        expect(c.count).toBe(8);
    });
});
