// Train 1, lane rooms: the client's socket (apps/fly/src/rooms/socket.ts, api.ts) against the real service
// (apps/rooms/rooms.py as a child process on a free port, Node 22's global WebSocket). Two pilots in one room: A's pose
// reaches B in a snapshot, decoded. Control: C in another room never sees A's pose. Also: the clock gets its round
// trips, a room that does not exist stops the joining with 'no-room'. The child process is stopped on every exit path.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRoom, getRoom } from '../../../apps/fly/src/rooms/api';
import { encodePose, type Pose, type Snapshot } from '../../../apps/fly/src/rooms/codec';
import { RoomSocket } from '../../../apps/fly/src/rooms/socket';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let child: ChildProcess | null = null;
let port = 0;
const sockets: RoomSocket[] = [];
const stop = (): void => { if (child && child.exitCode === null) child.kill(); child = null; };
process.once('exit', stop);

const freePort = (): Promise<number> => new Promise((ok, bad) => {
    const s = createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});
const canConnect = (p: number): Promise<boolean> => new Promise((ok) => {
    const c = connect(p, '127.0.0.1', () => { c.destroy(); ok(true); });
    c.once('error', () => ok(false));
});
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await sleep(20); }
    return cond();
}

beforeAll(async () => {
    port = await freePort();
    child = spawn(process.env.PYTHON ?? 'python', ['-X', 'utf8', '-u', 'apps/rooms/rooms.py', '--host', '127.0.0.1', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
    const end = Date.now() + 10000;
    while (!(await canConnect(port))) {
        if (Date.now() > end || child.exitCode !== null) {
            stop();
            throw new Error('rooms.py did not start');
        }
        await sleep(100);
    }
}, 20000);

afterAll(() => {
    for (const s of sockets) s.close();
    stop();
});

const pose = (seq: number, x: number): Pose => ({ flags: 1, seq, tick: seq * 67, pos: [x, 2.5, -7.25], quat: [0, 0, 0, 1], vel: [1, 0, 0], throttle: 0.4 });

function join(room: string, nick: string, seen: Snapshot[]): RoomSocket {
    const s = new RoomSocket({ url: `ws://127.0.0.1:${port}/api/rooms/ws`, room, nick }, { snapshot: (x) => seen.push(x) });
    sockets.push(s);
    s.connect();
    return s;
}

describe('rooms socket against rooms.py', () => {
    it("two pilots in one room: A's pose reaches B; control: C in another room never sees it", async () => {
        const base = `http://127.0.0.1:${port}`;
        const r1 = await createRoom(base, { scene: { id: '39e63ce9' }, shared: { size: 2 } });
        const r2 = await createRoom(base, { scene: { id: '39e63ce9' } });
        expect(r1.ok && r2.ok).toBe(true);
        if (!r1.ok || !r2.ok) return;
        const info = await getRoom(base, r1.value.id);
        expect(info.ok && info.value.scene.id).toBe('39e63ce9');
        const seenA: Snapshot[] = [], seenB: Snapshot[] = [], seenC: Snapshot[] = [];
        const a = join(r1.value.id, 'Ala', seenA);
        const b = join(r1.value.id, 'Bob', seenB);
        const c = join(r2.value.id, 'Cyr', seenC);
        expect(await until(() => a.state === 'joined' && b.state === 'joined' && c.state === 'joined', 5000)).toBe(true);
        expect(await until(() => b.members.size === 2 && a.members.size === 2, 3000)).toBe(true);
        expect([...b.members.values()].sort()).toEqual(['Ala', 'Bob']);
        expect(a.room?.shared?.size).toBe(2);
        const A_X = 123.5, C_X = -40;
        const fromA = (s: Snapshot) => s.members.find((m) => m.slot === a.slot && m.pose.pos[0] === A_X);
        let seq = 0;
        const ok = await until(() => {
            a.sendPose(encodePose(pose(seq, A_X)));
            c.sendPose(encodePose(pose(seq, C_X)));
            seq++;
            return seenB.some(fromA) && seenC.length >= 5;
        }, 5000);
        expect(ok).toBe(true);
        const got = seenB.find(fromA)!.members.find((m) => m.slot === a.slot)!.pose;
        expect(got.pos).toEqual([A_X, 2.5, -7.25]);
        expect(got.flags).toBe(1);
        // control: room 2 gets snapshots (C's own pose) but never A's
        expect(seenC.some((s) => s.members.some((m) => m.pose.pos[0] === A_X))).toBe(false);
        expect(seenC.some((s) => s.members.some((m) => m.pose.pos[0] === C_X))).toBe(true);
        // the clock: round trips came back (pings every 250 ms at the start)
        expect(await until(() => a.clock.count >= 3, 3000)).toBe(true);
        expect(Math.abs(a.clock.rtt!)).toBeLessThan(1000);
        // B leaves: A hears it
        b.leave();
        expect(await until(() => a.members.size === 1, 3000)).toBe(true);
    }, 30000);

    it("a room that does not exist stops joining with 'no-room' (no new tries)", async () => {
        const s = join('AAAAAAAAAAA', 'Dan', []);
        expect(await until(() => s.problem !== null, 5000)).toBe(true);
        expect(s.problem).toBe('no-room');
        expect(s.state).toBe('off');
    }, 10000);
});
