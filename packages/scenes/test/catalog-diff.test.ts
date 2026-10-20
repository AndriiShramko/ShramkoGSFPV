// The admin's "not published yet" list (catalogDiff) and a pasted link's drawing parameters as the
// admin's "Add a scene" stores them (lane R's parseSceneLink + catalogueRender: one link parser).
// Each block ends with a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { catalogDiff, readCatalog, readScene } from '../src/catalog';
import { catalogueRender, parseSceneLink } from '../src/link';
import type { SceneCatalog, SceneRender } from '../src/catalog';

const cat = (scenes: object[], collections: object[] = []): SceneCatalog => readCatalog({ scenes, collections })!;
const LIVE = cat([
    { id: 'aaaaaa01', title: 'A', walls: 'on', pinned: false, hidden: false, collections: [] },
    { id: 'aaaaaa02', title: 'B' },
    { id: 'aaaaaa03', title: 'C' },
    { id: 'aaaaaa04', title: 'D' }
]);

describe('catalogDiff', () => {
    it('nothing changed: not dirty, even when the draft leaves out the defaults the API writes', () => {
        const draft = cat([{ id: 'aaaaaa01', title: 'A' }, { id: 'aaaaaa02', title: 'B' }, { id: 'aaaaaa03', title: 'C' }, { id: 'aaaaaa04', title: 'D' }]);
        expect(catalogDiff(draft, LIVE)).toEqual({ scenes: [], collections: false, drawing: false, dirty: false });
    });

    it('added, removed, changed (with the fields) and one dragged scene = one "moved"', () => {
        const draft = cat([
            { id: 'ffffff01', title: 'New' },
            { id: 'aaaaaa02', title: 'B' },
            { id: 'aaaaaa03', title: 'C', hidden: true, about: { en: 'Our words' } },
            { id: 'aaaaaa01', title: 'A' }
        ]);
        const d = catalogDiff(draft, LIVE);
        expect(d.dirty).toBe(true);
        expect(d.scenes).toEqual([
            { id: 'ffffff01', title: 'New', kind: 'added' },
            { id: 'aaaaaa03', title: 'C', kind: 'changed', fields: ['about', 'hidden'] },
            { id: 'aaaaaa01', title: 'A', kind: 'moved' },
            { id: 'aaaaaa04', title: 'D', kind: 'removed' }
        ]);
    });

    it('a renamed collection alone makes the draft dirty; with nothing live every scene is new', () => {
        const live = cat([{ id: 'aaaaaa01', title: 'A' }], [{ id: 'c1', title: { en: 'Cities' } }]);
        const draft = cat([{ id: 'aaaaaa01', title: 'A' }], [{ id: 'c1', title: { en: 'Towns' } }]);
        expect(catalogDiff(draft, live)).toEqual({ scenes: [], collections: true, drawing: false, dirty: true });
        expect(catalogDiff(draft, null).scenes).toEqual([{ id: 'aaaaaa01', title: 'A', kind: 'added' }]);
    });

    it('the drawing defaults (the device presets) are part of what Publish would change (v0.10)', () => {
        const scenes = [{ id: 'aaaaaa01', title: 'A' }];
        const live = readCatalog({ scenes, collections: [], drawing: { presets: { phone: { budgetM: 2 } } } })!;
        const same = readCatalog({ scenes, collections: [], drawing: { presets: { phone: { budgetM: 2 } } } })!;
        const edited = readCatalog({ scenes, collections: [], drawing: { presets: { phone: { budgetM: 1.5 } } } })!;
        const cleared = readCatalog({ scenes, collections: [] })!;
        expect(catalogDiff(same, live)).toEqual({ scenes: [], collections: false, drawing: false, dirty: false });
        expect(catalogDiff(edited, live)).toEqual({ scenes: [], collections: false, drawing: true, dirty: true });
        // back to the built-in table (the key gone) is a change too; and nothing live with defaults in the draft is
        expect(catalogDiff(cleared, live).drawing).toBe(true);
        expect(catalogDiff(live, cleared).drawing).toBe(true);
        expect(catalogDiff(cleared, cleared).dirty).toBe(false);
        // key order inside the document is not a change
        const reordered = readCatalog({ scenes, collections: [], drawing: { presets: { phone: { budgetM: 2 } } } })!;
        expect(catalogDiff(reordered, live).drawing).toBe(false);
        // control: a diff that looks only at scenes and collections (the v0.9 rule) calls the edited draft clean
        const v09 = (d: SceneCatalog, l: SceneCatalog): boolean => catalogDiff({ ...d, drawing: undefined }, { ...l, drawing: undefined }).dirty;
        expect(v09(edited, live)).toBe(false);
    });

    it('readCatalog carries the drawing document through untouched, and drops anything that is not a small plain object', () => {
        const doc = { presets: { tablet: { drawing: 'sorted', budgetM: 1.5, renderScale: 0.8 } } };
        expect(readCatalog({ scenes: [], collections: [], drawing: doc })?.drawing).toEqual(doc);
        for (const bad of [undefined, null, 5, 'x', [], [doc]]) expect(readCatalog({ scenes: [], collections: [], drawing: bad })?.drawing, JSON.stringify(bad)).toBeUndefined();
        expect(readCatalog({ scenes: [], collections: [], drawing: { presets: { x: 'y'.repeat(5000) } } })?.drawing).toBeUndefined();
        // the document is a copy: editing it never edits the source
        const copy = readCatalog({ scenes: [], collections: [], drawing: doc })!;
        (copy.drawing as { presets: { tablet: { budgetM: number } } }).presets.tablet.budgetM = 9;
        expect(doc.presets.tablet.budgetM).toBe(1.5);
    });

    it('control: comparing positions one by one (the naive rule) calls every scene a dragged one passed "moved"', () => {
        const draft = cat([{ id: 'aaaaaa02', title: 'B' }, { id: 'aaaaaa03', title: 'C' }, { id: 'aaaaaa04', title: 'D' }, { id: 'aaaaaa01', title: 'A' }]);
        expect(catalogDiff(draft, LIVE).scenes.map((s) => s.id)).toEqual(['aaaaaa01']);
        const naive = draft.scenes.filter((s, i) => LIVE.scenes[i].id !== s.id).map((s) => s.id);
        expect(naive.length).toBe(4);
    });
});

