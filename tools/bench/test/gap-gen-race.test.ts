// Lane gap-gen, stage S2 (audit entry generator-15 of t6-audit.json): a course of the 'Generate a course' dialog raced in a
// room. The host flies an asked course (pro, compact); the guest's own dialog says beginner, wide. The race proposal and the
// room's course carry the g2 link (courseLinkId of @gsfpv/tracks/request) through apps/rooms/rooms.py, the guest builds
// the course the link names, and both lay the very same gates. Negative control: the old race.ts named the course 'g1.<seed>'
// and the guest built that seed with its own level and spread (docs/wip/gap-gen.md, Status).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openRoom } from '../../../apps/fly/src/rooms/api';
import { RoomSocket } from '../../../apps/fly/src/rooms/socket';
import { RoomBoard } from '../../../apps/fly/src/rooms/board';
import { courseFor, parseCourse } from '../../../apps/fly/src/rooms/race';
import type { CourseNow, CourseRef, RaceMsg } from '../../../apps/fly/src/rooms/race';
import { planCourse } from '../../../packages/tracks/src';
import type { CourseAsk, CourseRequest, PlanInput, VoxelCollision } from '../../../packages/tracks/src';
import { IDENTITY } from '../../../packages/tracks/test/worlds';
import { cityFromAbove } from '../../../packages/tracks/test/scan-worlds';

const A = '39e63ce9';
// lane w1-anchor: the host's course grows from the host's place; its id carries it, so every racer lays it from there
const HOST: CourseRequest = { seed: 4242, level: 'pro', spread: 'compact', anyQuality: false, anchor: [27, 3, 27] };
/** the guest's own dialog choice (store course.level, course.spread) */
const GUEST_OWN: CourseAsk = { level: 'beginner', spread: 'wide', anyQuality: false };
const hostNow: CourseNow = { on: true, source: 'generated', track: { id: 'x', version: 1 }, seed: HOST.seed, request: HOST };

/** What a page asks the worker for when it builds a room's course (race-page.ts build, the course feature's adopt): the
 *  link's ask, or for a plain seed the old way, the seed with this page's own level and spread. */
function askOf(ref: CourseRef | null, own: CourseAsk): CourseRequest | null {
    if (!ref || ref.kind === 'saved') return null;
    if (ref.kind === 'seed') return { seed: ref.seed, ...own, anchor: null };
    return ref.request;
}

const input = (walls: VoxelCollision, request: CourseRequest): PlanInput => ({
    walls, transform: IDENTITY, spawn: [0, 1, 0], scene: { id: 'abcdef12', version: 1 }, created: '2026-11-20T00:00:00.000Z', craftRadiusM: 0.0425, request, elements: true
});
const gatesOf = (walls: VoxelCollision, r: CourseRequest): number[][] => {
    const p = planCourse(input(walls, r));
    expect(p.ok).toBe(true);
    return p.ok ? p.track.gates.map((g) => g.pos.map((v) => Math.round(v * 1000) / 1000)) : [];
};

describe('the course id of an asked course', () => {
    it('names the asker\'s level and spread, and reads back to the same ask', () => {
        const id = courseFor(hostNow, [{ id: 'cd', version: 2 }], 7);
        expect(id).toBe(`g2.${HOST.seed.toString(36)}.pc.27.3.27`);
        expect(askOf(parseCourse(id), GUEST_OWN)).toEqual(HOST);
        // a course without a request (a 'g1.' link) stays the old id
        expect(courseFor({ ...hostNow, request: undefined }, [], 7)).toBe(`g1.${HOST.seed}`);
        // the room's course on the board: the guest adopts the asked course, not a seed of its own choice
        const board = new RoomBoard(() => 1);
        expect(askOf(board.onBoard({ type: 'board', course: id, by: 0, rows: [] }), GUEST_OWN)).toEqual(HOST);
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
    // t7-base: 1.7 s alone; under the whole suite beside other lanes 10 s was not enough (two gate runs of three)
    const end = Date.now() + 30000;
    while (!(await canConnect(port))) {
        if (Date.now() > end || child.exitCode !== null) {
            stop();
            throw new Error('rooms.py did not start');
        }
        await sleep(100);
    }
}, 40000);

afterAll(() => {
    for (const s of sockets) s.close();
    stop();
});

describe('a dialog course raced in a room', () => {
    it('host pro compact, guest beginner wide: the guest lays the host\'s gates', async () => {
        const a = await openRoom(`http://127.0.0.1:${port}`, A);
        expect(a.ok).toBe(true);
        if (!a.ok) return;
        const got: Record<'host' | 'guest', RaceMsg[]> = { host: [], guest: [] };
        const mk = (who: 'host' | 'guest'): RoomSocket => {
            const s = new RoomSocket({ url: `ws://127.0.0.1:${port}/api/rooms/ws`, room: a.value.id, nick: who }, { race: (m) => got[who].push(m) });
            sockets.push(s);
            s.connect();
            return s;
        };
        const host = mk('host');
        const guest = mk('guest');
        expect(await until(() => host.state === 'joined' && guest.state === 'joined' && host.members.size === 2, 5000)).toBe(true);
        host.race(courseFor(hostNow, [], 1), 1);
        expect(await until(() => got.guest.some((m) => m.state === 'prep'), 5000)).toBe(true);
        const course = got.guest.find((m) => m.state === 'prep')!.course;
        const ask = askOf(parseCourse(course), GUEST_OWN);
        expect(ask).not.toBeNull();
        const walls = cityFromAbove();
        const hostGates = gatesOf(walls, HOST);
        expect(hostGates.length).toBeGreaterThanOrEqual(3);
        expect(gatesOf(walls, ask!)).toEqual(hostGates);
    }, 60000);
});
