// Lane race, L3 and L4: the order of the live board, the lead change and the banner's text and timing (apps/fly/src/rooms/lead.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RoomBoard } from '../../../apps/fly/src/rooms/board';
import type { BoardRow, LapMsg } from '../../../apps/fly/src/rooms/board';
import { BANNER_MS, LeadBanner, boardShown, fmtLap, leadChange, leadLine, viewRows } from '../../../apps/fly/src/rooms/lead';

const lap = (slot: number, nick: string, n: number, ms: number, best = ms): LapMsg => ({ type: 'blap', course: 'g1.7', slot, nick, n, ms, best, lead: false });
const members = [{ slot: 0, nick: 'Ann' }, { slot: 1, nick: 'Bob' }, { slot: 2, nick: 'Cid' }];

describe('live board and lead change (lane race R2)', () => {
    it('writes a lap time as m:ss.cc', () => {
        expect(fmtLap(41270)).toBe('0:41.27');
        expect(fmtLap(5233)).toBe('0:05.23');
        expect(fmtLap(61005)).toBe('1:01.01');
        expect(fmtLap(59999)).toBe('1:00.00');
    });

    it('is shown only with a course, two or more pilots and no pause menu', () => {
        expect(boardShown('g1.7', 2, false)).toBe(true);
        expect(boardShown('g1.7', 1, false)).toBe(false);
        expect(boardShown(null, 3, false)).toBe(false);
        expect(boardShown('g1.7', 2, true)).toBe(false);
    });

    it('orders the rows by the best lap, pilots without a lap below, the own row marked, the gone left out', () => {
        const b = new RoomBoard(() => 1);
        b.onBoard({ type: 'board', course: 'g1.7', rows: [] });
        b.onLap(lap(0, 'Ann', 1, 41270));
        b.onLap(lap(3, 'Gone', 1, 30000));
        b.onLap(lap(1, 'Bob', 1, 40100));
        const v = viewRows(b.rows, members, 1);
        expect(v.map((r) => [r.place, r.nick, r.best, r.laps, r.mine])).toEqual([
            [1, 'Bob', '0:40.10', 1, true],
            [2, 'Ann', '0:41.27', 1, false],
            [null, 'Cid', '-', 0, false]
        ]);
    });

    it('a better lap takes the lead; a slower lap gives no banner; an equal time keeps the first pilot', () => {
        const rows: BoardRow[] = [{ slot: 0, nick: 'Ann', best: 41270, laps: 1 }];
        expect(leadChange(rows, lap(1, 'Bob', 1, 40100), 0)).toEqual({ slot: 1, nick: 'Bob', ms: 40100, mine: false });
        expect(leadChange(rows, lap(1, 'Bob', 1, 42000), 0)).toBeNull();
        expect(leadChange(rows, lap(1, 'Bob', 1, 41270), 0)).toBeNull();
        expect(leadChange([], lap(0, 'Ann', 1, 41270), 0)).toEqual({ slot: 0, nick: 'Ann', ms: 41270, mine: true });
        expect(leadChange(rows, lap(1, 'Bob', 1, 0), 0)).toBeNull();
        // an equal best stays below the pilot who flew it first on the board too
        const b = new RoomBoard(() => 0);
        b.onBoard({ type: 'board', course: 'g1.7', rows: [] });
        b.onLap(lap(0, 'Ann', 1, 41270));
        b.onLap(lap(1, 'Bob', 1, 41270));
        expect(viewRows(b.rows, members, 0).map((r) => r.nick).slice(0, 2)).toEqual(['Ann', 'Bob']);
    });

    it('the banner says who leads and with what time, the own takeover in its own words, for BANNER_MS', () => {
        expect(leadLine({ slot: 1, nick: 'Bob', ms: 40100, mine: false })).toEqual({ key: 'rooms.lead.other', vars: { nick: 'Bob', time: '0:40.10' } });
        expect(leadLine({ slot: 0, nick: 'Ann', ms: 39000, mine: true }).key).toBe('rooms.lead.mine');
        expect(BANNER_MS).toBe(2000);
        const b = new LeadBanner();
        expect(b.at(0)).toBeNull();
        b.show({ slot: 1, nick: 'Bob', ms: 40100, mine: false }, 1000);
        expect(b.at(1000)?.nick).toBe('Bob');
        expect(b.at(2999)?.nick).toBe('Bob');
        b.show({ slot: 0, nick: 'Ann', ms: 39000, mine: true }, 2500);
        expect(b.at(2999)?.nick).toBe('Ann');
        expect(b.at(4499)?.nick).toBe('Ann');
        expect(b.at(4500)).toBeNull();
    });

    it('has the banner texts in en, es, pl and ru with the name and the time', () => {
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const d = JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/rooms/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>;
            expect(d['rooms.lead.other']).toContain('{nick}');
            expect(d['rooms.lead.other']).toContain('{time}');
            expect(d['rooms.lead.mine']).toContain('{time}');
        }
    });
});
