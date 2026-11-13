// Lane rooms2, stage Q2: the race on the page (apps/fly/src/rooms/race-page.ts) without a browser: which race messages it
// says, that a repeated prep (each pilot's ready) says nothing, that a pilot outside the racers builds nothing, that the
// results keep the table for key 0, and the place line key 0 says. The browser part (course built, laps flown) is the
// probe tools/bench/src/rooms-race.ts.
import { describe, expect, it } from 'vitest';
import { RacePage } from '../../../apps/fly/src/rooms/race-page';
import type { RaceMsg, RaceRow } from '../../../apps/fly/src/rooms/race';
import type { FlightContext } from '../../../apps/fly/src/app/context';
import type { RoomSocket } from '../../../apps/fly/src/rooms/socket';

const row = (slot: number, nick: string, place: number, bestMs: number | null): RaceRow => ({
    slot, nick, laps: bestMs === null ? 0 : 1, totalMs: bestMs ?? 0, bestMs, lastMs: bestMs, done: false, place, gapMs: place === 1 ? null : 100
});

function page(slot: number): { rp: RacePage; told: string[]; sent: string[] } {
    const told: string[] = [];
    const sent: string[] = [];
    const ctx = { events: { on: () => () => undefined }, session: { runner: { sim: { tick: 0, s: [0, 0, 0] } } }, scene: { id: 'x' }, hook: {} } as unknown as FlightContext;
    const sock = {
        slot, members: new Map([[0, 'Ann'], [1, 'Bob']]),
        clock: { serverNow: (n: number) => n },
        ready: () => sent.push('ready'), lap: (n: number, ms: number) => sent.push(`lap ${n} ${ms}`), race: () => sent.push('race'), table: () => sent.push('table')
    } as unknown as RoomSocket;
    return { rp: new RacePage(ctx, sock, (key) => told.push(key)), told, sent };
}

describe('the race on the page', () => {
    it('says the proposal once, though every ready repeats the prep', () => {
        const { rp, told } = page(1);
        const prep: RaceMsg = { type: 'race', state: 'prep', course: 'g1.7', laps: 2, by: 0, racers: [0], ready: [] };
        rp.onMsg(prep);
        rp.onMsg({ ...prep, ready: [0] });
        expect(told).toEqual(['rooms.race.prep']);
        expect(rp.h.state).toBe('prep');
        expect(rp.h.course).toBe('g1.7');
        expect(rp.h.laps).toBe(2);
    });

    it('a pilot who is not a racer builds nothing and says no ready', () => {
        const { rp, sent } = page(1);
        rp.onMsg({ type: 'race', state: 'prep', course: 'g1.7', laps: 2, by: 0, racers: [0], ready: [] });
        expect(rp.h.racer).toBe(false);
        expect(rp.h.built).toBe(false);
        expect(sent).toEqual([]);
    });

    it('the results keep the table; key 0 says this pilot’s place', () => {
        const { rp, told } = page(1);
        rp.onMsg({ type: 'race', state: 'prep', course: 'g1.7', laps: 2, by: 0, racers: [0, 1], ready: [], table: [row(0, 'Ann', 1, null), row(1, 'Bob', 2, null)] });
        expect(rp.h.racer).toBe(true);
        expect(rp.standing()).toEqual({ key: 'rooms.race.standingNoLap', params: { place: 2, n: 2 } });
        const table = [row(1, 'Bob', 1, 4200), row(0, 'Ann', 2, 4300)];
        rp.onMsg({ type: 'race', state: 'results', course: 'g1.7', table });
        expect(rp.h.state).toBe('results');
        expect(rp.h.table.map((r) => r.slot)).toEqual([1, 0]);
        expect(told.at(-1)).toBe('rooms.race.results');
        expect(rp.standing()).toEqual({ key: 'rooms.race.standing', params: { place: 1, n: 2, time: '4.2' } });
    });
});
