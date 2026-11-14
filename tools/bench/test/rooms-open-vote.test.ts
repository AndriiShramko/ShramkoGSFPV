// Lane rooms2 (R27): key 9 lands in the open room with one press, agrees to a vote, else opens the panel; "the next scan";
// the vote lines; and two RoomSockets against apps/rooms/rooms.py: both land in one open room, A proposes, B agrees, both get
// the room's new scan. Negative control: the old keys.ts and socket.ts (docs/wip/rooms2.md, Status).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openRoom } from '../../../apps/fly/src/rooms/api';
import type { RoomInfo } from '../../../apps/fly/src/rooms/api';
import { roomKeys } from '../../../apps/fly/src/rooms/keys';
import { RoomSocket } from '../../../apps/fly/src/rooms/socket';
import { nextScan, ninePress, voteLine, voteView } from '../../../apps/fly/src/rooms/vote';
import type { VoteMsg } from '../../../apps/fly/src/rooms/vote';

const A = '39e63ce9';
const B = 'aabbccdd';

describe('key 9 (the owner rule: fewest presses)', () => {
    const press = (nine: 'join' | 'agree' | 'panel'): string[] => {
        const did: string[] = [];
        const rk = roomKeys({
            dialogUp: () => false, inRoom: () => false, openPanel: () => did.push('panel'), sayWho: () => did.push('who'),
            sayNoRoom: () => did.push('noRoom'), nine: () => nine, joinOpen: () => did.push('join'), agree: () => did.push('agree')
        });
        let stopped = false;
        rk.panel.run({ repeat: false, preventDefault: () => { stopped = true; } } as KeyboardEvent);
        expect(stopped).toBe(true);
        return did;
    };
    it('outside a room 9 joins the open room, with a vote to agree it agrees, else the panel', () => {
        expect(press('join')).toEqual(['join']);
        expect(press('agree')).toEqual(['agree']);
        expect(press('panel')).toEqual(['panel']);
    });
    it('ninePress decides', () => {
        const v = { scene: B, by: 0, yes: 1, need: 2, mine: false };
        expect(ninePress(false, null)).toBe('join');
        expect(ninePress(false, v)).toBe('join');
        expect(ninePress(true, v)).toBe('agree');
        expect(ninePress(true, { ...v, mine: true })).toBe('panel');
        expect(ninePress(true, null)).toBe('panel');
    });
});

describe('the next scan', () => {
    it('follows the catalogue order and wraps', () => {
        expect(nextScan(['a1', 'b2', 'c3'], 'a1')).toBe('b2');
        expect(nextScan(['a1', 'b2', 'c3'], 'c3')).toBe('a1');
        expect(nextScan(['a1', 'b2', 'c3'], 'zz')).toBe('a1');
        expect(nextScan(['a1'], 'a1')).toBeNull();
        expect(nextScan([], 'a1')).toBeNull();
        expect(nextScan(['a1', 'a1', 'b2'], 'b2')).toBe('a1');
    });
});

describe('vote lines', () => {
    const title = (id: string): string => `T-${id}`;
    const nick = (s: number): string => `P${s}`;
    const open: VoteMsg = { type: 'vote', state: 'open', scene: { id: B }, by: 0, yes: [0], need: 2, present: 2, leftMs: 30000 };
    it('an open vote asks the others to press the key, tells the yes voter the count', () => {
        expect(voteLine(open, 1, title, nick, '9')).toEqual({ key: 'rooms.vote.open', params: { nick: 'P0', scan: `T-${B}`, yes: 1, need: 2, key: '9' } });
        expect(voteLine(open, 0, title, nick, '9')).toEqual({ key: 'rooms.vote.counted', params: { scan: `T-${B}`, yes: 1, need: 2 } });
        expect(voteView(open, 1)).toEqual({ scene: B, by: 0, yes: 1, need: 2, mine: false });
        expect(voteView(open, 0)?.mine).toBe(true);
    });
    it('the result is said', () => {
        expect(voteLine({ ...open, state: 'passed', yes: [0, 1] }, 1, title, nick, '9').key).toBe('rooms.vote.passed');
        expect(voteLine({ ...open, state: 'failed' }, 1, title, nick, '9').params).toEqual({ scan: `T-${B}`, yes: 1, need: 2 });
        expect(voteView({ ...open, state: 'passed' }, 1)).toBeNull();
        expect(voteLine({ ...open, state: 'busy' }, 1, title, nick, '9').key).toBe('rooms.vote.open');
    });
});

// ---------------------------------------------------------------- against the service
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

describe('two pilots, one press each, a vote', () => {
    it('both land in one open room, A proposes, B agrees, both get the new scan', async () => {
        const base = `http://127.0.0.1:${port}`;
        const a = await openRoom(base, A);
        const b = await openRoom(base, A);
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) return;
        expect(b.value.id).toBe(a.value.id);
        expect(a.value.room.kind).toBe('persistent');
        const votes: Record<string, VoteMsg[]> = { A: [], B: [] };
        const scenes: Record<string, RoomInfo[]> = { A: [], B: [] };
        const mk = (who: 'A' | 'B'): RoomSocket => {
            const s = new RoomSocket({ url: `ws://127.0.0.1:${port}/api/rooms/ws`, room: a.value.id, nick: `Pilot ${who}` },
                { vote: (m) => votes[who].push(m), scene: (r) => scenes[who].push(r) });
            sockets.push(s);
            s.connect();
            return s;
        };
        const sa = mk('A');
        const sb = mk('B');
        expect(await until(() => sa.state === 'joined' && sb.state === 'joined' && sa.members.size === 2, 5000)).toBe(true);
        sa.propose(B);
        expect(await until(() => votes.B.some((m) => m.state === 'open'), 5000)).toBe(true);
        const open = votes.B.find((m) => m.state === 'open');
        expect(voteView(open as VoteMsg, sb.slot)).toEqual({ scene: B, by: sa.slot, yes: 1, need: 2, mine: false });
        sb.agree();
        expect(await until(() => scenes.A.length === 1 && scenes.B.length === 1, 5000)).toBe(true);
        expect(scenes.A[0].scene.id).toBe(B);
        expect(sb.room?.scene.id).toBe(B);
        expect(votes.A.map((m) => m.state)).toEqual(['open', 'passed']);
    }, 20000);
});
