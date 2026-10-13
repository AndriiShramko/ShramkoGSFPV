// Scene links with SuperSplat's drawing parameters (v0.7 lane R): every link form keeps the id AND
// budget / stochastic; hostile values are dropped, never passed on. Each table also runs against a
// deliberately naive parser (SuperSplat's own rules: Number(budget), has('stochastic')) and an
// id-only parser: those must fail, or the table would not be checking anything.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSceneLink, parseSceneInput, renderParams, sceneRender, sameRender, catalogueRender, writeSceneQuery, flyQueryString, flyDeepLink } from '../src/index';
import type { SceneLink, SceneRender } from '../src/index';

type Parser = (raw: string) => SceneLink | null;

/** [input, expected] — the owner's own example first */
const CASES: [string, SceneLink | null][] = [
    ['https://superspl.at/scene/2f1ddf5f?budget=8&stochastic', { id: '2f1ddf5f', render: { budgetM: 8, stochastic: true } }],
    ['superspl.at/scene/2f1ddf5f?budget=8&stochastic', { id: '2f1ddf5f', render: { budgetM: 8, stochastic: true } }],
    ['https://www.superspl.at/scene/2F1DDF5F/?stochastic=1', { id: '2f1ddf5f', render: { stochastic: true } }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=true', { id: '2f1ddf5f', render: { stochastic: true } }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=ON', { id: '2f1ddf5f', render: { stochastic: true } }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=0', { id: '2f1ddf5f', render: { stochastic: false } }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=false&budget=2.5', { id: '2f1ddf5f', render: { budgetM: 2.5, stochastic: false } }],
    ['https://superspl.at/s?id=2f1ddf5f&budget=4&stochastic', { id: '2f1ddf5f', render: { budgetM: 4, stochastic: true } }],
    ['http://superspl.at/scene/2f1ddf5f?budget=0.25', { id: '2f1ddf5f', render: { budgetM: 0.25 } }],
    ['https://superspl.at/scene/2f1ddf5f?budget=32', { id: '2f1ddf5f', render: { budgetM: 32 } }],
    // plain links and ids: no render at all
    ['https://superspl.at/scene/2f1ddf5f', { id: '2f1ddf5f' }],
    ['  2F1DDF5F  ', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?foo=bar#stochastic', { id: '2f1ddf5f' }],
    // hostile or out-of-range values are dropped, the scene still opens
    ['https://superspl.at/scene/2f1ddf5f?budget=1e9&stochastic', { id: '2f1ddf5f', render: { stochastic: true } }],
    ['https://superspl.at/scene/2f1ddf5f?budget=NaN', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=Infinity', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=-1', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=0x10', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=8abc', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=%208', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=0.2', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=33', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?budget=8&budget=1', { id: '2f1ddf5f', render: { budgetM: 8 } }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=%3Cscript%3Ealert(1)%3C/script%3E', { id: '2f1ddf5f' }],
    ['https://superspl.at/scene/2f1ddf5f?stochastic=maybe&budget=6', { id: '2f1ddf5f', render: { budgetM: 6 } }],
    // not SuperSplat scene links
    ['https://superspl.at.evil.example/scene/2f1ddf5f?stochastic', null],
    ['https://evil.example/?u=https://superspl.at/scene/2f1ddf5f', null],
    ['javascript://superspl.at/scene/2f1ddf5f?stochastic', null],
    ['https://superspl.at/scene/xyz?stochastic', null],
    ['https://superspl.at/scene/2f1ddf5f/edit?budget=8', null],
    [`https://superspl.at/scene/2f1ddf5f?x=${'a'.repeat(3000)}`, null],
    ['', null]
];

function failures(parse: Parser): string[] {
    const out: string[] = [];
    for (const [input, want] of CASES) {
        let got: SceneLink | null;
        try { got = parse(input); } catch (e) { got = null; out.push(`${input.slice(0, 80)}: threw ${String(e)}`); continue; }
        if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${input.slice(0, 80)}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    }
    return out;
}

/** Control 1: SuperSplat's own reading (any number, any stochastic value), on our id rules. */
const naive: Parser = (raw) => {
    const id = parseSceneInput(raw);
    if (!id) return null;
    let u: URL | null = null;
    try { u = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`); } catch { u = null; }
    if (!u || u.hostname.toLowerCase().endsWith('superspl.at') === false) return { id };
    const r: Record<string, unknown> = {};
    const b = u.searchParams.get('budget');
    if (b !== null && Number(b) > 0) r.budgetM = Number(b);
    if (u.searchParams.has('stochastic')) r.stochastic = true;
    return Object.keys(r).length ? { id, render: r } : { id };
};

/** Control 2: the v0.6 parser, the id only. */
const idOnly: Parser = (raw) => {
    const id = parseSceneInput(raw);
    return id ? { id } : null;
};

describe('parseSceneLink: the id and the drawing parameters of every link form', () => {
    it('every case of the table', () => {
        expect(failures(parseSceneLink)).toEqual([]);
    });

    it('control: SuperSplat\'s own reading of the values fails the hostile rows', () => {
        const f = failures(naive);
        expect(f.length).toBeGreaterThanOrEqual(8);
        expect(f.some((x) => x.includes('budget=1e9'))).toBe(true);
        expect(f.some((x) => x.includes('stochastic=0'))).toBe(true);
    });

    it('control: an id-only parser fails every row with parameters', () => {
        expect(failures(idOnly).length).toBeGreaterThanOrEqual(12);
    });

    it('parseSceneInput still gives the id of a link with parameters (every caller of v0.6 keeps working)', () => {
        expect(parseSceneInput('https://superspl.at/scene/2f1ddf5f?budget=8&stochastic')).toBe('2f1ddf5f');
        expect(parseSceneInput('https://superspl.at/s?id=39e63ce9&stochastic')).toBe('39e63ce9');
        expect(parseSceneInput('https://example.com/scene/39e63ce9')).toBeNull();
    });
});

describe('renderParams: the raw values of a query', () => {
    it('absent (null) and present without a value (\'\') are different', () => {
        expect(renderParams(null, null)).toBeUndefined();
        expect(renderParams(null, '')).toEqual({ stochastic: true });
        expect(renderParams('8', null)).toEqual({ budgetM: 8 });
        expect(renderParams('.5', 'off')).toEqual({ budgetM: 0.5, stochastic: false });
    });
});

describe('the fly deep link /fly/?scene=<id>&budget=<M>&stochastic', () => {
    it('is written with a bare stochastic flag, and reads back to the same request', () => {
        const href = flyDeepLink('/en/fly/', '2f1ddf5f', { budgetM: 8, stochastic: true });
        expect(href).toBe('/en/fly/?scene=2f1ddf5f&budget=8&stochastic');
        const q = new URL(href, 'https://gsfpv.flyreelstudio.eu').searchParams;
        expect(q.get('scene')).toBe('2f1ddf5f');
        expect(renderParams(q.get('budget'), q.get('stochastic'))).toEqual({ budgetM: 8, stochastic: true });
    });

    it('the table the share page\'s writer (apps/api/server.py fly_link) is held to as well, and every row reads back', () => {
        const table = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fly-deep-links.json'), 'utf8')) as { rows: { render: SceneRender | null; link: string }[] };
        expect(table.rows.length).toBeGreaterThan(5);
        for (const { render, link } of table.rows) {
            expect(flyDeepLink('/en/fly/', '2f1ddf5f', render ?? undefined)).toBe(link);
            const q = new URL(link, 'https://gsfpv.flyreelstudio.eu').searchParams;
            expect(renderParams(q.get('budget'), q.get('stochastic')) ?? null).toEqual(render);
        }
        // control: the link without the request (what share wrote before) matches only the row without one
        expect(table.rows.filter((r) => r.link === '/en/fly/?scene=2f1ddf5f').length).toBe(1);
    });

    it('keeps the page\'s other parameters and removes a budget or flag left from another scene', () => {
        const q = new URLSearchParams('scene=39e63ce9&budget=8&stochastic=&lat=1&nowarn=1');
        writeSceneQuery(q, '887f27aa');
        expect(flyQueryString(q)).toBe('scene=887f27aa&lat=1&nowarn=1');
        writeSceneQuery(q, '2f1ddf5f', { stochastic: false });
        expect(flyQueryString(q)).toBe('scene=2f1ddf5f&lat=1&nowarn=1&stochastic=0');
        // control: without the clean-up the old budget would stay with the new scene
        const stale = new URLSearchParams('scene=39e63ce9&budget=8');
        stale.set('scene', '887f27aa');
        expect(stale.get('budget')).toBe('8');
    });

    it('a pasted SuperSplat link inside ?scene= keeps its parameters (the landing\'s ScenePaste sends the raw text)', () => {
        const raw = 'https://superspl.at/scene/2f1ddf5f?budget=8&stochastic';
        const page = new URL(`https://gsfpv.flyreelstudio.eu/en/fly/?scene=${encodeURIComponent(raw)}`);
        expect(parseSceneLink(page.searchParams.get('scene')!)).toEqual({ id: '2f1ddf5f', render: { budgetM: 8, stochastic: true } });
        // control: the same link pasted without encoding loses its parameters to the page
        const bare = new URL(`https://gsfpv.flyreelstudio.eu/en/fly/?scene=${raw}`);
        expect(parseSceneLink(bare.searchParams.get('scene')!)).toEqual({ id: '2f1ddf5f', render: { budgetM: 8 } });
    });
});