/**
 * The admin's "Add a scene" (apps/fly/src/admin/scenes-tab.ts find): lane R's one link parser, the result
 * stored as the catalogue contract keeps it (a budget in 0.25..32 M, stochastic true or false: since v0.9 stochastic
 * is the desktop default, so an explicit sorted is the owner's choice for the scene and is kept).
 */
const addRender = (raw: string): SceneRender | undefined => catalogueRender(parseSceneLink(raw)?.render);

/** [pasted text, the entry's render] */
const ADD_CASES: [string, SceneRender | undefined][] = [
    ['https://superspl.at/scene/2f1ddf5f?budget=8&stochastic', { budgetM: 8, stochastic: true }],
    ['superspl.at/scene/2f1ddf5f?budget=0.5', { budgetM: 0.5 }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=1', { stochastic: true }],
    ['https://superspl.at/scene/2f1ddf5f', undefined],
    ['https://superspl.at/scene/2f1ddf5f?budget=900', undefined],
    ['https://superspl.at/scene/2f1ddf5f?budget=8e1', undefined],
    ['https://evil.example/scene/2f1ddf5f?budget=8&stochastic', undefined],
    ['2f1ddf5f', undefined],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=false', { stochastic: false }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=0&budget=4', { budgetM: 4, stochastic: false }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=maybe', undefined]
];

const addFailures = (read: (raw: string) => SceneRender | null | undefined): string[] =>
    ADD_CASES.filter(([raw, want]) => JSON.stringify(read(raw) ?? undefined) !== JSON.stringify(want)).map(([raw]) => raw);

describe('a pasted link\'s drawing parameters for the catalogue entry (the admin\'s Add: parseSceneLink + catalogueRender)', () => {
    it('every case: SuperSplat\'s parameters kept, out of range / another host / an id / an unknown value store nothing (sorted is kept)', () => {
        expect(addFailures(addRender)).toEqual([]);
        // the scene of an out-of-range link still opens: only its budget is dropped
        expect(parseSceneLink('https://superspl.at/scene/2f1ddf5f?budget=900')).toEqual({ id: '2f1ddf5f' });
    });

    it('control: the admin\'s former parser (any stochastic value but 0/false = on) and the link\'s request stored raw both fail', () => {
        const former = (raw: string): SceneRender | null => {
            let u: URL;
            try { u = new URL(raw.includes('://') ? raw : `https://${raw}`); } catch { return null; }
            if (!/^(www\.)?superspl\.at$/i.test(u.hostname)) return null;
            const st = u.searchParams.get('stochastic');
            const b = u.searchParams.get('budget');
            const r: SceneRender = {};
            if (b !== null && /^\d{1,2}(\.\d{1,3})?$/.test(b) && Number(b) >= 0.25 && Number(b) <= 32) r.budgetM = Number(b);
            if (st !== null && st !== '0' && st !== 'false') r.stochastic = true;
            return Object.keys(r).length ? r : null;
        };
        expect(addFailures(former)).toEqual(['https://superspl.at/scene/2f1ddf5f?stochastic=false', 'https://superspl.at/scene/2f1ddf5f?stochastic=0&budget=4', 'https://superspl.at/scene/2f1ddf5f?stochastic=maybe']);
        // control: the v0.7 contract (only stochastic: true is stored; sorted was the default) loses the owner's "sorted for this scene"
        const v07 = (raw: string): SceneRender | undefined => {
            const r = parseSceneLink(raw)?.render;
            if (!r) return undefined;
            const out: SceneRender = {};
            if (r.budgetM !== undefined) out.budgetM = r.budgetM;
            if (r.stochastic === true) out.stochastic = true;
            return Object.keys(out).length ? out : undefined;
        };
        expect(addFailures(v07)).toEqual(['https://superspl.at/scene/2f1ddf5f?stochastic=false', 'https://superspl.at/scene/2f1ddf5f?stochastic=0&budget=4']);
    });
});

describe('origin.user', () => {
    it('keeps a SuperSplat user name and drops anything else', () => {
        expect(readScene({ id: 'abcdef12', title: 'T', origin: { url: 'https://superspl.at/scene/abcdef12', user: 'andriishramko' } })?.origin).toEqual({ url: 'https://superspl.at/scene/abcdef12', user: 'andriishramko' });
        expect(readScene({ id: 'abcdef12', title: 'T', origin: { url: 'https://superspl.at/scene/abcdef12', user: '<b>x</b>' } })?.origin).toEqual({ url: 'https://superspl.at/scene/abcdef12' });
    });
});
