// The end-of-flight stats behind the card and the summary panel (apps/fly/src/app/builtin/
// summary-stats.ts; docs/architecture-v03.md D.2, item 7), in Node on the real FlightStats of
// sim-core and the real PrefsStore. Claims, each with a negative control that must fire:
//  - the page session survives a rebuilt flight model (control: the session's own FlightStats
//    starts from zero again);
//  - the lifetime totals per drone add what was flown since the last write, never twice (control: a
//    writer that adds the whole session each time counts the first flight model twice);
//  - the totals survive a new store on the same storage, i.e. a reload (control: other storage, a
//    fresh browser context, starts at zero);
//  - only a switch disarm after 3 s shows the card (controls: a crash, 2.9 s, the setting off);
//  - a keyboard throttle left at 40 % does not close the card, a push does (control: the plain
//    "above 25 %" rule closes it at once);
//  - the card's air time text is within 0.05 s of the number (the browser check allows 0.1 s).
import { describe, expect, it } from 'vitest';
import { FlightStats, S } from '../../../packages/sim-core/src/index';
import type { StatsBlock, StatsSource } from '../../../packages/sim-core/src/index';
import { MemoryBackend } from '../../../packages/prefs/src';
import type { PrefsStore } from '../../../packages/prefs/src';
import { mkStore } from '../../../packages/prefs/test/helpers';
import {
    StatsLedger, cardOnDisarm, statsCsv, statsFile, statsFileName, emptyStats, fmtClock, mergeStats, statText, statsText, throttleDismisses, zeroTotals, STAT_ROWS,
    CARD_MIN_AIRTIME_S
} from '../../../apps/fly/src/app/builtin/summary-stats';
import type { TotalsStore } from '../../../apps/fly/src/app/builtin/summary-stats';

const W = { kmh: 'km/h', mph: 'mph', m: 'm', ft: 'ft', km: 'km', mi: 'mi' };

/** A flight model's stats driven by a scripted state: armed, 1 m/s along +x, `seconds` long, `crashes` crash events. */
class Model {
    readonly stats = new FlightStats([0, 1, 0], 550);
    private s = new Float64Array(S.size);
    private src: StatsSource & { tick: number };
    constructor() {
        this.s[S.py] = 1; this.s[S.qw] = 1; this.s[S.volt] = 12.1; this.s[S.amps] = 6;
        this.src = { s: this.s, tick: 0, ch: new Float64Array([0, 0, 0.2, 0, 1, -1, 0, 0]), p: { gravity: 9.81 } };
        this.stats.onStep(this.src);
    }
    fly(seconds: number, crashes = 0): this {
        this.stats.onEvent({ type: 'arm', tick: this.src.tick + 1 });
        for (let i = 0; i < seconds * 1000; i++) {
            this.src.tick++;
            this.s[S.armed] = 1;
            this.s[S.vx] = 1;
            this.s[S.px] += 0.001;
            this.stats.onStep(this.src);
        }
        for (let c = 0; c < crashes; c++) this.stats.onEvent({ type: 'crash', tick: this.src.tick, speed: 5, nx: 1, ny: 0, nz: 0, px: 0, py: 0, pz: 0 });
        this.s[S.armed] = 0;
        return this;
    }
}

const store = (backend = new MemoryBackend()): PrefsStore => mkStore(backend);
const totals = (p: TotalsStore, drone: string) => p.collection('stats').byDrone[drone] ?? zeroTotals();

