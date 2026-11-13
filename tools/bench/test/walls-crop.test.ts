// Walls review WL-2: a browser build crops the scan to its dense core before voxelising, so a few
// floaters kilometres out (Wroclaw: a 13.5 km bound) do not make the voxeliser walk the whole bound.
// The real splat-transform DataTable, no GPU.
import { describe, expect, it } from 'vitest';
import { Column, DataTable } from '../../../apps/fly/node_modules/@playcanvas/splat-transform/dist/index.mjs';
import * as bakeModule from '../../../apps/fly/src/bake';

type Crop = (st: unknown, t: DataTable) => { table: DataTable; kept: number };
const cropToCore = (bakeModule as unknown as { cropToCore?: Crop }).cropToCore;

/** a 10 m cube of 20 000 points plus `far` floaters 13 km out, and a second column that follows the rows */
function scan(far: number): DataTable {
    const n = 20_000 + far;
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), id = new Float32Array(n);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < n; i++) {
        const out = i % Math.floor(n / Math.max(1, far)) === 0 && i / Math.floor(n / Math.max(1, far)) < far;
        x[i] = out ? 13_000 + i : rnd() * 10;
        y[i] = out ? -13_000 : rnd() * 10;
        z[i] = rnd() * 10;
        id[i] = out ? -1 : i;
    }
    return new DataTable([new Column('x', x), new Column('y', y), new Column('z', z), new Column('id', id)]);
}

describe('the browser build voxelises the dense core of a scan', () => {
    it('drops the far floaters and keeps every row of the core with its own columns', () => {
        const t = scan(20);
        const r = cropToCore ? cropToCore({ Column, DataTable }, t) : { table: t, kept: 1 };
        expect(r.table.numRows).toBe(20_000);
        const x = r.table.getColumnByName('x')!.data;
        const id = r.table.getColumnByName('id')!.data;
        let maxX = -Infinity, far = 0;
        for (let i = 0; i < r.table.numRows; i++) { maxX = Math.max(maxX, x[i]); if (id[i] < 0) far++; }
        expect(maxX).toBeLessThan(30);
        expect(far).toBe(0);
        expect(r.kept).toBeCloseTo(20_000 / 20_020, 6);
    });
    it('a scan without floaters is left as it is', () => {
        const t = scan(0);
        const r = cropToCore ? cropToCore({ Column, DataTable }, t) : { table: null, kept: 0 };
        expect(r.table).toBe(t);
        expect(r.kept).toBe(1);
    });
});
