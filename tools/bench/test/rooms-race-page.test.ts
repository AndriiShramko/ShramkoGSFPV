// Lane rooms2, stage Q2: the race on the page (apps/fly/src/rooms/race-page.ts) without a browser: which race messages it
// says, that a repeated prep (each pilot's ready) says nothing, that a pilot outside the racers builds nothing, that the
// results keep the table for key 0, and the place line key 0 says. The browser part (course built, laps flown) is the
// probe tools/bench/src/rooms-race.ts.
import { describe, expect, it } from 'vitest';
import { RacePage } from '../../../apps/fly/src/rooms/race-page';
import { closeVisit, openVisit } from '../../../apps/fly/src/rooms/open-visit';
import type { RaceMsg, RaceRow } from '../../../apps/fly/src/rooms/race';
import type { FlightContext } from '../../../apps/fly/src/app/context';
import type { RoomSocket } from '../../../apps/fly/src/rooms/socket';

const row = (slot: number, nick: string, place: number, bestMs: number | null): RaceRow => ({
    slot, nick, laps: bestMs === null ? 0 : 1, totalMs: bestMs ?? 0, bestMs, lastMs: bestMs, done: false, place, gapMs: place === 1 ? null : 100
});

function page(slot: number, roomScene = 'x'): { rp: RacePage; told: string[]; sent: string[] } {
    const told: string[] = [];
    const sent: string[] = [];
    const ctx = { events: { on: () => () => undefined }, session: { runner: { sim: { tick: 0, s: [0, 0, 0] } } }, scene: { id: 'x' }, hook: {} } as unknown as FlightContext;
    const sock = {
        slot, members: new Map([[0, 'Ann'], [1, 'Bob']]), room: { scene: { id: roomScene } },
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

    it('the results keep the table; key 0 says the place of this pilot', () => {
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

    it('review RM-6: the table the panel asks for after a race is not said again', () => {
        const { rp, told } = page(1);
        rp.onMsg({ type: 'race', state: 'prep', course: 'g1.7', laps: 2, by: 0, racers: [0, 1], ready: [] });
        const table = [row(1, 'Bob', 1, 4200), row(0, 'Ann', 2, 4300)];
        rp.onMsg({ type: 'race', state: 'results', course: 'g1.7', table });
        const n = told.length;
        rp.onMsg({ type: 'race', state: 'results', course: 'g1.7', table });
        expect(told.length).toBe(n);
        const late = page(0);
        late.rp.onMsg({ type: 'race', state: 'results', course: 'g1.7', table });
        expect(late.told).toEqual([]);
        expect(late.rp.h.table.length).toBe(2);
    });

    it('review RM-9: a pilot in a freed slot hears no place of another and says he races next time', () => {
        const { rp, told } = page(1);
        const table = [row(1, 'Bob', 1, 4200), row(0, 'Ann', 2, 4300)];
        rp.onMsg({ type: 'race', state: 'run', course: 'g1.7', laps: 2, by: 0, racers: [0], ready: [0], startAt: 5, table });
        expect(told).toEqual(['rooms.race.watching']);
        expect(rp.standing()).toBeNull();
        rp.onMsg({ type: 'race', state: 'results', course: 'g1.7', table });
        expect(told.at(-1)).toBe('rooms.race.results');
    });

    it('review RM-14: a member on another scan is no racer and builds nothing', () => {
        const { rp, sent } = page(1, 'y');
        rp.onMsg({ type: 'race', state: 'prep', course: 'g1.7', laps: 2, by: 0, racers: [0, 1], ready: [] });
        expect(rp.h.racer).toBe(false);
        expect(sent).toEqual([]);
    });

    it('review RM-3 and RM-10: a course the page cannot build and a refused proposal each say a line', async () => {
        const { rp, told } = page(1);
        rp.onMsg({ type: 'race', state: 'prep', course: 'zz', laps: 2, by: 0, racers: [0, 1], ready: [] });
        await new Promise((r) => setTimeout(r, 0));
        expect(told).toContain('rooms.race.noCourse');
        rp.onMsg({ type: 'race', state: 'wait', course: 'g1.7' });
        expect(told.at(-1)).toBe('rooms.race.wait');
    });
});

describe('review RM-4: an open room flies the default size and walls', () => {
    it('puts the defaults in the visit layer and clears them on leaving', () => {
        const visit = new Map<string, unknown>();
        const prefs = {
            defaultOf: (id: string) => (id === 'scene.walls' ? true : null),
            setVisit: (_s: string, id: string, v: unknown) => { visit.set(id, v); return { ok: true as const, value: v }; },
            clearVisit: (_s: string, id?: string) => { if (id) visit.delete(id); }
        };
        const ids = openVisit(prefs as never, 'x');
        expect(ids).toEqual(['scene.transform', 'scene.walls']);
        expect(visit.get('scene.transform')).toEqual({ s: 1, t: [0, 0, 0], v: 0 });
        expect(visit.get('scene.walls')).toBe(true);
        closeVisit(prefs, 'x', ids);
        expect(visit.size).toBe(0);
    });
});
