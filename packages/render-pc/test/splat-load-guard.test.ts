// Which scan load still counts (voxux4, splat-load-guard.ts; used by renderer.ts loadSplat/unloadSplat for ux4b's cancel of a load).
// Control: a guard whose invalidate() does nothing keeps a load current after unloadSplat, and the first row fails.
import { describe, it, expect } from 'vitest';
import { SplatLoadCancelled, SplatLoadGuard, isSplatLoadCancelled } from '../src/splat-load-guard';

describe('SplatLoadGuard', () => {
    it('a load is stale after the scan was unloaded (invalidate)', () => {
        const g = new SplatLoadGuard();
        const t = g.begin();
        expect(g.isStale(t)).toBe(false);
        g.invalidate();
        expect(g.isStale(t)).toBe(true);
    });
    it('a newer load makes the older one stale, the newer one counts', () => {
        const g = new SplatLoadGuard();
        const a = g.begin();
        const b = g.begin();
        expect(g.isStale(a)).toBe(true);
        expect(g.isStale(b)).toBe(false);
    });
    it('a load begun after the unload counts (unload, then the next scene)', () => {
        const g = new SplatLoadGuard();
        g.begin();
        g.invalidate();
        const t = g.begin();
        expect(g.isStale(t)).toBe(false);
    });
    it('the cancel is its own error, told apart from a failure', () => {
        const e = new SplatLoadCancelled('lod-meta.json');
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('SplatLoadCancelled');
        expect(isSplatLoadCancelled(e)).toBe(true);
        expect(isSplatLoadCancelled(new Error('lod-meta.json: HTTP 404'))).toBe(false);
    });
});
