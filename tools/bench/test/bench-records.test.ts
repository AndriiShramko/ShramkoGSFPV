// Review findings LQ-1 and LQ-2 of lane laptop4. LQ-1: the score record of lod-view-score.mjs kept the --rows band
// under the key 'rows' and the results under 'rows' again, so the band was lost. LQ-2: startStockBrowser
// (gpu-select-probe.mjs, used by lod-view-probe.mjs) built its own command line and ignored BENCH_UNCAPPED=1.
// No browser is started. Negative control: on the old files the two exports are missing.
import { describe, expect, it } from 'vitest';
// @ts-ignore plain .mjs script without types
import * as score from '../scripts/lod-view-score.mjs';
// @ts-ignore plain .mjs script without types
import * as stock from '../scripts/gpu-select-probe.mjs';

describe('lod-view-score record', () => {
    it('keeps the band and the result rows apart', () => {
        expect(typeof score.scoreRecord).toBe('function');
        const results = [{ label: 'a', picture: 'p', psnrLit: 18 }];
        const r = score.scoreRecord({ ref: 'ref16', labels: ['a'], band: [0.5, 1], rows: results, date: 'd' });
        expect(r.band).toEqual([0.5, 1]);
        expect(r.rows).toEqual(results);
    });
    it('records a whole-picture pass as band null', () => {
        expect(typeof score.scoreRecord).toBe('function');
        expect(score.scoreRecord({ ref: 'r', labels: ['a'], band: null, rows: [], date: 'd' }).band).toBeNull();
    });
});

describe('startStockBrowser command line', () => {
    const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
    it('adds the uncapped flags with BENCH_UNCAPPED=1 and records them', () => {
        expect(typeof stock.stockLaunchArgs).toBe('function');
        const { args, added } = stock.stockLaunchArgs({ profile: 'P', maximized: true, variantArgs: ['--v'], extra: ['--x'], env: { BENCH_UNCAPPED: '1' } });
        for (const f of UNCAPPED) {
            expect(args).toContain(f);
            expect(added).toContain(f);
        }
        expect(args[0]).toBe('--user-data-dir=P');
        expect(args[args.length - 1]).toBe('about:blank');
        expect(added).toEqual(['--start-maximized', '--v', '--x', ...UNCAPPED]);
    });
    it('leaves them out by default', () => {
        expect(typeof stock.stockLaunchArgs).toBe('function');
        const { args } = stock.stockLaunchArgs({ profile: 'P', env: {} });
        for (const f of UNCAPPED) expect(args).not.toContain(f);
        expect(args).toContain('--window-size=1296,920');
    });
});
