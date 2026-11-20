// Lane gap-save: a gate's size is checked in FLOWN metres (scene units x transform[0]), the unit a leg is checked in, so a
// course laid at any Scene size (the owner enlarges scans x15, brief lines 537-539, 559) saves. The table
// apps/api/tests/fixtures/track-sizes.json is shared with apps/api/tests/test_tracks_sizes.py (tracks.py); here it runs
// against the sound package's validateTrack and server.ts validateServerTrack. The courses stored before (scale 1) still
// pass: fixtures.test.ts reads every stored fixture with the same validators.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateTrack } from '@shramko/sonic-fpv';
import { validateServerTrack } from '../src';

const API = join(__dirname, '..', '..', '..', 'apps', 'api', 'tests', 'fixtures');
type Row = { name: string; scale: number; shape: Record<string, string | number>; ok: boolean; format_ok?: boolean };
const table = JSON.parse(readFileSync(join(API, 'track-sizes.json'), 'utf8')) as { rows: Row[] };
const basic = readFileSync(join(API, 'tracks', 'valid-basic.json'), 'utf8');

/** valid-basic.json flown at `scale`: the same flown course, every gate the row's shape (flown m / scale) */
function sizedTrack(row: Row): Record<string, unknown> {
    const t = JSON.parse(basic) as { transform: number[]; start: { pos: number[] }; gates: { pos: number[]; shape: unknown }[] };
    const s = row.scale;
    t.transform = [s, 0, 0, 0];
    t.start.pos = t.start.pos.map((x) => x / s);
    const shape = Object.fromEntries(Object.entries(row.shape).map(([k, v]) => [k, typeof v === 'number' ? v / s : v]));
    for (const g of t.gates) {
        g.pos = g.pos.map((x) => x / s);
        g.shape = { ...shape };
    }
    return t;
}

describe('gate sizes in flown metres (lane gap-save)', () => {
    it('the table holds every size the stage asks for', () => {
        for (const scale of [1, 5.6, 15, 100, 0.1]) {
            expect(table.rows.some((r) => r.name.startsWith('whoop') && r.scale === scale && r.ok)).toBe(true);
            expect(table.rows.some((r) => r.name.startsWith('5 inch') && r.scale === scale && r.ok)).toBe(true);
        }
    });
    for (const row of table.rows) {
        it(row.name, () => {
            const t = sizedTrack(row);
            const server = validateServerTrack(t);
            expect(server.ok ? [] : server.issues, `server.ts on ${row.name}`).toEqual(row.ok ? [] : expect.arrayContaining([expect.stringMatching(/^gates\[0\]\.shape/)]));
            const format = validateTrack(t);
            expect(format.ok ? [] : format.issues, `validateTrack on ${row.name}`).toEqual((row.format_ok ?? row.ok) ? [] : expect.arrayContaining([expect.objectContaining({ path: expect.stringMatching(/^gates\[0\]\.shape/) })]));
        });
    }
});
