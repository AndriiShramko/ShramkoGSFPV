// The admin's "not published yet" list (catalogDiff) and a pasted link's drawing parameters (linkRender).
// Each block ends with a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { catalogDiff, linkRender, readCatalog, readScene } from '../src/catalog';
import type { SceneCatalog } from '../src/catalog';

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
        expect(catalogDiff(draft, LIVE)).toEqual({ scenes: [], collections: false, dirty: false });
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
        expect(catalogDiff(draft, live)).toEqual({ scenes: [], collections: true, dirty: true });
        expect(catalogDiff(draft, null).scenes).toEqual([{ id: 'aaaaaa01', title: 'A', kind: 'added' }]);
    });

    it('control: comparing positions one by one (the naive rule) calls every scene a dragged one passed "moved"', () => {
        const draft = cat([{ id: 'aaaaaa02', title: 'B' }, { id: 'aaaaaa03', title: 'C' }, { id: 'aaaaaa04', title: 'D' }, { id: 'aaaaaa01', title: 'A' }]);
        expect(catalogDiff(draft, LIVE).scenes.map((s) => s.id)).toEqual(['aaaaaa01']);
        const naive = draft.scenes.filter((s, i) => LIVE.scenes[i].id !== s.id).map((s) => s.id);
        expect(naive.length).toBe(4);
    });
});

describe('linkRender (a pasted link\'s ?budget=&stochastic, lane R contract)', () => {
    it('reads SuperSplat\'s drawing parameters', () => {
        expect(linkRender('https://superspl.at/scene/2f1ddf5f?budget=8&stochastic')).toEqual({ budgetM: 8, stochastic: true });
        expect(linkRender('superspl.at/scene/2f1ddf5f?budget=0.5')).toEqual({ budgetM: 0.5 });
        expect(linkRender('https://superspl.at/scene/2f1ddf5f?stochastic=1')).toEqual({ stochastic: true });
        expect(linkRender('https://superspl.at/scene/2f1ddf5f')).toBeNull();
    });
    it('control: out of range, another host or not a link says nothing', () => {
        expect(linkRender('https://superspl.at/scene/2f1ddf5f?budget=900')).toBeNull();
        expect(linkRender('https://superspl.at/scene/2f1ddf5f?budget=8e1')).toBeNull();
        expect(linkRender('https://evil.example/scene/2f1ddf5f?budget=8&stochastic')).toBeNull();
        expect(linkRender('2f1ddf5f')).toBeNull();
        expect(linkRender('https://superspl.at/scene/2f1ddf5f?stochastic=false')).toBeNull();
    });
});

describe('origin.user', () => {
    it('keeps a SuperSplat user name and drops anything else', () => {
        expect(readScene({ id: 'abcdef12', title: 'T', origin: { url: 'https://superspl.at/scene/abcdef12', user: 'andriishramko' } })?.origin).toEqual({ url: 'https://superspl.at/scene/abcdef12', user: 'andriishramko' });
        expect(readScene({ id: 'abcdef12', title: 'T', origin: { url: 'https://superspl.at/scene/abcdef12', user: '<b>x</b>' } })?.origin).toEqual({ url: 'https://superspl.at/scene/abcdef12' });
    });
});
