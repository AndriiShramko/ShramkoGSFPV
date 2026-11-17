// Lane race, L1 and L2: the room's course and its board on the page (apps/fly/src/rooms/board.ts).
import { describe, expect, it } from 'vitest';
import { RoomBoard, courseId, orderRows } from '../../../apps/fly/src/rooms/board';
import type { CourseLook } from '../../../apps/fly/src/rooms/board';

const gen = (seed: number, laps = 0, lastLapMs: number | null = null): CourseLook => ({ on: true, source: 'generated', track: { id: 'x', version: 1 }, seed, laps, lastLapMs });
const off: CourseLook = { on: false, source: 'none', track: null, seed: null, laps: 0, lastLapMs: null };

describe('room board (lane race)', () => {
    it('a course made on this page becomes the room course, once', () => {
        const b = new RoomBoard(() => 0);
        expect(b.look(off)).toBeNull();
        expect(b.look(gen(42))).toEqual({ kind: 'course', course: 'g1.42' });
        expect(b.look(gen(42))).toBeNull();
    });

    it('the room course is built here when this page flies another, and is not sent back', () => {
        const b = new RoomBoard(() => 1);
        b.look(gen(7));
        expect(b.onBoard({ type: 'board', course: 'g1.42', rows: [] })).toEqual({ kind: 'seed', seed: 42 });
        expect(b.adopting).toBe('g1.42');
        expect(b.look(gen(42))).toBeNull();
        expect(b.adopting).toBeNull();
        expect(b.onBoard({ type: 'board', course: 'g1.42', rows: [] })).toBeNull();
    });

    it('each lap on the room course is sent with the next number; laps on another course are not', () => {
        const b = new RoomBoard(() => 0);
        b.look(gen(42));
        b.onBoard({ type: 'board', course: 'g1.42', rows: [] });
        expect(b.look(gen(42, 1, 41270.4))).toEqual({ kind: 'lap', course: 'g1.42', n: 1, ms: 41270 });
        expect(b.look(gen(42, 1, 41270.4))).toBeNull();
        expect(b.look(gen(42, 2, 40000))).toEqual({ kind: 'lap', course: 'g1.42', n: 2, ms: 40000 });
        // a new course replaces the room course: the count starts again
        b.onBoard({ type: 'board', course: 'g1.9', rows: [] });
        expect(b.sent).toBe(0);
        expect(b.look(gen(42, 3, 39000))).toBeNull();
    });

    it('rows are ordered by the best lap; an equal best keeps the first', () => {
        const rows = orderRows([{ slot: 0, nick: 'A', best: 41000, laps: 1 }, { slot: 1, nick: 'B', best: 40000, laps: 1 }, { slot: 2, nick: 'C', best: 41000, laps: 3 }]);
        expect(rows.map((r) => r.slot)).toEqual([1, 0, 2]);
        const b = new RoomBoard(() => 0);
        b.onBoard({ type: 'board', course: 'g1.42', rows: [] });
        b.onLap({ type: 'blap', course: 'g1.42', slot: 1, nick: 'B', n: 1, ms: 42000, best: 42000, lead: true });
        b.onLap({ type: 'blap', course: 'g1.42', slot: 0, nick: 'A', n: 1, ms: 41000, best: 41000, lead: true });
        expect(b.rows.map((r) => r.nick)).toEqual(['A', 'B']);
        expect(b.onLap({ type: 'blap', course: 'g1.1', slot: 0, nick: 'A', n: 2, ms: 30000, best: 30000, lead: true })).toBeNull();
        expect(courseId({ on: true, source: 'server', track: { id: 'abc', version: 3 }, seed: null, laps: 0, lastLapMs: null })).toBe('abc.v3');
    });
});
