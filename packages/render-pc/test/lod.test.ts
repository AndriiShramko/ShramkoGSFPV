// v0.8 lane C (the owner's item 8): the lod-meta.json check the renderer runs before the engine sees the
// file, and the level-of-detail mode it reports. The positive case is a real SuperSplat file
// (fixtures/lod-meta-39e63ce9.json, the showcase Modlinek Villa, 4 levels in 13 files). The control is the
// engine itself: playcanvas 2.23's GSplatOctreeResource constructor, the code that runs inside the engine's
// HTTP callback (framework/parsers/gsplat-octree.js) with no try/catch, so whatever throws there leaves a
// page that waits forever. Every file the engine throws on must be refused by the check.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lodMetaProblem, lodMode, MAX_LOD_LEVELS } from '../src/lod';

const REAL = JSON.parse(readFileSync(new URL('./fixtures/lod-meta-39e63ce9.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const copy = (): Record<string, any> => structuredClone(REAL) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The real file with one change made by `edit` to a copy. */
function broken(edit: (j: Record<string, any>) => void): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const j = copy();
    edit(j);
    return j;
}

/** The first leaf of a tree (a node with lods), depth first. */
function firstLeaf(j: Record<string, any>): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    let n = j.tree;
    while (!n.lods) n = n.children[0];
    return n;
}

/** The engine's constructor of a lod-meta.json resource (not exported by the package: loaded by path). */
type EngineCtor = new (url: string, data: unknown, loader: unknown) => { octree: { nodes: unknown[] } };
let Engine: EngineCtor;
beforeAll(async () => {
    const main = createRequire(import.meta.url).resolve('playcanvas'); // build/playcanvas.js
    const file = join(dirname(main), 'playcanvas', 'src', 'scene', 'gsplat-unified', 'gsplat-octree.resource.js');
    Engine = ((await import(pathToFileURL(file).href)) as { GSplatOctreeResource: EngineCtor }).GSplatOctreeResource;
});

/** Does the engine's constructor throw on this file (what would hang the page)? */
function engineThrows(json: unknown): boolean {
    try {
        new Engine('https://cdn.example/scene/v1/lod-meta.json', structuredClone(json), null);
        return false;
    } catch {
        return true;
    }
}

// files the engine itself throws on: top-level shapes and (review finding, 2026-10-16) the leaves' data
const ENGINE_THROWS: Array<[string, unknown]> = [
    ['null', null],
    ['no filenames', broken((j) => { delete j.filenames; })],
    ['a filename that is not a string', broken((j) => { j.filenames = [1, 2]; })],
    ['no tree', broken((j) => { delete j.tree; })],
    ['an error page as JSON', { message: 'Access Denied' }],
    ['the tree without its bound', broken((j) => { delete j.tree.bound; })],
    ['a leaf without its bound', broken((j) => { delete firstLeaf(j).bound; })],
    ['a leaf whose bound has no min', broken((j) => { delete firstLeaf(j).bound.min; })],
    ['a level whose file is past the filenames', broken((j) => { firstLeaf(j).lods['0'].file = j.filenames.length; })],
    ['a level with no file index', broken((j) => { delete firstLeaf(j).lods['1'].file; })],
    ['a level that is a number', broken((j) => { firstLeaf(j).lods['0'] = 7; })],
    ['a child that is null', broken((j) => { j.tree.children.push(null); })],
    ['children that are not a list', broken((j) => { j.tree.children = { 0: j.tree.children[0] }; })],
    ['environment that is not a file name', broken((j) => { j.environment = 42; })]
];

// files the engine opens without throwing, but with nothing (or nonsense) to draw: refused as well, so the
// session falls back to the scene's single file instead of showing an empty or broken scan
const ENGINE_OPENS_BUT_BROKEN: Array<[string, unknown]> = [
    ['a string', 'lod-meta'],
    ['an array', [REAL]],
    ['empty filenames', broken((j) => { j.filenames = []; })],
    ['lodLevels 0', broken((j) => { j.lodLevels = 0; })],
    ['lodLevels as text', broken((j) => { j.lodLevels = '4'; })],
    ['lodLevels 2.5', broken((j) => { j.lodLevels = 2.5; })],
    ['lodLevels above the limit', broken((j) => { j.lodLevels = MAX_LOD_LEVELS + 1; })],
    ['a tree without leaves', broken((j) => { j.tree = { bound: j.tree.bound, children: [] }; })],
    ['a leaf bound of text', broken((j) => { firstLeaf(j).bound.max = ['a', 'b', 'c']; })],
    ['a fractional file index', broken((j) => { firstLeaf(j).lods['0'].file = 1.5; })]
];

describe('lodMetaProblem', () => {
    it('a real SuperSplat lod-meta.json opens, in the check and in the engine', () => {
        expect(REAL.lodLevels).toBe(4);
        expect(lodMetaProblem(REAL)).toBeNull();
        expect(engineThrows(REAL)).toBe(false);
    });

    it.each(ENGINE_THROWS)('%s: the engine throws in its HTTP callback (control), the check refuses it first', (_name, json) => {
        expect(engineThrows(json)).toBe(true);
        const p = lodMetaProblem(json);
        expect(typeof p).toBe('string');
        expect(p!.length).toBeGreaterThan(3);
    });

    it.each(ENGINE_OPENS_BUT_BROKEN)('%s is refused although the engine would not throw', (_name, json) => {
        expect(typeof lodMetaProblem(json)).toBe('string');
    });

    it('negative control: the old top-level check (before the review) let the leaf cases through to the engine', () => {
        // the check as it was at eef522b: lodLevels, filenames and an object tree only
        const topLevelOnly = (j: unknown): boolean => {
            const m = j as { lodLevels?: unknown; filenames?: unknown; tree?: unknown } | null;
            return !!m && typeof m === 'object' && !Array.isArray(m) && Number.isInteger(m.lodLevels) && (m.lodLevels as number) >= 1
                && Array.isArray(m.filenames) && m.filenames.length > 0 && m.filenames.every((f) => typeof f === 'string' && f.length > 0)
                && !!m.tree && typeof m.tree === 'object' && !Array.isArray(m.tree);
        };
        const slipped = ENGINE_THROWS.filter(([, j]) => topLevelOnly(j)).map(([name]) => name);
        expect(slipped.length).toBeGreaterThanOrEqual(8); // every leaf and node case: the page would wait forever
        expect(slipped).toContain('a leaf without its bound');
        expect(slipped).toContain('a level whose file is past the filenames');
    });

    it('the owner\'s city scan ba7aa29d (10 levels, 257 files, 1272 leaves) passes; its shape stands in the fixture header', () => {
        // the real file is 143 kB; the walk is linear: a synthetic tree of the same size checks in well under 50 ms
        const leaves = Array.from({ length: 1272 }, (_, k) => ({
            bound: { min: [k, 0, 0], max: [k + 1, 1, 1] },
            lods: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), { file: (k * 10 + i) % 257, offset: 0, count: 100 }]))
        }));
        const big = { lodLevels: 10, filenames: Array.from({ length: 257 }, (_, i) => `${i % 10}_${i}/meta.json`), tree: { bound: { min: [0, 0, 0], max: [1272, 1, 1] }, children: leaves } };
        const t0 = performance.now();
        expect(lodMetaProblem(big)).toBeNull();
        expect(performance.now() - t0).toBeLessThan(50);
        expect(engineThrows(big)).toBe(false);
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
