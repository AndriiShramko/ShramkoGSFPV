// Train 1, lane rooms: the binary frames of protocol rooms/1 (docs/rooms-protocol.md), the client's half of
// apps/rooms/protocol.py. Little-endian. A pose is 36 bytes; a snapshot is a 6-byte head and (slot + pose) entries.
// Tested on the fixtures the server's tests use (apps/rooms/tests/fixtures, tools/bench/test/rooms-codec.test.ts).

export const POSE_BYTES = 36;
export const SNAP_HEAD_BYTES = 6;
export const KIND_POSE = 1;
export const KIND_SNAPSHOT = 2;
/** flags of a pose */
export const FLAG_ARMED = 1;
export const FLAG_CRASHED = 2;
export const FLAG_PAUSED = 4;
export const FLAG_RACE = 8;
/** the quaternion's scale on the wire (protocol.py QUAT_SCALE) */
export const QUAT_SCALE = 32767;

export type Vec3 = [number, number, number];
/** x y z w */
export type Quat4 = [number, number, number, number];

export interface Pose {
    flags: number;
    seq: number;
    tick: number;
    /** metres, the room's flown frame */
    pos: Vec3;
    /** x y z w */
    quat: Quat4;
    /** m/s */
    vel: Vec3;
    /** 0..1 */
    throttle: number;
}

export interface SnapshotEntry { slot: number; pose: Pose }
export interface Snapshot { serverMs: number; members: SnapshotEntry[] }

const clampInt = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);

/** Writes one pose at `off` of `view`. */
export function writePose(view: DataView, off: number, p: Pose): void {
    view.setUint8(off, KIND_POSE);
    view.setUint8(off + 1, p.flags & 0xff);
    view.setUint16(off + 2, p.seq & 0xffff, true);
    view.setUint32(off + 4, p.tick >>> 0, true);
    for (let i = 0; i < 3; i++) view.setFloat32(off + 8 + 4 * i, p.pos[i], true);
    for (let i = 0; i < 4; i++) view.setInt16(off + 20 + 2 * i, clampInt(p.quat[i] * QUAT_SCALE, -32768, 32767), true);
    for (let i = 0; i < 3; i++) view.setInt16(off + 28 + 2 * i, clampInt(p.vel[i] * 100, -32768, 32767), true);
    view.setUint16(off + 34, clampInt(p.throttle * 65535, 0, 65535), true);
}

/** One pose as the 36 bytes sent up. */
export function encodePose(p: Pose): Uint8Array {
    const out = new Uint8Array(POSE_BYTES);
    writePose(new DataView(out.buffer), 0, p);
    return out;
}

/** The pose at `off`; null when the kind byte is not a pose, the bytes are short or the position is not finite. */
export function readPose(view: DataView, off = 0): Pose | null {
    if (view.byteLength - off < POSE_BYTES || view.getUint8(off) !== KIND_POSE) return null;
    const pos: Vec3 = [view.getFloat32(off + 8, true), view.getFloat32(off + 12, true), view.getFloat32(off + 16, true)];
    if (!pos.every(Number.isFinite)) return null;
    const quat = [0, 1, 2, 3].map((i) => view.getInt16(off + 20 + 2 * i, true) / QUAT_SCALE) as Quat4;
    const vel = [0, 1, 2].map((i) => view.getInt16(off + 28 + 2 * i, true) / 100) as Vec3;
    return {
        flags: view.getUint8(off + 1),
        seq: view.getUint16(off + 2, true),
        tick: view.getUint32(off + 4, true),
        pos,
        quat,
        vel,
        throttle: view.getUint16(off + 34, true) / 65535
    };
}

const viewOf = (b: ArrayBuffer | ArrayBufferView): DataView =>
    b instanceof ArrayBuffer ? new DataView(b) : new DataView(b.buffer, b.byteOffset, b.byteLength);

export function decodePose(b: ArrayBuffer | ArrayBufferView): Pose | null {
    const v = viewOf(b);
    return v.byteLength === POSE_BYTES ? readPose(v, 0) : null;
}

/** A snapshot from the server; null when the head or the length is wrong. Entries whose pose is bad are left out. */
export function decodeSnapshot(b: ArrayBuffer | ArrayBufferView): Snapshot | null {
    const v = viewOf(b);
    if (v.byteLength < SNAP_HEAD_BYTES || v.getUint8(0) !== KIND_SNAPSHOT) return null;
    const count = v.getUint8(5);
    if (v.byteLength !== SNAP_HEAD_BYTES + count * (1 + POSE_BYTES)) return null;
    const members: SnapshotEntry[] = [];
    for (let i = 0; i < count; i++) {
        const off = SNAP_HEAD_BYTES + i * (1 + POSE_BYTES);
        const pose = readPose(v, off + 1);
        if (pose) members.push({ slot: v.getUint8(off), pose });
    }
    return { serverMs: v.getUint32(1, true), members };
}

/** A snapshot as the server builds it (for tests and the local rig). */
export function encodeSnapshot(s: Snapshot): Uint8Array {
    const out = new Uint8Array(SNAP_HEAD_BYTES + s.members.length * (1 + POSE_BYTES));
    const v = new DataView(out.buffer);
    v.setUint8(0, KIND_SNAPSHOT);
    v.setUint32(1, s.serverMs >>> 0, true);
    v.setUint8(5, s.members.length);
    s.members.forEach((m, i) => {
        const off = SNAP_HEAD_BYTES + i * (1 + POSE_BYTES);
        v.setUint8(off, m.slot);
        writePose(v, off + 1, m.pose);
    });
    return out;
}