describe('page session across flight models', () => {
    it('a rebuilt flight model (new FlightStats) keeps the session: 10 s + 5 s = 15 s, 15 m; control: the new FlightStats alone says 5 s', () => {
        const ledger = new StatsLedger(store());
        const a = new Model().fly(10, 1);
        ledger.track(a.stats, 'pavo20pro-3s');
        const b = new Model();
        ledger.track(b.stats, 'pavo20pro-3s'); // the menu's Restart, a new drone, the walls switch...
        b.fly(5);
        const s = ledger.session();
        expect(s.airtimeS).toBeCloseTo(15, 9);
        expect(Math.abs(s.distance - 15)).toBeLessThan(0.002);
        expect(s.crashes).toBe(1);
        expect(s.flights).toBe(2);
        expect(ledger.life().airtimeS).toBeCloseTo(5, 9);
        // control: what the session's own stats object knows after the rebuild
        expect(b.stats.session().airtimeS).toBeCloseTo(5, 9);
        expect(b.stats.session().crashes).toBe(0);
    });

    it('mergeStats: sums, maxima, the lower battery of blocks that flew, throttle weighted by air time', () => {
        const a: StatsBlock = { ...emptyStats(), airtimeS: 10, maxSpeed: 12, distance: 30, minVolt: 10.8, endVolt: 11.2, avgThrottle: 0.5, crashes: 2, respawns: { crash: 2 }, maxAlt: 4, scenes: 1, flights: 1 };
        const b: StatsBlock = { ...emptyStats(), airtimeS: 30, maxSpeed: 9, distance: 60, minVolt: 11.0, endVolt: 11.4, avgThrottle: 0.3, crashes: 1, respawns: { crash: 1, 'manual-start': 1 }, maxAlt: 2, scenes: 1, flights: 2 };
        const m = mergeStats(a, b);
        expect(m).toMatchObject({ airtimeS: 40, maxSpeed: 12, distance: 90, minVolt: 10.8, endVolt: 11.4, crashes: 3, maxAlt: 4, scenes: 1, flights: 3 });
        expect(m.avgThrottle).toBeCloseTo((0.5 * 10 + 0.3 * 30) / 40, 12);
        expect(m.respawns).toEqual({ crash: 3, 'manual-start': 1 });
        // a block that never flew does not bring its resting voltage in as the minimum
        expect(mergeStats(a, { ...emptyStats(), minVolt: 12.6, endVolt: 12.6 }).minVolt).toBe(10.8);
    });
});

describe('lifetime totals per drone (prefs collection stats)', () => {
    it('commits add only what was flown since the last one, across a rebuild; control: adding the whole session each time counts twice', () => {
        const p = store();
        const ledger = new StatsLedger(p);
        const a = new Model();
        ledger.track(a.stats, 'pavo20pro-3s');
        a.fly(4);
        expect(ledger.commit()).toBe(true);
        a.fly(6, 1);
        ledger.commit();
        expect(ledger.commit()).toBe(false); // nothing new: no write
        const b = new Model();
        ledger.track(b.stats, 'pavo20pro-3s'); // commits a's rest, if any
        b.fly(5);
        ledger.commit();
        const t = totals(p, 'pavo20pro-3s');
        expect(t.airtimeS).toBeCloseTo(15, 9);
        expect(t.flights).toBe(3);
        expect(t.crashes).toBe(1);
        expect(Math.abs(t.distanceM - 15)).toBeLessThan(0.003);
        expect(ledger.lifetime().airtimeS).toBeCloseTo(15, 9);

        // control: the naive writer (total += the session's numbers at every write)
        const q = store();
        const naive = (st: FlightStats) => q.updateCollection('stats', (d) => {
            const o = d.byDrone['pavo20pro-3s'] ?? zeroTotals();
            const s = st.session();
            d.byDrone['pavo20pro-3s'] = { flights: o.flights + s.flights, airtimeS: o.airtimeS + s.airtimeS, distanceM: o.distanceM + s.distance, crashes: o.crashes + s.crashes };
        });
        const c = new Model().fly(4);
        naive(c.stats);
        c.fly(6, 1);
        naive(c.stats);
        expect(totals(q, 'pavo20pro-3s').airtimeS).toBeCloseTo(14, 9); // 4 + (4 + 6): the first 4 s twice
    });

    it('uncommitted air time shows in lifetime() of the drone flying now, not of another drone', () => {
        const ledger = new StatsLedger(store());
        const a = new Model();
        ledger.track(a.stats, 'pavo20pro-3s');
        a.fly(3);
        expect(ledger.lifetime().airtimeS).toBeCloseTo(3, 9);
        expect(ledger.lifetime('air65-1s').airtimeS).toBe(0);
        const b = new Model();
        ledger.track(b.stats, 'air65-1s'); // another drone: a's 3 s stay with pavo20pro-3s
        b.fly(2);
        ledger.commit();
        expect(ledger.lifetime('pavo20pro-3s').airtimeS).toBeCloseTo(3, 9);
        expect(ledger.lifetime('air65-1s').airtimeS).toBeCloseTo(2, 9);
    });

    it('a reload (a new store on the same storage) keeps the totals; control: other storage (a fresh context) starts at zero', () => {
        const backend = new MemoryBackend();
        const p = store(backend);
        const ledger = new StatsLedger(p);
        const a = new Model();
        ledger.track(a.stats, 'pavo20pro-3s');
        a.fly(7, 2);
        ledger.commit();
        p.flush();
        const again = store(backend);
        expect(totals(again, 'pavo20pro-3s')).toMatchObject({ flights: 1, crashes: 2 });
        expect(totals(again, 'pavo20pro-3s').airtimeS).toBeCloseTo(7, 9);
        expect(new StatsLedger(again).lifetime('pavo20pro-3s').airtimeS).toBeCloseTo(7, 9);
        expect(totals(store(new MemoryBackend()), 'pavo20pro-3s')).toEqual(zeroTotals());
    });
});

