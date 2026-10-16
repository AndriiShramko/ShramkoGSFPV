// v0.8 lane C (the owner's item 8): the lod-meta.json check the renderer runs before the engine sees the
// file, and the level-of-detail mode it reports. The positive case is a real SuperSplat file
// (fixtures/lod-meta-39e63ce9.json, the showcase Modlinek Villa, 4 levels in 13 files); every broken
// variant is one the engine's GSplatOctree constructor would throw on inside its HTTP callback.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lodMetaProblem, lodMode, MAX_LOD_LEVELS } from '../src/lod';

const REAL = JSON.parse(readFileSync(new URL('./fixtures/lod-meta-39e63ce9.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** What the engine's constructor touches first (playcanvas 2.23 GSplatOctree): a stand-in for the throw. */
function engineWouldThrow(json: unknown): boolean {
    try {
        const d = json as { lodLevels: number; filenames: string[]; tree: { children?: unknown[] } };
        d.filenames.map((u) => u.length);
        if (typeof d.tree !== 'object' || d.tree === null) throw new TypeError('tree');
        if (!(d.lodLevels >= 1)) throw new RangeError('lodLevels');
        return false;
    } catch {
        return true;
    }
}

describe('lodMetaProblem', () => {
    it('a real SuperSplat lod-meta.json opens', () => {
        expect(REAL.lodLevels).toBe(4);
        expect(lodMetaProblem(REAL)).toBeNull();
        expect(engineWouldThrow(REAL)).toBe(false);
    });

    const BROKEN: Array<[string, unknown]> = [
        ['null', null],
        ['a string', 'lod-meta'],
        ['an array', [REAL]],
        ['an error page as JSON', { message: 'Access Denied' }],
        ['no filenames', { ...REAL, filenames: undefined }],
        ['empty filenames', { ...REAL, filenames: [] }],
        ['a filename that is not a string', { ...REAL, filenames: [1, 2] }],
        ['no tree', { ...REAL, tree: undefined }],
        ['lodLevels 0', { ...REAL, lodLevels: 0 }],
        ['lodLevels as text', { ...REAL, lodLevels: '4' }],
        ['lodLevels 2.5', { ...REAL, lodLevels: 2.5 }],
        ['lodLevels above the limit', { ...REAL, lodLevels: MAX_LOD_LEVELS + 1 }]
    ];

    it.each(BROKEN)('%s is refused with a reason', (_name, json) => {
        const p = lodMetaProblem(json);
        expect(typeof p).toBe('string');
        expect(p!.length).toBeGreaterThan(3);
    });

    it('negative control: without the check most of these reach the engine and throw there', () => {
        // the shapes the engine itself chokes on (missing lists, wrong types) are all refused by the check
        const reachEngine = BROKEN.filter(([, j]) => engineWouldThrow(j));
        expect(reachEngine.length).toBeGreaterThanOrEqual(6);
        expect(reachEngine.every(([, j]) => lodMetaProblem(j) !== null)).toBe(true);
    });
});

describe('lodMode', () => {
    it.each([
        ['lod-meta', 10, 9, 9, 'coarse'],
        ['lod-meta', 10, 0, 9, 'auto'],
        ['lod-meta', 10, 0, 0, 'final'],
        ['lod-meta', 1, 0, 0, 'single'],
        ['meta', 1, 0, 0, 'single'],
        [null, 0, 0, 0, 'single']
    ] as const)('%s with %i levels, range %i..%i -> %s', (kind, levels, min, max, want) => {
        expect(lodMode(kind, levels, min, max)).toBe(want);
    });
});