describe('sceneRender: the link wins field by field, the catalogue is the default', () => {
    it('fields', () => {
        expect(sceneRender(undefined, undefined)).toBeUndefined();
        expect(sceneRender(undefined, { budgetM: 6, stochastic: true })).toEqual({ budgetM: 6, stochastic: true });
        expect(sceneRender({ stochastic: false }, { budgetM: 6, stochastic: true })).toEqual({ budgetM: 6, stochastic: false });
        expect(sceneRender({ budgetM: 2 }, { budgetM: 6, stochastic: true })).toEqual({ budgetM: 2, stochastic: true });
    });

    it('catalogueRender keeps only what the contract stores (a budget in range, stochastic: true)', () => {
        expect(catalogueRender({ budgetM: 8, stochastic: true })).toEqual({ budgetM: 8, stochastic: true });
        expect(catalogueRender({ stochastic: false })).toBeUndefined();
        expect(catalogueRender({ budgetM: 64 })).toBeUndefined();
        expect(catalogueRender(undefined)).toBeUndefined();
    });

    it('sameRender: the same budget and flag (an explicit "sorted" is not "nothing asked"; the controls differ)', () => {
        expect(sameRender(undefined, undefined)).toBe(true);
        expect(sameRender({ budgetM: 8, stochastic: true }, { stochastic: true, budgetM: 8 })).toBe(true);
        expect(sameRender({ stochastic: false }, undefined)).toBe(false);
        expect(sameRender({ budgetM: 8 }, { budgetM: 4 })).toBe(false);
        expect(sameRender({ stochastic: true }, { stochastic: true, budgetM: 8 })).toBe(false);
    });
});