describe('the card', () => {
    const life = (s: number): StatsBlock => ({ ...emptyStats(), airtimeS: s });
    it('a switch disarm after 3 s shows it; a crash, 2.9 s or the setting off do not', () => {
        expect(cardOnDisarm({ type: 'disarm', tick: 1, reason: 'switch' }, life(CARD_MIN_AIRTIME_S), true)).toBe(true);
        expect(cardOnDisarm({ type: 'disarm', tick: 1, reason: 'crash' }, life(10), true)).toBe(false);
        expect(cardOnDisarm({ type: 'disarm', tick: 1, reason: 'switch' }, life(2.9), true)).toBe(false);
        expect(cardOnDisarm({ type: 'disarm', tick: 1, reason: 'switch' }, life(10), false)).toBe(false);
        expect(cardOnDisarm({ type: 'arm', tick: 1 }, life(10), true)).toBe(false);
    });

    it('throttle: a keyboard throttle left at 40 % keeps it, a push to 50 % closes it, a radio from 0 closes above 25 %; control: the plain level rule closes the 40 % card at once', () => {
        expect(throttleDismisses(0.4, 0.4)).toBe(false);
        expect(throttleDismisses(0.4, 0.5)).toBe(true);
        expect(throttleDismisses(0, 0.25)).toBe(false);
        expect(throttleDismisses(0, 0.26)).toBe(true);
        const plain = (thr: number) => thr > 0.25;
        expect(plain(0.4)).toBe(true); // the control fires: the card would never be seen
    });

    it('air time text: m:ss.t within 0.05 s of the number, carried at 59.96 s, h:mm:ss above an hour', () => {
        expect(fmtClock(12.34)).toBe('0:12.3');
        expect(fmtClock(59.96)).toBe('1:00.0');
        expect(fmtClock(3725.4)).toBe('1:02:05');
        expect(fmtClock(-1)).toBe('0:00.0');
        const parse = (s: string) => { const [m, r] = s.split(':'); return Number(m) * 60 + Number(r); };
        for (let x = 3; x < 200; x += 0.0137) expect(Math.abs(parse(fmtClock(x)) - x)).toBeLessThanOrEqual(0.05 + 1e-9);
    });

    it('values with units: km/h and m, mph and ft; lifetime rows only for flights, air time, distance, crashes', () => {
        const b: StatsBlock = { ...emptyStats(), airtimeS: 12, maxSpeed: 10, maxAlt: 3, distance: 120, minVolt: 10.95, maxG: 2.44, avgThrottle: 0.456, usedMah: 31.6 };
        expect(statText('maxSpeed', b, null, 'metric', W)).toBe('36 km/h');
        expect(statText('maxSpeed', b, null, 'imperial', W)).toBe('22 mph');
        expect(statText('maxAlt', b, null, 'imperial', W)).toBe('9.8 ft');
        expect(statText('minVolt', b, null, 'metric', W)).toBe('10.95 V');
        expect(statText('avgThrottle', b, null, 'metric', W)).toBe('46 %');
        expect(statText('distance', null, { flights: 3, airtimeS: 4000, distanceM: 2500, crashes: 1 }, 'metric', W)).toBe('2.5 km');
        expect(statText('airtime', null, { flights: 3, airtimeS: 4000, distanceM: 2500, crashes: 1 }, 'metric', W)).toBe('1:06:40');
        expect(STAT_ROWS.filter((r) => r.lifetime).map((r) => r.id).sort()).toEqual(['airtime', 'crashes', 'distance', 'flights']);
        expect(STAT_ROWS.filter((r) => r.card).length).toBeGreaterThanOrEqual(8);
        expect(STAT_ROWS.filter((r) => r.card).length).toBeLessThanOrEqual(10);
        expect(STAT_ROWS.filter((r) => r.core).length).toBe(4);
    });

    it('Copy stats: a title, the three headings and one aligned row per stat', () => {
        const b: StatsBlock = { ...emptyStats(), airtimeS: 12.3, maxSpeed: 10 };
        const text = statsText({ title: 'T', heads: ['Life', 'Session', 'All'], label: (id) => `L-${id}`, life: b, session: b, lifetime: { flights: 1, airtimeS: 12.3, distanceM: 5, crashes: 0 }, units: 'metric', words: W });
        const lines = text.split('\n');
        expect(lines[0]).toBe('T');
        expect(lines[2]).toMatch(/Life\s+Session\s+All$/);
        expect(lines.length).toBe(3 + STAT_ROWS.length);
        for (const r of STAT_ROWS) expect(text).toContain(`L-${r.id}`);
        expect(lines.find((l) => l.startsWith('L-airtime'))).toMatch(/0:12\.3\s+0:12\.3\s+0:12\.3$/);
        // the columns line up: every row is as long as the heading row or shorter only by trailing blanks
        const widths = new Set(lines.slice(2).map((l) => l.length));
        expect(widths.size).toBe(1);
    });
});

