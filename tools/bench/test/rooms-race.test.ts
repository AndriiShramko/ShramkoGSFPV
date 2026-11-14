// Lane rooms2, stage Q2 (rooms-plan.md 2.4, 4D): a race on time in a room. The page's rules (which course a proposal names,
// the countdown lines in order, the laps it reports, the lines of each race message) and two RoomSockets against
// apps/rooms/rooms.py: A proposes, both build and say ready, both get one start time, a lap before the start is refused,
// both report a lap after it and both get the same table. Negative control: the old socket.ts (docs/wip/rooms2.md, Status).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openRoom } from '../../../apps/fly/src/rooms/api';
import { RoomSocket } from '../../../apps/fly/src/rooms/socket';
import { COUNT_MARKS, Countdown, RaceLaps, courseFor, parseCourse, raceLine, tableRows } from '../../../apps/fly/src/rooms/race';
import type { RaceMsg, RaceRow } from '../../../apps/fly/src/rooms/race';

const A = '39e63ce9';

describe('the course a proposal names', () => {
    const off = { on: false, source: 'none' as const, track: null, seed: null };
    it('the course flown now, else the newest saved one, else a new seed', () => {
        expect(courseFor({ on: true, source: 'server', track: { id: 'ab12', version: 3 }, seed: null }, [], 7)).toBe('ab12.v3');
        expect(courseFor({ on: true, source: 'generated', track: { id: 'x', version: 1 }, seed: 42 }, [{ id: 'cd', version: 2 }], 7)).toBe('g1.42');
        expect(courseFor(off, [{ id: 'cd', version: 2 }, { id: 'ef', version: 1 }], 7)).toBe('cd.v2');
        expect(courseFor(off, [], 7)).toBe('g1.7');
        expect(courseFor(null, [], 7)).toBe('g1.7');
    });
    it('a course id back to what the page builds', () => {
        expect(parseCourse('g1.42')).toEqual({ kind: 'seed', seed: 42 });
        expect(parseCourse('cd.v2')).toEqual({ kind: 'saved', id: 'cd', version: 2 });
        expect(parseCourse('../x')).toBeNull();
        expect(parseCourse('g1.99999999999')).toBeNull();
    });
});

describe('the countdown', () => {
    it('says 10, 3, 2, 1, go in order, each once', () => {
        const c = new Countdown();
        const said: string[] = [];
        for (let left = 10500; left >= -100; left -= 16) {
            const l = c.due(left);
            if (l) said.push(l.key === 'rooms.race.go' ? 'go' : String(l.params.n));
        }
        expect(said).toEqual(['10', '3', '2', '1', 'go']);
        expect(c.over).toBe(true);
        expect(COUNT_MARKS.length).toBe(5);
    });
    it('a late page says only the last mark passed', () => {
        const c = new Countdown();
        expect(c.due(2500)?.params.n).toBe(3);
        expect(c.due(-50)?.key).toBe('rooms.race.go');
        expect(c.due(-100)).toBeNull();
    });
});

describe('the laps a page reports', () => {
    it('only after the start, numbered, up to the race laps', () => {
        const l = new RaceLaps(2);
        expect(l.feed('lap', 9000, false)).toBeNull();
        expect(l.feed('gate', 9000, true)).toBeNull();
        expect(l.feed('lap', 9000.4, true)).toEqual({ n: 1, ms: 9000 });
        expect(l.feed('done', 8000, true)).toEqual({ n: 2, ms: 8000 });
        expect(l.feed('lap', 7000, true)).toBeNull();
    });
});

describe('the lines of race messages', () => {
    const row = (slot: number, nick: string, place: number, totalMs: number, gapMs: number | null, done = true): RaceRow =>
        ({ slot, nick, laps: 1, totalMs, bestMs: totalMs, lastMs: totalMs, done, place, gapMs });
    const nick = (s: number): string => ['Ala', 'Bob'][s] ?? '?';
    it('prep, my lap with a gap, another pilot finishing, the results', () => {
        const table = [row(1, 'Bob', 1, 8000, null), row(0, 'Ala', 2, 9000, 1000)];
        const msg = (m: Partial<RaceMsg>): RaceMsg => ({ type: 'race', state: 'lap', course: 'g1.1', table, ...m });
        expect(raceLine(msg({ state: 'prep', by: 1, laps: 2 }), 0, nick)).toEqual({ key: 'rooms.race.prep', params: { nick: 'Bob', laps: 2 } });
        expect(raceLine(msg({ slot: 0, n: 1, ms: 9000 }), 0, nick)).toEqual({ key: 'rooms.race.myLapGap', params: { n: 1, time: '9.0', place: 2, gap: '1.0' } });
        expect(raceLine(msg({ slot: 1, n: 1, ms: 8000 }), 0, nick)?.key).toBe('rooms.race.finished');
        expect(raceLine(msg({ state: 'results' }), 0, nick)).toEqual({ key: 'rooms.race.resultsMe', params: { nick: 'Bob', time: '8.0', place: 2 } });
        expect(raceLine(msg({ state: 'count' }), 0, nick)).toBeNull();
        expect(tableRows(table)[1]).toEqual(['2', 'Ala', '1', '9.0', '9.0', '+1.0']);
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

describe('two pilots race', () => {
    it('one start time, a lap before it refused, the same table on both pages', async () => {
        const base = `http://127.0.0.1:${port}`;
        const a = await openRoom(base, A);
        expect(a.ok).toBe(true);
        if (!a.ok) return;
        const got: Record<string, RaceMsg[]> = { A: [], B: [] };
        const mk = (who: 'A' | 'B'): RoomSocket => {
            const s = new RoomSocket({ url: `ws://127.0.0.1:${port}/api/rooms/ws`, room: a.value.id, nick: `Pilot ${who}` }, { race: (m) => got[who].push(m) });
            sockets.push(s);
            s.connect();
            return s;
        };
        const sa = mk('A');
        const sb = mk('B');
        expect(await until(() => sa.state === 'joined' && sb.state === 'joined' && sa.members.size === 2, 5000)).toBe(true);
        sa.race('g1.12345', 1);
        expect(await until(() => got.B.some((m) => m.state === 'prep'), 5000)).toBe(true);
        sa.ready();
        sb.ready();
        expect(await until(() => got.A.some((m) => m.state === 'count') && got.B.some((m) => m.state === 'count'), 5000)).toBe(true);
        const startA = got.A.find((m) => m.state === 'count')?.startAt;
        expect(startA).toBe(got.B.find((m) => m.state === 'count')?.startAt);
        sa.lap(1, 50);
        expect(await until(() => got.A.some((m) => m.state === 'refused'), 5000)).toBe(true);
        // the countdown is the service's 10 s; then each page's lap (shorter than the time since the start, not under MIN_LAP_MS)
        expect(await until(() => (sa.clock.serverNow(performance.now()) ?? 0) > (startA ?? 0) + 4600, 20000)).toBe(true);
        sb.lap(1, 3300);
        sa.lap(1, 3400);
        expect(await until(() => got.A.some((m) => m.state === 'results') && got.B.some((m) => m.state === 'results'), 5000)).toBe(true);
        const ta = got.A.find((m) => m.state === 'results')?.table ?? [];
        const tb = got.B.find((m) => m.state === 'results')?.table ?? [];
        expect(ta.map((r) => r.nick)).toEqual(['Pilot B', 'Pilot A']);
        expect(tb).toEqual(ta);
        expect(ta[1]?.gapMs).toBe(100);
    }, 40000);
});
