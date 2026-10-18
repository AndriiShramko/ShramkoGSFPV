// The scene catalogue's shared rules (src/catalog.ts): reading the API's or the static list, the
// storefront split (Featured, collections, the rest in the admin's order), the admin's reorder.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG_SCALE_MAX, CATALOG_SCALE_MIN, collectionId, localText, moveItem, readCatalog, readScene, sceneDefaultScale, storefront } from '../src/catalog';

const SHOWCASE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'apps', 'fly', 'public', 'showcase.json'), 'utf8'));

describe('readCatalog', () => {
    it('reads the static showcase.json as it is (no collections, every scene)', () => {
        const c = readCatalog(SHOWCASE)!;
        expect(c.collections).toEqual([]);
        expect(c.scenes.map((s) => s.id)).toEqual(SHOWCASE.scenes.map((s: { id: string }) => s.id));
        expect(c.scenes[0]).toMatchObject({ title: SHOWCASE.scenes[0].title, walls: 'on', collision: true, voxelCm: 5 });
    });
    it('drops what is not a scene, duplicates and unknown fields; keeps the admin fields', () => {
        const c = readCatalog({
            collections: [{ id: 'cities', title: { en: 'Cities', ru: 'x' } }, { id: 'nope' }],
            scenes: [{ id: 'abcdef12', title: 'A', pinned: true, pitch: 'Go', collections: ['cities'], evil: 1, scale: 9 }, { id: 'abcdef12', title: 'dup' }, { id: '../x', title: 'B' }, 'junk']
        })!;
        expect(c.collections.map((x) => x.id)).toEqual(['cities']);
        // scale 9 is a valid default size since v0.9 (0.25..100)
        expect(c.scenes).toEqual([{ id: 'abcdef12', title: 'A', author: '', license: '', kind: 'other', collision: true, scale: 9, pinned: true, pitch: { en: 'Go' }, collections: ['cities'] }]);
        // control: no scene list at all is "no catalogue", not an empty one
        expect(readCatalog({ ok: false })).toBeNull();
        expect(readCatalog('<!doctype html>')).toBeNull();
    });
});

describe('storefront', () => {
    const cat = readCatalog({
        collections: [{ id: 'cities', title: { en: 'Cities' } }, { id: 'empty', title: { en: 'Nothing' } }],
        scenes: [
            { id: 'aaaaaa01', title: 'A' },
            { id: 'aaaaaa02', title: 'B', pinned: true },
            { id: 'aaaaaa03', title: 'C', collections: ['cities'] },
            { id: 'aaaaaa04', title: 'D', pinned: true, collections: ['cities'] }
        ]
    })!;
    const rows = cat.scenes.map((s) => ({ id: s.id }));
    it('pinned go to Featured in the admin order, the rest keep theirs', () => {
        const s = storefront(rows, cat, null);
        expect(s.featured.map((r) => r.id)).toEqual(['aaaaaa02', 'aaaaaa04']);
        expect(s.rest.map((r) => r.id)).toEqual(['aaaaaa01', 'aaaaaa03']);
        expect(s.collections.map((c) => c.id)).toEqual(['cities']); // a collection with no scene shows no chip
    });
    it('a chosen collection narrows the rest; an unknown one is ignored', () => {
        expect(storefront(rows, cat, 'cities').rest.map((r) => r.id)).toEqual(['aaaaaa03']);
        expect(storefront(rows, cat, 'gone').rest.map((r) => r.id)).toEqual(['aaaaaa01', 'aaaaaa03']);
    });
    it('filtered rows (walls only, kind...) decide the chips', () => {
        expect(storefront(rows.slice(0, 2), cat, null).collections).toEqual([]);
    });
});

describe('admin helpers', () => {
    it('moveItem moves and clamps, never loses an item', () => {
        expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
        expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
        expect(moveItem(['a', 'b', 'c'], 1, 99)).toEqual(['a', 'c', 'b']);
        expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    });
    it('collectionId follows the API rule and avoids taken ids', () => {
        expect(collectionId('Old Towns & Streets!', [])).toBe('old-towns-streets');
        expect(collectionId('Cities', ['cities'])).toBe('cities-2');
        expect(collectionId('...', [])).toBe('collection');
        expect(collectionId('Cities', [])).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
    });
    it('localText falls back to English', () => {
        expect(localText({ en: 'Fly', ru: 'R' }, 'ru')).toBe('R');
        expect(localText({ en: 'Fly' }, 'pl')).toBe('Fly');
        expect(localText(undefined, 'pl')).toBe('');
    });
});

const SCALE_TABLE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'scene-scale-range.json'), 'utf8')) as { min: number; max: number; rows: { scale: unknown; kept: number | null }[] };

describe('the default Scene size of a scene (v0.9, item 14)', () => {
    const kept = (scale: unknown): number | undefined => readScene({ id: 'abcdef12', title: 'A', scale })?.scale;

    it('0.25..100, the table the admin API reads too (apps/api/admin.py clean_scene)', () => {
        expect([CATALOG_SCALE_MIN, CATALOG_SCALE_MAX]).toEqual([SCALE_TABLE.min, SCALE_TABLE.max]);
        for (const row of SCALE_TABLE.rows) expect(kept(row.scale), JSON.stringify(row)).toBe(row.kept ?? undefined);
        // control: the range before v0.9 (0.25..4) drops what this table keeps above 4
        const before = (v: unknown): number | undefined => (typeof v === 'number' && v >= 0.25 && v <= 4 ? v : undefined);
        expect(SCALE_TABLE.rows.filter((r) => before(r.scale) !== (r.kept ?? undefined)).map((r) => r.scale)).toEqual([9, 30, 100]);
    });

    it('defaults: read strictly (a scene id and a scale in range), nothing else gets through', () => {
        const c = readCatalog({
            scenes: [{ id: 'aaaaaa01', title: 'A' }],
            defaults: { aaaaaa02: { scale: 30, title: 'leak' }, '../x': { scale: 3 }, aaaaaa03: { scale: 500 }, aaaaaa04: { scale: 'big' }, aaaaaa05: 7, aaaaaa06: {} }
        })!;
        expect(c.defaults).toEqual({ aaaaaa02: { scale: 30 } });
        // control: no defaults key (an older API, the static list) and a junk one both read as none
        expect(readCatalog({ scenes: [] })!.defaults).toBeUndefined();
        expect(readCatalog({ scenes: [], defaults: [1, 2] })!.defaults).toBeUndefined();
        expect(readCatalog({ scenes: [], defaults: { aaaaaa03: { scale: 500 } } })!.defaults).toBeUndefined();
    });

    it('sceneDefaultScale: the entry of the scene itself, else the default of a hidden one, else nothing', () => {
        const c = readCatalog({ scenes: [{ id: 'aaaaaa01', title: 'A', scale: 5 }, { id: 'aaaaaa07', title: 'B' }], defaults: { aaaaaa02: { scale: 30 }, aaaaaa01: { scale: 99 } } })!;
        expect(sceneDefaultScale(c, 'aaaaaa01')).toBe(5); // its own entry wins over a defaults row
        expect(sceneDefaultScale(c, 'aaaaaa02')).toBe(30); // hidden: only in defaults
        expect(sceneDefaultScale(c, 'aaaaaa07')).toBeUndefined(); // listed, no size
        expect(sceneDefaultScale(c, 'ffffff00')).toBeUndefined(); // not in the catalogue at all
        expect(sceneDefaultScale(c, '__proto__')).toBeUndefined();
    });
});