describe('the stats last: stored, exported, imported, and saved as a file (owner\'s message 16)', () => {
    const TOTALS = { 'pavo20pro-3s': { flights: 12, airtimeS: 3725.4, distanceM: 18234.6, crashes: 7 }, 'tinyhawk-1s': { flights: 3, airtimeS: 61, distanceM: 410, crashes: 1 } };
    const fill = (s: PrefsStore) => s.updateCollection('stats', (d) => { d.byDrone = JSON.parse(JSON.stringify(TOTALS)); });

    it('a later page on the same storage has them (the document is written at once); control: another storage does not', () => {
        const b = new MemoryBackend();
        fill(mkStore(b));
        expect(mkStore(b).collection('stats').byDrone).toEqual(TOTALS);
        expect(mkStore(new MemoryBackend()).collection('stats').byDrone).toEqual({});
    });

    it('Settings -> Data export carries them and an import restores them; control: an export without the collection does not', () => {
        const a = mkStore(new MemoryBackend());
        fill(a);
        const file = JSON.parse(JSON.stringify(a.exportFile()));
        const fresh = mkStore(new MemoryBackend());
        expect(fresh.importFile(file).ok).toBe(true);
        expect(fresh.collection('stats').byDrone).toEqual(TOTALS);
        const without = mkStore(new MemoryBackend());
        without.importFile(JSON.parse(JSON.stringify(a.exportFile({ include: ['ui'] }))));
        expect(without.collection('stats').byDrone).toEqual({});
    });

    it('"Save my stats": every drone and the total, SI units, as JSON and as a CSV table', () => {
        const f = statsFile(TOTALS, (id) => (id === 'pavo20pro-3s' ? 'Pavo20 Pro, 3S' : id), new Date('2026-10-02T12:00:00Z'));
        expect(f.drones.map((d) => d.id)).toEqual(['pavo20pro-3s', 'tinyhawk-1s']);
        expect(f.total).toEqual({ flights: 15, airtimeS: 3786.4, distanceM: 18644.6, crashes: 8 });
        const csv = statsCsv(f).split('\r\n');
        expect(csv[0]).toBe('drone_id,drone,flights,airtime_s,airtime,distance_m,crashes');
        expect(csv[1]).toBe('pavo20pro-3s,"Pavo20 Pro, 3S",12,3725.4,1:02:05,18234.6,7'); // a comma in a name is quoted
        expect(csv[3]).toBe('total,,15,3786.4,1:03:06,18644.6,8');
        expect(csv).toHaveLength(5); // header, 2 drones, total, the empty end after the last line break
        expect(statsFileName(new Date('2026-10-02T12:00:00Z'), 'csv')).toBe('gsfpv-stats-2026-10-02.csv');
    });

    it('control: with no drone flown the file still has its total row of zeros', () => {
        expect(statsCsv(statsFile({}, (id) => id, new Date(0))).split('\r\n')[1]).toBe('total,,0,0,0:00,0,0');
    });
});
